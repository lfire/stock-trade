#!/usr/bin/env node
// 可重跑校验：示例数据结构与口径、纯函数计算、源码语法、页面引用完整性。
// 注意：下方按模块读取的源码变量（ppSrc / aggSrc / scSrc / genSrc / dtsText 等）均为文件级 const，
// 新增断言前先检索已有声明并复用，不要重复 const 导致模块整体 SyntaxError。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rect, line, rgba, makeScale } from '../src/gl/geometry.js';
import { computeIndicator, ema, intradayVolumeRatio } from '../src/compute/indicators.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };
const rd = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

// 1. 数据结构与口径
const m = rd('src/data/manifest.json');
const bars = rd(`src/data/${m.files.bars}`);
const intra = rd(`src/data/${m.files.intraday}`);
const chips = rd(`src/data/${m.files.chips}`);
const auction = rd(`src/data/${m.files.auction}`);
const trades = rd(`src/data/${m.files.trades}`);
const depth = rd(`src/data/${m.files.depth}`);
const orders = rd(`src/data/${m.files.orders}`);
const pano = rd(`src/data/${m.files.depthFull}`);
const scen = rd(`src/data/${m.files.depthScenarios}`);

const barKeys = ['timestamp', 'tradeDate', 'open', 'high', 'low', 'close', 'preClose', 'volume', 'amount', 'turnoverRate'];
ok(bars.every((b) => barKeys.every((k) => b[k] !== undefined)), 'Bar 字段缺失');
ok(bars.every((b) => b.high >= Math.max(b.open, b.close) - 1e-6 && b.low <= Math.min(b.open, b.close) + 1e-6), 'Bar OHLC 不自洽');
ok(bars.every((b, i) => i === 0 || b.timestamp > bars[i - 1].timestamp), 'Bar 时间非升序');
ok(bars.at(-1).tradeDate === m.tradeDate, '日 K 末根与 manifest 交易日不一致');
// 涨跌停 / 炸板四态（沪市主板 10%，复权误差 0.5% 容差）与注入后的链条闭合
const VALID_STATES = ['', 'limitUp', 'limitDown', 'limitUpBroken', 'limitDownBroken'];
ok(bars.every((b) => VALID_STATES.includes(b.limitState || '')), 'limitState 取值非法');
['limitUp', 'limitDown', 'limitUpBroken', 'limitDownBroken'].forEach((s) =>
  ok(bars.some((b) => b.limitState === s), `缺少 ${s} 样本`));
ok(bars.every((b, i) => i === 0 || Math.abs(b.preClose - bars[i - 1].close) < 0.02), '注入后 preClose 链条断裂');
// 独立基准：比例取自 manifest（不复用生成脚本的常量），容差按交易所最小变动单位固定 0.011 元
const LIMIT_RATE = m.limitRate ?? 0.10;
const PRICE_EPS = 0.011;
const upPx = (b) => Math.round(b.preClose * (1 + LIMIT_RATE) * 100) / 100;
const dnPx = (b) => Math.round(b.preClose * (1 - LIMIT_RATE) * 100) / 100;
ok(bars.filter((b) => b.limitState === 'limitUp').every((b) =>
  Math.abs(b.close - upPx(b)) <= PRICE_EPS), '涨停样本收盘价未封板');
ok(bars.filter((b) => b.limitState === 'limitDown').every((b) =>
  Math.abs(b.close - dnPx(b)) <= PRICE_EPS), '跌停样本收盘价未封板');
ok(bars.filter((b) => b.limitState === 'limitUpBroken').every((b) =>
  Math.abs(b.high - upPx(b)) <= PRICE_EPS
  && Math.abs(b.close - upPx(b)) > PRICE_EPS), '涨停炸板形态不符');
ok(bars.filter((b) => b.limitState === 'limitDownBroken').every((b) =>
  Math.abs(b.low - dnPx(b)) <= PRICE_EPS
  && Math.abs(b.close - dnPx(b)) > PRICE_EPS), '跌停炸板形态不符');
// 预置期望值（由独立标准公式在 600519.SH 前复权 935 根日 K / 截至 2026-11-13 数据上算出）
// 改动公式会直接导致这些断言失败，替代原先「用同一实现自校验」的循环论证
const expectClose = (actual, expected, label) =>
  ok(Math.abs(actual - expected) < 1e-5, `${label}：${actual} ≠ 基准 ${expected}`);
const macdNow = computeIndicator('MACD', bars, {}).values;
expectClose(macdNow[25].dif, -6.501693, 'MACD DIF[25]');
expectClose(macdNow[40].dea, -5.246571, 'MACD DEA[40]');
expectClose(macdNow.at(-1).macd, -2.019009, 'MACD 柱[末根]');
const kdjNow = computeIndicator('KDJ', bars, {}).values;
expectClose(kdjNow.at(-1).k, 51.534178, 'KDJ K[末根]');
expectClose(kdjNow.at(-1).d, 63.215194, 'KDJ D[末根]');
const avg5Daily = bars.slice(-6, -1).reduce((s, b) => s + b.volume, 0) / 5;
expectClose(intradayVolumeRatio(intra.filter((p) => p.time <= '15:00'), avg5Daily, '09:35'),
  2.469124, '分时量比@09:35');
ok(intra.filter((p) => p.session !== 'afterHours').length === 242, '常规时段不是 242 点');
ok(intra.every((p) => p.volume >= 0 && p.amount >= 0), '分时增量出现负数');
ok(Math.abs(intra[0].avgPrice - intra[0].price) < 0.01, '分时首点均价异常');
ok(chips.priceGrid.length === chips.bins && chips.stats.length === chips.dates.length, '筹码档位/日期数不一致');
ok(Math.abs(chips.currentHistogram.ratios.reduce((a, b) => a + b, 0) - 1) < 0.01, '筹码 ratios 总和不为 1');
ok(chips.stats.length === chips.histograms.length && chips.stats.every((s) => s.weightedAvgCost > 0),
  '筹码逐日直方图 / 加权平均成本缺失');
ok(chips.current.profitRatio >= 0 && chips.current.profitRatio <= 1, '获利比例越界');
const openAuction = auction.filter((p) => p.phase === 'open');
const closeAuction = auction.filter((p) => p.phase === 'close');
ok(openAuction.length + closeAuction.length === auction.length, '竞价 phase 取值异常');
// ---- 开盘集合竞价 9:15–9:25（同花顺 9 秒口径，69 点） ----
ok(openAuction.filter((p) => p.volume > 0).length === 1, '开盘竞价成交量规则异常');
ok(openAuction.length === 69, `开盘竞价节点应为 69，实际 ${openAuction.length}`);
const gaps = openAuction.slice(1).map((p, i) => p.timestamp - openAuction[i].timestamp);
ok(gaps.every((g) => g === 9000 || g === 3000), '开盘竞价节点间隔应为 9 秒或 3 秒');
ok(gaps.filter((g) => g === 3000).length === 2, '开盘竞价应恰有两处 3 秒间隔');
['09:19:57', '09:20:00', '09:24:57', '09:25:00'].forEach((t) =>
  ok(openAuction.some((p) => p.time === t), `开盘竞价特殊时间点缺失：${t}`));
ok(openAuction[0].time === '09:15:00' && openAuction.at(-1).time === '09:25:00', '开盘竞价起止时间异常');
ok(openAuction.at(-1).virtualPrice === bars.at(-1).open, '竞价末点应等于真实 9:25 开盘价');
ok(openAuction.at(-1).volume === intra[0].volume, '竞价成交量应与分时 09:30 首点一致');
ok(openAuction.at(-1).amount === intra[0].amount, '竞价成交额应与分时 09:30 首点一致');
ok(openAuction.at(-1).matchedQty * 100 === intra[0].volume, '竞价匹配量(手)应与真实成交量(股)闭合');
ok(openAuction.every((p, i) => i === 0 || p.matchedQty >= openAuction[i - 1].matchedQty), '开盘竞价虚拟匹配量应单调不减');
const priceJumps = openAuction.filter((p, i) => i > 0 && p.virtualPrice !== openAuction[i - 1].virtualPrice).length;
ok(priceJumps <= 16, `开盘竞价价格应呈阶梯状（跳变 ${priceJumps} 次过多）`);
ok(openAuction.at(-1).unmatchedQty === 0, '9:25 未匹配量应归零');
// ---- 尾盘（收盘）集合竞价 14:57–15:00（21 点，沪市 2018-08-20 起） ----
const p1500 = intra.find((p) => p.time === '15:00');
ok(closeAuction.length === 21, `尾盘竞价节点应为 21，实际 ${closeAuction.length}`);
// 两段采集点密度一致：开盘 600s/69 点 ≈ 8.7s/点，尾盘 180s/21 点 ≈ 8.6s/点
ok(Math.abs(closeAuction.length / openAuction.length - 180 / 600) < 0.02,
  '尾盘与开盘竞价的采集点密度应一致（9 秒/点）');
const cgaps = closeAuction.slice(1).map((p, i) => p.timestamp - closeAuction[i].timestamp);
ok(cgaps.every((g) => g === 9000), '尾盘竞价节点间隔应均为 9 秒');
ok(closeAuction[0].time === '14:57:00' && closeAuction.at(-1).time === '15:00:00', '尾盘竞价起止时间异常');
ok(closeAuction.filter((p) => p.volume > 0).length === 1, '尾盘竞价应仅 15:00 有成交量');
ok(closeAuction.at(-1).virtualPrice === bars.at(-1).close, '尾盘竞价末点应等于真实收盘价');
ok(closeAuction.at(-1).volume === p1500.volume, '尾盘竞价成交量应与分时 15:00 一致');
ok(closeAuction.at(-1).amount === p1500.amount, '尾盘竞价成交额应与分时 15:00 一致');
ok(closeAuction.every((p, i) => i === 0 || p.matchedQty >= closeAuction[i - 1].matchedQty), '尾盘竞价虚拟匹配量应单调不减');
ok(closeAuction.at(-1).unmatchedQty === 0, '15:00 未匹配量应归零');
ok(auction.every((p) => /^\d{2}:\d{2}:\d{2}$/.test(p.time)), '竞价 time 未精确到秒');
ok(trades.every((t) => ['B', 'S', 'N'].includes(t.side)), '逐笔 side 越界');
ok(trades.every((t) => t.granularity && t.sideSource && t.license), '逐笔来源标注缺失');
ok(depth[0].bids.length === 10 && depth[0].asks.length === 10, '盘口档数异常');

// 2. 纯函数计算
const geo = [];
rect(geo, 0, 0, 10, 10, rgba('#E24B4A'));
ok(geo.length === 36, 'rect 顶点数异常');
line(geo, 0, 0, 10, 0, 2, rgba('#1D9E75'));
ok(geo.length === 72, '粗线三角形化顶点数异常');
ok(makeScale(0, 100, 0, 200)(50) === 100, '价格映射异常');
ok(ema([1, 2, 3], 3).length === 3, 'EMA 长度异常');
const macd = computeIndicator('MACD', bars, {}).values;
ok(macd.length === bars.length && Number.isFinite(macd.at(-1).macd), 'MACD 计算异常');
const ma5 = computeIndicator('MA', bars, { n: 5 }).values;
ok(ma5[3].value === null && Number.isFinite(ma5[4].value), 'MA 预热期异常');
const vma5 = computeIndicator('MA', bars, { n: 5, field: 'volume' }).values;
const volAvg5 = bars.slice(0, 5).reduce((s, b) => s + b.volume, 0) / 5;
ok(Math.abs(vma5[4].value - volAvg5) < 1e-6, 'MA(field=volume) 量均线计算异常');
const ama10 = computeIndicator('MA', bars, { n: 10, field: 'amount' }).values;
ok(Number.isFinite(ama10[9].value), 'MA(field=amount) 额均线计算异常');
ok(computeIndicator('KDJ', bars, {}).values.length === bars.length, 'KDJ 计算异常');
ok(computeIndicator('VOL_RATIO', bars, {}).values.length === bars.length, '量比计算异常');

// 3. 源码语法
const jsFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(name)) jsFiles.push(p);
  }
};
walk(path.join(root, 'src'));
walk(path.join(root, 'scripts'));
for (const f of jsFiles) {
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); }
  catch (e) { problems.push(`语法错误 ${path.relative(root, f)}: ${String(e.stderr || e.message).slice(0, 120)}`); }
}

// 3b. Level-2 全部挂单：字段、整手、最小变动价位、涨跌停、时间序、撤单规则、收盘十档闭合
const osec = (s) => { const p = s.split(':').map(Number); return p[0] * 3600 + p[1] * 60 + (p[2] || 0); };
const orderKeys = ['ordId', 'time', 'price', 'volume', 'side', 'action', 'level', 'phase', 'tag', 'trend'];
ok(orders.every((o) => orderKeys.every((k) => o[k] !== undefined)), '挂单字段缺失');
ok(orders.every((o) => o.volume > 0 && o.volume % 100 === 0), '挂单委托量非 100 股整数倍');
ok(orders.every((o) => Math.abs(o.price * 100 - Math.round(o.price * 100)) < 1e-6), '挂单价格非 0.01 步长');
// 涨跌停价按 A 股最小变动价位取整到分（round(preClose × 0.9/1.1, 2)）
const limitDown = Math.round(m.preClose * 0.9 * 100) / 100;
const limitUp = Math.round(m.preClose * 1.1 * 100) / 100;
ok(orders.every((o) => o.price >= limitDown - 1e-6 && o.price <= limitUp + 1e-6), '挂单价格越出涨跌停');
ok(orders.every((o, i) => i === 0 || osec(o.time) >= osec(orders[i - 1].time)), '挂单时间非升序');
ok(orders.every((o) => o.action !== 'CANCEL'
  || !((o.time >= '09:20:00' && o.time < '09:30:00') || (o.time >= '14:57:00' && o.time <= '15:00:00'))), '不可撤时段存在撤单');
ok(orders.every((o) => o.action !== 'CANCEL' || (o.tag === `${o.side}C` && o.trend === 0)), '撤单未按买撤 BC / 卖撤 SC 标记');
const byId = new Map(orders.map((o) => [o.ordId, o]));
ok(orders.every((o) => o.action !== 'CANCEL' || !o.cancelOf
  || (byId.get(o.cancelOf)?.side === o.side && byId.get(o.cancelOf)?.price === o.price
      && byId.get(o.cancelOf)?.volume >= o.volume)), '撤单关联的原始委托不一致');
const snapAgg = {};
orders.filter((o) => o.snapshot).forEach((o) => { const k = `${o.side}:${o.price}`; snapAgg[k] = (snapAgg[k] || 0) + o.volume; });
const lv = [...depth[0].bids.map((d) => ({ ...d, side: 'B' })), ...depth[0].asks.map((d) => ({ ...d, side: 'S' }))];
ok(lv.every((d) => (snapAgg[`${d.side}:${d.price}`] || 0) === d.volume), '收盘存活挂单与十档快照不闭合');

// 3c. 全景盘口：价格排序、量/笔数为正、前十档与十档快照闭合
ok(pano.bids.every((d, i) => i === 0 || pano.bids[i - 1].price > d.price), '全景盘口买档价格非降序');
ok(pano.asks.every((d, i) => i === 0 || pano.asks[i - 1].price < d.price), '全景盘口卖档价格非升序');
ok([...pano.bids, ...pano.asks].every((d) => d.volume > 0 && d.orderCount > 0), '全景盘口存在非正挂单量/笔数');
ok(Math.abs(pano.bids.at(-1).price - limitDown) < 1e-6 && Math.abs(pano.asks.at(-1).price - limitUp) < 1e-6, '全景盘口未覆盖至跌停/涨停价');
ok(JSON.stringify(pano.bids.slice(0, 10).map((d) => [d.price, d.volume])) === JSON.stringify(depth[0].bids.map((d) => [d.price, d.volume]))
  && JSON.stringify(pano.asks.slice(0, 10).map((d) => [d.price, d.volume])) === JSON.stringify(depth[0].asks.map((d) => [d.price, d.volume])), '全景盘口前十档与十档快照不闭合');

// 3d. 涨跌停场景：一侧无挂单、另一侧封单价格等于涨跌停价，全景盘口同步
ok(!!scen.normal && !!scen.limitUp && !!scen.limitDown, '盘口场景缺失');
ok(!!scen.normal.depth && !!scen.normal.pano, '普通场景缺少盘口/全景数据');
ok(scen.limitUp.depth.asks.length === 0 && scen.limitUp.depth.bids.length === 10
  && scen.limitUp.depth.bids[0].price === limitUp, '涨停场景：卖盘应为空、买1 为涨停价');
ok(scen.limitDown.depth.bids.length === 0 && scen.limitDown.depth.asks.length === 10
  && scen.limitDown.depth.asks[0].price === limitDown, '跌停场景：买盘应为空、卖1 为跌停价');
ok(scen.limitUp.pano.asks.length === 0 && scen.limitUp.pano.bids[0].price === limitUp
  && scen.limitDown.pano.bids.length === 0 && scen.limitDown.pano.asks[0].price === limitDown, '涨跌停场景全景盘口不同步');

// 3e. 委托生命周期守恒：NEW − ΣFILL − ΣCANCEL = 剩余在挂量，且每个事件的 remainVolume 逐步一致
const evByOrig = new Map();
orders.forEach((o) => {
  if (!o.origOrdId) return;
  if (!evByOrig.has(o.origOrdId)) evByOrig.set(o.origOrdId, []);
  evByOrig.get(o.origOrdId).push(o);
});
ok(orders.filter((o) => o.action === 'NEW' && !o.snapshot).every((n) => {
  let rem = n.volume;
  const evs = (evByOrig.get(n.ordId) || []).slice()
    .sort((a, b) => a.time.localeCompare(b.time) || (a.ordId < b.ordId ? -1 : 1));
  for (const e of evs) {
    rem -= e.volume;
    if (rem < 0 || e.remainVolume !== rem) return false;
  }
  return true;
}), '委托生命周期不守恒（剩余量与事件不一致）');
ok(orders.every((o) => o.action !== 'CANCEL' || o.origVolume >= o.volume), '撤单量大于原委托量');
ok(orders.every((o) => o.action !== 'FILL' || !!o.tradeId), '成交事件缺少成交编号');
ok(trades.every((t) => !t.ordIds || t.ordIds.every((id) => byId.has(id))), '合并分笔关联了不存在的委托号');

// 4. 页面引用完整性 + 组件注册入口契约（elements 不再有 import 时自动注册的副作用）
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
// 同时支持副作用导入 import './x.js' 与命名/默认导入 import { A } from './x.js'
const imports = [...html.matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"](\.\/[^'"]+)['"]/g)].map((x) => x[1]);
for (const i of imports) ok(existsSync(path.join(root, i.split('?')[0])), `index.html 引用缺失：${i}`);
ok(html.includes('defineAll()'), 'index.html 未显式调用 defineAll()');

const ELEMENT_TAGS_CHECK = ['stock-chart', 'price-pane', 'indicator-pane', 'chip-pane',
  'auction-pane', 'trade-tape', 'depth-book'];
const entryPath = path.join(root, 'src/index.js');
ok(existsSync(entryPath), '缺少注册入口 src/index.js');
if (existsSync(entryPath)) {
  const entry = readFileSync(entryPath, 'utf8');
  for (const tag of ELEMENT_TAGS_CHECK) ok(entry.includes(`'${tag}'`), `注册入口缺少标签 ${tag}`);
  ok(entry.includes('export function defineAll'), '注册入口未导出 defineAll()');
}
ok(existsSync(path.join(root, 'src/pure.js')), '缺少纯函数子入口 src/pure.js');
for (const f of jsFiles) {
  const rel = path.relative(root, f);
  if (!rel.startsWith('src/elements/')) continue;
  ok(!readFileSync(f, 'utf8').includes('customElements.define'),
    `${rel} 仍含 import 时自动注册副作用`);
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
ok(pkg.types === './dist/index.d.ts' && pkg.main === './dist/index.js',
  'package.json types / main 未指向构建产物');
ok(pkg.exports?.['.']?.types === './dist/index.d.ts' && pkg.exports?.['.']?.default === './dist/index.js',
  'exports["."] 缺少 types / default 条件');
ok(pkg.exports?.['./pure']?.types === './dist/pure.d.ts' && pkg.exports?.['./pure']?.default === './dist/pure.js',
  'exports["./pure"] 缺少 types / default 条件');
ok(pkg.sideEffects === false && !('private' in pkg), 'package.json 仍为 private 或缺少 sideEffects:false');
ok(typeof pkg.scripts?.typecheck === 'string', '缺少 typecheck 脚本');
for (const f of ['src/index.d.ts', 'src/pure.d.ts']) {
  ok(existsSync(path.join(root, f)), `缺少类型声明 ${f}`);
}
const dtsPath = path.join(root, 'src/index.d.ts');
if (existsSync(dtsPath)) {
  const dts = readFileSync(dtsPath, 'utf8');
  ok(dts.includes('declare function defineAll') && dts.includes('StockChartState'),
    'index.d.ts 缺少 defineAll / StockChartState 声明');
  for (const tag of ELEMENT_TAGS_CHECK) {
    ok(dts.includes(`'${tag}':`), `index.d.ts 的 HTMLElementTagNameMap 缺少 ${tag}`);
  }
  ok(dts.includes('setTheme') && dts.includes('getTheme'), 'index.d.ts 缺少 setTheme / getTheme 声明');
  ok(dts.includes('namespace JSX') && dts.includes("'stock-chart': StockChartJSXAttributes"),
    'index.d.ts 缺少 JSX 自定义元素标签声明');
}
// 主题与框架薄封装契约
ok(pkg.exports?.['./react']?.types === './dist/frameworks/react.d.ts'
  && pkg.exports?.['./react']?.default === './dist/frameworks/react.js',
  'exports 缺少 ./react 薄封装（types/default）');
for (const f of ['src/frameworks/react.js', 'src/frameworks/react.d.ts']) {
  ok(existsSync(path.join(root, f)), `缺少框架薄封装文件 ${f}`);
}
const themeSrc = readFileSync(path.join(root, 'src/types.js'), 'utf8');
ok(themeSrc.includes('export const THEMES') && themeSrc.includes('export function applyPalette'),
  'types.js 缺少主题预设 / applyPalette');
ok(html.includes('var(--sc-bg'), 'index.html :root 未接入 --sc-* 主题变量');
// .d.ts 契约一致性：实现里用到的公开方法/事件必须在声明中（防再次漂移）
const dtsText = readFileSync(dtsPath, 'utf8');
for (const m of ['setSideExpanded', 'updateSide', 'setWindow', 'setViewConfig', 'setCompact',
  'setTheme', 'getTheme', 'layoutMetrics', 'defineAll']) {
  ok(dtsText.includes(m), `index.d.ts 缺少方法声明 ${m}`);
}
for (const ev of ['theme-change', 'auction-hover', 'closing-hover', 'auction-toggle', 'chips-toggle',
  'depth-levels-change', 'view-panorama', 'tape-scroll']) {
  ok(dtsText.includes(`'${ev}'`), `index.d.ts 事件映射缺少 ${ev}`);
}
// 重连幂等契约
const scSrc = readFileSync(path.join(root, 'src/elements/stock-chart.js'), 'utf8');
ok(scSrc.includes('AbortController') && scSrc.includes('this._abort?.abort()'),
  '重连未统一撤销连接期监听');
ok(scSrc.includes('this.barsStyle') && scSrc.includes('el?.remove()'),
  '重连未清理自建 DOM（canvas/overlay/style/pane-bars）');
ok(scSrc.includes("if (name === 'theme')"), 'theme 属性变化未反射到 setTheme()');
ok(scSrc.includes("this.sideSlot.prepend(sideEl)"), '盘口未固定在侧栏首位（重连会错位）');
// 多实例隔离契约：实例色板 / host 级变量 / 事件不外溢
const typesSrc = readFileSync(path.join(root, 'src/types.js'), 'utf8');
ok(typesSrc.includes('export function withPalette'), 'types.js 缺少 withPalette 帧级色板作用域');
ok(readFileSync(path.join(root, 'src/core/chart-context.js'), 'utf8')
  .includes('withPalette(this.palette, () => this.renderFrame())'), 'render 未使用实例色板');
ok(!scSrc.includes('document.documentElement'), 'setTheme 仍写 :root（多实例会串扰）');
ok(scSrc.includes('this.style.setProperty(k, v)'), 'setTheme 未把 --sc-* 写到本实例 host');
const tapeSrc = readFileSync(path.join(root, 'src/elements/trade-tape.js'), 'utf8');
ok(tapeSrc.includes('this._eventHost'), 'trade-tape 仍向 document 注册 crosshair 监听');
ok(!html.includes("document.addEventListener('dataset-ready'"), '页面仍用 document 监听业务事件');
// 硬编码收口：布局数值与示例页颜色不得再写死
const ctxSrc = readFileSync(path.join(root, 'src/core/chart-context.js'), 'utf8');
ok(ctxSrc.includes('const SUBPLOT_INFO_H = LAYOUT.rowH'), '副图信息栏高度未引用 LAYOUT');
ok(!html.includes('<ma-line period="5" color='), '示例页均线仍写死 color');
ok(html.includes('var(--sc-row-h,18px)') && html.includes('height:var(--sc-row-h,18px)'),
  '页面仍有未引用 LAYOUT 的 18px 行高');
const ppSrc = readFileSync(path.join(root, 'src/elements/price-pane.js'), 'utf8');
ok(ppSrc.includes('softColor(PALETTE.up)') && ppSrc.includes('rgba(PALETTE.neutral)'),
  '主图几何仍有预调浅色硬编码');
// 4 条标题/表头行统一 + 余数均分给间隙
ok(typesSrc.includes('barH: 24'), 'LAYOUT 缺少统一 barH 基准');
ok(scSrc.includes('const each = Math.floor(rem / 4)')
  && scSrc.includes('const left = rem - 4 * each')
  && scSrc.includes("setProperty('--sc-split-h'"),
  '4 条行均分 / 余数给间隙的算式缺失');
// 第三轮回归防护：主题重算、footer 时序自愈、类型契约
const setThemeBody = scSrc.slice(scSrc.indexOf('setTheme(theme,'), scSrc.indexOf('getTheme()'));
ok(setThemeBody.includes('this.syncSideBars()'), 'setTheme 后未重算 4 条行均分');
ok(scSrc.includes('refreshDefaultMAColors(palette)') && scSrc.includes('MA_DEFAULT_KEYS'),
  '主题切换未刷新默认均线色');
ok(scSrc.includes("color:var(--sc-up,"), 'showError 仍读全局 PALETTE 颜色');
ok(scSrc.includes("attributeFilter: ['hidden']") && scSrc.includes('footer.getClientRects().length'),
  '底部条 hidden 变化未自愈重算');
ok(html.includes('.tape-footer[hidden]{display:none}'), 'hidden 会被 display:flex 覆盖');
ok(tapeSrc.includes("this.colCls[i] || ''"), '时间表头又回退成 num（右对齐）');
ok(!dtsText.includes('export declare class PaneElementBase'), '.d.ts 仍有幽灵基类导出');
ok(dtsText.includes('export declare class AuctionPane extends HTMLElement')
  && dtsText.includes('syncSideBars(): void')
  && dtsText.includes("'load-start': CustomEvent<{ base: string }>"),
  '.d.ts 契约漂移（pane 继承 / 方法 / 事件 detail）');
// 第 3~6 步：发布工程化 / WebGL 恢复 / dataset 解绑 / 行为断言
const pkgObj = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const k of ['license', 'author', 'repository', 'keywords']) ok(!!pkgObj[k], `package.json 缺少 ${k}`);
ok(pkgObj.files.includes('dist') && !pkgObj.files.includes('src') && !pkgObj.files.includes('docs'),
  'files 仍把源码或示例数据/文档打进包');
for (const s of ['test', 'build', 'prepublishOnly']) ok(!!pkgObj.scripts[s], `缺少 npm script ${s}`);
ok(pkgObj.devDependencies.typescript === '5.6.3', 'TypeScript 未锁定精确版本');
ok(existsSync(path.join(root, 'scripts/build.mjs')) && existsSync(path.join(root, 'scripts/tests/contract.test.mjs')),
  '缺少构建/测试脚本');
const rendererSrc = readFileSync(path.join(root, 'src/gl/renderer.js'), 'utf8');
ok(rendererSrc.includes('initGL()')
  && /onContextRestored[\s\S]{0,400}this\.initGL\(\)/.test(rendererSrc),
  'WebGL 恢复未重建 program/VBO');
ok(scSrc.includes("webglcontext-restored"), '恢复事件未触发重绘');
const storeSrc = readFileSync(path.join(root, 'src/core/data-store.js'), 'utf8');
ok(storeSrc.includes('if (!base) throw') && storeSrc.includes('Object.entries(manifest.files || {})'),
  'dataset 仍硬编码默认目录或 9 个分片');
ok(!scSrc.includes("|| './src/data'"), '组件仍无条件 fetch ./src/data');
ok(dtsText.includes("'webglcontext-restored'") && dtsText.includes("export { bindStockChart }"),
  '.d.ts 缺少新增事件或 React 薄封装 re-export');
// P0 算法口径：防止 EMA 冷启动 / 日线量比 / 序号分桶回归
const indSrc = readFileSync(path.join(root, 'src/compute/indicators.js'), 'utf8');
ok(indSrc.includes('前 N 个值取简单平均') && indSrc.includes('out[n - 1] = prev'),
  'EMA 未用 SMA 初始化');
ok(indSrc.includes('dif.findIndex((v) => v != null)'), 'MACD DEA 未在 DIF 有效段上递推');
ok(indSrc.includes('intradayVolumeRatio') && indSrc.includes('elapsedMarketMinutes'),
  '缺少分时量比（累计开市分钟）实现');
const aggSrc = readFileSync(path.join(root, 'src/core/bar-aggregator.js'), 'utf8');
ok(aggSrc.includes('intradayBucket') && aggSrc.includes('SESSION_MINUTES'),
  '分钟 K 未按时段边界分桶');
ok(readFileSync(path.join(root, 'src/elements/price-pane.js'), 'utf8').includes("'日量比'"),
  'K 线面板未标注日线量比口径');
ok(existsSync(path.join(root, 'scripts/tests/algorithm-regression.test.mjs')),
  '缺少独立基准的数值回归测试');
// MACD 参数：固定默认 + 可配置
const ipSrc = readFileSync(path.join(root, 'src/core/indicator-params.js'), 'utf8');
ok(ipSrc.includes('DEFAULT_MACD_PARAMS') && !ipSrc.includes('if (count >= 40)'),
  'MACD 参数仍随 K 线根数自适应');
ok(ipSrc.includes('parseMACDParams') && ipSrc.includes('resolveMACDParams'),
  '缺少 MACD 参数配置解析');
ok(scSrc.includes('setMACDParams(') && scSrc.includes("'macd'"),
  '组件缺少 MACD 参数配置入口');
ok(readFileSync(path.join(root, 'src/elements/indicator-pane.js'), 'utf8').includes('ctx.getMACDParams()'),
  '副图未从组件统一真源读取 MACD 参数');
ok(dtsText.includes("'macd-params-change'") && dtsText.includes('setMACDParams('),
  '.d.ts 缺少 MACD 参数契约');
ok(html.includes("urlParams.get('macd')"), '示例页缺少 ?macd= 配置入口');
// P1 算法口径
ok(existsSync(path.join(root, 'scripts/auction-match.mjs'))
  && existsSync(path.join(root, 'scripts/limit-rules.mjs')),
  '缺少集合竞价撮合 / 涨跌停规则模块');
const genSrc = readFileSync(path.join(root, 'scripts/build-sample-data.mjs'), 'utf8');
ok(genSrc.includes('matchAuction(') && !genSrc.includes('const unmatchedSide = unmatched === 0'),
  '竞价虚拟价仍为硬编码 + 随机方向');
ok(genSrc.includes('b.amount / b.volume'), '筹码三角分布峰值未取当日成交均价');
ok(genSrc.includes('chips-decay') && genSrc.includes('chips-shape'), '筹码模型参数不可配置');
ok(m.limitRate === 0.10, 'manifest 缺少按板块识别的涨跌幅比例');
const chipPaneSrc = readFileSync(path.join(root, 'src/elements/chip-pane.js'), 'utf8');
ok(chipPaneSrc.includes('平均成本(COST50)') && chipPaneSrc.includes('集中度(面板)'),
  '筹码 UI 术语未对齐软件面板口径');
ok(scSrc.includes("row('平均成本', c.avgCost") && scSrc.includes('集中度(面板口径)'),
  '统计面板仍把加权平均当成平均成本');
ok(existsSync(path.join(root, 'scripts/tests/p1-algorithm.test.mjs')),
  '缺少 P1 数值回归测试');
// 分时头部明细：删除「价 / 量比」，新增「高 / 低」（取当日日 K 的 high/low；复用上方 ppSrc）
ok(ppSrc.includes("{ label: '高'") && ppSrc.includes("{ label: '低'")
  && ppSrc.includes('today.high') && ppSrc.includes('today.low'),
  '分时明细缺少今日最高/最低价');
ok(!ppSrc.includes("{ label: '价'") && !ppSrc.includes("{ label: '量比'"),
  '分时明细仍显示「价」或「量比」');
// K 线周期：11 个选项、顺序、默认日 K（复用上方 aggSrc）
ok(aggSrc.includes("DEFAULT_PERIOD = '1d'"), '缺少默认日 K 常量');
for (const key of ['1m', '5m', '15m', '30m', '60m', '120m', '1d', '1w', '1M', '1Q', '1Y']) {
  ok(aggSrc.includes(`key: '${key}'`), `PERIODS 缺少 ${key}`);
}
ok(aggSrc.includes("label: '120 分钟'"), '120m 标签应为「120 分钟」');
ok(html.includes('selPeriod.value = chart.getPeriod()'), '周期下拉未显式选中默认日 K');
ok(readFileSync(path.join(root, 'src/core/chart-context.js'), 'utf8').includes('DEFAULT_PERIOD'),
  '组件未使用默认周期常量');
const dbSrc = readFileSync(path.join(root, 'src/elements/depth-book.js'), 'utf8');
ok(dbSrc.includes('var(--sc-bar-h') && dbSrc.includes('var(--sc-split-h'),
  '盘口两条行或买卖间隙未用统一变量');
ok(html.includes('height:var(--sc-bar-h,24px)') && tapeSrc.includes('var(--sc-bar-h'),
  '明细标题行 / 表头行未用统一 bar 高度');

// 5. 结论
console.log(`数据：日 K ${bars.length} 根 | 分时 ${intra.length} 点 | 筹码 ${chips.bins} 档/${chips.stats.length} 日 | 竞价 ${auction.length} 点 | 逐笔 ${trades.length} 条 | 盘口 ${depth.length} 快照 | 挂单 ${orders.length} 条 | 全景盘口 买${pano.bids.length}/卖${pano.asks.length} 档`);
console.log(`源码：${jsFiles.length} 个 JS/MJS 文件语法检查 | 注册入口 ${ELEMENT_TAGS_CHECK.length} 个标签 + pure 子入口`);
console.log(`指标：MACD / MA / KDJ / 量比 / VOL / AMOUNT 纯函数校验`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} 项未通过：`);
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
console.log('\n✅ 全部校验通过');
