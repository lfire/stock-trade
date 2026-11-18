// 纯函数子入口可在 Node 中直接 import：这里做真实行为断言，而非字符串存在性检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, macd, kdj, rgba, rect } from '../../src/pure.js';
import { LAYOUT, PALETTE, withPalette } from '../../src/types.js';

const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('sma：窗口均值正确、长度不足时为 null', () => {
  const out = sma(series, 3);
  assert.equal(out.length, series.length);
  assert.equal(out[2], 2);
  assert.equal(out[9], 9);
  assert.equal(out[0], null);
});

test('ema：首值等于输入、后续单调', () => {
  const out = ema(series, 3);
  assert.equal(out[0], series[0]);
  for (let i = 2; i < out.length; i += 1) assert.ok(out[i] >= out[i - 1]);
});

test('macd / kdj 返回与输入等长的结构', () => {
  const bars = series.map((v, i) => ({ timestamp: i, close: v, high: v + 1, low: v - 1, volume: 100 + i }));
  const m = macd(bars);
  assert.equal(m.length, bars.length);
  assert.equal(typeof m[0].dif, 'number');
  assert.equal(typeof m[0].macd, 'number');
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

test('withPalette：帧内切换、帧后还原全局色板', () => {
  const before = PALETTE.background;
  let inside;
  withPalette({ background: '#010203' }, () => { inside = PALETTE.background; });
  assert.equal(inside, '#010203');
  assert.equal(PALETTE.background, before);
  assert.throws(() => withPalette({}, () => { throw new Error('boom'); }), /boom/);
  assert.equal(PALETTE.background, before); // 异常路径也必须还原
});
