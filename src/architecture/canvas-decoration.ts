/**
 * CanvasDecorationModule：把原 ChartContext.renderFrame() 里「不属于任何 pane」的
 * 画布级装饰批次抽成纯函数。MODULE_REGISTRY 中已登记为 canvas-decoration，
 * regionType 为 'gutter|timeline|divider|auction-tail'。
 *
 * 四段装饰的公式 / 常量 / 顺序 / 条件与改造前逐字一致：
 *   1. 全局左坐标栏 band（分时模式，底层绘制 → 原 geometries.unshift）
 *   2. 统一时间轴带（两种模式 → 原 geometries.push）
 *   3. 竞价列尾部灰底（分时 + 有竞价列 → 原 geometries.push）
 *   4. 主副分界线（贯穿全画布，最后绘制 → 原 geometries.push）
 *
 * 依赖方向：Module → Region → Layout → Container，本模块只消费只读状态，产出几何批次。
 * 色板沿用全局 PALETTE：渲染帧内 withPalette 已就地覆盖为实例色板，与旧代码同源。
 */
import { PALETTE, AXIS_GUTTER_L } from '../types';
import type { Rect, SideRect, Palette, ChartMode } from '../types';
import { rect, line, rgba } from '../gl/geometry';
import type { LayoutSnapshot } from './types';

export interface DecorationContext {
  size: { w: number; h: number };
  mainH: number;
  sideRect: SideRect | null;
  auctionPriceRect: Rect | null;
  auctionVolumeRect: Rect | null;
  closingPriceRect: Rect | null;
  palette: Palette;
  mode: ChartMode;
}

/** 一个装饰几何批次：rect 仅用于 scissor 裁剪，vertices 为 WebGL 全局坐标顶点 */
export interface DecorationBatch {
  rect: Rect;
  vertices: number[];
}

/**
 * 逐字搬运原 renderFrame 的四段装饰（this.* → ctx.* 的机械映射）。
 * 返回 { bottom, top }：bottom 为原代码 unshift 到底层的批次（段 1），
 * top 为原代码 push 到末尾的批次（段 2/3/4），各自保持源码中的先后次序。
 */
function computeDecoration(ctx: DecorationContext): { bottom: DecorationBatch[]; top: DecorationBatch[] } {
  const bottom: DecorationBatch[] = [];
  const top: DecorationBatch[] = [];
  // 分时模式：画布最左侧的全局左坐标栏，主图与所有副图共用（底层绘制）
  if (ctx.mode === 'intraday' && ctx.size) {
    const bar: number[] = [];
    rect(bar, 0, 0, AXIS_GUTTER_L, ctx.size.h, rgba(PALETTE.panel, 0.8));
    line(bar, AXIS_GUTTER_L - 0.5, 0, AXIS_GUTTER_L - 0.5, ctx.size.h, 1, rgba(PALETTE.grid));
    bottom.push({ rect: { x: 0, y: 0, w: AXIS_GUTTER_L, h: ctx.size.h }, vertices: bar });
  }
  // 两种模式都画统一时间轴带（浅灰底 + 上细线）：分时段贯穿竞价列 + 连续竞价 + 尾盘段，
  // K 线段贯穿中列；数据绘图区已同步上移 18px，周期切换后日期刻度也落在这条带上
  if (ctx.size && ctx.mainH > 18) {
    const band: number[] = [];
    const y0 = ctx.mainH - 18, x1 = ctx.sideRect?.x ?? ctx.size.w;
    rect(band, 0, y0, x1, ctx.mainH, rgba(PALETTE.band));
    line(band, 0, y0, x1, y0, 1, rgba(PALETTE.grid));
    top.push({ rect: { x: 0, y: y0, w: x1, h: 18 }, vertices: band });
  }
  // 竞价列只铺到第一个副图槽位；其下的左右留白延续同一灰底，避免副图区出现白/浅色断层
  if (ctx.mode === 'intraday' && ctx.size && (ctx.auctionPriceRect || ctx.closingPriceRect)) {
    const tailY = ctx.mainH + (ctx.auctionVolumeRect?.h || 0);
    const tailH = ctx.size.h - tailY;
    if (tailH > 0) {
      const blank: number[] = [], bg = rgba(PALETTE.band);
      for (const col of [ctx.auctionPriceRect, ctx.closingPriceRect]) {
        if (col) rect(blank, col.x, tailY, col.x + col.w, ctx.size.h, bg);
      }
      if (blank.length) top.push({ rect: { x: 0, y: tailY, w: ctx.size.w, h: tailH }, vertices: blank });
    }
  }
  // 主图区 / 副图区分界线：贯穿全画布，最后绘制以免被 pane 背景覆盖
  if (ctx.size && ctx.mainH > 0) {
    const divider: number[] = [];
    // 与副图信息栏的 inset 1px #ECEEF1 分隔线完全同款：竞价列 / 分时图 / 右列统一，
    // 不再用 1.5px 深灰线让竞价侧显得更粗
    line(divider, 0, ctx.mainH, ctx.size.w, ctx.mainH, 1, rgba(PALETTE.grid));
    top.push({ rect: { x: 0, y: 0, w: ctx.size.w, h: ctx.size.h }, vertices: divider });
  }
  return { bottom, top };
}

/** 按源码顺序返回全部四段装饰（bottom 在前、top 在后），供像素级对比 / 探测使用 */
export function buildDecorationBatches(ctx: DecorationContext): Array<{ rect: Rect; vertices: number[] }> {
  const { bottom, top } = computeDecoration(ctx);
  return [...bottom, ...top];
}

/** 原代码用 geometries.unshift(...) 插入到底层的批次（段 1） */
export function buildBottomBatches(ctx: DecorationContext): DecorationBatch[] {
  return computeDecoration(ctx).bottom;
}

/** 原代码用 geometries.push(...) 追加到末尾的批次（段 2/3/4，保持源码先后次序） */
export function buildTopBatches(ctx: DecorationContext): DecorationBatch[] {
  return computeDecoration(ctx).top;
}

/** 说明 canvas-decoration 模块被安排到哪些 Region：返回 snapshot 中可见且存在的装饰槽位 id */
export function decorationRegionIds(snapshot: LayoutSnapshot): string[] {
  const ids = ['gutter', 'timeline', 'auction-tail', 'divider'];
  const out: string[] = [];
  for (const id of ids) {
    const r = snapshot.regions[id];
    if (r && r.visible) out.push(id);
  }
  return out;
}
