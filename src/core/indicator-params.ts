// 指标参数自适应：K 线周期越高、可用根数越少，长周期参数越需要收缩，
// 否则季 / 年 / 2 小时等周期下 MA5/MA20 与 MACD(12,26,9) 会全为 null 或因预热不足失真。

/**
 * MA 周期：数据充足时原样返回用户配置；不足时在 [2, count-1] 内生成
 * 与配置条数相同的递增周期，保证每条均线都能算出至少一个值。
 */
export function adaptiveMAPeriods(periods: Array<number | string>, count: number) {
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

/** MACD 固定默认参数：通达信 / 同花顺 (12,26,9)。不再随 K 线根数自动收缩。 */
export const DEFAULT_MACD_PARAMS = Object.freeze({ fast: 12, slow: 26, signal: 9 });

/** 合并并校验 MACD 配置：均为正整数、slow > fast；非法输入回退默认值（不抛错） */
export function resolveMACDParams(config: { fast?: number; slow?: number; signal?: number } = {}) {
  const merged = { ...DEFAULT_MACD_PARAMS, ...(config || {}) };
  const { fast, slow, signal } = merged;
  const valid = [fast, slow, signal].every((v) => Number.isInteger(v) && v >= 1)
    && slow > fast && signal >= 1;
  return valid ? { fast, slow, signal } : { ...DEFAULT_MACD_PARAMS };
}

/** 解析 '12,26,9' / '12 26 9' 或 {fast,slow,signal}；非法输入回退默认 */
export function parseMACDParams(input: string | { fast?: number; slow?: number; signal?: number } | null | undefined) {
  if (input && typeof input === 'object') return resolveMACDParams(input);
  if (typeof input !== 'string') return resolveMACDParams();
  const nums = input.split(/[\s,;]+/).filter(Boolean).map(Number);
  return nums.length === 3
    ? resolveMACDParams({ fast: nums[0], slow: nums[1], signal: nums[2] })
    : resolveMACDParams();
}

// 已移除 adaptiveMACDParams（MACD 固定默认 12,26,9，不再随根数自适应）；
// 需要部分配置请用 resolveMACDParams({ ...DEFAULT_MACD_PARAMS, ...patch })。

export const maParamsText = (periods: Array<number | string>) => periods.map((p) => `MA${p}`).join('/');
export const macdParamsText = (p: { fast: number; slow: number; signal: number }) => `(${p.fast},${p.slow},${p.signal})`;
