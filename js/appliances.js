/* 家庭採購家電登錄模組 */
const Appliances = {
  CATEGORIES: ['廚房家電', '視聽家電', '生活家電', '清潔家電', '冷氣空調', '3C', '其他'],
  WARRANTY_PRESETS: ['6個月', '1年', '2年', '3年', '5年', '10年', '終身保固'],
  ATT_LABELS: ['附件 1', '附件 2', '附件 3'],
  // 家電照片(列表縮圖用,壓小一點就好,保留彩色);附件(收據/保固卡等文件照)通常有
  // 密密麻麻的小字,解析度不夠放大就是一團模糊——所以附件走灰階(去掉色彩資訊換取同樣
  // 位元組預算下能留更高解析度)、解析度優先於畫質(文字清晰度靠像素夠不夠,不是靠色彩準不準)。
  // Google Sheet 單一儲存格上限是 5 萬字元,一張像樣的文件照壓縮後常常不夠塞——所以附件
  // 拆成好幾格存(見 Sheets.ATT_CHUNKS/ATT_CHUNK_SIZE),預算是單一儲存格的好幾倍,才有辦法
  // 留住足夠解析度。家電照片本身只是列表縮圖,不用放大看細節,維持單一儲存格就好。
  PHOTO_ATTEMPTS: [[600, 0.8], [600, 0.6], [450, 0.55], [350, 0.45], [280, 0.4]],
  DOC_ATTEMPTS: [[2600, 0.75], [2400, 0.72], [2200, 0.7], [2000, 0.68], [1800, 0.65], [1600, 0.62],
                 [1400, 0.6], [1200, 0.55], [1000, 0.5], [850, 0.45], [700, 0.4]],

  /* 附件的壓縮目標/硬上限——跟 Sheets.ATT_CHUNKS/ATT_CHUNK_SIZE 保持一致,單一來源避免兩邊數字兜不起來 */
  docLimit() { return Math.round(Sheets.ATT_CHUNKS * Sheets.ATT_CHUNK_SIZE * 0.85); },
  docHardCap() { return Sheets.ATT_CHUNKS * Sheets.ATT_CHUNK_SIZE; },

  list() { return Store.load('appliances', []); },
  saveList(list) { Store.save('appliances', list); },

  sync(action, data) {
    if (!Sheets.enabled()) return;
    Sheets.push(action, data).then(ok => {
      if (!ok) toast('⚠️ 同步到 Google Sheet 失敗,資料先存在手機');
    });
  },

  /* ---------- 圖片壓縮(照片/附件共用,見 Shows.compressPoster 的壓法) ---------- */
  readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  },

  // Google Sheet 單一儲存格硬上限是 5 萬字元,超過會整格寫入失敗——這條線不能退讓,
  // 所以下面壓到最後一輪還是超過的話,會再加碼壓到保證塞得下為止(犧牲畫質也要保正確性)。
  SHEET_CELL_HARD_CAP: 49500,

  renderJpeg(img, maxW, q, grayscale) {
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    if (grayscale) {
      // 轉灰階丟掉色彩資訊,同樣的位元組預算下能留更高解析度給文字細節——
      // 附件多半是收據/保固卡這種看內容不看色彩的文件照,犧牲顏色換清晰度划算
      const imgData = ctx.getImageData(0, 0, w, h);
      const px = imgData.data;
      for (let i = 0; i < px.length; i += 4) {
        const gray = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        px[i] = px[i + 1] = px[i + 2] = gray;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    return canvas.toDataURL('image/jpeg', q);
  },

  async compressImage(dataUrl, attempts, opts = {}) {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    const limit = opts.limit || 45000;
    const hardCap = opts.hardCap || this.SHEET_CELL_HARD_CAP;
    let out = '';
    for (const [maxW, q] of attempts) {
      out = this.renderJpeg(img, maxW, q, opts.grayscale);
      if (out.length < limit) return out;
    }
    // 內容特別密(例如密密麻麻的小字+雜訊),連最小的嘗試都還是超過——
    // 繼續往下壓到保證能塞進 Sheet 儲存格(們)為止,不然這筆資料會整個存不進去
    for (const [maxW, q] of [[400, 0.25], [280, 0.2], [180, 0.15]]) {
      if (out.length < hardCap) break;
      out = this.renderJpeg(img, maxW, q, opts.grayscale);
    }
    return out;
  },

  async pickAndCompress(file, attempts, opts) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) { toast('請選擇圖片檔'); return null; }
    try {
      return await this.compressImage(await this.readImageFile(file), attempts, opts);
    } catch {
      toast('圖片處理失敗,換一張試試');
      return null;
    }
  },

  /* 放大檢視(附件、家電照片共用)——原本用 window.open() 開新視窗,結果手機上(尤其
   * 加到主畫面後)那個新視窗/新分頁常常沒有明顯的關閉按鈕,使用者會卡住出不來。
   * 改用 App 現成的 Modal(跟其他彈窗共用同一套✕按鈕、點背景關閉的邏輯),保證關得掉。
   * 雙指縮放看細節還是能用——viewport 設定本來就沒有停用縮放。 */
  viewImage(dataUrl) {
    if (!dataUrl) return;
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <img src="${dataUrl}" alt="" style="width:100%;border-radius:10px;display:block;margin-top:8px">
    `);
  },

  /* ---------- 保固到期試算(輸入是自由文字,能辨識常見格式就順便算到期日) ---------- */
  parseWarrantyMonths(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (/^終身/.test(s)) return Infinity;
    let m = s.match(/^(\d+(?:\.\d+)?)\s*年$/);
    if (m) return Math.round(parseFloat(m[1]) * 12);
    m = s.match(/^(\d+)\s*個?月$/);
    if (m) return parseInt(m[1], 10);
    return null; // 看不懂的自訂文字(例如「保固到2028年」),不強行硬算,顯示原文就好
  },

  warrantyEndDate(purchaseDate, warrantyText) {
    if (!purchaseDate) return null;
    const months = this.parseWarrantyMonths(warrantyText);
    if (months == null) return null;
    if (months === Infinity) return 'lifetime';
    const d = new Date(purchaseDate + 'T00:00:00');
    d.setMonth(d.getMonth() + months);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /* 回傳 {label, cls, end} 給列表/詳情頁顯示的保固狀態小標籤(label 已經帶到期日,不用另外拼);
   * 算不出來就回傳 null(不顯示) */
  warrantyStatus(purchaseDate, warrantyText) {
    const end = this.warrantyEndDate(purchaseDate, warrantyText);
    if (!end) return null;
    if (end === 'lifetime') return { label: '終身保固', cls: 'done', end: null };
    const daysLeft = Math.ceil((new Date(end + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
    if (daysLeft < 0) return { label: `已過保(${end})`, cls: 'want', end };
    if (daysLeft <= 30) return { label: `剩 ${daysLeft} 天(${end})`, cls: 'warn', end };
    return { label: `保固至 ${end}`, cls: 'done', end };
  },

  fmtPrice(n) {
    return n ? `NT$ ${Number(n).toLocaleString('zh-TW')}` : '';
  },

  /* ---------- 列表 ---------- */
  render() {
    const listEl = document.getElementById('appliance-list');
    const empty = document.getElementById('appliance-empty');
    const list = [...this.list()].sort((a, b) => {
      const da = a.purchaseDate || '', db = b.purchaseDate || '';
      if (da !== db) return db.localeCompare(da); // 買比較新的排前面
      return (b.addedAt || 0) - (a.addedAt || 0);
    });

    empty.classList.toggle('hidden', list.length > 0);
    listEl.innerHTML = list.map(a => {
      const photo = a.photo
        ? `<img class="appliance-row-photo" src="${esc(a.photo)}" alt="" loading="lazy">`
        : `<div class="appliance-row-photo placeholder">🔌</div>`;
      const wstat = this.warrantyStatus(a.purchaseDate, a.warranty);
      const sub = [a.brand, a.category].filter(Boolean).map(esc).join(' · ');
      return `<button class="appliance-row" data-id="${esc(a.id)}">
        ${photo}
        <div class="appliance-row-body">
          <div class="appliance-row-title">${esc(a.name)}</div>
          ${sub ? `<div class="appliance-row-sub">${sub}</div>` : ''}
        </div>
        <div class="appliance-row-right">
          ${a.price ? `<div class="appliance-row-price">${esc(this.fmtPrice(a.price))}</div>` : ''}
          ${wstat ? `<span class="chip ${wstat.cls}">${esc(wstat.label)}</span>` : ''}
        </div>
      </button>`;
    }).join('');

    listEl.querySelectorAll('.appliance-row').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.id)));
  },

  textInput(id, value, placeholder) {
    return `<input type="text" id="${id}" placeholder="${esc(placeholder || '')}" value="${esc(value || '')}">`;
  },

  categoryInput(id, value = '') {
    return `<input type="text" id="${id}" list="appliance-category-list" placeholder="例:廚房家電(可留空)" value="${esc(value)}">
      <datalist id="appliance-category-list">${this.CATEGORIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  },

  warrantyInput(id, value = '') {
    return `<input type="text" id="${id}" list="appliance-warranty-list" placeholder="例:1年(可留空)" value="${esc(value)}">
      <datalist id="appliance-warranty-list">${this.WARRANTY_PRESETS.map(w => `<option value="${esc(w)}">`).join('')}</datalist>`;
  },

  /* 附件縮圖(有照片就顯示縮圖,沒有就顯示上傳按鈕的空格子) */
  attachmentThumb(dataUrl) {
    return dataUrl
      ? `<img class="attachment-thumb" src="${esc(dataUrl)}" alt="">`
      : `<div class="attachment-thumb placeholder">📎</div>`;
  },

  /* 附件實際壓成多大——直接量給使用者看,不用再憑感覺猜「是不是還是很模糊」 */
  attachmentInfo(dataUrl) {
    if (!dataUrl) return Promise.resolve('');
    const kb = Math.round(dataUrl.length * 0.75 / 1024);
    return new Promise(resolve => {
      const im = new Image();
      im.onload = () => resolve(`${im.naturalWidth}×${im.naturalHeight}·約${kb}KB`);
      im.onerror = () => resolve(`約${kb}KB`);
      im.src = dataUrl;
    });
  },

  /* 讓 textarea 自動長高到能看見完整內容,不用手動拉、也不會把內容藏在捲軸裡看不到 */
  autoGrowTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';
  },

  /* ---------- 新增 ---------- */
  openAdd() {
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>新增家電</h2>
      <label>品名 *</label>
      ${this.textInput('a-name', '', '例:變頻冷氣')}
      <label>品牌</label>
      ${this.textInput('a-brand', '', '例:大金')}
      <label>分類</label>
      ${this.categoryInput('a-category')}
      <label>型號 / 序號</label>
      ${this.textInput('a-model', '', '維修、保固諮詢時會用到')}
      <label>購買日期</label>
      <input type="date" id="a-purchase-date" value="${todayStr()}">
      <label>價格</label>
      <input type="number" id="a-price" min="0" step="1" placeholder="例:35000">
      <label>保固期間</label>
      ${this.warrantyInput('a-warranty')}
      <label>採購地點</label>
      ${this.textInput('a-place', '', '例:燦坤、momo購物網')}
      <label>參考網址</label>
      <input type="url" id="a-url" placeholder="商品頁、訂單連結…">
      <label>照片</label>
      <div class="btn-row">
        <button type="button" class="btn" id="a-photo-upload">📷 上傳照片</button>
        <input type="file" id="a-photo-file" accept="image/*" hidden>
      </div>
      <div id="a-photo-preview"></div>
      <label>附件(收據、保固卡、說明書等,最多 3 張)</label>
      <div id="a-attachments"></div>
      <label>備註</label>
      <textarea id="a-notes" placeholder="安裝師傅、注意事項…"></textarea>
      <button class="btn primary block" id="a-add">加入清單</button>
    `);

    document.getElementById('a-notes').addEventListener('input', e => this.autoGrowTextarea(e.target));

    let uploadedPhoto = '';
    document.getElementById('a-photo-upload').addEventListener('click', () =>
      document.getElementById('a-photo-file').click());
    document.getElementById('a-photo-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      const dataUrl = await this.pickAndCompress(file, this.PHOTO_ATTEMPTS);
      if (!dataUrl) return;
      uploadedPhoto = dataUrl;
      document.getElementById('a-photo-preview').innerHTML =
        `<img src="${dataUrl}" alt="" style="width:96px;aspect-ratio:4/3;object-fit:cover;border-radius:8px;margin-top:6px">`;
    });

    const uploadedAttachments = ['', '', ''];
    const attBox = document.getElementById('a-attachments');
    attBox.innerHTML = this.ATT_LABELS.map((label, i) => `
      <div class="attachment-item">
        ${this.attachmentThumb('')}
        <span class="attachment-name" id="a-att-name-${i}">${esc(label)}(未上傳)</span>
        <div class="attachment-actions">
          <button type="button" class="btn" data-i="${i}">上傳</button>
        </div>
        <input type="file" id="a-att-file-${i}" accept="image/*" hidden>
      </div>`).join('');
    attBox.querySelectorAll('button[data-i]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('a-att-file-' + btn.dataset.i).click()));
    this.ATT_LABELS.forEach((label, i) => {
      document.getElementById('a-att-file-' + i).addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        const dataUrl = await this.pickAndCompress(file, this.DOC_ATTEMPTS, { grayscale: true, limit: this.docLimit(), hardCap: this.docHardCap() });
        if (!dataUrl) return;
        uploadedAttachments[i] = dataUrl;
        const row = attBox.children[i];
        row.querySelector('.attachment-thumb').outerHTML = this.attachmentThumb(dataUrl);
        const nameEl = document.getElementById('a-att-name-' + i);
        nameEl.textContent = label + '(已上傳)';
        this.attachmentInfo(dataUrl).then(info => { if (info) nameEl.textContent += ' · ' + info; });
      });
    });

    document.getElementById('a-add').addEventListener('click', () => {
      const name = document.getElementById('a-name').value.trim();
      if (!name) { toast('請輸入品名'); return; }
      this.add({
        name,
        brand: document.getElementById('a-brand').value.trim(),
        category: document.getElementById('a-category').value.trim(),
        model: document.getElementById('a-model').value.trim(),
        purchaseDate: document.getElementById('a-purchase-date').value || '',
        price: +document.getElementById('a-price').value || 0,
        warranty: document.getElementById('a-warranty').value.trim(),
        place: document.getElementById('a-place').value.trim(),
        url: document.getElementById('a-url').value.trim(),
        photo: uploadedPhoto,
        attachments: [...uploadedAttachments],
        notes: document.getElementById('a-notes').value.trim(),
      });
    });
  },

  add(item) {
    const list = this.list();
    const a = {
      id: 'a' + Date.now(),
      attachments: ['', '', ''],
      ...item,
      addedAt: Date.now(),
    };
    list.push(a);
    this.saveList(list);
    this.sync('upsertAppliance', Sheets.applianceToRow(a));
    Modal.close();
    this.render();
    toast(`已加入「${a.name}」`);
  },

  /* ---------- 詳情 ---------- */
  openDetail(id) {
    const list = this.list();
    const a = list.find(x => x.id === id);
    if (!a) return;
    a.attachments = a.attachments || ['', '', ''];

    const save = () => { this.saveList(list); this.render(); };
    let upsertTimer;
    const syncAppliance = (delay = 0) => {
      clearTimeout(upsertTimer);
      if (delay > 0) upsertTimer = setTimeout(() => this.sync('upsertAppliance', Sheets.applianceToRow(a)), delay);
      else this.sync('upsertAppliance', Sheets.applianceToRow(a));
    };

    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <div class="detail-head">
        <div class="detail-photo-wrap">
          <img class="detail-photo" id="d-photo-img" src="${esc(a.photo)}" alt=""
               style="${a.photo ? '' : 'display:none'}">
          <div class="detail-photo placeholder" id="d-photo-ph" style="${a.photo ? 'display:none' : ''}">🔌</div>
          <button type="button" class="poster-upload-btn" id="d-photo-btn" title="上傳照片">📷</button>
          <input type="file" id="d-photo-file" accept="image/*" hidden>
        </div>
        <div>
          <div class="detail-title">${esc(a.name)}</div>
          <div class="detail-sub">${[a.brand, a.category].filter(Boolean).map(esc).join(' · ')}</div>
          <div id="d-warranty-status"></div>
        </div>
      </div>

      <label>品名</label>
      ${this.textInput('d-name', a.name)}
      <label>品牌</label>
      ${this.textInput('d-brand', a.brand)}
      <label>分類</label>
      ${this.categoryInput('d-category', a.category)}
      <label>型號 / 序號</label>
      ${this.textInput('d-model', a.model, '維修、保固諮詢時會用到')}
      <label>購買日期</label>
      <input type="date" id="d-purchase-date" value="${esc(a.purchaseDate || '')}">
      <label>價格</label>
      <input type="number" id="d-price" min="0" step="1" value="${a.price || ''}">
      <label>保固期間</label>
      ${this.warrantyInput('d-warranty', a.warranty)}
      <label>採購地點</label>
      ${this.textInput('d-place', a.place)}
      <label>參考網址</label>
      <input type="url" id="d-url" placeholder="商品頁、訂單連結…" value="${esc(a.url || '')}">
      ${a.url ? `<p class="hint"><a href="${esc(a.url)}" target="_blank" rel="noopener">🔗 開啟連結</a></p>` : ''}
      <label>附件(收據、保固卡、說明書等)</label>
      <div id="d-attachments"></div>
      <label>備註</label>
      <textarea id="d-notes" placeholder="安裝師傅、注意事項…">${esc(a.notes)}</textarea>

      <button class="btn danger block" id="d-delete">從清單移除</button>
    `);

    const renderWarrantyStatus = () => {
      const box = document.getElementById('d-warranty-status');
      const wstat = this.warrantyStatus(a.purchaseDate, a.warranty);
      box.innerHTML = wstat ? `<span class="chip ${wstat.cls}">${esc(wstat.label)}</span>` : '';
    };
    renderWarrantyStatus();
    this.autoGrowTextarea(document.getElementById('d-notes')); // 一打開就長到能顯示既有備註全文,不用捲動

    // 照片(點縮圖放大看,點右下角相機圖示才是換照片)
    document.getElementById('d-photo-img').addEventListener('click', () => this.viewImage(a.photo));
    document.getElementById('d-photo-btn').addEventListener('click', () =>
      document.getElementById('d-photo-file').click());
    document.getElementById('d-photo-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      const dataUrl = await this.pickAndCompress(file, this.PHOTO_ATTEMPTS);
      if (!dataUrl) return;
      a.photo = dataUrl;
      const img = document.getElementById('d-photo-img');
      const ph = document.getElementById('d-photo-ph');
      img.src = dataUrl; img.style.display = '';
      ph.style.display = 'none';
      save(); syncAppliance();
      toast('照片已更新');
    });

    // 基本欄位(輸入類延遲同步,避免每個字都送出;日期/下拉類立刻同步)
    document.getElementById('d-name').addEventListener('input', e => {
      a.name = e.target.value.trim();
      document.querySelector('.detail-title').textContent = a.name;
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-brand').addEventListener('input', e => {
      a.brand = e.target.value.trim();
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-category').addEventListener('input', e => {
      a.category = e.target.value.trim();
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-model').addEventListener('input', e => {
      a.model = e.target.value.trim();
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-purchase-date').addEventListener('change', e => {
      a.purchaseDate = e.target.value;
      renderWarrantyStatus();
      save(); syncAppliance();
    });
    document.getElementById('d-price').addEventListener('input', e => {
      a.price = +e.target.value || 0;
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-warranty').addEventListener('input', e => {
      a.warranty = e.target.value.trim();
      renderWarrantyStatus();
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-place').addEventListener('input', e => {
      a.place = e.target.value.trim();
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-url').addEventListener('input', e => {
      a.url = e.target.value.trim();
      this.saveList(list); syncAppliance(1200);
    });
    document.getElementById('d-notes').addEventListener('input', e => {
      a.notes = e.target.value;
      this.autoGrowTextarea(e.target);
      this.saveList(list); syncAppliance(1200);
    });

    // 附件:三格,各自可上傳/替換/移除
    const attBox = document.getElementById('d-attachments');
    const renderAttachments = () => {
      attBox.innerHTML = this.ATT_LABELS.map((label, i) => `
        <div class="attachment-item">
          ${this.attachmentThumb(a.attachments[i])}
          <span class="attachment-name" id="d-att-name-${i}">${esc(label)}${a.attachments[i] ? '' : '(未上傳)'}</span>
          <div class="attachment-actions">
            ${a.attachments[i] ? `<button type="button" data-view="${i}" title="查看">👁</button>` : ''}
            <button type="button" data-up="${i}" title="上傳/替換">📷</button>
            ${a.attachments[i] ? `<button type="button" data-rm="${i}" title="移除">✕</button>` : ''}
          </div>
          <input type="file" id="d-att-file-${i}" accept="image/*" hidden>
        </div>`).join('');
      // 實際壓縮結果(解析度、大約多少 KB)直接標在名稱後面,不用再憑感覺猜清不清楚
      a.attachments.forEach((val, i) => {
        if (!val) return;
        this.attachmentInfo(val).then(info => {
          const el = document.getElementById('d-att-name-' + i);
          if (el && info) el.textContent = this.ATT_LABELS[i] + ' · ' + info;
        });
      });
      attBox.querySelectorAll('[data-view]').forEach(btn =>
        btn.addEventListener('click', () => this.viewImage(a.attachments[+btn.dataset.view])));
      attBox.querySelectorAll('[data-up]').forEach(btn =>
        btn.addEventListener('click', () => document.getElementById('d-att-file-' + btn.dataset.up).click()));
      attBox.querySelectorAll('[data-rm]').forEach(btn =>
        btn.addEventListener('click', () => {
          a.attachments[+btn.dataset.rm] = '';
          save(); syncAppliance();
          renderAttachments();
        }));
      this.ATT_LABELS.forEach((label, i) => {
        document.getElementById('d-att-file-' + i).addEventListener('change', async e => {
          const file = e.target.files[0];
          e.target.value = '';
          const dataUrl = await this.pickAndCompress(file, this.DOC_ATTEMPTS, { grayscale: true, limit: this.docLimit(), hardCap: this.docHardCap() });
          if (!dataUrl) return;
          a.attachments[i] = dataUrl;
          save(); syncAppliance();
          renderAttachments();
          toast(label + '已上傳');
        });
      });
    };
    renderAttachments();

    // 刪除
    document.getElementById('d-delete').addEventListener('click', () => {
      const warn = Sheets.enabled()
        ? `確定要移除「${a.name}」嗎?\nGoogle Sheet 上這筆資料也會一併刪除。`
        : `確定要移除「${a.name}」嗎?`;
      if (!confirm(warn)) return;
      const idx = list.indexOf(a);
      list.splice(idx, 1);
      save();
      this.sync('deleteAppliance', { id: a.id });
      Modal.close();
      toast('已移除');
    });
  },
};
