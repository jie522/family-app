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
      app: '家庭小站',
      version: 1,
      exportedAt: new Date().toISOString(),
      shows: this.load('shows', []),
      stocks: this.load('stocks', []),
      settings: this.load('settings', {}),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `家庭小站備份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  importAll(file, done) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== '家庭小站') throw new Error('格式不對');
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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
