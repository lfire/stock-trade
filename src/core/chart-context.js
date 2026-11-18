// ChartContext：viewport / priceScale / crosshair / 色板 / 计算引擎的单一真源。
// 三列两行区域规划：
//   左列 = 开盘集合竞价 9:15–9:25（上价格 / 下挂单量+成交量），仅分时且开启时显示
//   中列 = 上主图（连续竞价 9:30–15:00 或 K 线）+ 右端尾盘竞价 14:57–15:00 放大列 + 下多个副图
//   右列 = 上筹码峰横条（K 线且开启）+ 下筹码统计；分时模式右列给十档盘口
import { PALETTE, AXIS_GUTTER_L, AXIS_GUTTER_R, LAYOUT, withPalette } from '../types.js';
import { rgba, rect, line } from '../gl/geometry.js';
import { buildPhaseGeometry } from './auction-layer.js';
import { createComputeEngine } from '../compute/engine.js';
import { WebGL2Renderer } from '../gl/renderer.js';
import { PERIODS, PERIOD_LABEL, buildBars } from './bar-aggregator.js';

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
function segmentOverlay(ctx, parts, span, cfg) {
  const { r, v, pts, title, ticks, hover, hoverTitle, basePrice, pctLabel, phaseOf, floatLeft,
    compact } = cfg;
  // 窄段（尾盘竞价）不显示标题，避免与主图右坐标栏的百分比刻度挤压
  // 与副图信息栏一致：浅灰轻量标题条、灰色细体，时间范围由下方刻度承担不再重复
  if (!compact) parts.push(span(r.x + 3, r.y + 2, title, PALETTE.textMuted, true));
  ticks.forEach((t) => parts.push(span(t.x, r.y + r.h - 16, t.text, PALETTE.textMuted)));   // 与主图时间轴同一基线

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
  constructor(host) {
    this.host = host;
    this.canvas = host.canvas;
    this.overlay = host.overlay;
    this.renderer = new WebGL2Renderer(this.canvas);
    this.compute = createComputeEngine();
    this.palette = { ...PALETTE };   // 实例色板；渲染帧内临时生效，不污染全局
    this.dataset = null;
    this.size = null;
    this.mode = 'candle';
    this.period = '1d';               // K 线周期键，见 PERIODS
    this.barsCache = new Map();       // 各周期聚合结果缓存
    this.panes = [];
    this.viewport = { start: 0, end: 0 };
    this.priceScale = { min: 0, max: 0 };
    this.crosshair = null;
    this.auctionHover = null;         // 开盘竞价列 hover 索引
    this.closingHover = null;         // 尾盘竞价段 hover 索引
    this.chipMode = 'histogram';
    this.maConfig = defaultMA(this.palette);      // K 线均线配置的单一真源（取实例色板）
    this.firstSubPane = null;         // 当前第一个可见副图（恒为成交量，与竞价列共用刻度）
    this.infoBars = [];               // 各副图上方信息栏的位置与指标
    this.pointer = null;              // 鼠标精确像素位置 {x,y}，坐标轴定位标签以它为中心
    this.auctionEnabled = true;       // 同时控制开盘 / 尾盘两段竞价
    this.chipsEnabled = true;
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

  registerPane(el) {
    if (!this.panes.includes(el)) this.panes.push(el);
    this.applyLayout();
  }
  unregisterPane(el) { this.panes = this.panes.filter((p) => p !== el); this.applyLayout(); }

  emit(name, detail) {
    this.host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  setDataset(dataset) {
    this.dataset = dataset;
    this.barsCache.clear();
    const all = dataset.auction || [];
    this.openAuction = all.filter((p) => p.phase === 'open');
    this.closeAuction = all.filter((p) => p.phase === 'close');
    this.resetViewport();
    this.applyLayout();               // 尾盘竞价段依赖 closeAuction，数据到达后必须重新布局
    this.emit('data-loaded', { symbol: dataset.manifest.symbol, tradeDate: dataset.manifest.tradeDate });
    this.requestRender();
  }

  setMode(mode) {
    if (mode !== 'candle' && mode !== 'intraday') return;
    // 第一个副图恒为成交量，K 线 / 分时都不可修改（防御性校正）
    const subs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    if (subs[0] && (subs[0].getAttribute('indicator') || '').toUpperCase() !== 'VOL') {
      subs[0].setAttribute('indicator', 'VOL');
    }
    this.mode = mode;
    this.resetViewport();
    this.applyLayout();
    this.emit('viewport-change', { ...this.viewport, mode });
    this.emit('subplot-config-change', { config: this.getSubplotConfig() });
    this.requestRender();
  }

  setChipMode(mode) {
    if (mode !== 'stat' && mode !== 'histogram') return;
    this.chipMode = mode;
    this.emit('chip-mode-change', { mode });
    this.requestRender();
  }

  // ---- K 线均线配置：可添加、删除、改周期 / 颜色 ----
  /** 整体替换；period 规整为正整数并去重，最多 8 条，返回新配置 */
  setMA(list) {
    const seen = new Set();
    this.maConfig = (Array.isArray(list) ? list : []).slice(0, 8).map((m) => {
      let period = Math.max(1, Math.round(Number(m.period) || 5));
      while (seen.has(period)) period += 1;
      seen.add(period);
      const color = /^#[0-9A-Fa-f]{6}$/.test(m.color || '') ? m.color : PALETTE.avg;
      return { period, color };
    });
    this.emit('ma-config-change', { list: this.maConfig });
    this.requestRender();
    return this.maConfig;
  }
  addMA(cfg) { return this.setMA([...this.maConfig, cfg || {}]); }
  removeMA(period) { return this.setMA(this.maConfig.filter((m) => m.period !== Number(period))); }
  updateMA(period, patch) {
    return this.setMA(this.maConfig.map((m) => (m.period === Number(period) ? { ...m, ...patch } : m)));
  }

  /** 竞价开关（同时控制开盘 9:15–9:25 与尾盘 14:57–15:00，仅分时模式生效） */
  setAuctionEnabled(on) {
    this.auctionEnabled = !!on;
    this.emit('auction-toggle', { enabled: this.auctionEnabled });
    this.applyLayout();
  }

  setChipsEnabled(on) {
    this.chipsEnabled = !!on;
    this.emit('chips-toggle', { enabled: this.chipsEnabled });
    this.applyLayout();
  }

  setSubplotCount(n) {
    const subs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    subs.forEach((p, i) => { if (i < n) p.removeAttribute('hidden'); else p.setAttribute('hidden', ''); });
    this.applyLayout();
    this.emit('subplot-config-change', { config: this.getSubplotConfig() });
  }

  /** 所有副图的当前配置（含隐藏的），按 DOM 顺序返回，index 可用于 setSubplotIndicator */
  getSubplotConfig() {
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
  getSubplotLayout() {
    return (this.infoBars || []).map((b) => ({ ...b }));
  }

  /** 单独切换某一个副图的指标；非法名称忽略 */
  setSubplotIndicator(index, name) {
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
    if (!this.barsCache.has(this.period)) this.barsCache.set(this.period, buildBars(this.dataset, this.period));
    return this.barsCache.get(this.period);
  }

  /** 切换 K 线周期：重算序列、重置视口、清空光标 */
  setPeriod(period) {
    const p = PERIODS.some((x) => x.key === period) ? period : '1d';
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

  /** 分时主图画到 15:00 收盘（含 14:58/14:59 价有量无与 15:00 统一撮合）；
   *  15:01–15:30 盘后固定价段不画。14:57–15:00 的 9 秒级虚拟撮合仍由独立尾盘竞价列放大绘制。 */
  getSeries() {
    if (!this.dataset) return [];
    if (this.mode !== 'intraday') return this.getBars();
    const arr = this.dataset.intraday;
    const cut = arr.findIndex((p) => p.time > '15:00');
    return cut < 0 ? arr : arr.slice(0, cut);
  }
  getVisible() { return this.getSeries().slice(this.viewport.start, this.viewport.end); }
  visibleCount() { return Math.max(1, this.viewport.end - this.viewport.start); }

  mainRect() { return this.panes.find((p) => p.tagName.toLowerCase() === 'price-pane')?.rect || null; }

  /** 中列 pane 内是否还要预留左坐标栏；分时模式左栏移到画布最左侧，故为 0 */
  leftInset() {
    return this.mode === 'intraday' ? 0 : AXIS_GUTTER_L;
  }

  /** 中间绘图区宽度：扣掉左右坐标留白，分时再扣尾盘竞价段 */
  plotWidth(r) {
    const closing = this.mode === 'intraday' && this.closingW > 0 ? this.closingW : 0;
    return Math.max(60, r.w - this.leftInset() - AXIS_GUTTER_R - closing);
  }

  /** 中间绘图区矩形：所有数据（K 线 / 分时线 / 量柱 / 均线 / 网格）只画在这里 */
  plotRect(r) {
    return { x: r.x + this.leftInset(), y: r.y, w: this.plotWidth(r), h: r.h };
  }

  xForIndex(i, rect) {
    const pr = this.plotRect(rect);
    return pr.x + ((i - this.viewport.start) + 0.5) * (pr.w / this.visibleCount());
  }

  /** 分时图半小时刻度：返回落在当前 viewport 内的 { x, time }，主图与副图共用同一组 x */
  halfHourMarks(rect) {
    if (this.mode !== 'intraday' || !this.dataset) return [];
    const s = this.getSeries();
    const marks = ['09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30'];
    const out = [];
    for (const t of marks) {
      const i = s.findIndex((p) => p.time === t);
      if (i < this.viewport.start || i >= this.viewport.end) continue;
      out.push({ x: this.xForIndex(i, rect), time: t });
    }
    return out;
  }

  indexAtX(x) {
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
  auctionIndexAtX(x) {
    const r = this.auctionPriceRect;
    if (!r || !this.openAuction.length || x < r.x || x > r.x + r.w) return null;
    const n = this.openAuction.length;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - r.x) / r.w) * n)));
  }

  /** 尾盘竞价段 x 命中的节点索引 */
  closingIndexAtX(x) {
    const r = this.closingPriceRect;
    if (!r || !this.closeAuction.length || x < r.x || x > r.x + r.w) return null;
    const n = this.closeAuction.length;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - r.x) / r.w) * n)));
  }

  setAuctionHover(index) {
    if (index === this.auctionHover) return;
    this.auctionHover = index;
    this.emit('auction-hover', { index, point: index != null ? this.openAuction[index] || null : null });
    this.requestRender();
  }

  setClosingHover(index) {
    if (index === this.closingHover) return;
    this.closingHover = index;
    this.emit('closing-hover', { index, point: index != null ? this.closeAuction[index] || null : null });
    this.requestRender();
  }

  setCrosshair(index) {
    if (index === this.crosshair) return;
    this.crosshair = index;
    const item = this.getSeries()[index] || null;
    this.emit('crosshair-change', { index, item, mode: this.mode });
    this.requestRender();
  }

  /** 记录鼠标精确像素位置；坐标轴定位标签与水平十字线以它为中心 */
  setPointer(x, y) {
    const p = x == null ? null : { x, y };
    if (this.pointer?.x === p?.x && this.pointer?.y === p?.y) return;
    this.pointer = p;
    this.requestRender();
  }

  panBy(delta) {
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

  zoomBy(factor, anchor = 0.5) {
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

  layout(width, height) {
    this.size = { w: width, h: height };
    this.renderer.resize(width, height);
    this.applyLayout();
  }

  applyLayout() {
    if (!this.size) return;
    const { w: width, h: height } = this.size;
    const isIntraday = this.mode === 'intraday';
    const auctionOn = this.auctionEnabled && isIntraday;
    const chipsOn = this.chipsEnabled && !isIntraday;

    // 布局尺寸由 element 层读取 DOM 后以结构化 hints 传入，core 不再反向 querySelector
    const chip = this.panes.find((p) => p.tagName.toLowerCase() === 'chip-pane');
    const hints = this.host.getLayoutHints?.() || {};
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
    if (price) price.rect = { x: mainX, y: 0, w: mainW, h: mainH };
    const pctSum = subs.reduce((s, p) => s + (parseFloat(p.getAttribute('height')) || 0), 0) || 100;
    const allSubs = this.panes.filter((p) => p.tagName.toLowerCase() === 'indicator-pane');
    this.infoBars = [];
    let y = mainH;
    subs.forEach((p, idx) => {
      const pct = parseFloat(p.getAttribute('height')) || 0;
      const slotH = idx === subs.length - 1 ? height - y : (subH * pct) / pctSum;
      // 每个副图上方预留独立信息栏，绘图区整体下移
      p.rect = { x: mainX, y: y + SUBPLOT_INFO_H, w: mainW,
        h: Math.max(1, slotH - SUBPLOT_INFO_H) };
      this.infoBars.push({ x: mainX, y, w: mainW, h: SUBPLOT_INFO_H,
        index: allSubs.indexOf(p), indicator: (p.getAttribute('indicator') || 'VOL').toUpperCase() });
      y += slotH;
    });
    this.firstSubPane = subs[0] || null;
    // 竞价列下半部 = 第一个副图的整个槽位（18px 信息栏 + 绘图区），上下边沿严格对齐；其下留白
    const firstSlotH = (subs[0]?.rect.h || subH - SUBPLOT_INFO_H) + SUBPLOT_INFO_H;
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

    if (chip) chip.rect = chipsOn ? { x: rightX, y: 0, w: rightW, h: mainH } : null;
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
    const geometries = ordered.map((p) => ({ rect: p.rect, vertices: p.buildGeometry(this) || [] }));

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
      const bar = [];
      rect(bar, 0, 0, AXIS_GUTTER_L, this.size.h, rgba(PALETTE.panel, 0.8));
      line(bar, AXIS_GUTTER_L - 0.5, 0, AXIS_GUTTER_L - 0.5, this.size.h, 1, rgba(PALETTE.grid));
      geometries.unshift({ rect: { x: 0, y: 0, w: AXIS_GUTTER_L, h: this.size.h }, vertices: bar });
    }
    // 两种模式都画统一时间轴带（浅灰底 + 上细线）：分时段贯穿竞价列 + 连续竞价 + 尾盘段，
    // K 线段贯穿中列；数据绘图区已同步上移 18px，周期切换后日期刻度也落在这条带上
    if (this.size && this.mainH > 18) {
      const band = [];
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
        const blank = [], bg = rgba(PALETTE.band);
        for (const col of [this.auctionPriceRect, this.closingPriceRect]) {
          if (col) rect(blank, col.x, tailY, col.x + col.w, this.size.h, bg);
        }
        if (blank.length) geometries.push({ rect: { x: 0, y: tailY, w: this.size.w, h: tailH }, vertices: blank });
      }
    }
    // 主图区 / 副图区分界线：贯穿全画布，最后绘制以免被 pane 背景覆盖
    if (this.size && this.mainH > 0) {
      const divider = [];
      // 与副图信息栏的 inset 1px #ECEEF1 分隔线完全同款：竞价列 / 分时图 / 右列统一，
      // 不再用 1.5px 深灰线让竞价侧显得更粗
      line(divider, 0, this.mainH, this.size.w, this.mainH, 1, rgba(PALETTE.grid));
      geometries.push({ rect: { x: 0, y: 0, w: this.size.w, h: this.size.h }, vertices: divider });
    }
    this.renderer.render(geometries);
    this.renderOverlay(active);
  }

  renderOverlay(panes) {
    if (!this.overlay) return;
    // 字体统一 11px；bar=true 的标题项用与副图信息栏一致的浅灰轻量条；align=right 让左栏刻度贴边
    const span = (x, y, text, color, bar, align) =>
      `<span style="position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;color:${color};font:11px/1.4 system-ui,-apple-system,sans-serif;white-space:nowrap;pointer-events:none;${align === 'right' ? 'transform:translateX(-100%);' : ''}${bar ? 'background:var(--sc-panel,#FAFBFC);border-bottom:1px solid var(--sc-line,#ECEEF1);padding:1px 6px;border-radius:2px;' : ''}">${text}</span>`;
    const parts = [];
    for (const p of panes) {
      if (typeof p.overlayText !== 'function') continue;
      for (const t of p.overlayText(this) || []) parts.push(span(t.x, t.y, t.text, t.color, t.bg, t.align));
    }

    if (this.auctionPriceRect && this.auctionVolumeRect && this.openAuction.length) {
      const r = this.auctionPriceRect, v = this.auctionVolumeRect;
      segmentOverlay(this, parts, span, {
        r, v, pts: this.openAuction, title: '集合竞价',
        // 9:25 去掉：与主图 9:30 起点标签相邻会重叠，时间轴在 9:30 处接续
        ticks: [
          { x: r.x + 4, text: '9:15' }, { x: r.x + r.w * 0.5 - 14, text: '9:20' },
        ],
        hover: this.auctionHover, hoverTitle: '集合竞价', floatLeft: false,
        basePrice: this.dataset.manifest.preClose, pctLabel: '较昨收',
        phaseOf: (p) => (Number(p.time.slice(3, 5)) <= 19 ? '可撤单时段' : '不可撤单时段'),
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
      const tag = (left, top, w, text, bg) =>
        `<span style="position:absolute;left:${Math.round(left)}px;top:${Math.round(top)}px;width:${Math.round(w)}px;box-sizing:border-box;background:${bg || 'var(--sc-text,#3B424D)'};color:var(--sc-bg,#fff);font:11px/16px system-ui,-apple-system,sans-serif;text-align:center;border-radius:2px;padding:0 3px;white-space:nowrap;pointer-events:none">${text}</span>`;
      const clampY = (y, r) => Math.max(r.y + 1, Math.min(r.y + r.h - 17, y - 8));
      const pricePane = panes.find((p) => p.tagName.toLowerCase() === 'price-pane');
      const gutterX = this.mode === 'intraday' ? 0 : (pricePane?.rect?.x ?? 0);
      // 主图：左栏价格标签；分时额外在右栏显示涨跌幅（红涨绿跌）
      // 只有鼠标落在主图区内才显示价格标签，避免在副图时被 clamp 到轴底反算出超范围数值
      if (pricePane?.rect && pt.y >= pricePane.rect.y && pt.y <= pricePane.rect.y + pricePane.rect.h) {
        const pv = pricePane.axisValueAt?.(pt.y, this);
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
          const v = p.axisValueAt?.(pt.y);
          if (v != null) parts.push(tag(gutterX, clampY(pt.y, r), AXIS_GUTTER_L, v));
          break;
        }
      }
      // 时间轴：标签水平位置跟随鼠标 x，内容取当前数据点的时间 / 日期
      if (this.crosshair != null) {
        const item = this.getSeries()[this.crosshair];
        if (item) {
          const w = this.mode === 'intraday' ? 52 : 84;
          const text = this.mode === 'intraday' ? item.time : item.tradeDate;
          const left = Math.max(2, Math.min(this.size.w - w - 2, pt.x - w / 2));
          parts.push(tag(left, this.mainH - 18, w, text));
        }
      }
    }
    this.overlay.innerHTML = parts.join('');
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.renderer.destroy();
  }
}
