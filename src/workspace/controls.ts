/**
 * 图表卡片工具栏控件（模式 / 多日分时 / 竞价 / 筹码峰 / 周期 / 副图数量 /
 * 场景 / 盘口单位 / K 线均线设置面板）。
 *
 * 逻辑逐字搬自 index.html 的以下区间：
 *   1221-1229  selPeriod 初始化与 change
 *   1231-1259  applyScenario / applyDepthUnit 的控件同步部分（下拉 value）
 *   1329-1341  pair() 模式按钮互斥
 *   1342-1381  syncAuctionButton / syncDaysSeg / applyIntradayDays / daysSeg click
 *   1720-1757  syncToggles / btnAuction / btnChips / 模式按钮 / sel-subplots /
 *              sel-scenario / sel-depth-unit change
 *   1925-1981  renderMAPanel() / ma-config-change / btn-ma / ma-close / ma-add /
 *              maList input|change|click
 *
 * 与原页面唯一的结构性差异：用户操作不再直接调 chart.setXxx，而是统一通过
 * ctx.patchConfig({...}) 输出配置变更（由主元素统一把 config 应用到 chart）；
 * 控件自身状态一律从 ctx.config() 读取后渲染。
 * `document.getElementById` 换成 `ctx.root.querySelector`，事件用 AbortController 解绑。
 */
import type { WorkspaceContext } from './types';
import { resolveWorkspaceTheme } from './theme';
import { PALETTE, type ChartMode, type DepthUnit, type MAConfig } from '../types';
import { PERIODS } from '../core/bar-aggregator';

/** 在 light DOM 根范围内按 id 取元素（替代页面级 document.getElementById） */
function el<T extends Element = HTMLElement>(ctx: WorkspaceContext, id: string): T | null {
  return ctx.root.querySelector<T>(`#${id}`);
}

/** 拖动取色器时不重建 ma-list DOM，避免打断交互（对应原 maSkipRender） */
const maSkip = new WeakMap<HTMLElement, boolean>();
const isSkip = (ctx: WorkspaceContext): boolean => maSkip.get(ctx.root) === true;
const setSkip = (ctx: WorkspaceContext, on: boolean): void => { maSkip.set(ctx.root, on); };

/**
 * 与 chart-context.setMovingAverages 同口径：截断到 8 条、周期去重顺延、颜色校验。
 * 保证 config.movingAverages 与图表内部 maConfig 一致，均线面板渲染不会与图表错位。
 */
function normalizeMA(list: MAConfig[]): MAConfig[] {
  const seen = new Set<number>();
  return list.slice(0, 8).map((m) => {
    let period = Math.max(1, Math.round(Number(m.period) || 5));
    while (seen.has(period)) period += 1;
    seen.add(period);
    const color = /^#[0-9A-Fa-f]{6}$/.test(m.color || '') ? m.color : PALETTE.avg;
    return { period, color };
  });
}

/** 取当前配置的均线副本（避免改动只读快照） */
function currentMA(ctx: WorkspaceContext): MAConfig[] {
  return ctx.config().movingAverages.map((m) => ({ period: m.period, color: m.color }));
}

/** index.html:1928-1944 renderMAPanel：结构/文案逐字保留，数据源改为 config */
function renderMAPanel(ctx: WorkspaceContext): void {
  const maList = el(ctx, 'ma-list');
  if (!maList) return;
  const list = ctx.config().movingAverages;
  maList.innerHTML = list.length
    ? list
        .map(
          (m) => `
    <div class="ma-row">
      <input type="color" value="${m.color}" data-ma-color="${m.period}" title="颜色">
      <span>MA</span>
      <input type="number" min="1" max="250" value="${m.period}" data-ma-period="${m.period}" title="周期">
      <span style="flex:1"></span>
      <button type="button" data-ma-remove="${m.period}">删除</button>
    </div>`,
        )
        .join('')
    : '<div style="color:var(--muted);font-size:12px">暂无均线，可在下方添加</div>';
}

/** index.html:1351-1358 syncAuctionButton：单一真源，多日时禁用并说明原因 */
function syncAuctionButton(ctx: WorkspaceContext): void {
  const config = ctx.config();
  const btn = el<HTMLButtonElement>(ctx, 'btn-auction');
  if (!btn) return;
  const multi = config.intradayDays > 1;
  btn.disabled = multi;
  btn.classList.toggle('active', !multi && config.auctionEnabled);
  btn.textContent = multi
    ? '多日不展示竞价'
    : `竞价：${config.auctionEnabled ? '开' : '关'}`;
}

/** index.html:1359-1367 syncDaysSeg */
function syncDaysSeg(ctx: WorkspaceContext, days: number): void {
  const seg = el(ctx, 'intraday-days-seg');
  if (!seg) return;
  for (const b of seg.querySelectorAll<HTMLButtonElement>('button[data-days]')) {
    const on = Number(b.dataset.days) === Number(days);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

/** index.html:1368-1376 applyIntradayDays：输出改走 patchConfig，视觉同步交给 syncControls */
function applyIntradayDays(ctx: WorkspaceContext, days: number): void {
  const n = Math.max(1, Math.min(5, Math.round(Number(days) || 1)));
  ctx.patchConfig({ intradayDays: n });
}

/**
 * 从 ctx.config() 重渲染所有控件状态：
 * active class / hidden / select value / 均线面板。
 * 对应原 syncToggles(1720-1729) + syncAuctionButton + syncDaysSeg + 各下拉初值。
 * 原 syncToggles 里的 placeTape(mode) 属明细停放布局，由主元素按 config 处理，不在控件职责内。
 */
export function syncControls(ctx: WorkspaceContext): void {
  const config = ctx.config();
  const intraday = config.mode === 'intraday';

  const intradayOnly = el(ctx, 'intraday-only');
  if (intradayOnly) intradayOnly.hidden = !intraday;
  const candleOnly = el(ctx, 'candle-only');
  if (candleOnly) candleOnly.hidden = intraday;

  // 模式按钮互斥（原 pair() 的 active 切换，改由 config 驱动）
  const btnIntraday = el(ctx, 'btn-intraday');
  if (btnIntraday) btnIntraday.classList.toggle('active', intraday);
  const btnCandle = el(ctx, 'btn-candle');
  if (btnCandle) btnCandle.classList.toggle('active', !intraday);

  syncAuctionButton(ctx);

  const btnChips = el(ctx, 'btn-chips');
  if (btnChips) {
    btnChips.textContent = `筹码峰：${config.chipsEnabled ? '开' : '关'}`;
    btnChips.classList.toggle('active', config.chipsEnabled);
  }

  syncDaysSeg(ctx, config.intradayDays);
  const provenance = el(ctx, 'intraday-provenance');
  if (provenance) {
    provenance.textContent = config.intradayDays > 1
      ? `前 ${config.intradayDays - 1} 日为拟真数据`
      : '';
  }

  const selPeriod = el<HTMLSelectElement>(ctx, 'sel-period');
  if (selPeriod) selPeriod.value = config.period;
  const selSubplots = el<HTMLSelectElement>(ctx, 'sel-subplots');
  if (selSubplots) selSubplots.value = String(config.subplotCount);
  // 场景 / 盘口单位下拉属页面级 demo-bar（不在 root 内），若存在则同步（防御式）
  const selScenario = el<HTMLSelectElement>(ctx, 'sel-scenario');
  if (selScenario) selScenario.value = config.depthScenario;
  const selDepthUnit = el<HTMLSelectElement>(ctx, 'sel-depth-unit');
  if (selDepthUnit) selDepthUnit.value = config.depthUnit === 'amount' ? 'amount' : 'volume';

  const maPanel = el(ctx, 'ma-panel');
  if (maPanel) maPanel.style.display = config.maPanelOpen ? 'block' : 'none';
  if (!isSkip(ctx)) renderMAPanel(ctx);

  // 明暗主题切换按钮：文案/提示随当前有效主题变化，dark 时高亮（复用 button.active）
  const btnTheme = el<HTMLButtonElement>(ctx, 'btn-theme');
  if (btnTheme) {
    const dark = resolveWorkspaceTheme(config.theme).name === 'dark';
    const hint = dark ? '切换为浅色主题' : '切换为暗色主题';
    btnTheme.textContent = dark ? '浅色' : '暗色';
    btnTheme.title = hint;
    btnTheme.setAttribute('aria-label', hint);
    btnTheme.classList.toggle('active', dark);
  }
}

/** 绑定所有控件事件并做初始渲染；返回清理函数 */
export function mountControls(ctx: WorkspaceContext): () => void {
  const controller = new AbortController();
  const signal = controller.signal;

  // ---- index.html:1221-1229 selPeriod ----
  const selPeriod = el<HTMLSelectElement>(ctx, 'sel-period');
  if (selPeriod) {
    selPeriod.innerHTML = PERIODS.map(
      (p) => `<option value="${p.key}">${p.label}</option>`,
    ).join('');
    selPeriod.addEventListener(
      'change',
      (e: Event) => {
        ctx.patchConfig({ period: (e.target as HTMLSelectElement).value });
      },
      { signal },
    );
  }

  // ---- index.html:1329-1341 pair() 模式按钮互斥 ----
  const pair = (a: string, b: string, fn: (intraday?: boolean) => void): void => {
    const x = el(ctx, a);
    const y = el(ctx, b);
    if (!x || !y) return;
    x.addEventListener('click', () => fn(), { signal });
    y.addEventListener('click', () => fn(true), { signal });
  };
  pair('btn-candle', 'btn-intraday', (intraday) => {
    const mode: ChartMode = intraday ? 'intraday' : 'candle';
    ctx.patchConfig({ mode });
  });

  // ---- index.html:1342-1381 多日分时 / 竞价 ----
  const daysSeg = el(ctx, 'intraday-days-seg');
  if (daysSeg) {
    daysSeg.addEventListener(
      'click',
      (e: Event) => {
        const target = e.target as Element | null;
        const b = target?.closest<HTMLButtonElement>('button[data-days]');
        if (b) applyIntradayDays(ctx, Number(b.dataset.days));
      },
      { signal },
    );
  }
  const btnAuction = el<HTMLButtonElement>(ctx, 'btn-auction');
  if (btnAuction) {
    btnAuction.addEventListener(
      'click',
      () => {
        if (btnAuction.disabled) return; // 多日场景竞价不可用
        ctx.patchConfig({ auctionEnabled: !ctx.config().auctionEnabled });
      },
      { signal },
    );
  }
  const btnChips = el(ctx, 'btn-chips');
  if (btnChips) {
    btnChips.addEventListener(
      'click',
      () => {
        ctx.patchConfig({ chipsEnabled: !ctx.config().chipsEnabled });
      },
      { signal },
    );
  }

  // ---- index.html:1747-1751 副图数量 ----
  const selSubplots = el<HTMLSelectElement>(ctx, 'sel-subplots');
  if (selSubplots) {
    selSubplots.addEventListener(
      'change',
      (e: Event) => {
        ctx.patchConfig({ subplotCount: Number((e.target as HTMLSelectElement).value) });
      },
      { signal },
    );
  }

  // ---- index.html:1753-1757 场景 / 盘口单位下拉（页面级 demo-bar，防御式绑定）----
  const selScenario = el<HTMLSelectElement>(ctx, 'sel-scenario');
  if (selScenario) {
    selScenario.addEventListener(
      'change',
      (e: Event) => {
        ctx.patchConfig({ depthScenario: (e.target as HTMLSelectElement).value });
      },
      { signal },
    );
  }
  const selDepthUnit = el<HTMLSelectElement>(ctx, 'sel-depth-unit');
  if (selDepthUnit) {
    selDepthUnit.addEventListener(
      'change',
      (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        ctx.patchConfig({ depthUnit: (value === 'amount' ? 'amount' : 'volume') as DepthUnit });
      },
      { signal },
    );
  }
  // applyDepthUnit / depth-unit-change 的控件同步部分：盘口子组件切换单位时也同步下拉
  ctx.chart.addEventListener(
    'depth-unit-change',
    (e: Event) => {
      const unit = (e as CustomEvent<{ unit: DepthUnit }>).detail.unit === 'amount'
        ? 'amount'
        : 'volume';
      const sel = el<HTMLSelectElement>(ctx, 'sel-depth-unit');
      if (sel) sel.value = unit;
    },
    { signal },
  );

  // ---- index.html:1925-1981 K 线均线设置面板 ----
  const maPanel = el(ctx, 'ma-panel');
  const maList = el(ctx, 'ma-list');
  const maColor = el<HTMLInputElement>(ctx, 'ma-color');
  if (maColor) maColor.value = PALETTE.limitDownBroken; // index.html:1211

  // ma-config-change：图表均线配置变化时重建面板（既有事件，不 new CustomEvent）
  ctx.chart.addEventListener(
    'ma-config-change',
    () => {
      if (!isSkip(ctx)) renderMAPanel(ctx);
    },
    { signal },
  );

  const btnMa = el(ctx, 'btn-ma');
  if (btnMa && maPanel) {
    btnMa.addEventListener(
      'click',
      () => {
        const open = maPanel.style.display === 'none';
        maPanel.style.display = open ? 'block' : 'none';
        ctx.patchConfig({ maPanelOpen: open });
        if (open) renderMAPanel(ctx);
      },
      { signal },
    );
  }
  const maClose = el(ctx, 'ma-close');
  if (maClose && maPanel) {
    maClose.addEventListener(
      'click',
      () => {
        maPanel.style.display = 'none';
        ctx.patchConfig({ maPanelOpen: false });
      },
      { signal },
    );
  }
  const maAdd = el(ctx, 'ma-add');
  if (maAdd) {
    maAdd.addEventListener(
      'click',
      () => {
        const periodInput = el<HTMLInputElement>(ctx, 'ma-period');
        const colorInput = el<HTMLInputElement>(ctx, 'ma-color');
        const next = normalizeMA([
          ...currentMA(ctx),
          {
            period: Number(periodInput?.value ?? '') || 60,
            color: colorInput?.value ?? PALETTE.limitDownBroken,
          },
        ]);
        ctx.patchConfig({ movingAverages: next });
      },
      { signal },
    );
  }
  if (maList) {
    maList.addEventListener(
      'input',
      (e: Event) => {
        const target = e.target as HTMLInputElement;
        const p = target.dataset.maColor;
        if (p != null) {
          setSkip(ctx, true);
          const next = normalizeMA(
            currentMA(ctx).map((m) => (m.period === Number(p) ? { ...m, color: target.value } : m)),
          );
          ctx.patchConfig({ movingAverages: next });
          setSkip(ctx, false);
        }
      },
      { signal },
    );
    maList.addEventListener(
      'change',
      (e: Event) => {
        const target = e.target as HTMLInputElement;
        const p = target.dataset.maPeriod;
        if (p != null) {
          const next = normalizeMA(
            currentMA(ctx).map((m) => (m.period === Number(p) ? { ...m, period: Number(target.value) } : m)),
          );
          ctx.patchConfig({ movingAverages: next });
        }
      },
      { signal },
    );
    maList.addEventListener(
      'click',
      (e: Event) => {
        const target = e.target as HTMLElement;
        const p = target.dataset.maRemove;
        if (p != null) {
          const next = normalizeMA(currentMA(ctx).filter((m) => m.period !== Number(p)));
          ctx.patchConfig({ movingAverages: next });
        }
      },
      { signal },
    );
  }

  // ---- 明暗主题切换：点击只输出配置变更，不直接操作 DOM 颜色 / chart.setTheme / :root ----
  const btnTheme = el<HTMLButtonElement>(ctx, 'btn-theme');
  if (btnTheme) {
    const onThemeToggle = (): void => {
      const name = resolveWorkspaceTheme(ctx.config().theme).name;
      const next = name === 'dark' ? 'light' : 'dark';
      ctx.patchConfig({ theme: next });
    };
    btnTheme.addEventListener('click', onThemeToggle, { signal });
  }

  // 初始渲染（对应原 selPeriod.value / syncDaysSeg / syncToggles 的启动时同步）
  syncControls(ctx);
  return () => controller.abort();
}
