import { BaseElement } from './ssr-base';
import { rgba, rect, line } from '../gl/geometry';
import { PALETTE, AXIS_GUTTER_L, AXIS_GUTTER_R } from '../types';
import type { SubplotLayout, OverlayTextItem } from '../types';
import type { ChartContext } from '../core/chart-context';

type AxisColor = string | ((v: number) => string);
interface AxisOptions {
  count?: number;
  leftFmt?: (v: number) => string;
  rightFmt?: (v: number) => string;
  leftColor?: AxisColor;
  rightColor?: AxisColor;
  skipLeftLast?: boolean;
  leftX?: number;
  unit?: string;
  rightWidth?: number;
}

/**
 * pane 背景：左右各留一条专用坐标栏（浅灰、无网格、无数据），
 * 网格线与边界只画在中间绘图区，保证刻度文字不遮挡任何图表内容。
 */
export function paneBg(out: number[], r: SubplotLayout, rows = 4, leftInset = AXIS_GUTTER_L) {
  rect(out, r.x, r.y, r.x + r.w, r.y + r.h, rgba(PALETTE.background));
  const gutter = rgba(PALETTE.panel, 0.8);
  // 分时模式的左坐标栏在画布最左侧（由 ChartContext 统一画），本 pane 内不再预留
  if (leftInset > 0) rect(out, r.x, r.y, r.x + leftInset, r.y + r.h, gutter);
  rect(out, r.x + r.w - AXIS_GUTTER_R, r.y, r.x + r.w, r.y + r.h, gutter);
  const px0 = r.x + leftInset, px1 = r.x + r.w - AXIS_GUTTER_R;
  const c = rgba(PALETTE.grid);
  for (let i = 1; i < rows; i += 1) {
    const y = r.y + (r.h / rows) * i;
    line(out, px0, y, px1, y, 1, c);
  }
  if (leftInset > 0) line(out, px0, r.y, px0, r.y + r.h, 1, c);
  line(out, px1 - 0.5, r.y, px1 - 0.5, r.y + r.h, 1, c);
}

/**
 * 生成左右两侧坐标刻度，位置固定在左右留白栏内（不再压在数据上）。
 * @param r pane rect
 * @param _width 兼容旧签名，刻度位置由留白栏决定
 * @param opts { count, leftFmt, rightFmt, leftColor, rightColor, skipLeftLast }
 *   count = 网格等分数（主图 5 / 副图 3），颜色可传函数按刻度值着色
 */
export function axisScaleText(r: SubplotLayout, _width: number, lo: number, hi: number, opts: AxisOptions = {}) {
  const count = opts.count || 4;
  const leftFmt = opts.leftFmt || ((v: number) => v.toFixed(2));
  const rightFmt = opts.rightFmt || leftFmt;
  const colorOf = (c: AxisColor, v: number) => (typeof c === 'function' ? c(v) : c);
  // 左栏右对齐（贴着绘图区）、右栏左对齐（贴着绘图区），文字不会往图表里伸
  const leftX = opts.leftX != null ? opts.leftX : r.x + AXIS_GUTTER_L - 6;
  const rightX = r.x + r.w - AXIS_GUTTER_R + 6;
  const unit = opts.unit || '';                              // 单位沉底：最后一行只显示单位
  const out: OverlayTextItem[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const v = hi - (hi - lo) * t;
    const isLast = i === count;
    const y = i === 0 ? r.y + 2
      : (isLast ? r.y + r.h - 16 : r.y + (r.h * i) / count - 6);
    const isUnit = !!(unit && isLast);
    const lText = isUnit ? unit : leftFmt(v);
    const rText = isUnit ? unit : rightFmt(v);
    // 单位与刻度数字完全同款（同字号 / 同灰色 / 不加粗），只靠「沉底位置」区分，避免视觉突兀
    const lc = isUnit ? PALETTE.textMuted : colorOf(opts.leftColor || PALETTE.textMuted, v);
    const rc = isUnit ? PALETTE.textMuted : colorOf(opts.rightColor || PALETTE.textMuted, v);
    // 主图左下角留给 09:30 时间刻度
    if (!(opts.skipLeftLast && isLast)) {
      out.push({ x: leftX, align: 'right', y: Math.round(y), text: lText, color: lc });
    }
    out.push({ x: rightX, y: Math.round(y), text: rText, color: rc });
  }
  return out;
}

/** pane 基类：统一连接到 ChartContext，并处理属性变更重绘。 */
export class PaneElement extends BaseElement {
  declare ctx: ChartContext | null;
  declare rect: SubplotLayout | null;
  constructor() { super(); this.ctx = null; this.rect = null; }

  connectedCallback() {
    const attach = () => {
      const host = this.closest('stock-chart');
      if (host?.ctx) this.connect(host.ctx);
    };
    attach();
    if (!this.ctx) queueMicrotask(attach);
  }

  disconnectedCallback() { this.ctx?.unregisterPane(this); this.ctx = null; }

  connect(ctx: ChartContext) {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    ctx.registerPane(this);
    ctx.requestRender();
  }

  attributeChangedCallback() { this.ctx?.applyLayout(); }

  overlayText(): OverlayTextItem[] { return []; }
}
