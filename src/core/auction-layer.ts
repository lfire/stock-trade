// 竞价段几何：开盘集合竞价（9:15–9:25，左列）与收盘集合竞价（14:57–15:00，中列右段）共用。
// 上段（占满主图高度）画阶梯价格线，下段（占副图高度）画挂单量/成交量；与主图共用 priceScale。
import { rgba, rect, line, makeScale } from '../gl/geometry';
import { PALETTE } from '../types';
import type { AuctionPoint } from '../types';
import type { ChartContext } from './chart-context';

type Rect = { x: number; y: number; w: number; h: number };
type Grid = { x0: number; x1: number; w: number };
interface PhaseOpts {
  dividerRatio?: number;
  leftEdge?: boolean;
  gutter?: number;
  hover?: number | null;
}

/** 灰底 + 与主图同 5 行网格 + 时段分界竖线 */
function drawBand(out: number[], r: Rect, g: Grid, opts: PhaseOpts) {
  rect(out, r.x, r.y, r.x + r.w, r.y + r.h, rgba(PALETTE.band));   // 灰底铺满整列
  if (g.x1 < r.x + r.w) rect(out, g.x1, r.y, r.x + r.w, r.y + r.h, rgba(PALETTE.panel, 0.8)); // 右侧坐标栏
  const grid = rgba(PALETTE.grid);
  for (let i = 1; i < 5; i += 1) {
    const y = r.y + (r.h / 5) * i;
    line(out, g.x0, y, g.x1, y, 1, grid);
  }
  // 所有竖分隔线统一为「宽度 1 + PALETTE.grid」，与分时图半小时竖网格完全同款；
  // 此前 9:20 分界用 #DCDFE5、右边界用 #C9CDD4，深浅不一看起来像粗细不同
  if (opts.dividerRatio != null) {                  // 开盘段 9:20 可撤单分界
    const x = g.x0 + opts.dividerRatio * g.w;
    line(out, x, r.y, x, r.y + r.h, 1, grid);
  }
  if (opts.leftEdge) line(out, g.x0, r.y, g.x0, r.y + r.h, 1, grid);   // 尾盘段左边界 14:57
  line(out, g.x1, r.y, g.x1, r.y + r.h, 1, grid);
}

/** 阶梯价格线：水平段 + 垂直跳变，不画节点圆点 */
function drawStepLine(out: number[], pts: AuctionPoint[], g: Grid, yPrice: (v: number) => number) {
  const n = pts.length;
  const xAt = (i: number) => g.x0 + ((i + 0.5) / n) * g.w;
  const dark = rgba(PALETTE.text);   // 阶梯价格线跟随实例主题文字色
  for (let i = 0; i < n; i += 1) {
    const y = yPrice(pts[i].virtualPrice);
    const xEnd = i < n - 1 ? xAt(i + 1) : g.x1;
    line(out, xAt(i), y, xEnd, y, 1.4, dark);
    if (i < n - 1) line(out, xEnd, y, xEnd, yPrice(pts[i + 1].virtualPrice), 1.4, dark);
  }
}

/** 下段：挂单量吸顶（红=买方堆积/绿=卖方堆积）、成交量吸底（涨红/跌绿），含 0/50%/100% 刻度线 */
function drawVolumeSection(out: number[], pts: AuctionPoint[], ctx: ChartContext, r: Rect, g: Grid) {
  const n = pts.length;
  const bw = Math.max(0.8, (g.w / n) * 0.62);
  const xAt = (k: number) => g.x0 + ((k + 0.5) / n) * g.w;
  // 竞价列下半部与第一个副图的整个槽位等高：顶部 18px 对应副图信息栏留白，
  // 量柱/网格只画在绘图区高度内；铺灰底并画出上下边沿，使与副图边沿严格对齐可见。
  const drawY = r.y + 18, drawH = Math.max(10, r.h - 18);
  rect(out, r.x, r.y, r.x + r.w, r.y + r.h, rgba(PALETTE.band));
  // 上边沿 y=mainH 由 render() 的统一分界线绘制，这里不重复画线以免叠加变粗
  line(out, r.x, r.y + r.h - 0.5, r.x + r.w, r.y + r.h - 0.5, 1, rgba(PALETTE.grid));
  const topBase = drawY + 2, topUsable = drawH * 0.22;
  // 与第一个成交量副图共用同一零值基线（副图 bottom = 副图 rect 底 - 8 = volRect 底 - 8）
  const botBase = r.y + r.h - 8, botUsable = drawH * 0.62;
  let maxUn = 0, maxQty = 0;
  for (const p of pts) { maxUn = Math.max(maxUn, p.unmatchedQty); maxQty = Math.max(maxQty, p.matchedQty); }
  // 开盘竞价列与第一个成交量副图共用纵轴上限（统一为「股」）；尾盘段量级不同，按自身相对量
  const isClose = pts[0]?.phase === 'close';
  const sharedHi = !isClose && ctx.volumeScaleHi ? ctx.volumeScaleHi() : 0;
  const qtyMax = sharedHi || maxQty * 100;
  line(out, g.x0, topBase, g.x1, topBase, 1, rgba(PALETTE.grid));
  line(out, g.x0, topBase + topUsable, g.x1, topBase + topUsable, 1, rgba(PALETTE.grid));
  line(out, g.x0, botBase - botUsable, g.x1, botBase - botUsable, 1, rgba(PALETTE.grid));
  line(out, g.x0, botBase - botUsable / 2, g.x1, botBase - botUsable / 2, 1, rgba(PALETTE.grid));
  line(out, g.x0, botBase, g.x1, botBase, 1, rgba(PALETTE.grid));
  const pre = ctx.dataset!.manifest.preClose;
  for (let k = 0; k < n; k += 1) {
    const p = pts[k];
    const hu = (p.unmatchedQty / (maxUn || 1)) * topUsable;
    rect(out, xAt(k) - bw / 2, topBase, xAt(k) + bw / 2, topBase + hu,
      rgba(p.unmatchedSide === 1 ? PALETTE.up : PALETTE.down, 0.85));
    const prev = k > 0 ? pts[k - 1].virtualPrice : pre;
    const hq = ((p.matchedQty * 100) / qtyMax) * botUsable;   // 手 → 股，与分时 VOL 同量纲
    rect(out, xAt(k) - bw / 2, botBase - hq, xAt(k) + bw / 2, botBase,
      rgba(p.virtualPrice - prev < -0.01 ? PALETTE.down : PALETTE.up, 0.9));
  }
}

/**
 * 生成一段竞价区的两个绘制批次。
 * @param pts 该时段的 AuctionPoint 数组
 * @param opts { dividerRatio, leftEdge, hover }
 * @returns { priceVerts, volVerts, maxQty } maxQty 供 overlay 纵轴刻度使用
 */
export function buildPhaseGeometry(ctx: ChartContext, priceRect: Rect, volRect: Rect | null, pts: AuctionPoint[], opts: PhaseOpts = {}) {
  // 竞价量柱已与第一个成交量副图共用全局左坐标栏刻度，无需再留自己的数字栏
  const gutter = opts.gutter != null ? opts.gutter : 0;
  const plotW = Math.max(10, priceRect.w - gutter);
  const g = { x0: priceRect.x, x1: priceRect.x + plotW, w: plotW };
  const { min, max, pre } = ctx.priceScale;
  // 与主图同步让出底部 18px 时间轴带，保证 9:25 与 9:30 价格仍在同一高度
  const yPrice = makeScale(min, max, priceRect.y + 10, priceRect.y + priceRect.h - 26, 0);
  const priceVerts: number[] = [];
  drawBand(priceVerts, priceRect, g, opts);
  line(priceVerts, g.x0, yPrice(pre!), g.x1, yPrice(pre!), 1, rgba(PALETTE.grid));  // 昨收 0% 线
  drawStepLine(priceVerts, pts, g, yPrice);
  const volVerts: number[] = [];
  if (volRect) drawVolumeSection(volVerts, pts, ctx, volRect, g);

  // hover：竖线贯穿上下两段 + 价格水平虚线（交点不画圆点）
  const h = opts.hover;
  if (h != null && pts[h]) {
    const hx = g.x0 + ((h + 0.5) / pts.length) * g.w;
    const hy = yPrice(pts[h].virtualPrice);
    line(priceVerts, hx, priceRect.y, hx, priceRect.y + priceRect.h, 1, rgba(PALETTE.crosshair));
    if (volRect) line(volVerts, hx, volRect.y, hx, volRect.y + volRect.h, 1, rgba(PALETTE.crosshair));
    for (let xx = g.x0; xx < g.x1; xx += 9) {
      line(priceVerts, xx, hy, Math.min(xx + 5, g.x1), hy, 1, rgba(PALETTE.crosshair));
    }
  }
  const maxQty = Math.max(...pts.map((p) => p.matchedQty));
  return { priceVerts, volVerts, maxQty };
}
