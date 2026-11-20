/**
 * 事件契约单一真源（零依赖叶子模块，gl / core / elements 都可引用）。
 * 所有组件事件统一 bubbles + composed，保证从 Shadow DOM 冒泡到 <stock-chart> 与页面。
 */
export const CHART_EVENTS = Object.freeze({
  LOAD_START: 'load-start',
  DATA_LOADED: 'data-loaded',
  DATASET_READY: 'dataset-ready',
  CHART_ERROR: 'chart-error',
  HEAD_CHANGE: 'head-change',
  DETAIL_DATA_CHANGE: 'detail-data-change',
  DEPTH_SCENARIO_CHANGE: 'depth-scenario-change',
  DEPTH_UNIT_CHANGE: 'depth-unit-change',
  DEPTH_UNIT_REQUEST: 'depth-unit-request',   // 子组件请求改单位，由根容器统一派发 CHANGE
  CROSSHAIR_CHANGE: 'crosshair-change',
  VIEWPORT_CHANGE: 'viewport-change',
  LAYOUT_CHANGE: 'layout-change',
  PERIOD_CHANGE: 'period-change',
  CHIP_MODE_CHANGE: 'chip-mode-change',
  MA_CONFIG_CHANGE: 'ma-config-change',
  MACD_PARAMS_CHANGE: 'macd-params-change',
  INTRADAY_DAYS_CHANGE: 'intraday-days-change',
  SUBPLOT_CONFIG_CHANGE: 'subplot-config-change',
  COMPUTE_MODE_CHANGE: 'compute-mode-change',
  THEME_CHANGE: 'theme-change',
  AUCTION_TOGGLE: 'auction-toggle',
  CHIPS_TOGGLE: 'chips-toggle',
  AUCTION_HOVER: 'auction-hover',
  CLOSING_HOVER: 'closing-hover',
  DEPTH_LEVELS_CHANGE: 'depth-levels-change',
  VIEW_PANORAMA: 'view-panorama',
  TAPE_SCROLL: 'tape-scroll',
  WEBGL_CONTEXT_LOST: 'webglcontext-lost',
  WEBGL_CONTEXT_RESTORED: 'webglcontext-restored',
});

/** 统一派发：detail 恒为对象，options 默认 bubbles + composed */
export function emitEvent(host: EventTarget, name: string,
  detail: unknown = {}, options: CustomEventInit = {}): boolean {
  // options 先展开：显式传入的 detail 与统一约定（bubbles/composed）不能被调用方静默覆盖
  return host.dispatchEvent(new CustomEvent(name, {
    ...options, detail, bubbles: true, composed: true,
  }));
}
