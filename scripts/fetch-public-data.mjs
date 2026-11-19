#!/usr/bin/env node
// 抓取公开行情数据到 .tmp-raw/。失败不影响后续：build-sample-data.mjs 会对缺失项做合理 mock。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, '.tmp-raw');
mkdirSync(rawDir, { recursive: true });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

const sources = [
  {
    name: '东方财富 日K 前复权',
    file: 'em_kline_qfq.json',
    url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=20230101&end=20500101&lmt=1000',
  },
  {
    name: '东方财富 日K 不复权',
    file: 'em_kline_raw.json',
    url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&beg=20230101&end=20500101&lmt=1000',
  },
  {
    name: '东方财富 分时 trends2',
    file: 'em_trends.json',
    url: 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=1.600519&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0',
  },
  {
    name: '腾讯 分时 minute',
    // 规范名与 build-sample-data.mjs 读取的文件一致；alias 保留旧名便于复核
    file: 'hist_intraday.json', alias: 'tx_minute.json',
    url: 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519',
  },
  {
    name: '东方财富 逐笔明细 details',
    file: 'em_details.json',
    url: 'https://push2.eastmoney.com/api/qt/stock/details/get?secid=1.600519&pos=-200&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55',
  },
  {
    name: '腾讯 逐笔明细 detail',
    file: 'tx_detail.txt',
    url: 'https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=sh600519&p=0',
  },
  {
    name: '新浪 日K',
    file: 'sina_kline.json',
    url: 'https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=240&ma=no&datalen=250',
  },
  {
    name: 'Alpha Vantage 日线 CSV（海外对照）',
    file: 'av_daily.csv',
    url: 'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=IBM&apikey=demo&datatype=csv',
  },
  {
    name: '东方财富 筹码分布（已知常失败）',
    file: 'em_cyq.json',
    url: 'https://push2his.eastmoney.com/api/qt/stock/cyq/get?secid=1.600519&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58',
  },
  {
    name: '东方财富 十档盘口（已知常失败）',
    file: 'em_depth.json',
    url: 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f19,f20,f17,f18,f31,f32,f33,f34,f35,f36,f37,f38,f39,f40,f43,f57,f58,f60',
  },
];

let ok = 0;
for (const s of sources) {
  try {
    const buf = execFileSync(
      'curl',
      ['-sL', '--max-time', '25', '-H', `User-Agent: ${UA}`, '-H', 'Referer: https://quote.eastmoney.com/', s.url],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const bytes = buf.length;
    const empty = bytes === 0;
    if (!empty) ok += 1;
    writeFileSync(path.join(rawDir, s.file), buf);
    if (!empty && s.alias) writeFileSync(path.join(rawDir, s.alias), buf);   // 同接口原始备份
    console.log(`${empty ? 'EMPTY' : 'OK   '} ${s.name.padEnd(28)} -> ${s.file}${s.alias ? ` (+ ${s.alias})` : ''} (${bytes} B)`);
  } catch (e) {
    console.log(`FAIL  ${s.name.padEnd(28)} -> ${s.file}: ${e.message.slice(0, 90)}`);
  }
}
console.log(`\n成功 ${ok}/${sources.length} 个源；空响应或失败的项由 build-sample-data.mjs 按规则生成。`);
