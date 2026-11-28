/**
 * 历史分时索引（算法单元化收口，纯计算，可在 Node / Worker 中直接 import）。
 *
 * 数据可得性边界：免费公开源只覆盖近 5 个交易日的分钟分时——传入的 intradayMulti
 * 已是这 5 日（末日真实分时、前几日按当日日 K OHLC 确定性拟真，见 ./intraday-multi）。
 * 本函数只把传入序列按 tradeDate 分组、裁到常规交易时段（<=15:00），绝不凭空生成
 * 更多日期或分钟点，也不读取任何路径 / URL。更早的历史分钟分时无免费公开源，
 * 需交易所 / 厂商授权；外部授权数据应经 ChartDataset.historicalIntraday 注入，
 * 由 deriveDataset() 原样保留、不覆盖。
 */
import type {
  Bar, IntradayPoint, Manifest, HistoricalIntradaySeries,
  AuctionPoint, TradeTick,
} from '../types';
import { buildAuctionSeries } from './auction-series';
import { buildTradeSeries } from './trade-series';
import { assignTradeOrderNos } from './trade-order-runs';

/** 单日来源：同一日的点应一致，未知值 / 混合来源一律归 custom。 */
function sourceOf(points: IntradayPoint[]): HistoricalIntradaySeries['source'] {
  const first = points[0]?.source;
  if (first !== 'real-intraday' && first !== 'simulated-from-daily-ohlc') return 'custom';
  return points.every((p) => p.source === first) ? first : 'custom';
}

/**
 * 按 tradeDate 把多日分时序列分组为 historicalIntraday 索引。
 * preClose 优先级：manifest.preCloseByDate[date] → 该日 Bar.preClose → 上一根 Bar.close → 0。
 * 纯函数：不修改入参，点对象浅拷贝、日期键只来自 intradayMulti 实际出现的交易日。
 */
export function buildHistoricalIntraday(
  intradayMulti: IntradayPoint[], bars: Bar[], manifest: Manifest,
): Record<string, HistoricalIntradaySeries> {
  // 分组：只依据传入序列里实际出现的日期，不补日期；每点截到 <=15:00 的常规交易时段。
  const groups = new Map<string, IntradayPoint[]>();
  for (const p of intradayMulti) {
    if (p.time.slice(0, 5) > '15:00') continue;
    const date = p.tradeDate ?? manifest.tradeDate;
    const point: IntradayPoint = { ...p, tradeDate: date };
    const arr = groups.get(date);
    if (arr) arr.push(point); else groups.set(date, [point]);
  }

  // 该日 Bar.preClose 及其前一根收盘价，供 preClose 兜底链使用。
  const barInfo = new Map<string, { preClose: number; prevClose: number | undefined }>();
  for (let i = 0; i < bars.length; i += 1) {
    barInfo.set(bars[i].tradeDate, {
      preClose: bars[i].preClose,
      prevClose: i > 0 ? bars[i - 1].close : undefined,
    });
  }

  const out: Record<string, HistoricalIntradaySeries> = {};
  for (const [date, points] of groups) {
    const info = barInfo.get(date);
    out[date] = {
      tradeDate: date,
      points,
      preClose: manifest.preCloseByDate?.[date]
        ?? info?.preClose
        ?? info?.prevClose
        ?? 0,
      source: sourceOf(points),
    };
  }
  return out;
}

/**
 * 选中日派生视图：把单日序列 + 全量 bars/manifest 收敛为覆盖视图所需的全部算法输出，
 * UI 层只需调用一次并消费返回值，不再现场拼装 Bar / 竞价 / 逐笔 / dataset。
 * 授权数据（series.auction / series.trades）注入优先，未注入才按该日端点现场生成示意数据。
 * 纯函数：不修改入参，dayBars 为新数组、manifest 为浅拷贝。
 */
export interface HistoricalDayView {
  dayBars: Bar[];                    // 截到该日、末根即该日
  auction: AuctionPoint[];           // series.auction ?? buildAuctionSeries(dayBars, points, date)
  trades: TradeTick[];               // series.trades ?? buildTradeSeries(points, date)
  manifest: Record<string, unknown>; // 原 manifest 浅拷贝 + preClose/tradeDate 按该日覆盖
}

export function deriveHistoricalDayView(
  series: HistoricalIntradaySeries, bars: Bar[], manifest: Manifest,
): HistoricalDayView {
  const date = series.tradeDate;
  const points = series.points;
  // 精确取该日的日 K：存在时作为真实端点来源（无对应日 K 时其值为 undefined）。
  const dayBar = bars.find((b) => b.tradeDate === series.tradeDate);
  // 截到该日：正常数据末根即该日；末根不是该日说明无对应日 K，按分时端点补造一根。
  const dayBars = bars.filter((b) => b.tradeDate <= date);
  if (dayBars[dayBars.length - 1]?.tradeDate !== date) {
    const first = points[0]?.price ?? series.preClose;
    const last = points[points.length - 1]?.price ?? first;
    // 端点 Bar 的 volume/amount 取该日分时累计量额（原实现填 0，此处改为真实累计）。
    const volume = points.reduce((sum, p) => sum + p.volume, 0);
    const amount = points.reduce((sum, p) => sum + p.amount, 0);
    dayBars.push({
      timestamp: dayBar?.timestamp ?? 0,
      tradeDate: date,
      open: first,
      close: last,
      high: Math.max(first, last),
      low: Math.min(first, last),
      preClose: dayBar?.preClose ?? series.preClose,
      volume,
      amount,
      turnoverRate: dayBar?.turnoverRate ?? 0,
      amplitude: 0,
      pctChg: 0,
      change: 0,
    });
  }
  return {
    dayBars,
    auction: series.auction ?? buildAuctionSeries(dayBars, points, date),
    // 买卖委托号：授权注入的逐笔已带号则原样保留，否则补示意号（买单 / 卖单视图使用）
    trades: assignTradeOrderNos(series.trades ?? buildTradeSeries(points, date)),
    manifest: {
      ...manifest,
      preClose: series.preClose,
      tradeDate: date,
    },
  };
}
