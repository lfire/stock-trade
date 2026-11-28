/**
 * SSR 安全基类：浏览器里就是原生 HTMLElement；在 Node / SSR（Next、Nuxt、Vite SSR）中
 * 全局没有 HTMLElement，`class X extends HTMLElement` 会在 import 阶段直接抛错。
 * 这里退化为一个空类，使根入口与元素子路径可在服务端被安全 import（不会实例化）。
 * 真正注册标签仍须在浏览器调用 defineAll() / defineElements()，服务端调用会自动 no-op。
 */
const Base: typeof HTMLElement = typeof HTMLElement === 'undefined'
  ? (class {} as unknown as typeof HTMLElement)
  : HTMLElement;

export { Base as BaseElement };
