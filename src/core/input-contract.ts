/**
 * 输入数据契约（L0）与校验器：纯数据 + 纯函数，无 DOM 依赖，可在 Node / Worker / 构建期运行。
 *
 * 只描述「接入方必须从来源端拿到并注入」的 5 份落盘输入（bars / intraday / auction / depth /
 * orders）与 manifest；其余数据集（chips / intradayMulti / trades / depthFull / depthScenarios /
 * historicalIntraday）全部由 deriveDataset() 运行时派生，接入方无需、也不应自行提供。
 *
 * 字段口径对齐市面行情软件与公开接口（东方财富 / 腾讯 / 新浪 / 交易所行情）：
 *   价格 = 元；成交量 = 股（公开接口多返回「手」，需 × 100）；成交额 = 元；百分比 = % 数值；
 *   时间 = 市场本地字符串（tradeDate / time），时间戳 = UTC 毫秒。
 */
import { requiredDataFor, resolveModules } from '../workspace/module-catalog';
import type { DataKey, ResolveModulesOptions } from '../workspace/module-catalog';

/** 接入方需要提供的落盘输入键（manifest 另行必填） */
export type InputKey = 'bars' | 'intraday' | 'auction' | 'depth' | 'orders';

/** 来源可得性分级（与 manifest.provenance.availability 同一套取值） */
export type InputAvailability = 'public-eod' | 'vendor-minute' | 'l1-intraday-only' | 'level2-licensed';

export interface InputFieldSpec {
  name: string;
  type: 'number' | 'string' | 'array' | 'object';
  /** 单位：CNY / share / lot / percent / UTC ms / 'HH:MM' 等 */
  unit?: string;
  required: boolean;
  desc: string;
}

export interface InputSpec {
  key: InputKey | 'manifest';
  label: string;
  /** 数据形态 */
  shape: string;
  availability: InputAvailability | 'required-meta';
  /** 来源端可获取途径（公开接口 / 授权行情） */
  sources: string;
  /** 市面通识与口径约束 */
  conventions: string[];
  fields: InputFieldSpec[];
}

const f = (name: string, type: InputFieldSpec['type'], required: boolean, desc: string, unit?: string): InputFieldSpec =>
  ({ name, type, required, desc, ...(unit ? { unit } : {}) });

/** 输入契约表：文档、校验器、测试共用这一份定义 */
export const INPUT_CONTRACT: Readonly<Record<InputKey | 'manifest', InputSpec>> = Object.freeze({
  manifest: {
    key: 'manifest', label: '标的与交易日元信息', shape: '对象', availability: 'required-meta',
    sources: '交易所 / 行情接口的证券基本资料与当日行情头（代码、名称、昨收、开收盘）；流通股本取自上市公司定期报告或行情软件 F10',
    conventions: [
      'symbol 采用「代码.交易所」形式（如 600519.SH / 000001.SZ / 688xxx.SH / 8xxxxx.BJ）',
      'limitRate 按板块：主板 0.1、创业板 / 科创板 0.2、主板 ST 0.05、北交所 0.3',
      'preClose / open / close 必须与当日日 K 一致；换手率 = 成交量 ÷ 流通股本',
      'session 为连续竞价时段，A 股为 09:30–11:30、13:00–15:00',
    ],
    fields: [
      f('symbol', 'string', true, '证券代码.交易所'),
      f('name', 'string', true, '证券简称'),
      f('tradeDate', 'string', true, '当日交易日 YYYY-MM-DD'),
      f('preClose', 'number', true, '昨收价', 'CNY'),
      f('open', 'number', false, '当日开盘价（缺省取当日日 K）', 'CNY'),
      f('close', 'number', false, '当日收盘价 / 最新价（缺省取当日日 K）', 'CNY'),
      f('limitRate', 'number', false, '涨跌幅限制比例（缺省按代码 / 名称识别板块：主板 0.1、创业 / 科创 0.2、ST 0.05、北交所 0.3）'),
      f('floatShares', 'number', false, '流通股本；bars 未提供 turnoverRate 时据此计算换手率（筹码分布需要）', 'share'),
      f('adjust', 'string', false, "复权方式 'qfq' | 'hfq' | 'none'"),
      f('session', 'array', false, '连续竞价时段 [{open, close}]'),
      f('files', 'object', false, 'loadDataset 用：输入键 → 文件名（setDataset 直接注入时可省略）'),
      f('tradeDates', 'array', false, '多日分时用的近 N 个交易日'),
      f('preCloseByDate', 'object', false, '多日分时用的逐日昨收'),
    ],
  },
  bars: {
    key: 'bars', label: '日 K 线', shape: 'Bar[]（按 tradeDate 升序）', availability: 'public-eod',
    sources: '东方财富 push2his kline（11 列）/ 新浪 / 腾讯日线等公开日频接口；交易所日频行情表',
    conventions: [
      '量能在公开接口里多为「手」，落盘须 × 100 转为股',
      'low ≤ min(open, close) ≤ max(open, close) ≤ high；tradeDate 严格递增',
      '同一复权口径下 preClose 与上一根 close 相等；振幅 = (high − low) ÷ preClose',
    ],
    fields: [
      f('tradeDate', 'string', true, '交易日 YYYY-MM-DD'),
      f('open', 'number', true, '开盘价', 'CNY'), f('high', 'number', true, '最高价', 'CNY'),
      f('low', 'number', true, '最低价', 'CNY'), f('close', 'number', true, '收盘价', 'CNY'),
      f('volume', 'number', true, '成交量', 'share'), f('amount', 'number', true, '成交额', 'CNY'),
      f('preClose', 'number', false, '昨收（缺省取上一根 close，首根取开盘价）', 'CNY'),
      f('timestamp', 'number', false, '交易日 00:00 UTC（缺省由 tradeDate 计算）', 'UTC ms'),
      f('turnoverRate', 'number', false, '换手率（缺省 = volume ÷ manifest.floatShares）', 'percent'),
      f('pctChg', 'number', false, '涨跌幅（缺省由 preClose 计算）', 'percent'),
      f('amplitude', 'number', false, '振幅（缺省由 preClose 计算）', 'percent'),
      f('change', 'number', false, '涨跌额（缺省由 preClose 计算）', 'CNY'),
    ],
  },
  intraday: {
    key: 'intraday', label: '当日分时（分钟线）', shape: 'IntradayPoint[]（按 time 升序）', availability: 'vendor-minute',
    sources: '腾讯 minute/query、东方财富 trends2 等公开分时接口（返回累计量额，需差分为每分钟增量）；历史分时一般只回溯近几日',
    conventions: [
      '时间轴 09:30–11:30、13:00–15:00（241 或 242 点，依供应商是否单列 13:00）',
      '首个分钟点 09:30 含开盘集合竞价成交（腾讯 / 东财口径），逐笔中的 09:25 竞价成交即取该点量额',
      '可选盘后固定价段 15:01–15:30（不参与日 K 量能、不画在分时主图）',
      '连续竞价段成交量合计应等于当日日 K 成交量；分时价应落在日 K 高低之间',
    ],
    fields: [
      f('time', 'string', true, '分钟标签', 'HH:MM'),
      f('price', 'number', true, '该分钟收盘价 / 最新价', 'CNY'),
      f('volume', 'number', true, '该分钟成交量（增量）', 'share'),
      f('amount', 'number', true, '该分钟成交额（增量）', 'CNY'),
      f('tradeDate', 'string', false, '所属交易日（缺省取 manifest.tradeDate）'),
    ],
  },
  auction: {
    key: 'auction', label: '集合竞价过程', shape: 'AuctionPoint[]（开盘 + 收盘两段）', availability: 'l1-intraday-only',
    sources: '即时行情在竞价阶段给出参考价 / 匹配量 / 未匹配量，需在 9:15–9:25、14:57–15:00 逐点采集留存；历史过程无法回溯（同花顺等按 9 秒一点展示）',
    conventions: [
      '开盘 09:15–09:25（09:20 后不可撤单），收盘 14:57–15:00（不可撤单）',
      'matchedQty / unmatchedQty 以「手」为单位（与公开接口一致）',
      '09:25 末点 virtualPrice = 当日开盘价、matchedQty × 100 = 首个分钟点成交量；15:00 末点 = 收盘价',
    ],
    fields: [
      f('time', 'string', true, '时点', 'HH:MM:SS'),
      f('phase', 'string', true, "'open' 开盘竞价 | 'close' 收盘竞价"),
      f('virtualPrice', 'number', true, '虚拟参考价', 'CNY'),
      f('matchedQty', 'number', true, '虚拟匹配量', 'lot'),
      f('unmatchedQty', 'number', true, '虚拟未匹配量', 'lot'),
      f('unmatchedSide', 'number', false, '未匹配方向：1 买方堆积 / 2 卖方堆积 / 0 无'),
      f('timestamp', 'number', false, '时点时间戳（缺省由 tradeDate + time 计算）', 'UTC ms'),
    ],
  },
  depth: {
    key: 'depth', label: '盘口快照（十档）', shape: 'DepthBookSnapshot[]（取首个快照）', availability: 'level2-licensed',
    sources: '五档为公开 L1 即时行情；十档属 Level-2 增值行情，需向上证所信息网络 / 深证信息申请展示许可',
    conventions: [
      '买盘价格降序、卖盘价格升序，买一 < 卖一，价格为 0.01 元整数倍',
      '挂单量以「股」落盘（市面盘口多显示「手」，差 100 倍）；每档笔数由 orders 聚合，可不提供',
    ],
    fields: [
      f('bids', 'array', true, '买盘 [{price, volume}]，≤ 10 档', 'CNY / share'),
      f('asks', 'array', true, '卖盘 [{price, volume}]，≤ 10 档', 'CNY / share'),
      f('timestamp', 'number', false, '快照时间戳', 'UTC ms'),
    ],
  },
  orders: {
    key: 'orders', label: '逐笔委托事件流', shape: 'OrderRecord[]（按 time 非递减）', availability: 'level2-licensed',
    sources: '上交所 Level-2 逐笔合并流（新增 A / 撤单 D / 成交 T）、深交所逐笔委托 + 逐笔明细；需 Level-2 授权',
    conventions: [
      'action：NEW 新增委托、CANCEL 撤单、FILL 成交；CANCEL / FILL 用 origOrdId 指向原 NEW',
      '买入申报为 100 股整数倍；价格在涨跌停区间内且为 0.01 元整数倍',
      '09:20–09:25 与 14:57–15:00 不可撤单；11:30–13:00 午休无委托',
    ],
    fields: [
      f('ordId', 'string', true, '委托号'),
      f('time', 'string', true, '事件时间', 'HH:MM:SS'),
      f('price', 'number', true, '委托 / 成交价', 'CNY'),
      f('volume', 'number', true, '委托 / 成交 / 撤单量', 'share'),
      f('side', 'string', true, "'B' 买 | 'S' 卖"),
      f('action', 'string', true, "'NEW' | 'CANCEL' | 'FILL'"),
      f('origOrdId', 'string', false, 'CANCEL / FILL 指向的原委托号（NEW 为 null）'),
    ],
  },
});

export const INPUT_KEYS: readonly InputKey[] = Object.freeze(['bars', 'intraday', 'auction', 'depth', 'orders']);

const isInputKey = (k: string): k is InputKey => (INPUT_KEYS as readonly string[]).includes(k);

/** 启用给定模块时，接入方必须提供的落盘输入（模块数据依赖闭包 ∩ 落盘输入；manifest 恒必填） */
export function inputsForModules(options?: ResolveModulesOptions): InputKey[] {
  const enabled = resolveModules(options ?? { preset: 'full' });
  return requiredDataFor(enabled).filter((k: DataKey): k is InputKey => isInputKey(k));
}

export interface InputIssue {
  key: InputKey | 'manifest';
  code: string;
  message: string;
  /** 首个出错行下标（若适用） */
  index?: number;
}

export interface InputReport {
  ok: boolean;
  /** 本次按启用模块要求的落盘输入 */
  required: InputKey[];
  errors: InputIssue[];
  warnings: InputIssue[];
}

type Row = Record<string, unknown>;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const onTick = (p: number): boolean => Math.abs(p * 100 - Math.round(p * 100)) < 1e-6;

/**
 * 校验注入数据是否满足输入契约。只读、不修改入参。
 * - errors：结构性问题（缺必需输入 / 缺字段 / 类型错 / 顺序错 / OHLC 越界 / 单位错配），会导致图表口径错误；
 * - warnings：可容忍但值得关注的偏差（如分时额与日 K 额的供应商差异），派生层会锚定修正。
 * @param data 注入的数据集（loadDataset 结果或接入方自组对象）
 * @param options 启用模块（同 resolveModules 入参），决定哪些输入是必需的
 */
export function validateDatasetInput(data: unknown, options?: ResolveModulesOptions): InputReport {
  const required = inputsForModules(options);
  const neededKeys: DataKey[] = requiredDataFor(resolveModules(options ?? { preset: 'full' }));
  const errors: InputIssue[] = [];
  const warnings: InputIssue[] = [];
  const err = (key: InputIssue['key'], code: string, message: string, index?: number): void => {
    errors.push({ key, code, message, ...(index != null ? { index } : {}) });
  };
  const warn = (key: InputIssue['key'], code: string, message: string, index?: number): void => {
    warnings.push({ key, code, message, ...(index != null ? { index } : {}) });
  };
  const ds = (data && typeof data === 'object' ? data : {}) as Row;

  // manifest
  const m = (ds.manifest && typeof ds.manifest === 'object' ? ds.manifest : null) as Row | null;
  if (!m) err('manifest', 'missing', '缺少 manifest');
  else {
    for (const fd of INPUT_CONTRACT.manifest.fields) {
      if (fd.required && (fd.type === 'number' ? !num(m[fd.name]) : !str(m[fd.name]))) {
        err('manifest', 'field', `manifest.${fd.name} 缺失或类型错误（应为 ${fd.type}）`);
      }
    }
    if (num(m.limitRate) && ![0.05, 0.1, 0.2, 0.3].includes(m.limitRate)) {
      warn('manifest', 'limit-rate', `limitRate=${m.limitRate} 不是 A 股常见涨跌幅（0.05 / 0.1 / 0.2 / 0.3）`);
    }
  }

  // 逐个输入：存在性 + 必填字段类型（只报首个出错行，避免刷屏）
  const rowsOf = (key: InputKey): Row[] | null => {
    const v = ds[key];
    if (key === 'depth') {
      if (Array.isArray(v)) return v as Row[];
      return v && typeof v === 'object' ? [v as Row] : null;
    }
    return Array.isArray(v) ? (v as Row[]) : null;
  };
  const present = new Map<InputKey, Row[]>();
  for (const key of INPUT_KEYS) {
    const rows = rowsOf(key);
    if (!rows || rows.length === 0) {
      if (required.includes(key)) err(key, 'missing', `启用的模块需要 ${key}（${INPUT_CONTRACT[key].label}），但未提供或为空`);
      continue;
    }
    present.set(key, rows);
    const fields = INPUT_CONTRACT[key].fields.filter((fd) => fd.required);
    const bad = rows.findIndex((r) => fields.some((fd) => (fd.type === 'number' ? !num(r[fd.name])
      : fd.type === 'string' ? !str(r[fd.name]) : !Array.isArray(r[fd.name]))));
    if (bad >= 0) {
      const r = rows[bad];
      const miss = fields.filter((fd) => (fd.type === 'number' ? !num(r[fd.name])
        : fd.type === 'string' ? !str(r[fd.name]) : !Array.isArray(r[fd.name]))).map((fd) => fd.name);
      err(key, 'field', `${key}[${bad}] 字段缺失或类型错误：${miss.join(', ')}`, bad);
    }
  }
  // 字段不完整时不再做数值约束，避免连锁误报
  const usable = (key: InputKey): Row[] | null => (errors.some((e) => e.key === key) ? null : present.get(key) ?? null);

  const bars = usable('bars');
  if (bars && neededKeys.includes('chips')) {
    const noTurn = bars.some((b) => !num(b.turnoverRate));
    if (noTurn && !(m && num(m.floatShares) && (m.floatShares as number) > 0)) {
      err('bars', 'turnover', '筹码分布需要换手率：bars 缺 turnoverRate 且 manifest 未提供 floatShares');
    }
  }
  if (bars) {
    const i1 = bars.findIndex((b, i) => i > 0 && String(b.tradeDate) <= String(bars[i - 1].tradeDate));
    if (i1 >= 0) err('bars', 'order', `bars 未按 tradeDate 严格递增（第 ${i1} 根）`, i1);
    const i2 = bars.findIndex((b) => {
      const o = b.open as number, c = b.close as number, h = b.high as number, l = b.low as number;
      return !(l <= Math.min(o, c) + 1e-9 && h >= Math.max(o, c) - 1e-9);
    });
    if (i2 >= 0) err('bars', 'ohlc', `bars[${i2}] 违反 low ≤ open/close ≤ high`, i2);
    const i3 = bars.findIndex((b) => (b.volume as number) < 0 || (b.amount as number) < 0);
    if (i3 >= 0) err('bars', 'negative', `bars[${i3}] 成交量 / 成交额为负`, i3);
    if (m && num(m.preClose) && str(m.tradeDate)) {
      const last = bars[bars.length - 1];
      if (last.tradeDate === m.tradeDate && num(last.preClose) && Math.abs((last.preClose as number) - (m.preClose as number)) > 0.011) {
        err('manifest', 'pre-close', `manifest.preClose=${m.preClose} 与当日日 K preClose=${last.preClose} 不一致`);
      }
    }
  }

  const intraday = usable('intraday');
  if (intraday) {
    const i1 = intraday.findIndex((p, i) => i > 0 && String(p.time) <= String(intraday[i - 1].time));
    if (i1 >= 0) err('intraday', 'order', `intraday 未按 time 严格递增（第 ${i1} 点）`, i1);
    const i2 = intraday.findIndex((p) => (p.volume as number) < 0 || (p.amount as number) < 0);
    if (i2 >= 0) err('intraday', 'negative', `intraday[${i2}] 成交量 / 成交额为负（应为每分钟增量而非累计值差分错误）`, i2);
    const regular = intraday.filter((p) => String(p.time) <= '15:00');
    const day = bars && m ? bars.find((b) => b.tradeDate === m.tradeDate) : undefined;
    if (day && regular.length) {
      const vol = regular.reduce((s, p) => s + (p.volume as number), 0);
      const dv = day.volume as number;
      const ratio = dv > 0 ? vol / dv : 1;
      if (Math.abs(ratio - 0.01) < 0.002 || Math.abs(ratio - 100) < 20) {
        err('intraday', 'unit', `分时成交量合计 ${vol} 与日 K ${dv} 相差约 100 倍：疑似「手 / 股」单位混用（契约要求均为股）`);
      } else if (dv > 0 && Math.abs(vol - dv) / dv > 0.005) {
        warn('intraday', 'volume-sum', `分时连续竞价段成交量合计 ${vol} 与当日日 K ${dv} 偏差 > 0.5%`);
      }
      const lo = day.low as number, hi = day.high as number;
      const i3 = regular.findIndex((p) => (p.price as number) < lo - 0.011 || (p.price as number) > hi + 0.011);
      if (i3 >= 0) err('intraday', 'price-range', `intraday[${i3}] 价格 ${regular[i3].price} 越出当日日 K 高低 [${lo}, ${hi}]`, i3);
    }
  }

  const auction = usable('auction');
  if (auction) {
    const badPhase = auction.findIndex((a) => a.phase !== 'open' && a.phase !== 'close');
    if (badPhase >= 0) err('auction', 'phase', `auction[${badPhase}].phase 只能为 'open' | 'close'`, badPhase);
    const openEnd = [...auction].reverse().find((a) => a.phase === 'open');
    // 分时本身单位已错时不再拿它比对竞价，避免连锁误报
    const first = errors.some((e) => e.key === 'intraday') ? undefined : intraday?.[0];
    if (openEnd && first && num(first.volume)) {
      const qty = openEnd.matchedQty as number;
      if (qty * 100 !== first.volume && qty !== first.volume) {
        warn('auction', 'open-volume', `09:25 匹配量 ${qty} 手 ≠ 首个分钟点成交量 ${first.volume} 股（派生层将以分时为准锚定）`);
      } else if (qty === first.volume && qty !== 0) {
        err('auction', 'unit', 'auction.matchedQty 疑似以「股」提供（契约要求为「手」，与公开接口一致）');
      }
    }
    if (openEnd && m && num(m.open) && Math.abs((openEnd.virtualPrice as number) - (m.open as number)) > 0.011) {
      warn('auction', 'open-price', `09:25 虚拟价 ${openEnd.virtualPrice} 与开盘价 ${m.open} 不一致（派生层将锚定为开盘价）`);
    }
  }

  const depth = usable('depth');
  if (depth) {
    const s = depth[0];
    const bids = s.bids as Row[], asks = s.asks as Row[];
    const lvlBad = [...bids, ...asks].findIndex((l) => !num(l.price) || !num(l.volume) || (l.volume as number) < 0);
    if (lvlBad >= 0) err('depth', 'level', '盘口档位须为 {price: number, volume: number ≥ 0}');
    else {
      if (bids.some((l, i) => i > 0 && (l.price as number) >= (bids[i - 1].price as number))) err('depth', 'bid-order', '买盘须按价格降序');
      if (asks.some((l, i) => i > 0 && (l.price as number) <= (asks[i - 1].price as number))) err('depth', 'ask-order', '卖盘须按价格升序');
      if (bids.length && asks.length && (bids[0].price as number) >= (asks[0].price as number)) err('depth', 'crossed', '买一价须低于卖一价');
      if ([...bids, ...asks].some((l) => !onTick(l.price as number))) warn('depth', 'tick', '存在非 0.01 元价位的档位');
      if (bids.length > 10 || asks.length > 10) warn('depth', 'levels', '盘口超过 10 档，组件只展示前 10 档');
    }
  }

  const orders = usable('orders');
  if (orders) {
    const actions = new Set(['NEW', 'CANCEL', 'FILL']);
    const i1 = orders.findIndex((o) => !actions.has(o.action as string) || (o.side !== 'B' && o.side !== 'S'));
    if (i1 >= 0) err('orders', 'enum', `orders[${i1}] action 须为 NEW/CANCEL/FILL，side 须为 B/S`, i1);
    const i2 = orders.findIndex((o, i) => i > 0 && String(o.time) < String(orders[i - 1].time));
    if (i2 >= 0) err('orders', 'order', `orders 未按 time 非递减（第 ${i2} 条）`, i2);
    const news = new Set(orders.filter((o) => o.action === 'NEW').map((o) => o.ordId as string));
    const i3 = orders.findIndex((o) => o.action !== 'NEW' && !news.has(o.origOrdId as string));
    if (i3 >= 0) err('orders', 'orig-ref', `orders[${i3}] 的 origOrdId 未指向任何 NEW 委托`, i3);
    const i4 = orders.findIndex((o) => o.action === 'NEW' && o.side === 'B' && (o.volume as number) % 100 !== 0);
    if (i4 >= 0) warn('orders', 'odd-lot', `orders[${i4}] 买入申报不是 100 股整数倍`, i4);
    if (m && num(m.preClose) && num(m.limitRate)) {
      const lo = Math.round(m.preClose * (1 - m.limitRate) * 100) / 100;
      const hi = Math.round(m.preClose * (1 + m.limitRate) * 100) / 100;
      const i5 = orders.findIndex((o) => (o.price as number) < lo - 1e-9 || (o.price as number) > hi + 1e-9);
      if (i5 >= 0) err('orders', 'limit', `orders[${i5}] 价格 ${orders[i5].price} 超出涨跌停区间 [${lo}, ${hi}]`, i5);
    }
  }

  return { ok: errors.length === 0, required, errors, warnings };
}
