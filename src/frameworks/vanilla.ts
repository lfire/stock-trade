/**
 * 原生（vanilla）统一子入口：stock-chart/vanilla。
 *
 *  - 完整 re-export 框架无关内核（值 + 类型），单文件即可拿到全部能力；
 *  - mount()：mountWorkspace 的直接别名（把 props 应用到元素并返回 controller）；
 *  - mountWithData()：**显式的可选便利项**，页面负责 IO —— 用 loadDataset 加载后写入
 *    data / config 并返回 controller。组件本身永远不 fetch、不解析 URL；这绝不会变成
 *    组件的默认行为，只有主动调用本函数才会触发一次 IO。
 *  - WORKSPACE_EVENTS：原生用户订阅事件的常量。
 *
 * 不调用 defineAll()（标签注册由使用方负责），不碰 document / window / customElements，
 * SSR 下传入 null 的 mount / mountWithData 返回 undefined，可安全 import。
 */
import { mountWorkspace, createWorkspaceController } from './controller';
import type { WorkspaceProps, WorkspaceHost, WorkspaceController } from './controller';
import { WORKSPACE_EVENTS } from '../workspace/types';
import type { WorkspaceConfig } from '../workspace/types';

// —— 全部内核公开 API re-export（值 / 类型分离，满足 verbatimModuleSyntax）——
export {
  createWorkspaceController, bindWorkspace, mountWorkspace,
  camelToEventName, diffConfig, WORKSPACE_EVENT_NAMES,
} from './controller';
export type {
  WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap,
  WorkspaceEventName, WorkspaceEventHandler,
} from './controller';

/** 原生事件名常量，便于 el.addEventListener(WORKSPACE_EVENTS.READY, ...) */
export { WORKSPACE_EVENTS };

/** mountWorkspace 的直接别名（把 props 应用到元素并返回 controller） */
export function mount(
  el: WorkspaceHost | null,
  props: WorkspaceProps = {},
): WorkspaceController | undefined {
  return mountWorkspace(el, props);
}

/**
 * 显式可选便利项：页面负责 IO。
 * 用 loadDataset(dataUrl) 加载结构化数据 → 赋给 el.data / el.config → 返回 controller。
 * 采用 dynamic import，使本模块在 SSR / 仅订阅事件的场景下不静态拉起数据派生依赖链；
 * 只有主动调用才会触发 IO，组件默认行为不变。
 */
export async function mountWithData(
  el: WorkspaceHost | null,
  dataUrl: string,
  config?: Partial<WorkspaceConfig>,
): Promise<WorkspaceController | undefined> {
  const { loadDataset } = await import('../core/data-store');
  const data = await loadDataset(dataUrl);
  if (!el) return undefined;
  // 页面把加载结果写到宿主（等价于 el.data = data / el.config = config）；
  // 再以同一份值作为 controller 的初始基线，使事件绑定与后续 update 的增量 diff 正常。
  el.data = data;
  if (config !== undefined) el.config = config;
  return createWorkspaceController(el, { data, config });
}
