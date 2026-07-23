/* 主程式:頁籤切換、彈窗、設定 */
const Modal = {
  open(html) {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    modal.innerHTML = html;
    backdrop.classList.remove('hidden');
    modal.querySelectorAll('[data-close]').forEach(el =>
      el.addEventListener('click', () => this.close()));
  },
  close() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal').innerHTML = '';
  },
};

document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target.id === 'modal-backdrop') Modal.close();
});

/* ---------- 頁籤 ---------- */
const PAGES = {
  stocks: { title: '台股追蹤', add: () => Stocks.openAdd() },
  shows: { title: '追劇清單', add: () => Shows.openAdd() },
  knowledge: { title: '知識庫', add: null },
  settings: { title: '設定', add: null },
};
let currentPage = 'stocks';
let knowledgeLoaded = false;

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + page));
  document.getElementById('header-title').textContent = PAGES[page].title;
  document.getElementById('header-action').classList.toggle('hidden', !PAGES[page].add);
  if (page === 'knowledge' && !knowledgeLoaded) {
    knowledgeLoaded = true;
    Knowledge.render();
  }
}

document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => switchPage(tab.dataset.page)));

document.getElementById('header-action').addEventListener('click', () => {
  const fn = PAGES[currentPage].add;
  if (fn) fn();
});

/* ---------- 追劇篩選 ---------- */
document.querySelectorAll('#show-filter button').forEach(btn =>
  btn.addEventListener('click', () => {
    Shows.filter = btn.dataset.status;
    syncFilterUI();
    Shows.render();
  }));

/* ---------- 設定頁 ---------- */
const tmdbInput = document.getElementById('tmdb-key');
const tmdbStatus = document.getElementById('tmdb-status');

function refreshTmdbStatus() {
  const key = TMDB.key();
  if (key) {
    tmdbInput.value = key;
    tmdbStatus.textContent = '✅ 這支手機已設定金鑰,搜尋劇名會自動抓海報';
  } else if (Sheets.enabled()) {
    tmdbStatus.textContent = '這支手機沒貼金鑰,會改用 Google Sheet 同步的代理(若已在 Apps Script 設定 TMDB_KEY 就能正常抓海報)';
  } else {
    tmdbStatus.textContent = '尚未設定金鑰';
  }
}

document.getElementById('save-tmdb').addEventListener('click', () => {
  const settings = Store.load('settings', {});
  settings.tmdbKey = tmdbInput.value.trim();
  Store.save('settings', settings);
  refreshTmdbStatus();
  toast(settings.tmdbKey ? '金鑰已儲存' : '金鑰已清除');
});

/* ---------- Google Sheet 同步 ---------- */
const scriptInput = document.getElementById('script-url');
const syncStatus = document.getElementById('sync-status');

function refreshSyncStatus() {
  const s = Store.load('settings', {});
  if (Sheets.enabled()) {
    scriptInput.value = Sheets.scriptUrl();
    const t = s.lastSync ? new Date(s.lastSync).toLocaleString('zh-TW') : '尚未同步';
    syncStatus.textContent = `✅ 同步已啟用,上次讀取:${t}`;
  } else {
    syncStatus.textContent = '尚未啟用,目前資料只存在這支手機';
  }
}

async function pullAndRender() {
  try {
    await Sheets.pull();
    Shows.render();
    Stocks.render();
    refreshSyncStatus();
    return true;
  } catch {
    toast('⚠️ 讀取 Google Sheet 失敗,顯示手機上的資料');
    return false;
  }
}

document.getElementById('save-script').addEventListener('click', async () => {
  const url = scriptInput.value.trim();
  const settings = Store.load('settings', {});
  if (!url) {
    delete settings.scriptUrl;
    Store.save('settings', settings);
    refreshSyncStatus();
    refreshTmdbStatus();
    toast('已停用同步');
    return;
  }
  if (!/^https:\/\/script\.google(?:usercontent)?\.com\//.test(url)) {
    toast('網址看起來不對,應該是 script.google.com 開頭');
    return;
  }
  settings.scriptUrl = url;
  Store.save('settings', settings);
  syncStatus.textContent = '測試連線中…';
  const ok = await Sheets.push('ping', {});
  if (!ok) {
    syncStatus.textContent = '❌ 連不上 Apps Script,請確認部署時「誰可以存取」選了「所有人」';
    return;
  }
  const localShows = Store.load('shows', []);
  const localStocks = Store.load('stocks', []);
  const total = localShows.length + localStocks.length;
  if (total && confirm(`連線成功!要把這支手機現有的 ${localShows.length} 部劇 + ${localStocks.length} 檔股票上傳到 Google Sheet 嗎?\n(家人的手機第一次啟用時選「取消」就好)`)) {
    syncStatus.textContent = '上傳中…';
    await Sheets.bulkUpload();
  }
  await pullAndRender();
  refreshTmdbStatus();
  toast('✅ 同步已啟用');
});

document.getElementById('sync-now').addEventListener('click', async () => {
  syncStatus.textContent = '同步中…';
  if (await pullAndRender()) toast('已同步最新資料');
  else refreshSyncStatus();
});

document.getElementById('export-data').addEventListener('click', () => Store.exportAll());
document.getElementById('import-data').addEventListener('click', () =>
  document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('匯入會覆蓋這支手機目前的資料,確定嗎?')) { e.target.value = ''; return; }
  Store.importAll(file, ok => {
    if (ok) {
      Shows.render();
      Stocks.render();
      refreshTmdbStatus();
      toast('匯入成功!');
    } else {
      toast('匯入失敗:檔案格式不對');
    }
    e.target.value = '';
  });
});

/* ---------- 啟動 ---------- */
refreshTmdbStatus();
refreshSyncStatus();
Shows.render();          // 先用本機快取畫面
Stocks.init();
switchPage('stocks');
if (Sheets.enabled()) pullAndRender();   // 再從 Google Sheet 抓最新資料
