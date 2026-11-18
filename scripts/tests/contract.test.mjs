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
    const p = t.replace(/^\.\//, '');
    if (p.includes('*')) {
      // 通配子路径：检查目录下存在同扩展名的实际文件
      const [dir, ext] = [p.slice(0, p.lastIndexOf('/') + 1), p.slice(p.lastIndexOf('.') + 1)];
      const files = readdirSync(join(root, dir));
      assert.ok(files.some((f) => f.endsWith(`.${ext}`)), `exports 通配目标无匹配文件：${t}`);
    } else {
      assert.ok(existsSync(join(root, p)), `exports 目标不存在：${t}`);
    }
  }
  assert.ok(existsSync(join(root, 'dist/index.d.ts')), 'dist 缺类型入口');
});

test('类型声明覆盖入口导出的类与关键 API', () => {
  const dts = read('src/index.d.ts');
  for (const name of ['StockChart', 'PricePane', 'IndicatorPane', 'ChipPane', 'AuctionPane',
    'TradeTape', 'DepthBook', 'defineAll', 'ELEMENT_TAGS', 'withPalette', 'bindStockChart',
    'syncSideBars', 'refreshDefaultMAColors']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(dts), `index.d.ts 缺少 ${name}`);
  }
  assert.ok(!dts.includes('export declare class PaneElementBase'), '仍有幽灵基类导出');
  assert.ok(dts.includes('export declare class AuctionPane extends HTMLElement'), 'AuctionPane 继承声明错误');
});

test('事件映射与实现派发的事件名一致', () => {
  const dts = read('src/index.d.ts');
  const map = dts.slice(dts.indexOf('StockChartEventMap'), dts.indexOf('// ---- 根容器 ----'));
  const declared = new Set([...map.matchAll(/'([a-z][a-z-]+)'\s*:/g)].map((m) => m[1]));
  const walk = (dir) => readdirSync(join(root, dir), { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.js') && !f.startsWith('data/'))
    .map((f) => `${dir}/${f}`);
  const emitted = new Set();
  for (const f of walk('src')) {
    const s = read(f);
    for (const m of s.matchAll(/(?:emit|dispatchEvent)\(\s*(?:new CustomEvent\()?\s*'([a-z][a-z-]+)'/g)) emitted.add(m[1]);
  }
  for (const e of declared) assert.ok(emitted.has(e), `d.ts 声明了未派发的事件：${e}`);
  assert.ok(declared.size >= 20, `事件映射数量异常：${declared.size}`);
});

test('dist 与 src 的模块文件一一对应', () => {
  const list = (dir) => readdirSync(join(root, dir), { recursive: true })
    .filter((f) => typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.d.ts')))
    .sort();
  const srcFiles = list('src').filter((f) => !f.startsWith('data/'));
  const distFiles = list('dist');
  for (const f of srcFiles) assert.ok(distFiles.includes(f), `dist 缺少 ${f}`);
});
