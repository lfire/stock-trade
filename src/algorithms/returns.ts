/**
 * 涨跌幅 / 变化类统一公式（算法单元化收口）：Δ / base × 100。
 * 核心关系逐字来自 src/core/bar-aggregator.ts 与 src/elements/price-pane.ts。
 * 本模块只返回原始数值；取整 / 展示格式化分别由 rounding.ts、format.ts 负责。
 */

/** 涨跌额：现值 − 基准。 */
export function change(value: number, base: number): number {
  return value - base;
}

/** 涨跌幅（%）：(value − base) / base × 100。 */
export function pctChg(value: number, base: number): number {
  return (change(value, base) / base) * 100;
}

/** 振幅（%）：(high − low) / preClose × 100。 */
export function amplitude(high: number, low: number, preClose: number): number {
  return ((high - low) / preClose) * 100;
}

/** 占比（%）：part / whole × 100。 */
export function pctOf(part: number, whole: number): number {
  return (part / whole) * 100;
}

/** 报价：给定现价与昨收，返回涨跌额与涨跌幅（%）。 */
export function quoteOf(price: number, preClose: number): { change: number; pct: number } {
  return { change: change(price, preClose), pct: pctChg(price, preClose) };
}
