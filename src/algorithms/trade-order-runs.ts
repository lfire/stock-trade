/**
 * 逐笔明细「买单 / 卖单」视图（算法层纯函数）。
 *
 * 市面口径：Level-2 逐笔明细每条都带买方委托号与卖方委托号（上交所 BuyNo / SellNo，
 * 深交所 BidApplSeqNum / OfferApplSeqNum）。一笔主动大单会连续吃掉多笔对手挂单，
 * 于是相邻若干条成交共用同一个买单（或卖单）号；行情软件把这样的连续成交合并成一个
 * 跨行方框，显示该委托在这段连续成交中的合计手数与金额，金额达到阈值时标「大」。
 *
 * - assignTradeOrderNos：已带 buyOrdId / sellOrdId 的成交（授权 L2 数据）原样保留；
 *   缺失时按固定种子确定性生成示意委托号——主动方（side）连续成交更长、被动方多为单笔，
 *   与真实盘口「主动单扫多档」的形态一致。只补号，不改价、量、额与顺序。
 * - buildOrderRuns：把相邻且委托号相同的成交合并为 OrderRun（合计量额、首末 seq），
 *   每行挂上 buyRun / sellRun 引用，供 UI 画跨行方框。
 * 均不修改入参、不依赖 DOM。
 */
import type { TradeTick } from '../types';
import { mulberry32 } from './random';

/** 大单金额阈值（元）：东方财富资金流口径「大单」下限 20 万元 */
export const BIG_ORDER_AMOUNT = 200_000;

export type OrderNoSide = 'B' | 'S';

export interface OrderRun {
  ordId: string;
  side: OrderNoSide;
  /** 连续成交合计量（股） */
  volume: number;
  /** 连续成交合计额（元） */
  amount: number;
  /** 连续成交条数（1 = 单笔，不画框） */
  count: number;
  firstSeq: number;
  lastSeq: number;
}

export interface MatchedTrade extends TradeTick {
  buyOrdId: string;
  sellOrdId: string;
  buyRun: OrderRun;
  sellRun: OrderRun;
}

export interface OrderNoOptions {
  /** 示意委托号的随机种子（缺省由首笔时间戳推得，保证同一数据集结果稳定） */
  seed?: number;
}

type WithOrderNos = TradeTick & { buyOrdId?: string; sellOrdId?: string };

/**
 * 为逐笔明细补齐买卖委托号；已有号的行原样返回（对象引用不变）。
 * @param trades 按时间升序的逐笔明细
 * @param opts 种子选项
 */
export function assignTradeOrderNos<T extends WithOrderNos>(
  trades: readonly T[], opts: OrderNoOptions = {},
): Array<T & { buyOrdId: string; sellOrdId: string }> {
  type Out = T & { buyOrdId: string; sellOrdId: string };
  if (trades.every((t) => t.buyOrdId && t.sellOrdId)) return trades as unknown as Out[];
  const rnd = mulberry32((opts.seed ?? Math.floor((trades[0]?.timestamp ?? 0) / 1000)) >>> 0);
  /** 主动方连续成交更长；被动方多为单笔、偶有被连续吃掉的大挂单 */
  const runLength = (aggressive: boolean): number => {
    const r = rnd();
    if (aggressive) return r < 0.35 ? 1 : r < 0.75 ? 2 + Math.floor(rnd() * 4) : 6 + Math.floor(rnd() * 8);
    return r < 0.7 ? 1 : r < 0.92 ? 2 + Math.floor(rnd() * 2) : 4 + Math.floor(rnd() * 4);
  };
  const cur: Record<OrderNoSide, { id: string; left: number; n: number }> = {
    B: { id: '', left: 0, n: 0 }, S: { id: '', left: 0, n: 0 },
  };
  let phase: string | null = null;
  return trades.map((t) => {
    // 阶段切换（竞价 / 连续 / 盘后）时委托不跨阶段延续；集合竞价与盘后成交按单笔撮合
    if (t.phase !== phase) { cur.B.left = 0; cur.S.left = 0; phase = t.phase; }
    const single = t.phase !== 'continuous';
    const pick = (side: OrderNoSide, given?: string): string => {
      if (given) return given;
      const c = cur[side];
      if (c.left <= 0) {
        c.n += 1;
        c.id = `${side}${String(c.n).padStart(6, '0')}`;
        c.left = single ? 1 : runLength(t.side === side);
      }
      c.left -= 1;
      return c.id;
    };
    const buyOrdId = pick('B', t.buyOrdId);
    const sellOrdId = pick('S', t.sellOrdId);
    return (t.buyOrdId && t.sellOrdId ? t : { ...t, buyOrdId, sellOrdId }) as Out;
  });
}

/**
 * 相邻且委托号相同的成交合并为一段；返回新行数组，每行带 buyRun / sellRun（同段共享引用）。
 * @param trades 已有 buyOrdId / sellOrdId 的逐笔明细（时间升序）
 */
export function buildOrderRuns<T extends TradeTick & { buyOrdId: string; sellOrdId: string }>(
  trades: readonly T[],
): Array<T & { buyRun: OrderRun; sellRun: OrderRun }> {
  let buy: OrderRun | null = null;
  let sell: OrderRun | null = null;
  const extend = (run: OrderRun | null, side: OrderNoSide, ordId: string, t: T): OrderRun => {
    if (run && run.ordId === ordId) {
      run.volume += t.volume;
      run.amount += t.amount;
      run.count += 1;
      run.lastSeq = t.seq;
      return run;
    }
    return { ordId, side, volume: t.volume, amount: t.amount, count: 1, firstSeq: t.seq, lastSeq: t.seq };
  };
  return trades.map((t) => {
    buy = extend(buy, 'B', t.buyOrdId, t);
    sell = extend(sell, 'S', t.sellOrdId, t);
    return { ...t, buyRun: buy, sellRun: sell };
  });
}

/** 是否大单：连续成交合计金额达到阈值（缺省 BIG_ORDER_AMOUNT） */
export function isBigOrder(run: OrderRun, threshold: number = BIG_ORDER_AMOUNT): boolean {
  return run.amount >= threshold;
}
