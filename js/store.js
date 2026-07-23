/* 資料儲存:localStorage 包裝 + 匯出匯入 */
const Store = {
  KEYS: { shows: 'fam.shows', stocks: 'fam.stocks', settings: 'fam.settings' },

  load(key, fallback) {
    try {
      const raw = localStorage.getItem(this.KEYS[key]);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  save(key, value) {
    localStorage.setItem(this.KEYS[key], JSON.stringify(value));
  },

  exportAll() {
    const data = {
      app: 'FAMIAP',
      version: 1,
      exportedAt: new Date().toISOString(),
      shows: this.load('shows', []),
      stocks: this.load('stocks', []),
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
