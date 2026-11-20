// <auction-pane> 现在是「配置节点」而非独立绘制 pane。
// 参考主流行情软件：集合竞价是分时图 x 轴最前面的一段，不是左侧独立小图。
// 几何由 src/core/auction-layer.ts 提供给 price-pane（价格线）与 indicator-pane（量柱），
// 两者与竞价段共用同一价格轴 / 同一量区。
// 属性：ratio = 竞价段占主图宽度的比例（默认 0.16，范围 0.08–0.30）。
export class AuctionPane extends HTMLElement {
  static get observedAttributes() { return ['ratio']; }
  connectedCallback() { /* 配置节点：不注册绘制 pane、不产生几何 */ }
}

// 标签注册统一由 src/index.ts 的 defineAll() 显式负责，本模块保持无副作用
