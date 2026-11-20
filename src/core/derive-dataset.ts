/**
 * 运行时数据派生层（数据分层的枢纽）。
 *
 * L0 外部输入：bars（公开日 K）、intraday（公开分时）、manifest（契约 + 流通股本），
 *              以及 4 份 Level-2 示意数据（auction / trades / depth / orders）。
 * L1 中间计算：chips、intradayMulti、depthFull、depthScenarios 均由 src/algorithms 在运行时生成，
 *              不再落盘为独立 JSON。
 *
 * 本层同时负责「强逻辑关联」的数值闭合：分时累计量额、逐笔按分钟聚合、多日量额锚定、
 * 委托流生命周期守恒、全景盘口与十档同源。所有修正都以 bars / intraday 为真源。
 */
import type {
  Bar, ChartDataset, IntradayPoint, TradeTick, OrderRecord,
  DepthBookSnapshot, Manifest,
} from '../types';
import { r2, r6 } from '../algorithms/rounding';
import { limitRateFor, limitPrices } from '../algorithms/price-limits';
import { mulberry32 } from '../algorithms/random';
import { PRICE_TICK } from '../core/market-constants';
import { buildChipDistribution } from '../algorithms/chip-distribution';
import { buildIntradayMulti } from '../algorithms/intraday-multi';
import { buildTradeSeries } from '../algorithms/trade-series';
import { reduceOrderBook, linkFillsToTrades } from '../algorithms/order-book';
import { buildDepthScenarios } from '../algorithms/depth-scenarios';

interface DeriveContext {
  preClose: number;
  limitRate: number;
  iso: string;
}

/** 从 manifest 提取派生所需的静态上下文 */
function contextOf(manifest: Manifest): DeriveContext {
  return {
    preClose: manifest.preClose,
    limitRate: manifest.limitRate ?? limitRateFor(manifest.symbol, manifest.name),
    iso: manifest.tradeDate.replace(/-/g, ''),
  };
}

/**
 * 分时累计量/额/均价由逐点增量重算，并把 15:00 的累计额锚定到当日日 K amount。
 * 原数据两个来源各自取整导致 15:00 累计额与 bars.amount 差约 2.28 万元（量为 0）。
 */
function normalizeIntraday(points: IntradayPoint[], lastBar: Bar): IntradayPoint[] {
  if (!points?.length) return points;
  const out = points.map((p) => ({ ...p }));
  let closeIdx = -1;
  for (let i = 0; i < out.length; i += 1) if (out[i].time === '15:00') closeIdx = i;
  if (closeIdx >= 0) {
    // 把差额落在 15:00 这一分钟的增量上，保证累计额逐点自洽且末点锚定日 K
    const prior = closeIdx > 0 ? out[closeIdx - 1].cumulativeAmount : 0;
    const target = lastBar.amount - prior;
    if (Number.isFinite(target) && target > 0) out[closeIdx].amount = r2(target);
  }
  let cv = 0, ca = 0;
  for (const p of out) {
    cv += p.volume;
    ca += p.amount;
    p.cumulativeVolume = cv;
    p.cumulativeAmount = r2(ca);
    p.avgPrice = cv > 0 ? r2(ca / cv) : p.price;
  }
  return out;
}

/**
 * 多日前 N-1 日的拟真分时量额锚定到对应日 K 的 volume / amount。
 * 原拟真量额与 bars 差 3~4 倍，破坏跨图一致性；末日（真实分时）保持不变。
 */
function anchorIntradayMulti(points: IntradayPoint[], bars: Bar[], lastDate: string): IntradayPoint[] {
  if (!points?.length) return points;
  const byDate = new Map<string, Bar>();
  for (const b of bars) byDate.set(b.tradeDate, b);
  const groups = new Map<string, IntradayPoint[]>();
  for (const p of points) {
    const d = p.tradeDate || lastDate;
    const arr = groups.get(d);
    if (arr) arr.push(p); else groups.set(d, [p]);
  }
  for (const [date, arr] of groups) {
    if (date === lastDate) continue;
    const bar = byDate.get(date);
    if (!bar || !arr.length) continue;
    const totalVol = arr.reduce((s, p) => s + p.volume, 0);
    const totalAmt = arr.reduce((s, p) => s + p.amount, 0);
    const kv = totalVol > 0 ? bar.volume / totalVol : 0;
    const ka = totalAmt > 0 ? bar.amount / totalAmt : 0;
    let cv = 0, ca = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const p = arr[i];
      if (i === arr.length - 1) {
        // 末点吸收整百股取整产生的残差，使当日累计量/额严格等于日 K
        p.volume = Math.max(0, bar.volume - cv);
        p.amount = r2(Math.max(0, bar.amount - ca));
      } else {
        p.volume = Math.round(p.volume * kv / 100) * 100;
        p.amount = r2(p.amount * ka);
      }
      cv += p.volume;
      ca += p.amount;
      p.cumulativeVolume = cv;
      p.cumulativeAmount = r2(ca);
      p.avgPrice = cv > 0 ? r2(ca / cv) : p.price;
    }
  }
  return points;
}

/**
 * 委托流生命周期守恒：为所有「非 snapshot 且仍有剩余量、又无后续事件」的 NEW 补发 CANCEL，
 * 使 ΣNEW = ΣFILL + ΣCANCEL + Σsnapshot。原生成脚本的 openOrders 240 上限会静默丢弃挂单。
 */
function closeOpenOrders(orders: OrderRecord[]): OrderRecord[] {
  if (!orders?.length) return orders;
  const remaining = new Map<string, number>();
  const hasEvent = new Set<string>();
  const out: OrderRecord[] = [];
  for (const o of orders) {
    out.push(o);
    if (o.action === 'NEW' && !o.snapshot) remaining.set(o.ordId, o.volume);
    if (o.action === 'FILL' || o.action === 'CANCEL') {
      if (o.origOrdId) {
        hasEvent.add(o.origOrdId);
        remaining.set(o.origOrdId, (remaining.get(o.origOrdId) ?? 0) - o.volume);
      }
    }
  }
  const orphans = [...remaining.entries()].filter(([, v]) => v > 0);
  if (!orphans.length) return out;
  const byId = new Map<string, OrderRecord>();
  for (const o of orders) if (o.action === 'NEW' && !o.snapshot) byId.set(o.ordId, o);
  const extra: OrderRecord[] = [];
  for (const [id, vol] of orphans) {
    const src = byId.get(id);
    if (!src) continue;
    extra.push({
      ...src,
      action: 'CANCEL',
      volume: vol,
      origOrdId: id,
      origVolume: src.volume,
      remainVolume: 0,
      cancelOf: id,
      time: '15:00:00',
      phase: 'continuous',
    });
  }
  const merged = [...out, ...extra].sort((a, b) => a.time.localeCompare(b.time));
  return merged;
}

/**
 * 远档挂单（全景盘口）：真实委托簿里未撤未成交的低价买单 / 高价卖单会一直留存到涨跌停边界。
 * 守恒修复后所有近档悬空挂单都有了终态，这里按确定性规则把远档补成「收盘存活 snapshot」，
 * 使全景盘口保持完整档位，且与 orders 事件流同源（回放后即得到同一份簿）。
 */
function appendFarLevels(orders: OrderRecord[], depth: DepthBookSnapshot, ctx: DeriveContext): OrderRecord[] {
  const { up: limitUp, down: limitDown } = limitPrices(ctx.preClose, ctx.limitRate);
  const nearBid = Math.min(...(depth.bids ?? []).map((l) => l.price));
  const nearAsk = Math.max(...(depth.asks ?? []).map((l) => l.price));
  if (!Number.isFinite(nearBid) || !Number.isFinite(nearAsk)) return orders;
  const rnd = mulberry32(2026111303);
  const extra: OrderRecord[] = [];
  const pushLevel = (price: number, side: 'B' | 'S', level: number, i: number, n: number) => {
    const vol = (Math.round(2 + rnd() * 26) * 100) * Math.max(1, Math.round(1 + (n - i) / 12));
    extra.push({
      ordId: `FAR${side}${String(level).padStart(3, '0')}`,
      time: '15:00:00', price: r2(price), volume: vol, side, action: 'NEW',
      level, phase: 'closing', snapshot: true, remainVolume: vol, origVolume: vol,
      tag: side,
    });
  };
  const BID_N = 43, ASK_N = 23;
  for (let i = 0; i < BID_N; i += 1) {
    const p = i === BID_N - 1 ? limitDown
      : nearBid - PRICE_TICK - ((nearBid - PRICE_TICK - limitDown) * (i + 1)) / (BID_N + 1);
    if (p <= limitDown && i !== BID_N - 1) continue;
    pushLevel(p, 'B', 11 + i, i, BID_N);
  }
  for (let i = 0; i < ASK_N; i += 1) {
    const p = i === ASK_N - 1 ? limitUp
      : nearAsk + PRICE_TICK + ((limitUp - nearAsk - PRICE_TICK) * (i + 1)) / (ASK_N + 1);
    if (p >= limitUp && i !== ASK_N - 1) continue;
    pushLevel(p, 'S', 11 + i, i, ASK_N);
  }
  return [...orders, ...extra];
}

/** 把 depth 字段归一化为单个快照（历史文件可能是数组） */
function firstDepth(depth: unknown): DepthBookSnapshot | null {
  if (Array.isArray(depth)) return (depth[0] as DepthBookSnapshot) ?? null;
  return (depth as DepthBookSnapshot) ?? null;
}

/**
 * 由 L0 输入派生完整 dataset。纯函数：不修改入参，返回新对象。
 * 可被 loadDataset 调用一次，也可对 Partial<ChartDataset> 重复调用（幂等）。
 */
export function deriveDataset(base: ChartDataset): ChartDataset {
  const bars = base.bars ?? [];
  if (!bars.length || !base.manifest) return base;
  const ctx = contextOf(base.manifest);
  const lastBar = bars[bars.length - 1];

  // 1) 分时：累计量额/均价重算 + 15:00 累计额锚定日 K
  const intraday = normalizeIntraday(base.intraday ?? [], lastBar);

  // 2) 逐笔：按分钟量额严格锚定分时（算法已保证逐分钟聚合相等）
  const trades = buildTradeSeries(intraday, ctx.iso);

  // 3) 委托流：补发终态，保证守恒；再据同一份状态机回放全景盘口
  const depth = firstDepth(base.depth) ?? { bids: [], asks: [] } as DepthBookSnapshot;
  const orders = appendFarLevels(
    closeOpenOrders((base.orders ?? []) as OrderRecord[]), depth, ctx,
  );
  const depthFull = reduceOrderBook(orders, intraday, depth, ctx);

  // 4) L1 派生数据集
  const chips = buildChipDistribution(bars);
  const intradayMulti = anchorIntradayMulti(
    buildIntradayMulti(bars, intraday, 5), bars, base.manifest.tradeDate,
  );
  const depthScenarios = buildDepthScenarios(depth, depthFull, ctx);

  return {
    ...base,
    intraday,
    trades: linkFillsToTrades(trades, orders),
    orders,
    depth,
    depthFull,
    depthScenarios,
    chips,
    intradayMulti,
  };
}
