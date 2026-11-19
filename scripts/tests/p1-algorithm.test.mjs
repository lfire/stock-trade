/**
 * P1 数值回归：集合竞价撮合三原则、涨跌停板块化与容差、筹码分布口径。
 * 基准公式独立写在测试内，不复用生成脚本的实现。
 * 数据：src/data/*.json（600519.SH 前复权，截至 2026-11-13）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchAuction, makeOrderBook } from '../auction-match.mjs';
import { limitRateFor, limitPrices, limitStateOf, PRICE_EPS } from '../limit-rules.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const chips = JSON.parse(readFileSync(`${root}src/data/chips_20261113.json`, 'utf8'));
const auction = JSON.parse(readFileSync(`${root}src/data/auction_20261113.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${root}src/data/manifest.json`, 'utf8'));
const bars = JSON.parse(readFileSync(`${root}src/data/bars_1d.json`, 'utf8'));

// ---------- 集合竞价撮合（上交所 3.5.2 / 深交所投教三原则） ----------
test('撮合：取可实现最大成交量的价格', () => {
  const bids = [{ price: 10.02, qty: 10 }, { price: 10.01, qty: 20 }, { price: 10.00, qty: 30 }];
  const asks = [{ price: 9.98, qty: 15 }, { price: 9.99, qty: 25 }, { price: 10.00, qty: 20 }];
  // 独立手算：p=10.00 → 买>=10 = 60、卖<=10 = 60 → 可成交 60，为各价最大
  const manual = {};
  for (const p of [9.98, 9.99, 10.00, 10.01, 10.02]) {
    manual[p] = Math.min(
      bids.filter((b) => b.price >= p).reduce((s, b) => s + b.qty, 0),
      asks.filter((a) => a.price <= p).reduce((s, a) => s + a.qty, 0));
  }
  assert.equal(Math.max(...Object.values(manual)), 60);
  const m = matchAuction(bids, asks, 10.00);
  assert.equal(m.price, 10.00);
  assert.equal(m.matchedQty, 60);
  assert.equal(m.unmatchedQty, 0);
  assert.equal(m.unmatchedSide, 0);
});

test('撮合：并列价取未成交量最小者，仍并列取最接近参考价', () => {
  // 场景 A：p=10.00 与 p=10.02 的可成交量同为 100，但 p=10.02 的未成交量为 0 更小，
  // 应优先于「最接近前收」的 p=10.00
  const a = matchAuction(
    [{ price: 10.02, qty: 100 }, { price: 10.00, qty: 20 }],
    [{ price: 10.00, qty: 100 }], 10.00);
  assert.equal(a.matchedQty, 100);
  assert.equal(a.unmatchedQty, 0);
  assert.equal(a.price, 10.02);
  // 场景 B：两侧都只有单一价位，可成交量与未成交量完全相同 → 取最接近前收的价格
  const b = matchAuction([{ price: 10.02, qty: 100 }], [{ price: 10.00, qty: 100 }], 10.00);
  assert.equal(b.matchedQty, 100);
  assert.equal(b.unmatchedQty, 0);
  assert.equal(b.price, 10.00);
});

test('撮合：未匹配方向由买卖申报差额决定', () => {
  const buyHeavy = matchAuction([{ price: 10, qty: 300 }], [{ price: 10, qty: 120 }], 10);
  assert.equal(buyHeavy.unmatchedSide, 1);
  assert.equal(buyHeavy.unmatchedQty, 180);
  const sellHeavy = matchAuction([{ price: 10, qty: 120 }], [{ price: 10, qty: 300 }], 10);
  assert.equal(sellHeavy.unmatchedSide, 2);
  assert.equal(sellHeavy.unmatchedQty, 180);
  assert.equal(matchAuction([], [{ price: 10, qty: 5 }], 10).matchedQty, 0);
});

test('示意委托簿：price 恒等于 center、matched=min、unmatched=|差|', () => {
  for (const [b, s, side] of [[150, 150, 0], [350, 120, 1], [120, 350, 2]]) {
    const ob = makeOrderBook(1404.00, b, s);
    const m = matchAuction(ob.bids, ob.asks, 1410.27);
    assert.equal(m.price, 1404.00);
    assert.equal(m.matchedQty, Math.min(b, s));
    assert.equal(m.unmatchedQty, Math.abs(b - s));
    assert.equal(m.unmatchedSide, side);
  }
});

test('生成的竞价序列：末点与真实值闭合、匹配量单调不减', () => {
  const open = auction.filter((p) => p.phase === 'open');
  const close = auction.filter((p) => p.phase === 'close');
  assert.equal(open.length, 69);
  assert.equal(close.length, 21);
  for (const arr of [open, close]) {
    let prev = 0;
    for (const p of arr) {
      assert.ok(p.matchedQty >= prev, `${p.time} 匹配量倒退`);
      prev = p.matchedQty;
      assert.ok(p.unmatchedSide === 0 || p.unmatchedSide === 1 || p.unmatchedSide === 2);
    }
    const last = arr.at(-1);
    assert.equal(last.unmatchedQty, 0);
    assert.equal(last.unmatchedSide, 0);
  }
  assert.equal(open.at(-1).virtualPrice, manifest.open);
  assert.equal(close.at(-1).virtualPrice, manifest.close);
  assert.equal(open.at(-1).volume, JSON.parse(readFileSync(`${root}src/data/intraday_20261113.json`, 'utf8'))[0].volume);
});

// ---------- 涨跌停：板块比例 + 0.01 元容差 ----------
test('涨跌停比例按板块识别（构造代码，非真实标的）', () => {
  assert.equal(limitRateFor('600519.SH', '贵州茅台'), 0.10);
  assert.equal(limitRateFor('000001.SZ', 'ST示例'), 0.05);
  assert.equal(limitRateFor('300001.SZ', '创业板示例'), 0.20);
  assert.equal(limitRateFor('688001.SH', '科创板示例'), 0.20);
  assert.equal(limitRateFor('688001.SH', 'ST示例'), 0.20);   // 创业/科创风险警示股仍 20%
  assert.equal(limitRateFor('830001.BJ', '北交所示例'), 0.30);
});

test('涨跌停价四舍五入到分、容差 0.011 元不会误标接近价', () => {
  assert.deepEqual(limitPrices(10.005, 0.10), { up: 11.01, down: 9.00 });
  const rate = 0.10, pre = 100.00;
  const { up, down } = limitPrices(pre, rate);
  const bar = (close, high, low) => ({ preClose: pre, close, high, low });
  assert.equal(limitStateOf(bar(up, up, 99), rate), 'limitUp');
  assert.equal(limitStateOf(bar(down, 101, down), rate), 'limitDown');
  assert.equal(limitStateOf(bar(99.5, up, 99), rate), 'limitUpBroken');
  // 修复前 0.5% 相对容差（0.50 元）会把 109.60 / 90.40 之类接近价误标
  assert.equal(limitStateOf(bar(109.60, 109.60, 100), rate), '', '距涨停 0.40 元不应误标');
  assert.equal(limitStateOf(bar(90.40, 100, 90.40), rate), '', '距跌停 0.40 元不应误标');
  assert.ok(PRICE_EPS < 0.02, '容差应保持在 1 个最小变动单位量级');
  // 真实数据：4 种形态仍在，且没有非封板价被误标
  const states = ['limitUp', 'limitDown', 'limitUpBroken', 'limitDownBroken'];
  for (const s of states) assert.ok(bars.some((b) => b.limitState === s), `缺少 ${s} 样本`);
  assert.equal(bars.filter((b) => b.limitState).length, 4, '0.011 元容差下应只剩 4 根注入形态');
});

// ---------- 筹码分布口径 ----------
test('筹码模型：峰值取当日成交均价、衰减系数与分布形状可配置', () => {
  assert.equal(chips.peakSource, 'vwap');
  assert.equal(chips.shape, 'triangular');
  assert.equal(chips.decay, 1);
  assert.equal(chips.bins, 150);
  assert.equal(chips.lookback, 120);
  assert.match(chips.concentrationBasis, /not SCR\/2/);
});

test('筹码 9 项统计：分位数、集中度、获利比例与独立公式一致', () => {
  const grid = chips.priceGrid;
  const ratios = chips.currentHistogram.ratios;
  const at = (q) => {
    let cum = 0;
    for (let i = 0; i < grid.length; i += 1) { cum += ratios[i]; if (cum >= q) return grid[i]; }
    return grid[grid.length - 1];
  };
  const c = chips.current;
  assert.equal(c.cost90Low, at(0.05));
  assert.equal(c.cost90High, at(0.95));
  assert.equal(c.cost70Low, at(0.15));
  assert.equal(c.cost70High, at(0.85));
  assert.equal(c.avgCost, at(0.5));
  const conc = (hi, lo) => (hi - lo) / (hi + lo);   // 同花顺面板口径，不除 2
  assert.ok(Math.abs(c.concentration90 - conc(c.cost90High, c.cost90Low)) < 1e-6);
  assert.ok(Math.abs(c.concentration70 - conc(c.cost70High, c.cost70Low)) < 1e-6);
  const profit = ratios.reduce((s, r, i) => s + (grid[i] <= bars.at(-1).close ? r : 0), 0);
  assert.ok(Math.abs(c.profitRatio - profit) < 1e-5);
  // 加权平均与 COST(50) 是两个不同统计量，UI 的「平均成本」应对齐后者
  assert.notEqual(c.weightedAvgCost, c.avgCost);
});
