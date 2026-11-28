/**
 * chip 模块子路径门面（薄聚合门面，实现仍在共享模块）。
 *
 * 只 re-export 筹码分布纯算法与该模块描述符，不搬运实现、不引入其它模块门面、
 * 无注册副作用，可独立加载（SSR 安全）。
 * 注意：chipSnapshotAt 位于 elements/chip-pane.ts（依赖 HTMLElement），
 * 门面不引入 DOM 依赖，改以同域纯函数 summarizeChipStats 作为配对公开 API。
 */
import { MODULE_CATALOG, type WorkspaceModuleDef } from '../workspace/module-catalog';
import { describeModule, type ModuleDescription } from '../workspace/module-io';

/** 模块 id 字面量，与 MODULE_CATALOG 的键一致。 */
export const MODULE_ID = 'chip';
/** 模块目录描述符（纯数据，来自零依赖的 module-catalog）。 */
export const descriptor: WorkspaceModuleDef = MODULE_CATALOG['chip'];
/** 单模块出入参：必需落盘输入、派生数据、元素、API、配置、事件（数据输入由模块目录计算） */
export const io: ModuleDescription = describeModule('chip')!;

export { buildChipDistribution, summarizeChipStats } from '../algorithms/chip-distribution';
export type { ChipDistributionOptions } from '../algorithms/chip-distribution';
export type { ChipDataset, ChipStat, ChipHistogram } from '../types';
