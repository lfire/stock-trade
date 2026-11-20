// ChartContext：viewport / priceScale / crosshair / 色板 / 计算引擎的单一真源。
// 三列两行区域规划：
//   左列 = 开盘集合竞价 9:15–9:25（上价格 / 下挂单量+成交量），仅分时且开启时显示
//   中列 = 上主图（连续竞价 9:30–15:00 或 K 线）+ 右端尾盘竞价 14:57–15:00 放大列 + 下多个副图
//   右列 = 上筹码峰横条（K 线且开启）+ 下筹码统计；分时模式右列给十档盘口
import { PALETTE, AXIS_GUTTER_L, AXIS_GUTTER_R, LAYOUT, withPalette } from '../types';
import { rgba, rect, line } from '../gl/geometry';
import { buildPhaseGeometry } from './auction-layer';
import { DEFAULT_MACD_PARAMS, resolveMACDParams } from './indicator-params';
import { HALF_HOUR_MARKS, TIME } from './market-constants';
import { emitEvent } from '../events';
import { createComputeEngine } from '../compute/engine';
import { WebGL2Renderer } from '../gl/renderer';
import { PERIODS, PERIOD_LABEL, DEFAULT_PERIOD, buildBars } from './bar-aggregator';
import type { ChartMode, ChipMode, IntradayPoint, AuctionPoint, Bar, Palette, MACDParams, MAConfig, SubplotConfig, SubplotLayout, SideRect, PriceScale, NumericInput, ChartDataset, Manifest, PaneElementLike, LayoutHints, ChartContextFacade } from '../types';
import type { StockChart } from '../elements/stock-chart';
import type { JsComputeEngine, WasmComputeEngine } from '../compute/engine';

type Rect = { x: number; y: number; w: number; h: number };
type SpanFn = (x: number, y: number, text: string, color?: string, bar?: unknown, align?: string) => string;
interface Tick { x: number; text: string; }
interface SegmentOverlayConfig {
  r: Rect;
  v: Rect | null;
  pts: AuctionPoint[];
  title: string;
  ticks: Tick[];
  hover: number | null;
  hoverTitle: string;
  floatLeft: boolean;
  basePrice: number;
  pctLabel: string;
  phaseOf: (p: AuctionPoint) => string;
  compact?: boolean;
}
interface GeometryBatch { rect: Rect | null; vertices: number[]; }
interface HalfHourMark { x: number; time: string; tradeDate: string; dayStart: boolean; }
interface PriceAxisValue { price: number; pct: number | null; }
interface PriceAxisPane extends PaneElementLike {
  axisValueAt?: (py: number, ctx: ChartContext) => PriceAxisValue | null;
}
interface ValueAxisPane extends PaneElementLike {
  axisValueAt?: (py: number) => string | null;
}

/** 每个副图上方独立信息栏的高度（切换下拉 + 指标数值，不画在图上） */
const SUBPLOT_INFO_H = LAYOUT.rowH;   // 副图信息栏与数据行同高

/** 副图可切换的指标（computeIndicator 支持的全部类型） */
export const SUBPLOT_INDICATORS = Object.freeze(['VOL', 'AMOUNT', 'MACD', 'KDJ', 'VOL_RATIO']);

/** 默认均线配置（用工厂函数避免共享引用） */
const defaultMA = (palette = PALETTE) => [
  { period: 5, color: palette.avg },
  { period: 20, color: palette.chipLoss },
];

/** 竞价段 overlay：标题 / 时间轴 / 成交量纵轴刻度 / hover 浮层与时间高亮 */
function segmentOverlay(ctx: ChartContext, parts: string[], span: SpanFn, cfg: SegmentOverlayConfig) {
  const { r, v, pts, title, ticks, hover, hoverTitle, basePrice, pctLabel, phaseOf, floatLeft,
    compact } = cfg;
  // 竞价段不再显示「集合竞价」标题条；窄段（尾盘竞价）同样不显示，避免与右坐标栏挤压
  // 时间范围由下方刻度承担，不再重复标文字
  if (!compact && title) parts.push(span(r.x + 3, r.y + 2, title, PALETTE.textMuted, true));
  ticks.forEach((t: Tick) => parts.push(span(t.x, r.y + r.h - 16, t.text, PALETTE.textMuted)));   // 与主图时间轴同一基线

  // 竞价量柱与第一个成交量副图共用全局左坐标栏刻度，这里不再单独标数字刻度
  if (hover == null || !pts[hover]) return;
  const p = pts[hover];
  const pct = ((p.virtualPrice - basePrice) / basePrice) * 100;
  // 固定宽度 + 分区卡片：标题/状态胶囊、主价格区、两列对齐的指标区；色点代替「（红）」文字
  const side = p.unmatchedSide === 1 ? { text: '买方堆积', color: 'var(--sc-up,#E24B4A)' }
    : p.unmatchedSide === 2 ? { text: '卖方堆积', color: 'var(--sc-down,#1D9E75)' }
      : { text: '无未匹配', color: 'var(--sc-muted,#9AA3AF)' };
  const phaseText = phaseOf(p), canCancel = phaseText === '可撤单时段';
  const phaseBg = canCancel ? 'var(--sc-panel,#EAF2FE)' : 'var(--sc-panel,#F1F2F4)';
  const phaseColor = canCancel ? 'var(--sc-link,#1B5FBF)' : 'var(--sc-muted,#6B7280)';
  const bx = Math.round(floatLeft ? r.x - 236 : r.x + r.w + 8), by = Math.round(r.y + 34);
  const pctColor = pct >= 0 ? 'var(--sc-up,#E24B4A)' : 'var(--sc-down,#1D9E75)';
  const num = 'font-variant-numeric:tabular-nums';
  parts.push(`<div style="position:absolute;left:${bx}px;top:${by}px;width:232px;box-sizing:border-box;background:var(--sc-bg,#fff);border:1px solid var(--sc-line,#DDE2E8);border-radius:8px;padding:10px 12px;pointer-events:none;box-shadow:0 6px 18px rgba(31,35,41,.10);font:11px/1.5 system-ui,-apple-system,sans-serif;color:var(--sc-text,#1F2329)">`
    + `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:12px;font-weight:500">${hoverTitle} <span style="color:var(--sc-muted,#6B7280);font-weight:400;${num}">${p.time}</span></span>`
    + `<span style="flex:0 0 auto;font-size:10px;padding:1px 6px;border-radius:4px;background:${phaseBg};color:${phaseColor}">${phaseText}</span></div>`
    + `<div style="font-size:10px;color:var(--sc-muted,#9AA3AF);margin-top:2px">示意撮合 · 9:15–9:24 虚拟量历史不留存</div>`
    + `<div style="margin:8px 0;padding:8px 0;border-top:1px solid var(--sc-line,#EEF0F3);border-bottom:1px solid var(--sc-line,#EEF0F3)">`
    + `<div style="display:flex;align-items:baseline;justify-content:space-between"><span style="color:var(--sc-muted,#6B7280)">虚拟撮合价</span><b style="font-size:16px;font-weight:500;${num}">${p.virtualPrice.toFixed(2)}</b></div>`
    + `<div style="display:flex;align-items:baseline;justify-content:flex-end;gap:6px;margin-top:2px"><span style="color:${pctColor};font-weight:500;${num}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span><span style="color:var(--sc-muted,#9AA3AF);font-size:10px">${pctLabel}</span></div></div>`
    + `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px">`
    + `<span style="color:var(--sc-muted,#6B7280)">匹配量</span><b style="text-align:right;font-weight:500;${num}">${p.matchedQty.toLocaleString('zh-CN')} 手</b>`
    + `<span style="color:var(--sc-muted,#6B7280)">未匹配量</span><b style="text-align:right;font-weight:500;${num}">${p.unmatchedQty.toLocaleString('zh-CN')} 手</b>`
    + `<span style="color:var(--sc-muted,#6B7280)">挂单方向</span><span style="text-align:right"><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${side.color};margin-right:5px"></i>${side.text}</span></div></div>`);
  const hx = r.x + ((hover + 0.5) / pts.length) * r.w;
  parts.push(`<span style="position:absolute;left:${Math.round(hx - 23)}px;top:${Math.round(r.y + r.h - 14)}px;background:var(--sc-text,#1F2329);color:var(--sc-bg,#fff);padding:1px 4px;border-radius:3px;font:10px/1.3 system-ui,-apple-system,sans-serif;pointer-events:none">${p.time}</span>`);
}

export class ChartContext {
  declare host: StockChart;
  declare canvas: HTMLCanvasElement;
  declare overlay: HTMLDivElement | null;
  declare renderer: WebGL2Renderer | null;
  declare compute: JsComputeEngine | WasmComputeEngine;
  declare palette: Palette;
  declare dataset: ChartDataset | null;
  declare size: { w: number; h: number } | null;
  declare mode: ChartMode;
  declare period: string;
  declare barsCache: Map<string, Bar[]>;
  declare panes: PaneElementLike[];
  declare viewport: { start: number; end: number };
  declare priceScale: { min: number; max: number; pre?: number; dev?: number; symmetrical?: boolean };
  declare crosshair: number | null;
  declare auctionHover: number | null;
  declare closingHover: number | null;
  declare chipMode: ChipMode;
  declare maConfig: MAConfig[];
  declare macdParams: MACDParams;
  declare firstSubPane: PaneElementLike | null;
  declare infoBars: SubplotLayout[];
  declare pointer: { x: number; y: number } | null;
  declare auctionEnabled: boolean;
  declare chipsEnabled: boolean;
  declare intradayDays: number;
  declare isMultiDay: boolean;
  declare intradayBasePrice: number | null;
  declare openAuction: AuctionPoint[];
  declare closeAuction: AuctionPoint[];
  declare auctionPriceRect: Rect | null;
  declare auctionVolumeRect: Rect | null;
  declare closingPriceRect: Rect | null;
  declare closingVolumeRect: Rect | null;
  declare closingW: number;
  declare mainH: number;
  declare sideRect: SideRect | null;
  declare frame: number;
  declare dirty: boolean;
  constructor(host: StockChart) {
    this.host = host;
    this.canvas = host.canvas!;
    this.overlay = host.overlay;
    this.renderer = new WebGL2Renderer(this.canvas);
    this.compute = createComputeEngine();
    this.palette = { ...PALETTE };   // 实例色板；渲染帧内临时生效，不污染全局
    this.dataset = null;
    this.size = null;
    this.mode = 'candle';
    this.period = DEFAULT_PERIOD;     // K 线默认日 K，见 PERIODS
    this.barsCache = new Map();       // 各周期聚合结果缓存
    this.panes = [];
    this.viewport = { start: 0, end: 0 };
    this.priceScale = { min: 0, max: 0 };
    this.crosshair = null;
    this.auctionHover = null;         // 开盘竞价列 hover 索引
    this.closingHover = null;         // 尾盘竞价段 hover 索引
    this.chipMode = 'histogram';
    this.maConfig = defaultMA(this.palette);      // K 线均线配置的单一真源（取实例色板）
    this.macdParams = { ...DEFAULT_MACD_PARAMS };   // MACD 参数单一真源，默认通达信 (12,26,9)
    this.firstSubPane = null;         // 当前第一个可见副图（恒为成交量，与竞价列共用刻度）
    this.infoBars = [];               // 各副图上方信息栏的位置与指标
    this.pointer = null;              // 鼠标精确像素位置 {x,y}，坐标轴定位标签以它为中心
    this.auctionEnabled = true;       // 同时控制开盘 / 尾盘两段竞价
    this.chipsEnabled = true;
    this.intradayDays = 1;            // 分时天数：1 = 单日（默认），>1 = 多日拼接
    this.isMultiDay = false;          // 多日场景：竞价段不展示
    this.intradayBasePrice = null;    // 分时价格轴基准：单日昨收 / 多日当前显示（末）交易日昨收
    this.openAuction = [];
    this.closeAuction = [];
    this.auctionPriceRect = null;
    this.auctionVolumeRect = null;
    this.closingPriceRect = null;
    this.closingVolumeRect = null;
    this.closingW = 0;
    this.mainH = 0;                   // 主图区 / 副图区分界的 y 坐标
    this.sideRect = null;
    this.frame = 0;
    this.dirty = false;
  }

  registerPane(el: PaneElementLike) {
    if (!this.panes.includes(el)) this.panes.push(el);
    this.applyLayout();
  }
  unregisterPane(el: PaneElementLike) { this.panes = this.panes.filter((p) => p !== el); this.applyLayout(); }

  emit(name: string, detail?: unknown) {
    emitEvent(this.host, name, detail);
  }

  // ---------------------------------------------------------------- 受控状态写入
  // 所有外部（组件层 / 页面层）对 ctx 状态的修改都必须走这里；core 内部仍直接赋值。
  /** 初始化配置：仅 connectedCallback 使用，数据未就绪，不 emit / 不重绘 */
  configure({ mode, auctionEnabled, chipsEnabled }: { mode?: string; auctionEnabled?: boolean; chipsEnabled?: boolean } = {}) {
    if (mode === 'intraday' || mode === 'candle') this.mode = mode;
    if (typeof auctionEnabled === 'boolean') this.auctionEnabled = auctionEnabled;
    if (typeof chipsEnabled === 'boolean') this.chipsEnabled = chipsEnabled;
    return this;
  }

  /** 实例色板：只接受对象，浅拷贝防止外部改到内部 */
  setPalette(palette: Palette) {
    if (!palette || typeof palette !== 'object') return { ...this.palette };
    this.palette = { ...palette };
    return { ...this.palette };
  }

  /**
   * 每帧价格轴：由 price-pane 计算后写入，竞价段 / 筹码峰 / 副图复用。
   * 校验 min/max 为有限数且 max >= min，避免脏数据让后续 y 映射产生 NaN。
   */
  setPriceScale(scale: PriceScale) {
    const min = Number(scale?.min), max = Number(scale?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return { ...this.priceScale };
    this.priceScale = { ...scale, min, max };
    return { ...this.priceScale };
  }

  /** 全景委托簿：唯一写入 dataset.depthFull 的入口 */
  setDepthFull(pano: Record<string, unknown> | null | undefined) {
    if (!this.dataset) return null;
    this.dataset.depthFull = pano ?? null;
    this.requestRender();
    return this.dataset.depthFull;
  }

  /** 视口：钳制到当前序列范围，避免负数 / start>end / 越界导致 xForIndex 产生 NaN */
  setViewport({ start = 0, end }: { start?: number; end?: number } = {}) {
    const n = this.getSeries().length;
    const clamp = (v: number | undefined, fallback: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(n, Number(v))) : fallback);
    const s = clamp(start, 0), e = Math.max(s, clamp(end, n));
    this.viewport = { start: s, end: e };
    this.emit('viewport-change', { start: s, end: e, mode: this.mode });
    this.requestRender();
    return { ...this.viewport };
  }

  /**
   * 只读门面：getContext() 返回它，而不是可变的 ChartContext 本体。
   * 冻结对象 + getter 浅拷贝，外部既不能改状态字段，也拿不到内部数组的写引用；
   * 需要改状态请用 <stock-chart> 的公开方法（内部转调上面的受控 setter）。
   */
  readonlyFacade(): ChartContextFacade {
    const ctx = this;
    const denied = (prop: unknown) => {
      throw new TypeError(`[stock-chart] ChartContext.${String(prop)} 只读；请使用 <stock-chart> 的公开方法改状态`);
    };
    return new Proxy(Object.freeze({
      get mode() { return ctx.mode; },
      get period() { return ctx.period; },
      get viewport() { return { ...ctx.viewport }; },
      get priceScale() { return { ...ctx.priceScale }; },
      get palette() { return { ...ctx.palette }; },
      get isMultiDay() { return ctx.isMultiDay; },
      get intradayDays() { return ctx.intradayDays; },
      get auctionEnabled() { return ctx.auctionEnabled; },
      get chipsEnabled() { return ctx.chipsEnabled; },
      get dataset() { return ctx.dataset ? { ...ctx.dataset } : null; },
      getSeries: () => ctx.getSeries().slice(),
      getBars: () => ctx.getBars().slice(),
      getVisible: () => ctx.getVisible().slice(),
      getSubplotConfig: () => ctx.getSubplotConfig().map((c) => ({ ...c })),
      getSubplotLayout: () => ctx.getSubplotLayout().map((c) => ({ ...c })),
      getMACDParams: () => ctx.getMACDParams(),
      getIntradayDays: () => ctx.getIntradayDays(),
      halfHourMarks: (rect: Rect) => ctx.halfHourMarks(rect).map((m) => ({ ...m })),
    }), {
      set: (_t, prop) => { denied(prop); return true; },
      deleteProperty: (_t, prop) => { denied(prop); return true; },
      defineProperty: (_t, prop) => { denied(prop); return true; },
    });
  }

  setDataset(dataset: ChartDataset) {
    this.dataset = dataset;
    // 保留原始单日分时，切换回 1 日时无需重新 fetch
    this.dataset.intradaySingle = dataset.intraday || [];
    this.barsCache.clear();
    this.intradayBasePrice = dataset.manifest?.preClose ?? null;
    this.setIntradayDays(this.intradayDays);   // 内部完成序列切换 / 竞价隐藏 / 视口 / 布局 / 重绘
    this.emit('data-loaded', { symbol: dataset.manifest.symbol, tradeDate: dataset.manifest.tradeDate });
    this.requestRender();
  }

  /**
   * 切换分时天数：从 dataset.intradayMulti（扁平多日点，每点带 tradeDate）取最后 N 个交易日。
   * 多日场景不展示集合竞价：清空 openAuction/closeAuction，并让 applyLayout() 不再分配竞价列。
   */
  setIntradayDays(days: NumericInput) {
    const n = Math.max(1, Math.min(5, Math.round(Number(days) || 1)));
    this.intradayDays = n;
    if (!this.dataset) return n;
    const multi: IntradayPoint[] = this.dataset.intradayMulti || [];
    const dates = [...new Set(multi.map((p) => p.tradeDate).filter(Boolean))];
    const chosen = n > 1 && dates.length > 1 ? dates.slice(-Math.min(n, dates.length)) : [];
    this.isMultiDay = chosen.length > 1;
    this.dataset.intraday = this.isMultiDay
      ? multi.filter((p) => chosen.includes(p.tradeDate))
      : (this.dataset.intradaySingle || this.dataset.intraday || []) as IntradayPoint[];
    const m = this.dataset.manifest || ({} as Manifest);
    const byDate = m.preCloseByDate || ({} as Record<string, number>);
    // 口径统一（P1）：单日 / 多日一律按「当前显示（末）交易日」昨收（manifest.preCloseByDate）取涨跌幅基准，
    // 不再误用首日昨收（1453），避免同一 close=1435.26 多日显示与单日（1410.27）符号相反。
    // 末日 2026-11-13 → 1410.27 → +1.772%（与单日一致）；明细报价按光标所在日逐日取基准见 price-pane。
    const baseDate = this.isMultiDay ? (chosen[chosen.length - 1] || m.tradeDate) : m.tradeDate;
    this.intradayBasePrice = byDate[baseDate] ?? m.preClose ?? null;
    // 多日时竞价数组清空：避免价格轴 dev 仍被 virtualPrice 撑大（视觉上等价于隐藏竞价）
    const all: AuctionPoint[] = this.isMultiDay ? [] : (this.dataset.auction || []);
    this.openAuction = all.filter((p) => p.phase === 'open');
    this.closeAuction = all.filter((p) => p.phase === 'close');
    this.crosshair = null;
    this.pointer = null;
    this.resetViewport();
    this.applyLayout();
    this.emit('intraday-days-change', {
      days: this.isMultiDay ? chosen.length : 1, multiDay: this.isMultiDay, dates: chosen,
      simulatedDays: this.isMultiDay ? chosen.length - 1 : 0,   // 末日真实，其余按日 K 拟真
    });
    this.requestRender();
    return this.isMultiDay ? chosen.length : 1;
  }
  getIntradayDays() { return this.intradayDays; }

  setMode(mode: string) {
    if (mode !== 'candle' && mode !== 'intraday') return;
    // 第一个副图恒为成交量，K 线 / 分时都不可修改（防御性校正）
    const subs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    if (subs[0] && (subs[0].getAttribute('indicator') || '').toUpperCase() !== 'VOL') {
      subs[0].setAttribute('indicator', 'VOL');
    }
    this.mode = mode;
    this.crosshair = null;      // 多日/单日点数不同，旧索引可能越界
    this.pointer = null;
    this.resetViewport();
    this.applyLayout();
    this.emit('viewport-change', { ...this.viewport, mode });
    this.emit('subplot-config-change', { config: this.getSubplotConfig() });
    this.requestRender();
  }

  setChipMode(mode: string) {
    if (mode !== 'stat' && mode !== 'histogram') return;
    this.chipMode = mode;
    this.emit('chip-mode-change', { mode });
    this.requestRender();
  }

  // ---- K 线均线配置：可添加、删除、改周期 / 颜色 ----
  /** 整体替换；period 规整为正整数并去重，最多 8 条，返回新配置 */
  /** 均线配置单一写入口（组件层 setMovingAverages / addMA / removeMA / updateMA 都转调这里） */
  setMovingAverages(list: unknown) {
    const seen = new Set<number>();
    this.maConfig = (Array.isArray(list) ? list : []).slice(0, 8).map((m) => {
      let period = Math.max(1, Math.round(Number(m.period) || 5));
      while (seen.has(period)) period += 1;
      seen.add(period);
      const color = /^#[0-9A-Fa-f]{6}$/.test(m.color || '') ? m.color : PALETTE.avg;
      return { period, color };
    });
    // 事件与返回值都给拷贝，避免消费者改到内部 maConfig（对齐 macd-params-change 的做法）
    const snapshot = this.maConfig.map((m) => ({ ...m }));
    this.emit('ma-config-change', { list: snapshot });
    this.requestRender();
    return snapshot;
  }
  addMA(cfg: Partial<MAConfig>) { return this.setMovingAverages([...this.maConfig, cfg || {}]); }
  removeMA(period: NumericInput) { return this.setMovingAverages(this.maConfig.filter((m) => m.period !== Number(period))); }
  updateMA(period: NumericInput, patch: Partial<MAConfig>) {
    return this.setMovingAverages(this.maConfig.map((m) => (m.period === Number(period) ? { ...m, ...patch } : m)));
  }

  /** 设置 MACD 参数（部分配置合并到当前值），非法值回退默认 (12,26,9) */
  setMACDParams(patch = {}) {
    this.macdParams = resolveMACDParams({ ...this.macdParams, ...(patch || {}) });
    this.emit('macd-params-change', { params: { ...this.macdParams } });
    this.requestRender();
    return { ...this.macdParams };
  }
  getMACDParams() { return { ...this.macdParams }; }

  /** 竞价开关（同时控制开盘 9:15–9:25 与尾盘 14:57–15:00，仅分时模式生效） */
  setAuctionEnabled(on: unknown) {
    this.auctionEnabled = !!on;
    this.emit('auction-toggle', { enabled: this.auctionEnabled });
    this.applyLayout();
  }

  setChipsEnabled(on: unknown) {
    this.chipsEnabled = !!on;
    this.emit('chips-toggle', { enabled: this.chipsEnabled });
    this.applyLayout();
  }

  setSubplotCount(n: number) {
    const subs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    subs.forEach((p, i) => { if (i < n) p.removeAttribute('hidden'); else p.setAttribute('hidden', ''); });
    this.applyLayout();
    this.emit('subplot-config-change', { config: this.getSubplotConfig() });
  }

  /** 所有副图的当前配置（含隐藏的），按 DOM 顺序返回，index 可用于 setSubplotIndicator */
  getSubplotConfig(): SubplotConfig[] {
    return this.panes
      .filter((p) => p.tagName.toLowerCase() === 'indicator-pane')
      .map((p, index) => ({
        index,
        indicator: (p.getAttribute('indicator') || 'VOL').toUpperCase(),
        height: p.getAttribute('height') || '',
        hidden: p.hasAttribute('hidden'),
      }));
  }

  /** 各可见副图上方信息栏的位置（供页面渲染切换下拉与数值），不随每帧重绘 */
  getSubplotLayout(): SubplotLayout[] {
    return (this.infoBars || []).map((b) => ({ ...b }));
  }

  /** 单独切换某一个副图的指标；非法名称忽略 */
  setSubplotIndicator(index: number, name: string) {
    const upper = String(name || '').toUpperCase();
    const subs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    if (!subs[index] || !SUBPLOT_INDICATORS.includes(upper)) return this.getSubplotConfig();
    if (index === 0 && upper !== 'VOL') return this.getSubplotConfig();   // 首个副图恒为成交量
    subs[index].setAttribute('indicator', upper);   // 触发 attributeChangedCallback → 重绘
    this.emit('subplot-config-change', { config: this.getSubplotConfig() });
    this.requestRender();
    return this.getSubplotConfig();
  }

  resetViewport() {
    const n = this.getSeries().length;
    const span = Math.min(120, n);   // 分钟级周期总根数可能远小于 120
    this.viewport = this.mode === 'intraday'
      ? { start: 0, end: n }
      : { start: Math.max(0, n - span), end: n };
  }

  /** 当前周期的 K 线序列（带缓存）；所有指标计算都以它为准 */
  getBars() {
    if (!this.dataset) return [];
    if (!this.barsCache.has(this.period)) this.barsCache.set(this.period, buildBars(this.dataset, this.period) as Bar[]);
    return this.barsCache.get(this.period)!;
  }

  /** 切换 K 线周期：重算序列、重置视口、清空光标 */
  setPeriod(period: string) {
    const p = PERIODS.some((x) => x.key === period) ? period : DEFAULT_PERIOD;
    if (p === this.period) return;
    this.period = p;
    this.crosshair = null;
    this.pointer = null;
    this.resetViewport();
    this.applyLayout();
    this.emit('period-change', { period: p, label: PERIOD_LABEL[p], count: this.getSeries().length });
    this.emit('viewport-change', { ...this.viewport, mode: this.mode });
    this.requestRender();
  }

  /** 分时主图画到 15:00 收盘；15:01–15:30 盘后固定价段不画。
   *  多日序列是扁平拼接数组（每点带 tradeDate），必须逐点过滤盘后点，
   *  不能用 findIndex 截断（否则第一天盘后点会丢掉后续所有交易日）。 */
  getSeries(): (Bar | IntradayPoint)[] {
    if (!this.dataset) return [];
    if (this.mode !== 'intraday') return this.getBars();
    // 收盘时刻由 manifest.session 决定（缺省回退 15:00），不再把交易时段写死在代码里
    const end = this.dataset.manifest?.session?.at?.(-1)?.close || TIME.SESSION_END;
    return (this.dataset.intraday || []).filter((p: IntradayPoint) => p.time <= end);
  }
  getVisible() { return this.getSeries().slice(this.viewport.start, this.viewport.end); }
  visibleCount() { return Math.max(1, this.viewport.end - this.viewport.start); }

  mainRect() { return this.panes.find((p) => p.tagName.toLowerCase() === 'price-pane')?.rect || null; }

  /** 中列 pane 内是否还要预留左坐标栏；分时模式左栏移到画布最左侧，故为 0 */
  leftInset() {
    return this.mode === 'intraday' ? 0 : AXIS_GUTTER_L;
  }

  /** 中间绘图区宽度：扣掉左右坐标留白，分时再扣尾盘竞价段 */
  plotWidth(r: Rect) {
    const closing = this.mode === 'intraday' && this.closingW > 0 ? this.closingW : 0;
    return Math.max(60, r.w - this.leftInset() - AXIS_GUTTER_R - closing);
  }

  /** 中间绘图区矩形：所有数据（K 线 / 分时线 / 量柱 / 均线 / 网格）只画在这里 */
  plotRect(r: Rect) {
    return { x: r.x + this.leftInset(), y: r.y, w: this.plotWidth(r), h: r.h };
  }

  xForIndex(i: number, rect: Rect) {
    const pr = this.plotRect(rect);
    return pr.x + ((i - this.viewport.start) + 0.5) * (pr.w / this.visibleCount());
  }

  /** 分时图半小时刻度：按 tradeDate 分日生成（多日时每个交易日都有自己的一套刻度），
   *  返回 { x, time, tradeDate, dayStart }，dayStart 用于画日界竖线与日期标签。 */
  halfHourMarks(rect: Rect): HalfHourMark[] {
    if (this.mode !== 'intraday' || !this.dataset) return [];
    const s = this.getSeries();
    const fallbackDate = this.dataset.manifest?.tradeDate || '';
    const marks = HALF_HOUR_MARKS;
    const groups = new Map<string, number[]>();
    s.forEach((p, i) => {
      const key = p.tradeDate || fallbackDate;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    });
    const out: HalfHourMark[] = [];
    for (const [date, idxs] of groups) {
      for (const t of marks) {
        const i = idxs.find((idx: number) => (s[idx] as IntradayPoint).time === t);
        if (i == null || i < this.viewport.start || i >= this.viewport.end) continue;
        out.push({ x: this.xForIndex(i, rect), time: t, tradeDate: date, dayStart: i === idxs[0] });
      }
    }
    return out;
  }

  indexAtX(x: number) {
    const r = this.mainRect();
    if (!r) return null;
    const pr = this.plotRect(r);   // 坐标留白区不触发 crosshair
    if (x < pr.x || x > pr.x + pr.w) return null;
    const i = this.viewport.start + Math.floor(((x - pr.x) / pr.w) * this.visibleCount());
    return Math.min(this.viewport.end - 1, Math.max(this.viewport.start, i));
  }

  /**
   * 分时模式：第一个成交量副图与「开盘竞价列」共用的纵轴上限（统一为「股」）。
   * 9:25 竞价量恰好等于分时 09:30 首点成交量，共用刻度后两者等高。
   * 尾盘 15:00 一次性撮合量级远大于分钟量，不纳入此上限，由尾盘段按自身相对量绘制。
   */
  volumeScaleHi() {
    if (this.mode !== 'intraday' || !this.dataset) return 0;
    let hi = 0;
    for (const p of this.getVisible()) hi = Math.max(hi, p.volume);
    for (const p of this.openAuction) hi = Math.max(hi, p.matchedQty * 100);
    return Math.max(1, hi * 1.02);
  }

  /** 开盘竞价左列 x 命中的节点索引 */
  auctionIndexAtX(x: number) {
    const r = this.auctionPriceRect;
    if (!r || !this.openAuction.length || x < r.x || x > r.x + r.w) return null;
    const n = this.openAuction.length;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - r.x) / r.w) * n)));
  }

  /** 尾盘竞价段 x 命中的节点索引 */
  closingIndexAtX(x: number) {
    const r = this.closingPriceRect;
    if (!r || !this.closeAuction.length || x < r.x || x > r.x + r.w) return null;
    const n = this.closeAuction.length;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - r.x) / r.w) * n)));
  }

  setAuctionHover(index: number | null) {
    if (index === this.auctionHover) return;
    this.auctionHover = index;
    this.emit('auction-hover', { index, point: index != null ? this.openAuction[index] || null : null });
    this.requestRender();
  }

  setClosingHover(index: number | null) {
    if (index === this.closingHover) return;
    this.closingHover = index;
    this.emit('closing-hover', { index, point: index != null ? this.closeAuction[index] || null : null });
    this.requestRender();
  }

  setCrosshair(index: number | null) {
    if (index === this.crosshair) return;
    this.crosshair = index;
    const item = this.getSeries()[index!] || null;
    this.emit('crosshair-change', { index, item, mode: this.mode });
    this.requestRender();
  }

  /** 记录鼠标精确像素位置；坐标轴定位标签与水平十字线以它为中心 */
  setPointer(x: number | null, y?: number) {
    const p = x == null ? null : { x, y };
    if (this.pointer?.x === p?.x && this.pointer?.y === p?.y) return;
    this.pointer = p as { x: number; y: number } | null;
    this.requestRender();
  }

  panBy(delta: number) {
    const s = this.getSeries(), n = s.length;
    let { start, end } = this.viewport;
    start += delta; end += delta;
    if (start < 0) { end -= start; start = 0; }
    if (end > n) { start -= end - n; end = n; }
    start = Math.max(0, start);
    this.viewport = { start, end };
    this.emit('viewport-change', { ...this.viewport });
    this.requestRender();
  }

  zoomBy(factor: number, anchor = 0.5) {
    const s = this.getSeries(), n = s.length;
    let count = Math.round(this.visibleCount() * factor);
    count = Math.min(n, Math.max(20, count));
    const center = this.viewport.start + this.visibleCount() * anchor;
    let start = Math.round(center - count * anchor);
    start = Math.min(Math.max(0, start), n - count);
    this.viewport = { start, end: start + count };
    this.emit('viewport-change', { ...this.viewport });
    this.requestRender();
  }

  layout(width: number, height: number) {
    this.size = { w: width, h: height };
    this.renderer!.resize(width, height);
    this.applyLayout();
  }

  applyLayout() {
    if (!this.size) return;
    const { w: width, h: height } = this.size;
    const isIntraday = this.mode === 'intraday';
    // 多日分时场景不展示集合竞价：rect 置 null 后几何/hover/浮层都自动跳过
    const auctionOn = this.auctionEnabled && isIntraday && !this.isMultiDay;
    const chipsOn = this.chipsEnabled && !isIntraday;

    // 布局尺寸由 element 层读取 DOM 后以结构化 hints 传入，core 不再反向 querySelector
    const chip = this.panes.find((p) => p.tagName.toLowerCase() === 'chip-pane');
    const hints = this.host.getLayoutHints?.() || ({} as LayoutHints);
    const auctionW = auctionOn ? (hints.auctionWidth || 150) : 0;
    const chipW = hints.chipWidth || 170;
    const depthW = hints.sideWidth || 210;
    const rightW = isIntraday ? depthW : (chipsOn ? chipW : 0);
    const rightX = width - rightW;
    // 分时模式：画布最左侧 54px 给全局左坐标栏，竞价列右移，中列不再内嵌左留白
    const leftBar = isIntraday ? AXIS_GUTTER_L : 0;
    const mainX = leftBar + auctionW;
    const mainW = Math.max(120, width - mainX - rightW);

    const mainH = Math.round(height * 0.5);   // 主图略收，把更多高度让给副图区
    this.mainH = mainH;
    const subH = height - mainH;

    // 中列：主图 1 个 + 副图若干（至少一个）
    const drawables = this.panes.filter((p) => typeof p.buildGeometry === 'function');
    const price = drawables.find((p) => p.tagName.toLowerCase() === 'price-pane');
    let subs = drawables.filter((p) => p !== price && p.tagName.toLowerCase() !== 'chip-pane' && !p.hasAttribute('hidden'));
    if (!subs.length) {
      const first = drawables.find((p) => p.tagName.toLowerCase() === 'indicator-pane');
      if (first) { first.removeAttribute('hidden'); subs = [first]; }
    }
    if (price) price.rect = { x: mainX, y: 0, w: mainW, h: mainH } as SubplotLayout;
    const pctSum = subs.reduce((s, p) => s + (parseFloat(p.getAttribute('height')!) || 0), 0) || 100;
    const allSubs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    this.infoBars = [];
    let y = mainH;
    subs.forEach((p, idx) => {
      const pct = parseFloat(p.getAttribute('height')!) || 0;
      const slotH = idx === subs.length - 1 ? height - y : (subH * pct) / pctSum;
      // 每个副图上方预留独立信息栏，绘图区整体下移
      p.rect = { x: mainX, y: y + SUBPLOT_INFO_H, w: mainW,
        h: Math.max(1, slotH - SUBPLOT_INFO_H) } as SubplotLayout;
      this.infoBars.push({ x: mainX, y, w: mainW, h: SUBPLOT_INFO_H,
        index: allSubs.indexOf(p), indicator: (p.getAttribute('indicator') || 'VOL').toUpperCase() });
      y += slotH;
    });
    this.firstSubPane = subs[0] || null;
    // 竞价列下半部 = 第一个副图的整个槽位（18px 信息栏 + 绘图区），上下边沿严格对齐；其下留白
    const firstSlotH = (subs[0]?.rect!.h || subH - SUBPLOT_INFO_H) + SUBPLOT_INFO_H;
    for (const p of drawables) {
      if (p !== price && !subs.includes(p) && p.tagName.toLowerCase() !== 'chip-pane') p.rect = null;
    }

    // 左列：开盘竞价
    this.auctionPriceRect = auctionOn ? { x: leftBar, y: 0, w: auctionW, h: mainH } : null;
    this.auctionVolumeRect = auctionOn
      ? { x: leftBar, y: mainH, w: auctionW, h: firstSlotH } : null;
    // 中列右端：尾盘竞价（14:57–15:00），与连续竞价时间轴相邻。
    // 宽度按「与开盘竞价列相同的每节点像素密度」换算：150px/69点 × 21点 ≈ 46px，
    // 两段视觉比例一致（而非占主图固定百分比）。
    const showClosing = auctionOn && this.closeAuction.length > 0 && this.openAuction.length > 0;
    this.closingW = showClosing
      ? Math.max(32, Math.round(auctionW * (this.closeAuction.length / this.openAuction.length)))
      : 0;
    const cx = mainX + mainW - AXIS_GUTTER_R - this.closingW;   // 右侧坐标留白让给刻度
    this.closingPriceRect = showClosing ? { x: cx, y: 0, w: this.closingW, h: mainH } : null;
    this.closingVolumeRect = showClosing
      ? { x: cx, y: mainH, w: this.closingW, h: firstSlotH } : null;

    if (chip) chip.rect = chipsOn ? { x: rightX, y: 0, w: rightW, h: mainH } as SubplotLayout : null;
    this.sideRect = isIntraday
      ? { x: rightX, y: 0, w: rightW, h: height, content: 'depth' }
      : (chipsOn ? { x: rightX, y: mainH, w: rightW, h: height - mainH, content: 'chips' } : null);
    this.host.updateSide?.(this.sideRect);
    this.emit('layout-change', { bars: this.getSubplotLayout() });
    this.requestRender();
  }

  requestRender() {
    if (this.dirty) return;
    this.dirty = true;
    this.frame = requestAnimationFrame(() => { this.dirty = false; this.render(); });
  }

  /** 每帧在自己的色板作用域内渲染，帧后还原全局色板，保证多实例不串色 */
  render() {
    withPalette(this.palette, () => this.renderFrame());
  }

  renderFrame() {
    const active = this.dataset
      ? this.panes.filter((p) => p.isConnected && p.rect && typeof p.buildGeometry === 'function')
      : [];
    // price-pane 先执行：它计算 priceScale，两段竞价与筹码峰都复用同一价格轴
    const pricePane = active.find((p) => p.tagName.toLowerCase() === 'price-pane');
    const ordered = pricePane ? [pricePane, ...active.filter((p) => p !== pricePane)] : active;
    const geometries: GeometryBatch[] = ordered.map((p) => ({ rect: p.rect, vertices: p.buildGeometry!(this) || [] }));

    if (this.priceScale.max > this.priceScale.min) {
      if (this.auctionPriceRect && this.openAuction.length) {
        const { priceVerts, volVerts } = buildPhaseGeometry(this, this.auctionPriceRect, this.auctionVolumeRect,
          this.openAuction, { dividerRatio: 0.5, hover: this.auctionHover });
        geometries.push({ rect: this.auctionPriceRect, vertices: priceVerts });
        geometries.push({ rect: this.auctionVolumeRect, vertices: volVerts });
      }
      if (this.closingPriceRect && this.closeAuction.length) {
        const { priceVerts, volVerts } = buildPhaseGeometry(this, this.closingPriceRect, this.closingVolumeRect,
          this.closeAuction, { leftEdge: true, hover: this.closingHover, gutter: 0 });
        geometries.push({ rect: this.closingPriceRect, vertices: priceVerts });
        geometries.push({ rect: this.closingVolumeRect, vertices: volVerts });
      }
    }
    // 分时模式：画布最左侧的全局左坐标栏，主图与所有副图共用（底层绘制）
    if (this.mode === 'intraday' && this.size) {
      const bar: number[] = [];
      rect(bar, 0, 0, AXIS_GUTTER_L, this.size.h, rgba(PALETTE.panel, 0.8));
      line(bar, AXIS_GUTTER_L - 0.5, 0, AXIS_GUTTER_L - 0.5, this.size.h, 1, rgba(PALETTE.grid));
      geometries.unshift({ rect: { x: 0, y: 0, w: AXIS_GUTTER_L, h: this.size.h }, vertices: bar });
    }
    // 两种模式都画统一时间轴带（浅灰底 + 上细线）：分时段贯穿竞价列 + 连续竞价 + 尾盘段，
    // K 线段贯穿中列；数据绘图区已同步上移 18px，周期切换后日期刻度也落在这条带上
    if (this.size && this.mainH > 18) {
      const band: number[] = [];
      const y0 = this.mainH - 18, x1 = this.sideRect?.x ?? this.size.w;
      rect(band, 0, y0, x1, this.mainH, rgba(PALETTE.band));
      line(band, 0, y0, x1, y0, 1, rgba(PALETTE.grid));
      geometries.push({ rect: { x: 0, y: y0, w: x1, h: 18 }, vertices: band });
    }
    // 竞价列只铺到第一个副图槽位；其下的左右留白延续同一灰底，避免副图区出现白/浅色断层
    if (this.mode === 'intraday' && this.size && (this.auctionPriceRect || this.closingPriceRect)) {
      const tailY = this.mainH + (this.auctionVolumeRect?.h || 0);
      const tailH = this.size.h - tailY;
      if (tailH > 0) {
        const blank: number[] = [], bg = rgba(PALETTE.band);
        for (const col of [this.auctionPriceRect, this.closingPriceRect]) {
          if (col) rect(blank, col.x, tailY, col.x + col.w, this.size.h, bg);
        }
        if (blank.length) geometries.push({ rect: { x: 0, y: tailY, w: this.size.w, h: tailH }, vertices: blank });
      }
    }
    // 主图区 / 副图区分界线：贯穿全画布，最后绘制以免被 pane 背景覆盖
    if (this.size && this.mainH > 0) {
      const divider: number[] = [];
      // 与副图信息栏的 inset 1px #ECEEF1 分隔线完全同款：竞价列 / 分时图 / 右列统一，
      // 不再用 1.5px 深灰线让竞价侧显得更粗
      line(divider, 0, this.mainH, this.size.w, this.mainH, 1, rgba(PALETTE.grid));
      geometries.push({ rect: { x: 0, y: 0, w: this.size.w, h: this.size.h }, vertices: divider });
    }
    this.renderer!.render(geometries as Array<{ rect: Rect; vertices: number[] }>);
    this.renderOverlay(active);
  }

  renderOverlay(panes: PaneElementLike[]) {
    if (!this.overlay) return;
    // 字体统一 11px；bar=true 的标题项用与副图信息栏一致的浅灰轻量条；align=right 让左栏刻度贴边
    const span: SpanFn = (x, y, text, color, bar, align) =>
      `<span style="position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;color:${color};font:11px/1.4 system-ui,-apple-system,sans-serif;white-space:nowrap;pointer-events:none;${align === 'right' ? 'transform:translateX(-100%);' : ''}${bar ? 'background:var(--sc-panel,#FAFBFC);border-bottom:1px solid var(--sc-line,#ECEEF1);padding:1px 6px;border-radius:2px;' : ''}">${text}</span>`;
    const parts: string[] = [];
    for (const p of panes) {
      if (typeof p.overlayText !== 'function') continue;
      for (const t of p.overlayText!(this) || []) parts.push(span(t.x, t.y, t.text, t.color, t.bg, t.align));
    }

    if (this.auctionPriceRect && this.auctionVolumeRect && this.openAuction.length) {
      const r = this.auctionPriceRect, v = this.auctionVolumeRect;
      segmentOverlay(this, parts, span, {
        r, v, pts: this.openAuction, title: '',   // 竞价段顶部不再显示「集合竞价」标题
        // 9:25 去掉：与主图 9:30 起点标签相邻会重叠，时间轴在 9:30 处接续
        ticks: [
          { x: r.x + 4, text: '9:15' }, { x: r.x + r.w * 0.5 - 14, text: '9:20' },
        ],
        hover: this.auctionHover, hoverTitle: '竞价', floatLeft: false,
        basePrice: this.dataset!.manifest.preClose, pctLabel: '较昨收',
        phaseOf: (p: AuctionPoint) => (Number(p.time.slice(3, 5)) <= 19 ? '可撤单时段' : '不可撤单时段'),
      });
    }
    if (this.closingPriceRect && this.closingVolumeRect && this.closeAuction.length) {
      const r = this.closingPriceRect, v = this.closingVolumeRect;
      segmentOverlay(this, parts, span, {
        r, v, pts: this.closeAuction, title: '尾盘竞价',
        compact: true,   // 窄段不显示标题 / 数字刻度，避免与坐标栏挤压
        ticks: [],   // 收盘 15:00 由主图时间轴右端统一标注，避免与右侧百分比刻度挤压
        hover: this.closingHover, hoverTitle: '尾盘竞价', floatLeft: true,
        basePrice: this.closeAuction[0].virtualPrice, pctLabel: '较14:57',
        phaseOf: () => '不可撤单时段',
      });
    }
    // ---- 十字光标坐标轴定位标签：以鼠标精确位置为中心，主图与副图都覆盖 ----
    const pt = this.pointer;
    if (pt && this.dataset && this.size) {
      const tag = (left: number, top: number, w: number, text: string, bg?: string | null) =>
        `<span style="position:absolute;left:${Math.round(left)}px;top:${Math.round(top)}px;width:${Math.round(w)}px;box-sizing:border-box;background:${bg || 'var(--sc-text,#3B424D)'};color:var(--sc-bg,#fff);font:11px/16px system-ui,-apple-system,sans-serif;text-align:center;border-radius:2px;padding:0 3px;white-space:nowrap;pointer-events:none">${text}</span>`;
      const clampY = (y: number, r: Rect) => Math.max(r.y + 1, Math.min(r.y + r.h - 17, y - 8));
      const pricePane = panes.find((p) => p.tagName.toLowerCase() === 'price-pane');
      const gutterX = this.mode === 'intraday' ? 0 : (pricePane?.rect?.x ?? 0);
      // 主图：左栏价格标签；分时额外在右栏显示涨跌幅（红涨绿跌）
      // 只有鼠标落在主图区内才显示价格标签，避免在副图时被 clamp 到轴底反算出超范围数值
      if (pricePane?.rect && pt.y >= pricePane.rect.y && pt.y <= pricePane.rect.y + pricePane.rect.h) {
        const pv = (pricePane as PriceAxisPane).axisValueAt?.(pt.y, this);
        if (pv) {
          parts.push(tag(gutterX, clampY(pt.y, pricePane.rect), AXIS_GUTTER_L, pv.price.toFixed(2)));
          if (pv.pct != null) {
            const r = pricePane.rect;
            const c = pv.pct > 0.001 ? PALETTE.up : (pv.pct < -0.001 ? PALETTE.down : null);
            parts.push(tag(r.x + r.w - AXIS_GUTTER_R, clampY(pt.y, r), AXIS_GUTTER_R,
              `${pv.pct >= 0 ? '+' : ''}${pv.pct.toFixed(2)}%`, c));
          }
        }
      }
      // 副图：鼠标所在副图的左栏显示该指标在鼠标 y 处的数值（复用刻度缩放单位）
      if (pt.y > this.mainH) {
        for (const p of panes) {
          if (p.tagName.toLowerCase() !== 'indicator-pane' || !p.rect) continue;
          const r = p.rect;
          if (pt.y < r.y || pt.y > r.y + r.h) continue;
          const v = (p as ValueAxisPane).axisValueAt?.(pt.y);
          if (v != null) parts.push(tag(gutterX, clampY(pt.y, r), AXIS_GUTTER_L, v));
          break;
        }
      }
      // 时间轴：标签水平位置跟随鼠标 x，内容取当前数据点的时间 / 日期
      if (this.crosshair != null) {
        const item = this.getSeries()[this.crosshair];
        if (item) {
          const w = this.mode === 'intraday' ? 52 : 84;
          const text = this.mode === 'intraday' ? (item as IntradayPoint).time : (item as Bar).tradeDate;
          const left = Math.max(2, Math.min(this.size.w - w - 2, pt.x - w / 2));
          parts.push(tag(left, this.mainH - 18, w, text));
        }
      }
    }
    this.overlay.innerHTML = parts.join('');
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.renderer!.destroy();
  }
}
