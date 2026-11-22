/**
 * 测试共用数据夹具：读取 5 个 L0 输入，经运行时派生层得到完整 dataset。
 * 4 个 L1 数据集（chips / intradayMulti / depthFull / depthScenarios）不再落盘，
 * 所有测试统一从这里取，避免各文件自己拼路径或直接读已删除的 JSON。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveDataset } from '../../dist/core/derive-dataset.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(`${root}src/data/${p}`, 'utf8'));

export function loadRaw() {
  const manifest = rd('manifest.json');
  const base = { manifest };
  for (const [key, file] of Object.entries(manifest.files)) base[key] = rd(file);
  return { manifest, base, root };
}

export function loadDerived() {
  const { manifest, base, root: r } = loadRaw();
  return { manifest, base, derived: deriveDataset(base), root: r };
}
