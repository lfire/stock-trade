/**
 * 架构概念契约：Container / Layout / Region / Module 四层正交。
 *
 * 依赖方向（单向）：Module → Region → Layout → Container → Workspace。
 * 反向只允许事件（`layout-change` / `module-mounted`），不允许直接调用。
 *
 *  - Container：持有渲染介质与生命周期，容器下的概念只有 Layout。
 *  - Layout   ：纯数据，只划分空间，不认识任何具体模块，也不触发渲染。
 *  - Region   ：布局的最小空间槽位；模块被安排到 Region 中。
 *  - Module   ：可插拔的内容单元，只消费 Region.rect 与只读状态，产出几何或 DOM。
 */
import type { Rect, LayoutHints, SideRect, SubplotLayout, ChartMode } from '../types';

/** 模块产出的目标介质 */
export type RenderTarget = 'webgl' | 'dom';

/** 两个容器 id */
export type ContainerId = 'main-canvas' | 'detail-canvas';

/** 布局槽位 */
export interface Region {
  /** 槽位 id，如 'main' / 'subplot-0' / 'auction-price' / 'cover-groups' */
  id: string;
  /** 画布全局绝对坐标（WebGL 顶点也是全局坐标，rect 仅用于 scissor 裁剪） */
  rect: Rect;
  /** 该槽位由哪种介质渲染 */
  target: RenderTarget;
  /** 是否可见；不可见的槽位不参与模块渲染 */
  visible: boolean;
  /** 层级，越大越靠前 */
  z: number;
  /** 布局约束的可读说明（如「主图占 50% 高度」「副图按 height 属性比例分配」） */
  constraint?: string;
}

/** 参与布局的 pane 槽位描述（由 Container 把 Custom Element 转成纯数据后传入） */
export interface PaneSlot {
  kind: 'price' | 'indicator' | 'chip' | 'other';
  /** 解析后的 height 属性数值 */
  height: number;
  indicator: string;
  hidden: boolean;
  /** 是否实现 buildGeometry */
  drawable: boolean;
  /** 在所有 indicator-pane 中的序号，用于信息栏 index */
  subIndex: number;
}

/** 布局计算输入：尺寸 + DOM hints + 只读状态快照 */
export interface LayoutInput {
  size: { w: number; h: number };
  hints: LayoutHints;
  state: {
    mode: ChartMode;
    auctionEnabled: boolean;
    chipsEnabled: boolean;
    isMultiDay: boolean;
    openAuctionCount: number;
    closeAuctionCount: number;
    /** 参与布局的 pane 槽位（纯数据，顺序与 Container 的 panes 数组一致） */
    panes: ReadonlyArray<PaneSlot>;
  };
}

/** 布局计算输出：一份纯数据快照 */
export interface LayoutSnapshot {
  id: ContainerId;
  size: { w: number; h: number };
  regions: Readonly<Record<string, Region>>;
  /** 与输入 panes 等长的矩形（null = 该 pane 不参与本次布局） */
  paneRects: ReadonlyArray<Rect | null>;
  /** 不占空间但需随布局传递的派生量（mainH / closingW / firstSubPaneIndex / sideRect …） */
  metrics: {
    mainH: number;
    closingW: number;
    firstSubPaneIndex: number;
    infoBars: SubplotLayout[];
    sideRect: SideRect | null;
    auctionPriceRect: Rect | null;
    auctionVolumeRect: Rect | null;
    closingPriceRect: Rect | null;
    closingVolumeRect: Rect | null;
    /** 各布局可附加以自身语义命名的派生量 */
    [key: string]: unknown;
  };
}

/** 布局对象：只算空间，零副作用 */
export interface Layout {
  readonly id: ContainerId;
  compute(input: LayoutInput): LayoutSnapshot;
}

/** 模块描述符：把现有 Custom Element 登记为架构意义上的模块 */
export interface ModuleDescriptor {
  id: string;
  label: string;
  /** 需要的槽位类型，可为具体 id 或前缀（如 'subplot-'） */
  regionType: string;
  target: RenderTarget;
  /** 默认所属容器；'*' 表示可在两容器间迁移 */
  container: ContainerId | '*';
  /** 现有公开标签名（保持不变，仅作映射） */
  tag?: string;
  /** 是否允许多个实例（如副图） */
  multiple?: boolean;
  /** 一句话职责，用于架构文档与调试面板 */
  responsibility: string;
}

/** 容器契约：应用布局 + 把模块安排到槽位 */
export interface Container {
  readonly id: ContainerId;
  readonly target: RenderTarget;
  applyLayout(snapshot: LayoutSnapshot): void;
  mount(moduleId: string, regionId: string): void;
  unmount(moduleId: string): void;
}

/** 旧词 → 新词映射，供文档与迁移说明使用 */
export const TERMINOLOGY: Readonly<Record<string, string>> = Object.freeze({
  pane: 'Module（内容单元）；其矩形改称 Region',
  'pane.rect': 'Region.rect',
  'applyLayout()': 'Layout.compute() + Container.applyLayout()',
  'renderFrame 装饰批次': 'CanvasDecorationModule',
  overlay: 'WebGL 文本层（无交互）',
  cover: 'DetailCanvasContainer（可交互详情层）',
  '三列两行': 'MainCanvasLayout 的 Region 树',
  layout: 'Layout（空间契约）；LAYOUT 常量只管行高',
});
