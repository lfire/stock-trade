# Stock Chart · 组件实现（P0 可运行骨架）

集主图、多副图、筹码峰、集合竞价、交易明细、十档盘口于一体的 Web Components 实现。
**重点是可运行的组件**；数据先真实抓取公开源，抓不到的按固定种子确定性 mock，产出结构稳定的示例 case。

## 运行

需要通过 HTTP 访问（浏览器 `fetch` 不能读 `file://` 的 JSON）：

```bash
cd /Users/benji/Documents/benji/github/stock-trade
npm run serve
# 默认 8080；若被占用会自动顺延到 8081…，以终端打印的地址为准
# 也可指定端口：PORT=8090 npm run serve
```

`serve` 是零依赖的 Node 静态服务（`scripts/serve.mjs`），带 `Cache-Control: no-store`，避免开发期缓存到旧模块；不依赖 Python 版本。

在 WorkBuddy 中直接打开 `index.html` 预览面板即可（内置预览服务会映射整个项目目录，提供同源访问）。

若页面空白，顶部红色「加载诊断」框会直接显示原因（模块/资源加载失败、数据未就绪、`file://` 直接打开等），便于快速定位。页面模块 URL 使用干净相对路径，不依赖查询串版本号。

## 目录

```text
index.html                          示例页：三列两行布局 + 竞价/筹码峰开关 + 副图数量 + 明细
src/                                 TypeScript 源码（strict，0 显式 any），tsc 编译到 dist/
  index.ts / pure.ts               组件注册入口 / 纯函数子入口（含全部算法单元）
  global.d.ts                      唯一手写声明（JSX / HTMLElementTagNameMap）
  types.ts                         共享数据契约、配置、事件映射、色板的单一真源
  algorithms/                      【以算法概念为分割单元】18 个纯 TS 模块 + ALGORITHMS 注册表
    rounding / random / market-time / price-limits / returns / vwap / volume-ratio
    indicators / aggregation / format / chip-distribution / intraday-multi
    auction-match / auction-series / trade-series / depth-snapshot
    order-book / depth-scenarios
  core/
    derive-dataset.ts              【数据分层枢纽】L0 输入 → L1 运行时派生 + 跨图数值闭合
    data-store.ts                  静态分片加载（串行 + 重试 + no-store），加载后调用派生层
    chart-context.ts               布局 / viewport / priceScale / crosshair 单一真源
    bar-aggregator.ts              多周期 K 线聚合
    market-constants.ts            A 股业务常量单一真源
  compute/  gl/  elements/  frameworks/   指标 / WebGL / 7 个自定义元素 / React·Vue 薄封装
  data/                            L0 外部输入（见 data/SOURCES.md）
    manifest.json                  6 个输入分片 + 元数据
    bars_1d.json                   935 根真实公开日 K（前复权）
    intraday_20261113.json         267 点真实公开分时
    auction_*.json                 90 点竞价示意（9:25/15:00 锚定真实）
    trades_*.json                  逐笔示意（需 Level-2 授权）
    depth_*.json                   十档快照示意（需 Level-2 授权）
    orders_*.json                  委托流示意（需 Level-2 授权）
    raw/                           抓取到的原始响应 + 流通股本静态资料
  【L1 运行时派生，不再落盘】chips / intradayMulti / depthFull / depthScenarios
scripts/
  fetch-public-data.mjs            抓取公开数据（可重跑）
  build-sample-data.mjs            归一化 + 确定性 mock 补全（只写 6 个 L0 输入）
  build-order-book.mjs             委托流 mock + manifest 补回 orders
  build.mjs                        tsc 编译 + import 扩展名补全 + 产物校验
  verify.mjs                       数据口径 / 跨图闭合 / 源码 / 页面引用校验
  tests/*.test.mjs                 64 个行为与契约测试（含第三方 TS 消费者探针）
  shared / limit-rules / auction-match   薄 re-export，复用 dist/algorithms
  serve.mjs                        零依赖静态服务（端口自动顺延 + no-store）
docs/                              01 数据格式 / 02 扩展数据 / 03 架构方案 / 审计报告
```

## 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 日 K 935 根 | 东方财富 `push2his` kline | 真实，前复权；剔除 2026-11-13 之后未完成的 K 线，固定到 2026-11-13 |
| 分时 267 点 | 腾讯 `minute/query` | 真实完整交易日；累计量额已差分为每分钟增量 |
| 筹码 150 档 | **自行计算** | 基于真实日 K + 换手率，三角形成本分布算法（公开 cyq 接口空响应） |
| 集合竞价 **69 点 · 尾盘竞价 21 点 / 9 秒** | **mock（锚定真实）** | 历史竞价虚拟撮合快照属 L2、免费接口无法回溯；同一文件用 `phase` 区分 `open`(9:15–9:25) / `close`(14:57–15:00)，均锚定真实值拟真生成：开盘末点 = 真实 9:25 开盘价/量额，尾盘末点 = 真实 15:00 收盘价/量额（见下方说明） |
| 逐笔明细 507 条 | **mock + 真实片段留档** | 真实接口只给当日 3 秒合并分笔片段；主数据按同结构确定性生成 |
| 十档盘口 | **mock** | 公开盘口接口空响应，按收盘价上下各 10 档生成 |
| 全部挂单 1377 条 | **mock（Level-2）** | 公开接口无逐笔委托（抓取复核见 `src/data/raw/em_order_attempt.json`）；按分时市价轨迹 + 收盘十档快照闭合确定性生成；含 `NEW / FILL / CANCEL` 完整委托生命周期（部分成交后按剩余量撤单），详见 `src/data/SOURCES.md` |
| 全景盘口 买 53 / 卖 33 档 | **回放计算（真实 L2 做法）** | 由逐笔委托流重建完整委托簿（NEW 入簿 / CANCEL 出簿 / 被市价穿越即成交离场），未撤单远档一直留存，买档覆盖至跌停 1269.24、卖档覆盖至涨停 1551.30，前十档与十档快照闭合 |
| 盘口场景 3 组 | **mock** | 普通 / 涨停 / 跌停三组十档快照与对应全景盘口；涨停无卖盘、买1 为涨停价封单，跌停反之 |

所有 mock 使用固定种子 `mulberry32(20261113)`，重复运行输出一致。详见 `src/data/SOURCES.md`。

## 组件 API

**注册方式**：`src/elements/*.js` 只导出 class、import 时不产生 `customElements.define` 副作用。用注册入口显式升级标签：

```js
import { defineAll, StockChart } from './dist/index.js';
defineAll();          // 注册全部 7 个标签；也可传自定义 registry 便于测试隔离
```

`./dist/pure.js`（包导出 `stock-chart/pure`）只含几何 / 指标 / 聚合 / 参数纯函数，不含 DOM 引用，可在 Node 或 Worker 中直接 import。

**主题**：`setTheme('light'|'dark'|{自定义色板})` / `getTheme()`，或声明式 `<stock-chart theme="dark">`、示例页 `?theme=dark`。色板采用**帧级作用域隔离**：`ChartContext` 持有实例级 `palette` 快照，`render()` 用 `withPalette(instancePalette, renderFrame)` 在一帧同步渲染内临时切换全局 `PALETTE`（110 处模块级 `PALETTE.xxx` 读取零改动）、帧后立即还原，因此同页多个 `<stock-chart>` 可以用不同主题而互不串色。`setTheme()` 不再持久覆盖全局色板、也不写 `:root`，只把 `--sc-bg/--sc-panel/--sc-line/--sc-text/--sc-muted/--sc-up/--sc-down/--sc-link` 与 `--sc-row-h/--sc-head-h/--sc-title-h` 写到**本实例 host**（shadow DOM 后代可继承）；`PALETTE.band` 只用于 WebGL 几何。示例页额外监听 `theme-change` 把页面级 `--bg/--panel/…` 同步到 `:root`，供头部/工具栏使用——这是页面行为，不是组件职责。组件内部 DOM（信息栏、筹码统计、侧栏）、两个 Shadow DOM 组件的颜色以及竞价 hover 浮层均改用 `var(--sc-*)` / `color-mix`，换肤自动刷新、无需重建。数据集 `manifest.palette/upColor/downColor` 在用户未显式指定主题时自动生效，变化时派发 `theme-change`。事件也不再走 document 全局总线：示例页监听各自的 `chart`，`trade-tape` 监听 `closest('stock-chart')`（独立使用时才回退 document）。

**JSX 薄封装**：`dist/src/index.d.ts` 声明全局 `JSX.IntrinsicElements`（8 个自定义标签）与 `HTMLElementTagNameMap`；`stock-chart/react` 导出 `bindStockChart(el, options)`，把 props 映射到公开 setter、注册 `on` 事件并返回 cleanup，**不依赖 react 运行时**，可用于 React ref / 任意框架：

```jsx
<stock-chart ref={(el) => bindStockChart(el, {
  mode: 'candle', theme: 'light',
  on: { 'crosshair-change': (e) => console.log(e.detail.index) },
})} />
```

**类型与发布**：源码已全面切换为 **TypeScript（strict）**。`npm run build` 调用 `tsc -p tsconfig.json`，把 `src/**/*.ts` 编译为 `dist/**/*.js` 并**自动生成 `dist/**/*.d.ts`**（不再维护手写声明）；`src/global.d.ts`（JSX / `HTMLElementTagNameMap`）由构建脚本复制进 `dist`，并在 `dist/index.d.ts` 顶部注入三斜线引用，保证消费者 import 时获得全局声明；最后对每个 JS 产物做 `node --check`。`main` / `types` / `exports` 全部指向构建产物，`files` 只含 `dist` + `README.md` + `LICENSE`。`devDependencies.typescript` 锁定 `5.6.3`（CI 可 `npm ci` 复现，不依赖全局 `tsc`）。`npm test` 运行 63 个真实行为/契约断言；`pretest` / `precheck` / `predata` / `preserve` 会先构建，保证 Node 脚本与浏览器页面始终加载最新 `dist` 产物。`JSX.IntrinsicElements`、React 与 Vue 薄封装均已提供。

```html
<stock-chart dataset="./src/data" mode="candle">
  <price-pane height="50"></price-pane>
  <indicator-pane indicator="VOL" height="11"></indicator-pane>
  <indicator-pane indicator="MACD" height="15"></indicator-pane>
  <chip-pane dock="right" width="170" mode="histogram"></chip-pane>
  <auction-pane height="14"></auction-pane>
</stock-chart>
<trade-tape></trade-tape>
<depth-book></depth-book>
```

`<stock-chart>` 方法（按职责分组）：
- 数据 / 模式：`setDataset(ds)` / `setMode('candle'|'intraday')` / `setPeriod(key)` / `getPeriod()` / `setChipMode('stat'|'histogram')` / `setViewport({start,end})`
- 开关：`setAuctionEnabled(on)` / `setChipsEnabled(on)`
- 副图：`setSubplotCount(n)` / `getSubplotConfig()` / `getSubplotLayout()` / `setSubplotIndicator(index, name)`
- 均线：`getMovingAverages()` / `setMovingAverages(list)` / `addMovingAverage(cfg)` / `removeMovingAverage(period)` / `updateMovingAverage(period, patch)`
- 状态 / 数据：`getState()`（只读快照：mode / period / crosshair / viewport / pano / 场景 / 单位）/ `getDataset()` / `setDetailData(data)` / `setDepthScenario(key)` / `setDepthUnit(unit)`
- 编程式交互：`setCrosshair(i)` / `setPointer(x,y)` / `setAuctionHover(i)` / `setClosingHover(i)`
- DOM 挂载：`attachDetailCard(card)` / `detachDetailCard(card, home)` / `attachCover(el)`；布局尺寸由 `getLayoutHints()` 交给 core，页面不再注入 `#pane-bars`
- 其他：`getComputeMode()`（当前恒为 `js`）/ `destroy()` / `getContext()` —— **返回内部可变的 `ChartContext`，仅为兼容保留，示例页已不再使用，不属于稳定对外契约**。

事件（全部经 `bubbles + composed` 冒泡）：`load-start` / `data-loaded` / `dataset-ready` / `chart-error` / `webglcontext-lost` / `viewport-change` / `layout-change` / `period-change` / `crosshair-change` / `chip-mode-change` / `compute-mode-change` / `subplot-config-change` / `ma-config-change` / `auction-toggle` / `chips-toggle` / `auction-hover` / `closing-hover` / `head-change`（头部信息结构化数据）/ `detail-data-change` / `depth-scenario-change` / `depth-unit-change`。
交互：滚轮缩放、拖拽平移、十字光标联动（明细表格会高亮对应分钟）。

> **组件化核验（2026-11-18）**：P0 目标已达成 —— 单 canvas / 单 WebGL2 context + scissor 多 pane、单一 `ChartContext` 真源、7 个 Custom Elements 标签、`ComputeEngine` 抽象（JS 实现 + WASM 占位）、`ChipDataset` 双模式、纯函数层（`gl/geometry`、`compute/indicators`、`core/bar-aggregator`）。**已收口（第 1、2 步）**：示例页不再写 `ctx.dataset` / 读 `chart.ctx` / 调内部 `setCrosshair` 等方法 —— 场景、盘口单位、L2 明细数据、编程式交互均由组件公开 API 承接并派发结构化事件；副图信息栏的容器、样式、指标计算与刷新整套搬进 `<stock-chart>` 内部（组件自带 `PANE_BARS_CSS`）；交易明细卡片与覆盖层改经 `attachDetailCard/attachCover` 挂载；core 的布局尺寸改由 `getLayoutHints()` 传入，不再 `querySelector` DOM。**第 3 步已拆注册副作用**：7 个 `src/elements/*.js` 不再 `customElements.define`，统一由 `src/index.ts` 的 `defineAll()` 显式注册；新增 `src/pure.ts` 纯函数子入口（Node 可直接 import）；`package.json` 补 `exports`（`.` / `./pure` / `./elements/*`）与 `files`。**第 3 步已完成**：`package.json` 移除 `private` 并补齐 `main` / `module` / `types` / `exports`（含 types 条件）/ `files` / `sideEffects:false` / `engines` / `typecheck` 脚本 / `devDependencies.typescript`；新增 `dist/src/index.d.ts`（数据契约 + 7 个 class + 事件映射 + `HTMLElementTagNameMap`）与 `dist/src/pure.d.ts`（26 个纯函数签名），`npm run typecheck` 与第三方 TS 消费校验均通过，`npm pack --dry-run` 确认声明文件入包。**第 4 步已补 theme 与 JSX 薄封装**：`setTheme()` / `theme` 属性 / `?theme=dark`、内置 light/dark 预设 + 自定义色板、`manifest.palette/upColor/downColor` 自动生效、CSS 变量贯通 WebGL 与 DOM；`JSX.IntrinsicElements` + `stock-chart/react` 零依赖 ref 绑定器。**重连幂等与类型契约已补齐**：`AbortController` 统一管理连接期全部监听，`disconnectedCallback()` 撤销监听并移除 canvas/overlay/`<style>`/`#pane-bars`（保留含页面节点的 sideSlot），`connectedCallback()` 复用侧栏、重建渲染节点，`theme` 属性变化也能反射到 `setTheme()`；`dist/src/index.d.ts` 补齐 `setSideExpanded`/`updateSide`、9 个事件、`TradeTape`/`DepthBook`/pane 方法，`getDataset()` 与 `getState().pano` 改为快照。**第 2 步多实例隔离已完成**：`withPalette()` 帧级色板作用域 + 实例 `ctx.palette`、`--sc-*` 变量下沉到 host（不再写 `:root`）、页面级事件改挂各自 `chart`、`trade-tape` 的 crosshair 监听改挂 `closest('stock-chart')`；两个 Shadow DOM 组件与竞价浮层的颜色快照改为 CSS 变量 / `color-mix`，深色主题因此完整覆盖头部控件、盘口、明细与信息栏。**残留硬编码已收口**：`SUBPLOT_INFO_H`、两处 `select{height:18px}`、`.pano-row{height:22px}` 与 `.split` margin 全部引用 `LAYOUT` / `--sc-row-h`；`defaultMA()` 与 `<ma-line>` 改按实例色板取色（页面不再写 `#F0A020` 等 hex），`price-pane` 的预调浅色改为 `softColor()` 按主题涨跌色与背景预混、`chip-pane` 位置线与竞价阶梯线改取 `PALETTE.*`，页面 CSS 的 61 处裸语义 hex 批量改为 `--up/--down/--text/--muted/--line/--panel/--sc-link` 与 `color-mix`（`var(...)` 内的兜底值保留）。**第三轮回归与类型契约已清掉**：`setTheme()` 末尾重算 `syncSideBars()`（避免切换主题把 4 条行打回基准 24px）并刷新 `MA_DEFAULT_KEYS` 记录的默认均线色；`showError()` 改用 `var(--sc-up)`；侧栏底部条 `hidden` 变化由 `MutationObserver` 自动触发重算，`syncSideBars()` 改用 `getClientRects()` 实测可见性，页面同时把 hidden 赋值提前，两种调用顺序都收敛。`dist/src/index.d.ts` 删除幽灵基类导出、`AuctionPane` 改回 `extends HTMLElement`、`overlayText()` 改对象数组、补齐 3 处事件 detail 与 `syncSideBars`/`refreshDefaultMAColors`/`theme` 声明。**第 3~6 步已完成**：发布收尾（`dist` 构建产物 + 元数据 + `files` 收窄 + `test`/`build`/`prepublishOnly` + 锁定 TypeScript 与 lock 文件）、WebGL context-restored 重建 program/VBO 并触发重绘、dataset 解绑（无 `dataset` 属性不 fetch，`loadDataset` 改 manifest 驱动，`setDataset` 支持部分分片注入并归一化）、`verify.mjs` 与 `npm test` 补真实行为/一致性断言。**仍待收口**：主入口 class 仍 `extends HTMLElement`（Node 侧只能用 `./pure`）、Vue 薄封装与 E2E/浏览器行为测试、中文文案与 A 股业务口径（交易时段、涨跌停比例）外置；`dataset` 属性仍绑死 `./src/data` 目录与 9 个 JSON 分片；中文文案与 A 股业务口径（交易时段、涨跌停比例）仍硬编码；组件间事件仍走 document 全局总线。Rust/WASM、Worker、列式 SoA、React/Vue 薄封装属 P1–P4，不计入当前可复用性判断（见下方「Rust / WASM 状态」）。

## 布局与显示规则

**三列两行网格**（由 `ChartContext.applyLayout()` 统一计算 rect）：

| 区域 | 位置 | 内容 |
|---|---|---|
| 集合竞价 | 左列 | **上段占满主图区高度**：灰底 + 黑色阶梯价格线（9:15–9:25 **每 9 秒 1 个撮合节点、共 69 点**，仅画阶梯线、不画节点圆点）+ 9:20 分界 + 09:30 竖线；**下段占副图区高度**：挂单量（未匹配量，红=买方堆积/绿=卖方堆积）**吸顶**——贴顶部基线向下画；成交量（匹配量，涨红/跌绿）**吸底**——贴底部基线向上画；中间留分隔空隙 |
| 主图 | 中列居上 | 分时图（价格线 + 均价线，价格轴以昨收上下对称）或 K 线（蜡烛 + MA5/MA20/MA60）；分时画到 `15:00` 收盘（含 14:58/14:59 价有量无与 15:00 统一撮合），15:01–15:30 盘后固定价段不画 |
| 尾盘竞价 | 中列右端（分时模式） | **14:57–15:00 收盘集合竞价**：上段灰底 + 黑色阶梯价格线（21 个 9 秒节点）、`14:57` 左分界 + 段内 `15:00` 刻度（`14:57` 由主图静态时间刻度标示）；下段挂单量吸顶 / 成交量吸底 + 纵轴刻度。**宽度按与开盘列相同的「每节点像素密度」换算**（`auctionW × 21/69 ≈ 46px`），采集点同为 9 秒/点，因此两段视觉比例一致。共用 `AuctionPoint` 契约与绘制函数，同一 `竞价` 开关控制 |
| 副图 | 中列居下 | **至少一个、可多个**：成交量 / 成交额 / MACD / KDJ / 量比，按 `height` 比例分配；分时模式右侧同样让给尾盘竞价段 |
| 筹码峰 | 右列 | **上段占满主图区高度**：150 档横向柱（与主图共享价格轴）；**下段占副图区高度**：DOM 统计面板（获利比例、平均成本、居中成本、90%/70% 成本区间与集中度），采用分区布局 —— 标题行加粗 + 右侧日期、获利比例红色大字 + 占比进度条、90%/70% 成本分布各成一组（区间 / 集中度两列右对齐 + 等宽数字）。**平均成本** = `Σ(价格档 × 筹码占比) / Σ占比`（`weightedAvgCost`，按 150 档直方图加权），与**居中成本**（`avgCost`，50% 分位中位数）是两个不同口径，面板分别展示；两者都逐日存于 `chips.stats`，随光标联动。**随 K 线光标按交易日联动**：`chipSnapshotAt()` 取该日的 `histograms` / `stats`（数据覆盖 120 日逐日快照），直方图按该日收盘价分色、标题与统计面板标注实际日期；**加权平均成本位置线**按同一价格轴绘制，与统计面板的「平均成本」同源联动；样式取中性深灰 `#5B6472` 细虚线（13px 步长），左端贴筹码柱起点 `r.x+4`、右端延伸到筹码峰画布边沿 `r.x+r.w`（不越出 rect，也不留右侧空白）。**直方图模式图上不放任何标签**（不再有「筹码峰 · 150 档 · 日期」标题条与「均成本」浮标），日期与数值统一由右侧 DOM 统计面板承载；hover 到窗口外更早的 K 线时回退到窗口内最近一日并标注该日期 |
| 十档盘口 | 右列（分时模式） | DOM 侧栏占满右列全高 |

- **操作区分组**：页面顶部「数据演示」条只放切换示例数据的控件（`盘口场景`、`盘口单位`），明确标注非真实行情功能；图表功能条集成在图表卡片内部顶部（与绘图区同一张卡片、共用边框圆角）。**功能按图分工、各自管理**：`分时` / `K线` 模式切换与 `副图数量` 两种模式共用；**分时专属** `多日` 分段控件与 `竞价` 开关（开盘+尾盘），**K 线专属** `周期` / `筹码峰` / `均线设置`（含均线面板），各自成组，切到相应图才整组展示，**不再把不适用的控件置灰**。`syncToggles()` 用 `hidden` 切换两组容器。**默认展示分时图**（`<stock-chart mode="intraday">`），`?mode=candle` 可切回 K 线。
- **显示规则**：集合竞价只在主图为分时图时出现；筹码峰只在主图为 K 线图时出现；十档盘口只在分时模式出现。竞价与筹码峰都**支持开启/关闭**（工具栏按钮，或 `setAuctionEnabled()` / `setChipsEnabled()`，或 `<stock-chart auction="off" chips="off">`）。关闭后对应列宽度归零，主图区自动扩展。
- **高度分配**：示例页画布 600px，主图占 50%（`mainH = height * 0.5`），副图区 50%；每个副图上方先扣 18px 信息栏，其余为绘图区，三个副图等分权重 `height="12"`（3 个副图时每个绘图区约 82px）。
- **副图数量**：`setSubplotCount(n)` 或工具栏「副图数量」；隐藏全部时强制保留第一个，保证至少一个。
- 竞价列与筹码峰上段都与主图共用 `ChartContext.priceScale`（`render()` 强制 price-pane 先计算），因此 9:25 撮合价与 9:30 分时价在同一价格高度衔接。
- 十档盘口 / 筹码统计是 DOM 侧栏，由 `updateSide(sideRect)` 定位并按 `content` 切换内容，不参与 WebGL 绘制。盘口**表头分两层**：主行是「盘口」标题 + `10档 ▾` / `量 ▾` 中性分段控件 + 右对齐「全景盘口 →」入口；下方列头行按与数据行相同的 `40px 1fr 1fr 1fr` 网格列出 `档位 / 价格 / 挂单量(额) / 笔数`，数值列右对齐，每行只显示纯数字、不再重复单位后缀。控件、列头、量能底色与行分隔线统一走 `--sc-*` 主题变量（量能底色用 `color-mix` 按主题涨跌色混合），浅色/深色都保持低饱和。**行高单一真源**：`src/types.ts` 导出 `LAYOUT = { rowH:18, barH:24, headH:24, titleH:24, splitH:5 }`（px；`headH/titleH` 为 `barH` 别名），盘口 5/10 档 / compact 数据行、盘口列头与标题行、交易明细虚拟滚动行与列头、页面「交易明细」标题行、多组逐笔覆盖视图的 `DETAIL_ROW_H` 全部引用它；组件通过 `--sc-row-h/--sc-head-h/--sc-title-h` 把数值下发给页面级 CSS。**盘口高度完全按内容自适应且 `overflow:hidden`**（无 `max-height` / `auto` 滚动），十档 20 行在窄、矮窗口也完整展示；展开态盘口固定为 `titleH + headH + 2×rowH + splitH = 89px`（卖1/买1 精确容纳），明细占满剩余，既无滚动也无异常留白。**4 条标题/表头行统一**：盘口主行、盘口列头、交易明细标题、交易明细列头全部用同一个 `--sc-bar-h`（基准 `LAYOUT.barH = 24`，原 28+20 两组各均分为 24+24，总高不变）。`stock-chart.syncSideBars()` 按侧栏实际高度统一分配：`R = H - (4×barH + 2×levels×rowH + splitH + 卡片边框 + 底部条)`，`rows = floor(R/rowH)` 给明细整数行，`rem = R - rows×rowH` **均分给这 4 条行**（`each = floor(rem/4)`），**除不尽的 `left` 全部给买1/卖1 之间的间隙**（`--sc-split-h = splitH + left`）。因此 4 条行等高、间隙吸收零头、明细视口恰好 `M×rowH`，既无半行也无底部留白；`trade-tape` 的 `.view` 直接用 `calc(100% - var(--sc-bar-h))`，不再由 JS 逐次算高度。展开态把「查看逐笔明细」底部条的固定 32px 计入 `R`。`verify.mjs` 有对应契约断言。
- **筹码峰背景**：筹码峰左右没有坐标刻度（价格刻度在主图右坐标栏），因此不使用 `paneBg()`（它会在两侧画浅灰坐标栏、网格只画中间，导致右侧突兀灰带且与下方统计区底色断裂）。改为纯白底 + 贯穿全宽的 5 行网格 + 左边界线，与下方白底统计面板连成一片。
- **光标数值**：鼠标划过图表时，图表卡片头部第二行显示光标处的时间与数值 —— **标签统一用简写**：K 线 `开/高/低/日量比/换/量/额`（收盘价与涨跌幅由第一行强调报价承担，明细不再重复；日量比=`VOL_RATIO` 对当前周期 K 线取前 5 根均量，换手按成交量 ÷ `floatShares`），分时 `高/低/均/量/额/换`（高/低取当日日 K 的 `high/low`，为全天最高最低、不随光标变化；均=均价，量=成交量，额=成交额，换=当日累计成交量 ÷ `floatShares`）；**第一行品牌区旁有强调报价**（当前价 20px 大字 + 涨跌额 + 涨跌幅，涨红跌绿），随光标实时联动；**每个副图**左上角同步显示该指标在光标处的值（VOL / AMOUNT / MACD 的 DIF·DEA·柱 / KDJ 的 K·D·J / 量比）。主图画竖线 + 价格水平虚线，各副图画竖线。`?crosshair=N` 可固定光标位置便于验证与分享。
- **竞价区 hover**：鼠标按 x 分三段互斥 —— 开盘竞价列用 `auctionHover`、尾盘竞价段用 `closingHover`、其余用主图 `crosshair`。三者都画竖线 + 价格水平虚线（交点不画圆点）、时间轴高亮当前时间；浮层显示 **虚拟撮合价 / 涨跌幅（开盘较昨收、尾盘较 14:57）/ 匹配量 / 未匹配量 / 挂单方向 / 可撤单或不可撤单时段**，图表卡片头部第二行同步显示时间与数值。**浮层为固定 232px 分区卡片**（`segmentOverlay()`）：标题行含名称/时间/可撤单状态胶囊，主价格区突出虚拟撮合价与涨跌色涨跌幅，指标区两列右对齐并用色点标注挂单方向（不再写「（红）」），固定宽度 + 等宽数字避免 hover 时跳动。分别派发 `auction-hover` / `closing-hover` 事件。
- **刻度**：两段竞价量区「成交量（吸底）」都在纵轴显示 `0 / 50% / 100%` 三档刻度（单位「手」）并画横向刻度线；分时图 **0 轴**（昨收）画明显虚线，右侧标注 `0轴 0.00% 昨收价`。
- **主副图分界与半小时网格**：`ChartContext.render()` 在 `y = mainH` 画一条贯穿全画布的分界线（**1px `PALETTE.grid` #ECEEF1**，与副图信息栏的 inset 分隔线完全同款；最后绘制，不被 pane 背景覆盖；竞价量区不再重复画上边沿以免叠加变粗，因此竞价段与分时段的时间轴下沿线统一）；分时模式 `halfHourMarks()` 给出 `09:30 / 10:00 / 10:30 / 11:00 / 11:30 / 13:00 / 13:30 / 14:00 / 14:30` 的 x，主图与所有副图共用同一组 x 画竖网格、上下对齐，主图底部标注时间（`11:30` 与 `13:00` 在分钟数据里紧邻，合并为 `11:30/13:00` 午休标注避免重叠）。**时间轴底带**：分时模式在 `[mainH-18, mainH]` 画一条贯穿竞价列 + 连续竞价 + 尾盘段的浅灰带（`#FAFBFC` + 上细线），主图与竞价阶梯线的价格轴 `bottom` 同步上移到 `mainH-26`，数据不进时间轴区域；两段时间刻度的底色因此完全一致（K 线模式无时间轴、绘图区不变）。
**时间轴统一规划**：竞价列 `9:15 / 9:20`、连续竞价半小时刻度、收盘 `15:00` 全部落在同一基线 `y = mainH - 16`；去掉竞价列 `9:25`（与 `9:30` 相邻会叠加）与尾盘段独立的 `15:00`（与右侧百分比刻度挤压），`9:30` 左对齐贴绘图区起点、`11:30/13:00` 长文本居中、`15:00` 右对齐贴绘图区右端，任意两个标签不重叠。K 线模式不画半小时竖线。竞价列内的 9:20 可撤单分界、竞价区右边界、尾盘段左边界与这些半小时竖网格统一为「宽度 1 + `PALETTE.grid`」（区域区分由灰底承担），避免颜色深浅不一看起来像粗细不同。
- 可用 `?mode=candle|intraday`（默认 `intraday`）、`?auction=off`、`?chips=off`、`?crosshair=N`、`?auction-hover=0..68`、`?closing-hover=0..20` 直接打开指定模式 / 开关 / 光标位置，便于分享与验证。

### 纵坐标轴刻度（专用留白栏）

为彻底避免刻度遮挡图表内容，中列每个 pane 左右各预留 `AXIS_GUTTER_L/R = 54px` 的**专用坐标栏**（浅灰、无网格、无数据）：

- `ChartContext.plotRect()` / `plotWidth()` 给出中间绘图区（分时再扣尾盘竞价段），K 线 / 分时线 / 均线 / 量柱 / 网格 / 十字线**只画在这里**；
- **分时模式的左坐标栏放在画布最左侧**（`x = 0..54`，由 `render()` 统一绘制），开盘竞价列整体右移 54px，中列 `leftInset() = 0` 不再内嵌左留白；主图与所有副图的左刻度都对齐到这条全局栏（`axisScaleText({ leftX: 6 })`），不会夹在竞价列与分时图中间。K 线模式仍是 pane 内嵌左栏；关闭竞价时全局左栏依然保留。
- `paneBg()` 只在绘图区画网格，左右坐标栏保持纯浅灰；坐标留白区不触发 crosshair；
- `axisScaleText()` 把刻度文字固定在坐标栏内，不再压在任何数据上；股票基本信息（两行）由 `PricePane.overlayText()` 通过 `head-change` 事件实时同步到图表卡片头部，主图不再绘制；副图标签仍从绘图区左边缘开始；
- 开盘竞价列右侧留 42px 量区坐标栏（数字刻度移入其中）；尾盘竞价段太窄，不显示标题与数字刻度。

刻度档位：主图 `count=5` → 6 档、副图 `count=3` → 4 档，与 `paneBg` 的网格线对齐。

| 区域 | 左侧 | 右侧 |
|---|---|---|
| 分时主图 | 价格 | 百分比（涨红跌绿）+ 中间 `0.00%` 昨收轴；左下角让给 `09:30` 时间刻度 |
| K 线主图 | 价格 | 价格 |
| 每个副图 | 数值 | 数值 |

副图刻度参考终端排版：`pickUnit()` 按纵轴上限**尽量选大单位**（千 / 万 / 亿），单位字单独沉在左右坐标栏最底部；刻度数字只显示缩放后的**纯数值**，并按长度动态调整小数位（整数 ≥4 位用 0 位、≥3 位用 1 位，其余 2 位 —— 如 `1062 / 708 / 354` 与 `40.60 / 30.45`），避免数值过长。`KDJ` 取整，无单位指标照常显示数值；标题行与 hover 量值用同一单位与小数位（如 `MA5 427万`）。

**排版**：左右刻度都贴着绘图区一侧对齐（左栏右对齐 `translateX(-100%)`、右栏左对齐），`white-space:nowrap` 不换行；字体统一 11px，**沉底单位与刻度数字完全同款**（同字号、同灰色、不加粗），只靠「沉底位置」区分，避免深色粗体在浅灰坐标栏里显得突兀。分时模式右侧刻度落在 `plotWidth()` 内，不侵入尾盘竞价段。

**分时成交量共用刻度**：分时第一个副图固定为 `VOL`（`setMode()` 强制、组件 API 对 index 0 锁定、工具栏下拉禁用，切回 K 线时恢复原配置）；开盘竞价列与尾盘竞价段的量区只占这第一个副图的高度，其下对应副图 2/3 的空间留白。`ChartContext.volumeScaleHi()` 取「分时可见分钟成交量」与「开盘竞价 9:25 量」的最大值作为共享上限，竞价量柱由「手」换算为「股」后按同一上限绘制，因此 `9:25` 竞价柱与 `09:30` 分时柱等高；竞价列不再单独标 `150手/75手/0`，直接共用最左侧全局坐标栏里第一个副图的刻度。尾盘 `15:00` 一次性撮合量级远大于分钟量，按本段相对量绘制、不纳入共享上限。

### 交易明细（分时右列 · 两级展开 · 时分秒）

- **时间列**：逐笔 `time` 为 `HH:MM:SS`，盘后个别 `HH:MM` 自动补 `:00`；时间列宽 62px 保证秒完整显示，与十字光标的联动仍按前 5 位 `HH:MM` 匹配。
- **默认侧栏**：图表右列 `sideSlot` flex 列，十档盘口按内容自适应（标题 + 列头 sticky）、明细占满剩余；标题右侧只有浅灰提示「点击展开」。侧栏小列表使用 `<trade-tape order="desc">` **按时间倒序（最新在前）**：`setData()` 保留 `_rawRows` 原始时间序，仅在 `order="desc"` 时反转显示数组，`trend` 等派生字段随行一起反转、涨跌口径不变；覆盖视图走 `setWindow(rows)` 仍保持正序时间线，不受影响。
- **一级展开（点击明细区域）**：`chart.setSideExpanded(true)` 让十档 `setCompact(true)` 只保留卖1 / 买1（标题变 `盘口 · 1档`），十档按自然高度收缩，明细占满剩余高度；底部出现「查看逐笔明细 →」文字链接触发点（与「全景盘口 →」同款弱化样式），提示变「点击收起」，再点区域收起。
- **二级（点击底部触发点）**：**不使用弹窗** —— 在 `stock-chart` 内铺一层 `position:absolute;inset:0` 的 `.detail-cover`（z-index 10）占满整个图表区；顶部栏显示总条数、当前时间窗口与「返回图表」。
- **连续时间线分栏（非同步滚动）**：按宽度算栏数（每栏约 270px、最多 6 栏），每栏可见行数 `L = floor(栏高/LAYOUT.rowH)`；全局窗口起点 `from` 由**唯一滚动条**驱动，栏 g 显示 `allTrades[from+g*L, from+(g+1)*L)` —— 前一栏末尾紧接后一栏开头，中间栏数据始终连贯，滚动只推动第一栏开头与最后栏结尾。`trade-tape.setWindow(rows)` 关闭自身滚动条、只替换数据重绘；组标题显示该栏当前时间范围。滚动条范围 `maxFrom = total - N*L`（滚动条视觉隐藏，仅用滚轮/触摸板推动时间线），`ResizeObserver` 在栏数或 `L` 变化时重算并保留 `from`。`?tape-scroll=N` 可直接定位到指定像素对应的时间窗口。K 线模式或点击「返回图表」关闭覆盖层，回到一级展开态。
- **K 线模式**：交易明细完全不展示，卡片移回 `hidden` 寄主并复位十档展开状态；切换由 `placeTape(mode)` 在 `syncToggles()` 完成（移动同一个 DOM 节点）。
- 表格四列 **时间 / 价格 / 成交量 / 方向**（紧凑列宽 `62px 1fr 1fr 30px`、11px 字号）；`ResizeObserver` 按宿主尺寸重建虚拟滚动视口并保留滚动位置。`?tape-side=1` 直接进入一级展开，`?tape-zoom=1` 直接打开多组逐笔视图（均仅分时模式生效）。
- **逐笔涨跌着色**：`bindDataset()` 以相邻两笔成交价比较（首行对 `preClose`，容差 `1e-6`）算出 `trend`（涨 1 / 跌 -1 / 平 0），整行时间、价格、成交量文字与方向标签按 A 股习惯**涨红跌绿**、平盘中性灰着色，价格列加粗；隔行极淡底与十字光标选中高亮保留。
- **侧栏视觉统一**：`sideSlot` 用 1px `#E3E6EB` 左边界 + 轻微阴影与图表分区；十档与明细标题条统一 `#F7F8FA` 底 + 深色细线，表头白底细线；明细行去掉逐行硬边框，改隔行极淡底（`#FAFBFC`）+ hover 高亮，方向 B/S/N 用浅红 / 浅绿 / 浅灰圆角标签；底部「查看逐笔明细」做成圆角按钮。1 档收缩态用细分隔线代替整行「买卖分界」文字，十档固定 66px。
- **全部挂单（Level-2）**：由覆盖层顶部「逐笔明细 / 全部挂单 / 全景盘口」切换进入（十档盘口标题条右侧的入口已改为「全景盘口 ›」），与逐笔明细共用连续时间线多栏视图。挂单模式为 5 列 `时间 / 委托价 / 数量 / 剩余 / 类型`（`trade-tape.setViewConfig()` 可配列模板与额外列），标签 `B / S / BF / SF / BC / SC`（买 / 卖 / 买成交 / 卖成交 / 买撤 / 卖撤），成交标签加细边框区分，撤单按方向红系/绿系着色。`?tape-zoom=1&tape-set=orders` 可直接打开挂单视图。数据契约见 `manifest.json → files.orders`，生成脚本 `scripts/build-order-book.mjs`。
- **委托生命周期（真实口径）**：一张委托 `NEW` 入簿后，`FILL` 按成交量扣减剩余在挂量，`CANCEL` 撤的是**当时的剩余量**而非原委托量（例如委托 2000 手 → 成交 1200 手 → 撤单 800 手）。事件带 `origOrdId / origVolume / remainVolume / tradeId`，`volume` 语义随事件变化；合并分笔 `trades` 新增 `ordIds`（该分钟内参与成交的委托号）形成可追溯关联。委托簿回放按剩余量聚合，`verify.mjs` 校验 `NEW − ΣFILL − ΣCANCEL = 剩余` 守恒。
- **全景盘口（与「全部挂单」平行的第三个视角）**：真实 Level-2 里全景盘口不是独立数据，而是行情商用**逐笔委托消息重建完整委托簿（order book）**后按价格聚合的当前状态；本例严格由「全部挂单」事件流回放得到（撤单按 `cancelOf` 出簿、被市价穿越才成交离场，**未撤单的远档会一直留存**），因此买单覆盖现价 → 跌停 1269.24、卖单覆盖现价 → 涨停 1551.30，并含涨跌停边界埋伏单。视图分左右两块（左买单降序红系 / 右卖单升序绿系），每块 `档位 / 委托价 / 挂单量 / 笔数`，带挂单量占比色条、前十档加粗、边界档高亮、中间价浮标与价格区间摘要，档位多时各自滚动（滚动条隐藏）。数据契约 `manifest.json → files.depthFull`，前十档与十档快照闭合。`?tape-zoom=1&tape-set=panorama` 可直接打开，十档盘口标题条右侧的「全景盘口 ›」入口也直接跳转到本视图；「全部挂单」时间线视图保持原样。
- **全景盘口实时统计**：两侧统计条不写死在数据里，而是渲染时按当前 `bids/asks` 实时累加 —— 卖单「拉至涨停」与买单「砸至跌停」分别给出 `Σvolume` 成交量、`Σ(price×volume)` 消耗金额、`ΣorderCount` 委托笔数及到涨跌停的涨跌幅。现价改为独立居中条（`pano-mid`），顶部栏统计也居中，不再有浮标遮挡内容。
- **盘口量 / 金额切换**：页面顶部「数据演示」条的「盘口单位」下拉、十档盘口标题条的单位按钮、`?depth-unit=amount` 三处共用全局 `depthUnit` 状态，十档盘口与全景盘口同步切换第 3 列显示口径。金额按 `委托价 × 挂单量` 实时计算，表头在「挂单量 / 挂单额」间切换，量柱也按当前口径归一化；全景盘口顶部统计标注当前显示口径。**两种口径都按数值大小自适应换算 `万 / 亿` 短格式**（小数位随量级收敛，避免大数值撑爆窄列）：量为 `股 / 万股 / 亿股`、金额为 `元 / 万元 / 亿元`，`hover` 单元格可看精确股数与元值，表头 `title` 标明当前单位口径；统计条仍给出完整单位的汇总值。分时主图右侧量柱仍按挂单量绘制。
- **分时主图右侧挂单量柱**：`price-pane` 在分时模式读取 `dataset.depthFull`，把各价位挂单量按主图 `priceScale` 的 y 轴分 64 个桶聚合，从绘图区右边缘向左画细横柱（买浅红 `#F3CFCF` / 卖浅绿 `#CFEBDD`，渲染器未启用 alpha 混合故用预调浅色，`sqrt` 归一化让小档位也可见），与价格刻度天然对齐、只占右侧约 20% 宽度且画在曲线之下；仅分时模式显示。
- **五档 / 十档与涨跌停场景**：`depth-book` 支持 `levels` 属性（`5` / `10`），标题条的档位标签可点击切换，五档时行高自动加大以均衡留白；缺档渲染为淡灰 `—` 占位。工具栏「盘口场景」下拉（或 `?depth-scenario=limitUp|limitDown`）可在普通 / 涨停 / 跌停间切换：涨停时卖盘区显示「涨停 xxxx · 无卖盘」提示条、买1 封单行高亮，跌停反之；切换会同步十档盘口、全景盘口与分时主图右侧量柱三处数据。`?depth-levels=5` 可直接进入五档。

### 每个副图上方的信息栏与切换下拉

参考终端：**每个副图上方预留 18px 独立信息栏**（`applyLayout()` 中副图绘图区整体下移），栏内左侧是切换指标的下拉框（**承担指标名，右侧不再重复**），右侧只显示参数与数值（如 `MA5 323.68万 MA10 473.65万 量 417.80万`、`(12,26,9) MACD -2.019 DIFF 35.460 DEA 36.470`）。信息栏用浅灰底 `#FAFBFC` 与白底绘图区分层，下拉去掉浏览器默认蓝色焦点框、禁用项淡灰显示、间距与基线统一。**画布内不再渲染这些文本**，`indicator-pane.overlayText()` 只返回左右坐标刻度；下拉与数值是常驻 DOM（`#pane-bars`），不随每帧重绘打断交互，仅在 `layout-change` / `subplot-config-change` 时重建、在 `crosshair-change` / `viewport-change` 时只更新数值。

- 组件 API：`getSubplotLayout()` 返回 `[{ x, y, w, h, index, indicator }]`（信息栏位置）；`getSubplotConfig()` 返回 `[{ index, indicator, height, hidden }]`；`setSubplotIndicator(index, name)` 单独切换；`setSubplotCount(n)` 调整数量。配置变化派发 `subplot-config-change`，布局变化派发 `layout-change`。
- `SUBPLOT_INDICATORS` 由 `stock-chart.js` 导出供 UI 复用，非法指标名忽略；**第一个副图恒为成交量**（K 线 / 分时都锁定，`setSubplotIndicator(0, 非VOL)` 被忽略，`?panes=` 也改不动），其下拉禁用。分时模式下它同时与竞价列共用成交量刻度。
- `?panes=KDJ,VOL,MACD` 可一次性配置所有副图（数量随列表长度，最多 3 个），便于验证与分享。
- 竞价列 / 尾盘段的下半部与第一个副图的**整个槽位**等高（`y = mainH`，高度 = 18px 信息栏 + 绘图区），铺灰底并画出上下边沿，与副图上下边沿严格对齐；顶部 18px（对应信息栏）留白不画量柱，量柱与网格只在绘图区高度内绘制，继续共用成交量刻度；第二个及之后的副图高度处仍留白。**零值基线**：竞价量区 `botBase` 与副图柱底统一为 `volRect 底 - 8`（副图 `bottom = 副图 rect 底 - 8`，两者 rect 底相同），并在副图 `bottom` 处画一条 0 值基线，底端对齐可见。

### 标题样式统一

除副图信息栏外，全页标题统一为与信息栏一致的**浅灰轻量条**（`#FAFBFC` 底 + `1px #ECEEF1` 分隔线、11px 灰色细体、不加粗），指标名只出现一次、不在正文重复：

- **图表卡片头部**（DOM）：两行左右分布、视觉平衡。**第一行左侧是强调的股票标识**（`manifest.name` 加粗 16px + `symbol` 12px）+ **强调报价**（当前价 / 涨跌额 / 涨跌幅，固定宽度槽位 + 等宽数字、涨红跌绿，随光标联动），右侧是图表功能控件（无「图表功能」文字）；**第二行左侧**为模式 · 日期时间 · **带均线颜色的 MA 实时值**（`MA5/MA20/MA60`，hover 读光标处/无光标取最后一根，标签与数值都用该均线的 `color`，数值固定 52px 槽位），**右侧**为**四色涨跌停图例**（仅日 K，已从主图左上移到此处，与指标行竖线分隔）+ 固定槽位指标，两行间有细分隔线。**日期时间只出现一次**且占固定 104px 槽位（等宽数字、溢出省略并带 `title`），不会推动后面的 MA 参数；指标拆成固定槽位且标签简写（分时 `价/均/量比/量/额/换`、K 线 `开/高/低/量比/换/量/额`、竞价 `虚拟撮合价/匹配量/未匹配量`），数值 `width:58px` 右对齐 + `tabular-nums` 等宽数字；MA 区、图例、指标区间距收紧，保证 K 线七项与四色图例同排时仍有呼吸空间。所有结构仅在标签序列变化时重建、同一场景只更新数值，避免 hover 时整行位移。`head-change` 事件派发 `name/symbol/modeLabel/datetime/maValues/legend/metrics/note/active` 结构化字段；均线设置面板相对控件行展开。
- **图内**（canvas overlay）：竞价列「集合竞价」通过 `bg: true` 的 span 渲染浅灰条；筹码峰直方图区不再放标题条与数值浮标（信息都在右侧 DOM 统计面板）；坐标刻度仍是纯文字。
- **DOM 侧栏**：十档盘口标题与「买卖分界」条、筹码统计 head、交易明细列标题与说明条、信息卡片 `h2` 全部同款。
- 文字保持在各自原区域，**不改变图表布局与高度分配**。
- 副图信息栏的下拉**无边框**：`appearance:none` + `18px` 高 / `16px` 行盒（`line-height:16px`、垂直 padding 归零）精确居中，渐变自绘箭头，仅 hover / focus 给淡底反馈，禁用态用浅灰块区分。信息栏的分隔线改用 `box-shadow:inset 0 1px 0`（不占高度），避免 `overflow:hidden` 把 18px 下拉裁掉一条边。整行（下拉与数值文本）统一 16px 行高。

### K 线多周期

工具栏「周期」下拉与 `?period=` 支持 **11 个周期**，按分钟→日→周月年排序：`1 分钟 / 5 分钟 / 15 分钟 / 30 分钟 / 60 分钟 / 120 分钟 / 日 K / 周 K / 月 K / 季 K / 年 K`（键 `1m/5m/15m/30m/60m/120m/1d/1w/1M/1Q/1Y`，分时模式禁用）。`DEFAULT_PERIOD = '1d'`，组件 `ChartContext.period` 与页面下拉都**显式默认日 K**（列表首项是 1 分钟，不能依赖浏览器默认选中第一项）；未知周期由 `periodMeta()` 回退到日 K。分钟周期按上午 9:30–11:30 / 下午 13:00–15:00 两段独立分桶，实测根数 `1m 238 / 5m 48 / 15m 16 / 30m 8 / 60m 4 / 120m 2`，日/周/月/季/年 `935/198/47/16/4`。

- 聚合器 `src/core/bar-aggregator.ts`：日 K 按 ISO 周 / 月 / 季 / 年分组，OHLC 取组内首开、末收、最高、最低，量额与换手率求和，涨跌幅/振幅按首根 `preClose` 重算；分钟级把当日分时点按序号每 5/30/60/120 个聚合成一根（open/close 取首末价、high/low 取区间极值、量额求和）。输出与 `bars_1d.json` 同字段，额外带 `label` 供时间轴与明细显示。
- `ChartContext.period` + `getBars()`（按周期缓存）是 K 线数据的单一入口：`getSeries()`、MA / MACD / KDJ / 量比 / 成交量额指标与副图信息栏数值全部走它；切换周期会清空光标、按 `min(120, n)` 重置视口，少量 K 线时蜡烛/量柱宽度上限 24px。
- 两种模式统一使用底部 18px 时间轴带：K 线按可见区间等分显示 6 个当前周期标签，分时显示半小时刻度；主图价格轴让出同样高度。
- **指标参数**：MA 仍按当前周期根数自适应（`adaptiveMAPeriods`，避免短周期全为 null）；**MACD 固定为通达信默认 `(12,26,9)`**，可通过 `chart.setMACDParams()` / `macd` 属性 / `?macd=` 配置，短周期预热不足时按软件语义留空（信息栏显示 `—`）。主图标题、hover 明细、副图信息栏同步显示实际参数。
- **涨跌停样式只属于日 K**：`limitState`（涨停 / 跌停 / 涨停炸板 / 跌停炸板）是日线级别状态，聚合到周 / 月 / 季 / 年或分钟周期时不继承（`mergeBars` 输出空值），主图四色图例只在 `period === '1d'` 显示；其他周期蜡烛一律按普通红涨绿跌渲染、不加粗，hover 明细也不带状态标签。
- **数据边界**：示例只含 935 根日 K + 当日 267 个分时点，分钟级周期仅有当日约 48 / 8 / 4 / 2 根，历史深度有限；周 / 月 / 季 / 年分别约 187 / 45 / 15 / 4 根。

### 多日分时

- 数据契约：`manifest.files.intradayMulti = 'intraday_5d.json'`，文件是**扁平数组、每点带 `tradeDate`**，5 个交易日 × 242 点（末日取真实分时并截到 15:00，前 4 日按当日日 K 的 OHLC 以固定种子确定性拟真生成）。`manifest.tradeDates` / `preCloseByDate` 提供各日昨收。单日 `files.intraday` 保持不变，兼容原有 267 点数据。
- 组件 API：`chart.setIntradayDays(1..5)` / `getIntradayDays()`、HTML 属性 `intraday-days="3"`、事件 `intraday-days-change`。**界面入口**是图表工具栏「多日」后面的一组 tab 式分段按钮 `1 日 / 2 日 / 3 日 / 4 日 / 5 日`（点击即时切换、当前天数高亮），比下拉更直观；也支持 `?intraday-days=3`。默认 1 日，主图标题在多日时显示「多日分时 · N 日」。
- 渲染：`getSeries()` 逐点过滤盘后点（不能用 `findIndex` 截断，否则第一天盘后点会丢掉后续交易日）；`halfHourMarks()` 按 `tradeDate` 分日生成刻度并标记 `dayStart`，多日时时间轴只标日期（MM/DD）、画日界竖线，价格线与均价线在日界处**断开**，不画跨日垂直连线。价格轴与涨跌幅统一以**首日昨收**为基准；头部的日期与「高/低」按光标所在交易日取值。
- **多日场景隐藏竞价**：`ChartContext.isMultiDay` 为真时清空 `openAuction` / `closeAuction`，`applyLayout()` 不再分配竞价列（`auctionOn = ... && !isMultiDay`），`closingW = 0` 让主图铺满；几何、hover、浮层因 rect 为 `null` 自动跳过。页面上竞价开关**不直接隐藏**，而是置为禁用并显示「多日不展示竞价」，让用户知道竞价为何消失；切回 1 日完整恢复。
- 分时量比曲线按 `tradeDate` 在日界处把累计成交量归零，每个交易日各自从 09:30 起算。

### 十字光标坐标轴定位（以鼠标为中心）

`mousemove` 同时记录 `crosshair`（吸附到数据索引）与 `pointer = {x, y}`（精确像素位置）。鼠标划过时：

- **水平十字虚线画在 `pointer.y`**（不再吸附到数据点价格），竖线仍吸附数据索引；鼠标所在的副图也画同一条水平虚线。
- **主图**：左坐标栏显示鼠标 y 反算的价格（`PricePane.axisValueAt()`，按 `priceScale` 与 `makeScale` 的 pad 反算），分时额外在右坐标栏显示涨跌幅（红涨绿跌）；标签垂直居中于鼠标高度，深色高亮块覆盖静态刻度。
- **副图**：鼠标所在副图的左坐标栏显示该指标在鼠标 y 处的值（`IndicatorPane.axisValueAt()`，按 `axis {lo,hi,top,bottom,pad}` 反算，复用刻度的缩放单位）；不在鼠标所在 pane 时不显示 y 标签，避免 clamp 到轴底反算出超范围数值。
- **时间轴**：底部标签水平位置跟随 `pointer.x`，内容取 `crosshair` 对应的时间（分时 `HH:MM`）或日期（K 线 `YYYY-MM-DD`）。
- 鼠标离开时 `pointer` 与 `crosshair` 一起清空。`?pointer=X,Y` 可固定鼠标像素位置便于验证/分享（与 `?crosshair=N` 搭配）。

### K 线均线配置（可添加 / 设置）

均线不再硬编码为 MA5 / MA20，改由 `ChartContext.maConfig` 单一真源驱动，最多 8 条，每条 `{ period, color }`。

**声明式**：在 `<price-pane>` 内放 `<ma-line>` 配置节点（不产生可见 DOM），组件启动时读取：

```html
<price-pane height="50">
  <ma-line period="5" color="#F0A020"></ma-line>
  <ma-line period="20" color="#4A90D9"></ma-line>
  <ma-line period="60" color="#7C5CDB"></ma-line>
  <ma-line period="60" color="#7C5CDB"></ma-line>
</price-pane>
```

**运行时 API**（`<stock-chart>` 实例上）：`getMovingAverages()` / `setMovingAverages(list)` / `addMovingAverage(cfg)` / `removeMovingAverage(period)` / `updateMovingAverage(period, patch)`；配置变化时派发 `ma-config-change` 事件（`detail.list`）。

**工具栏**：「均线设置」面板支持增删、改周期（数字输入）、改颜色（取色器）；`?ma=5,10,60` 可直接覆盖配置、`?ma-panel=1` 直接展开面板，便于验证与分享。

- `period` 规整为正整数、周期重复自动顺延，颜色非法回退到默认橙；价格轴范围会纳入所有可见均线值，避免长周期均线被裁掉；K 线 hover 明细追加前 4 条均线值。
- **量额副图量均线**：K 线模式的 `VOL` / `AMOUNT` 副图额外叠加 **MA5（橙）/ MA10（蓝）**，对 `volume` / `amount` 序列计算（`computeIndicator('MA', bars, { n, field })`，`ma()` 现支持任意字段），y 轴范围纳入均线值；无光标时标签显示 `MA5/MA10`，hover 时显示两条均线的当前值。分时模式使用分钟增量口径，不画日线量均线。

### K 线涨跌停 / 炸板四色区分

`Bar.limitState` 标注四种特殊状态，蜡烛按状态着色（不适用普通红涨绿跌），并略微加宽以便识别：

| 状态 | 颜色 | 判定（按代码/名称识别比例，本例沪市主板 10%；涨跌停价四舍五入到分，容差固定 0.011 元） |
|---|---|---|
| `limitUp` 涨停 | 深红 `#C62828` | 收盘价 = 涨停价 |
| `limitDown` 跌停 | 深绿 `#087A55` | 收盘价 = 跌停价 |
| `limitUpBroken` 涨停炸板 | 橙 `#F08C24` | 最高价触及涨停价，但收盘未封住 |
| `limitDownBroken` 跌停炸板 | 紫 `#7C5CDB` | 最低价触及跌停价，但收盘未封死 |

真实 935 根日 K 里涨停仅 1 根、跌停与跌停炸板为 0，因此生成脚本在中段 4 个交易日**拟真注入**各 1 根样本（仅调整这 4 根 OHLC 及派生字段，并同步其后一根 `preClose` 链条），保证四种配色在图上均可见；`verify.mjs` 校验四态齐备、形态自洽与链条闭合。四色配色图例已移至图表卡片头部第二行右侧，卡片头部的 hover 明细会追加 `【涨停】` 等状态标签。

### 集合竞价的数据粒度：交易所 3 秒 vs 终端 9 秒

| 口径 | 粒度 | 说明 |
|---|---|---|
| 交易所官方行情 | **3 秒** | 《上海证券交易所 LDDS 系统竞价 Level-2 行情接口说明书》（v2.0.11）：快照分「变化全量 **3 秒**（数据无变化顺延）」与「周期全量 30 秒」；竞价快照 `UA3202` 自 8:45 发布。9:15–9:25 状态 `OCALL` 时，申买/申卖价一 = **虚拟参考价**，量一 = **虚拟匹配量**，申买量二/申卖量二 = **买方/卖方虚拟未匹配量**。10 分钟 = 201 个快照点 |
| 同花顺等终端竞价图 | **9 秒** | 竞价图时间刻度与白点（一次撮合匹配价格）**每 9 秒一个**；每 5 分钟 = 33 个 9 秒间隔（297 秒）+ 1 个 3 秒间隔对齐整点：`9:19:57→9:20:00`、`9:24:57→9:25:00`。全程约 **69 个节点**。人气冷清时可能隔几个 9 秒才有一次撮合，白点更稀疏 |

**本组件采用终端口径（9 秒 / 69 点）**，因为目标是复刻同花顺那张参考图。`auction_20261113.json` 的 `time` 精确到秒（`HH:mm:ss`），相邻 `timestamp` 大多 9000ms，两处特殊 3000ms；`verify.mjs` 会校验点数、间隔与四个特殊时间点。渲染上**只画阶梯价格线，不画节点圆点**（hover 交点也不画），靠竖线、水平虚线与浮层数值定位。

补充：免费 Level-1 通常只揭示虚拟参考价，匹配量/未匹配量属 L2；`UA5803` 竞价逐笔合并是逐笔级（09:15–15:35），比快照更细，某些终端更密的白点可能来自它。

### 为什么用「拟真 mock」而不是抓取真实竞价数据

**能抓到什么**：9:15–9:25 的虚拟撮合快照（虚拟参考价 / 虚拟匹配量 / 买卖虚拟未匹配量）属于交易所 Level-2 行情。公开资料与实测一致：AkShare（9:15 抛 `ValueError`）、Tushare（价格字段空到 9:30）、Baostock（无实时路径）、聚宽 / 米筐（分钟线从 9:30 起）、券商 Level-1 封装（虚拟字段被过滤）在竞价窗口都没有完整数据；机构 L2 有但需权限。**当日**可通过 AKShare MCP `get_stock_auction_tool`（9:15–9:25 虚拟撮合过程，仅当日可拉，首次查询落盘 CSV 归档）或通达信协议 `get_call_auction`（`0x056a` 当前交易日竞价明细）获取后自行归档，历史日期只能读自己的归档。本项目使用固定历史交易日 `2026-11-13`，无法回溯当时快照。

**能拿到的真实部分**：9:25 统一撮合结果（开盘价、竞价成交量 / 额）存在于公开日 K、1 分钟 K 首根、逐笔明细；本项目分时 `09:30` 首点的 `volume / amount` 即 9:25 竞价成交量额。

**因此采取「锚定真实 + 拟真生成」**（`scripts/build-sample-data.mjs` 的 `buildAuction()`）：

- 真实锚点：昨收 `1410.27`、9:25 开盘价 `1404.00`、竞价成交量 `15000 股 / 21060000 元 = 150 手`；末点与之精确闭合，`verify.mjs` 会校验。
- 拟真行为：价格只在少数节点跳变形成**长水平段**（而非逐点锯齿）——9:15 虚假买单托高 → 9:19:57 集中撤单跳水 → 9:20 后不可撤单缓慢收敛 → 9:25 落到真实开盘价；虚拟匹配量单调不减且后期加速；未匹配量撤单后跳降并衰减到 0；可撤单期买方堆积（红）为主、之后转卖方堆积（绿）；仅 9:25 产生成交量，其余「价有量无」。
- 若将来要换真实数据：在交易当日跑一次带归档的采集脚本，按 `AuctionPoint` 契约落盘替换 `auction_*.json` 即可，组件与渲染层不用改。

### 尾盘竞价（14:57–15:00 收盘集合竞价）

上交所自 **2018-08-20** 起对股票实施 3 分钟收盘集合竞价：14:57–15:00 可申报、不可撤单，「行情揭示同开盘集合竞价」（同样揭示虚拟参考价 / 虚拟匹配量 / 买卖虚拟未匹配量）。因此 600519.SH 分时图右端需要单独画这一段，与开盘竞价对称。

- 真实分时数据里能看到这个特征：`14:58 / 14:59` 成交量为 0（价有量无），`15:00` 一次性放出 `177300 股 / 254471605.07 元` 并把收盘价定在 `1435.26`。
- 数据同样锚定真实并拟真：21 个 9 秒节点（14:57:00–15:00:00），起始价 = `14:57` 连续竞价末价 `1434.52`，末点 = 真实收盘价 / 量 / 额（1773 手）；不可撤单期虚拟匹配量单调不减、未匹配量逐步被吸收到 0、买方堆积（红）为主。`verify.mjs` 会校验这些闭合关系。
- 时间轴处理：`ChartContext.getSeries()` 在分时模式返回到 `15:00` 的分钟数据（14:58/14:59 量为 0、15:00 为收盘统一撮合量），15:01–15:30 盘后固定价段排除；`plotWidth()` 让主图与副图自动让出右端宽度，分时线不会压到灰底区上。尾盘竞价列作为 9 秒级放大视图并列保留，与分钟级主图不冲突。
- **比例对齐**：生成脚本用统一常量 `AUCTION_STEP_SEC = 9` 生成两段节点（开盘 600 秒 → 69 点，尾盘 180 秒 → 21 点，密度一致）；`ChartContext.applyLayout()` 用 `auctionW × closeAuction.length / openAuction.length` 换算尾盘段宽度（150 × 21/69 ≈ 46px），不再用主图固定百分比。`verify.mjs` 会校验两段密度比。窄段下标题收紧为「尾盘竞价」、只标 `15:00`（`14:57` 由主图静态刻度标示）、纵轴刻度靠左避免溢出；主图右侧 ±% 刻度与静态时间刻度都按 `plotWidth()` 排布，避开尾盘段。

## 架构要点

- **单 canvas + 单 WebGL2 context**，各 pane 用 `gl.scissor` 分区；Rust/WASM 只负责计算，不碰 DOM 和 GL 提交。
- **`ChartContext` 单一真源**：viewport、priceScale、crosshair、色板都存于根容器；多副图共享 x 轴、筹码峰共享价格 y 轴天然对齐。
- **粗线三角形化**：WebGL 的 `gl.lineWidth` 多数实现只有 1px，均线/影线由 `geometry.js` 在 CPU 侧扩展成三角形带。
- **文字用 DOM overlay**：刻度、图例、tooltip 不进 WebGL，保证 DPR 与缩放下的清晰度。
- **按需渲染**：无变化不跑常驻 rAF loop，`requestRender()` 置脏后合帧提交。

## Rust / WASM 状态

计算层已抽象为 `ComputeEngine`（`src/compute/engine.ts`），当前为 `JsComputeEngine`。
本机只有 `stable rustc 1.69 + wasm-pack 0.11.1`，**没有 nightly / rust-src**，无法按 `wasm-bindgen-rayon` 要求用 `build-std + atomics` 编译线程版 WASM。
工具链就绪后只需实现 `WasmComputeEngine.indicator()` 同名方法，组件层无需改动。双构建与特性检测的部署配置见 `docs/03-组件架构与Rust性能方案设计.md` §6.3。

## 后续

P1：分时模式副图口径统一、Worker + 列式二进制、双构建特性检测；
P2/P3：L2 双来源适配、资金流副图；（筹码峰历史回放已实现，见「三列两行网格」表格）
P4：Rust/WASM 接入、多线程压测与降级路径验证。

**MACD 参数**：固定默认通达信/同花顺 `(12,26,9)`，不随 K 线根数分档；旧兼容包装 `adaptiveMACDParams()` 已于 2026-11-19 P2 移除，统一用 `resolveMACDParams()` / `parseMACDParams()`。参数支持三层配置：纯函数层 `resolveMACDParams({fast,slow,signal})` / `parseMACDParams('12,26,9')`（非法值回退默认）；组件层 `chart.setMACDParams(obj|string)` / `getMACDParams()`、HTML 属性 `macd="12,26,9"`、事件 `macd-params-change`；示例页 `?macd=12,26,9`。短历史序列预热不足时 MACD 按通达信语义留空（信息栏显示 `—`），需要显示可显式配更小参数。`ChartContext.macdParams` 是唯一真源，副图与信息栏都从它读取。

**算法口径（2026-11-19 核验并修复 P0）**：`EMA` 采用通达信/同花顺口径（前 N 个值取简单平均作首个 EMA，前 N−1 根为 `null`），`MACD` 的 DEA 只在 DIF 有效段上递推、柱仍为 `2×(DIF−DEA)`；`KDJ` 与通达信 `SMA(X,3,1)` 递推一致。量比拆成两套：日线 `volumeRatio()` = 当日量 ÷ 前 5 日平均日量（K 线面板标注「日量比」），分时 `intradayVolumeRatio()` = (当日累计量 ÷ 当日累计开市分钟) ÷ (前 5 日平均日量 ÷ 240)，按上午 9:30–11:30 / 下午 13:00–15:00 共 240 分钟并扣午休。分钟 K 由 `intradayBucket()` 按交易时段边界分桶，11:30 / 15:00 收盘点归入所在时段最后一根，不再跨午休成根。`scripts/tests/algorithm-regression.test.mjs` 用独立基准双实现逐根比对（EMA/MACD/KDJ/量比/分钟 K），详见 `docs/algorithm-audit.html`。**P1 已完成（2026-11-19）**：筹码三角分布峰值改当日成交均价（成交额/成交量，一字板回退四价均价），分布形状 / 历史换手衰减系数 / 分桶精度 / 回看天数可通过 `npm run data -- --chips-shape=uniform --chips-decay=2 --chips-bins=200` 配置；UI「平均成本」对齐软件面板的 `COST(50)`、加权平均另列、集中度标注「面板口径」（`(高−低)/(高+低)`，非通达信 SCR 的再除 2 版本）。涨跌停比例由代码/名称识别板块（主板 10% / 创业科创 20% / 主板 ST 5% / 北交所 30%），涨跌停价四舍五入到分、判定容差固定 0.011 元，清除了 0.5% 相对容差的误标。集合竞价虚拟价 / 匹配量 / 未匹配量 / 方向改由 `scripts/auction-match.mjs` 按上交所《交易规则》3.5.2 三原则撮合生成，末点仍与真实开盘/收盘价及成交量闭合。`scripts/verify.mjs` 的涨跌停校验改用 manifest 比例 + 独立容差，并加入 MACD/KDJ/量比的预置期望值断言，替换循环论证；新增 `scripts/tests/p1-algorithm.test.mjs`（撮合三原则、板块比例、筹码口径）。

**架构与数据契约规范化（2026-11-19 全量审计）**：详见 `docs/architecture-audit.html`。本轮落地四组修复 —— ① 出入参契约：修正 `index.d.ts` 14 处类型不符、移除无行为属性、补 `period` / `chip-mode` 属性与 React 的 `macd` / `intradayDays` 映射、补参数防御与只读返回值（`setMovingAverages()` 返回拷贝 / `rgba` 冻结缓存）、`data-store` 缺失分片真正跳过；② 数据可获得性：`manifest.provenance` 覆盖 10 个数据集并标注 Level-2 授权边界，数据体补 `source` / `license` / `requiresAuthorization` / `priceBasis`，UI 增加「示意撮合」「前 N 日为拟真数据」提示，`SOURCES.md` 覆盖 orders/depthFull/depthScenarios；③ 模块化：新增 `src/core/market-constants.ts` 作为 A 股业务常量单一真源（0.01 / ×100 / 240 分钟 / 时段 / 半小时刻度），涨跌停 0.9/1.1 硬编码改按 `manifest.limitRate` 计算；④ 工程链：`npm run data` 两步生成、`typecheck` 纳入 `react.d.ts`、新增 `scripts/tests/contract-runtime.test.mjs`（运行时契约回归）。`npm test` 45/45 全过。**P0 两项随后完成（2026-11-19）**：① `getContext()` 改为返回 `ChartContext.readonlyFacade()` 只读门面（`Object.freeze` + Proxy set/delete 陷阱、状态 getter 浅拷贝、不暴露内部方法），`index.d.ts` 新增精确的 `ChartContextFacade` 接口；② 组件层 9 处绕过 setter 的直接写全部收口到 ChartContext 的受控 setter `configure()` / `setPalette()` / `setPriceScale()` / `setDepthFull()` / `setViewport()`，静态核查组件层直接写 ctx 为 0 处，并修正初始 mode 在 `layout()` 之后才设置的时序。新增 `scripts/tests/p0-controlled-state.test.mjs`（7 个测试），`npm test` **52/52**，6 场景截图像素级无视觉回归。**P1 四组 + P2 两组随后一次性完成（2026-11-19）**：① 数据重跑可复现 —— 抓取脚本统一规范名 `hist_intraday.json`（同时写别名 `tx_minute.json`），生成脚本建立「规范名 → 兼容名 → `src/data/raw` 归档副本」三级回退并校验分钟点非空；② 事件契约 —— 新建 `src/events.ts`（`CHART_EVENTS` 冻结表 + `emitEvent()` 统一 bubbles/composed），全仓 `new CustomEvent` 只剩一处，盘口单位改 `depth-unit-request` → 根容器唯一派发 `depth-unit-change`；③ `exports` 补 `./vue` / `./events` / `./core/*` / `./gl/*` / `./compute/*` 并消除 `.js.js` 陷阱，新增无运行时依赖的 `vStockChart` 指令；④ 新建 `scripts/shared.mjs` 收口 `r2/r6/mulberry32`、常量模块补 `AUCTION_STEP_SEC/TIME`，`getSeries()` 读 `manifest.session`、复权标签读 `manifest.adjust`；⑤ `generatedAt` 支持 `SOURCE_DATE_EPOCH`、`floatShares` 改读 `instrument.json`（含来源）；⑥ 删除 `adaptiveMACDParams` / `CLEAR`，均线写入统一 `setMovingAverages()`，新增纯函数 `createPalette()` 并把 `applyPalette/resetPalette` 标 deprecated。新增 `scripts/tests/p1p2-architecture.test.mjs`（11 个测试）与 `pretest` 构建顺序保证，`npm test` **63/63**，8 场景截图 0 JS 错误。审计报告 8 组问题**全部完成**，详见 `docs/architecture-audit.html`。

> **源码相对 import 写无扩展名，产物由构建补全 `.js`**：源码统一写 `import { chipSnapshotAt } from './chip-pane'`（`tsconfig.json` 的 `moduleResolution: Bundler` 负责解析到 `chip-pane.ts`）。`tsc` 自身**不会给产物补扩展名**，因此 `scripts/build.mjs` 在编译后扫描 `dist/**/*.js` 与 `dist/**/*.d.ts`，把 import/export 语句里的相对无扩展名 specifier 统一补成 `.js`，并校验目标文件存在；这样浏览器与 Node ESM 都能直接加载 `dist/`，第三方 TS 消费者也能正确解析声明。全仓 86 处源码 import 与 108 处产物补全由 `verify.mjs` 双向断言锁定：源码禁止 `.js`/`.ts` 后缀、产物禁止残留无扩展名引用。`tsconfig.json` 同时用 `verbatimModuleSyntax: true` / `allowImportingTsExtensions: false` 锁住类型导入与后缀规范。注释与文档里描述**源码文件**时写 `.ts`，描述**产物/包路径**时写 `.js`。

**类型收敛（2026-11-19）**：全仓 **205 处显式 `any` 归零**（`stock-chart.ts` 81、`chart-context.ts` 42、`trade-tape.ts` 25、`depth-book.ts` 18 等 14 个文件），并补齐了 tsc 推断出的 15 处声明级 `any`（`sma/ema/ma/macd/computeIndicator`、`aggregateDaily/aggregateIntraday`、`halfHourMarks`），因此 `src/**/*.ts` 与 `dist/**/*.d.ts` **均无任何 `any`**。做法：共享类型统一收口到 `src/types.ts`（新增 `Rect/PriceScale/Viewport/Pointer/NumericInput/OrderRecord/DepthBookSnapshot/ComputeResult/PaneElementLike` 等），字段用 `declare f: 精确类型 | null`、调用点用 `!` 非空断言（编译后擦除），`catch` 用 `unknown`，事件回调用具体 DOM 事件类型；全程零运行时改动，24 个 JS 产物与基线逐字节一致。同时给 `getDataset()` / `getSubplotConfig()` / `getContext()` / `chipSnapshotAt()` 补显式返回类型，消除了 tsc 声明里的 `import("..")`（该写法在 NodeNext 消费者下无法解析），独立第三方项目 Bundler / NodeNext / TSX 三种配置均 0 错误。

**TypeScript 工程切换（2026-11-19）**：按确认的方案完成整体迁移 —— ① `src/` 下 24 个模块全部从 `.js` 改为 `.ts` 并做 `strict: true` 全量标注（`tsc --noEmit` 零错误、无隐式 any）；共享类型（数据契约、事件映射、JSX 属性、只读门面等）统一收口到 `src/types.ts`，`src/global.d.ts` 保留全局标签声明；② 删掉 5 个手写 `.d.ts`，改由 `tsc` 自动生成 `dist/**/*.d.ts`，消除源码类型与手写声明两套漂移；③ `scripts/build.mjs` 重写为调用项目本地 `typescript@5.6.3` 编译 + 复制全局声明 + `dist/index.d.ts` 注入三斜线引用 + 产物语法校验；④ `index.html` 改从 `./dist/index.js` 加载，`npm run serve` 前置自动构建；⑤ `scripts/` 与 8 组测试保持 `.mjs`（`node --test` 直接跑），其对源码的 import 改指 `dist` 编译产物，源码文本断言改指 `.ts`，`verify.mjs` 与 `contract.test.mjs` 的声明类断言改为校验 tsc 生成产物；⑥ `package.json` 增加 `predata` / `precheck` / `pretest` / `preserve` 保证任何脚本运行前 `dist` 都是最新的，`typecheck` 改为 `tsc --noEmit -p tsconfig.json`。**编译产物与原 JS 逐模块字节级一致**（各模块标注组用 `transpileModule` 对比验证），7 场景截图 0 JS 错误且与切换前像素级一致；`check` / `test`(63/63) / `typecheck` / `build` / `pack` 全链路通过。

**数据分层与算法单元化（2026-11-20）**：按「市面可得数据为基准 / 尽量少依赖外部数据 / 中间数据尽量由计算获得 / 概念统一、逻辑单元以算法为分割」完成整体重构。

- **L0 最小外部输入**：`bars_1d.json`（公开日 K）、`intraday_20261113.json`（公开分时）、`manifest.json` + `raw/instrument.json`（流通股本静态资料），另保留 4 份 Level-2 **示意数据**（`auction`/`trades`/`depth`/`orders`）—— 真实逐笔与委托簿需交易所授权，无法从分钟数据反推，因此以本地确定性 mock 呈现。`manifest.files` / `provenance` 由 10 键收敛为 **6 键**。
- **L1 运行时派生**：`chips`、`intradayMulti`、`depthFull`、`depthScenarios` 四个 JSON **已删除**，统一由 `src/core/derive-dataset.ts` 调用 `src/algorithms/` 在加载时生成。分钟 K / 周月季年 K / MA·MACD·KDJ·量比 / 盘口金额 / 逐笔方向本就是运行时计算，本次一并纳入同一算法层。
- **算法单元**：新建 `src/algorithms/` 共 **18 个纯 TS 模块**（无 DOM、无 IO、0 显式 any），按概念而非图表切分；`ALGORITHMS` 注册表登记 `{ id, concept, inputs, outputs, sharedBy, pure }`，`pure` 子入口统一导出；`scripts/` 的 `shared` / `limit-rules` / `auction-match` 改为薄 re-export，构建期与运行时复用同一实现。
- **跨图强逻辑关联（实测闭合）**：分时 15:00 累计量/额 == 当日日 K（原额差 22804.62 元）；逐笔按分钟聚合 **242/242 分钟**量额与分时严格相等（原 242/242 分钟 amount 全不等）；委托流 `ΣNEW = ΣFILL + ΣCANCEL + Σsnapshot`（原 261 条悬空挂单、两套状态机）；多日前 4 日累计量严格等于对应日 K（原差 3~4 倍）；全景盘口 53 买 / 33 卖档与「全部挂单」同源并覆盖到涨跌停价；场景切换不再覆盖原始 `depthFull`；单日 / 多日涨跌幅统一按各交易日昨收（末日 +1.77% 与单日一致）。
- **概念统一**：成交额、均价/VWAP、换手率（统一 `%`）、涨跌幅基准、取整 half-up、时间解析、单位格式化、`trim` 全部收口到单一算法单元；`matchAuction` 补齐申报价之间的 0.01 步长中间价候选（上交所中间价口径）。
- **验收**：`verify.mjs` 新增 8 条跨图闭合断言；`check` / `test` **64/64** / `typecheck` 0 错误 / `build` 44 JS + 45 声明 / 第三方 TS 项目 Bundler·NodeNext·TSX 均 0 错误 / 8 场景浏览器截图 0 JS 错误。

> 本项目为前端组件工程示例，示例标的仅用于验证数据结构与渲染，不构成投资建议。
