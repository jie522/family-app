/* 抓取台灣證交所開放資料,整理成 data/stocks.json
 * 由 GitHub Actions 每交易日執行,也可以在本機執行:node scripts/fetch_stocks.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';

const DAY_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';   // 當日行情
const VAL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';      // 本益比/殖利率/淨值比
const INFO_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';           // 上市公司基本資料(產業別/股本/上市日期)

// 證交所產業別代碼表(isin.twse.com.tw 查詢頁下拉選單,穩定不太變,對照一次寫死)
const INDUSTRY_MAP = {
  '01': '水泥工業', '02': '食品工業', '03': '塑膠工業', '04': '紡織纖維',
  '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙工業',
  '10': '鋼鐵工業', '11': '橡膠工業', '12': '汽車工業', '13': '電子工業',
  '14': '建材營造業', '15': '航運業', '16': '觀光餐旅', '17': '金融保險業',
  '18': '貿易百貨業', '19': '綜合', '20': '其他業', '21': '化學工業',
  '22': '生技醫療業', '23': '油電燃氣業', '24': '半導體業', '25': '電腦及週邊設備業',
  '26': '光電業', '27': '通信網路業', '28': '電子零組件業', '29': '電子通路業',
  '30': '資訊服務業', '31': '其他電子業', '32': '文化創意業', '33': '農業科技業',
  '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活',
};

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

// 上市公司基本資料的日期是西元 YYYYMMDD(不是民國年)
const fmtDate8 = (v) => {
  const s = String(v || '').trim();
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

// 實收資本額(元)→ 股本(億元),四捨五入到小數 1 位
const capInBillion = (v) => {
  const n = num(v);
  return n != null ? Math.round(n / 1e8 * 10) / 10 : null;
};

const [dayRows, valRows, infoRows] = await Promise.all([getJson(DAY_URL), getJson(VAL_URL), getJson(INFO_URL)]);

const val = new Map(valRows.map(r => [r.Code, r]));
const info = new Map(infoRows.map(r => [r['公司代號'], r]));
const stocks = {};
let updated = '';

for (const r of dayRows) {
  if (!r.Code || !/^\d{4,6}$/.test(r.Code)) continue;
  const v = val.get(r.Code);
  const c = info.get(r.Code);
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
    ind: c ? (INDUSTRY_MAP[c['產業別']] || null) : null,        // 產業別
    ipo: c ? fmtDate8(c['上市日期']) : null,                     // 上市日期(YYYY-MM-DD)
    cap: c ? capInBillion(c['實收資本額']) : null,                // 股本(億元)
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
