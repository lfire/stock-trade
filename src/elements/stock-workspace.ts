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
import { mountDetail, syncDetail, mountSideData, syncSideData } from '../workspace/detail';
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
  setHistoricalIntradayDate?(date: string | null): void;
  getState(): Record<string, unknown>;
}

/** 两个已解析模块清单是否一致（拓扑序数组逐位比较）。 */
const sameEnabled = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

interface LifecycleHooks {
  mount(ctx: WorkspaceContext): () => void;
  sync(ctx: WorkspaceContext): void;
}

/**
 * 可变生命周期注册表：lifecycle 值（string）→ hooks。registerLifecycle() 让新模块声明的
 * 任意 lifecycle 值都能落地，不再用固定三类枚举 + filter 静默丢弃未知值。
 */
const LIFECYCLE_HOOKS: Map<string, LifecycleHooks> = new Map<string, LifecycleHooks>([
  ['head', { mount: mountHead, sync: syncHead }],
  ['controls', { mount: mountControls, sync: syncControls }],
  ['detail', { mount: mountDetail, sync: syncDetail }],
]);

/** 注册 / 覆盖一个生命周期的 hooks（单对象参数，≤3 参数）。 */
export function registerLifecycle(name: string, hooks: LifecycleHooks): void {
  LIFECYCLE_HOOKS.set(name, hooks);
}

// 侧栏数据生命周期：depth-book / trade-tape 各自声明不同值，共用同一份轻量 hooks
// （mountSideData 内部按 root 幂等去重，full 同时启用两者也不会重复绑定）。
registerLifecycle('depth', { mount: mountSideData, sync: syncSideData });
registerLifecycle('tape', { mount: mountSideData, sync: syncSideData });

/** 已告警过的未注册 lifecycle，保证同一值只 warn 一次。 */
const warnedLifecycles: Set<string> = new Set();

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
    const out = {
      depth: (depth[0] as DetailData['depth']) ?? null,
      depthScenarios: (d?.depthScenarios ?? {}) as DetailData['depthScenarios'],
      trades: (d?.trades ?? []) as DetailData['trades'],
      orders: (d?.orders ?? []) as DetailData['orders'],
      depthFull: (d?.depthFull ?? null) as DetailData['depthFull'],
      historicalIntraday: d?.historicalIntraday ?? null,
    } as DetailData;
    return out;
  }

  /** 把配置增量映射到内部 chart 的公开方法；声明式子配置节点同步更新 */
  private applyConfig(patch: Partial<WorkspaceConfig>): void {
    // 作用于覆盖视图 mini / DOM class 的字段（historicalAuctionEnabled / historicalTapeExpanded 等）
    // 由 detail lifecycle 的 syncAll 从 config 快照消费；本函数只把配置增量映射到主 #chart 的公开方法，
    // mini 是独立实例不在该链 —— 这类字段不在此出现是有意分工，不是遗漏。
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
    if ('historicalIntradayDate' in patch) {
      c.setHistoricalIntradayDate?.(cfg.historicalIntradayDate);
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

  /**
   * 按启用模块顺序收集其 lifecycle（每种只挂一次）：已注册的直接保留；
   * 未注册的不静默丢弃——给一次 console.warn 后跳过，保证新值可见、可诊断。
   */
  private activeLifecycles(): string[] {
    const active: string[] = [];
    const seen = new Set<string>();
    for (const id of this._enabled) {
      if (!isModuleEnabled(this._enabled, id)) continue;
      const lifecycle = MODULE_CATALOG[id]?.lifecycle;
      if (typeof lifecycle !== 'string' || !lifecycle || seen.has(lifecycle)) continue;
      seen.add(lifecycle);
      if (!LIFECYCLE_HOOKS.has(lifecycle)) {
        if (!warnedLifecycles.has(lifecycle)) {
          warnedLifecycles.add(lifecycle);
          console.warn(`[stock-workspace] lifecycle "${lifecycle}" 未注册 hooks，已跳过挂载`);
        }
        continue;
      }
      active.push(lifecycle);
    }
    return active;
  }

  /** 按启用模块顺序的 lifecycle 查注册表挂载；未注册值已由 activeLifecycles 过滤/告警。 */
  private mountLifecycles(): void {
    if (!this._ctx) return;
    const ctx = this._ctx;
    this._cleanups = this.activeLifecycles()
      .map((lifecycle) => LIFECYCLE_HOOKS.get(lifecycle)?.mount(ctx) ?? (() => {}));
  }

  /**
   * 模块集变化后的整体重建：清理旧生命周期 → 按新 enabled 重建 DOM/CSS →
   * 重新取 #chart / 重建 ctx / 重挂载生命周期 → 微任务重放完整配置与已有数据。
   * setData 不会触发 rebuild，因此无递归风险。
   */
  private rebuildModules(): void {
    const enabled = this._enabled;
    // 缓存明细卡片引用：分时模式 placeTape 会把 #tape-card 搬进旧 chart 的 sideTradeEl，
    // 无条件 innerHTML 会连同旧 chart 一起销毁。重建后由 restoreTapeCard 决定归位或丢弃
    // （新模板无 tapeCard 切片时丢弃缓存、不补寄主，避免残留）。
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

    // 处理缓存的明细卡片（新模板含 tapeCard 切片才归位，否则丢弃）；并同步把主题下沉到
    // 新 chart（微任务里的 applyConfig 会再 setTheme 一次，幂等），不再依赖守卫。
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

  /**
   * 缓存的 #tape-card 归位：仅当新模板含 tapeCard 切片（自带 #tape-home）时才处理；
   * 否则丢弃缓存节点、不补任何隐藏寄主，避免切到无 tapeCard 的模板后残留旧 DOM。
   */
  private restoreTapeCard(): void {
    const card = this._tapeCard;
    this._tapeCard = null;
    if (!card) return;
    // 新模板无 tapeCard 切片 → 无 #tape-home：直接丢弃缓存，不补 #tape-home，杜绝运行时残留。
    const home = this.querySelector<HTMLElement>('#tape-home');
    if (!home) return;
    // 新模板已自带 #tape-card（full/intraday/candle-full）：以新节点为准，丢弃缓存避免重复。
    if (this.querySelector('#tape-card')) return;
    // 新模板含寄主却缺卡片（防御）：把缓存卡片归位。
    home.appendChild(card);
  }

  private syncAll(): void {
    if (!this._ctx) return;
    const ctx = this._ctx;
    for (const lifecycle of this.activeLifecycles()) LIFECYCLE_HOOKS.get(lifecycle)?.sync(ctx);
  }
}
