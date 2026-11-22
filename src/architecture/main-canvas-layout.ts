/**
 * MainCanvasLayout：整体画布容器的布局（原 ChartContext.applyLayout 的计算部分）。
 *
 * 这是**纯数据布局**：只划分 Region 与 pane 矩形，不写 DOM、不派事件、不触发重绘、
 * 不反向调用宿主。副作用由 Container（ChartContext 适配层）在 applyLayout() 里统一执行。
 *
 * 三列两行的 Region 树：
 *   gutter(左坐标栏) | auction-price / auction-volume(左列竞价)
 *   main(主图) / subplot-0..n(副图) / closing-price / closing-volume(中列)
 *   chip(右列上) / side(右列 DOM 侧栏) | timeline / divider(画布级装饰)
 */
import { AXIS_GUTTER_L, AXIS_GUTTER_R, LAYOUT } from '../types';
import type { Rect, SideRect, SubplotLayout } from '../types';
import type { Layout, LayoutInput, LayoutSnapshot, Region } from './types';

const SUBPLOT_INFO_H = LAYOUT.rowH;   // 原 chart-context.ts 的常量，保持同一真源

/** WebGL 槽位统一 z=1；DOM 侧栏 z=3；装饰层按绘制顺序给 z */
const region = (
  ...[id, rect, target, visible, z, constraint]:
    [string, Rect, Region['target'], boolean, number, string?]
): Region => ({ id, rect, target, visible, z, constraint });

/**
 * 把任意矩形钳制进画布边界：0<=x、x+w<=width、0<=y、y+h<=height。
 * 全量场景所有 rect 本就在界内，故对其为恒等变换（逐字段不变）；
 * 窄画布 / 0 副图 / 极矮画布等极端场景下统一消除越界。
 */
const clampRect = (r: Rect, width: number, height: number): Rect => {
  const x = Math.max(0, Math.min(r.x, width));
  const y = Math.max(0, Math.min(r.y, height));
  const w = Math.max(0, Math.min(r.w, width - x));
  const h = Math.max(0, Math.min(r.h, height - y));
  return { x, y, w, h };
};

export class MainCanvasLayout implements Layout {
  readonly id = 'main-canvas' as const;

  compute(input: LayoutInput): LayoutSnapshot {
    const { w: width, h: height } = input.size;
    const { mode, auctionEnabled, chipsEnabled, isMultiDay,
      openAuctionCount, closeAuctionCount, panes } = input.state;
    const hints = input.hints;
    const isIntraday = mode === 'intraday';
    const auctionOn = auctionEnabled && isIntraday && !isMultiDay && openAuctionCount > 0;
    const chipsOn = chipsEnabled && !isIntraday;

    const auctionW = auctionOn ? (hints.auctionWidth || 150) : 0;
    const chipW = hints.chipWidth || 170;
    const depthW = hints.sideWidth || 210;
    const rightW = isIntraday ? depthW : (chipsOn ? chipW : 0);
    const rightX = width - rightW;
    const leftBar = isIntraday ? AXIS_GUTTER_L : 0;
    const mainX = leftBar + auctionW;
    // 窄画布时把 mainW 钳到剩余可用宽度，保证 mainX + mainW <= width 且 mainW >= 1。
    const mainW = Math.max(1, Math.min(width - mainX, Math.max(120, width - mainX - rightW)));
    // 无副图模块时主图占满画布高度（避免只装分时图时下半留白）；
    // 只要存在可绘制的 indicator-pane，就维持原 50% / 50% 划分，保证全量场景逐字段不变。
    const mainH = panes.some((p) => p.kind === 'indicator' && p.drawable)
      ? Math.round(height * 0.5) : height;
    const subH = height - mainH;

    // pane 槽位：主图 + 可见副图（chip 单独成 Region，不占中列）
    const drawables = panes.map((p, i) => ({ p, i })).filter(({ p }) => p.drawable);
    const priceIdx = drawables.find(({ p }) => p.kind === 'price')?.i ?? -1;
    let subs = drawables.filter(({ p }) => p.kind !== 'price' && p.kind !== 'chip' && !p.hidden);
    // 全隐藏时强制保留第一个副图的兜底仅在「确有 indicator-pane」时生效；
    // 没有任何 indicator-pane（如 minimal 预设无副图）时直接跳过，让 subs 保持为空，
    // 从而 firstSubPaneIndex = -1 / infoBars = [] / firstSlotH 回退 subH - SUBPLOT_INFO_H。
    const hasIndicatorPane = panes.some((p) => p.kind === 'indicator');
    if (!subs.length && hasIndicatorPane) {
      const first = drawables.find(({ p }) => p.kind === 'indicator');
      if (first) subs = [first];   // 全隐藏时强制保留第一个副图（DOM hidden 由 Container 清除）
    }

    const paneRects: Array<Rect | null> = panes.map(() => null);
    const regions: Record<string, Region> = {};
    if (priceIdx >= 0) {
      const r = clampRect({ x: mainX, y: 0, w: mainW, h: mainH }, width, height);
      paneRects[priceIdx] = r;
      regions.main = region('main', r, 'webgl', true, 1, '主图占 50% 高度');
    }

    const pctSum = subs.reduce((s, { p }) => s + p.height, 0) || 100;
    const infoBars: SubplotLayout[] = [];
    let y = mainH;
    subs.forEach(({ p, i }, idx) => {
      const slotH = idx === subs.length - 1 ? height - y : (subH * p.height) / pctSum;
      const r = clampRect({ x: mainX, y: y + SUBPLOT_INFO_H, w: mainW,
        h: Math.max(1, Math.min(slotH - SUBPLOT_INFO_H, height - y - SUBPLOT_INFO_H)) }, width, height);
      paneRects[i] = r;
      regions[`subplot-${idx}`] = region(`subplot-${idx}`, r, 'webgl', true, 1,
        `副图 ${idx} 按 height 比例分配`);
      const info = clampRect({ x: mainX, y, w: mainW, h: SUBPLOT_INFO_H }, width, height);
      infoBars.push({ ...info, index: p.subIndex, indicator: p.indicator.toUpperCase() });
      regions[`subplot-${idx}-info`] = region(`subplot-${idx}-info`,
        info, 'dom', true, 5, '副图信息栏');
      y += slotH;
    });
    const firstSubPaneIndex = subs.length ? subs[0].i : -1;
    const firstSlotH = (subs[0] ? paneRects[subs[0].i]!.h : subH - SUBPLOT_INFO_H) + SUBPLOT_INFO_H;

    // 左列 / 中列右端竞价
    const auctionPriceRect: Rect | null = auctionOn
      ? clampRect({ x: leftBar, y: 0, w: auctionW, h: mainH }, width, height) : null;
    const auctionVolumeRect: Rect | null = auctionOn
      ? clampRect({ x: leftBar, y: mainH, w: auctionW, h: firstSlotH }, width, height) : null;
    const showClosing = auctionOn && closeAuctionCount > 0 && openAuctionCount > 0;
    const closingW = showClosing
      ? Math.max(32, Math.round(auctionW * (closeAuctionCount / openAuctionCount))) : 0;
    const cx = mainX + mainW - AXIS_GUTTER_R - closingW;
    const closingPriceRect: Rect | null = showClosing
      ? clampRect({ x: cx, y: 0, w: closingW, h: mainH }, width, height) : null;
    const closingVolumeRect: Rect | null = showClosing
      ? clampRect({ x: cx, y: mainH, w: closingW, h: firstSlotH }, width, height) : null;
    if (auctionPriceRect) regions['auction-price'] = region('auction-price', auctionPriceRect, 'webgl', true, 1);
    if (auctionVolumeRect) regions['auction-volume'] = region('auction-volume', auctionVolumeRect, 'webgl', true, 1);
    if (closingPriceRect) regions['closing-price'] = region('closing-price', closingPriceRect, 'webgl', true, 1);
    if (closingVolumeRect) regions['closing-volume'] = region('closing-volume', closingVolumeRect, 'webgl', true, 1);

    // 右列筹码峰（WebGL）与 DOM 侧栏
    const chipIdx = panes.findIndex((p) => p.kind === 'chip');
    const chipRect: Rect | null = chipsOn
      ? clampRect({ x: rightX, y: 0, w: rightW, h: mainH }, width, height) : null;
    if (chipIdx >= 0) paneRects[chipIdx] = chipRect;
    if (chipRect) regions.chip = region('chip', chipRect, 'webgl', true, 1, 'K 线模式右列上段');
    const sideBase: SideRect | null = isIntraday
      ? { x: rightX, y: 0, w: rightW, h: height, content: 'depth' }
      : (chipsOn ? { x: rightX, y: mainH, w: rightW, h: height - mainH, content: 'chips' } : null);
    const sideRect: SideRect | null = sideBase
      ? { ...clampRect(sideBase, width, height), content: sideBase.content }
      : null;
    if (sideRect) regions.side = region('side', sideRect, 'dom', true, 3, '右列 DOM 侧栏');

    // 画布级装饰槽位（原 renderFrame 里的「无主批次」）
    regions.gutter = region('gutter',
      clampRect({ x: 0, y: 0, w: AXIS_GUTTER_L, h: height }, width, height), 'webgl', isIntraday, 0,
      '分时模式全局左坐标栏');
    const tlY = Math.max(0, Math.min(mainH - 18, height - 18));
    const tlH = Math.max(1, Math.min(18, height - tlY));
    regions.timeline = region('timeline',
      clampRect({ x: mainX, y: tlY, w: mainW, h: tlH }, width, height), 'webgl', true, 0, '时间轴带');
    const dvY = Math.max(0, Math.min(mainH, height - 1));
    regions.divider = region('divider',
      clampRect({ x: 0, y: dvY, w: width, h: 1 }, width, height), 'webgl', true, 0, '主副图分界线');
    if (auctionVolumeRect) {
      regions['auction-tail'] = region('auction-tail',
        clampRect({ x: leftBar, y: mainH + firstSlotH, w: auctionW,
          h: Math.max(0, height - mainH - firstSlotH) }, width, height),
        'webgl', true, 0, '竞价列下半部灰底');
    }

    return {
      id: 'main-canvas',
      size: { w: width, h: height },
      regions: Object.freeze(regions),
      paneRects: Object.freeze(paneRects),
      metrics: {
        mainH, closingW, firstSubPaneIndex, infoBars, sideRect,
        auctionPriceRect, auctionVolumeRect, closingPriceRect, closingVolumeRect,
      },
    };
  }
}
