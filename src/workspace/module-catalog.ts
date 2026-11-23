/**
 * Workspace 模块化目录：把页面壳按「功能域」拆成 13 个可按需装载的模块。
 *
 * 每个模块声明它依赖的运行时数据（DataKey）、依赖的其它模块（dependencies）、
 * 归属哪些预设（presets）、需要的 DOM / CSS 片段键（templateKeys / cssKeys），
 * 以及生命周期挂载位置（lifecycle）；这些字段是装载的唯一依据。
 * resolveModules() 先得到「依赖在前」的启用清单：组件按 templateKeys 拼接 DOM 切片、
 * 按 cssKeys 拼接 CSS 片段、按 lifecycle 查映射表挂载生命周期，实现模块化按需装载。
 * 组件 CSS 分段源在 template.ts 的 CSS_SOURCE，页面壳 CSS 在 shell-css.ts，
 * 二者由 <stock-workspace> 的 ensureStyles() 合并注入实例内 <style>（index.html 不含 <style>）。
 *
 * 本文件为纯数据 + 纯函数，不依赖 DOM，可在 Node / 构建期直接运行。
 * registerModule() 是「将来新增模块」的唯一扩展点：写入底层可变目录后，
 * MODULE_CATALOG / resolveModules() / requiredDataFor() 对新模块立即可见。
 */

/** L0 输入 + L1 派生的运行时数据集键（与 derive-dataset.ts 的派生字段一致）。 */
export type DataKey =
  | 'bars'
  | 'intraday'
  | 'auction'
  | 'trades'
  | 'orders'
  | 'depth'
  | 'chips'
  | 'intradayMulti'
  | 'depthFull'
  | 'depthScenarios';

/**
 * 预设档位：full 全量（默认）、intraday 分时、candle K 线（真按需，不含历史分时）、
 * candle-full K 线 + 历史分时（依赖链自动补 detail-cover / trade-tape）、minimal 最小。
 */
export type WorkspacePreset = 'full' | 'intraday' | 'candle' | 'candle-full' | 'minimal';

/** 单个功能域模块的静态描述。 */
export interface WorkspaceModuleDef {
  id: string;
  label: string;
  /** 该模块运行所需的运行时数据键 */
  requiresData: DataKey[];
  /** 依赖的其它模块 id（启用本模块时会被自动补齐，且排在前面） */
  dependencies: string[];
  /** 该模块归属哪些预设 */
  presets: WorkspacePreset[];
  /** true = 可选模块；false / undefined = 核心必需（core） */
  optional?: boolean;
  /** 需要的 DOM 片段键（shell / header / toolbar / chart / panes / tapeCard）——向后兼容的共享键字段 */
  templateKeys: string[];
  /**
   * 该模块拥有的模板切片 id（模块级归属）。启用本模块时，template.ts 的
   * templateSliceEnabled() 除匹配切片 owners 外，也据此产出独占 DOM；新模块配合
   * registerTemplateSlice() 声明 id 即可产出独占 DOM，无需改内置切片白名单。
   */
  templateSlices?: readonly string[];
  /** 需要的 CSS 片段键 */
  cssKeys: string[];
  /** 生命周期挂载位置（可注册任意值）；undefined / null = 不挂载 */
  lifecycle?: string | null;
}

/** 5 个预设值（同时作为 preset 白名单来源）。 */
const PRESET_KEYS: readonly WorkspacePreset[] = ['full', 'intraday', 'candle', 'candle-full', 'minimal'];

/** 归属全部预设（core / header）。 */
const ALL_PRESETS: WorkspacePreset[] = [...PRESET_KEYS];

/** 运行时数据键之间的依赖闭包：某个键被需要时，其前置数据也必须一并加载。 */
const DATA_DEPENDENCIES: Readonly<Partial<Record<DataKey, readonly DataKey[]>>> = {
  auction: ['intraday'],
  intradayMulti: ['intraday'],
  trades: ['intraday'],
  orders: ['intraday'],
  depthFull: ['orders', 'depth'],
  depthScenarios: ['depthFull', 'depth'],
  chips: ['bars'],
};

/** 13 个内置功能域模块。 */
const BUILTIN_MODULES: WorkspaceModuleDef[] = [
  {
    id: 'core',
    label: '核心画布与数据基座',
    requiresData: ['bars', 'intraday'],
    dependencies: [],
    presets: ALL_PRESETS,
    templateKeys: ['shell', 'chart', 'panes'],
    cssKeys: ['base'],
  },
  {
    id: 'price-intraday',
    label: '分时走势',
    requiresData: ['intraday', 'intradayMulti'],
    dependencies: ['core'],
    presets: ['full', 'intraday', 'minimal'],
    templateKeys: ['chart'],
    cssKeys: [],
  },
  {
    id: 'price-candle',
    label: 'K 线蜡烛',
    requiresData: ['bars'],
    dependencies: ['core'],
    presets: ['full', 'candle'],
    templateKeys: ['chart'],
    cssKeys: [],
  },
  {
    id: 'auction',
    label: '集合竞价',
    requiresData: ['auction', 'intraday'],
    dependencies: ['core', 'price-intraday'],
    presets: ['full', 'intraday'],
    templateKeys: ['chart'],
    cssKeys: [],
  },
  {
    id: 'indicator',
    label: '技术指标副图',
    requiresData: ['bars', 'intraday'],
    dependencies: ['core'],
    presets: ['full', 'intraday', 'candle'],
    templateKeys: ['panes'],
    cssKeys: ['paneBars'],
  },
  {
    id: 'chip',
    label: '筹码分布',
    requiresData: ['chips'],
    dependencies: ['core', 'price-candle'],
    presets: ['full', 'candle'],
    templateKeys: ['panes'],
    cssKeys: [],
  },
  {
    id: 'depth-book',
    label: '十档盘口',
    requiresData: ['depth', 'orders'],
    dependencies: ['core'],
    presets: ['full', 'intraday'],
    lifecycle: 'depth',
    templateKeys: ['tapeCard'],
    cssKeys: ['depthBook'],
  },
  {
    id: 'trade-tape',
    label: '逐笔明细',
    // orders 让 deriveDataset 的 linkFillsToTrades() 生效：逐笔每行补齐 ordIds，
    // 单独启用时不再输出缺关联字段的 trades。
    requiresData: ['trades', 'orders'],
    dependencies: ['core'],
    presets: ['full', 'intraday'],
    lifecycle: 'tape',
    templateKeys: ['tapeCard'],
    cssKeys: ['tapeCard'],
  },
  {
    id: 'detail-cover',
    label: '详情覆盖层',
    requiresData: ['trades', 'orders', 'depthFull', 'depthScenarios'],
    dependencies: ['core', 'trade-tape'],
    presets: ['full', 'intraday'],
    lifecycle: 'detail',
    templateKeys: ['tapeCard'],
    cssKeys: ['detailCover'],
  },
  {
    id: 'panorama',
    label: '全景盘口',
    requiresData: ['depthFull'],
    dependencies: ['core', 'detail-cover'],
    presets: ['full', 'intraday'],
    lifecycle: 'detail',
    templateKeys: ['panes'],
    cssKeys: ['panorama'],
  },
  {
    id: 'header',
    label: '页头',
    requiresData: [],
    dependencies: ['core'],
    presets: ALL_PRESETS,
    lifecycle: 'head',
    templateKeys: ['header'],
    cssKeys: ['header'],
  },
  {
    id: 'toolbar',
    label: '控制栏',
    requiresData: [],
    dependencies: ['core'],
    presets: ['full', 'intraday', 'candle'],
    lifecycle: 'controls',
    templateKeys: ['toolbar'],
    cssKeys: ['toolbar'],
  },
  {
    id: 'historical-intraday',
    label: '历史分时（日 K 查看）',
    requiresData: ['intradayMulti', 'bars'],
    dependencies: ['core', 'detail-cover'],
    presets: ['full', 'candle-full'],
    templateKeys: ['toolbar', 'tapeCard'],
    cssKeys: ['historicalIntraday'],
    lifecycle: 'detail',
  },
];

/**
 * 可变目录（null 原型，避免 toString / constructor 等继承键污染 id 判定）。
 * MODULE_CATALOG 与它共享同一对象引用，因此 registerModule 写入后立即可见。
 */
const catalog: Record<string, WorkspaceModuleDef> = Object.create(null) as Record<string, WorkspaceModuleDef>;
for (const def of BUILTIN_MODULES) catalog[def.id] = def;

/** 模块目录的只读视图；registerModule() 写入底层可变对象后此处立即可见。 */
export const MODULE_CATALOG: Readonly<Record<string, WorkspaceModuleDef>> = catalog;

/**
 * 预设 → 模块 id 清单（full 全量 13，向后兼容默认全开）。
 * candle 为真按需的 K 线档（不含 historical-intraday，不触发依赖链）；
 * candle-full = candle + historical-intraday，依赖闭包会自动补 detail-cover / trade-tape。
 * registerModule() 注册的新模块不会自动进入这些静态预设。
 */
export const MODULE_PRESETS: Readonly<Record<WorkspacePreset, string[]>> = {
  full: [
    'core', 'price-intraday', 'price-candle', 'auction', 'indicator', 'chip',
    'depth-book', 'trade-tape', 'detail-cover', 'panorama', 'header', 'toolbar',
    'historical-intraday',
  ],
  intraday: [
    'core', 'price-intraday', 'auction', 'indicator', 'depth-book',
    'trade-tape', 'detail-cover', 'panorama', 'header', 'toolbar',
  ],
  candle: ['core', 'price-candle', 'indicator', 'chip', 'header', 'toolbar'],
  'candle-full': [
    'core', 'price-candle', 'indicator', 'chip', 'header', 'toolbar',
    'historical-intraday',
  ],
  minimal: ['core', 'price-intraday', 'header'],
};

const getDef = (id: string): WorkspaceModuleDef | undefined => catalog[id];

const isPreset = (value: unknown): value is WorkspacePreset =>
  typeof value === 'string' && PRESET_KEYS.some((p) => p === value);

/** 拓扑排序：依赖排在使用者之前；未知 id 被过滤；环依赖由 visiting 集合安全打断。 */
function topoSort(seeds: readonly string[]): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    const def = getDef(id);
    if (!def) return;
    visiting.add(id);
    for (const dep of def.dependencies) visit(dep);
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  };
  for (const id of seeds) visit(id);
  return result;
}

/**
 * 解析启用模块清单。
 * - modules 为非空显式数组时优先：过滤未知 id，自动补 core 与全部 dependencies 传递闭包；
 * - modules 未提供（undefined）或为空数组时按 preset 装载：合法 preset 直接采纳
 *   （空数组不再吞掉 preset 回退 full），preset 缺省 / 非法 / input 为 undefined → full；
 * - 新增模块默认不自动启用：MODULE_PRESETS 保持静态 5 预设清单，registerModule 注册的
 *   新模块只有显式出现在 modules 数组里才装载，避免「注册即半装载」（无 DOM 切片 / 生命周期）。
 * 返回去重、依赖在前的拓扑顺序 id 数组。
 */
export function resolveModules(
  input: { modules?: string[]; preset?: WorkspacePreset } | undefined,
): string[] {
  const explicit = input?.modules;
  if (Array.isArray(explicit) && explicit.length > 0) {
    const seeds: string[] = ['core'];
    for (const id of explicit) if (!seeds.includes(id)) seeds.push(id);
    return topoSort(seeds);
  }

  // 不再扫 catalog 并入「声明归属该 preset 的新模块」：那样会让注册即强制启用，
  // 且新 id 不产出 DOM 切片 / 生命周期。预设清单静态取自 MODULE_PRESETS。
  const rawPreset = input?.preset;
  const preset: WorkspacePreset = isPreset(rawPreset) ? rawPreset : 'full';
  return topoSort([...MODULE_PRESETS[preset]]);
}

/**
 * 返回启用模块所需数据键的并集，并按数据依赖闭包补全（传递闭包）：
 * auction / intradayMulti / trades / orders → intraday；
 * depthFull → orders + depth；depthScenarios → depthFull + depth；chips → bars。
 * 结果去重，依赖数据排在前面。
 */
export function requiredDataFor(moduleIds: string[]): DataKey[] {
  const result: DataKey[] = [];
  const seen = new Set<DataKey>();
  const add = (key: DataKey): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const deps = DATA_DEPENDENCIES[key];
    if (deps) for (const d of deps) add(d);
    result.push(key);
  };
  for (const id of moduleIds) {
    const def = getDef(id);
    if (!def) continue;
    for (const key of def.requiresData) add(key);
  }
  return result;
}

/**
 * 注册新模块（将来新增模块的唯一扩展点）。写入后 resolveModules / requiredDataFor /
 * MODULE_CATALOG 立即对新模块可见。重复 id 抛错。
 */
export function registerModule(def: WorkspaceModuleDef): void {
  if (getDef(def.id) !== undefined) {
    throw new Error(`[module-catalog] 模块 id 已存在：${def.id}`);
  }
  catalog[def.id] = def;
}

/** 给定的已解析启用模块清单中是否包含某模块。 */
export function isModuleEnabled(moduleIds: string[], id: string): boolean {
  return moduleIds.includes(id);
}
