// 交易明细：DOM 虚拟滚动表格，与 crosshair 联动。B/S/N 着色，显式标注来源与粒度。
import { PALETTE, LAYOUT } from '../types.js';

export class TradeTape extends HTMLElement {
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
    this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() { return ['page-size', 'order']; }

  /**
   * 侧栏小列表可用 order="desc" 按时间倒序（最新在前）；
   * 覆盖视图走 setWindow()，不受影响。trend 等派生字段随原始行一起反转，口径不变。
   */
  setData(rows) {
    const src = rows || [];
    this._rawRows = src;
    this.rows = this.getAttribute('order') === 'desc' ? [...src].reverse() : src;
    this.renderShell();
  }
  setActiveTime(time) { this.activeTime = time; this.paint(); }

  /** 同一张表可切换数据集：成交明细与 Level-2 挂单共用四列网格，只换表头与标签字段 */
  headHtml() {
    // 空 class 表示该列左对齐（如「时间」）；不能回退成 num，否则表头右对齐而数据行左对齐
    return this.heads.map((h, i) => `<span class="${this.colCls[i] || ''}">${h}</span>`).join('');
  }
  setViewConfig({ heads, labelKey, cols, colCls, extraKey }) {
    if (heads) this.heads = heads;
    if (labelKey) this.labelKey = labelKey;
    this.cols = cols || '62px 1fr 1fr 30px';
    this.colCls = colCls || ['', 'num', 'num', 'side'];
    this.extraKey = extraKey || null;
    this.renderShell();   // 列模板写在 shadow CSS 里，需重建表头与行网格
  }

  /**
   * 多栏连续时间线视图：本栏不滚动，由外部按全局时间窗口喂入一段数据。
   * 只替换 spacer 高度并重绘，不重建 shadow DOM，滚动时无闪烁。
   */
  setWindow(rows) {
    this.rows = rows || [];
    this._windowMode = true;
    if (!this.view) { this.renderShell(); return; }
    this.spacer.style.height = `${this.rows.length * this.rowH}px`;
    this.paint();
  }

  /** 多组逐笔视图共享滚动位置时使用的读写接口 */
  scrollPosition() { return this.view?.scrollTop || 0; }
  /**
   * 4 条标题/表头行统一为 --sc-bar-h（由 stock-chart.syncSideBars 按侧栏余数均分下发）；
   * 视口高度由 CSS calc 自动占满宿主剩余空间，余数已由这 4 条行与买卖间隙消化，
   * 因此视口恰好是整数个 rowH，不会出现半行或底部留白。
   */
  layoutMetrics(hostH) {
    const headH = LAYOUT.barH;
    const avail = Math.max(this.rowH, hostH - headH);
    return { headH, viewH: Math.floor(avail / this.rowH) * this.rowH };
  }

  visibleRows() { return Math.max(1, Math.floor((this.view?.clientHeight || 0) / this.rowH)); }
  setScrollTop(top) {
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
    this.onCrosshair = (e) => {
      const item = e.detail?.item;
      this.setActiveTime(item ? (item.time || '').slice(0, 5) : null);
    };
    // 只监听所属 <stock-chart> 实例的事件，避免同页多个图表互相高亮；独立使用时退回 document
    const rootHost = this.getRootNode()?.host?.closest?.('stock-chart');
    this._eventHost = this.closest('stock-chart') || rootHost || document;
    this._eventHost.addEventListener('crosshair-change', this.onCrosshair);
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
    (this._eventHost || document).removeEventListener('crosshair-change', this.onCrosshair);
    this.ro?.disconnect();
  }
  attributeChangedCallback(name, oldV, newV) {
    if (!this.isConnected || oldV === newV) return;
    if (name === 'order' && this._rawRows.length) this.setData(this._rawRows);
    else this.paint();
  }

  renderShell() {
    const keepScroll = this.view?.scrollTop || 0;
    const total = this.rows.length * this.rowH;
    // 侧栏态跟随 host 统一分配的 --sc-bar-h；覆盖视图用基准 barH 避免继承侧栏余数
    const bar = this._windowMode ? `${LAYOUT.barH}px` : `var(--sc-bar-h,${LAYOUT.barH}px)`;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;height:100%;background:var(--sc-bg,${PALETTE.background});font:11px/1.35 system-ui,-apple-system,sans-serif;color:var(--sc-text,${PALETTE.text})}
        .head{display:grid;grid-template-columns:${this.cols};gap:4px;align-items:center;
              height:${bar};padding:0 6px;box-sizing:border-box;
              background:var(--sc-panel,#fff);border-bottom:1px solid var(--sc-line,#E3E6EB);color:var(--sc-muted,#9AA3AF);font-size:10px;
              letter-spacing:.2px}
        .view{height:calc(100% - ${bar});
              overflow:${this._windowMode ? 'hidden' : 'auto'};position:relative;background:var(--sc-bg,${PALETTE.background});
              scrollbar-width:none;-ms-overflow-style:none}
        .view::-webkit-scrollbar{display:none}
        .spacer{height:${total}px;position:relative}
        .row{position:absolute;left:0;right:0;height:${this.rowH}px;display:grid;
             grid-template-columns:${this.cols};gap:4px;padding:0 6px;align-items:center;
             box-sizing:border-box;background:var(--sc-bg,${PALETTE.background})}
        .row.alt{background:var(--sc-panel,#FAFBFC)}
        .row:hover{background:#EEF4FC;background:color-mix(in srgb,var(--sc-link,#1B5FBF) 10%,transparent)}
        .row.active,.row.active.alt{background:#FFF4E5;background:color-mix(in srgb,var(--sc-up,#E24B4A) 12%,transparent)}
        /* 整行按逐笔涨跌着色：A 股习惯涨红跌绿，平盘用中性灰；颜色走 host 变量，随实例主题刷新 */
        .row.up{color:var(--sc-up,${PALETTE.up})}
        .row.down{color:var(--sc-down,${PALETTE.down})}
        .row.flat{color:var(--sc-muted,${PALETTE.textMuted})}
        .row .price{font-weight:600}
        .num{text-align:right;font-variant-numeric:tabular-nums}
        .side{text-align:center}
        .tag{display:inline-block;min-width:15px;padding:0 3px;border-radius:3px;font-size:10px;
             font-weight:600;font-style:normal;line-height:16px}
        .tag.up{background:#FDECEC;color:var(--sc-up,${PALETTE.up});
                background:color-mix(in srgb,var(--sc-up,#E24B4A) 12%,transparent)}
        .tag.down{background:#E6F5EE;color:var(--sc-down,${PALETTE.down});
                  background:color-mix(in srgb,var(--sc-down,#1D9E75) 12%,transparent)}
        .tag.flat{background:var(--sc-panel,#F1F2F4);color:var(--sc-muted,#6B7280)}
        /* 撤单按被撤委托方向区分：BC 买撤（红系）/ SC 卖撤（绿系），行文字仍为中性灰 */
        .tag.BC{background:#FDECEC;background:color-mix(in srgb,var(--sc-up,#E24B4A) 12%,transparent);color:var(--sc-up,#C0392B)}
        .tag.SC{background:#E6F5EE;background:color-mix(in srgb,var(--sc-down,#1D9E75) 12%,transparent);color:var(--sc-down,#0E7A55)}
        /* 部分成交：BF 买成交 / SF 卖成交，用细边框与挂单标签区分 */
        .tag.BF{background:#FDECEC;background:color-mix(in srgb,var(--sc-up,#E24B4A) 12%,transparent);
                color:var(--sc-up,#A32D2D);border:1px solid color-mix(in srgb,var(--sc-up,#E24B4A) 35%,transparent)}
        .tag.SF{background:#E6F5EE;background:color-mix(in srgb,var(--sc-down,#1D9E75) 12%,transparent);
                color:var(--sc-down,#0E7A55);border:1px solid color-mix(in srgb,var(--sc-down,#1D9E75) 35%,transparent)}
      </style>
      <div class="head">${this.headHtml()}</div>
      <div class="view"><div class="spacer"></div></div>`;
    const view = this.shadowRoot.querySelector('.view');
    view.addEventListener('scroll', () => {
      this.paint();
      if (this._suppressBroadcast) { this._suppressBroadcast = false; return; }
      // 供多组视图把所有栏同步到同一滚动位置，保持时间衔接
      this.dispatchEvent(new CustomEvent('tape-scroll', { detail: { top: this.view.scrollTop } }));
    });
    this.view = view;
    this.view.scrollTop = keepScroll;
    this.spacer = this.shadowRoot.querySelector('.spacer');
    this.paint();
  }

  paint() {
    if (!this.view || !this.spacer) return;
    const top = this._windowMode ? 0 : this.view.scrollTop;
    const count = Math.ceil(this.view.clientHeight / this.rowH) + 4;
    const from = Math.max(0, Math.floor(top / this.rowH) - 2);
    const to = Math.min(this.rows.length, from + count);
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) {
      const t = this.rows[i];
      const el = document.createElement('div');
      const trend = t.trend > 0 ? 'up' : (t.trend < 0 ? 'down' : 'flat');
      const label = t[this.labelKey] ?? t.side;
      el.className = `row ${trend}${i % 2 ? ' alt' : ''}${this.activeTime && t.time.slice(0, 5) === this.activeTime ? ' active' : ''}`;
      el.style.top = `${i * this.rowH}px`;
      const extra = this.extraKey
        ? `<span class="num">${(t[this.extraKey] ?? 0).toLocaleString('zh-CN')}</span>` : '';
      el.innerHTML = `<span>${t.time.length === 5 ? `${t.time}:00` : t.time}</span><span class="num price">${t.price.toFixed(2)}</span>` +
        `<span class="num">${t.volume.toLocaleString('zh-CN')}</span>${extra}` +
        `<span class="side"><i class="tag ${trend} ${label}">${label}</i></span>`;
      frag.appendChild(el);
    }
    this.spacer.replaceChildren(frag);
  }
}

// 标签注册统一由 src/index.js 的 defineAll() 显式负责，本模块保持无副作用
