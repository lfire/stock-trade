/**
 * 集合竞价虚拟撮合（上交所《交易规则》3.5.2 / 深交所投教「股市入门 300 问」）：
 *   ① 可实现最大成交量的价格；
 *   ② 高于该价的买入申报与低于该价的卖出申报全部成交；
 *   ③ 与该价相同的买方或卖方至少有一方全部成交。
 * 两个以上价格同时满足时取未成交量最小者；仍并列时，开盘取最接近前收盘价、
 * 盘中/收盘取最接近最近成交价（深交所口径；上交所取中间价，本实现统一用参考价）。
 *
 * 说明：min(Σ买[q>=p], Σ卖[q<=p]) 天然满足②③。所有成交以同一价格成交。
 * 输入量单位一致（手或股均可），价格须已按最小变动单位 0.01 取整。
 */
export function matchAuction(bids, asks, refPrice) {
  const buy = (bids || []).filter((b) => Number.isFinite(b.price) && b.qty > 0);
  const sell = (asks || []).filter((a) => Number.isFinite(a.price) && a.qty > 0);
  if (!buy.length || !sell.length) {
    return { price: refPrice, matchedQty: 0, unmatchedQty: 0, unmatchedSide: 0 };
  }
  const prices = [...new Set([...buy.map((b) => b.price), ...sell.map((a) => a.price)])]
    .sort((a, b) => a - b);
  let best = null;
  for (const p of prices) {
    let buyQty = 0, sellQty = 0;
    for (const b of buy) if (b.price >= p) buyQty += b.qty;
    for (const a of sell) if (a.price <= p) sellQty += a.qty;
    const matchedQty = Math.min(buyQty, sellQty);
    const unmatchedQty = Math.abs(buyQty - sellQty);
    const better = !best
      || matchedQty > best.matchedQty
      || (matchedQty === best.matchedQty && (
        unmatchedQty < best.unmatchedQty
        || (unmatchedQty === best.unmatchedQty
          && Math.abs(p - refPrice) < Math.abs(best.price - refPrice))));
    if (better) best = { price: p, matchedQty, unmatchedQty, buyQty, sellQty };
  }
  if (!best) return { price: refPrice, matchedQty: 0, unmatchedQty: 0, unmatchedSide: 0 };
  return {
    price: best.price,
    matchedQty: best.matchedQty,
    unmatchedQty: best.unmatchedQty,
    // 1 = 买方堆积（未匹配买单），2 = 卖方堆积，0 = 完全匹配
    unmatchedSide: best.buyQty > best.sellQty ? 1 : best.sellQty > best.buyQty ? 2 : 0,
  };
}

/**
 * 为示例数据构造集中在撮合价的示意委托簿：两侧申报都挂在 center，
 * 于是 matchAuction 的唯一候选价就是 center，结果 price=center、
 * matched=min(买,卖)、unmatched=|买-卖|、方向由差额决定。
 * 注意：这是**示意数据生成**的简化（Level-2 委托簿无法回溯）；
 * matchAuction 本身支持任意多价位委托簿，三原则与并列处理由单元测试完整验证。
 */
import { r2 } from './shared.mjs';

export function makeOrderBook(center, buyQty, sellQty) {
  const p = r2(center);
  return {
    bids: buyQty > 0 ? [{ price: p, qty: Math.round(buyQty), side: 'buy' }] : [],
    asks: sellQty > 0 ? [{ price: p, qty: Math.round(sellQty), side: 'sell' }] : [],
  };
}
