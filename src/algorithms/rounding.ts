/**
 * 价格 / 数值取整（算法单元化收口）。
 * 公式逐字来自 scripts/shared.mjs:9-10；与数据生成脚本保持同一口径。
 */
import { PRICE_TICK } from '../core/market-constants';

/**
 * 取整到分（half-up）。加相对 epsilon 修正 JS 浮点误差：
 * 裸 Math.round(n*100) 会把 1.005 算成 1.00、1.015 算成 1.01。
 */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON * Math.abs(n)) * 100) / 100;
}

/** 取整到 6 位小数（比率 / 概率类数值）。 */
export function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 把价格对齐到最小变动单位（默认 0.01 元）的整数倍；r2 消除乘回时的浮点尾差。 */
export function roundToTick(price: number, tick: number = PRICE_TICK): number {
  if (!(tick > 0)) return price;
  return r2(Math.round(price / tick) * tick);
}
