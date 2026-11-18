// 顶点生成：全部输出 6 floats/顶点 [x, y, r, g, b, a]，统一用 TRIANGLES。
// WebGL 的 gl.lineWidth 多数实现只有 1px，所以粗线一律在 CPU 侧三角形化。
import { PALETTE } from '../types.js';

const colorCache = new Map();
export function rgba(hex, alpha = 1) {
  const key = `${hex}:${alpha}`;
  if (colorCache.has(key)) return colorCache.get(key);
  const h = hex.replace('#', '');
  const c = [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
    alpha,
  ];
  colorCache.set(key, c);
  return c;
}

function vertex(out, x, y, c) { out.push(x, y, c[0], c[1], c[2], c[3]); }

/** 填充矩形 → 2 个三角形 */
export function rect(out, x0, y0, x1, y1, c) {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
  const bx = Math.max(x0, x1), by = Math.max(y0, y1);
  vertex(out, ax, ay, c); vertex(out, bx, ay, c); vertex(out, ax, by, c);
  vertex(out, ax, by, c); vertex(out, bx, ay, c); vertex(out, bx, by, c);
}

/** 粗线段 → 沿法线扩展成窄四边形 → 2 个三角形 */
export function line(out, x0, y0, x1, y1, width, c) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2), ny = (dx / len) * (width / 2);
  const p = [
    [x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny],
    [x0 + nx, y0 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny],
  ];
  for (const [x, y] of p) vertex(out, x, y, c);
}

export function polyline(out, pts, width, c) {
  for (let i = 1; i < pts.length; i += 1) {
    line(out, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], width, c);
  }
}

/** 一根蜡烛：实体 + 上下影线 */
export function candle(out, x, yOpen, yClose, yHigh, yLow, barWidth, c) {
  const half = Math.max(1, barWidth * 0.35);
  line(out, x, yHigh, x, yLow, 1, c);
  if (Math.abs(yOpen - yClose) < 1) rect(out, x - half, yOpen - 0.5, x + half, yOpen + 0.5, c);
  else rect(out, x - half, Math.min(yOpen, yClose), x + half, Math.max(yOpen, yClose), c);
}

/** 横向柱（筹码峰用） */
export function hbar(out, x0, y, width, height, c) {
  rect(out, x0, y - height / 2, x0 + width, y + height / 2, c);
}

/** 水平虚线（WebGL 无 dash，逐段短横线模拟） */
export function dashedH(out, x0, x1, y, width, color, seg = 9, gap = 4) {
  for (let x = x0; x < x1; x += seg + gap) {
    line(out, x, y, Math.min(x + seg, x1), y, width, color);
  }
}

/** 背景与水平网格线 */
export function background(out, w, h, rows = 4) {
  rect(out, 0, 0, w, h, rgba(PALETTE.background));
  const c = rgba(PALETTE.grid);
  for (let i = 1; i < rows; i += 1) line(out, 0, (h / rows) * i, w, (h / rows) * i, 1, c);
}

/** 线性映射，带上下留白 */
export function makeScale(min, max, top, bottom, pad = 0.08) {
  const span = max - min || 1;
  const lo = min - span * pad, hi = max + span * pad;
  return (v) => top + ((hi - v) / (hi - lo)) * (bottom - top);
}
