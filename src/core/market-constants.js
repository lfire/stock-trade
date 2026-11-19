/**
 * A 股市场业务常量单一真源（截至 2026-11 沪深交易规则）。
 * 纯常量模块，无 DOM / 无依赖，组件层与数据生成脚本共用，避免同一时段/单位在多个文件各写一份。
 * 口径来源：上交所《交易规则》3.5.2 / 5.1.2 / 5.2.1、深交所投教问答、证监会令第 192 号。
 */

/** 最小价格变动单位（元）与判定容差（1 个最小变动单位 + 浮点余量） */
export const PRICE_TICK = 0.01;
export const PRICE_EPS = 0.011;

/** 交易单位：1 手 = 100 股 */
export const LOT_SIZE = 100;

/** 连续竞价时段（分钟数，自 00:00 起算） */
export const AM_START = 9 * 60 + 30;    // 09:30
export const AM_END = 11 * 60 + 30;     // 11:30
export const PM_START = 13 * 60;        // 13:00
export const PM_END = 15 * 60;          // 15:00
export const SESSION_MINUTES = 120;     // 上午 / 下午各 120 分钟
export const DAY_MINUTES = 240;         // 全天 240 分钟

/** 集合竞价窗口 */
export const AUCTION_OPEN = { start: '09:15:00', end: '09:25:00', seconds: 600 };
export const AUCTION_CLOSE = { start: '14:57:00', end: '15:00:00', seconds: 180 };
export const NO_CANCEL_FROM = '09:20:00';   // 9:20 起开盘竞价不可撤单
/** 同花顺等终端竞价图每 9 秒一个撮合结果节点 */
export const AUCTION_STEP_SEC = 9;
/** 常用时段的 HH:mm:ss / HH:mm 写法，避免脚本各写一份 */
export const TIME = Object.freeze({
  OPEN: '09:30:00', NOON: '11:30:00', PM: '13:00:00', CLOSE: '15:00:00',
  AUCTION_START: '09:15:00', AUCTION_END: '09:25:00',
  NO_CANCEL_OPEN: '09:20:00', NO_CANCEL_CLOSE: '14:57:00',
  SESSION_END: '15:00',
});

/** 分时图半小时刻度（收盘 15:00 由右端单独标注） */
export const HALF_HOUR_MARKS = Object.freeze([
  '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30',
]);

/** 交易时段声明（与 manifest.session 同构，供数据契约使用） */
export const SESSION = Object.freeze([
  { open: '09:30', close: '11:30' },
  { open: '13:00', close: '15:00' },
]);
export const AFTER_HOURS = Object.freeze({ open: '15:01', close: '15:30' });
