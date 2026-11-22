/**
 * 交易时间口径（算法单元化收口）：clockMinutes / elapsedMarketMinutes /
 * intradayBucket / isoWeek / isoToDateBase 的唯一实现，交易时段常量统一取自
 * ../core/market-constants；compute / core 层与组件层均复用本模块导出。
 * 口径说明：elapsedMarketMinutes 采用「首分钟计 1」——09:30 与 09:31 均为 1，
 * 11:30=120、13:00=120（午休按上午已收盘计）、15:00=240，全天 240 分钟不变。
 */
import {
  AM_START, AM_END, PM_START, SESSION_MINUTES,
} from '../core/market-constants';

/** 'HH:mm' → 自 00:00 起算的分钟数。 */
export function clockMinutes(time: string): number {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 截至某个分时时刻的累计开市分钟数（扣除 11:30–13:00 午休，最小 1 分钟）。 */
export function elapsedMarketMinutes(time: string): number {
  const [h, m] = String(time || '09:30').split(':').map(Number);
  const n = (h || 0) * 60 + (m || 0);
  if (n <= AM_END) return Math.max(1, Math.min(SESSION_MINUTES, n - AM_START));
  if (n >= PM_START) return Math.max(1, SESSION_MINUTES + Math.min(SESSION_MINUTES, n - PM_START));
  return SESSION_MINUTES;   // 午休期间按上午已收盘计
}

/** 分时点所属 K 线桶：'0:0'…（0=上午 / 1=下午，冒号后为时段内第几根）。 */
export function intradayBucket(time: string, size: number): string {
  const n = clockMinutes(time);
  const isPM = n > AM_END && n >= PM_START;
  const offset = isPM ? n - PM_START : n - AM_START;
  // 收盘点（11:30 / 15:00）归入该时段最后一根，保证 120 分钟恰好产出 120/size 根
  const clamped = Math.max(0, Math.min(offset, SESSION_MINUTES - 1));
  return `${isPM ? 1 : 0}:${Math.floor(clamped / size)}`;
}

/** ISO 周（周一为一周起点），用于周 K 分组。 */
export function isoWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);          // 移到本周四
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * 把交易日字符串规范成可安全拼进 Date.parse 的 ISO 日期基准。
 * manifest.tradeDate 去掉横杠后是 '20261113' 这样的 8 位紧凑格式，
 * 直接拼 '20261113T09:30:00+08:00' 会被 Date.parse 判为 NaN；
 * 这里转成 '2026-11-13'。已是 'YYYY-MM-DD' 的写法原样返回。
 */
export function isoToDateBase(iso: string): string {
  return /^\d{8}$/.test(iso)
    ? `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}`
    : iso;
}
