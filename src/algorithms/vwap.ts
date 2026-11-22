/**
 * 成交量 / 均价 / 换手类公式（算法单元化收口），核心关系逐字来自
 * scripts/build-sample-data.mjs 与 src/elements/price-pane.ts。
 * 本模块只返回原始数值；取整（r2）/ 展示格式化分别由 rounding.ts、format.ts 负责。
 */
import type { Bar, IntradayPoint } from '../types';

/**
 * 成交均价（VWAP）：amount / volume；量或额缺失时回退到四价算术均价
 * （通达信筹码峰口径）。peak 的 [low, high] clamp 由调用方（筹码分布）处理。
 */
export function vwapOf(amount: number, volume: number, fallback?: Bar): number {
  if (amount > 0 && volume > 0) return avgPriceOf(amount, volume);
  if (fallback) return (fallback.open + fallback.close + fallback.high + fallback.low) / 4;
  return 0;
}

/** 分时均价 = 累计成交额 / 累计成交量（均价公式唯一真源，返回原始值；取整由消费方负责）。 */
export function avgPriceOf(cumAmount: number, cumVolume: number): number {
  return cumVolume > 0 ? cumAmount / cumVolume : 0;
}

/** 成交额 = 成交价 × 成交量。 */
export function amountOf(price: number, volume: number): number {
  return price * volume;
}

/** 换手率（明确返回 %）：volume / floatShares × 100。 */
export function turnoverRateOf(volume: number, floatShares: number): number {
  return (volume / floatShares) * 100;
}

/** 原始行情常见的「累计量额点」（仅含累计值与价格）。 */
export type CumulativePoint = Pick<
  IntradayPoint, 'time' | 'price' | 'cumulativeVolume' | 'cumulativeAmount'
>;
/** 差分为每分钟增量后的点。 */
export interface IncrementalPoint extends CumulativePoint {
  volume: number;
  amount: number;
  avgPrice: number;
}

/**
 * 累计量额 → 每分钟增量（逐字保留 buildIntraday 的差分口径）。
 * 输入与输出的量额假定同单位（股 / 元）；数据源若给「手」请先自行换算，
 * 保证 cumulativeVolume 与 volume 单位一致。
 * avgPrice 保持 avgPriceOf 返回的原始值，取整（r2）由消费方在数据落点层负责。
 */
export function toIncremental(points: CumulativePoint[]): IncrementalPoint[] {
  let prevVol = 0, prevAmt = 0;
  return points.map((p) => {
    const cv = p.cumulativeVolume, ca = p.cumulativeAmount;
    const volume = Math.max(0, cv - prevVol);
    const amount = Math.max(0, ca - prevAmt);
    const avgPrice = avgPriceOf(ca, cv);
    prevVol = cv;
    prevAmt = ca;
    return { ...p, volume, amount, avgPrice };
  });
}
