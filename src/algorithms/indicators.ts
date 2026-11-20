/**
 * 技术指标（算法单元化收口）：计算实现统一从 src/compute/indicators re-export，
 * 保证单一实现；WARMUP 提供各指标在默认参数下的预热根数元数据。
 */
export {
  sma,
  ema,
  ma,
  macd,
  kdj,
  computeIndicator,
} from '../compute/indicators';

/**
 * 各指标默认参数下、产出首个可靠值所需的最少 K 线根数（预热根数）。
 * 依赖参数的指标按 computeIndicator 默认参数记；裁剪前段不可靠值时可参考。
 */
export const WARMUP = Object.freeze({
  /** MA5 / SMA5：i >= n-1 才出值 */
  MA: 5,
  SMA: 5,
  /** EMA(n) 需 n 根冷启动；此处按 MACD 慢线默认 26 记 */
  EMA: 26,
  /** DIF 需 slow=26 根、DEA 在有效 DIF 段再需 signal-1=8 根：26+9-1=34 */
  MACD: 34,
  /** KDJ 的 RSV 默认窗口 9 */
  KDJ: 9,
  /** 日线量比默认 5 日均量 */
  VOL_RATIO: 5,
  /** 量 / 额首根即有效，无需预热 */
  VOL: 0,
  AMOUNT: 0,
} as const);
