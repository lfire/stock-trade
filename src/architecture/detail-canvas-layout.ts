/**
 * DetailCanvasLayout：详情画布容器的布局（原 index.html 覆盖视图里散落的 Grid / 虚拟滚动计算）。
 *
 * 纯数据：只算出「标签栏 / 分组区 / 全景区」三个 Region 与分组数、每组行数、spacer 高度，
 * 不创建 DOM、不注册 ResizeObserver、不读 dataset。
 */
import { LAYOUT } from '../types';
import type { Layout, LayoutInput, LayoutSnapshot, Region } from './types';

export type DetailSet = 'trades' | 'orders' | 'panorama';

export interface DetailLayoutInput extends LayoutInput {
  detail: {
    set: DetailSet;
    /** 数据总行数，用于虚拟滚动 spacer */
    totalRows: number;
    /** 水平滚动起点（行号） */
    from: number;
  };
}

const region = (
  ...[id, rect, visible, z, constraint]: [string, Region['rect'], boolean, number, string?]
): Region => ({ id, rect, target: 'dom', visible, z, constraint });

/** 按宽度决定分几组，原 index.html detailGroupCount(width) 的单一真源 */
export function detailGroupCount(width: number): number {
  return Math.max(1, Math.min(6, Math.floor(width / 270)));
}

/** 一组能显示的整数行，原 index.html visibleRows() 的简化：由容器高度与行高决定 */
export function detailRowsPerGroup(height: number): number {
  return Math.max(1, Math.floor(height / LAYOUT.rowH));
}

export class DetailCanvasLayout implements Layout {
  readonly id = 'detail-canvas' as const;

  compute(input: LayoutInput): LayoutSnapshot {
    const d = input as DetailLayoutInput;
    const { w: width, h: height } = d.size;
    const { set, totalRows, from } = d.detail;
    const barH = LAYOUT.barH;
    const bodyH = Math.max(0, height - barH);
    const n = detailGroupCount(width);
    const L = detailRowsPerGroup(bodyH);
    const spacerH = Math.max(0, (totalRows - n * L + L) * LAYOUT.rowH);
    const isPano = set === 'panorama';

    const regions: Record<string, Region> = {
      'cover-tabs': region('cover-tabs', { x: 0, y: 0, w: width, h: barH }, true, 1,
        '顶部标签栏，固定一个 barH'),
      'cover-groups': region('cover-groups', { x: 0, y: barH, w: width, h: bodyH }, !isPano, 1,
        `${n} 组 Grid，每组 ${L} 行`),
      'cover-panorama': region('cover-panorama', { x: 0, y: barH, w: width, h: bodyH }, isPano, 1,
        '全景盘口双列，与分组区互斥'),
      'cover-scroll-spacer': region('cover-scroll-spacer',
        { x: 0, y: 0, w: width, h: spacerH }, !isPano, 0, '虚拟滚动占位高度'),
    };

    return {
      id: 'detail-canvas',
      size: { w: width, h: height },
      regions: Object.freeze(regions),
      paneRects: Object.freeze([]),
      metrics: {
        mainH: barH,
        closingW: 0,
        firstSubPaneIndex: -1,
        infoBars: [],
        sideRect: null,
        auctionPriceRect: null,
        auctionVolumeRect: null,
        closingPriceRect: null,
        closingVolumeRect: null,
        // 详情容器专属派生量（通过 as 扩展读取，见 detail-canvas 元素）
        ...({ groupCount: n, rowsPerGroup: L, spacerHeight: spacerH,
          scrollTop: from * LAYOUT.rowH, set } as Record<string, unknown>),
      },
    };
  }
}
