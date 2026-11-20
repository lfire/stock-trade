/**
 * K 线多周期聚合（算法单元化收口）：统一从 src/core/bar-aggregator re-export，
 * 保证单一实现。
 */
export {
  aggregateDaily,
  aggregateIntraday,
  buildBars,
  intradayBucket,
  PERIODS,
} from '../core/bar-aggregator';
