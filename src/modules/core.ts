/**
 * core 模块子路径门面（薄聚合门面，实现仍在共享模块）。
 *
 * 本文件只 re-export 现有实现的公开 API 与该模块在 MODULE_CATALOG 中的描述符，
 * 不搬运实现、不引入其它模块门面、不产生注册副作用，可独立加载（SSR 安全）。
 * 消费者经子路径 'stock-chart/modules/core' 静态寻址，按需只拉起相关实现闭包。
 */
import { MODULE_CATALOG, type WorkspaceModuleDef } from '../workspace/module-catalog';
import { describeModule, type ModuleDescription } from '../workspace/module-io';

/** 模块 id 字面量，与 MODULE_CATALOG 的键一致。 */
export const MODULE_ID = 'core';
/** 模块目录描述符（纯数据，来自零依赖的 module-catalog）。 */
export const descriptor: WorkspaceModuleDef = MODULE_CATALOG['core'];
/** 单模块出入参：必需落盘输入、派生数据、元素、API、配置、事件（数据输入由模块目录计算） */
export const io: ModuleDescription = describeModule('core')!;

export { LAYOUT, PALETTE, THEMES } from '../types';
export type { ChartDataset } from '../types';
// WorkspaceConfig 定义在 workspace/types（而非 types），按实际可用位置 re-export。
export type { WorkspaceConfig } from '../workspace/types';
