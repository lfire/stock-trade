/**
 * 单模块出入参说明（纯数据 + 纯函数，无 DOM 依赖）。
 *
 * 数据输入不在这里重复声明：describeModule() 从 MODULE_CATALOG 的 requiresData / dependencies
 * 计算出「依赖闭包」「必需落盘输入」「运行时派生数据」，保证与实际装载逻辑同源。
 * 这里只补模块目录里没有的出入参信息：承载元素、公开 API、消费的配置键、派发的事件、可选输入。
 */
import { MODULE_CATALOG, requiredDataFor, resolveModules } from './module-catalog';
import type { DataKey } from './module-catalog';

/** 模块的可选数据输入（不强制派生；缺失时功能降级而非报错） */
export interface OptionalInput {
  key: string;
  desc: string;
}

export interface ModuleIoSpec {
  /** 一句话职责 */
  summary: string;
  /** 承载该模块的自定义元素 / DOM 区域 */
  elements: string[];
  /** 公开 API，格式「元素.方法」或根入口函数 */
  api: string[];
  /** 消费的 WorkspaceConfig 键（入参） */
  config: string[];
  /** 派发的事件（出参） */
  events: string[];
  /** 可选输入 */
  optional?: OptionalInput[];
  /** 产出（界面 / 数据） */
  outputs: string[];
}

/** 13 个内置模块的出入参（数据输入由 describeModule 计算） */
export const MODULE_IO: Readonly<Record<string, ModuleIoSpec>> = Object.freeze({
  core: {
    summary: '组件根与 WebGL 画布基座：接收 data / config，持有唯一 ChartContext',
    elements: ['stock-workspace', 'stock-chart', 'price-pane'],
    api: ['stock-workspace.data', 'stock-workspace.config', 'stock-chart.setDataset', 'stock-chart.setTheme', 'stock-chart.getState'],
    config: ['modules', 'preset', 'theme', 'mode'],
    events: ['workspace-ready', 'dataset-ready', 'data-validate', 'workspace-config-change', 'chart-error', 'layout-change', 'viewport-change', 'crosshair-change', 'theme-change'],
    outputs: ['画布与主图区域布局', '十字光标 / 视口状态'],
  },
  'price-intraday': {
    summary: '分时走势：价格线、均价线、昨收基准、1~5 日多日分时',
    elements: ['price-pane'],
    api: ['stock-chart.setMode', 'stock-chart.setIntradayDays', 'stock-chart.getIntradayDays'],
    config: ['mode', 'intradayDays'],
    events: ['intraday-days-change'],
    outputs: ['分时价格线 / 均价线（均价 = 累计额 ÷ 累计量）', '多日分时（intradayMulti 运行时派生）'],
  },
  'price-candle': {
    summary: 'K 线蜡烛：多周期聚合、均线、涨跌停 / 炸板四色',
    elements: ['price-pane'],
    api: ['stock-chart.setMode', 'stock-chart.setPeriod', 'stock-chart.setMovingAverages', 'stock-chart.addMovingAverage', 'stock-chart.updateMovingAverage', 'stock-chart.removeMovingAverage'],
    config: ['mode', 'period', 'movingAverages', 'maPanelOpen'],
    events: ['period-change', 'ma-config-change', 'historical-intraday-request'],
    outputs: ['日 / 周 / 月 / 季 / 年及分钟周期 K 线（由 bars / intraday 聚合）'],
  },
  auction: {
    summary: '开盘 / 收盘集合竞价段：虚拟价阶梯线、匹配量 / 未匹配量',
    elements: ['auction-pane'],
    api: ['stock-chart.setAuctionEnabled', 'stock-chart.setAuctionHover', 'stock-chart.setClosingHover'],
    config: ['auctionEnabled', 'auctionHover', 'closingHover'],
    events: ['auction-toggle', 'auction-hover', 'closing-hover'],
    outputs: ['竞价段（末点量额锚定首个分钟点、价格锚定开 / 收盘价）'],
  },
  indicator: {
    summary: '技术指标副图：VOL / AMOUNT / MACD / KDJ / 量比 / 成交对比，可注册扩展指标',
    elements: ['indicator-pane'],
    api: ['stock-chart.setSubplotCount', 'stock-chart.setSubplotIndicator', 'stock-chart.getSubplotConfig', 'stock-chart.setMACDParams', 'registerSubplotIndicator'],
    config: ['subplotCount', 'subplotIndicators', 'macd'],
    events: ['subplot-config-change', 'macd-params-change'],
    optional: [
      { key: 'intradayMulti', desc: '成交对比（VOLCMP）前一交易日曲线；随 price-intraday 模块派生，缺失时按 0 补齐' },
      { key: 'prevIntraday', desc: '注入通道：直接提供前一交易日分时点（历史分时视图由组件自动注入）' },
    ],
    outputs: ['副图指标序列与信息栏数值'],
  },
  chip: {
    summary: '筹码分布：成本分布直方 / 统计面板',
    elements: ['chip-pane'],
    api: ['stock-chart.setChipMode', 'stock-chart.setChipsEnabled'],
    config: ['chipMode', 'chipsEnabled'],
    events: ['chip-mode-change', 'chips-toggle'],
    outputs: ['筹码分布（chips 由日 K 与换手率运行时估算）'],
  },
  'depth-book': {
    summary: '五档 / 十档盘口：挂单量 / 金额切换、普通 / 涨停 / 跌停场景、买卖占比柱',
    elements: ['depth-book'],
    api: ['depth-book.setData', 'depth-book.setLevels', 'depth-book.setUnit', 'depth-book.setCompact', 'stock-chart.setDepthScenario', 'stock-chart.setDepthUnit'],
    config: ['depthScenario', 'depthUnit', 'depthLevels'],
    events: ['depth-scenario-change', 'depth-unit-change', 'depth-unit-request', 'depth-levels-change', 'view-panorama'],
    outputs: ['盘口档位（每档笔数由 orders 聚合）', '可视档位买卖占比'],
  },
  'trade-tape': {
    summary: '逐笔明细：侧栏列表、两级展开、按时间定位',
    elements: ['trade-tape'],
    api: ['trade-tape.setData', 'trade-tape.setViewConfig', 'trade-tape.setWindow', 'trade-tape.scrollToTime', 'stock-chart.setSideExpanded'],
    config: ['tapePlacement', 'tapeZoom', 'tapeSet', 'tapeScroll'],
    events: ['tape-scroll'],
    outputs: ['逐笔（trades 由分时按分钟量额锚定派生，09:25 竞价成交取首个分钟点）'],
  },
  'detail-cover': {
    summary: '详情覆盖层：多栏逐笔（列表 / 买卖单两种展示）、Level-2 全部挂单、Tab 切换',
    elements: ['detail-canvas'],
    api: ['detail-canvas.setDetailSet', 'detail-canvas.setWindow', 'stock-chart.setDetailData', 'stock-chart.attachCover', 'trade-tape.setViewConfig', 'buildOrderRuns'],
    config: ['tapePlacement', 'tapeZoom', 'tapeSet', 'tapeScroll', 'tradeView', 'bigOrderAmount'],
    events: ['detail-data-change'],
    outputs: ['多栏连续时间线逐笔', '买卖单视图：连续成交同一委托合并为跨行框（合计手数 + 金额，≥ bigOrderAmount 标「大」）', '委托流明细'],
  },
  panorama: {
    summary: '全景盘口：当前场景下全部有效买卖档位',
    elements: ['detail-canvas'],
    api: ['stock-chart.getScenarioPano'],
    config: ['tapeSet', 'depthScenario'],
    events: ['view-panorama'],
    outputs: ['全景委托簿（depthFull 由 orders 回放聚合，前十档与 depth 闭合）'],
  },
  header: {
    summary: '行情头：名称、最新价、涨跌、量额、换手、十字光标处明细',
    elements: ['stock-workspace（.chart-header 区域）'],
    api: [],
    config: ['crosshair'],
    events: ['head-change'],
    outputs: ['行情头数值（取自 manifest / bars / intraday）'],
  },
  toolbar: {
    summary: '控制栏：模式 / 周期 / 多日 / 主题 / 盘口场景 / 历史分时日期',
    elements: ['stock-workspace（.toolbar 区域）'],
    api: [],
    config: ['mode', 'period', 'intradayDays', 'theme', 'depthScenario', 'auctionEnabled', 'chipsEnabled', 'historicalIntradayDate'],
    events: ['workspace-config-change'],
    outputs: ['把用户操作写回 config（单向数据流）'],
  },
  'historical-intraday': {
    summary: '历史分时：日 K 选日后查看该日分时、竞价、逐笔与成交对比',
    elements: ['detail-canvas', 'stock-chart（独立实例）', 'trade-tape'],
    api: ['stock-chart.setHistoricalIntradayDate'],
    config: ['historicalIntradayDate', 'historicalAuctionEnabled', 'historicalTapeExpanded', 'tradeView', 'bigOrderAmount'],
    events: ['historical-intraday-request'],
    optional: [
      { key: 'historicalIntraday', desc: '注入通道：按 tradeDate 提供授权历史分时（可附 auction / trades；trades 可带 L2 买卖委托号 buyOrdId / sellOrdId，买卖单视图直接使用），注入即原样使用' },
    ],
    outputs: ['选中日分时 / 竞价 / 逐笔（historicalIntraday 运行时派生，只算选中日）'],
  },
});

const L0_KEYS: readonly DataKey[] = ['bars', 'intraday', 'auction', 'depth', 'orders'];

export interface ModuleDescription extends ModuleIoSpec {
  id: string;
  label: string;
  /** 启用该模块时实际装载的模块（依赖在前） */
  enabledModules: string[];
  /** 接入方必须提供的落盘输入（manifest 恒必填，不列出） */
  requiredInputs: DataKey[];
  /** 组件运行时派生的数据集（接入方无需提供） */
  derivedData: string[];
  /** 最小调用方式 */
  usage: string;
}

/** 单模块完整出入参说明；未知 id 返回 null */
export function describeModule(id: string): ModuleDescription | null {
  const def = MODULE_CATALOG[id];
  if (!def) return null;
  const enabledModules = resolveModules({ modules: [id] });
  const keys = requiredDataFor(enabledModules);
  const derived: string[] = keys.filter((k) => !L0_KEYS.includes(k));
  if (enabledModules.includes('historical-intraday')) derived.push('historicalIntraday');
  const io: ModuleIoSpec = MODULE_IO[id] ?? {
    summary: def.label, elements: [], api: [], config: [], events: [], outputs: [],
  };
  return {
    id,
    label: def.label,
    ...io,
    enabledModules,
    requiredInputs: keys.filter((k) => L0_KEYS.includes(k)),
    derivedData: derived,
    usage: `ws.config = { modules: ['${id}'] };  // 自动补齐 ${enabledModules.join(' / ')}\n`
      + `ws.data = await loadDataset(dir, { modules: ['${id}'] });  // 只取所需落盘输入`,
  };
}
