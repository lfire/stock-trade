// K 线多周期聚合：当日分时 → 1 / 5 / 15 / 30 / 60 / 120 分钟；日 K → 周 / 月 / 季 / 年。
// 输出与 bars_1d.json 相同的字段结构，额外带 label 供时间轴与 hover 明细显示。
import type { Bar, IntradayPoint, ChartDataset, Manifest } from '../types';
// isoWeek（周 K 分组）与 intradayBucket（分钟分桶）统一复用 algorithms/market-time 的唯一实现。
import { isoWeek, intradayBucket } from '../algorithms/market-time';
export { intradayBucket };

/** 聚合后的 K 线：与 Bar 同构，额外带时间轴 label */
interface AggregatedBar extends Bar { label?: string; }
/** 默认周期：日 K（周期列表按分钟→日→周月年排序，故不能用 PERIODS[0] 兜底） */
export const DEFAULT_PERIOD = '1d';

export const PERIODS = [
  { key: '1m', label: '1 分钟', kind: 'minute', size: 1 },
  { key: '5m', label: '5 分钟', kind: 'minute', size: 5 },
  { key: '15m', label: '15 分钟', kind: 'minute', size: 15 },
  { key: '30m', label: '30 分钟', kind: 'minute', size: 30 },
  { key: '60m', label: '60 分钟', kind: 'minute', size: 60 },
  { key: '120m', label: '120 分钟', kind: 'minute', size: 120 },
  { key: '1d', label: '日 K', kind: 'daily' },
  { key: '1w', label: '周 K', kind: 'daily' },
  { key: '1M', label: '月 K', kind: 'daily' },
  { key: '1Q', label: '季 K', kind: 'daily' },
  { key: '1Y', label: '年 K', kind: 'daily' },
];

export const PERIOD_LABEL = Object.fromEntries(PERIODS.map((p) => [p.key, p.label]));
export const periodMeta = (key: string) => PERIODS.find((p) => p.key === key)
  || PERIODS.find((p) => p.key === DEFAULT_PERIOD);

function groupOf(bar: Bar, period: string) {
  const d = bar.tradeDate;
  const y = d.slice(0, 4), m = Number(d.slice(5, 7));
  switch (period) {
    case '1w': return { key: isoWeek(d), label: `${d.slice(5, 7)}/${d.slice(8, 10)}` };
    case '1M': return { key: d.slice(0, 7), label: d.slice(0, 7) };
    case '1Q': return { key: `${y}-Q${Math.ceil(m / 3)}`, label: `${y}Q${Math.ceil(m / 3)}` };
    case '1Y': return { key: y, label: y };
    default: return { key: d, label: d };
  }
}

function mergeBars(group: Bar[], label: string): AggregatedBar {
  const first = group[0], last = group[group.length - 1];
  let high = -Infinity, low = Infinity, volume = 0, amount = 0, turnover = 0;
  for (const b of group) {
    high = Math.max(high, b.high);
    low = Math.min(low, b.low);
    volume += b.volume;
    amount += b.amount;
    turnover += b.turnoverRate || 0;
  }
  const preClose = first.preClose, close = last.close;
  return {
    timestamp: last.timestamp, tradeDate: last.tradeDate, label,
    open: first.open, high, low, close, preClose, volume, amount,
    turnoverRate: +turnover.toFixed(2),
    amplitude: +(((high - low) / preClose) * 100).toFixed(2),
    pctChg: +(((close - preClose) / preClose) * 100).toFixed(2),
    change: +(close - preClose).toFixed(2),
    limitState: '',   // 涨跌停 / 炸板是日线级别状态，聚合到周/月/季/年后不再继承
  };
}

/** 日 K → 周 / 月 / 季 / 年；period='1d' 原样返回 */
export function aggregateDaily(bars: Bar[], period: string): Bar[] {
  if (period === '1d' || !bars?.length) return bars || [];
  const groups = new Map<string, Bar[]>();
  for (const b of bars) {
    const g = groupOf(b, period);
    if (!groups.has(g.key)) groups.set(g.key, []);
    groups.get(g.key)!.push(b);
  }
  const out: AggregatedBar[] = [];
  for (const items of groups.values()) {
    const g = groupOf(items[items.length - 1], period);   // 用组内最后一根产生标签
    out.push(mergeBars(items, g.label));
  }
  return out;
}

/**
 * 当日分时 → 分钟 K。按 A 股交易时段边界分组（上午 9:30–11:30、下午 13:00–15:00 各自独立），
 * 每 size 分钟一根；上午 / 下午各 SESSION_MINUTES（120）分钟，11:30 / 15:00 的收盘点
 * 归入所在时段最后一根，绝不跨午休成根。分桶键由 algorithms/market-time 的 intradayBucket
 * 统一产生（收盘点归入该时段最后一根，保证 120 分钟恰好产出 120/size 根）。
 * open/close 取首末价、high/low 取区间极值、量额求和；preClose 取上一根收盘。
 */export function aggregateIntraday(series: IntradayPoint[], size: number, manifest: Manifest): Bar[] {
  const pts = (series || []).filter((p) => p.time <= '15:00' && p.volume > 0);
  const groups = new Map<string, IntradayPoint[]>();
  for (const p of pts) {
    const key = intradayBucket(p.time, size);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const out: AggregatedBar[] = [];
  for (const g of groups.values()) {
    const first = g[0], last = g[g.length - 1];
    let high = -Infinity, low = Infinity, volume = 0, amount = 0;
    for (const p of g) {
      high = Math.max(high, p.price);
      low = Math.min(low, p.price);
      volume += p.volume;
      amount += p.amount;
    }
    const preClose: number = out.length ? out[out.length - 1].close : manifest.preClose;
    const close = last.price, open = first.price;
    out.push({
      timestamp: last.timestamp, tradeDate: manifest.tradeDate, label: first.time,
      open, high, low, close, preClose, volume, amount,
      turnoverRate: 0,
      amplitude: +(((high - low) / preClose) * 100).toFixed(2),
      pctChg: +(((close - preClose) / preClose) * 100).toFixed(2),
      change: +(close - preClose).toFixed(2),
      limitState: '',
    });
  }
  return out;
}

/** 统一入口：按周期键生成当前 K 线序列 */
export function buildBars(dataset: ChartDataset, period: string): Bar[] {
  if (!dataset) return [];
  const meta = periodMeta(period)!;
  if (meta.kind === 'minute') return aggregateIntraday(dataset.intraday, meta.size!, dataset.manifest);
  return aggregateDaily(dataset.bars, meta.key);
}
