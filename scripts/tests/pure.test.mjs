// 纯函数子入口可在 Node 中直接 import：这里做真实行为断言，而非字符串存在性检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, macd, kdj, rgba, rect, DEFAULT_MACD_PARAMS,
  resolveMACDParams, parseMACDParams } from '../../src/pure.js';
import { LAYOUT, PALETTE, withPalette } from '../../src/types.js';

const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('sma：窗口均值正确、长度不足时为 null', () => {
  const out = sma(series, 3);
  assert.equal(out.length, series.length);
  assert.equal(out[2], 2);
  assert.equal(out[9], 9);
  assert.equal(out[0], null);
});

test('ema：通达信口径 SMA 初始化 + 预热期 null', () => {
  const out = ema(series, 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 2);              // 前 3 个值的简单平均
  assert.ok(Math.abs(out[3] - (4 * (2 / 4) + 2 * (1 - 2 / 4))) < 1e-12);
  for (let i = 3; i < out.length; i += 1) assert.ok(out[i] >= out[i - 1]);
});

test('macd / kdj：预热段 null、有效段有值', () => {
  const bars = series.map((v, i) => ({ timestamp: i, close: v, high: v + 1, low: v - 1, volume: 100 + i }));
  const m = macd(bars);
  assert.equal(m.length, bars.length);
  assert.equal(m[0].dif, null);
  assert.equal(m[0].dea, null);
  assert.equal(m[0].macd, null);
  const k = kdj(bars);
  assert.equal(k.length, bars.length);
  assert.equal(typeof k[0].k, 'number');
});

test('几何：rgba 归一到 0..1，rect 产生 6 顶点 × 6 分量', () => {
  const c = rgba('#E24B4A');
  assert.equal(c.length, 4);
  assert.ok(c.every((v) => v >= 0 && v <= 1));
  const out = [];
  rect(out, 0, 0, 10, 10, c);
  assert.equal(out.length, 36);
});

test('LAYOUT 单一真源：4 条标题/表头行同高', () => {
  assert.equal(LAYOUT.barH, LAYOUT.headH);
  assert.equal(LAYOUT.barH, LAYOUT.titleH);
  assert.ok(LAYOUT.rowH > 0 && LAYOUT.splitH > 0);
});

test('MACD 参数：固定默认 (12,26,9)，不再随根数自适应', () => {
  assert.deepEqual({ ...DEFAULT_MACD_PARAMS }, { fast: 12, slow: 26, signal: 9 });
  // 参数与根数无关：不同 count 下 resolveMACDParams() 恒返回固定默认
  for (const count of [3, 5, 8, 20, 39, 40, 935]) {
    assert.deepEqual(resolveMACDParams({ ...DEFAULT_MACD_PARAMS }), { fast: 12, slow: 26, signal: 9 },
      `count=${count}`);
  }
});

test('MACD 参数：支持对象 / 字符串配置，非法输入回退默认', () => {
  assert.deepEqual(resolveMACDParams({ fast: 5, slow: 10, signal: 4 }), { fast: 5, slow: 10, signal: 4 });
  assert.deepEqual(resolveMACDParams({ fast: 8 }), { fast: 8, slow: 26, signal: 9 });
  assert.deepEqual(parseMACDParams('3,6,3'), { fast: 3, slow: 6, signal: 3 });
  assert.deepEqual(parseMACDParams('12 26 9'), { fast: 12, slow: 26, signal: 9 });
  assert.deepEqual(parseMACDParams({ slow: 35 }), { fast: 12, slow: 35, signal: 9 });
  // 非法：slow <= fast、小数、负数、格式错误 → 全部回退默认
  for (const bad of ['12,12,9', '26,12,9', '2.5,6,3', '-1,6,3', 'abc', '', null, { fast: 0 }]) {
    assert.deepEqual(parseMACDParams(bad), { fast: 12, slow: 26, signal: 9 }, `非法输入 ${JSON.stringify(bad)}`);
  }
});

test('withPalette：帧内切换、帧后还原全局色板', () => {
  const before = PALETTE.background;
  let inside;
  withPalette({ background: '#010203' }, () => { inside = PALETTE.background; });
  assert.equal(inside, '#010203');
  assert.equal(PALETTE.background, before);
  assert.throws(() => withPalette({}, () => { throw new Error('boom'); }), /boom/);
  assert.equal(PALETTE.background, before); // 异常路径也必须还原
});
