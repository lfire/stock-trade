#!/usr/bin/env node
// 生成 Level-2「全部挂单 / 逐笔委托」示例数据。
//
// 抓取结论（2026-11-18 复验）：东方财富 details 只返回 3 秒合并成交明细，
// 盘口字段接口 stock/get 返回 data:{}，公开源无历史 Level-2 逐笔委托（见 SOURCES.md）。
// 因此按「当日分时价格轨迹 + 收盘十档快照」做确定性拟真 mock：
//   1. 市价随时间从分时曲线插值，买/卖委托价分别挂在市价下方/上方 N 档（0.01 步长）；
//   2. 委托量一律 100 股整数倍，档位按几何衰减分布，含少量十档外委托；
//   3. 撤单遵守上交所规则：9:20–9:25、14:57–15:00 不可撤，其余时段按概率撤单；
//   4. 收盘时刻未撤单挂单按价格聚合，与 depth 十档各档 volume 严格闭合。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { limitPrices, limitRateFor } from './limit-rules.mjs';
import { r2, mulberry32 } from './shared.mjs';
import { TIME } from '../src/core/market-constants.js';
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
// 委托量：100 股整数倍，小额为主、偶有大单
function pickVolume() {
  const r = rnd();
  const lots = r < 0.62 ? 1 + Math.floor(rnd() * 5)
    : r < 0.9 ? 6 + Math.floor(rnd() * 15)
      : r < 0.985 ? 21 + Math.floor(rnd() * 30)
        : 60 + Math.floor(rnd() * 60);
  return lots * 100;
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
 * origVolume / remainVolume / origOrdId / tradeId 用于守恒校验与委托号关联。
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
    const lots = Math.floor(x.remain / 100);
    const fillLots = Math.min(lots, 1 + Math.floor(rnd() * Math.min(lots, 20)));
    const fillVol = Math.max(100, fillLots * 100);
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
// 既有 depth 个别档位存在 orderCount > volume/100（如 200 股 7 笔）的历史 mock 瑕疵，
// 这里按「每笔至少 1 手」约束拆单：逐档总量严格等于 depth.volume，笔数取合理上限。
const snapLevels = [
  ...depth.bids.map((d, i) => ({ ...d, side: 'B', level: i + 1 })),
  ...depth.asks.map((d, i) => ({ ...d, side: 'S', level: i + 1 })),
];
for (const lv of snapLevels) {
  const shares = Math.round(lv.volume / 100);
  const n = Math.max(1, Math.min(lv.orderCount, shares));
  // 先按整数手等分，再把余数随机分给若干笔：每笔至少 1 手、总量精确等于该档
  const base = Math.floor(shares / n);
  const parts = Array.from({ length: n }, () => base);
  let extra = shares - base * n;
  while (extra > 0) { parts[Math.floor(rnd() * n)] += 1; extra -= 1; }
  for (const p of parts) {
    // 收盘竞价时段申报、不可撤；时间落在 14:57–15:00 内均匀分布
    const t = NO_CANCEL_2 + Math.floor(rnd() * (CLOSE - NO_CANCEL_2));
    emit(fmt(t), lv.price, p * 100, lv.side, 'NEW', lv.level, 'closing', { snapshot: true });
  }
}

orders.sort((a, b) => (T(a.time) - T(b.time)) || (a.ordId < b.ordId ? -1 : 1));
const out = path.join(dir, `orders_${m.tradeDate.replace(/-/g, '')}.json`);
writeFileSync(out, `${JSON.stringify(orders, null, 0)}\n`);

// ---------------------------------------------------------------- 3. 全景盘口（回放委托流）
// 真实 Level-2 的做法：行情商用逐笔委托消息重建完整委托簿（order book），
// 快照只是该簿按价格聚合的当前状态，不是独立生成的数据。
//   NEW 入簿 → FILL 按成交价从剩余量扣减 → CANCEL 撤掉剩余量；只有被市价穿越才整笔离场。
//   真实委托簿不会因「挂太久」自动撤单，所以低价买单 / 高价卖单会一直留存，
//   盘口因此覆盖「买：现价 → 跌停价」「卖：现价 → 涨停价」的全价格区间。
const live = new Map();   // 原委托号 -> { side, price, remain, t }
for (const o of orders) {
  const t = T(o.time), mid = midAt(t);
  for (const [id, x] of live) {
    if ((x.side === 'B' && x.price >= mid) || (x.side === 'S' && x.price <= mid)) live.delete(id);
  }
  if (o.action === 'NEW') live.set(o.ordId, { side: o.side, price: o.price, remain: o.volume, t });
  else if (o.action === 'FILL' && live.has(o.origOrdId)) {
    const x = live.get(o.origOrdId);
    x.remain -= o.volume;
    if (x.remain <= 0) live.delete(o.origOrdId);
  } else if (o.action === 'CANCEL') live.delete(o.origOrdId);
}
const agg = new Map();
for (const x of live.values()) {
  if (x.remain <= 0) continue;
  const k = `${x.side}:${x.price.toFixed(2)}`;
  const cur = agg.get(k) || { side: x.side, price: x.price, volume: 0, orderCount: 0 };
  cur.volume += x.remain; cur.orderCount += 1;   // 只聚合未成交未撤的剩余量
  agg.set(k, cur);
}
// 与既有十档快照保持口径一致：同价格档位用快照值覆盖
for (const lv of snapLevels) {
  agg.set(`${lv.side}:${lv.price.toFixed(2)}`, {
    side: lv.side, price: lv.price, volume: lv.volume, orderCount: lv.orderCount,
  });
}
const bids = [...agg.values()].filter((x) => x.side === 'B').sort((a, b) => b.price - a.price);
const asks = [...agg.values()].filter((x) => x.side === 'S').sort((a, b) => a.price - b.price);
const pano = {
  timestamp: depth.timestamp,
  time: TIME.CLOSE,
  // 全景委托簿 / 逐笔委托属交易所 Level-2 增值行情，真实数据需展示或非展示许可
  source: 'mock', license: 'public-demo', requiresAuthorization: true,
  mid: r2(midAt(CLOSE)),
  limitDown: limitLo,
  limitUp: limitHi,
  bids: bids.map(({ price, volume, orderCount }) => ({ price, volume, orderCount })),
  asks: asks.map(({ price, volume, orderCount }) => ({ price, volume, orderCount })),
};
const panoOut = path.join(dir, `depth_full_${m.tradeDate.replace(/-/g, '')}.json`);
writeFileSync(panoOut, `${JSON.stringify(pano)}\n`);

// ---------------------------------------------------------------- 4. 涨停 / 跌停场景
// 真实涨跌停时一侧无挂单：涨停无卖盘、买1 为涨停价封单；跌停无买盘、卖1 为跌停价封单。
const seal = (price, volume, orderCount) => ({ price, volume, orderCount });
const mkDepth = (state) => {
  if (state === 'limitUp') {
    const bids = Array.from({ length: 10 }, (_, i) => seal(
      r2(limitHi - i * 0.01),
      i === 0 ? 1280000 : Math.max(100, Math.round((26000 - i * 2300) / 100) * 100),
      i === 0 ? 860 : 12 + i * 3,
    ));
    return { ...depth, bids, asks: [], limitState: 'limitUp', limitPrice: limitHi };
  }
  const asks = Array.from({ length: 10 }, (_, i) => seal(
    r2(limitLo + i * 0.01),
    i === 0 ? 960000 : Math.max(100, Math.round((24000 - i * 2100) / 100) * 100),
    i === 0 ? 720 : 11 + i * 3,
  ));
  return { ...depth, bids: [], asks, limitState: 'limitDown', limitPrice: limitLo };
};
const mkPano = (state) => {
  if (state === 'limitUp') {
    return {
      ...pano, mid: limitHi, limitState: 'limitUp',
      bids: [seal(limitHi, 1280000, 860), ...pano.bids.filter((d) => d.price < limitHi)],
      asks: [],
    };
  }
  return {
    ...pano, mid: limitLo, limitState: 'limitDown',
    bids: [],
    asks: [seal(limitLo, 960000, 720), ...pano.asks.filter((d) => d.price > limitLo)],
  };
};
// 场景对象的键即场景名（normal/limitUp/limitDown），不额外加顶层元数据以免破坏按 key 索引；
// 来源与授权边界统一见 manifest.provenance 与 SOURCES.md，内层 pano 自带 source/license。
const scenarios = {
  normal: { label: '普通', depth, pano },
  limitUp: { label: '涨停', depth: mkDepth('limitUp'), pano: mkPano('limitUp') },
  limitDown: { label: '跌停', depth: mkDepth('limitDown'), pano: mkPano('limitDown') },
};
const scenarioOut = path.join(dir, `depth_scenarios_${m.tradeDate.replace(/-/g, '')}.json`);
writeFileSync(scenarioOut, `${JSON.stringify(scenarios)}\n`);

// ---------------------------------------------------------------- 5. 合并分笔 ↔ 委托号关联
// trades 是分钟级合并分笔（聚合粒度），真实逐笔明细才带买卖双方委托号；
// 这里把同一分钟内发生部分成交的委托号挂到合并分笔上，形成可追溯的关联（幂等重写）。
const tradesFile = path.join(dir, m.files.trades);
const trades = JSON.parse(readFileSync(tradesFile, 'utf8'));
const fillsByMinute = new Map();
for (const o of orders) {
  if (o.action !== 'FILL') continue;
  const k = o.time.slice(0, 5);
  if (!fillsByMinute.has(k)) fillsByMinute.set(k, []);
  fillsByMinute.get(k).push(o.origOrdId);
}
for (const tr of trades) {
  tr.ordIds = [...new Set(fillsByMinute.get(String(tr.time).slice(0, 5)) || [])].slice(0, 8);
}
writeFileSync(tradesFile, `${JSON.stringify(trades)}\n`);

// build-sample-data 重跑会覆盖 manifest，这里幂等补回三个派生数据文件的登记
const manifestFile = path.join(dir, 'manifest.json');
const meta = JSON.parse(readFileSync(manifestFile, 'utf8'));
const derived = { orders: out, depthFull: panoOut, depthScenarios: scenarioOut };
let metaChanged = false;
for (const [k, file] of Object.entries(derived)) {
  const v = path.basename(file);
  if (meta.files[k] !== v) { meta.files[k] = v; metaChanged = true; }
}
if (metaChanged) writeFileSync(manifestFile, `${JSON.stringify(meta)}\n`);

// 幂等追加：让 SOURCES.md 覆盖由本脚本生成的 3 个派生数据集（build-sample-data 只写 7 个）
const sourcesFile = path.join(dir, 'SOURCES.md');
const derivedNote = `<!-- derived-data -->
## 派生数据集与 Level-2 授权边界（build-order-book.mjs）

- \`orders\`（逐笔委托 NEW/FILL/CANCEL）、\`depthFull\`（全景委托簿）、\`depthScenarios\`（普通/涨停/跌停场景）均为**确定性 mock**，固定种子 \`mulberry32(2026111302)\`。公开接口无历史 Level-2 逐笔委托（见 \`src/data/raw/em_order_attempt.json\`）。
- **数据可获得性**：按《证券交易所管理办法》第 38 条与沪深交易规则 5.1.3，交易所法定公开的是日频行情表与集合竞价即时行情（参考价/匹配量/未匹配量）；**十档盘口、逐笔明细、逐笔委托属 Level-2 增值行情**，真实数据需向上证所信息网络 / 深圳证券信息申请展示或非展示许可，且不得自行复制、转发或开发衍生品。本项目示例数据 \`license: 'public-demo'\`、\`requiresAuthorization: true\`，**非真实行情**。
- \`depthFull\` 由 \`orders\` 事件流回放聚合，前十档用 \`depth\` 快照覆盖；\`depthScenarios\` 的封单量为硬编码示意值。
- 逐数据集来源与授权摘要统一登记在 \`manifest.provenance\`，供消费者一次读取。

<!-- /derived-data -->`;
if (existsSync(sourcesFile)) {
  const prev = readFileSync(sourcesFile, 'utf8');
  const start = prev.indexOf('<!-- derived-data -->');
  const end = prev.indexOf('<!-- /derived-data -->');
  const next = start >= 0 && end > start
    ? prev.slice(0, start) + derivedNote + prev.slice(end + '<!-- /derived-data -->'.length)
    : `${prev.trimEnd()}\n\n${derivedNote}\n`;
  writeFileSync(sourcesFile, next);
}

const active = orders.filter((o) => o.snapshot);
console.log(`挂单数据：${orders.length} 条（收盘存活 ${active.length} 条）| NEW ${orders.filter((o) => o.action === 'NEW').length} / FILL ${orders.filter((o) => o.action === 'FILL').length} / CANCEL ${orders.filter((o) => o.action === 'CANCEL').length} | 合并分笔已关联 ${trades.filter((t) => t.ordIds?.length).length}/${trades.length} 条`);
console.log(`全景盘口：买 ${bids.length} 档 / 卖 ${asks.length} 档 | 中间价 ${pano.mid}`);
console.log(`输出 ${out} / ${panoOut} / ${scenarioOut}`);
