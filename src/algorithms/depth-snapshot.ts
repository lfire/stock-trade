/**
 * 十档盘口快照（算法单元化收口）：逐字搬 scripts/build-sample-data.mjs 的
 * buildDepth(:507-525)，去掉 notes 副作用。复用 ./rounding 的 r2 与 ./random 的 mulberry32。
 *
 * 脚本返回 `[snap]`（单项数组，供 depth 数据集使用）；本运行时函数按契约
 * 返回数组中的那「一项」——即单个 DepthBookSnapshot 对象，类型已注明。
 */
import type { Bar, DepthBookSnapshot, DepthLevel } from '../types';
import { r2 } from './rounding';
import { mulberry32 } from './random';

export function buildDepthSnapshot(bars: Bar[], iso: string): DepthBookSnapshot {
  const rnd = mulberry32(20261113);
  const close = bars[bars.length - 1].close;
  const mk = (sign: number): DepthLevel[] => Array.from({ length: 10 }, (_, i) => ({
    price: r2(close + sign * (i + 1) * 0.01),
    volume: (Math.round(2 + rnd() * 40) * 100),
    orderCount: 1 + Math.floor(rnd() * 18),
  }));
  return {
    timestamp: Date.parse(`${iso}T15:00:00+08:00`),
    bids: mk(-1),
    asks: mk(1),
    phaseCode: 'E',
    source: 'mock',
    // 真实十档盘口属交易所 Level-2 增值行情，需持牌授权
    license: 'public-demo', requiresAuthorization: true,
  };
}
