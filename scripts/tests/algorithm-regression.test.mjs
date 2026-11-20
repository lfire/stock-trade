/**
 * 算法数值回归测试（P0）：用一套**独立实现**的标准口径与项目函数逐根比对。
 * 基准实现写在下方、不复用项目 ema/macd/intradayVolumeRatio，避免循环论证。
 *
 * 口径来源：
 *  - 通达信/同花顺：EMA 前 N 个值取简单平均作初值、SMA(X,N,M) 递推、MACD 柱乘 2
 *  - 量比：(当日累计量/当日累计开市分钟) ÷ (前 5 日平均日量/240)，全天 240 分钟、扣 11:30–13:00 午休
 *  - 上交所交易时段：上午 9:30–11:30、下午 13:00–15:00
 * 数据：项目 src/data/bars_1d.json（600519.SH 东财前复权，935 根，截至 2026-11-13）
 *       src/data/intraday_20261113.json（腾讯分时累计量额差分，267 点）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ema, macd, kdj, volumeRatio, intradayVolumeRatio,
  elapsedMarketMinutes, intradayVolumeRatioSeries,
  aggregateIntraday, intradayBucket, PERIODS, DEFAULT_PERIOD, periodMeta, buildBars,
} from '../../dist/pure.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bars = JSON.parse(readFileSync(`${root}src/data/bars_1d.json`, 'utf8'));
const intraday = JSON.parse(readFileSync(`${root}src/data/intraday_20261113.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${root}src/data/manifest.json`, 'utf8'));
const closes = bars.map((b) => b.close);
const EPS = 1e-9;

// ---------- 独立基准（不复用项目实现） ----------
function refEma(values, n) {
  const out = new Array(values.length).fill(null);
  let acc = 0;
  for (let i = 0; i < n && i < values.length; i += 1) acc += values[i];
  if (values.length < n) return out;
  let prev = acc / n;
  out[n - 1] = prev;
  const alpha = 2 / (n + 1);
  for (let i = n; i < values.length; i += 1) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}
function refMacd(cs, fast = 12, slow = 26, signal = 9) {
  const ef = refEma(cs, fast), es = refEma(cs, slow);
  const dif = cs.map((_, i) => (ef[i] === null || es[i] === null ? null : ef[i] - es[i]));
  const start = dif.findIndex((v) => v !== null);
  const dea = new Array(cs.length).fill(null);
  if (start >= 0) {
    const tail = dif.slice(start);
    const e = refEma(tail, signal);
    for (let j = 0; j < e.length; j += 1) if (e[j] !== null) dea[start + j] = e[j];
  }
  return cs.map((_, i) => ({
    dif: dif[i], dea: dea[i],
    macd: dif[i] === null || dea[i] === null ? null : 2 * (dif[i] - dea[i]),
  }));
}
function refKdj(bs, n = 9) {
  let K = 50, D = 50;
  const out = [];
  for (let i = 0; i < bs.length; i += 1) {
    const w = bs.slice(Math.max(0, i - n + 1), i + 1);
    const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low));
    const rsv = hh === ll ? 50 : ((bs[i].close - ll) / (hh - ll)) * 100;
    // 通达信 SMA(RSV,3,1): Y = (X*1 + Y'*2)/3
    K = (rsv + K * 2) / 3;
    D = (K + D * 2) / 3;
    out.push({ k: K, d: D, j: 3 * K - 2 * D });
  }
  return out;
}
/** 独立计算累计开市分钟，不调用项目 elapsedMarketMinutes */
function refMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  const n = h * 60 + m;
  if (n <= 11 * 60 + 30) return Math.max(1, Math.min(120, n - (9 * 60 + 30)));
  if (n >= 13 * 60) return Math.max(1, 120 + Math.min(120, n - 13 * 60));
  return 120;
}
function refVolumeRatioAt(points, avg5, at) {
  const cum = points.filter((p) => p.time <= '15:00' && p.time <= at)
    .reduce((s, p) => s + (p.volume || 0), 0);
  return (cum / refMinutes(at)) / (avg5 / 240);
}
/** 独立按交易时段分桶聚合，验证每根 K 线的 OHLCV */
function refBuckets(points, size) {
  const key = (t) => {
    const [h, m] = t.split(':').map(Number);
    const n = h * 60 + m;
    const pm = n > 11 * 60 + 30 && n >= 13 * 60;
    const off = pm ? n - 13 * 60 : n - (9 * 60 + 30);
    return `${pm ? 1 : 0}:${Math.floor(Math.max(0, Math.min(off, 119)) / size)}`;
  };
  const g = new Map();
  for (const p of points) {
    if (p.time > '15:00' || !(p.volume > 0)) continue;
    const k = key(p.time);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  return [...g.values()];
}

// ---------- P0-1 EMA / MACD ----------
test('EMA：与通达信 SMA 初始化口径逐根一致（935 根 × 3 个周期）', () => {
  for (const n of [9, 12, 26]) {
    const mine = ema(closes, n), ref = refEma(closes, n);
    assert.equal(mine.length, ref.length, `n=${n} 长度`);
    for (let i = 0; i < ref.length; i += 1) {
      if (ref[i] === null) assert.equal(mine[i], null, `n=${n} 第 ${i} 根应为预热 null`);
      else assert.ok(Math.abs(mine[i] - ref[i]) < EPS, `n=${n} 第 ${i} 根偏差 ${Math.abs(mine[i] - ref[i])}`);
    }
  }
});

test('MACD：DIF / DEA / 柱与独立基准逐根一致，预热段 null 对齐', () => {
  const mine = macd(bars), ref = refMacd(closes);
  assert.equal(mine.length, 935);
  for (let i = 0; i < ref.length; i += 1) {
    for (const k of ['dif', 'dea', 'macd']) {
      if (ref[i][k] === null) assert.equal(mine[i][k], null, `第 ${i} 根 ${k} 应为 null`);
      else assert.ok(Math.abs(mine[i][k] - ref[i][k]) < EPS,
        `第 ${i} 根 ${k}: ${mine[i][k]} vs ${ref[i][k]}`);
    }
  }
  // 关键回归点：第 25 根 DIF 必须为负（修复前为 +8.938，符号相反）
  assert.ok(mine[25].dif < 0, `第 25 根 DIF 应为负，实际 ${mine[25].dif}`);
  assert.equal(mine[0].macd, null);
  assert.ok(Math.abs(mine.at(-1).macd - ref.at(-1).macd) < EPS);
});

test('KDJ：与通达信 SMA(X,3,1) 递推零偏差', () => {
  const mine = kdj(bars), ref = refKdj(bars);
  for (let i = 0; i < bars.length; i += 1) {
    assert.ok(Math.abs(mine[i].k - ref[i].k) < EPS, `第 ${i} 根 K`);
    assert.ok(Math.abs(mine[i].d - ref[i].d) < EPS, `第 ${i} 根 D`);
    assert.ok(Math.abs(mine[i].j - ref[i].j) < EPS, `第 ${i} 根 J`);
  }
});

// ---------- P0-2 分时量比 ----------
test('分时量比：累计开市分钟边界正确', () => {
  for (const [t, expected] of [['09:30', 1], ['09:35', 5], ['10:00', 30],
    ['11:30', 120], ['13:00', 120], ['13:30', 150], ['14:30', 210], ['15:00', 240]]) {
    assert.equal(elapsedMarketMinutes(t), expected, `${t} 应为 ${expected} 分钟`);
    assert.equal(refMinutes(t), expected, `独立基准 ${t}`);
  }
});

test('分时量比：盘中随时间变化，且与独立教科书公式逐点一致', () => {
  const prev5 = bars.slice(-6, -1);
  const avg5 = prev5.reduce((s, b) => s + b.volume, 0) / prev5.length;
  const pts = intraday.filter((p) => p.time <= '15:00');
  for (const t of ['09:30', '09:35', '10:00', '10:30', '11:30', '13:30', '14:30', '15:00']) {
    const mine = intradayVolumeRatio(pts, avg5, t);
    const ref = refVolumeRatioAt(pts, avg5, t);
    assert.ok(Math.abs(mine - ref) < EPS, `${t}: ${mine} vs ${ref}`);
  }
  // 盘中不应等于收盘值（修复前组件恒为 1.2823）
  assert.ok(intradayVolumeRatio(pts, avg5, '09:35') > intradayVolumeRatio(pts, avg5, '15:00') + 1,
    '09:35 量比应显著高于全天量比');
  // 全天 240 分钟时，分时口径与日线口径代数等价
  const daily = volumeRatio(bars, 5).at(-1).value;
  assert.ok(Math.abs(intradayVolumeRatio(pts, avg5, '15:00') - daily) < 1e-6,
    '收盘量比应与日线比值一致');
});

test('分时量比曲线：逐点与独立公式一致', () => {
  const prev5 = bars.slice(-6, -1);
  const avg5 = prev5.reduce((s, b) => s + b.volume, 0) / prev5.length;
  const pts = intraday.filter((p) => p.time <= '15:00');
  const series = intradayVolumeRatioSeries(pts, avg5);
  assert.equal(series.length, pts.length);
  let cum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    cum += pts[i].volume || 0;
    const ref = (cum / refMinutes(pts[i].time)) / (avg5 / 240);
    assert.ok(Math.abs(series[i].value - ref) < EPS, `第 ${i} 点 ${pts[i].time}`);
  }
});

// ---------- P0-3 分钟 K 时段边界 ----------
test('K 线周期：11 个选项按分钟→日→周月年排序，默认日 K', () => {
  assert.deepEqual(PERIODS.map((p) => p.key),
    ['1m', '5m', '15m', '30m', '60m', '120m', '1d', '1w', '1M', '1Q', '1Y']);
  assert.equal(DEFAULT_PERIOD, '1d');
  assert.equal(periodMeta('1d').label, '日 K');
  assert.equal(periodMeta('未定义周期').key, '1d', '未知周期应回退日 K 而非列表第一项');
  assert.equal(periodMeta('120m').label, '120 分钟');
  for (const m of ['1m', '5m', '15m', '30m', '60m', '120m']) {
    assert.equal(periodMeta(m).kind, 'minute', m);
    assert.ok(periodMeta(m).size > 0, m);
  }
  for (const d of ['1d', '1w', '1M', '1Q', '1Y']) assert.equal(periodMeta(d).kind, 'daily', d);
});

test('K 线周期：日/周/月/季/年聚合根数递减且合法', () => {
  const ds = { bars, intraday, manifest };
  const counts = ['1d', '1w', '1M', '1Q', '1Y'].map((k) => buildBars(ds, k).length);
  assert.deepEqual(counts, [935, 198, 47, 16, 4]);
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i] < counts[i - 1]);
});

test('分钟 K：1m/5m/15m/30m/60m/120m 根数正确且无跨午休 K 线', () => {
  for (const [size, expected] of [[1, 238], [5, 48], [15, 16], [30, 8], [60, 4], [120, 2]]) {
    const out = aggregateIntraday(intraday, size, manifest);
    assert.equal(out.length, expected, `${size}m 应 ${expected} 根，实际 ${out.length}`);
    const groups = refBuckets(intraday, size);
    assert.equal(groups.length, expected, `独立基准 ${size}m`);
    for (let i = 0; i < out.length; i += 1) {
      const g = groups[i];
      const crossesNoon = g.some((p) => p.time <= '11:30') && g.some((p) => p.time >= '13:00');
      assert.ok(!crossesNoon, `${size}m 第 ${i} 根跨午休：${g[0].time}~${g.at(-1).time}`);
      assert.equal(out[i].open, g[0].price, `${size}m 第 ${i} 根 open`);
      assert.equal(out[i].close, g.at(-1).price, `${size}m 第 ${i} 根 close`);
      assert.equal(out[i].volume, g.reduce((s, p) => s + p.volume, 0), `${size}m 第 ${i} 根 volume`);
    }
  }
});

test('分钟 K：11:30 与 15:00 收盘点归入所在时段最后一根', () => {
  assert.equal(intradayBucket('11:29', 30), intradayBucket('11:30', 30));
  assert.equal(intradayBucket('14:59', 30), intradayBucket('15:00', 30));
  assert.notEqual(intradayBucket('11:30', 30), intradayBucket('13:00', 30));
  const out = aggregateIntraday(intraday, 30, manifest);
  assert.equal(out.filter((b) => b.label >= '09:30' && b.label <= '11:30').length, 4, '上午 4 根');
  assert.equal(out.filter((b) => b.label >= '13:00' && b.label <= '15:00').length, 4, '下午 4 根');
});
