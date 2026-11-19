// 指标计算（当前 TS/JS 实现）。串行递推类指标保持串行，符合 docs/03 §6.4 的并行性约束。
// 后续接入 Rust/WASM 时，只需让 WasmComputeEngine 实现同名方法，组件层不改。

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * 指数移动平均（通达信 / 同花顺 / Wind 口径）：
 * 前 N 个值取简单平均作为首个 EMA，前 N−1 根为 null（预热期不产出），
 * 之后按 α = 2/(N+1) 递推。pandas ewm(adjust=false) 的「首值冷启动」不适用于国内行情软件。
 */
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (!Number.isFinite(n) || n < 1 || values.length < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(values[i])) return out;
    sum += values[i];
  }
  let prev = sum / n;
  out[n - 1] = prev;
  const k = 2 / (n + 1);
  for (let i = n; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) return out;
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 简单移动平均；field 可指定任意数值字段（close / volume / amount …） */
export function ma(bars, n = 5, field = 'close') {
  return sma(bars.map((b) => b[field]), n);
}

/** MACD：DIF = EMA12 - EMA26，DEA = EMA9(DIF)，柱 = 2×(DIF-DEA)。串行递推，不可简单 par_iter。 */
export function macd(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  const closes = bars.map((b) => b.close);
  const ef = ema(closes, fast), es = ema(closes, slow);
  // 两条价格 EMA 都需各自的预热期；未预热的位置保持 null，不参与后续递推
  const dif = closes.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
  // DEA 只在 DIF 的有效段上做 EMA（通达信 EMA(DIF,9) 的语义），避免把前段 null 当 0 污染
  const first = dif.findIndex((v) => v != null);
  const dea = new Array(bars.length).fill(null);
  if (first >= 0) {
    const tail = dif.slice(first);
    const deaTail = ema(tail, signal);
    for (let j = 0; j < deaTail.length; j += 1) {
      if (deaTail[j] != null) dea[first + j] = deaTail[j];
    }
  }
  return bars.map((b, i) => ({
    time: b.timestamp,
    dif: dif[i],
    dea: dea[i],
    macd: dif[i] == null || dea[i] == null ? null : 2 * (dif[i] - dea[i]),
  }));
}

export function kdj(bars, n = 9) {
  const out = [];
  let k = 50, d = 50;
  for (let i = 0; i < bars.length; i += 1) {
    const from = Math.max(0, i - n + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = from; j <= i; j += 1) { hi = Math.max(hi, bars[j].high); lo = Math.min(lo, bars[j].low); }
    const rsv = hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    out.push({ time: bars[i].timestamp, k, d, j: 3 * k - 2 * d });
  }
  return out;
}

/** 量比（日线口径）：当日成交量 ÷ 前 N 日平均日成交量。分时量比请用 intradayVolumeRatio。 */
export function volumeRatio(bars, n = 5) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    if (i >= n) {
      const avg = sum / n;
      out.push({ time: bars[i].timestamp, value: avg > 0 ? bars[i].volume / avg : 1 });
    } else out.push({ time: bars[i].timestamp, value: 1 });
    sum += bars[i].volume;
    if (i >= n) sum -= bars[i - n].volume;
  }
  return out;
}

/** A 股交易时段：上午 9:30–11:30、下午 13:00–15:00，全天 240 分钟 */
const AM_START = 9 * 60 + 30, AM_END = 11 * 60 + 30;
const PM_START = 13 * 60, SESSION_MINUTES = 120, DAY_MINUTES = 240;

/** 截至某个分时时刻的累计开市分钟数（扣除 11:30–13:00 午休，最小 1 分钟） */
export function elapsedMarketMinutes(time) {
  const [h, m] = String(time || '09:30').split(':').map(Number);
  const n = (h || 0) * 60 + (m || 0);
  if (n <= AM_END) return Math.max(1, Math.min(SESSION_MINUTES, n - AM_START));
  if (n >= PM_START) return Math.max(1, SESSION_MINUTES + Math.min(SESSION_MINUTES, n - PM_START));
  return SESSION_MINUTES;   // 午休期间按上午已收盘计
}

/**
 * A 股分时量比（行情软件通行口径）：
 *   量比 = (当日累计成交量 / 当日累计开市分钟) / (前 5 日平均每分钟成交量)
 *   前 5 日平均每分钟成交量 = avg5DailyVolume / 240
 * points 的 volume 为分时增量（股）；09:30 首点已含开盘集合竞价成交，不重复计入 auction 段。
 * @param {Array} points 分时点（含 time 'HH:mm' 与 volume 增量）
 * @param {number} avg5DailyVolume 前 5 个交易日平均日成交量（与 points 同单位）
 * @param {string} [atTime] 计算时刻，默认最后一个点
 */
export function intradayVolumeRatio(points, avg5DailyVolume, atTime) {
  const pts = (points || []).filter((p) => p.time <= '15:00');
  if (!pts.length || !(avg5DailyVolume > 0)) return 1;
  const at = atTime || pts[pts.length - 1].time;
  let cum = 0;
  for (const p of pts) if (p.time <= at) cum += p.volume || 0;
  const perMinute = avg5DailyVolume / DAY_MINUTES;
  const minutes = elapsedMarketMinutes(at);
  return (cum / minutes) / perMinute;
}

/** 逐分时点生成量比曲线（供副图 VOL_RATIO 在分时模式下使用） */
export function intradayVolumeRatioSeries(points, avg5DailyVolume) {
  const pts = (points || []).filter((p) => p.time <= '15:00');
  let cum = 0;
  return pts.map((p) => {
    cum += p.volume || 0;
    const perMinute = avg5DailyVolume > 0 ? avg5DailyVolume / DAY_MINUTES : 0;
    return {
      time: p.time,
      value: perMinute > 0 ? (cum / elapsedMarketMinutes(p.time)) / perMinute : 1,
    };
  });
}

export function computeIndicator(name, bars, params = {}) {
  switch (name) {
    case 'MA': return { type: 'line', values: ma(bars, params.n || 5, params.field || 'close').map((v, i) => ({ time: bars[i].timestamp, value: v })) };
    case 'MACD': return { type: 'macd', values: macd(bars, params) };
    case 'KDJ': return { type: 'multi-line', values: kdj(bars, params.n || 9) };
    case 'VOL': return { type: 'bar', values: bars.map((b) => ({ time: b.timestamp, value: b.volume, up: b.close >= b.open })) };
    case 'AMOUNT': return { type: 'bar', values: bars.map((b) => ({ time: b.timestamp, value: b.amount, up: b.close >= b.open })) };
    case 'VOL_RATIO': return { type: 'line', values: volumeRatio(bars, params.n || 5) };
    default: throw new Error(`unknown indicator: ${name}`);
  }
}
