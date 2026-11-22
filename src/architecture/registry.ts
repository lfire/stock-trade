/**
 * ModuleRegistry：把现有 Custom Element 登记为架构意义上的「模块」。
 *
 * 公开标签名保持不变（零破坏性），这里只声明每个模块的：
 * 需要的 Region 类型、渲染介质、默认容器、是否可多实例、职责。
 * Container 依据此表把模块安排到 Layout 的 Region 中。
 */
import type { ContainerId, ModuleDescriptor, RenderTarget } from './types';

const entry = (
  ...[id, label, regionType, target, container, responsibility, extra]:
    [string, string, string, RenderTarget, ContainerId | '*', string, Partial<ModuleDescriptor>?]
): ModuleDescriptor => ({ id, label, regionType, target, container, responsibility,
  ...(extra || {}) });

/** 整体画布：WebGL 模块 */
export const MAIN_MODULES: ReadonlyArray<ModuleDescriptor> = Object.freeze([
  entry('price-chart', '分时图 / K 线图', 'main', 'webgl', 'main-canvas',
    '同一模块按 ChartMode 切换分时折线或蜡烛；计算 priceScale', { tag: 'price-pane' }),
  entry('auction', '集合竞价', 'auction-*', 'webgl', 'main-canvas',
    '开盘 / 尾盘竞价虚拟价与匹配量几何', { tag: 'auction-pane' }),
  entry('indicator', '副图', 'subplot-', 'webgl', 'main-canvas',
    'VOL / AMOUNT / MACD / KDJ / 量比，按 height 占槽位', { tag: 'indicator-pane', multiple: true }),
  entry('chip-distribution', '筹码峰', 'chip', 'webgl', 'main-canvas',
    '150 档横向柱 + 9 项统计', { tag: 'chip-pane' }),
  entry('canvas-decoration', '画布装饰', 'gutter|timeline|divider|auction-tail', 'webgl', 'main-canvas',
    '左坐标栏 / 时间轴带 / 分界线 / 竞价列灰底（原 renderFrame 无主批次）'),
  entry('depth-book', '十档盘口', 'side', 'dom', '*',
    '十档挂单表，可在整体画布侧栏与详情画布间迁移', { tag: 'depth-book' }),
  entry('trade-tape', '逐笔明细', 'side', 'dom', '*',
    '虚拟滚动明细，可在侧栏卡片与详情分组织间迁移', { tag: 'trade-tape' }),
  entry('pane-bars', '副图信息栏', 'subplot-*-info', 'dom', 'main-canvas',
    '每个副图上方的指标名与数值条'),
]);

/** 详情画布：DOM 模块 */
export const DETAIL_MODULES: ReadonlyArray<ModuleDescriptor> = Object.freeze([
  entry('cover-tabs', '详情标签栏', 'cover-tabs', 'dom', 'detail-canvas',
    '逐笔 / 全部挂单 / 全景盘口 三标签'),
  entry('detail-groups', '多组逐笔 / 全部挂单', 'cover-groups', 'dom', 'detail-canvas',
    '按宽度分 N 组、每组虚拟滚动窗口', { multiple: true }),
  entry('panorama', '全景盘口', 'cover-panorama', 'dom', 'detail-canvas',
    '53 买 / 33 卖档双列 + 涨跌停统计'),
]);

export const MODULE_REGISTRY: Readonly<Record<string, ModuleDescriptor>> = Object.freeze(
  Object.fromEntries([...MAIN_MODULES, ...DETAIL_MODULES].map((m) => [m.id, m])),
);

/** 对外契约 API，供消费者按 Region/Container 查询模块元数据：按 Region id 找到可安排到该槽位的模块 */
export function modulesForRegion(regionId: string): ModuleDescriptor[] {
  return Object.values(MODULE_REGISTRY).filter((m) => {
    const key = m.regionType;
    if (key.endsWith('-')) return regionId.startsWith(key);
    if (key.includes('|')) return key.split('|').some((k) => regionId === k || regionId.startsWith(k));
    if (key.includes('*')) return regionId.startsWith(key.split('*')[0]);
    return regionId === key || regionId.startsWith(`${key}-`);
  });
}

/** 对外契约 API，供消费者按 Region/Container 查询模块元数据：按容器取模块清单 */
export function modulesForContainer(id: ContainerId): ModuleDescriptor[] {
  return Object.values(MODULE_REGISTRY).filter((m) => m.container === id || m.container === '*');
}
