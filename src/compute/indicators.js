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

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i += 1) {
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
  const dif = closes.map((_, i) => ef[i] - es[i]);
  const dea = ema(dif, signal);
  return bars.map((b, i) => ({
    time: b.timestamp,
    dif: dif[i],
    dea: dea[i],
    macd: 2 * (dif[i] - dea[i]),
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

/** 量比（日线近似口径）：当日成交量 ÷ 前 N 日平均成交量。分时段口径需另用分钟数据。 */
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
