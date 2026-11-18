// 计算引擎抽象。当前为纯 JS 实现；Rust/WASM 接入后替换 WasmComputeEngine 即可，
// 组件层只依赖 indicator(name, bars, params) 这一个方法。
import { ComputeEngineInterface } from '../types.js';
import { computeIndicator } from './indicators.js';

export class JsComputeEngine extends ComputeEngineInterface {
  constructor() { super(); this.mode = 'js'; }
  indicator(name, bars, params) { return computeIndicator(name, bars, params); }
}

/**
 * Rust / WASM 引擎占位。
 * 当前环境仅有 stable rustc 1.69 + wasm-pack 0.11.1，没有 nightly / rust-src，
 * 无法按 wasm-bindgen-rayon 要求用 build-std + atomics 编译线程版。
 * 工具链就绪后在此实现 initThreadPool + wasm.indicator()，签名保持不变。
 */
export class WasmComputeEngine extends ComputeEngineInterface {
  static isAvailable() { return false; }
  constructor() { super(); throw new Error('WasmComputeEngine 尚未构建：需要 nightly + rust-src + atomics（见 docs/03 §6.3）'); }
  indicator() { throw new Error('not built'); }
}

export function createComputeEngine() {
  return WasmComputeEngine.isAvailable() ? new WasmComputeEngine() : new JsComputeEngine();
}
