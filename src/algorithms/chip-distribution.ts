/**
 * 筹码分布（算法单元化收口）：逐字搬 scripts/build-sample-data.mjs 的
 * summarize(:222-242) 与 buildChips(:244-296)，去掉脚本里的 notes 副作用与 CLI 参数，
 * 数值口径保持不变。复用 ./rounding 的 r2/r6 与 ./vwap 的 vwapOf（成交均价口径）。
 */
import type { Bar, ChipStat, ChipHistogram, ChipDataset } from '../types';
import { r2, r6 } from './rounding';
import { vwapOf } from './vwap';

/** 示例标的（脚本模块级常量 SYMBOL，运行时纯函数内联保留）。 */
const SYMBOL = '600519.SH';

/** 筹码峰单日 9 项统计（不含 date）；与 summarize(:222-242) 逐字一致。 */
export function summarizeChipStats(
  grid: number[], ratios: number[], close: number,
): Omit<ChipStat, 'date'> {
  const at = (q: number): number => {
    let cum = 0;
    for (let i = 0; i < grid.length; i += 1) { cum += ratios[i]; if (cum >= q) return grid[i]; }
    return grid[grid.length - 1];
  };
  const profitRatio = ratios.reduce((s, r, i) => s + (grid[i] <= close ? r : 0), 0);
  // 加权平均成本 = Σ(价格档 × 该档筹码占比) / Σ占比，与中位数 avgCost 是两个概念
  let wr = 0, wsum = 0;
  for (let i = 0; i < grid.length; i += 1) { wr += ratios[i]; wsum += ratios[i] * grid[i]; }
  const c90l = at(0.05), c90h = at(0.95), c70l = at(0.15), c70h = at(0.85);
  return {
    profitRatio: r6(profitRatio),
    avgCost: at(0.5),
    weightedAvgCost: wr > 0 ? r2(wsum / wr) : 0,
    cost90Low: c90l, cost90High: c90h,
    concentration90: r6((c90h - c90l) / (c90h + c90l)),
    cost70Low: c70l, cost70High: c70h,
    concentration70: r6((c70h - c70l) / (c70h + c70l)),
  };
}

/** buildChips 的可选参数；默认值与脚本 CLI 缺省一致。 */
export interface ChipDistributionOptions {
  bins?: number;
  lookback?: number;
  decay?: number;
  shape?: 'triangular' | 'uniform';
}

/** 基于真实日 K + 换手率的成本分布模型；逐字搬 buildChips(:244-296)。 */
export function buildChipDistribution(
  bars: Bar[], opts: ChipDistributionOptions = {},
): ChipDataset {
  const BINS = opts.bins ?? 150;
  const LOOKBACK = opts.lookback ?? 120;
  const DECAY = opts.decay ?? 1;                 // 历史换手衰减系数 n（通达信默认 1）
  const SHAPE = opts.shape ?? 'triangular';      // 'triangular' | 'uniform'（平均分布）
  const win = bars.slice(-LOOKBACK);
  const lo = Math.min(...win.map((b) => b.low)) * 0.98;
  const hi = Math.max(...win.map((b) => b.high)) * 1.02;
  const step = (hi - lo) / BINS;
  const priceGrid = Array.from({ length: BINS }, (_, i) => r2(lo + (i + 0.5) * step));
  const stock = new Float64Array(BINS);
  const stats: ChipStat[] = [], histograms: ChipHistogram[] = [];
  win.forEach((b) => {
    const turn = Math.min(Math.max((b.turnoverRate / 100) * DECAY, 0), 1);
    for (let i = 0; i < BINS; i += 1) stock[i] *= (1 - turn);   // 存量筹码按换手率×衰减系数折损
    // 三角分布峰值取当日成交均价（成交额/成交量，一字板回退四价均价）；vwapOf 同口径。
    // peak 的 [low, high] clamp 由调用方（此处）处理。
    const vwap = vwapOf(b.amount, b.volume, b);
    const peak = Math.max(b.low, Math.min(b.high, vwap));
    const w = new Float64Array(BINS);
    let sum = 0;
    for (let i = 0; i < BINS; i += 1) {
      const p = priceGrid[i];
      if (p < b.low || p > b.high) continue;
      let v = 0;
      if (SHAPE === 'uniform') v = 1;                                   // 平均分布：当日换手量在 high~low 均摊
      else if (b.high === b.low) v = Math.abs(p - b.high) < step ? 1 : 0;   // 一字板堆单档
      else if (p <= peak) v = (p - b.low) / (peak - b.low || step);
      else v = (b.high - p) / (b.high - peak || step);
      w[i] = Math.max(0, v); sum += w[i];
    }
    if (sum > 0) for (let i = 0; i < BINS; i += 1) stock[i] += (turn * w[i]) / sum;
    let total = 0; for (let i = 0; i < BINS; i += 1) total += stock[i];
    total = total || 1;
    const ratios = Array.from(stock, (val) => r6(val / total));
    stats.push({ date: b.tradeDate, ...summarizeChipStats(priceGrid, ratios, b.close) });
    // 全回看窗口每天都存一份直方图，供 K 线 hover 按历史交易日联动筹码峰
    histograms.push({ date: b.tradeDate, ratios });
  });
  return {
    symbol: SYMBOL, adjust: 'qfq', algorithm: `${SHAPE}-cost-distribution`,
    // 交易所不发布持仓成本；筹码分布是软件按历史成交/换手率反推的估算模型
    source: 'estimated-model', estimated: true,
    bins: BINS, lookback: LOOKBACK, priceGrid,
    peakSource: 'vwap', decay: DECAY, shape: SHAPE,
    concentrationBasis: 'panel (high-low)/(high+low), not SCR/2',
    dates: stats.map((s) => s.date), stats, histograms,
    current: stats[stats.length - 1],
    currentHistogram: histograms[histograms.length - 1],
  };
}
