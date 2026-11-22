/**
 * 框架无关适配内核：把 WorkspaceProps 映射到 <stock-workspace> 的 data / config 属性与事件。
 *
 * 设计要点：
 *  - 只依赖原生 EventTarget，不 import 任何框架、不碰 document / customElements，SSR 可安全 import。
 *  - data 用引用比较（允许 null 清空）；config 逐 key 浅 diff，只把变化字段作为 patch 传给组件
 *    （对齐 StockWorkspace.setConfig 的浅合并 + `'key' in patch` 增量语义）。
 *  - 事件同时支持「事件名字典 on」与「驼峰 onXxx」，detail 保持强类型。
 *  - update() 只处理差异，不做全量解绑重绑。
 */
import type { ChartDataset, StockChartEventMap } from '../types';
import type { WorkspaceConfig } from '../workspace/types';
import { WORKSPACE_EVENTS } from '../workspace/types';

/** 组件宿主的最小结构化契约（不引用任何自定义元素类，便于测试与 SSR） */
export interface WorkspaceHost extends EventTarget {
  data?: ChartDataset | null;
  config?: Partial<WorkspaceConfig> | Readonly<WorkspaceConfig>;
  setData?: (value: ChartDataset | null) => void;
  setConfig?: (patch: Partial<WorkspaceConfig>) => void;
}

/** workspace 级事件（补充 CHART_EVENTS 未覆盖的三个），detail 强类型 */
export interface WorkspaceEventMap extends Omit<StockChartEventMap, 'dataset-ready'> {
  'workspace-ready': CustomEvent<{ config: WorkspaceConfig }>;
  'dataset-ready': CustomEvent<{ dataset: ChartDataset | null }>;
  'workspace-config-change': CustomEvent<{ config: WorkspaceConfig; patch: Partial<WorkspaceConfig> }>;
  'workspace-status': CustomEvent<{ status: string; message?: string }>;
}

export type WorkspaceEventName = keyof WorkspaceEventMap & string;

/** 事件回调：字典形式或驼峰形式共用 */
export type WorkspaceEventHandler<K extends string = string> =
  (ev: K extends keyof WorkspaceEventMap ? WorkspaceEventMap[K] : CustomEvent<unknown>) => void;

/** 框架适配层的统一输入 */
export interface WorkspaceProps {
  /** 结构化数据对象；引用变化才赋值，null 可清空 */
  data?: ChartDataset | null;
  /** 配置对象（增量合并，逐 key diff） */
  config?: Partial<WorkspaceConfig>;
  /** 事件名字典，如 { 'theme-change': fn, 'chart-error': fn } */
  on?: Partial<Record<WorkspaceEventName | string, WorkspaceEventHandler>>;
  // 常用驼峰回调：给出精确的 CustomEvent detail 类型；其它事件请用 on 字典
  onWorkspaceReady?: WorkspaceEventHandler<'workspace-ready'>;
  onDatasetReady?: WorkspaceEventHandler<'dataset-ready'>;
  onWorkspaceConfigChange?: WorkspaceEventHandler<'workspace-config-change'>;
  onWorkspaceStatus?: WorkspaceEventHandler<'workspace-status'>;
  onChartError?: WorkspaceEventHandler<'chart-error'>;
  onThemeChange?: WorkspaceEventHandler<'theme-change'>;
  onHeadChange?: WorkspaceEventHandler<'head-change'>;
  onDataLoaded?: WorkspaceEventHandler<'data-loaded'>;
  onDepthScenarioChange?: WorkspaceEventHandler<'depth-scenario-change'>;
  onDepthUnitChange?: WorkspaceEventHandler<'depth-unit-change'>;
  /** 其余驼峰回调（运行时按 camelToEventName 转换），参数按 CustomEvent<unknown> 处理 */
  [key: string]: unknown;
}

/** controller 返回给框架桥的句柄 */
export interface WorkspaceController {
  readonly element: WorkspaceHost;
  /** 增量更新 props；返回是否有实际变更 */
  update(next: WorkspaceProps): boolean;
  /** 解绑全部事件并释放 */
  destroy(): void;
}

/** WORKSPACE_EVENTS 的键集合，供事件解析与文档生成使用 */
export const WORKSPACE_EVENT_NAMES: ReadonlyArray<string> = Object.freeze(Object.values(WORKSPACE_EVENTS));

/** onThemeChange → theme-change；已经带连字符的事件名原样返回 */
export function camelToEventName(key: string): string {
  if (!/^on[A-Z]/.test(key)) return '';
  // 'onThemeChange' → 'theme-change'（首字母大写不应产生前导 '-'）
  const body = key.slice(2);
  return body.charAt(0).toLowerCase()
    + body.slice(1).replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** 把 on 字典与驼峰 onXxx 合并为「事件名 → handler」 */
function collectHandlers(props: WorkspaceProps): Map<string, WorkspaceEventHandler> {
  const out = new Map<string, WorkspaceEventHandler>();
  for (const [name, fn] of Object.entries(props.on || {})) {
    if (typeof fn === 'function' && name) out.set(name, fn as WorkspaceEventHandler);
  }
  for (const [key, value] of Object.entries(props)) {
    const name = camelToEventName(key);
    if (name && typeof value === 'function') out.set(name, value as WorkspaceEventHandler);
  }
  return out;
}

/** 逐 key 浅 diff，返回变化的配置字段；无变化返回 null */
export function diffConfig(
  prev: Partial<WorkspaceConfig> | undefined,
  next: Partial<WorkspaceConfig> | undefined,
): Partial<WorkspaceConfig> | null {
  if (prev === next) return null;
  if (!next) return null;
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next)]);
  let changed = false;
  for (const k of keys) {
    const a = (prev as Record<string, unknown> | undefined)?.[k];
    const b = (next as Record<string, unknown>)[k];
    if (a !== b) { patch[k] = b; changed = true; }
  }
  return changed ? patch as Partial<WorkspaceConfig> : null;
}

/** 写入 data：优先用属性，其次用方法；允许 null 清空 */
function applyData(el: WorkspaceHost, value: ChartDataset | null): void {
  if (typeof el.setData === 'function') el.setData(value);
  else el.data = value;
}

/** 写入 config patch：属性与 setter 都可用（属性是增量合并语义） */
function applyConfig(el: WorkspaceHost, patch: Partial<WorkspaceConfig>): void {
  if (typeof el.setConfig === 'function') el.setConfig(patch);
  else el.config = patch;
}

/**
 * 创建控制器。el 为 null/undefined 时返回 undefined（React ref 卸载、Vue unmounted 等场景）。
 */
export function createWorkspaceController(
  el: WorkspaceHost | null | undefined,
  initial: WorkspaceProps = {},
): WorkspaceController | undefined {
  if (!el) return undefined;
  let current: WorkspaceProps = {};
  const bound = new Map<string, { fn: WorkspaceEventHandler; off: () => void }>();

  const sync = (next: WorkspaceProps): boolean => {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(next, 'data') && current.data !== next.data) {
      applyData(el, next.data ?? null);
      changed = true;
    }
    const patch = diffConfig(current.config, next.config);
    if (patch) { applyConfig(el, patch); changed = true; }

    const handlers = collectHandlers(next);
    for (const [name, { off }] of bound) {
      if (!handlers.has(name) || handlers.get(name) !== bound.get(name)?.fn) {
        off(); bound.delete(name); changed = true;
      }
    }
    for (const [name, fn] of handlers) {
      if (bound.get(name)?.fn === fn) continue;
      const listener: EventListener = (ev) => fn(ev as CustomEvent);
      el.addEventListener(name, listener);
      bound.set(name, { fn, off: () => el.removeEventListener(name, listener) });
      changed = true;
    }
    current = { ...next };
    return changed;
  };

  sync(initial);
  return {
    element: el,
    update: sync,
    destroy() {
      for (const { off } of bound.values()) off();
      bound.clear();
      current = {};
    },
  };
}

/** 一次性绑定（React ref / 原生回调场景），返回 cleanup */
export function bindWorkspace(
  el: WorkspaceHost | null | undefined,
  props: WorkspaceProps = {},
): (() => void) | undefined {
  const c = createWorkspaceController(el, props);
  return c ? () => c.destroy() : undefined;
}

/**
 * 原生工厂：把 props 应用到元素并返回 controller。
 * 不调用 defineAll()（标签注册由使用方负责），不做任何 DOM 查询，SSR 下传入 null 返回 undefined。
 */
export function mountWorkspace(
  el: WorkspaceHost | null | undefined,
  props: WorkspaceProps = {},
): WorkspaceController | undefined {
  return createWorkspaceController(el, props);
}
