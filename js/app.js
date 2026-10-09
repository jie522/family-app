/* 主程式:頁籤切換、彈窗、設定 */
const Modal = {
  scrollY: 0,
  open(html) {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    modal.innerHTML = html;
    backdrop.classList.remove('hidden');
    modal.scrollTop = 0; // 不然會沿用上一個彈窗捲到的位置,一打開就停在半中間
    modal.querySelectorAll('[data-close]').forEach(el =>
      el.addEventListener('click', () => this.close()));
    // 鎖住手機版背景頁面:遮罩雖然是 position:fixed,但 iOS Safari 光靠這個蓋不住底下
    // body 還是能被拖動捲動/彈跳的問題(彈窗開著時在內容上按住移動,畫面會跟著跑)。
    // 連 body 本身也固定住,關閉時再還原到原本捲動的位置。
    this.scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${this.scrollY}px`;
    document.body.style.width = '100%';
  },
  /* 從一個彈窗換到另一個彈窗:先關再開,不然 open() 會把「已經被鎖住的 body」
     當成捲動位置 0 記下來,關掉後頁面跳回最上面 */
  swap(html) {
    if (!document.getElementById('modal-backdrop').classList.contains('hidden')) this.close();
    this.open(html);
  },
  close() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal').innerHTML = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, this.scrollY);
  },
};

document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target.id === 'modal-backdrop') Modal.close();
});

/* ---------- 頁籤 ---------- */
const PAGES = {
  stocks: { title: '台股追蹤', add: () => Stocks.openAdd() },
  shows: { title: '追劇清單', add: () => Shows.openAdd() },
  appliances: { title: '家電清單', add: () => Appliances.openAdd() },
  food: { title: '美食地圖', add: () => Food.openAdd() },
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
  if (page === 'food') Food.onShow(); // 每次打開都重新定位,看看是不是人就在哪間店附近
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

/* ---------- 追劇搜尋(劇名/平台/筆記,在目前選的分類內找) ---------- */
document.getElementById('show-search').addEventListener('input', e => {
  Shows.search = e.target.value;
  Shows.render();
});

/* ---------- 家電搜尋(名稱/品牌/分類/備註) ---------- */
document.getElementById('appliance-search').addEventListener('input', e => {
  Appliances.search = e.target.value;
  Appliances.render();
});

/* ---------- 美食地圖:地圖/想吃/吃過/紀錄切換、搜尋、定位 ---------- */
document.querySelectorAll('#food-view button').forEach(btn =>
  btn.addEventListener('click', () => {
    Food.view = btn.dataset.view;
    Food.render();
    if (Food.view === 'map') Food.ensureMap();
  }));
document.getElementById('food-search').addEventListener('input', e => {
  Food.search = e.target.value;
  Food.render();
});
document.getElementById('food-relocate').addEventListener('click', () => Food.relocate(true));
document.getElementById('food-locate').addEventListener('click', () => Food.relocate(true));
// App 從背景切回來(例如走進店裡才打開手機)時,如果停在美食頁就再比對一次附近的店
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentPage === 'food') Food.relocate(false);
});

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
    if (Sheets.scriptOld != null) syncStatus.textContent += `
⚠️ Apps Script 是舊版 v${Sheets.scriptOld},需要 v${Sheets.SCRIPT_VERSION}:新功能(家電附件/維修紀錄/美食地圖)不會寫進 Sheet,請重新部署`;
  } else {
    syncStatus.textContent = '尚未啟用,目前資料只存在這支手機';
  }
}

async function pullAndRender(quiet) {
  try {
    await Sheets.flushPending(); // 先補送上次來不及送出的變更,免得等一下被 pull() 的舊資料蓋掉
    await Sheets.pull();
    await Sheets.checkVersion(); // 部署的 Apps Script 太舊的話,在狀態列明講,不要讓使用者只看到莫名其妙的同步失敗
    if (!quiet && Sheets.heldKeys().size) toast('⚠️ 有變更還沒同步成功,這些資料先保留手機上的版本,沒有被覆蓋');
    Shows.render();
    Stocks.render();
    Appliances.render();
    Food.render();
    refreshSyncStatus();
    return true;
  } catch {
    if (!quiet) toast('⚠️ 讀取 Google Sheet 失敗,顯示手機上的資料');
    return false;
  }
}

/* App 從背景切回來時自動重抓一次 Sheet:家人在別支手機新增的店、維修紀錄就會自己出現,
 * 不用每次都跑去設定頁按「立即同步」。重抓前會先補送這支手機還沒送出的變更。
 * 有彈窗開著(正在編輯)就先不抓——pull 會把本機清單整批換成 Sheet 的版本,
 * 彈窗裡拿著的是舊資料,存檔時會把剛抓下來的蓋回去。 */
let lastAutoPull = Date.now(), autoPulling = false;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !Sheets.enabled() || autoPulling) return;
  if (Date.now() - lastAutoPull < 30000) return;
  if (!document.getElementById('modal-backdrop').classList.contains('hidden')) return;
  autoPulling = true;
  try { await pullAndRender(true); } finally { lastAutoPull = Date.now(); autoPulling = false; }
});

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
  const localAppliances = Store.load('appliances', []);
  const localFood = Store.load('foodPlaces', []);
  const total = localShows.length + localStocks.length + localAppliances.length + localFood.length;
  if (total && confirm(`連線成功!要把這支手機現有的 ${localShows.length} 部劇 + ${localStocks.length} 檔股票 + ${localAppliances.length} 項家電 + ${localFood.length} 間美食店家上傳到 Google Sheet 嗎?\n(家人的手機第一次啟用時選「取消」就好)`)) {
    syncStatus.textContent = '上傳中…';
    await Sheets.bulkUpload();
  }
  await pullAndRender();
  refreshTmdbStatus();
  toast('✅ 同步已啟用');
});

document.getElementById('sync-diag').addEventListener('click', async () => {
  const box = document.getElementById('sync-diag-result');
  box.textContent = '檢查中…';
  const lines = await Sheets.diagnose();
  box.innerHTML = lines.map(esc).join('<br>');
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
      Appliances.render();
      Food.render();
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
// 家電資料存在 IndexedDB(非同步),要先讀進快取才能畫、才能同步
Store.init().then(() => {
  Sheets.compactPending();
  Appliances.render();
  Food.render();
  if (Sheets.enabled()) pullAndRender();   // 再從 Google Sheet 抓最新資料
});
