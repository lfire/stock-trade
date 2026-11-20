/**
 * 集合竞价虚拟撮合（算法单元化收口）：逐字搬 scripts/auction-match.mjs。
 * 上交所《交易规则》3.5.2 三原则：
 *   ① 可实现最大成交量的价格；
 *   ② 高于该价的买入申报与低于该价的卖出申报全部成交；
 *   ③ 与该价相同的买方或卖方至少有一方全部成交。
 * 两个以上价格同时满足时取未成交量最小者；仍并列时取最接近参考价
 * （开盘最接近前收、盘中/收盘最接近最近成交价，本实现统一用 refPrice）。
 *
 * 额外修复：候选价集合不再只取申报价并集 —— 当买卖申报价之间存在中间价、
 * 且这些价位成交量/未成交量并列时，把「最接近 refPrice 的 0.01 步长价位」
 * 纳入候选（例：买 10.02 / 卖 10.00 / ref 10.01 应返回 10.01）。
 * 实现上把交叉区间 [minAsk, maxBid] 内所有 0.01 步长价位并入候选，
 * 三原则比较逻辑（最大成交量 → 未成交量最小 → 最接近 refPrice）保持不变。
 *
 * 输入量单位一致（手或股均可），价格须已按最小变动单位取整。
 */
import { PRICE_TICK } from '../core/market-constants';
import { r2 } from './rounding';

export interface AuctionOrder {
  price: number;
  qty: number;
}

export interface AuctionMatchResult {
  price: number;
  matchedQty: number;
  unmatchedQty: number;
  /** 1 = 买方堆积（未匹配买单），2 = 卖方堆积，0 = 完全匹配 */
  unmatchedSide: 0 | 1 | 2;
}

export interface AuctionBookOrder extends AuctionOrder {
  side: 'buy' | 'sell';
}
export interface AuctionOrderBook {
  bids: AuctionBookOrder[];
  asks: AuctionBookOrder[];
}

interface Candidate {
  price: number;
  matchedQty: number;
  unmatchedQty: number;
  buyQty: number;
  sellQty: number;
}

export function matchAuction(
  bids: AuctionOrder[], asks: AuctionOrder[], refPrice: number,
): AuctionMatchResult {
  const buy = (bids || []).filter((b) => Number.isFinite(b.price) && b.qty > 0);
  const sell = (asks || []).filter((a) => Number.isFinite(a.price) && a.qty > 0);
  if (!buy.length || !sell.length) {
    return { price: refPrice, matchedQty: 0, unmatchedQty: 0, unmatchedSide: 0 };
  }
  // 候选价 = 申报价并集 ∪ 交叉区间内 0.01 步长价位（修复并列价须取中间价）。
  // 只在存在交叉（minAsk <= maxBid）时补中间价，避免在无可成交价位的委托簿里
  // 引入「零成交/零未成交」的伪候选。申报价本身始终保留为候选。
  const priceSet = new Set<number>([...buy.map((b) => b.price), ...sell.map((a) => a.price)]);
  const minAsk = Math.min(...sell.map((a) => a.price));
  const maxBid = Math.max(...buy.map((b) => b.price));
  if (minAsk <= maxBid) {
    const loTick = Math.round(minAsk / PRICE_TICK);
    const hiTick = Math.round(maxBid / PRICE_TICK);
    for (let t = loTick; t <= hiTick; t += 1) {
      priceSet.add(r2(t * PRICE_TICK));
      if (priceSet.size > 10000) break;   // 防御：异常宽价差时限制候选规模
    }
  }
  const prices = [...priceSet].sort((a, b) => a - b);
  let best: Candidate | null = null;
  for (const p of prices) {
    let buyQty = 0, sellQty = 0;
    for (const b of buy) if (b.price >= p) buyQty += b.qty;
    for (const a of sell) if (a.price <= p) sellQty += a.qty;
    const matchedQty = Math.min(buyQty, sellQty);
    const unmatchedQty = Math.abs(buyQty - sellQty);
    const cand: Candidate = { price: p, matchedQty, unmatchedQty, buyQty, sellQty };
    if (best === null) { best = cand; continue; }
    const better = cand.matchedQty > best.matchedQty
      || (cand.matchedQty === best.matchedQty && (
        cand.unmatchedQty < best.unmatchedQty
        || (cand.unmatchedQty === best.unmatchedQty
          && Math.abs(cand.price - refPrice) < Math.abs(best.price - refPrice))));
    if (better) best = cand;
  }
  if (!best) return { price: refPrice, matchedQty: 0, unmatchedQty: 0, unmatchedSide: 0 };
  const unmatchedSide: 0 | 1 | 2 = best.buyQty > best.sellQty ? 1 : best.sellQty > best.buyQty ? 2 : 0;
  return {
    price: best.price,
    matchedQty: best.matchedQty,
    unmatchedQty: best.unmatchedQty,
    unmatchedSide,
  };
}

/** 构造集中在撮合价的示意委托簿；逐字来自 makeOrderBook。 */
export function makeOrderBook(center: number, buyQty: number, sellQty: number): AuctionOrderBook {
  const p = r2(center);
  return {
    bids: buyQty > 0 ? [{ price: p, qty: Math.round(buyQty), side: 'buy' }] : [],
    asks: sellQty > 0 ? [{ price: p, qty: Math.round(sellQty), side: 'sell' }] : [],
  };
}
