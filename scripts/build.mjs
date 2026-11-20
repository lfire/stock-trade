#!/usr/bin/env node
// 构建：TypeScript 源码（src/**/*.ts）→ tsc 编译为 dist/**/*.js + 自动生成的 .d.ts。
// - 类型声明由 tsc 从源码生成，不再维护手写 .d.ts；
// - 源码里的相对 import 写成无扩展名（'./chip-pane'），本脚本在编译后统一补回 '.js'，
//   让 dist 产物能被浏览器 / Node ESM 直接加载（tsc 自身不会补扩展名）；
// - dist/global.d.ts（JSX / HTMLElementTagNameMap 全局声明）tsc 不产出，需单独复制；
// - 排除 src/data 示例数据，最后对产物做 node --check 语法校验。
import { mkdir, readdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// 1) 编译（strict + declaration + noEmitOnError，任一类型错误即失败）
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], {
  cwd: root, stdio: 'inherit',
});

// 2) 全局声明：.d.ts 输入不会被 tsc 复制到 outDir；tsc 也不会保留源码里的三斜线引用，
//    因此在根类型入口前置 reference，保证消费者 import 'stock-chart' 时获得 JSX / 标签声明。
await copyFile(join(src, 'global.d.ts'), join(dist, 'global.d.ts'));
const indexDts = join(dist, 'index.d.ts');
const indexDtsText = await readFile(indexDts, 'utf8');
if (!indexDtsText.includes('reference path="./global.d.ts"')) {
  await writeFile(indexDts, `/// <reference path="./global.d.ts" />\n${indexDtsText}`);
}

// 3) 相对 import 扩展名补全：源码写 './chip-pane'，产物必须是 './chip-pane.js'。
//    同时处理 .js 运行时文件与 .d.ts 声明文件（声明里也要带 .js，消费者类型解析才成立）。
//    只匹配 import/export 语句中的相对 specifier，且校验目标 .js 文件确实存在。
const SPEC_RE = /(\b(?:from|import)\s*|\bimport\(\s*)(['"])(\.[^'"]+)(\2)/g;
let rewritten = 0;
for (const f of await walk(dist)) {
  if (!f.endsWith('.js') && !f.endsWith('.d.ts')) continue;
  const text = await readFile(f, 'utf8');
  const out = text.replace(SPEC_RE, (all, head, quote, spec, tail) => {
    const last = spec.split('/').pop() || '';
    if (last.includes('.')) return all;              // 已有扩展名（.js / .json / .ts …）
    const target = join(dirname(f), `${spec}.js`);
    if (!existsSync(target)) {
      throw new Error(`构建期补全失败：${relative(root, f)} 引用 ${spec}，但 ${relative(root, target)} 不存在`);
    }
    rewritten += 1;
    return `${head}${quote}${spec}.js${tail}`;
  });
  if (out !== text) await writeFile(f, out);
}

// 4) dist 可独立作为 ESM 包被解析（不依赖根目录 package.json 的 type）
await writeFile(join(dist, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

// 5) 产物清点 + 语法校验
const files = await walk(dist);
const jsFiles = files.filter((f) => f.endsWith('.js'));
for (const f of jsFiles) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
const dtsFiles = files.filter((f) => f.endsWith('.d.ts'));
console.log(`build: ${jsFiles.length} 个 JS + ${dtsFiles.length} 个 .d.ts（补全 ${rewritten} 处 import 扩展名）-> dist/（tsc strict 通过，语法校验通过）`);
