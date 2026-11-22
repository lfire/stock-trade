/**
 * 全局 JSX / 标签声明。这是唯一保留的手写声明文件：
 * tsc 不会把 .d.ts 复制到 outDir，由 scripts/build.mjs 单独复制进 dist。
 * 其余对外类型全部由 tsc 从 .ts 源码自动生成，避免两套声明漂移。
 */
import type { StockChart } from './elements/stock-chart';
import type { PricePane } from './elements/price-pane';
import type { IndicatorPane } from './elements/indicator-pane';
import type { ChipPane } from './elements/chip-pane';
import type { AuctionPane } from './elements/auction-pane';
import type { TradeTape } from './elements/trade-tape';
import type { DepthBook } from './elements/depth-book';
import type { DetailCanvas } from './elements/detail-canvas';
import type { StockWorkspace } from './elements/stock-workspace';
import type { ChartDataset, ChipMode, CustomElementAttributes, StockChartJSXAttributes } from './types';
import type { WorkspaceConfig } from './workspace/types';

declare global {
  interface HTMLElementTagNameMap {
    'stock-chart': StockChart;
    'price-pane': PricePane;
    'indicator-pane': IndicatorPane;
    'chip-pane': ChipPane;
    'auction-pane': AuctionPane;
    'trade-tape': TradeTape;
    'depth-book': DepthBook;
    'detail-canvas': DetailCanvas;
    'stock-workspace': StockWorkspace;
  }
  /** 全局 JSX 标签声明：TSX / Preact / Solid 等可直接使用自定义元素 */
  namespace JSX {
    interface IntrinsicElements {
      'stock-chart': StockChartJSXAttributes;
      'price-pane': CustomElementAttributes & { height?: string | number };
      'indicator-pane': CustomElementAttributes & { indicator?: string; height?: string | number };
      'chip-pane': CustomElementAttributes & { mode?: ChipMode; width?: string | number; dock?: string };
      'auction-pane': CustomElementAttributes & { width?: string | number };
      'trade-tape': CustomElementAttributes & { 'page-size'?: string | number; order?: 'asc' | 'desc' };
      'depth-book': CustomElementAttributes & { width?: string | number; slot?: string };
      'detail-canvas': CustomElementAttributes & { 'data-set'?: 'trades' | 'orders' | 'panorama' };
      'stock-workspace': CustomElementAttributes & {
        data?: ChartDataset | null;
        config?: Partial<WorkspaceConfig>;
        onWorkspaceReady?: (ev: CustomEvent<{ config: WorkspaceConfig }>) => void;
        onDatasetReady?: (ev: CustomEvent<{ dataset: ChartDataset | null }>) => void;
        onWorkspaceConfigChange?: (ev: CustomEvent<{ config: WorkspaceConfig; patch: Partial<WorkspaceConfig> }>) => void;
        onChartError?: (ev: CustomEvent<{ message: string }>) => void;
        /** @deprecated 用 data 属性注入对象 */ dataset?: string;
      };
      /** 配置节点（非自定义元素类）：由 <stock-chart> 读取 period/color 初始化均线 */
      'ma-line': CustomElementAttributes & { period?: string | number; color?: string };
    }
  }
}

export {};
