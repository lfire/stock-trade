// 统一数据契约（JSDoc）。与 docs/01 §6、docs/02 §6、docs/03 §4 保持一致。
// 这是组件对外的唯一数据契约；Rust/WASM 接入后内部存储可换成列式，但这些字段不变。

/**
 * 一根 K 线。价格单位元，volume 单位「股」，amount 单位「元」。
 * @typedef {Object} Bar
 * @property {number} timestamp UTC 毫秒，日线取交易日 00:00 UTC
 * @property {string} tradeDate YYYY-MM-DD，市场本地交易日
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} preClose 昨收（复权口径与价格一致）
 * @property {number} volume 股
 * @property {number} amount 元
 * @property {number} turnoverRate %
 * @property {number} [amplitude] %
 * @property {number} [pctChg] %
 * @property {number} [change] 元
 * @property {''|'limitUp'|'limitDown'|'limitUpBroken'|'limitDownBroken'} [limitState]
 *   涨停 / 跌停 / 涨停炸板（盘中触板未封住）/ 跌停炸板（盘中触板未封死）；空串为普通 K 线
 * @property {'injected-demo'} [source] 仅 4 根拟真注入的涨跌停形态带此标记，与真实 K 线可区分
 */

/**
 * 一个分时点。volume/amount 为该分钟增量；均价 = 累计额 / 累计量。
 * @typedef {Object} IntradayPoint
 * @property {number} timestamp UTC 毫秒
 * @property {string} time HH:mm，市场本地
 * @property {string} [tradeDate] 所属交易日 YYYY-MM-DD；多日分时按此分日，单日可省略
 * @property {'real-intraday'|'simulated-from-daily-ohlc'} [source] 来源标注；历史分钟分时无免费公开源时按日 K OHLC 拟真
 * @property {number} price 该分钟最后成交价
 * @property {number} avgPrice 累计均价
 * @property {number} volume 该分钟增量，股
 * @property {number} amount 该分钟增量，元
 * @property {number} cumulativeVolume 股
 * @property {number} cumulativeAmount 元
 * @property {'morning'|'afternoon'|'afterHours'} session
 */

/** @typedef {'B'|'S'|'N'} Side 归一方向：主动买 / 主动卖 / 未知或中性 */

/**
 * 逐笔明细 / 合并分笔。
 * @typedef {Object} TradeTick
 * @property {number} timestamp
 * @property {string} time HH:mm:ss
 * @property {number} seq
 * @property {number} price
 * @property {number} volume 股
 * @property {number} amount 元
 * @property {Side} side
 * @property {string} rawSide 原始编码（B/S/M、1/2、4/F ...）
 * @property {string} sideSource
 * @property {'tick'|'merged3s'} granularity
 * @property {'authorized'|'public-demo'} license
 * @property {'auction'|'continuous'|'afterHours'} phase
 * @property {number} tradeCount 该条包含的成交笔数
 */

/**
 * 集合竞价点。竞价期间「价有量无」，仅 9:25 统一撮合产生成交量。
 * 竞价撮合节点，按同花顺等终端竞价图口径每 9 秒 1 个节点。一个文件同时含两段：
 *   phase='open'  开盘集合竞价 9:15:00–9:25:00 共 69 点（9:19:57→9:20:00、9:24:57→9:25:00 各 3 秒）
 *   phase='close' 收盘集合竞价 14:57:00–15:00:00 共 21 点（沪市 2018-08-20 起，可申报不可撤单）
 * @typedef {Object} AuctionPoint
 * @property {number} timestamp UTC 毫秒，精确到秒
 * @property {string} time HH:mm:ss（9 秒节点）
 * @property {'open'|'close'} phase 开盘 / 收盘集合竞价
 * @property {number} virtualPrice 虚拟撮合价
 * @property {number} matchedQty 虚拟匹配量
 * @property {number} unmatchedQty 虚拟未匹配量
 * @property {0|1|2} unmatchedSide 0 无 / 1 买方 / 2 卖方
 * @property {number} volume 股
 * @property {number} amount 元
 * @property {'illustrative'|'anchored-real'} [source] 9:15–9:24 虚拟撮合量绝大多数平台不留存历史，
 *   属示意数据；仅 9:25 / 15:00 末点锚定真实成交
 * @property {string} [priceBasis] 撮合口径，如 SSE-3.5.2-max-volume
 */

/**
 * 筹码峰：9 项统计指标（单日）。
 * @typedef {Object} ChipStat
 * @property {string} date
 * @property {number} profitRatio 0~1
 * @property {number} avgCost 成本分布中位数（50% 分位，面板称「居中成本」）
 * @property {number} weightedAvgCost 加权平均成本 = Σ(价格档 × 筹码占比) / Σ占比
 * @property {number} cost90Low
 * @property {number} cost90High
 * @property {number} concentration90
 * @property {number} cost70Low
 * @property {number} cost70High
 * @property {number} concentration70
 */

/**
 * 筹码峰完整数据集：统计与 150 档直方图共用一份 priceGrid，切换模式不重新请求。
 * 交易所不发布持仓成本，本数据集是软件按历史成交/换手率反推的**估算模型**，非真实持仓账本。
 * @typedef {Object} ChipDataset
 * @property {string} symbol
 * @property {'none'|'qfq'|'hfq'} adjust
 * @property {string} algorithm
 * @property {string} [source] estimated-model
 * @property {boolean} [estimated] 恒为 true
 * @property {'triangular'|'uniform'} [shape] 日内分布形状
 * @property {'vwap'|'four-price-average'} [peakSource] 三角分布峰值来源
 * @property {number} [decay] 历史换手衰减系数
 * @property {string} [concentrationBasis] 集中度口径（面板口径 / SCR 再除 2）
 * @property {number} bins
 * @property {number} lookback
 * @property {number[]} priceGrid 150 档价格
 * @property {string[]} dates
 * @property {ChipStat[]} stats
 * @property {{date: string, ratios: number[]}[]} histograms
 * @property {ChipStat} current
 * @property {{date: string, ratios: number[]}} currentHistogram
 */

/**
 * 十档快照。
 * @typedef {Object} DepthSnapshot
 * @property {number} timestamp
 * @property {{price:number,volume:number,orderCount:number}[]} bids
 * @property {{price:number,volume:number,orderCount:number}[]} asks
 * @property {string} phaseCode
 */

/**
 * 数据集清单。
 * @typedef {Object} DatasetManifest
 * @property {string} symbol
 * @property {string} name
 * @property {string} market
 * @property {string} timezone
 * @property {string} currency
 * @property {'none'|'qfq'|'hfq'} adjust
 * @property {string} interval
 * @property {string} tradeDate
 * @property {string[]} [tradeDates] 多日分时交易日列表
 * @property {Record<string,number>} [preCloseByDate] 各交易日昨收
 * @property {number} [limitRate] 按代码/名称识别的涨跌幅比例
 * @property {number} preClose
 * @property {number} floatShares
 * @property {string} [source] 数据集整体来源说明
 * @property {Record<string,{availability:string,source:string,licensed:boolean}>} [provenance]
 *   逐数据集可获得性与 Level-2 授权边界摘要
 * @property {{open:string,close:string}[]} session
 * @property {Record<string,string>} files
 * @property {Record<string,string>} units
 */

/**
 * 副图输出契约：新增副图不需要改主图数据链路。
 * @typedef {Object} PaneSeries
 * @property {string} paneId
 * @property {string} name
 * @property {'bar'|'line'|'histogram'|'horizontalBar'} type
 * @property {{time:number, value:number|number[]}[]} series
 */

/** 计算引擎接口：JsComputeEngine 为当前实现，WasmComputeEngine 为后续替换点。 */
export class ComputeEngineInterface {
  // eslint-disable-next-line no-unused-vars
  indicator(name, bars, params) { throw new Error('not implemented'); }
}

/** 左右坐标轴专用留白宽度：数据只画在中间绘图区，刻度放在留白里，不遮挡图表内容 */
export const AXIS_GUTTER_L = 54;
export const AXIS_GUTTER_R = 54;

/**
 * 右侧栏统一行高真源（px）：盘口 5/10 档 / compact 态、交易明细虚拟滚动、
 * 多组逐笔覆盖视图、两张列头与两条标题行全部引用这里，避免各处行高漂移。
 */
export const LAYOUT = Object.freeze({
  rowH: 18,     // 数据行
  barH: 24,     // 4 条标题/表头行的统一基准高度（原 28+20 两组各均分为 24+24，总高不变）
  headH: 24,    // 列头行别名
  titleH: 24,   // 标题行别名
  splitH: 5,    // 买卖分界细线含上下 margin（均分后除不尽的余数补到这里）
});

const DEFAULT_PALETTE = Object.freeze({
  background: '#FFFFFF',
  panel: '#F7F8FA',
  band: '#F2F3F5',    // 竞价列 / 时间轴带等辅助区底色，比 panel 略深以区分绘图区
  grid: '#ECEEF1',
  text: '#1F2329',
  textMuted: '#6B7280',
  up: '#E24B4A',      // 红涨（A 股习惯）
  down: '#1D9E75',    // 绿跌
  limitUp: '#C62828',        // 涨停：深红（与普通阳线区分）
  limitDown: '#087A55',      // 跌停：深绿（与普通阴线区分）
  limitUpBroken: '#F08C24',  // 涨停炸板：橙（触板未封住）
  limitDownBroken: '#7C5CDB',// 跌停炸板：紫（触板未封死）
  avg: '#F0A020',
  crosshair: '#8A94A6',
  chipProfit: '#F5A623',
  chipLoss: '#4A90D9',
  neutral: '#9AA3AF',
  link: '#1B5FBF',    // 次级交互入口（全景盘口等）文字色
});

/**
 * 当前色板。刻意保持**同一个对象引用**：渲染层全部以 `PALETTE.xxx` 读取，
 * applyPalette() 就地覆盖属性即可全局换肤，无需改动 87 处引用。
 * 代价是单例色板由同页所有 <stock-chart> 共享（与 docs/03 的「浅色单一基线」一致）。
 */
export const PALETTE = { ...DEFAULT_PALETTE };

/** 内置主题预设；dark 只覆盖需要变化的键 */
export const THEMES = Object.freeze({
  light: DEFAULT_PALETTE,
  dark: Object.freeze({
    ...DEFAULT_PALETTE,
    background: '#14181E', panel: '#1C222B', band: '#191F27', grid: '#2A323D',
    text: '#E6EAF0', textMuted: '#95A0B0',
    up: '#F26A66', down: '#35BE93',
    limitUp: '#FF6B6B', limitDown: '#1FAE7C',
    limitUpBroken: '#F5A94A', limitDownBroken: '#9C86EC',
    crosshair: '#7C8798', neutral: '#8A94A3', link: '#7FB0FF',
  }),
});

/** @param {'light'|'dark'|string|Record<string,string>} theme */
export function resolveTheme(theme) {
  if (!theme) return DEFAULT_PALETTE;
  if (typeof theme === 'string') return THEMES[theme] || DEFAULT_PALETTE;
  if (typeof theme === 'object') return { ...DEFAULT_PALETTE, ...theme };
  return DEFAULT_PALETTE;
}

/**
 * 纯函数：由主题补丁生成一份**新**色板，不改动全局 PALETTE。
 * 新代码应优先用它 + 实例色板；applyPalette / resetPalette 仅为帧级 withPalette 服务。
 */
export function createPalette(patch = {}, base = DEFAULT_PALETTE) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    if (k in DEFAULT_PALETTE && typeof patch[k] === 'string') out[k] = patch[k];
  }
  return out;
}

/** @deprecated 会就地改动全局 PALETTE；新代码请用 createPalette() 或 <stock-chart> 的实例色板 */
export function applyPalette(patch = {}) {
  for (const k of Object.keys(patch)) {
    if (k in DEFAULT_PALETTE && typeof patch[k] === 'string') PALETTE[k] = patch[k];
  }
  return { ...PALETTE };
}

/** @deprecated 见 applyPalette；仅用于恢复全局色板 */
export function resetPalette() { return applyPalette(DEFAULT_PALETTE); }

/**
 * 在一帧同步渲染内把全局色板临时切到某个实例的色板，结束后还原。
 * 渲染层 110 处 `PALETTE.xxx` 是模块级读取、无法逐一传 ctx；用「帧级作用域」
 * 让每个 <stock-chart> 用自己独立的 palette 绘制，且互不污染全局状态。
 */
export function withPalette(palette, fn) {
  const saved = { ...PALETTE };
  applyPalette(palette || {});
  try { return fn(); } finally { applyPalette(saved); }
}
