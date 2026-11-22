// 通用指标副图：一个组件通过 indicator 属性注册 VOL / AMOUNT / MACD / KDJ / VOL_RATIO。
// 分时模式下 VOL/AMOUNT 切换为分时增量口径，其余指标仍按日线口径显示（并在标题标注）。
import { PaneElement, paneBg, axisScaleText } from './pane-base';
import { rgba, rect, line, dashedH, polyline, makeScale } from '../gl/geometry';
import { PALETTE, AXIS_GUTTER_L } from '../types';
import { adaptiveMAPeriods } from '../core/indicator-params';
import { intradayVolumeRatioSeries } from '../compute/indicators';
import { pickUnit } from '../algorithms/format';
import type { ChartContext } from '../core/chart-context';
import type { Bar, IntradayPoint, OverlayTextItem } from '../types';

interface IndicatorPoint {
  value: number | null;
  up?: boolean;
  macd?: number | null; dif?: number | null; dea?: number | null;
  k?: number; d?: number; j?: number;
  [key: string]: unknown;
}
interface IndicatorResult {
  type: string;
  values: IndicatorPoint[];
}
interface AxisState {
  lo: number; hi: number; name: string; top: number; bottom: number; pad: number;
  unit?: { d: number; u: string; dec: number };
}

export class IndicatorPane extends PaneElement {
  declare axis: AxisState | undefined;
  static get observedAttributes() { return ['indicator', 'height']; }

  buildGeometry(ctx: ChartContext) {
    const r = this.rect;
    if (!r || !ctx.dataset) return [];
    const out: number[] = [];
    // 副图加高后网格随之加密，避免只剩 1 个副图时刻度被拉得过稀
    const rows = Math.max(3, Math.min(8, Math.round(r.h / 45)));
    paneBg(out, r, rows, ctx.leftInset());
    const name = (this.getAttribute('indicator') || 'VOL').toUpperCase();
    const isIntraday = ctx.mode === 'intraday';
    // 半小时竖网格与主图共用同一组 x，保证主副图上下对齐
    if (isIntraday) {
      const gc = rgba(PALETTE.grid);
      for (const m of ctx.halfHourMarks(r)) line(out, m.x, r.y, m.x, r.y + r.h, 1, gc);
    }
    let res: IndicatorResult, vis: IndicatorPoint[];

    if (isIntraday && name === 'VOL_RATIO') {
      // 分时量比曲线：逐点按当日累计开市分钟归一化，不再拿日线序列末 N 个凑数
      const pts = ctx.getSeries() as IntradayPoint[];
      const daily = ctx.dataset?.bars || [];
      const prev5 = daily.slice(-6, -1);
      const avg5Daily = prev5.length
        ? prev5.reduce((s: number, b: Bar) => s + (b.volume || 0), 0) / prev5.length : 0;
      res = { type: 'line', values: intradayVolumeRatioSeries(pts, avg5Daily) };
      vis = res.values.slice(ctx.viewport.start, ctx.viewport.end);
    } else if (isIntraday && (name === 'VOL' || name === 'AMOUNT')) {
      const pts = ctx.getSeries() as IntradayPoint[];
      const key = name === 'VOL' ? 'volume' : 'amount';
      const pre = ctx.intradayBasePrice ?? ctx.dataset.manifest.preClose;
      res = { type: 'bar', values: pts.map((p, i) => {
        // 多日日界处不与前一日 15:00 价比，改用首日昨收兜底
        const sameDay = i > 0 && (!p.tradeDate || !pts[i - 1].tradeDate
          || p.tradeDate === pts[i - 1].tradeDate);
        return { value: p[key], up: sameDay ? p.price >= pts[i - 1].price : p.price >= pre };
      }) };
      vis = res.values.slice(ctx.viewport.start, ctx.viewport.end);
    } else {
      const bars = ctx.getBars();
      const indParams = name === 'MACD' ? ctx.getMACDParams() : {};
      res = ctx.compute.indicator(name === 'VOL_RATIO' ? 'VOL_RATIO' : name, bars, indParams) as IndicatorResult;
      vis = isIntraday
        ? res.values.slice(Math.max(0, res.values.length - ctx.visibleCount()))
        : res.values.slice(ctx.viewport.start, ctx.viewport.end);
    }
    if (!vis.length) return out;

    const top = r.y + 12, bottom = r.y + r.h - 8;
    const pr = ctx.plotRect(r);       // 数据只画在中间绘图区
    const bw = Math.min(24, Math.max(1, (pr.w / vis.length) * 0.68));
    const xAt = (i: number) => isIntraday
      ? pr.x + ((i + 0.5) / vis.length) * pr.w
      : ctx.xForIndex(ctx.viewport.start + i, r);

    if (res.type === 'bar') {
      // 量额副图叠加 MA5 / MA10 量均线（仅 K 线模式；分时增量口径不适用日线均线）
      const field = name === 'VOL' ? 'volume' : 'amount';
      const maBars = ctx.getBars();
      const maColors = [PALETTE.avg, PALETTE.chipLoss];
      const maLines = (!isIntraday && (name === 'VOL' || name === 'AMOUNT'))
        ? adaptiveMAPeriods([5, 10], maBars.length).map((n, i) => ({
          n, color: maColors[i % maColors.length],
          vals: (ctx.compute.indicator('MA', maBars, { n, field }) as IndicatorResult).values,
        }))
        : [];
      let hi = 0;
      for (const v of vis) hi = Math.max(hi, Math.abs(v.value!));
      for (const m of maLines) {
        for (const v of m.vals.slice(ctx.viewport.start, ctx.viewport.end)) {
          if (v.value != null) hi = Math.max(hi, v.value);
        }
      }
      // 分时模式第一个副图（固定为成交量）与竞价列/尾盘段共用同一纵轴上限
      if (isIntraday && name === 'VOL' && ctx.firstSubPane === this) hi = ctx.volumeScaleHi();
      const y = makeScale(0, hi || 1, top, bottom, 0.02);
      this.axis = { lo: 0, hi: hi || 1, name, top, bottom, pad: 0.02 };
      line(out, pr.x, bottom, pr.x + pr.w, bottom, 1, rgba(PALETTE.grid));   // 0 值基线，与竞价量区底线同高
      vis.forEach((v, i) => {
        const x = xAt(i);
        rect(out, x - bw / 2, y(v.value!), x + bw / 2, bottom, rgba(v.up ? PALETTE.up : PALETTE.down, 0.85));
      });
      for (const m of maLines) {
        const pts: number[][] = [];
        m.vals.slice(ctx.viewport.start, ctx.viewport.end).forEach((v: IndicatorPoint, i: number) => {
          if (v.value == null) return;
          pts.push([xAt(i), y(v.value)]);
        });
        polyline(out, pts, 1.3, rgba(m.color));
      }
    } else if (res.type === 'macd') {
      let lo = Infinity, hi = -Infinity;
      // 预热期为 null：不参与纵轴归一化，也不绘制（通达信在预热段留空）
      for (const v of vis) {
        for (const val of [v.dif, v.dea, v.macd]) {
          if (val == null || !Number.isFinite(val)) continue;
          lo = Math.min(lo, val); hi = Math.max(hi, val);
        }
      }
      if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
      const y = makeScale(lo, hi, top, bottom);
      this.axis = { lo, hi, name: 'MACD', top, bottom, pad: 0.08 };
      const zero = y(0);
      line(out, pr.x, zero, pr.x + pr.w, zero, 1, rgba(PALETTE.grid));
      vis.forEach((v, i) => {
        if (v.macd == null) return;
        const x = xAt(i);
        rect(out, x - bw / 2, Math.min(zero, y(v.macd)), x + bw / 2, Math.max(zero, y(v.macd)), rgba(v.macd >= 0 ? PALETTE.up : PALETTE.down));
      });
      for (const key of ['dif', 'dea']) {
        const pts: number[][] = [];
        vis.forEach((v, i) => { if (v[key] != null) pts.push([xAt(i), y(v[key] as number)]); });
        polyline(out, pts, 1.3, rgba(key === 'dif' ? PALETTE.avg : PALETTE.chipLoss));
      }
    } else if (res.type === 'multi-line') {
      let lo = Infinity, hi = -Infinity;
      for (const v of vis) { lo = Math.min(lo, v.k!, v.d!, v.j!); hi = Math.max(hi, v.k!, v.d!, v.j!); }
      const y = makeScale(lo, hi, top, bottom);
      this.axis = { lo, hi, name: 'KDJ', top, bottom, pad: 0.08 };
      const colors: Record<string, string> = { k: PALETTE.avg, d: PALETTE.chipLoss, j: PALETTE.up };
      for (const key of ['k', 'd', 'j']) {
        const pts = vis.map((v, i) => [xAt(i), y(v[key] as number)]);
        polyline(out, pts, 1.3, rgba(colors[key]));
      }
    } else {
      let lo = Infinity, hi = -Infinity;
      for (const v of vis) { lo = Math.min(lo, v.value!); hi = Math.max(hi, v.value!); }
      lo = Math.min(lo, 1); hi = Math.max(hi, 1);
      const y = makeScale(lo, hi, top, bottom);
      this.axis = { lo, hi, name: 'VOL_RATIO', top, bottom, pad: 0.08 };
      const one = y(1);
      line(out, pr.x, one, pr.x + pr.w, one, 1, rgba(PALETTE.grid));
      polyline(out, vis.map((v, i) => [xAt(i), y(v.value!)]), 1.5, rgba(PALETTE.chipLoss));
    }

    if (ctx.crosshair != null) {
      const x = ctx.xForIndex(ctx.crosshair, r);
      line(out, x, r.y, x, r.y + r.h, 1, rgba(PALETTE.crosshair));
    }
    // 鼠标所在副图的水平十字线以鼠标为中心
    if (ctx.pointer && ctx.pointer.y >= r.y && ctx.pointer.y <= r.y + r.h) {
      dashedH(out, pr.x, pr.x + pr.w, ctx.pointer.y, 1, rgba(PALETTE.crosshair), 8, 5);
    }
    return out;
  }

  /** 由鼠标 y 反算该副图的指标值，供坐标轴定位标签使用 */
  axisValueAt(py: number) {
    const a = this.axis;
    if (!a || !(a.bottom > a.top)) return null;
    const lo = a.lo - (a.hi - a.lo) * a.pad;
    const hi = a.hi + (a.hi - a.lo) * a.pad;
    const v = hi - ((py - a.top) / (a.bottom - a.top)) * (hi - lo);
    const u = a.unit || { d: 1, u: '', dec: 2 };
    return `${(v / u.d).toFixed(u.dec)}${u.u}`;
  }

  overlayText(ctx?: ChartContext): OverlayTextItem[] {
    const r = this.rect;
    if (!r || !ctx!.dataset) return [];
    // 指标名 / 参数 / MA5 / MA10 / 当前值统一由副图上方的信息栏展示，画布内只保留坐标刻度
    const name = (this.getAttribute('indicator') || 'VOL').toUpperCase();
    const isIntraday = ctx!.mode === 'intraday';
    const ax = this.axis;
    const axName = ax?.name || name;
    const { d, u, dec } = pickUnit(ax?.hi || 0, axName);
    if (ax) ax.unit = { d, u, dec };   // 供坐标轴定位标签复用同一缩放单位
    const tickFmt = (v: number) => (axName === 'KDJ' ? v.toFixed(0) : (v / d).toFixed(dec));
    return ax ? axisScaleText(r, ctx!.plotWidth(r), ax.lo, ax.hi, {
      count: Math.max(3, Math.min(8, Math.round(r.h / 45))),
      leftFmt: tickFmt, rightFmt: tickFmt, unit: u,
      leftX: isIntraday ? AXIS_GUTTER_L - 6 : undefined,   // 分时模式对齐全局左栏右边缘
    }) : [];
  }
}

// 标签注册统一由 src/index.ts 的 defineAll() 显式负责，本模块保持无副作用
