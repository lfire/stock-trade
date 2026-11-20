/**
 * 普通 / 涨停 / 跌停 三场景（算法单元化收口）。
 * 逐字搬 scripts/build-order-book.mjs 的 :249-290，去掉 fs/IO 副作用；封单量硬编码值
 * 改为具名常量导出。纯函数：mkDepth / mkPano 一律用展开 + filter 生成新对象 / 新数组，
 * 不把场景结果写回传入的 depth / pano。
 *
 * 真实涨跌停时一侧无挂单：涨停无卖盘、买1 为涨停价封单；跌停无买盘、卖1 为跌停价封单。
 */
import type { DepthBookSnapshot, DepthLevel } from '../types';
import { r2 } from './rounding';
import { limitPrices } from './price-limits';

/** 涨停买一 / 跌停卖一 封单量与笔数（脚本 :256 / :263 的 i===0 硬编码示意值）。 */
export const LIMIT_UP_SEAL_VOLUME = 1280000;
export const LIMIT_UP_SEAL_ORDER_COUNT = 860;
export const LIMIT_DOWN_SEAL_VOLUME = 960000;
export const LIMIT_DOWN_SEAL_ORDER_COUNT = 720;

/** 非首档逐档衰减基数 / 步长（脚本 :256-257 / :263-264）。 */
export const SEAL_DECAY = Object.freeze({
  limitUpBase: 26000, limitUpStep: 2300,
  limitUpCountBase: 12, limitUpCountStep: 3,
  limitDownBase: 24000, limitDownStep: 2100,
  limitDownCountBase: 11, limitDownCountStep: 3,
  minVolume: 100,
});

export interface Scenario {
  label: string;
  depth: DepthBookSnapshot;
  pano: DepthBookSnapshot;
  [key: string]: unknown;
}

const seal = (price: number, volume: number, orderCount: number): DepthLevel => ({
  price, volume, orderCount,
});

/**
 * 生成三场景。normal 直接返回入参引用 { depth, pano }；limitUp / limitDown 由封单常量
 * 与涨跌停价派生。场景对象的键即场景名，不额外加顶层元数据以免破坏按 key 索引。
 */
export function buildDepthScenarios(
  depth: DepthBookSnapshot,
  pano: DepthBookSnapshot,
  opts: { preClose: number; limitRate: number },
): Record<string, Scenario> {
  const { up: limitHi, down: limitLo } = limitPrices(opts.preClose, opts.limitRate);

  const mkDepth = (state: 'limitUp' | 'limitDown'): DepthBookSnapshot => {
    if (state === 'limitUp') {
      const bids: DepthLevel[] = Array.from({ length: 10 }, (_, i) => seal(
        r2(limitHi - i * 0.01),
        i === 0
          ? LIMIT_UP_SEAL_VOLUME
          : Math.max(SEAL_DECAY.minVolume,
            Math.round((SEAL_DECAY.limitUpBase - i * SEAL_DECAY.limitUpStep) / 100) * 100),
        i === 0
          ? LIMIT_UP_SEAL_ORDER_COUNT
          : SEAL_DECAY.limitUpCountBase + i * SEAL_DECAY.limitUpCountStep,
      ));
      return { ...depth, bids, asks: [], limitState: 'limitUp', limitPrice: limitHi };
    }
    const asks: DepthLevel[] = Array.from({ length: 10 }, (_, i) => seal(
      r2(limitLo + i * 0.01),
      i === 0
        ? LIMIT_DOWN_SEAL_VOLUME
        : Math.max(SEAL_DECAY.minVolume,
          Math.round((SEAL_DECAY.limitDownBase - i * SEAL_DECAY.limitDownStep) / 100) * 100),
      i === 0
        ? LIMIT_DOWN_SEAL_ORDER_COUNT
        : SEAL_DECAY.limitDownCountBase + i * SEAL_DECAY.limitDownCountStep,
    ));
    return { ...depth, bids: [], asks, limitState: 'limitDown', limitPrice: limitLo };
  };

  const mkPano = (state: 'limitUp' | 'limitDown'): DepthBookSnapshot => {
    if (state === 'limitUp') {
      return {
        ...pano,
        mid: limitHi, limitState: 'limitUp',
        bids: [
          seal(limitHi, LIMIT_UP_SEAL_VOLUME, LIMIT_UP_SEAL_ORDER_COUNT),
          ...pano.bids.filter((d) => d.price < limitHi),
        ],
        asks: [],
      };
    }
    return {
      ...pano,
      mid: limitLo, limitState: 'limitDown',
      bids: [],
      asks: [
        seal(limitLo, LIMIT_DOWN_SEAL_VOLUME, LIMIT_DOWN_SEAL_ORDER_COUNT),
        ...pano.asks.filter((d) => d.price > limitLo),
      ],
    };
  };

  return {
    normal: { label: '普通', depth, pano },
    limitUp: { label: '涨停', depth: mkDepth('limitUp'), pano: mkPano('limitUp') },
    limitDown: { label: '跌停', depth: mkDepth('limitDown'), pano: mkPano('limitDown') },
  };
}
