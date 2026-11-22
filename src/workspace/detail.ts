/**
 * 详情画布的全部渲染逻辑（<stock-workspace> 内部模块，light DOM，视觉零变化）。
 *
 * 逐字搬自 index.html 的以下区间，DOM 结构 / 文案 / class / data-set 值 / LAYOUT.rowH 全部保留：
 *   1385-1396  覆盖视图状态 + coverRegion(id) 的 region()/querySelector 回退
 *   1401-1408  applySideExpanded(on)
 *   1419-1444  renderDetailWindow()
 *   1447-1460  updateDetailSpacer()
 *   1462-1506  buildDetailGroups()（动态 trade-tape / setViewConfig / setWindow / dataset.groups）
 *   1509-1612  renderPanorama()（getScenarioPano / .pano-* 全量 HTML / cover-panorama.innerHTML）
 *   1615-1634  applyDetailMode() / switchDetailSet()
 *   1636-1688  openTapeDetail() / closeTapeDetail()（tab / 返回 / scroll / ResizeObserver）
 *   1690-1718  placeTape() / tape-card click / book 的 view-panorama
 *   1246-1259  depth-scenario-change / depth-unit-change
 *   1261-1281  bindDataset 的详情部分（trend 派生 / orderMix / tape.setData / cover 刷新 / pendingScroll）
 *   1864-1890  tape-side / tape-zoom / tape-set / tape-scroll 的应用（改由 config 驱动）
 *
 * 与页面的结构性差异（统一契约）：
 *   - 状态不再用模块级 `let detailCover / coverRO / coverTapes ...`，全部收进
 *     WeakMap<HTMLElement, State>（key = ctx.root），多实例互不串扰。
 *   - 数据从 ctx.data() 现场派生，不再引用页面级全局 allTrades / allOrders。
 *   - 元素查询一律 ctx.root.querySelector，页面级 demo-bar（sel-*）做防御式可选绑定。
 *   - 配置输出只走 ctx.patchConfig；不解析 URL、不改全局 document/window、不 new CustomEvent。
 *   - 事件绑定统一用 AbortController（mount 级 + cover 级各一个），清理时 abort + 断 RO。
 *
 * config 驱动约定（由主元素从 URL/控件写入 config，本模块只读消费）：
 *   tapePlacement : 'side' = 明细卡片停在侧栏、覆盖视图关闭；'detail' = 打开占满图表区的覆盖视图（tape-zoom）
 *   tapeZoom      : >0 = 侧栏一级展开（tape-side；tape-zoom 打开覆盖视图时也隐含展开）
 *   tapeSet       : 覆盖视图当前数据集（trades / orders / panorama，对应 tape-set）
 *   tapeScroll    : 覆盖视图时间线滚动像素（tape-scroll，数据/覆盖视图就绪后应用）
 *   仅分时模式（mode === 'intraday'）允许展开侧栏与打开覆盖视图；K 线一律收起。
 */
import type { WorkspaceContext, DetailSet } from './types';
import type {
  ChartMode, DepthUnit, OrderRecord, TradeTick, TradeTapeViewConfig,
} from '../types';
import { LAYOUT } from '../types';
import { detailGroupCount } from '../architecture/detail-canvas-layout';
import { trim } from '../algorithms/format';

/** 一条连续时间线的数据行：逐笔行带 trend 派生字段 */
type TradeRow = TradeTick & { trend: number };
type DetailRow = TradeTick | OrderRecord;

/** 全景盘口档位（getScenarioPano / reduceOrderBook 的运行时形状） */
interface PanoLevel { price: number; volume: number; orderCount: number; }
interface PanoSnapshot {
  bids: PanoLevel[];
  asks: PanoLevel[];
  limitUp: number;
  limitDown: number;
  mid: number;
  time: string;
}

/** <stock-chart> 上详情逻辑用到的公开方法（ctx.chart 为通用 HTMLElement，按窄接口断言） */
interface ChartApi extends HTMLElement {
  getScenarioPano?(): PanoSnapshot | null;
  getState?(): { depthUnit: DepthUnit };
  attachCover?(el: HTMLElement): void;
  attachDetailCard?(card: HTMLElement): void;
  detachDetailCard?(card: HTMLElement, home: HTMLElement): void;
  setSideExpanded?(on: boolean): void;
}

/** <trade-tape> 用到的公开方法（含侧栏 #tape 与覆盖视图内动态创建的实例） */
interface TapeApi extends HTMLElement {
  setData(rows: DetailRow[]): void;
  setViewConfig(cfg: TradeTapeViewConfig): void;
  setWindow(rows: DetailRow[]): void;
  visibleRows(): number;
}

/** <depth-book> 用到的公开方法 */
interface BookApi extends HTMLElement {
  setData(rows: Array<Record<string, unknown>> | null): void;
  setUnit(unit: DepthUnit): void;
}

/**
 * <detail-canvas> 容器消费面：成员刻意声明为可选，与原页面里
 * `region?.()` / `setWindow?.()` / `groupCount ||` / `typeof spacerHeight === 'number'` 的
 * 「容器可能未升级」兜底写法一一对应。
 */
interface CoverApi extends HTMLElement {
  region?(id: string): HTMLElement | null;
  setDetailSet?(set: DetailSet): void;
  setWindow?(from: number, totalRows: number): void;
  groupCount?: number;
  spacerHeight?: number;
}

interface CoverTape { head: HTMLElement; tape: TapeApi; }

/** 每个 root 一份的闭包状态（替代原页面的全局 let 变量） */
interface State {
  controller: AbortController;        // mount 级事件（chart / tape-card / book）
  coverAbort: AbortController | null; // 覆盖视图内事件（tabs / 返回 / scroll）
  coverRO: ResizeObserver | null;
  detailCover: CoverApi | null;
  coverTapes: CoverTape[];
  sideExpanded: boolean;
  detailFrom: number;
  detailL: number;
  detailSet: DetailSet;
  pendingScroll: number | null;
  appliedScroll: number | null;       // 已消费的 tapeScroll，避免重复应用
  allTrades: TradeRow[];
  allOrders: OrderRecord[];
  orderMix: string;
}

const states = new WeakMap<HTMLElement, State>();
const DETAIL_ROW_H = LAYOUT.rowH;

function createState(): State {
  return {
    controller: new AbortController(),
    coverAbort: null,
    coverRO: null,
    detailCover: null,
    coverTapes: [],
    sideExpanded: false,
    detailFrom: 0,
    detailL: 20,
    detailSet: 'trades',
    pendingScroll: null,
    appliedScroll: null,
    allTrades: [],
    allOrders: [],
    orderMix: '',
  };
}

function getState(ctx: WorkspaceContext): State {
  let s = states.get(ctx.root);
  if (!s) {
    s = createState();
    states.set(ctx.root, s);
  }
  return s;
}

/** 在 light DOM 根范围内按 id 取元素（替代页面级 document.getElementById） */
function el<T extends Element = HTMLElement>(ctx: WorkspaceContext, id: string): T | null {
  return ctx.root.querySelector<T>(`#${id}`);
}

function chartApi(ctx: WorkspaceContext): ChartApi {
  return ctx.chart as unknown as ChartApi;
}

/** book / tape 是 <stock-chart> 子组件实例；id 缺失时按标签名兜底，均防御式返回可空 */
function bookOf(ctx: WorkspaceContext): BookApi | null {
  const node = ctx.root.querySelector<HTMLElement>('#book')
    ?? ctx.chart.querySelector<HTMLElement>('#book')
    ?? ctx.root.querySelector<HTMLElement>('depth-book');
  return node as BookApi | null;
}

function tapeOf(ctx: WorkspaceContext): TapeApi | null {
  return ctx.root.querySelector<HTMLElement>('#tape') as TapeApi | null;
}

/**
 * index.html:1393-1396 — Region id → 容器内 DOM 节点：容器就绪走 region()，
 * 未升级 / 截图兜底回退到 light DOM querySelector（`.类` 选择器）。逐字保留回退链。
 */
function coverRegion(ctx: WorkspaceContext, id: string): HTMLElement | null {
  const cover = getState(ctx).detailCover;
  return cover?.region?.(id)
    || cover?.querySelector<HTMLElement>(`.${id}`)
    || null;
}

/** index.html:1411 — 分组/时间线取当前数据集 */
function detailRows(ctx: WorkspaceContext): DetailRow[] {
  const s = getState(ctx);
  return s.detailSet === 'orders' ? s.allOrders : s.allTrades;
}

/** index.html:1412-1413 — 视角标签 */
function detailLabel(ctx: WorkspaceContext): string {
  const labels: Record<string, string> = { orders: '全部挂单', panorama: '全景盘口' };
  return labels[getState(ctx).detailSet] || '逐笔明细';
}

/** index.html:1401-1408 — 一级展开：底部条可见性 + 组件重算 + 卡片状态 + 提示文案 */
function applySideExpanded(ctx: WorkspaceContext, on: boolean): void {
  const s = getState(ctx);
  s.sideExpanded = !!on;
  // 先改底部条可见性，再让组件按新 footerH 重算 4 条行与间隙的均分
  const btn = el(ctx, 'tape-detail');
  if (btn) btn.hidden = !s.sideExpanded;
  chartApi(ctx).setSideExpanded?.(s.sideExpanded);
  el(ctx, 'tape-card')?.classList.toggle('side-open', s.sideExpanded);
  const hint = el(ctx, 'tape-hint');
  if (hint) hint.textContent = s.sideExpanded ? '点击收起' : '点击展开';
}

/** index.html:1419-1444 — 一条连续时间线按栏顺排，栏 g 显示 [from+g*L, from+(g+1)*L) */
function renderDetailWindow(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (s.detailSet === 'panorama' || !s.detailCover || !s.coverTapes.length) return;
  const rowsAll = detailRows(ctx);
  const total = rowsAll.length;
  const n = s.coverTapes.length, L = s.detailL;
  const maxFrom = Math.max(0, total - n * L);
  s.detailFrom = Math.max(0, Math.min(s.detailFrom, maxFrom));
  for (const [g, item] of s.coverTapes.entries()) {
    const rows = rowsAll.slice(
      s.detailFrom + g * L,
      s.detailFrom + (g + 1) * L,
    );
    item.tape.setWindow(rows);
    item.head.textContent = rows.length
      ? `${g + 1}/${n} · ${rows[0].time}–${rows[rows.length - 1].time} · ${rows.length} 条`
      : `${g + 1}/${n} · —`;
  }
  const count = coverRegion(ctx, 'cover-count');
  if (count)
    count.textContent = `${detailLabel(ctx)} · 共 ${total} 条${s.detailSet === 'orders' ? s.orderMix : ''} · ${n} 栏连续时间线 · 第 ${s.detailFrom + 1}–${Math.min(total, s.detailFrom + n * L)} 条`;
  const sc = coverRegion(ctx, 'cover-scroll');
  if (sc && Math.abs(sc.scrollTop - s.detailFrom * DETAIL_ROW_H) > 1)
    sc.scrollTop = s.detailFrom * DETAIL_ROW_H;
}

/** index.html:1447-1460 — 滚动条范围只对应整条时间线的起点/终点 */
function updateDetailSpacer(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (!s.detailCover) return;
  const spacer = coverRegion(ctx, 'cover-scroll-spacer');
  if (!spacer) return;
  // 布局真源在容器：直接消费 compute 写回的 spacerHeight；容器未升级则回退到原公式
  if (typeof s.detailCover.spacerHeight === 'number') {
    spacer.style.height = `${s.detailCover.spacerHeight}px`;
  } else {
    const total = detailRows(ctx).length, L = s.detailL, n = s.coverTapes.length || 1;
    spacer.style.height = `${Math.max(0, total - n * L + L) * DETAIL_ROW_H}px`;
  }
}

/** index.html:1462-1506 — 按容器 groupCount 动态建多组 trade-tape，保留容器调用方式 */
function buildDetailGroups(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (!s.detailCover) return;
  const grid = coverRegion(ctx, 'cover-groups');
  if (!grid) return;
  // 先同步容器窗口（totalRows / 尺寸），再消费 compute 写回的 groupCount 作为分组数
  s.detailCover.setWindow?.(s.detailFrom, detailRows(ctx).length);
  const n = s.detailCover.groupCount
    || detailGroupCount(s.detailCover.clientWidth || chartApi(ctx).clientWidth || 900);
  grid.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  grid.replaceChildren();
  s.coverTapes = [];
  const doc = ctx.root.ownerDocument;
  for (let g = 0; g < n; g += 1) {
    const col = doc.createElement('div');
    col.className = 'group';
    const head = doc.createElement('div');
    head.className = 'group-head';
    const t = doc.createElement('trade-tape') as unknown as TapeApi;
    col.append(head, t);
    grid.appendChild(col);
    t.setViewConfig(
      s.detailSet === 'orders'
        ? {
            heads: ['时间', '委托价', '数量', '剩余', '类型'],
            labelKey: 'tag',
            cols: '52px 1fr 1fr 1fr 34px',
            colCls: ['', 'num', 'num', 'num', 'side'],
            extraKey: 'remainVolume',
          }
        : {
            heads: ['时间', '价格', '成交量', '方向'],
            labelKey: 'side',
            cols: '62px 1fr 1fr 30px',
            colCls: ['', 'num', 'num', 'side'],
            extraKey: null,
          },
    );
    t.setWindow([]);
    s.coverTapes.push({ head, tape: t });
  }
  s.detailCover.dataset.groups = String(n);
  s.detailL = Math.max(1, s.coverTapes[0].tape.visibleRows() || 20);
  updateDetailSpacer(ctx);
  renderDetailWindow(ctx);
}

/** index.html:1509-1612 — 全景盘口：左右两块列出当前时刻所有有效买/卖价格档位 */
function renderPanorama(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (!s.detailCover) return;
  const host = coverRegion(ctx, 'cover-panorama');
  if (!host) return;
  // 读组件暴露的「当前场景全景盘口」：切 limitUp 显示封单、切回 normal 恢复原始盘口；
  // 不再读 chart.getState().pano（后者恒为数据集原始全景，不随场景变化）。
  const p = chartApi(ctx).getScenarioPano?.() ?? null;
  if (!p) {
    host.innerHTML = '<div class="pano-empty">全景盘口数据未就绪</div>';
    return;
  }
  // 全部统计都由当前 bids/asks 实时计算，不写在数据文件里：
  // 吃光所有卖档 = 拉到涨停；吃光所有买档 = 砸到跌停。
  const sumOf = (rows: PanoLevel[]) =>
    rows.reduce(
      (a, d) => {
        a.volume += d.volume;
        a.amount += d.price * d.volume;
        a.orders += d.orderCount;
        return a;
      },
      { volume: 0, amount: 0, orders: 0 },
    );
  const fmtVol = (v: number) =>
    v >= 1e8
      ? `${(v / 1e8).toFixed(2)} 亿股`
      : v >= 1e4
        ? `${(v / 1e4).toFixed(2)} 万股`
        : `${v.toLocaleString('zh-CN')} 股`;
  const fmtAmt = (a: number) =>
    a >= 1e8
      ? `${(a / 1e8).toFixed(2)} 亿元`
      : a >= 1e4
        ? `${(a / 1e4).toFixed(2)} 万元`
        : `${a.toFixed(0)} 元`;
  const bidSum = sumOf(p.bids), askSum = sumOf(p.asks);
  const bidStat =
    `砸至跌停 ${p.limitDown.toFixed(2)}（${((p.limitDown / p.mid - 1) * 100).toFixed(2)}%）` +
    ` 需成交 <b>${fmtVol(bidSum.volume)}</b> · 消耗 <b>${fmtAmt(bidSum.amount)}</b> · <b>${bidSum.orders}</b> 笔委托 / ${p.bids.length} 档`;
  const askStat =
    `拉至涨停 ${p.limitUp.toFixed(2)}（+${((p.limitUp / p.mid - 1) * 100).toFixed(2)}%）` +
    ` 需成交 <b>${fmtVol(askSum.volume)}</b> · 消耗 <b>${fmtAmt(askSum.amount)}</b> · <b>${askSum.orders}</b> 笔委托 / ${p.asks.length} 档`;

  // 金额按「委托价 × 挂单量」实时计算；量柱也按当前口径归一化
  const state = chartApi(ctx).getState?.();
  const isAmt = state?.depthUnit === 'amount';
  const metric = (d: PanoLevel) => (isAmt ? d.price * d.volume : d.volume);
  // 数值按大小自适应换算 万 / 亿，小数位随量级收敛；精确值放 title 供 hover 查看。
  // trim 与 `format.ts` 的 `trim` 同源（`depth-book` 已复用）：≥100 → 0 位、≥10 → 1 位、其余 2 位。
  const fmtCell = (d: PanoLevel) => {
    const v = metric(d);
    return v >= 1e8
      ? `${trim(v / 1e8)}亿`
      : v >= 1e4
        ? `${trim(v / 1e4)}万`
        : `${Math.round(v)}`;
  };
  const unitTip = isAmt ? '元 / 万元 / 亿元' : '股 / 万股 / 亿股';
  const block = (
    ...[rows, side, label, limitName, limitPx, statText, emptyText]:
      [PanoLevel[], string, string, string, number, string, string]
  ): string => {
    const maxVal = Math.max(1, ...rows.map(metric));
    const first = rows.length ? rows[0].price.toFixed(2) : '—';
    return `
    <div class="pano-side ${side}">
      <div class="pano-cap"><b>${label} · ${rows.length} 档</b>
        <span>${first} → ${limitName} ${limitPx.toFixed(2)}</span></div>
      <div class="pano-stat">${statText}</div>
      <div class="pano-head"><span>档位</span><span class="num">委托价</span><span class="num" title="单位自适应（${unitTip}），hover 查看精确值">${isAmt ? '挂单额' : '挂单量'}</span><span class="num">笔数</span></div>
      <div class="pano-list">${
        rows.length
          ? rows
              .map((d, i) => {
                const cls = `pano-row${i < 10 ? ' near' : ''}${Math.abs(d.price - limitPx) < 1e-6 ? ' bound' : ''}`;
                const w = Math.max(3, Math.round((metric(d) / maxVal) * 100));
                return `<div class="${cls}"><div class="bar" style="width:${w}%"></div>
          <span class="lbl">${label[0]}${i + 1}</span>
          <span class="num">${d.price.toFixed(2)}</span>
          <span class="num" title="${d.volume.toLocaleString('zh-CN')} 股 · ${(d.price * d.volume).toFixed(2)} 元">${fmtCell(d)}</span>
          <span class="num">${d.orderCount}</span></div>`;
              })
              .join('')
          : `<div class="pano-empty">${emptyText}</div>`
      }</div>
    </div>`;
  };
  host.innerHTML =
    `
    <div class="pano-mid">现价 <b>${p.mid.toFixed(2)}</b> · 买一 ${p.bids[0]?.price.toFixed(2) ?? '—'}` +
    ` / 卖一 ${p.asks[0]?.price.toFixed(2) ?? '—'} · ${p.time} 快照</div>
    <div class="pano-cols">
      ${block(p.bids, 'bids', '买单', '跌停', p.limitDown, bidStat, '跌停封板 · 无买盘挂单')}
      ${block(p.asks, 'asks', '卖单', '涨停', p.limitUp, askStat, '涨停封板 · 无卖盘挂单')}
    </div>`;
  const count = coverRegion(ctx, 'cover-count');
  if (count)
    count.textContent = `全景盘口 · ${p.time} 现价 ${p.mid.toFixed(2)} · 买 ${p.bids.length} 档 / 卖 ${p.asks.length} 档 · 显示${isAmt ? '挂单金额' : '挂单量'}（单位自适应）`;
}

/** index.html:1615-1626 — 切换视角：连续时间线（成交/挂单）与全景盘口互斥显示 */
function applyDetailMode(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (!s.detailCover) return;
  const pano = s.detailSet === 'panorama';
  coverRegion(ctx, 'cover-body')?.classList.toggle('pano-mode', pano);
  coverRegion(ctx, 'cover-tabs')
    ?.querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.set === s.detailSet));
  if (pano) renderPanorama(ctx);
  else buildDetailGroups(ctx);
}

/**
 * index.html:1628-1634 — 切换数据集。
 * 与原页面唯一差异：cover 尚未创建时也把 set 记入状态（openDetail 无 set 参数，set 由状态/config 驱动）。
 */
function switchDetailSet(ctx: WorkspaceContext, set: DetailSet): void {
  const s = getState(ctx);
  if (set === s.detailSet) return;
  s.detailSet = set;
  s.detailFrom = 0;
  if (!s.detailCover) return;
  s.detailCover.setDetailSet?.(set); // 容器同步 set / pano-mode / 布局快照
  applyDetailMode(ctx);
}

/**
 * index.html:1275-1279 + 1884-1889 — tape-scroll 应用：数据/覆盖视图就绪后把多组视图
 * 统一滚到指定像素；panorama 视角不应用（与原条件一致）。未就绪时保留 pendingScroll 等待下次。
 */
function applyPendingScroll(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (s.pendingScroll == null) return;
  if (!s.detailCover || !s.allTrades.length) return;
  if (s.detailSet !== 'panorama') {
    s.detailFrom = Math.max(0, Math.floor(s.pendingScroll / DETAIL_ROW_H));
    s.detailCover.setWindow?.(s.detailFrom, detailRows(ctx).length);
    renderDetailWindow(ctx);
  }
  s.pendingScroll = null;
}

/** index.html:1682-1688 — 关闭覆盖视图：断 RO、解绑 cover 内事件、remove 触发容器自清 */
export function closeDetail(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  s.coverRO?.disconnect();
  s.coverRO = null;
  s.coverAbort?.abort();
  s.coverAbort = null;
  s.detailCover?.remove(); // 容器 disconnectedCallback 自清 RO / 监听 / 状态
  s.detailCover = null;
  s.coverTapes = [];
}

/**
 * index.html:1261-1281 — 数据到达后刷新详情：trend 派生 / orderMix / tape.setData /
 * detailCover 的 setWindow + applyDetailMode + pendingScroll。数据一律从 ctx.data() 现场取。
 */
function bindDataset(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  const ds = ctx.data();
  // 逐笔涨跌口径：以上一笔成交价为基准，首行对昨收；涨 1 / 跌 -1 / 平 0
  const preClose = ds?.manifest.preClose ?? 0;
  const trades = (ds?.trades || []) as TradeTick[];
  s.allTrades = trades.map((t, i, arr) => {
    const diff = t.price - (i === 0 ? preClose : arr[i - 1].price);
    return { ...t, trend: Math.abs(diff) < 1e-6 ? 0 : diff > 0 ? 1 : -1 };
  });
  s.allOrders = (ds?.orders || []) as unknown as OrderRecord[];
  const cnt = (a: string): number => s.allOrders.filter((o) => o.action === a).length;
  s.orderMix = ` · NEW ${cnt('NEW')} / FILL ${cnt('FILL')} / CANCEL ${cnt('CANCEL')}`;
  tapeOf(ctx)?.setData(s.allTrades);
  if (s.detailCover) {
    s.detailCover.setWindow?.(s.detailFrom, detailRows(ctx).length); // 数据到达后刷新容器 totalRows / spacerHeight
    applyDetailMode(ctx); // 数据到达后按当前视角重建（时间线或全景盘口）
    applyPendingScroll(ctx);
  }
}


/** index.html:1690-1706 — 明细卡片停放：分时挂进图表右列，K 线回 hidden 寄主并复位展开状态 */
function placeTape(ctx: WorkspaceContext, mode: ChartMode): void {
  const s = getState(ctx);
  const card = el(ctx, 'tape-card');
  const home = el(ctx, 'tape-home');
  if (!card || !home) return;
  const intraday = mode === 'intraday';
  // 底部条可见性在任何 setSideExpanded / syncSideBars 之前确定，避免 footerH 时序偏差
  const btn = el(ctx, 'tape-detail');
  if (btn) btn.hidden = !intraday || !s.sideExpanded;
  // K 线模式关闭覆盖视图、回到 hidden 寄主，并复位十档展开状态
  if (!intraday) {
    closeDetail(ctx);
    applySideExpanded(ctx, false);
  }
  // 挂载点经组件公开 API 收口，页面不再接触内部节点
  const chart = chartApi(ctx);
  if (intraday) chart.attachDetailCard?.(card);
  else chart.detachDetailCard?.(card, home);
  card.classList.toggle('tape-in-side', intraday);
}

/**
 * index.html:1636-1680 — 打开覆盖视图：创建 <detail-canvas> → chart.attachCover(cover)，
 * 绑定三个 data-set 按钮 / 返回按钮 / 滚动联动，并起 ResizeObserver。
 * 已打开时保持幂等（set 由 syncDetail / switchDetailSet 维护，不重复绑定 cover 内事件）。
 */
export function openDetail(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (s.detailCover) return;
  s.detailFrom = 0;
  // 容器自身即 .detail-cover：connectedCallback 建骨架、起 RO、产出首份布局快照
  const cover = ctx.root.ownerDocument.createElement('detail-canvas') as unknown as CoverApi;
  s.detailCover = cover;
  chartApi(ctx).attachCover?.(cover);
  // 同步容器状态（数据可能稍后由 bindDataset 到达，届时再刷新 setWindow）
  cover.setDetailSet?.(s.detailSet);
  cover.setWindow?.(s.detailFrom, detailRows(ctx).length);

  // cover 内事件单独一个 AbortController，closeDetail 时统一解绑
  s.coverAbort = new AbortController();
  const signal = s.coverAbort.signal;
  // 三个 data-set 按钮 / 返回按钮 / 滚动联动，交互保持原样
  coverRegion(ctx, 'cover-tabs')
    ?.querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => {
      b.classList.toggle('on', b.dataset.set === s.detailSet);
      b.addEventListener('click', () => {
        const set = (b.dataset.set || 'trades') as DetailSet;
        switchDetailSet(ctx, set);
        ctx.patchConfig({ tapeSet: set }); // 输出配置变更（不直接改全局）
      }, { signal });
    });
  coverRegion(ctx, 'cover-back')?.addEventListener('click', () => {
    closeDetail(ctx);
    ctx.patchConfig({ tapePlacement: 'side' });
  }, { signal });
  const sc = coverRegion(ctx, 'cover-scroll');
  sc?.addEventListener('scroll', () => {
    const f = Math.floor(sc.scrollTop / DETAIL_ROW_H);
    if (f === s.detailFrom) return;
    s.detailFrom = f;
    cover.setWindow?.(s.detailFrom, detailRows(ctx).length);
    renderDetailWindow(ctx);
    // 滚动是连续瞬时视图状态，不 patchConfig（避免主元素全量 sync 造成回环/重建）。
    // tapeScroll 作为初始输入由 syncDetail 统一消费。
  }, { signal });

  applyDetailMode(ctx);
  // 宽度/高度变化导致栏数或每栏可见行数变化时重建，保留当前时间窗口起点
  s.coverRO = new ResizeObserver(() => {
    if (!s.detailCover || s.detailSet === 'panorama') return;
    const n = detailGroupCount(s.detailCover.clientWidth);
    const L = Math.max(1, s.coverTapes[0]?.tape.visibleRows() || 20);
    if (n !== Number(s.detailCover.dataset.groups)) buildDetailGroups(ctx);
    else if (L !== s.detailL) {
      s.detailL = L;
      updateDetailSpacer(ctx);
      renderDetailWindow(ctx);
    }
  });
  s.coverRO.observe(cover);
}


/**
 * data / config 变化后的全量刷新：派生数据 → 停放布局 → 侧栏展开 → 覆盖视图开关/set →
 * 应用滚动。全部动作幂等，供主元素在每次 config-change 时调用。
 */
export function syncDetail(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  const config = ctx.config();

  // tape-scroll：仅当配置变化时置 pendingScroll，由 applyPendingScroll 在就绪后应用
  if (config.tapeScroll > 0 && config.tapeScroll !== s.appliedScroll) {
    s.pendingScroll = config.tapeScroll;
    s.appliedScroll = config.tapeScroll;
  }

  // 数据派生 + detailCover 刷新 + pendingScroll（bindDataset 内的详情部分）
  bindDataset(ctx);

  // placeTape：按 mode 停放明细卡片
  placeTape(ctx, config.mode);

  // tape-side / tape-zoom 的侧栏一级展开（仅分时）
  const intraday = config.mode === 'intraday';
  const expand = intraday && (config.tapeZoom > 0 || config.tapePlacement === 'detail');
  applySideExpanded(ctx, expand);

  // tape-zoom / tape-placement 的覆盖视图开关 + tape-set 的数据集
  const open = intraday && config.tapePlacement === 'detail';
  if (open) {
    if (s.detailCover) switchDetailSet(ctx, config.tapeSet);
    else {
      s.detailSet = config.tapeSet;
      openDetail(ctx);
    }
  } else {
    closeDetail(ctx);
    s.detailSet = config.tapeSet;
  }

  // 覆盖视图刚创建、数据已就绪时立即应用 tape-scroll（对应原 1884-1889）
  applyPendingScroll(ctx);
}

/** 绑定持久事件（chart / tape-card / book），返回清理函数（解绑 + 断 RO） */
export function mountDetail(ctx: WorkspaceContext): () => void {
  const s = getState(ctx);
  s.controller = new AbortController();
  const signal = s.controller.signal;
  const book = bookOf(ctx);

  // index.html:1246-1250 — depth-scenario-change → book.setData([depth]) + renderPanorama()
  ctx.chart.addEventListener('depth-scenario-change', (e: Event) => {
    const { depth } = (e as CustomEvent<{ depth: Record<string, unknown> | null }>).detail;
    if (depth) book?.setData?.([depth]);
    const st = getState(ctx);
    if (st.detailCover && st.detailSet === 'panorama') renderPanorama(ctx);
  }, { signal });

  // index.html:1253-1259 — 唯一的 depth-unit-change 消费点：同步十档盘口与全景视图；
  // 不再回调 chart.setDepthUnit（否则事件回环）。demo-bar 下拉不在 root 内，防御式可选同步。
  ctx.chart.addEventListener('depth-unit-change', (e: Event) => {
    const unit = (e as CustomEvent<{ unit: DepthUnit }>).detail.unit === 'amount'
      ? 'amount'
      : 'volume';
    book?.setUnit?.(unit);
    const sel = el<HTMLSelectElement>(ctx, 'sel-depth-unit');
    if (sel) sel.value = unit;
    const st = getState(ctx);
    if (st.detailCover && st.detailSet === 'panorama') renderPanorama(ctx);
  }, { signal });

  // index.html:1324-1327 — 数据就绪刷新详情（数据源改为 ctx.data()）
  ctx.chart.addEventListener('dataset-ready', () => bindDataset(ctx), { signal });

  // index.html:1708-1716 — 侧栏明细点击：底部条打开覆盖视图，其余区域切换一级展开
  const tapeCard = el(ctx, 'tape-card');
  if (tapeCard) {
    tapeCard.addEventListener('click', (e: Event) => {
      const card = e.currentTarget as HTMLElement;
      if (!card.classList.contains('tape-in-side')) return;
      const target = e.target as Element | null;
      if (target?.closest('#tape-detail')) {
        openDetail(ctx);
        ctx.patchConfig({ tapePlacement: 'detail' });
        return;
      }
      const st = getState(ctx);
      const next = !st.sideExpanded;
      applySideExpanded(ctx, next);
      ctx.patchConfig({ tapeZoom: next ? 1 : 0 });
    }, { signal });
  }

  // index.html:1718 — 十档盘口标题条的「全景盘口」入口：直接打开全景委托簿覆盖视图
  book?.addEventListener('view-panorama', () => {
    switchDetailSet(ctx, 'panorama');
    openDetail(ctx);
    ctx.patchConfig({ tapeSet: 'panorama', tapePlacement: 'detail' });
  }, { signal });

  // 初始渲染（对应页面启动时的同步）
  syncDetail(ctx);

  return () => {
    s.controller.abort(); // 解绑全部持久事件
    closeDetail(ctx);     // 断 RO、解绑 cover 内事件、remove 覆盖视图
  };
}
