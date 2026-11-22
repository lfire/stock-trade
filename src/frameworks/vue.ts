/**
 * Vue 薄封装：不依赖 Vue 运行时。
 * - bindStockChart(el, options) 与 React 版共用同一套 setter/事件绑定，返回 cleanup。
 * - vStockChart 自定义指令：v-stock-chart="options"，mounted/updated 应用、unmounted 自动解绑。
 *
 * 面向 <stock-workspace> 的新适配（推荐）：vWorkspace 指令 / createVueWorkspace 注入式组件 /
 * useWorkspace composable；旧 vStockChart / bindStockChart 仍原样可用，但已 @deprecated。
 */
import { bindStockChart } from './react';
import type { StockChartBinding } from './react';
import { createWorkspaceController } from './controller';
import type {
  WorkspaceProps, WorkspaceController, WorkspaceHost,
} from './controller';

/** @deprecated 仅服务旧 <stock-chart>；请改用 bindWorkspace。 */
export { bindStockChart };

// 面向 <stock-workspace> 的内核 re-export
export { bindWorkspace, createWorkspaceController, mountWorkspace } from './controller';
export type {
  WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap,
} from './controller';

const CLEANUP = '__stockChartCleanup__';
type VueBinding = { value?: StockChartBinding; oldValue?: StockChartBinding };
interface CleanupHost extends EventTarget { __stockChartCleanup__?: (() => void) | undefined }

/** @deprecated 仅服务旧 <stock-chart>；请改用 vWorkspace。 */
export const vStockChart = {
  mounted(el: EventTarget, binding: VueBinding) {
    (el as CleanupHost)[CLEANUP]?.();
    (el as CleanupHost)[CLEANUP] = bindStockChart(el, binding.value || {});
  },
  updated(el: EventTarget, binding: VueBinding) {
    // binding.value 是对象，引用变化即重新绑定（新旧值相同则跳过）
    if (binding.value === binding.oldValue) return;
    (el as CleanupHost)[CLEANUP]?.();
    (el as CleanupHost)[CLEANUP] = bindStockChart(el, binding.value || {});
  },
  unmounted(el: EventTarget) {
    (el as CleanupHost)[CLEANUP]?.();
    delete (el as CleanupHost)[CLEANUP];
  },
};

/** @deprecated 仅服务旧 <stock-chart>；请改用 vWorkspace。 */
export default vStockChart;

// ---------------------------------------------------------------------------
// 面向 <stock-workspace> 的 Vue 适配
// ---------------------------------------------------------------------------

const WORKSPACE_CONTROLLER = '__stockWorkspaceController__';
interface WorkspaceDirectiveBinding {
  value?: WorkspaceProps;
}
interface WorkspaceControllerHost extends EventTarget {
  __stockWorkspaceController__?: WorkspaceController | undefined;
}

/**
 * vWorkspace 指令：v-workspace="props"。
 * mounted 建 controller，updated 只做 controller.update（增量 diff，不全量解绑重绑），unmounted 销毁。
 */
export const vWorkspace = {
  mounted(el: EventTarget, binding: WorkspaceDirectiveBinding) {
    const host = el as WorkspaceControllerHost;
    host[WORKSPACE_CONTROLLER]?.destroy();
    host[WORKSPACE_CONTROLLER] = createWorkspaceController(el as WorkspaceHost, binding.value || {});
  },
  updated(el: EventTarget, binding: WorkspaceDirectiveBinding) {
    (el as WorkspaceControllerHost)[WORKSPACE_CONTROLLER]?.update(binding.value || {});
  },
  unmounted(el: EventTarget) {
    const host = el as WorkspaceControllerHost;
    host[WORKSPACE_CONTROLLER]?.destroy();
    delete host[WORKSPACE_CONTROLLER];
  },
};

/** 注入式组件工厂依赖的最小 Vue 兼容接口（不 import vue） */
export interface VueLike {
  defineComponent(options: Record<string, unknown>): unknown;
  h(type: string, props: Record<string, unknown> | null): unknown;
  ref<T>(initial: T): { value: T };
  watchEffect(effect: () => void): void;
  onMounted(hook: () => void): void;
  onUnmounted(hook: () => void): void;
}

/**
 * 注入式组件工厂：返回一个 defineComponent 产物。
 * render 用 h('stock-workspace', { ref: elRef })；挂载后建 controller，
 * watchEffect 里 controller?.update(props) 增量更新，卸载 destroy。
 */
export function createVueWorkspace(vue: VueLike): unknown {
  return vue.defineComponent({
    props: ['data', 'config', 'on'],
    setup(props: WorkspaceProps) {
      const elRef = vue.ref<WorkspaceHost | null>(null);
      let controller: WorkspaceController | undefined;
      vue.onMounted(() => {
        controller = createWorkspaceController(elRef.value, { ...props });
      });
      vue.watchEffect(() => {
        // 读取 props 建立响应式依赖；展开为普通对象交给 controller 做增量 diff
        const snapshot: WorkspaceProps = { ...props };
        controller?.update(snapshot);
      });
      vue.onUnmounted(() => {
        controller?.destroy();
        controller = undefined;
      });
      return () => vue.h('stock-workspace', { ref: elRef });
    },
  });
}

/** 组合式 API 句柄：暴露 controller 供外部增量 update，cleanup 在卸载时调用 */
export interface WorkspaceControllerHandle {
  readonly controller: WorkspaceController | undefined;
  readonly cleanup: () => void;
}

/**
 * 返回 controller + cleanup 的句柄形态（无框架运行时依赖）。
 * 调用方在 Vue 的 onMounted 后拿到 controller，props 变化时调 controller.update(next)，
 * onUnmounted 时调 cleanup。
 */
export function useWorkspaceController(
  el: WorkspaceHost | null | undefined,
  props: WorkspaceProps = {},
): WorkspaceControllerHandle {
  const controller = createWorkspaceController(el, props);
  return { controller, cleanup: () => controller?.destroy() };
}

function isElementRef(x: unknown): x is { value: WorkspaceHost | null } {
  return typeof x === 'object' && x !== null && 'value' in x;
}

/**
 * useWorkspace composable：接受元素 ref（{ value }）或直接元素，
 * 返回与 useWorkspaceController 相同的 controller + cleanup 句柄，供组合式 API 配合生命周期使用。
 */
export function useWorkspace(
  elRef: { value: WorkspaceHost | null } | WorkspaceHost | null | undefined,
  props: WorkspaceProps = {},
): WorkspaceControllerHandle {
  const el = isElementRef(elRef) ? elRef.value : elRef;
  return useWorkspaceController(el, props);
}
