/**
 * Workspace 组件的标准数据契约。
 *
 * 原则：组件只接受**结构化对象**（data / config），不读取路径、不 fetch、不解析 URL；
 * 输出只有 CustomEvent。页面的职责收敛为「加载数据 → 赋值 → 订阅事件」。
 */
import type { ChartDataset, ChartMode, ChipMode, DepthUnit, MAConfig, MACDParams, DetailData } from '../types';
import type { WorkspacePreset } from './module-catalog';

/** 详情画布的数据集选择 */
export type DetailSet = 'trades' | 'orders' | 'panorama' | 'intraday';

/** 明细卡片停放位置 */
export type TapePlacement = 'side' | 'detail';

/**
 * Workspace 配置对象：所有原 URL 参数与控件状态统一收敛于此。
 * 赋值为**增量合并**（`workspace.config = { mode: 'candle' }` 只改 mode）。
 *
 * 模块化装载：modules / preset 控制启用哪些功能域模块。
 * **未配置时全量装载**（向后兼容）；modules 与 preset 同时给出时，
 * **显式 modules 优先于 preset**（空 modules 数组仍按全量处理）。
 */
export interface WorkspaceConfig {
  /**
   * 显式启用的模块 id 清单（见 module-catalog.ts 的 MODULE_CATALOG）。
   * 优先于 preset；缺省 / 空数组 = 全量装载。依赖会被自动补齐。
   */
  modules?: string[];
  /**
   * 预设档位（'full' | 'intraday' | 'candle' | 'candle-full' | 'minimal'）。
   * 仅在 modules 未提供时生效，默认 'full'；candle 为真按需 K 线，candle-full 追加历史分时。
   */
  preset?: WorkspacePreset;
  /**
   * 主题为组件内部实现，仅通过此配置属性切换：'light' / 'dark' / 自定义色板对象 / null（→ light）。
   * 字符串来源（URL 参数、HTML 属性等）由组件内部归一，未知值回退 light；
   * `string & {}` 兼容这类运行期字符串来源，同时保留 'light' / 'dark' 的字面量提示。
   */
  theme: 'light' | 'dark' | Record<string, string> | null | (string & {});
  mode: ChartMode;
  period: string;
  chipMode: ChipMode;
  intradayDays: number;
  subplotCount: number;
  subplotIndicators: string[];
  movingAverages: MAConfig[];
  macd: string | MACDParams;
  auctionEnabled: boolean;
  chipsEnabled: boolean;
  depthScenario: string;
  depthUnit: DepthUnit;
  depthLevels: number;
  tapePlacement: TapePlacement;
  tapeZoom: number;
  tapeSet: DetailSet;
  tapeScroll: number;
  /** 选中的历史交易日（日 K 查看历史分时）；null = 未选中；由 applyConfig 经 setHistoricalIntradayDate 下发主 #chart */
  historicalIntradayDate: string | null;
  /**
   * 历史分时视图内的竞价列开关（与主图 auctionEnabled 独立）。
   * 消费路径：detail lifecycle → syncAll 读 config 快照 → applyHistoricalViewState 作用于覆盖视图 mini / DOM class；
   * 不经 ChartApi（mini 是独立实例，不在主 #chart 的公开方法链）。
   */
  historicalAuctionEnabled: boolean;
  /**
   * 历史分时视图内逐笔明细侧栏的展开态。
   * 消费路径同 historicalAuctionEnabled：detail → syncAll → applyHistoricalViewState，不经 ChartApi。
   */
  historicalTapeExpanded: boolean;
  /**
   * 逐笔明细的展示模式：'list' 普通明细（时间 / 价格 / 成交量 / 方向）；
   * 'match' 买单 / 卖单视图（连续成交同一委托合并为跨行框，显示合计手数与金额，大单标「大」）。
   * 作用于覆盖视图的「逐笔明细」与历史分时展开态多栏。
   */
  tradeView: 'list' | 'match';
  /** 买单 / 卖单视图的大单金额阈值（元），默认 20 万（东方财富资金流「大单」下限） */
  bigOrderAmount: number;
  maPanelOpen: boolean;
  crosshair: number | null;
  pointer: { x: number; y: number } | null;
  auctionHover: number | null;
  closingHover: number | null;
}

/** 默认配置（与示例页原先的初始状态一致） */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  preset: 'full',
  theme: null,
  mode: 'intraday',
  period: '1d',
  chipMode: 'histogram',
  intradayDays: 1,
  subplotCount: 3,
  subplotIndicators: ['VOL', 'AMOUNT', 'MACD'],
  movingAverages: [],
  macd: '',
  auctionEnabled: true,
  chipsEnabled: true,
  depthScenario: 'normal',
  depthUnit: 'volume',
  depthLevels: 5,
  tapePlacement: 'side',
  tapeZoom: 0,
  tapeSet: 'trades',
  tapeScroll: 0,
  historicalIntradayDate: null,
  historicalAuctionEnabled: true,
  historicalTapeExpanded: false,
  tradeView: 'list',
  bigOrderAmount: 200000,
  maPanelOpen: false,
  crosshair: null,
  pointer: null,
  auctionHover: null,
  closingHover: null,
};

/** 页面 → 组件：仅这两个入口 */
export interface WorkspaceInputs {
  data: ChartDataset | null;
  config: Partial<WorkspaceConfig>;
}

/** 组件 → 页面：统一事件白名单（detail 结构沿用 StockChartEventMap，另加 workspace 级事件） */
export const WORKSPACE_EVENTS = Object.freeze({
  READY: 'workspace-ready',
  DATA_READY: 'dataset-ready',
  CONFIG_CHANGE: 'workspace-config-change',
  ERROR: 'chart-error',
  STATUS: 'workspace-status',
  /** 数据注入后按输入契约校验的结果（非致命：errors 表示口径会出错，warnings 为可容忍偏差） */
  DATA_VALIDATE: 'data-validate',
});

/** 组件内部模块共用的上下文（由主元素注入，模块不直接持有 HTMLElement 根） */
export interface WorkspaceContext {
  /** 根元素（light DOM），模块只在这个范围内 querySelector */
  root: HTMLElement;
  /** 内部 <stock-chart> 实例 */
  chart: HTMLElement & Record<string, unknown>;
  /** 只读配置快照 */
  config: () => Readonly<WorkspaceConfig>;
  /** 请求修改配置（会触发 config-change 与重渲染） */
  patchConfig: (patch: Partial<WorkspaceConfig>) => void;
  /** 当前数据 */
  data: () => ChartDataset | null;
  /** 详情数据（由主元素从 dataset 派生） */
  detailData: () => DetailData;
}

/** 各内部模块统一形状 */
export interface WorkspaceModule {
  /** 绑定事件与初始渲染；返回清理函数 */
  connect(ctx: WorkspaceContext): () => void;
  /** data 或 config 变化后重渲染 */
  update(ctx: WorkspaceContext): void;
}
