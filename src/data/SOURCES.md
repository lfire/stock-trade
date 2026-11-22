# 示例数据来源说明

固定交易日：2026-11-13（完整历史交易日，避免当日进行中数据导致 case 不稳定）。

## 真实公开数据（已尝试并成功采集）

日 K：东方财富 push2his kline（fqt=1 前复权）真实数据 936 根，剔除 2026-11-13 之后未完成的当日 K 线，保留 935 根。日 K 字段严格取自东财原生 11 列（日期/开/收/高/低/量(手)/额(元)/振幅%/涨跌幅%/涨跌额/换手率%）：仅做「量(手) × LOT_SIZE 转股、timestamp 由 tradeDate 生成」两项映射，不含任何注入形态、不含 limitState / source 标记。四种涨跌停/炸板配色改由 manifest.demoPatterns 声明，由 `deriveDataset()` 运行时在内存按此叠加 `limitState`，落盘 bars 保持东财原生。
分时：腾讯 minute/query 在 2026-11-13 的真实完整交易日数据 267 点（上午 121 + 下午 121 + 盘后 25）。腾讯返回累计量额，已差分为每分钟增量；落盘仅保留 time / price / volume / amount / tradeDate，avgPrice / cumulativeVolume / cumulativeAmount / session / timestamp / source 由 src/core/derive-dataset.ts 运行时重算或补齐。
集合竞价：历史 9 秒级虚拟撮合过程快照需 L2 授权、无法回溯；9:25 结果与参考价属公开即时行情，故 manifest 标为 l1-intraday-only。本数据为锚定真实值 + 按上交所《交易规则》3.5.2 三原则撮合的示意委托簿，虚拟撮合价 / 匹配量 / 未匹配量 / 方向全部由 matchAuction() 按「最大成交量 → 未成交量最小 → 最接近前收」算出。落盘仅保留 time / phase / virtualPrice / matchedQty / unmatchedQty / unmatchedSide / timestamp；source / priceBasis / volume / amount 不再落盘，末点量额由运行时从 intraday 锚定，phase 为 chart-context 强依赖故保留。
尾盘竞价（收盘集合竞价 14:57–15:00）：上交所 2018-08-20 起对股票实施 3 分钟收盘集合竞价，可申报不可撤单；与开盘竞价一致采用锚定真实 + 三原则撮合的示意委托簿（并列价参考 14:57 末价），按同花顺口径生成 21 个 9 秒节点。

## 采集失败 / 不足，已按合理规则确定性 mock

十档盘口：公开盘口接口空响应，按收盘价上下各 10 档、0.01 步长确定性 mock；落盘每档仅 price / volume，顶层仅 timestamp / bids / asks，phaseCode / source / license / requiresAuthorization / orderCount 不再落盘（orderCount 运行时由 orders 聚合）。
- 十档盘口接口 em_depth.json 采集结果：空响应；筹码分布不依赖公开接口，由真实日 K 在运行时派生（见下）。
- 落盘 mock 使用固定种子 `mulberry32(20261113)`，重复运行 `build-sample-data.mjs` 输出完全一致；`build-order-book.mjs` 用独立种子 `mulberry32(2026111302)`；运行时派生层远档挂单用 `mulberry32(2026111303)`。
- 原始数据回退链：`.tmp-raw/hist_intraday.json`（规范名）→ `.tmp-raw/tx_minute.json`（旧名备份）→ `src/data/raw/` 归档副本。腾讯分时接口常返回空，归档副本保证 `npm run data` 在离线/无抓取结果时仍可完整重跑。

## 运行时派生数据集（非落盘输入）

以下 5 个数据集由 src/algorithms 在运行时派生，不再写盘为独立 JSON、也不再是输入：

- `chips` ← `src/algorithms/chip-distribution.ts`（真实日 K + 换手率的成本分布估算模型）；
- `intradayMulti` ← `src/algorithms/intraday-multi.ts`（末日真实分时 + 前 4 日按当日日 K 拟真，量额锚定日 K）；
- `depthFull` ← `src/algorithms/order-book.ts`（由 `orders` 委托流回放聚合，前十档与 `depth` 快照闭合）；
- `depthScenarios` ← `src/algorithms/depth-scenarios.ts`（普通 / 涨停 / 跌停场景）；
- `trades`（逐笔明细）← `buildTradeSeries(intraday)` 运行时生成、不落盘；原落盘输入 `trades_20261113.json` 已删除，不再写盘；合并分笔委托号关联 `ordIds` 同步移除。

派生过程的两个跨图修正（均由 `src/core/derive-dataset.ts` 在运行时完成）：

- **委托流守恒修复**：对 `orders` 补发 `CANCEL`，保证 `ΣNEW = ΣFILL + ΣCANCEL + Σ存活`，使委托流严格闭合。`orders` 落盘已移除 `snapshot` 布尔字段，「收盘存活挂单」由运行时按 `origOrdId` 与委托流守恒重建。
- **15:00 累计额锚定 bars**：把 15:00 累计成交额锚定当日日 K `amount`，使分时累计额与日 K 严格闭合。

派生入口为 `src/core/derive-dataset.ts`，以 L0 输入（`bars` / `intraday` / `manifest`，以及 `auction`（`l1-intraday-only` 示意）与 `depth` / `orders`（2 份 Level-2 示意数据））调用上述纯函数；明确需授权的是 `depth` / `orders` 这 2 个。因此 `manifest.files` 与 `manifest.provenance` 只登记 5 个落盘输入：`bars / intraday / auction / depth / orders`。

## 原始数据留档

`src/data/raw/` 保存抓取到的原始响应，便于复核字段与单位；`scripts/fetch-public-data.mjs` 可重跑。

## 单位与口径

- 价格：元（CNY）；成交量：股（share，东财返回「手」，已 × LOT_SIZE(=100) 转股）；成交额：元（CNY）。`lot` = 手、`share` = 股、`percent` = 百分数数值（如 0.33 表示 0.33%）。
- 时间戳：UTC 毫秒（UTC ms）；日线 `timestamp` 取交易日 00:00 UTC；`tradeDate` / `time` 保留市场本地字符串，避免 `new Date()` 串日。
- 复权：前复权（qfq）；`preClose = close - change`，与前复权涨跌额自洽。
- `turnoverRate` / `pctChg` / `amplitude` 为百分数数值（% 数值，如 0.33 表示 0.33%）；`change` 单位为元（CNY）。
- 开盘/尾盘竞价 `matchedQty` / `unmatchedQty` 单位为手（lot）；`virtualPrice` 单位为元（CNY）。
- `depth.bids/asks[].volume` 单位为股（share）：市面十档盘口常显示「手」，二者差 100 倍，由 `LOT_SIZE` 换算（1 手 = 100 股）；每档 `orderCount` 由运行时从 `orders` 聚合。
- 分时均价：均价 = 累计成交额 ÷ 累计成交量（股），不是价格算术平均；竞价/分时累计量额、session、timestamp 等派生字段由 `src/core/derive-dataset.ts` 运行时补齐。
- 开盘/尾盘竞价节点除 9:25 / 15:00 两个统一撮合时点外成交量均为 0；集合竞价成交方向为 `N`（无主动方向）。

> 本文为工程示例数据说明，不构成投资建议；示例标的仅用于验证数据结构与组件渲染。

## 派生数据集与 Level-2 授权边界

- `orders`（逐笔委托 NEW/FILL/CANCEL）由 `build-order-book.mjs` 以固定种子 `mulberry32(2026111302)` 确定性生成并落盘，仅 7 字段 `ordId/time/price/volume/side/action/origOrdId`；`level/phase/snapshot/origVolume/remainVolume/tradeId/cancelOf/tag/trend` 等仅为生成期内存状态、不写进 JSON；「收盘存活挂单」语义由运行时按 `origOrdId` 与委托流守恒重建。`depth` / `orders` 为 2 份 Level-2 示意数据（需授权），`auction` 为 `l1-intraday-only` 示意，统一登记在 `manifest.files` / `manifest.provenance`（5 个落盘输入）。
- **数据可获得性**：按《证券交易所管理办法》第 38 条与沪深交易规则 5.1.3，交易所法定公开的是日频行情表与集合竞价即时行情（参考价/匹配量/未匹配量）；十档盘口、逐笔明细、逐笔委托属 Level-2 增值行情，真实数据需向上证所信息网络 / 深圳证券信息申请展示或非展示许可，且不得自行复制、转发或开发衍生品。本项目示例数据均为确定性 mock、非真实行情，不再落盘 `license` / `requiresAuthorization` 等授权元数据。
- 逐数据集来源与授权摘要统一登记在 `manifest.provenance`（5 个落盘输入，其中 `depth` / `orders` 2 个需授权），供消费者一次读取；逐数据集单位见 `manifest.units`。
