/* 台股追蹤模組:報價資料來自 data/stocks.json(GitHub Actions 每交易日更新) */
/* 主要生產東西的一句話標籤,人工維護,列表上一眼看出這檔在做什麼(不是官方產業分類) */
const PRODUCT_TAGS = {
  '2059': '滑軌',
  '2317': '組裝代工',
  '2330': '晶圓代工',
  '3548': '轉軸',
  '8033': '無人機',
  '4979': '光模組',
  '2486': '散熱均熱片',
};

const Stocks = {
  data: null,        // { updated, stocks: { code: {n,c,chg,o,h,l,v,pe,pb,dy} } }
  loadError: false,
  live: null,        // 即時報價(經 Apps Script 代抓 Yahoo): { code: {c,y,o,h,l,v,t} }
  liveAt: null,      // 最後成功抓到即時報價的時間(Date)

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
    this.refreshLive(); // 背景抓即時報價,抓到後自動重繪
  },

  /* 經 Apps Script 代抓 Yahoo 即時報價(未啟用同步或抓不到就維持每日收盤資料) */
  async refreshLive() {
    if (!Sheets.enabled()) return;
    const codes = this.list().map(w => w.code);
    if (!codes.length) return;
    try {
      const json = await Sheets.call('quotes', { codes });
      if (!json.ok || !json.quotes || !Object.keys(json.quotes).length) return;
      this.live = json.quotes;
      this.liveAt = new Date();
      this.render();
    } catch { /* 連不上就算了,顯示收盤資料 */ }
  },

  quote(code) {
    const base = this.data?.stocks?.[code] || null;
    const lv = this.live?.[code];
    if (!lv || lv.c == null) return base;
    const m = Object.assign({ n: null, pe: null, dy: null, pb: null }, base);
    m.c = lv.c;
    if (lv.y != null) m.chg = +(lv.c - lv.y).toFixed(2);
    if (lv.o != null) m.o = lv.o;
    if (lv.h != null) m.h = lv.h;
    if (lv.l != null) m.l = lv.l;
    if (lv.v != null) m.v = lv.v;
    if (lv.w52h != null) m.w52h = lv.w52h;
    if (lv.w52l != null) m.w52l = lv.w52l;
    if (lv.spark) m.spark = lv.spark;
    return m;
  },

  fmtChange(q) {
    if (!q || q.c == null || q.chg == null) return { cls: 'chg-flat', text: '—' };
    const prev = q.c - q.chg;
    const pct = prev > 0 ? (q.chg / prev * 100) : 0;
    const sign = q.chg > 0 ? '▲' : q.chg < 0 ? '▼' : '';
    const cls = q.chg > 0 ? 'chg-up' : q.chg < 0 ? 'chg-down' : 'chg-flat';
    return { cls, text: `${sign}${Math.abs(q.chg).toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)` };
  },

  /* 近三個月走勢迷你圖:closes 是每日收盤序列,顏色依這段期間漲跌(非當日漲跌)決定 */
  sparklineSvg(closes) {
    if (!closes || closes.length < 2) return '';
    const w = 300, h = 60, pad = 4;
    const min = Math.min(...closes), max = Math.max(...closes);
    const span = (max - min) || 1;
    const stepX = (w - pad * 2) / (closes.length - 1);
    const pts = closes.map((c, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (c - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = pts.join(' ');
    const area = `${pad},${h - pad} ${line} ${(w - pad).toFixed(1)},${h - pad}`;
    const cls = closes[closes.length - 1] >= closes[0] ? 'chg-up' : 'chg-down';
    return `<div class="spark-wrap">
      <svg viewBox="0 0 ${w} ${h}" class="spark-svg ${cls}">
        <polygon points="${area}" class="spark-area"></polygon>
        <polyline points="${line}" class="spark-line"></polyline>
      </svg>
      <div class="spark-label">近 3 個月走勢(${min.toFixed(1)} ~ ${max.toFixed(1)})</div>
    </div>`;
  },

  /* 產業別/股本/上市日期:來自 data/stocks.json(證交所上市公司基本資料,GitHub Actions 每交易日更新) */
  companyInfoHtml(q) {
    if (!q || (!q.ind && !q.ipo && q.cap == null)) return '';
    return `<div class="fact-grid company-info">
      <div class="fact"><div class="k">產業別</div><div class="v">${q.ind ? esc(q.ind) : '—'}</div></div>
      <div class="fact"><div class="k">股本</div><div class="v">${q.cap != null ? q.cap.toLocaleString('zh-TW') + ' 億' : '—'}</div></div>
      <div class="fact"><div class="k">上市日期</div><div class="v">${q.ipo ? esc(q.ipo) : '—'}</div></div>
    </div>`;
  },

  reordering: false, // 排序模式只存在這支手機,不跟 Google Sheet 同步

  render() {
    const meta = document.getElementById('stock-meta');
    const listEl = document.getElementById('stock-list');
    const empty = document.getElementById('stock-empty');
    const watch = this.list();

    if (this.loadError && !this.live) {
      meta.textContent = '⚠️ 讀不到股票資料檔(data/stocks.json)。部署到 GitHub 後會自動更新。';
    } else if (this.liveAt) {
      const hm = `${String(this.liveAt.getHours()).padStart(2, '0')}:${String(this.liveAt.getMinutes()).padStart(2, '0')}`;
      meta.innerHTML = `盤中報價 ${hm}(Yahoo,可能延遲數分鐘) <button id="stock-live-refresh" class="meta-refresh">🔄 更新</button>`;
    } else if (this.data) {
      meta.innerHTML = `資料日期:${esc(this.data.updated)}(收盤)` +
        (Sheets.enabled() ? ' <button id="stock-live-refresh" class="meta-refresh">🔄 更新</button>' : '');
    } else {
      meta.textContent = '載入中…';
    }
    if (watch.length > 1) {
      meta.insertAdjacentHTML('beforeend',
        `<button id="stock-reorder-toggle" class="meta-refresh ${this.reordering ? 'active' : ''}">${this.reordering ? '✓ 完成排序' : '↕️ 排序'}</button>`);
    }
    document.getElementById('stock-live-refresh')?.addEventListener('click', () => this.refreshLive());
    document.getElementById('stock-reorder-toggle')?.addEventListener('click', () => {
      this.reordering = !this.reordering;
      this.render();
    });

    empty.classList.toggle('hidden', watch.length > 0);
    listEl.classList.toggle('reordering', this.reordering);
    listEl.innerHTML = watch.map((w, i) => {
      const q = this.quote(w.code);
      const ch = this.fmtChange(q);
      const tag = PRODUCT_TAGS[w.code];
      const idBlock = `<span class="stock-id">
          <span class="stock-name">${esc(q?.n || w.name || w.code)}${tag ? ` <span class="stock-tag">${esc(tag)}</span>` : ''}</span>
          <span class="stock-code">${esc(w.code)}${w.notes ? ' · 📝 有筆記' : ''}</span>
        </span>`;
      const quoteBlock = `<span class="stock-quote">
          <div class="stock-price ${ch.cls}">${q?.c != null ? q.c.toFixed(2) : '—'}</div>
          <div class="stock-change-badge ${ch.cls}">${ch.text}</div>
        </span>`;
      if (this.reordering) {
        return `<div class="stock-row ${ch.cls} reorder-mode" data-code="${esc(w.code)}">
          <div class="reorder-left">
            <div class="reorder-btns">
              <button class="reorder-btn" data-dir="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="reorder-btn" data-dir="down" data-i="${i}" ${i === watch.length - 1 ? 'disabled' : ''}>▼</button>
            </div>
            ${idBlock}
          </div>
          ${quoteBlock}
        </div>`;
      }
      return `<button class="stock-row ${ch.cls}" data-code="${esc(w.code)}">${idBlock}${quoteBlock}</button>`;
    }).join('');

    if (this.reordering) {
      listEl.querySelectorAll('.reorder-btn').forEach(el =>
        el.addEventListener('click', () => this.moveStock(+el.dataset.i, el.dataset.dir)));
    } else {
      listEl.querySelectorAll('.stock-row').forEach(el =>
        el.addEventListener('click', () => this.openDetail(el.dataset.code)));
    }
  },

  /* 排序只存本機(localStorage),不寫回 Google Sheet——排列順序是個人使用習慣,
   * 沒必要每支手機都一樣;跟 Sheet 同步時看 sheets.js 的合併邏輯,會保留這支手機原本的順序。 */
  moveStock(i, dir) {
    const list = this.list();
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.saveList(list);
    this.render();
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
      : '<p class="hint">找不到,請確認代號或名稱(涵蓋上市、上櫃股票)</p>';
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
      <div class="big-quote-block ${ch.cls}">
        <div class="big-quote">
          <span class="big-price ${ch.cls}">${q?.c != null ? q.c.toFixed(2) : '—'}</span>
          <span class="big-change-badge ${ch.cls}">${ch.text}</span>
        </div>
      </div>
      ${q?.spark ? this.sparklineSvg(q.spark) : ''}
      ${q ? `<div class="fact-grid">
        <div class="fact"><div class="k">開盤</div><div class="v">${q.o != null ? q.o.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">最高</div><div class="v up">${q.h != null ? q.h.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">最低</div><div class="v down">${q.l != null ? q.l.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">52週高</div><div class="v up">${q.w52h != null ? q.w52h.toFixed(2) : '—'}</div></div>
        <div class="fact"><div class="k">52週低</div><div class="v down">${q.w52l != null ? q.w52l.toFixed(2) : '—'}</div></div>
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
        ${this.companyInfoHtml(q)}
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
