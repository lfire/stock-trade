// 输入数据契约 / 校验器 / 单模块出入参：真实行为断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateDatasetInput, inputsForModules, INPUT_CONTRACT, INPUT_KEYS } from '../../dist/pure.js';
import { deriveDataset } from '../../dist/core/derive-dataset.js';
import { MODULE_CATALOG } from '../../dist/workspace/module-catalog.js';
import { MODULE_IO, describeModule } from '../../dist/workspace/module-io.js';
import { CHART_EVENTS } from '../../dist/events.js';
import { WORKSPACE_EVENTS, DEFAULT_WORKSPACE_CONFIG } from '../../dist/workspace/types.js';
import { buildTradeSeries } from '../../dist/algorithms/trade-series.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (f) => JSON.parse(readFileSync(join(root, 'src/data', f), 'utf8'));
const manifest = rd('manifest.json');
const raw = { manifest };
for (const [k, f] of Object.entries(manifest.files)) raw[k] = rd(f);
const clone = (o) => JSON.parse(JSON.stringify(o));
const mutate = (fn) => { const d = clone(raw); fn(d); return d; };
const codes = (r) => r.errors.map((e) => `${e.key}:${e.code}`);

test('样例数据：原始 L0 与派生结果均满足输入契约（0 错误 0 警告）', () => {
  for (const data of [raw, deriveDataset(raw, { preset: 'full' })]) {
    const r = validateDatasetInput(data, { preset: 'full' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.required, ['bars', 'intraday', 'auction', 'depth', 'orders']);
  }
});

test('必需输入随启用模块变化：minimal 只要 bars / intraday，depth-book 要 depth / orders', () => {
  assert.deepEqual(inputsForModules({ preset: 'minimal' }), ['bars', 'intraday']);
  assert.deepEqual(inputsForModules({ modules: ['depth-book'] }).sort(), ['bars', 'depth', 'intraday', 'orders']);
  const r = validateDatasetInput({ manifest, bars: raw.bars, intraday: raw.intraday }, { preset: 'minimal' });
  assert.equal(r.ok, true);
});

test('校验器精确识别结构问题（缺输入 / 顺序 / OHLC / 单位 / 引用 / 涨跌停）', () => {
  const cases = [
    ['缺 orders', (d) => { delete d.orders; }, { modules: ['depth-book'] }, 'orders:missing'],
    ['bars 乱序', (d) => { [d.bars[3], d.bars[4]] = [d.bars[4], d.bars[3]]; }, { preset: 'candle' }, 'bars:order'],
    ['OHLC 越界', (d) => { d.bars[10].high = 1; }, { preset: 'candle' }, 'bars:ohlc'],
    ['分时以手给量', (d) => { d.intraday.forEach((p) => { p.volume /= 100; }); }, { preset: 'full' }, 'intraday:unit'],
    ['竞价以股给量', (d) => { d.auction.forEach((a) => { a.matchedQty *= 100; }); }, { modules: ['auction'] }, 'auction:unit'],
    ['卖盘倒序', (d) => { d.depth[0].asks.reverse(); }, { modules: ['depth-book'] }, 'depth:ask-order'],
    ['撤单无原委托', (d) => { d.orders.find((o) => o.action === 'CANCEL').origOrdId = 'X'; }, { modules: ['trade-tape'] }, 'orders:orig-ref'],
    ['委托越涨停', (d) => { d.orders[0].price = 9999; }, { modules: ['trade-tape'] }, 'orders:limit'],
    ['manifest 缺代码', (d) => { delete d.manifest.symbol; }, { preset: 'minimal' }, 'manifest:field'],
  ];
  for (const [name, fn, opts, code] of cases) {
    const r = validateDatasetInput(mutate(fn), opts);
    assert.equal(r.ok, false, name);
    assert.deepEqual(codes(r), [code], `${name} 应只报 ${code}，实际 ${codes(r)}`);
  }
});

test('可选字段真实可推导：最小输入派生出的值与来源值一致', () => {
  const full = deriveDataset(raw, { preset: 'full' });
  const min = mutate((d) => {
    d.bars = d.bars.map(({ tradeDate, open, high, low, close, volume, amount }) => ({ tradeDate, open, high, low, close, volume, amount }));
    delete d.manifest.open; delete d.manifest.close; delete d.manifest.limitRate;
    d.auction.forEach((a) => { delete a.timestamp; });
    d.intraday.forEach((p) => { delete p.tradeDate; });
  });
  assert.equal(validateDatasetInput(min, { preset: 'full' }).ok, true);
  const out = deriveDataset(min, { preset: 'full' });
  for (const k of ['preClose', 'timestamp', 'change', 'pctChg', 'amplitude', 'turnoverRate']) {
    out.bars.slice(1).forEach((b, i) => assert.ok(Math.abs(b[k] - full.bars[i + 1][k]) <= 0.0101, `${k}@${i + 1}`));
  }
  assert.equal(out.manifest.open, manifest.open);
  assert.equal(out.manifest.close, manifest.close);
  assert.equal(out.manifest.limitRate, manifest.limitRate);
  assert.ok(out.auction.every((a, i) => a.timestamp === full.auction[i].timestamp));
  // 样例数据（字段齐全）补齐步骤零影响：对象引用不变
  assert.equal(full.manifest, raw.manifest);
  assert.equal(full.bars[0], raw.bars[0]);
  // 不能推导的情况必须报错：需要筹码但无换手率来源
  const noTurn = clone(min); delete noTurn.manifest.floatShares;
  assert.deepEqual(codes(validateDatasetInput(noTurn, { preset: 'candle' })), ['bars:turnover']);
});

test('逐笔与分时 / 竞价闭合：9:25 竞价成交取首个分钟点，逐笔总量 === 分时总量（当日 + 历史 5 日）', () => {
  const d = deriveDataset(raw, { preset: 'full' });
  const sum = (a) => a.reduce((s, x) => s + x.volume, 0);
  assert.equal(sum(d.trades), sum(d.intraday));
  const days = [...new Set(d.intradayMulti.map((p) => p.tradeDate))];
  assert.equal(days.length, 5);
  for (const day of days) {
    const pts = d.intradayMulti.filter((p) => p.tradeDate === day);
    const t = buildTradeSeries(pts, day);
    assert.equal(sum(t), sum(pts), day);
    assert.equal(t.find((x) => x.phase === 'auction').volume, pts[0].volume, day);
    assert.equal(t.filter((x) => x.phase === 'afterHours' && x.volume <= 0).length, 0, '盘后不得造量');
  }
});

test('输入契约：每个输入都有来源可得性、来源途径、市面口径与必填字段', () => {
  for (const key of ['manifest', ...INPUT_KEYS]) {
    const s = INPUT_CONTRACT[key];
    assert.ok(s.availability && s.sources.length > 10 && s.conventions.length >= 2, key);
    assert.ok(s.fields.some((f) => f.required), key);
  }
});

test('单模块出入参：13 模块全覆盖，数据输入由目录计算、事件 / 配置 / API 均真实存在', async () => {
  const ids = Object.keys(MODULE_CATALOG);
  assert.deepEqual(Object.keys(MODULE_IO).sort(), [...ids].sort());
  const events = new Set([...Object.values(CHART_EVENTS), ...Object.values(WORKSPACE_EVENTS)]);
  const configKeys = new Set([...Object.keys(DEFAULT_WORKSPACE_CONFIG), 'modules', 'preset']);
  const sc = await import('stock-chart');
  const owners = {
    'stock-chart': sc.StockChart, 'depth-book': sc.DepthBook, 'trade-tape': sc.TradeTape,
    'detail-canvas': sc.DetailCanvas, 'stock-workspace': sc.StockWorkspace,
  };
  for (const id of ids) {
    const d = describeModule(id);
    assert.deepEqual(d.requiredInputs.slice().sort(), inputsForModules({ modules: [id] }).sort(), `${id} 输入`);
    for (const e of d.events) assert.ok(events.has(e), `${id} 事件 ${e} 不存在`);
    for (const c of d.config) assert.ok(configKeys.has(c), `${id} 配置键 ${c} 不存在`);
    for (const a of d.api) {
      const [owner, member] = a.split('.');
      if (!member) { assert.equal(typeof sc[owner], 'function', `${id} 根入口函数 ${owner} 不存在`); continue; }
      const proto = owners[owner]?.prototype;
      assert.ok(proto && (member in proto), `${id} API ${a} 不存在`);
    }
    const facade = await import(`stock-chart/modules/${id}`);
    assert.deepEqual(facade.io.requiredInputs, d.requiredInputs, `${id} 门面 io`);
  }
  assert.equal(describeModule('not-a-module'), null);
});

test('depth-book 单独启用也会派生盘口场景（涨跌停切换可用）', () => {
  assert.ok(describeModule('depth-book').derivedData.includes('depthScenarios'));
  const d = deriveDataset(raw, { modules: ['depth-book'] });
  assert.ok(d.depthScenarios && d.depthScenarios.limitUp, '单模块缺 depthScenarios');
});

test('买卖单视图：委托号确定性补齐、已有号原样保留，连续成交合并且量额闭合', async () => {
  const { assignTradeOrderNos, buildOrderRuns, isBigOrder, BIG_ORDER_AMOUNT } = await import('../../dist/pure.js');
  const d = deriveDataset(raw, { preset: 'full' });
  assert.ok(d.trades.every((t) => t.buyOrdId && t.sellOrdId), '派生逐笔须带买卖委托号');
  const again = deriveDataset(raw, { preset: 'full' });
  assert.deepEqual(again.trades.map((t) => t.buyOrdId + t.sellOrdId), d.trades.map((t) => t.buyOrdId + t.sellOrdId), '须确定性');
  // 已有号（授权 L2）原样保留：数组与对象引用不变
  assert.equal(assignTradeOrderNos(d.trades), d.trades);
  const frozen = d.trades.slice(0, 30).map((t) => Object.freeze({ ...t }));
  const rows = buildOrderRuns(frozen);   // 不修改入参（冻结对象也不报错）
  const sum = (a) => a.reduce((s, x) => s + x.volume, 0);
  for (const key of ['buyRun', 'sellRun']) {
    const runs = [...new Set(rows.map((r) => r[key]))];
    assert.equal(sum(runs), sum(frozen), `${key} 合计须等于逐笔总量`);
    for (const run of runs) {
      const members = rows.filter((r) => r[key] === run);
      assert.equal(members.length, run.count);
      assert.equal(sum(members), run.volume);
      assert.equal(run.firstSeq, members[0].seq);
      assert.equal(run.lastSeq, members.at(-1).seq);
      // 同一段必须连续
      const idx = members.map((m) => rows.indexOf(m));
      assert.ok(idx.every((v, i) => i === 0 || v === idx[i - 1] + 1), '同段须为相邻成交');
    }
  }
  const all = buildOrderRuns(d.trades);
  assert.ok([...new Set(all.map((r) => r.buyRun))].some((r) => r.count > 1), '应存在连续成交的买单');
  assert.ok(all.filter((r) => r.phase !== 'continuous').every((r) => r.buyRun.count === 1 && r.sellRun.count === 1),
    '集合竞价 / 盘后成交不跨阶段合并');
  assert.equal(BIG_ORDER_AMOUNT, 200000);
  assert.equal(isBigOrder({ amount: 199999 }), false);
  assert.equal(isBigOrder({ amount: 200000 }), true);
  assert.equal(isBigOrder({ amount: 50 }, 10), true);
});

test('买卖单视图配置：URL trade-view / big-order 解析，默认列表', async () => {
  const { parseWorkspaceConfig, DEFAULT_WORKSPACE_CONFIG: D } = await import('stock-chart');
  assert.equal(D.tradeView, 'list');
  assert.equal(D.bigOrderAmount, 200000);
  const c = parseWorkspaceConfig(new URLSearchParams('trade-view=match&big-order=500000'));
  assert.equal(c.tradeView, 'match');
  assert.equal(c.bigOrderAmount, 500000);
  assert.equal(parseWorkspaceConfig(new URLSearchParams('trade-view=xx')).tradeView, 'list');
});
