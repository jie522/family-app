/* 家庭小站 - Google Sheet 寫入服務
 * 設定方式(一次性,約 5 分鐘):
 * 1. 打開追劇的 Google Sheet → 上方選單「擴充功能」→「Apps Script」
 * 2. 刪掉編輯器裡原本的內容,把這整份檔案貼上,按存檔(磁碟片圖示)
 * 3. 右上角「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」
 *    - 執行身分:我
 *    - 誰可以存取:所有人
 * 4. 按「部署」,授權自己的 Google 帳號,複製產生的「網頁應用程式 URL」
 * 5. 把 URL 貼到家庭小站 App 的「設定」頁 → Google Sheet 同步
 *
 * 選用:TMDB 海報代理(設定一次,全家都不用各自貼金鑰)
 * 6. 左側選單齒輪圖示「專案設定」→ 拉到最下面「指令碼屬性」→ 新增指令碼屬性
 *    屬性:TMDB_KEY,值:貼上你的 TMDB API Key(v3)
 *    存檔即可,不用重新部署。金鑰只存在這裡,不會出現在原始碼或 GitHub 上。
 */

var VERSION = 8; // 每次改這份檔案就 +1,ping 會回傳,用來確認部署的是新版

var SHOW_TAB = '劇集庫';
var SHOW_HEADERS = ['劇名', '平台', '狀態', '評分', '筆記', '海報', '年份', '類型', '簡介', 'TMDBID', '更新時間'];
var STOCK_TAB = '股票追蹤';
var STOCK_HEADERS = ['代號', '名稱', '筆記', '更新時間'];
var REPORT_TAB = 'FAMAILY APP - 股票'; // 股票分析報告鏡像(reports/ 資料夾內容的雲端備份)
var REPORT_HEADERS = ['代號', '日期', '標題', '內容', '更新時間'];

function logSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; // 第一個分頁:日期,劇名,平台,備註
}

function showSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHOW_TAB);
  if (!sh) {
    sh = ss.insertSheet(SHOW_TAB);
    sh.appendRow(SHOW_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function stockSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STOCK_TAB);
  if (!sh) {
    sh = ss.insertSheet(STOCK_TAB);
    sh.appendRow(STOCK_HEADERS);
    sh.setFrozenRows(1);
  }
  // 代號欄強制文字格式,避免 0050 這類 ETF 代號被自動轉成數字 50
  sh.getRange('A:A').setNumberFormat('@');
  return sh;
}

function reportSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(REPORT_TAB);
  if (!sh) sh = ss.insertSheet(REPORT_TAB);
  if (sh.getLastRow() === 0) { // 分頁已存在但是空的(使用者手動建立的情況)
    sh.appendRow(REPORT_HEADERS);
    sh.setFrozenRows(1);
  }
  sh.getRange('A:A').setNumberFormat('@'); // 代號欄強制文字格式
  return sh;
}

function doPost(e) {
  var out;
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var req = JSON.parse(e.postData.contents);
    out = handle(req.action, req.data || {});
  } catch (err) {
    out = { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle(action, d) {
  switch (action) {
    case 'ping':
      // delOk=true 代表線上實際生效的 deleteReport 是新版(含 fmtDate)。
      // 若編輯器裡殘留舊程式碼,舊函式會蓋掉新函式,這裡就會是 false。
      return { ok: true, msg: 'pong', v: VERSION,
               delOk: deleteReport.toString().indexOf('fmtDate') !== -1 };
    case 'listReports': return listReports();
    case 'addLog':     addLog(d);      return { ok: true };
    case 'deleteLog':  deleteLog(d);   return { ok: true };
    case 'upsertShow': upsertShow(d);  return { ok: true };
    case 'deleteShow': deleteShow(d);  return { ok: true };
    case 'upsertStock': upsertStock(d); return { ok: true };
    case 'deleteStock': deleteStock(d); return { ok: true };
    case 'tmdbSearch': return tmdbSearch(d);
    case 'quotes':     return quotes(d);
    case 'upsertReport': upsertReport(d); return { ok: true };
    case 'deleteReport': deleteReport(d); return { ok: true };
    case 'bulk':       bulk(d);        return { ok: true };
    default:           return { ok: false, error: 'unknown action' };
  }
}

function fmtDate(v) {
  // 不用 instanceof Date:在 Apps Script 執行環境會失效(getValues 回傳的
  // Date 來自另一個 context),改用鴨子判斷(有 getTime 方法就是日期)
  if (v && typeof v.getTime === 'function') {
    // 用「試算表」的時區,不用「指令碼專案」的時區——後者預設常是美國時區,
    // 跟台北差 12 小時會讓日期差一天,比對永遠失敗
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(new Date(v.getTime()), tz, 'yyyy-MM-dd');
  }
  return String(v || '').trim();
}

/* ---------- 觀看紀錄 ---------- */
function addLog(d) {
  logSheet().appendRow([d.date || '', d.title || '', d.platform || '', d.note || '']);
}

function logExists(rows, d) {
  for (var i = 1; i < rows.length; i++) {
    if (fmtDate(rows[i][0]) === fmtDate(d.date) &&
        String(rows[i][1]).trim() === String(d.title).trim() &&
        String(rows[i][3] || '') === String(d.note || '')) return true;
  }
  return false;
}

function deleteLog(d) {
  var sh = logSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (fmtDate(rows[i][0]) === fmtDate(d.date) &&
        String(rows[i][1]).trim() === String(d.title).trim() &&
        String(rows[i][3] || '') === String(d.note || '')) {
      sh.deleteRow(i + 1);
      return;
    }
  }
}

/* ---------- 劇集庫 ---------- */
function showRowValues(d) {
  return [d.title || '', d.platform || '', d.status || '追劇中', d.rating || 0,
          d.notes || '', d.poster || '', d.year || '', d.type || '影集',
          d.overview || '', d.tmdbId || '', new Date()];
}

function upsertShow(d) {
  var sh = showSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(d.title).trim()) {
      sh.getRange(i + 1, 1, 1, SHOW_HEADERS.length).setValues([showRowValues(d)]);
      return;
    }
  }
  sh.appendRow(showRowValues(d));
}

function deleteShow(d) {
  var title = String(d.title).trim();
  var sh = showSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === title) sh.deleteRow(i + 1);
  }
  // 同時刪掉這部劇的觀看紀錄,不然 App 讀取時會把它復活
  var ls = logSheet();
  var lrows = ls.getDataRange().getValues();
  for (var j = lrows.length - 1; j >= 1; j--) {
    if (String(lrows[j][1]).trim() === title) ls.deleteRow(j + 1);
  }
}

/* ---------- 股票追蹤清單 ---------- */
function stockRowValues(d) {
  return [d.code || '', d.name || '', d.notes || '', new Date()];
}

function upsertStock(d) {
  var sh = stockSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(d.code).trim()) {
      sh.getRange(i + 1, 1, 1, STOCK_HEADERS.length).setValues([stockRowValues(d)]);
      return;
    }
  }
  sh.appendRow(stockRowValues(d));
}

function deleteStock(d) {
  var code = String(d.code).trim();
  var sh = stockSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === code) sh.deleteRow(i + 1);
  }
}

/* ---------- 股票分析報告(reports/ 資料夾內容的雲端鏡像) ---------- */
function reportRowValues(d) {
  return [d.code || '', d.date || '', d.title || '', d.content || '', new Date()];
}

function upsertReport(d) {
  var sh = reportSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    // 日期一定要用 fmtDate 比對:Sheets 會把「2026-07-14」自動轉成日期物件
    if (String(rows[i][0]).trim() === String(d.code).trim() &&
        fmtDate(rows[i][1]) === fmtDate(d.date)) {
      sh.getRange(i + 1, 1, 1, REPORT_HEADERS.length).setValues([reportRowValues(d)]);
      return;
    }
  }
  sh.appendRow(reportRowValues(d));
}

function deleteReport(d) {
  var sh = reportSheet();
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === String(d.code).trim() &&
        fmtDate(rows[i][1]) === fmtDate(d.date)) {
      sh.deleteRow(i + 1);
    }
  }
}

/* 列出報告分頁裡每一列的代號和日期(以指令碼自己看到的樣子回傳,除錯用) */
function listReports() {
  var rows = reportSheet().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    out.push({ row: i + 1, code: String(rows[i][0]), date: fmtDate(rows[i][1]), title: String(rows[i][2]) });
  }
  return { ok: true, reports: out };
}

/* ---------- TMDB 海報代理(金鑰存在指令碼屬性,不進原始碼) ---------- */
function tmdbSearch(d) {
  var key = PropertiesService.getScriptProperties().getProperty('TMDB_KEY');
  if (!key) return { ok: false, error: 'NO_KEY' };
  var q = String(d.query || '').trim();
  if (!q) return { ok: true, results: [] };

  var url = 'https://api.themoviedb.org/3/search/multi?api_key=' + encodeURIComponent(key) +
    '&language=zh-TW&include_adult=false&query=' + encodeURIComponent(q);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code === 401) return { ok: false, error: 'BAD_KEY' };
  if (code !== 200) return { ok: false, error: 'HTTP_' + code };

  var data = JSON.parse(res.getContentText());
  var results = (data.results || [])
    .filter(function (r) { return r.media_type === 'tv' || r.media_type === 'movie'; })
    .slice(0, 10)
    .map(function (r) {
      return {
        tmdbId: r.id,
        type: r.media_type,
        title: r.name || r.title || '(無標題)',
        year: (r.first_air_date || r.release_date || '').slice(0, 4),
        poster: r.poster_path ? 'https://image.tmdb.org/t/p/w342' + r.poster_path : '',
        overview: r.overview || '',
      };
    });
  return { ok: true, results: results };
}

/* ---------- 即時報價代理 ----------
 * 瀏覽器因跨域限制不能直接抓,由這裡代抓再回傳給 App。
 * 主要來源:證交所官方即時 API(mis.twse.com.tw,約延遲 5 秒);
 * 上市用 tse_、查不到再試上櫃 otc_;都失敗才退到 Yahoo(GAS 常被 Yahoo 擋,僅備援)。 */
function quotes(d) {
  var codes = (d.codes || []).slice(0, 30).map(String);
  if (!codes.length) return { ok: true, quotes: {} };
  var out = {};
  fetchTwseMis(codes, 'tse', out);
  var misses = codes.filter(function (c) { return !out[c]; });
  if (misses.length) fetchTwseMis(misses, 'otc', out);
  misses = codes.filter(function (c) { return !out[c]; });
  if (misses.length) fetchYahooBatch(misses, '.TW', out);
  misses = codes.filter(function (c) { return !out[c]; });
  if (misses.length) fetchYahooBatch(misses, '.TWO', out);
  return { ok: true, quotes: out };
}

function fetchTwseMis(codes, market, out) {
  var exCh = codes.map(function (c) { return market + '_' + c + '.tw'; }).join('|');
  var url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + exCh +
    '&json=1&delay=0&_=' + Date.now();
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return;
    var arr = JSON.parse(res.getContentText()).msgArray || [];
    arr.forEach(function (s) {
      var last = parseFloat(s.z); // 最新成交價;沒成交時是 '-'
      if (isNaN(last)) last = parseFloat(String(s.b || '').split('_')[0]); // 用最佳買價替代
      if (isNaN(last)) last = parseFloat(s.y);
      if (isNaN(last)) return;
      out[s.c] = {
        c: last,
        y: parseFloat(s.y) || null,
        o: parseFloat(s.o) || null,
        h: parseFloat(s.h) || null,
        l: parseFloat(s.l) || null,
        v: s.v ? parseInt(s.v, 10) * 1000 : null, // 證交所回傳單位是「張」,轉成股數
        t: s.t || null,
      };
    });
  } catch (e) { /* 連不上就交給後面的備援 */ }
}

function fetchYahooBatch(codes, suffix, out) {
  var reqs = codes.map(function (c) {
    return {
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(c) + suffix + '?interval=1d&range=1d',
      muteHttpExceptions: true,
    };
  });
  var resps;
  try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) { return; }
  for (var i = 0; i < resps.length; i++) {
    var q = parseYahooChart(resps[i]);
    if (q) out[codes[i]] = q;
  }
}

function parseYahooChart(resp) {
  try {
    if (resp.getResponseCode() !== 200) return null;
    var r = JSON.parse(resp.getContentText()).chart.result[0];
    var m = r.meta || {};
    if (m.regularMarketPrice == null) return null;
    var arr = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    return {
      c: m.regularMarketPrice,                                        // 最新成交價
      y: m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose, // 昨收
      o: (arr.open && arr.open[0] != null) ? arr.open[0] : null,      // 今日開盤
      h: m.regularMarketDayHigh != null ? m.regularMarketDayHigh : null,
      l: m.regularMarketDayLow != null ? m.regularMarketDayLow : null,
      v: m.regularMarketVolume != null ? m.regularMarketVolume : null, // 累積成交股數
      t: m.regularMarketTime != null ? m.regularMarketTime : null,     // 報價時間(unix 秒)
    };
  } catch (e) { return null; }
}

/* ---------- 整批上傳(啟用同步時搬資料) ---------- */
function bulk(d) {
  (d.shows || []).forEach(function (s) { upsertShow(s); });
  var rows = logSheet().getDataRange().getValues();
  (d.logs || []).forEach(function (l) {
    if (!logExists(rows, l)) {
      addLog(l);
      rows.push([l.date, l.title, l.platform || '', l.note || '']);
    }
  });
  (d.stocks || []).forEach(function (s) { upsertStock(s); });
}
