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
  Bar, IntradayPoint, HistoricalIntradaySeries, AuctionPoint, Manifest,
} from '../types';
import { LAYOUT } from '../types';
import { detailGroupCount } from '../architecture/detail-canvas-layout';
import { trim } from '../algorithms/format';
import { CHART_EVENTS } from '../events';
import { deriveHistoricalDayView } from '../algorithms/historical-intraday';
import { withTradeTrend } from '../algorithms/trade-series';

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
  readonly viewHeight: number;
  paint(): void;
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

/** 覆盖视图内独立 <stock-chart> 实例的窄接口（setDataset 由组件提供，其余由 HTMLElement 继承） */
interface IntradayMini extends HTMLElement {
  setTheme(theme: string | Record<string, string> | null): void;
  getTheme?(): { theme: string; palette: Record<string, string> } | null;
  setDataset(dataset: {
    manifest: Record<string, unknown>;
    bars: Bar[];
    intraday: IntradayPoint[];
    auction?: AuctionPoint[];
    trades?: TradeTick[];
    depth?: unknown[];
    orders?: unknown[];
  }): void;
}
/** 历史分时侧栏的逐笔明细（替代十档盘口，不挂 depth-book） */
type HistTape = TapeApi;

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
  intradayMini: IntradayMini | null;  // 覆盖视图内独立分时图实例（自持 WebGL context）
  renderedIntradayDate: string | null;
  histGroups: CoverTape[];            // 历史分时展开后的多栏连续时间线
  histRows: TradeRow[];              // 该历史日的逐笔（展开面板数据源）
  histFrom: number;                  // 多栏共享的全局起始行
  histL: number;                     // 每栏可见行数
  noDataDate: string | null;         // 上次「无数据」提示对应的日期（避免重复提示）
  noDataHint: HTMLElement | null;    // 组件内轻提示元素
  miniTheme: string | null;          // mini 已应用的主题签名，避免重复 setTheme
  sideRO: ResizeObserver | null;     // 观察 mini 侧栏 tape 尺寸，布局稳定后校准视口
  histRaf: number | null;            // 展开重算的 rAF 句柄（切离/关闭时取消）
  pendingScroll: number | null;
  appliedScroll: number | null;       // 已消费的 tapeScroll，避免重复应用
  allTrades: TradeRow[];
  allOrders: OrderRecord[];
  orderMix: string;
}

const states = new WeakMap<HTMLElement, State>();
const DETAIL_ROW_H = LAYOUT.rowH;

/**
 * 分段连续时间线的视图状态快照：当日 / 历史各持一份独立状态（数据与滚动互不干扰），
 * 只在调用共享算法时投影成这份快照，不合并成单一全局状态。
 */
type TimedRow = { time: string };
interface Timeline<T extends TimedRow = TimedRow> {
  rows: readonly T[];  // 当前数据源（当日 detailRows / 历史 histRows）
  from: number;        // 多栏共享的全局起始行
  L: number;           // 每栏可见行数
  n: number;           // 栏数
}

/** 把全局起始行钳制到 [0, max(0, total - n*L)]，与两个 render*Window 原公式逐字一致。 */
function clampFrom<T extends TimedRow>(tl: Timeline<T>): number {
  return Math.max(0, Math.min(tl.from, Math.max(0, tl.rows.length - tl.n * tl.L)));
}

/** 按当前窗口把整条时间线切成 n 段（rows + 标题字符串），顺序与栏对齐。 */
function sliceTimelineColumns<T extends TimedRow>(
  tl: Timeline<T>,
): Array<{ rows: T[]; title: string }> {
  return Array.from({ length: tl.n }, (_, g) => {
    const rows = tl.rows.slice(tl.from + g * tl.L, tl.from + (g + 1) * tl.L);
    const title = rows.length
      ? `${g + 1}/${tl.n} · ${rows[0].time}–${rows[rows.length - 1].time} · ${rows.length} 条`
      : `${g + 1}/${tl.n} · —`;
    return { rows, title };
  });
}

/** 透明滚动层 spacer 高度（px）：只映射整条时间线的起点/终点。 */
function timelineSpacerHeight<T extends TimedRow>(tl: Timeline<T>): number {
  return Math.max(0, tl.rows.length - tl.n * tl.L + tl.L) * DETAIL_ROW_H;
}

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
    intradayMini: null,
    renderedIntradayDate: null,
    histGroups: [],
    histRows: [],
    histFrom: 0,
    histL: 20,
    noDataDate: null,
    noDataHint: null,
    miniTheme: null,
    histRaf: null,
    sideRO: null,
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

/** historicalIntraday 已在 ChartDataset / DetailData 契约中声明，单一真源只读 ctx.data() */
function historicalMap(ctx: WorkspaceContext): Record<string, HistoricalIntradaySeries> | null {
  return ctx.data()?.historicalIntraday ?? null;
}

/** 实际数据为准：只有索引里确有该日且带有效分钟点，才允许进入历史分时界面 */
function hasHistoricalSeries(ctx: WorkspaceContext, date: string | null): boolean {
  if (!date) return false;
  const series = historicalMap(ctx)?.[date];
  return !!series && Array.isArray(series.points) && series.points.length > 0;
}

/** 读不到数据：不打开覆盖视图，只在组件内给一次轻量「无数据」提示 */
function showNoDataHint(ctx: WorkspaceContext, date: string): void {
  const s = getState(ctx);
  if (s.noDataDate === date) return; // 同一日期只提示一次，避免其它 config 变更反复弹出
  clearNoDataHint(ctx);
  const card = ctx.root.querySelector('.chart-card');
  if (!card) return;
  const doc = ctx.root.ownerDocument;
  const hint = doc.createElement('div');
  hint.className = 'hist-no-data';
  hint.textContent = `无数据 · ${date}`;
  card.appendChild(hint);          // absolute 浮层，不占文档流、不挤动界面
  s.noDataDate = date;
  s.noDataHint = hint;
  doc.defaultView?.setTimeout?.(() => {
    hint.remove();
    if (s.noDataHint === hint) s.noDataHint = null;
  }, 3000);
}

function clearNoDataHint(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  s.noDataHint?.remove();
  s.noDataHint = null;
  s.noDataDate = null;
}

/** 释放覆盖视图内独立分时图实例：remove 触发 disconnectedCallback → ctx.destroy() 回收 WebGL */
function disposeIntradayMini(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (s.histRaf != null) {
    ctx.root.ownerDocument.defaultView?.cancelAnimationFrame?.(s.histRaf);
    s.histRaf = null;
  }
  const mini = s.intradayMini;
  s.intradayMini = null;
  s.renderedIntradayDate = null;
  s.histGroups = [];
  s.histRows = [];
  s.histFrom = 0;
  s.miniTheme = null;
  s.sideRO?.disconnect();
  s.sideRO = null;
  mini?.remove();
}

/** index.html:1411 — 分组/时间线取当前数据集；全景 / 历史分时不参与虚拟滚动 */
function detailRows(ctx: WorkspaceContext): DetailRow[] {
  const s = getState(ctx);
  if (s.detailSet === 'panorama' || s.detailSet === 'intraday') return [];
  return s.detailSet === 'orders' ? s.allOrders : s.allTrades;
}

/** index.html:1412-1413 — 视角标签 */
function detailLabel(ctx: WorkspaceContext): string {
  const labels: Record<string, string> = {
    orders: '全部挂单', panorama: '全景盘口', intraday: '历史分时',
  };
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
  if (s.detailSet === 'panorama' || s.detailSet === 'intraday'
    || !s.detailCover || !s.coverTapes.length) return;
  const rowsAll = detailRows(ctx);
  const total = rowsAll.length;
  const n = s.coverTapes.length, L = s.detailL;
  const tl: Timeline<DetailRow> = { rows: rowsAll, from: s.detailFrom, L, n };
  const from = clampFrom(tl);
  s.detailFrom = from;
  const columns = sliceTimelineColumns({ ...tl, from });
  for (const [g, item] of s.coverTapes.entries()) {
    item.tape.setWindow(columns[g].rows);
    item.head.textContent = columns[g].title;
  }
  const count = coverRegion(ctx, 'cover-count');
  if (count)
    count.textContent = `${detailLabel(ctx)} · 共 ${total} 条${s.detailSet === 'orders' ? s.orderMix : ''} · ${n} 栏连续时间线 · 第 ${from + 1}–${Math.min(total, from + n * L)} 条`;
  const sc = coverRegion(ctx, 'cover-scroll');
  if (sc && Math.abs(sc.scrollTop - from * DETAIL_ROW_H) > 1)
    sc.scrollTop = from * DETAIL_ROW_H;
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
    const tl: Timeline<DetailRow> = {
      rows: detailRows(ctx), from: s.detailFrom, L: s.detailL, n: s.coverTapes.length || 1,
    };
    spacer.style.height = `${timelineSpacerHeight(tl)}px`;
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

/** 两套逐笔视图共用的固定层高：组标题 26px（CSS）+ 表头 24px（--sw-bar-h） */
const TAPE_CHROME_H = 26 + 24;

/**
 * 上方共享工具栏吸收视口余数：在 openDetail 阶段对所有 tab 统一计算一次，
 * 保证当日逐笔 / 历史逐笔 / 全部挂单的 .cover-bar 严格等高。
 * 行高 18px、组标题 26px、表头 24px 三者均不改，余数【对称】分到 cover-bar 上下 padding。
 */
/** 视口行对齐的单一真源：给定基准视口高与行高，返回可完整显示行数与待吸收余数 */
function rowFit(viewBase: number, rowH: number = DETAIL_ROW_H): { L: number; extra: number } {
  const L = Math.max(1, Math.floor(viewBase / rowH));
  return { L, extra: Math.max(0, Math.floor(viewBase - L * rowH)) };
}

/** 多栏与侧栏共用：用「当前视口 + 已扣减值」反推基准，扣余数后重绘（幂等、自校正） */
function fitTapeView(tape: TapeApi): void {
  const current = parseFloat(tape.style.getPropertyValue('--sw-view-extra')) || 0;
  const { extra } = rowFit(tape.viewHeight + current);
  tape.style.setProperty('--sw-view-extra', `${extra}px`);
  tape.paint(); // .view 由 CSS 变量动态改变，组件自身 RO 不触发，需显式重绘填满列表
}

/**
 * 把视口余数【对称】分配到元素上下 padding：总高恰好增加 extra，内容保持垂直居中。
 * 此前只加 padding-bottom 会让底部计数条 / 工具栏文字偏上。每次先清空 inline padding
 * 回 CSS 基准，因此幂等、多次调用不累加。
 */
function applyBalancedPadding(el: HTMLElement, extra: number): void {
  el.style.paddingTop = '';
  el.style.paddingBottom = '';
  const win = el.ownerDocument.defaultView;
  const top = parseFloat(win?.getComputedStyle(el).paddingTop || '') || 6;
  const bottom = parseFloat(win?.getComputedStyle(el).paddingBottom || '') || 6;
  const up = Math.ceil(extra / 2);
  el.style.paddingTop = `${top + up}px`;
  el.style.paddingBottom = `${bottom + extra - up}px`;
}

function fitCoverBar(ctx: WorkspaceContext): void {
  const bar = ctx.root.querySelector('.cover-bar') as HTMLElement | null;
  const body = ctx.root.querySelector('.cover-body') as HTMLElement | null;
  if (!bar || !body) return;
  applyBalancedPadding(bar, 0); // 回到 CSS 基准（8px），再量基准视口
  const viewBase = body.clientHeight - TAPE_CHROME_H;
  const { extra } = rowFit(viewBase);
  applyBalancedPadding(bar, extra);
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
  // 与两套逐笔视图同构：列表视口严格等于整数行高，底部不留半行/空白
  fitPanoramaViewport(ctx);
}

/**
 * 全景盘口：把 .pano-list 视口的不足一行余数吸收到全景专属的 .pano-mid 信息行，
 * 行高（与逐笔同为 18px）与共享 .cover-bar 都不改，保证各视图相同位置仍等高。
 * 每次从 CSS 基准重算，幂等、切换场景不累积。
 */
function fitPanoramaViewport(ctx: WorkspaceContext): void {
  const host = coverRegion(ctx, 'cover-panorama');
  const mid = host?.querySelector('.pano-mid') as HTMLElement | null;
  const list = host?.querySelector('.pano-list') as HTMLElement | null;
  const firstRow = list?.querySelector('.pano-row') as HTMLElement | null;
  if (!mid || !list || !firstRow) return;
  applyBalancedPadding(mid, 0); // 回到 CSS 基准（6px），再量基准列表视口
  const pitch = firstRow.getBoundingClientRect().height || DETAIL_ROW_H;
  const listH = list.clientHeight;
  const { extra } = rowFit(listH, pitch);
  applyBalancedPadding(mid, extra);
}

/** 有历史分时数据的交易日（统一升序口径，供前后切换与日期控件共用） */
function histDateList(ctx: WorkspaceContext): string[] {
  return Object.keys(historicalMap(ctx) ?? {}).sort();
}

const CAL_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6h12"/></svg>';
const LEFT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2.5 5.5 8l4.5 5.5"/></svg>';
const RIGHT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5 10.5 8 6 13.5"/></svg>';

/** 自绘月历：只有索引里存在数据的日期可点，其余一律置灰禁用 */
function renderHistDatePanel(ctx: WorkspaceContext, panel: HTMLElement): void {
  const dates = histDateList(ctx);
  const cur = ctx.config().historicalIntradayDate ?? '';
  const ym = panel.dataset.ym || (cur ? cur.slice(0, 7) : new Date().toISOString().slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return;
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一为首列
  const days = new Date(y, m, 0).getDate();
  const iso = (d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const cells: string[] = [];
  for (let i = 0; i < lead; i += 1) cells.push('<span class="hist-cal-cell empty"></span>');
  for (let d = 1; d <= days; d += 1) {
    const v = iso(d);
    cells.push(dates.includes(v)
      ? `<button type="button" class="hist-cal-cell${v === cur ? ' sel' : ''}" data-date="${v}">${d}</button>`
      : `<span class="hist-cal-cell disabled" aria-disabled="true">${d}</span>`);
  }
  panel.innerHTML = [
    '<div class="hist-cal-head">',
    `<button type="button" class="hist-cal-icon" data-month-step="-1" aria-label="上个月">${LEFT_ICON}</button>`,
    `<span class="hist-cal-title">${y} 年 ${m} 月</span>`,
    `<button type="button" class="hist-cal-icon" data-month-step="1" aria-label="下个月">${RIGHT_ICON}</button>`,
    '</div>',
    '<div class="hist-cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>',
    `<div class="hist-cal-grid">${cells.join('')}</div>`,
  ].join('');
}

/** 同步日期控件：显示值、前后按钮边界、面板（打开时重渲染） */
function syncHistDateNav(ctx: WorkspaceContext, host: HTMLElement): void {
  const dates = histDateList(ctx);
  const cur = ctx.config().historicalIntradayDate ?? '';
  const label = host.querySelector('#hist-date-label');
  if (label) label.textContent = cur || '选择日期';
  const i = dates.indexOf(cur);
  const prev = host.querySelector<HTMLButtonElement>('#hist-date-prev');
  const next = host.querySelector<HTMLButtonElement>('#hist-date-next');
  if (prev) prev.disabled = i <= 0;
  if (next) next.disabled = i < 0 || i >= dates.length - 1;
  const panel = host.querySelector<HTMLElement>('#hist-date-panel');
  if (panel && !panel.hidden) renderHistDatePanel(ctx, panel);
}

/**
 * 历史分时覆盖视图：按 config.historicalIntradayDate 取索引里的单日序列。
 *  - 有数据：顶部仅一条功能按钮（竞价开关 / 逐笔展开），独立 <stock-chart> 注入该日实际数据。
 *  - 无数据：由 syncDetail 前置拦截，不进入本界面；这里只留「无数据」兜底。
 * 每次渲染前清理上一次 mini 实例，避免多个 WebGL context 泄漏；不切主图数据源、不复用 ctx.chart。
 */
function renderHistoricalIntraday(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  const host = coverRegion(ctx, 'cover-intraday');
  if (!host) return;
  const date = ctx.config().historicalIntradayDate;
  const map = historicalMap(ctx);
  const series = date ? map?.[date] ?? null : null;

  // 同一交易日且 mini 已渲染：只同步竞价开关 / 展开态，避免反复创建销毁 WebGL context
  if (s.intradayMini && s.renderedIntradayDate === date && series) {
    applyHistoricalViewState(ctx);
    return;
  }

  disposeIntradayMini(ctx);
  host.replaceChildren();
  const doc = ctx.root.ownerDocument;

  if (!series) {
    const msg = doc.createElement('div');
    msg.className = 'hist-empty';
    msg.textContent = '无数据';
    host.appendChild(msg);
    return;
  }

  // 只保留功能按钮，不展示任何来源 / 示意说明；数据以实际索引内容为准
  const bar = doc.createElement('div');
  bar.className = 'hist-toolbar';
  // 日期导航：icon 前后切换 + 自绘日期控件（无数据的日期在月历里置灰）
  const nav = doc.createElement('div');
  nav.className = 'hist-date-nav';
  const signal = s.coverAbort?.signal;
  const goDate = (delta: number) => () => {
    const dates = histDateList(ctx);
    const i = dates.indexOf(ctx.config().historicalIntradayDate ?? '');
    const next = dates[i + delta];
    if (next) ctx.patchConfig({ historicalIntradayDate: next });
  };
  const iconBtn = (id: string, svg: string, label: string): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'hist-date-icon';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = svg;
    return b;
  };
  const prevBtn = iconBtn('hist-date-prev', LEFT_ICON, '上一交易日');
  prevBtn.addEventListener('click', goDate(-1), { signal });
  const nextBtn = iconBtn('hist-date-next', RIGHT_ICON, '下一交易日');
  nextBtn.addEventListener('click', goDate(1), { signal });
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.id = 'hist-date-trigger';
  trigger.className = 'hist-date-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = `${CAL_ICON}<span id="hist-date-label"></span>`;
  const datePanel = doc.createElement('div');
  datePanel.id = 'hist-date-panel';
  datePanel.className = 'hist-date-panel';
  datePanel.hidden = true;
  datePanel.setAttribute('role', 'dialog');
  const setOpen = (open: boolean): void => {
    datePanel.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const cur = ctx.config().historicalIntradayDate ?? '';
      datePanel.dataset.ym = cur ? cur.slice(0, 7) : new Date().toISOString().slice(0, 7);
      renderHistDatePanel(ctx, datePanel);
    }
  };
  trigger.addEventListener('click', () => setOpen(datePanel.hidden), { signal });
  datePanel.addEventListener('click', (e: Event) => {
    const t = e.target as HTMLElement;
    const day = t.closest<HTMLElement>('[data-date]');
    if (day?.dataset.date) {
      ctx.patchConfig({ historicalIntradayDate: day.dataset.date });
      setOpen(false);
      return;
    }
    const step = t.closest<HTMLElement>('[data-month-step]');
    if (step?.dataset.monthStep) {
      const [y, m] = (datePanel.dataset.ym || '').split('-').map(Number);
      const d = new Date(y, m - 1 + Number(step.dataset.monthStep), 1);
      datePanel.dataset.ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      renderHistDatePanel(ctx, datePanel);
    }
  }, { signal });
  doc.addEventListener('pointerdown', (e: Event) => {
    if (!datePanel.hidden && !nav.contains(e.target as Node)) setOpen(false);
  }, { signal });
  doc.addEventListener('keydown', (e: Event) => {
    if (!datePanel.hidden && (e as KeyboardEvent).key === 'Escape') setOpen(false);
  }, { signal });
  const group = doc.createElement('div');
  group.className = 'hist-date-group';
  group.append(prevBtn, trigger, nextBtn);
  nav.append(group, datePanel);
  const actions = doc.createElement('div');
  actions.className = 'hist-actions';
  const auctionBtn = doc.createElement('button');
  auctionBtn.type = 'button';
  auctionBtn.id = 'hist-auction-toggle';
  auctionBtn.addEventListener('click', () => ctx.patchConfig({
    historicalAuctionEnabled: !ctx.config().historicalAuctionEnabled,
  }), { signal: s.coverAbort?.signal });
  const tapeBtn = doc.createElement('button');
  tapeBtn.type = 'button';
  tapeBtn.id = 'hist-tape-toggle';
  tapeBtn.addEventListener('click', () => ctx.patchConfig({
    historicalTapeExpanded: !ctx.config().historicalTapeExpanded,
  }), { signal: s.coverAbort?.signal });
  actions.append(auctionBtn, tapeBtn);
  bar.append(nav, actions);
  host.appendChild(bar);

  // 内容区：左侧独立分时实例 + 右侧可展开的放大逐笔面板（不触碰 stock-chart 内部 sideSlot）
  const body = doc.createElement('div');
  body.className = 'hist-body';
  // 独立分时图实例：与主图完全隔离，不复用 ctx.chart、不切主图数据源
  const mini = doc.createElement('stock-chart') as unknown as IntradayMini;
  mini.setAttribute('mode', 'intraday');
  mini.setAttribute('auction', 'on');
  mini.setAttribute('chips', 'off');
  // 迷你图是主图的后代（attachCover）：阻断其冒泡事件，避免 dataset-ready 回环触发
  // bindDataset → applyDetailMode → 再次创建 mini，也避免 chart-error 污染页面诊断。
  const isolate = (e: Event): void => { e.stopPropagation(); };
  for (const name of Object.values(CHART_EVENTS)) mini.addEventListener(name, isolate);
  const price = doc.createElement('price-pane');
  price.setAttribute('height', '50');
  mini.appendChild(price);
  // 与主图相同的副图配置：数量与指标都从 config 读取，动态创建声明式子配置节点
  const cfg = ctx.config();
  const subCount = Math.max(1, Math.min(3, cfg.subplotCount ?? 3));
  const indicators = cfg.subplotIndicators ?? ['VOL', 'AMOUNT', 'MACD'];
  for (let i = 0; i < subCount; i += 1) {
    const pane = doc.createElement('indicator-pane');
    pane.setAttribute('indicator', indicators[i] ?? 'VOL');
    pane.setAttribute('height', '12');
    mini.appendChild(pane);
  }
  // 逐笔明细侧栏：用 trade-tape 占据 [slot=side]，不挂 depth-book → 不显示十档盘口
  const tape = doc.createElement('trade-tape') as unknown as HistTape;
  tape.setAttribute('slot', 'side');
  tape.setAttribute('order', 'desc');
  tape.setAttribute('follow-crosshair', '');
  mini.appendChild(tape);
  body.appendChild(mini);
  // 多栏逐笔面板：与侧栏共享同一份该日逐笔，展开后全宽覆盖内容区
  const panel = doc.createElement('div');
  panel.className = 'hist-tape-panel';
  // 与当日逐笔一致：透明滚动层提供 scrollTop，多栏 grid 只展示、pointer-events:none 让滚轮穿透
  const view = doc.createElement('div');
  view.className = 'hist-tape-view';
  const scroller = doc.createElement('div');
  scroller.className = 'hist-tape-scroll';
  const spacer = doc.createElement('div');
  spacer.className = 'hist-tape-spacer';
  scroller.appendChild(spacer);
  const grid = doc.createElement('div');
  grid.className = 'hist-tape-grid';
  view.append(scroller, grid);
  scroller.addEventListener('scroll', () => {
    const f = Math.floor(scroller.scrollTop / DETAIL_ROW_H);
    if (f === s.histFrom) return;
    s.histFrom = f;
    renderHistoricalTapeWindow(ctx);
  }, { signal: s.coverAbort?.signal });
  const foot = doc.createElement('div');
  foot.className = 'hist-tape-foot';
  const pagerInfo = doc.createElement('span');
  pagerInfo.className = 'hist-tape-info';
  const hint = doc.createElement('span');
  hint.textContent = '滚轮切换';
  foot.append(pagerInfo, hint);
  panel.append(view, foot);
  body.appendChild(panel);
  host.appendChild(body);
  s.intradayMini = mini;
  s.renderedIntradayDate = date;

  const base = ctx.data();
  // 算法层具名派生：一次性产出 dayBars / auction / trades / manifest，UI 只消费返回值
  const dayView = deriveHistoricalDayView(
    series, base?.bars ?? [], base?.manifest ?? ({} as Manifest),
  );
  const trades: TradeRow[] = withTradeTrend(dayView.trades, series.preClose);
  mini.setDataset({
    manifest: dayView.manifest, bars: dayView.dayBars, intraday: series.points,
    auction: dayView.auction, trades, depth: [], orders: [],
  });
  tape.setData(trades);
  tape.setViewConfig({
    heads: ['时间', '价格', '成交量', '方向'],
    labelKey: 'side',
    cols: '62px 1fr 1fr 30px',
    colCls: ['', 'num', 'num', 'side'],
    extraKey: null,
  });
  // 侧栏逐笔保持 setData 的滚动模式（setWindow 会覆盖 rows，不能传空数组）
  s.histRows = trades;
  s.histFrom = 0;
  s.histGroups = [];
  applyHistoricalViewState(ctx);
  // 侧栏 tape 自身高度不受 --sw-view-extra 影响，观察它可在布局稳定后自动校准；
  // 配合 fitHistoricalSideTape 的自校正基准，重复触发会收敛到唯一稳定值。
  const sideTape = mini.querySelector('trade-tape[slot="side"]');
  const win = ctx.root.ownerDocument.defaultView;
  if (sideTape && win) {
    s.sideRO?.disconnect();
    s.sideRO = new win.ResizeObserver(() => fitHistoricalSideTape(ctx));
    s.sideRO.observe(sideTape);
  }
}

/** 与当日逐笔明细一致：按容器宽度分 N 栏，每栏一个 trade-tape 用 setWindow 承接一段连续时间线 */
function buildHistoricalTapeGroups(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  const host = coverRegion(ctx, 'cover-intraday');
  const grid = host?.querySelector('.hist-tape-grid') as HTMLElement | null;
  if (!grid) return;
  const n = detailGroupCount(grid.clientWidth || ctx.root.clientWidth || 900);
  if (s.histGroups.length !== n) {
    grid.replaceChildren();
    s.histGroups = [];
    grid.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    const doc = ctx.root.ownerDocument;
    for (let g = 0; g < n; g += 1) {
      const col = doc.createElement('div');
      col.className = 'group';
      const head = doc.createElement('div');
      head.className = 'group-head';
      const t = doc.createElement('trade-tape') as unknown as TapeApi;
      col.append(head, t);
      grid.appendChild(col);
      t.setViewConfig({
        heads: ['时间', '价格', '成交量', '方向'],
        labelKey: 'side',
        cols: '62px 1fr 1fr 30px',
        colCls: ['', 'num', 'num', 'side'],
        extraKey: null,
      });
      t.setWindow([]);
      s.histGroups.push({ head, tape: t });
    }
  }
  // 行高（DETAIL_ROW_H = LAYOUT.rowH）与其它列表一致，不改列表项；
  // 由 fitTapeView 用 --sw-view-extra 校准视口为整数行：既不裁半行，也不在底部留白。
  fitHistoricalTapeColumns(ctx);
  s.histL = Math.max(1, s.histGroups[0]?.tape.visibleRows() || 20);
  updateHistoricalSpacer(ctx, n);
}

/** 展开态多栏：取第一栏 tape 交给 fitTapeView 校准（计数栏已固定高度，不在此调整） */
function fitHistoricalTapeColumns(ctx: WorkspaceContext): void {
  const tape = getState(ctx).histGroups[0]?.tape;
  if (tape) fitTapeView(tape);
}

/** spacer 高度只映射整条时间线的起点/终点，随每栏行数 L 同步更新 */
function updateHistoricalSpacer(ctx: WorkspaceContext, n: number): void {
  const s = getState(ctx);
  const host = coverRegion(ctx, 'cover-intraday');
  const spacer = host?.querySelector('.hist-tape-spacer') as HTMLElement | null;
  if (!spacer) return;
  const tl: Timeline<TradeRow> = { rows: s.histRows, from: s.histFrom, L: s.histL, n };
  spacer.style.height = `${timelineSpacerHeight(tl)}px`;
}

/** 多栏共享全局起始行：每栏截取一段连续时间线，标题标注时间范围与条数 */
function renderHistoricalTapeWindow(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  const n = s.histGroups.length;
  if (!n) return;
  // 每次渲染都按当前视口校准每栏行数：视口高度非 rowH 整数倍时只取可完整显示的行，
  // 否则最后一行下半会被 .view 的 overflow 裁掉（用户反馈的「半行被遮挡」）。
  const measured = Math.max(1, s.histGroups[0].tape.visibleRows() || s.histL);
  if (measured !== s.histL) {
    s.histL = measured;
    updateHistoricalSpacer(ctx, n);
  }
  const L = s.histL;
  const total = s.histRows.length;
  const tl: Timeline<TradeRow> = { rows: s.histRows, from: s.histFrom, L, n };
  const from = clampFrom(tl);
  s.histFrom = from;
  const columns = sliceTimelineColumns({ ...tl, from });
  for (const [g, item] of s.histGroups.entries()) {
    item.tape.setWindow(columns[g].rows);
    item.head.textContent = columns[g].title;
  }
  const sc = ctx.root.querySelector('.hist-tape-scroll') as HTMLElement | null;
  if (sc && Math.abs(sc.scrollTop - from * DETAIL_ROW_H) > 1) {
    sc.scrollTop = from * DETAIL_ROW_H;
  }
  const info = ctx.root.querySelector('.hist-tape-info');
  if (info) {
    info.textContent = `共 ${total} 条 · ${n} 栏连续时间线 · 第 ${from + 1}–${Math.min(total, from + n * L)} 条`;
  }
}

/** 收起态侧栏：取 mini 的 [slot=side] tape 交给 fitTapeView 校准 */
function fitHistoricalSideTape(ctx: WorkspaceContext): void {
  const tape = getState(ctx).intradayMini
    ?.querySelector('trade-tape[slot="side"]') as HistTape | null;
  if (tape) fitTapeView(tape);
}

function applyHistoricalViewState(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  const host = coverRegion(ctx, 'cover-intraday');
  const mini = s.intradayMini;
  if (!host || !mini) return;
  fitHistoricalSideTape(ctx); // 竞价开关 / 展开切换 / 短路路径都保持侧栏严格对齐
  const cfg = ctx.config();
  // 主题切换同步：mini 是独立 <stock-chart>，不继承主图的 setTheme 调用；
  // 必须显式下沉，让 WebGL 色板（ctx.palette）与 mini host 的 --sw-* 与根组件同源。
  const theme = cfg.theme;
  const themeKey = typeof theme === 'string' ? theme : (theme ? 'custom' : 'light');
  if (s.miniTheme !== themeKey) {
    mini.setTheme(theme);
    s.miniTheme = themeKey;
  }
  const auctionOn = cfg.historicalAuctionEnabled !== false;
  mini.setAttribute('auction', auctionOn ? 'on' : 'off');
  const expanded = cfg.historicalTapeExpanded === true;
  host.classList.toggle('hist-tape-expanded', expanded);
  if (expanded) {
    const syncGroups = () => {
      buildHistoricalTapeGroups(ctx);
      renderHistoricalTapeWindow(ctx);
    };
    syncGroups();
    // 展开后布局尺寸才生效，下一帧按真实宽度重算栏数与每栏可见行数；句柄存 State 供释放时取消
    s.histRaf = ctx.root.ownerDocument.defaultView?.requestAnimationFrame?.(syncGroups) ?? null;
  }
  // 日期控件状态：显示值、icon 按钮边界、月历面板（打开时重渲染）
  syncHistDateNav(ctx, host);
  const aBtn = host.querySelector<HTMLButtonElement>('#hist-auction-toggle');
  if (aBtn) {
    aBtn.textContent = `竞价：${auctionOn ? '开' : '关'}`;
    aBtn.classList.toggle('active', auctionOn);
  }
  const tBtn = host.querySelector<HTMLButtonElement>('#hist-tape-toggle');
  if (tBtn) {
    tBtn.textContent = expanded ? '收起逐笔明细' : '展开逐笔明细';
    tBtn.classList.toggle('active', expanded);
  }
}

/** index.html:1615-1626 — 切换视角：连续时间线 / 全景盘口 / 历史分时三态互斥显示 */
function applyDetailMode(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  if (!s.detailCover) return;
  const set = s.detailSet;
  const body = coverRegion(ctx, 'cover-body');
  body?.classList.toggle('pano-mode', set === 'panorama');
  body?.classList.toggle('intraday-mode', set === 'intraday');
  coverRegion(ctx, 'cover-tabs')
    ?.querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.set === set));
  if (set === 'intraday') renderHistoricalIntraday(ctx);
  else {
    // 切离历史分时：清空 cover-intraday 内残留 DOM（hist-tape-panel 的 scroll 监听已绑
    // coverAbort.signal，此处只清 DOM 节点，避免隐藏视图残留）
    coverRegion(ctx, 'cover-intraday')?.replaceChildren();
    disposeIntradayMini(ctx);
    if (set === 'panorama') renderPanorama(ctx);
    else buildDetailGroups(ctx);
  }
}

/**
 * index.html:1628-1634 — 切换数据集。
 * 与原页面唯一差异：cover 尚未创建时也把 set 记入状态（openDetail 无 set 参数，set 由状态/config 驱动）。
 */
function switchDetailSet(ctx: WorkspaceContext, set: DetailSet): void {
  const s = getState(ctx);
  if (set === s.detailSet) return;
  s.detailSet = set;
  if (set !== 'intraday') s.detailFrom = 0; // 历史分时不参与虚拟滚动，跳过窗口重置
  if (!s.detailCover) return;
  s.detailCover.setDetailSet?.(set); // 容器同步 set / pano-mode / intraday-mode / 布局快照
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
  // 全景 / 历史分时均为独立视图，不参与连续时间线虚拟滚动
  if (s.detailSet !== 'panorama' && s.detailSet !== 'intraday') {
    s.detailFrom = Math.max(0, Math.floor(s.pendingScroll / DETAIL_ROW_H));
    s.detailCover.setWindow?.(s.detailFrom, detailRows(ctx).length);
    renderDetailWindow(ctx);
  }
  s.pendingScroll = null;
}

/** index.html:1682-1688 — 关闭覆盖视图：断 RO、解绑 cover 内事件、remove 触发容器自清 */
export function closeDetail(ctx: WorkspaceContext): void {
  const s = getState(ctx);
  disposeIntradayMini(ctx); // 释放覆盖视图内独立分时图的 WebGL context
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
  s.allTrades = withTradeTrend(trades, preClose);
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
  // 历史分时「确有数据」时（含 K 线模式）才保留覆盖视图；读不到数据一律按常规逻辑收起
  const histActive = hasHistoricalSeries(ctx, ctx.config().historicalIntradayDate);
  // 底部条可见性在任何 setSideExpanded / syncSideBars 之前确定，避免 footerH 时序偏差
  const btn = el(ctx, 'tape-detail');
  if (btn) btn.hidden = !intraday || !s.sideExpanded;
  // K 线模式关闭覆盖视图、回到 hidden 寄主，并复位十档展开状态
  if (!intraday) {
    if (!histActive) closeDetail(ctx);
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
    // 返回图表即取消选中的历史交易日，避免 histActive 守卫重新打开覆盖视图
    ctx.patchConfig({ tapePlacement: 'side', historicalIntradayDate: null });
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

  // 宽度/高度变化导致栏数或每栏可见行数变化时重建，保留当前时间窗口起点
  s.coverRO = new ResizeObserver(() => {
    // 全景 / 历史分时均为独立视图，不参与连续时间线的栏数 / 可见行数重算
    if (!s.detailCover || s.detailSet === 'panorama' || s.detailSet === 'intraday') return;
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
  // 共享上方工具栏按统一几何补差：所有 tab 的 .cover-bar 严格等高，
  // 且列表视口恰好是整行高；展开态多栏再由 fitHistoricalTapeColumns → fitTapeView 校准。
  fitCoverBar(ctx);
  applyDetailMode(ctx);
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

  // 覆盖视图开关：仅当该交易日确有历史分时数据才进入「历史分时」界面；
  // 读不到数据时组件内给一次「无数据」提示，不打开覆盖视图、不切到该 tab。
  const requestedDate = config.historicalIntradayDate;
  const histActive = hasHistoricalSeries(ctx, requestedDate);
  if (requestedDate && !histActive) showNoDataHint(ctx, requestedDate);
  else clearNoDataHint(ctx);
  const effectiveSet = config.tapeSet === 'intraday' && !histActive ? 'trades' : config.tapeSet;
  if (histActive) {
    applyHistoricalViewState(ctx);
    // 首次打开落在「历史分时」tab；已打开时保留用户当前 tab（不重复强制 set，避免 tab 切换被打回）。
    if (!s.detailCover) {
      s.detailSet = 'intraday';
      openDetail(ctx);
    }
  } else {
    const open = intraday && config.tapePlacement === 'detail';
    if (open) {
      if (s.detailCover) switchDetailSet(ctx, effectiveSet);
      else {
        s.detailSet = effectiveSet;
        openDetail(ctx);
      }
    } else {
      closeDetail(ctx);
      s.detailSet = effectiveSet;
    }
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

/* ------------------------------------------------------------------ 侧栏数据生命周期 */

/**
 * depth-book / trade-tape 单独启用时（不挂载 detail lifecycle）仍需的基础数据填充 + 数据事件。
 * 刻意与 mountDetail 的覆盖视图 / 多栏时间线 / 历史分时 / 全景盘口状态机解耦：
 * 只负责 #book.setData / #tape.setData 及它们的刷新事件，不重复 detail 生命周期的完整逻辑。
 * 每 root 一份 AbortController；depth 与 tape 两个 lifecycle 共用时幂等去重，full 不重复绑定。
 */
const sideDataControllers = new WeakMap<HTMLElement, AbortController>();

/** 现场从 ctx.data() / ctx.detailData() 取数，填充 #tape / #book（幂等，不改入参）。 */
export function syncSideData(ctx: WorkspaceContext): void {
  const ds = ctx.data();
  const preClose = ds?.manifest?.preClose ?? 0;
  tapeOf(ctx)?.setData(withTradeTrend((ds?.trades ?? []) as TradeTick[], preClose));
  const snap = ctx.detailData().depth ?? null;
  bookOf(ctx)?.setData?.(snap ? [snap] : null);
}

/** 绑定侧栏数据刷新事件并做一次初始填充；返回清理函数（abort + 注销幂等标记）。 */
export function mountSideData(ctx: WorkspaceContext): () => void {
  const root = ctx.root;
  // 同一 root 已挂载（depth + tape 两个 lifecycle 共用）：返回空清理，避免 full 重复绑定。
  if (sideDataControllers.has(root)) return () => {};
  const controller = new AbortController();
  sideDataControllers.set(root, controller);
  const signal = controller.signal;
  const book = bookOf(ctx);

  // index.html:1246-1281 — 数据到达 / 盘口场景 / 盘口单位：只同步侧栏两个组件的数据。
  ctx.chart.addEventListener('dataset-ready', () => syncSideData(ctx), { signal });
  ctx.chart.addEventListener('depth-scenario-change', (e: Event) => {
    const { depth } = (e as CustomEvent<{ depth: Record<string, unknown> | null }>).detail;
    if (depth) book?.setData?.([depth]);
  }, { signal });
  ctx.chart.addEventListener('depth-unit-change', (e: Event) => {
    const unit = (e as CustomEvent<{ unit: DepthUnit }>).detail.unit === 'amount' ? 'amount' : 'volume';
    book?.setUnit?.(unit);
  }, { signal });

  syncSideData(ctx); // 初始填充（数据可能已在 mount 之前就绪）

  return () => {
    controller.abort();
    sideDataControllers.delete(root);
  };
}
