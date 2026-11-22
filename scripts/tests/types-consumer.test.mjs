/**
 * 第三方 TS 消费者视角的类型契约测试：
 * 生成一个临时 .ts 探针，用项目本地 tsc --strict 编译 dist 的自动声明，
 * 验证数据契约、根入口导出、子入口、强类型事件重载与全局标签都真实可用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const probe = join(root, '__types_consumer_probe.ts');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const SOURCE = `
import { defineAll, StockChart, PALETTE, LAYOUT } from "./dist/index.js";
import type { ChartDataset, Bar, ChartMode, StockChartEventMap, ChartContextFacade,
  AuctionPoint, SubplotConfig } from "./dist/index.js";
import { rgba, ema, PRICE_TICK } from "./dist/pure.js";
import { bindStockChart } from "./dist/frameworks/react.js";
import { vStockChart } from "./dist/frameworks/vue.js";

const mode: ChartMode = "intraday";
const bar: Bar = { timestamp: 0, tradeDate: "2026-11-13", open: 1, high: 2, low: 0.5,
  close: 1.5, preClose: 1, volume: 100, amount: 150, turnoverRate: 0.1 };
const ap: AuctionPoint = { timestamp: 0, time: "09:25:00", phase: "open", virtualPrice: 1,
  matchedQty: 1, unmatchedQty: 0, unmatchedSide: 0, volume: 0, amount: 0 };
const sc: SubplotConfig = { index: 0, indicator: "VOL", height: "120", hidden: false };
const facade: ChartContextFacade | null = null;
const ds: ChartDataset | null = null;
const tags: string[] = defineAll();
// HTMLElementTagNameMap 由 dist/global.d.ts 经 dist/index.d.ts 三斜线引用提供
const el: StockChart = document.createElement("stock-chart");
el.setMode(mode); el.setDataset({ bars: [bar], auction: [ap] });
// 强类型事件重载：e.detail 必须能推导出具体类型，而非基类 Event
el.addEventListener("crosshair-change", (e) => { const i: number | null = e.detail.index; void i; });
const cleanup = bindStockChart(el, { mode, on: { "theme-change": () => {} } });
void [PALETTE, LAYOUT, rgba, ema, PRICE_TICK, vStockChart, tags, facade, sc, ds, cleanup];
`;

test('自动生成的 .d.ts 可被第三方 strict TS 项目消费', () => {
  writeFileSync(probe, SOURCE, 'utf8');
  try {
    const out = execFileSync(process.execPath, [
      tsc, '--noEmit', '--strict', '--lib', 'es2022,dom',
      '--module', 'esnext', '--moduleResolution', 'bundler', probe,
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(out.trim(), '');
  } catch (e) {
    assert.fail(`消费者类型探针编译失败：\n${String(e.stdout || '')}${String(e.stderr || '')}`);
  } finally {
    rmSync(probe, { force: true });
  }
});

// workspace 跨框架适配层：根入口导出的 API / 类型契约（仅 tsc --noEmit 编译，不在 Node 里执行根入口）
const probeWorkspace = join(root, '__types_consumer_workspace_probe.ts');

const WORKSPACE_SOURCE = `
import {
  createWorkspaceController, bindWorkspace, vWorkspace, StockWorkspace,
} from "./dist/index.js";
import type {
  WorkspaceProps, WorkspaceConfig, WorkspaceController, WorkspaceHost,
  WorkspaceEventMap, ChartDataset,
} from "./dist/index.js";

const host: WorkspaceHost = new EventTarget() as WorkspaceHost;
const data: ChartDataset | null = null;
const config: Partial<WorkspaceConfig> = { mode: "candle", theme: "dark", intradayDays: 3 };
const onThemeChange = (e: CustomEvent<{ theme: string | null; palette: Record<string, string> }>): void => {
  void e.detail.theme;
};
const props: WorkspaceProps = {
  data,
  config,
  on: {
    "theme-change": (e) => { void e.detail; },
    "chart-error": (e) => { void e.detail; },
  },
  onThemeChange,
};
const controller: WorkspaceController | undefined = createWorkspaceController(host, props);
controller?.update(props);
controller?.destroy();
const cleanup = bindWorkspace(host, props);
cleanup?.();
vWorkspace.mounted(host, { value: props });
vWorkspace.updated(host, { value: props });
vWorkspace.unmounted(host);
type ReadyEvent = WorkspaceEventMap["workspace-ready"];
const ready: ReadyEvent | null = null;
const ws: StockWorkspace = document.createElement("stock-workspace");
ws.data = data;
const cfgRo: Readonly<WorkspaceConfig> = ws.config;
void [ready, cfgRo, ws, onThemeChange, config];
`;

test('workspace 适配层 API 与类型契约可被第三方 strict TS 项目消费', () => {
  writeFileSync(probeWorkspace, WORKSPACE_SOURCE, 'utf8');
  try {
    const out = execFileSync(process.execPath, [
      tsc, '--noEmit', '--strict', '--lib', 'es2022,dom',
      '--module', 'esnext', '--moduleResolution', 'bundler', probeWorkspace,
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(out.trim(), '');
  } catch (e) {
    assert.fail(`workspace 消费者类型探针编译失败：\n${String(e.stdout || '')}${String(e.stderr || '')}`);
  } finally {
    rmSync(probeWorkspace, { force: true });
  }
});
