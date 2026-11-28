// 交易明细：DOM 虚拟滚动表格，与 crosshair 联动。B/S/N 着色，显式标注来源与粒度。
import { BaseElement } from './ssr-base';
import { LAYOUT } from '../types';
import { emitEvent, CHART_EVENTS } from '../events';
import type { TradeTick, OrderRecord, TradeTapeViewConfig, TradeTapeMetrics } from '../types';
import { BIG_ORDER_AMOUNT, isBigOrder } from '../algorithms/trade-order-runs';
import type { OrderRun } from '../algorithms/trade-order-runs';

interface TapeRow extends TradeTick {
  trend?: number;
  buyRun?: OrderRun;
  sellRun?: OrderRun;
  [key: string]: unknown;
}

/** 股 → 手（A 股 1 手 = 100 股），非整手保留至多 2 位小数 */
const lotsText = (volume: number): string =>
  (volume / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
/** 金额：≥1 亿用「亿」，≥1 万用「万」，其余取整（与市面逐笔明细一致） */
const amountText = (v: number): string => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿`
  : v >= 1e4 ? `${(v / 1e4).toFixed(2)}万` : `${Math.round(v)}`);

export class TradeTape extends BaseElement {
  declare rows: Array<TradeTick | OrderRecord>;
  declare _rawRows: Array<TradeTick | OrderRecord>;
  declare rowH: number;
  declare activeTime: string | null;
  declare heads: string[];
  declare labelKey: string;
  declare cols: string;
  declare colCls: string[];
  declare extraKey: string | null;
  declare _windowMode: boolean | undefined;
  declare view: HTMLElement | undefined;
  declare spacer: HTMLElement | undefined;
  declare _suppressBroadcast: boolean | undefined;
  declare onCrosshair: EventListener | undefined;
  declare _eventHost: EventTarget | undefined;
  declare ro: ResizeObserver | undefined;
  declare _lastH: number | undefined;
  declare mode: 'list' | 'match';
  declare basePrice: number | null;
  declare bigAmount: number;
  constructor() {
    super();
    this.rows = [];
    this._rawRows = [];        // 保持原始时间序，倒序仅作用于显示
    this.rowH = LAYOUT.rowH;   // 与盘口 5/10 档数据行同一高度
    this.activeTime = null;
    this.heads = ['时间', '价格', '成交量', '方向'];
    this.labelKey = 'side';
    this.cols = '62px 1fr 1fr 30px';
    this.colCls = ['', 'num', 'num', 'side'];
    this.extraKey = null;   // 挂单视角额外显示「剩余在挂量」列
    this.mode = 'list';     // 'match' = 买单 / 卖单视图
    this.basePrice = null;
    this.bigAmount = BIG_ORDER_AMOUNT;
    this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() { return ['page-size', 'order']; }

  /**
   * 侧栏小列表可用 order="desc" 按时间倒序（最新在前）；
   * 覆盖视图走 setWindow()，不受影响。trend 等派生字段随原始行一起反转，口径不变。
   */
  setData(rows: Array<TradeTick | OrderRecord>) {
    const src = rows || [];
    this._rawRows = src;
    this.rows = this.getAttribute('order') === 'desc' ? [...src].reverse() : src;
    this.renderShell();
  }
  setActiveTime(time: string | null) {
    this.activeTime = time;
    // 开启跟随定位时，把对应时间的行滚动到视口中央；
    // 否则该行常在可见区之外，只有 activeTime 变化、看不到任何联动。
    if (time && this.hasAttribute('follow-crosshair') && !this._windowMode) {
      this.scrollToTime(time);
    }
    this.paint();
  }

  /** 把首个匹配分钟的行滚动到视口中央（rows 已按显示顺序排列，desc 时即倒序） */
  scrollToTime(time: string) {
    if (!this.view) return;
    const idx = this.rows.findIndex((r) => (r.time || '').slice(0, 5) === time);
    if (idx < 0) return;
    const viewH = this.view.clientHeight;
    const max = Math.max(0, this.rows.length * this.rowH - viewH);
    const target = Math.max(0, Math.min(idx * this.rowH - viewH / 2 + this.rowH / 2, max));
    this.view.scrollTop = target;
  }

  /** 同一张表可切换数据集：成交明细与 Level-2 挂单共用四列网格，只换表头与标签字段 */
  headHtml() {
    // 空 class 表示该列左对齐（如「时间」）；不能回退成 num，否则表头右对齐而数据行左对齐
    return this.heads.map((h: string, i: number) => `<span class="${this.colCls[i] || ''}">${h}</span>`).join('');
  }
  setViewConfig({ heads, labelKey, cols, colCls, extraKey, mode, basePrice, bigAmount }: TradeTapeViewConfig) {
    if (heads) this.heads = heads;
    if (labelKey) this.labelKey = labelKey;
    this.cols = cols || '62px 1fr 1fr 30px';
    this.colCls = colCls || ['', 'num', 'num', 'side'];
    this.extraKey = extraKey || null;
    this.mode = mode === 'match' ? 'match' : 'list';
    this.basePrice = Number.isFinite(basePrice) ? (basePrice as number) : null;
    this.bigAmount = Number.isFinite(bigAmount) ? (bigAmount as number) : BIG_ORDER_AMOUNT;
    this.renderShell();   // 列模板写在 shadow CSS 里，需重建表头与行网格
  }

  /**
   * 多栏连续时间线视图：本栏不滚动，由外部按全局时间窗口喂入一段数据。
   * 只替换 spacer 高度并重绘，不重建 shadow DOM，滚动时无闪烁。
   */
  setWindow(rows: Array<TradeTick | OrderRecord>) {
    this.rows = rows || [];
    this._windowMode = true;
    if (!this.view) { this.renderShell(); return; }
    this.spacer!.style.height = `${this.rows.length * this.rowH}px`;
    this.paint();
  }

  /** 多组逐笔视图共享滚动位置时使用的读写接口 */
  scrollPosition() { return this.view?.scrollTop || 0; }
  /**
   * 4 条标题/表头行统一为 --sw-bar-h（由 stock-chart.syncSideBars 按侧栏余数均分下发）；
   * 视口高度由 CSS calc 自动占满宿主剩余空间，余数已由这 4 条行与买卖间隙消化，
   * 因此视口恰好是整数个 rowH，不会出现半行或底部留白。
   */
  layoutMetrics(hostH: number): TradeTapeMetrics {
    const headH = LAYOUT.barH;
    const avail = Math.max(this.rowH, hostH - headH);
    return { headH, viewH: Math.floor(avail / this.rowH) * this.rowH };
  }

  /** 供容器层读取当前列表视口高度（避免穿透 shadow DOM） */
  get viewHeight(): number { return this.view?.clientHeight || 0; }
  visibleRows() { return Math.max(1, Math.floor(this.viewHeight / this.rowH)); }
  setScrollTop(top: number) {
    if (!this.view) return;
    // 程序化同步滚动不再向外派发 tape-scroll，避免联动回环
    if (Math.abs(this.view.scrollTop - top) > 1) {
      this._suppressBroadcast = true;
      this.view.scrollTop = top;
    }
    this.paint();
  }

  connectedCallback() {
    this.renderShell();
    this.onCrosshair = (e: Event) => {
      const item = (e as CustomEvent<{ item: { time?: string } | null }>).detail?.item;
      this.setActiveTime(item ? (item.time || '').slice(0, 5) : null);
    };
    // 只监听所属 <stock-chart> 实例的事件，避免同页多个图表互相高亮；独立使用时退回 document
    const rootHost = (this.getRootNode() as ShadowRoot)?.host?.closest?.('stock-chart');
    this._eventHost = this.closest('stock-chart') || rootHost || document;
    this._eventHost.addEventListener('crosshair-change', this.onCrosshair!);
    // 宿主尺寸变化只调整视口高度并重绘，不重建 shadow DOM：
    // 重建会冲掉 scrollTop、触发 ResizeObserver 循环并打断多组滚动联动
    this.ro = new ResizeObserver(() => {
      const h = this.clientHeight;
      if (h === this._lastH) return;
      this._lastH = h;
      // 列头与视口高度都由 CSS 变量驱动，尺寸变化时只需重绘
      this.paint();
    });
    this.ro.observe(this);
  }

  disconnectedCallback() {
    (this._eventHost || document).removeEventListener('crosshair-change', this.onCrosshair!);
    this.ro?.disconnect();
  }
  attributeChangedCallback(name: string, oldV: string | null, newV: string | null) {
    if (!this.isConnected || oldV === newV) return;
    if (name === 'order' && this._rawRows.length) this.setData(this._rawRows);
    else this.paint();
  }

  renderShell() {
    const keepScroll = this.view?.scrollTop || 0;
    const total = this.rows.length * this.rowH;
    // 侧栏态跟随 host 统一分配的 --sw-bar-h；覆盖视图用基准 barH 避免继承侧栏余数
    const bar = this._windowMode ? `${LAYOUT.barH}px` : `var(--sw-bar-h,${LAYOUT.barH}px)`;
    this.shadowRoot!.innerHTML = `
      <style>
        :host{display:block;height:100%;background:var(--sw-bg,transparent);font:11px/1.35 system-ui,-apple-system,sans-serif;color:var(--sw-text)}
        .head{display:grid;grid-template-columns:${this.cols};gap:4px;align-items:center;
              height:${bar};padding:0 6px;box-sizing:border-box;
              background:var(--sw-panel,transparent);border-bottom:1px solid var(--sw-line,transparent);color:var(--sw-muted);font-size:10px;
              letter-spacing:.2px}
        .view{height:calc(100% - ${bar} - var(--sw-view-extra, 0px));
              overflow:${this._windowMode ? 'hidden' : 'auto'};position:relative;background:var(--sw-bg,transparent);
              scrollbar-width:none;-ms-overflow-style:none}
        .view::-webkit-scrollbar{display:none}
        .spacer{height:${total}px;position:relative}
        .row{position:absolute;left:0;right:0;height:${this.rowH}px;display:grid;
             grid-template-columns:${this.cols};gap:4px;padding:0 6px;align-items:center;
             box-sizing:border-box;background:var(--sw-bg,transparent)}
        .row.alt{background:color-mix(in srgb,var(--sw-panel) 55%,transparent)}
        .row:hover{background:color-mix(in srgb,var(--sw-link) 10%,transparent)}
        .row.active,.row.active.alt{background:color-mix(in srgb,var(--sw-up) 12%,transparent)}
        /* 整行按逐笔涨跌着色：A 股习惯涨红跌绿，平盘用中性灰；颜色走 host 变量，随实例主题刷新 */
        .row.up{color:var(--sw-up)}
        .row.down{color:var(--sw-down)}
        .row.flat{color:var(--sw-muted)}
        .row .price{font-weight:600}
        .num{text-align:right;font-variant-numeric:tabular-nums}
        .side{text-align:center}
        .tag{display:inline-block;min-width:15px;padding:0 3px;border-radius:3px;font-size:10px;
             font-weight:600;font-style:normal;line-height:16px}
        .tag.up{color:var(--sw-up);background:color-mix(in srgb,var(--sw-up) 12%,transparent)}
        .tag.down{color:var(--sw-down);background:color-mix(in srgb,var(--sw-down) 12%,transparent)}
        .tag.flat{background:color-mix(in srgb,var(--sw-muted) 14%,transparent);color:var(--sw-muted)}
        /* 撤单按被撤委托方向区分：BC 买撤（红系）/ SC 卖撤（绿系），行文字仍为中性灰 */
        .tag.BC{background:color-mix(in srgb,var(--sw-up) 12%,transparent);color:var(--sw-up)}
        .tag.SC{background:color-mix(in srgb,var(--sw-down) 12%,transparent);color:var(--sw-down)}
        /* 部分成交：BF 买成交 / SF 卖成交，用细边框与挂单标签区分 */
        .tag.BF{background:color-mix(in srgb,var(--sw-up) 12%,transparent);
                color:var(--sw-up);border:1px solid color-mix(in srgb,var(--sw-up) 35%,transparent)}
        .tag.SF{background:color-mix(in srgb,var(--sw-down) 12%,transparent);
                color:var(--sw-down);border:1px solid color-mix(in srgb,var(--sw-down) 35%,transparent)}
        /* 买单 / 卖单视图：行内只给单元格着色；连续成交同一委托合并为跨行虚线框 */
        .row.m{color:var(--sw-text)}
        .row.m .t{color:var(--sw-muted)}
        .row.m .c{text-align:center;font-variant-numeric:tabular-nums}
        .row.m .up{color:var(--sw-up)}
        .row.m .down{color:var(--sw-down)}
        .row.m .flat{color:var(--sw-muted)}
        .mwrap{position:absolute;left:0;right:0;display:grid;grid-template-columns:${this.cols};gap:4px;
               padding:0 6px;box-sizing:border-box;pointer-events:none}
        .mbox{grid-row:1;position:relative;box-sizing:border-box;margin:1px 0;min-width:0;overflow:hidden;
              display:flex;flex-direction:column;align-items:center;justify-content:center;
              border:1px dashed color-mix(in srgb,var(--sw-muted) 55%,transparent);
              background:var(--sw-bg,#fff);color:var(--sw-text);font:10px/12px system-ui,-apple-system,sans-serif;
              font-variant-numeric:tabular-nums;white-space:nowrap}
        .mbox.clip-top{border-top:none;margin-top:0}
        .mbox.clip-bottom{border-bottom:none;margin-bottom:0}
        .mbox.big.buy{border-color:color-mix(in srgb,var(--sw-up) 55%,transparent);
                      background:color-mix(in srgb,var(--sw-up) 6%,var(--sw-bg,#fff))}
        .mbox.big.sell{border-color:color-mix(in srgb,var(--sw-down) 55%,transparent);
                       background:color-mix(in srgb,var(--sw-down) 6%,var(--sw-bg,#fff))}
        .mbox .corner{position:absolute;left:0;top:0;width:17px;height:17px;padding:1px 0 0 1px;box-sizing:border-box;
                      color:#fff;font:600 9px/9px system-ui,sans-serif;font-style:normal;text-align:left}
        /* 带角标的框内容整体下移，避开左上三角（2 行框也不与首行文字重叠） */
        .mbox.big:not(.clip-top){padding-top:6px}
        .mbox.buy .corner{background:linear-gradient(135deg,var(--sw-up) 50%,transparent 50%)}
        .mbox.sell .corner{background:linear-gradient(135deg,var(--sw-down) 50%,transparent 50%)}
      </style>
      <div class="head">${this.headHtml()}</div>
      <div class="view"><div class="spacer"></div></div>`;
    const view = this.shadowRoot!.querySelector('.view') as HTMLElement;
    view.addEventListener('scroll', () => {
      this.paint();
      if (this._suppressBroadcast) { this._suppressBroadcast = false; return; }
      // 供多组视图把所有栏同步到同一滚动位置，保持时间衔接
      emitEvent(this, CHART_EVENTS.TAPE_SCROLL, { top: this.view!.scrollTop });
    });
    this.view = view;
    this.view.scrollTop = keepScroll;
    this.spacer = this.shadowRoot!.querySelector('.spacer') as HTMLElement;
    this.paint();
  }

  paint() {
    if (!this.view || !this.spacer) return;
    const top = this._windowMode ? 0 : this.view.scrollTop;
    const count = Math.ceil(this.view.clientHeight / this.rowH) + 4;
    const from = Math.max(0, Math.floor(top / this.rowH) - 2);
    const to = Math.min(this.rows.length, from + count);
    if (this.mode === 'match') { this.paintMatch(from, to); return; }
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) {
      const t = this.rows[i] as TapeRow;
      const el = document.createElement('div');
      const trend = t.trend! > 0 ? 'up' : (t.trend! < 0 ? 'down' : 'flat');
      const label = t[this.labelKey] as string ?? t.side;
      el.className = `row ${trend}${i % 2 ? ' alt' : ''}${this.activeTime && t.time.slice(0, 5) === this.activeTime ? ' active' : ''}`;
      el.style.top = `${i * this.rowH}px`;
      const extra = this.extraKey
        ? `<span class="num">${((t[this.extraKey] as number) ?? 0).toLocaleString('zh-CN')}</span>` : '';
      el.innerHTML = `<span>${t.time.length === 5 ? `${t.time}:00` : t.time}</span><span class="num price">${t.price.toFixed(2)}</span>` +
        `<span class="num">${t.volume.toLocaleString('zh-CN')}</span>${extra}` +
        `<span class="side"><i class="tag ${trend} ${label}">${label}</i></span>`;
      frag.appendChild(el);
    }
    this.spacer.replaceChildren(frag);
  }

  /**
   * 买单 / 卖单视图：列 = 时间 / 成交价 / 成交（手）/ 买单 / 卖单。
   * 单笔委托直接在格内显示手数；连续多笔同一委托（buyRun / sellRun.count > 1）画跨行框，
   * 框内为该段合计「手 + 金额」，金额达阈值标「大」。框被可视窗口截断时去掉截断侧边框。
   */
  paintMatch(from: number, to: number) {
    const rows = this.rows as TapeRow[];
    const desc = !this._windowMode && this.getAttribute('order') === 'desc';
    const tone = (t: TapeRow): string => {
      const d = this.basePrice != null ? t.price - this.basePrice : (t.trend ?? 0);
      return d > 1e-9 ? 'up' : d < -1e-9 ? 'down' : 'flat';
    };
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) {
      const t = rows[i];
      const c = tone(t);
      const single = (run?: OrderRun): string => (!run || run.count <= 1
        ? `<span class="c ${c}">${lotsText(t.volume)}</span>` : '<span></span>');
      const el = document.createElement('div');
      el.className = `row m${i % 2 ? ' alt' : ''}${this.activeTime && t.time.slice(0, 5) === this.activeTime ? ' active' : ''}`;
      el.style.top = `${i * this.rowH}px`;
      el.innerHTML = `<span class="t">${t.time.length === 5 ? `${t.time}:00` : t.time}</span>`
        + `<span class="c price ${c}">${t.price.toFixed(2)}</span>`
        + `<span class="c">${lotsText(t.volume)}</span>${single(t.buyRun)}${single(t.sellRun)}`;
      frag.appendChild(el);
    }
    for (const [key, col] of [['buyRun', 4], ['sellRun', 5]] as const) {
      for (let i = from; i < to; i += 1) {
        const run = rows[i][key];
        if (!run || run.count <= 1) continue;
        const start = i;
        while (i + 1 < to && rows[i + 1][key] === run) i += 1;
        const topRow = rows[start], bottomRow = rows[i];
        const clipTop = topRow.seq !== (desc ? run.lastSeq : run.firstSeq);
        const clipBottom = bottomRow.seq !== (desc ? run.firstSeq : run.lastSeq);
        const big = isBigOrder(run, this.bigAmount);
        const wrap = document.createElement('div');
        wrap.className = 'mwrap';
        wrap.style.top = `${start * this.rowH}px`;
        wrap.style.height = `${(i - start + 1) * this.rowH}px`;
        const side = key === 'buyRun' ? 'buy' : 'sell';
        wrap.innerHTML = `<span class="mbox ${side}${big ? ' big' : ''}${clipTop ? ' clip-top' : ''}`
          + `${clipBottom ? ' clip-bottom' : ''}" style="grid-column:${col}" title="${side === 'buy' ? '买' : '卖'}单 ${run.ordId} · `
          + `连续成交 ${run.count} 笔 · ${lotsText(run.volume)}手 ${amountText(run.amount)}">`
          + `${big && !clipTop ? '<i class="corner">大</i>' : ''}<span>${lotsText(run.volume)}手</span>`
          // 被窗口截断只剩 1 行时放不下两行文字，只保留手数（完整信息见 title）
          + `${i - start + 1 >= 2 ? `<span>${amountText(run.amount)}</span>` : ''}</span>`;
        frag.appendChild(wrap);
      }
    }
    this.spacer!.replaceChildren(frag);
  }
}

// 标签注册统一由 src/index.ts 的 defineAll() 显式负责，本模块保持无副作用
