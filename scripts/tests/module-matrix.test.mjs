/**
 * 模块化按需装载的矩阵门禁。
 *
 * 不变量：模块启用 ⇔ 独占 DOM 切片 / cssKey 段 / requiresData 数据字段 / lifecycle 挂载；
 * 未启用模块的独占标记不得残留；默认 full 与 preset:full 逐字段一致。
 * 覆盖 13 个单模块 + 5 个预设 + 若干组合，防止「声明启用但零产出」或「未启用却有 DOM」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveDataset } from '../../dist/core/derive-dataset.js';
import { buildWorkspaceTemplate, buildWorkspaceCSS, WORKSPACE_TEMPLATE, WORKSPACE_CSS } from '../../dist/workspace/template.js';
import {
  MODULE_CATALOG, MODULE_PRESETS, resolveModules, requiredDataFor,
} from '../../dist/workspace/module-catalog.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rd = (f) => JSON.parse(readFileSync(`${root}src/data/${f}`, 'utf8'));
const manifest = rd('manifest.json');
const rawBase = { manifest };
for (const [k, f] of Object.entries(manifest.files)) rawBase[k] = rd(f);

const IDS = Object.keys(MODULE_CATALOG);

/** 每个非 core 模块至少应产出的独占 DOM 标记（模块级归属） */
const DOM_MARK = {
  // 分时/ K 线主模式按钮属共享工具栏；分时模块的独占 DOM 是多日分段控件
  'price-intraday': 'intraday-days-seg',
  'price-candle': 'sel-period',
  auction: 'auction-pane',
  indicator: 'indicator-pane',
  chip: 'chip-pane',
  'depth-book': 'depth-book',
  'trade-tape': 'tape-home',
  'detail-cover': 'tape-home',
  panorama: 'tape-home',
  header: 'hdr-left',
  toolbar: 'chart-tools',
  'historical-intraday': 'sel-historical-intraday',
};

/** 模块启用时应派生的数据字段（requiresData 的可见产出） */
const DATA_MARK = {
  'price-intraday': 'intradayMulti',
  auction: 'auction',
  indicator: 'bars',
  chip: 'chips',
  'depth-book': 'depth',
  'trade-tape': 'trades',
  'detail-cover': 'depthFull',
  panorama: 'depthScenarios',
  'historical-intraday': 'historicalIntraday',
};

const tpl = (modules) => buildWorkspaceTemplate(resolveModules({ modules }));
const css = (modules) => buildWorkspaceCSS(resolveModules({ modules }));

test('13 个模块单模块启用：依赖闭包、拓扑序、独占 DOM 与数据', () => {
  const coreTpl = tpl(['core']);
  for (const id of IDS) {
    const enabled = resolveModules({ modules: ['core', id] });
    assert.ok(enabled[0] === 'core', `${id}: core 必须在首位`);
    assert.ok(enabled.includes(id), `${id}: 自身未启用`);
    for (const dep of MODULE_CATALOG[id].dependencies) {
      assert.ok(enabled.indexOf(dep) < enabled.indexOf(id), `${id}: 依赖 ${dep} 未排在前`);
    }
    if (DOM_MARK[id]) {
      assert.ok(buildWorkspaceTemplate(enabled).includes(DOM_MARK[id]),
        `${id}: 缺少独占 DOM 标记 ${DOM_MARK[id]}（半装载）`);
      assert.ok(!coreTpl.includes(DOM_MARK[id]) || id === 'core',
        `${id}: 仅 core 也含 ${DOM_MARK[id]}（无模块级归属）`);
    }
    if (DATA_MARK[id]) {
      const d = deriveDataset(rawBase, { modules: ['core', id] });
      assert.notEqual(d[DATA_MARK[id]], undefined, `${id}: 未派生 ${DATA_MARK[id]}`);
    }
  }
});

test('未启用模块的独占标记不残留（DOM / CSS）', () => {
  // historical-intraday 的下拉只在该模块启用时出现
  assert.ok(tpl(['core', 'historical-intraday']).includes('sel-historical-intraday'));
  for (const [label, modules] of [
    ['core+header+toolbar', ['core', 'header', 'toolbar']],
    ['preset:minimal', resolveModules({ preset: 'minimal' })],
    ['preset:intraday', resolveModules({ preset: 'intraday' })],
    ['preset:candle', resolveModules({ preset: 'candle' })],
  ]) {
    assert.ok(!tpl(modules).includes('sel-historical-intraday'), `${label}: 历史分时下拉残留`);
  }
  // toolbar 未启用时不得带出 chart-tools
  assert.ok(!tpl(['core', 'historical-intraday']).includes('chart-tools'),
    'historical-intraday 未启用 toolbar 却带出 chart-tools');
  // 未启用 panorama / detailCover 时 CSS 段不出现
  assert.ok(!css(['core', 'header']).includes('.pano-row'));
});

test('CSS 段按 cssKeys 精确裁剪：full 全量、minimal 最小', () => {
  const full = css(resolveModules({ preset: 'full' }));
  const minimal = css(resolveModules({ preset: 'minimal' }));
  assert.ok(full.includes('.pano-row') && full.includes('.hist-tape-grid'));
  assert.ok(!minimal.includes('.pano-row') && !minimal.includes('.hist-tape-grid'));
  assert.ok(minimal.length < full.length);
});

test('5 个预设：candle 真按需，candle-full 才拉起历史分时依赖链', () => {
  assert.equal(Object.keys(MODULE_PRESETS).length, 5);
  const candle = resolveModules({ preset: 'candle' });
  const full = resolveModules({ preset: 'candle-full' });
  assert.ok(!candle.includes('historical-intraday'));
  assert.ok(full.includes('historical-intraday'));
  assert.ok(requiredDataFor(candle).length < requiredDataFor(full).length);
  const cd = deriveDataset(rawBase, { preset: 'candle' });
  const fd = deriveDataset(rawBase, { preset: 'candle-full' });
  assert.equal(cd.historicalIntraday, undefined);
  assert.ok(fd.historicalIntraday && Object.keys(fd.historicalIntraday).length === 5);
  assert.ok(!tpl(candle).includes('sel-historical-intraday'));
  assert.ok(tpl(full).includes('sel-historical-intraday'));
});

test('full 向后兼容：模板/CSS 恒等 + 默认与 preset:full 逐字段一致', () => {
  const full = resolveModules({ preset: 'full' });
  assert.equal(buildWorkspaceTemplate(full), WORKSPACE_TEMPLATE);
  assert.equal(buildWorkspaceCSS(full), WORKSPACE_CSS);
  const a = deriveDataset(rawBase);
  const b = deriveDataset(rawBase, { preset: 'full' });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('任意组合：数据闭包与 fetch 范围自洽、无半装载', () => {
  const combos = [
    ['core', 'price-candle', 'indicator', 'chip'],
    ['core', 'price-intraday', 'auction', 'indicator'],
    ['core', 'header', 'toolbar', 'depth-book'],
    ['core', 'historical-intraday'],
    ['core', 'trade-tape', 'detail-cover', 'panorama'],
  ];
  for (const mods of combos) {
    const enabled = resolveModules({ modules: mods });
    const need = new Set(requiredDataFor(enabled));
    const d = deriveDataset(rawBase, { modules: mods });
    for (const id of enabled) {
      if (DATA_MARK[id]) assert.notEqual(d[DATA_MARK[id]], undefined, `${mods}: ${id} 数据缺失`);
    }
    assert.ok(need.has('bars') && need.has('intraday'));
    assert.ok(buildWorkspaceTemplate(enabled).includes('price-pane'));
  }
});

test('扩展点：新模块需显式列入 modules，数据/CSS/独占 DOM 可落地', async () => {
  const { registerTemplateSlice, registerCssSegment } = await import('../../dist/workspace/template.js');
  const { registerModule } = await import('../../dist/workspace/module-catalog.js');
  const id = '__matrix_probe__';
  registerModule({
    id, label: '矩阵探针', requiresData: ['chips'], dependencies: ['core'], presets: [],
    templateSlices: ['__matrix_slice__'], cssKeys: ['__matrix_css__'], lifecycle: null,
  });
  registerTemplateSlice({
    id: '__matrix_slice__', text: '<div id="matrix-probe-marker"></div>',
    owners: [], always: false, after: 'panes',
  });
  registerCssSegment('__matrix_css__', '/* matrix-probe-css */');
  const enabled = resolveModules({ modules: ['core', id] });
  assert.ok(enabled.includes(id));
  assert.ok(!resolveModules({ preset: 'full' }).includes(id), '新模块不得污染静态预设');
  assert.ok(buildWorkspaceTemplate(enabled).includes('matrix-probe-marker'), '独占 DOM 未落地');
  assert.ok(buildWorkspaceCSS(enabled).includes('matrix-probe-css'), '自定义 CSS 未落地');
  assert.notEqual(deriveDataset(rawBase, { modules: ['core', id] }).chips, undefined);
  // full 恒等不受注册影响
  assert.equal(buildWorkspaceTemplate(resolveModules({ preset: 'full' })), WORKSPACE_TEMPLATE);
});
