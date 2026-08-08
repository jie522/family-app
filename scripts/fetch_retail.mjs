/* 抓取散戶動向的兩個代理指標,只針對 reports/manifest.json 裡有追蹤的股票,
 * 逐次累積進 data/retail.json(rolling window)。
 * 由 GitHub Actions 每交易日執行,也可以在本機執行:node scripts/fetch_retail.mjs
 *
 * ⚠️ 台股沒有官方的「個股散戶買賣超」資料,證交所只公布三大法人。
 * 這裡收的是市場公認的兩個散戶代理指標:
 *   1. 融資餘額(每日):借錢買股票的槓桿資金,絕大多數是散戶。餘額增加=散戶加碼,減少=散戶退場。
 *   2. 集保股權分散表(每週五):散戶(持股 10 張以下)與大戶(400 張以上)的持股比例,看籌碼集中度。
 * 兩者都是推估,不是真的散戶買賣超,前端文案要講清楚。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const MAX_MARGIN_DAYS = 60;   // 融資餘額保留的交易日數
const MAX_HOLDER_WEEKS = 26;  // 集保股權分散保留的週數(約半年)

// 上市融資融券餘額(沒有日期欄位,日期沿用 data/stocks.json 的 updated)
const MARGIN_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
// 上櫃融資融券餘額
const OTC_MARGIN_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance';
// 集保結算所股權分散表(上市+上櫃同一份,每週五收盤後更新,約 2.3MB)
const TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';

// 集保持股分級代碼:1=1-999股,2=1~5張,3=5~10張 …… 15=1000張以上,16=差異調整,17=合計
const RETAIL_LEVELS = new Set([1, 2, 3]);          // 散戶:持股 10 張以下
const BIG_LEVELS = new Set([12, 13, 14, 15]);      // 大戶:持股 400 張以上

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

async function getTextSoft(url, label) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.log(`⚠️ ${label} 抓取失敗,這次先跳過(${err.message})`);
    return null;
  }
}

const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

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
  console.log('目前 reports/manifest.json 是空的,沒有股票要抓散戶資料。');
  process.exit(0);
}
const tracked = new Set(trackedCodes);

const isoDate = stocksData.updated.replace(/\//g, '-'); // YYYY-MM-DD

let history = {};
try {
  history = JSON.parse(await readFile('data/retail.json', 'utf8'));
} catch { /* 第一次執行,還沒有檔案 */ }

const entry = (code) => (history[code] ||= { margin: [], holders: [] });

/* 把一筆資料 append 進序列,同一個日期重跑就覆蓋,並裁切到上限 */
function pushPoint(list, point, max) {
  const last = list[list.length - 1];
  if (last && last.d === point.d) Object.assign(last, point);
  else list.push(point);
  return list.slice(-max);
}

/* ---------- 1. 融資餘額(每日) ---------- */
const marginByCode = {};

const twMargin = await getJsonSoft(MARGIN_URL, '上市融資融券餘額');
if (Array.isArray(twMargin)) {
  for (const r of twMargin) {
    const code = String(r['股票代號'] || '').trim();
    if (!tracked.has(code)) continue;
    const bal = num(r['融資今日餘額']);
    const prev = num(r['融資前日餘額']);
    if (bal == null) continue;
    marginByCode[code] = { bal, chg: prev == null ? null : bal - prev };
  }
}

const otcMargin = await getJsonSoft(OTC_MARGIN_URL, '上櫃融資融券餘額');
if (Array.isArray(otcMargin)) {
  for (const r of otcMargin) {
    const code = String(r.SecuritiesCompanyCode || '').trim();
    if (!tracked.has(code) || marginByCode[code]) continue; // 代號重複時以上市優先
    const bal = num(r.MarginPurchaseBalance);
    const prev = num(r.MarginPurchaseBalancePreviousDay);
    if (bal == null) continue;
    marginByCode[code] = { bal, chg: prev == null ? null : bal - prev };
  }
}

let marginCount = 0;
for (const [code, m] of Object.entries(marginByCode)) {
  const e = entry(code);
  e.margin = pushPoint(e.margin, { d: isoDate, bal: m.bal, chg: m.chg }, MAX_MARGIN_DAYS);
  marginCount++;
}

/* ---------- 2. 集保股權分散表(每週) ---------- */
const tdccCsv = await getTextSoft(TDCC_URL, '集保股權分散表');
let holderCount = 0;
if (tdccCsv) {
  // 每檔股票先累加散戶/大戶的持股比例與人數,再一次寫進 history
  const agg = {};
  let tdccDate = '';
  for (const line of tdccCsv.split('\n')) {
    const p = line.split(',');
    if (p.length < 6) continue;
    const code = String(p[1] || '').trim(); // 代號補空白到 6 碼,要 trim
    if (!tracked.has(code)) continue;
    const level = parseInt(p[2], 10);
    const people = num(p[3]);
    const pct = num(p[5]);
    if (!Number.isFinite(level) || pct == null) continue;
    if (!tdccDate) {
      const d = String(p[0] || '').trim();
      if (/^\d{8}$/.test(d)) tdccDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }
    const a = (agg[code] ||= { rp: 0, bp: 0, rn: 0 });
    if (RETAIL_LEVELS.has(level)) { a.rp += pct; a.rn += people || 0; }
    else if (BIG_LEVELS.has(level)) { a.bp += pct; }
  }

  if (tdccDate) {
    for (const [code, a] of Object.entries(agg)) {
      const e = entry(code);
      const point = {
        d: tdccDate,
        rp: Math.round(a.rp * 100) / 100,  // 散戶持股比例 %
        bp: Math.round(a.bp * 100) / 100,  // 大戶持股比例 %
        rn: a.rn,                          // 散戶人數
      };
      e.holders = pushPoint(e.holders, point, MAX_HOLDER_WEEKS);
      holderCount++;
    }
    console.log(`集保股權分散資料日期:${tdccDate}`);
  } else {
    console.log('⚠️ 集保資料裡找不到追蹤股票的資料日期,這次跳過');
  }
}

await mkdir('data', { recursive: true });
await writeFile('data/retail.json', JSON.stringify(history));
console.log(`✅ 已更新 data/retail.json:融資餘額 ${marginCount}/${trackedCodes.length} 檔(${isoDate})、集保股權分散 ${holderCount}/${trackedCodes.length} 檔`);
