/* 追劇清單模組 */
const Shows = {
  STATUS: { watching: '追劇中', want: '想看', done: '看完' },
  PLATFORMS: ['Netflix', 'Disney+', '愛奇藝', 'KKTV', 'friDay影音', 'Hami Video', 'YouTube', '電視'],
  filter: 'watching',

  list() { return Store.load('shows', []); },
  saveList(list) { Store.save('shows', list); },

  /* 最近一次觀看紀錄的日期(YYYY-MM-DD),沒記錄過就回傳 null */
  lastWatchDate(s) {
    const log = s.log || [];
    if (!log.length) return null;
    return log.reduce((max, e) => (e.date > max ? e.date : max), log[0].date);
  },

  /* 寫回 Google Sheet(未啟用同步時靜默略過) */
  sync(action, data) {
    if (!Sheets.enabled()) return;
    Sheets.push(action, data).then(ok => {
      if (!ok) toast('⚠️ 同步到 Google Sheet 失敗,資料先存在手機');
    });
  },

  render() {
    const grid = document.getElementById('show-grid');
    const empty = document.getElementById('show-empty');
    const all = this.list();
    let list = all;
    if (this.filter !== 'all') list = all.filter(s => s.status === this.filter);
    list.sort((a, b) => {
      const da = this.lastWatchDate(a) || '';
      const db = this.lastWatchDate(b) || '';
      if (da !== db) return db.localeCompare(da); // 依觀看日期新到舊排序
      return (b.addedAt || 0) - (a.addedAt || 0); // 都沒觀看紀錄時,退回新增時間排序
    });

    empty.classList.toggle('hidden', list.length > 0);
    empty.querySelector('p').innerHTML = all.length
      ? `「${this.STATUS[this.filter] || ''}」分類目前沒有劇`
      : '還沒有劇喔!<br>按右上角「＋」新增第一部劇';
    grid.innerHTML = list.map(s => {
      const poster = s.poster
        ? `<img class="show-poster" src="${esc(s.poster)}" alt="" loading="lazy">`
        : `<div class="show-poster placeholder">🎬</div>`;
      const stars = s.rating ? `<span class="stars-small">${'★'.repeat(s.rating)}</span>` : '';
      const chipCls = s.status === 'done' ? 'done' : s.status === 'want' ? 'want' : '';
      const watchDate = this.lastWatchDate(s);
      return `<button class="show-card" data-id="${esc(s.id)}">
        ${poster}
        <div class="show-card-body">
          <div class="show-card-title">${esc(s.title)}</div>
          <div class="show-card-sub"><span class="chip ${chipCls}">${this.STATUS[s.status] || ''}</span>${stars}</div>
          ${watchDate ? `<div class="show-card-sub">📅 ${esc(watchDate)}</div>` : ''}
          ${s.platform ? `<div class="show-card-sub">${esc(s.platform)}</div>` : ''}
        </div>
      </button>`;
    }).join('');

    grid.querySelectorAll('.show-card').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.id)));
  },

  /* ---------- 新增(TMDB 搜尋) ---------- */
  openAdd() {
    const hasKey = TMDB.available();
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>新增劇 / 電影</h2>
      ${hasKey ? `
        <input type="search" id="tmdb-q" placeholder="輸入劇名,例如:排球少年" autocomplete="off">
        <div class="search-results" id="tmdb-results"></div>
        <p class="hint" style="margin-top:12px">找不到嗎?<a href="#" id="manual-link">改用手動輸入</a></p>
      ` : `
        <p class="hint">尚未設定 TMDB 金鑰,無法自動抓海報。<br>可以先到「設定」頁申請並填入金鑰,或直接手動輸入劇名。</p>
        <div id="manual-area"></div>
      `}
    `);
    if (hasKey) {
      const q = document.getElementById('tmdb-q');
      q.focus();
      let timer;
      q.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.doSearch(q.value.trim()), 400);
      });
      document.getElementById('manual-link').addEventListener('click', e => {
        e.preventDefault();
        this.openManual();
      });
    } else {
      this.renderManualForm(document.getElementById('manual-area'));
    }
  },

  async doSearch(query) {
    const box = document.getElementById('tmdb-results');
    if (!box) return;
    if (!query) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="hint">搜尋中…</p>';
    try {
      const results = await TMDB.search(query);
      if (!results.length) { box.innerHTML = '<p class="hint">找不到結果</p>'; return; }
      box.innerHTML = results.map((r, i) => `
        <button class="search-item" data-i="${i}">
          ${r.poster ? `<img src="${esc(r.poster)}" alt="">` : '<div class="thumb-ph">🎬</div>'}
          <div>
            <div class="search-item-title">${esc(r.title)}</div>
            <div class="search-item-sub">${r.type === 'tv' ? '影集' : '電影'}${r.year ? ' · ' + esc(r.year) : ''}</div>
          </div>
        </button>`).join('');
      box.querySelectorAll('.search-item').forEach(el =>
        el.addEventListener('click', () => this.add(results[+el.dataset.i])));
    } catch (err) {
      box.innerHTML = `<p class="hint">${err.message === 'BAD_KEY'
        ? 'TMDB 金鑰不正確,請到「設定」頁檢查'
        : '搜尋失敗,請檢查網路'}</p>`;
    }
  },

  openManual() {
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>手動新增</h2>
      <div id="manual-area"></div>
    `);
    this.renderManualForm(document.getElementById('manual-area'));
  },

  platformInput(id, value = '') {
    return `<input type="text" id="${id}" list="platform-list" placeholder="例:Netflix(可留空)" value="${esc(value)}">
      <datalist id="platform-list">${this.PLATFORMS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
  },

  renderManualForm(container) {
    container.innerHTML = `
      <label>名稱</label>
      <input type="text" id="m-title" placeholder="劇名或電影名">
      <label>平台</label>
      ${this.platformInput('m-platform')}
      <label>海報圖片網址(可留空)</label>
      <input type="url" id="m-poster" placeholder="https://…">
      <button class="btn primary block" id="m-add">加入清單</button>
    `;
    container.querySelector('#m-add').addEventListener('click', () => {
      const title = container.querySelector('#m-title').value.trim();
      if (!title) { toast('請輸入名稱'); return; }
      this.add({
        tmdbId: null, type: 'tv', title,
        year: '', poster: container.querySelector('#m-poster').value.trim(), overview: '',
        platform: container.querySelector('#m-platform').value.trim(),
      });
    });
  },

  add(item) {
    const list = this.list();
    if (list.some(s => s.title === item.title || (item.tmdbId && s.tmdbId === item.tmdbId))) {
      toast('這部已經在清單裡囉');
      return;
    }
    const show = {
      id: 's' + Date.now(),
      platform: '',
      ...item,
      status: 'want',
      rating: 0,
      notes: '',
      log: [],
      addedAt: Date.now(),
    };
    list.push(show);
    this.saveList(list);
    this.sync('upsertShow', Sheets.showToRow(show));
    Modal.close();
    this.filter = 'want';
    syncFilterUI();
    this.render();
    toast(`已加入「${show.title}」`);
  },

  /* ---------- 詳情 ---------- */
  openDetail(id) {
    const list = this.list();
    const s = list.find(x => x.id === id);
    if (!s) return;

    const save = () => { this.saveList(list); this.render(); };

    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <div class="detail-head">
        ${s.poster ? `<img class="detail-poster" src="${esc(s.poster)}" alt="">` : ''}
        <div>
          <div class="detail-title">${esc(s.title)}</div>
          <div class="detail-sub">${s.type === 'movie' ? '電影' : '影集'}${s.year ? ' · ' + esc(s.year) : ''}</div>
          ${s.overview ? `<div class="detail-overview">${esc(s.overview)}</div>` : ''}
        </div>
      </div>

      <label>狀態</label>
      <div class="status-picker" id="d-status">
        ${Object.entries(this.STATUS).map(([k, v]) =>
          `<button data-s="${k}" class="${s.status === k ? 'active' : ''}">${v}</button>`).join('')}
      </div>

      <label>平台</label>
      ${this.platformInput('d-platform', s.platform || '')}

      <label>評分</label>
      <div class="stars" id="d-stars">
        ${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}" class="${s.rating >= n ? 'on' : ''}">★</button>`).join('')}
      </div>

      <label>觀看紀錄(什麼時候看了什麼)</label>
      <div class="log-list" id="d-log"></div>
      <div class="log-add">
        <input type="date" id="d-log-date" value="${todayStr()}">
        <input type="text" id="d-log-text" placeholder="例:看完第 3 集">
        <button class="btn primary" id="d-log-add">記錄</button>
      </div>

      <label>筆記</label>
      <textarea id="d-notes" placeholder="心得、進度、家人留言…">${esc(s.notes)}</textarea>

      <button class="btn danger block" id="d-delete">從清單移除</button>
    `);

    // 任何欄位變動 → 更新劇集庫(筆記/平台打字時延遲 1.2 秒再送,避免每個字都同步)
    let upsertTimer;
    const syncShow = (delay = 0) => {
      clearTimeout(upsertTimer);
      upsertTimer = setTimeout(() => this.sync('upsertShow', Sheets.showToRow(s)), delay);
    };

    // 狀態
    document.querySelectorAll('#d-status button').forEach(btn =>
      btn.addEventListener('click', () => {
        s.status = btn.dataset.s;
        document.querySelectorAll('#d-status button').forEach(b => b.classList.toggle('active', b === btn));
        // 標記「看完」時自動記一筆觀看紀錄(今天日期),讓卡片上的📅日期跟排序不用手動補
        if (btn.dataset.s === 'done') {
          s.log = s.log || [];
          const today = todayStr();
          if (!s.log.some(e => e.date === today)) {
            s.log.push({ date: today, text: '看完' });
            this.sync('addLog', { date: today, title: s.title, platform: s.platform || '', note: '看完' });
            renderLog();
          }
        }
        save(); syncShow();
      }));

    // 平台
    document.getElementById('d-platform').addEventListener('input', e => {
      s.platform = e.target.value.trim();
      this.saveList(list); syncShow(1200);
    });

    // 評分
    document.querySelectorAll('#d-stars button').forEach(btn =>
      btn.addEventListener('click', () => {
        const n = +btn.dataset.n;
        s.rating = (s.rating === n) ? 0 : n;
        document.querySelectorAll('#d-stars button').forEach(b => b.classList.toggle('on', +b.dataset.n <= s.rating));
        save(); syncShow();
      }));

    // 觀看紀錄
    const renderLog = () => {
      const box = document.getElementById('d-log');
      const log = [...(s.log || [])].sort((a, b) => b.date.localeCompare(a.date));
      box.innerHTML = log.length
        ? log.map((e, i) => `<div class="log-item">
            <span class="log-date">${esc(e.date)}</span>
            <span style="flex:1">${esc(e.text)}</span>
            <button class="log-del" data-i="${i}">✕</button>
          </div>`).join('')
        : '<p class="hint">還沒有紀錄</p>';
      box.querySelectorAll('.log-del').forEach(btn =>
        btn.addEventListener('click', () => {
          const sorted = [...(s.log || [])].sort((a, b) => b.date.localeCompare(a.date));
          const target = sorted[+btn.dataset.i];
          s.log = s.log.filter(e => e !== target);
          save(); renderLog();
          this.sync('deleteLog', { date: target.date, title: s.title, note: target.text });
        }));
    };
    renderLog();

    document.getElementById('d-log-add').addEventListener('click', () => {
      const date = document.getElementById('d-log-date').value || todayStr();
      const text = document.getElementById('d-log-text').value.trim();
      if (!text) { toast('寫一下看了什麼吧'); return; }
      s.log = s.log || [];
      s.log.push({ date, text });
      document.getElementById('d-log-text').value = '';
      this.sync('addLog', { date, title: s.title, platform: s.platform || '', note: text });
      // 有在看就自動轉「追劇中」
      if (s.status === 'want') {
        s.status = 'watching';
        document.querySelectorAll('#d-status button').forEach(b =>
          b.classList.toggle('active', b.dataset.s === 'watching'));
        syncShow();
      }
      save(); renderLog();
    });

    // 筆記
    document.getElementById('d-notes').addEventListener('input', e => {
      s.notes = e.target.value;
      this.saveList(list);
      syncShow(1200);
    });

    // 刪除
    document.getElementById('d-delete').addEventListener('click', () => {
      const warn = Sheets.enabled()
        ? `確定要移除「${s.title}」嗎?\nGoogle Sheet 上這部劇和它的觀看紀錄也會一併刪除。`
        : `確定要移除「${s.title}」嗎?`;
      if (!confirm(warn)) return;
      const idx = list.indexOf(s);
      list.splice(idx, 1);
      save();
      this.sync('deleteShow', { title: s.title });
      Modal.close();
      toast('已移除');
    });
  },
};

function syncFilterUI() {
  document.querySelectorAll('#show-filter button').forEach(b =>
    b.classList.toggle('active', b.dataset.status === Shows.filter));
}
