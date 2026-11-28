/**
 * 盘口买卖占比（算法层纯函数）：统计「当前可视盘口」里买盘与卖盘各自的挂单合计与占比。
 *
 * - 只统计调用方传入的可视档位（5 档 / 10 档 / 展开态 1 档），不看不可见的深档；
 * - 口径随盘口单位：volume = 挂单量（股），amount = 挂单金额（委托价 × 挂单量，元）；
 * - 涨停无卖盘 / 跌停无买盘时由调用方传空数组，结果自然为 100% / 0%；
 * - 双方合计为 0 时占比为 null（无可比较的挂单），由 UI 显示中性态。
 * 不修改入参、不依赖 DOM。
 */
import type { DepthLevel, DepthUnit } from '../types';

export interface DepthSideRatio {
  /** 可视买盘合计（股或元） */
  buy: number;
  /** 可视卖盘合计（股或元） */
  sell: number;
  /** 买盘占比 0~1；双方合计为 0 时为 null */
  buyRatio: number | null;
  /** 卖盘占比 0~1；与 buyRatio 互补 */
  sellRatio: number | null;
}

/**
 * @param bids 可视买档（已按档数截取）
 * @param asks 可视卖档（已按档数截取）
 * @param unit 统计口径，缺省按挂单量
 */
export function depthSideRatio(
  bids: readonly DepthLevel[], asks: readonly DepthLevel[], unit: DepthUnit = 'volume',
): DepthSideRatio {
  const sum = (levels: readonly DepthLevel[]): number => levels.reduce((acc, l) => {
    const v = unit === 'amount' ? l.price * l.volume : l.volume;
    return acc + (Number.isFinite(v) && v > 0 ? v : 0);
  }, 0);
  const buy = sum(bids);
  const sell = sum(asks);
  const total = buy + sell;
  if (total <= 0) return { buy, sell, buyRatio: null, sellRatio: null };
  return { buy, sell, buyRatio: buy / total, sellRatio: sell / total };
}
