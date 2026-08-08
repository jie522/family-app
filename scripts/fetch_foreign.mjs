/* 抓取三大法人(外資/投信/自營商)買賣超日報,只針對 reports/manifest.json 裡有追蹤的股票,
 * 逐日累積進 data/foreign.json(rolling window,最多留 60 個交易日)。
 * 前提:先跑過 scripts/fetch_stocks.mjs,寫好 data/stocks.json(要用裡面的 updated 日期)。
 * 由 GitHub Actions 每交易日執行,也可以在本機執行:node scripts/fetch_foreign.mjs
 *
 * 資料來源不是 openapi.twse.com.tw(那邊沒有三大法人買賣超的個股日報),
 * 是證交所/櫃買中心舊版報表服務,但一樣是公開、免登入、免金鑰的 JSON API。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const MAX_DAYS = 60; // 每檔股票最多保留的交易日數

// 上市:三大法人買賣超日報(依日期查詢,日期參數雖然是舊版報表但吃西元 yyyymmdd,不是民國年)
const twseUrl = (ymd) => `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALL&response=json`;
// 上櫃:三大法人買賣超日報(固定回傳最新一個交易日,不用帶日期)
const OTC_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading';

async function getJsonSoft(url, label) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.log(`⚠️ ${label} 抓取失敗,這次先跳過(${err.message})`);
    return null;
  }
}

const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// 西元 "YYYY/MM/DD" → "yyyymmdd"
function toYmd(westernSlash) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(westernSlash || ''));
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

let stocksData;
try {
  stocksData = JSON.parse(await readFile('data/stocks.json', 'utf8'));
} catch {
  console.log('⚠️ 讀不到 data/stocks.json,請先跑 scripts/fetch_stocks.mjs');
  process.exit(1);
}

const manifest = JSON.parse(await readFile('reports/manifest.json', 'utf8').catch(() => '{}'));
const trackedCodes = Object.keys(manifest);
if (!trackedCodes.length) {
  console.log('目前 reports/manifest.json 是空的,沒有股票要抓外資資料。');
  process.exit(0);
}

const isoDate = stocksData.updated.replace(/\//g, '-'); // YYYY-MM-DD,當作這次資料的日期戳記
const ymd = toYmd(stocksData.updated);

const netByCode = {};

// 上市(TWSE):外陸資(不含自營商)買賣超 + 外資自營商買賣超 = 一般俗稱的「外資買賣超」
if (ymd) {
  const t86 = await getJsonSoft(twseUrl(ymd), '上市三大法人買賣超(T86)');
  if (t86?.stat === 'OK' && Array.isArray(t86.data)) {
    for (const row of t86.data) {
      const code = row[0];
      const netForeign = (num(row[4]) || 0) + (num(row[7]) || 0);
      netByCode[code] = netForeign;
    }
  } else if (t86) {
    console.log(`⚠️ 上市三大法人買賣超今天沒有資料(可能非交易日):${t86.stat || ''}`);
  }
}

// 上櫃(TPEx):同樣邏輯,欄位名稱是英文
const otc = await getJsonSoft(OTC_URL, '上櫃三大法人買賣超');
if (Array.isArray(otc)) {
  for (const row of otc) {
    const code = row.SecuritiesCompanyCode;
    if (!code || !/^\d{4}$/.test(code) || netByCode[code] != null) continue; // 代號重複時以上市優先
    const netForeign = (num(row['ForeignInvestorsIncludeMainlandAreaInvestors-Difference']) || 0) +
      (num(row['ForeignDealers-Difference']) || 0);
    netByCode[code] = netForeign;
  }
}

let history = {};
try {
  history = JSON.parse(await readFile('data/foreign.json', 'utf8'));
} catch { /* 第一次執行,還沒有檔案 */ }

let updatedCount = 0;
for (const code of trackedCodes) {
  const net = netByCode[code];
  if (net == null) continue; // 抓不到就跳過,不補零,避免誤導成「今天賣超 0」
  const list = history[code] || [];
  if (list.length && list[list.length - 1].d === isoDate) {
    list[list.length - 1].n = net; // 同一天重跑,更新覆蓋掉
  } else {
    list.push({ d: isoDate, n: net });
  }
  history[code] = list.slice(-MAX_DAYS);
  updatedCount++;
}

await mkdir('data', { recursive: true });
await writeFile('data/foreign.json', JSON.stringify(history));
console.log(`✅ 已更新 data/foreign.json:${updatedCount}/${trackedCodes.length} 檔追蹤股票有新資料(${isoDate})`);
