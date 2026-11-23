/**
 * 模块子路径枚举入口（纯数据，零依赖、SSR 安全）。
 *
 * 列出 13 个功能域模块的 id 与静态可寻址子路径，便于消费者枚举；
 * 具体门面在同目录各 id 文件里，单独按子路径加载即可，本文件不聚合实现闭包。
 */

/** 13 个内置模块 id（顺序与 MODULE_CATALOG 一致）。 */
export const MODULE_IDS: readonly string[] = Object.freeze([
  'core', 'price-intraday', 'price-candle', 'auction', 'indicator', 'chip',
  'depth-book', 'trade-tape', 'detail-cover', 'panorama', 'header', 'toolbar',
  'historical-intraday',
]);

/** id 到包名子路径的映射（不含扩展名；types 条件由 ./modules/* 通配提供）。 */
export const MODULE_PATHS: Readonly<Record<string, string>> = Object.freeze({
  core: 'stock-chart/modules/core',
  'price-intraday': 'stock-chart/modules/price-intraday',
  'price-candle': 'stock-chart/modules/price-candle',
  auction: 'stock-chart/modules/auction',
  indicator: 'stock-chart/modules/indicator',
  chip: 'stock-chart/modules/chip',
  'depth-book': 'stock-chart/modules/depth-book',
  'trade-tape': 'stock-chart/modules/trade-tape',
  'detail-cover': 'stock-chart/modules/detail-cover',
  panorama: 'stock-chart/modules/panorama',
  header: 'stock-chart/modules/header',
  toolbar: 'stock-chart/modules/toolbar',
  'historical-intraday': 'stock-chart/modules/historical-intraday',
});
