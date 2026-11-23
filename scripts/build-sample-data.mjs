#!/usr/bin/env node
// 把 .tmp-raw/ 的公开数据归一化成稳定的示例 case；抓不到的部分按固定种子做确定性 mock。
// 输出严格遵循统一数据结构；日 K 逐字段对齐东方财富原生 11 列，不含注入形态。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAuction, makeOrderBook } from './auction-match.mjs';
import { limitRateFor } from './limit-rules.mjs';
import { r2, mulberry32 } from './shared.mjs';
import { AUCTION_STEP_SEC, SESSION, LOT_SIZE } from '../dist/core/market-constants.js';

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
      volume: Number(vol) * LOT_SIZE,               // 手 -> 股
      amount: Number(amt),                          // 元
      turnoverRate: Number(turn),                   // %
      amplitude: Number(amp),                       // %
      pctChg: Number(pct),                          // %
      change,
    };
  });
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
    const p = {
      time: t,
      price: Number(price),
      volume: Math.max(0, cv - prevVol) * LOT_SIZE,  // 每分钟增量，股（手 -> 股）
      amount: r2(Math.max(0, ca - prevAmt)),          // 每分钟增量，元
      tradeDate: iso,                                 // 多日分时按此字段分日；单日数据同样携带，保持契约一致
    };
    prevVol = cv; prevAmt = ca;
    return p;
  });
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
  const realLots = realVolume / LOT_SIZE;         // 手（虚拟匹配量单位）

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
    });
  });
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
  const realLots = realVolume / LOT_SIZE;                  // 1773 手

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
    });
  });
  return pts;
}

// ---------------------------------------------------------------- 6. 十档盘口（mock）
function buildDepth(bars, iso) {
  const close = bars[bars.length - 1].close;
  const mk = (sign) => Array.from({ length: 10 }, (_, i) => ({
    price: r2(close + sign * (i + 1) * 0.01),
    volume: (Math.round(2 + rnd() * 40) * LOT_SIZE),
  }));
  const snap = {
    timestamp: Date.parse(`${iso}T15:00:00+08:00`),
    bids: mk(-1),
    asks: mk(1),
  };
  return [snap];
}

// ---------------------------------------------------------------- 执行
const bars = buildBars();
const { iso, points: intraday } = buildIntraday();
const tradeDates = bars.slice(-5).map((b) => b.tradeDate);
const preCloseByDate = Object.fromEntries(bars.slice(-5).map((b) => [b.tradeDate, b.preClose]));
const auction = buildAuction(bars, intraday, iso);
const closingAuction = buildClosingAuction(bars, intraday, iso);
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

// 逐数据集单位显式声明（与市面口径对齐：lot=手、share=股、percent=百分数数值）
const units = {
  bars: { price: 'CNY', volume: 'share', amount: 'CNY', turnoverRate: 'percent', pctChg: 'percent', amplitude: 'percent', change: 'CNY', timestamp: 'UTC ms' },
  intraday: { price: 'CNY', volume: 'share', amount: 'CNY', timestamp: 'UTC ms' },
  auction: { virtualPrice: 'CNY', matchedQty: 'lot', unmatchedQty: 'lot', timestamp: 'UTC ms' },
  depth: { price: 'CNY', volume: 'share', timestamp: 'UTC ms' },
  orders: { price: 'CNY', volume: 'share' },
};

const manifest = {
  symbol: '600519.SH',
  name: '贵州茅台',
  adjust: 'qfq',
  tradeDate: iso,
  tradeDates,                     // 多日分时的交易日列表（最后一项为当日）
  preCloseByDate,                 // 各交易日昨收，多日分时按首日昨收统一价格轴
  preClose: last.preClose,
  open: last.open,
  close: last.close,
  floatShares: instrument.floatShares,
  limitRate: LIMIT_RATE,          // 按代码/名称识别板块：主板 10% / 创业科创 20% / ST 主板 5% / 北交所 30%
  session: SESSION.map((s) => ({ ...s })),
  demoPatterns: [
    { tradeDate: '2026-06-26', state: 'limitUp' },
    { tradeDate: '2026-07-24', state: 'limitDown' },
    { tradeDate: '2026-08-21', state: 'limitUpBroken' },
    { tradeDate: '2026-09-18', state: 'limitDownBroken' },
  ],
  files: {
    bars: 'bars_1d.json',
    intraday: `intraday_${iso.replace(/-/g, '')}.json`,
    auction: `auction_${iso.replace(/-/g, '')}.json`,
    depth: `depth_${iso.replace(/-/g, '')}.json`,
    orders: `orders_${iso.replace(/-/g, '')}.json`,
  },
  provenance: {
    bars: { availability: 'public-eod', source: 'real-kline', licensed: false },
    intraday: { availability: 'vendor-minute', source: 'real-intraday', licensed: false },
    auction: { availability: 'l1-intraday-only', source: 'illustrative + anchored-real endpoints', licensed: false },
    depth: { availability: 'level2-licensed', source: 'mock', licensed: true },
    orders: { availability: 'level2-licensed', source: 'mock', licensed: true },
  },
  units,
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
  `固定交易日：${iso}（完整历史交易日，避免当日进行中数据导致 case 不稳定）。`,
  '',
  '## 真实公开数据（已尝试并成功采集）',
  '',
  `日 K：东方财富 push2his kline（fqt=1 前复权）真实数据 936 根，剔除 ${TRADE_DATE} 之后未完成的当日 K 线，保留 ${bars.length} 根。日 K 字段严格取自东财原生 11 列（日期/开/收/高/低/量(手)/额(元)/振幅%/涨跌幅%/涨跌额/换手率%）：仅做「量(手) × LOT_SIZE 转股、timestamp 由 tradeDate 生成」两项映射，不含任何注入形态、不含 limitState / source 标记。四种涨跌停/炸板配色改由 manifest.demoPatterns 声明，由 \`deriveDataset()\` 运行时在内存按此叠加 \`limitState\`，落盘 bars 保持东财原生。`,
  `分时：腾讯 minute/query 在 ${iso} 的真实完整交易日数据 ${intraday.length} 点（上午 121 + 下午 121 + 盘后 25）。腾讯返回累计量额，已差分为每分钟增量；落盘仅保留 time / price / volume / amount / tradeDate，avgPrice / cumulativeVolume / cumulativeAmount / session / timestamp / source 由 src/core/derive-dataset.ts 运行时重算或补齐。`,
  '集合竞价：历史 9 秒级虚拟撮合过程快照需 L2 授权、无法回溯；9:25 结果与参考价属公开即时行情，故 manifest 标为 l1-intraday-only。本数据为锚定真实值 + 按上交所《交易规则》3.5.2 三原则撮合的示意委托簿，虚拟撮合价 / 匹配量 / 未匹配量 / 方向全部由 matchAuction() 按「最大成交量 → 未成交量最小 → 最接近前收」算出。落盘仅保留 time / phase / virtualPrice / matchedQty / unmatchedQty / unmatchedSide / timestamp；source / priceBasis / volume / amount 不再落盘，末点量额由运行时从 intraday 锚定，phase 为 chart-context 强依赖故保留。',
  '尾盘竞价（收盘集合竞价 14:57–15:00）：上交所 2018-08-20 起对股票实施 3 分钟收盘集合竞价，可申报不可撤单；与开盘竞价一致采用锚定真实 + 三原则撮合的示意委托簿（并列价参考 14:57 末价），按同花顺口径生成 21 个 9 秒节点。',
  '',
  '## 采集失败 / 不足，已按合理规则确定性 mock',
  '',
  '十档盘口：公开盘口接口空响应，按收盘价上下各 10 档、0.01 步长确定性 mock；落盘每档仅 price / volume，顶层仅 timestamp / bids / asks，phaseCode / source / license / requiresAuthorization / orderCount 不再落盘（orderCount 运行时由 orders 聚合）。',
  `- 十档盘口接口 em_depth.json 采集结果：${failed.length ? '空响应' : '有响应但未采用'}；筹码分布不依赖公开接口，由真实日 K 在运行时派生（见下）。`,
  '- 落盘 mock 使用固定种子 `mulberry32(20261113)`，重复运行 `build-sample-data.mjs` 输出完全一致；`build-order-book.mjs` 用独立种子 `mulberry32(2026111302)`；运行时派生层远档挂单用 `mulberry32(2026111303)`。',
  '- 原始数据回退链：`.tmp-raw/hist_intraday.json`（规范名）→ `.tmp-raw/tx_minute.json`（旧名备份）→ `src/data/raw/` 归档副本。腾讯分时接口常返回空，归档副本保证 `npm run data` 在离线/无抓取结果时仍可完整重跑。',
  '',
  '## 运行时派生数据集（非落盘输入）',
  '',
  '以下 6 个数据集由 src/algorithms 在运行时派生，不再写盘为独立 JSON、也不再是输入：',
  '',
  '- `chips` ← `src/algorithms/chip-distribution.ts`（真实日 K + 换手率的成本分布估算模型）；',
  '- `intradayMulti` ← `src/algorithms/intraday-multi.ts`（末日真实分时 + 前 4 日按当日日 K 拟真，量额锚定日 K）；',
  '- `historicalIntraday` ← `src/algorithms/historical-intraday.ts`（按 tradeDate 索引近 5 日分时；消费者可注入授权数据覆盖）；历史分时的竞价（buildAuctionSeries：锚定真实 9:25/15:00 端点 + 三原则撮合示意）与逐笔（buildTradeSeries：按分钟量额锚定分时）均在选中日现场生成，属示意数据、不落盘、不在界面展示来源说明；',
  '- `depthFull` ← `src/algorithms/order-book.ts`（由 `orders` 委托流回放聚合，前十档与 `depth` 快照闭合）；',
  '- `depthScenarios` ← `src/algorithms/depth-scenarios.ts`（普通 / 涨停 / 跌停场景）；',
  '- `trades`（逐笔明细）← `buildTradeSeries(intraday)` 运行时生成、不落盘；原落盘输入 `trades_20261113.json` 已删除，不再写盘；合并分笔委托号关联 `ordIds` 同步移除。',
  '',
  '派生过程的两个跨图修正（均由 `src/core/derive-dataset.ts` 在运行时完成）：',
  '',
  '- **委托流守恒修复**：对 `orders` 补发 `CANCEL`，保证 `ΣNEW = ΣFILL + ΣCANCEL + Σ存活`，使委托流严格闭合。`orders` 落盘已移除 `snapshot` 布尔字段，「收盘存活挂单」由运行时按 `origOrdId` 与委托流守恒重建。',
  '- **15:00 累计额锚定 bars**：把 15:00 累计成交额锚定当日日 K `amount`，使分时累计额与日 K 严格闭合。',
  '',
  '派生入口为 `src/core/derive-dataset.ts`，以 L0 输入（`bars` / `intraday` / `manifest`，以及 `auction`（`l1-intraday-only` 示意）与 `depth` / `orders`（2 份 Level-2 示意数据））调用上述纯函数；明确需授权的是 `depth` / `orders` 这 2 个。因此 `manifest.files` 与 `manifest.provenance` 只登记 5 个落盘输入：`bars / intraday / auction / depth / orders`。',
  '',
  '## 原始数据留档',
  '',
  '`src/data/raw/` 保存抓取到的原始响应，便于复核字段与单位；`scripts/fetch-public-data.mjs` 可重跑。',
  '',
  '## 单位与口径',
  '',
  '- 价格：元（CNY）；成交量：股（share，东财返回「手」，已 × LOT_SIZE(=100) 转股）；成交额：元（CNY）。`lot` = 手、`share` = 股、`percent` = 百分数数值（如 0.33 表示 0.33%）。',
  '- 时间戳：UTC 毫秒（UTC ms）；日线 `timestamp` 取交易日 00:00 UTC；`tradeDate` / `time` 保留市场本地字符串，避免 `new Date()` 串日。',
  '- 复权：前复权（qfq）；`preClose = close - change`，与前复权涨跌额自洽。',
  '- `turnoverRate` / `pctChg` / `amplitude` 为百分数数值（% 数值，如 0.33 表示 0.33%）；`change` 单位为元（CNY）。',
  '- 开盘/尾盘竞价 `matchedQty` / `unmatchedQty` 单位为手（lot）；`virtualPrice` 单位为元（CNY）。',
  '- `depth.bids/asks[].volume` 单位为股（share）：市面十档盘口常显示「手」，二者差 100 倍，由 `LOT_SIZE` 换算（1 手 = 100 股）；每档 `orderCount` 由运行时从 `orders` 聚合。',
  '- 分时均价：均价 = 累计成交额 ÷ 累计成交量（股），不是价格算术平均；竞价/分时累计量额、session、timestamp 等派生字段由 `src/core/derive-dataset.ts` 运行时补齐。',
  '- 开盘/尾盘竞价节点除 9:25 / 15:00 两个统一撮合时点外成交量均为 0；集合竞价成交方向为 `N`（无主动方向）。',
  '',
  '> 本文为工程示例数据说明，不构成投资建议；示例标的仅用于验证数据结构与组件渲染。',
  '',
  '## 派生数据集与 Level-2 授权边界',
  '',
  '- `orders`（逐笔委托 NEW/FILL/CANCEL）由 `build-order-book.mjs` 以固定种子 `mulberry32(2026111302)` 确定性生成并落盘，仅 7 字段 `ordId/time/price/volume/side/action/origOrdId`；`level/phase/snapshot/origVolume/remainVolume/tradeId/cancelOf/tag/trend` 等仅为生成期内存状态、不写进 JSON；「收盘存活挂单」语义由运行时按 `origOrdId` 与委托流守恒重建。`depth` / `orders` 为 2 份 Level-2 示意数据（需授权），`auction` 为 `l1-intraday-only` 示意，统一登记在 `manifest.files` / `manifest.provenance`（5 个落盘输入）。',
  '- **数据可获得性**：按《证券交易所管理办法》第 38 条与沪深交易规则 5.1.3，交易所法定公开的是日频行情表与集合竞价即时行情（参考价/匹配量/未匹配量）；十档盘口、逐笔明细、逐笔委托属 Level-2 增值行情，真实数据需向上证所信息网络 / 深圳证券信息申请展示或非展示许可，且不得自行复制、转发或开发衍生品。本项目示例数据均为确定性 mock、非真实行情，不再落盘 `license` / `requiresAuthorization` 等授权元数据。',
  '- 逐数据集来源与授权摘要统一登记在 `manifest.provenance`（5 个落盘输入，其中 `depth` / `orders` 2 个需授权），供消费者一次读取；逐数据集单位见 `manifest.units`。',
  '',
].join('\n');
writeFileSync(path.join(dataDir, 'SOURCES.md'), sourcesMd);

console.log(`\n日 K ${bars.length} 根 | 分时 ${intraday.length} 点 | 开盘竞价 ${auction.length} 点 + 尾盘竞价 ${closingAuction.length} 点 | 盘口 ${depth.length} 快照`);
console.log('数据生成完成（chips / intradayMulti / depthFull / depthScenarios / trades 由 src/algorithms 运行时派生，不再落盘）。');
