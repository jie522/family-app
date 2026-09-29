/* 極簡 IndexedDB 鍵值存取(單一 object store 'kv') */
const IDB = {
  _db: null,
  open() {
    if (!this._db) {
      this._db = new Promise((resolve, reject) => {
        const req = indexedDB.open('famiap', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._db;
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },
};

/* 資料儲存:localStorage 包裝 + 匯出匯入
 * 家電清單例外:照片/附件動輒上百 KB,iPhone Safari 的 localStorage 只有約 5MB,
 * 一兩筆就塞爆,之後每次存檔都丟 QuotaExceededError、畫面上什麼都沒發生
 * (看起來就像「沒辦法上傳照片」)。所以家電改存 IndexedDB(可用空間大很多),
 * 記憶體裡留一份快取,讓 load() 維持同步呼叫、其他程式不用改。
 * 啟動時要先 await Store.init() 把資料讀進快取,才能讀家電清單。 */
const Store = {
  KEYS: { shows: 'fam.shows', stocks: 'fam.stocks', appliances: 'fam.appliances', settings: 'fam.settings', pendingSync: 'fam.pendingSync' },
  IDB_KEYS: ['appliances'],
  cache: {},
  idbOk: false,

  async init() {
    try { await IDB.open(); this.idbOk = true; } catch { this.idbOk = false; }
    if (!this.idbOk) return; // 開不了 IndexedDB(極少數瀏覽器/隱私模式)就退回 localStorage
    for (const key of this.IDB_KEYS) {
      let val;
      try { val = await IDB.get(key); } catch { val = undefined; }
      const legacy = localStorage.getItem(this.KEYS[key]);
      if (val === undefined && legacy) {
        // 舊版存在 localStorage 的資料搬進 IndexedDB
        try { val = JSON.parse(legacy); await IDB.set(key, val); } catch { /* 搬失敗就先用記憶體裡的 */ }
      }
      // 搬完(或 IndexedDB 已經有資料)就刪掉 localStorage 那份,把配額還回去
      if (legacy && val !== undefined) localStorage.removeItem(this.KEYS[key]);
      this.cache[key] = val;
    }
  },

  usesIdb(key) { return this.idbOk && this.IDB_KEYS.includes(key); },

  load(key, fallback) {
    if (this.usesIdb(key)) return this.cache[key] ?? fallback;
    try {
      const raw = localStorage.getItem(this.KEYS[key]);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  save(key, value) {
    if (this.usesIdb(key)) {
      this.cache[key] = value;
      IDB.set(key, value).catch(() => toast('⚠️ 手機儲存失敗,這次的變更只暫存在畫面上'));
      return;
    }
    try {
      localStorage.setItem(this.KEYS[key], JSON.stringify(value));
    } catch {
      // 以前這裡直接丟例外,後面的程式整段不跑,使用者只看到「按了沒反應」
      toast('⚠️ 手機儲存空間不足,這次的變更沒存進手機');
    }
  },

  exportAll() {
    const data = {
      app: 'FAMIAP',
      version: 1,
      exportedAt: new Date().toISOString(),
      shows: this.load('shows', []),
      stocks: this.load('stocks', []),
      appliances: this.load('appliances', []),
      settings: this.load('settings', {}),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `FAMIAP備份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  importAll(file, done) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        // 舊版備份檔的 app 標記是「家庭小站」,改名後仍要能匯入
        if (!data || (data.app !== 'FAMIAP' && data.app !== '家庭小站')) throw new Error('格式不對');
        if (Array.isArray(data.shows)) this.save('shows', data.shows);
        if (Array.isArray(data.stocks)) this.save('stocks', data.stocks);
        if (Array.isArray(data.appliances)) this.save('appliances', data.appliances);
        if (data.settings) this.save('settings', data.settings);
        done(true);
      } catch {
        done(false);
      }
    };
    reader.readAsText(file);
  },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2300);
}

/* 極簡 Markdown → HTML(標題/粗斜體/清單/連結/引用/程式碼) */
function mdToHtml(md) {
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // 知識庫站內連結:[顯示文字](k:slug) → 給 JS 攔截,不整頁跳轉
    .replace(/\[([^\]]+)\]\(k:([a-z0-9-]+)\)/g,
      '<a href="#" class="k-link" data-k="$2">$1</a>')
    // 跳去股票詳情頁:[顯示文字](s:代號)
    .replace(/\[([^\]]+)\]\(s:(\d{4,6})\)/g,
      '<a href="#" class="s-link" data-s="$2">$1</a>');

  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  let inList = false, para = [];
  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
  };
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      flushPara(); closeList();
      const lv = m[1].length + 1; // # → h2,避免跟頁面 h1 打架
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
    } else if ((m = line.match(/^>\s?(.*)/))) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = line.match(/^[-*]\s+(.*)/))) {
      flushPara();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (/^---+$/.test(line.trim())) {
      flushPara(); closeList();
      out.push('<hr>');
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara(); closeList();
  return out.join('\n');
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* 自己畫的下拉建議清單,取代原生 <input list> + <datalist>——iOS Safari 對 datalist
 * 支援不穩定(常常整個不顯示、或沒有任何提示看得出來有下拉選單可以點),換成自己畫的
 * 清單,行為在所有瀏覽器一致,也比較看得出來「這裡有東西可以選」。
 * getOptions() 每次都重新呼叫,才會抓到當下最新的歷史值清單。 */
function bindAutocomplete(input, getOptions) {
  if (!input) return;
  const box = document.createElement('div');
  box.className = 'ac-list hidden';
  input.insertAdjacentElement('afterend', box);

  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    const opts = getOptions().filter(v => !q || (v.toLowerCase().includes(q) && v.toLowerCase() !== q));
    if (!opts.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = opts.map(v => `<button type="button" class="ac-item">${esc(v)}</button>`).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('.ac-item').forEach(btn =>
      // mousedown(不是 click)搶在 input 的 blur 事件關掉清單之前先觸發,不然點了沒反應
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = btn.textContent;
        box.classList.add('hidden');
        input.dispatchEvent(new Event('input', { bubbles: true })); // 讓原本監聽 input 的存檔邏輯照常觸發
      }));
  };
  input.addEventListener('focus', renderList);
  input.addEventListener('input', renderList);
  input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
}
