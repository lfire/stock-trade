/**
 * <stock-workspace>：行情工作台根组件（light DOM 封装）。
 *
 * 对外只有两个输入：
 *   workspace.data   = ChartDataset      结构化数据对象（页面负责 IO，组件不 fetch、不读路径）
 *   workspace.config = Partial<WorkspaceConfig>  配置对象（增量合并）
 * 输出统一为 CustomEvent（WORKSPACE_EVENTS + 内部 chart 的既有事件冒泡）。
 *
 * 内部把头部行情、工具栏、明细与详情覆盖视图作为私有模块挂载，
 * 页面不再 querySelector 组件内部 DOM、不再直接调用子组件方法。
 */
import { buildWorkspaceCSS, buildWorkspaceTemplate } from '../workspace/template';
import { WORKSPACE_SHELL_CSS } from '../workspace/shell-css';
import { MODULE_CATALOG, resolveModules, isModuleEnabled } from '../workspace/module-catalog';
import { applyWorkspaceTheme, resolveWorkspaceTheme } from '../workspace/theme';
import {
  DEFAULT_WORKSPACE_CONFIG, WORKSPACE_EVENTS,
  type WorkspaceConfig, type WorkspaceContext,
} from '../workspace/types';
import { mountHead, syncHead } from '../workspace/head';
import { mountControls, syncControls } from '../workspace/controls';
import { mountDetail, syncDetail } from '../workspace/detail';
import { emitEvent } from '../events';
import type { ChartDataset, DetailData, MAConfig, MACDParams } from '../types';

/** 内部 <stock-chart> 需要用到的公开方法（结构化描述，避免宽松类型） */
interface ChartApi {
  setDataset(data: ChartDataset | null): void;
  setDetailData(data: DetailData): void;
  setTheme(theme: string | Record<string, string> | null): void;
  setMode(mode: string): void;
  setPeriod(period: string): void;
  setChipMode(mode: string): void;
  setAuctionEnabled(on: boolean): void;
  setChipsEnabled(on: boolean): void;
  setSubplotCount(n: number): void;
  setSubplotIndicator(index: number, name: string): void;
  setIntradayDays(days: number): void;
  setMACDParams(input: string | MACDParams): void;
  setMovingAverages(list: MAConfig[]): void;
  setDepthScenario(key: string): void;
  setDepthUnit(unit: string): void;
  setCrosshair(index: number | null): void;
  setPointer(x: number | null, y?: number): void;
  setAuctionHover(index: number | null): void;
  setClosingHover(index: number | null): void;
  setSideExpanded(on: boolean): void;
  getState(): Record<string, unknown>;
}

/** 两个已解析模块清单是否一致（拓扑序数组逐位比较）。 */
const sameEnabled = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** 生命周期种类（对应 MODULE_CATALOG[id].lifecycle 的取值）。 */
type WorkspaceLifecycle = 'head' | 'controls' | 'detail';

interface LifecycleHooks {
  mount(ctx: WorkspaceContext): () => void;
  sync(ctx: WorkspaceContext): void;
}

/** lifecycle → 挂载/同步函数映射表；新模块声明 lifecycle 后据此落地，不留硬编码 id 判断。 */
const LIFECYCLE_HOOKS: Readonly<Record<WorkspaceLifecycle, LifecycleHooks>> = {
  head: { mount: mountHead, sync: syncHead },
  controls: { mount: mountControls, sync: syncControls },
  detail: { mount: mountDetail, sync: syncDetail },
};

/** 固定挂载顺序：与内置模块行为一致；每种 lifecycle 只挂一次（多模块共用时去重）。 */
const LIFECYCLE_ORDER: readonly WorkspaceLifecycle[] = ['head', 'controls', 'detail'];

export class StockWorkspace extends HTMLElement {
  /** 结构化数据输入 */
  declare data: ChartDataset | null;
  /** 配置输入（增量合并） */
  declare config: Readonly<WorkspaceConfig>;

  private _data: ChartDataset | null = null;
  private _config: WorkspaceConfig = { ...DEFAULT_WORKSPACE_CONFIG };
  private _connected = false;
  private _cleanups: Array<() => void> = [];
  private _chart: (HTMLElement & Partial<ChartApi>) | null = null;
  private _ctx: WorkspaceContext | null = null;
  /** 当前生效的启用模块清单（resolveModules 结果），供 sync/apply/rebuild 复用 */
  private _enabled: string[] = [];
  /** 本实例自有的 <style> 元素（不再用文档级全局 id，多实例互不串写） */
  private _styleEl: HTMLStyleElement | null = null;
  /** ensureStyles 上次注入的 CSS，模块集变化时据此更新已存在 <style> 的 textContent */
  private _lastCss: string | null = null;
  /** rebuild 时缓存搬迁中的 #tape-card，避免 innerHTML 连同旧 chart 一起销毁 */
  private _tapeCard: HTMLElement | null = null;

  /** @deprecated 组件不再读取数据路径；请改用 workspace.data 注入结构化对象 */
  static get observedAttributes(): string[] { return ['dataset', 'theme']; }

  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    // 模块化装载：先按配置解析启用模块，据此生成 DOM 模板与 CSS
    this._enabled = resolveModules({ modules: this._config.modules, preset: this._config.preset });
    if (!this.querySelector('.chart-card')) this.innerHTML = buildWorkspaceTemplate(this._enabled);
    // 组件自有主题：把 23 个 --sw-* 变量写到根元素 inline style（非 :root、非 stock-chart host）
    applyWorkspaceTheme(this, this._config.theme ?? this.getAttribute('theme'));
    this.ensureStyles(this._enabled);
    this._chart = this.querySelector<HTMLElement & Partial<ChartApi>>('#chart');
    if (!this._chart) return;

    const chart = this._chart;
    this.buildContext();
    this.mountLifecycles();
    // 子元素升级是同步的，但用微任务兜底，确保 chart 的 connectedCallback 已完成；
    // rebuildModules 替换 #chart 后按引用比对跳过，避免对旧实例重复应用配置
    queueMicrotask(() => {
      if (!this._connected || this._chart !== chart) return;
      this.applyConfig(this._config);
      if (this._data) chart.setDataset?.(this._data);
      this.syncAll();
      emitEvent(this, WORKSPACE_EVENTS.READY, { config: { ...this._config } });
    });

    // 兼容旧用法：仅给出废弃提示，不再由组件 fetch 路径
    if (this.hasAttribute('dataset')) {
      console.warn('[stock-workspace] dataset 路径属性已废弃，请用 workspace.data 注入 ChartDataset 对象');
    }
  }

  disconnectedCallback() {
    this._connected = false;
    for (const fn of this._cleanups) { try { fn(); } catch { /* 清理失败不阻塞卸载 */ } }
    this._cleanups = [];
    this._ctx = null;
    this._chart = null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'dataset' && value) {
      console.warn('[stock-workspace] dataset 路径属性已废弃；组件不再加载数据，请设置 workspace.data');
    } else if (name === 'theme' && this._connected) {
      // setConfig → applyConfig 已在内部应用根主题 + chart.setTheme；不再重复直接调用，
      // 避免一次 theme 属性变更触发 2~3 次主题写入。
      this.setConfig({ theme: value });
    }
  }

  // ---------------------------------------------------------------- 标准输入
  /** 用 Object.defineProperty 挂到原型，保持 `workspace.data = obj` / `workspace.config = {...}` 的直观写法 */
  static {
    Object.defineProperty(StockWorkspace.prototype, 'data', {
      configurable: true,
      get(this: StockWorkspace) { return this._data; },
      set(this: StockWorkspace, v: ChartDataset | null) { this.setData(v); },
    });
    Object.defineProperty(StockWorkspace.prototype, 'config', {
      configurable: true,
      get(this: StockWorkspace): Readonly<WorkspaceConfig> { return { ...this._config }; },
      set(this: StockWorkspace, v: Partial<WorkspaceConfig>) { this.setConfig(v); },
    });
  }

  setData(value: ChartDataset | null): void {
    this._data = value;
    if (this._connected && this._chart) {
      this._chart.setDataset?.(value);
      this._chart.setDetailData?.(this.buildDetailData());
      this.syncAll();
      emitEvent(this, WORKSPACE_EVENTS.DATA_READY, { dataset: value });
    }
  }

  setConfig(patch: Partial<WorkspaceConfig>): void {
    this._config = { ...this._config, ...patch };
    if (!this._connected) return;
    // 模块集变化统一在此处理：applyConfig 不重复触发 rebuild
    if ('modules' in patch || 'preset' in patch) {
      const next = resolveModules({ modules: this._config.modules, preset: this._config.preset });
      if (!sameEnabled(next, this._enabled)) {
        this._enabled = next;
        this.rebuildModules();
        emitEvent(this, WORKSPACE_EVENTS.CONFIG_CHANGE, { config: { ...this._config }, patch });
        return;
      }
    }
    this.applyConfig(patch);
    this.syncAll();
    emitEvent(this, WORKSPACE_EVENTS.CONFIG_CHANGE, { config: { ...this._config }, patch });
  }

  /** 当前生效主题名（只读，供外部查询；不暴露内部色板实现）。 */
  get theme(): 'light' | 'dark' {
    return resolveWorkspaceTheme(this._config.theme).name;
  }

  // ---------------------------------------------------------------- 内部编排
  private ensureStyles(enabled: string[]): void {
    const css = buildWorkspaceCSS(enabled) + '\n' + WORKSPACE_SHELL_CSS;
    let style = this._styleEl;
    if (!style) {
      style = this.ownerDocument.createElement('style');
      this._styleEl = style;
    }
    // <style> 挂进本实例（light DOM）：文档级选择器仍全局生效，但每个实例只写自己
    // 那一份，不再靠文档级全局 id 共享而互相覆盖。rebuildModules 的 innerHTML 会清掉
    // 子节点，这里按需重新挂回，保证「同一实例只注入一次」。
    if (style.parentElement !== this) this.prepend(style);
    // 注入内容随模块变化：用 _lastCss 记录上次注入值，模块集变化时更新已存在 <style> 的 textContent
    if (this._lastCss === css && style.textContent === css) return;
    style.textContent = css;
    this._lastCss = css;
  }

  private buildDetailData(): DetailData {
    const d = this._data;
    const depth = Array.isArray(d?.depth) ? d!.depth : [d?.depth].filter(Boolean);
    return {
      depth: (depth[0] as DetailData['depth']) ?? null,
      depthScenarios: (d?.depthScenarios ?? {}) as DetailData['depthScenarios'],
      trades: (d?.trades ?? []) as DetailData['trades'],
      orders: (d?.orders ?? []) as DetailData['orders'],
      depthFull: (d?.depthFull ?? null) as DetailData['depthFull'],
    } as DetailData;
  }

  /** 把配置增量映射到内部 chart 的公开方法；声明式子配置节点同步更新 */
  private applyConfig(patch: Partial<WorkspaceConfig>): void {
    const c = this._chart;
    if (!c) return;
    const cfg = this._config;
    if ('theme' in patch) {
      applyWorkspaceTheme(this, cfg.theme);
      c.setTheme?.(cfg.theme);
    }
    if ('mode' in patch) c.setMode?.(cfg.mode);
    if ('period' in patch) c.setPeriod?.(cfg.period);
    if ('chipMode' in patch) c.setChipMode?.(cfg.chipMode);
    if ('auctionEnabled' in patch) c.setAuctionEnabled?.(cfg.auctionEnabled);
    if ('chipsEnabled' in patch) c.setChipsEnabled?.(cfg.chipsEnabled);
    if ('subplotCount' in patch) c.setSubplotCount?.(cfg.subplotCount);
    if ('intradayDays' in patch) c.setIntradayDays?.(cfg.intradayDays);
    if ('macd' in patch && cfg.macd) c.setMACDParams?.(cfg.macd);
    // 空数组表示「不覆盖」：声明式 <ma-line> 子节点由 chart 自己读取生成默认均线
    if ('movingAverages' in patch && cfg.movingAverages.length) c.setMovingAverages?.(cfg.movingAverages);
    if ('depthScenario' in patch) c.setDepthScenario?.(cfg.depthScenario);
    if ('depthUnit' in patch) c.setDepthUnit?.(cfg.depthUnit);
    if ('crosshair' in patch) c.setCrosshair?.(cfg.crosshair);
    if ('auctionHover' in patch) c.setAuctionHover?.(cfg.auctionHover);
    if ('closingHover' in patch) c.setClosingHover?.(cfg.closingHover);
    if ('pointer' in patch) {
      const p = cfg.pointer;
      c.setPointer?.(p ? p.x : null, p ? p.y : undefined);
    }
    if ('tapePlacement' in patch || 'mode' in patch) {
      c.setSideExpanded?.(cfg.tapePlacement === 'detail');
    }
    if ('subplotIndicators' in patch) {
      cfg.subplotIndicators.forEach((name, i) => c.setSubplotIndicator?.(i, name));
      const panes = this.querySelectorAll('indicator-pane');
      panes.forEach((p, i) => { if (cfg.subplotIndicators[i]) p.setAttribute('indicator', cfg.subplotIndicators[i]); });
    }
    if ('depthLevels' in patch) {
      const book = this.querySelector<HTMLElement & { setLevels?: (n: number) => void }>('#book');
      book?.setLevels?.(cfg.depthLevels);
    }
  }

  /** 构造内部模块共用的上下文（root / chart / config / data 等只读入口） */
  private buildContext(): void {
    this._ctx = {
      root: this,
      chart: this._chart as HTMLElement & Record<string, unknown>,
      config: () => this._config,
      patchConfig: (patch) => this.setConfig(patch),
      data: () => this._data,
      detailData: () => this.buildDetailData(),
    };
  }

  /** 启用模块声明的生命周期种类：遍历 enabled 查 MODULE_CATALOG[id].lifecycle，去重并按固定顺序返回。 */
  private activeLifecycles(): WorkspaceLifecycle[] {
    const active = new Set<WorkspaceLifecycle>();
    for (const id of this._enabled) {
      const lifecycle = MODULE_CATALOG[id]?.lifecycle;
      if (lifecycle && isModuleEnabled(this._enabled, id)) active.add(lifecycle);
    }
    return LIFECYCLE_ORDER.filter((lifecycle) => active.has(lifecycle));
  }

  /** 按启用模块的 lifecycle 查映射表挂载；未启用的模块不挂载，其 cleanup 不进入 _cleanups */
  private mountLifecycles(): void {
    if (!this._ctx) return;
    const ctx = this._ctx;
    this._cleanups = this.activeLifecycles()
      .map((lifecycle) => LIFECYCLE_HOOKS[lifecycle].mount(ctx));
  }

  /**
   * 模块集变化后的整体重建：清理旧生命周期 → 按新 enabled 重建 DOM/CSS →
   * 重新取 #chart / 重建 ctx / 重挂载生命周期 → 微任务重放完整配置与已有数据。
   * setData 不会触发 rebuild，因此无递归风险。
   */
  private rebuildModules(): void {
    const enabled = this._enabled;
    // 缓存明细卡片：分时模式 placeTape 会把 #tape-card 搬进旧 chart 的 sideTradeEl，
    // 无条件 innerHTML 会连同旧 chart 一起销毁。先持有引用，重建后归位，
    // 避免 minimal/candle 新模板无 #tape-home 时卡片永久消失。
    const card = this.querySelector<HTMLElement>('#tape-card');
    if (card) this._tapeCard = card;
    // 同步应用组件根主题：setConfig 走 rebuild 分支会跳过 applyConfig(patch)，
    // 根主题不能只靠可能被守卫跳过的微任务（甚至丢失）。innerHTML 只替换子节点，
    // root 上的 --sw-* / data-theme 不受影响。
    applyWorkspaceTheme(this, this._config.theme);
    for (const fn of this._cleanups) { try { fn(); } catch { /* 清理失败不阻塞重建 */ } }
    this._cleanups = [];
    this._ctx = null;
    this._chart = null;

    this.innerHTML = buildWorkspaceTemplate(enabled);
    this.ensureStyles(enabled);
    this._chart = this.querySelector<HTMLElement & Partial<ChartApi>>('#chart');
    if (!this._chart) return;
    const chart = this._chart;

    // 归位缓存的明细卡片；并同步把主题下沉到新 chart（微任务里的 applyConfig 会再
    // setTheme 一次，幂等），不再依赖守卫。
    this.restoreTapeCard();
    chart.setTheme?.(this._config.theme);

    this.buildContext();
    this.mountLifecycles();
    // 微任务兜底：chart 升级完成后重放完整配置；已有数据用 setData 重新注入（其内部不触发 rebuild）
    queueMicrotask(() => {
      if (!this._connected || this._chart !== chart) return;
      this.applyConfig(this._config);
      if (this._data) this.setData(this._data);
      else this.syncAll();
      emitEvent(this, WORKSPACE_EVENTS.READY, { config: { ...this._config } });
    });
  }

  /** 把缓存的 #tape-card 归位到 #tape-home；新模板已自带卡片时以新节点为准（不重复）。 */
  private restoreTapeCard(): void {
    const card = this._tapeCard;
    if (!card) return;
    // 新模板自带 #tape-card（full/intraday）：丢弃缓存，避免与新节点重复。
    if (this.querySelector('#tape-card')) { this._tapeCard = null; return; }
    // minimal/candle 新模板无 #tape-home：补一个隐藏寄主，卡片归位，节点不丢，
    // 也让 detachDetailCard(card, home) 恒有宿主可用。
    let home = this.querySelector<HTMLElement>('#tape-home');
    if (!home) {
      home = this.ownerDocument.createElement('div');
      home.id = 'tape-home';
      home.hidden = true;
      this.appendChild(home);
    }
    home.appendChild(card);
  }

  private syncAll(): void {
    if (!this._ctx) return;
    const ctx = this._ctx;
    for (const lifecycle of this.activeLifecycles()) LIFECYCLE_HOOKS[lifecycle].sync(ctx);
  }
}
