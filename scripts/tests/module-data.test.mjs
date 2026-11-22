/**
 * 模块化加载 · 数据按需派生阶段的行为回归。
 *
 * 覆盖：模块目录 / 预设、deriveDataset 按数据依赖闭包裁剪、
 * 默认全开与 preset:'full' 等价、裁剪后核心数值闭合仍成立、
 * loadDataset 只 fetch 启用模块需要的落盘分片、registerModule 扩展点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveDataset } from '../../dist/core/derive-dataset.js';
import { loadDataset } from '../../dist/core/data-store.js';
import {
  MODULE_CATALOG, MODULE_PRESETS, resolveModules, requiredDataFor, registerModule,
} from '../../dist/workspace/module-catalog.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (file) => JSON.parse(readFileSync(`${root}src/data/${file}`, 'utf8'));
const manifest = rd('manifest.json');
const rawBase = { manifest };
for (const [key, file] of Object.entries(manifest.files)) rawBase[key] = rd(file);

const OPTIONAL_KEYS = [
  'auction', 'trades', 'orders', 'depth', 'depthFull',
  'depthScenarios', 'chips', 'intradayMulti',
];

test('模块目录：12 个功能域模块 + 4 个内置预设', () => {
  assert.equal(Object.keys(MODULE_CATALOG).length, 12);
  assert.deepEqual(Object.keys(MODULE_PRESETS).sort(), ['candle', 'full', 'intraday', 'minimal']);
  assert.equal(MODULE_PRESETS.full.length, 12);
  assert.equal(resolveModules(undefined).length, 12);
  assert.ok(resolveModules({ preset: 'candle' }).includes('chip'));
  assert.ok(!resolveModules({ preset: 'candle' }).includes('auction'));
  assert.deepEqual(resolveModules({ modules: ['core', 'price-candle'] }), ['core', 'price-candle']);
});

test('数据依赖闭包：chips 需要 bars，depthScenarios 需要 depthFull/depth/orders', () => {
  assert.ok(requiredDataFor(['core', 'chip']).includes('chips'));
  assert.ok(requiredDataFor(['core', 'chip']).includes('bars'));
  const closure = requiredDataFor(['core', 'panorama']);
  for (const k of ['depthFull', 'depth', 'orders', 'intraday']) {
    assert.ok(closure.includes(k), `闭包缺少 ${k}`);
  }
});

test('默认全开（不传 options）与 preset:full 逐字段一致', () => {
  const a = deriveDataset(rawBase);
  const b = deriveDataset(rawBase, { preset: 'full' });
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const k of ['bars', 'intraday', 'chips', 'intradayMulti', 'auction', 'trades', 'orders', 'depth', 'depthFull', 'depthScenarios']) {
    assert.equal(JSON.stringify(a[k]), JSON.stringify(b[k]), `${k} 不一致`);
  }
  for (const k of OPTIONAL_KEYS) assert.notEqual(a[k], undefined, `全开时 ${k} 不应缺省`);
});

test('preset:candle 只派生 K 线相关数据集', () => {
  const d = deriveDataset(rawBase, { preset: 'candle' });
  assert.ok(Array.isArray(d.bars) && d.bars.length === 935);
  assert.ok(Array.isArray(d.intraday) && d.intraday.length === 267);
  assert.ok(d.chips, 'candle 含 chip 模块，应派生筹码峰');
  for (const k of ['auction', 'trades', 'orders', 'depth', 'depthFull', 'depthScenarios', 'intradayMulti']) {
    assert.equal(d[k], undefined, `${k} 不应派生`);
  }
});

test('preset:minimal 只保留 core + 分时主图所需数据', () => {
  const d = deriveDataset(rawBase, { preset: 'minimal' });
  assert.ok(d.bars.length === 935);
  assert.ok(d.intraday.length === 267);
  assert.ok(d.intradayMulti, '分时模块需要多日序列');
  for (const k of ['auction', 'trades', 'orders', 'depth', 'depthFull', 'depthScenarios', 'chips']) {
    assert.equal(d[k], undefined, `${k} 不应派生`);
  }
});

test('显式 modules 优先：core+price-candle 不派生 chips', () => {
  const d = deriveDataset(rawBase, { modules: ['core', 'price-candle'] });
  assert.equal(d.chips, undefined);
  assert.equal(d.intradayMulti, undefined);
  assert.ok(d.bars.length === 935);
});

test('裁剪模式下跨图核心闭合仍成立（分时累计额 == 当日日 K）', () => {
  for (const options of [{ preset: 'minimal' }, { preset: 'candle' }, { modules: ['core'] }]) {
    const d = deriveDataset(rawBase, options);
    const p15 = d.intraday.find((p) => p.time === '15:00');
    assert.ok(p15, '归一化分时缺失 15:00');
    assert.equal(p15.cumulativeAmount, d.bars.at(-1).amount, '15:00 累计额未锚定日 K');
    assert.equal(p15.cumulativeVolume, d.bars.at(-1).volume, '15:00 累计量未闭合');
  }
});

test('loadDataset 只 fetch 启用模块的数据依赖闭包覆盖的分片', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const file = String(url).split('/').pop();
    calls.push(file);
    return { ok: true, json: async () => rd(file) };
  };
  try {
    calls.length = 0;
    const full = await loadDataset('./src/data');
    assert.equal(calls.length, 1 + Object.keys(manifest.files).length, '全开应加载 manifest + 全部分片');
    assert.ok(full.chips && full.trades && full.depthFull);

    calls.length = 0;
    const minimal = await loadDataset('./src/data', { preset: 'minimal' });
    assert.deepEqual(calls, ['manifest.json', 'bars_1d.json', 'intraday_20261113.json']);
    assert.equal(minimal.trades, undefined);
    assert.equal(minimal.chips, undefined);
    assert.ok(minimal.intradayMulti);
  } finally {
    globalThis.fetch = original;
  }
});

test('registerModule 扩展点：新增模块即刻参与装载与数据派生', () => {
  const id = '__test_extra_module';
  registerModule({
    id, label: '测试扩展模块', requiresData: ['chips'], dependencies: ['core'],
    presets: [], templateKeys: [], cssKeys: [], lifecycle: null,
  });
  const enabled = resolveModules({ modules: [id] });
  assert.deepEqual(enabled, ['core', id]);
  const d = deriveDataset(rawBase, { modules: [id] });
  assert.ok(d.chips, '扩展模块声明 chips 后应派生筹码峰');
  assert.equal(d.trades, undefined, '未声明的逐笔数据不应派生');
});
