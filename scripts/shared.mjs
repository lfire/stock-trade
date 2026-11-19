/**
 * 数据生成脚本共用的纯工具（无副作用，可被测试直接 import）。
 * 之前 r2 / mulberry32 在 4 个脚本各写一份，现统一到单一真源。
 */
export const r2 = (n) => Math.round(n * 100) / 100;
export const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** 固定种子 PRNG：保证每次生成的 mock 完全一致；不同数据集用不同种子互不干扰 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
