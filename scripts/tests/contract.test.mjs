// 发布契约测试：包元数据、exports 目标、类型声明与实现的一致性。
// 只做静态反射，不加载 Web Components（Node 无 HTMLElement）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

// 保证 exports 指向的 dist 产物存在（单独 npm test 也能通过）
if (!existsSync(join(root, 'dist/index.js'))) {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
}

test('包元数据完整', () => {
  for (const key of ['name', 'version', 'license', 'author', 'repository', 'keywords', 'main', 'types', 'exports', 'files']) {
    assert.ok(pkg[key], `package.json 缺少 ${key}`);
  }
  assert.ok(pkg.scripts.test && pkg.scripts.build && pkg.scripts.prepublishOnly, '缺少 test/build/prepublishOnly');
  assert.equal(pkg.devDependencies.typescript, '5.6.3', 'TypeScript 未锁定精确版本（CI 不可复现）');
});

test('files 不携带示例数据与文档', () => {
  assert.ok(!pkg.files.includes('docs'), 'docs 被打进发布包');
  assert.ok(!pkg.files.includes('src'), 'src 源码目录被打进发布包');
  assert.ok(pkg.files.includes('dist'), '缺少 dist 产物');
  assert.ok(!existsSync(join(root, 'dist/data')), 'dist 里仍含示例数据');
});

test('exports 的每个目标文件都存在', () => {
  const targets = [];
  for (const v of Object.values(pkg.exports)) {
    if (typeof v === 'string') targets.push(v);
    else for (const t of Object.values(v)) targets.push(t);
  }
  for (const t of targets) {
    assert.ok(!t.includes('.js.js'), `exports 目标存在 .js.js 拼接陷阱：${t}`);
    const p = t.replace(/^\.\//, '');
    if (p.includes('*')) {
      // 通配子路径：目标目录必须存在且非空（新契约用 ./dist/elements/* 而非追加 .js）
      const dir = join(root, p.slice(0, p.lastIndexOf('/')));
      assert.ok(existsSync(dir), `exports 通配目标目录不存在：${t}`);
      assert.ok(readdirSync(dir).length > 0, `exports 通配目标目录为空：${t}`);
    } else {
      assert.ok(existsSync(join(root, p)), `exports 目标不存在：${t}`);
    }
  }
  assert.ok(existsSync(join(root, 'dist/index.d.ts')), 'dist 缺类型入口');
  assert.ok(existsSync(join(root, 'dist/events.js')) && existsSync(join(root, 'dist/frameworks/vue.js')),
    'dist 缺少 ./events 或 ./vue 子路径产物');
});

test('tsc 自动生成的声明覆盖入口导出的类与关键 API', () => {
  // 切换 TS 后声明由 tsc 从 src/**/*.ts 生成，分散在 index/types/elements 三个 .d.ts
  const indexDts = read('dist/index.d.ts');
  const typesDts = read('dist/types.d.ts');
  const stockDts = read('dist/elements/stock-chart.d.ts');
  const auctionDts = read('dist/elements/auction-pane.d.ts');
  for (const name of ['StockChart', 'PricePane', 'IndicatorPane', 'ChipPane', 'AuctionPane',
    'TradeTape', 'DepthBook', 'defineAll', 'ELEMENT_TAGS', 'withPalette', 'bindStockChart']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(indexDts), `index.d.ts 缺少 ${name}`);
  }
  assert.ok(indexDts.includes("reference path=\"./global.d.ts\""), '根声明未引用全局 JSX 声明');
  assert.ok(read('dist/global.d.ts').includes('namespace JSX'), 'dist/global.d.ts 未复制');
  for (const name of ['StockChartState', 'StockChartEventMap', 'ChartContextFacade', 'ChartDataset']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(typesDts), `types.d.ts 缺少 ${name}`);
  }
  for (const name of ['syncSideBars', 'refreshDefaultMAColors', 'getContext']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(stockDts), `stock-chart.d.ts 缺少 ${name}`);
  }
  assert.ok(!read('dist/elements/pane-base.d.ts').includes('PaneElementBase'), '仍有幽灵基类导出');
  // SSR 安全：声明为 extends BaseElement，BaseElement 的类型必须是 typeof HTMLElement（实例即 HTMLElement）
  assert.ok(/class AuctionPane extends BaseElement/.test(auctionDts), 'AuctionPane 继承声明错误');
  const ssrBaseDts = read('dist/elements/ssr-base.d.ts');
  assert.ok(/declare const Base: typeof HTMLElement/.test(ssrBaseDts), 'BaseElement 未声明为 typeof HTMLElement');
});

test('事件映射与 CHART_EVENTS 常量表双向一致', () => {
  // 事件映射现在在 dist/types.d.ts（由 src/types.ts 生成）
  const dts = read('dist/types.d.ts');
  const start = dts.indexOf('interface StockChartEventMap');
  assert.ok(start > 0, 'types.d.ts 缺少 StockChartEventMap');
  const map = dts.slice(start, dts.indexOf('\n}', start));
  const declared = new Set([...map.matchAll(/'([a-z][a-z-]+)'\s*:/g)].map((m) => m[1]));
  const evSrc = read('src/events.ts');
  const table = evSrc.slice(evSrc.indexOf('CHART_EVENTS'), evSrc.indexOf('/** 统一派发'));
  const emitted = new Set([...table.matchAll(/'([a-z][a-z-]+)'/g)].map((m) => m[1]));
  for (const e of declared) assert.ok(emitted.has(e), `声明了未登记的事件：${e}`);
  for (const e of emitted) assert.ok(declared.has(e), `CHART_EVENTS 登记了未声明的事件：${e}`);
  assert.ok(declared.size >= 20, `事件映射数量异常：${declared.size}`);
  // 全仓只有 events.ts 允许直接构造 CustomEvent，统一 bubbles + composed
  const walk = (dir) => readdirSync(join(root, dir), { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.ts')
      && !f.endsWith('.d.ts') && !f.startsWith('data/'))
    .map((f) => `${dir}/${f}`);
  const direct = walk('src').filter((f) => read(f).includes('new CustomEvent('));
  assert.deepEqual(direct, ['src/events.ts'], `仍有模块绕过 emitEvent：${direct.join(', ')}`);
});

test('每个 src 模块都有 tsc 生成的 .js 与 .d.ts', () => {
  const list = (dir, exts) => readdirSync(join(root, dir), { recursive: true })
    .filter((f) => typeof f === 'string' && exts.some((e) => f.endsWith(e))
      && !f.startsWith('data/')).sort();
  const srcFiles = list('src', ['.ts']).filter((f) => !f.endsWith('.d.ts'));
  const distFiles = list('dist', ['.js', '.d.ts']);
  assert.ok(srcFiles.length >= 24, `src 模块数量异常：${srcFiles.length}`);
  for (const f of srcFiles) {
    const base = f.slice(0, -3);
    assert.ok(distFiles.includes(`${base}.js`), `dist 缺少 ${base}.js`);
    assert.ok(distFiles.includes(`${base}.d.ts`), `dist 缺少 ${base}.d.ts`);
  }
});
