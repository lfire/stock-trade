// 主图：K 线 / 分时双模式。
// 价格轴以昨收为中心上下对称（±涨跌幅）；0 轴画虚线并明确标注。
// 鼠标划过时，通过 crosshair 在 head 区显示时间、OHLC/分时价、均价、成交量等数值。
import { PaneElement, paneBg, axisScaleText } from './pane-base.js';
import { rgba, line, dashedH, polyline, candle, makeScale, hbar } from '../gl/geometry.js';
import { PALETTE, AXIS_GUTTER_L, AXIS_GUTTER_R } from '../types.js';
import { PERIOD_LABEL } from '../core/bar-aggregator.js';
import { adaptiveMAPeriods } from '../core/indicator-params.js';

/** 渲染器未启用 alpha 混合：按当前主题背景色预混出低饱和量能底色（帧内 PALETTE 已切到实例色板） */
const softColor = (fg, t = 0.28) => {
  const a = rgba(fg), b = rgba(PALETTE.background);
  return [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t),
    a[2] * t + b[2] * (1 - t), 1];
};

const LIMIT_LABEL = {
  limitUp: '涨停', limitDown: '跌停',
  limitUpBroken: '涨停炸板', limitDownBroken: '跌停炸板',
};

export class PricePane extends PaneElement {
  static get observedAttributes() { return ['mode', 'height']; }

  buildGeometry(ctx) {
    const r = this.rect;
    if (!r || !ctx.dataset) return [];
    const out = [];
    paneBg(out, r, 5, ctx.leftInset());
    const pr = ctx.plotRect(r);       // 数据只画在中间绘图区，左右留白放刻度
    const visible = ctx.getVisible();
    if (!visible.length) return out;
    const isIntraday = ctx.mode === 'intraday';
    // 分时模式主图底部留 18px 给统一时间轴带，数据绘图区上移（竞价列同步让出同样高度）
    const top = r.y + 10, bottom = r.y + r.h - 26;   // 两种模式都让出底部 18px 统一时间轴带
    let y;

    if (isIntraday) {
      // 半小时竖网格：分时图按 30 分钟一格划分
      const gc = rgba(PALETTE.grid);
      for (const m of ctx.halfHourMarks(r)) line(out, m.x, r.y, m.x, r.y + r.h, 1, gc);
      // 多日：日界用主色竖线区分（单日只有一根 dayStart，跳过避免重复画）
      if (ctx.isMultiDay) {
        for (const m of ctx.halfHourMarks(r)) {
          if (m.dayStart) line(out, m.x, r.y, m.x, r.y + r.h, 1.4, rgba(PALETTE.neutral));
        }
      }
      // 单日用当日昨收；多日用首日昨收作统一基准，各日价格轴/涨跌幅口径一致
      const pre = ctx.intradayBasePrice ?? ctx.dataset.manifest.preClose;
      let dev = 0;
      for (const p of visible) dev = Math.max(dev, Math.abs(p.price - pre) / pre, Math.abs(p.avgPrice - pre) / pre);
      for (const p of [...ctx.openAuction, ...ctx.closeAuction]) dev = Math.max(dev, Math.abs(p.virtualPrice - pre) / pre);
      dev = Math.max(dev * 1.05, 0.005);
      const lo = pre * (1 - dev), hi = pre * (1 + dev);
      ctx.setPriceScale({ min: lo, max: hi, pre, dev, symmetrical: true });
      y = makeScale(lo, hi, top, bottom, 0);

      const zeroY = y(pre);
      dashedH(out, pr.x, pr.x + pr.w, zeroY, 1.3, rgba(PALETTE.neutral));   // 0 轴（昨收）虚线

      // 右侧挂单量柱：把全景盘口各价位挂单量按主图 y 轴分桶聚合，
      // 从绘图区右边缘向左画半透明横柱，与价格刻度天然对齐（仅分时模式）。
      const pano = ctx.dataset.depthFull;
      if (pano && hi > lo) {
        const BINS = 64, binH = (bottom - top) / BINS;
        const maxW = Math.min(120, pr.w * 0.2);
        const bins = Array.from({ length: BINS }, () => ({ bid: 0, ask: 0 }));
        const put = (price, volume, key) => {
          const py = y(price);
          if (py < top || py > bottom) return;
          bins[Math.min(BINS - 1, Math.floor((py - top) / binH))][key] += volume;
        };
        pano.bids.forEach((d) => put(d.price, d.volume, 'bid'));
        pano.asks.forEach((d) => put(d.price, d.volume, 'ask'));
        let peak = 1;
        for (const b of bins) peak = Math.max(peak, b.bid, b.ask);
        const right = pr.x + pr.w;
        bins.forEach((b, i) => {
          const cy = top + (i + 0.5) * binH;
          const bh = Math.max(1, binH * 0.45);   // 细条：只占桶高约一半，条间留白
          // 未启用 alpha 混合，用主题涨跌色与背景预混的低饱和底色；sqrt 归一化让小档位也可见
          if (b.bid > 0) {
            const w = Math.sqrt(b.bid / peak) * maxW;
            hbar(out, right - w, cy, w, bh, softColor(PALETTE.up));
          }
          if (b.ask > 0) {
            const w = Math.sqrt(b.ask / peak) * maxW;
            hbar(out, right - w, cy, w, bh, softColor(PALETTE.down));
          }
        });
      }

      const pricePts = [], avgPts = [], dayKeys = [];
      visible.forEach((p, i) => {
        const x = ctx.xForIndex(ctx.viewport.start + i, r);
        pricePts.push([x, y(p.price)]);
        avgPts.push([x, y(p.avgPrice)]);
        dayKeys.push(p.tradeDate || ctx.dataset.manifest.tradeDate);
      });
      // 多日：日界处断开折线，避免把「前日收盘 → 次日开盘」画成一根垂直连线
      const drawSegments = (pts, width, color) => {
        let seg = [];
        for (let i = 0; i < pts.length; i += 1) {
          if (i > 0 && dayKeys[i] !== dayKeys[i - 1]) {
            if (seg.length > 1) polyline(out, seg, width, color);
            seg = [];
          }
          seg.push(pts[i]);
        }
        if (seg.length > 1) polyline(out, seg, width, color);
      };
      drawSegments(pricePts, 1.6, rgba(PALETTE.chipLoss));
      drawSegments(avgPts, 1.4, rgba(PALETTE.avg));
    } else {
      let lo = Infinity, hi = -Infinity;
      for (const b of visible) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); }
      // 均线由 ChartContext.maConfig 驱动，可任意添加 / 改周期 / 改颜色
      // 高周期根数少时缩短 MA 周期，保证均线不会全为 null（信息栏同步显示实际参数）
      const barsAll = ctx.getBars();
      const maPeriods = adaptiveMAPeriods(ctx.maConfig.map((m) => m.period), barsAll.length);
      const maSeries = maPeriods.map((n, i) => ({
        period: n,
        color: ctx.maConfig[i]?.color || ctx.maConfig[ctx.maConfig.length - 1]?.color || PALETTE.avg,
        data: ctx.compute.indicator('MA', barsAll, { n }).values,
      }));
      for (const s of maSeries) {
        for (const v of s.data.slice(ctx.viewport.start, ctx.viewport.end)) {
          if (v.value == null) continue;
          lo = Math.min(lo, v.value); hi = Math.max(hi, v.value);
        }
      }
      ctx.setPriceScale({ min: lo, max: hi });
      y = makeScale(lo, hi, top, bottom);
      // 分钟级高周期可能只剩 2~4 根，限制单根最大宽度避免蜡烛被拉满整屏
      const bw = Math.min(24, Math.max(1, (pr.w / ctx.visibleCount()) * 0.68));
      visible.forEach((b, i) => {
        const gi = ctx.viewport.start + i;
        const x = ctx.xForIndex(gi, r);
        // 涨停 / 跌停 / 炸板各用独立颜色，普通 K 线仍按红涨绿跌
        const color = b.limitState
          ? PALETTE[b.limitState]
          : (b.close >= b.open ? PALETTE.up : PALETTE.down);
        candle(out, x, y(b.open), y(b.close), y(b.high), y(b.low),
          b.limitState ? bw * 1.3 : bw, rgba(color));
      });
      for (const s of maSeries) {
        const pts = [];
        s.data.slice(ctx.viewport.start, ctx.viewport.end).forEach((v, i) => {
          if (v.value == null) return;
          pts.push([ctx.xForIndex(ctx.viewport.start + i, r), y(v.value)]);
        });
        polyline(out, pts, 1.4, rgba(s.color));
      }
    }

    if (ctx.crosshair != null) {
      const x = ctx.xForIndex(ctx.crosshair, r);
      line(out, x, r.y, x, r.y + r.h, 1, rgba(PALETTE.crosshair));   // 竖线（吸附到数据点）
    }
    // 水平十字线以鼠标为中心，与坐标轴定位标签使用同一 y
    if (ctx.pointer && ctx.pointer.y >= r.y && ctx.pointer.y <= r.y + r.h) {
      dashedH(out, pr.x, pr.x + pr.w, ctx.pointer.y, 1, rgba(PALETTE.crosshair), 8, 5);
    }
    return out;
  }

  /** 由鼠标 y 反算价格与涨跌幅，供坐标轴上的定位标签使用 */
  axisValueAt(py, ctx) {
    const r = this.rect;
    if (!r || !(ctx.priceScale?.max > ctx.priceScale?.min)) return null;
    const { min, max, pre } = ctx.priceScale;
    const pad = ctx.mode === 'candle' ? 0.08 : 0;
    const top = r.y + 10, bottom = r.y + r.h - 26;
    const lo = min - (max - min) * pad, hi = max + (max - min) * pad;
    const v = hi - ((py - top) / (bottom - top)) * (hi - lo);
    return { price: v, pct: pre ? ((v - pre) / pre) * 100 : null };
  }

  overlayText(ctx) {
    const r = this.rect;
    if (!r || !ctx.dataset) return [];
    const m = ctx.dataset.manifest;
    const idx = ctx.crosshair;
    const item = idx != null ? ctx.getSeries()[idx] : null;
    const last = ctx.getSeries()[ctx.viewport.end - 1];
    const shown = item || last;
    const ap0 = ctx.auctionHover != null ? ctx.openAuction?.[ctx.auctionHover] : null;
    const cp0 = ctx.closingHover != null ? ctx.closeAuction?.[ctx.closingHover] : null;
    const seg = ap0 || cp0;
    const shownDate = shown?.tradeDate || m.tradeDate;   // 多日分时用光标所在交易日
    const date = seg ? `${shownDate} ${seg.time}`
      : (shown ? (ctx.mode === 'candle' ? (shown.label || shown.tradeDate) : `${shownDate} ${shown.time}`) : m.tradeDate);

    // 结构化字段：日期时间只在标题行出现一次；指标拆成固定槽位 + 等宽数字，
    // hover 时只更新数值、不重建结构，避免整段文本重排造成跳动。
    // 复权方式取自 manifest.adjust，不再把「前复权」写死（换后复权/不复权数据集自动跟随）
    const adjustLabel = { qfq: '前复权', hfq: '后复权', none: '不复权' }[ctx.dataset?.manifest?.adjust] || '';
    const modeLabel = ctx.mode === 'candle'
      ? `K线${adjustLabel ? `(${adjustLabel})` : ''} · ${PERIOD_LABEL[ctx.period]}`
      : (ctx.isMultiDay ? `多日分时 · ${ctx.getIntradayDays()} 日` : '分时');
    // K 线：每条均线在光标处（无光标取最后一根）的实时值，颜色沿用该均线配置
    const maBars = ctx.getBars();
    const maAt = ctx.crosshair ?? (maBars.length - 1);
    const maValues = ctx.mode === 'candle'
      ? adaptiveMAPeriods(ctx.maConfig.map((x) => x.period), maBars.length).map((n, i) => {
        const cfg = ctx.maConfig[i] || {};
        const v = ctx.compute.indicator('MA', maBars, { n }).values[maAt];
        return {
          label: `MA${n}`, value: v?.value != null ? v.value.toFixed(2) : '—',
          color: cfg.color || PALETTE.text,
        };
      }) : [];
    const fmtQty = (v) => v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿股`
      : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万股` : `${v.toLocaleString('zh-CN')}股`;
    const fmtMoney = (a) => a >= 1e8 ? `${(a / 1e8).toFixed(2)}亿`
      : a >= 1e4 ? `${(a / 1e4).toFixed(1)}万` : `${Math.round(a)}`;
    let metrics = [], note = '';
    if (ap0 || cp0) {
      const p = ap0 || cp0;
      note = ap0 ? '集合竞价' : '尾盘竞价';
      metrics = [
        { label: '虚拟撮合价', value: p.virtualPrice.toFixed(2) },
        { label: '匹配量', value: `${p.matchedQty}手` },
        { label: '未匹配量', value: `${p.unmatchedQty}手` },
      ];
    } else if (ctx.mode === 'candle') {
      // K 线七项明细：开 / 高 / 低 / 量比 / 换手 / 成交量 / 成交额
      // 收盘价与涨跌幅已由第一行的强调报价承担，明细里不再重复
      const b = item || last;
      const vr = ctx.compute.indicator('VOL_RATIO', maBars, { n: 5 }).values[maAt]?.value;
      metrics = [
        { label: '开', value: b.open.toFixed(2) },
        { label: '高', value: b.high.toFixed(2) },
        { label: '低', value: b.low.toFixed(2) },
        { label: '日量比', value: vr != null ? vr.toFixed(2) : '—' },
        { label: '换', value: `${(b.volume / m.floatShares * 100).toFixed(2)}%` },
        { label: '量', value: fmtQty(b.volume) },
        { label: '额', value: fmtMoney(b.amount ?? 0) },
      ];
      note = !item ? '最新 · 划过图表查看明细' : (b.limitState ? LIMIT_LABEL[b.limitState] : '');
    } else {
      // 分时六项明细：今日最高 / 最低 / 均价 / 成交量 / 成交额 / 换手率（换手按当日累计成交量算）
      const p = item || last;
      // 今日高/低取当日日 K 的 high/low：它含盘中瞬时极值与集合竞价，
      // 比按每分钟分时点取 max/min 更贴近行情软件显示的当日最高/最低价。
      const daily = ctx.dataset?.bars || [];
      // 多日时「今日高/低」应对应光标所在交易日，而不是数据集最后一天
      const pointDate = p.tradeDate || m.tradeDate;
      const today = ctx.isMultiDay && pointDate
        ? (daily.find((b) => b.tradeDate === pointDate) || daily[daily.length - 1] || {})
        : (daily[daily.length - 1] || {});
      metrics = [
        { label: '高', value: (today.high ?? m.close).toFixed(2) },
        { label: '低', value: (today.low ?? m.close).toFixed(2) },
        { label: '均', value: (p.avgPrice ?? m.close).toFixed(2) },
        { label: '量', value: fmtQty(p.volume ?? 0) },
        { label: '额', value: fmtMoney(p.amount ?? 0) },
        { label: '换', value: `${((p.cumulativeVolume ?? 0) / m.floatShares * 100).toFixed(2)}%` },
      ];
      if (!item) note = '最新 · 划过图表查看明细';
    }
    // 强调报价：当前价 / 涨跌额 / 涨跌幅，随光标实时联动
    const qBase = item || last;
    const quote = ctx.mode === 'candle'
      ? (() => {
        const chg = qBase.change ?? 0;
        return { price: qBase.close.toFixed(2), change: chg, pct: qBase.pctChg ?? 0, up: chg >= 0 };
      })()
      : (() => {
        const base = ctx.intradayBasePrice ?? m.preClose;   // 多日按首日昨收计算累计涨跌幅
        const px = qBase.price ?? m.close, chg = px - base;
        return { price: px.toFixed(2), change: chg, pct: chg / base * 100, up: chg >= 0 };
      })();
    // 四色涨跌停图例改由头部 DOM 渲染，不再画在主图左上角
    const legend = ctx.mode === 'candle' && ctx.period === '1d' ? [
      { text: '涨停', color: PALETTE.limitUp },
      { text: '跌停', color: PALETTE.limitDown },
      { text: '涨停炸板', color: PALETTE.limitUpBroken },
      { text: '跌停炸板', color: PALETTE.limitDownBroken },
    ] : [];
    ctx.emit('head-change', {
      name: m.name, symbol: m.symbol, modeLabel, datetime: date,
      maValues, legend, metrics, quote, note, active: !!(item || seg),
    });
    const width = ctx.plotWidth(r);   // 分时模式避开右端尾盘竞价段
    if (ctx.mode === 'candle') {
      const { min, max } = ctx.priceScale;
      // K 线时间轴：可见区间等分取 5 档，显示当前周期的 label（周/月/季/年/分钟）
      const bars = ctx.getBars();
      const kpr = ctx.plotRect(r);
      const ktimes = [];
      for (let i = 0; i <= 5; i += 1) {
        const bi = Math.min(bars.length - 1,
          ctx.viewport.start + Math.round((ctx.visibleCount() - 1) * i / 5));
        const bar = bars[bi];
        if (!bar) continue;
        const x = ctx.xForIndex(bi, r);
        const text = ctx.period === '1d' ? bar.tradeDate.slice(5) : (bar.label || bar.tradeDate.slice(5));
        const tx = Math.max(kpr.x + 2, Math.min(kpr.x + kpr.w - 50, x - 24));
        ktimes.push({ x: tx, y: r.y + r.h - 16, text, color: PALETTE.textMuted });
      }
      // K 线：左右都显示价格刻度
      return [...ktimes,
        ...axisScaleText(r, r.w, min, max, { count: 5, rightWidth: 58 })];
    }
    const { min, max, pre } = ctx.priceScale;
    // 时间轴统一基线 y=mainH-14：竞价段 9:15/9:20、连续竞价半小时刻度、收盘 15:00 同一行。
    // 9:30 左对齐贴绘图区起点（避开竞价列 9:20），11:30/13:00 长文本居中，15:00 右对齐贴右端。
    const times = [];
    const pr = ctx.plotRect(r);
    if (ctx.isMultiDay) {
      // 多日：只在每个交易日起点标日期（MM/DD），避免 5 日重复半小时标签挤成一团
      for (const m of ctx.halfHourMarks(r)) {
        if (!m.dayStart) continue;
        const d = String(m.tradeDate || '');
        times.push({ x: m.x + 4, y: r.y + r.h - 16, text: d.slice(5), color: PALETTE.textMuted });
      }
    } else {
      for (const m of ctx.halfHourMarks(r)) {
        if (m.time === '13:00') continue;
        const text = m.time === '11:30' ? '11:30/13:00' : m.time;
        const x = m.time === '09:30' ? pr.x + 4
          : (m.time === '11:30' ? m.x - 32 : m.x - 14);
        times.push({ x, y: r.y + r.h - 16, text, color: PALETTE.textMuted });
      }
      times.push({ x: pr.x + pr.w - 34, y: r.y + r.h - 16, text: '15:00', color: PALETTE.textMuted });
    }
    const pctFmt = (v) => {
      const p = ((v - pre) / pre) * 100;
      return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
    };
    // 分时：左边价格刻度、右边百分比刻度（0 轴居中单独标注）
    return [...times,
      ...axisScaleText(r, width, min, max, {
        count: 5, leftX: AXIS_GUTTER_L - 6, rightFmt: pctFmt, skipLeftLast: true,   // 左刻度右对齐全局栏右边缘
        rightColor: (v) => (v > pre + 1e-6 ? PALETTE.up : (v < pre - 1e-6 ? PALETTE.down : PALETTE.textMuted)),
      }),
      { x: r.x + r.w - AXIS_GUTTER_R + 6, y: r.y + r.h / 2 - 6, text: '0.00%', color: PALETTE.textMuted },
    ];
  }
}

// 标签注册统一由 src/index.js 的 defineAll() 显式负责，本模块保持无副作用
