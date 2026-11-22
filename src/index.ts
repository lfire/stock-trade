/**
 * 组件库注册入口。
 *
 * 各 elements 模块只导出 class，import 时不再产生 customElements.define 副作用；
 * 显式调用 defineAll() 才注册全局标签，便于按需引入、多版本共存与隔离测试。
 * 需要纯计算能力而不想触碰 DOM 时，请改用 'stock-chart/pure' 子入口（源码 ./pure.ts）。
 */
import { StockChart } from './elements/stock-chart';
import { PricePane } from './elements/price-pane';
import { IndicatorPane } from './elements/indicator-pane';
import { ChipPane } from './elements/chip-pane';
import { AuctionPane } from './elements/auction-pane';
import { TradeTape } from './elements/trade-tape';
import { DepthBook } from './elements/depth-book';
import { DetailCanvas } from './elements/detail-canvas';
import { StockWorkspace } from './elements/stock-workspace';

export {
  StockChart, PricePane, IndicatorPane, ChipPane, AuctionPane, TradeTape, DepthBook, DetailCanvas,
  StockWorkspace,
};
export { SUBPLOT_INDICATORS } from './elements/stock-chart';
export { PALETTE, THEMES, LAYOUT, resolveTheme, createPalette, applyPalette, resetPalette, withPalette } from './types';
export { bindStockChart } from './frameworks/react';
export { CHART_EVENTS, emitEvent } from './events';
/** 页面侧数据加载与配置解析工具：组件本身不接受路径、不读 URL */
export { loadDataset } from './core/data-store';
export { parseWorkspaceConfig } from './workspace/url-config';
export { WORKSPACE_EVENTS, DEFAULT_WORKSPACE_CONFIG } from './workspace/types';
export type { WorkspaceConfig, WorkspaceInputs, WorkspaceModule, WorkspaceContext, DetailSet, TapePlacement } from './workspace/types';
export * from './pure';
/** 对外公开的全部数据类型由 tsc 自动生成到 dist/types.d.ts，并由根入口重导出 */
export type * from './types';

/** 跨框架适配层：框架无关内核 + 各框架薄桥的统一根入口导出（不引入任何框架运行时依赖） */
export { createWorkspaceController, bindWorkspace, mountWorkspace, diffConfig, camelToEventName, WORKSPACE_EVENT_NAMES } from './frameworks/controller';
export type { WorkspaceProps, WorkspaceController, WorkspaceHost, WorkspaceEventMap, WorkspaceEventName, WorkspaceEventHandler } from './frameworks/controller';
export { createWorkspaceRef, createReactWorkspace, bindWorkspaceProps } from './frameworks/react';
export { vWorkspace, createVueWorkspace, useWorkspace } from './frameworks/vue';
export { workspaceAction, stockWorkspace } from './frameworks/svelte';
export { createWorkspaceDirective } from './frameworks/angular';
export { splitWorkspaceProps, createWorkspaceSignalBinding } from './frameworks/solid';
export { mount as mountVanillaWorkspace, mountWithData } from './frameworks/vanilla';

const ELEMENTS = {
  'stock-chart': StockChart,
  'price-pane': PricePane,
  'indicator-pane': IndicatorPane,
  'chip-pane': ChipPane,
  'auction-pane': AuctionPane,
  'trade-tape': TradeTape,
  'depth-book': DepthBook,
  'detail-canvas': DetailCanvas,
  'stock-workspace': StockWorkspace,
};

export const ELEMENT_TAGS = Object.keys(ELEMENTS);

/** @param {CustomElementRegistry} [registry] 可注入自定义 registry 便于测试隔离 */
export function defineAll(registry?: CustomElementRegistry): string[] {
  const r = registry || customElements;
  for (const tag of ELEMENT_TAGS) {
    if (!r.get(tag)) r.define(tag, (ELEMENTS as Record<string, CustomElementConstructor>)[tag]);
  }
  return ELEMENT_TAGS.slice();
}
