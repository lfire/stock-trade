/**
 * 组件库注册入口。
 *
 * 各 elements 模块只导出 class，import 时不再产生 customElements.define 副作用；
 * 显式调用 defineAll() 才注册全局标签，便于按需引入、多版本共存与隔离测试。
 * 需要纯计算能力而不想触碰 DOM 时，请改用 './pure.js' 子入口。
 */
import { StockChart } from './elements/stock-chart.js';
import { PricePane } from './elements/price-pane.js';
import { IndicatorPane } from './elements/indicator-pane.js';
import { ChipPane } from './elements/chip-pane.js';
import { AuctionPane } from './elements/auction-pane.js';
import { TradeTape } from './elements/trade-tape.js';
import { DepthBook } from './elements/depth-book.js';

export {
  StockChart, PricePane, IndicatorPane, ChipPane, AuctionPane, TradeTape, DepthBook,
};
export { SUBPLOT_INDICATORS } from './elements/stock-chart.js';
export { PALETTE, THEMES, LAYOUT, resolveTheme, createPalette, applyPalette, resetPalette, withPalette } from './types.js';
export { bindStockChart } from './frameworks/react.js';
export { CHART_EVENTS, emitEvent } from './events.js';
export * from './pure.js';

const ELEMENTS = {
  'stock-chart': StockChart,
  'price-pane': PricePane,
  'indicator-pane': IndicatorPane,
  'chip-pane': ChipPane,
  'auction-pane': AuctionPane,
  'trade-tape': TradeTape,
  'depth-book': DepthBook,
};

export const ELEMENT_TAGS = Object.keys(ELEMENTS);

/** @param {CustomElementRegistry} [registry] 可注入自定义 registry 便于测试隔离 */
export function defineAll(registry) {
  const r = registry || customElements;
  for (const tag of ELEMENT_TAGS) {
    if (!r.get(tag)) r.define(tag, ELEMENTS[tag]);
  }
  return ELEMENT_TAGS.slice();
}
