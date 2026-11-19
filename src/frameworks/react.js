/**
 * React / JSX 薄封装：不依赖 react 运行时，任何支持 ref 回调的框架都能用。
 *
 * 用法（React 19 的 ref cleanup 会自动解绑事件）：
 *   <stock-chart ref={(el) => bindStockChart(el, {
 *     mode: 'candle', theme: 'light',
 *     on: { 'crosshair-change': (e) => console.log(e.detail.index) },
 *   })} />
 *
 * 命令式注入数据用 `data`（对象）或 `dataset`（目录 URL），其余键映射到组件公开 setter。
 */
export function bindStockChart(el, options = {}) {
  if (!el) return undefined;
  const setters = {
    dataset: (v) => { if (typeof v === 'string') el.setAttribute('dataset', v); },
    mode: (v) => el.setMode?.(v),
    period: (v) => el.setPeriod?.(v),
    chipMode: (v) => el.setChipMode?.(v),
    theme: (v) => el.setTheme?.(v),
    auction: (v) => el.setAuctionEnabled?.(v !== 'off' && v !== false),
    chips: (v) => el.setChipsEnabled?.(v !== 'off' && v !== false),
    subplots: (v) => el.setSubplotCount?.(Number(v)),
    movingAverages: (v) => el.setMovingAverages?.(v),
    macd: (v) => el.setMACDParams?.(v),
    intradayDays: (v) => el.setIntradayDays?.(v),
    viewport: (v) => el.setViewport?.(v),
    crosshair: (v) => el.setCrosshair?.(v),
  };
  for (const [key, fn] of Object.entries(setters)) {
    if (options[key] !== undefined) fn(options[key]);
  }
  if (options.data) el.setDataset?.(options.data);

  const offs = [];
  for (const [name, handler] of Object.entries(options.on || {})) {
    if (typeof handler !== 'function') continue;
    el.addEventListener(name, handler);
    offs.push(() => el.removeEventListener(name, handler));
  }
  return () => { for (const fn of offs) fn(); };
}
