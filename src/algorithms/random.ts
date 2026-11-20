/**
 * 固定种子 PRNG（算法单元化收口），公式逐字来自 scripts/shared.mjs:13-22。
 * 保证每次生成的 mock 完全一致；不同数据集用不同种子互不干扰。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
