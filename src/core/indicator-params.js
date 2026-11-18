// 指标参数自适应：K 线周期越高、可用根数越少，长周期参数越需要收缩，
// 否则季 / 年 / 2 小时等周期下 MA5/MA20 与 MACD(12,26,9) 会全为 null 或因预热不足失真。

/**
 * MA 周期：数据充足时原样返回用户配置；不足时在 [2, count-1] 内生成
 * 与配置条数相同的递增周期，保证每条均线都能算出至少一个值。
 */
export function adaptiveMAPeriods(periods, count) {
  const orig = periods.map(Number).filter((p) => Number.isFinite(p) && p > 0);
  if (!orig.length) return [];
  if (count >= Math.max(...orig) + 5) return orig;
  const maxP = Math.max(2, count - 1);
  const n = orig.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    // 除以 n 而非 n-1：多条均线均匀落在 [2, maxP]，避免第二条总顶到最大周期只剩 1~2 个点
    out.push(Math.max(2, n === 1 ? maxP : 2 + Math.round(((maxP - 2) * i) / n)));
  }
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  }
  const valid = out.filter((p) => p <= count);
  return valid.length ? valid : [Math.min(2, Math.max(1, count))];
}

/** MACD 参数按可用根数分档；根数 ≥40 保持经典 (12,26,9) */
export function adaptiveMACDParams(count) {
  if (count >= 40) return { fast: 12, slow: 26, signal: 9 };
  if (count >= 20) return { fast: 6, slow: 13, signal: 5 };
  if (count >= 10) return { fast: 3, slow: 6, signal: 3 };
  if (count >= 5) return { fast: 2, slow: 4, signal: 2 };
  if (count >= 3) return { fast: 2, slow: 3, signal: 2 };
  // signal 至少 2，否则 DEA 恒等于 DIF、柱全为 0
  return { fast: 1, slow: 2, signal: 2 };
}

export const maParamsText = (periods) => periods.map((p) => `MA${p}`).join('/');
export const macdParamsText = (p) => `(${p.fast},${p.slow},${p.signal})`;
