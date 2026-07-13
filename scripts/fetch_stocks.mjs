/* 抓取台灣證交所開放資料,整理成 data/stocks.json
 * 由 GitHub Actions 每交易日執行,也可以在本機執行:node scripts/fetch_stocks.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';

const DAY_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';   // 當日行情
const VAL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';      // 本益比/殖利率/淨值比

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const [dayRows, valRows] = await Promise.all([getJson(DAY_URL), getJson(VAL_URL)]);

const val = new Map(valRows.map(r => [r.Code, r]));
const stocks = {};
let updated = '';

for (const r of dayRows) {
  if (!r.Code || !/^\d{4,6}$/.test(r.Code)) continue;
  const v = val.get(r.Code);
  stocks[r.Code] = {
    n: r.Name,
    c: num(r.ClosingPrice),
    chg: num(r.Change),
    o: num(r.OpeningPrice),
    h: num(r.HighestPrice),
    l: num(r.LowestPrice),
    v: num(r.TradeVolume),
    pe: v ? num(v.PEratio) : null,
    dy: v ? num(v.DividendYield) : null,
    pb: v ? num(v.PBratio) : null,
  };
  if (!updated && r.Date) updated = r.Date; // 民國年格式 e.g. 1150713
}

// 民國年 → 西元 yyyy/mm/dd
if (/^\d{7}$/.test(updated)) {
  const y = parseInt(updated.slice(0, 3), 10) + 1911;
  updated = `${y}/${updated.slice(3, 5)}/${updated.slice(5, 7)}`;
} else if (!updated) {
  updated = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
}

const out = {
  updated,
  fetchedAt: new Date().toISOString(),
  count: Object.keys(stocks).length,
  stocks,
};

await mkdir('data', { recursive: true });
await writeFile('data/stocks.json', JSON.stringify(out));
console.log(`✅ 已更新 data/stocks.json:${out.count} 檔股票,資料日期 ${updated}`);
