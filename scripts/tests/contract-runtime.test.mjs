/**
 * 运行时契约回归：验证「数据可获得性标注 / 常量单一真源 / 参数防御 / 只读返回值」，
 * 补足 verify.mjs 与 contract.test.mjs 只做源码字符串断言的盲区。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  rgba, sma, kdj, volumeRatio, computeIndicator,
  PRICE_TICK, PRICE_EPS, LOT_SIZE, DAY_MINUTES, SESSION_MINUTES, HALF_HOUR_MARKS,
} from '../../dist/pure.js';
import { limitPrices, limitRateFor, PRICE_EPS as RULE_EPS } from '../limit-rules.mjs';
import { loadDerived } from './derived-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(`${root}src/data/${p}`, 'utf8'));
const manifest = rd('manifest.json');

test('A 股业务常量单一真源：组件与生成脚本共用同一份值', () => {
  assert.equal(PRICE_TICK, 0.01);
  assert.equal(PRICE_EPS, 0.001);
  assert.equal(RULE_EPS, PRICE_EPS, 'limit-rules 与 market-constants 不得各写一份容差');
  assert.equal(LOT_SIZE, 100);
  assert.equal(DAY_MINUTES, 240);
  assert.equal(SESSION_MINUTES, 120);
  assert.equal(HALF_HOUR_MARKS.length, 9);
  assert.equal(HALF_HOUR_MARKS[0], '09:30');
  assert.equal(HALF_HOUR_MARKS.at(-1), '14:30');
  assert.ok(Object.isFrozen(HALF_HOUR_MARKS));
});

test('涨跌停价按板块比例，委托流与校验不再硬编码 0.9/1.1', () => {
  assert.deepEqual(limitPrices(100, 0.10), { up: 110, down: 90 });
  assert.deepEqual(limitPrices(100, 0.20), { up: 120, down: 80 });
  assert.equal(limitRateFor('600519.SH', '贵州茅台'), 0.10);
  assert.equal(limitRateFor('300001.SZ', '示例'), 0.20);
  assert.equal(manifest.limitRate, 0.10);
  const orders = rd(manifest.files.orders);
  const { up, down } = limitPrices(manifest.preClose, manifest.limitRate);
  assert.ok(orders.every((o) => o.price >= down - 1e-6 && o.price <= up + 1e-6));
});

test('rgba 返回只读元组，非法色值兜底且不污染缓存', () => {
  const c = rgba('#E24B4A', 0.85);
  assert.ok(Object.isFrozen(c), '共享缓存值必须冻结，避免外部修改导致全局串色');
  assert.equal(c.length, 4);
  assert.ok(Math.abs(c[0] - 226 / 255) < 1e-9);
  assert.throws(() => { c[0] = 0; }, TypeError);
  assert.deepEqual([...rgba('bad-color', 1)], [0, 0, 0, 1]);
  assert.deepEqual([...rgba('#E24B4A', 0.85)], [...c], '非法色值不应污染正常缓存');
});

test('纯函数参数防御：n<=0 / NaN / 小数不产生全 NaN 结果', () => {
  const bars = Array.from({ length: 12 }, (_, i) => ({
    timestamp: i, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 100 + i,
  }));
  for (const bad of [0, -1, NaN, 2.5]) {
    assert.ok(sma([1, 2, 3], bad).every((v) => v === null), `sma n=${bad}`);
  }
  for (const bad of [0, -1, NaN]) {
    const k = kdj(bars, bad);
    assert.equal(k.length, bars.length);
    assert.ok(k.every((v) => Number.isFinite(v.k) && Number.isFinite(v.d) && Number.isFinite(v.j)),
      `kdj n=${bad}`);
    const v = volumeRatio(bars, bad);
    assert.equal(v.length, bars.length);
    assert.ok(v.every((x) => Number.isFinite(x.value)), `volumeRatio n=${bad}`);
  }
  assert.equal(computeIndicator('MA', bars, { n: 5 }).values[4].value, 12.5);
});

test('数据可获得性：manifest.provenance 覆盖全部 5 个 L0 输入并标注授权边界', () => {
  const keys = Object.keys(manifest.files);
  assert.equal(keys.length, 5);
  assert.ok(!('trades' in manifest.files), '逐笔已不落盘，不应登记为 L0 输入');
  assert.ok(manifest.provenance, 'manifest 缺少 provenance 摘要');
  for (const k of keys) {
    const p = manifest.provenance[k];
    assert.ok(p, `provenance 缺少 ${k}`);
    assert.ok(p.availability && p.source && typeof p.licensed === 'boolean', `${k} 字段不全`);
  }
  // Level-2 数据集必须标为需授权（仅 depth / orders）
  for (const k of ['depth', 'orders']) {
    assert.equal(manifest.provenance[k].availability, 'level2-licensed', k);
    assert.equal(manifest.provenance[k].licensed, true, k);
  }
  assert.equal(Object.values(manifest.provenance)
    .filter((p) => p.availability === 'level2-licensed').length, 2);
  assert.equal(manifest.provenance.auction.availability, 'l1-intraday-only');
  assert.ok(!manifest.files.chips && !manifest.files.intradayMulti
    && !manifest.files.depthFull && !manifest.files.depthScenarios,
  '运行时派生数据集仍被登记为落盘输入');
  // manifest 精简字段：units 5 组 / demoPatterns 4 项 / generatedAt 有效，旧字段不再落盘
  assert.equal(Object.keys(manifest.units).length, 5);
  assert.equal(manifest.units.bars.turnoverRate, 'percent');
  assert.equal(manifest.units.auction.matchedQty, 'lot');
  assert.equal(manifest.units.depth.volume, 'share');
  assert.equal(manifest.demoPatterns.length, 4);
  assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)));
  for (const k of ['market', 'timezone', 'currency', 'interval', 'source', 'afterHours',
    'l2', 'floatSharesSource', 'palette', 'upColor', 'downColor']) {
    assert.ok(!(k in manifest), `manifest 仍残留已删除字段 ${k}`);
  }
});

test('数据体来源标注：竞价示意点、多日拟真点、派生逐笔与盘口齐备', () => {
  const { derived } = loadDerived();
  // 落盘字段已精简，来源 / 授权 / 末点量额等一律对运行时派生层断言
  const auction = derived.auction;
  assert.equal(auction.length, 90);
  const openA = auction.filter((p) => p.phase === 'open');
  const closeA = auction.filter((p) => p.phase === 'close');
  assert.equal(openA.filter((p) => p.source === 'illustrative').length, 68);
  assert.equal(openA.at(-1).source, 'anchored-real');
  assert.equal(closeA.at(-1).source, 'anchored-real');
  assert.ok(auction.every((p) => p.priceBasis === 'SSE-3.5.2-max-volume'));

  const multi = derived.intradayMulti;
  const byDate = new Set(multi.map((p) => p.tradeDate));
  assert.equal(byDate.size, 5);
  const first = [...byDate][0];
  assert.ok(multi.filter((p) => p.tradeDate === first).every((p) => p.source === 'simulated-from-daily-ohlc'));
  assert.ok(multi.filter((p) => p.tradeDate === manifest.tradeDate).every((p) => p.source === 'real-intraday'));

  // 逐笔 / 盘口 / 委托由 deriveDataset() 在运行时补齐，落盘不再有这些字段
  assert.equal(derived.trades.length, 476);
  assert.ok(derived.trades.every((t) => t.license === 'public-demo' && t.requiresAuthorization === true
    && t.granularity && t.sideSource && t.rawSide !== undefined));
  assert.equal(derived.depth.source, 'mock');
  assert.equal(derived.depth.requiresAuthorization, true);
  assert.ok([...derived.depth.bids, ...derived.depth.asks].every((d) => d.orderCount > 0));
  assert.ok(derived.orders.every((o) => o.level && o.phase && o.tag !== undefined));
  const chips = derived.chips;
  assert.equal(chips.source, 'estimated-model');
  assert.equal(chips.estimated, true);
  assert.equal(chips.peakSource, 'vwap');

  // 四态改由 manifest.demoPatterns 驱动，derived.bars 在对应 tradeDate 内存叠加 limitState
  const states = ['limitUp', 'limitDown', 'limitUpBroken', 'limitDownBroken'];
  assert.equal(manifest.demoPatterns.length, 4);
  assert.ok(states.every((s) => manifest.demoPatterns.filter((p) => p.state === s).length === 1));
  for (const p of manifest.demoPatterns) {
    const bar = derived.bars.find((b) => b.tradeDate === p.tradeDate);
    assert.ok(bar && bar.limitState === p.state, `${p.tradeDate} 未叠加 ${p.state}`);
  }
  assert.equal(derived.bars.filter((b) => b.limitState).length, 4);
});

test('SOURCES.md 覆盖派生的 Level-2 数据集', () => {
  const text = readFileSync(`${root}src/data/SOURCES.md`, 'utf8');
  assert.ok(text.includes('派生数据集与 Level-2 授权边界'));
  assert.ok(text.includes('mulberry32(2026111302)'));
  assert.ok(text.includes('不得自行复制、转发或开发衍生品'));
});
