/**
 * 算法单元总入口。
 *
 * 分割原则：以「算法概念」而非「图表 / 文件职责」为单元，每个模块都是无 DOM、无 IO、
 * 无副作用的纯函数集合；构建期（scripts/）与运行时（src/）通过同一份实现复用，
 * 不再靠 JSON 结果或 dist 产物间接耦合。
 *
 * 每个单元在 ALGORITHMS 里登记 { id, concept, inputs, outputs, sharedBy } 元数据，
 * 同时保留具名导出，调用方可以按需 import 而无需走注册表。
 */
export * from './rounding';
export * from './random';
// market-time 为时间口径唯一真源；显式列出，避免与 aggregation 的 intradayBucket
// re-export 形成 export * 同名歧义，并与 pure 子入口暴露同一个引用。
export {
  clockMinutes, elapsedMarketMinutes, intradayBucket, isoWeek, isoToDateBase,
} from './market-time';
export * from './price-limits';
export * from './returns';
export * from './vwap';
export * from './volume-ratio';
export * from './indicators';
export { aggregateDaily, aggregateIntraday, buildBars, PERIODS } from './aggregation';
export * from './format';
export * from './chip-distribution';
export * from './intraday-multi';
export * from './historical-intraday';
export type { HistoricalIntradaySeries } from '../types';
export * from './auction-match';
export * from './auction-series';
export * from './trade-series';
export * from './depth-snapshot';
export * from './order-book';
export * from './depth-scenarios';

/** 算法单元元数据 */
export interface AlgorithmMeta {
  /** 单元 id，与文件名一致 */
  id: string;
  /** 统一后的概念域 */
  concept: string;
  /** 输入契约（自然语言 + 主要类型） */
  inputs: string;
  /** 输出契约 */
  outputs: string;
  /** 被谁复用：runtime = 浏览器组件；build = scripts 数据生成/校验 */
  sharedBy: ReadonlyArray<'runtime' | 'build'>;
  pure: true;
}

export const ALGORITHMS: Readonly<Record<string, AlgorithmMeta>> = Object.freeze({
  rounding: {
    id: 'rounding', concept: '价格取整', inputs: 'number', outputs: 'number（分 / 6 位小数）',
    sharedBy: ['runtime', 'build'], pure: true,
  },
  random: {
    id: 'random', concept: '确定性伪随机', inputs: 'seed: number', outputs: '() => number',
    sharedBy: ['build'], pure: true,
  },
  'market-time': {
    id: 'market-time', concept: '交易时段 / 时间换算', inputs: 'HH:mm 时间字符串、周期',
    outputs: '分钟数、分钟 K 桶键、ISO 周键', sharedBy: ['runtime', 'build'], pure: true,
  },
  'price-limits': {
    id: 'price-limits', concept: '涨跌停比例 / 价格 / 四态', inputs: 'symbol、preClose、rate、Bar',
    outputs: '比例、涨跌停价、LimitState', sharedBy: ['runtime', 'build'], pure: true,
  },
  returns: {
    id: 'returns', concept: '涨跌幅 / 涨跌额 / 振幅', inputs: '价格、基准价', outputs: '百分比或金额',
    sharedBy: ['runtime', 'build'], pure: true,
  },
  vwap: {
    id: 'vwap', concept: 'VWAP / 均价 / 成交额 / 换手率', inputs: '额、量、价、流通股本',
    outputs: '均价、金额、换手率(%)、增量序列', sharedBy: ['runtime', 'build'], pure: true,
  },
  'volume-ratio': {
    id: 'volume-ratio', concept: '量比（日线 / 分时双口径）', inputs: 'bars、分时点、前 N 日均量',
    outputs: '比值或逐点曲线', sharedBy: ['runtime', 'build'], pure: true,
  },
  indicators: {
    id: 'indicators', concept: 'MA / EMA / MACD / KDJ / 副图分发', inputs: 'K 线序列、参数',
    outputs: '指标序列 + WARMUP 预热元数据', sharedBy: ['runtime', 'build'], pure: true,
  },
  aggregation: {
    id: 'aggregation', concept: 'K 线多周期聚合', inputs: 'bars / intraday / period',
    outputs: 'Bar[]', sharedBy: ['runtime', 'build'], pure: true,
  },
  format: {
    id: 'format', concept: '单位换算与数值格式化', inputs: 'number、单位偏好', outputs: 'string / 单位元数据',
    sharedBy: ['runtime', 'build'], pure: true,
  },
  'chip-distribution': {
    id: 'chip-distribution', concept: '筹码分布估算模型', inputs: 'bars（近 N 日）+ bins/lookback/decay/shape',
    outputs: 'ChipDataset（9 项统计 + 逐日直方图）', sharedBy: ['runtime', 'build'], pure: true,
  },
  'intraday-multi': {
    id: 'intraday-multi', concept: '多日分时（前 N 日由日 K 拟真）', inputs: 'bars、单日 intraday、天数',
    outputs: 'IntradayPoint[]（扁平多日序列）', sharedBy: ['runtime', 'build'], pure: true,
  },
  'historical-intraday': {
    id: 'historical-intraday', concept: '历史分时索引（按交易日分组）',
    inputs: 'intradayMulti、bars、manifest',
    outputs: 'Record<tradeDate, HistoricalIntradaySeries>（242 点/日 + preClose + source）',
    sharedBy: ['runtime', 'build'], pure: true,
  },
  'auction-match': {
    id: 'auction-match', concept: '集合竞价三原则撮合', inputs: '买/卖申报价量、参考价',
    outputs: '成交价、匹配量、未匹配量、方向', sharedBy: ['runtime', 'build'], pure: true,
  },
  'auction-series': {
    id: 'auction-series', concept: '竞价 9 秒节点序列', inputs: 'bars、intraday、交易日',
    outputs: 'AuctionPoint[]（open 69 + close 21）', sharedBy: ['runtime', 'build'], pure: true,
  },
  'trade-series': {
    id: 'trade-series', concept: '逐笔明细（分钟量额闭合）', inputs: 'intraday、交易日、anchorToIntraday',
    outputs: 'TradeTick[]（按分钟聚合严格等于分时）', sharedBy: ['runtime', 'build'], pure: true,
  },
  'depth-snapshot': {
    id: 'depth-snapshot', concept: '收盘十档快照（示意）', inputs: 'bars、交易日', outputs: 'DepthBookSnapshot',
    sharedBy: ['runtime', 'build'], pure: true,
  },
  'order-book': {
    id: 'order-book', concept: '委托流生成 / 回放聚合 / 成交关联',
    inputs: '委托事件、分时曲线、十档快照', outputs: 'OrderRecord[]、全景委托簿、TradeTick[]',
    sharedBy: ['runtime', 'build'], pure: true,
  },
  'depth-scenarios': {
    id: 'depth-scenarios', concept: '普通 / 涨停 / 跌停盘口场景', inputs: '十档、全景、preClose、limitRate',
    outputs: '场景表（不写回输入）', sharedBy: ['runtime', 'build'], pure: true,
  },
});
