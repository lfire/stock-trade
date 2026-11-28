/**
 * 逐笔明细（算法单元化收口）：逐字搬 scripts/build-sample-data.mjs 的
 * buildTrades(:467-504)，去掉 notes 副作用。复用 ./rounding 的 r2 与 ./random 的 mulberry32。
 *
 * 额外修复（默认 anchorToIntraday=true）：连续竞价每分钟的逐笔 volume 之和严格等于
 * 该分钟分时 volume，amount 按各笔 volume 占该分钟分时 amount 的比例分配、末笔吸收
 * 金额残差（不取整，保证浮点按分钟聚合严格 === 分时 amount）。
 * 集合竞价首条（09:25:00）：市面分时口径（腾讯 / 东财）把开盘集合竞价成交并入首个分钟点
 * （09:30），故该笔量额 = 首个常规分钟点的量额，且该分钟不再另拆连续竞价成交（避免重复计数）；
 * 盘后固定价段只记真实发生的成交（零成交分钟不造笔）。由此逐笔总量 === 分时总量。
 * 体积按降序排列，使吸收残差的末笔为最小量（acc ≥ A/2），从而 Sterbenz 引理下
 * acc + (A-acc) === A 严格成立，消除 1 ULP 尾差。
 * anchorToIntraday=false 时回退到脚本原始（未修复）口径。
 */
import type { IntradayPoint, TradeTick, Side } from '../types';
import { r2 } from './rounding';
import { mulberry32 } from './random';
import { isoToDateBase } from './market-time';

export interface TradeSeriesOptions {
  anchorToIntraday?: boolean;
}

export function buildTradeSeries(
  intraday: IntradayPoint[], iso: string, opts: TradeSeriesOptions = {},
): TradeTick[] {
  const anchor = opts.anchorToIntraday !== false;   // 默认 true
  const rnd = mulberry32(20261113);
  const trades: TradeTick[] = [];
  let seq = 0;
  const push = (
    time: string, price: number, volume: number,
    side: Side, rawSide: string, phase: TradeTick['phase'],
    tradeCount: number, amount?: number,
  ): void => {
    const [hh, mm] = time.split(':');
    trades.push({
      timestamp: Date.parse(`${isoToDateBase(iso)}T${hh}:${mm}:00+08:00`),
      time, seq: seq++, price, volume,
      amount: amount ?? r2(price * volume),
      side, rawSide, sideSource: 'mock.public-merged', source: 'mock',
      license: 'public-demo', requiresAuthorization: true,
      granularity: 'merged3s', phase, tradeCount,
    });
  };

  let prev = intraday[0].price;
  /** 生成一条连续竞价逐笔（价格抖动 / B-S-N 方向 / 合并笔数逐字保留脚本口径）。 */
  const emitContinuous = (p: IntradayPoint, volume: number, amount?: number): void => {
    const price = r2(p.price + (rnd() - 0.5) * 0.8);
    const delta = price - prev;
    const side: Side = delta > 0.01 ? 'B' : delta < -0.01 ? 'S' : 'N';
    const rawSide = side === 'N' ? 'M' : side;      // 腾讯用 M 表示中性
    push(p.time, price, volume, side, rawSide, 'continuous', 1 + Math.floor(rnd() * 5), amount);
    prev = price;
  };

  const regular = intraday.filter((p) => p.session !== 'afterHours');
  const opening = regular[0];
  if (anchor && opening) {
    // 开盘集合竞价成交 = 首个分钟点（09:30）的量额；集合竞价无主动方向
    push('09:25:00', opening.price, opening.volume, 'N', 'N', 'auction', 1, opening.amount);
  } else {
    push('09:25:00', intraday[0].price, 15000, 'N', 'N', 'auction', 1);   // 旧脚本口径（未修复）
  }
  for (const p of regular) {
    if (anchor && p === opening) continue;            // 已由 09:25 竞价成交完整表示
    const n = 1 + Math.floor(rnd() * 3);              // 每分钟 1–3 条合并分笔
    const V = p.volume, A = p.amount;
    if (anchor) {
      // 体积切分严格求和到 V（逐笔封顶 left，末笔取剩余，避免 Math.max(100,…) 溢出）。
      const vols: number[] = [];
      let left = V;
      for (let i = 0; i < n - 1; i += 1) {
        const v = Math.max(0, Math.min(left, Math.round((V / n) * (0.6 + rnd() * 0.8) / 100) * 100));
        vols.push(v);
        left -= v;
      }
      vols.push(left);
      vols.sort((x, y) => y - x);                    // 大量在前、最小量在后（残差笔最小）
      // 金额按各笔量占该分钟分时 amount 比例分配；末笔吸收残差（不取整，保证严格相等）。
      const amounts: number[] = [];
      let acc = 0;
      for (let i = 0; i < n; i += 1) {
        if (i === n - 1) amounts.push(A - acc);
        else { const amt = V > 0 ? r2(A * vols[i] / V) : 0; amounts.push(amt); acc += amt; }
      }
      for (let i = 0; i < n; i += 1) emitContinuous(p, vols[i], amounts[i]);
    } else {
      // 逐字：脚本原始 buildTrades 连续竞价分支（未修复口径，价格/量/笔数随机序列保持一致）。
      const minuteVol = Math.max(100, p.volume);
      let left = minuteVol;
      for (let i = 0; i < n; i += 1) {
        const v = i === n - 1
          ? left
          : Math.max(100, Math.round((minuteVol / n) * (0.6 + rnd() * 0.8) / 100) * 100);
        left = Math.max(0, left - v);
        emitContinuous(p, v);
      }
    }
  }
  for (const p of intraday.filter((x) => x.session === 'afterHours')) {
    if (anchor) {
      if (p.volume > 0) push(p.time, p.price, p.volume, 'N', 'M', 'afterHours', 1, p.amount);
    } else {
      push(p.time, p.price, Math.max(100, p.volume), 'N', 'M', 'afterHours', 1);   // 旧脚本口径
    }
  }
  return trades;
}

/**
 * 逐笔涨跌口径的单一真源：以上一笔成交价为基准，首行对昨收；涨 1 / 跌 -1 / 平 0。
 * detail.ts 的当日 bindDataset 与历史分时视图共用，避免两处手写同一 map。
 * 纯函数：不修改入参，返回带 trend 的新数组。
 */
export function withTradeTrend(
  rows: TradeTick[], preClose: number,
): Array<TradeTick & { trend: number }> {
  return rows.map((t, i, arr) => {
    const diff = t.price - (i === 0 ? preClose : arr[i - 1].price);
    return { ...t, trend: Math.abs(diff) < 1e-6 ? 0 : diff > 0 ? 1 : -1 };
  });
}
