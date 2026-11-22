/**
 * Svelte 薄封装：不 import svelte 运行时，Svelte 的「action」本质就是普通函数。
 *
 * 用法（action 已足够覆盖完整生命周期，推荐）：
 *   <script>
 *     import { stockWorkspace } from 'stock-chart/svelte';
 *     let props = { data, config, on: { 'theme-change': (e) => console.log(e.detail) } };
 *   </script>
 *   <stock-workspace use:stockWorkspace={props} />
 *   // props 引用/内容变化 → Svelte 自动调用返回对象的 update(next)（内核增量 diff，不全量重绑）；
 *   // 组件卸载 → 自动调用 destroy()（解绑事件、释放 controller）。
 *
 * 说明：<stock-workspace> 的 data / config / on / onXxx 全由 controller 处理，action 不需要
 * 访问 document / window / customElements，SSR 下 import 本模块完全安全。
 * 若组件侧确实需要注入式工厂（onMount/onDestroy 语义），可用下方的 createSvelteWorkspace；
 * 绝大多数场景直接用 use:stockWorkspace 即可。
 */
import { createWorkspaceController } from './controller';
import type { WorkspaceProps, WorkspaceHost, WorkspaceController } from './controller';

// —— 面向 <stock-workspace> 的内核 re-export（值 / 类型分离，满足 verbatimModuleSyntax）——
export {
  createWorkspaceController, bindWorkspace, mountWorkspace,
  camelToEventName, diffConfig, WORKSPACE_EVENT_NAMES,
} from './controller';
export type {
  WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap,
  WorkspaceEventName, WorkspaceEventHandler,
} from './controller';

/** Svelte action 的返回契约（Svelte 编译器按 update / destroy 调用） */
export interface SvelteActionReturn {
  update(next: WorkspaceProps): void;
  destroy(): void;
}

/**
 * Svelte action：内部持有 createWorkspaceController 句柄。
 *  - 首次调用即 createWorkspaceController(node, props)（写入 data/config、绑定事件）；
 *  - update(next) → controller.update(next)（增量 diff）；
 *  - destroy()   → controller.destroy()（解绑全部事件）。
 * node 为 null/undefined（SSR 场景）时 controller 为空，update/destroy 自动退化为空操作。
 */
export function workspaceAction(
  node: WorkspaceHost,
  props: WorkspaceProps = {},
): SvelteActionReturn {
  const controller = createWorkspaceController(node, props);
  return {
    update(next: WorkspaceProps): void {
      controller?.update(next);
    },
    destroy(): void {
      controller?.destroy();
    },
  };
}

/** 别名：便于 `use:stockWorkspace` 的直观写法 */
export const stockWorkspace = workspaceAction;

/** 注入式工厂依赖的最小 Svelte 运行时接口（不 import svelte） */
export interface SvelteLike {
  onMount(fn: () => void | (() => void)): void;
  onDestroy(fn: () => void): void;
}

/**
 * 可选：注入式封装（action 已足够，此工厂仅服务需要 onMount/onDestroy 语义的封装场景）。
 * 返回一个 setup 函数，组件里这样用：
 *   const ws = createSvelteWorkspace(svelte)(() => nodeRef, () => props);
 *   // props 变化时手动 ws.update(next)；onMount 建 controller、onDestroy 销毁。
 * 全程只调用注入进来的 onMount/onDestroy，不触碰任何 DOM 全局。
 */
export function createSvelteWorkspace(
  svelte: SvelteLike,
): (
  getNode: () => WorkspaceHost | null,
  getProps: () => WorkspaceProps,
) => { update(next: WorkspaceProps): void } {
  return function setupWorkspace(getNode, getProps) {
    let controller: WorkspaceController | undefined;
    svelte.onMount(() => {
      controller = createWorkspaceController(getNode(), getProps());
    });
    svelte.onDestroy(() => {
      controller?.destroy();
      controller = undefined;
    });
    return {
      update(next: WorkspaceProps): void {
        controller?.update(next);
      },
    };
  };
}
