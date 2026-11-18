#!/usr/bin/env node
// 零依赖静态服务：no-store 避免开发期缓存；端口被占用时自动顺延，不再报 Address already in use。
// 用法：npm run serve  或  PORT=8090 npm run serve
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const startPort = Number(process.env.PORT || 8080);
const MAX_TRY = 10;

function listen(port, attempt = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.resolve(root, `.${rel}`);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403, { 'Cache-Control': 'no-store' });
        res.end('forbidden');
        return;
      }
      const info = await stat(file);
      if (info.isDirectory()) {
        res.writeHead(403, { 'Cache-Control': 'no-store' });
        res.end('forbidden');
        return;
      }
      const buf = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store, must-revalidate',
        'Content-Length': buf.length,
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('404 not found');
    }
  });

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_TRY) {
      console.log(`端口 ${port} 已被占用，自动尝试 ${port + 1} …`);
      listen(port + 1, attempt + 1);
    } else {
      console.error(`启动失败：${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Stock Chart 静态服务已启动 → http://127.0.0.1:${port}/index.html`);
    console.log(`目录 ${root}`);
    console.log('Cache-Control: no-store（开发期不会缓存旧模块）');
  });
}

listen(startPort);
