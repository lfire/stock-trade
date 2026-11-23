/**
 * detail-cover 模块子路径门面（薄聚合门面，实现仍在共享模块）。
 *
 * buildDetailGroups 是 detail.ts 的内部函数（不导出），故此处按可用的公开 API
 * 导出详情画布布局与 workspace 事件常量，外加该模块描述符；
 * 不搬运实现、不引入其它模块门面、无注册副作用，可独立加载（SSR 安全）。
 */
import { MODULE_CATALOG, type WorkspaceModuleDef } from '../workspace/module-catalog';

/** 模块 id 字面量，与 MODULE_CATALOG 的键一致。 */
export const MODULE_ID = 'detail-cover';
/** 模块目录描述符（纯数据，来自零依赖的 module-catalog）。 */
export const descriptor: WorkspaceModuleDef = MODULE_CATALOG['detail-cover'];

export { DetailCanvasLayout, detailGroupCount, detailRowsPerGroup } from '../architecture/detail-canvas-layout';
export { WORKSPACE_EVENTS } from '../workspace/types';
export type { DetailLayoutInput } from '../architecture/detail-canvas-layout';
export type { DetailData } from '../types';
