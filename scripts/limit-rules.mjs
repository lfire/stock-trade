/**
 * A 股涨跌停规则（截至 2026-11，沪深主板 / 创业板 / 科创板 / 北交所现行规则）。
 * 独立模块：生成脚本与数值回归测试共用同一份口径，测试 import 不会触发数据生成副作用。
 */
export const PRICE_TICK = 0.01;   // A 股最小价格变动单位（元）
export const PRICE_EPS = 0.011;   // 判定容差：1 个最小变动单位 + 浮点余量
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * 涨跌幅比例：主板 10%（ST/*ST 5%）、创业板 300/301 与科创板 688/689 20%
 * （风险警示股同为 20%）、北交所 8/4/92 开头 30%。
 */
export function limitRateFor(symbol = '', name = '') {
  const code = String(symbol).replace(/\D/g, '').slice(0, 6);
  const st = /\*?ST/i.test(String(name));
  if (/^(30[01]|68[89])/.test(code)) return 0.20;
  if (/^(8|4|92)/.test(code)) return 0.30;
  return st ? 0.05 : 0.10;
}

/** 涨跌停价：前收盘价 ×(1±比例)，按四舍五入取至 0.01 元 */
export function limitPrices(preClose, rate) {
  return { up: r2(preClose * (1 + rate)), down: r2(preClose * (1 - rate)) };
}

/**
 * 涨跌停 / 炸板判定：容差固定 0.011 元，不再用 preClose×0.5% 的相对容差
 * （后者会把接近涨跌停但并未封板的 K 线误标）。
 */
export function limitStateOf(bar, rate = limitRateFor()) {
  const { up, down } = limitPrices(bar.preClose, rate);
  if (Math.abs(bar.close - up) <= PRICE_EPS) return 'limitUp';
  if (Math.abs(bar.close - down) <= PRICE_EPS) return 'limitDown';
  if (Math.abs(bar.high - up) <= PRICE_EPS) return 'limitUpBroken';
  if (Math.abs(bar.low - down) <= PRICE_EPS) return 'limitDownBroken';
  return '';
}
