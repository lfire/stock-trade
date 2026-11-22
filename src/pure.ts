/**
 * 纯函数子入口：不含任何 DOM / customElements 引用，可在 Node 或 Worker 中直接 import。
 * 供第三方只取计算与几何能力、不加载 Web Components 时使用。
 */
export * from './gl/geometry';
export * from './compute/indicators';
export * from './core/bar-aggregator';
export * from './core/indicator-params';
export * from './core/market-constants';
export * from './architecture/index';
// 算法单元总入口：注册表与新增算法具名导出。
// elapsedMarketMinutes / intradayBucket 已收敛到 algorithms/market-time 的唯一实现，
// 下面显式从算法总入口导出，与 compute/indicators、core/bar-aggregator 的 re-export
// 指向同一个引用；其余同名键（sma/ema/…、aggregate*）由上方 re-export 提供，
// 显式列出不冲突的部分，避免 export * 的歧义。
export { ALGORITHMS } from './algorithms/index';
export type { AlgorithmMeta } from './algorithms/index';
export {
  elapsedMarketMinutes, intradayBucket,
  r2, r6, roundToTick, mulberry32, clockMinutes, isoWeek,
  limitRateFor, limitPrices, limitStateOf,
  pctChg, change, amplitude, pctOf, quoteOf,
  vwapOf, avgPriceOf, amountOf, turnoverRateOf, toIncremental, avgDailyVolume,
  WARMUP, trim, shortNum, pickUnit, fmtQty, fmtVol, fmtMoney, fmtAmt,
  buildChipDistribution, summarizeChipStats, buildIntradayMulti,
  matchAuction, makeOrderBook, buildAuctionSeries, buildTradeSeries,
  buildDepthSnapshot, buildOrderFlow, reduceOrderBook, linkFillsToTrades,
  buildDepthScenarios, LIMIT_UP_SEAL_VOLUME, LIMIT_DOWN_SEAL_VOLUME,
} from './algorithms/index';
