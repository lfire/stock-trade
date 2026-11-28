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
/** 副图扩展点：注册自定义副图指标（数据 + 信息栏文案），绘制复用通用渲染器 */
export {
  registerSubplotIndicator, subplotIndicatorIds, subplotIndicatorLabel, getSubplotIndicator,
} from './core/subplot-indicators';
export type {
  SubplotIndicatorDef, SubplotSeries, SubplotPoint, SubplotRenderType, SubplotFormat,
} from './core/subplot-indicators';
export { PALETTE, THEMES, LAYOUT, resolveTheme, createPalette, applyPalette, resetPalette, withPalette } from './types';
export { bindStockChart } from './frameworks/react';
export { CHART_EVENTS, emitEvent } from './events';
/** 页面侧数据加载与配置解析工具：组件本身不接受路径、不读 URL */
export { loadDataset } from './core/data-store';
export { parseWorkspaceConfig } from './workspace/url-config';
export { WORKSPACE_EVENTS, DEFAULT_WORKSPACE_CONFIG } from './workspace/types';
export type { WorkspaceConfig, WorkspaceInputs, WorkspaceModule, WorkspaceContext, DetailSet, TapePlacement } from './workspace/types';
/** 模块化装载扩展点：注册自定义模块 / CSS 片段，并读取模块目录与模板构造器 */
export { MODULE_CATALOG, registerModule } from './workspace/module-catalog';
/** 单模块出入参说明：describeModule(id) 给出必需落盘输入 / 派生数据 / 元素 / API / 配置 / 事件 */
export { MODULE_IO, describeModule } from './workspace/module-io';
export type { ModuleIoSpec, ModuleDescription, OptionalInput } from './workspace/module-io';
export { buildWorkspaceTemplate, registerCssSegment, registerTemplateSlice } from './workspace/template';
/** 生命周期扩展点：让新模块声明的任意 lifecycle 值都能挂载 hooks */
export { registerLifecycle } from './elements/stock-workspace';
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

/**
 * 按需注册指定标签（未知标签忽略、已注册跳过，可重复调用）。
 * 服务端（无 customElements）自动 no-op 并返回空数组，SSR 工程可在通用代码里直接调用。
 * @param tags 需要注册的标签名，如 ['stock-chart', 'price-pane', 'indicator-pane']
 * @param registry 可注入自定义 registry 便于测试隔离
 * @returns 本次实际处于已注册状态的标签
 */
export function defineElements(tags: readonly string[], registry?: CustomElementRegistry): string[] {
  const r = registry ?? (typeof customElements === 'undefined' ? undefined : customElements);
  if (!r) return [];
  const map = ELEMENTS as Record<string, CustomElementConstructor>;
  const done: string[] = [];
  for (const tag of tags) {
    const ctor = map[tag];
    if (!ctor) continue;
    if (!r.get(tag)) r.define(tag, ctor);
    done.push(tag);
  }
  return done;
}

/** 注册全部内置标签；服务端自动 no-op。@param registry 可注入自定义 registry 便于测试隔离 */
export function defineAll(registry?: CustomElementRegistry): string[] {
  return defineElements(ELEMENT_TAGS, registry);
}
