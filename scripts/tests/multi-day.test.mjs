/**
 * 多日分时数据契约与跨日行为的数值回归（不依赖 DOM）。
 * 数据：src/data/intraday_5d.json（5 × 242 点，末日真实、前 4 日确定性拟真）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { intradayVolumeRatioSeries, elapsedMarketMinutes } from '../../dist/pure.js';
import { loadDerived } from './derived-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { manifest, derived } = loadDerived();
const single = derived.intraday;
const multi = derived.intradayMulti;

test('多日分时：5 个交易日 × 242 点，每点带 tradeDate、无盘后点', () => {
  assert.equal(multi.length, 5 * 242);
  const byDate = new Map();
  for (const p of multi) {
    assert.ok(p.tradeDate, '每个点必须有 tradeDate');
    assert.ok(p.time <= '15:00', '多日序列不应含盘后点');
    byDate.set(p.tradeDate, (byDate.get(p.tradeDate) || 0) + 1);
  }
  assert.equal(byDate.size, 5);
  for (const [d, n] of byDate) {
    assert.equal(n, 242, `${d} 应为 242 点`);
    assert.ok(manifest.tradeDates.includes(d), `${d} 不在 manifest.tradeDates`);
  }
  assert.deepEqual(manifest.tradeDates, [...byDate.keys()].sort());
  assert.equal(Object.keys(manifest.preCloseByDate).length, 5);
});

test('多日最后一日用真实单日分时（价格与均价闭合）', () => {
  const last = multi.filter((p) => p.tradeDate === manifest.tradeDate);
  const real = single.filter((p) => p.time <= '15:00');
  assert.equal(last.length, real.length);
  for (let i = 0; i < real.length; i += 1) {
    assert.equal(last[i].price, real[i].price);
    assert.equal(last[i].avgPrice, real[i].avgPrice);
    assert.equal(last[i].volume, real[i].volume);
  }
});

test('多日序列首日昨收为统一价格轴基准', () => {
  const first = manifest.tradeDates[0];
  assert.ok(manifest.preCloseByDate[first] > 0);
  assert.notEqual(manifest.preCloseByDate[first], manifest.preCloseByDate[manifest.tradeDate]);
});

test('多日 getSeries 过滤逻辑：逐点过滤盘后点，不能 findIndex 截断', () => {
  const arr = [...single, ...single];   // 模拟两天拼接且都含盘后点
  const naiveCut = arr.findIndex((p) => p.time > '15:00');
  assert.ok(naiveCut < single.length, 'findIndex 会截断在第一天盘后点');
  const filtered = arr.filter((p) => p.time <= '15:00');
  assert.equal(filtered.length, 242 * 2);
});

test('分时量比曲线：跨交易日累计量归零', () => {
  const prev5 = [100000, 100000, 100000, 100000, 100000];
  const avg5 = prev5.reduce((a, b) => a + b, 0) / 5;
  const day1 = [1000, 1000, 1000];
  const day2 = [1000, 1000, 1000];
  const pts = [
    ...day1.map((v, i) => ({ time: ['09:30', '10:00', '11:30'][i], tradeDate: '2026-11-12', volume: v })),
    ...day2.map((v, i) => ({ time: ['09:30', '10:00', '11:30'][i], tradeDate: '2026-11-13', volume: v })),
  ];
  const s = intradayVolumeRatioSeries(pts, avg5);
  const expected = (cum, t) => (cum / elapsedMarketMinutes(t)) / (avg5 / 240);
  assert.ok(Math.abs(s[0].value - expected(1000, '09:30')) < 1e-9);
  assert.ok(Math.abs(s[2].value - expected(3000, '11:30')) < 1e-9);
  // 第 4 点是新交易日 09:30，累计量必须从 1000 重新起算，而不是 4000
  assert.ok(Math.abs(s[3].value - expected(1000, '09:30')) < 1e-9);
  assert.ok(Math.abs(s[5].value - expected(3000, '11:30')) < 1e-9);
  assert.equal(s[3].tradeDate, '2026-11-13');
});
