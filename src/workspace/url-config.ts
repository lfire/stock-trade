/**
 * URL → WorkspaceConfig 的解析（页面侧工具，由根入口导出）。
 *
 * 组件自身**不读 URL**；页面把查询参数解析成配置对象后一次性赋给
 * `workspace.config`，这是「标准化数据传递」的一部分。
 */
import type { ChartMode, ChipMode, DepthUnit, MAConfig } from '../types';
import type { WorkspaceConfig, DetailSet, TapePlacement } from './types';
import type { WorkspacePreset } from './module-catalog';

const int = (v: string | null, fallback: number): number => {
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const oneOf = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  (v && allowed.includes(v as T) ? v as T : fallback);

/** preset 白名单（与 module-catalog.ts 的 WorkspacePreset 一致）。 */
const PRESET_VALUES: readonly WorkspacePreset[] = ['full', 'intraday', 'candle', 'minimal'];

/** 解析 `?ma=5,20,60` 之类为 MAConfig[]（不依赖 PALETTE，颜色由组件默认色板补齐） */
function parseMA(raw: string | null): MAConfig[] | undefined {
  if (!raw) return undefined;
  const periods = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!periods.length) return undefined;
  return periods.slice(0, 8).map((period, i) => ({ period, color: ['#E24B4A', '#378ADD', '#BA7517', '#639922', '#7F77DD', '#1D9E75', '#D4537E', '#888780'][i] }));
}

/** 把 URLSearchParams 转成增量配置；未出现的键不写入，保留组件默认值 */
export function parseWorkspaceConfig(params: URLSearchParams): Partial<WorkspaceConfig> {
  const out: Partial<WorkspaceConfig> = {};
  const has = (k: string) => params.has(k);
  const get = (k: string) => params.get(k);

  // 模块化装载：?modules=core,price-intraday（逗号分隔，去空格、过滤空串）
  // 与 ?preset=full|intraday|candle|minimal（白名单之外回退 full）。
  // ?modules= 空串 / 全空白时不写 modules 键（等价于「未提供」），避免空数组吞掉 preset。
  if (has('modules')) {
    const mods = (get('modules') || '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (mods.length) out.modules = mods;
  }
  if (has('preset')) out.preset = oneOf<WorkspacePreset>(get('preset'), PRESET_VALUES, 'full');

  if (has('theme')) out.theme = get('theme');
  if (has('mode')) out.mode = oneOf<ChartMode>(get('mode'), ['intraday', 'candle'], 'intraday');
  if (has('period')) out.period = get('period') || '1d';
  if (has('chip-mode')) out.chipMode = oneOf<ChipMode>(get('chip-mode'), ['stat', 'histogram'], 'histogram');
  if (has('intraday-days')) out.intradayDays = Math.max(1, Math.min(5, int(get('intraday-days'), 1)));
  if (has('panes')) out.subplotCount = Math.max(1, Math.min(3, int(get('panes'), 3)));
  if (has('ma')) { const list = parseMA(get('ma')); if (list) out.movingAverages = list; }
  if (has('macd')) out.macd = get('macd') || '';
  if (has('ma-panel')) out.maPanelOpen = get('ma-panel') === '1';
  if (has('auction')) out.auctionEnabled = get('auction') !== 'off';
  if (has('chips')) out.chipsEnabled = get('chips') !== 'off';
  if (has('depth-scenario')) out.depthScenario = get('depth-scenario') || 'normal';
  if (has('depth-unit')) out.depthUnit = oneOf<DepthUnit>(get('depth-unit'), ['volume', 'amount'], 'volume');
  if (has('depth-levels')) out.depthLevels = Math.max(1, Math.min(10, int(get('depth-levels'), 5)));
  if (has('tape-side')) out.tapePlacement = oneOf<TapePlacement>(get('tape-side'), ['side', 'detail'], 'side');
  if (has('tape-zoom')) {
    out.tapeZoom = int(get('tape-zoom'), 0);
    // 原示例页 ?tape-zoom=1 会直接打开详情覆盖视图；标准化后等价于
    // tapePlacement='detail'（显式 ?tape-side=side 可覆盖）。
    if (out.tapeZoom > 0 && !has('tape-side')) out.tapePlacement = 'detail';
  }
  if (has('tape-set')) out.tapeSet = oneOf<DetailSet>(get('tape-set'), ['trades', 'orders', 'panorama'], 'trades');
  if (has('tape-scroll')) out.tapeScroll = Math.max(0, int(get('tape-scroll'), 0));
  if (has('crosshair')) out.crosshair = int(get('crosshair'), 0);
  if (has('pointer')) {
    const [x, y] = (get('pointer') || '').split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out.pointer = { x, y };
  }
  if (has('auction-hover')) out.auctionHover = int(get('auction-hover'), 0);
  if (has('closing-hover')) out.closingHover = int(get('closing-hover'), 0);
  return out;
}
