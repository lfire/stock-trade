/**
 * 运行时数据派生层（数据分层的枢纽）。
 *
 * L0 外部输入：bars / intraday / manifest，以及 auction / depth / orders 三份示意数据，
 *              均为「输入层精简」后的最小字段集（见 src/data/SOURCES.md）。
 * L1 运行时派生：本层把落盘删除的字段在内存副本上补齐——bars 演示四态、intraday 归一化字段、
 *              竞价末点量额、盘口档位笔数、委托流派生字段；chips / intradayMulti /
 *              depthFull / depthScenarios / trades 由 src/algorithms 在运行时生成，不再落盘。
 *
 * 本层同时负责「强逻辑关联」的数值闭合：分时累计量额、逐笔按分钟聚合、多日量额锚定、
 * 委托流生命周期守恒、全景盘口与十档同源。所有修正都以 bars / intraday 为真源。
 * 纯函数：不修改入参，所有派生都返回新数组 / 浅拷贝对象。
 */
import type {
  Bar, ChartDataset, IntradayPoint, TradeTick, OrderRecord,
  DepthBookSnapshot, AuctionPoint, Manifest, LimitState,
} from '../types';
import { r2, r6 } from '../algorithms/rounding';
import { limitRateFor, limitPrices } from '../algorithms/price-limits';
import { mulberry32 } from '../algorithms/random';
import { avgPriceOf } from '../algorithms/vwap';
import { PRICE_TICK, LOT_SIZE } from '../core/market-constants';
import { buildChipDistribution } from '../algorithms/chip-distribution';
import { buildIntradayMulti } from '../algorithms/intraday-multi';
import { buildHistoricalIntraday } from '../algorithms/historical-intraday';
import { buildTradeSeries } from '../algorithms/trade-series';
import { assignTradeOrderNos } from '../algorithms/trade-order-runs';
import { reduceOrderBook, linkFillsToTrades } from '../algorithms/order-book';
import { buildDepthScenarios } from '../algorithms/depth-scenarios';
import { resolveModules, requiredDataFor } from '../workspace/module-catalog';
import type { DataKey, WorkspacePreset } from '../workspace/module-catalog';

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

/** 'HH:mm:ss' / 'HH:mm' → 自 00:00 起算的秒数（与 order-book.ts 的 T() 同口径）。 */
function clockSec(s: string): number {
  const p = s.split(':').map(Number);
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}

/**
 * 0) 可推导字段补齐（输入契约中标为「可选」的字段）：已有值一律原样保留、对象引用不变，
 * 只在缺失时按市面口径计算——
 *  - manifest：open / close 取当日日 K，limitRate 按代码 / 名称识别板块；
 *  - bars：preClose 取上一根 close（首根取开盘价）、timestamp 取交易日 00:00 UTC、
 *    change / pctChg / amplitude 由 preClose 计算、turnoverRate = volume ÷ floatShares。
 */
function hydrateManifest(m: Manifest, lastBar: Bar | undefined): Manifest {
  const day = lastBar && lastBar.tradeDate === m.tradeDate ? lastBar : undefined;
  const open = m.open ?? day?.open;
  const close = m.close ?? day?.close;
  const limitRate = m.limitRate ?? limitRateFor(m.symbol, m.name);
  if (open === m.open && close === m.close && limitRate === m.limitRate) return m;
  return { ...m, open, close, limitRate } as Manifest;
}

function hydrateBars(bars: Bar[], manifest: Manifest): Bar[] {
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const shares = manifest.floatShares;
  let changed = false;
  const out = bars.map((b, i) => {
    if (fin(b.preClose) && fin(b.timestamp) && fin(b.change) && fin(b.pctChg)
      && fin(b.amplitude) && (fin(b.turnoverRate) || !fin(shares))) return b;
    changed = true;
    const preClose = fin(b.preClose) ? b.preClose : (i > 0 ? bars[i - 1].close : b.open);
    return {
      ...b,
      preClose,
      timestamp: fin(b.timestamp) ? b.timestamp : Date.parse(`${b.tradeDate}T00:00:00Z`),
      change: fin(b.change) ? b.change : r2(b.close - preClose),
      pctChg: fin(b.pctChg) ? b.pctChg : r2(((b.close - preClose) / preClose) * 100),
      amplitude: fin(b.amplitude) ? b.amplitude : r2(((b.high - b.low) / preClose) * 100),
      turnoverRate: fin(b.turnoverRate) ? b.turnoverRate
        : (fin(shares) && shares > 0 ? r2((b.volume / shares) * 100) : b.turnoverRate),
    };
  });
  return changed ? out : bars;
}

/**
 * 1) bars 演示形态叠加：按 manifest.demoPatterns 的 tradeDate 在内存副本上设置
 * limitState（四态配色由 price-pane 消费），落盘 bars 保持东财原生不变。
 */
function applyDemoPatterns(bars: Bar[], manifest: Manifest): Bar[] {
  const patterns = manifest.demoPatterns;
  if (!patterns?.length) return bars;
  const byDate = new Map<string, LimitState>();
  for (const p of patterns) byDate.set(p.tradeDate, p.state);
  return bars.map((b) => {
    const state = byDate.get(b.tradeDate);
    return state !== undefined && b.limitState !== state
      ? { ...b, limitState: state }
      : b;
  });
}

/**
 * 2) intraday 最小落盘（time/price/volume/amount/tradeDate）补齐运行时字段：
 * timestamp（tradeDate + time + 08:00 的 UTC ms）、session、source。
 * 累计量额 / 均价仍由后续 normalizeIntraday() 由增量重算。
 */
function hydrateIntraday(points: IntradayPoint[], manifest: Manifest): IntradayPoint[] {
  if (!points?.length) return points;
  const fallback = manifest.tradeDate;
  return points.map((p) => {
    const tradeDate = p.tradeDate || fallback;
    const hm = p.time.slice(0, 5);
    const clock = p.time.length === 5 ? `${p.time}:00` : p.time;
    const timestamp = Number.isFinite(p.timestamp)
      ? p.timestamp
      : Date.parse(`${tradeDate}T${clock}+08:00`);
    const session: IntradayPoint['session'] =
      hm <= '11:30' ? 'morning' : hm <= '15:00' ? 'afternoon' : 'afterHours';
    return { ...p, tradeDate, timestamp, session, source: 'real-intraday' as const };
  });
}

/**
 * 3) 竞价末点量额：开盘 9:25 / 尾盘 15:00 两个统一撮合时点，从 intraday 对应分钟
 * 取 volume/amount（其余节点为 0），补 source / priceBasis 兼容既有断言与文案。
 * 末点取归一化后的 intraday，保证与运行时分时严格闭合。
 */
function deriveAuction(points: AuctionPoint[], intraday: IntradayPoint[], tradeDate: string): AuctionPoint[] {
  if (!points?.length) return points;
  const openTick = intraday[0];
  const closeTick = intraday.find((p) => p.time === '15:00') ?? intraday[intraday.length - 1];
  let openEnd = -1;
  let closeEnd = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].phase === 'open') openEnd = i;
    else if (points[i].phase === 'close') closeEnd = i;
  }
  const anchored = new Map<number, { volume: number; amount: number }>();
  if (openEnd >= 0 && openTick) {
    anchored.set(openEnd, { volume: openTick.volume, amount: openTick.amount });
  }
  if (closeEnd >= 0 && closeTick) {
    anchored.set(closeEnd, { volume: closeTick.volume, amount: closeTick.amount });
  }
  return points.map((p, i) => {
    const a = anchored.get(i);
    const source: AuctionPoint['source'] = a ? 'anchored-real' : 'illustrative';
    return {
      ...p,
      // timestamp 可选：缺省由交易日 + 时点（北京时间）计算
      timestamp: Number.isFinite(p.timestamp) ? p.timestamp : Date.parse(`${tradeDate}T${p.time}+08:00`),
      volume: a ? a.volume : 0,
      amount: a ? a.amount : 0,
      source,
      priceBasis: 'SSE-3.5.2-max-volume',
    };
  });
}

/**
 * 5) orders 7 字段最小集 → 完整 OrderRecord：
 *  - level：price 相对分时 mid 的距离（/ PRICE_TICK），mid 用与 order-book.ts 同口径的价格轨迹；
 *  - phase：由 time 与时段比较（auction / continuous / closing）；
 *  - snapshot：收盘存活挂单 = 收盘竞价时段、挂在十档价、且无任何后续事件的 NEW；
 *    其余无终态 NEW 由 closeOpenOrders() 补发 CANCEL 离簿，使 ΣNEW=ΣFILL+ΣCANCEL+Σ存活；
 *  - tag / trend：由 side + action 推导（BC/SC/BF/SF 命中 trade-tape 的 CSS 类）；
 *  - origVolume / remainVolume / tradeId / cancelOf：按 origOrdId 事件链重建。
 */
function rebuildOrders(
  orders: OrderRecord[], intraday: IntradayPoint[], depth: DepthBookSnapshot,
): OrderRecord[] {
  if (!orders?.length) return orders;
  const closeSec = clockSec('15:00:00');
  const curve = intraday
    .filter((p) => clockSec(p.time) <= closeSec)
    .map((p) => ({ t: clockSec(p.time), price: p.price }))
    .sort((a, b) => a.t - b.t);
  const lastPrice = curve.length ? curve[curve.length - 1].price : 0;
  const midAt = (t: number): number => {
    if (!curve.length) return lastPrice;
    if (t < curve[0].t) return curve[0].price;
    for (let i = 1; i < curve.length; i += 1) {
      if (t <= curve[i].t) {
        const a = curve[i - 1];
        const b = curve[i];
        const w = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return a.price + (b.price - a.price) * w;
      }
    }
    return lastPrice;
  };

  const byId = new Map<string, OrderRecord>();
  for (const o of orders) if (o.action === 'NEW') byId.set(o.ordId, o);
  const hasEvent = new Set<string>();
  const eventsByOrig = new Map<string, OrderRecord[]>();
  for (const o of orders) {
    if (o.action !== 'FILL' && o.action !== 'CANCEL') continue;
    const id = o.origOrdId || '';
    hasEvent.add(id);
    const arr = eventsByOrig.get(id);
    if (arr) arr.push(o); else eventsByOrig.set(id, [o]);
  }
  const remainById = new Map<string, number>();
  for (const [id, arr] of eventsByOrig) {
    let running = byId.get(id)?.volume ?? 0;
    const sorted = [...arr].sort(
      (a, b) => a.time.localeCompare(b.time) || (a.ordId < b.ordId ? -1 : 1),
    );
    for (const o of sorted) {
      running -= o.volume;
      remainById.set(o.ordId, Math.max(0, running));
    }
  }

  const nearPrices = new Set<string>();
  for (const d of [...(depth.bids ?? []), ...(depth.asks ?? [])]) {
    nearPrices.add(d.price.toFixed(2));
  }
  const phaseOf = (time: string): string =>
    time < '09:30:00' ? 'auction' : time >= '14:57:00' ? 'closing' : 'continuous';

  let tradeSeq = 0;
  return orders.map((o) => {
    const isNew = o.action === 'NEW';
    const origVolume = isNew ? o.volume : (byId.get(o.origOrdId || '')?.volume ?? o.volume);
    const remainVolume = isNew ? o.volume : (remainById.get(o.ordId) ?? 0);
    const tradeId = o.action === 'FILL' ? `T${String(++tradeSeq).padStart(6, '0')}` : null;
    const cancelOf = o.action === 'CANCEL' ? o.origOrdId || null : null;
    const tag = o.action === 'CANCEL' ? `${o.side}C` : o.action === 'FILL' ? `${o.side}F` : o.side;
    const trend = o.action === 'CANCEL' ? 0 : (o.side === 'B' ? 1 : -1);
    // 已派生的记录保留其 snapshot 标记（重复调用幂等）；落盘最小集无该字段时才按守恒重建
    const snapshot = o.snapshot !== undefined
      ? o.snapshot
      : isNew && !hasEvent.has(o.ordId)
        && o.time >= '14:57:00' && nearPrices.has(o.price.toFixed(2));
    const level = Math.max(1, Math.round(Math.abs(o.price - midAt(clockSec(o.time))) / PRICE_TICK));
    return {
      ...o,
      level, phase: phaseOf(o.time), snapshot, tag, trend,
      origVolume, remainVolume, tradeId, cancelOf,
    };
  });
}

/**
 * 统一订单字段契约：closeOpenOrders() 补发的 CANCEL 与 appendFarLevels() 生成的远档挂单
 * 属运行时记录，补齐其缺失的关联字段；tag / trend 一律由 side + action 推导，保证
 * trade-tape 的 tag CSS 类（BC/SC/BF/SF）与 detail.ts 的字段读取口径一致。幂等。
 */
function normalizeOrderFields(orders: OrderRecord[]): OrderRecord[] {
  return orders.map((o) => ({
    ...o,
    origOrdId: o.origOrdId ?? null,
    tradeId: o.tradeId ?? null,
    cancelOf: o.cancelOf ?? null,
    tag: o.action === 'CANCEL' ? `${o.side}C` : o.action === 'FILL' ? `${o.side}F` : o.side,
    trend: o.action === 'CANCEL' ? 0 : (o.side === 'B' ? 1 : -1),
  }));
}

/**
 * 4) depth 档位笔数：orderCount 由 orders 事件流按 (side, price) 聚合收盘存活挂单补充，
 * 无法精确聚合时按每档 volume / LOT_SIZE 给确定性值（保证 > 0）；并补齐顶层
 * phaseCode / source / license / requiresAuthorization 以兼容既有读取。
 */
function hydrateDepth(depth: DepthBookSnapshot, orders: OrderRecord[]): DepthBookSnapshot {
  const count = new Map<string, number>();
  for (const o of orders) {
    if (o.action !== 'NEW' || !o.snapshot) continue;
    const k = `${o.side}:${o.price.toFixed(2)}`;
    count.set(k, (count.get(k) || 0) + 1);
  }
  const level = (d: { price: number; volume: number }, side: string) => ({
    ...d,
    orderCount: count.get(`${side}:${d.price.toFixed(2)}`)
      ?? Math.max(1, Math.round(d.volume / LOT_SIZE)),
  });
  return {
    ...depth,
    bids: (depth.bids ?? []).map((d) => level(d, 'B')),
    asks: (depth.asks ?? []).map((d) => level(d, 'S')),
    phaseCode: depth.phaseCode ?? 'E',
    source: depth.source ?? 'mock',
    license: depth.license ?? 'public-demo',
    requiresAuthorization: depth.requiresAuthorization ?? true,
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
    // 把差额落在 15:00 这一分钟的增量上，保证累计额逐点自洽且末点锚定日 K。
    // prior 由前 N-1 个增量累加得到：精简后落盘分时不再带 cumulativeAmount，
    // 不能依赖 out[closeIdx - 1].cumulativeAmount（会是 undefined → NaN）。
    let prior = 0;
    for (let i = 0; i < closeIdx; i += 1) prior += out[i].amount;
    const target = lastBar.amount - prior;
    if (Number.isFinite(target) && target > 0) out[closeIdx].amount = r2(target);
  }
  let cv = 0, ca = 0;
  for (const p of out) {
    cv += p.volume;
    ca += p.amount;
    p.cumulativeVolume = cv;
    p.cumulativeAmount = r2(ca);
    p.avgPrice = cv > 0 ? r2(avgPriceOf(ca, cv)) : p.price;
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
  // 纯函数：为每个待锚定点生成新对象，绝不就地改写入参数组元素。
  const anchored = new Map<IntradayPoint, IntradayPoint>();
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
      let volume: number;
      let amount: number;
      if (i === arr.length - 1) {
        // 末点吸收整百股取整产生的残差，使当日累计量/额严格等于日 K
        volume = Math.max(0, bar.volume - cv);
        amount = r2(Math.max(0, bar.amount - ca));
      } else {
        volume = Math.round(p.volume * kv / 100) * 100;
        amount = r2(p.amount * ka);
      }
      cv += volume;
      ca += amount;
      anchored.set(p, {
        ...p,
        volume, amount,
        cumulativeVolume: cv,
        cumulativeAmount: r2(ca),
        avgPrice: cv > 0 ? r2(avgPriceOf(ca, cv)) : p.price,
      });
    }
  }
  return points.map((p) => anchored.get(p) ?? p);
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

/** 按需派生配置：显式 modules 优先于 preset；不传 = full（全量，向后兼容） */
export interface DeriveOptions {
  modules?: string[];
  preset?: WorkspacePreset;
}

/**
 * 由 L0 输入派生 dataset。纯函数：不修改入参，返回新对象。
 *
 * 模块化加载：按 `resolveModules(options)` 得到启用模块，再由 `requiredDataFor()`
 * 求数据依赖闭包，只派生被需要的数据集；未启用的字段为 undefined（契约上均为可选）。
 * **不传 options 时等价于 preset:'full'**，计算顺序与数值与模块化改造前逐字段一致，
 * 因此 verify.mjs 的全量闭合断言、示例页与现有测试不受影响。
 */
export function deriveDataset(base: ChartDataset, options?: DeriveOptions): ChartDataset {
  if (!(base.bars ?? []).length || !base.manifest) return base;
  const rawBars = hydrateBars(base.bars, base.manifest);
  const manifest = hydrateManifest(base.manifest, rawBars[rawBars.length - 1]);
  const ctx = contextOf(manifest);
  const enabled = resolveModules(options ?? { preset: 'full' });
  const need = new Set<DataKey>(requiredDataFor(enabled));
  const has = (key: DataKey): boolean => need.has(key);

  // 1) core：bars 四态叠加（按 manifest.demoPatterns 在内存副本上，落盘保持东财原生）
  const bars = applyDemoPatterns(rawBars, manifest);
  const lastBar = bars[bars.length - 1];

  // 2) core：intraday 归一化，是竞价 / 逐笔 / 委托 / 多日分时的公共输入
  const intraday = normalizeIntraday(
    hydrateIntraday(base.intraday ?? [], manifest), lastBar,
  );

  // 3) 竞价列：末点量额从 intraday 锚定 + source / priceBasis
  const auction = has('auction')
    ? deriveAuction((base.auction ?? []) as AuctionPoint[], intraday, manifest.tradeDate)
    : undefined;

  // 4) 逐笔明细：按分钟量额严格锚定分时，不读落盘 trades
  const trades = has('trades') ? buildTradeSeries(intraday, ctx.iso) : undefined;

  // 5) 委托流 / 十档 / 全景盘口：三者共享同一份事件流，按需要一次性回放
  const rawDepth = firstDepth(base.depth) ?? ({ bids: [], asks: [] } as DepthBookSnapshot);
  const rebuilt = has('orders')
    ? rebuildOrders((base.orders ?? []) as OrderRecord[], intraday, rawDepth)
    : [];
  const depth = has('depth') ? hydrateDepth(rawDepth, rebuilt) : undefined;
  const orders = has('orders')
    ? normalizeOrderFields(appendFarLevels(closeOpenOrders(rebuilt), depth ?? rawDepth, ctx))
    : undefined;
  const depthFull = has('depthFull') && orders && depth
    ? reduceOrderBook(orders, intraday, depth, ctx)
    : undefined;

  // 6) L1 派生数据集
  const chips = has('chips') ? buildChipDistribution(bars) : undefined;
  const intradayMulti = has('intradayMulti')
    ? anchorIntradayMulti(
      buildIntradayMulti(bars, intraday, 5), bars, manifest.tradeDate,
    )
    : undefined;
  const depthScenarios = has('depthScenarios') && depth && depthFull
    ? buildDepthScenarios(depth, depthFull, ctx)
    : undefined;

  // 7) 历史分时索引：消费者可经 base.historicalIntraday 注入外部授权数据，
  //    已注入则原样保留；否则仅当 historical-intraday 模块启用且 intradayMulti
  //    已派生时生成默认 5 日索引（minimal / intraday 预设不装该模块，不做多余计算）。
  const historicalIntraday = base.historicalIntraday !== undefined
    ? base.historicalIntraday
    : (enabled.includes('historical-intraday') && has('intradayMulti') && intradayMulti
      ? buildHistoricalIntraday(intradayMulti, bars, manifest)
      : undefined);

  return {
    ...base,
    manifest,
    bars,
    intraday,
    auction,
    // trade-tape 单独启用时 requiresData 已补 'orders'，此处 orders 必为数组 → ordIds 完整。
    // 仍以 orders ?? [] 兜底：trades 一旦派生就始终经过 linkFillsToTrades（不再因 orders
    // 未派生而整段跳过关联），保证每行都有 ordIds 字段；orders 存在时行为与原式逐字段一致。
    trades: trades ? assignTradeOrderNos(linkFillsToTrades(trades, orders ?? [])) : trades,
    orders,
    depth,
    depthFull,
    depthScenarios,
    chips,
    intradayMulti,
    historicalIntraday,
    // prevIntraday 是历史分时 mini 的运行时注入通道：消费者注入即原样保留，
    // 不参与全量派生；与 historicalIntraday 的注入语义对称。
    prevIntraday: Array.isArray(base.prevIntraday)
      ? (base.prevIntraday as IntradayPoint[]) : undefined,
  };
}
