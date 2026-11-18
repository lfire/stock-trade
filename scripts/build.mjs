// 构建：把 src 下的 ESM 源码与类型声明按原结构复制到 dist/。
// 项目是原生 ESM，无转译/打包步骤；这里做产物收口、排除示例数据并做语法校验。
import { mkdir, readdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const copied = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'data') continue;   // 示例数据不属于发布产物
      await walk(full);
    } else if (/\.(js|mjs)$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
      const out = join(dist, relative(src, full));
      await mkdir(dirname(out), { recursive: true });
      await copyFile(full, out);
      copied.push(out);
    }
  }
}
await walk(src);

// dist 可独立作为 ESM 包被解析（不依赖根目录 package.json 的 type）
await writeFile(join(dist, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

for (const f of copied.filter((f) => /\.(js|mjs)$/.test(f))) {
  execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
}
console.log(`build: ${copied.length} 个文件 -> dist/（已排除 src/data，语法校验通过）`);
