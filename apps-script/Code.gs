/* 家庭小站 - Google Sheet 寫入服務
 * 設定方式(一次性,約 5 分鐘):
 * 1. 打開追劇的 Google Sheet → 上方選單「擴充功能」→「Apps Script」
 * 2. 刪掉編輯器裡原本的內容,把這整份檔案貼上,按存檔(磁碟片圖示)
 * 3. 右上角「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」
 *    - 執行身分:我
 *    - 誰可以存取:所有人
 * 4. 按「部署」,授權自己的 Google 帳號,複製產生的「網頁應用程式 URL」
 * 5. 把 URL 貼到家庭小站 App 的「設定」頁 → Google Sheet 同步
 */

var SHOW_TAB = '劇集庫';
var SHOW_HEADERS = ['劇名', '平台', '狀態', '評分', '筆記', '海報', '年份', '類型', '簡介', 'TMDBID', '更新時間'];
var STOCK_TAB = '股票追蹤';
var STOCK_HEADERS = ['代號', '名稱', '筆記', '更新時間'];

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
    case 'ping':       return { ok: true, msg: 'pong' };
    case 'addLog':     addLog(d);      return { ok: true };
    case 'deleteLog':  deleteLog(d);   return { ok: true };
    case 'upsertShow': upsertShow(d);  return { ok: true };
    case 'deleteShow': deleteShow(d);  return { ok: true };
    case 'upsertStock': upsertStock(d); return { ok: true };
    case 'deleteStock': deleteStock(d); return { ok: true };
    case 'bulk':       bulk(d);        return { ok: true };
    default:           return { ok: false, error: 'unknown action' };
  }
}

function fmtDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
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
