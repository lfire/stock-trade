#!/usr/bin/env node
// 把 .tmp-raw/ 的公开数据归一化成稳定的示例 case；抓不到的部分按固定种子做确定性 mock。
// 输出严格遵循 docs/01、docs/02、docs/03 定义的统一数据结构。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAuction, makeOrderBook } from './auction-match.mjs';
import { limitRateFor, limitStateOf } from './limit-rules.mjs';
import { r2, mulberry32 } from './shared.mjs';
import { AUCTION_STEP_SEC, SESSION, AFTER_HOURS } from '../dist/core/market-constants.js';

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
/**
 * 原始数据按「规范名 → 兼容名 → 仓库归档副本」回退：
 * 腾讯分时接口常返回空，.tmp-raw 未抓取时 src/data/raw 的归档副本仍可让 npm run data 完整重跑。
 */
const RAW_CANDIDATES = ['hist_intraday.json', 'tx_minute.json'];
const readRaw = (f) => {
  for (const dir of [rawDir, rawCopyDir]) {
    try { return readFileSync(path.join(dir, f), 'utf8'); } catch { /* 换下一个候选 */ }
  }
  return '';
};
const readJson = (f) => {
  const names = f === 'hist_intraday.json' ? RAW_CANDIDATES : [f];
  for (const name of names) {
    const text = readRaw(name);
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      // 分时归档必须含有效分钟点，空响应不能当作真实数据
      if (f !== 'hist_intraday.json' || parsed?.data?.sh600519?.data?.data?.length) return parsed;
    } catch { /* 损坏的归档换下一个候选 */ }
  }
  throw new Error(`缺少有效的原始数据 ${f}（候选：${names.join(', ')}；请运行 npm run fetch 或保留 src/data/raw 归档）`);
};
const has = (f) => { try { return readRaw(f).length > 0; } catch { return false; } };

// 固定种子 PRNG 由 scripts/shared.mjs 提供，保证每次生成的 mock 完全一致
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
      source: 'injected-demo',                 // 4 根注入形态与真实 K 线可区分
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
      tradeDate: iso,                            // 多日分时按此字段分日；单日数据同样携带，保持契约一致
      source: 'real-intraday',                  // 来源标注：腾讯历史分时真实数据
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

// 竞价图节点口径（开盘 / 尾盘共用）：同花顺等终端每 9 秒一个撮合结果节点；
// AUCTION_STEP_SEC 取自 market-constants.js 单一真源。
// 开盘 10 分钟 → 69 点（每 5 分钟 33×9s + 1×3s）；尾盘 3 分钟 → 21 点（180s/9s + 1）。

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
      // 9:15–9:24 虚拟撮合量绝大多数平台不做历史留存，属示意数据；仅 9:25 末点锚定真实成交
      source: isEnd ? 'anchored-real' : 'illustrative',
      priceBasis: 'SSE-3.5.2-max-volume',
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
      source: isEnd ? 'anchored-real' : 'illustrative',
      priceBasis: 'SSE-3.5.2-max-volume',
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
      side, rawSide, sideSource: 'mock.public-merged', source: 'mock',
      // 真实逐笔明细属交易所 Level-2 增值行情，需展示/非展示许可，不得自行再分发
      license: 'public-demo', requiresAuthorization: true,
      granularity: 'merged3s', phase, tradeCount,
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
    // 真实十档盘口属交易所 Level-2 增值行情，需持牌授权
    license: 'public-demo', requiresAuthorization: true,
  };
  notes.push('十档盘口：公开盘口接口空响应，按收盘价上下各 10 档、0.01 步长确定性 mock；保留 bids/asks/orderCount/phaseCode 结构。');
  return [snap];
}

// ---------------------------------------------------------------- 执行
const bars = buildBars();
const { iso, points: intraday } = buildIntraday();
const tradeDates = bars.slice(-5).map((b) => b.tradeDate);
const preCloseByDate = Object.fromEntries(bars.slice(-5).map((b) => [b.tradeDate, b.preClose]));
const auction = buildAuction(bars, intraday, iso);
const closingAuction = buildClosingAuction(bars, intraday, iso);
const trades = buildTrades(intraday, iso);
const depth = buildDepth(bars, iso);
const last = bars[bars.length - 1];
// 流通股本取自人工归档的证券资料（含来源与 asOf），不再写死在生成脚本里
const instrument = JSON.parse(readFileSync(path.join(rawCopyDir, 'instrument.json'), 'utf8'));
if (!Number.isFinite(instrument.floatShares) || instrument.floatShares <= 0) {
  throw new Error('src/data/raw/instrument.json 缺少有效的 floatShares');
}
// SOURCE_DATE_EPOCH 可固定生成时间（可复现构建）；缺省用当前 UTC 时间，不影响数据本身
const generatedAt = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();

const manifest = {
  symbol: '600519.SH',
  name: '贵州茅台',
  market: 'CN',
  timezone: 'Asia/Shanghai',
  currency: 'CNY',
  adjust: 'qfq',
  interval: '1d',
  tradeDate: iso,
  tradeDates,                     // 多日分时的交易日列表（最后一项为当日）
  preCloseByDate,                 // 各交易日昨收，多日分时按首日昨收统一价格轴
  preClose: last.preClose,
  open: last.open,
  close: last.close,
  floatShares: instrument.floatShares,
  floatSharesSource: `${instrument.source}（asOf ${instrument.asOf}）`,
  limitRate: LIMIT_RATE,          // 按代码/名称识别板块：主板 10% / 创业科创 20% / ST 主板 5% / 北交所 30%
  session: SESSION.map((s) => ({ ...s })),
  afterHours: { ...AFTER_HOURS },
  palette: 'light',
  upColor: '#E24B4A',
  downColor: '#1D9E75',
  l2: {
    providers: [{ kind: 'public-merged', granularity: 'merged3s', license: 'public-demo', label: '公开合并分笔（示例）' }],
  },
  files: {
    bars: 'bars_1d.json',
    intraday: `intraday_${iso.replace(/-/g, '')}.json`,
    auction: `auction_${iso.replace(/-/g, '')}.json`,
    trades: `trades_${iso.replace(/-/g, '')}.json`,
    depth: `depth_${iso.replace(/-/g, '')}.json`,
  },
  units: { price: 'CNY', volume: 'share', amount: 'CNY', timestamp: 'UTC ms' },
  source: 'public + deterministic mock (see SOURCES.md)',
  /**
   * 数据可获得性 / 授权边界摘要（截至 2026-11 的沪深交易规则与行情授权口径）：
   * 交易所法定公开的是日频行情表与集合竞价即时行情（参考价/匹配量/未匹配量）；
   * 分钟级分时是信息商加工产品，十档/逐笔/逐笔委托属 Level-2 增值行情需授权；
   * 筹码分布不是交易所数据，是软件估算模型。9:15–9:24 虚拟撮合量绝大多数平台不留存历史。
   */
  provenance: {
    bars: { availability: 'public-eod', source: 'real-kline + injected-demo', licensed: false },
    intraday: { availability: 'vendor-minute', source: 'real-intraday', licensed: false },
    auction: { availability: 'l1-intraday-only', source: 'illustrative + anchored-real endpoints', licensed: false },
    trades: { availability: 'level2-licensed', source: 'mock', licensed: true },
    depth: { availability: 'level2-licensed', source: 'mock', licensed: true },
  },
  generatedAt,
};

const suffix = iso.replace(/-/g, '');
const out = (name, obj) => {
  writeFileSync(path.join(dataDir, name), `${JSON.stringify(obj)}\n`);
  console.log(`  ${name.padEnd(30)} ${(JSON.stringify(obj).length / 1024).toFixed(1)} KB`);
};
out('manifest.json', manifest);
out('bars_1d.json', bars);
out(`intraday_${suffix}.json`, intraday);
out(`auction_${suffix}.json`, [...auction, ...closingAuction]);   // phase: open(69) + close(21)
out(`trades_${suffix}.json`, trades);
out(`depth_${suffix}.json`, depth);

const existsInRaw = (f) => {
  try { return readFileSync(path.join(rawDir, f), 'utf8').length > 0; } catch { return false; }
};
for (const f of ['em_kline_qfq.json', 'em_kline_raw.json', 'hist_intraday.json', 'tx_minute.json', 'hist_detail.txt', 'em_details.json', 'tx_detail.txt', 'sina_kline.json', 'av_daily.csv']) {
  // 只从 .tmp-raw 复制到 src/data/raw；归档副本不覆盖自身，也不回写抓取目录
  if (existsInRaw(f)) copyFileSync(path.join(rawDir, f), path.join(rawCopyDir, f));
}

const failed = ['em_depth.json'].filter((f) => !existsInRaw(f));
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
  `- 十档盘口接口 \`em_depth.json\` 采集结果：${failed.length ? '空响应' : '有响应但未采用'}；筹码分布不依赖公开接口，由真实日 K 在运行时派生（见下）。`,
  '- 所有 mock 使用固定种子 `mulberry32(20261113)`，重复运行 `build-sample-data.mjs` 输出完全一致；`build-order-book.mjs` 用独立种子 `mulberry32(2026111302)`。',
  '- 原始数据回退链：`.tmp-raw/hist_intraday.json`（规范名）→ `.tmp-raw/tx_minute.json`（旧名备份）→ `src/data/raw/` 归档副本。`npm run fetch` 一次抓取会同时写规范名与旧名；腾讯分时接口常返回空，归档副本保证 `npm run data` 在离线/无抓取结果时仍可完整重跑。',
  '',
  '## 运行时派生数据集（非落盘输入）',
  '',
  '以下 4 个数据集**由 src/algorithms 在运行时派生**，不再写盘为独立 JSON、也不再是输入：',
  '',
  '- `chips` ← `src/algorithms/chip-distribution.ts`（真实日 K + 换手率的成本分布估算模型）；',
  '- `intradayMulti` ← `src/algorithms/intraday-multi.ts`（末日真实分时 + 前 4 日按当日日 K 拟真，量额锚定日 K）；',
  '- `depthFull` ← `src/algorithms/order-book.ts`（由 `orders` 委托流回放聚合，前十档与 `depth` 快照闭合）；',
  '- `depthScenarios` ← `src/algorithms/depth-scenarios.ts`（普通 / 涨停 / 跌停场景）。',
  '',
  '派生入口为 `src/core/derive-dataset.ts`，以 L0 输入（bars / intraday / manifest 与 auction / trades / depth / orders 四份 Level-2 示意数据）调用上述纯函数。因此 `manifest.files` 与 `manifest.provenance` 只登记 6 个落盘输入：`bars / intraday / auction / trades / depth / orders`。',
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

console.log(`\n日 K ${bars.length} 根 | 分时 ${intraday.length} 点 | 开盘竞价 ${auction.length} 点 + 尾盘竞价 ${closingAuction.length} 点 | 逐笔 ${trades.length} 条 | 盘口 ${depth.length} 快照`);
console.log('数据生成完成（chips / intradayMulti / depthFull / depthScenarios 由 src/algorithms 运行时派生，不再落盘）。');
