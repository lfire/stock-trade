#!/usr/bin/env node
// 把 .tmp-raw/ 的公开数据归一化成稳定的示例 case；抓不到的部分按固定种子做确定性 mock。
// 输出严格遵循 docs/01、docs/02、docs/03 定义的统一数据结构。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAuction, makeOrderBook } from './auction-match.mjs';
import { limitRateFor, limitStateOf } from './limit-rules.mjs';

const SYMBOL = '600519.SH';
const NAME = '贵州茅台';
const LIMIT_RATE = limitRateFor(SYMBOL, NAME);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, '.tmp-raw');
const dataDir = path.join(root, 'src', 'data');
const rawCopyDir = path.join(dataDir, 'raw');
mkdirSync(dataDir, { recursive: true });
mkdirSync(rawCopyDir, { recursive: true });

const TRADE_DATE = '2026-11-13';   // 固定历史完整交易日，避免「当日进行中」数据导致 case 不稳定
/** 筹码模型参数可通过 CLI 覆写：npm run data -- --chips-decay=2 --chips-shape=uniform */
const cliArg = (key, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.slice(hit.indexOf('=') + 1) : fallback;
};
const numArg = (key, fallback, min, max) => {
  const v = Number(cliArg(key, fallback));
  return Number.isFinite(v) && v >= min && v <= max ? v : Number(fallback);
};
const CHIPS_OPTS = Object.freeze({
  bins: Math.round(numArg('chips-bins', 150, 20, 500)),
  lookback: Math.round(numArg('chips-lookback', 120, 20, 1000)),
  decay: numArg('chips-decay', 1, 0.1, 10),
  shape: cliArg('chips-shape', 'triangular') === 'uniform' ? 'uniform' : 'triangular',
});
const r2 = (n) => Math.round(n * 100) / 100;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const readJson = (f) => JSON.parse(readFileSync(path.join(rawDir, f), 'utf8'));
const has = (f) => { try { return readFileSync(path.join(rawDir, f), 'utf8').length > 0; } catch { return false; } };

// 固定种子 PRNG，保证每次生成的 mock 完全一致
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261113);

const notes = [];

// ---------------------------------------------------------------- 1. 日 K
function buildBars() {
  const klines = readJson('em_kline_qfq.json').data.klines;
  const rows = klines.filter((line) => line.slice(0, 10) <= TRADE_DATE);
  const bars = rows.map((line) => {
    const [date, o, c, h, l, vol, amt, amp, pct, chg, turn] = line.split(',');
    const close = Number(c);
    const change = Number(chg);
    return {
      timestamp: Date.parse(`${date}T00:00:00Z`),   // UTC 毫秒，日线取交易日 00:00 UTC
      tradeDate: date,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close,
      preClose: r2(close - change),                 // 前复权口径下与 change 自洽
      volume: Number(vol) * 100,                    // 手 -> 股
      amount: Number(amt),                          // 元
      turnoverRate: Number(turn),                   // %
      amplitude: Number(amp),                       // %
      pctChg: Number(pct),                          // %
      change,
      limitState: '',                               // 涨停/跌停/炸板状态，见下方注入逻辑
    };
  });

  // 按比例（由代码/名称识别板块）与 0.01 元最小变动单位判定，容差固定 0.011 元
  bars.forEach((b) => { b.limitState = limitStateOf(b, LIMIT_RATE); });

  // 真实 935 根里几乎无跌停/跌停炸板，为让四种配色都可见，在中段 4 个交易日拟真注入形态。
  // 只改这 4 根的 OHLC 与派生字段，并同步其后一根的 preClose 链条，保持数据自洽。
  // 落在默认 viewport（最后 120 根）内，且避开末根（分时/筹码/竞价都依赖末根）
  const samples = [
    { idx: bars.length - 95, state: 'limitUp' },
    { idx: bars.length - 75, state: 'limitDown' },
    { idx: bars.length - 55, state: 'limitUpBroken' },
    { idx: bars.length - 35, state: 'limitDownBroken' },
  ];
  for (const { idx, state } of samples) {
    const b = bars[idx];
    const pre = b.preClose;
    const up = r2(pre * (1 + LIMIT_RATE)), down = r2(pre * (1 - LIMIT_RATE));
    let o, h, l, c;
    if (state === 'limitUp') { o = r2(pre * 1.012); l = r2(pre * 0.994); h = up; c = up; }
    else if (state === 'limitDown') { o = r2(pre * 0.988); h = r2(pre * 1.006); l = down; c = down; }
    else if (state === 'limitUpBroken') { o = r2(pre * 1.008); l = r2(pre * 0.992); h = up; c = r2(pre * 1.052); }
    else { o = r2(pre * 0.992); h = r2(pre * 1.008); l = down; c = r2(pre * 0.948); }
    Object.assign(b, {
      open: o, high: h, low: l, close: c, limitState: state,
      change: r2(c - pre),
      pctChg: r2(((c - pre) / pre) * 100),
      amplitude: r2(((h - l) / pre) * 100),
      amount: r2((b.volume * (h + l + c)) / 3),
    });
    const next = bars[idx + 1];
    if (next) {
      next.preClose = c;
      next.change = r2(next.close - c);
      next.pctChg = r2(((next.close - c) / c) * 100);
      next.amplitude = r2(((next.high - next.low) / c) * 100);
      next.limitState = limitStateOf(next, LIMIT_RATE);
    }
  }
  notes.push(`日 K：东方财富 push2his kline（fqt=1 前复权）真实数据 ${klines.length} 根，剔除 ${TRADE_DATE} 之后未完成的当日 K 线，保留 ${bars.length} 根。`);
  notes.push(`涨跌停状态：按代码/名称识别板块确定比例（本例 600519.SH 沪市主板 ${(LIMIT_RATE * 100).toFixed(0)}%），涨跌停价 = 前复权昨收 ×(1±比例) 四舍五入到 0.01 元，容差固定 0.011 元（1 个最小变动单位），不再用 0.5% 相对容差；真实序列里涨停仅 1 根、跌停与跌停炸板为 0，故在中段 4 个交易日拟真注入 涨停 / 跌停 / 涨停炸板（触板未封住）/ 跌停炸板（触板未封死）各 1 根，仅调整这 4 根 OHLC 及其派生字段并同步下一根 preClose 链条，保证四种配色在图上均可见。`);
  return bars;
}

// ---------------------------------------------------------------- 2. 分时
function buildIntraday() {
  const d = readJson('hist_intraday.json').data.sh600519.data;
  const date = String(d.date);                     // 20261113
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  let prevVol = 0, prevAmt = 0;
  const points = d.data.map((row) => {
    const [hhmm, price, cumVol, cumAmt] = row.trim().split(/\s+/);
    const cv = Number(cumVol), ca = Number(cumAmt);
    const hh = hhmm.slice(0, 2), mm = hhmm.slice(2);
    const t = `${hh}:${mm}`;
    const n = Number(hhmm);
    const session = n <= 1130 ? 'morning' : n <= 1500 ? 'afternoon' : 'afterHours';
    const p = {
      timestamp: Date.parse(`${iso}T${t}:00+08:00`),
      time: t,
      price: Number(price),
      avgPrice: r2(ca / (cv * 100)),               // 累计额 / (累计量(手) × 100)
      volume: Math.max(0, cv - prevVol) * 100,     // 每分钟增量，股
      amount: r2(Math.max(0, ca - prevAmt)),       // 每分钟增量，元
      cumulativeVolume: cv * 100,
      cumulativeAmount: r2(ca),
      session,
    };
    prevVol = cv; prevAmt = ca;
    return p;
  });
  notes.push(`分时：腾讯 minute/query 在 ${iso} 的真实完整交易日数据 ${points.length} 点（上午 121 + 下午 121 + 盘后 25）。腾讯返回累计量额，已差分为每分钟增量并按「累计额 ÷ (累计量 × 100)」还原均价。`);
  return { iso, points };
}

// ---------------------------------------------------------------- 3. 筹码峰（由真实日 K 计算）
function summarize(grid, ratios, close) {
  const at = (q) => {
    let cum = 0;
    for (let i = 0; i < grid.length; i += 1) { cum += ratios[i]; if (cum >= q) return grid[i]; }
    return grid[grid.length - 1];
  };
  const profitRatio = ratios.reduce((s, r, i) => s + (grid[i] <= close ? r : 0), 0);
  // 加权平均成本 = Σ(价格档 × 该档筹码占比) / Σ占比，与中位数 avgCost 是两个概念
  let wr = 0, wsum = 0;
  for (let i = 0; i < grid.length; i += 1) { wr += ratios[i]; wsum += ratios[i] * grid[i]; }
  const c90l = at(0.05), c90h = at(0.95), c70l = at(0.15), c70h = at(0.85);
  return {
    profitRatio: r6(profitRatio),
    avgCost: at(0.5),
    weightedAvgCost: wr > 0 ? r2(wsum / wr) : 0,
    cost90Low: c90l, cost90High: c90h,
    concentration90: r6((c90h - c90l) / (c90h + c90l)),
    cost70Low: c70l, cost70High: c70h,
    concentration70: r6((c70h - c70l) / (c70h + c70l)),
  };
}

function buildChips(bars, opts = {}) {
  const BINS = opts.bins ?? 150;
  const LOOKBACK = opts.lookback ?? 120;
  const DECAY = opts.decay ?? 1;                 // 历史换手衰减系数 n（通达信默认 1，范围 0.1–10）
  const SHAPE = opts.shape ?? 'triangular';      // 'triangular' | 'uniform'（平均分布）
  const win = bars.slice(-LOOKBACK);
  const lo = Math.min(...win.map((b) => b.low)) * 0.98;
  const hi = Math.max(...win.map((b) => b.high)) * 1.02;
  const step = (hi - lo) / BINS;
  const priceGrid = Array.from({ length: BINS }, (_, i) => r2(lo + (i + 0.5) * step));
  const stock = new Float64Array(BINS);
  const stats = [], histograms = [];
  win.forEach((b) => {
    const turn = Math.min(Math.max((b.turnoverRate / 100) * DECAY, 0), 1);
    for (let i = 0; i < BINS; i += 1) stock[i] *= (1 - turn);   // 存量筹码按换手率×衰减系数折损
    // 通达信三角形分布的峰在「当日成交均价（成交额/成交量）」，不是四价算术均值；
    // 一字板/金额缺失时回退四价均价，并始终把峰 clamp 在当日 [low, high] 内。
    const vwap = b.amount > 0 && b.volume > 0
      ? b.amount / b.volume : (b.open + b.close + b.high + b.low) / 4;
    const peak = Math.max(b.low, Math.min(b.high, vwap));
    const w = new Float64Array(BINS);
    let sum = 0;
    for (let i = 0; i < BINS; i += 1) {
      const p = priceGrid[i];
      if (p < b.low || p > b.high) continue;
      let v;
      if (SHAPE === 'uniform') v = 1;                                   // 平均分布：当日换手量在 high~low 均摊
      else if (b.high === b.low) v = Math.abs(p - b.high) < step ? 1 : 0;   // 一字板堆单档
      else if (p <= peak) v = (p - b.low) / (peak - b.low || step);
      else v = (b.high - p) / (b.high - peak || step);
      w[i] = Math.max(0, v); sum += w[i];
    }
    if (sum > 0) for (let i = 0; i < BINS; i += 1) stock[i] += (turn * w[i]) / sum;
    let total = 0; for (let i = 0; i < BINS; i += 1) total += stock[i];
    total = total || 1;
    const ratios = Array.from(stock, (v) => r6(v / total));
    stats.push({ date: b.tradeDate, ...summarize(priceGrid, ratios, b.close) });
    // 全回看窗口每天都存一份直方图，供 K 线 hover 按历史交易日联动筹码峰
    histograms.push({ date: b.tradeDate, ratios });
  });
  notes.push(`筹码峰：公开接口（东财 cyq）多次空响应，改为基于真实日 K + 换手率按${SHAPE === 'uniform' ? '平均' : '三角形'}成本分布模型自行计算；三角分布峰值取当日成交均价（成交额/成交量，一字板回退四价均价），价格域 ${BINS} 档、回看 ${LOOKBACK} 日、历史换手衰减系数 ${DECAY}，存量按 (1-换手率×衰减系数) 折损。分位数取 COST(5/95/15/85/50)，集中度 =(高-低)/(高+低) 为同花顺面板口径（非通达信 SCR 的再除 2 版本）。参数可用 --chips-bins / --chips-lookback / --chips-decay / --chips-shape 配置。`);
  return {
    symbol: SYMBOL, adjust: 'qfq', algorithm: `${SHAPE}-cost-distribution`,
    bins: BINS, lookback: LOOKBACK, priceGrid,
    peakSource: 'vwap', decay: DECAY, shape: SHAPE,
    concentrationBasis: 'panel (high-low)/(high+low), not SCR/2',
    dates: stats.map((s) => s.date), stats, histograms,
    current: stats[stats.length - 1],
    currentHistogram: histograms[histograms.length - 1],
  };
}

// 竞价图节点口径（开盘 / 尾盘共用）：同花顺等终端每 9 秒一个撮合结果节点。
// 开盘 10 分钟 → 69 点（每 5 分钟 33×9s + 1×3s）；尾盘 3 分钟 → 21 点（180s/9s + 1）。
const AUCTION_STEP_SEC = 9;

// ---------------------------------------------------------------- 4. 集合竞价（mock）
function buildAuction(bars, intraday, iso) {
  // 真实锚点（来自同一交易日的真实日 K / 分时数据），竞价 mock 必须与之闭合
  const last = bars[bars.length - 1];
  const openPrice = last.open;                    // 9:25 真实开盘价 1404.00
  const preClose = last.preClose;                 // 真实昨收 1410.27
  const firstTick = intraday[0];                  // 09:30 首点，其量额即 9:25 集合竞价成交量
  const realVolume = firstTick.volume;            // 股
  const realAmount = firstTick.amount;            // 元
  const realLots = realVolume / 100;              // 手（虚拟匹配量单位）

  // 同花顺等终端竞价图口径：每 9 秒一个撮合结果节点，9:15:00–9:25:00 共 69 点。
  // 每 5 分钟 = 33 个 9 秒间隔（297 秒）+ 1 个 3 秒间隔，对齐 9:20 / 9:25 整点。
  const secs = [];
  for (let s = 0; s < 300; s += AUCTION_STEP_SEC) secs.push(s);            // 9:15:00..9:19:57（34 点）
  secs.push(300);                                                           // 9:20:00（3 秒间隔）
  for (let s = 300 + AUCTION_STEP_SEC; s < 600; s += AUCTION_STEP_SEC) secs.push(s); // 9:20:09..9:24:57（33 点）
  secs.push(600);                                      // 9:25:00（3 秒间隔，统一撮合）

  // 价格只在少数时刻跳变：真实竞价图是「长水平段 + 偶发跳变」，不是逐点锯齿。
  // 低开日典型路径：9:15 虚假买单托高 → 9:19:57 集中撤单跳水 → 9:20 后不可撤单缓慢收敛 → 9:25 真实开盘价。
  const priceSteps = [
    { t: 0, p: r2(preClose + 1.80) },
    { t: 54, p: r2(preClose + 1.10) },
    { t: 117, p: r2(preClose + 1.55) },
    { t: 189, p: r2(preClose + 0.40) },
    { t: 252, p: r2(preClose - 0.60) },
    { t: 297, p: r2(openPrice + 3.20) },   // 9:19:57 撤单陷阱
    { t: 300, p: r2(openPrice + 2.60) },   // 9:20:00 不可撤单
    { t: 369, p: r2(openPrice + 1.90) },
    { t: 441, p: r2(openPrice + 1.10) },
    { t: 513, p: r2(openPrice + 0.55) },
    { t: 570, p: r2(openPrice + 0.20) },
    { t: 597, p: r2(openPrice + 0.08) },
    { t: 600, p: r2(openPrice) },          // 9:25:00 = 真实开盘价
  ];
  const priceAt = (sec) => {
    let p = priceSteps[0].p;
    for (const s of priceSteps) { if (s.t <= sec) p = s.p; else break; }
    return p;
  };
  // 未匹配量（手）：可撤单期大且反复，9:19:57 集中撤单后跳降，9:20 后衰减到 0
  const unmatchedSteps = [
    { t: 0, v: 1150 }, { t: 90, v: 1480 }, { t: 180, v: 1320 }, { t: 252, v: 1680 },
    { t: 297, v: 420 }, { t: 300, v: 380 }, { t: 420, v: 260 }, { t: 510, v: 140 },
    { t: 570, v: 60 }, { t: 597, v: 20 }, { t: 600, v: 0 },
  ];
  const unmatchedAt = (sec) => {
    let v = unmatchedSteps[0].v;
    for (const s of unmatchedSteps) { if (s.t <= sec) v = s.v; else break; }
    return v;
  };
  const pts = [];
  secs.forEach((sec, idx) => {
    const mm = 15 + Math.floor(sec / 60);
    const ss = sec % 60;
    const time = `09:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const isEnd = idx === secs.length - 1;            // 9:25:00 统一撮合
    const k = sec / 600;
    // 委托簿交叉中心随竞价推进收敛到真实开盘价；两侧申报量差决定未匹配量与方向。
    // 撮合价 / 匹配量 / 未匹配量全部由 matchAuction() 按上交所 3.5.2 三原则算出，不再硬编码。
    const center = priceAt(sec);
    const targetMatched = isEnd ? realLots : Math.max(1, Math.round(realLots * Math.pow(k, 1.7)));
    const gap = isEnd ? 0 : Math.max(0, unmatchedAt(sec) + Math.round((rnd() - 0.5) * 90));
    const buyBias = sec < 280;                        // 9:20 前虚假买单堆积，之后卖方堆积
    const ob = makeOrderBook(center,
      targetMatched + (buyBias ? gap : 0),
      targetMatched + (buyBias ? 0 : gap));
    const m = matchAuction(ob.bids, ob.asks, preClose);   // 开盘并列价取最接近前收
    pts.push({
      timestamp: Date.parse(`${iso}T${time}+08:00`),
      time,
      phase: 'open',
      virtualPrice: r2(m.price),
      matchedQty: m.matchedQty,
      unmatchedQty: m.unmatchedQty,
      unmatchedSide: m.unmatchedSide,
      volume: isEnd ? realVolume : 0,                 // 竞价期间「价有量无」
      amount: isEnd ? realAmount : 0,
    });
  });
  notes.push('集合竞价：历史交易日的 9:15–9:25 虚拟撮合快照属 Level-2 数据，免费公开接口无法回溯（AkShare / Tushare / Baostock / 聚宽 / 米筐 / 券商 L1 在该窗口均返回空；仅当日可通过 AKShare MCP get_stock_auction_tool 或通达信协议 get_call_auction 拉取后自行归档）。因此本数据为**锚定真实值 + 按上交所《交易规则》3.5.2 三原则撮合的示意委托簿**：虚拟撮合价 / 匹配量 / 未匹配量 / 方向全部由 `matchAuction()` 按「最大成交量 → 未成交量最小 → 最接近前收」算出，不再硬编码阶梯价或随机方向；委托簿为集中在撮合价的示意簿（L2 逐笔委托无法回溯）。①真实锚点取同一交易日的昨收 1410.27、9:25 开盘价 1404.00、9:25 集合竞价成交量/额（= 分时 09:30 首点 15000 股 / 21060000 元 = 150 手），末点与真实值精确闭合；②按同花顺终端口径生成 69 个 9 秒节点（9:15:00–9:25:00，9:19:57→9:20:00 与 9:24:57→9:25:00 各 3 秒）；③拟真行为：价格只在少数节点跳变形成长水平段（9:15 虚假买单托高 → 9:19:57 集中撤单跳水 → 9:20 后不可撤单缓慢收敛 → 9:25 真实开盘价）、虚拟匹配量单调不减且后期加速、未匹配量撤单后跳降并衰减到 0、可撤单期买方堆积(红)为主后转卖方堆积(绿)；④仅 9:25 产生成交量，其余节点「价有量无」。');
  return pts;
}

// ---------------------------------------------------------------- 4b. 尾盘（收盘）集合竞价（锚定真实 + 拟真 mock）
// 上交所自 2018-08-20 起对股票实施 14:57–15:00 收盘集合竞价（可申报、不可撤单，行情揭示同开盘集合竞价）。
// 真实分时里 14:58/14:59 成交量为 0（价有量无），15:00 一次性撮合产生收盘价与成交量 —— 与开盘竞价同理。
function buildClosingAuction(bars, intraday, iso) {
  const p1457 = intraday.find((p) => p.time === '14:57');   // 连续竞价末价
  const p1500 = intraday.find((p) => p.time === '15:00');   // 15:00 真实收盘集合竞价结果
  const startPrice = p1457.price;                          // 1434.52
  const closePrice = bars[bars.length - 1].close;          // 1435.26 = p1500.price
  const realVolume = p1500.volume;                         // 177300 股
  const realAmount = p1500.amount;                         // 254471605.07 元
  const realLots = realVolume / 100;                       // 1773 手

  // 14:57:00–15:00:00，与开盘竞价同口径每 AUCTION_STEP_SEC 秒 1 点 → 21 点（180/9 = 20 间隔）
  const TOTAL = 180;
  const baseSec = 14 * 3600 + 57 * 60;
  const secs = [];
  for (let s = 0; s <= TOTAL; s += AUCTION_STEP_SEC) secs.push(s);

  // 价格只在少数节点跳变，形成真实的长水平段；不可撤单期波动很小
  const priceSteps = [
    { t: 0, p: r2(startPrice) },
    { t: 27, p: r2(startPrice + 0.16) },
    { t: 60, p: r2(startPrice + 0.33) },
    { t: 90, p: r2(startPrice + 0.50) },
    { t: 120, p: r2(closePrice - 0.14) },
    { t: 150, p: r2(closePrice - 0.06) },
    { t: 171, p: r2(closePrice - 0.02) },
    { t: 180, p: r2(closePrice) },
  ];
  const priceAt = (sec) => {
    let p = priceSteps[0].p;
    for (const s of priceSteps) { if (s.t <= sec) p = s.p; else break; }
    return p;
  };
  // 虚拟未匹配量（手）：不可撤单，随撮合推进逐步被吸收，15:00 归零
  const unmatchedSteps = [
    { t: 0, v: 880 }, { t: 45, v: 760 }, { t: 90, v: 610 },
    { t: 120, v: 430 }, { t: 150, v: 240 }, { t: 171, v: 90 }, { t: 180, v: 0 },
  ];
  const unmatchedAt = (sec) => {
    let v = unmatchedSteps[0].v;
    for (const s of unmatchedSteps) { if (s.t <= sec) v = s.v; else break; }
    return v;
  };

  const pts = [];
  secs.forEach((sec, idx) => {
    const abs = baseSec + sec;
    const hh = Math.floor(abs / 3600), mm = Math.floor((abs % 3600) / 60), ss = abs % 60;
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const isEnd = idx === secs.length - 1;             // 15:00:00 统一撮合
    const k = sec / TOTAL;
    // 同样用三原则撮合；收盘并列价参考最近成交价（14:57 连续竞价末价）
    const center = priceAt(sec);
    const targetMatched = isEnd ? realLots : Math.max(1, Math.round(realLots * Math.pow(k, 1.5)));
    const gap = isEnd ? 0 : Math.max(0, unmatchedAt(sec) + Math.round((rnd() - 0.5) * 60));
    const ob = makeOrderBook(center, targetMatched + gap, targetMatched);  // 收盘买方堆积为主
    const m = matchAuction(ob.bids, ob.asks, startPrice);
    pts.push({
      timestamp: Date.parse(`${iso}T${time}+08:00`),
      time,
      phase: 'close',
      virtualPrice: r2(m.price),
      matchedQty: m.matchedQty,
      unmatchedQty: m.unmatchedQty,
      unmatchedSide: m.unmatchedSide,
      volume: isEnd ? realVolume : 0,
      amount: isEnd ? realAmount : 0,
    });
  });
  notes.push('尾盘竞价（收盘集合竞价 14:57–15:00）：上交所 2018-08-20 起对股票实施 3 分钟收盘集合竞价，可申报不可撤单、行情揭示同开盘集合竞价。历史虚拟撮合快照同样属 L2 无法回溯，故与开盘竞价一致采用**锚定真实 + 三原则撮合的示意委托簿**（并列价参考最近成交价 14:57 末价）：①真实锚点取 14:57 连续竞价末价 1434.52、15:00 收盘价 1435.26（= 日 K close）、15:00 集合竞价成交量 177300 股 / 254471605.07 元 = 1773 手，末点精确闭合；②按同花顺终端口径生成 21 个 9 秒节点（14:57:00–15:00:00）；③真实分时里 14:58/14:59 成交量为 0（价有量无），仅 15:00 统一撮合有量；④不可撤单期虚拟匹配量单调不减、未匹配量逐步被吸收到 0、买方堆积(红)为主。');
  return pts;
}

// ---------------------------------------------------------------- 5. 逐笔明细（mock + 真实结构）
function buildTrades(intraday, iso) {
  const trades = [];
  let seq = 0;
  const push = (time, price, volume, side, rawSide, phase, tradeCount) => {
    const [hh, mm] = time.split(':');
    trades.push({
      timestamp: Date.parse(`${iso}T${hh}:${mm}:00+08:00`),
      time, seq: seq++, price, volume, amount: r2(price * volume),
      side, rawSide, sideSource: 'mock.public-merged',
      granularity: 'merged3s', license: 'public-demo', phase, tradeCount,
    });
  };
  push('09:25:00', intraday[0].price, 15000, 'N', 'N', 'auction', 1);   // 集合竞价无主动方向
  let prev = intraday[0].price;
  const regular = intraday.filter((p) => p.session !== 'afterHours');
  for (const p of regular) {
    const n = 1 + Math.floor(rnd() * 3);              // 每分钟 1–3 条合并分笔
    const minuteVol = Math.max(100, p.volume);
    let left = minuteVol;
    for (let i = 0; i < n; i += 1) {
      const v = i === n - 1 ? left : Math.max(100, Math.round((minuteVol / n) * (0.6 + rnd() * 0.8) / 100) * 100);
      left = Math.max(0, left - v);
      const price = r2(p.price + (rnd() - 0.5) * 0.8);
      const delta = price - prev;
      const side = delta > 0.01 ? 'B' : delta < -0.01 ? 'S' : 'N';
      const rawSide = side === 'N' ? 'M' : side;      // 腾讯用 M 表示中性
      push(p.time, price, v, side, rawSide, 'continuous', 1 + Math.floor(rnd() * 5));
      prev = price;
    }
  }
  for (const p of intraday.filter((x) => x.session === 'afterHours')) {
    push(p.time, p.price, Math.max(100, p.volume), 'N', 'M', 'afterHours', 1);
  }
  notes.push(`逐笔明细：真实公开接口只给 3 秒合并分笔且为当日片段（东财 details 200 条 / 腾讯 detail 70 条，已保存在 src/data/raw/ 供对照）。为保证示例 case 完整稳定，主数据按相同的字段结构确定性 mock 全天 ${trades.length} 条，B/S/N 由价格变动推导、rawSide 用 B/S/M，granularity=merged3s。`);
  return trades;
}

// ---------------------------------------------------------------- 6. 十档盘口（mock）
function buildDepth(bars, iso) {
  const close = bars[bars.length - 1].close;
  const mk = (sign) => Array.from({ length: 10 }, (_, i) => ({
    price: r2(close + sign * (i + 1) * 0.01),
    volume: (Math.round(2 + rnd() * 40) * 100),
    orderCount: 1 + Math.floor(rnd() * 18),
  }));
  const snap = {
    timestamp: Date.parse(`${iso}T15:00:00+08:00`),
    bids: mk(-1),
    asks: mk(1),
    phaseCode: 'E',
    source: 'mock',
  };
  notes.push('十档盘口：公开盘口接口空响应，按收盘价上下各 10 档、0.01 步长确定性 mock；保留 bids/asks/orderCount/phaseCode 结构。');
  return [snap];
}

// ---------------------------------------------------------------- 执行
const bars = buildBars();
const { iso, points: intraday } = buildIntraday();
const chips = buildChips(bars, CHIPS_OPTS);
const auction = buildAuction(bars, intraday, iso);
const closingAuction = buildClosingAuction(bars, intraday, iso);
const trades = buildTrades(intraday, iso);
const depth = buildDepth(bars, iso);
const last = bars[bars.length - 1];

const manifest = {
  symbol: '600519.SH',
  name: '贵州茅台',
  market: 'CN',
  timezone: 'Asia/Shanghai',
  currency: 'CNY',
  adjust: 'qfq',
  interval: '1d',
  tradeDate: iso,
  preClose: last.preClose,
  open: last.open,
  close: last.close,
  floatShares: 1250081601,
  limitRate: LIMIT_RATE,          // 按代码/名称识别板块：主板 10% / 创业科创 20% / ST 主板 5% / 北交所 30%
  session: [{ open: '09:30', close: '11:30' }, { open: '13:00', close: '15:00' }],
  afterHours: { open: '15:01', close: '15:30' },
  palette: 'light',
  upColor: '#E24B4A',
  downColor: '#1D9E75',
  l2: {
    providers: [{ kind: 'public-merged', granularity: 'merged3s', license: 'public-demo', label: '公开合并分笔（示例）' }],
  },
  files: {
    bars: 'bars_1d.json',
    intraday: `intraday_${iso.replace(/-/g, '')}.json`,
    chips: `chips_${iso.replace(/-/g, '')}.json`,
    auction: `auction_${iso.replace(/-/g, '')}.json`,
    trades: `trades_${iso.replace(/-/g, '')}.json`,
    depth: `depth_${iso.replace(/-/g, '')}.json`,
  },
  units: { price: 'CNY', volume: 'share', amount: 'CNY', timestamp: 'UTC ms' },
  source: 'public + deterministic mock (see SOURCES.md)',
  generatedAt: '2026-11-16T09:56:00+08:00',
};

const suffix = iso.replace(/-/g, '');
const out = (name, obj) => {
  writeFileSync(path.join(dataDir, name), `${JSON.stringify(obj)}\n`);
  console.log(`  ${name.padEnd(30)} ${(JSON.stringify(obj).length / 1024).toFixed(1)} KB`);
};
out('manifest.json', manifest);
out('bars_1d.json', bars);
out(`intraday_${suffix}.json`, intraday);
out(`chips_${suffix}.json`, chips);
out(`auction_${suffix}.json`, [...auction, ...closingAuction]);   // phase: open(69) + close(21)
out(`trades_${suffix}.json`, trades);
out(`depth_${suffix}.json`, depth);

for (const f of ['em_kline_qfq.json', 'em_kline_raw.json', 'hist_intraday.json', 'hist_detail.txt', 'em_details.json', 'tx_detail.txt', 'sina_kline.json', 'av_daily.csv']) {
  if (has(f)) copyFileSync(path.join(rawDir, f), path.join(rawCopyDir, f));
}

const failed = ['em_cyq.json', 'em_depth.json'].filter((f) => !has(f));
const sourcesMd = [
  '# 示例数据来源说明',
  '',
  `固定交易日：\`${iso}\`（完整历史交易日，避免当日进行中数据导致 case 不稳定）。`,
  '',
  '## 真实公开数据（已尝试并成功采集）',
  '',
  ...notes.filter((n) => !n.includes('多次空响应') && !n.includes('空响应') && !n.includes('只给 3 秒') && !n.includes('未返回')),
  '',
  '## 采集失败 / 不足，已按合理规则确定性 mock',
  '',
  ...notes.filter((n) => n.includes('多次空响应') || n.includes('空响应') || n.includes('只给 3 秒') || n.includes('未返回')),
  '',
  `- 筹码分布接口 \`em_cyq.json\`、十档盘口接口 \`em_depth.json\` 采集结果：${failed.length ? '空响应' : '有响应但未采用'}。`,
  '- 所有 mock 使用固定种子 `mulberry32(20261113)`，重复运行 `build-sample-data.mjs` 输出完全一致。',
  '',
  '## 原始数据留档',
  '',
  '`src/data/raw/` 保存抓取到的原始响应，便于复核字段与单位；`scripts/fetch-public-data.mjs` 可重跑。',
  '',
  '## 单位与口径',
  '',
  '- 价格：元；成交量：**股**（东财返回「手」，已 ×100）；成交额：元。',
  '- 时间戳：UTC 毫秒；`tradeDate` / `time` 保留市场本地字符串，避免 `new Date()` 串日。',
  '- 复权：前复权（qfq）；`preClose = close - change`，与前复权涨跌额自洽。',
  '- 分时均价：`累计成交额 / (累计成交量(手) × 100)`，不是价格算术平均。',
  '- 集合竞价期间成交量为 0，仅 9:25 统一撮合有量；集合竞价成交方向为 `N`（无主动方向）。',
  '',
  '> 本文为工程示例数据说明，不构成投资建议；示例标的仅用于验证数据结构与组件渲染。',
  '',
].join('\n');
writeFileSync(path.join(dataDir, 'SOURCES.md'), sourcesMd);

console.log(`\n日 K ${bars.length} 根 | 分时 ${intraday.length} 点 | 筹码 ${chips.bins} 档/${chips.stats.length} 日 | 开盘竞价 ${auction.length} 点 + 尾盘竞价 ${closingAuction.length} 点 | 逐笔 ${trades.length} 条 | 盘口 ${depth.length} 快照`);
console.log('数据生成完成。');
