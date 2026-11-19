/**
 * 纯函数层类型声明（`stock-chart/pure`）。
 * 不含任何 DOM / customElements 引用，可在 Node 或 Worker 中直接使用。
 */

/** WebGL 顶点数组：x, y, r, g, b, a 交错排列 */
export type VertexArray = number[];
/** 归一化颜色 [r, g, b, a]，各分量 0~1 */
export type Color = readonly [number, number, number, number];
export type Point2 = readonly [number, number];
export type ScaleFn = (value: number) => number;

/** 指标计算所需的最小 K 线形状 */
export interface BarLike {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  [key: string]: unknown;
}

export interface IndicatorPoint {
  time: number;
  value?: number | null;
  up?: boolean;
  macd?: number;
  dif?: number;
  dea?: number;
  k?: number;
  d?: number;
  j?: number;
}
export interface IndicatorResult {
  type: string;
  values: IndicatorPoint[];
}
export interface MACDParams { fast: number; slow: number; signal: number; }
export interface PeriodDef { key: string; label: string; [key: string]: unknown; }

// ---- gl/geometry ----
export function rgba(hex: string, alpha?: number): Color;
export function rect(out: VertexArray, x0: number, y0: number, x1: number, y1: number, c: Color): void;
export function line(out: VertexArray, x0: number, y0: number, x1: number, y1: number, width: number, c: Color): void;
export function polyline(out: VertexArray, pts: readonly Point2[], width: number, c: Color): void;
export function candle(out: VertexArray, x: number, yOpen: number, yClose: number,
  yHigh: number, yLow: number, barWidth: number, c: Color): void;
export function hbar(out: VertexArray, x0: number, y: number, width: number, height: number, c: Color): void;
export function dashedH(out: VertexArray, x0: number, x1: number, y: number,
  width: number, c: Color, seg?: number, gap?: number): void;
export function background(out: VertexArray, w: number, h: number, rows?: number): void;
export function makeScale(min: number, max: number, top: number, bottom: number, pad?: number): ScaleFn;

// ---- compute/indicators ----
export function sma(values: readonly number[], n: number): Array<number | null>;
export function ema(values: readonly number[], n: number): Array<number | null>;
export function ma(bars: readonly BarLike[], n?: number, field?: string): Array<number | null>;
/** EMA 采用通达信口径：前 N 个值取简单平均作首个 EMA，前 N−1 根为 null */
export function macd(bars: readonly BarLike[], params?: Partial<MACDParams>): Array<{
  time: number; dif: number | null; dea: number | null; macd: number | null;
}>;
export function kdj(bars: readonly BarLike[], n?: number): IndicatorPoint[];
/** 日线量比：当日成交量 ÷ 前 N 日平均日成交量（不是行情软件的分时量比） */
export function volumeRatio(bars: readonly BarLike[], n?: number): IndicatorPoint[];
/** A 股截至某时刻的累计开市分钟（扣 11:30–13:00 午休，全天 240 分钟） */
export function elapsedMarketMinutes(time: string): number;
/** 分时量比：(当日累计量 / 累计开市分钟) ÷ (前 5 日平均日量 / 240) */
export function intradayVolumeRatio(points: readonly Record<string, unknown>[],
  avg5DailyVolume: number, atTime?: string): number;
export function intradayVolumeRatioSeries(points: readonly Record<string, unknown>[],
  avg5DailyVolume: number): Array<{ time: string; value: number }>;
export function computeIndicator(name: string, bars: readonly BarLike[],
  params?: Record<string, unknown>): IndicatorResult;

// ---- core/bar-aggregator ----
/** K 线默认周期键：'1d'（日 K） */
export const DEFAULT_PERIOD: string;
export const PERIODS: readonly PeriodDef[];
export const PERIOD_LABEL: Readonly<Record<string, string>>;
export function periodMeta(key: string): PeriodDef;
export function aggregateDaily(bars: readonly BarLike[], period: string): BarLike[];
/** 分时点所属分钟 K 桶（上午 / 下午各自切分，收盘点归入该时段最后一根） */
export function intradayBucket(time: string, size: number): string;
export function aggregateIntraday(series: readonly Record<string, unknown>[],
  size: number, manifest: Record<string, unknown>): BarLike[];
export function buildBars(dataset: Record<string, unknown>, period: string): BarLike[];

// ---- core/indicator-params ----
export function adaptiveMAPeriods(periods: readonly number[], count: number): number[];
/** MACD 固定默认 (12,26,9)：不再随 K 线根数自适应 */
export const DEFAULT_MACD_PARAMS: Readonly<MACDParams>;
/** 合并并校验 MACD 配置，非法值回退默认 */
export function resolveMACDParams(config?: Partial<MACDParams>): MACDParams;
/** 解析 '12,26,9' / '12 26 9' 或对象；非法输入回退默认 */
export function parseMACDParams(input: string | Partial<MACDParams> | null | undefined): MACDParams;
/** 兼容旧调用：count 不再参与计算，config 可覆盖固定默认值 */
export function adaptiveMACDParams(count: number, config?: Partial<MACDParams>): MACDParams;
export function maParamsText(periods: readonly number[]): string;
export function macdParamsText(p: MACDParams): string;
