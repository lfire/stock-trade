// 根容器：唯一 WebGL2 context / viewport / priceScale / crosshair 的持有者。
// 画布由单 canvas + scissor 分区绘制；pane 元素只作为配置节点，不产生可见 DOM。
import { ChartContext, SUBPLOT_INDICATORS } from '../core/chart-context';
export { SUBPLOT_INDICATORS };
import { loadDataset } from '../core/data-store';
import { PALETTE, LAYOUT, resolveTheme } from '../types';
import type {
  ChartDataset, ChartMode, ChipMode, DepthUnit, MACDParams, MAConfig, Viewport,
  SideRect, NumericInput, DetailData, Palette, PaneElementLike, DepthBookSnapshot,
  SubplotLayout, SubplotConfig, ChartContextFacade, StockChartEventMap,
} from '../types';
import { chipSnapshotAt } from './chip-pane';
import { adaptiveMAPeriods, parseMACDParams, resolveMACDParams, maParamsText, macdParamsText } from '../core/indicator-params';
import { emitEvent, CHART_EVENTS } from '../events';
import { shortNum } from '../algorithms/format';

interface DefaultMAItem { idx: number; key: string; explicit: boolean; }
interface DepthSlotElement extends HTMLElement {
  levels?: number;
  setCompact?: (on: boolean | undefined) => void;
}
interface IndicatorPoint {
  value?: number | null;
  macd?: number | null; dif?: number | null; dea?: number | null;
  k?: number; d?: number; j?: number;
  [key: string]: unknown;
}
interface IndicatorResult { values: IndicatorPoint[]; }

const PANE_SELECTOR = 'price-pane, indicator-pane, chip-pane, auction-pane';
/** 声明式 <ma-line> 未给 color 时依次取色板中的这三项，换主题时按同一组键刷新 */
const MA_DEFAULT_KEYS = ['avg', 'chipLoss', 'limitDownBroken'];
const IND_LABEL: Record<string, string> = { VOL: '成交量', AMOUNT: '成交额', MACD: 'MACD', KDJ: 'KDJ', VOL_RATIO: '量比' };
// shortNum 收口到 algorithms/format（与算法单元单一实现一致，签名/口径完全相同，直接替换）。
// 副图信息栏样式随组件自带，脱离示例页也能正确渲染（选择器限定在 #pane-bars 内）
const PANE_BARS_CSS = `
#pane-bars{position:absolute;inset:0;pointer-events:none;z-index:5}
#pane-bars .pane-bar{position:absolute;display:flex;align-items:center;gap:10px;padding:0 10px;box-sizing:border-box;background:var(--sc-panel,#FAFBFC);box-shadow:inset 0 1px 0 var(--sc-line,#E3E6EB);font:11px/16px system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--sc-muted,#6B7280);white-space:nowrap;overflow:hidden;pointer-events:auto}
#pane-bars .pane-bar select{-webkit-appearance:none;appearance:none;box-sizing:border-box;height:var(--sc-row-h,18px);margin:0;padding:0 18px 0 6px;font:500 11px/16px system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--sc-text,#1F2329);background-color:transparent;background-image:linear-gradient(45deg,transparent 50%,var(--sc-muted,#8A93A0) 50%),linear-gradient(135deg,var(--sc-muted,#8A93A0) 50%,transparent 50%);background-position:calc(100% - 11px) 7px,calc(100% - 7px) 7px;background-size:4px 4px,4px 4px;background-repeat:no-repeat;border:0;border-radius:3px;min-width:72px;cursor:pointer;outline:none}
#pane-bars .pane-bar select:disabled{color:var(--sc-muted,#6B7280);cursor:default;background-color:var(--sc-panel,#F2F4F7)}
#pane-bars .pane-bar .vals{color:var(--sc-muted,#6B7280);line-height:16px;overflow:hidden;text-overflow:ellipsis}
#pane-bars .pane-bar .vals b{font-weight:500;color:var(--sc-text,#1F2329)}
`;

/**
 * 强类型事件重载：与 class 同名 interface 合并，只影响类型、编译后不产出任何 JS。
 * 原先由手写 index.d.ts 提供，切换 TS 后必须显式声明，否则消费者只能拿到基类 Event。
 */
export interface StockChart {
  addEventListener<K extends keyof StockChartEventMap>(
    type: K, listener: (this: StockChart, ev: StockChartEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof StockChartEventMap>(
    type: K, listener: (this: StockChart, ev: StockChartEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export class StockChart extends HTMLElement {
  declare ctx: ChartContext | null;
  declare canvas: HTMLCanvasElement | null;
  declare overlay: HTMLDivElement | null;
  declare ro: ResizeObserver | null;
  declare _abort: AbortController | null;
  declare _sideMo: MutationObserver | null;
  declare _defaultMA: DefaultMAItem[];
  declare barsStyle: HTMLStyleElement | null;
  declare dragging: boolean;
  declare lastX: number | null;
  declare onPointerUp: (() => void) | null;
  declare depthScenario: string;
  declare depthUnit: DepthUnit;
  declare detailData: DetailData | null;
  /** 当前盘口场景的全景盘口：与 dataset.depthFull（原始 L1 派生全景）分离，场景切换不污染原始数据 */
  declare scenarioPano: DepthBookSnapshot | null;
  declare paneBars: HTMLElement | null;
  declare theme: string | null;
  declare sideSlot: HTMLElement | null | undefined;
  declare statsEl: HTMLElement | null | undefined;
  declare sideTradeEl: HTMLElement | null | undefined;
  declare depthEl: DepthSlotElement | null | undefined;
  declare sideExpanded: boolean | undefined;
  // symbol/height 不在观察列表：展示用名称由 dataset.manifest 提供，尺寸由 CSS 控制
  static get observedAttributes() {
    return ['dataset', 'mode', 'auction', 'chips', 'theme', 'macd', 'intraday-days', 'period', 'chip-mode'];
  }

  constructor() {
    super();
    this.ctx = null;
    this.canvas = null;
    this.overlay = null;
    this.ro = null;
    this._abort = null;          // 每次连接一组 AbortController，断开时统一撤销所有监听
    this._sideMo = null;         // 侧栏底部条 hidden 变化时重算 4 条行均分
    this._defaultMA = [];        // maConfig 中由组件默认分配颜色的项（主题切换后需刷新）
    this.barsStyle = null;
    this.dragging = false;
    this.lastX = 0;
    this.onPointerUp = () => { this.dragging = false; };   // 具名，disconnectedCallback 可配平移除
    // 场景 / 单位 / L2 明细数据由组件自己持有，页面不再维护平行状态
    this.depthScenario = 'normal';
    this.depthUnit = 'volume';
    this.detailData = null;
    this.scenarioPano = null;
    this.paneBars = null;
    this.theme = null;           // 当前主题名：'light' | 'dark' | 'custom' | 'dataset'
  }

  connectedCallback() {
    if (this.ctx) return;
    // 每次连接的监听共用 signal；断开时 abort 一次即可全部解绑，重连不会叠加
    this._abort = new AbortController();
    const sig = { signal: this._abort!.signal };
    this.style.position = 'relative';
    this.style.display = 'block';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;cursor:crosshair;z-index:1';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2';
    this.canvas = canvas;
    this.overlay = overlay;
    this.prepend(overlay);
    this.prepend(canvas);

    // 右侧 DOM 侧栏：内含页面提供的 <depth-book> 与挂载进来的明细卡片，重连时复用不销毁
    if (!this.sideSlot) {
      const sideSlot = document.createElement('div');
      sideSlot.style.cssText = 'position:absolute;z-index:3;background:var(--sc-bg,#fff);border-left:1px solid var(--sc-line,#E3E6EB);box-shadow:-2px 0 10px rgba(31,35,41,.05);overflow:hidden;box-sizing:border-box;display:none;flex-direction:column';
      this.appendChild(sideSlot);
      const statsEl = document.createElement('div');
      statsEl.style.cssText = 'height:100%;overflow:auto;padding:6px 8px;box-sizing:border-box;font:11px/1.6 system-ui,-apple-system,sans-serif;color:var(--sc-text,#1F2329)';
      sideSlot.appendChild(statsEl);
      // 分时模式右列下半部：交易明细，由页面把卡片挂进来
      const tradeHost = document.createElement('div');
      const tapeMin = LAYOUT.titleH + LAYOUT.headH + LAYOUT.rowH;
      tradeHost.style.cssText = `flex:1 1 32%;min-height:${tapeMin}px;overflow:hidden;display:none;flex-direction:column`;
      sideSlot.appendChild(tradeHost);
      this.sideSlot = sideSlot;
      this.statsEl = statsEl;
      this.sideTradeEl = tradeHost;
    }
    const sideEl = this.querySelector('[slot="side"]') as DepthSlotElement | null;
    // 盘口必须位于侧栏最上方（statsEl / tradeHost 之后）；prepend 对已在首位的元素是 no-op，
    // 首次连接把页面提供的节点搬进来，重连时也不会被挤到末尾。
    if (sideEl && sideEl !== this.sideSlot.firstElementChild) this.sideSlot.prepend(sideEl);
    this.depthEl = sideEl || null;
    // 底部条 hidden 变化（明细展开/收起）后自动重算：页面无论先改 hidden 还是先调
    // setSideExpanded 都能收敛到正确 footerH，不依赖调用顺序
    this._sideMo?.disconnect();
    this._sideMo = new MutationObserver(() => this.syncSideBars());
    this._sideMo.observe(this.sideTradeEl!, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    // 副图信息栏：组件内部创建并自渲染，页面不再持有或注入该 DOM
    const barsStyle = document.createElement('style');
    barsStyle.textContent = PANE_BARS_CSS;
    this.appendChild(barsStyle);
    this.barsStyle = barsStyle;
    const paneBars = document.createElement('div');
    paneBars.id = 'pane-bars';
    this.appendChild(paneBars);
    this.paneBars = paneBars;
    // 五档/十档切换后重新分配右列高度：五档时盘口按内容收缩，明细上移填补留白
    this.addEventListener('depth-levels-change', () => this.updateSide(this.ctx?.sideRect as SideRect | null), sig);
    // K 线光标跨日时同步刷新筹码统计面板（直方图由 render() 重绘时自行取快照）
    this.addEventListener('crosshair-change', () => {
      if (this.ctx?.mode === 'candle' && this.ctx?.chipsEnabled) this.renderChipStats();
    }, sig);
    // 副图信息栏的渲染与刷新完全由组件自己驱动
    this.addEventListener('subplot-config-change', () => this.renderPaneBars(), sig);
    this.addEventListener('layout-change', () => this.renderPaneBars(), sig);
    this.addEventListener('crosshair-change', () => this.updatePaneValues(), sig);
    this.addEventListener('viewport-change', () => this.updatePaneValues(), sig);
    this.addEventListener('data-loaded', () => this.renderPaneBars(), sig);
    // WebGL 资源重建完成后重绘一帧，否则恢复的画布停留在空白
    this.addEventListener('webglcontext-restored', () => this.ctx?.requestRender(), sig);
    paneBars.addEventListener('change', (e: Event) => {
      const idx = Number((e.target as HTMLSelectElement).dataset.pane);
      if (!Number.isNaN(idx)) this.setSubplotIndicator(idx, (e.target as HTMLSelectElement).value);
    }, sig);

    try {
      this.ctx = new ChartContext(this);
    } catch (e: unknown) {
      this.showError(`WebGL2 初始化失败：${(e as Error).message}`);
      return;
    }

    // 初始状态一次性经 configure() 写入（受控），不再逐个直接赋值 ctx 字段
    this.ctx!.configure({
      auctionEnabled: this.getAttribute('auction') !== 'off',
      chipsEnabled: this.getAttribute('chips') !== 'off',
      mode: this.getAttribute('mode') === 'intraday' ? 'intraday' : 'candle',
    });
    // 声明式均线配置：<price-pane><ma-line period="5" color="#F0A020">…</price-pane>
    const maNodes = [...this.querySelectorAll('ma-line')];
    if (maNodes.length) {
      // 未显式给色时按实例色板依次取橙 / 蓝 / 紫，避免示例页写死 hex；
      // 记录这些「默认分配」项，setTheme 后要按新色板刷新
      const pal = this.ctx!.palette;
      const keys = MA_DEFAULT_KEYS;
      this._defaultMA = maNodes
        .map((n, i) => ({ idx: i, key: keys[i % keys.length], explicit: !!n.getAttribute('color') }))
        .filter((x) => !x.explicit);
      this.ctx!.setMovingAverages(maNodes.map((n, i) => ({
        period: Number(n.getAttribute('period')) || 5,
        color: n.getAttribute('color') || pal[keys[i % keys.length] as keyof Palette],
      })));
    }
    this.querySelectorAll(PANE_SELECTOR).forEach((p: Element) => (p as PaneElementLike).connect?.(this.ctx));
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this);
    this.bindEvents();
    this.layout();

    // 初始模式已在上方 configure() 中一并设置，不调用 setMode（数据尚未加载时它会读 dataset）
    this.ctx!.emit('compute-mode-change', { mode: this.ctx!.compute.mode, threads: 1, reason: 'js-fallback' });
    // 声明式主题优先；未声明时等 setDataset() 读取数据集 manifest 的配色声明
    const declaredTheme = this.getAttribute('theme');
    if (declaredTheme) this.setTheme(declaredTheme);
    // 声明式 MACD 参数，如 macd="12,26,9"；未声明保持固定默认 (12,26,9)
    const declaredMACD = this.getAttribute('macd');
    if (declaredMACD) this.ctx!.setMACDParams(parseMACDParams(declaredMACD));
    // 声明式分时天数：数据到达后由 setDataset() 应用（此时仅记录偏好）
    const declaredDays = this.getAttribute('intraday-days');
    if (declaredDays) this.ctx!.setIntradayDays(declaredDays);
    const declaredPeriod = this.getAttribute('period');
    if (declaredPeriod) this.ctx!.setPeriod(declaredPeriod);
    const declaredChipMode = this.getAttribute('chip-mode');
    if (declaredChipMode) this.ctx!.setChipMode(declaredChipMode);

    // 无 dataset 属性时不发起任何 fetch：作为 npm 包使用时由 setDataset() 注入内存数据，
    // 避免消费者目录下不存在 './src/data' 而报 404。示例页显式写了 dataset="./src/data"。
    const base = this.getAttribute('dataset');
    if (base) {
      emitEvent(this, CHART_EVENTS.LOAD_START, { base });
      loadDataset(base)
        .then((ds) => this.setDataset(ds))
        .catch((e) => this.showError(`数据加载失败：${e.message}（请通过 HTTP 访问，不要用 file:// 打开）`));
    }
  }

  disconnectedCallback() {
    this.ro?.disconnect();
    this.ro = null;
    this._sideMo?.disconnect();
    this._sideMo = null;
    this._abort?.abort();       // 一次撤销宿主/canvas/window 上的全部监听
    this._abort = null;
    this.ctx?.destroy();
    this.ctx = null;
    // 只移除每次连接都会重建的节点；sideSlot / statsEl / tradeHost / depthEl 保留，
    // 因为其中含页面提供的 <depth-book> 与挂载进来的明细卡片，销毁会丢内容。
    for (const el of [this.canvas, this.overlay, this.barsStyle, this.paneBars]) el?.remove();
    this.canvas = this.overlay = this.barsStyle = this.paneBars = null;
  }

  attributeChangedCallback(name: string, oldV: string | null, newV: string | null) {
    if (oldV === newV) return;
    // 守卫必须在 theme 分支之前：元素升级时属性回调先于 connectedCallback，
    // 此时 ctx 尚未建立；连接阶段会统一应用声明式 theme，避免 setTheme 与 theme-change 双派发。
    if (!this.ctx) return;
    if (name === 'theme') { this.setTheme(newV || 'light'); return; }
    if (name === 'mode') this.ctx.setMode(newV || 'candle');
    if (name === 'auction') this.ctx.setAuctionEnabled(newV !== 'off');
    if (name === 'chips') this.ctx.setChipsEnabled(newV !== 'off');
    if (name === 'macd') { this.setMACDParams(newV || ''); return; }
    if (name === 'intraday-days') { this.setIntradayDays(newV || 1); return; }
    if (name === 'period') { this.setPeriod(newV || ''); return; }
    if (name === 'chip-mode') { this.setChipMode((newV as ChipMode) || 'histogram'); return; }
    if (name === 'dataset' && newV) {
      emitEvent(this, CHART_EVENTS.LOAD_START, { base: newV });
      loadDataset(newV).then((ds) => this.setDataset(ds)).catch((e) => this.showError(e.message));
    }
  }

  showError(msg: string) {
    if (this.overlay) this.overlay.innerHTML = `<div style="padding:12px;color:var(--sc-up,${PALETTE.up});font:13px system-ui">${msg}</div>`;
    emitEvent(this, CHART_EVENTS.CHART_ERROR, { message: msg });
  }

  layout() {
    if (!this.ctx) return;
    this.ctx.layout(this.clientWidth || 800, this.clientHeight || 500);
  }

  /** 盘口按内容自适应（十档/五档一致），完整展示不允许滚动；明细占满剩余高度 */
  depthFlex() {
    if (!this.sideExpanded) return '0 0 auto';
    // compact 只显示卖1/买1：用当前下发的两条 bar 高度 + 分界线精确计算，避免裁切或留白
    const bar = parseFloat(this.style.getPropertyValue('--sc-bar-h')) || LAYOUT.barH;
    const split = parseFloat(this.style.getPropertyValue('--sc-split-h')) || LAYOUT.splitH;
    return `0 0 ${2 * bar + 2 * LAYOUT.rowH + split}px`;
  }
  tradeFlex() {
    return '1 1 0%';   // 占满盘口之外的全部剩余高度
  }

  /**
   * 4 条标题/表头行统一分配：以 barH 为基准，把侧栏无法被整数据行消化的余数
   * 均分给这 4 条行（each），除不尽的 left 给买卖分界间隙，从而：
   *   侧栏高 = 4*(barH+each) + 盘口 2*levels*rowH + (splitH+left) + 明细卡片 border 1 + M*rowH
   * 明细视口因此恰好是 M 个整行，既无半行也无底部留白。
   */
  syncSideBars() {
    const s = this.sideSlot;
    if (!s || s.style.display === 'none' || !this.depthEl || !this.sideTradeEl) return;
    const H = parseFloat(s.style.height) || 0;
    if (!H) return;
    const levels = this.sideExpanded ? 1 : (this.depthEl.levels || 10);
    // 用实测可见性而非 hidden 属性：页面可能先调 setSideExpanded 再改 hidden，
    // 配合下方的 MutationObserver，两种顺序都能得到正确 footerH
    const footer = this.sideTradeEl.querySelector('.tape-footer');
    const footerH = footer && footer.getClientRects().length
      ? Math.round(footer.getBoundingClientRect().height) : 0;
    const base = 4 * LAYOUT.barH + 2 * levels * LAYOUT.rowH + LAYOUT.splitH + 1 + footerH;
    const R = Math.max(0, H - base);
    const rows = Math.floor(R / LAYOUT.rowH);
    const rem = R - rows * LAYOUT.rowH;           // 0 ~ rowH-1
    const each = Math.floor(rem / 4);             // 均分给 4 条标题/表头行
    const left = rem - 4 * each;                  // 除不尽的余数给买1/卖1 间隙
    this.style.setProperty('--sc-bar-h', `${LAYOUT.barH + each}px`);
    this.style.setProperty('--sc-split-h', `${LAYOUT.splitH + left}px`);
    if (this.sideExpanded) this.depthEl.style.flex = this.depthFlex();
  }

  /** 由 ChartContext.applyLayout 回调，定位右侧 DOM 侧栏并按模式切换内容 */
  /** 侧栏内展开成交明细：十档收缩为 1 档，明细占满剩余高度 */
  setSideExpanded(on: boolean) {
    this.sideExpanded = !!on;
    this.depthEl?.setCompact?.(this.sideExpanded);
    this.syncSideBars();   // 档数变了，4 条行与间隙的均分要重算
    // 展开时盘口固定为「标题+列头+卖1+分隔线+买1」的精确高度，明细占满剩余
    if (this.depthEl) this.depthEl.style.flex = this.depthFlex();
    if (this.sideTradeEl) this.sideTradeEl.style.flex = this.tradeFlex();
  }

  updateSide(rect: SideRect | null) {
    const s = this.sideSlot;
    if (!s) return;
    if (!rect) { s.style.display = 'none'; return; }
    s.style.display = 'flex';
    s.style.left = `${rect.x}px`;
    s.style.top = `${rect.y}px`;
    s.style.width = `${rect.w}px`;
    s.style.height = `${rect.h}px`;
    const chips = rect.content === 'chips';
    if (this.depthEl) {
      this.depthEl.style.display = chips ? 'none' : 'block';
      // 盘口按内容自适应，十档 20 行与五档 10 行都完整展示；明细上移占满剩余
      this.depthEl.style.flex = chips ? '' : this.depthFlex();
      // 任何档位都不允许盘口内部滚动（展开态固定 66px 刚好容纳卖1/买1）
      this.depthEl.style.overflow = chips ? '' : 'hidden';
      this.depthEl.setCompact?.(!chips && !!this.sideExpanded);
    }
    if (this.sideTradeEl) {
      this.sideTradeEl.style.display = chips ? 'none' : 'flex';
      this.sideTradeEl.style.flex = chips ? '' : this.tradeFlex();
    }
    if (this.statsEl) {
      this.statsEl.style.display = chips ? 'block' : 'none';
      if (chips) this.renderChipStats();
    }
    if (!chips) this.syncSideBars();
  }

  /** 筹码峰下半部：分区统计面板（主指标 + 居中成本 + 两组成本分布），随 K 线光标联动 */
  renderChipStats() {
    const c = chipSnapshotAt(this.ctx!)?.stat;
    if (!c || !this.statsEl) return;
    const num = 'font-variant-numeric:tabular-nums';
    const row = (k: string, v: unknown, strong?: boolean) =>
      `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 0">`
      + `<span style="color:var(--sc-muted,#6B7280);font-size:11px">${k}</span>`
      + `<b style="font-weight:${strong ? 500 : 400};font-size:${strong ? 13 : 11}px;text-align:right;${num}">${v}</b></div>`;
    const group = (title: string, lo: unknown, hi: unknown, conc: unknown) =>
      `<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--sc-line,#EEF0F3)">`
      + `<div style="font-size:10px;color:var(--sc-muted,#9AA3AF);letter-spacing:.3px;margin-bottom:2px">${title}</div>`
      + row('区间', `${lo}–${hi}`) + row('集中度(面板口径)', conc) + `</div>`;
    const pct = c.profitRatio * 100;
    const head = `<div style="background:var(--sc-panel,#FAFBFC);border-bottom:1px solid var(--sc-line,#ECEEF1);padding:5px 8px;margin:-6px -8px 8px;display:flex;align-items:center;justify-content:space-between;gap:8px">`
      + `<b style="font:500 12px/1.4 system-ui,-apple-system,sans-serif;color:var(--sc-text,#1F2329)">筹码统计</b>`
      + `<span style="font:10px/1.4 system-ui,-apple-system,sans-serif;color:var(--sc-muted,#6B7280);${num}">${c.date}</span></div>`;
    const main = `<div style="margin-bottom:8px">`
      + `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">`
      + `<span style="color:var(--sc-muted,#6B7280);font-size:11px">获利比例</span>`
      + `<b style="font:500 18px/1.2 system-ui,-apple-system,sans-serif;color:var(--sc-up,#E24B4A);${num}">${pct.toFixed(2)}%</b></div>`
      + `<div style="height:6px;border-radius:3px;background:var(--sc-line,#ECEEF1);overflow:hidden;margin-top:6px">`
      + `<div style="width:${Math.max(0, Math.min(100, pct))}%;height:100%;background:var(--sc-up,#E24B4A)"></div></div></div>`;
    // 软件面板口径：「平均成本」= COST(50)（分布中位/中心），加权平均成本另列
    this.statsEl.innerHTML = head + main + row('平均成本', c.avgCost.toFixed(2), true)
      + row('加权均成本', c.weightedAvgCost != null ? c.weightedAvgCost.toFixed(2) : '—')
      + group('90% 成本分布', c.cost90Low.toFixed(2), c.cost90High.toFixed(2), `${(c.concentration90 * 100).toFixed(2)}%`)
      + group('70% 成本分布', c.cost70Low.toFixed(2), c.cost70High.toFixed(2), `${(c.concentration70 * 100).toFixed(2)}%`);
  }

  bindEvents() {
    const c = this.canvas!;
    // 统一注入本次连接的 signal，断开时 abort 即解绑全部交互监听
    const add = (target: EventTarget, type: string, fn: Function, opts?: AddEventListenerOptions) =>
      target.addEventListener(type, fn as EventListener, { ...(opts || {}), signal: this._abort!.signal });
    // 盘口单位：子组件发 request，这里统一转成唯一的 depth-unit-change
    add(this, CHART_EVENTS.DEPTH_UNIT_REQUEST, (e: CustomEvent<{ unit: DepthUnit }>) => {
      if (e.target !== this) this.setDepthUnit(e.detail?.unit);
    });
    add(c, 'mousemove', (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.ctx!.setPointer(x, y);
      if (this.dragging) {
        const main = this.ctx!.mainRect();
        const barPx = main ? main.w / this.ctx!.visibleCount() : 8;
        const delta = Math.round((x - this.lastX!) / barPx);
        if (delta !== 0) this.ctx!.panBy(-delta);
        this.lastX = x;
      }
      // 三段互斥：开盘竞价列 / 尾盘竞价段 / 连续竞价主图区
      const ai = this.ctx!.auctionIndexAtX(x);
      const ci = this.ctx!.closingIndexAtX(x);
      if (ai != null) {
        this.ctx!.setCrosshair(null);
        this.ctx!.setClosingHover(null);
        this.ctx!.setAuctionHover(ai);
      } else if (ci != null) {
        this.ctx!.setCrosshair(null);
        this.ctx!.setAuctionHover(null);
        this.ctx!.setClosingHover(ci);
      } else {
        this.ctx!.setAuctionHover(null);
        this.ctx!.setClosingHover(null);
        this.ctx!.setCrosshair(this.ctx!.indexAtX(x));
      }
    });
    add(c, 'mouseleave', () => {
      this.dragging = false;
      this.ctx!.setPointer(null);
      this.ctx!.setCrosshair(null);
      this.ctx!.setAuctionHover(null);
      this.ctx!.setClosingHover(null);
    });
    add(c, 'pointerdown', (e: MouseEvent) => { this.dragging = true; this.lastX = e.clientX - c.getBoundingClientRect().left; });
    add(window, 'pointerup', this.onPointerUp!);
    add(c, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const main = this.ctx!.mainRect();
      const anchor = main ? (e.clientX - rect.left - main.x) / main.w : 0.5;
      this.ctx!.zoomBy(e.deltaY > 0 ? 1.12 : 0.89, Math.min(1, Math.max(0, anchor)));
    }, { passive: false });
  }

  // ---- 公共 API ----
  /** 主题：预设名（light / dark）、自定义色板对象，或 null 恢复默认 */
  setTheme(theme: string | Record<string, string> | null, { fromDataset = false } = {}) {
    const resolved = resolveTheme(theme);
    this.theme = fromDataset ? 'dataset'
      : (typeof theme === 'string' ? (theme || 'light') : 'custom');
    // 实例级色板：不再就地覆盖全局 PALETTE，渲染帧内由 withPalette 临时生效
    const palette = { ...resolved };
    if (this.ctx) this.ctx.setPalette(palette);
    // CSS 变量只写到本实例 host（含 shadow DOM 的后代可继承），不再污染 :root / 其它实例
    const vars = {
      '--sc-bg': palette.background, '--sc-panel': palette.panel, '--sc-line': palette.grid,
      '--sc-text': palette.text, '--sc-muted': palette.textMuted,
      '--sc-up': palette.up, '--sc-down': palette.down, '--sc-link': palette.link,
      '--sc-row-h': `${LAYOUT.rowH}px`, '--sc-head-h': `${LAYOUT.headH}px`,
      '--sc-title-h': `${LAYOUT.titleH}px`,
      // 4 条标题/表头行与买卖间隙的基准值；syncSideBars() 会按侧栏余数覆盖
      '--sc-bar-h': `${LAYOUT.barH}px`, '--sc-split-h': `${LAYOUT.splitH}px`,
    };
    for (const [k, v] of Object.entries(vars)) this.style.setProperty(k, v);
    // vars 里的 bar 基准值会覆盖 syncSideBars 的实际分配，必须立刻重算，
    // 否则运行时切主题后 4 条标题/表头行被打回 24px，明细视口出现半行/留白。
    this.syncSideBars();
    this.refreshDefaultMAColors(palette);
    this.ctx?.requestRender();
    emitEvent(this, CHART_EVENTS.THEME_CHANGE, { theme: this.theme, palette });
    return palette;
  }

  /** 主题切换后只刷新「组件默认分配」的均线颜色，保留用户显式给色与自定义配置 */
  refreshDefaultMAColors(palette: Palette) {
    if (!this.ctx || !this._defaultMA.length) return;
    const list = this.ctx.maConfig.map((m: MAConfig, i: number) => {
      const d = this._defaultMA.find((x: DefaultMAItem) => x.idx === i);
      return d ? { ...m, color: palette[d.key as keyof Palette] } : m;
    });
    this.ctx.setMovingAverages(list);
  }

  /** 当前主题名与实例色板快照 */
  getTheme() {
    const p = this.ctx?.palette || PALETTE;
    return { theme: this.theme, palette: { ...p } };
  }

  /** 只读状态快照：页面不再需要访问可变的 ChartContext */
  getState() {
    const c = this.ctx;
    return {
      mode: c?.mode ?? null, period: c?.period ?? null, chipMode: c?.chipMode ?? null,
      crosshair: c?.crosshair ?? null, viewport: c ? { ...c.viewport } : null,
      datasetReady: !!c?.dataset,
      // getState().pano 恒为数据集原始全景盘口（L1 派生），不再被场景切换覆盖
      pano: c?.dataset?.depthFull ? { ...c.dataset.depthFull } : null,
      depthScenario: this.depthScenario, depthUnit: this.depthUnit,
    };
  }

  /** 只读：当前盘口场景的全景盘口（normal=原始；limitUp/limitDown=封单盘口）。
   *  与 getState().pano 分离，供页面 renderPanorama() 读取，场景切换不污染 dataset.depthFull。 */
  getScenarioPano(): DepthBookSnapshot | null {
    return this.scenarioPano ? { ...this.scenarioPano } : null;
  }

  /** 已加载的数据集快照（顶层浅拷贝，防止替换内部引用的键；写入走 setDetailData / setDepthScenario） */
  getDataset(): ChartDataset | null {
    const ds = this.ctx?.dataset;
    return ds ? { ...ds } : null;
  }

  /** 注入 L2 / 场景数据；setDataset 自动调用，也可单独更新 */
  setDetailData(data: Partial<DetailData> = {}) {
    this.detailData = { ...(this.detailData || {}), ...data };
    if (data.depthFull !== undefined) this.ctx?.setDepthFull(data.depthFull);
    emitEvent(this, CHART_EVENTS.DETAIL_DATA_CHANGE, { ...this.detailData });
  }

  /** 切换盘口场景：组件内部改数据并重绘，页面只消费结构化事件 */
  setDepthScenario(key: string) {
    this.depthScenario = key;   // 数据未就绪时先记录，setDataset 会重新应用
    const sc = this.detailData?.depthScenarios?.[key];
    // 无对应场景时回退到数据集默认盘口 / 全景，保证页面侧栏总有数据
    const depth = sc?.depth ?? this.detailData?.depth ?? null;
    const pano = sc?.pano ?? this.detailData?.depthFull ?? null;
    // 场景 pano 只保存在组件独立字段，绝不写回 dataset.depthFull（运行时派生层 L1 产物保持只读）。
    // 全景视图经 depth-scenario-change 事件 / getScenarioPano() 读取，切回 normal 自动恢复原始盘口。
    this.scenarioPano = (pano as DepthBookSnapshot | null) ?? null;
    emitEvent(this, CHART_EVENTS.DEPTH_SCENARIO_CHANGE, { key, depth, pano });
  }

  setDepthUnit(unit: DepthUnit) {
    this.depthUnit = unit === 'amount' ? 'amount' : 'volume';
    // 根容器是 depth-unit-change 的唯一派发源；子组件只发 request，避免同一操作双派发
    emitEvent(this, CHART_EVENTS.DEPTH_UNIT_CHANGE, { unit: this.depthUnit });
  }

  /** 编程式交互（URL 参数 / 外部自动化），不再暴露 ctx */
  setCrosshair(index: number | null) { this.ctx?.setCrosshair(index); }
  setPointer(x: number | null, y?: number) { this.ctx?.setPointer(x, y); }
  setAuctionHover(index: number | null) { this.ctx?.setAuctionHover(index); }
  setClosingHover(index: number | null) { this.ctx?.setClosingHover(index); }

  /** 页面提供的明细卡片 / 覆盖层统一经 API 挂载，不接触内部节点 */
  attachDetailCard(card: HTMLElement) {
    if (card && this.sideTradeEl && card.parentElement !== this.sideTradeEl) this.sideTradeEl.appendChild(card);
  }
  detachDetailCard(card: HTMLElement, home: HTMLElement) {
    if (card && home && card.parentElement === this.sideTradeEl) home.appendChild(card);
  }
  attachCover(el: HTMLElement) { if (el && el.parentElement !== this) this.appendChild(el); }

  /** 布局所需的 DOM 属性由 element 层读取后交给 core，core 不再 querySelector */
  getLayoutHints() {
    const auctionEl = this.querySelector('auction-pane');
    const sideEl = this.querySelector('[slot="side"]');
    const chip = this.ctx?.panes.find((p: PaneElementLike) => p.tagName.toLowerCase() === 'chip-pane');
    return {
      auctionWidth: parseFloat(auctionEl?.getAttribute('width') || '') || 150,
      chipWidth: parseFloat(chip?.getAttribute('width') || '') || 170,
      sideWidth: parseFloat(sideEl?.getAttribute('width') || '') || 210,
    };
  }

  // ---- 副图信息栏：组件内部自渲染（原先在 index.html 中） ----
  paneValueText(name: string, idx: number | null) {
    const ctx = this.ctx!;
    const intraday = ctx.mode === 'intraday';
    const bars = ctx.getBars();
    const i = idx != null ? idx : (intraday ? ctx.getSeries().length - 1 : ctx.viewport.end - 1);
    const b = (v: unknown) => `<b>${v}</b>`;
    const num = (v: unknown) => Number(v ?? 0);
    if (name === 'VOL' || name === 'AMOUNT') {
      const field = name === 'VOL' ? 'volume' : 'amount';
      const cur = intraday ? ctx.getSeries()[i]?.[field] : (ctx.compute.indicator(name, bars, {}) as IndicatorResult).values[i]?.value;
      const maPeriods = adaptiveMAPeriods([5, 10], bars.length);
      if (intraday) return `${maParamsText(maPeriods)}  量 ${b(shortNum(cur))}`;
      const ma = maPeriods.map((n) => {
        const v = (ctx.compute.indicator('MA', bars, { n, field }) as IndicatorResult).values[i]?.value;
        return `MA${n} ${b(shortNum(v))}`;
      }).join('  ');
      return `${ma}  量 ${b(shortNum(cur))}`;
    }
    const macdP = name === 'MACD' ? ctx.getMACDParams() : null;
    const res = ctx.compute.indicator(name === 'VOL_RATIO' ? 'VOL_RATIO' : name, bars, macdP || {}) as IndicatorResult;
    const mapped = intraday
      ? Math.max(0, res.values.length - ctx.visibleCount()) + (i - ctx.viewport.start)
      : i;
    const v = res.values[mapped];
    if (!v) return '';
    if (name === 'MACD') {
      const fmt = (x: unknown) => (x == null ? '—' : b(num(x).toFixed(3)));
      return `${macdParamsText(macdP!)}  MACD ${fmt(v.macd)}  DIFF ${fmt(v.dif)}  DEA ${fmt(v.dea)}`;
    }
    if (name === 'KDJ') return `(9)  K ${b(num(v.k).toFixed(1))}  D ${b(num(v.d).toFixed(1))}  J ${b(num(v.j).toFixed(1))}`;
    return `(5日)  量比 ${b(num(v.value).toFixed(2))}`;
  }

  updatePaneValues() {
    if (!this.ctx?.dataset || !this.paneBars) return;
    for (const b of this.getSubplotLayout()) {
      const el = this.paneBars.querySelector(`[data-vals="${b.index}"]`);
      if (el) el.innerHTML = this.paneValueText(b.indicator, this.ctx.crosshair);
    }
  }

  renderPaneBars() {
    if (!this.ctx?.dataset || !this.paneBars) return;
    const layout = this.getSubplotLayout();
    this.paneBars.innerHTML = layout.map((b: SubplotLayout, i: number) => {
      const locked = i === 0;   // 第一个副图恒为成交量，不提供修改
      return `<div class="pane-bar" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">
        <select data-pane="${b.index}"${locked ? ' disabled title="第一个副图固定为成交量，不可修改"' : ''}>
          ${SUBPLOT_INDICATORS.map((n) => `<option value="${n}"${n === b.indicator ? ' selected' : ''}>${IND_LABEL[n] || n}</option>`).join('')}
        </select>
        <span class="vals" data-vals="${b.index}"></span>
      </div>`;
    }).join('');
    this.updatePaneValues();
  }

  setDataset(dataset: Partial<ChartDataset>) {
    // 归一化：支持只注入部分分片（如 setDataset({ bars })），缺失字段给安全空值
    const ds = {
      manifest: {}, bars: [], intraday: [], intradayMulti: [], chips: [], auction: [], trades: [],
      depth: [], orders: [], depthFull: null, depthScenarios: {},
      ...(dataset || {}),
    } as ChartDataset;
    this.ctx!.setDataset(ds);
    // 数据集声明的 palette / upColor / downColor 在用户未显式指定主题时生效
    if (!this.theme || this.theme === 'dataset') {
      const mf = ds.manifest || {};
      const patch = { ...resolveTheme(mf.palette as string | Record<string, string> | null) };
      if (mf.upColor) patch.up = mf.upColor as string;
      if (mf.downColor) patch.down = mf.downColor as string;
      this.setTheme(patch, { fromDataset: true });
    }
    this.setDetailData({
      trades: ds.trades, orders: ds.orders, depth: ds.depth as Record<string, unknown>,
      depthFull: ds.depthFull || null, depthScenarios: ds.depthScenarios || null,
      manifest: ds.manifest,
    });
    this.setDepthScenario(this.depthScenario);   // 数据就绪后应用（含 URL 预设的场景）
    this.renderChipStats();
    this.updateSide(this.ctx!.sideRect);
    emitEvent(this, CHART_EVENTS.DATASET_READY, { dataset: ds });
  }
  setMode(mode: ChartMode) { this.ctx!.setMode(mode); }
  setPeriod(period: string) { this.ctx!.setPeriod(period); }
  getPeriod() { return this.ctx!.period; }
  setChipMode(mode: ChipMode) { this.ctx!.setChipMode(mode); }
  setAuctionEnabled(on: boolean) { this.ctx!.setAuctionEnabled(on); }
  setChipsEnabled(on: boolean) { this.ctx!.setChipsEnabled(on); }
  setSubplotCount(n: NumericInput) { this.ctx!.setSubplotCount(n as number); }
  getSubplotConfig(): SubplotConfig[] { return this.ctx!.getSubplotConfig(); }
  getSubplotLayout(): SubplotLayout[] { return this.ctx!.getSubplotLayout(); }
  setSubplotIndicator(index: number, name: string): SubplotConfig[] { return this.ctx!.setSubplotIndicator(index, name); }
  /**
   * 设置 MACD 参数：支持 {fast,slow,signal} 对象或 '12,26,9' 字符串；
   * 非法输入回退固定默认 (12,26,9)。变更会触发 macd-params-change 并重绘。
   */
  /** 切换分时天数（1 单日 / 2–5 多日）；多日场景自动隐藏集合竞价段 */
  setIntradayDays(days: NumericInput) { return this.ctx!.setIntradayDays(days); }
  getIntradayDays() { return this.ctx!.getIntradayDays(); }
  setMACDParams(input: string | Partial<MACDParams> | null) {
    const patch = typeof input === 'string' ? parseMACDParams(input) : (input || {});
    const resolved = this.ctx ? this.ctx.setMACDParams(patch) : resolveMACDParams(patch);
    this.renderPaneBars();
    return resolved;
  }
  getMACDParams() {
    return this.ctx ? this.ctx.getMACDParams() : resolveMACDParams();
  }
  getMovingAverages() { return this.ctx!.maConfig.map((m: MAConfig) => ({ ...m })); }
  setMovingAverages(list: MAConfig[]) { return this.ctx!.setMovingAverages(list); }
  addMovingAverage(cfg: Partial<MAConfig>) { return this.ctx!.addMA(cfg); }
  removeMovingAverage(period: NumericInput) { return this.ctx!.removeMA(period); }
  updateMovingAverage(period: NumericInput, patch: Partial<MAConfig>) { return this.ctx!.updateMA(period, patch); }
  /** 视口写入转调 ChartContext 的受控 setter（钳制 / emit / 重绘都在 core 内完成） */
  setViewport({ start, end }: Viewport) { this.ctx!.setViewport({ start, end }); }
  getComputeMode() { return this.ctx?.compute.mode || 'none'; }
  /**
   * @deprecated 仅返回只读门面，不暴露可变的 ChartContext；需要改状态请用公开方法。
   * 下个主版本可能移除，请改用 <stock-chart> 的公开 API 与事件。
   */
  getContext(): ChartContextFacade | null { return this.ctx ? this.ctx.readonlyFacade() : null; }
  destroy() { this.disconnectedCallback(); }
}

// 标签注册统一由 src/index.ts 的 defineAll() 显式负责，本模块保持无副作用
