// 筹码峰：stat（9 项统计）/ histogram（150 档横向柱）双模式，共用同一份 ChipDataset。
// 与主图共享 ChartContext.priceScale，因此价格轴天然对齐。
import { PaneElement } from './pane-base.js';
import { rgba, rect, line, hbar, makeScale } from '../gl/geometry.js';
import { PALETTE } from '../types.js';

// 位置线用主题中性色（帧内取实例色板），退到辅助信息层级，不与橙/蓝筹码柱抢视觉

/** 按 K 线光标取该交易日的筹码快照：stats 与 histograms 均为 120 日逐日数据。
 *  无光标取最新；聚合周期或更早日期回退到不晚于该日的最近一份。 */
export function chipSnapshotAt(ctx) {
  const chips = ctx?.dataset?.chips;
  if (!chips) return null;
  const bars = ctx.getBars?.() || [];
  const idx = ctx.crosshair != null ? ctx.crosshair : bars.length - 1;
  const bar = bars[idx];
  const date = ctx.mode === 'candle' && bar?.tradeDate ? bar.tradeDate : null;
  const pick = (arr, cur) => {
    if (!date || !arr?.length) return cur;
    const exact = arr.find((x) => x.date === date);
    if (exact) return exact;
    let found = arr[0];
    for (const x of arr) { if (x.date <= date) found = x; else break; }
    return found || cur;
  };
  return {
    stat: pick(chips.stats, chips.current),
    hist: pick(chips.histograms, chips.currentHistogram),
    close: bar?.close ?? ctx.dataset.manifest.close,
    date: date || chips.current?.date,
  };
}

export class ChipPane extends PaneElement {
  static get observedAttributes() { return ['mode', 'width', 'dock', 'height']; }

  buildGeometry(ctx) {
    const r = this.rect;
    if (!r || !ctx.dataset?.chips) return [];
    const out = [];
    // 筹码峰左右都没有坐标刻度（价格刻度在主图右坐标栏），不能套用 paneBg：
    // 否则两侧会多出浅灰坐标栏、网格也只画在中间，右侧出现突兀灰带且与下方统计区白底断裂。
    rect(out, r.x, r.y, r.x + r.w, r.y + r.h, rgba(PALETTE.background));
    const grid = rgba(PALETTE.grid);
    for (let i = 1; i < 5; i += 1) {
      const gy = r.y + (r.h / 5) * i;
      line(out, r.x, gy, r.x + r.w, gy, 1, grid);   // 网格贯穿全宽，与主图 5 行对齐
    }
    line(out, r.x, r.y, r.x, r.y + r.h, 1, grid);   // 左边界，与统计区 border-left 连贯
    const chips = ctx.dataset.chips;
    const snap = chipSnapshotAt(ctx);
    const { min, max } = ctx.priceScale;
    if (!(max > min)) return out;
    const y = makeScale(min, max, r.y + 6, r.y + r.h - 6);
    const close = snap?.close ?? ctx.dataset.manifest.close;

    if (ctx.chipMode === 'histogram') {
      const ratios = snap?.hist?.ratios || chips.currentHistogram.ratios;
      const grid = chips.priceGrid;
      let peak = 0;
      for (const v of ratios) peak = Math.max(peak, v);
      const bandH = Math.max(1, r.h / grid.length);
      grid.forEach((price, i) => {
        const cy = y(price);
        if (cy < r.y || cy > r.y + r.h) return;
        const w = (ratios[i] / (peak || 1)) * (r.w - 12) * 0.92;
        hbar(out, r.x + 4, cy, w, bandH, rgba(price <= close ? PALETTE.chipProfit : PALETTE.chipLoss, 0.9));
      });
    } else {
      const s = snap?.stat || chips.current;
      const bands = [
        { lo: s.cost90Low, hi: s.cost90High, color: PALETTE.chipProfit, alpha: 0.18 },
        { lo: s.cost70Low, hi: s.cost70High, color: PALETTE.chipLoss, alpha: 0.28 },
      ];
      for (const b of bands) {
        const y0 = y(Math.min(b.hi, max)), y1 = y(Math.max(b.lo, min));
        rect(out, r.x, y0, r.x + r.w, y1, rgba(b.color, b.alpha));
        line(out, r.x, y0, r.x + r.w, y0, 1, rgba(b.color));
        line(out, r.x, y1, r.x + r.w, y1, 1, rgba(b.color));
      }
      line(out, r.x, y(close), r.x + r.w, y(close), 1.4, rgba(PALETTE.up));
    }
    // 平均成本线 = COST(50)（软件面板口径、筹码分布中心）；加权平均成本是另一统计量，另列在统计面板
    const avgCost = snap?.stat?.avgCost ?? chips.current?.avgCost;
    if (avgCost > min && avgCost < max) {
      const ay = y(avgCost);
      const ink = rgba(PALETTE.textMuted, 0.88);
      // 左端贴筹码柱起点，右端延伸到筹码峰画布边沿（不留空白，也不越出 rect）
      const x0 = r.x + 4, x1 = r.x + r.w;
      for (let xx = x0; xx < x1; xx += 13) {
        line(out, xx, ay, Math.min(xx + 8, x1), ay, 1, ink);
      }
    }
    return out;
  }

  overlayText(ctx) {
    const r = this.rect;
    // 直方图模式图上不放任何标签：日期、均成本等信息统一由右侧 DOM 统计面板承载
    if (!r || !ctx.dataset?.chips || ctx.chipMode !== 'stat') return [];
    const s = chipSnapshotAt(ctx)?.stat || ctx.dataset.chips.current;
    const rows = [
      `获利比例 ${(s.profitRatio * 100).toFixed(2)}%`,
      `平均成本(COST50) ${s.avgCost.toFixed(2)}`,
      `加权均成本 ${(s.weightedAvgCost ?? 0).toFixed(2)}`,
      `90%区间 ${s.cost90Low.toFixed(2)}–${s.cost90High.toFixed(2)}`,
      `90集中度(面板) ${(s.concentration90 * 100).toFixed(2)}%`,
      `70%区间 ${s.cost70Low.toFixed(2)}–${s.cost70High.toFixed(2)}`,
      `70集中度(面板) ${(s.concentration70 * 100).toFixed(2)}%`,
    ];
    return rows.map((t, i) => ({ x: r.x + 8, y: r.y + 8 + i * 16, text: t, color: PALETTE.textMuted }));
  }
}

// 标签注册统一由 src/index.js 的 defineAll() 显式负责，本模块保持无副作用
