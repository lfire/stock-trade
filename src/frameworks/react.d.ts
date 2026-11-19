import type { ChartDataset, ChartMode, ChipMode, MAConfig, MACDParams } from '../index.js';

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
}

/** 绑定到自定义元素，返回卸载函数（可作 React 19 的 ref cleanup） */
export declare function bindStockChart(
  el: HTMLElement | null | undefined,
  options?: StockChartBinding,
): (() => void) | undefined;
