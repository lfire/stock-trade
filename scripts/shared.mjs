/**
 * 数据生成脚本共用纯工具：薄重导出层（数据分层）。
 * 单一真源 src/algorithms/rounding.ts、src/algorithms/random.ts（tsc 产物 dist/algorithms/）。
 * 与 limit-rules.mjs / auction-match.mjs 一同只保留原有导出名与签名，
 * 生成脚本与回归测试仍按原路径 import，避免与 dist 版本重复实现。
 */
export { r2, r6 } from '../dist/algorithms/rounding.js';
export { mulberry32 } from '../dist/algorithms/random.js';
