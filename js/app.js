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
  shows: { title: '追劇清單', add: () => Shows.openAdd() },
  stocks: { title: '台股追蹤', add: () => Stocks.openAdd() },
  settings: { title: '設定', add: null },
};
let currentPage = 'shows';

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + page));
  document.getElementById('header-title').textContent = PAGES[page].title;
  document.getElementById('header-action').classList.toggle('hidden', !PAGES[page].add);
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
  tmdbStatus.textContent = key ? '✅ 已設定金鑰,搜尋劇名會自動抓海報' : '尚未設定金鑰';
  if (key) tmdbInput.value = key;
}

document.getElementById('save-tmdb').addEventListener('click', () => {
  const settings = Store.load('settings', {});
  settings.tmdbKey = tmdbInput.value.trim();
  Store.save('settings', settings);
  refreshTmdbStatus();
  toast(settings.tmdbKey ? '金鑰已儲存' : '金鑰已清除');
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
Shows.render();
Stocks.init();
switchPage('shows');
