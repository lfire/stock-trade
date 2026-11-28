/**
 * 日 K 线图查看历史分时：数据契约、可得性边界、注入通道、配置链与三态 Region 回归。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveDataset } from '../../dist/core/derive-dataset.js';
import { buildHistoricalIntraday } from '../../dist/algorithms/historical-intraday.js';
import { buildAuctionSeries } from '../../dist/algorithms/auction-series.js';
import { buildTradeSeries } from '../../dist/algorithms/trade-series.js';
import { parseWorkspaceConfig } from '../../dist/workspace/url-config.js';
import { MODULE_CATALOG, MODULE_PRESETS, resolveModules } from '../../dist/workspace/module-catalog.js';
import { DetailCanvasLayout, detailGroupCount } from '../../dist/architecture/detail-canvas-layout.js';
import { CHART_EVENTS } from '../../dist/events.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (f) => JSON.parse(readFileSync(`${root}src/data/${f}`, 'utf8'));
const manifest = rd('manifest.json');
const rawBase = { manifest };
for (const [k, f] of Object.entries(manifest.files)) rawBase[k] = rd(f);

test('模块注册：第 13 个模块在 full / candle-full 预设中，且声明历史分时数据依赖', () => {
  assert.equal(Object.keys(MODULE_CATALOG).length, 13);
  const def = MODULE_CATALOG['historical-intraday'];
  assert.ok(def);
  assert.ok(def.requiresData.includes('intradayMulti'));
  assert.ok(MODULE_PRESETS.full.includes('historical-intraday'));
  assert.ok(!MODULE_PRESETS.candle.includes('historical-intraday'));
  assert.ok(MODULE_PRESETS['candle-full'].includes('historical-intraday'));
  assert.ok(!MODULE_PRESETS.minimal.includes('historical-intraday'));
  assert.ok(!resolveModules({ preset: 'candle' }).includes('historical-intraday'));
  assert.ok(resolveModules({ preset: 'candle-full' }).includes('historical-intraday'));
});

test('buildHistoricalIntraday：近 5 日、每键 242 点、真实/拟真来源、逐日昨收', () => {
  const d = deriveDataset(rawBase);
  const map = buildHistoricalIntraday(d.intradayMulti, d.bars, d.manifest);
  const dates = Object.keys(map);
  assert.equal(dates.length, 5);
  assert.deepEqual(dates, ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  for (const [date, s] of Object.entries(map)) {
    assert.equal(s.tradeDate, date);
    assert.equal(s.points.length, 242, `${date} 应为 242 个交易分钟点`);
    assert.ok(s.points.every((p) => p.time <= '15:00'));
    assert.ok(Number.isFinite(s.preClose) && s.preClose > 0);
    const bar = d.bars.find((b) => b.tradeDate === date);
    assert.equal(s.preClose, bar.preClose, `${date} 昨收应取对应日 K`);
  }
  assert.equal(map['2026-11-13'].source, 'real-intraday');
  for (const date of dates.slice(0, 4)) {
    assert.equal(map[date].source, 'simulated-from-daily-ohlc');
  }
});

test('deriveDataset：默认生成索引；外部注入授权数据时原样保留', () => {
  const d = deriveDataset(rawBase);
  assert.equal(Object.keys(d.historicalIntraday || {}).length, 5);
  const injected = {
    '2026-06-26': {
      tradeDate: '2026-06-26', points: [], preClose: 1184.08, source: 'licensed',
    },
  };
  const custom = deriveDataset({ ...rawBase, historicalIntraday: injected });
  assert.equal(custom.historicalIntraday, injected, '注入通道不应被默认派生覆盖');
});

test('candle-full 预设派生历史分时索引，minimal / intraday 语义不变', () => {
  const candle = deriveDataset(rawBase, { preset: 'candle-full' });
  assert.ok(candle.historicalIntraday && Object.keys(candle.historicalIntraday).length === 5);
  assert.equal(candle.auction, undefined);
  const minimal = deriveDataset(rawBase, { preset: 'minimal' });
  assert.equal(minimal.historicalIntraday, undefined);
  assert.equal(minimal.historicalIntraday, undefined);
});

test('配置链：?historical-intraday 日期校验、?tape-set=intraday、事件常量', () => {
  const cfg = parseWorkspaceConfig(new URLSearchParams('historical-intraday=2026-11-12&tape-set=intraday'));
  assert.equal(cfg.historicalIntradayDate, '2026-11-12');
  assert.equal(cfg.tapeSet, 'intraday');
  const bad = parseWorkspaceConfig(new URLSearchParams('historical-intraday=2026/11/12'));
  assert.equal(bad.historicalIntradayDate, undefined);
  assert.equal(CHART_EVENTS.HISTORICAL_INTRADAY_REQUEST, 'historical-intraday-request');
});

test('DetailCanvasLayout：trades / panorama / intraday 三态 Region 互斥', () => {
  const layout = new DetailCanvasLayout();
  const base = { size: { w: 1200, h: 600 }, hints: {}, state: {} };
  for (const [set, expected] of [
    ['trades', 'cover-groups'], ['orders', 'cover-groups'],
    ['panorama', 'cover-panorama'], ['intraday', 'cover-intraday'],
  ]) {
    const snap = layout.compute({
      ...base,
      detail: { set, totalRows: 100, from: 0 },
    });
    const vis = Object.values(snap.regions).filter((r) => r.visible).map((r) => r.id);
    assert.ok(vis.includes(expected), `${set} 应显示 ${expected}`);
    assert.ok(vis.includes('cover-tabs'));
    if (set === 'intraday') assert.ok(!vis.includes('cover-panorama'));
    if (set === 'panorama') assert.ok(!vis.includes('cover-intraday'));
  }
});

test('历史日竞价：90 点、锚定该日真实端点、末点量额来自分时', () => {
  const d = deriveDataset(rawBase);
  const day = '2026-11-12';
  const dayBars = d.bars.filter((b) => b.tradeDate <= day);
  const points = d.intradayMulti.filter((p) => p.tradeDate === day);
  const auction = buildAuctionSeries(dayBars, points, day);
  assert.equal(auction.length, 90);
  assert.equal(auction.filter((p) => p.phase === 'open').length, 69);
  assert.equal(auction.filter((p) => p.phase === 'close').length, 21);
  const bar = dayBars.at(-1);
  assert.equal(bar.tradeDate, day);
  const openEnd = auction.filter((p) => p.phase === 'open').at(-1);
  assert.equal(Math.round(openEnd.virtualPrice), Math.round(bar.open));
  assert.equal(openEnd.volume, points[0].volume, '9:25 末点量锚定 09:30 首点');
});

test('历史日逐笔：按分钟量额锚定分时，含 trend 后可喂 trade-tape', () => {
  const d = deriveDataset(rawBase);
  const day = '2026-11-12';
  const points = d.intradayMulti.filter((p) => p.tradeDate === day);
  const trades = buildTradeSeries(points, day);
  assert.ok(trades.length > 0);
  // 市面口径：9:25 竞价成交 = 该日首个分钟点量额（不再写死），逐笔总量 === 分时总量
  const auc = trades.filter((t) => t.phase === 'auction');
  assert.equal(auc.length, 1);
  assert.equal(auc[0].volume, points[0].volume, '9:25 竞价成交量须取该日首个分钟点');
  assert.equal(auc[0].amount, points[0].amount);
  const sum = (arr) => arr.reduce((s, x) => s + x.volume, 0);
  assert.equal(sum(trades), sum(points), '逐笔总量须等于分时总量（无重复计数、无盘后造量）');
  assert.equal(trades.filter((t) => t.time.startsWith('09:30')).length, 0, '09:30 分钟已由竞价成交表示');
  assert.ok(trades.every((t) => Number.isFinite(t.timestamp) && Number.isFinite(t.price)));
  const rows = trades.map((t, i, arr) => {
    const diff = t.price - (i === 0 ? d.bars.find((b) => b.tradeDate === day).preClose : arr[i - 1].price);
    return { ...t, trend: Math.abs(diff) < 1e-6 ? 0 : diff > 0 ? 1 : -1 };
  });
  assert.ok(rows.every((r) => [0, 1, -1].includes(r.trend)));
});

test('注入通道可自带 auction / trades（授权数据不被引擎覆盖）', () => {
  const injected = {
    '2026-11-10': {
      tradeDate: '2026-11-10', points: [], preClose: 1439,
      source: 'licensed', auction: [{ timestamp: 1 }], trades: [{ time: '09:30' }],
    },
  };
  const d = deriveDataset({ ...rawBase, historicalIntraday: injected });
  assert.equal(d.historicalIntraday, injected);
  assert.equal(d.historicalIntraday['2026-11-10'].auction.length, 1);
  assert.equal(d.historicalIntraday['2026-11-10'].trades.length, 1);
});

test('历史分时视图配置：竞价开关 / 逐笔展开 / tab 文案', async () => {
  const { DEFAULT_WORKSPACE_CONFIG } = await import('../../dist/workspace/types.js');
  assert.equal(DEFAULT_WORKSPACE_CONFIG.historicalAuctionEnabled, true);
  assert.equal(DEFAULT_WORKSPACE_CONFIG.historicalTapeExpanded, false);
  const cfg = parseWorkspaceConfig(new URLSearchParams(
    'historical-intraday=2026-11-12&historical-auction=off&historical-tape-expanded=1',
  ));
  assert.equal(cfg.historicalAuctionEnabled, false);
  assert.equal(cfg.historicalTapeExpanded, true);
  assert.equal(cfg.historicalIntradayDate, '2026-11-12');
  const skeleton = readFileSync(`${root}src/elements/detail-canvas.ts`, 'utf8');
  assert.ok(skeleton.includes('data-set="intraday">历史分时</button>'));
  assert.ok(!skeleton.includes('data-set="intraday">分时</button>'));
});

test('展开态按容器宽度分多栏连续时间线（与当日逐笔一致）', () => {
  assert.equal(detailGroupCount(1358), 5);
  assert.equal(detailGroupCount(270), 1);
  assert.equal(detailGroupCount(2000), 6); // 上限 6 栏
  const cfg = parseWorkspaceConfig(new URLSearchParams('historical-tape-expanded=1'));
  assert.equal(cfg.historicalTapeExpanded, true);
});
