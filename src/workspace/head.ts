/**
 * 图表卡片头部（第二行模式/时间/MA 实时值、右侧图例与固定槽位指标）。
 *
 * 逻辑逐字搬自 index.html:1761-1827 的 `chart` 上 `head-change` 监听：
 * 只把 `document.getElementById` 换成 `ctx.root.querySelector`，其余 DOM 操作、
 * 文案、涨跌色 class（up / down）、结构复用（dataset.key）全部保持原样。
 * 数据来源改用 `<stock-chart>` 既有事件 `head-change`（不 new CustomEvent）。
 */
import type { WorkspaceContext } from './types';
import type { HeadChange } from '../types';

/** 每个 root 缓存最近一次 head-change detail，供 syncHead 在无新事件时兜底重绘 */
const lastHead = new WeakMap<HTMLElement, HeadChange>();

/** 在 light DOM 根范围内按 id 取元素（替代页面级 document.getElementById） */
function el<T extends Element = HTMLElement>(ctx: WorkspaceContext, id: string): T | null {
  return ctx.root.querySelector<T>(`#${id}`);
}

/** index.html:1761-1827 原样渲染逻辑 */
function renderHead(ctx: WorkspaceContext, d: HeadChange): void {
  const set = (id: string, v: string): void => {
    const node = el(ctx, id);
    if (node) node.textContent = v || '';
  };
  set('head-name', d.name);
  set('head-symbol', d.symbol);
  // 强调报价随光标联动，涨红跌绿
  const q = d.quote;
  if (q) {
    const qEl = el(ctx, 'head-quote');
    if (qEl) {
      qEl.classList.toggle('up', q.up);
      qEl.classList.toggle('down', !q.up);
    }
    const sign = q.up ? '+' : '';
    set('q-price', q.price);
    set('q-change', `${sign}${q.change.toFixed(2)}`);
    set('q-pct', `${sign}${q.pct.toFixed(2)}%`);
  }
  set('head-mode', d.modeLabel);
  const dt = el(ctx, 'head-datetime');
  if (dt) {
    dt.textContent = d.datetime || '';
    dt.title = d.datetime || ''; // 固定槽位省略时 hover 可看完整时间
  }
  // MA 实时值：标签与数值沿用均线颜色，结构按标签序列复用、hover 只更新数值
  const maBox = el(ctx, 'head-ma-values');
  if (maBox) {
    const maKey = (d.maValues || []).map((m) => m.label).join(',');
    if (maBox.dataset.key !== maKey) {
      maBox.innerHTML = (d.maValues || [])
        .map(
          (m) =>
            `<span class="ma-item"><i style="color:${m.color}">${m.label}</i><b style="color:${m.color}"></b></span>`,
        )
        .join('');
      maBox.dataset.key = maKey;
    }
    const maVals = maBox.querySelectorAll<HTMLElement>('.ma-item b');
    (d.maValues || []).forEach((m, i) => {
      if (maVals[i]) maVals[i].textContent = m.value;
    });
  }
  // 四色涨跌停图例移到头部，仅日 K 显示
  const lg = el(ctx, 'head-legend');
  if (lg) {
    const lgKey = (d.legend || []).map((x) => x.text).join(',');
    if (lg.dataset.key !== lgKey) {
      lg.innerHTML = (d.legend || [])
        .map(
          (x) =>
            `<span><i style="background:${x.color}"></i>${x.text}</span>`,
        )
        .join('');
      lg.dataset.key = lgKey;
    }
    lg.style.display = lgKey ? 'flex' : 'none';
  }
  const box = el(ctx, 'head-metric-list');
  if (box) {
    const key = (d.metrics || []).map((m) => m.label).join(',');
    if (box.dataset.key !== key) {
      box.innerHTML = (d.metrics || [])
        .map((m) => `<span class="metric"><i>${m.label}</i><b></b></span>`)
        .join('');
      box.dataset.key = key;
    }
    const vals = box.querySelectorAll<HTMLElement>('.metric b');
    (d.metrics || []).forEach((m, i) => {
      if (vals[i]) vals[i].textContent = m.value;
    });
  }
  const metrics = el(ctx, 'head-metrics');
  if (metrics) metrics.classList.toggle('muted', !d.active);
}

/** 判断兜底来源是否携带完整头部结构（仅当 chart.getState 暴露头部状态时可用） */
function isHeadLike(v: unknown): v is HeadChange {
  return typeof v === 'object' && v !== null
    && 'quote' in v && 'metrics' in v && 'maValues' in v && 'name' in v;
}

/** 绑定事件，返回清理函数 */
export function mountHead(ctx: WorkspaceContext): () => void {
  const controller = new AbortController();
  ctx.chart.addEventListener(
    'head-change',
    (event: Event) => {
      const d = (event as CustomEvent<HeadChange>).detail;
      lastHead.set(ctx.root, d);
      renderHead(ctx, d);
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}

/** data / config 变化后的兜底重渲染：无新事件时复用最近一次 detail，否则尝试 chart.getState?.() */
export function syncHead(ctx: WorkspaceContext): void {
  const cached = lastHead.get(ctx.root);
  if (cached) {
    renderHead(ctx, cached);
    return;
  }
  // 兜底：无缓存事件时，若 chart 暴露 getState（可选），借其状态刷新一次
  const getState = ctx.chart.getState as (() => unknown) | undefined;
  if (typeof getState === 'function') {
    const state: unknown = getState.call(ctx.chart);
    if (isHeadLike(state)) renderHead(ctx, state);
  }
}
