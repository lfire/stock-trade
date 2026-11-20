/**
 * P0 架构收口回归：外部不再能直接改 ChartContext 状态，getContext() 只给只读门面。
 * ChartContext 构造需要 WebGL2/DOM，故用原型方法 + 最小 fake 对象验证受控 setter。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ChartContext } from '../../dist/core/chart-context.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const P = ChartContext.prototype;

/** 最小 ctx 替身：只含被测方法需要的字段，记录 emit / render 调用 */
function fakeCtx(overrides = {}) {
  const events = [];
  const ctx = {
    mode: 'intraday',
    period: '1d',
    palette: { up: '#E24B4A' },
    dataset: { intraday: [], depthFull: null },
    viewport: { start: 0, end: 0 },
    priceScale: { min: 0, max: 0 },
    auctionEnabled: true,
    chipsEnabled: true,
    isMultiDay: false,
    intradayDays: 1,
    barsCache: new Map(),
    maConfig: [],
    macdParams: { fast: 12, slow: 26, signal: 9 },
    getSeries: () => ctx.dataset.intraday,
    getBars: () => [],
    getVisible: () => ctx.getSeries().slice(ctx.viewport.start, ctx.viewport.end),
    getSubplotConfig: () => [],
    getSubplotLayout: () => [],
    getMACDParams: () => ({ ...ctx.macdParams }),
    getIntradayDays: () => ctx.intradayDays,
    halfHourMarks: () => [{ x: 10, time: '09:30', tradeDate: '2026-11-13', dayStart: true }],
    emit: (name, detail) => events.push({ name, detail }),
    requestRender: () => events.push({ name: 'render' }),
    events,
    ...overrides,
  };
  return ctx;
}

test('configure() 是初始化状态的唯一入口，只接受合法值', () => {
  const ctx = fakeCtx();
  P.configure.call(ctx, {
    mode: 'intraday', auctionEnabled: false, chipsEnabled: false,
  });
  assert.equal(ctx.mode, 'intraday');
  assert.equal(ctx.auctionEnabled, false);
  assert.equal(ctx.chipsEnabled, false);
  assert.equal(ctx.events.length, 0, '初始化不应 emit / 重绘');
  P.configure.call(ctx, { mode: 'bogus', auctionEnabled: 'yes', chipsEnabled: null });
  assert.equal(ctx.mode, 'intraday', '非法 mode 应被忽略');
  assert.equal(ctx.auctionEnabled, false, '非 boolean 应被忽略');
});

test('setPalette() 浅拷贝且拒绝非对象', () => {
  const ctx = fakeCtx();
  const input = { up: '#000000', down: '#00FF00' };
  const snapshot = P.setPalette.call(ctx, input);
  assert.notEqual(ctx.palette, input, '不能直接持有外部对象');
  input.up = '#FFFFFF';
  assert.equal(ctx.palette.up, '#000000');
  snapshot.up = '#FFFFFF';
  assert.equal(ctx.palette.up, '#000000', '返回值也不能反向污染内部');
  P.setPalette.call(ctx, null);
  assert.equal(ctx.palette.up, '#000000');
});

test('setPriceScale() 校验 min/max，脏值不写入', () => {
  const ctx = fakeCtx();
  P.setPriceScale.call(ctx, { min: 1400, max: 1440, pre: 1410.27, symmetrical: true });
  assert.equal(ctx.priceScale.max, 1440);
  assert.equal(ctx.priceScale.symmetrical, true);
  const before = { ...ctx.priceScale };
  for (const bad of [{ min: NaN, max: 1 }, { min: 2, max: 1 }, { min: undefined, max: 1 }, null]) {
    const ret = P.setPriceScale.call(ctx, bad);
    assert.deepEqual(ctx.priceScale, before, `脏值 ${JSON.stringify(bad)} 不应写入`);
    assert.deepEqual(ret, before);
  }
});

test('setViewport() 钳制到序列范围并 emit', () => {
  const ctx = fakeCtx({ dataset: { intraday: Array.from({ length: 242 }, (_, i) => ({ i })) } });
  const vp = P.setViewport.call(ctx, { start: -10, end: 9999 });
  assert.deepEqual(vp, { start: 0, end: 242 });
  assert.deepEqual(ctx.viewport, { start: 0, end: 242 });
  const ev = ctx.events.find((e) => e.name === 'viewport-change');
  assert.ok(ev && ev.detail.mode === 'intraday', '事件必须带 mode');
  assert.ok(ctx.events.some((e) => e.name === 'render'));
  P.setViewport.call(ctx, { start: 100, end: 20 });
  assert.deepEqual(ctx.viewport, { start: 100, end: 100 }, 'start>end 应被压平');
  P.setViewport.call(ctx, { start: NaN, end: NaN });
  assert.deepEqual(ctx.viewport, { start: 0, end: 242 }, 'NaN 应回退到全量');
});

test('setDepthFull() 是写 dataset.depthFull 的唯一入口', () => {
  const ctx = fakeCtx();
  const pano = { bids: [1], asks: [2] };
  assert.deepEqual(P.setDepthFull.call(ctx, pano), pano);
  assert.equal(ctx.dataset.depthFull, pano);
  assert.ok(ctx.events.some((e) => e.name === 'render'));
  assert.equal(P.setDepthFull.call(ctx, undefined), null);
  const noData = fakeCtx({ dataset: null });
  assert.equal(P.setDepthFull.call(noData, pano), null, '无 dataset 时安全返回');
});

test('readonlyFacade()：冻结、状态浅拷贝、不暴露内部可变对象与写方法', () => {
  const ctx = fakeCtx();
  ctx.dataset.intraday = [{ price: 1 }];
  const f = P.readonlyFacade.call(ctx);
  assert.ok(Object.isFrozen(f));
  assert.equal(f.mode, 'intraday');
  assert.equal(f.priceScale.max, 0);
  assert.throws(() => { f.mode = 'candle'; }, /只读/, '门面写入应明确报「只读」错误');
  assert.throws(() => { delete f.mode; }, /只读/);
  const vp = f.viewport;
  vp.start = 999;
  assert.equal(f.viewport.start, 0, 'getter 返回浅拷贝，改它不影响内部');
  const pal = f.palette;
  pal.up = '#FFF';
  assert.equal(f.palette.up, '#E24B4A');
  const series = f.getSeries();
  series.push({ price: 999 });
  assert.equal(ctx.dataset.intraday.length, 1, '查询方法返回拷贝，不暴露内部数组');
  for (const internal of ['setMode', 'setDataset', 'requestRender', 'emit', 'applyLayout']) {
    assert.equal(f[internal], undefined, `门面不应暴露内部方法 ${internal}`);
  }
  assert.equal(typeof f.getMACDParams, 'function');
  assert.equal(f.halfHourMarks({ x: 0, y: 0, w: 100, h: 100 }).length, 1);
});

test('getContext() 返回只读门面；组件层 0 处绕过 setter 直接写 ctx', () => {
  const chartSrc = readFileSync(`${root}src/elements/stock-chart.ts`, 'utf8');
  assert.ok(chartSrc.includes('this.ctx.readonlyFacade()'), 'getContext 仍返回可变 ctx');
  assert.ok(!chartSrc.includes('getContext() { return this.ctx; }'));
  for (const file of ['stock-chart.ts', 'price-pane.ts', 'indicator-pane.ts', 'chip-pane.ts']) {
    const src = readFileSync(`${root}src/elements/${file}`, 'utf8');
    const writes = [...src.matchAll(/(?:this\.)?ctx\.[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/g)]
      .map((m) => m[0]).filter((s) => !s.includes('=>'));
    assert.equal(writes.length, 0, `${file} 仍有直接写 ctx：${writes.join(', ')}`);
  }
  const paneSrc = readFileSync(`${root}src/elements/price-pane.ts`, 'utf8');
  assert.ok(paneSrc.includes('ctx.setPriceScale('), 'price-pane 未走受控 setter');
});
