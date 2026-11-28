/**
 * historical-intraday 模块子路径门面（薄聚合门面，实现仍在共享模块）。
 *
 * 只 re-export 历史分时索引与单日派生视图相关的现有公开 API、类型与该模块描述符，
 * 不搬运实现、不引入其它模块门面、无注册副作用，可独立加载（SSR 安全）。
 */
import { MODULE_CATALOG, type WorkspaceModuleDef } from '../workspace/module-catalog';
import { describeModule, type ModuleDescription } from '../workspace/module-io';

/** 模块 id 字面量，与 MODULE_CATALOG 的键一致。 */
export const MODULE_ID = 'historical-intraday';
/** 模块目录描述符（纯数据，来自零依赖的 module-catalog）。 */
export const descriptor: WorkspaceModuleDef = MODULE_CATALOG['historical-intraday'];
/** 单模块出入参：必需落盘输入、派生数据、元素、API、配置、事件（数据输入由模块目录计算） */
export const io: ModuleDescription = describeModule('historical-intraday')!;

export { buildHistoricalIntraday, deriveHistoricalDayView } from '../algorithms/historical-intraday';
export type { HistoricalDayView } from '../algorithms/historical-intraday';
export type { HistoricalIntradaySeries, HistoricalIntradayMap } from '../types';
