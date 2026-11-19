/**
 * P1/P2 六组架构收口回归：数据可复现、事件契约、exports、重复实现、
 * manifest.session、generatedAt/floatShares、废弃 API 与命名收敛。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHART_EVENTS, emitEvent,
} from '../../src/events.js';
import { vStockChart, bindStockChart } from '../../src/frameworks/vue.js';
import { r2, r6, mulberry32 } from '../shared.mjs';
import { PALETTE, createPalette } from '../../src/types.js';
import { ChartContext } from '../../src/core/chart-context.js';
import * as pure from '../../src/pure.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (p) => readFileSync(`${root}${p}`, 'utf8');
const json = (p) => JSON.parse(rd(p));
const pkg = json('package.json');
const manifest = json('src/data/manifest.json');

// ---- P1-1 数据重跑可复现 ----
test('P1-1 原始数据回退链：规范名 / 兼容名 / 归档副本', () => {
  const src = rd('scripts/build-sample-data.mjs');
  assert.ok(src.includes("RAW_CANDIDATES = ['hist_intraday.json', 'tx_minute.json']"));
  assert.ok(src.includes('[rawDir, rawCopyDir]'), '未回退到 src/data/raw 归档副本');
  assert.ok(src.includes("parsed?.data?.sh600519?.data?.data?.length"), '未校验空响应');
  assert.ok(existsSync(`${root}src/data/raw/hist_intraday.json`), '归档副本缺失，离线无法重跑');
  const fetchSrc = rd('scripts/fetch-public-data.mjs');
  assert.ok(fetchSrc.includes("file: 'hist_intraday.json', alias: 'tx_minute.json'"),
    '抓取脚本未使用规范名');
  assert.ok(pkg.scripts.data.includes('build-order-book.mjs'), 'npm run data 缺第二步');
});

// ---- P1-2 事件契约 ----
test('P1-2 事件名集中登记，emitEvent 统一 bubbles + composed', () => {
  assert.ok(Object.isFrozen(CHART_EVENTS));
  assert.equal(CHART_EVENTS.DEPTH_UNIT_REQUEST, 'depth-unit-request');
  assert.equal(CHART_EVENTS.WEBGL_CONTEXT_RESTORED, 'webglcontext-restored');
  const host = new EventTarget();
  let seen = null;
  host.addEventListener('custom-event', (e) => { seen = e; });
  const ok = emitEvent(host, 'custom-event', { a: 1 });
  assert.equal(ok, true);
  assert.deepEqual(seen.detail, { a: 1 });
  assert.equal(seen.bubbles, true);
  assert.equal(seen.composed, true);
});

test('P1-2 全仓只有 events.js 直接构造 CustomEvent；单位事件单一派发源', () => {
  const all = readdirSync(`${root}src`, { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.js') && !f.startsWith('data/'));
  const direct = all.filter((f) => rd(`src/${f}`).includes('new CustomEvent('));
  assert.deepEqual(direct, ['events.js']);
  const book = rd('src/elements/depth-book.js');
  const chart = rd('src/elements/stock-chart.js');
  assert.ok(book.includes('DEPTH_UNIT_REQUEST') && !book.includes("'depth-unit-change'"),
    '十档盘口仍直接派发 depth-unit-change');
  assert.ok(chart.includes('DEPTH_UNIT_CHANGE'), '根容器未统一派发 depth-unit-change');
  const page = rd('index.html');
  assert.ok(!page.includes("book.addEventListener('depth-unit-change'"), '页面仍有重复监听');
  assert.equal((chart.match(/emitEvent\(this, CHART_EVENTS\.DEPTH_UNIT_CHANGE/g) || []).length, 1);
});

// ---- P1-3 exports 与 Vue 封装 ----
test('P1-3 exports 补齐子路径、消除 .js.js 陷阱', () => {
  for (const [k, v] of Object.entries(pkg.exports)) {
    const targets = typeof v === 'string' ? [v] : Object.values(v);
    for (const t of targets) {
      assert.ok(!t.includes('.js.js'), `${k} 存在 .js.js 陷阱`);
      const p = t.replace(/^\./, '').replace(/^\//, '');
      if (p.includes('*')) {
        const dir = `${root}${p.slice(0, p.lastIndexOf('/'))}`;
        assert.ok(existsSync(dir) && readdirSync(dir).length > 0, `${k} 通配目录为空：${t}`);
      } else assert.ok(existsSync(`${root}${p}`), `${k} 目标不存在：${t}`);
    }
  }
  for (const sub of ['./vue', './events', './core/*', './gl/*', './compute/*', './elements/*.js']) {
    assert.ok(pkg.exports[sub], `exports 缺 ${sub}`);
  }
});

test('P1-3 Vue 指令：mounted / updated / unmounted 绑定与解绑', () => {
  const el = new EventTarget();
  const options = { mode: 'intraday', crosshair: 3 };
  vStockChart.mounted(el, { value: options, oldValue: undefined });
  assert.equal(typeof el.__stockChartCleanup__, 'function');
  vStockChart.updated(el, { value: options, oldValue: options });   // 同引用不重绑
  assert.equal(typeof el.__stockChartCleanup__, 'function');
  const next = { mode: 'candle' };
  vStockChart.updated(el, { value: next, oldValue: options });
  assert.equal(typeof el.__stockChartCleanup__, 'function');
  vStockChart.unmounted(el);
  assert.equal(el.__stockChartCleanup__, undefined);
  assert.equal(typeof bindStockChart, 'function');
});

// ---- P1-4 重复实现 / 常量单一真源 / manifest.session ----
test('P1-4 生成脚本共用 shared.mjs 与 market-constants', () => {
  assert.equal(r2(1.2345), 1.23);
  assert.equal(r6(1.23456789), 1.234568);
  const a = mulberry32(20261113), b = mulberry32(20261113);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()], '同种子必须完全一致');
  assert.notEqual(mulberry32(1)(), mulberry32(2)(), '不同种子应不同');
  for (const f of ['build-sample-data.mjs', 'build-order-book.mjs', 'limit-rules.mjs', 'auction-match.mjs']) {
    assert.ok(rd(`scripts/${f}`).includes('shared.mjs'), `${f} 未共用 shared.mjs`);
    assert.ok(!rd(`scripts/${f}`).includes('function mulberry32'), `${f} 仍有本地 PRNG`);
  }
  assert.equal(pure.AUCTION_STEP_SEC, 9);
  assert.equal(pure.TIME.CLOSE, '15:00:00');
  assert.equal(pure.TIME.SESSION_END, '15:00');
});

test('P1-4 getSeries() 收盘时刻取自 manifest.session', () => {
  const src = rd('src/core/chart-context.js');
  assert.ok(src.includes('manifest?.session?.at?.(-1)?.close'), 'getSeries 未读 manifest.session');
  const ctx = Object.create(ChartContext.prototype);
  const pts = [
    { time: '09:30', price: 1 }, { time: '14:59', price: 2 },
    { time: '15:00', price: 3 }, { time: '15:01', price: 4 },
  ];
  ctx.mode = 'intraday';
  ctx.dataset = { intraday: pts, manifest: { session: [{ open: '09:30', close: '11:30' }, { open: '13:00', close: '15:00' }] } };
  assert.equal(ctx.getSeries().length, 3);
  // 改用自定义收盘时刻也能跟随（不再写死 15:00）
  ctx.dataset.manifest.session.at(-1).close = '14:00';
  assert.equal(ctx.getSeries().length, 1);
});

test('P1-4 复权标签取自 manifest.adjust', () => {
  const src = rd('src/elements/price-pane.js');
  assert.ok(src.includes("qfq: '前复权'") && src.includes('manifest?.adjust'));
  assert.ok(!src.includes('`K线(前复权)'), '仍写死前复权');
});

// ---- P2-5 generatedAt / floatShares ----
test('P2-5 generatedAt 可复现、floatShares 有来源', () => {
  const src = rd('scripts/build-sample-data.mjs');
  assert.ok(src.includes('SOURCE_DATE_EPOCH') && src.includes('new Date().toISOString()'));
  assert.ok(!src.includes("generatedAt: '2026-11-16"), '仍写死生成时间');
  assert.ok(!src.includes('floatShares: 1250081601'), '仍写死流通股本');
  const instrument = json('src/data/raw/instrument.json');
  assert.equal(instrument.floatShares, manifest.floatShares);
  assert.ok(instrument.source && instrument.asOf);
  assert.ok(manifest.floatSharesSource.includes(instrument.asOf));
  assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)));
});

// ---- P2-6 废弃 API / 命名 / PALETTE ----
test('P2-6 废弃 API 已移除，均线写入口收敛', () => {
  assert.equal(pure.adaptiveMACDParams, undefined, 'adaptiveMACDParams 未移除');
  assert.ok(!rd('src/gl/renderer.js').includes('export const CLEAR'), 'CLEAR 未移除');
  const ctxSrc = rd('src/core/chart-context.js');
  const chartSrc = rd('src/elements/stock-chart.js');
  assert.ok(ctxSrc.includes('setMovingAverages(list)'));
  assert.ok(!ctxSrc.includes('setMA(') && !chartSrc.includes('.setMA('), '仍残留 setMA 命名');
  assert.ok(rd('src/index.d.ts').includes('setMovingAverages'), '声明缺公开方法');
});

test('P2-6 createPalette() 是纯函数，不改动全局 PALETTE', () => {
  const before = { ...PALETTE };
  const p = createPalette({ up: '#123456' });
  assert.equal(p.up, '#123456');
  assert.equal(PALETTE.up, before.up, '全局色板不应被改动');
  p.up = '#FFFFFF';
  assert.equal(PALETTE.up, before.up);
  const withBase = createPalette({}, { up: '#AAAAAA', down: '#BBBBBB' });
  assert.equal(withBase.up, '#AAAAAA');
  assert.ok(rd('src/types.js').includes('@deprecated 会就地改动全局 PALETTE'));
});
