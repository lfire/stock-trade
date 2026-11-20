/**
 * A 股涨跌停规则：薄重导出层（数据分层）。
 * 算法单一真源 src/algorithms/price-limits.ts → dist/algorithms/price-limits.js。
 * scripts/ 三处薄重导出 shared.mjs / limit-rules.mjs / auction-match.mjs 只保留原导出面，
 * 生成脚本、verify 与回归测试继续按原路径 import，避免与 dist 版本重复实现。
 * PRICE_TICK / PRICE_EPS 仍从 market-constants 单一真源透传，保持原有导出名不变。
 */
export { limitRateFor, limitPrices, limitStateOf } from '../dist/algorithms/price-limits.js';
export { PRICE_TICK, PRICE_EPS } from '../dist/core/market-constants.js';
