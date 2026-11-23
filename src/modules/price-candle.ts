/**
 * price-candle 模块子路径门面（薄聚合门面，实现仍在共享模块）。
 *
 * 只 re-export K 线聚合相关的现有公开 API 与该模块描述符，不搬运实现、
 * 不引入其它模块门面、无注册副作用，可独立加载（SSR 安全）。
 */
import { MODULE_CATALOG, type WorkspaceModuleDef } from '../workspace/module-catalog';

/** 模块 id 字面量，与 MODULE_CATALOG 的键一致。 */
export const MODULE_ID = 'price-candle';
/** 模块目录描述符（纯数据，来自零依赖的 module-catalog）。 */
export const descriptor: WorkspaceModuleDef = MODULE_CATALOG['price-candle'];

export { aggregateDaily, aggregateIntraday, buildBars, PERIODS, PERIOD_LABEL, periodMeta, DEFAULT_PERIOD } from '../core/bar-aggregator';
export type { Bar, ChartDataset } from '../types';
