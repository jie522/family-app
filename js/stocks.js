/* 台股追蹤模組:報價資料來自 data/stocks.json(GitHub Actions 每交易日更新) */
const Stocks = {
  data: null,        // { updated, stocks: { code: {n,c,chg,o,h,l,v,pe,pb,dy} } }
  loadError: false,

  list() { return Store.load('stocks', []); },
  saveList(list) { Store.save('stocks', list); },

  /* 寫回 Google Sheet(未啟用同步時靜默略過) */
  sync(action, data) {
    if (!Sheets.enabled()) return;
    Sheets.push(action, data).then(ok => {
      if (!ok) toast('⚠️ 同步到 Google Sheet 失敗,資料先存在手機');
    });
  },

  async init() {
    try {
      const res = await fetch('data/stocks.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error();
      this.data = await res.json();
    } catch {
      this.loadError = true;
    }
    this.render();
  },

  quote(code) {
    return this.data?.stocks?.[code] || null;
  },

  fmtChange(q) {
    if (!q || q.c == null || q.chg == null) return { cls: 'chg-flat', text: '—' };
    const prev = q.c - q.chg;
    const pct = prev > 0 ? (q.chg / prev * 100) : 0;
    const sign = q.chg > 0 ? '▲' : q.chg < 0 ? '▼' : '';
    const cls = q.chg > 0 ? 'chg-up' : q.chg < 0 ? 'chg-down' : 'chg-flat';
    return { cls, text: `${sign}${Math.abs(q.chg).toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)` };
  },

  render() {
    const meta = document.getElementById('stock-meta');
    const listEl = document.getElementById('stock-list');
    const empty = document.getElementById('stock-empty');
    const watch = this.list();

    if (this.loadError) {
      meta.textContent = '⚠️ 讀不到股票資料檔(data/stocks.json)。部署到 GitHub 後會自動更新。';
    } else if (this.data) {
      meta.textContent = `資料日期:${this.data.updated}(收盤)`;
    } else {
      meta.textContent = '載入中…';
    }

    empty.classList.toggle('hidden', watch.length > 0);
    listEl.innerHTML = watch.map(w => {
      const q = this.quote(w.code);
      const ch = this.fmtChange(q);
      return `<button class="stock-row" data-code="${esc(w.code)}">
        <span class="stock-id">
          <span class="stock-name">${esc(q?.n || w.name || w.code)}</span>
          <span class="stock-code">${esc(w.code)}${w.notes ? ' · 📝 有筆記' : ''}</span>
        </span>
        <span class="stock-quote">
          <div class="stock-price">${q?.c != null ? q.c.toFixed(2) : '—'}</div>
          <div class="stock-change ${ch.cls}">${ch.text}</div>
        </span>
      </button>`;
    }).join('');

    listEl.querySelectorAll('.stock-row').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.code)));
  },

  /* ---------- 新增 ---------- */
  openAdd() {
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>新增追蹤股票</h2>
      <input type="search" id="stock-q" placeholder="輸入代號或名稱,例如:2330 或 台積電" autocomplete="off">
      <div class="search-results" id="stock-results"></div>
    `);
    const q = document.getElementById('stock-q');
    q.focus();
    q.addEventListener('input', () => this.doSearch(q.value.trim()));
  },

  doSearch(query) {
    const box = document.getElementById('stock-results');
    if (!box) return;
    if (!query) { box.innerHTML = ''; return; }
    if (!this.data) {
      box.innerHTML = '<p class="hint">股票資料還沒載入。可直接輸入 4 位數代號後按下方按鈕加入。</p>' +
        `<button class="btn primary block" id="add-raw">直接加入「${esc(query)}」</button>`;
      const btn = document.getElementById('add-raw');
      btn.addEventListener('click', () => this.add(query, query));
      return;
    }
    const qq = query.toUpperCase();
    const hits = Object.entries(this.data.stocks)
      .filter(([code, s]) => code.startsWith(qq) || (s.n && s.n.includes(query)))
      .slice(0, 12);
    box.innerHTML = hits.length
      ? hits.map(([code, s]) => `
          <button class="search-item" data-code="${esc(code)}">
            <div class="thumb-ph" style="width:46px;height:46px;font-size:13px;font-weight:700">${esc(code)}</div>
            <div>
              <div class="search-item-title">${esc(s.n)}</div>
              <div class="search-item-sub">收盤 ${s.c != null ? s.c.toFixed(2) : '—'}</div>
            </div>
          </button>`).join('')
      : '<p class="hint">找不到,請確認代號或名稱(僅含上市股票)</p>';
    box.querySelectorAll('.search-item').forEach(el =>
      el.addEventListener('click', () => this.add(el.dataset.code, this.data.stocks[el.dataset.code]?.n)));
  },

  add(code, name) {
    const list = this.list();
    if (list.some(w => w.code === code)) { toast('已經在追蹤清單裡囉'); return; }
    const w = { code, name: name || code, notes: '', addedAt: Date.now() };
    list.push(w);
    this.saveList(list);
    this.sync('upsertStock', Sheets.stockToRow(w));
    Modal.close();
    this.render();
    toast(`已加入 ${name || code}`);
  },

  reportsManifest: null,

  /* reports/manifest.json:{ 代號: [日期,...] },記錄每檔股票有哪些日期的報告 */
  async loadManifest() {
    if (this.reportsManifest) return this.reportsManifest;
    try {
      const res = await fetch('reports/manifest.json', { cache: 'no-cache' });
      this.reportsManifest = res.ok ? await res.json() : {};
    } catch { this.reportsManifest = {}; }
    return this.reportsManifest;
  },

  /* 讀取 reports/<代號>/_about.md 公司簡介(沒有就整塊隱藏,不硬報錯) */
  async loadAbout(code) {
    const box = document.getElementById('sk-about');
    if (!box) return;
    try {
      const res = await fetch(`reports/${encodeURIComponent(code)}/_about.md`, { cache: 'no-cache' });
      const text = res.ok ? await res.text() : '';
      if (!res.ok || text.trimStart().startsWith('<')) throw new Error();
      if (!document.getElementById('sk-about')) return; // 彈窗已被關掉
      box.innerHTML = mdToHtml(text);
    } catch {
      const el = document.getElementById('sk-about');
      if (!el) return;
      el.innerHTML = '<p class="hint">還沒有這檔的公司簡介。新增 reports/代號/_about.md 就會顯示在這裡。</p>';
    }
  },

  /* 讀取單一日期的分析報告內容 */
  async loadReport(code, date) {
    const box = document.getElementById('sk-report');
    if (!box) return;
    box.innerHTML = '<p class="hint">讀取中…</p>';
    try {
      const res = await fetch(`reports/${encodeURIComponent(code)}/${encodeURIComponent(date)}.md`, { cache: 'no-cache' });
      const text = res.ok ? await res.text() : '';
      if (!res.ok || text.trimStart().startsWith('<')) throw new Error();
      if (!document.getElementById('sk-report')) return;
      box.innerHTML = mdToHtml(text);
    } catch {
      if (!document.getElementById('sk-report')) return;
      box.innerHTML = '<p class="hint">這份報告讀取失敗。</p>';
    }
  },

  /* 讀取 reports/<代號>/_industry.md 產業知識(沒有檔案就顯示提示) */
  async loadIndustry(code) {
    const box = document.getElementById('sk-industry');
    if (!box) return;
    try {
      const res = await fetch(`reports/${encodeURIComponent(code)}/_industry.md`, { cache: 'no-cache' });
      const text = res.ok ? await res.text() : '';
      if (!res.ok || text.trimStart().startsWith('<')) throw new Error();
      if (!document.getElementById('sk-industry')) return; // 彈窗已被關掉
      box.innerHTML = mdToHtml(text);
    } catch {
      const el = document.getElementById('sk-industry');
      if (!el) return;
      el.innerHTML = '<p class="hint">還沒有這檔的產業知識。新增 reports/代號/_industry.md 就會顯示在這裡。</p>';
    }
  },

  /* 公司簡介 + 產業知識 + 依日期切換的分析報告,一起初始化 */
  async loadReportsSection(code) {
    this.loadAbout(code);    // 跟報告平行載入,互不擋
    this.loadIndustry(code);
    const manifest = await this.loadManifest();
    const dates = [...(manifest[code] || [])].sort().reverse(); // 最新的排最前面
    const dateBox = document.getElementById('sk-report-dates');
    const reportBox = document.getElementById('sk-report');
    if (!dateBox || !reportBox) return; // 彈窗已被關掉

    if (!dates.length) {
      dateBox.innerHTML = '';
      reportBox.innerHTML = '<p class="hint">還沒有這檔的報告。照 reports/_template.md 的步驟新增就會顯示在這裡。</p>';
      return;
    }
    dateBox.innerHTML = dates.length > 1
      ? `<select id="sk-report-date-sel">${dates.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>`
      : '';
    document.getElementById('sk-report-date-sel')
      ?.addEventListener('change', e => this.loadReport(code, e.target.value));
    this.loadReport(code, dates[0]);
  },

  /* ---------- 詳情 ---------- */
  openDetail(code) {
    const list = this.list();
    const w = list.find(x => x.code === code);
    if (!w) return;
    const q = this.quote(code);
    const ch = this.fmtChange(q);
    const fmt = v => (v == null ? '—' : (typeof v === 'number' ? v.toLocaleString('zh-TW') : v));

    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>${esc(q?.n || w.name || code)} <span style="font-size:14px;color:var(--text2)">${esc(code)}</span></h2>
      <div class="big-quote">
        <span class="big-price ${ch.cls}">${q?.c != null ? q.c.toFixed(2) : '—'}</span>
        <span class="big-change ${ch.cls}">${ch.text}</span>
      </div>
      ${q ? `<div class="fact-grid">
        <div class="fact"><div class="k">開盤</div><div class="v">${q.o != null ? q.o.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">最高</div><div class="v">${q.h != null ? q.h.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">最低</div><div class="v">${q.l != null ? q.l.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">成交量(張)</div><div class="v">${q.v != null ? fmt(Math.round(q.v / 1000)) : '—'}</div></div>
        <div class="fact"><div class="k">本益比</div><div class="v">${q.pe != null ? q.pe : '—'}</div></div>
        <div class="fact"><div class="k">殖利率</div><div class="v">${q.dy != null ? q.dy + '%' : '—'}</div></div>
      </div>` : '<p class="hint">目前沒有這檔的報價資料(部署後每交易日自動更新)</p>'}

      <div class="segmented sk-tabs" id="sk-tabs">
        <button data-pane="about" class="active">公司簡介</button>
        <button data-pane="industry">產業知識</button>
        <button data-pane="report">分析報告</button>
      </div>
      <div class="sk-pane active" id="sk-pane-about">
        <div id="sk-about" class="md-body"><p class="hint">讀取中…</p></div>
      </div>
      <div class="sk-pane" id="sk-pane-industry">
        <div id="sk-industry" class="md-body"><p class="hint">讀取中…</p></div>
      </div>
      <div class="sk-pane" id="sk-pane-report">
        <div class="report-dates" id="sk-report-dates"></div>
        <div id="sk-report" class="md-body"><p class="hint">讀取中…</p></div>
      </div>

      <label>我的分析筆記</label>
      <textarea id="sk-notes" placeholder="買賣想法、目標價、觀察重點…">${esc(w.notes)}</textarea>

      <button class="btn danger block" id="sk-delete">取消追蹤</button>
    `);

    // 公司簡介/產業知識/分析報告 三個頁籤切換
    const tabs = document.getElementById('sk-tabs');
    tabs.querySelectorAll('button').forEach(btn =>
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        ['about', 'industry', 'report'].forEach(p =>
          document.getElementById('sk-pane-' + p).classList.toggle('active', p === btn.dataset.pane));
      }));

    this.loadReportsSection(code);

    let noteTimer;
    document.getElementById('sk-notes').addEventListener('input', e => {
      w.notes = e.target.value;
      this.saveList(list);
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => this.sync('upsertStock', Sheets.stockToRow(w)), 1200);
    });
    document.getElementById('sk-delete').addEventListener('click', () => {
      const warn = Sheets.enabled()
        ? `確定不再追蹤 ${q?.n || code} 嗎?\nGoogle Sheet 上的紀錄也會一併刪除。`
        : `不再追蹤 ${q?.n || code}?`;
      if (!confirm(warn)) return;
      list.splice(list.indexOf(w), 1);
      this.saveList(list);
      this.sync('deleteStock', { code });
      Modal.close();
      this.render();
      toast('已取消追蹤');
    });
  },
};
