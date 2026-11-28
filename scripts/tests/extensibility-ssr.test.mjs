// 可扩展性与 SSR 契约：根入口在无 DOM 环境可 import、按需注册标签、副图注册表扩展。
// 运行环境为纯 Node（无 HTMLElement / customElements），正好模拟 Next / Nuxt 的服务端。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('SSR：根入口 / 元素子路径 / 框架适配层在无 DOM 环境均可 import', async () => {
  assert.equal(typeof globalThis.HTMLElement, 'undefined', '测试前提：Node 无 HTMLElement');
  for (const spec of ['stock-chart', 'stock-chart/react', 'stock-chart/vue',
    'stock-chart/elements/stock-chart', 'stock-chart/elements/stock-workspace',
    'stock-chart/elements/trade-tape', 'stock-chart/elements/depth-book']) {
    await assert.doesNotReject(import(spec), `${spec} 在服务端 import 失败`);
  }
  // 不得为了 SSR 去污染全局（会干扰框架的浏览器环境探测）
  assert.equal(typeof globalThis.HTMLElement, 'undefined', 'import 后不应向全局注入 HTMLElement');
});

test('SSR：defineAll / defineElements 在服务端 no-op 返回空数组', async () => {
  const sc = await import('stock-chart');
  assert.deepEqual(sc.defineAll(), []);
  assert.deepEqual(sc.defineElements(['stock-chart']), []);
});

test('defineElements 按需注册：未知标签忽略、重复调用幂等、defineAll 注册全部', async () => {
  const sc = await import('stock-chart');
  const reg = new Map();
  const fake = { get: (t) => reg.get(t), define: (t, c) => { reg.set(t, c); } };
  assert.deepEqual(sc.defineElements(['stock-chart', 'price-pane', 'not-a-tag'], fake), ['stock-chart', 'price-pane']);
  assert.equal(reg.size, 2);
  sc.defineElements(['stock-chart'], fake);
  assert.equal(reg.size, 2, '重复注册不应再次 define');
  assert.equal(sc.defineAll(fake).length, sc.ELEMENT_TAGS.length);
  assert.equal(reg.size, sc.ELEMENT_TAGS.length);
  assert.equal(reg.get('stock-chart'), sc.StockChart, '注册的构造器必须是导出的同一个类');
});

test('副图注册表：内置 5 项 + VOLCMP；SUBPLOT_INDICATORS 兼容常量不变', async () => {
  const sc = await import('stock-chart');
  assert.deepEqual([...sc.SUBPLOT_INDICATORS], ['VOL', 'AMOUNT', 'MACD', 'KDJ', 'VOL_RATIO']);
  assert.ok(Object.isFrozen(sc.SUBPLOT_INDICATORS));
  const ids = sc.subplotIndicatorIds();
  assert.deepEqual(ids.slice(0, 6), ['VOL', 'AMOUNT', 'MACD', 'KDJ', 'VOL_RATIO', 'VOLCMP']);
  assert.equal(sc.subplotIndicatorLabel('VOLCMP'), '成交对比');
  assert.equal(sc.subplotIndicatorLabel('VOL'), '成交量');
  const def = sc.getSubplotIndicator('volcmp');
  assert.deepEqual([...def.modes], ['intraday']);
  assert.equal(def.unavailableText, '成交对比（仅分时）');
});

test('副图注册表：VOLCMP 的 series / valueText 只依赖公开 ctx 读数，输出累计量', async () => {
  const sc = await import('stock-chart');
  const pt = (time, volume, tradeDate) => ({ time, volume, amount: 0, price: 1, tradeDate });
  const ctx = {
    getSeries: () => [pt('09:30', 10), pt('09:31', 5), pt('09:32', 7)],
    dataset: { manifest: { tradeDate: '2026-11-13' }, prevIntraday: [pt('09:30', 3), pt('09:31', 4)] },
  };
  const def = sc.getSubplotIndicator('VOLCMP');
  const s = def.series(ctx);
  assert.equal(s.type, 'compare');
  assert.deepEqual(s.values.map((v) => v.value), [10, 15, 22]);
  assert.deepEqual(s.values.map((v) => v.prev), [3, 7, 7], '前一日缺 09:32 时沿用已累计值');
  const fmt = { b: (v) => `[${v}]`, shortNum: (v) => String(v) };
  assert.equal(def.valueText(ctx, 1, fmt), '累计 今 [15]  昨 [7]');
});

test('副图注册表：第三方注册新指标即可选；拒绝与内置冲突 / 缺回调的描述符', async () => {
  const sc = await import('stock-chart');
  const ids = sc.registerSubplotIndicator({
    id: 'test_ext', label: '测试扩展',
    series: () => ({ type: 'line', values: [{ value: 1 }] }),
    valueText: () => 'x',
  });
  assert.ok(ids.includes('TEST_EXT'), 'id 应规范为大写并出现在可选列表');
  assert.equal(sc.subplotIndicatorLabel('TEST_EXT'), '测试扩展');
  assert.throws(() => sc.registerSubplotIndicator({ id: 'VOL', label: 'x', series() {}, valueText() {} }), /内置冲突/);
  assert.throws(() => sc.registerSubplotIndicator({ id: '', label: 'x' }), /非法/);
  assert.throws(() => sc.registerSubplotIndicator({ id: 'NO_CB', label: 'x' }), /缺少 series/);
});

test('扩展点开放：核心文件不含扩展副图专属分支，新增副图只需注册', () => {
  for (const f of ['src/core/chart-context.ts', 'src/elements/stock-chart.ts', 'src/elements/indicator-pane.ts']) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(!src.includes('VOLCMP'), `${f} 仍含 VOLCMP 专属代码`);
  }
});
