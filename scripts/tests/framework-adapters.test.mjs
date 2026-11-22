/**
 * 跨框架适配层运行时契约测试。
 * 从 dist/frameworks/*.js 直接 import 运行时 API，用 new EventTarget() 作 fake host，
 * 不加载根入口（根入口在 Node 里不可执行）、不触碰 document / customElements。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceController, bindWorkspace, mountWorkspace, diffConfig,
  camelToEventName, WORKSPACE_EVENT_NAMES,
} from '../../dist/frameworks/controller.js';
import {
  bindStockChart, createWorkspaceRef, bindWorkspaceProps,
} from '../../dist/frameworks/react.js';
import { vWorkspace, vStockChart } from '../../dist/frameworks/vue.js';
import { workspaceAction, stockWorkspace } from '../../dist/frameworks/svelte.js';
import { createWorkspaceDirective } from '../../dist/frameworks/angular.js';
import {
  splitWorkspaceProps, workspaceProps, createWorkspaceSignalBinding,
} from '../../dist/frameworks/solid.js';
import { mount, mountWithData } from '../../dist/frameworks/vanilla.js';

/** 最小 fake host：EventTarget + 可统计的 setData / setConfig setter */
function makeHost() {
  const host = new EventTarget();
  const dataWrites = [];
  const configWrites = [];
  host.setData = (v) => { dataWrites.push(v); host.data = v; };
  host.setConfig = (patch) => {
    configWrites.push(patch);
    host.config = { ...(host.config || {}), ...patch };
  };
  return { host, dataWrites, configWrites };
}

/** 派发一个带 detail 的 CustomEvent */
function fire(host, type, detail = {}) {
  host.dispatchEvent(new CustomEvent(type, { detail }));
}

test('createWorkspaceController 初次写入 data 与 config 并返回 controller', () => {
  const { host, dataWrites, configWrites } = makeHost();
  const data = { manifest: {}, bars: [] };
  const config = { mode: 'candle', theme: 'dark' };
  const c = createWorkspaceController(host, { data, config });
  assert.ok(c, '应返回 controller');
  assert.equal(c.element, host);
  assert.deepEqual(dataWrites, [data], 'data 应写入一次');
  assert.equal(configWrites.length, 1, 'config 应写入一次');
  assert.deepEqual(configWrites[0], config, 'config patch 应为初始全量字段');
  assert.equal(host.data, data);
  assert.deepEqual(host.config, config);
  c.destroy();
  assert.equal(createWorkspaceController(null, {}), undefined, 'null host 返回 undefined');
});

test('createWorkspaceController.update 增量 diff，相同 props 不重复写', () => {
  const { host, dataWrites, configWrites } = makeHost();
  const data = { bars: [1] };
  const props = { data, config: { mode: 'candle', theme: 'light' } };
  const c = createWorkspaceController(host, props);

  assert.equal(c.update(props), false, '同一 props 引用应无变更');
  assert.equal(dataWrites.length, 1);
  assert.equal(configWrites.length, 1);

  assert.equal(c.update({ data, config: { mode: 'candle', theme: 'light' } }), false,
    '内容相同但新对象也应判无变化');
  assert.equal(configWrites.length, 1);

  assert.equal(c.update({ data, config: { mode: 'intraday', theme: 'light' } }), true,
    '变化一个 key 应返回 true');
  assert.equal(configWrites.length, 2);
  assert.deepEqual(configWrites[1], { mode: 'intraday' }, 'patch 只含变化字段');

  const data2 = { bars: [1, 2] };
  assert.equal(c.update({ data: data2, config: { mode: 'intraday', theme: 'light' } }), true,
    'data 引用变化应触发写入');
  assert.equal(dataWrites.length, 2);
  assert.equal(dataWrites[1], data2);
  c.destroy();
});

test('createWorkspaceController 支持 on 字典与 onXxx 驼峰收到 CustomEvent', () => {
  const { host } = makeHost();
  const viaDict = [];
  const viaCamel = [];
  const c = createWorkspaceController(host, {
    on: { 'theme-change': (e) => viaDict.push(e) },
    onChartError: (e) => viaCamel.push(e),
  });
  fire(host, 'theme-change', { theme: 'dark', palette: {} });
  // 驼峰回调与事件名字典绑定到同一个真实事件名
  assert.equal(camelToEventName('onChartError'), 'chart-error');
  fire(host, camelToEventName('onChartError'), { message: 'boom' });

  assert.equal(viaDict.length, 1);
  assert.ok(viaDict[0] instanceof CustomEvent, 'on 字典应收到 CustomEvent');
  assert.deepEqual(viaDict[0].detail, { theme: 'dark', palette: {} });
  assert.equal(viaCamel.length, 1);
  assert.ok(viaCamel[0] instanceof CustomEvent, 'onXxx 驼峰应收到 CustomEvent');
  assert.equal(viaCamel[0].detail.message, 'boom');
  c.destroy();
});

test('createWorkspaceController.destroy 解绑后不再收到事件', () => {
  const { host } = makeHost();
  let count = 0;
  const c = createWorkspaceController(host, {
    on: { 'workspace-ready': () => { count += 1; } },
  });
  fire(host, 'workspace-ready', { config: {} });
  assert.equal(count, 1);
  c.destroy();
  fire(host, 'workspace-ready', { config: {} });
  assert.equal(count, 1, 'destroy 后不应再收到');
});

test('diffConfig 逐 key 比较 / 嵌套引用替换 / 无变化返回 null', () => {
  assert.equal(diffConfig(undefined, undefined), null);
  const a = { mode: 'candle', theme: 'light' };
  assert.equal(diffConfig(a, a), null, '同引用返回 null');
  assert.equal(diffConfig(a, { mode: 'candle', theme: 'light' }), null, '逐 key 值相同返回 null');
  assert.deepEqual(diffConfig(a, { mode: 'intraday', theme: 'light' }), { mode: 'intraday' });
  assert.equal(diffConfig(a, undefined), null, 'next 为 undefined 返回 null');
  assert.deepEqual(diffConfig(a, { ...a, subplotCount: 3 }), { subplotCount: 3 }, '新增 key 应进 patch');

  const ma1 = [{ period: 5, color: '#fff' }];
  const ma2 = [{ period: 5, color: '#fff' }];
  const patch = diffConfig({ movingAverages: ma1 }, { movingAverages: ma2 });
  assert.ok(patch, '嵌套引用替换应产生 patch');
  assert.equal(patch.movingAverages, ma2, 'patch 应携带新引用');
  assert.notEqual(patch.movingAverages, ma1);
  assert.equal(diffConfig({ movingAverages: ma1 }, { movingAverages: ma1 }), null,
    '嵌套引用不变返回 null');
});

test('camelToEventName 把 onXxx 转成连字符事件名', () => {
  assert.equal(camelToEventName('onThemeChange'), 'theme-change');
  assert.equal(camelToEventName('onChartError'), 'chart-error');
  assert.equal(camelToEventName('onWorkspaceReady'), 'workspace-ready');
  assert.equal(camelToEventName('onAuctionToggle'), 'auction-toggle');
  assert.equal(camelToEventName('theme-change'), '', '非 onXxx 返回空串');
  assert.equal(camelToEventName('on'), '', '单独 on 返回空串');
  assert.equal(camelToEventName('data'), '');
});

test('bindWorkspace 返回 cleanup，调用后事件解绑', () => {
  const { host } = makeHost();
  let count = 0;
  const cleanup = bindWorkspace(host, { on: { 'workspace-status': () => { count += 1; } } });
  assert.equal(typeof cleanup, 'function');
  fire(host, 'workspace-status', { status: 'ok' });
  assert.equal(count, 1);
  cleanup();
  fire(host, 'workspace-status', { status: 'ok' });
  assert.equal(count, 1, 'cleanup 后不应再收到');
  assert.equal(bindWorkspace(null, {}), undefined, 'null host 返回 undefined');
  assert.equal(typeof bindWorkspaceProps, 'function', 'bindWorkspaceProps 别名应存在');
});

test('vWorkspace mounted/updated/unmounted：updated 只 update 不重绑', () => {
  const { host, configWrites } = makeHost();
  const KEY = '__stockWorkspaceController__';
  let hits = 0;
  const p1 = { config: { mode: 'candle' }, on: { 'theme-change': () => { hits += 1; } } };
  vWorkspace.mounted(host, { value: p1 });
  const controller = host[KEY];
  assert.ok(controller, 'mounted 应挂上 controller');
  assert.equal(configWrites.length, 1);
  fire(host, 'theme-change', {});
  assert.equal(hits, 1);

  const p2 = { config: { mode: 'intraday' }, on: { 'theme-change': () => { hits += 1; } } };
  vWorkspace.updated(host, { value: p2 });
  assert.equal(host[KEY], controller, 'updated 不应重建 controller');
  assert.equal(configWrites.length, 2, 'updated 应增量写入 config');
  assert.deepEqual(configWrites[1], { mode: 'intraday' });
  fire(host, 'theme-change', {});
  assert.equal(hits, 2, 'updated 后事件仍只触发一次（未重复绑定）');

  vWorkspace.unmounted(host);
  assert.equal(host[KEY], undefined, 'unmounted 应删除 controller');
  fire(host, 'theme-change', {});
  assert.equal(hits, 2, 'unmounted 后不再收到');
});

test('workspaceAction（Svelte action）update/destroy 与空 host 退化', () => {
  const { host, configWrites } = makeHost();
  let hits = 0;
  const action = workspaceAction(host, {
    config: { mode: 'candle' },
    on: { 'chart-error': () => { hits += 1; } },
  });
  assert.equal(typeof action.update, 'function');
  assert.equal(typeof action.destroy, 'function');
  assert.equal(stockWorkspace, workspaceAction, 'stockWorkspace 应为 workspaceAction 别名');
  fire(host, 'chart-error', { message: 'x' });
  assert.equal(hits, 1);

  action.update({ config: { mode: 'intraday' }, on: { 'chart-error': () => { hits += 1; } } });
  assert.equal(configWrites.length, 2);
  assert.deepEqual(configWrites[1], { mode: 'intraday' });
  fire(host, 'chart-error', { message: 'y' });
  assert.equal(hits, 2);

  action.destroy();
  fire(host, 'chart-error', { message: 'z' });
  assert.equal(hits, 2, 'destroy 后不再收到');

  const empty = workspaceAction(null, { config: { mode: 'candle' } });
  assert.doesNotThrow(() => { empty.update({}); empty.destroy(); }, 'null host 应退化为空操作');
});

test('createWorkspaceDirective（Angular）mounted/updated/unmounted + 重复 mounted 不叠加', () => {
  const { host, configWrites } = makeHost();
  const d = createWorkspaceDirective();
  assert.equal(d.selector, '[stockWorkspace]');
  let hits = 0;
  const fn = () => { hits += 1; };
  d.mounted(host, { config: { mode: 'candle' }, on: { 'theme-change': fn } });
  assert.equal(configWrites.length, 1);
  fire(host, 'theme-change', {});
  assert.equal(hits, 1);

  d.updated(host, { config: { mode: 'intraday' }, on: { 'theme-change': fn } });
  assert.equal(configWrites.length, 2);
  assert.deepEqual(configWrites[1], { mode: 'intraday' });
  fire(host, 'theme-change', {});
  assert.equal(hits, 2, 'updated 用同一 handler，不应重复绑定');

  d.mounted(host, { config: { mode: 'candle' }, on: { 'theme-change': fn } });
  fire(host, 'theme-change', {});
  assert.equal(hits, 3, '重新 mounted 先销毁旧的，只保留一份监听');

  d.unmounted(host);
  fire(host, 'theme-change', {});
  assert.equal(hits, 3, 'unmounted 后不再收到');
});

test('splitWorkspaceProps 分离 workspace props 与其余 JSX 属性', () => {
  const data = { bars: [] };
  const config = { mode: 'candle' };
  const on = { 'theme-change': () => {} };
  const onThemeChange = () => {};
  const { workspace, rest } = splitWorkspaceProps({
    data, config, on, onThemeChange, className: 'card', id: 'ws', hidden: true,
  });
  assert.equal(workspace.data, data);
  assert.equal(workspace.config, config);
  assert.equal(workspace.on, on);
  assert.equal(workspace.onThemeChange, onThemeChange);
  assert.deepEqual(Object.keys(rest).sort(), ['className', 'hidden', 'id']);
  assert.equal(rest.className, 'card');
  assert.equal(workspaceProps.splitWorkspaceProps, splitWorkspaceProps, '命名空间导出应指向同一函数');
});

test('mount（vanilla）返回 controller 并应用 props', () => {
  const { host, dataWrites, configWrites } = makeHost();
  const data = { bars: [1] };
  let hits = 0;
  const c = mount(host, {
    data, config: { mode: 'candle' }, on: { 'chart-error': () => { hits += 1; } },
  });
  assert.ok(c);
  assert.equal(c.element, host);
  assert.equal(dataWrites.length, 1);
  assert.equal(configWrites.length, 1);
  fire(host, 'chart-error', { message: 'x' });
  assert.equal(hits, 1);

  assert.equal(c.update({
    data, config: { mode: 'intraday' }, on: { 'chart-error': () => { hits += 1; } },
  }), true);
  assert.deepEqual(configWrites[1], { mode: 'intraday' });

  c.destroy();
  fire(host, 'chart-error', { message: 'y' });
  assert.equal(hits, 1, 'destroy 后不再收到');
  assert.equal(mount(null, {}), undefined, 'null host 返回 undefined');
  assert.equal(typeof mountWorkspace, 'function', 'mountWorkspace 应存在');
  assert.equal(typeof mountWithData, 'function', 'mountWithData 应存在（不实际触发 IO）');
});

test('回归：bindStockChart 旧 API 仍可用（setter + 事件 + cleanup）', () => {
  const host = new EventTarget();
  const calls = [];
  host.setMode = (v) => calls.push(['setMode', v]);
  host.setDataset = (v) => calls.push(['setDataset', v]);
  host.setAttribute = (n, v) => calls.push(['setAttribute', n, v]);
  let hits = 0;
  const data = { bars: [] };
  const cleanup = bindStockChart(host, {
    dataset: '/data/dir', mode: 'candle', data,
    on: { 'theme-change': () => { hits += 1; } },
  });
  assert.equal(typeof cleanup, 'function');
  assert.ok(calls.some((c) => c[0] === 'setMode' && c[1] === 'candle'));
  assert.ok(calls.some((c) => c[0] === 'setAttribute' && c[1] === 'dataset' && c[2] === '/data/dir'));
  assert.ok(calls.some((c) => c[0] === 'setDataset' && c[1] === data));
  fire(host, 'theme-change', {});
  assert.equal(hits, 1);
  cleanup();
  fire(host, 'theme-change', {});
  assert.equal(hits, 1, 'cleanup 后不再收到');
  assert.equal(bindStockChart(null, {}), undefined);
});

test('回归：vStockChart 旧指令 mounted/updated/unmounted 仍可用', () => {
  const host = new EventTarget();
  const calls = [];
  host.setMode = (v) => calls.push(v);
  let hits = 0;
  const opts1 = { mode: 'candle', on: { 'theme-change': () => { hits += 1; } } };
  const opts2 = { mode: 'intraday', on: { 'theme-change': () => { hits += 1; } } };
  vStockChart.mounted(host, { value: opts1 });
  assert.ok(calls.includes('candle'));
  fire(host, 'theme-change', {});
  assert.equal(hits, 1);

  vStockChart.updated(host, { value: opts1, oldValue: opts1 });
  fire(host, 'theme-change', {});
  assert.equal(hits, 2, '相同引用不重绑，仍只触发一次');

  vStockChart.updated(host, { value: opts2, oldValue: opts1 });
  assert.ok(calls.includes('intraday'));
  fire(host, 'theme-change', {});
  assert.equal(hits, 3, '重绑后仍只触发一次');

  vStockChart.unmounted(host);
  fire(host, 'theme-change', {});
  assert.equal(hits, 3, 'unmounted 后不再收到');
});

test('WORKSPACE_EVENT_NAMES / createWorkspaceRef / createWorkspaceSignalBinding 附加契约', () => {
  assert.ok(Array.isArray(WORKSPACE_EVENT_NAMES));
  for (const name of ['workspace-ready', 'dataset-ready', 'workspace-config-change',
    'chart-error', 'workspace-status']) {
    assert.ok(WORKSPACE_EVENT_NAMES.includes(name), `WORKSPACE_EVENT_NAMES 缺少 ${name}`);
  }

  // createWorkspaceRef：ref(el) 建 controller 返回 cleanup，ref(null) 销毁
  const { host, dataWrites } = makeHost();
  const ref = createWorkspaceRef({ data: { bars: [] } });
  const cleanup = ref(host);
  assert.equal(typeof cleanup, 'function');
  assert.equal(dataWrites.length, 1);
  cleanup();
  assert.equal(ref(null), undefined);

  // createWorkspaceSignalBinding：fake solid 立即执行 effect，onCleanup 收集 destroy
  const effects = [];
  const cleanups = [];
  const solid = {
    createEffect: (fn) => { effects.push(fn); fn(); },
    onCleanup: (fn) => { cleanups.push(fn); },
    createSignal: (init) => { let v = init; return [() => v, (nv) => { v = nv; }]; },
  };
  const { host: host2 } = makeHost();
  let hits = 0;
  const bind = createWorkspaceSignalBinding(solid);
  const props = { config: { mode: 'candle' }, on: { 'theme-change': () => { hits += 1; } } };
  bind(host2, () => props);
  fire(host2, 'theme-change', {});
  assert.equal(hits, 1);
  assert.equal(effects.length, 1);
  assert.equal(cleanups.length, 1);
  cleanups[0]();
  fire(host2, 'theme-change', {});
  assert.equal(hits, 1, 'cleanup 后不再收到');
});
