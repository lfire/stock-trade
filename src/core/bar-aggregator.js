// K 线多周期聚合：日 K → 周 / 月 / 季 / 年；当日分时 → 5 / 30 / 60 / 120 分钟。
// 输出与 bars_1d.json 相同的字段结构，额外带 label 供时间轴与 hover 明细显示。
export const PERIODS = [
  { key: '1d', label: '日 K', kind: 'daily' },
  { key: '5m', label: '5 分钟', kind: 'minute', size: 5 },
  { key: '30m', label: '30 分钟', kind: 'minute', size: 30 },
  { key: '60m', label: '60 分钟', kind: 'minute', size: 60 },
  { key: '120m', label: '2 小时', kind: 'minute', size: 120 },
  { key: '1w', label: '周 K', kind: 'daily' },
  { key: '1M', label: '月 K', kind: 'daily' },
  { key: '1Q', label: '季 K', kind: 'daily' },
  { key: '1Y', label: '年 K', kind: 'daily' },
];

export const PERIOD_LABEL = Object.fromEntries(PERIODS.map((p) => [p.key, p.label]));
export const periodMeta = (key) => PERIODS.find((p) => p.key === key) || PERIODS[0];

/** ISO 周（周一为一周起点），用于周 K 分组 */
function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);          // 移到本周四
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function groupOf(bar, period) {
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

function mergeBars(group, label) {
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
export function aggregateDaily(bars, period) {
  if (period === '1d' || !bars?.length) return bars || [];
  const groups = new Map();
  for (const b of bars) {
    const g = groupOf(b, period);
    if (!groups.has(g.key)) groups.set(g.key, []);
    groups.get(g.key).push(b);
  }
  const out = [];
  for (const items of groups.values()) {
    const g = groupOf(items[items.length - 1], period);   // 用组内最后一根产生标签
    out.push(mergeBars(items, g.label));
  }
  return out;
}

/**
 * 当日分时 → 分钟 K。分时数据是一分钟一个价格点，按序号每 size 个聚合成一根，
 * open/close 取首末价、high/low 取区间极值、量额求和；preClose 取上一根收盘。
 * 注意：示例数据只有当日 267 点，分钟级周期的历史深度有限。
 */
export function aggregateIntraday(series, size, manifest) {
  const pts = (series || []).filter((p) => p.time <= '15:00' && p.volume > 0);
  const out = [];
  for (let i = 0; i < pts.length; i += size) {
    const g = pts.slice(i, i + size);
    if (!g.length) break;
    const first = g[0], last = g[g.length - 1];
    let high = -Infinity, low = Infinity, volume = 0, amount = 0;
    for (const p of g) {
      high = Math.max(high, p.price);
      low = Math.min(low, p.price);
      volume += p.volume;
      amount += p.amount;
    }
    const preClose = out.length ? out[out.length - 1].close : manifest.preClose;
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
export function buildBars(dataset, period) {
  if (!dataset) return [];
  const meta = periodMeta(period);
  if (meta.kind === 'minute') return aggregateIntraday(dataset.intraday, meta.size, dataset.manifest);
  return aggregateDaily(dataset.bars, meta.key);
}
