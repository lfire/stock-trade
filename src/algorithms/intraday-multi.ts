/**
 * 多日分时（算法单元化收口）：逐字搬 scripts/build-sample-data.mjs 的
 * buildIntradayMulti(:178-219)。末日取真实分时（截到 15:00），前几日按当日日 K 的
 * OHLC 以固定种子确定性拟真生成。复用 ./rounding 的 r2 与 ./random 的 mulberry32。
 */
import type { Bar, IntradayPoint } from '../types';
import { r2 } from './rounding';
import { mulberry32 } from './random';

/** 最近 days 个交易日拼成扁平数组，每点带 tradeDate。 */
export function buildIntradayMulti(
  bars: Bar[], intraday: IntradayPoint[], days = 5,
): IntradayPoint[] {
  const win = bars.slice(-days);
  const times: string[] = [];
  for (let m = 9 * 60 + 30; m <= 11 * 60 + 30; m += 1) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  for (let m = 13 * 60; m <= 15 * 60; m += 1) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  const out: IntradayPoint[] = [];
  win.forEach((b, dayIdx) => {
    if (dayIdx === win.length - 1) {
      for (const p of intraday) {
        if (p.time <= '15:00') out.push({ ...p, tradeDate: b.tradeDate, source: 'real-intraday' });
      }
      return;
    }
    const rndDay = mulberry32(20261113 + dayIdx);
    let cumVol = 0, cumAmt = 0;
    const range = Math.max(0.01, b.high - b.low);
    times.forEach((t, i) => {
      const k = i / (times.length - 1);
      const wave = Math.sin(k * Math.PI * 2.4 + dayIdx) * range * 0.16
        + (rndDay() - 0.5) * range * 0.06;
      const price = r2(Math.max(b.low, Math.min(b.high, b.open + (b.close - b.open) * k + wave)));
      const vol = Math.max(100, Math.round((12000 + rndDay() * 60000) / 100) * 100);
      const amt = r2(price * vol);
      cumVol += vol; cumAmt += amt;
      out.push({
        timestamp: Date.parse(`${b.tradeDate}T${t}:00+08:00`),
        time: t, tradeDate: b.tradeDate,
        source: 'simulated-from-daily-ohlc',   // 历史分钟分时无免费公开源，按当日日 K OHLC 拟真
        price, avgPrice: r2(cumAmt / cumVol),
        volume: vol, amount: amt,
        cumulativeVolume: cumVol, cumulativeAmount: r2(cumAmt),
        session: t <= '11:30' ? 'morning' : 'afternoon',
      });
    });
  });
  return out;
}
