// 静态可寻址模块子路径回归：
//  - exports 通配（./modules/* / ./workspace/*）与 types 条件；
//  - 13 个门面各自可独立 import（SSR 安全、无副作用）且导出一致的描述符；
//  - 13 个子路径静态闭包互不包含未启用模块的门面；
//  - 根入口静态导出（9 个 element class / defineAll / 两个扩展点）仍完整。
// 动态 import 一律使用字面量路径（不用模板拼接），便于 build/verify 静态审计。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

// 单独执行本文件时 dist/modules 可能尚未构建：先触发一次构建（与 contract.test.mjs 同款兜底）
if (!existsSync(join(root, 'dist/modules/core.js'))) {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
}

// 13 个模块 id（字面量数组）
const MODULE_IDS = [
  'core', 'price-intraday', 'price-candle', 'auction', 'indicator', 'chip',
  'depth-book', 'trade-tape', 'detail-cover', 'panorama', 'header', 'toolbar',
  'historical-intraday',
];

// 13 个 dist 产物路径（字面量数组，用于闭包静态检查与产物清点）
const DIST_FILES = [
  'dist/modules/core.js',
  'dist/modules/price-intraday.js',
  'dist/modules/price-candle.js',
  'dist/modules/auction.js',
  'dist/modules/indicator.js',
  'dist/modules/chip.js',
  'dist/modules/depth-book.js',
  'dist/modules/trade-tape.js',
  'dist/modules/detail-cover.js',
  'dist/modules/panorama.js',
  'dist/modules/header.js',
  'dist/modules/toolbar.js',
  'dist/modules/historical-intraday.js',
];

// 13 个字面量动态 import：每个门面都能独立加载成功（Node 探针，不触碰 DOM）
const loaded = {
  core: await import('../../dist/modules/core.js'),
  'price-intraday': await import('../../dist/modules/price-intraday.js'),
  'price-candle': await import('../../dist/modules/price-candle.js'),
  auction: await import('../../dist/modules/auction.js'),
  indicator: await import('../../dist/modules/indicator.js'),
  chip: await import('../../dist/modules/chip.js'),
  'depth-book': await import('../../dist/modules/depth-book.js'),
  'trade-tape': await import('../../dist/modules/trade-tape.js'),
  'detail-cover': await import('../../dist/modules/detail-cover.js'),
  panorama: await import('../../dist/modules/panorama.js'),
  header: await import('../../dist/modules/header.js'),
  toolbar: await import('../../dist/modules/toolbar.js'),
  'historical-intraday': await import('../../dist/modules/historical-intraday.js'),
};

test('exports 补 ./modules/* 与 ./workspace/* 且都带 types 条件', () => {
  for (const key of ['./modules/*', './workspace/*']) {
    const e = pkg.exports[key];
    assert.ok(e && typeof e === 'object', `exports 缺少 ${key}`);
    assert.equal(typeof e.types, 'string', `${key} 缺少 types 条件`);
    assert.ok(typeof e.default === 'string' || typeof e.import === 'string',
      `${key} 缺少 default/import 条件`);
  }
  assert.ok(pkg.exports['./modules/*.js'], 'exports 缺少 ./modules/*.js 形式');
  // 通配目标目录存在且非空（对齐 contract / p1p2 的 exports 目标存在断言口径）
  for (const key of ['./modules/*', './workspace/*', './modules/*.js']) {
    const v = pkg.exports[key];
    const targets = typeof v === 'string' ? [v] : Object.values(v);
    for (const t of targets) {
      assert.ok(!t.includes('.js.js'), `${key} 存在 .js.js 陷阱：${t}`);
      const p = t.replace(/^\.\//, '');
      const dir = join(root, p.slice(0, p.lastIndexOf('/')));
      assert.ok(existsSync(dir) && readdirSync(dir).length > 0,
        `${key} 通配目标目录不存在或为空：${t}`);
    }
  }
});

test('13 个门面各自导出字面量 MODULE_ID 与一致描述符', () => {
  assert.equal(MODULE_IDS.length, 13);
  assert.equal(DIST_FILES.length, 13);
  for (const id of MODULE_IDS) {
    const m = loaded[id];
    assert.ok(m, `缺少门面 ${id}`);
    assert.equal(m.MODULE_ID, id, `${id} 的 MODULE_ID 不正确`);
    assert.ok(m.descriptor, `${id} 缺少 descriptor`);
    assert.equal(m.descriptor.id, id, `${id} 的 descriptor.id 与 MODULE_ID 不一致`);
  }
});

test('descriptor 与 MODULE_CATALOG 同源（同一引用）', async () => {
  const { MODULE_CATALOG } = await import('../../dist/workspace/module-catalog.js');
  assert.equal(Object.keys(MODULE_CATALOG).length, 13, 'MODULE_CATALOG 不是 13 个模块');
  for (const id of MODULE_IDS) {
    assert.equal(loaded[id].descriptor, MODULE_CATALOG[id], `${id} descriptor 非同一引用`);
  }
});

test('13 个门面都有 tsc 生成的 .js 与 .d.ts', () => {
  for (const file of DIST_FILES) {
    assert.ok(existsSync(join(root, file)), `缺少 ${file}`);
    assert.ok(existsSync(join(root, file.replace(/\.js$/, '.d.ts'))),
      `缺少 ${file.replace(/\.js$/, '.d.ts')}`);
  }
});

test('13 个子路径的静态闭包互不包含未启用模块的门面', () => {
  for (let i = 0; i < MODULE_IDS.length; i += 1) {
    const id = MODULE_IDS[i];
    const src = read(DIST_FILES[i]);
    // 门面不得 import 任何其它门面（modules/ 子路径）
    assert.ok(!/from\s+['"][^'"]*\/modules\//.test(src),
      `${id} 含指向其它模块门面的 import`);
    assert.ok(!/import\(\s*['"][^'"]*\/modules\//.test(src),
      `${id} 含指向其它模块门面的动态 import`);
    // 例如 chip.js 不应拉起 header.js：不得出现其它 12 个门面的产物文件名
    for (const other of MODULE_IDS) {
      if (other === id) continue;
      assert.ok(!src.includes(`modules/${other}.js`),
        `${id} 静态闭包拉起了 ${other}`);
    }
  }
});

test('modules/index.js 的枚举映射覆盖 13 个 id', async () => {
  const { MODULE_IDS: ids, MODULE_PATHS: paths } = await import('../../dist/modules/index.js');
  assert.deepEqual([...ids], MODULE_IDS, 'MODULE_IDS 枚举不一致');
  assert.equal(Object.keys(paths).length, 13, 'MODULE_PATHS 数量不是 13');
  for (const id of MODULE_IDS) assert.ok(paths[id], `MODULE_PATHS 缺少 ${id}`);
});

test('根入口静态导出仍完整（9 个 class / defineAll / 两个扩展点）', () => {
  const entry = read('src/index.ts');
  for (const name of [
    'StockChart', 'PricePane', 'IndicatorPane', 'ChipPane', 'AuctionPane',
    'TradeTape', 'DepthBook', 'DetailCanvas', 'StockWorkspace', 'defineAll',
    'ELEMENT_TAGS', 'registerTemplateSlice', 'registerLifecycle',
  ]) {
    assert.ok(entry.includes(name), `src/index.ts 缺少 ${name}`);
  }
  for (const tag of ['stock-chart', 'price-pane', 'indicator-pane', 'chip-pane',
    'auction-pane', 'trade-tape', 'depth-book', 'detail-canvas', 'stock-workspace']) {
    assert.ok(entry.includes(`'${tag}'`), `注册入口缺少标签 ${tag}`);
  }
  // 根入口不得把 13 个门面全量 export *（避免静态闭包进一步扩大）
  assert.ok(!/export\s+\*\s+from\s+['"][^'"]*modules\//.test(entry),
    '根入口不应全量 re-export 模块门面');
  // 不做运行时懒注册：源码里没有动态 import()
  assert.ok(!entry.includes('import('), '根入口出现运行时懒注册的动态 import');
  const distEntry = read('dist/index.js');
  assert.ok(distEntry.includes('defineAll')
    && distEntry.includes('registerTemplateSlice')
    && distEntry.includes('registerLifecycle'), 'dist/index.js 静态导出不完整');
});
