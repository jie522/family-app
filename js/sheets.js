/* Google Sheet 雙向同步
 * 讀取:直接抓公開 Sheet 的 gviz CSV(不需任何金鑰)
 * 寫入:POST 到家裡自己部署的 Google Apps Script(見 apps-script/Code.gs)
 */
const Sheets = {
  SHEET_ID: '1rS_foFkuoFXVdK_9QxEFUFO7cPwwbX4Y8d7HY7yvIhI',
  LOG_GID: '0',          // 第一個分頁:日期,劇名,平台,備註
  SHOW_TAB: '劇集庫',     // App 自動建立的分頁:劇的狀態/評分/海報…
  STOCK_TAB: '股票追蹤',  // App 自動建立的分頁:代號/名稱/筆記
  SHOW_HEADER0: '劇名',   // 用來核對真的抓到「劇集庫」分頁(見 fetchNamedTab)
  STOCK_HEADER0: '代號',  // 用來核對真的抓到「股票追蹤」分頁
  STATUS_ZH: { want: '想看', watching: '追劇中', done: '看完' },

  settings() { return Store.load('settings', {}); },
  scriptUrl() { return (this.settings().scriptUrl || '').trim(); },
  enabled() { return !!this.scriptUrl(); },
  sheetUrl() { return `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/edit`; },

  /* ---------- 讀取 ---------- */
  async fetchCsv(tabParam) {
    const url = `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/gviz/tq?tqx=out:csv&${tabParam}&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) throw new Error('NOT_CSV'); // 極少數情況會回 HTML 錯誤頁
    return this.parseCsv(text);
  },

  /* 用「sheet=名稱」查不存在的分頁時,Google 不會報錯,而是靜默回傳第一個分頁的資料。
   * 所以額外用表頭第一格核對,確認真的抓到目標分頁,不然視同「分頁還沒建立」。 */
  async fetchNamedTab(tabName, expectedHeader0) {
    const rows = await this.fetchCsv(`sheet=${encodeURIComponent(tabName)}`);
    return (rows[0] && rows[0][0] === expectedHeader0) ? rows : null;
  },

  parseCsv(text) {
    const rows = [];
    let row = [], cell = '', inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuote = false;
        } else cell += ch;
      } else if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  },

  normDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return s;
  },

  zhToStatus(zh) {
    for (const [k, v] of Object.entries(this.STATUS_ZH)) if (v === zh) return k;
    return 'watching';
  },

  /* 從 Sheet 拉全部資料,組成 App 的劇清單/股票清單並存入本機快取 */
  async pull() {
    // 劇集庫分頁(可能還沒建立;null 代表分頁不存在)
    let showRows = null;
    try { showRows = await this.fetchNamedTab(this.SHOW_TAB, this.SHOW_HEADER0); }
    catch { showRows = null; }
    showRows = showRows || [];
    // 觀看紀錄分頁(用 gid 指定,一定存在,不會有分頁名稱誤判的問題)
    let logRows = [];
    try { logRows = await this.fetchCsv(`gid=${this.LOG_GID}`); }
    catch (e) { throw new Error('READ_LOG_FAIL'); }
    // 股票追蹤分頁(可能還沒建立;null 代表分頁不存在,保留手機上原本的清單)
    let stockRows = null;
    try { stockRows = await this.fetchNamedTab(this.STOCK_TAB, this.STOCK_HEADER0); }
    catch { stockRows = null; }

    const shows = new Map();
    // 劇集庫:劇名,平台,狀態,評分,筆記,海報,年份,類型,簡介,TMDBID
    showRows.slice(1).forEach(([title, platform, statusZh, rating, notes, poster, year, type, overview, tmdbId], i) => {
      title = (title || '').trim();
      if (!title) return;
      shows.set(title, {
        id: 't:' + title,
        title,
        platform: platform || '',
        status: this.zhToStatus(statusZh),
        rating: Math.max(0, Math.min(5, parseInt(rating, 10) || 0)),
        notes: notes || '',
        poster: poster || '',
        year: year || '',
        type: type === '電影' ? 'movie' : 'tv',
        overview: overview || '',
        tmdbId: tmdbId ? +tmdbId : null,
        log: [],
        addedAt: i + 1,
      });
    });

    // 觀看紀錄:日期,劇名,平台,備註 → 掛到對應的劇;沒建檔的劇自動出現
    logRows.slice(1).forEach(([date, title, platform, note], i) => {
      title = (title || '').trim();
      if (!title) return;
      if (!shows.has(title)) {
        shows.set(title, {
          id: 't:' + title, title, platform: platform || '',
          status: 'watching', rating: 0, notes: '', poster: '',
          year: '', type: 'tv', overview: '', tmdbId: null,
          log: [], addedAt: 1000 + i,
        });
      }
      shows.get(title).log.push({ date: this.normDate(date), text: note || '' });
    });

    const list = [...shows.values()];
    Store.save('shows', list);

    // 股票追蹤:代號,名稱,筆記
    let stocks = null;
    if (stockRows) {
      stocks = stockRows.slice(1)
        .map(([code, name, notes], i) => ({ code: (code || '').trim(), name: name || '', notes: notes || '', addedAt: i + 1 }))
        .filter(w => w.code);
      Store.save('stocks', stocks);
    }

    const s = this.settings();
    s.lastSync = new Date().toISOString();
    Store.save('settings', s);
    return { shows: list, stocks: stocks || Store.load('stocks', []) };
  },

  /* ---------- 寫入 / 呼叫 ---------- */
  /* 回傳完整 JSON(給需要拿結果的呼叫,例如 tmdbSearch);網址沒設定或連不上就丟錯 */
  async call(action, data) {
    const url = this.scriptUrl();
    if (!url) throw new Error('NO_SCRIPT_URL');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 preflight
      body: JSON.stringify({ action, data }),
    });
    return res.json();
  },

  /* 單純的寫入動作(新增/刪除/筆記…),只在乎成不成功 */
  async push(action, data) {
    if (!this.scriptUrl()) return false;
    try {
      const json = await this.call(action, data);
      return !!json.ok;
    } catch {
      return false;
    }
  },

  showToRow(s) {
    return {
      title: s.title,
      platform: s.platform || '',
      status: this.STATUS_ZH[s.status] || '追劇中',
      rating: s.rating || 0,
      notes: s.notes || '',
      poster: s.poster || '',
      year: s.year || '',
      type: s.type === 'movie' ? '電影' : '影集',
      overview: (s.overview || '').slice(0, 500),
      tmdbId: s.tmdbId || '',
    };
  },

  stockToRow(w) {
    return { code: w.code, name: w.name || '', notes: w.notes || '' };
  },

  /* 把本機資料整批上傳(啟用同步時的搬家、或同步失敗後的補救) */
  async bulkUpload() {
    const showList = Store.load('shows', []);
    const shows = showList.map(s => this.showToRow(s));
    const logs = [];
    for (const s of showList) {
      for (const e of (s.log || [])) {
        logs.push({ date: e.date, title: s.title, platform: s.platform || '', note: e.text });
      }
    }
    const stocks = Store.load('stocks', []).map(w => this.stockToRow(w));
    return this.push('bulk', { shows, logs, stocks });
  },
};
