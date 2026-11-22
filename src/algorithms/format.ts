/**
 * 数值 / 单位格式化（算法单元化收口）：收口 price-pane / indicator-pane /
 * depth-book / stock-chart / index.html 里散落的 1e4 / 1e8 换算。
 * 本模块只提供统一版本，组件层可直接复用本模块导出（trim / pickUnit / 单位换算等）。
 */

const WAN = 1e4;
const YI = 1e8;

interface Scaled { value: number; unit: string; }

const UNIT_STEPS: ReadonlyArray<{ d: number; u: string }> = [
  { d: 1, u: '' },
  { d: 1e3, u: '千' },
  { d: 1e4, u: '万' },
  { d: 1e8, u: '亿' },
];

/** 按 1e4（万）/ 1e8（亿）自适应缩放。 */
function scale(v: number): Scaled {
  const a = Math.abs(v);
  if (a >= YI) return { value: v / YI, unit: '亿' };
  if (a >= WAN) return { value: v / WAN, unit: '万' };
  return { value: v, unit: '' };
}

/**
 * 数值小数位收敛：≥100 → 0 位、≥10 → 1 位、其余 2 位，并去掉尾部多余的 0。
 * 统一采用 ≥100 → 0 位小数（depth-book 窄列口径）。
 */
export function trim(x: number): string {
  return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2))
    .replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

/** 通用短数字：亿 / 万 两级换算，保留 2 位小数；非法值返回 '--'。 */
export function shortNum(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return '--';
  const { value, unit } = scale(Number(v));
  return unit ? `${value.toFixed(2)}${unit}` : value.toFixed(2);
}

/** 副图纵轴单位选择（千 / 万 / 亿），返回缩放系数、单位与刻度小数位。 */
export function pickUnit(hi: number, name = ''): { d: number; u: string; dec: number } {
  if (name !== 'VOL' && name !== 'AMOUNT') return { d: 1, u: '', dec: 2 };
  let pick = UNIT_STEPS[0];
  for (const c of UNIT_STEPS) {
    // 阈值放宽到 0.2：数值过长时尽量升级单位（如 9979万 → 1.00亿）
    if (hi / c.d >= 0.2) pick = c; else break;
  }
  const hiScaled = hi / pick.d;
  const dec = hiScaled >= 1000 ? 0 : hiScaled >= 100 ? 1 : 2;
  return { d: pick.d, u: pick.u || (name === 'VOL' ? '股' : '元'), dec };
}

/** 统一的量 / 额格式：万 / 亿 级保留 2 位小数，基础量级取整；suffix 追加单位后缀。 */
function formatUnit(v: number, suffix: string): string {
  const { value, unit } = scale(v);
  if (!unit) return `${Math.round(v)}${suffix}`;
  return `${value.toFixed(2)}${unit}${suffix}`;
}

/** 成交量（股）。 */
export function fmtQty(v: number): string { return formatUnit(v, '股'); }
/** 成交量（股），与 fmtQty 统一口径。 */
export function fmtVol(v: number): string { return formatUnit(v, '股'); }
/** 成交额（元）。 */
export function fmtMoney(a: number): string { return formatUnit(a, '元'); }
/** 成交额（元），与 fmtMoney 统一口径。 */
export function fmtAmt(a: number): string { return formatUnit(a, '元'); }
