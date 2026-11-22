#!/usr/bin/env node
// 生成 Level-2「全部挂单 / 逐笔委托」示例数据。
//
// 抓取结论（2026-11-18 复验）：东方财富 details 只返回 3 秒合并成交明细，
// 盘口字段接口 stock/get 返回 data:{}，公开源无历史 Level-2 逐笔委托（见 SOURCES.md）。
// 因此按「当日分时价格轨迹 + 收盘十档快照」做确定性拟真 mock：
//   1. 市价随时间从分时曲线插值，买/卖委托价分别挂在市价下方/上方 N 档（0.01 步长）；
//   2. 委托量一律 LOT_SIZE 股整数倍，档位按几何衰减分布，含少量十档外委托；
//   3. 撤单遵守上交所规则：9:20–9:25、14:57–15:00 不可撤，其余时段按概率撤单；
//   4. 收盘时刻未撤单挂单按价格聚合，与 depth 十档各档 volume 严格闭合。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { limitPrices, limitRateFor } from './limit-rules.mjs';
import { r2, mulberry32 } from './shared.mjs';
import { TIME, LOT_SIZE } from '../dist/core/market-constants.js';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src', 'data');
const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const intra = JSON.parse(readFileSync(path.join(dir, m.files.intraday), 'utf8'));
const depth = JSON.parse(readFileSync(path.join(dir, m.files.depth), 'utf8'))[0];

// PRNG 与 r2 统一取自 scripts/shared.mjs；不同数据集用不同种子，互不干扰
const rnd = mulberry32(2026111302);
const T = (s) => {
  const p = s.split(':').map(Number);
  return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
};
const fmt = (sec) => [
  String(Math.floor(sec / 3600)).padStart(2, '0'),
  String(Math.floor((sec % 3600) / 60)).padStart(2, '0'),
  String(sec % 60).padStart(2, '0'),
].join(':');

// 时段字面量取自 market-constants.TIME 单一真源
const LO = T(TIME.AUCTION_START), OPEN = T(TIME.OPEN), NOON = T(TIME.NOON);
const PM = T(TIME.PM), NO_CANCEL_1 = T(TIME.NO_CANCEL_OPEN), NO_CANCEL_2 = T(TIME.NO_CANCEL_CLOSE);
const CLOSE = T(TIME.CLOSE);
// 涨跌停价按 manifest.limitRate（由代码/名称识别板块）计算，不再硬编码主板 0.9/1.1
const { up: limitHi, down: limitLo } = limitPrices(m.preClose,
  m.limitRate ?? limitRateFor(m.symbol, m.name));

// 分时价格轨迹（排除盘后固定价段），用于给任意时刻的委托价定基准
const curve = intra
  .filter((p) => T(p.time) <= CLOSE)
  .map((p) => ({ t: T(p.time), price: p.price }))
  .sort((a, b) => a.t - b.t);
const openPx = curve[0].price;
function midAt(t) {
  if (t < curve[0].t) return openPx;                 // 开盘集合竞价参考 9:25 开盘价
  for (let i = 1; i < curve.length; i += 1) {
    if (t <= curve[i].t) {
      const a = curve[i - 1], b = curve[i];
      const w = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.price + (b.price - a.price) * w;
    }
  }
  return curve.at(-1).price;
}

// 档位：几何衰减，1~10 档为主，少量 11~20 档（十档之外的委托）
function pickLevel() {
  const r = rnd();
  let acc = 0, total = 0;
  for (let l = 1; l <= 20; l += 1) total += Math.pow(0.82, l - 1);
  for (let l = 1; l <= 20; l += 1) {
    acc += Math.pow(0.82, l - 1) / total;
    if (r <= acc) return l;
  }
  return 20;
}
// 委托量：LOT_SIZE 股整数倍，小额为主、偶有大单
function pickVolume() {
  const r = rnd();
  const lots = r < 0.62 ? 1 + Math.floor(rnd() * 5)
    : r < 0.9 ? 6 + Math.floor(rnd() * 15)
      : r < 0.985 ? 21 + Math.floor(rnd() * 30)
        : 60 + Math.floor(rnd() * 60);
  return lots * LOT_SIZE;
}

let seq = 0, tradeSeq = 0;
const orders = [];
const openOrders = [];   // 在挂委托：{ rec, remain }，remain = 未成交未撤的剩余量
function push(o) {
  const rec = { ordId: `O${String(++seq).padStart(6, '0')}`, ...o };
  orders.push(rec);
  return rec;
}
/**
 * 真实 Level-2 委托生命周期：NEW 入簿 → FILL 按量扣减 → CANCEL 撤掉剩余量。
 * volume 语义随事件变化：NEW = 委托总量、FILL = 本次成交量、CANCEL = 本次撤单量（即剩余量）。
 * level / phase / snapshot / tag / trend / origVolume / remainVolume / tradeId / cancelOf
 * 仅作生成期内存状态保留，最终写盘时按 7 字段契约投影，不落进 JSON。
 */
function emit(time, price, volume, side, action, level, phase, opts = {}) {
  const { snapshot = false, origOrdId = null, origVolume = volume,
    remainVolume = volume, tradeId = null } = opts;
  const tag = action === 'CANCEL' ? `${side}C` : action === 'FILL' ? `${side}F` : side;
  const rec = push({
    time, price, volume, side, action, level, phase, snapshot,
    origOrdId, origVolume, remainVolume, tradeId,
    cancelOf: action === 'CANCEL' ? origOrdId : null,   // 兼容既有字段
    tag,
    trend: action === 'CANCEL' ? 0 : (side === 'B' ? 1 : -1),
  });
  if (action === 'NEW' && !snapshot) {
    openOrders.push({ rec, remain: volume });
    if (openOrders.length > 240) openOrders.shift();   // 只保留近期待成交/待撤挂单
  }
  return rec;
}

// ---------------------------------------------------------------- 1. 全天委托流
const slots = [];
for (let t = LO; t <= T(TIME.AUCTION_END); t += 4) slots.push(t);        // 开盘集合竞价
for (let t = OPEN; t <= NOON; t += 14) slots.push(t);               // 上午连续竞价
for (let t = PM; t <= CLOSE; t += 14) slots.push(t);                // 下午连续竞价 / 收盘竞价
for (const t of slots) {
  const side = rnd() < 0.5 ? 'B' : 'S';
  const mid = midAt(t);
  // 真实委托簿里低价埋伏买单可一直挂到跌停价、高价埋伏卖单可一直挂到涨停价：
  // 约 18% 的委托为「远档埋伏单」，价格覆盖现价 → 涨跌停边界，分布偏向现价、少量极限价
  const far = rnd() < 0.18;
  let level, price;
  if (far) {
    const span = side === 'B' ? (mid - 0.01 - limitLo) : (limitHi - mid - 0.01);
    const w = side === 'B' ? 1 - Math.pow(rnd(), 2.5) : Math.pow(rnd(), 2.5);
    price = side === 'B' ? r2(limitLo + span * w) : r2(mid + 0.01 + span * w);
    price = Math.max(limitLo, Math.min(limitHi, price));
    level = Math.max(1, Math.round(Math.abs(price - mid) / 0.01));
  } else {
    level = pickLevel();
    // 买挂单低于市价、卖挂单高于市价，1 档即相邻一个最小变动价位
    price = Math.max(limitLo, Math.min(limitHi, r2(mid + (side === 'B' ? -1 : 1) * level * 0.01)));
  }
  const volume = pickVolume();
  const phase = t < OPEN ? 'auction' : (t >= NO_CANCEL_2 ? 'closing' : 'continuous');
  const cancelable = !((t >= NO_CANCEL_1 && t < OPEN) || (t >= NO_CANCEL_2 && t <= CLOSE));
  const r = rnd();
  const pool = openOrders.filter((x) => x.remain > 0);
  // 1) 部分成交：逐笔明细只在连续竞价发生，按量扣减剩余量，委托继续留在簿里
  if (phase === 'continuous' && r < 0.22 && pool.length) {
    const x = pool[Math.floor(rnd() * pool.length)];
    const lots = Math.floor(x.remain / LOT_SIZE);
    const fillLots = Math.min(lots, 1 + Math.floor(rnd() * Math.min(lots, 20)));
    const fillVol = Math.max(LOT_SIZE, fillLots * LOT_SIZE);
    x.remain -= fillVol;
    const tradeId = `T${String(++tradeSeq).padStart(6, '0')}`;
    emit(fmt(t), x.rec.price, fillVol, x.rec.side, 'FILL', x.rec.level, phase, {
      origOrdId: x.rec.ordId, origVolume: x.rec.volume, remainVolume: x.remain, tradeId,
    });
    if (x.remain <= 0) openOrders.splice(openOrders.indexOf(x), 1);
    continue;
  }
  // 2) 撤单：撤的是当时的剩余量，不是原委托总量（9:20–9:25、14:57–15:00 不可撤）
  const cancelRate = phase === 'auction' ? 0.42 : 0.22;
  if (cancelable && r >= 0.22 && r < 0.22 + cancelRate && pool.length) {
    const x = pool[Math.floor(rnd() * pool.length)];
    openOrders.splice(openOrders.indexOf(x), 1);
    emit(fmt(t), x.rec.price, x.remain, x.rec.side, 'CANCEL', x.rec.level, phase, {
      origOrdId: x.rec.ordId, origVolume: x.rec.volume, remainVolume: 0,
    });
    continue;
  }
  // 3) 新挂单
  emit(fmt(t), price, volume, side, 'NEW', level, phase);
}

// 涨跌停边界上的埋伏单：真实盘口常见「跌停价托单 / 涨停价压单」，全天不会被市价穿越
emit('09:30:01', limitLo, 20000, 'B', 'NEW', Math.round((midAt(OPEN) - limitLo) / 0.01), 'continuous');
emit('09:30:01', limitHi, 20000, 'S', 'NEW', Math.round((limitHi - midAt(OPEN)) / 0.01), 'continuous');

// ---------------------------------------------------------------- 2. 收盘存活挂单（与十档快照闭合）
// depth 每档仅 price / volume（股）；orderCount 不再落盘，改由本脚本按该档股数确定性拆单，
// 逐档总量严格等于 depth.volume，运行时再从 orders 聚合回 orderCount。
const snapLevels = [
  ...depth.bids.map((d, i) => ({ ...d, side: 'B', level: i + 1 })),
  ...depth.asks.map((d, i) => ({ ...d, side: 'S', level: i + 1 })),
];
for (const lv of snapLevels) {
  const shares = Math.round(lv.volume / LOT_SIZE);
  const n = Math.max(1, Math.min(shares, 1 + Math.floor(rnd() * 18)));
  // 先按整数手等分，再把余数随机分给若干笔：每笔至少 1 手、总量精确等于该档
  const base = Math.floor(shares / n);
  const parts = Array.from({ length: n }, () => base);
  let extra = shares - base * n;
  while (extra > 0) { parts[Math.floor(rnd() * n)] += 1; extra -= 1; }
  for (const p of parts) {
    // 收盘竞价时段申报、不可撤；时间落在 14:57–15:00 内均匀分布
    const t = NO_CANCEL_2 + Math.floor(rnd() * (CLOSE - NO_CANCEL_2));
    emit(fmt(t), lv.price, p * LOT_SIZE, lv.side, 'NEW', lv.level, 'closing', { snapshot: true });
  }
}

orders.sort((a, b) => (T(a.time) - T(b.time)) || (a.ordId < b.ordId ? -1 : 1));
// 落盘契约 7 字段；其余状态量（level / phase / snapshot / tag / trend / origVolume /
// remainVolume / tradeId / cancelOf）仅内存保留，不写进 JSON。
const ORDERS_FIELDS = ['ordId', 'time', 'price', 'volume', 'side', 'action', 'origOrdId'];
const serialized = orders.map((o) => Object.fromEntries(ORDERS_FIELDS.map((k) => [k, o[k]])));
const out = path.join(dir, `orders_${m.tradeDate.replace(/-/g, '')}.json`);
writeFileSync(out, `${JSON.stringify(serialized)}\n`);

const active = orders.filter((o) => o.snapshot);
console.log(`挂单数据：${orders.length} 条（收盘存活 ${active.length} 条）| NEW ${orders.filter((o) => o.action === 'NEW').length} / FILL ${orders.filter((o) => o.action === 'FILL').length} / CANCEL ${orders.filter((o) => o.action === 'CANCEL').length}`);
console.log(`输出 ${out}（depthFull / depthScenarios 由 src/algorithms 运行时派生，不再写盘）`);
