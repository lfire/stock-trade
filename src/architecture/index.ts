/**
 * 架构层总入口：Container / Layout / Region / Module 的概念契约与默认实现。
 *
 * 使用方式：
 *   const layout = new MainCanvasLayout();
 *   const snapshot = layout.compute({ size, hints, state });
 *   container.applyLayout(snapshot);
 *   container.mount('price-chart', 'main');
 */
export * from './types';
export * from './main-canvas-layout';
export * from './detail-canvas-layout';
export * from './registry';
export * from './canvas-decoration';
