/**
 * 对外数据契约、共享类型与色板的单一真源。
 * 原先分散在 JSDoc typedef 与手写 .d.ts 里；切换 TS 后由 tsc 从本文件自动生成 dist/types.d.ts。
 * 与 docs/01 §6、docs/02 §6、docs/03 §4 保持一致。
 */

// ---------------------------------------------------------------- 基础枚举
export type ChartMode = 'candle' | 'intraday';
export type ChipMode = 'stat' | 'histogram';
export type DepthUnit = 'volume' | 'amount';
export type Side = 'B' | 'S' | 'N';
export type Granularity = 'tick' | 'merged3s';
export type LimitState = '' | 'limitUp' | 'limitDown' | 'limitUpBroken' | 'limitDownBroken';
export type Adjust = 'none' | 'qfq' | 'hfq';
export type DataAvailability = 'public-eod' | 'vendor-minute' | 'partly-unavailable'
  | 'estimated-model' | 'l1-intraday-only' | 'level2-licensed';

// ---------------------------------------------------------------- 数据契约
/** 一根 K 线。价格单位元，volume 单位股，amount 单位元。 */
export interface Bar {
  timestamp: number;
  tradeDate: string;
  open: number; high: number; low: number; close: number;
  preClose: number; volume: number; amount: number;
  turnoverRate: number;
  amplitude?: number; pctChg?: number; change?: number;
  limitState?: LimitState;
  /** 仅 4 根拟真注入的涨跌停形态带此标记，与真实 K 线可区分 */
  source?: 'injected-demo';
}

/** 一个分时点。volume/amount 为该分钟增量；均价 = 累计额 / 累计量。 */
export interface IntradayPoint {
  timestamp: number;
  time: string;
  /** 所属交易日 YYYY-MM-DD；多日分时按此分日（单日可省略，回退 manifest.tradeDate） */
  tradeDate?: string;
  /** 真实分时 / 由日 K OHLC 拟真生成（多日前几日） */
  source?: 'real-intraday' | 'simulated-from-daily-ohlc';
  price: number; avgPrice: number;
  volume: number; amount: number;
  cumulativeVolume: number; cumulativeAmount: number;
  session: 'morning' | 'afternoon' | 'afterHours';
}

/** 集合竞价点（9 秒节点）。竞价期间「价有量无」，仅 9:25 / 15:00 末点锚定真实成交。 */
export interface AuctionPoint {
  timestamp: number;
  time: string;
  phase: 'open' | 'close';
  virtualPrice: number; matchedQty: number; unmatchedQty: number;
  unmatchedSide: 0 | 1 | 2;
  volume: number; amount: number;
  /** 9:15–9:24 虚拟撮合量绝大多数平台不留存历史，属示意数据 */
  source?: 'illustrative' | 'anchored-real';
  /** 撮合口径，如 SSE-3.5.2-max-volume */
  priceBasis?: string;
}

/** 逐笔明细 / 合并分笔。真实逐笔明细属 Level-2 增值行情，需交易所展示/非展示许可。 */
export interface TradeTick {
  timestamp: number; time: string; seq: number;
  price: number; volume: number; amount: number;
  side: Side;
  rawSide: string; sideSource: string;
  source?: string;
  requiresAuthorization?: boolean;
  granularity: Granularity;
  license: 'authorized' | 'public-demo';
  phase: 'auction' | 'continuous' | 'afterHours';
  tradeCount: number;
  ordIds?: string[];
}

/** 筹码峰单日 9 项统计。 */
export interface ChipStat {
  date: string;
  profitRatio: number;
  avgCost: number;
  weightedAvgCost: number;
  cost90Low: number; cost90High: number; concentration90: number;
  cost70Low: number; cost70High: number; concentration70: number;
}
export interface ChipHistogram { date: string; ratios: number[]; }

/** 筹码分布是软件估算模型，不是交易所发布的持仓数据；数值不可跨平台直接比较。 */
export interface ChipDataset {
  symbol: string;
  adjust: Adjust;
  algorithm: string;
  source?: string;
  estimated?: boolean;
  shape?: 'triangular' | 'uniform';
  peakSource?: 'vwap' | 'four-price-average';
  decay?: number;
  concentrationBasis?: string;
  bins: number; lookback: number;
  priceGrid: number[];
  dates: string[];
  stats: ChipStat[];
  histograms: ChipHistogram[];
  current: ChipStat;
  currentHistogram: ChipHistogram;
}

export interface DepthLevel { price: number; volume: number; orderCount: number; }
export interface DepthSnapshot {
  timestamp: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  phaseCode: string;
  source?: string;
  license?: string;
  requiresAuthorization?: boolean;
  [key: string]: unknown;
}

export interface Manifest {
  name: string; symbol: string; tradeDate: string;
  close: number; preClose: number; floatShares: number;
  tradeDates?: string[];
  preCloseByDate?: Record<string, number>;
  /** 按代码/名称识别的涨跌幅比例（主板 0.1 / 创业科创 0.2 / ST 主板 0.05 / 北交所 0.3） */
  limitRate?: number;
  adjust?: Adjust;
  session?: Array<{ open: string; close: string }>;
  afterHours?: { open: string; close: string };
  source?: string;
  provenance?: Record<string, { availability: DataAvailability; source: string; licensed: boolean }>;
  generatedAt?: string;
  floatSharesSource?: string;
  l2?: { providers: Array<Record<string, unknown>> };
  /** 演示形态：按 tradeDate 在内存副本上叠加 limitState（四态配色），落盘 bars 保持东财原生 */
  demoPatterns?: Array<{ tradeDate: string; state: LimitState }>;
  /** 逐数据集字段单位（如 bars.volume = 'share'、intraday.timestamp = 'UTC ms'） */
  units?: Record<string, Record<string, string>>;
  files: Record<string, string>;
  [key: string]: unknown;
}

export interface ChartDataset {
  manifest: Manifest;
  bars: Bar[];
  intraday: IntradayPoint[];
  /** 以下均为运行时派生字段；按 modules/preset 按需装载时允许缺省 */
  intradayMulti?: IntradayPoint[];
  chips?: ChipDataset | ChipDataset[];
  auction?: AuctionPoint[];
  trades?: TradeTick[];
  orders?: Array<Record<string, unknown> & { source?: string; license?: string; requiresAuthorization?: boolean }>;
  depth?: Array<Record<string, unknown>> | Record<string, unknown>;
  depthFull?: Record<string, unknown> | null;
  depthScenarios?: Record<string, Record<string, unknown>> | null;
  [key: string]: unknown;
}

/** 副图输出契约：新增副图不需要改主图数据链路。 */
export interface PaneSeries {
  paneId: string;
  name: string;
  type: 'bar' | 'line' | 'histogram' | 'horizontalBar';
  series: Array<{ time: number; value: number | number[] }>;
}

// ---------------------------------------------------------------- 组件状态与配置
export interface MAConfig { period: number; color: string; }
export interface MACDParams { fast: number; slow: number; signal: number; }
/** height 取自 DOM 属性，运行时为字符串（或空串），不是 number */
export interface SubplotConfig { index: number; indicator: string; height: string; hidden: boolean; }
export interface SubplotLayout { x: number; y: number; w: number; h: number; index: number; indicator: string; }
export interface LayoutHints { auctionWidth: number; chipWidth: number; sideWidth: number; }
export interface SideRect {
  x: number; y: number; w: number; h: number;
  content: 'depth' | 'chips';
}
export interface StockChartState {
  mode: ChartMode | null;
  period: string | null;
  chipMode: ChipMode | null;
  crosshair: number | null;
  viewport: { start: number; end: number } | null;
  datasetReady: boolean;
  pano: Record<string, unknown> | null;
  depthScenario: string;
  depthUnit: DepthUnit;
}
export interface DetailData {
  trades?: TradeTick[];
  orders?: Array<Record<string, unknown>>;
  depth?: Record<string, unknown>;
  depthFull?: Record<string, unknown> | null;
  depthScenarios?: Record<string, Record<string, unknown>> | null;
  manifest?: Manifest;
}
export interface HeadMetric { label: string; value: string; }
export interface HeadChange {
  name: string; symbol: string; modeLabel: string; datetime: string;
  quote: { price: string; change: number; pct: number; up: boolean };
  maValues: Array<{ label: string; value: string; color: string }>;
  legend: Array<{ text: string; color: string }>;
  metrics: HeadMetric[];
  note: string; active: boolean;
}
export interface OverlayTextItem {
  x: number; y: number; text: string;
  color?: string; bg?: string; align?: string; bar?: boolean;
}
export interface TradeTapeViewConfig {
  heads?: string[];
  labelKey?: string;
  cols?: string;
  colCls?: string[];
  extraKey?: string | null;
}
export interface TradeTapeMetrics { headH: number; viewH: number; }

// ---------------------------------------------------------------- 内部运行时契约
// 以下均为纯类型（编译后完全擦除），供 core / elements 标注内部状态时使用，不改变任何 JS 产物。
export interface Rect { x: number; y: number; w: number; h: number; }
export interface PriceScale {
  min: number; max: number;
  pre?: number; dev?: number; symmetrical?: boolean;
}
export interface Viewport { start: number; end: number; }
export interface Pointer { x: number; y: number; }
/** URL 参数与 HTML 属性常把数字传成字符串，公开 setter 需接受两者 */
export type NumericInput = number | string;

/** 委托流记录（orders 数据集 / 挂单视图共用） */
export interface OrderRecord {
  ordId: string;
  time: string;
  price: number;
  volume: number;
  side: string;
  action: 'NEW' | 'FILL' | 'CANCEL';
  level?: number;
  phase?: string;
  tag?: string;
  /** 运行时派生：买 1 / 卖 -1 / 撤单 0（数值，非字符串） */
  trend?: number;
  /** 关联原委托号；NEW 事件为 null */
  origOrdId?: string | null;
  origVolume?: number;
  remainVolume?: number;
  /** 成交编号；仅 FILL 事件非空，其余为 null */
  tradeId?: string | null;
  snapshot?: boolean;
  /** 撤销的原委托号；仅 CANCEL 事件非空，其余为 null */
  cancelOf?: string | null;
  [key: string]: unknown;
}

/** 盘口快照（十档 / 全景盘口） */
export interface DepthBookSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  timestamp?: number;
  phaseCode?: string;
  preClose?: number;
  [key: string]: unknown;
}

/** 指标序列的单个值：标量或带 time/value/up 等字段的点对象 */
export type IndicatorSeriesValue = number | null | number[] | Record<string, unknown>;
/** 指标计算输出（computeIndicator 的返回结构） */
export interface ComputeResult {
  type: 'line' | 'bar' | 'histogram' | 'horizontalBar' | 'macd' | 'multi-line' | string;
  values: IndicatorSeriesValue[];
  [key: string]: unknown;
}

/** 配置型 pane 的公共形状；buildGeometry / overlayText 由各 pane 可选实现 */
export interface PaneElementLike extends HTMLElement {
  rect: SubplotLayout | null;
  ctx?: unknown;
  connect(ctx: unknown): void;
  buildGeometry?(ctx: unknown): number[];
  overlayText?(ctx?: unknown): OverlayTextItem[];
}

/** 一帧的 pane 几何批次 */
export interface PaneGeometryBatch {
  rect: SubplotLayout | null;
  vertices: number[];
}

/** WebGL 顶点/绘图批次（gl/geometry 与 core 之间） */
export interface GeometryBuffer {
  vertices: number[];
  colors?: number[];
  [key: string]: unknown;
}

/** getContext() 返回的只读门面（冻结对象），不暴露可变的 ChartContext。 */
export interface ChartContextFacade {
  readonly mode: ChartMode;
  readonly period: string;
  readonly viewport: { start: number; end: number };
  readonly priceScale: { min: number; max: number; pre?: number; dev?: number; symmetrical?: boolean };
  readonly palette: Record<string, string>;
  readonly isMultiDay: boolean;
  readonly intradayDays: number;
  readonly auctionEnabled: boolean;
  readonly chipsEnabled: boolean;
  readonly dataset: ChartDataset | null;
  getSeries(): unknown[];
  getBars(): Bar[];
  getVisible(): unknown[];
  getSubplotConfig(): SubplotConfig[];
  getSubplotLayout(): SubplotLayout[];
  getMACDParams(): MACDParams;
  getIntradayDays(): number;
  halfHourMarks(rect: { x: number; y: number; w: number; h: number }): Array<{
    x: number; time: string; tradeDate: string; dayStart: boolean;
  }>;
}

/** 事件映射（与 src/events.ts 的 CHART_EVENTS 常量表一一对应） */
export interface StockChartEventMap extends HTMLElementEventMap {
  'load-start': CustomEvent<{ base: string }>;
  'data-loaded': CustomEvent<{ symbol?: string; tradeDate?: string }>;
  'dataset-ready': CustomEvent<{ dataset: ChartDataset }>;
  'chart-error': CustomEvent<{ message: string }>;
  'head-change': CustomEvent<HeadChange>;
  'detail-data-change': CustomEvent<DetailData>;
  'depth-scenario-change': CustomEvent<{
    key: string; depth: Record<string, unknown> | null; pano: Record<string, unknown> | null;
  }>;
  'depth-unit-change': CustomEvent<{ unit: DepthUnit }>;
  /** 子组件请求改单位；由 <stock-chart> 统一转成 depth-unit-change，避免双派发 */
  'depth-unit-request': CustomEvent<{ unit: DepthUnit }>;
  'crosshair-change': CustomEvent<{ index: number | null; item: unknown | null; mode: ChartMode }>;
  'viewport-change': CustomEvent<{ start: number; end: number; mode?: ChartMode }>;
  'layout-change': CustomEvent<{ bars: SubplotLayout[] }>;
  'period-change': CustomEvent<{ period: string; label: string; count: number }>;
  'chip-mode-change': CustomEvent<{ mode: ChipMode }>;
  'ma-config-change': CustomEvent<{ list: MAConfig[] }>;
  'macd-params-change': CustomEvent<{ params: MACDParams }>;
  'intraday-days-change': CustomEvent<{
    days: number; multiDay: boolean; dates: string[]; simulatedDays?: number;
  }>;
  'subplot-config-change': CustomEvent<{ config: SubplotConfig[] }>;
  'compute-mode-change': CustomEvent<{ mode: 'js' | 'wasm' | string; threads: number; reason: string }>;
  'theme-change': CustomEvent<{ theme: string | null; palette: Record<string, string> }>;
  'auction-toggle': CustomEvent<{ enabled: boolean }>;
  'chips-toggle': CustomEvent<{ enabled: boolean }>;
  'auction-hover': CustomEvent<{ index: number | null; point: AuctionPoint | null }>;
  'closing-hover': CustomEvent<{ index: number | null; point: AuctionPoint | null }>;
  'depth-levels-change': CustomEvent<{ levels: number }>;
  'view-panorama': CustomEvent<Record<string, never> | null>;
  'tape-scroll': CustomEvent<{ top: number }>;
  /** renderer.ts 经 emitEvent 派发的是 CustomEvent（detail 为空对象），与原生 Event 不同 */
  'webglcontext-lost': CustomEvent<Record<string, never>>;
  'webglcontext-restored': CustomEvent<Record<string, never>>;
}

/** JSX / 框架薄封装属性（不依赖 react / vue 运行时类型） */
export interface CustomElementAttributes {
  key?: string | number;
  ref?: unknown;
  id?: string;
  class?: string;
  className?: string;
  style?: string | Record<string, string | number>;
  slot?: string;
  children?: unknown;
  hidden?: boolean;
  [key: string]: unknown;
}
export interface StockChartJSXAttributes extends CustomElementAttributes {
  dataset?: string;
  mode?: ChartMode;
  theme?: string;
  auction?: 'on' | 'off';
  chips?: 'on' | 'off';
  period?: string;
  'chip-mode'?: ChipMode;
  macd?: string;
  'intraday-days'?: string | number;
}

// ---------------------------------------------------------------- 运行时常量与色板
/** 计算引擎抽象：组件层只依赖 indicator(name, bars, params) 与 mode。 */
export abstract class ComputeEngineInterface {
  mode?: string;
  abstract indicator(name: string, bars: Bar[], params: Record<string, unknown>): unknown;
}

/** 左右坐标轴专用留白宽度：数据只画在中间绘图区，刻度放在留白里 */
export const AXIS_GUTTER_L = 54;
export const AXIS_GUTTER_R = 54;

/** 右侧栏统一行高真源（px），盘口 / 明细 / 覆盖视图全部引用 */
export const LAYOUT = Object.freeze({
  rowH: 18, barH: 24, headH: 24, titleH: 24, splitH: 5,
});

const DEFAULT_PALETTE = Object.freeze({
  background: '#FFFFFF',
  panel: '#F7F8FA',
  band: '#F2F3F5',
  grid: '#ECEEF1',
  text: '#1F2329',
  textMuted: '#6B7280',
  up: '#E24B4A',
  down: '#1D9E75',
  limitUp: '#C62828',
  limitDown: '#087A55',
  limitUpBroken: '#F08C24',
  limitDownBroken: '#7C5CDB',
  avg: '#F0A020',
  crosshair: '#8A94A6',
  chipProfit: '#F5A623',
  chipLoss: '#4A90D9',
  neutral: '#9AA3AF',
  link: '#1B5FBF',
});

export type PaletteKey = keyof typeof DEFAULT_PALETTE;
export type Palette = Record<PaletteKey, string>;
type PaletteInput = Partial<Record<PaletteKey, string>> & Record<string, string>;
const isPaletteKey = (key: string): key is PaletteKey => key in DEFAULT_PALETTE;

/**
 * 当前色板。刻意保持同一个对象引用：渲染层全部以 PALETTE.xxx 读取，
 * applyPalette() 就地覆盖属性即可全局换肤；帧级 withPalette 负责多实例隔离。
 */
export const PALETTE: Palette = { ...DEFAULT_PALETTE };

/** 内置主题预设；light / dark 均为完整 18 键色板 */
export const THEMES: Readonly<Record<string, Readonly<Palette>>> = Object.freeze({
  light: DEFAULT_PALETTE,
  dark: Object.freeze({
    ...DEFAULT_PALETTE,
    background: '#14181E', panel: '#1C222B', band: '#191F27', grid: '#2A323D',
    text: '#E6EAF0', textMuted: '#95A0B0',
    up: '#F26A66', down: '#35BE93',
    limitUp: '#FF6B6B', limitDown: '#1FAE7C',
    limitUpBroken: '#F5A94A', limitDownBroken: '#9C86EC',
    crosshair: '#7C8798', neutral: '#8A94A3', link: '#7FB0FF',
    // 暗色专属：均价线 / 筹码盈 / 筹码亏，不再继承 light 的浅色值
    avg: '#F0B429', chipProfit: '#F5B942', chipLoss: '#6BA6E8',
  }),
});

/** 内置主题名（顺序稳定，供主题切换 UI 与运行时守卫复用）。 */
export const THEME_NAMES = Object.freeze(['light', 'dark'] as const);
export type ThemeName = (typeof THEME_NAMES)[number];

/** 运行时守卫：判断任意值是否为内置主题名。 */
export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === 'string' && (THEME_NAMES as readonly string[]).includes(v);
}

export function resolveTheme(theme?: string | Record<string, string> | null): Readonly<Palette> {
  if (!theme) return DEFAULT_PALETTE;
  if (typeof theme === 'string') return THEMES[theme] || DEFAULT_PALETTE;
  if (typeof theme === 'object') return { ...DEFAULT_PALETTE, ...theme };
  return DEFAULT_PALETTE;
}

/** 纯函数：由主题补丁生成一份新色板，不改动全局 PALETTE。 */
export function createPalette(patch: PaletteInput = {}, base: Readonly<Palette> = DEFAULT_PALETTE): Palette {
  const out: Palette = { ...base };
  for (const k of Object.keys(patch || {})) {
    if (isPaletteKey(k) && typeof patch[k] === 'string') out[k] = patch[k];
  }
  return out;
}

/** @deprecated 会就地改动全局 PALETTE；新代码请用 createPalette() 或实例色板 */
export function applyPalette(patch: PaletteInput = {}): Palette {
  for (const k of Object.keys(patch)) {
    if (isPaletteKey(k) && typeof patch[k] === 'string') PALETTE[k] = patch[k];
  }
  return { ...PALETTE };
}

/** @deprecated 见 applyPalette；仅用于恢复全局色板 */
export function resetPalette(): Palette { return applyPalette(DEFAULT_PALETTE); }

/** 在一帧同步渲染内把全局色板临时切到某个实例色板，结束后还原。 */
export function withPalette<T>(palette: Palette | null, fn: () => T): T {
  const saved: Palette = { ...PALETTE };
  applyPalette(palette || {});
  try { return fn(); } finally { applyPalette(saved); }
}
