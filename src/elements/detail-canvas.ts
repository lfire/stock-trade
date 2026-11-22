/**
 * <detail-canvas>：详情画布容器（Container 层）。
 *
 * 公开标签名不变、视觉零变化：元素自身即原 .detail-cover，内部是 light DOM，
 * 骨架 / class / data-set 值逐字照搬原 openTapeDetail() 模板字符串，
 * 因此 index.html 的全局 CSS（.detail-cover .cover-*）无需任何改动。
 *
 * 布局计算委托 DetailCanvasLayout（纯数据）；容器只负责持有 DOM 与生命周期：
 *  - 用 clientWidth/clientHeight 触发 compute，写回派生量并派发 layout-change；
 *  - region() 把 Region id 映射为 DOM 节点，供页面脚本消费；
 *  - ResizeObserver 在尺寸变化时重算；disconnectedCallback 统一清理。
 * 事件统一走 emitEvent（bubbles + composed），遵守全仓事件单一真源约定。
 */
import { DetailCanvasLayout } from '../architecture/detail-canvas-layout';
import type { DetailLayoutInput, DetailSet } from '../architecture/detail-canvas-layout';
import { MODULE_REGISTRY } from '../architecture/registry';
import type { LayoutSnapshot } from '../architecture/types';
import { emitEvent, CHART_EVENTS } from '../events';
import type { LayoutHints } from '../types';

/** Region id → 骨架内 DOM 节点（与全局 CSS 选择器一致） */
const REGION_SELECTORS: Readonly<Record<string, string>> = Object.freeze({
  'cover-tabs': '.cover-tabs',
  'cover-groups': '.cover-groups',
  'cover-panorama': '.cover-panorama',
  'cover-scroll': '.cover-scroll',
  'cover-scroll-spacer': '.cover-scroll-spacer',
  'cover-count': '.cover-count',
  'cover-body': '.cover-body',
});

/** 原 openTapeDetail() 的 innerHTML 模板，逐字保留（含三个 data-set 按钮） */
const DETAIL_SKELETON = `
    <div class="cover-bar">
      <span class="cover-tabs">
        <button type="button" data-set="trades">逐笔明细</button>
        <button type="button" data-set="orders">全部挂单</button>
        <button type="button" data-set="panorama">全景盘口</button>
      </span>
      <span class="cover-count"></span>
      <button type="button" class="cover-back">返回图表 ›</button>
    </div>
    <div class="cover-body">
      <div class="cover-scroll"><div class="cover-scroll-spacer"></div></div>
      <div class="cover-groups"></div>
      <div class="cover-panorama"></div>
    </div>`;

/** compute() 只消费 size 与 detail；hints / state 是 LayoutInput 的形状占位 */
const EMPTY_HINTS: LayoutHints = { auctionWidth: 0, chipWidth: 0, sideWidth: 0 };
const EMPTY_STATE: DetailLayoutInput['state'] = {
  mode: 'intraday', auctionEnabled: false, chipsEnabled: false,
  isMultiDay: false, openAuctionCount: 0, closeAuctionCount: 0, panes: [],
};

/** module-mounted 事件的 detail（mount / unmount 共用一个事件名） */
export interface DetailModuleEvent {
  moduleId: string;
  regionId: string | null;
  action: 'mount' | 'unmount';
  bindings: Readonly<Record<string, string>>;
}

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export class DetailCanvas extends HTMLElement {
  private readonly layout: DetailCanvasLayout = new DetailCanvasLayout();
  private snapshot: LayoutSnapshot | null = null;
  private ro: ResizeObserver | null = null;

  /** 当前状态：页面经 setDetailSet / setWindow 驱动，也可只读消费 */
  set: DetailSet = 'trades';
  from = 0;
  totalRows = 0;

  /** 当前模块 → Region 绑定（只登记，不移动 DOM） */
  private readonly bindings = new Map<string, string>();

  /** Layout 派生量：applyLayout() 写回，页面脚本直接读取 */
  groupCount = 1;
  rowsPerGroup = 1;
  spacerHeight = 0;
  scrollTop = 0;

  connectedCallback(): void {
    // 元素自身就是 .detail-cover：CSS 依赖它做 absolute 铺满与 z-index:10
    this.classList.add('detail-cover');
    // 只在首次连接时建骨架；重连（节点被搬动）保留页面已填充的分组与滚动监听
    if (!this.querySelector('.cover-body')) this.innerHTML = DETAIL_SKELETON;
    this.ro = new ResizeObserver(() => {
      // 已有快照才重算，避免首帧 clientWidth=0 时产生噪声
      if (this.snapshot) this.applyLayout();
    });
    this.ro.observe(this);
    // 首份快照：让 groupCount / spacerHeight 在页面 build 之前即可读
    this.applyLayout();
  }

  disconnectedCallback(): void {
    // 断开 RO（容器唯一的尺寸监听）并清空全部派生状态；DOM 由外部 remove()
    this.ro?.disconnect();
    this.ro = null;
    this.snapshot = null;
    this.bindings.clear();
    this.set = 'trades';
    this.from = 0;
    this.totalRows = 0;
    this.groupCount = 1;
    this.rowsPerGroup = 1;
    this.spacerHeight = 0;
    this.scrollTop = 0;
  }

  /** Region id → 对应 DOM 节点；未知 id 返回 null，由页面侧回退 querySelector */
  region(id: string): HTMLElement | null {
    const selector = REGION_SELECTORS[id];
    return selector ? this.querySelector<HTMLElement>(selector) : null;
  }

  /** 用当前尺寸 + 状态重算布局：写回派生量并派发 layout-change */
  applyLayout(): LayoutSnapshot {
    const input: DetailLayoutInput = {
      size: { w: this.clientWidth, h: this.clientHeight },
      hints: EMPTY_HINTS,
      state: EMPTY_STATE,
      detail: {
        set: this.set,
        totalRows: this.totalRows,
        from: this.from,
      },
    };
    const snapshot = this.layout.compute(input);
    const m = snapshot.metrics;
    this.groupCount = finite(m.groupCount, 1);
    this.rowsPerGroup = finite(m.rowsPerGroup, 1);
    this.spacerHeight = finite(m.spacerHeight, 0);
    this.scrollTop = finite(m.scrollTop, 0);
    this.snapshot = snapshot;
    emitEvent(this, CHART_EVENTS.LAYOUT_CHANGE, snapshot);
    return snapshot;
  }

  /** 切换数据集：切 .pano-mode（原 applyDetailMode）并重算布局 */
  setDetailSet(set: DetailSet): void {
    this.set = set;
    this.region('cover-body')?.classList.toggle('pano-mode', set === 'panorama');
    this.applyLayout();
  }

  /** 更新虚拟滚动窗口（起点行号 + 数据总行数）并重算布局 */
  setWindow(from: number, totalRows: number): void {
    this.from = from;
    this.totalRows = totalRows;
    this.applyLayout();
  }

  /** 登记模块 ↔ Region 绑定并派发 module-mounted（不移动 DOM） */
  mount(moduleId: string, regionId: string): void {
    if (!MODULE_REGISTRY[moduleId]) return;
    this.bindings.set(moduleId, regionId);
    this.emitModuleEvent(moduleId, regionId, 'mount');
  }

  unmount(moduleId: string): void {
    if (!this.bindings.delete(moduleId)) return;
    this.emitModuleEvent(moduleId, null, 'unmount');
  }

  private emitModuleEvent(moduleId: string, regionId: string | null,
    action: DetailModuleEvent['action']): void {
    const detail: DetailModuleEvent = {
      moduleId, regionId, action,
      bindings: Object.freeze(Object.fromEntries(this.bindings)),
    };
    emitEvent(this, 'module-mounted', detail);
  }
}

// 标签注册统一由 src/index.ts 的 defineAll() 显式负责，本模块保持无副作用
