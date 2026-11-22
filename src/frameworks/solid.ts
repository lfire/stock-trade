/**
 * Solid / Preact 薄封装：不 import solid-js / preact / react 等任何框架运行时。
 *
 *  - splitWorkspaceProps(props)：把 data / config / on / onXxx 从任意 props 对象里分离出来，
 *    data/config/on/onXxx 收进 workspace（交给 controller），其余（className / id / ref …）
 *    放进 rest 直接铺到 JSX 元素上。用 camelToEventName 识别 onXxx，供 JSX 系框架复用。
 *  - createWorkspaceSignalBinding(solid)：注入式，用 createEffect 订阅 props、onCleanup 销毁。
 *  - createPreactWorkspace(preact)：薄别名，复用 react.ts 的 createReactWorkspace。
 *
 * 全程不碰 document / window / customElements，SSR 可安全 import。
 */
import { createWorkspaceController, camelToEventName } from './controller';
import type { WorkspaceProps, WorkspaceHost } from './controller';
import { createReactWorkspace } from './react';

// —— 面向 <stock-workspace> 的内核 re-export（值 / 类型分离，满足 verbatimModuleSyntax）——
export {
  createWorkspaceController, bindWorkspace, mountWorkspace,
  camelToEventName, diffConfig, WORKSPACE_EVENT_NAMES,
} from './controller';
export type {
  WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap,
  WorkspaceEventName, WorkspaceEventHandler,
} from './controller';

/** splitWorkspaceProps 的结果：交给 controller 的子集 + 直接铺到 JSX 的其余属性 */
export interface SplitWorkspaceProps {
  workspace: WorkspaceProps;
  rest: Record<string, unknown>;
}

/**
 * 把 data / config / on / onXxx 从 props 中分离。
 * onXxx（如 onThemeChange）用 camelToEventName 判定（返回非空即命中），原样保留在 workspace 中，
 * 由 controller 的 collectHandlers 解析成事件名；其余键放入 rest。
 */
export function splitWorkspaceProps(props: Record<string, unknown>): SplitWorkspaceProps {
  const workspace: WorkspaceProps = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'data' || key === 'config' || key === 'on' || camelToEventName(key)) {
      (workspace as Record<string, unknown>)[key] = value;
    } else {
      rest[key] = value;
    }
  }
  return { workspace, rest };
}

/** workspaceProps 工具集（命名空间形态），便于按对象使用 splitWorkspaceProps */
export const workspaceProps = { splitWorkspaceProps } as const;

/** 注入式工厂依赖的最小 Solid 兼容接口（不 import solid-js） */
export interface SolidLike {
  createEffect(fn: () => void): void;
  onCleanup(fn: () => void): void;
  createSignal<T>(initial: T): readonly [() => T, (value: T) => void];
}

/**
 * 注入式：返回一个 bindWorkspaceProps(el, propsAccessor)。
 *  - 用 propsAccessor（Solid 的 signal accessor）建立响应式依赖；
 *  - createEffect 里每次 props 变化都 controller.update(snapshot)（增量 diff）；
 *  - onCleanup 里 controller.destroy() 解绑全部事件。
 * 返回 unknown（与 react/vue 注入式工厂一致），由调用方按需要收窄类型。
 */
export function createWorkspaceSignalBinding(solid: SolidLike): unknown {
  return function bindWorkspaceProps(
    el: WorkspaceHost | null | undefined,
    propsAccessor: () => WorkspaceProps,
  ): void {
    const controller = createWorkspaceController(el, propsAccessor());
    solid.createEffect(() => {
      // 读取 accessor 建立响应式依赖；展开为普通快照交给 controller 做增量 diff
      const snapshot: WorkspaceProps = propsAccessor();
      controller?.update(snapshot);
    });
    solid.onCleanup(() => {
      controller?.destroy();
    });
  };
}

/**
 * Preact 适配对象：结构与 react.ts 的 ReactLike 完全一致
 * （createElement / useRef / useEffect / useMemo），因此可直接传给 createReactWorkspace，
 * 无需 import react 内部未导出的 ReactLike，也不需要宽松类型或双重转换。
 */
export interface PreactLike {
  createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
  useMemo<T>(factory: () => T, deps: ReadonlyArray<unknown>): T;
}

/**
 * 薄别名：Preact 注入对象在结构上兼容 ReactLike，直接复用 react.ts 的组件工厂。
 * 不 import preact / react 运行时，SSR 安全。
 */
export function createPreactWorkspace(preact: PreactLike): unknown {
  return createReactWorkspace(preact);
}
