/**
 * 逐笔委托流 / 全景盘口（算法单元化收口）。
 * 逐字搬 scripts/build-order-book.mjs 的 :26-198（委托流生成）、:200-247（全景盘口回放）、
 * :292-307（分笔 ↔ 委托号关联），去掉全部 fs/IO 副作用，改为运行时纯函数。
 *
 * 守恒修复（相对脚本）：
 *  - 移除 :109 的 openOrders 240 上限。该上限会静默丢弃在挂委托（无 FILL/CANCEL 终态），
 *    是守恒缺口之一；脚本收盘时未撤未填满的挂单同样没有终态，是缺口之二。
 *  - 收盘对仍在簿的非 snapshot 挂单统一补发 CANCEL 终态事件（撤掉剩余量），使每条非
 *    snapshot NEW 都以「FILL 耗尽」或「CANCEL」收尾。于是
 *      ΣNEW.volume === ΣFILL.volume + ΣCANCEL.volume + Σsnapshot.volume
 *    其中 snapshot 挂单是收盘唯一存活集合，按十档 volume 拆单与 depth 严格闭合。
 *  - buildOrderFlow / reduceOrderBook 共用同一个 stepOrderBook 事件状态机
 *    （NEW 入簿 / FILL 扣减 / CANCEL 离簿），不再有「240 上限 vs live 无上限」两套口径，
 *    保证全景盘口与「全部挂单」同源。脚本回放里的「被市价穿越自动离场」属第二套隐式
 *    状态机，守恒修复后每条挂单都有显式终态，故收敛为单一 stepOrderBook，不再保留。
 */
import type {
  OrderRecord, DepthBookSnapshot, DepthLevel, IntradayPoint, TradeTick,
} from '../types';
import { TIME } from '../core/market-constants';
import { r2 } from './rounding';
import { mulberry32 } from './random';
import { limitPrices } from './price-limits';

/** 两个导出主函数共用的入参口径（tradeDate 仅占位，纯函数无 IO 不落盘）。 */
interface OrderBookOptions {
  preClose: number;
  limitRate: number;
  tradeDate?: string;
}

interface CurvePoint { t: number; price: number; }

/** 在挂委托：rec 为 NEW 事件记录，remain 为未成交未撤的剩余量。 */
interface LiveEntry { rec: OrderRecord; remain: number; }
type LiveBook = Map<string, LiveEntry>;

/** 十档快照展开后的统一档位（供拆单与前十档覆盖共用）。 */
interface SnapLevel extends DepthLevel { side: string; level: number; }
/** 按 side:price 聚合的中间档位。 */
interface AggEntry extends DepthLevel { side: string; }

interface EmitOptions {
  snapshot?: boolean;
  origOrdId?: string | null;
  origVolume?: number;
  remainVolume?: number;
  tradeId?: string | null;
}

/** 'HH:mm:ss' / 'HH:mm' → 自 00:00 起算的秒数。 */
const T = (s: string): number => {
  const p = s.split(':').map(Number);
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
};

/** 秒数 → 'HH:mm:ss'。 */
const fmt = (sec: number): string => [
  String(Math.floor(sec / 3600)).padStart(2, '0'),
  String(Math.floor((sec % 3600) / 60)).padStart(2, '0'),
  String(sec % 60).padStart(2, '0'),
].join(':');

/** 委托流按时间排序（生成收尾排序与回放共用同一比较器）。 */
const compareOrders = (a: OrderRecord, b: OrderRecord): number =>
  (T(a.time) - T(b.time)) || (a.ordId < b.ordId ? -1 : 1);

/** 分时价格轨迹（排除盘后固定价段）+ 线性插值 midAt（脚本 :44-60）。 */
function buildCurve(intraday: IntradayPoint[]): (t: number) => number {
  const CLOSE = T(TIME.CLOSE);
  const curve: CurvePoint[] = intraday
    .filter((p) => T(p.time) <= CLOSE)
    .map((p) => ({ t: T(p.time), price: p.price }))
    .sort((a, b) => a.t - b.t);
  const openPx = curve[0].price;
  return (t: number): number => {
    if (t < curve[0].t) return openPx;
    for (let i = 1; i < curve.length; i += 1) {
      if (t <= curve[i].t) {
        const a = curve[i - 1], b = curve[i];
        const w = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return a.price + (b.price - a.price) * w;
      }
    }
    return curve[curve.length - 1].price;
  };
}

/** 十档 → 带 side / level 的统一档位表（脚本 :177-180）。 */
function snapLevelsOf(depth: DepthBookSnapshot): SnapLevel[] {
  return [
    ...depth.bids.map((d, i) => ({ ...d, side: 'B', level: i + 1 })),
    ...depth.asks.map((d, i) => ({ ...d, side: 'S', level: i + 1 })),
  ];
}

/**
 * 唯一的委托簿状态机（NEW / FILL / CANCEL）。
 * buildOrderFlow 用它维护在挂委托池，reduceOrderBook 用它回放重建全景盘口；
 * 两处不再有 240 上限 / 无上限的口径差异，全景盘口与「全部挂单」同源。
 */
function stepOrderBook(book: LiveBook, rec: OrderRecord): void {
  if (rec.action === 'NEW') {
    book.set(rec.ordId, { rec, remain: rec.volume });
    return;
  }
  const id = rec.origOrdId;
  if (!id) return;
  if (rec.action === 'FILL') {
    const x = book.get(id);
    if (x) {
      x.remain -= rec.volume;
      if (x.remain <= 0) book.delete(id);
    }
  } else {                                  // CANCEL
    book.delete(id);
  }
}

/**
 * 全天委托流（脚本 :26-198）。
 * 返回按时间排序的 OrderRecord[]；每条非 snapshot NEW 都以显式终态收尾，满足守恒。
 */
export function buildOrderFlow(
  intraday: IntradayPoint[],
  depth: DepthBookSnapshot,
  opts: OrderBookOptions,
): OrderRecord[] {
  const rnd = mulberry32(2026111302);
  const midAt = buildCurve(intraday);
  const { up: limitHi, down: limitLo } = limitPrices(opts.preClose, opts.limitRate);

  const LO = T(TIME.AUCTION_START);
  const AUCTION_END = T(TIME.AUCTION_END);
  const OPEN = T(TIME.OPEN);
  const NOON = T(TIME.NOON);
  const PM = T(TIME.PM);
  const NO_CANCEL_1 = T(TIME.NO_CANCEL_OPEN);
  const NO_CANCEL_2 = T(TIME.NO_CANCEL_CLOSE);
  const CLOSE = T(TIME.CLOSE);

  const orders: OrderRecord[] = [];
  const book: LiveBook = new Map();
  let seq = 0;
  let tradeSeq = 0;

  const emit = (
    time: string, price: number, volume: number, side: string,
    action: OrderRecord['action'], level: number, phase: string,
    o: EmitOptions = {},
  ): void => {
    const {
      snapshot = false, origOrdId = null, origVolume = volume,
      remainVolume = volume, tradeId = null,
    } = o;
    const tag = action === 'CANCEL' ? `${side}C` : action === 'FILL' ? `${side}F` : side;
    // types.ts 把 origOrdId/tradeId/cancelOf 标为 string、trend 标为 string，但脚本与既有
    // orders 数据实际为 null / 数字（1/-1/0）。保留运行时原值，用一次 unknown 断言绕开
    // 契约里不准确的类型标注（本任务禁止改动 types.ts）。
    const rec = {
      ordId: `O${String(++seq).padStart(6, '0')}`,
      time, price, volume, side, action, level, phase, snapshot,
      origOrdId, origVolume, remainVolume, tradeId,
      cancelOf: action === 'CANCEL' ? origOrdId : null,
      tag,
      trend: action === 'CANCEL' ? 0 : (side === 'B' ? 1 : -1),
    } as unknown as OrderRecord;
    orders.push(rec);
    stepOrderBook(book, rec);
  };

  // 档位：几何衰减，1~10 档为主，少量 11~20 档（脚本 :63-72）。
  const pickLevel = (): number => {
    const r = rnd();
    let acc = 0, total = 0;
    for (let l = 1; l <= 20; l += 1) total += Math.pow(0.82, l - 1);
    for (let l = 1; l <= 20; l += 1) {
      acc += Math.pow(0.82, l - 1) / total;
      if (r <= acc) return l;
    }
    return 20;
  };
  // 委托量：100 股整数倍，小额为主、偶有大单（脚本 :74-81）。
  const pickVolume = (): number => {
    const r = rnd();
    const lots = r < 0.62 ? 1 + Math.floor(rnd() * 5)
      : r < 0.9 ? 6 + Math.floor(rnd() * 15)
        : r < 0.985 ? 21 + Math.floor(rnd() * 30)
          : 60 + Math.floor(rnd() * 60);
    return lots * 100;
  };

  // ---------------------------------------------------------------- 1. 全天委托流（:114-168）
  const slots: number[] = [];
  for (let t = LO; t <= AUCTION_END; t += 4) slots.push(t);
  for (let t = OPEN; t <= NOON; t += 14) slots.push(t);
  for (let t = PM; t <= CLOSE; t += 14) slots.push(t);

  for (const t of slots) {
    const side = rnd() < 0.5 ? 'B' : 'S';
    const mid = midAt(t);
    const far = rnd() < 0.18;
    let level: number, price: number;
    if (far) {
      const span = side === 'B' ? (mid - 0.01 - limitLo) : (limitHi - mid - 0.01);
      const w = side === 'B' ? 1 - Math.pow(rnd(), 2.5) : Math.pow(rnd(), 2.5);
      price = side === 'B' ? r2(limitLo + span * w) : r2(mid + 0.01 + span * w);
      price = Math.max(limitLo, Math.min(limitHi, price));
      level = Math.max(1, Math.round(Math.abs(price - mid) / 0.01));
    } else {
      level = pickLevel();
      price = Math.max(limitLo, Math.min(limitHi, r2(mid + (side === 'B' ? -1 : 1) * level * 0.01)));
    }
    const volume = pickVolume();
    const phase = t < OPEN ? 'auction' : (t >= NO_CANCEL_2 ? 'closing' : 'continuous');
    const cancelable = !((t >= NO_CANCEL_1 && t < OPEN) || (t >= NO_CANCEL_2 && t <= CLOSE));
    const r = rnd();
    const pool = [...book.values()].filter((x) => x.remain > 0 && !x.rec.snapshot);

    // 1) 部分成交：按量扣减剩余量，委托继续留在簿里（FILL 扣减由 stepOrderBook 统一处理）
    if (phase === 'continuous' && r < 0.22 && pool.length) {
      const x = pool[Math.floor(rnd() * pool.length)];
      const lots = Math.floor(x.remain / 100);
      const fillLots = Math.min(lots, 1 + Math.floor(rnd() * Math.min(lots, 20)));
      const fillVol = Math.max(100, fillLots * 100);
      const tradeId = `T${String(++tradeSeq).padStart(6, '0')}`;
      emit(fmt(t), x.rec.price, fillVol, x.rec.side, 'FILL', x.rec.level ?? 0, phase, {
        origOrdId: x.rec.ordId, origVolume: x.rec.volume,
        remainVolume: x.remain - fillVol, tradeId,
      });
      continue;
    }
    // 2) 撤单：撤剩余量，不是原委托总量（9:20–9:25、14:57–15:00 不可撤）
    const cancelRate = phase === 'auction' ? 0.42 : 0.22;
    if (cancelable && r >= 0.22 && r < 0.22 + cancelRate && pool.length) {
      const x = pool[Math.floor(rnd() * pool.length)];
      emit(fmt(t), x.rec.price, x.remain, x.rec.side, 'CANCEL', x.rec.level ?? 0, phase, {
        origOrdId: x.rec.ordId, origVolume: x.rec.volume, remainVolume: 0,
      });
      continue;
    }
    // 3) 新挂单
    emit(fmt(t), price, volume, side, 'NEW', level, phase);
  }

  // 涨跌停边界埋伏单（脚本 :171-172）：真实盘口常见，全天不会被市价穿越。
  emit('09:30:01', limitLo, 20000, 'B', 'NEW',
    Math.round((midAt(OPEN) - limitLo) / 0.01), 'continuous');
  emit('09:30:01', limitHi, 20000, 'S', 'NEW',
    Math.round((limitHi - midAt(OPEN)) / 0.01), 'continuous');

  // ---------------------------------------------------------------- 2. 守恒修复
  // 收盘对仍在簿的非 snapshot 挂单补发 CANCEL 终态（撤掉剩余量）。时间取 CLOSE，
  // 严格晚于所有盘中 / 快照挂单，回放时必然「先入簿再离簿」，不破坏收盘十档闭合。
  const remaining = [...book.values()].filter((x) => x.remain > 0 && !x.rec.snapshot);
  for (const x of remaining) {
    emit(fmt(CLOSE), x.rec.price, x.remain, x.rec.side, 'CANCEL', x.rec.level ?? 0, 'closing', {
      origOrdId: x.rec.ordId, origVolume: x.rec.volume, remainVolume: 0,
    });
  }

  // ---------------------------------------------------------------- 3. 收盘存活挂单（:174-194）
  // 按「每笔至少 1 手」拆单：逐档总量严格等于 depth.volume，笔数取合理上限。
  for (const lv of snapLevelsOf(depth)) {
    const shares = Math.round(lv.volume / 100);
    const n = Math.max(1, Math.min(lv.orderCount, shares));
    const base = Math.floor(shares / n);
    const parts = Array.from({ length: n }, () => base);
    let extra = shares - base * n;
    while (extra > 0) {
      parts[Math.floor(rnd() * n)] += 1;
      extra -= 1;
    }
    for (const p of parts) {
      const t = NO_CANCEL_2 + Math.floor(rnd() * (CLOSE - NO_CANCEL_2));
      emit(fmt(t), lv.price, p * 100, lv.side, 'NEW', lv.level, 'closing', { snapshot: true });
    }
  }

  orders.sort(compareOrders);
  return orders;
}

/**
 * 全景盘口（脚本 :200-247）：回放 + 按 side:price 聚合 + 前十档用 depth 覆盖 +
 * mid/limitUp/limitDown。回放复用 stepOrderBook，与 buildOrderFlow 同一状态机语义。
 */
export function reduceOrderBook(
  orders: OrderRecord[],
  intraday: IntradayPoint[],
  depth: DepthBookSnapshot,
  opts: OrderBookOptions,
): DepthBookSnapshot {
  const midAt = buildCurve(intraday);
  const { up: limitHi, down: limitLo } = limitPrices(opts.preClose, opts.limitRate);
  const CLOSE = T(TIME.CLOSE);

  const book: LiveBook = new Map();
  for (const o of [...orders].sort(compareOrders)) {
    stepOrderBook(book, o);
  }

  const agg = new Map<string, AggEntry>();
  for (const x of book.values()) {
    if (x.remain <= 0) continue;
    const k = `${x.rec.side}:${x.rec.price.toFixed(2)}`;
    const cur = agg.get(k) || { side: x.rec.side, price: x.rec.price, volume: 0, orderCount: 0 };
    cur.volume += x.remain;
    cur.orderCount += 1;                        // 只聚合未成交未撤的剩余量
    agg.set(k, cur);
  }
  // 与既有十档快照保持口径一致：同价格档位用快照值覆盖（含 orderCount）
  for (const lv of snapLevelsOf(depth)) {
    agg.set(`${lv.side}:${lv.price.toFixed(2)}`, {
      side: lv.side, price: lv.price, volume: lv.volume, orderCount: lv.orderCount,
    });
  }

  const bids = [...agg.values()].filter((x) => x.side === 'B').sort((a, b) => b.price - a.price);
  const asks = [...agg.values()].filter((x) => x.side === 'S').sort((a, b) => a.price - b.price);
  const lv = (x: AggEntry): DepthLevel => ({ price: x.price, volume: x.volume, orderCount: x.orderCount });

  return {
    timestamp: depth.timestamp,
    time: TIME.CLOSE,
    // 全景委托簿 / 逐笔委托属交易所 Level-2 增值行情，真实数据需展示或非展示许可
    source: 'mock', license: 'public-demo', requiresAuthorization: true,
    mid: r2(midAt(CLOSE)),
    limitDown: limitLo,
    limitUp: limitHi,
    bids: bids.map(lv),
    asks: asks.map(lv),
  };
}

/**
 * 合并分笔 ↔ 委托号关联（脚本 :292-307）：把同分钟部分成交的委托号去重后挂到分笔上。
 * 纯函数：返回新数组、不改动入参；重复调用结果一致（幂等）。
 */
export function linkFillsToTrades(trades: TradeTick[], orders: OrderRecord[]): TradeTick[] {
  const fillsByMinute = new Map<string, string[]>();
  for (const o of orders) {
    if (o.action !== 'FILL') continue;
    const k = o.time.slice(0, 5);
    let arr = fillsByMinute.get(k);
    if (!arr) { arr = []; fillsByMinute.set(k, arr); }
    if (o.origOrdId) arr.push(o.origOrdId);
  }
  return trades.map((tr) => ({
    ...tr,
    ordIds: [...new Set(fillsByMinute.get(String(tr.time).slice(0, 5)) || [])].slice(0, 8),
  }));
}
