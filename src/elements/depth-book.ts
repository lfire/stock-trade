// 十档盘口：DOM 表格，支持 5/10 档切换与「普通 / 涨停 / 跌停」三种盘口场景。
// 涨跌停时一侧无挂单，用提示条代替多行空档，并把封单档高亮。
import { LAYOUT } from '../types';
import { emitEvent, CHART_EVENTS } from '../events';
import type { DepthLevel, DepthUnit, DepthBookSnapshot } from '../types';
import { trim } from '../algorithms/format';

export class DepthBook extends HTMLElement {
  declare snap: DepthBookSnapshot | null;
  declare compact: boolean;
  declare levels: number;
  declare unit: DepthUnit;
  constructor() {
    super();
    this.snap = null;
    this.compact = false;
    this.levels = 10;
    this.unit = 'volume';   // 'volume' 挂单量 / 'amount' 挂单金额
    this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() { return ['levels']; }

  attributeChangedCallback() {
    const n = Number(this.getAttribute('levels'));
    this.levels = n === 5 ? 5 : 10;
    if (this.isConnected) this.render();
  }

  setData(snapshots: DepthBookSnapshot[] | null) { this.snap = snapshots?.[0] || null; this.render(); }
  setLevels(n: number) { this.setAttribute('levels', n === 5 ? '5' : '10'); }
  setUnit(u: DepthUnit) {
    const v = u === 'amount' ? 'amount' : 'volume';
    if (this.unit === v) return;
    this.unit = v;
    this.render();
  }

  /** 侧栏展开成交明细时，盘口只保留卖1 / 买1 各一行，腾出高度 */
  setCompact(on: boolean | undefined) { if (this.compact === !!on) return; this.compact = !!on; this.render(); }

  connectedCallback() { this.render(); }

  render() {
    const s = this.snap;
    if (!s) { this.shadowRoot!.innerHTML = ''; return; }
    this.classList.toggle('five', this.levels === 5);
    this.classList.toggle('compact', this.compact);
    const rows: string[] = [];
    const levels = this.compact ? 1 : this.levels;
    const asks: DepthLevel[] = s.asks || [], bids: DepthLevel[] = s.bids || [];
    const lim = s.limitState as string;                 // 'limitUp' | 'limitDown'
    const limitPx = s.limitPrice as number;
    // 金额 = 委托价 × 挂单量，实时计算；量柱按当前口径归一化，从右向左延伸。
    // 窄列按数值大小自适应换算 万 / 亿，小数位随量级收敛；精确值放 title 供 hover 查看。
    const isAmt = this.unit === 'amount';
    const metric = (price: number, volume: number) => isAmt ? price * volume : volume;
    // 窄列小数位收敛复用 algorithms/format 的 trim（≥100 取整、≥10 取 1 位）。
    const fmtCell = (price: number, volume: number) => {
      const v = metric(price, volume);
      return v >= 1e8 ? `${trim(v / 1e8)}亿` : v >= 1e4 ? `${trim(v / 1e4)}万` : `${Math.round(v)}`;
    };
    const maxVal = Math.max(1,
      ...asks.slice(0, levels).map((a) => metric(a.price, a.volume)),
      ...bids.slice(0, levels).map((b) => metric(b.price, b.volume)));
    const row = (cls: string, label: string, price: number, volume: number, count: number, color: string) => {
      const w = Math.max(3, Math.round((metric(price, volume) / maxVal) * 100));
      const cell = fmtCell(price, volume);
      const tip = `${volume.toLocaleString('zh-CN')} 股 · ${(price * volume).toFixed(2)} 元`;
      return `<div class="row ${cls}"><i class="bar" style="width:${w}%"></i>`
        + `<span class="lbl">${label}</span><b style="color:${color}">${price.toFixed(2)}</b>`
        + `<span class="num" title="${tip}">${cell}</span><span class="num">${count}</span></div>`;
    };
    const emptyRow = (cls: string, label: string) => `<div class="row ${cls} empty">`
      + `<span class="lbl">${label}</span><span>—</span><span class="num">—</span><span class="num">—</span></div>`;
    const sealed = (side: string, i: number) => (i === 0
      && ((side === 'bid' && lim === 'limitUp') || (side === 'ask' && lim === 'limitDown')) ? ' sealed' : '');

    // 卖档区：涨停时无卖盘，用一条提示代替多行空档
    if (lim === 'limitUp') {
      rows.push(`<div class="limit-note up">涨停 ${limitPx.toFixed(2)} · 无卖盘</div>`);
    } else {
      for (let i = levels - 1; i >= 0; i -= 1) {
        const a = asks[i];
        rows.push(a
          ? row(`ask${sealed('ask', i)}`, `卖${i + 1}`, a.price, a.volume, a.orderCount, 'var(--sw-down,#1D9E75)')
          : emptyRow('ask', `卖${i + 1}`));
      }
    }
    // 买卖盘之间只用一条细分隔线，不再显示「E · 买卖分界」文字行
    rows.push('<div class="split"></div>');
    // 买档区：跌停时无买盘
    if (lim === 'limitDown') {
      rows.push(`<div class="limit-note down">跌停 ${limitPx.toFixed(2)} · 无买盘</div>`);
    } else {
      for (let i = 0; i < levels; i += 1) {
        const b = bids[i];
        rows.push(b
          ? row(`bid${sealed('bid', i)}`, `买${i + 1}`, b.price, b.volume, b.orderCount, 'var(--sw-up,#E24B4A)')
          : emptyRow('bid', `买${i + 1}`));
      }
    }

    // 档位名始终显示当前选择的档数；展开态只保留 1 档内容，但名称不跟着变
    const lvlLabel = `${this.levels}档`;
    const unitLabel = isAmt ? '额' : '量';
    this.shadowRoot!.innerHTML = `
      <style>
        :host{display:block;background:var(--sw-bg,transparent);font:11px/1.35 system-ui,-apple-system,sans-serif;color:var(--sw-text)}
        .title{display:flex;align-items:center;justify-content:space-between;gap:8px;
               height:var(--sw-bar-h,${LAYOUT.barH}px);padding:0 8px;box-sizing:border-box;
               background:var(--sw-bg,transparent);border-bottom:1px solid var(--sw-line,transparent);
               position:sticky;top:0;z-index:2}
        .title .lead{display:flex;align-items:center;gap:7px;min-width:0}
        .title .name{font:500 11px/1.4 system-ui,-apple-system,sans-serif;
                     color:var(--sw-text);white-space:nowrap;letter-spacing:.3px}
        .seg{display:inline-flex;flex:0 0 auto;border:1px solid var(--sw-line,transparent);border-radius:4px;
             overflow:hidden;background:var(--sw-panel,transparent)}
        .seg button{border:0;background:transparent;padding:1px 6px;cursor:pointer;white-space:nowrap;
                    color:var(--sw-text);font:10px/1.5 system-ui,-apple-system,sans-serif}
        .seg button + button{border-left:1px solid var(--sw-line,transparent)}
        .seg button:hover{background:var(--sw-line,transparent)}
        .seg button:active{background:var(--sw-panel,transparent)}
        .all-orders{flex:0 0 auto;border:0;background:none;padding:0;cursor:pointer;white-space:nowrap;
                    color:var(--sw-link);font:10px/1.4 system-ui,-apple-system,sans-serif}
        .all-orders:hover{text-decoration:underline}
        .cols{display:grid;grid-template-columns:40px 1fr 1fr 1fr;gap:4px;align-items:center;
              height:var(--sw-bar-h,${LAYOUT.barH}px);padding:0 6px;box-sizing:border-box;
              background:var(--sw-bg,transparent);border-bottom:1px solid var(--sw-line,transparent);
              color:var(--sw-muted);font:10px/1 system-ui,-apple-system,sans-serif;
              letter-spacing:.2px;position:sticky;top:var(--sw-bar-h,${LAYOUT.barH}px);z-index:1}
        .cols span:nth-child(n+2){text-align:right}
        /* 5 档 / 10 档 / compact 全部同一行高，与交易明细虚拟滚动行高一致 */
        .row{position:relative;display:grid;grid-template-columns:40px 1fr 1fr 1fr;gap:4px;
             align-items:center;height:${LAYOUT.rowH}px;padding:0 6px;box-sizing:border-box;
             line-height:1;border-bottom:1px solid var(--sw-line,transparent);
             font-variant-numeric:tabular-nums;overflow:hidden}
        .row > span,.row > b{position:relative;z-index:1}
        .row .lbl{color:var(--sw-muted)}
        .row .num{text-align:right;color:var(--sw-muted)}
        .row.empty,.row.empty .num{color:color-mix(in srgb,var(--sw-muted) 60%,transparent)}
        .row .bar{position:absolute;right:0;left:auto;top:0;bottom:0;z-index:0}
        /* 量能底色由主题涨跌色派生，浅色 / 深色都保持低饱和 */
        .row.ask .bar{background:color-mix(in srgb,var(--sw-down) 12%,transparent)}
        .row.bid .bar{background:color-mix(in srgb,var(--sw-up) 12%,transparent)}
        .row.sealed{font-weight:600;background:color-mix(in srgb,var(--sw-up) 8%,transparent)}
        .row.sealed .lbl{color:var(--sw-up)}
        .limit-note{display:flex;align-items:center;justify-content:center;min-height:120px;
                    margin:10px 8px;padding:8px 10px;border-radius:6px;text-align:center;
                    font:11px/1.5 system-ui,-apple-system,sans-serif;font-weight:600}
        .limit-note.up{background:color-mix(in srgb,var(--sw-up) 10%,transparent);
                       color:var(--sw-up);border:1px solid color-mix(in srgb,var(--sw-up) 30%,transparent)}
        .limit-note.down{background:color-mix(in srgb,var(--sw-down) 10%,transparent);
                         color:var(--sw-down);border:1px solid color-mix(in srgb,var(--sw-down) 30%,transparent)}
        .split{height:1px;background:var(--sw-line,transparent);
               margin:calc((var(--sw-split-h,${LAYOUT.splitH}px) - 1px)/2) 6px}
      </style>
      <div class="title"><span class="lead">
        <span class="name">盘口</span>
        <span class="seg">
          <button type="button" class="lvl" title="切换五档 / 十档">${lvlLabel} ▾</button>
          <button type="button" class="unit" title="切换挂单量（股，自动换算万股/亿股）/ 挂单金额（元 = 委托价 × 挂单量，自动换算万元/亿元）；hover 数值可看精确值">${unitLabel} ▾</button>
        </span></span>
        <button type="button" class="all-orders">全景盘口 →</button></div>
      <div class="cols"><span>档位</span><span>价格</span><span>${isAmt ? '金额' : '挂单量'}</span><span>笔数</span></div>
      ${rows.join('')}`;
    this.shadowRoot!.querySelector('.lvl')!.addEventListener('click', () => {
      this.setLevels(this.levels === 10 ? 5 : 10);
      emitEvent(this, CHART_EVENTS.DEPTH_LEVELS_CHANGE, { levels: this.levels });
    });
    this.shadowRoot!.querySelector('.unit')!.addEventListener('click', () => {
      const next = this.unit === 'volume' ? 'amount' : 'volume';
      // 只发 request；由 <stock-chart> 统一派发 depth-unit-change，避免双派发
      emitEvent(this, CHART_EVENTS.DEPTH_UNIT_REQUEST, { unit: next });
    });
    this.shadowRoot!.querySelector('.all-orders')!.addEventListener('click', () => {
      emitEvent(this, CHART_EVENTS.VIEW_PANORAMA, {});
    });
  }
}

// 标签注册统一由 src/index.ts 的 defineAll() 显式负责，本模块保持无副作用
