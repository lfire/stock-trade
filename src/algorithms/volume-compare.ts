/**
 * 成交对比副图（算法层纯函数）：市面常用口径 —— 当天与前一交易日的
 * 「累计成交量」曲线（从开盘到当前分钟的成交量累加），不是每分钟增量柱。
 * 不修改入参、不依赖 DOM / 组件状态；数据缺失时按 0 补齐，保证曲线等长。
 */
import type { IntradayPoint } from '../types';

export interface VolumeComparePoint {
  time: string;   // HH:MM（分时分钟槽）
  value: number;  // 当天从开盘到该分钟的累计成交量
  prev: number;   // 前一天从开盘到同一分钟的累计成交量
}

/** 从多日分时序列中取 currentDate 之前最后一个交易日的点（无则空数组） */
export function pickPreviousDay(
  multi: readonly IntradayPoint[], currentDate: string,
): IntradayPoint[] {
  const dates = Array.from(new Set(
    multi.map((p) => p.tradeDate).filter((d): d is string => !!d),
  )).sort();
  const i = dates.indexOf(currentDate);
  const prev = i > 0 ? dates[i - 1] : '';
  return prev ? multi.filter((p) => p.tradeDate === prev) : [];
}

/**
 * 按 HH:MM 分钟槽对齐，产出两条「累计成交量」曲线：
 * - 当天：按分时序列原顺序前缀和（保持与当前主图 x 轴点数一致）；
 * - 前一天：先按分钟槽聚合再前缀和，用二分定位「不晚于该分钟」的累计值；
 *   当天独有的分钟槽（如竞价段）沿用前一交易日已累计到的量，不回退、不置 0。
 */
export function buildVolumeCompare(
  current: readonly IntradayPoint[], previous: readonly IntradayPoint[],
): VolumeComparePoint[] {
  const prevByTime = new Map<string, number>();
  for (const p of previous) {
    const t = p.time.slice(0, 5);
    prevByTime.set(t, (prevByTime.get(t) ?? 0) + p.volume);
  }
  const slots = Array.from(prevByTime.keys()).sort();
  const prevCum: number[] = [];
  let prevAcc = 0;
  for (const t of slots) { prevAcc += prevByTime.get(t)!; prevCum.push(prevAcc); }
  // 二分找到最后一个 <= t 的分钟槽，取其累计量
  const cumAt = (t: string): number => {
    let lo = 0, hi = slots.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (slots[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found < 0 ? 0 : prevCum[found];
  };
  let curAcc = 0;
  return current.map((p) => {
    curAcc += p.volume;
    const t = p.time.slice(0, 5);
    return { time: t, value: curAcc, prev: cumAt(t) };
  });
}

/** 成交对比的数据输入口径（组件层共用，避免两处各写一遍）：
 * 历史分时 mini 注入的 prevIntraday 优先；否则从 intradayMulti 取上一交易日。
 * 都是运行时注入 / 派生数据，不进全量 deriveDataset；缺失返回空数组由算法按 0 补齐。 */
export interface VolumeCompareInput {
  readonly prevIntraday?: readonly IntradayPoint[];
  readonly intradayMulti?: readonly IntradayPoint[];
  readonly manifest: { tradeDate: string };
}

export function volumeComparePrevious(input: VolumeCompareInput): IntradayPoint[] {
  const injected = Array.isArray(input.prevIntraday) ? input.prevIntraday : [];
  if (injected.length) return injected as IntradayPoint[];
  return Array.isArray(input.intradayMulti)
    ? pickPreviousDay(input.intradayMulti, input.manifest.tradeDate) : [];
}
