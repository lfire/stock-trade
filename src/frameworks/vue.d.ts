import type { StockChartBinding } from './react.js';

export { bindStockChart } from './react.js';

/** Vue 自定义指令对象：v-stock-chart="options"，无需导入 Vue 运行时 */
export declare const vStockChart: {
  mounted(el: HTMLElement, binding: { value?: StockChartBinding; oldValue?: StockChartBinding }): void;
  updated(el: HTMLElement, binding: { value?: StockChartBinding; oldValue?: StockChartBinding }): void;
  unmounted(el: HTMLElement): void;
};
export default vStockChart;
