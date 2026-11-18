/**
 * Stock Chart Web Components 公共类型（`stock-chart`）。
 *
 * 注册入口：import 模块不产生副作用，需显式调用 defineAll() 才升级自定义标签。
 * 纯计算能力请从 'stock-chart/pure' 引入（无 DOM 依赖）。
 */
export * from './pure.js';
export * from './frameworks/react.js';
export declare const THEMES: Readonly<Record<string, Readonly<Record<string, string>>>>;
export declare const LAYOUT: Readonly<{ rowH: number; barH: number; headH: number; titleH: number; splitH: number }>;
export declare function resolveTheme(theme?: string | Record<string, string> | null): Readonly<Record<string, string>>;
export declare function applyPalette(patch?: Record<string, string>): Record<string, string>;
export declare function resetPalette(): Record<string, string>;
/** 在一帧同步渲染内临时切换全局色板并还原（多实例隔离的内部机制，也可用于自定义渲染） */
export declare function withPalette<T>(palette: Record<string, string> | null, fn: () => T): T;
// 根入口同时导出 React 薄封装（与 src/index.js 的 re-export 对齐）
export { bindStockChart } from './frameworks/react.js';

export type ChartMode = 'candle' | 'intraday';
export type ChipMode = 'stat' | 'histogram';
export type DepthUnit = 'volume' | 'amount';

// ---- 数据契约（与 src/types.js 的 JSDoc typedef 对齐） ----
export interface Bar {
  timestamp: number;
  tradeDate: string;
  open: number; high: number; low: number; close: number;
  preClose: number; volume: number; amount: number;
  turnoverRate: number;
  amplitude?: number; pctChg?: number; change?: number;
  limitState?: '' | 'limitUp' | 'limitDown' | 'limitUpBroken' | 'limitDownBroken';
}
export interface IntradayPoint {
  timestamp: number; time: string;
  price: number; avgPrice: number;
  volume: number; amount: number;
  cumulativeVolume: number; cumulativeAmount: number;
  session: 'morning' | 'afternoon' | 'afterHours';
}
export interface AuctionPoint {
  timestamp: number; time: string;
  phase: 'open' | 'close';
  virtualPrice: number; matchedQty: number; unmatchedQty: number;
  unmatchedSide: 0 | 1 | 2;
  volume: number; amount: number;
}
export interface TradeTick {
  timestamp: number; time: string; seq: number;
  price: number; volume: number; amount: number;
  side: 'B' | 'S' | 'N';
  rawSide: string; sideSource: string;
  granularity: 'tick' | 'merged3s';
  license: 'authorized' | 'public-demo';
  phase: 'auction' | 'continuous' | 'afterHours';
  tradeCount: number;
  ordIds?: string[];
}
export interface ChipStat {
  date: string;
  profitRatio: number;
  avgCost: number;          // 成本分布中位数（50% 分位）
  weightedAvgCost: number;  // 按 150 档占比加权平均
  cost90Low: number; cost90High: number; concentration90: number;
  cost70Low: number; cost70High: number; concentration70: number;
}
export interface ChipHistogram { date: string; ratios: number[]; }
export interface ChipDataset {
  symbol: string;
  adjust: 'none' | 'qfq' | 'hfq';
  algorithm: string;
  bins: number; lookback: number;
  priceGrid: number[];
  dates: string[];
  stats: ChipStat[];
  histograms: ChipHistogram[];
  current: ChipStat;
  currentHistogram: ChipHistogram;
}
export interface Manifest {
  name: string; symbol: string; tradeDate: string;
  close: number; preClose: number; floatShares: number;
  files: Record<string, string>;
  [key: string]: unknown;
}
export interface ChartDataset {
  manifest: Manifest;
  bars: Bar[];
  intraday: IntradayPoint[];
  chips: ChipDataset;
  auction: AuctionPoint[];
  trades: TradeTick[];
  orders: Record<string, unknown>[];
  depth: Record<string, unknown>;
  depthFull: Record<string, unknown> | null;
  depthScenarios: Record<string, Record<string, unknown>> | null;
  [key: string]: unknown;
}

// ---- 组件状态与配置 ----
export interface MAConfig { period: number; color: string; }
export interface SubplotConfig { index: number; indicator: string; height: number; hidden: boolean; }
export interface SubplotLayout { x: number; y: number; w: number; h: number; index: number; indicator: string; }
export interface LayoutHints { auctionWidth: number; chipWidth: number; sideWidth: number; }
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
  orders?: Record<string, unknown>[];
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

// ---- 事件映射 ----
export interface StockChartEventMap extends HTMLElementEventMap {
  'load-start': CustomEvent<{ base: string }>;
  'data-loaded': CustomEvent<{ symbol: string; tradeDate: string }>;
  'dataset-ready': CustomEvent<{ dataset: ChartDataset }>;
  'chart-error': CustomEvent<{ message: string }>;
  'head-change': CustomEvent<HeadChange>;
  'detail-data-change': CustomEvent<DetailData>;
  'depth-scenario-change': CustomEvent<{ key: string; depth: Record<string, unknown> | null; pano: Record<string, unknown> | null }>;
  'depth-unit-change': CustomEvent<{ unit: DepthUnit }>;
  'crosshair-change': CustomEvent<{ index: number; item: unknown; mode: ChartMode }>;
  'viewport-change': CustomEvent<{ start: number; end: number; mode?: ChartMode }>;
  'layout-change': CustomEvent<{ bars: SubplotLayout[] }>;
  'period-change': CustomEvent<{ period: string; label: string; count: number }>;
  'chip-mode-change': CustomEvent<{ mode: ChipMode }>;
  'ma-config-change': CustomEvent<{ list: MAConfig[] }>;
  'subplot-config-change': CustomEvent<{ config: SubplotConfig[] }>;
  'compute-mode-change': CustomEvent<{ mode: string; threads: number; reason: string }>;
  'theme-change': CustomEvent<{ theme: string | null; palette: Record<string, string> }>;
  'auction-toggle': CustomEvent<{ enabled: boolean }>;
  'chips-toggle': CustomEvent<{ enabled: boolean }>;
  'auction-hover': CustomEvent<{ index: number | null; point: AuctionPoint | null }>;
  'closing-hover': CustomEvent<{ index: number | null; point: AuctionPoint | null }>;
  // 以下三个由子组件派发，因 bubbles + composed 冒泡到 <stock-chart> 上
  'depth-levels-change': CustomEvent<{ levels: number }>;
  'view-panorama': CustomEvent<Record<string, never>>;
  'tape-scroll': CustomEvent<{ top: number }>;
  'webglcontext-lost': Event;
  'webglcontext-restored': Event;
}

/** updateSide() 接收的右侧栏几何 */
export interface SideRect {
  x: number; y: number; w: number; h: number;
  content: 'depth' | 'chips';
}

// ---- 根容器 ----
export declare class StockChart extends HTMLElement {
  /** 切换主题；可传预设名（light / dark）或自定义色板对象 */
  setTheme(theme: string | Record<string, string> | null): Record<string, string>;
  getTheme(): { theme: string | null; palette: Record<string, string> };
  setDataset(dataset: ChartDataset): void;
  getDataset(): ChartDataset | null;
  getState(): StockChartState;
  setDetailData(data: Partial<DetailData>): void;
  setDepthScenario(key: string): void;
  setDepthUnit(unit: DepthUnit): void;
  setCrosshair(index: number | null): void;
  setPointer(x: number, y: number): void;
  setAuctionHover(index: number | null): void;
  setClosingHover(index: number | null): void;
  attachDetailCard(card: HTMLElement): void;
  detachDetailCard(card: HTMLElement, home: HTMLElement): void;
  attachCover(el: HTMLElement): void;
  getLayoutHints(): LayoutHints;
  /** 侧栏展开成交明细：盘口收缩为卖1/买1 */
  setSideExpanded(on: boolean): void;
  /** 由 ChartContext.applyLayout() 回调，定位右侧 DOM 侧栏 */
  updateSide(rect: SideRect | null): void;
  /** 按侧栏高度重算 4 条标题/表头行的均分与买卖间隙；主题/档数/展开态变化时自动调用 */
  syncSideBars(): void;
  /** 主题切换后刷新由组件默认分配颜色的均线项 */
  refreshDefaultMAColors(palette: Record<string, string>): void;
  /** 当前主题名（'light' | 'dark' | 'custom' | 'dataset' | null） */
  theme: string | null;
  setMode(mode: ChartMode): void;
  setPeriod(period: string): void;
  getPeriod(): string;
  setChipMode(mode: ChipMode): void;
  setAuctionEnabled(on: boolean): void;
  setChipsEnabled(on: boolean): void;
  setSubplotCount(n: number): void;
  getSubplotConfig(): SubplotConfig[];
  getSubplotLayout(): SubplotLayout[];
  setSubplotIndicator(index: number, name: string): unknown;
  getMovingAverages(): MAConfig[];
  setMovingAverages(list: MAConfig[]): MAConfig[];
  addMovingAverage(cfg: Partial<MAConfig>): MAConfig[];
  removeMovingAverage(period: number): MAConfig[];
  updateMovingAverage(period: number, patch: Partial<MAConfig>): MAConfig[];
  setViewport(viewport: { start: number; end: number }): void;
  getComputeMode(): 'js' | 'none';
  /** @deprecated 返回内部可变 ChartContext，仅为兼容保留，不属于稳定对外契约 */
  getContext(): unknown;
  destroy(): void;
  addEventListener<K extends keyof StockChartEventMap>(
    type: K, listener: (this: StockChart, ev: StockChartEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof StockChartEventMap>(
    type: K, listener: (this: StockChart, ev: StockChartEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions): void;
}

// ---- 配置型 pane / 侧栏组件 ----
/** overlayText 的实际条目：ChartContext.renderOverlay 按 x/y/text/color 渲染 */
export interface OverlayTextItem {
  x: number; y: number; text: string;
  color?: string; bg?: string; align?: string; bar?: boolean;
}
/** 内部基类形状（src/elements/pane-base.js 的 PaneElement 未从入口导出，故此处不导出） */
declare class PaneElementShape extends HTMLElement {
  connect(ctx: unknown): void;
  rect: SubplotLayout | null;
  overlayText(): OverlayTextItem[];
}
export declare class PricePane extends PaneElementShape {}
export declare class IndicatorPane extends PaneElementShape {}
export declare class ChipPane extends PaneElementShape {}
/** <auction-pane> 是纯配置节点（只提供 ratio 属性），不注册绘制 pane、不产生几何 */
export declare class AuctionPane extends HTMLElement {
  ratio?: string;
}

export interface TradeTapeViewConfig {
  heads?: string[];
  labelKey?: string;
  cols?: string;
  colCls?: string[];
  extraKey?: string | null;
}
export interface TradeTapeMetrics { headH: number; viewH: number; }
export declare class TradeTape extends HTMLElement {
  /** order="desc" 时按时间倒序显示，内部仍保留原始序 */
  setData(rows: TradeTick[] | Record<string, unknown>[]): void;
  /** 覆盖视图专用：关闭自身滚动、只替换窗口数据 */
  setWindow(rows: TradeTick[] | Record<string, unknown>[]): void;
  setViewConfig(config: TradeTapeViewConfig): void;
  setActiveTime(time: string | null): void;
  setScrollTop(top: number): void;
  scrollPosition(): number;
  visibleRows(): number;
  /** 返回基准 barH 与整行对齐后的视口高度参考值（实际 DOM 高度由 CSS calc 决定） */
  layoutMetrics(hostH: number): TradeTapeMetrics;
  paint(): void;
  renderShell(): void;
  headHtml(): string;
}
export declare class DepthBook extends HTMLElement {
  setData(depth: Record<string, unknown>[]): void;
  setUnit(unit: DepthUnit): void;
  setLevels(n: number): void;
  /** 侧栏展开时只保留卖1/买1 */
  setCompact(on: boolean): void;
}

export declare const SUBPLOT_INDICATORS: readonly ('VOL' | 'AMOUNT' | 'MACD' | 'KDJ' | 'VOL_RATIO')[];
export declare const PALETTE: Readonly<Record<string, string>>;
export declare const ELEMENT_TAGS: readonly string[];
/** @param registry 可注入自定义 CustomElementRegistry 便于测试隔离 */
export declare function defineAll(registry?: CustomElementRegistry): string[];

// ---- JSX / 框架薄封装属性（不依赖 react / vue 运行时类型） ----
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
  symbol?: string;
  auction?: 'on' | 'off';
  chips?: 'on' | 'off';
  height?: string | number;
}

declare global {
  interface HTMLElementTagNameMap {
    'stock-chart': StockChart;
    'price-pane': PricePane;
    'indicator-pane': IndicatorPane;
    'chip-pane': ChipPane;
    'auction-pane': AuctionPane;
    'trade-tape': TradeTape;
    'depth-book': DepthBook;
  }
  /** 全局 JSX 标签声明：TSX / Preact / Solid 等可直接使用自定义元素 */
  namespace JSX {
    interface IntrinsicElements {
      'stock-chart': StockChartJSXAttributes;
      'price-pane': CustomElementAttributes & { height?: string | number };
      'indicator-pane': CustomElementAttributes & { indicator?: string; height?: string | number };
      'chip-pane': CustomElementAttributes & { mode?: ChipMode; width?: string | number; dock?: string };
      'auction-pane': CustomElementAttributes & { width?: string | number };
      'trade-tape': CustomElementAttributes & { 'page-size'?: string | number; order?: 'asc' | 'desc' };
      'depth-book': CustomElementAttributes & { width?: string | number; slot?: string };
      'ma-line': CustomElementAttributes & { period?: string | number; color?: string };
    }
  }
}
