/**
 * 副图指标注册表：新增副图只需注册一个描述符，不再修改 chart-context / stock-chart /
 * indicator-pane 三个核心文件。
 *
 * - 内置指标（VOL / AMOUNT / MACD / KDJ / VOL_RATIO）仍由 indicator-pane 原分支绘制，
 *   保持既有像素与口径不变；
 * - 扩展指标走注册表：描述符负责「数据（series）+ 信息栏文案（valueText）+ 适用模式」，
 *   绘制复用 indicator-pane 的通用渲染器（bar / line / compare）。
 * - 成交对比 VOLCMP 是第一个注册式实现，也是第三方扩展的参考样例。
 *
 * 本模块无 DOM 依赖：只 import 类型与算法层纯函数，SSR 安全。
 */
import { buildVolumeCompare, volumeComparePrevious } from '../algorithms/volume-compare';
import type { ChartContext } from './chart-context';
import type { ChartDataset, ChartMode, IntradayPoint } from '../types';

/** 内置指标（顺序即下拉顺序）；对外常量 SUBPLOT_INDICATORS 保持这 5 项不变 */
export const BUILTIN_SUBPLOT_INDICATORS: readonly string[] = Object.freeze([
  'VOL', 'AMOUNT', 'MACD', 'KDJ', 'VOL_RATIO',
]);

const BUILTIN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  VOL: '成交量', AMOUNT: '成交额', MACD: 'MACD', KDJ: 'KDJ', VOL_RATIO: '量比',
});

/** 通用渲染器：bar = 涨跌着色柱；line = 单折线；compare = 当前实线 + 对照半透明线 */
export type SubplotRenderType = 'bar' | 'line' | 'compare';

export interface SubplotPoint {
  value: number | null;
  /** bar 渲染器的涨跌着色 */
  up?: boolean;
  /** compare 渲染器的对照值 */
  prev?: number;
}

export interface SubplotSeries {
  type: SubplotRenderType;
  /** 与当前主图序列等长（分时 = getSeries()，K 线 = getBars()）；视口裁剪由副图完成 */
  values: SubplotPoint[];
}

/** 信息栏格式化工具（由组件注入，保证与内置指标同一套样式） */
export interface SubplotFormat {
  b(v: unknown): string;
  shortNum(v: unknown): string;
}

export interface SubplotIndicatorDef {
  /** 大写 id，写入 indicator 属性与下拉 value */
  id: string;
  /** 下拉中文名 */
  label: string;
  /** 适用模式，缺省两种模式都可用 */
  modes?: readonly ChartMode[];
  /** 当前模式不可用时信息栏的提示文案 */
  unavailableText?: string;
  /** 纵轴单位口径（传给 pickUnit），缺省用 id；量类指标可设为 'VOL' 得到 万 / 亿 单位 */
  axisUnit?: string;
  /** 计算整条序列（纯函数风格：只读 ctx，不改 ctx） */
  series(ctx: ChartContext): SubplotSeries;
  /** 十字光标所在下标（全序列下标）的信息栏文案，可含 <b> 标签 */
  valueText(ctx: ChartContext, index: number, fmt: SubplotFormat): string;
}

/** 成交对比：当天与前一交易日累计成交量（市面常用口径），仅分时可用 */
const VOLUME_COMPARE: SubplotIndicatorDef = {
  id: 'VOLCMP',
  label: '成交对比',
  modes: ['intraday'],
  unavailableText: '成交对比（仅分时）',
  axisUnit: 'VOL',
  series(ctx) {
    const cmp = buildVolumeCompare(
      ctx.getSeries() as IntradayPoint[], volumeComparePrevious(ctx.dataset as ChartDataset),
    );
    return { type: 'compare', values: cmp.map((v) => ({ value: v.value, prev: v.prev })) };
  },
  valueText(ctx, index, fmt) {
    const cmp = buildVolumeCompare(
      ctx.getSeries() as IntradayPoint[], volumeComparePrevious(ctx.dataset as ChartDataset),
    );
    const at = cmp[Math.max(0, Math.min(cmp.length - 1, index))];
    return `累计 今 ${fmt.b(fmt.shortNum(at?.value ?? 0))}  昨 ${fmt.b(fmt.shortNum(at?.prev ?? 0))}`;
  },
};

const REGISTRY: Map<string, SubplotIndicatorDef> = new Map([[VOLUME_COMPARE.id, VOLUME_COMPARE]]);

/**
 * 注册（或覆盖）一个扩展副图指标；不可覆盖内置 5 项。
 * 注册后立即出现在副图下拉中，并可通过 setSubplotIndicator(index, id) 切换。
 * @returns 注册后的全部可选指标 id
 */
export function registerSubplotIndicator(def: SubplotIndicatorDef): string[] {
  const id = String(def?.id || '').toUpperCase();
  if (!id || BUILTIN_SUBPLOT_INDICATORS.includes(id)) {
    throw new Error(`registerSubplotIndicator: 非法或与内置冲突的 id「${def?.id}」`);
  }
  if (typeof def.series !== 'function' || typeof def.valueText !== 'function') {
    throw new Error(`registerSubplotIndicator: ${id} 缺少 series / valueText`);
  }
  REGISTRY.set(id, { ...def, id });
  return subplotIndicatorIds();
}

/** 扩展指标描述符（内置指标返回 undefined） */
export function getSubplotIndicator(id: string): SubplotIndicatorDef | undefined {
  return REGISTRY.get(String(id || '').toUpperCase());
}

/** 全部可选指标 id：内置在前，扩展按注册顺序在后 */
export function subplotIndicatorIds(): string[] {
  return [...BUILTIN_SUBPLOT_INDICATORS, ...REGISTRY.keys()];
}

export function isSubplotIndicator(id: string): boolean {
  const upper = String(id || '').toUpperCase();
  return BUILTIN_SUBPLOT_INDICATORS.includes(upper) || REGISTRY.has(upper);
}

export function subplotIndicatorLabel(id: string): string {
  const upper = String(id || '').toUpperCase();
  return BUILTIN_LABELS[upper] ?? REGISTRY.get(upper)?.label ?? upper;
}

/** 扩展指标在给定模式下是否可用（内置指标恒为 true） */
export function subplotAvailableIn(def: SubplotIndicatorDef, mode: ChartMode | null): boolean {
  return !def.modes || (mode != null && def.modes.includes(mode));
}
