/**
 * 页面壳（shell）静态样式，随组件一起发布。
 * 本文件随组件发布，由 `ensureStyles()` 注入；页面壳样式自包含，不依赖示例页。
 * 两套 --page-* 主题变量：:root 为浅色，html[data-theme="dark"] / 组件
 * data-theme="dark"（:has）为暗色；纯常量、无副作用。
 */

export const WORKSPACE_SHELL_CSS: string = `
      /* 页面壳自有静态明暗主题：与组件内部主题完全解耦，仅由 URL ?theme 驱动 */
      :root {
        --page-bg: #fff;
        --page-panel: #f7f8fa;
        --page-line: #eceef1;
        --page-text: #1f2329;
        --page-muted: #6b7280;
        --page-up: #e24b4a;
        --page-down: #1d9e75;
        --page-link: #185fa5;
      }
      html[data-theme="dark"] {
        --page-bg: #14181e;
        --page-panel: #1c222b;
        --page-line: #2c3440;
        --page-text: #e6e9ee;
        --page-muted: #96a0ae;
        --page-up: #f0736f;
        --page-down: #4ac79b;
        --page-link: #78b6f0;
      }
      /* 组件自驱动：组件自身带 data-theme="dark" 时同步切换页面壳，无需页面脚本 */
      :root:has(stock-workspace[data-theme="dark"]) {
        --page-bg: #14181e;
        --page-panel: #1c222b;
        --page-line: #2c3440;
        --page-text: #e6e9ee;
        --page-muted: #96a0ae;
        --page-up: #f0736f;
        --page-down: #4ac79b;
        --page-link: #78b6f0;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--page-bg);
        color: var(--page-text);
        font:
          13px/1.6 system-ui,
          -apple-system,
          "PingFang SC",
          sans-serif;
      }
      header {
        padding: 14px 20px;
        border-bottom: 1px solid var(--page-line);
      }
      h1 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      .sub {
        color: var(--page-muted);
        font-size: 12px;
        margin-top: 2px;
      }
      /* 数据演示区（页面级）与图表功能区（图表卡片内）分离 */
      .demo-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 9px 20px;
        background: var(--page-panel);
        border-bottom: 1px solid var(--page-line);
      }
      .group-label {
        font: 500 11px/1 system-ui;
        padding: 5px 9px;
        border-radius: 5px;
        background: color-mix(
          in srgb,
          var(--page-link) 12%,
          var(--page-panel)
        );
        color: var(--page-link);
        white-space: nowrap;
        letter-spacing: 0.3px;
      }
      .demo-hint {
        color: var(--page-muted);
        font-size: 11px;
        white-space: nowrap;
      }
      main {
        padding: 16px 20px;
        max-width: 1500px;
        margin: 0 auto;
      }
      footer {
        padding: 14px 20px 28px;
        color: var(--page-muted);
        font-size: 12px;
        max-width: 1500px;
        margin: 0 auto;
      }
      a {
        color: var(--page-link);
      }
      /* 页面壳状态提示：颜色定义随组件发布，页面只切换 class */
      .page-fatal {
        border: 1px solid var(--page-up);
        background: color-mix(in srgb, var(--page-up) 12%, var(--page-panel));
        color: var(--page-up);
      }
      .page-status.ok {
        background: color-mix(in srgb, var(--page-down) 12%, var(--page-panel));
        color: var(--page-down);
      }
      .page-status.bad {
        background: color-mix(in srgb, var(--page-up) 12%, var(--page-panel));
        color: var(--page-up);
      }
`;
