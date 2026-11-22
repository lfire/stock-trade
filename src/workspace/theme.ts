/**
 * Workspace 组件内部主题实现。
 *
 * 主题是组件内部实现细节：外部仅通过 WorkspaceConfig.theme 切换，本模块负责把
 * 色板（18 键）与布局尺寸（5 项）归一并写成 --sw-* CSS 变量。
 * 纯函数式：只作用于传入的 root，不触碰 document.documentElement、不派事件、不读 window，
 * 因此多实例互不串扰，也便于在测试里直接调用。
 */
import { THEMES, LAYOUT, isThemeName, createPalette } from '../types';
import type { Palette, PaletteKey } from '../types';

/** 18 个色板键 → --sw-* CSS 变量名（统一变量映射表，所有内部模块共用）。 */
export const WORKSPACE_CSS_VARS: Readonly<Record<PaletteKey, string>> = Object.freeze({
  background: '--sw-bg',
  panel: '--sw-panel',
  band: '--sw-band',
  grid: '--sw-line',
  text: '--sw-text',
  textMuted: '--sw-muted',
  up: '--sw-up',
  down: '--sw-down',
  link: '--sw-link',
  limitUp: '--sw-limit-up',
  limitDown: '--sw-limit-down',
  limitUpBroken: '--sw-limit-up-broken',
  limitDownBroken: '--sw-limit-down-broken',
  avg: '--sw-avg',
  crosshair: '--sw-crosshair',
  chipProfit: '--sw-chip-profit',
  chipLoss: '--sw-chip-loss',
  neutral: '--sw-neutral',
});

/** 5 个尺寸 CSS 变量；值来自 LAYOUT 单一真源（px）。 */
export const WORKSPACE_SIZE_VARS: Readonly<Record<
  '--sw-row-h' | '--sw-head-h' | '--sw-title-h' | '--sw-bar-h' | '--sw-split-h',
  string
>> = Object.freeze({
  '--sw-row-h': `${LAYOUT.rowH}px`,
  '--sw-head-h': `${LAYOUT.headH}px`,
  '--sw-title-h': `${LAYOUT.titleH}px`,
  '--sw-bar-h': `${LAYOUT.barH}px`,
  '--sw-split-h': `${LAYOUT.splitH}px`,
});

export interface WorkspaceThemeTokens {
  name: 'light' | 'dark';
  palette: Palette;
}

/**
 * 归一主题输入：
 *  - 'dark' → dark；'light' / null / undefined / 未知字符串 → light
 *  - 对象 → 以 light 为底合并，非法键（不在 18 键内）会被过滤
 */
export function resolveWorkspaceTheme(
  input: string | Record<string, string> | null | undefined,
): WorkspaceThemeTokens {
  if (typeof input === 'string') {
    const name: 'light' | 'dark' = isThemeName(input) ? input : 'light';
    return { name, palette: { ...THEMES[name] } };
  }
  if (input && typeof input === 'object') {
    return { name: 'light', palette: createPalette(input, THEMES.light) };
  }
  return { name: 'light', palette: { ...THEMES.light } };
}

/**
 * 把 18 色 + 5 尺寸全部写到 root.style，并在 root 上设 data-theme（light/dark）。
 * 只作用于 root 本身；不读全局、不派事件。返回本次归一后的 tokens。
 */
export function applyWorkspaceTheme(
  root: HTMLElement,
  input: string | Record<string, string> | null | undefined,
): WorkspaceThemeTokens {
  const tokens = resolveWorkspaceTheme(input);
  for (const key of Object.keys(WORKSPACE_CSS_VARS) as PaletteKey[]) {
    root.style.setProperty(WORKSPACE_CSS_VARS[key], tokens.palette[key]);
  }
  for (const [name, value] of Object.entries(WORKSPACE_SIZE_VARS)) {
    root.style.setProperty(name, value);
  }
  root.setAttribute('data-theme', tokens.name);
  return tokens;
}

/** 生成 :host / [data-theme] 形式的 CSS 声明文本，供组件注入样式表使用。 */
export function themeToCSS(tokens: WorkspaceThemeTokens): string {
  const decls: string[] = [];
  for (const key of Object.keys(WORKSPACE_CSS_VARS) as PaletteKey[]) {
    decls.push(`${WORKSPACE_CSS_VARS[key]}:${tokens.palette[key]};`);
  }
  for (const [name, value] of Object.entries(WORKSPACE_SIZE_VARS)) {
    decls.push(`${name}:${value};`);
  }
  const body = decls.join('');
  const theme = tokens.name;
  return `:host([data-theme="${theme}"]){${body}}\n[data-theme="${theme}"]{${body}}`;
}
