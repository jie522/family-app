/* 票券收納模組:電影票、餐券、禮券、優惠券…拍照存起來,標好名稱跟到期日,
 * 到櫃台直接打開照片給店員掃,快到期的排最前面,不會放到過期才想起來 */
const Tickets = {
  STATUS: { unused: '未使用', used: '已使用' },
  CATEGORIES: ['電影票', '餐券', '禮券 / 商品券', '優惠券', '門票', '其他'],
  CATEGORY_ICONS: { '電影票': '🎬', '餐券': '🍽️', '禮券 / 商品券': '🎁', '優惠券': '🏷️', '門票': '🎟️' },
  SOON_DAYS: 30, // 剩幾天內算「快到期」,列表標黃色提醒
  filter: 'active',
  search: '',

  list() { return Store.load('tickets', []); },
  saveList(list) { Store.save('tickets', list); },

  /* 票券照片常有 QR code / 條碼 / 序號小字,要能被店員掃得到——走跟維修紀錄照片一樣
   * 「解析度優先」的壓法,保留彩色(有些票券靠顏色分辨面額),預算是 Sheet 的 TICKET_PHOTO_CHUNKS 格 */
  photoLimit() { return Math.round(Sheets.TICKET_PHOTO_CHUNKS * Sheets.ATT_CHUNK_SIZE * 0.85); },
  photoHardCap() { return Sheets.TICKET_PHOTO_CHUNKS * Sheets.ATT_CHUNK_SIZE; },

  sync(action, data, msg) {
    if (msg) { Sheets.pushNotify(action, data, msg); return; }
    if (!Sheets.enabled()) return;
    Sheets.push(action, data).then(ok => {
      if (!ok) toast('⚠️ 同步到 Google Sheet 失敗,資料先存在手機');
    });
  },

  icon(t) { return this.CATEGORY_ICONS[t.category] || '🎫'; },

  daysLeft(expiry) {
    if (!expiry) return null;
    return Math.round((new Date(expiry + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
  },

  /* active(可使用)/ expired(過期沒用到)/ used(已使用) */
  state(t) {
    if (t.status === 'used') return 'used';
    const d = this.daysLeft(t.expiry);
    return d != null && d < 0 ? 'expired' : 'active';
  },

  /* 到期日小標籤 {label, cls};已使用的不再提醒到期 */
  expiryChip(t) {
    if (t.status === 'used') return { label: '✔️ 已使用', cls: '' };
    const d = this.daysLeft(t.expiry);
    if (d == null) return { label: '無期限', cls: 'done' };
    if (d < 0) return { label: `已過期(${t.expiry})`, cls: 'want' };
    if (d === 0) return { label: '今天到期!', cls: 'want' };
    if (d <= this.SOON_DAYS) return { label: `剩 ${d} 天(${t.expiry})`, cls: 'warn' };
    return { label: `到期 ${t.expiry}`, cls: 'done' };
  },

  /* ---------- 列表 ---------- */
  render() {
    const listEl = document.getElementById('ticket-list');
    const empty = document.getElementById('ticket-empty');
    const meta = document.getElementById('ticket-meta');
    const all = this.list();
    document.querySelectorAll('#ticket-filter button').forEach(b =>
      b.classList.toggle('active', b.dataset.f === this.filter));

    const active = all.filter(t => this.state(t) === 'active');
    const soon = active.filter(t => { const d = this.daysLeft(t.expiry); return d != null && d <= this.SOON_DAYS; });
    meta.textContent = all.length
      ? `${active.length} 張可使用${soon.length ? ` · ⚠️ ${soon.length} 張 ${this.SOON_DAYS} 天內到期` : ''}`
      : '';

    const q = (this.search || '').trim().toLowerCase();
    const rank = { active: 0, expired: 1, used: 2 };
    const list = all
      .filter(t => this.filter === 'all' || this.state(t) === this.filter)
      .filter(t => !q || [t.name, t.category, t.notes].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => {
        const ra = rank[this.state(a)], rb = rank[this.state(b)];
        if (ra !== rb) return ra - rb;
        // 快到期的排前面;沒期限的排最後
        const ea = a.expiry || '9999-99-99', eb = b.expiry || '9999-99-99';
        if (ea !== eb) return ra === 0 ? ea.localeCompare(eb) : eb.localeCompare(ea);
        return (b.addedAt || 0) - (a.addedAt || 0);
      });

    empty.classList.toggle('hidden', list.length > 0);
    empty.querySelector('p').innerHTML = !all.length
      ? '還沒有票券喔!<br>按右上角「＋」拍照登錄第一張'
      : q ? `找不到符合「${esc(this.search.trim())}」的票券`
      : { active: '目前沒有可使用的票券', expired: '沒有過期沒用到的票券 👍', used: '還沒有已使用的票券' }[this.filter] || '沒有票券';

    listEl.innerHTML = list.map(t => {
      const st = this.state(t);
      const chip = this.expiryChip(t);
      const photo = t.photos?.[0]
        ? `<img class="appliance-row-photo" src="${esc(t.photos[0])}" alt="" loading="lazy">`
        : `<div class="appliance-row-photo placeholder">${this.icon(t)}</div>`;
      const d = this.daysLeft(t.expiry);
      const soonCls = st === 'active' && d != null && d <= this.SOON_DAYS ? ' soon' : '';
      return `<button class="appliance-row ticket-row${st !== 'active' ? ' retired' : ''}${soonCls}" data-id="${esc(t.id)}">
        ${photo}
        <div class="appliance-row-body">
          <div class="appliance-row-title">${esc(t.name)}</div>
          ${t.category ? `<div class="appliance-row-sub">${this.icon(t)} ${esc(t.category)}</div>` : ''}
          <div class="appliance-row-sub"><span class="chip ${chip.cls}">${esc(chip.label)}</span></div>
        </div>
      </button>`;
    }).join('');

    listEl.querySelectorAll('.ticket-row').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.id)));
  },

  /* ---------- 檢視(到櫃台要用時:照片放大、一鍵標記已使用) ---------- */
  openDetail(id) {
    const t = this.list().find(x => x.id === id);
    if (!t) return;
    const chip = this.expiryChip(t);
    const used = t.status === 'used';
    Modal.swap(`
      <button class="modal-close" data-close>✕</button>
      <div class="detail-title" style="padding-right:36px">${this.icon(t)} ${esc(t.name)}</div>
      <div class="detail-sub">${t.category ? esc(t.category) + ' · ' : ''}<span class="chip ${chip.cls}">${esc(chip.label)}</span></div>
      ${t.photos?.length
        ? `<div class="ticket-photos">${t.photos.map((src, i) => `<img src="${esc(src)}" alt="" data-view="${i}">`).join('')}</div>
           <p class="food-loc-status">點照片可以全螢幕放大,方便給店員掃條碼</p>`
        : '<p class="food-loc-status">這張票券還沒有照片</p>'}
      ${t.notes ? `<label>備註</label><p class="ticket-notes">${esc(t.notes)}</p>` : ''}
      <button class="btn ${used ? '' : 'primary'} block" id="k-toggle">${used ? '↩️ 改回未使用' : '✅ 標記為已使用'}</button>
      <button class="btn block" id="k-edit">✏️ 編輯</button>
    `);
    document.querySelectorAll('.ticket-photos [data-view]').forEach(img =>
      img.addEventListener('click', () => Food.viewPhoto(t.photos[+img.dataset.view])));
    document.getElementById('k-toggle').addEventListener('click', () => {
      const list = this.list();
      const item = list.find(x => x.id === id);
      if (!item) return;
      item.status = used ? 'unused' : 'used';
      this.saveList(list);
      Modal.close();
      this.render();
      this.sync('upsertTicket', Sheets.ticketToRow(item), used ? `「${item.name}」改回未使用` : `「${item.name}」已標記使用`);
    });
    document.getElementById('k-edit').addEventListener('click', () => this.openEdit(id));
  },

  openAdd() { this.openEdit(null); },

  /* ---------- 新增 / 編輯 ---------- */
  openEdit(id) {
    const existing = id ? this.list().find(x => x.id === id) : null;
    let status = existing ? (existing.status || 'unused') : 'unused';
    const photos = existing ? [...(existing.photos || [])] : [];
    const max = Sheets.MAX_TICKET_PHOTOS;

    Modal.swap(`
      <button class="modal-close" data-close>✕</button>
      <h2>${existing ? '編輯票券' : '新增票券'}</h2>
      <label>照片(最多 ${max} 張,例如正面 + 背面條碼,可拍照或從相簿選)</label>
      <div class="food-photos" id="k-photos"></div>
      <input type="file" id="k-photo-file" accept="image/*" hidden>
      <label>名稱 *</label>
      <input type="text" id="k-name" placeholder="例:威秀電影票、王品餐券 $1000" value="${esc(existing ? existing.name : '')}">
      <label>到期日(沒有期限就留空)</label>
      <div class="ticket-expiry-row">
        <input type="date" id="k-expiry" value="${esc(existing ? existing.expiry || '' : '')}">
        <button type="button" class="btn" id="k-expiry-clear">清除</button>
      </div>
      <label>分類</label>
      <input type="text" id="k-category" placeholder="例:電影票(可留空)" value="${esc(existing ? existing.category : '')}">
      ${existing ? `<label>狀態</label>
      <div class="status-picker" id="k-status">
        ${Object.entries(this.STATUS).map(([k, v]) => `<button type="button" data-s="${k}" class="${status === k ? 'active' : ''}">${v}</button>`).join('')}
      </div>` : ''}
      <label>備註</label>
      <textarea id="k-notes" placeholder="序號、使用限制、適用門市、誰送的…">${esc(existing ? existing.notes : '')}</textarea>
      <button class="btn primary block" id="k-save">${existing ? '儲存' : '加入票券'}</button>
      ${existing ? '<button class="btn danger block" id="k-delete">刪除這張票券</button>' : ''}
    `);

    const notesEl = document.getElementById('k-notes');
    notesEl.addEventListener('input', () => Appliances.autoGrowTextarea(notesEl));
    Appliances.autoGrowTextarea(notesEl);
    bindAutocomplete(document.getElementById('k-category'), () =>
      [...new Set([...this.CATEGORIES, ...this.list().map(t => (t.category || '').trim()).filter(Boolean)])]);
    document.getElementById('k-expiry-clear').addEventListener('click', () => {
      document.getElementById('k-expiry').value = '';
    });
    document.querySelectorAll('#k-status button').forEach(btn =>
      btn.addEventListener('click', () => {
        status = btn.dataset.s;
        document.querySelectorAll('#k-status button').forEach(b => b.classList.toggle('active', b === btn));
      }));

    const photosEl = document.getElementById('k-photos');
    const renderPhotos = () => {
      photosEl.innerHTML = photos.map((src, i) => `
        <div class="food-photo">
          <img src="${src}" alt="" data-view="${i}">
          <button type="button" class="food-photo-rm" data-rm="${i}">✕</button>
        </div>`).join('') +
        (photos.length < max ? '<button type="button" class="food-photo add" id="k-photo-add">📷<span>拍照 / 上傳</span></button>' : '');
      photosEl.querySelectorAll('[data-view]').forEach(img =>
        img.addEventListener('click', () => Food.viewPhoto(photos[+img.dataset.view])));
      photosEl.querySelectorAll('[data-rm]').forEach(btn =>
        btn.addEventListener('click', () => { photos.splice(+btn.dataset.rm, 1); renderPhotos(); }));
      document.getElementById('k-photo-add')?.addEventListener('click', () =>
        document.getElementById('k-photo-file').click());
    };
    renderPhotos();
    document.getElementById('k-photo-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      const dataUrl = await Appliances.pickAndCompress(file, Appliances.DOC_ATTEMPTS, { limit: this.photoLimit(), hardCap: this.photoHardCap() });
      if (!dataUrl || photos.length >= max) return;
      photos.push(dataUrl);
      renderPhotos();
    });

    document.getElementById('k-save').addEventListener('click', () => {
      const name = document.getElementById('k-name').value.trim();
      if (!name) { toast('請輸入名稱'); return; }
      const t = {
        id: existing ? existing.id : 'k' + Date.now(),
        name,
        category: document.getElementById('k-category').value.trim(),
        expiry: document.getElementById('k-expiry').value || '',
        status,
        notes: document.getElementById('k-notes').value.trim(),
        photos: [...photos],
        addedAt: existing ? existing.addedAt : Date.now(),
      };
      const list = this.list();
      const idx = list.findIndex(x => x.id === t.id);
      if (idx >= 0) list[idx] = t; else list.push(t);
      this.saveList(list);
      Modal.close();
      this.render();
      this.sync('upsertTicket', Sheets.ticketToRow(t), existing ? '已儲存' : `已加入「${name}」`);
    });

    document.getElementById('k-delete')?.addEventListener('click', () => {
      const warn = Sheets.enabled()
        ? `確定要刪除「${existing.name}」嗎?\nGoogle Sheet 上這筆資料也會一併刪除。`
        : `確定要刪除「${existing.name}」嗎?`;
      if (!confirm(warn)) return;
      this.saveList(this.list().filter(x => x.id !== existing.id));
      Modal.close();
      this.render();
      this.sync('deleteTicket', { id: existing.id });
      toast('已刪除');
    });
  },
};
