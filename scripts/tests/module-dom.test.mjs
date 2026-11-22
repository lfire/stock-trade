/**
 * 模块化加载 · 阶段二：DOM / CSS 按需装载的行为回归。
 *
 * 覆盖：full 预设模板/CSS 与全量常量逐字符一致（硬约束）、
 * candle / intraday / minimal 预设与显式 modules 的模板裁剪、
 * CSS 片段裁剪、扩展模块 templateKeys/cssKeys 正向落地、自定义 CSS 片段登记与告警、
 * build* 纯函数性，以及架构对外契约 API（modulesForRegion / modulesForContainer）可调用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceTemplate, buildWorkspaceCSS, registerCssSegment,
  WORKSPACE_TEMPLATE, WORKSPACE_CSS,
} from '../../dist/workspace/template.js';
import { resolveModules, registerModule } from '../../dist/workspace/module-catalog.js';
import { modulesForRegion, modulesForContainer } from '../../dist/pure.js';

const full = () => resolveModules({ preset: 'full' });

test('full 预设：模板/CSS 与 WORKSPACE_TEMPLATE / WORKSPACE_CSS 逐字符一致', () => {
  assert.equal(buildWorkspaceTemplate(full()), WORKSPACE_TEMPLATE);
  assert.equal(buildWorkspaceCSS(full()), WORKSPACE_CSS);
});

test('candle 预设模板：无 auction-pane / depth-book / #tape-home，有 chip-pane / price-pane / indicator-pane', () => {
  const tpl = buildWorkspaceTemplate(resolveModules({ preset: 'candle' }));
  for (const absent of ['auction-pane', 'depth-book', 'id="tape-home"']) {
    assert.ok(!tpl.includes(absent), `candle 模板仍含 ${absent}`);
  }
  for (const present of ['chip-pane', 'price-pane', 'indicator-pane']) {
    assert.ok(tpl.includes(present), `candle 模板缺少 ${present}`);
  }
});

test('intraday 预设模板：无 chip-pane，有 auction-pane / #tape-home', () => {
  const tpl = buildWorkspaceTemplate(resolveModules({ preset: 'intraday' }));
  assert.ok(!tpl.includes('chip-pane'), 'intraday 模板仍含 chip-pane');
  assert.ok(tpl.includes('auction-pane'), 'intraday 模板缺少 auction-pane');
  assert.ok(tpl.includes('id="tape-home"'), 'intraday 模板缺少 #tape-home');
});

test('minimal 预设模板：无 indicator-pane / .chart-tools / #tape-home，有 .hdr-left / price-pane', () => {
  const tpl = buildWorkspaceTemplate(resolveModules({ preset: 'minimal' }));
  for (const absent of ['indicator-pane', 'chart-tools', 'tape-home']) {
    assert.ok(!tpl.includes(absent), `minimal 模板仍含 ${absent}`);
  }
  assert.ok(tpl.includes('hdr-left'), 'minimal 模板缺少 .hdr-left');
  assert.ok(tpl.includes('price-pane'), 'minimal 模板缺少 price-pane');
});

test('显式 modules: core+price-candle+indicator：无 header / toolbar / tape 相关节点', () => {
  const tpl = buildWorkspaceTemplate(resolveModules({ modules: ['core', 'price-candle', 'indicator'] }));
  for (const absent of ['chart-header', 'hdr-left', 'head-name', 'chart-tools', 'btn-theme', 'tape-home']) {
    assert.ok(!tpl.includes(absent), `显式 modules 模板仍含 ${absent}`);
  }
  assert.ok(tpl.includes('id="chart"') && tpl.includes('price-pane') && tpl.includes('indicator-pane'),
    '核心画布与主图/副图节点应保留');
});

test('CSS 裁剪：minimal 不含 .pano-row / .detail-cover / .tape-footer，含 button, 基础规则；full 含 .pano-row', () => {
  const minCss = buildWorkspaceCSS(resolveModules({ preset: 'minimal' }));
  for (const absent of ['.pano-row', '.detail-cover', '.tape-footer']) {
    assert.ok(!minCss.includes(absent), `minimal CSS 仍含 ${absent}`);
  }
  assert.ok(minCss.includes('button,'), 'minimal CSS 缺少 button 基础规则');
  assert.ok(buildWorkspaceCSS(full()).includes('.pano-row'), 'full CSS 缺少 .pano-row 全景盘口规则');
});

test('build* 纯函数：重复调用结果一致、不修改入参数组', () => {
  const mods = ['core', 'price-intraday', 'indicator', 'chip', 'header'];
  const snapshot = [...mods];
  const t1 = buildWorkspaceTemplate(mods);
  const t2 = buildWorkspaceTemplate(mods);
  const c1 = buildWorkspaceCSS(mods);
  const c2 = buildWorkspaceCSS(mods);
  assert.equal(t1, t2, 'buildWorkspaceTemplate 重复调用结果不一致');
  assert.equal(c1, c2, 'buildWorkspaceCSS 重复调用结果不一致');
  assert.deepEqual(mods, snapshot, 'build* 修改了入参数组');
});

test('扩展模块数据驱动（正向）：templateKeys / cssKeys 显式启用后 DOM/CSS 均有贡献', () => {
  const id = '__dom_probe_module__';
  const PROBE_CSS = '/* __probe_segment__ */\n.__probe_marker__{color:#123456}';
  registerCssSegment('__probe', PROBE_CSS);
  registerModule({
    id, label: 'DOM 扩展探针模块', requiresData: [], dependencies: ['core'],
    presets: [], templateKeys: ['panes'], cssKeys: ['__probe'], lifecycle: null,
  });
  const enabled = resolveModules({ modules: ['core', id] });
  assert.ok(enabled.includes(id), '显式装载清单应包含新模块');

  // 模板：templateKeys:['panes'] 驱动 panes 相关切片输出（不再被当作死字段静默忽略）。
  const tpl = buildWorkspaceTemplate(enabled);
  assert.ok(tpl.includes('price-pane'), 'templateKeys:["panes"] 未驱动 panes 切片输出');
  assert.ok(tpl.includes('id="chart"'), '新模块装载后模板仍应含核心画布');

  // CSS：cssKeys:['__probe'] 经 registerCssSegment 登记的片段文本确实合并进输出。
  const css = buildWorkspaceCSS(enabled);
  assert.ok(css.includes('.__probe_marker__'), 'CSS 缺少新模块 registerCssSegment 片段贡献');
  assert.ok(css.includes('__probe_segment__'), 'CSS 缺少登记片段标记');
  assert.ok(!buildWorkspaceCSS(full()).includes('.__probe_marker__'),
    'full CSS 不应混入未启用模块的探针片段');

  assert.equal(buildWorkspaceTemplate(['core', '__unknown_id__']), buildWorkspaceTemplate(['core']),
    '未知 id 不应影响模板结果');
  assert.equal(buildWorkspaceTemplate(full()), WORKSPACE_TEMPLATE, 'full 模板仍逐字符一致');
  assert.equal(buildWorkspaceCSS(full()), WORKSPACE_CSS, 'full CSS 仍逐字符一致');
});

test('未登记的非内置 cssKey：给一次 console.warn 且不影响构建（不抛错）', () => {
  const id = '__dom_warn_module__';
  registerModule({
    id, label: '未登记 CSS 模块', requiresData: [], dependencies: ['core'],
    presets: [], templateKeys: [], cssKeys: ['__missing_css_key__'], lifecycle: null,
  });
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  try {
    const css = buildWorkspaceCSS(resolveModules({ modules: ['core', id] }));
    assert.ok(css.includes('button,'), '未登记 cssKey 不应导致构建抛错或丢失内置段');
    assert.equal(warns.length, 1, '未登记 cssKey 应恰好给一次 console.warn');
    assert.ok(warns[0].includes('__missing_css_key__'), 'warn 应点名缺失的 cssKey');
    buildWorkspaceCSS(resolveModules({ modules: ['core', id] }));
    assert.equal(warns.length, 1, '同一 cssKey 不应重复告警');
  } finally {
    console.warn = original;
  }
});

test('架构对外契约 API：modulesForRegion / modulesForContainer 可调用', () => {
  const byRegion = modulesForRegion('subplot-0');
  assert.ok(Array.isArray(byRegion) && byRegion.length >= 1, 'modulesForRegion 应命中模块');
  assert.ok(byRegion.every((m) => m && typeof m.id === 'string' && typeof m.regionType === 'string'),
    'modulesForRegion 应返回完整 ModuleDescriptor');
  assert.ok(byRegion.some((m) => m.id === 'indicator'), 'subplot-0 应命中副图模块');
  const byContainer = modulesForContainer('main-canvas');
  assert.ok(Array.isArray(byContainer) && byContainer.length >= 1, 'modulesForContainer 应返回模块');
  assert.ok(byContainer.some((m) => m.id === 'price-chart'), 'main-canvas 应含 price-chart');
  assert.ok(byContainer.every((m) => m.container === 'main-canvas' || m.container === '*'),
    'modulesForContainer 结果应只含该容器或可迁移模块');
});
