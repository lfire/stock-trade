/**
 * 量比（算法单元化收口）：日线 / 分时量比统一从 src/compute/indicators re-export，
 * 保证单一实现；avgDailyVolume 为供分时量比使用的「前 N 日平均日成交量」helper。
 */
import type { Bar } from '../types';
export {
  volumeRatio,
  intradayVolumeRatio,
  intradayVolumeRatioSeries,
} from '../compute/indicators';

/** 前 N 个交易日平均日成交量（股 / 日），作为分时量比的基准分母。 */
export function avgDailyVolume(bars: Bar[], n = 5): number {
  const p = Number.isFinite(n) && n >= 1 ? Math.round(n) : 5;
  const win = (bars || []).slice(-p);
  if (!win.length) return 0;
  return win.reduce((sum, b) => sum + b.volume, 0) / win.length;
}
