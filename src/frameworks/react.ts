/**
 * React / JSX 薄封装：不依赖 react 运行时，任何支持 ref 回调的框架都能用。
 *
 * 用法（React 19 的 ref cleanup 会自动解绑事件）：
 *   <stock-chart ref={(el) => bindStockChart(el, {
 *     mode: 'candle', theme: 'light',
 *     on: { 'crosshair-change': (e) => console.log(e.detail.index) },
 *   })} />
 *
 * 命令式注入数据用 `data`（对象）或 `dataset`（目录 URL），其余键映射到组件公开 setter。
 *
 * 面向 <stock-workspace> 的新适配（推荐）：内核 re-export + createWorkspaceRef /
 * createReactWorkspace / bindWorkspaceProps；旧 bindStockChart 仍原样可用，但已 @deprecated。
 */
import type {
  ChartDataset, ChartMode, ChipMode, MAConfig, MACDParams, NumericInput, Viewport,
} from '../types';
import {
  bindWorkspace, camelToEventName, createWorkspaceController,
} from './controller';
import type {
  WorkspaceProps, WorkspaceController, WorkspaceHost,
} from './controller';

// 面向 <stock-workspace> 的统一内核 re-export（框架无关，SSR 可安全 import）
export {
  createWorkspaceController, bindWorkspace, mountWorkspace, diffConfig,
  camelToEventName, WORKSPACE_EVENT_NAMES,
} from './controller';
export type {
  WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap,
} from './controller';

interface ChartHost extends EventTarget {
  setAttribute?(name: string, value: string): void;
  setDataset?(dataset: Partial<ChartDataset>): void;
  setMode?(mode: ChartMode): void;
  setPeriod?(period: string): void;
  setChipMode?(mode: ChipMode): void;
  setTheme?(theme: string | Record<string, string> | null): void;
  setAuctionEnabled?(on: boolean): void;
  setChipsEnabled?(on: boolean): void;
  setSubplotCount?(n: NumericInput): void;
  setMovingAverages?(list: MAConfig[]): void;
  setMACDParams?(input: string | Partial<MACDParams> | null): void;
  setIntradayDays?(days: NumericInput): void;
  setViewport?(viewport: Viewport): void;
  setCrosshair?(index: number | null): void;
}

/**
 * 绑定到自定义元素的选项（与 vue.ts 共用；由 tsc 自动生成 .d.ts）
 * @deprecated 仅服务旧 <stock-chart>；请改用 WorkspaceProps 配合 bindWorkspace / createReactWorkspace。
 */
export interface StockChartBinding {
  /** 数据集目录 URL（组件自行 fetch） */
  dataset?: string;
  /** 内存数据集对象（走 setDataset） */
  data?: ChartDataset;
  mode?: ChartMode;
  period?: string;
  chipMode?: ChipMode;
  /** 'light' | 'dark' | 自定义色板对象 */
  theme?: string | Record<string, string>;
  auction?: boolean | 'on' | 'off';
  chips?: boolean | 'on' | 'off';
  subplots?: number;
  movingAverages?: MAConfig[];
  /** MACD 参数：对象或 '12,26,9' 字符串 */
  macd?: Partial<MACDParams> | string;
  /** 分时天数 1–5 */
  intradayDays?: number | string;
  viewport?: { start: number; end: number };
  crosshair?: number | null;
  /** 事件名 → 处理函数；返回的 cleanup 会逐一解绑 */
  on?: Record<string, (ev: Event) => void>;
  [key: string]: unknown;
}

/**
 * 绑定到自定义元素，返回卸载函数（可作 React 19 的 ref cleanup）
 * @deprecated 仅服务旧 <stock-chart>；请改用 bindWorkspace / createWorkspaceRef。
 */
export function bindStockChart(el: ChartHost | null | undefined,
  options: StockChartBinding = {}): (() => void) | undefined {
  if (!el) return undefined;
  const setters: Record<string, (v: unknown) => void> = {
    dataset: (v) => { if (typeof v === 'string') el.setAttribute!('dataset', v); },
    mode: (v) => el.setMode?.(v as ChartMode),
    period: (v) => el.setPeriod?.(v as string),
    chipMode: (v) => el.setChipMode?.(v as ChipMode),
    theme: (v) => el.setTheme?.(v as string | Record<string, string> | null),
    auction: (v) => el.setAuctionEnabled?.(v !== 'off' && v !== false),
    chips: (v) => el.setChipsEnabled?.(v !== 'off' && v !== false),
    subplots: (v) => el.setSubplotCount?.(Number(v)),
    movingAverages: (v) => el.setMovingAverages?.(v as MAConfig[]),
    macd: (v) => el.setMACDParams?.(v as string | Partial<MACDParams> | null),
    intradayDays: (v) => el.setIntradayDays?.(v as NumericInput),
    viewport: (v) => el.setViewport?.(v as Viewport),
    crosshair: (v) => el.setCrosshair?.(v as number | null),
  };
  for (const [key, fn] of Object.entries(setters)) {
    if (options[key] !== undefined) fn(options[key]);
  }
  if (options.data) el.setDataset?.(options.data);

  const offs: Array<() => void> = [];
  for (const [name, handler] of Object.entries(options.on || {})) {
    if (typeof handler !== 'function') continue;
    el.addEventListener(name, handler);
    offs.push(() => el.removeEventListener(name, handler));
  }
  return () => { for (const fn of offs) fn(); };
}

// ---------------------------------------------------------------------------
// 面向 <stock-workspace> 的 React 适配
// ---------------------------------------------------------------------------

/** createWorkspaceRef 的可变状态容器：props 可替换，controller 随挂载/卸载写入 */
export interface WorkspaceRefState {
  props: WorkspaceProps;
  controller: WorkspaceController | undefined;
}

/**
 * 返回 React 19 风格的 ref callback：
 *  - 传入元素时 createWorkspaceController 并返回 cleanup（React 19 ref cleanup 原生支持）；
 *  - 传入 null 时销毁上一次 controller 并返回 undefined（兼容 React ≤18 的 ref(null)）。
 * props 通过可选的 state 容器共享，createReactWorkspace 会在 useEffect 里替换 state.props 做增量更新。
 */
export function createWorkspaceRef(
  props: WorkspaceProps,
  state: WorkspaceRefState = { props, controller: undefined },
): (el: WorkspaceHost | null) => (() => void) | undefined {
  return (el) => {
    if (!el) {
      state.controller?.destroy();
      state.controller = undefined;
      return undefined;
    }
    const controller = createWorkspaceController(el, state.props);
    state.controller = controller;
    if (!controller) return undefined;
    return () => {
      controller.destroy();
      if (state.controller === controller) state.controller = undefined;
    };
  };
}

/** 注入式组件工厂依赖的最小 React 兼容接口（不 import react，可传 React / Preact 等） */
export interface ReactLike {
  createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
  useMemo<T>(factory: () => T, deps: ReadonlyArray<unknown>): T;
}

/**
 * 注入式组件工厂：返回函数组件，内部用 React.createElement('stock-workspace', { ref, ...rest })，
 * 把 data / config / on / onXxx 收进 controller，useEffect 做增量 update，卸载 destroy。
 * SSR 下仅注册 hook 与创建虚拟节点，不访问 document / customElements。
 */
export function createReactWorkspace(
  React: ReactLike,
): (props: WorkspaceProps & Record<string, unknown>) => unknown {
  return function Workspace(props) {
    // 最新 props 同步进可变 ref 容器，使 ref callback 保持稳定、不随 props 重新 attach
    const stateRef = React.useRef<WorkspaceRefState>({ props, controller: undefined });
    stateRef.current.props = props;
    const ref = React.useMemo(() => createWorkspaceRef(props, stateRef.current), []);

    // data / config / on / onXxx 不落到 DOM 属性，交给 controller 处理
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (key === 'data' || key === 'config' || key === 'on') continue;
      if (camelToEventName(key)) continue;
      rest[key] = value;
    }

    React.useEffect(() => {
      stateRef.current.controller?.update(props);
    }, [props]);
    React.useEffect(() => () => {
      stateRef.current.controller?.destroy();
      stateRef.current.controller = undefined;
    }, []);

    return React.createElement('stock-workspace', { ref, ...rest });
  };
}

/** bindWorkspace 的对称别名（与 vue 指令命名对齐） */
export function bindWorkspaceProps(
  el: WorkspaceHost | null | undefined,
  props: WorkspaceProps = {},
): (() => void) | undefined {
  return bindWorkspace(el, props);
}
