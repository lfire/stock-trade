/**
 * <stock-workspace> 根组件的静态资源（light DOM，视觉零变化）。
 * 组件 CSS 分段源在 CSS_SOURCE，页面壳 CSS 在 shell-css.ts，二者由
 * <stock-workspace> 的 ensureStyles() 合并注入实例内 <style>（index.html 不含 <style>）。
 * WORKSPACE_CSS / WORKSPACE_TEMPLATE 是 full 预设的全量输出常量，纯常量、无副作用，
 * 不含任何运行时逻辑；数据由 workspace.data 注入。
 *
 * 阶段二（DOM/CSS 按需）：CSS 分段源 CSS_SOURCE 用顶格的 @module:key 标记注释
 * 切成连续片段，buildWorkspaceCSS() 按启用模块的 cssKeys 拼接片段并过滤标记行；
 * 模板拆成有序切片 TEMPLATE_SLICES，每片声明模板键 keys 与可选的具体模块 id moduleIds，
 * buildWorkspaceTemplate() 用「启用模块 templateKeys 并集」+ moduleIds 决定切片是否输出。
 * 装载依据全部来自 MODULE_CATALOG 的 templateKeys / cssKeys / lifecycle。
 * full 预设下两者的输出与 WORKSPACE_CSS / WORKSPACE_TEMPLATE 常量逐字符一致（向后兼容）。
 */
import { MODULE_CATALOG, resolveModules } from './module-catalog';

/** full 预设的启用模块清单（依赖拓扑序），作为全量常量与默认行为的唯一真源。 */
const fullModules: string[] = resolveModules({ preset: 'full' });

/* ------------------------------------------------------------------ CSS 分段 */

/**
 * 带标记注释的 CSS 分段源：内容 = 原 WORKSPACE_CSS 逐字 + 顶格标记行
 * （key ∈ base/header/toolbar/paneBars/tapeCard/detailCover/panorama/depthBook）。
 * 标记行本身不输出，仅作分段边界；base 片段无条件保留。
 */
const CSS_SOURCE: string = `
/* @module:base */
      .bar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 10px 20px;
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        position: relative;
      }
      #ma-panel {
        position: absolute;
        top: 100%;
        right: 12px;
        z-index: 30;
        width: 290px;
        background: var(--sw-bg, #FFFFFF);
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 8px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
        padding: 10px 12px;
      }
      #ma-panel h3 {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 500;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #ma-panel .ma-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 5px 0;
        font-size: 12px;
      }
      #ma-panel input[type="number"] {
        width: 60px;
        font: 12px system-ui;
        padding: 3px 5px;
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 5px;
      }
      #ma-panel input[type="color"] {
        width: 28px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 5px;
        background: var(--sw-bg, #FFFFFF);
        cursor: pointer;
      }
      #ma-panel button {
        padding: 3px 8px;
        font-size: 11px;
      }
      button,
      select {
        font: 12px system-ui;
        padding: 5px 10px;
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 6px;
        background: var(--sw-panel, #F7F8FA);
        color: var(--sw-text, #1F2329);
        cursor: pointer;
      }
      .bar select {
        line-height: 16px;
      }
/* @module:toolbar */
      button.active {
        background: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 12%,
          var(--sw-panel, #F7F8FA)
        );
        background: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 14%,
          var(--sw-panel, #F7F8FA)
        );
        border-color: var(--sw-link, #85b7eb);
        color: var(--sw-link, #0c447c);
      }
/* @module:base */
      .tag {
        padding: 4px 8px;
        border-radius: 5px;
        background: color-mix(in srgb, var(--sw-down, #1D9E75) 12%, var(--sw-panel, #F7F8FA));
        color: var(--sw-down, #1D9E75);
        font-size: 11px;
      }
      /* 主题变量来源：applyWorkspaceTheme() 把 18 色板 + 5 尺寸的 --sw-* 变量
         写到 <stock-workspace> 根元素的 inline style（不在 :root / html[data-theme] 定义）；
         下面每个 var() 的浅色值是静态兜底，运行时由组件内部主题覆盖。 */
      .chart-card {
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 10px;
        overflow: hidden;
        background: var(--sw-bg, #FFFFFF);
      }
/* @module:header */
      .chart-header {
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        position: relative;
      }
      .hdr-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 12px;
        min-width: 0;
      }
      .hdr-row + .hdr-row {
        border-top: 1px solid var(--sw-line, #ECEEF1);
      }
      .hdr-left {
        display: flex;
        align-items: center;
        gap: 20px;
        min-width: 0;
      }
      .brand {
        display: flex;
        align-items: baseline;
        gap: 10px;
        white-space: nowrap;
      }
      .brand b {
        font:
          500 16px/1.2 system-ui,
          -apple-system,
          sans-serif;
        color: var(--sw-text, #1F2329);
      }
      .brand span {
        font:
          12px/1.2 system-ui,
          -apple-system,
          sans-serif;
        color: var(--sw-muted, #6B7280);
      }
      /* 强调报价：当前价 / 涨跌额 / 涨跌幅，固定槽位 + 等宽数字避免 hover 跳动 */
      .quote {
        display: flex;
        align-items: baseline;
        gap: 10px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .quote b {
        font:
          500 20px/1.2 system-ui,
          -apple-system,
          sans-serif;
        width: 84px;
        text-align: right;
      }
      .quote span {
        font-size: 13px;
        font-weight: 500;
        width: 62px;
        text-align: right;
      }
      .quote.up {
        color: var(--sw-up, #E24B4A);
      }
      .quote.down {
        color: var(--sw-down, #1D9E75);
      }
      .context {
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
        font:
          11px/1.4 system-ui,
          -apple-system,
          sans-serif;
        color: var(--sw-muted, #6B7280);
        font-variant-numeric: tabular-nums;
      }
      .context i {
        font-style: normal;
        color: var(--sw-muted, #6B7280);
      }
      /* 日期时间固定槽位 + 等宽数字：hover 时字符宽度变化不会推动后面的 MA 参数 */
      .context #head-datetime {
        flex: 0 0 104px;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* MA 实时值：标签与数值都用对应均线颜色，数值固定槽位 + 等宽数字 */
      .ma-values {
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }
      .ma-item {
        display: inline-flex;
        align-items: baseline;
        gap: 3px;
        white-space: nowrap;
      }
      .ma-item i {
        font-style: normal;
        font-weight: 500;
      }
      .ma-item b {
        font-weight: 500;
        width: 52px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
/* @module:toolbar */
      .chart-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        position: relative;
      }
      .chart-tools .sep {
        width: 1px;
        height: var(--sw-row-h, 18px);
        background: var(--sw-line, #ECEEF1);
        margin: 0 2px;
      }
      /* 分时 / K 线各自的功能组：按当前模式整组显示，不再置灰 */
      .chart-tools .tool-group {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .chart-tools .tool-group[hidden] {
        display: none;
      }
      /* 多日分时：tab 式分段控件，点击即时切换，active 复用全局 button.active */
      .chart-tools .seg {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 6px;
        overflow: hidden;
        background: var(--sw-panel, #F7F8FA);
      }
      .chart-tools .seg button {
        border: 0;
        border-right: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 0;
        padding: 5px 9px;
        font: 11px/1.2 system-ui;
        background: transparent;
        white-space: nowrap;
      }
      .chart-tools .seg button:last-child {
        border-right: 0;
      }
      .chart-tools .seg button:hover:not(.active) {
        background: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 8%,
          var(--sw-panel, #F7F8FA)
        );
      }
      .chart-tools .seg button.active {
        border-color: transparent;
      }
      .chart-tools button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      /* 明暗主题切换：文案「暗色 / 浅色」等宽，固定最小宽度避免切换时抖动 */
      .chart-tools .theme-toggle {
        min-width: 44px;
      }
/* @module:header */
      .head-line2 {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        white-space: nowrap;
        min-width: 0;
        font:
          11px/1.4 system-ui,
          -apple-system,
          sans-serif;
        color: var(--sw-muted, #6B7280);
      }
      /* 四色涨跌停图例移到头部右侧，与指标行之间用竖线分隔 */
      .head-line2 .legend {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        padding-right: 8px;
        border-right: 1px solid var(--sw-line, #ECEEF1);
      }
      .head-line2 .legend span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--sw-muted, #6B7280);
      }
      .head-line2 .legend i {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        flex: 0 0 8px;
      }
      .metrics {
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }
      .metrics .metric {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        white-space: nowrap;
      }
      .metrics .metric i {
        font-style: normal;
        color: var(--sw-muted, #6B7280);
      }
      .metrics .metric b {
        font-weight: 500;
        width: 58px;
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--sw-text, #1F2329);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .head-line2.muted .metric b {
        color: var(--sw-muted, #6B7280);
      }
/* @module:base */
      stock-chart {
        width: 100%;
        height: 600px;
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 10px;
        overflow: hidden;
        position: relative;
      }
      .chart-card stock-chart {
        border: 0;
        border-radius: 0;
        display: block;
      }
/* @module:paneBars */
      #pane-bars {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 5;
      }
      /* 分隔线用 inset 阴影，不占高度也不裁切 18px 的下拉 */
      .pane-bar {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 10px;
        box-sizing: border-box;
        background: var(--sw-panel, #F7F8FA);
        box-shadow: inset 0 1px 0 var(--sw-line, #ECEEF1);
        font:
          11px/16px system-ui,
          -apple-system,
          "PingFang SC",
          sans-serif;
        color: var(--sw-muted, #6B7280);
        white-space: nowrap;
        overflow: hidden;
        pointer-events: auto;
      }
      /* 无边框下拉：行高与 LAYOUT.rowH 一致，渐变自绘箭头，hover 才给淡底 */
      .pane-bar select {
        -webkit-appearance: none;
        appearance: none;
        box-sizing: border-box;
        height: var(--sw-row-h, 18px);
        margin: 0;
        padding: 0 18px 0 6px;
        font:
          500 11px/16px system-ui,
          -apple-system,
          "PingFang SC",
          sans-serif;
        color: var(--sw-text, #1F2329);
        background-color: transparent;
        background-image:
          linear-gradient(45deg, transparent 50%, var(--sw-muted, #6B7280) 50%),
          linear-gradient(135deg, var(--sw-muted, #6B7280) 50%, transparent 50%);
        background-position:
          calc(100% - 11px) 7px,
          calc(100% - 7px) 7px;
        background-size:
          4px 4px,
          4px 4px;
        background-repeat: no-repeat;
        border: 0;
        border-radius: 3px;
        min-width: 72px;
        cursor: pointer;
        outline: none;
      }
      .pane-bar select:not(:disabled):hover,
      .pane-bar select:focus,
      .pane-bar select:focus-visible {
        outline: none;
        background-color: var(--sw-panel, #F7F8FA);
      }
      .pane-bar select:disabled {
        color: var(--sw-muted, #6B7280);
        cursor: default;
        background-color: var(--sw-panel, #F7F8FA);
      }
      .pane-bar .vals {
        color: var(--sw-muted, #6B7280);
        line-height: 16px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pane-bar .vals b {
        font-weight: 500;
        color: var(--sw-text, #1F2329);
      }
      stock-chart > price-pane,
      stock-chart > indicator-pane,
      stock-chart > chip-pane,
      stock-chart > auction-pane {
        display: none;
      }
/* @module:tapeCard */
      .card.tape-in-side {
        border: 0;
        border-radius: 0;
        border-top: 1px solid var(--sw-line, #ECEEF1);
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        cursor: pointer;
      }
      /* 明细标题行与盘口两条行同高（统一 --sw-bar-h）；flex 垂直居中 */
      .card.tape-in-side h2 {
        height: var(--sw-bar-h, 24px);
        padding: 0 8px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--sw-panel, #f7f8fa);
        color: var(--sw-text, #4b5563);
        font-weight: 500;
        border-bottom: 1px solid var(--sw-line, #e3e6eb);
      }
      .card.tape-in-side trade-tape {
        flex: 1 1 0%;
        min-height: 0;
        height: auto;
      }
      .card.tape-in-side .tape-note {
        display: none;
      }
      .tape-hint {
        display: none;
        font-size: 10px;
        color: var(--sw-muted, #6B7280);
        font-weight: 400;
        margin-left: auto;
        margin-right: 6px;
        background: var(--sw-line, #ECEEF1);
        border-radius: 4px;
        padding: 1px 6px;
        line-height: 1.4;
      }
      .card.tape-in-side .tape-hint {
        display: inline-flex;
        align-items: center;
      }
      /* 固定整数高度：让 syncSideBars 的侧栏余量计算不产生亚像素零头 */
      .tape-footer {
        flex: 0 0 auto;
        height: 32px;
        box-sizing: border-box;
        padding: 0 8px;
        border-top: 1px solid var(--sw-line, #ECEEF1);
        background: var(--sw-bg, #FFFFFF);
        cursor: pointer;
        display: flex;
        align-items: center;
      }
      .tape-footer[hidden] {
        display: none;
      }
      /* 弱化为与「全景盘口 →」同款的文字链接：无底色/边框/圆角，仅链接色 + hover 下划线 */
      .tape-footer b {
        display: block;
        width: 100%;
        border: 0;
        background: none;
        padding: 0;
        white-space: nowrap;
        color: var(--sw-link, #1b5fbf);
        font:
          10px/1.4 system-ui,
          -apple-system,
          sans-serif;
        font-weight: 400;
        text-align: center;
      }
      .tape-footer:hover b {
        text-decoration: underline;
      }
/* @module:detailCover */
      /* 逐笔明细：铺满整个图表区的多组视图（不使用弹窗） */
      .detail-cover {
        position: absolute;
        inset: 0;
        z-index: 10;
        background: var(--sw-bg, #FFFFFF);
        display: flex;
        flex-direction: column;
      }
      .detail-cover .cover-bar {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        font-size: 12px;
        color: var(--sw-text, #1F2329);
      }
      .detail-cover .cover-bar b {
        font-weight: 600;
        color: var(--sw-text, #1F2329);
      }
      .detail-cover .cover-back {
        justify-self: end;
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 6px;
        background: var(--sw-bg, #FFFFFF);
        padding: 3px 12px;
        font: 12px system-ui;
        cursor: pointer;
        color: var(--sw-text, #1F2329);
      }
      .detail-cover .cover-back:hover {
        background: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 12%,
          var(--sw-panel, #F7F8FA)
        );
        border-color: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 30%,
          transparent
        );
      }
      .detail-cover .cover-tabs {
        display: inline-flex;
        gap: 4px;
      }
      .detail-cover .cover-tabs button {
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 5px;
        background: var(--sw-bg, #FFFFFF);
        padding: 3px 9px;
        font: 11px system-ui;
        cursor: pointer;
        color: var(--sw-text, #1F2329);
      }
      .detail-cover .cover-tabs button.on {
        background: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 12%,
          var(--sw-panel, #F7F8FA)
        );
        border-color: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 30%,
          transparent
        );
        color: var(--sw-link, #1b5fbf);
        font-weight: 600;
      }
      .detail-cover .cover-count {
        margin: 0;
        text-align: center;
        color: var(--sw-muted, #6B7280);
        font-size: 11px;
        white-space: nowrap;
      }
      .detail-cover .cover-body {
        position: relative;
        flex: 1;
        min-height: 0;
      }
      .detail-cover .cover-scroll {
        position: absolute;
        inset: 0;
        overflow-y: auto;
        z-index: 1;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .detail-cover .cover-scroll::-webkit-scrollbar {
        display: none;
      }
      .detail-cover .cover-scroll-spacer {
        width: 1px;
      }
      .detail-cover .cover-groups {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: grid;
        pointer-events: none;
      }
      .cover-body.pano-mode .cover-scroll,
      .cover-body.pano-mode .cover-groups {
        display: none;
      }
      .cover-body:not(.pano-mode) .cover-panorama {
        display: none;
      }
      .cover-panorama {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
      }
/* @module:panorama */
      .pano-mid {
        flex: 0 0 auto;
        text-align: center;
        padding: 6px 10px;
        background: var(--sw-bg, #FFFFFF);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        color: var(--sw-text, #1F2329);
        font-size: 11px;
      }
      .pano-mid b {
        color: var(--sw-text, #1F2329);
        font-weight: 600;
      }
      .pano-cols {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      .pano-stat {
        flex: 0 0 auto;
        padding: 6px 10px;
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        font-size: 10.5px;
        color: var(--sw-muted, #6B7280);
        line-height: 1.5;
      }
      .pano-stat b {
        font-weight: 600;
      }
      .pano-empty {
        padding: 28px 12px;
        text-align: center;
        color: var(--sw-muted, #6B7280);
        font-size: 11px;
      }
      .pano-side.bids .pano-stat b {
        color: var(--sw-up, #E24B4A);
      }
      .pano-side.asks .pano-stat b {
        color: var(--sw-down, #1D9E75);
      }
      .pano-side {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--sw-line, #ECEEF1);
      }
      .pano-side:last-child {
        border-right: 0;
      }
      .pano-cap {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 10px;
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        font-size: 11px;
        color: var(--sw-text, #1F2329);
      }
      .pano-cap b {
        font-weight: 600;
        color: var(--sw-text, #1F2329);
      }
      .pano-cap span {
        color: var(--sw-muted, #6B7280);
        font-size: 10px;
        white-space: nowrap;
      }
      .pano-head {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: 52px 1fr 1fr 46px;
        gap: 4px;
        padding: 5px 10px;
        background: var(--sw-bg, #FFFFFF);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        color: var(--sw-muted, #6B7280);
        font-size: 10px;
        letter-spacing: 0.2px;
      }
      .pano-list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .pano-list::-webkit-scrollbar {
        display: none;
      }
      .pano-row {
        position: relative;
        display: grid;
        grid-template-columns: 52px 1fr 1fr 46px;
        gap: 4px;
        padding: 0 10px;
        height: var(--sw-row-h, 18px);
        align-items: center;
        font-variant-numeric: tabular-nums;
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        font-size: 11px;
        overflow: hidden;
      }
      .pano-row > span {
        position: relative;
        z-index: 1;
      }
      .pano-row .bar {
        position: absolute;
        right: 0;
        left: auto;
        top: 0;
        bottom: 0;
        z-index: 0;
      }
      .pano-side.bids .pano-row {
        color: var(--sw-up, #E24B4A);
      }
      .pano-side.bids .pano-row .bar {
        background: #fde7e7;
        background: color-mix(in srgb, var(--sw-up, #E24B4A) 12%, transparent);
      }
      .pano-side.asks .pano-row {
        color: var(--sw-down, #1D9E75);
      }
      .pano-side.asks .pano-row .bar {
        background: #e3f4ec;
        background: color-mix(in srgb, var(--sw-down, #1D9E75) 12%, transparent);
      }
      .pano-row:nth-child(even) {
        background: var(--sw-panel, #F7F8FA);
      }
      .pano-row:hover {
        background: #eef4fc;
        background: color-mix(
          in srgb,
          var(--sw-link, #1b5fbf) 10%,
          transparent
        );
      }
      .pano-row.near {
        font-weight: 600;
      }
      .pano-row.near .lbl {
        color: var(--sw-text, #1F2329);
      }
      .pano-row.bound,
      .pano-row.bound:nth-child(even) {
        background: #fff8e8;
        background: color-mix(in srgb, var(--sw-up, #E24B4A) 8%, transparent);
      }
      .pano-row.bound .lbl {
        color: var(--sw-up, #E24B4A);
      }
      .pano-head .num,
      .pano-row .num {
        text-align: right;
      }
      .pano-row .lbl {
        color: var(--sw-muted, #6B7280);
      }
/* @module:detailCover */
      .detail-cover .group {
        display: flex;
        flex-direction: column;
        min-width: 0;
        border-right: 1px solid var(--sw-line, #ECEEF1);
      }
      .detail-cover .group:last-child {
        border-right: 0;
      }
      .detail-cover .group-head {
        flex: 0 0 auto;
        padding: 5px 6px;
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
        font: 11px/1.4 system-ui;
        color: var(--sw-muted, #6B7280);
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .detail-cover trade-tape {
        flex: 1 1 0%;
        min-height: 0;
        height: auto;
      }
/* @module:depthBook */
      .card {
        border: 1px solid var(--sw-line, #ECEEF1);
        border-radius: 10px;
        overflow: hidden;
        background: var(--sw-bg, #FFFFFF);
      }
      .card h2 {
        margin: 0;
        padding: 6px 12px;
        font-size: 11px;
        font-weight: 400;
        color: var(--sw-muted, #6B7280);
        background: var(--sw-panel, #F7F8FA);
        border-bottom: 1px solid var(--sw-line, #ECEEF1);
      }
      trade-tape {
        height: 280px;
        display: block;
      }
      /* 盘口高度完全按内容自适应、不允许滚动（十档 20 行也要完整展示）；明细占剩余高度 */
      depth-book {
        display: block;
        overflow: hidden;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      depth-book::-webkit-scrollbar {
        display: none;
      }
`;

interface CssSegment {
  key: string;
  text: string;
}

interface CssParts {
  prefix: string;
  segments: CssSegment[];
}

/** 按标记行切分；split 的捕获组把每个 key 与随后的片段文本交替放入结果数组。 */
function splitCssSource(source: string): CssParts {
  const parts = source.split(/\/\* @module:([A-Za-z][A-Za-z0-9]*) \*\/\n/);
  const segments: CssSegment[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    segments.push({ key: parts[i], text: parts[i + 1] });
  }
  return { prefix: parts[0], segments };
}

const CSS_PARTS: CssParts = splitCssSource(CSS_SOURCE);

/** 启用模块的 cssKeys 并集；base 为共享兜底，无条件保留。 */
function enabledCssKeys(moduleIds: string[]): ReadonlySet<string> {
  const keys = new Set<string>(['base']);
  for (const id of moduleIds) {
    const def = MODULE_CATALOG[id];
    if (!def) continue;
    for (const key of def.cssKeys) keys.add(key);
  }
  return keys;
}

/** 内置 CSS 分段键集合（含无条件保留的 base）。 */
const BUILTIN_CSS_KEYS: ReadonlySet<string> =
  new Set(['base', ...CSS_PARTS.segments.map((seg) => seg.key)]);

/** 自定义 CSS 片段登记表：registerCssSegment() 写入，buildWorkspaceCSS() 追加合并。 */
const CUSTOM_CSS_SEGMENTS: Map<string, string> = new Map();
/** 已告警过的缺失 cssKey，保证同一 key 只 warn 一次。 */
const warnedCssKeys: Set<string> = new Set();

/** 登记自定义 CSS 片段：启用模块声明非内置 cssKey 时由该片段提供内容。 */
export function registerCssSegment(key: string, css: string): void {
  CUSTOM_CSS_SEGMENTS.set(key, css);
}

/** 按启用模块拼接 CSS 片段（过滤标记行），full 时输出全部原规则。 */
export function buildWorkspaceCSS(moduleIds: string[]): string {
  const keys = enabledCssKeys(moduleIds);
  let css = CSS_PARTS.prefix;
  for (const seg of CSS_PARTS.segments) {
    if (keys.has(seg.key)) css += seg.text;
  }
  // 启用模块声明的非内置 cssKey：合并已登记片段；未登记则给一次告警（不抛错）。
  for (const key of keys) {
    if (BUILTIN_CSS_KEYS.has(key)) continue;
    const custom = CUSTOM_CSS_SEGMENTS.get(key);
    if (custom !== undefined) css += custom;
    else if (!warnedCssKeys.has(key)) {
      warnedCssKeys.add(key);
      console.warn(`[template] cssKey "${key}" 无内置 CSS 片段且未 registerCssSegment() 登记，已跳过`);
    }
  }
  return css;
}

/** 保留：全量 CSS（= buildWorkspaceCSS(fullModules)）。 */
export const WORKSPACE_CSS: string = buildWorkspaceCSS(fullModules);

/* ------------------------------------------------------------------ 模板切片 */

interface TemplateSlice {
  text: string;
  /** 对应的模板键（requireAll：全部命中「启用模块 templateKeys 并集」才输出） */
  keys: readonly string[];
  /** 仅能由具体内置模块产生的切片：声明具体模块 id（requireAny：任一启用才输出） */
  moduleIds?: readonly string[];
}

/** 有序切片：逐字取自原 WORKSPACE_TEMPLATE，full 时全部启用 → 拼接即原文。 */
const TEMPLATE_SLICES: readonly TemplateSlice[] = [
  { text: `
      <div class="chart-card">
`, keys: ['shell'] },
  { text: `        <div class="chart-header">
          <!-- 第一行：股票标识（强调、置顶）在左，图表功能控件在右 -->
          <div class="hdr-row">
            <div class="hdr-left">
              <div class="brand">
                <b id="head-name">贵州茅台</b
                ><span id="head-symbol">600519.SH</span>
              </div>
              <div class="quote up" id="head-quote">
                <b id="q-price">—</b><span id="q-change">—</span
                ><span id="q-pct">—</span>
              </div>
            </div>
`, keys: ['header'] },
  { text: `            <div class="chart-tools">
              <button id="btn-intraday" class="active">分时</button>
              <button id="btn-candle">K 线</button>
              <span class="sep"></span>
              <!-- 分时专属：多日分时段控件（tab 式即时切换）+ 竞价开关（多日时禁用并说明原因） -->
              <span class="tool-group" id="intraday-only">
                <label style="color: var(--sw-muted, #6B7280)">多日</label>
                <span
                  class="seg"
                  id="intraday-days-seg"
                  role="group"
                  aria-label="分时天数"
                >
                  <button type="button" data-days="1" class="active">
                    1 日
                  </button>
                  <button type="button" data-days="2">2 日</button>
                  <button type="button" data-days="3">3 日</button>
                  <button type="button" data-days="4">4 日</button>
                  <button type="button" data-days="5">5 日</button>
                </span>
                <span
                  id="intraday-provenance"
                  style="color: var(--sw-muted, #6B7280); font-size: 10px"
                ></span>
                <span class="sep"></span>
                <span id="auction-toggle-wrap"
                  ><button id="btn-auction" class="active">
                    竞价：开
                  </button></span
                >
              </span>
              <!-- K 线专属：周期 / 筹码峰 / 均线设置 -->
              <span class="tool-group" id="candle-only" hidden>
                <label style="color: var(--sw-muted, #6B7280)">周期</label>
                <select id="sel-period"></select>
                <span class="sep"></span>
                <button id="btn-chips" class="active">筹码峰：开</button>
                <span class="sep"></span>
                <button id="btn-ma">均线设置</button>
                <div id="ma-panel" style="display: none">
                  <h3>
                    K 线均线设置
                    <button id="ma-close" type="button">关闭</button>
                  </h3>
                  <div id="ma-list"></div>
                  <div
                    class="ma-row"
                    style="
                      border-top: 1px solid var(--sw-line, #ECEEF1);
                      padding-top: 8px;
                      margin-top: 8px;
                    "
                  >
                    <span>MA</span>
                    <input
                      id="ma-period"
                      type="number"
                      min="1"
                      max="250"
                      value="60"
                    />
                    <input id="ma-color" type="color" value="#7C5CDB" />
                    <button id="ma-add" type="button">+ 添加</button>
                  </div>
                  <div
                    style="
                      color: var(--sw-muted, #6B7280);
                      font-size: 11px;
                      margin-top: 6px;
                    "
                  >
                    最多 8
                    条，周期重复会自动顺延；点击色块改颜色，改数字后失焦生效
                  </div>
                </div>
              </span>
              <span class="sep"></span>
              <!-- 两种模式共用 -->
              <label style="color: var(--sw-muted, #6B7280)">副图数量</label>
              <select id="sel-subplots">
                <option value="1">1 个</option>
                <option value="2">2 个</option>
                <option value="3" selected>3 个</option>
              </select>
              <span class="sep"></span>
              <button id="btn-theme" type="button" class="theme-toggle" aria-label="切换明暗主题" title="切换明暗主题">暗色</button>
            </div>
`, keys: ['header', 'toolbar'] },
  { text: `          </div>
          <!-- 第二行：左侧模式/日期/MA 实时值，右侧四色图例 + 固定槽位指标 -->
          <div class="hdr-row">
            <div class="context">
              <span id="head-mode">分时</span><i>·</i
              ><span id="head-datetime">—</span>
              <span class="ma-values" id="head-ma-values"></span>
            </div>
            <div class="head-line2 muted" id="head-metrics">
              <span
                class="legend"
                id="head-legend"
                style="display: none"
              ></span>
              <span class="metrics" id="head-metric-list"></span>
            </div>
          </div>
        </div>
`, keys: ['header'] },
  { text: `        <stock-chart id="chart" mode="intraday">
`, keys: ['chart'] },
  { text: `          <price-pane height="50">
            <!-- 不写死颜色：由组件按实例色板依次分配（橙 / 蓝 / 紫），换肤自动跟随 -->
            <ma-line period="5"></ma-line>
            <ma-line period="20"></ma-line>
            <ma-line period="60"></ma-line>
          </price-pane>
`, keys: ['panes'] },
  { text: `          <indicator-pane indicator="VOL" height="12"></indicator-pane>
          <indicator-pane indicator="AMOUNT" height="12"></indicator-pane>
          <indicator-pane
            id="pane-third"
            indicator="MACD"
            height="12"
          ></indicator-pane>
`, keys: ['panes'], moduleIds: ['indicator'] },
  { text: `          <auction-pane width="150"></auction-pane>
`, keys: ['panes'], moduleIds: ['auction'] },
  { text: `          <chip-pane dock="right" width="210" mode="histogram"></chip-pane>
`, keys: ['panes'], moduleIds: ['chip'] },
  { text: `          <depth-book slot="side" id="book" width="210"></depth-book>
`, keys: ['tapeCard'], moduleIds: ['depth-book'] },
  { text: `        </stock-chart>
      </div>
`, keys: ['shell'] },
  { text: `
      <!-- 交易明细：分时模式挂进图表右列（十档盘口下方）；K 线模式留在此隐藏寄主中不展示 -->
      <div id="tape-home" hidden>
        <div class="card" id="tape-card">
          <h2>
            交易明细<span class="tape-note">（虚拟滚动 · 与十字光标联动）</span>
            <span class="tape-hint" id="tape-hint">点击展开</span>
          </h2>
          <trade-tape id="tape" order="desc"></trade-tape>
          <div class="tape-footer" id="tape-detail" hidden>
            <b>查看逐笔明细 →</b>
          </div>
        </div>
      </div>
`, keys: ['tapeCard'], moduleIds: ['trade-tape', 'detail-cover'] },
];

/** 切片是否输出：模板键全部命中「启用模块 templateKeys 并集」，且具体 id（若有）任一启用。 */
function templateSliceEnabled(
  slice: TemplateSlice,
  enabledKeys: ReadonlySet<string>,
  modules: ReadonlySet<string>,
): boolean {
  if (!slice.keys.every((key) => enabledKeys.has(key))) return false;
  if (slice.moduleIds && !slice.moduleIds.some((id) => modules.has(id))) return false;
  return true;
}

/** 按启用模块的 templateKeys 并集 + 具体模块 id 筛选切片，拼接 DOM 模板。 */
export function buildWorkspaceTemplate(moduleIds: string[]): string {
  const enabledKeys = new Set<string>();
  const modules = new Set(moduleIds);
  for (const id of moduleIds) {
    const def = MODULE_CATALOG[id];
    if (!def) continue;
    for (const key of def.templateKeys) enabledKeys.add(key);
  }
  let html = '';
  for (const slice of TEMPLATE_SLICES) {
    if (templateSliceEnabled(slice, enabledKeys, modules)) html += slice.text;
  }
  return html;
}

/** 保留：全量模板（= buildWorkspaceTemplate(fullModules)）。 */
export const WORKSPACE_TEMPLATE: string = buildWorkspaceTemplate(fullModules);
