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
 */
import type {
  ChartDataset, ChartMode, ChipMode, MAConfig, MACDParams, NumericInput, Viewport,
} from '../types';

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

/** 绑定到自定义元素的选项（与 vue.ts 共用；由 tsc 自动生成 .d.ts） */
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

/** 绑定到自定义元素，返回卸载函数（可作 React 19 的 ref cleanup） */
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
