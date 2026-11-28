// 由代码契约生成《数据输入契约与模块出入参》文档，保证说明与实现同源。
// 用法：npm run docs:io（写文件）；verify.mjs 导入 renderIoDoc() 校验文档未漂移。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { INPUT_CONTRACT, INPUT_KEYS } from '../dist/core/input-contract.js';
import { MODULE_CATALOG } from '../dist/workspace/module-catalog.js';
import { describeModule } from '../dist/workspace/module-io.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IO_DOC_PATH = path.join(root, 'docs/05-数据输入契约与模块出入参.md');

const AVAIL = {
  'required-meta': '必填元信息',
  'public-eod': '公开日频（免费可得）',
  'vendor-minute': '公开分时（当日 / 近几日）',
  'l1-intraday-only': '即时行情需实时留存（历史不可回溯）',
  'level2-licensed': 'Level-2 授权行情',
};
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderIoDoc() {
  const out = [];
  out.push('# 数据输入契约与模块出入参');
  out.push('');
  out.push('> 本文由 `scripts/gen-io-doc.mjs` 根据代码契约（`src/core/input-contract.ts` 的 `INPUT_CONTRACT`、`src/workspace/module-catalog.ts`、`src/workspace/module-io.ts`）**自动生成**，请勿手改；修改契约后执行 `npm run docs:io`，`npm run check` 会校验本文与代码一致。');
  out.push('');
  out.push('## 一、数据流总览');
  out.push('');
  out.push('```');
  out.push('来源端（公开接口 / 授权行情）');
  out.push('  └─ 接入方整理为 5 份落盘输入 + manifest（本节契约）');
  out.push('       └─ validateDatasetInput(data, { modules | preset })   ← 注入前校验（组件注入后也会自动校验并派发 data-validate）');
  out.push('            └─ deriveDataset()  运行时派生：chips / intradayMulti / trades / depthFull / depthScenarios / historicalIntraday');
  out.push('                 └─ <stock-workspace>.data  → 各模块只读消费');
  out.push('```');
  out.push('');
  out.push('- 接入方**只需提供** `manifest` 与按启用模块所需的落盘输入；派生数据集由组件计算，**不要自行提供**（注入通道 `historicalIntraday` / `prevIntraday` 除外，见各模块「可选输入」）。');
  out.push('- 单位约定：价格 = 元；成交量 = **股**（公开接口多返回「手」，需 × 100）；竞价匹配量 = **手**（与公开接口一致）；成交额 = 元；百分比 = % 数值；`tradeDate` / `time` 为市场本地字符串，`timestamp` 为 UTC 毫秒。');
  out.push('- `validateDatasetInput()` 返回 `{ ok, required, errors, warnings }`：`errors` 为结构性问题（缺输入 / 缺字段 / 顺序错 / OHLC 越界 / 手股单位错配 / 委托引用断裂 / 越涨跌停），会导致图表口径错误；`warnings` 为可容忍偏差（派生层会锚定修正）。');
  out.push('');
  out.push('## 二、落盘输入契约');
  out.push('');
  out.push('| 输入 | 名称 | 形态 | 可得性 | 来源端获取途径 |');
  out.push('|---|---|---|---|---|');
  for (const key of ['manifest', ...INPUT_KEYS]) {
    const s = INPUT_CONTRACT[key];
    out.push(`| \`${key}\` | ${cell(s.label)} | ${cell(s.shape)} | ${AVAIL[s.availability]} | ${cell(s.sources)} |`);
  }
  for (const key of ['manifest', ...INPUT_KEYS]) {
    const s = INPUT_CONTRACT[key];
    out.push('');
    out.push(`### ${key} · ${s.label}`);
    out.push('');
    out.push('| 字段 | 类型 | 单位 | 必填 | 说明 |');
    out.push('|---|---|---|---|---|');
    for (const fd of s.fields) {
      out.push(`| \`${fd.name}\` | ${fd.type} | ${cell(fd.unit ?? '—')} | ${fd.required ? '✅' : '可选'} | ${cell(fd.desc)} |`);
    }
    out.push('');
    out.push('市面口径与约束：');
    out.push('');
    for (const c of s.conventions) out.push(`- ${c}`);
  }
  out.push('');
  out.push('## 三、模块数据依赖总表');
  out.push('');
  out.push('| 模块 | 职责 | 自动补齐的依赖模块 | 必需落盘输入（+ manifest） | 组件派生 |');
  out.push('|---|---|---|---|---|');
  const ids = Object.keys(MODULE_CATALOG);
  for (const id of ids) {
    const d = describeModule(id);
    out.push(`| \`${id}\` | ${cell(d.summary)} | ${cell(d.enabledModules.filter((m) => m !== id).join(' / ') || '—')} | ${d.requiredInputs.map((k) => `\`${k}\``).join(' ')} | ${cell(d.derivedData.join(' / ') || '—')} |`);
  }
  out.push('');
  out.push('## 四、单模块出入参说明');
  out.push('');
  out.push('每个模块都可单独装载：配置 `modules: [id]` 即自动补齐依赖；也可经子路径 `stock-chart/modules/<id>` 读取同一份说明（门面导出 `io`），或调用根入口 `describeModule(id)`。');
  for (const id of ids) {
    const d = describeModule(id);
    out.push('');
    out.push(`### \`${id}\` · ${d.label}`);
    out.push('');
    out.push(d.summary);
    out.push('');
    out.push('| 项 | 内容 |');
    out.push('|---|---|');
    out.push(`| 入参 · 必需落盘输入 | \`manifest\` ${d.requiredInputs.map((k) => `\`${k}\``).join(' ')} |`);
    out.push(`| 入参 · 组件派生（无需提供） | ${cell(d.derivedData.map((k) => `\`${k}\``).join(' ') || '—')} |`);
    out.push(`| 入参 · 可选输入 | ${cell((d.optional ?? []).map((o) => `\`${o.key}\`：${o.desc}`).join('；') || '—')} |`);
    out.push(`| 入参 · 配置键 | ${cell(d.config.map((k) => `\`${k}\``).join(' ') || '—')} |`);
    out.push(`| 承载元素 | ${cell(d.elements.map((e) => `\`${e}\``).join(' ') || '—')} |`);
    out.push(`| 公开 API | ${cell(d.api.map((a) => `\`${a}\``).join(' ') || '—（通过 config 驱动）')} |`);
    out.push(`| 出参 · 事件 | ${cell(d.events.map((e) => `\`${e}\``).join(' ') || '—')} |`);
    out.push(`| 出参 · 产出 | ${cell(d.outputs.join('；'))} |`);
    out.push(`| 实际装载模块 | ${cell(d.enabledModules.join(' → '))} |`);
    out.push('');
    out.push('```js');
    out.push(d.usage);
    out.push('```');
  }
  out.push('');
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(IO_DOC_PATH, renderIoDoc());
  console.log(`已生成 ${path.relative(root, IO_DOC_PATH)}`);
}
