/**
 * Vue 薄封装：不依赖 Vue 运行时。
 * - bindStockChart(el, options) 与 React 版共用同一套 setter/事件绑定，返回 cleanup。
 * - vStockChart 自定义指令：v-stock-chart="options"，mounted/updated 应用、unmounted 自动解绑。
 */
import { bindStockChart } from './react';
import type { StockChartBinding } from './react';

export { bindStockChart };

const CLEANUP = '__stockChartCleanup__';
type VueBinding = { value?: StockChartBinding; oldValue?: StockChartBinding };
interface CleanupHost extends EventTarget { __stockChartCleanup__?: (() => void) | undefined }

export const vStockChart = {
  mounted(el: EventTarget, binding: VueBinding) {
    (el as CleanupHost)[CLEANUP]?.();
    (el as CleanupHost)[CLEANUP] = bindStockChart(el, binding.value || {});
  },
  updated(el: EventTarget, binding: VueBinding) {
    // binding.value 是对象，引用变化即重新绑定（新旧值相同则跳过）
    if (binding.value === binding.oldValue) return;
    (el as CleanupHost)[CLEANUP]?.();
    (el as CleanupHost)[CLEANUP] = bindStockChart(el, binding.value || {});
  },
  unmounted(el: EventTarget) {
    (el as CleanupHost)[CLEANUP]?.();
    delete (el as CleanupHost)[CLEANUP];
  },
};

export default vStockChart;
