/**
 * 集合竞价序列（算法单元化收口）：逐字搬 scripts/build-sample-data.mjs 的
 * buildAuction(:303-388) 与 buildClosingAuction(:393-465)，去掉 notes 副作用。
 * 内部调用 ./auction-match 的 matchAuction / makeOrderBook（上交所 3.5.2 三原则）。
 * 两个 builder 共用同一条 mulberry32(20261113) 随机流（脚本模块级 rnd 的口径），
 * 保证 open(69) + close(21) = 90 点与生成脚本逐点一致。
 */
import type { Bar, IntradayPoint, AuctionPoint } from '../types';
import { AUCTION_STEP_SEC } from '../core/market-constants';
import { r2 } from './rounding';
import { mulberry32 } from './random';
import { isoToDateBase } from './market-time';
import { matchAuction, makeOrderBook } from './auction-match';

type Random = () => number;
interface Step { t: number; p: number; }
interface VolStep { t: number; v: number; }

/** 分段常值函数在 sec 处的取值（t 递增，取最后一个 t<=sec 的值）。 */
function priceAt(sec: number, steps: Step[]): number {
  let p = steps[0].p;
  for (const s of steps) { if (s.t <= sec) p = s.p; else break; }
  return p;
}
function volAt(sec: number, steps: VolStep[]): number {
  let v = steps[0].v;
  for (const s of steps) { if (s.t <= sec) v = s.v; else break; }
  return v;
}

/** 开盘集合竞价 9:15:00–9:25:00，每 9 秒一个节点，共 69 点。 */
function buildOpenAuction(
  bars: Bar[], intraday: IntradayPoint[], iso: string, rnd: Random,
): AuctionPoint[] {
  const last = bars[bars.length - 1];
  const openPrice = last.open;                    // 9:25 真实开盘价
  const preClose = last.preClose;                 // 真实昨收
  const firstTick = intraday[0];                  // 09:30 首点，其量额即 9:25 集合竞价成交量
  const realVolume = firstTick.volume;            // 股
  const realAmount = firstTick.amount;            // 元
  const realLots = realVolume / 100;              // 手（虚拟匹配量单位）

  const secs: number[] = [];
  for (let s = 0; s < 300; s += AUCTION_STEP_SEC) secs.push(s);
  secs.push(300);
  for (let s = 300 + AUCTION_STEP_SEC; s < 600; s += AUCTION_STEP_SEC) secs.push(s);
  secs.push(600);

  const priceSteps: Step[] = [
    { t: 0, p: r2(preClose + 1.80) },
    { t: 54, p: r2(preClose + 1.10) },
    { t: 117, p: r2(preClose + 1.55) },
    { t: 189, p: r2(preClose + 0.40) },
    { t: 252, p: r2(preClose - 0.60) },
    { t: 297, p: r2(openPrice + 3.20) },   // 9:19:57 撤单陷阱
    { t: 300, p: r2(openPrice + 2.60) },   // 9:20:00 不可撤单
    { t: 369, p: r2(openPrice + 1.90) },
    { t: 441, p: r2(openPrice + 1.10) },
    { t: 513, p: r2(openPrice + 0.55) },
    { t: 570, p: r2(openPrice + 0.20) },
    { t: 597, p: r2(openPrice + 0.08) },
    { t: 600, p: r2(openPrice) },          // 9:25:00 = 真实开盘价
  ];
  const unmatchedSteps: VolStep[] = [
    { t: 0, v: 1150 }, { t: 90, v: 1480 }, { t: 180, v: 1320 }, { t: 252, v: 1680 },
    { t: 297, v: 420 }, { t: 300, v: 380 }, { t: 420, v: 260 }, { t: 510, v: 140 },
    { t: 570, v: 60 }, { t: 597, v: 20 }, { t: 600, v: 0 },
  ];

  const pts: AuctionPoint[] = [];
  secs.forEach((sec, idx) => {
    const mm = 15 + Math.floor(sec / 60);
    const ss = sec % 60;
    const time = `09:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const isEnd = idx === secs.length - 1;            // 9:25:00 统一撮合
    const k = sec / 600;
    const center = priceAt(sec, priceSteps);
    const targetMatched = isEnd ? realLots : Math.max(1, Math.round(realLots * Math.pow(k, 1.7)));
    const gap = isEnd ? 0 : Math.max(0, volAt(sec, unmatchedSteps) + Math.round((rnd() - 0.5) * 90));
    const buyBias = sec < 280;                        // 9:20 前虚假买单堆积，之后卖方堆积
    const ob = makeOrderBook(center,
      targetMatched + (buyBias ? gap : 0),
      targetMatched + (buyBias ? 0 : gap));
    const m = matchAuction(ob.bids, ob.asks, preClose);   // 开盘并列价取最接近前收
    pts.push({
      timestamp: Date.parse(`${isoToDateBase(iso)}T${time}+08:00`),
      time,
      phase: 'open',
      virtualPrice: r2(m.price),
      matchedQty: m.matchedQty,
      unmatchedQty: m.unmatchedQty,
      unmatchedSide: m.unmatchedSide,
      source: isEnd ? 'anchored-real' : 'illustrative',
      priceBasis: 'SSE-3.5.2-max-volume',
      volume: isEnd ? realVolume : 0,                 // 竞价期间「价有量无」
      amount: isEnd ? realAmount : 0,
    });
  });
  return pts;
}

/** 收盘集合竞价 14:57:00–15:00:00，每 9 秒一个节点，共 21 点。 */
function buildClosingAuction(
  bars: Bar[], intraday: IntradayPoint[], iso: string, rnd: Random,
): AuctionPoint[] {
  // 真实分时里 14:58/14:59 成交量为 0（价有量无），15:00 一次性撮合产生收盘价与成交量。
  const p1457 = intraday.find((p) => p.time === '14:57')!;   // 连续竞价末价
  const p1500 = intraday.find((p) => p.time === '15:00')!;   // 15:00 真实收盘集合竞价结果
  const startPrice = p1457.price;
  const closePrice = bars[bars.length - 1].close;
  const realVolume = p1500.volume;
  const realAmount = p1500.amount;
  const realLots = realVolume / 100;

  const TOTAL = 180;
  const baseSec = 14 * 3600 + 57 * 60;
  const secs: number[] = [];
  for (let s = 0; s <= TOTAL; s += AUCTION_STEP_SEC) secs.push(s);

  const priceSteps: Step[] = [
    { t: 0, p: r2(startPrice) },
    { t: 27, p: r2(startPrice + 0.16) },
    { t: 60, p: r2(startPrice + 0.33) },
    { t: 90, p: r2(startPrice + 0.50) },
    { t: 120, p: r2(closePrice - 0.14) },
    { t: 150, p: r2(closePrice - 0.06) },
    { t: 171, p: r2(closePrice - 0.02) },
    { t: 180, p: r2(closePrice) },
  ];
  const unmatchedSteps: VolStep[] = [
    { t: 0, v: 880 }, { t: 45, v: 760 }, { t: 90, v: 610 },
    { t: 120, v: 430 }, { t: 150, v: 240 }, { t: 171, v: 90 }, { t: 180, v: 0 },
  ];

  const pts: AuctionPoint[] = [];
  secs.forEach((sec, idx) => {
    const abs = baseSec + sec;
    const hh = Math.floor(abs / 3600), mm = Math.floor((abs % 3600) / 60), ss = abs % 60;
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const isEnd = idx === secs.length - 1;             // 15:00:00 统一撮合
    const k = sec / TOTAL;
    const center = priceAt(sec, priceSteps);
    const targetMatched = isEnd ? realLots : Math.max(1, Math.round(realLots * Math.pow(k, 1.5)));
    const gap = isEnd ? 0 : Math.max(0, volAt(sec, unmatchedSteps) + Math.round((rnd() - 0.5) * 60));
    const ob = makeOrderBook(center, targetMatched + gap, targetMatched);  // 收盘买方堆积为主
    const m = matchAuction(ob.bids, ob.asks, startPrice);  // 收盘并列价参考最近成交价
    pts.push({
      timestamp: Date.parse(`${isoToDateBase(iso)}T${time}+08:00`),
      time,
      phase: 'close',
      virtualPrice: r2(m.price),
      matchedQty: m.matchedQty,
      unmatchedQty: m.unmatchedQty,
      unmatchedSide: m.unmatchedSide,
      source: isEnd ? 'anchored-real' : 'illustrative',
      priceBasis: 'SSE-3.5.2-max-volume',
      volume: isEnd ? realVolume : 0,
      amount: isEnd ? realAmount : 0,
    });
  });
  return pts;
}

/** open(69) + close(21) = 90 点；两个 builder 共用同一条固定种子随机流。 */
export function buildAuctionSeries(
  bars: Bar[], intraday: IntradayPoint[], iso: string,
): AuctionPoint[] {
  const rnd = mulberry32(20261113);
  const open = buildOpenAuction(bars, intraday, iso, rnd);
  const close = buildClosingAuction(bars, intraday, iso, rnd);
  return [...open, ...close];
}
