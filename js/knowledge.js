/* 知識庫模組:公開的概念/產業知識(跟 Wiki/ 不同——這裡的內容是刻意公開給全家看的) */
const Knowledge = {
  manifest: null,

  async loadManifest() {
    if (this.manifest) return this.manifest;
    try {
      const res = await fetch('knowledge/manifest.json', { cache: 'no-cache' });
      this.manifest = res.ok ? await res.json() : [];
    } catch { this.manifest = []; }
    return this.manifest;
  },

  async render() {
    const list = document.getElementById('knowledge-list');
    if (!list) return;
    const items = await this.loadManifest();
    list.innerHTML = items.length
      ? items.map(it => `
        <button class="knowledge-card" data-slug="${esc(it.slug)}">
          <div class="knowledge-card-title">${esc(it.title)}</div>
          <div class="knowledge-card-summary">${esc(it.summary || '')}</div>
        </button>`).join('')
      : '<p class="hint">還沒有知識庫內容。</p>';
    list.querySelectorAll('.knowledge-card').forEach(el =>
      el.addEventListener('click', () => this.openConcept(el.dataset.slug)));
  },

  async openConcept(slug) {
    const items = await this.loadManifest();
    const meta = items.find(it => it.slug === slug);
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>${esc(meta?.title || slug)}</h2>
      <div id="knowledge-body" class="md-body"><p class="hint">讀取中…</p></div>
    `);
    this.bindLinks();
    try {
      const res = await fetch(`knowledge/${encodeURIComponent(slug)}.md`, { cache: 'no-cache' });
      const text = res.ok ? await res.text() : '';
      if (!res.ok || text.trimStart().startsWith('<')) throw new Error();
      const box = document.getElementById('knowledge-body');
      if (!box) return; // 彈窗已關掉
      box.innerHTML = mdToHtml(text.replace(/^#[^\n]*\n/, '')); // 標題已經顯示在 modal <h2>,內文不用重複
      this.bindLinks();
    } catch {
      const box = document.getElementById('knowledge-body');
      if (box) box.innerHTML = '<p class="hint">這篇內容讀取失敗。</p>';
    }
  },

  /* 攔截內文裡的站內連結:k:slug 跳到另一篇知識、s:代號 跳去股票詳情 */
  bindLinks() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.querySelectorAll('.k-link').forEach(el =>
      el.addEventListener('click', e => {
        e.preventDefault();
        this.openConcept(el.dataset.k);
      }));
    modal.querySelectorAll('.s-link').forEach(el =>
      el.addEventListener('click', e => {
        e.preventDefault();
        const code = el.dataset.s;
        Modal.close();
        switchPage('stocks');
        const tracked = Stocks.list().some(w => w.code === code);
        if (tracked) {
          Stocks.openDetail(code);
        } else {
          const name = Stocks.quote(code)?.n;
          toast(name ? `尚未追蹤 ${name},到「股票」頁搜尋 ${code} 加入看看` : `尚未追蹤這檔股票(${code})`);
        }
      }));
  },
};
