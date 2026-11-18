/**
 * 纯函数子入口：不含任何 DOM / customElements 引用，可在 Node 或 Worker 中直接 import。
 * 供第三方只取计算与几何能力、不加载 Web Components 时使用。
 */
export * from './gl/geometry.js';
export * from './compute/indicators.js';
export * from './core/bar-aggregator.js';
export * from './core/indicator-params.js';
