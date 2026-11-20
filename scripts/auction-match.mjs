/**
 * 集合竞价虚拟撮合：薄重导出层（数据分层）。
 * 算法单一真源 src/algorithms/auction-match.ts → dist/algorithms/auction-match.js
 * （已修复「候选价漏中间价」）。与 shared.mjs / limit-rules.mjs 一样只保留原导出名与签名，
 * 生成脚本与回归测试继续按原路径 import，避免与 dist 版本重复实现。
 */
export { matchAuction, makeOrderBook } from '../dist/algorithms/auction-match.js';
