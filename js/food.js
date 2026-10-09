/* 美食地圖:記下想吃的店、記錄什麼時候吃過什麼。
 * ⚠️ 網頁 App 沒辦法在背景偵測位置(iPhone 不讓網頁在關著的時候知道你在哪),
 * 所以「到了店附近跳出提醒」是在打開這一頁(或 App 從背景切回來)時抓一次 GPS,
 * 比對存過的店,夠近就跳出提醒問要不要記一筆。
 * 地圖用 Leaflet + OpenStreetMap(免費、不用金鑰),第一次打開這頁才載入,不拖慢 App 啟動。
 * 店名搜尋用 OpenStreetMap 的 Nominatim(有 CORS),但台灣小店常常搜不到,
 * 所以也可以用目前位置、或在地圖上點一下選位置。 */
const Food = {
  STATUS: { want: '想吃', been: '吃過' },
  CATEGORIES: ['小吃', '麵食', '拉麵', '火鍋', '燒肉', '日式', '韓式', '泰式', '義式', '中式', '早午餐', '咖啡廳', '甜點', '飲料', '夜市', '其他'],
  NEAR_M: 150,          // 多近算「人在這間店」:GPS 在室內常飄 50~100 公尺,抓寬一點
  NEARBY_LIST_M: 1000,  // 頁面上方「附近有幾間想吃的店」的範圍
  PROMPT_COOLDOWN: 4 * 3600 * 1000, // 同一間店提醒過後 4 小時內不再跳,免得每次切回來都被問
  MAX_PHOTOS: 2,
  LEAFLET: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/',
  NOMINATIM: 'https://nominatim.openstreetmap.org',
  view: 'map',
  search: '',
  pos: null,            // 最近一次定位 {lat, lng, acc}
  posError: '',
  locating: false,
  map: null,
  markerLayer: null,
  meMarker: null,
  leafletReady: null,

  places() { return Store.load('foodPlaces', []); },
  visits() { return Store.load('foodVisits', []); },
  savePlaces(list) { Store.save('foodPlaces', list); },
  saveVisits(list) { Store.save('foodVisits', list); },

  /* msg 有給的話(新增類動作),送出後會明確顯示「已同步」或「同步失敗」 */
  sync(action, data, msg) {
    if (msg) { Sheets.pushNotify(action, data, msg); return; }
    if (!Sheets.enabled()) return;
    Sheets.push(action, data).then(ok => {
      if (!ok) toast('⚠️ 同步到 Google Sheet 失敗,資料先存在手機');
    });
  },

  /* 從一個彈窗換到另一個彈窗(店家詳情 ↔ 記一筆)時先關再開,
   * 不然 Modal 記住的捲動位置會被覆蓋成 0,關掉後頁面跳回最上面 */
  openModal(html) {
    if (!document.getElementById('modal-backdrop').classList.contains('hidden')) Modal.close();
    Modal.open(html);
  },

  /* ---------- 位置/距離 ---------- */
  hasLoc(p) { return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng); },

  distance(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },

  distTo(p) { return this.pos && this.hasLoc(p) ? this.distance(this.pos, p) : null; },

  fmtDist(m) {
    if (m == null) return '';
    return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} 公尺` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} 公里`;
  },

  locate() {
    return new Promise(resolve => {
      if (!navigator.geolocation) { this.posError = 'fail'; resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        p => {
          this.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
          this.posError = '';
          resolve(this.pos);
        },
        err => { this.posError = err.code === 1 ? 'denied' : 'fail'; resolve(null); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  },

  posErrorMsg() {
    return this.posError === 'denied'
      ? '沒有定位權限:到手機「設定」允許瀏覽器使用位置,才會有附近提醒'
      : '暫時抓不到位置';
  },

  /* 打開美食頁時:先畫畫面,再定位、比對附近的店 */
  async onShow() {
    this.render();
    if (this.view === 'map') this.ensureMap();
    await this.relocate(true);
  },

  async relocate(recenter) {
    if (this.locating) return;
    this.locating = true;
    this.renderMeta();
    const pos = await this.locate();
    this.locating = false;
    this.render();
    if (!pos) return;
    this.updateMe();
    if (recenter && this.map) this.map.setView([pos.lat, pos.lng], Math.max(this.map.getZoom(), 15));
    this.checkNearby();
  },

  /* 人在存過的店附近 → 跳出提醒問要不要記一筆 */
  checkNearby() {
    if (!this.pos || currentPage !== 'food') return;
    if (!document.getElementById('modal-backdrop').classList.contains('hidden')) return; // 正在填別的東西,不打擾
    const radius = Math.min(300, Math.max(this.NEAR_M, this.pos.acc || 0));
    const now = Date.now(), today = todayStr();
    const prompted = Store.load('foodPrompt', {});
    const visits = this.visits();
    const near = this.places()
      .map(p => ({ p, d: this.distTo(p) }))
      .filter(x => x.d != null && x.d <= radius)
      .filter(x => !(prompted[x.p.id] > now - this.PROMPT_COOLDOWN))
      .filter(x => !visits.some(v => v.placeId === x.p.id && v.date === today)) // 今天已經記過了
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    if (!near.length) return;

    const kept = {};
    for (const [id, t] of Object.entries(prompted)) if (t > now - this.PROMPT_COOLDOWN) kept[id] = t;
    near.forEach(x => { kept[x.p.id] = now; });
    Store.save('foodPrompt', kept);

    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>📍 你好像在這附近</h2>
      ${near.map(({ p, d }) => {
        const last = this.lastVisit(p.id);
        return `<div class="nearby-item">
          <div class="nearby-name">${esc(p.name)}</div>
          <div class="nearby-sub">
            <span class="chip ${p.status === 'been' ? 'done' : 'want'}">${esc(this.STATUS[p.status] || this.STATUS.want)}</span>
            <span class="chip">約 ${esc(this.fmtDist(d))}</span>
          </div>
          ${p.wish ? `<div class="nearby-wish">📝 想吃:${esc(p.wish)}</div>` : ''}
          ${last ? `<div class="nearby-wish">上次來:${esc(last.date)}${last.dishes ? ',吃了' + esc(last.dishes) : ''}</div>` : ''}
          <div class="btn-row">
            <button class="btn primary" data-log="${esc(p.id)}">🍽️ 記一筆</button>
            <button class="btn" data-detail="${esc(p.id)}">看店家</button>
          </div>
        </div>`;
      }).join('')}
      <button class="btn block" data-close>沒有,只是路過</button>
    `);
    document.querySelectorAll('#modal [data-log]').forEach(btn =>
      btn.addEventListener('click', () => this.openVisit(btn.dataset.log, null, false)));
    document.querySelectorAll('#modal [data-detail]').forEach(btn =>
      btn.addEventListener('click', () => this.openDetail(btn.dataset.detail)));
  },

  /* ---------- 地圖(Leaflet,第一次用到才載入) ---------- */
  loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!this.leafletReady) {
      this.leafletReady = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = this.LEAFLET + 'leaflet.css';
        document.head.appendChild(css);
        const s = document.createElement('script');
        s.src = this.LEAFLET + 'leaflet.js';
        s.onload = resolve;
        s.onerror = () => { this.leafletReady = null; s.remove(); reject(new Error('LEAFLET_LOAD_FAIL')); };
        document.head.appendChild(s);
      });
    }
    return this.leafletReady;
  },

  tileLayer() {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    });
  },

  pinIcon(status) {
    const been = status === 'been';
    return L.divIcon({
      className: '',
      html: `<div class="food-pin ${been ? 'been' : 'want'}">${been ? '😋' : '🍴'}</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
  },

  async ensureMap() {
    try { await this.loadLeaflet(); }
    catch { document.getElementById('food-meta-text').textContent = '⚠️ 地圖載入失敗(網路不穩?),可以先切到清單'; return; }
    const el = document.getElementById('food-map');
    if (el.offsetParent === null) return; // 還沒顯示出來(已經切走了),等下次打開再畫
    if (!this.map) {
      this.map = L.map(el, { zoomControl: false });
      this.tileLayer().addTo(this.map);
      this.markerLayer = L.layerGroup().addTo(this.map);
      // 縮得太遠時店名標籤會疊成一團,只在街道層級才顯示
      const toggleLabels = () => el.classList.toggle('hide-labels', this.map.getZoom() < 14);
      this.map.on('zoomend', toggleLabels);
      this.fitView();
      toggleLabels();
    }
    this.map.invalidateSize();
    this.drawMarkers();
    this.updateMe();
  },

  fitView() {
    if (!this.map) return;
    const pts = this.filteredPlaces().filter(p => this.hasLoc(p)).map(p => [p.lat, p.lng]);
    if (this.pos) this.map.setView([this.pos.lat, this.pos.lng], 15);
    else if (pts.length) this.map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    else this.map.setView([23.7, 120.95], 7); // 什麼都沒有就先看全台灣
  },

  drawMarkers() {
    if (!this.map) return;
    this.markerLayer.clearLayers();
    this.filteredPlaces().filter(p => this.hasLoc(p)).forEach(p => {
      L.marker([p.lat, p.lng], { icon: this.pinIcon(p.status), title: p.name })
        .bindTooltip(esc(p.name), { permanent: true, direction: 'bottom', offset: [0, 12], className: 'food-pin-label' })
        .on('click', () => this.openDetail(p.id))
        .addTo(this.markerLayer);
    });
  },

  updateMe() {
    if (!this.map || !this.pos) return;
    const ll = [this.pos.lat, this.pos.lng];
    if (!this.meMarker) {
      this.meMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#4f6ef7', fillOpacity: 1 })
        .addTo(this.map);
    } else this.meMarker.setLatLng(ll);
  },

  /* ---------- 地點搜尋(OpenStreetMap Nominatim) ---------- */
  /* OSM 回傳的地址是「店名, 號, 路, 區, 市, 郵遞區號, 臺灣」由小到大,
   * 台灣/日本的地址習慣由大到小,倒過來接起來才像平常看到的地址 */
  shortAddr(display, name) {
    const parts = String(display || '').split(',').map(s => s.trim()).filter(Boolean);
    if (name && parts[0] === name) parts.shift();
    const rest = parts.filter(s => !/^\d{3,6}$/.test(s) && !['臺灣', '台灣', 'Taiwan'].includes(s));
    return /[一-鿿]/.test(rest.join('')) ? rest.reverse().join('') : rest.join(', ');
  },

  /* 有結構化地址就只挑「縣市 + 區 + 路 + 號」組起來,display_name 會混進商圈、里名這類雜訊 */
  fmtAddr(r) {
    const a = r.address;
    if (!a || !a.road || !/[一-鿿]/.test(a.road)) return this.shortAddr(r.display_name, r.name);
    const hn = a.house_number ? (/號$/.test(a.house_number) ? a.house_number : a.house_number + '號') : '';
    return [a.city || a.county || a.state || '', a.suburb || a.city_district || a.town || a.district || '', a.road, hn]
      .filter((v, i, arr) => v && arr.indexOf(v) === i).join('');
  },

  async geoSearch(q) {
    const params = new URLSearchParams({ q, format: 'jsonv2', limit: '8', addressdetails: '1', 'accept-language': 'zh-TW' });
    if (this.pos) { // 優先找附近的(不是只限附近,出國也搜得到)
      const d = 0.3;
      params.set('viewbox', [this.pos.lng - d, this.pos.lat + d, this.pos.lng + d, this.pos.lat - d].join(','));
    }
    const res = await fetch(`${this.NOMINATIM}/search?${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).map(r => ({
      name: r.name || String(r.display_name || '').split(',')[0],
      address: this.fmtAddr(r),
      lat: +r.lat, lng: +r.lon,
    }));
  },

  async geoReverse(lat, lng) {
    const params = new URLSearchParams({ lat, lon: lng, format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'zh-TW' });
    const res = await fetch(`${this.NOMINATIM}/reverse?${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = await res.json();
    if (!r || r.error) return null;
    return { name: r.name || '', address: this.fmtAddr(r) };
  },

  /* 貼上完整的 Google 地圖網址時,順便從網址裡撈座標(短網址 maps.app.goo.gl 撈不到,要點開才知道) */
  coordsFromUrl(url) {
    let s = String(url || '');
    try { s = decodeURIComponent(s); } catch { /* 編碼怪怪的就用原字串 */ }
    const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
              s.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    return m ? { lat: +m[1], lng: +m[2] } : null;
  },

  mapsUrl(p) {
    const q = p.address ? `${p.name} ${p.address}` : this.hasLoc(p) ? `${p.lat},${p.lng}` : p.name;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  },

  /* ---------- 位置選擇器(新增/詳情共用):目前位置、或在小地圖上點選,圖釘可拖曳微調 ---------- */
  locPickerHtml(prefix) {
    return `<div class="btn-row">
        <button type="button" class="btn" id="${prefix}-loc-here">📍 用目前位置</button>
        <button type="button" class="btn" id="${prefix}-loc-map">🗺️ 在地圖上選</button>
      </div>
      <p class="food-loc-status" id="${prefix}-loc-status"></p>
      <div class="food-mini-map hidden" id="${prefix}-mini-map"></div>`;
  },

  /* target 是要被寫入 lat/lng 的物件(新增時的草稿,或既有的店家);onChange(source) 在位置改變後呼叫 */
  bindLocPicker(prefix, target, onChange) {
    const status = document.getElementById(prefix + '-loc-status');
    const mapEl = document.getElementById(prefix + '-mini-map');
    let mini = null, pin = null;

    const showStatus = () => {
      const d = this.distTo(target);
      status.textContent = this.hasLoc(target)
        ? `✅ 已設定位置${d != null ? `(離你約 ${this.fmtDist(d)})` : ''}`
        : '還沒設定位置(沒有位置的店不會出現在地圖上,也不會有附近提醒)';
    };
    const drawPin = () => {
      if (!mini || !this.hasLoc(target)) return;
      const ll = [target.lat, target.lng];
      if (pin) { pin.setLatLng(ll); return; }
      pin = L.marker(ll, { draggable: true, icon: this.pinIcon(target.status) }).addTo(mini);
      pin.on('dragend', () => { const p = pin.getLatLng(); setLoc(p.lat, p.lng, 'map'); });
    };
    const showMap = async () => {
      try { await this.loadLeaflet(); } catch { toast('地圖載入失敗,稍後再試'); return; }
      mapEl.classList.remove('hidden');
      const center = this.hasLoc(target) ? [target.lat, target.lng] : this.pos ? [this.pos.lat, this.pos.lng] : [25.04, 121.53];
      if (!mini) {
        mini = L.map(mapEl, { zoomControl: false }).setView(center, 17);
        this.tileLayer().addTo(mini);
        mini.on('click', e => setLoc(e.latlng.lat, e.latlng.lng, 'map'));
      } else mini.setView(center, Math.max(mini.getZoom(), 16));
      setTimeout(() => mini.invalidateSize(), 60); // 彈窗動畫跑完才量得到正確尺寸
      drawPin();
    };
    const setLoc = (lat, lng, source) => {
      target.lat = +(+lat).toFixed(6);
      target.lng = +(+lng).toFixed(6);
      showStatus();
      drawPin();
      if (mini && source !== 'map') mini.setView([target.lat, target.lng], 17);
      if (onChange) onChange(source);
    };

    document.getElementById(prefix + '-loc-here').addEventListener('click', async () => {
      status.textContent = '📍 定位中…';
      const pos = await this.locate();
      if (!pos) { toast(this.posErrorMsg()); showStatus(); return; }
      setLoc(pos.lat, pos.lng, 'here');
      showMap();
    });
    document.getElementById(prefix + '-loc-map').addEventListener('click', async () => {
      await showMap();
      if (!this.hasLoc(target)) status.textContent = '在地圖上點一下店的位置(圖釘可以拖曳微調)';
    });
    showStatus();
    return { setLoc, showMap };
  },

  /* ---------- 紀錄小工具 ---------- */
  byVisitDesc(a, b) { return ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || '')); },
  visitsOf(placeId) { return this.visits().filter(v => v.placeId === placeId).sort(this.byVisitDesc); },
  lastVisit(placeId) { return this.visitsOf(placeId)[0] || null; },

  nowTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  usedValues(field, from) {
    return [...new Set(from.map(x => (x[field] || '').trim()).filter(Boolean))]
      .sort((x, y) => x.localeCompare(y, 'zh-TW'));
  },
  categoryOptions() { return [...new Set([...this.CATEGORIES, ...this.usedValues('category', this.places())])]; },

  starsHtml(n) { return n ? `<span class="stars-small">${'★'.repeat(n)}</span>` : ''; },

  /* 放大看照片:自己蓋一層在彈窗上面(不用 Modal,不然正在填的表單會被換掉) */
  viewPhoto(src) {
    if (!src) return;
    const ov = document.createElement('div');
    ov.className = 'photo-overlay';
    ov.innerHTML = `<img src="${src}" alt=""><button class="modal-close">✕</button>`;
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
  },

  /* ---------- 列表 ---------- */
  filteredPlaces() {
    const q = (this.search || '').trim().toLowerCase();
    const places = this.places();
    if (!q) return places;
    const visitText = {};
    this.visits().forEach(v => {
      visitText[v.placeId] = (visitText[v.placeId] || '') + ' ' + [v.dishes, v.notes, v.who].join(' ');
    });
    return places.filter(p =>
      [p.name, p.category, p.wish, p.address, visitText[p.id]].some(s => (s || '').toLowerCase().includes(q)));
  },

  renderMeta() {
    const el = document.getElementById('food-meta-text');
    if (!el) return;
    if (this.locating) { el.textContent = '📍 定位中…'; return; }
    if (!this.pos) { el.textContent = this.posError ? '📍 ' + this.posErrorMsg() : ''; return; }
    const nearWant = this.places().filter(p => p.status !== 'been' && (this.distTo(p) ?? Infinity) <= this.NEARBY_LIST_M).length;
    el.textContent = nearWant ? `📍 附近 1 公里內有 ${nearWant} 間想吃的店` : '📍 附近 1 公里內沒有想吃的店';
  },

  render() {
    const view = this.view;
    document.querySelectorAll('#food-view button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('food-map-wrap').classList.toggle('hidden', view !== 'map');
    this.renderMeta();
    const listEl = document.getElementById('food-list');
    const empty = document.getElementById('food-empty');
    const emptyText = empty.querySelector('p');
    const q = (this.search || '').trim();

    if (view === 'map') {
      listEl.innerHTML = '';
      const none = !this.places().length;
      empty.classList.toggle('hidden', !none);
      emptyText.innerHTML = '還沒有記任何店喔!<br>按右上角「＋」記下第一間想吃的店';
      if (this.map) {
        // 頁面藏起來時量到的尺寸是 0,這時重算會讓地圖錯位,等真的顯示(ensureMap)再算
        if (document.getElementById('food-map').offsetParent) this.map.invalidateSize();
        this.drawMarkers();
      }
      return;
    }

    let html = '', count = 0;
    if (view === 'log') {
      const placeMap = new Map(this.places().map(p => [p.id, p]));
      const ql = q.toLowerCase();
      const vs = this.visits()
        .filter(v => placeMap.has(v.placeId))
        .filter(v => !ql || [placeMap.get(v.placeId).name, placeMap.get(v.placeId).category, v.dishes, v.notes, v.who]
          .some(s => (s || '').toLowerCase().includes(ql)))
        .sort(this.byVisitDesc);
      let month = '';
      vs.forEach(v => {
        const m = (v.date || '').slice(0, 7);
        if (m && m !== month) {
          month = m;
          html += `<div class="food-month">${m.slice(0, 4)} 年 ${+m.slice(5)} 月</div>`;
        }
        html += this.visitRow(v, placeMap.get(v.placeId));
      });
      count = vs.length;
      emptyText.innerHTML = q ? `找不到符合「${esc(q)}」的紀錄`
        : '還沒有吃過的紀錄<br>到店家詳情按「🍽️ 記一筆」就會出現在這裡';
    } else {
      const last = {};
      this.visits().forEach(v => {
        if (!last[v.placeId] || this.byVisitDesc(v, last[v.placeId]) < 0) last[v.placeId] = v;
      });
      const ps = this.filteredPlaces().filter(p => (p.status || 'want') === view);
      if (view === 'want') {
        // 有定位就照距離排(逛到附近時打開看一眼,最近的在最上面),沒定位就新加的在前面
        ps.sort((a, b) => this.pos
          ? (this.distTo(a) ?? Infinity) - (this.distTo(b) ?? Infinity)
          : (b.addedAt || 0) - (a.addedAt || 0));
      } else {
        ps.sort((a, b) => ((last[b.id]?.date || '') + (last[b.id]?.time || ''))
          .localeCompare((last[a.id]?.date || '') + (last[a.id]?.time || '')));
      }
      html = ps.map(p => this.placeRow(p, last[p.id])).join('');
      count = ps.length;
      emptyText.innerHTML = q ? `找不到符合「${esc(q)}」的店`
        : view === 'want' ? '想吃清單是空的<br>按右上角「＋」記下想吃的店'
        : '還沒有吃過的店<br>到店家詳情按「🍽️ 記一筆」就會移到這裡';
    }
    listEl.innerHTML = html;
    empty.classList.toggle('hidden', count > 0);

    listEl.querySelectorAll('[data-place]').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.place)));
    listEl.querySelectorAll('[data-visit]').forEach(el =>
      el.addEventListener('click', () => {
        const v = this.visits().find(x => x.id === el.dataset.visit);
        if (v) this.openVisit(v.placeId, v.id, false);
      }));
  },

  placeRow(p, last) {
    const d = this.distTo(p);
    const thumb = last?.photos?.[0]
      ? `<img class="food-row-thumb" src="${esc(last.photos[0])}" alt="" loading="lazy">`
      : `<div class="food-row-thumb placeholder">${p.status === 'been' ? '😋' : '🍴'}</div>`;
    const sub = [p.category, p.address].filter(Boolean).map(esc).join(' · ');
    let extra = '';
    if (p.status === 'been' && last) {
      const n = this.visits().filter(v => v.placeId === p.id).length;
      extra = `<div class="food-row-sub">上次 ${esc(last.date)} · 吃過 ${n} 次 ${this.starsHtml(last.rating)}</div>`;
    }
    return `<button class="food-row ${p.status === 'been' ? 'been' : 'want'}" data-place="${esc(p.id)}">
      ${thumb}
      <div class="food-row-body">
        <div class="food-row-title">${esc(p.name)}</div>
        ${sub ? `<div class="food-row-sub">${sub}</div>` : ''}
        ${p.wish ? `<div class="food-row-wish">📝 ${esc(p.wish)}</div>` : ''}
        ${extra}
      </div>
      ${d != null ? `<div class="food-row-right"><span class="chip">${esc(this.fmtDist(d))}</span></div>` : ''}
    </button>`;
  },

  visitRow(v, p) {
    const thumb = v.photos?.[0]
      ? `<img class="food-row-thumb" src="${esc(v.photos[0])}" alt="" loading="lazy">`
      : `<div class="food-row-thumb placeholder">🍽️</div>`;
    const when = `${v.date ? +v.date.slice(5, 7) + '/' + +v.date.slice(8, 10) : ''} ${v.time || ''}`.trim();
    return `<button class="food-row been" data-visit="${esc(v.id)}">
      ${thumb}
      <div class="food-row-body">
        <div class="food-row-title">${esc(p.name)}</div>
        <div class="food-row-sub">${esc(when)} ${this.starsHtml(v.rating)}${v.who ? ' · 跟' + esc(v.who) : ''}</div>
        ${v.dishes ? `<div class="food-row-wish">${esc(v.dishes)}</div>` : ''}
      </div>
      ${v.cost ? `<div class="food-row-right"><span class="food-cost">$${esc(Number(v.cost).toLocaleString('zh-TW'))}</span></div>` : ''}
    </button>`;
  },

  /* ---------- 新增店家 ---------- */
  openAdd() {
    const draft = { lat: null, lng: null, status: 'want' };
    let autoAddr = '', autoName = '';
    this.openModal(`
      <button class="modal-close" data-close>✕</button>
      <h2>新增想吃的店</h2>
      <label>搜尋店名(OpenStreetMap,小店可能搜不到)</label>
      <div class="food-search-row">
        <input type="search" id="f-q" placeholder="例:阜杭豆漿" autocomplete="off" enterkeyhint="search">
        <button type="button" class="btn" id="f-q-go">搜尋</button>
      </div>
      <div id="f-q-results" class="search-results"></div>
      <label>店名 *</label>
      <input type="text" id="f-name" placeholder="例:阜杭豆漿">
      <label>分類</label>
      <input type="text" id="f-category" placeholder="例:早午餐(可留空)">
      <label>想吃什麼</label>
      <textarea id="f-wish" placeholder="例:厚餅夾蛋、鹹豆漿;朋友說要早上 7 點前到才不用排"></textarea>
      <label>位置</label>
      ${this.locPickerHtml('f')}
      <label>地址</label>
      <input type="text" id="f-address" placeholder="選了位置會自動帶入,也可以自己打">
      <label>連結(IG、文章、Google 地圖…)</label>
      <input type="url" id="f-url" placeholder="https://…">
      <button class="btn primary block" id="f-add">加入想吃清單</button>
      <button class="btn block" id="f-add-log">🍽️ 人就在店裡,加入並記錄這一餐</button>
    `);

    bindAutocomplete(document.getElementById('f-category'), () => this.categoryOptions());
    const nameEl = document.getElementById('f-name');
    const addrEl = document.getElementById('f-address');
    // 自動帶入的店名/地址,使用者還沒改過才覆蓋,打過字的不動
    const fillAuto = (name, address) => {
      if (name && (!nameEl.value.trim() || nameEl.value.trim() === autoName)) { nameEl.value = name; autoName = name; }
      if (address && (!addrEl.value.trim() || addrEl.value.trim() === autoAddr)) { addrEl.value = address; autoAddr = address; }
    };

    const picker = this.bindLocPicker('f', draft, async source => {
      if (source === 'search') return; // 搜尋結果本身就帶了店名地址
      try {
        const r = await this.geoReverse(draft.lat, draft.lng);
        if (r) fillAuto(source === 'here' ? r.name : '', r.address);
      } catch { /* 反查地址失敗不影響存檔 */ }
    });

    const doSearch = async () => {
      const q = document.getElementById('f-q').value.trim();
      const box = document.getElementById('f-q-results');
      if (!q) return;
      box.innerHTML = '<p class="food-loc-status">搜尋中…</p>';
      let results;
      try { results = await this.geoSearch(q); }
      catch { box.innerHTML = '<p class="food-loc-status">搜尋失敗,稍後再試或直接手動填</p>'; return; }
      if (!results.length) {
        box.innerHTML = '<p class="food-loc-status">搜不到,直接在下面填店名,位置用「目前位置」或「在地圖上選」</p>';
        return;
      }
      box.innerHTML = results.map((r, i) => {
        const d = this.distTo(r);
        return `<button type="button" class="search-item" data-i="${i}">
          <div class="thumb-ph food-search-ph">📍</div>
          <div><div class="search-item-title">${esc(r.name)}</div>
          <div class="search-item-sub">${esc(r.address)}${d != null ? ' · ' + esc(this.fmtDist(d)) : ''}</div></div>
        </button>`;
      }).join('');
      box.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', () => {
        const r = results[+btn.dataset.i];
        fillAuto(r.name, r.address);
        picker.setLoc(r.lat, r.lng, 'search');
        picker.showMap();
        box.innerHTML = '';
      }));
    };
    document.getElementById('f-q-go').addEventListener('click', doSearch);
    document.getElementById('f-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

    document.getElementById('f-url').addEventListener('change', e => {
      const c = this.coordsFromUrl(e.target.value);
      if (c && !this.hasLoc(draft)) { picker.setLoc(c.lat, c.lng, 'url'); picker.showMap(); toast('已從連結帶入位置'); }
    });

    const submit = thenLog => {
      const name = nameEl.value.trim();
      if (!name) { toast('請輸入店名'); return; }
      this.addPlace({
        name,
        category: document.getElementById('f-category').value.trim(),
        wish: document.getElementById('f-wish').value.trim(),
        address: addrEl.value.trim(),
        url: document.getElementById('f-url').value.trim(),
        lat: this.hasLoc(draft) ? draft.lat : null,
        lng: this.hasLoc(draft) ? draft.lng : null,
      }, thenLog);
    };
    document.getElementById('f-add').addEventListener('click', () => submit(false));
    document.getElementById('f-add-log').addEventListener('click', () => submit(true));
  },

  addPlace(item, thenLog) {
    const list = this.places();
    const p = { id: 'f' + Date.now(), status: 'want', ...item, addedAt: Date.now() };
    list.push(p);
    this.savePlaces(list);
    this.render();
    if (thenLog) { this.sync('upsertFoodPlace', Sheets.foodPlaceToRow(p)); this.openVisit(p.id, null, false); return; }
    Modal.close();
    this.sync('upsertFoodPlace', Sheets.foodPlaceToRow(p), `已加入「${p.name}」`);
  },

  /* ---------- 店家詳情 ---------- */
  openDetail(id) {
    const list = this.places();
    const p = list.find(x => x.id === id);
    if (!p) return;
    const vs = this.visitsOf(p.id);
    const rated = vs.filter(v => v.rating);
    const avg = rated.length ? (rated.reduce((s, v) => s + v.rating, 0) / rated.length).toFixed(1) : '';
    const d = this.distTo(p);

    let timer;
    const syncPlace = (delay = 0) => {
      clearTimeout(timer);
      const go = () => this.sync('upsertFoodPlace', Sheets.foodPlaceToRow(p));
      if (delay > 0) timer = setTimeout(go, delay); else go();
    };
    const save = () => { this.savePlaces(list); this.render(); };

    this.openModal(`
      <button class="modal-close" data-close>✕</button>
      <div class="detail-title">${esc(p.name)}</div>
      <div class="detail-sub">${[p.category, d != null ? '離你約 ' + this.fmtDist(d) : ''].filter(Boolean).map(esc).join(' · ')}</div>
      ${vs.length ? `<div class="detail-sub">吃過 ${vs.length} 次${avg ? ` · 平均 ★${avg}` : ''} · 上次 ${esc(vs[0].date)}</div>` : ''}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="fd-log">🍽️ 記一筆</button>
        <a class="btn" href="${esc(this.mapsUrl(p))}" target="_blank" rel="noopener">🧭 Google 地圖</a>
      </div>

      <label>狀態</label>
      <div class="status-picker" id="fd-status">
        ${Object.entries(this.STATUS).map(([k, v]) =>
          `<button data-s="${k}" class="${(p.status || 'want') === k ? 'active' : ''}">${v}</button>`).join('')}
      </div>

      <label>想吃什麼</label>
      <textarea id="fd-wish" placeholder="招牌菜、朋友推薦的、下次想試的…">${esc(p.wish)}</textarea>

      <label>吃過的紀錄</label>
      ${vs.length ? `<div class="food-visit-list">${vs.map(v => `
        <button type="button" class="food-visit-item" data-v="${esc(v.id)}">
          ${v.photos?.[0] ? `<img src="${esc(v.photos[0])}" alt="">` : ''}
          <div class="food-visit-body">
            <div class="food-visit-date">${esc(v.date)} ${esc(v.time || '')} ${this.starsHtml(v.rating)}</div>
            ${v.dishes ? `<div class="food-visit-text">${esc(v.dishes)}</div>` : ''}
          </div>
          ${v.cost ? `<span class="food-cost">$${esc(Number(v.cost).toLocaleString('zh-TW'))}</span>` : ''}
        </button>`).join('')}</div>`
        : '<p class="food-loc-status">還沒有紀錄,吃過後按上面的「🍽️ 記一筆」</p>'}

      <label>店名</label>
      <input type="text" id="fd-name" value="${esc(p.name)}">
      <label>分類</label>
      <input type="text" id="fd-category" placeholder="例:早午餐(可留空)" value="${esc(p.category || '')}">
      <label>位置</label>
      ${this.locPickerHtml('fd')}
      <label>地址</label>
      <input type="text" id="fd-address" value="${esc(p.address || '')}">
      <label>連結</label>
      <input type="url" id="fd-url" placeholder="https://…" value="${esc(p.url || '')}">
      ${p.url ? `<p class="food-loc-status"><a href="${esc(p.url)}" target="_blank" rel="noopener">🔗 開啟連結</a></p>` : ''}

      <button class="btn danger block" id="fd-delete">刪除這間店</button>
    `);

    document.getElementById('fd-log').addEventListener('click', () => this.openVisit(p.id, null, true));
    document.querySelectorAll('#fd-status button').forEach(btn =>
      btn.addEventListener('click', () => {
        p.status = btn.dataset.s;
        document.querySelectorAll('#fd-status button').forEach(b => b.classList.toggle('active', b === btn));
        save(); syncPlace();
      }));
    document.querySelectorAll('#modal [data-v]').forEach(btn =>
      btn.addEventListener('click', () => this.openVisit(p.id, btn.dataset.v, true)));

    const wishEl = document.getElementById('fd-wish');
    Appliances.autoGrowTextarea(wishEl);
    wishEl.addEventListener('input', () => {
      p.wish = wishEl.value;
      Appliances.autoGrowTextarea(wishEl);
      save(); syncPlace(1200);
    });
    document.getElementById('fd-name').addEventListener('input', e => {
      p.name = e.target.value.trim() || p.name;
      document.querySelector('#modal .detail-title').textContent = p.name;
      save(); syncPlace(1200);
    });
    bindAutocomplete(document.getElementById('fd-category'), () => this.categoryOptions());
    [['fd-category', 'category'], ['fd-address', 'address'], ['fd-url', 'url']].forEach(([elId, field]) =>
      document.getElementById(elId).addEventListener('input', e => {
        p[field] = e.target.value.trim();
        save(); syncPlace(1200);
      }));

    this.bindLocPicker('fd', p, async source => {
      save(); syncPlace();
      if (p.address) return; // 已經有地址就不幫忙改,免得蓋掉自己打的
      try {
        const r = await this.geoReverse(p.lat, p.lng);
        if (r?.address) {
          p.address = r.address;
          document.getElementById('fd-address').value = r.address;
          save(); syncPlace();
        }
      } catch { /* 反查失敗就算了 */ }
    });

    document.getElementById('fd-delete').addEventListener('click', () => {
      const n = vs.length;
      const msg = `確定要刪除「${p.name}」嗎?` + (n ? `\n這間店的 ${n} 筆吃過紀錄也會一起刪除。` : '') +
        (Sheets.enabled() ? '\nGoogle Sheet 上的資料也會一併刪除。' : '');
      if (!confirm(msg)) return;
      this.savePlaces(list.filter(x => x.id !== p.id));
      this.saveVisits(this.visits().filter(v => v.placeId !== p.id));
      this.sync('deleteFoodPlace', { id: p.id });
      Modal.close();
      this.render();
      toast('已刪除');
    });
  },

  /* ---------- 記一筆 / 編輯紀錄 ---------- */
  /* backToDetail:從店家詳情進來的,存完回到店家詳情;從提醒或時間軸進來的就直接關掉 */
  openVisit(placeId, visitId, backToDetail) {
    const p = this.places().find(x => x.id === placeId);
    if (!p) return;
    const existing = visitId ? this.visits().find(v => v.id === visitId) : null;
    const v = existing ? { ...existing, photos: [...(existing.photos || [])] }
      : { date: todayStr(), time: this.nowTime(), dishes: '', rating: 0, cost: 0, who: '', notes: '', photos: [] };

    this.openModal(`
      <button class="modal-close" data-close>✕</button>
      <h2>🍽️ ${esc(p.name)}</h2>
      <div class="food-dt-row">
        <div><label>日期</label><input type="date" id="v-date" value="${esc(v.date)}"></div>
        <div><label>時間</label><input type="time" id="v-time" value="${esc(v.time || '')}"></div>
      </div>
      <label>吃了什麼</label>
      <textarea id="v-dishes" placeholder="例:牛肉麵、燙青菜">${esc(v.dishes)}</textarea>
      ${!existing && p.wish ? `<p class="food-loc-status">📝 想吃清單上記的:${esc(p.wish)}</p>` : ''}
      <label>好不好吃</label>
      <div class="stars" id="v-stars">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${n <= v.rating ? 'on' : ''}">★</button>`).join('')}
      </div>
      <label>花費</label>
      <input type="number" id="v-cost" min="0" step="1" placeholder="例:450" value="${v.cost || ''}">
      <label>跟誰</label>
      <input type="text" id="v-who" placeholder="例:全家、老婆" value="${esc(v.who)}">
      <label>照片(最多 ${this.MAX_PHOTOS} 張)</label>
      <div class="food-photos" id="v-photos"></div>
      <input type="file" id="v-photo-file" accept="image/*" hidden>
      <label>心得</label>
      <textarea id="v-notes" placeholder="下次想點、要避開的…">${esc(v.notes)}</textarea>
      <button class="btn primary block" id="v-save">${existing ? '儲存' : '記錄這一餐'}</button>
      ${existing ? '<button class="btn danger block" id="v-delete">刪除這筆紀錄</button>' : ''}
    `);

    bindAutocomplete(document.getElementById('v-who'), () => this.usedValues('who', this.visits()));
    ['v-dishes', 'v-notes'].forEach(elId => {
      const el = document.getElementById(elId);
      Appliances.autoGrowTextarea(el);
      el.addEventListener('input', () => Appliances.autoGrowTextarea(el));
    });

    document.querySelectorAll('#v-stars button').forEach(btn =>
      btn.addEventListener('click', () => {
        const n = +btn.dataset.n;
        v.rating = v.rating === n ? 0 : n; // 再點一次同一顆星 = 取消評分
        document.querySelectorAll('#v-stars button').forEach(b => b.classList.toggle('on', +b.dataset.n <= v.rating));
      }));

    const photosEl = document.getElementById('v-photos');
    const renderPhotos = () => {
      photosEl.innerHTML = v.photos.map((src, i) => `
        <div class="food-photo">
          <img src="${src}" alt="" data-view="${i}">
          <button type="button" class="food-photo-rm" data-rm="${i}">✕</button>
        </div>`).join('') +
        (v.photos.length < this.MAX_PHOTOS ? '<button type="button" class="food-photo add" id="v-photo-add">📷<span>加照片</span></button>' : '');
      photosEl.querySelectorAll('[data-view]').forEach(img =>
        img.addEventListener('click', () => this.viewPhoto(v.photos[+img.dataset.view])));
      photosEl.querySelectorAll('[data-rm]').forEach(btn =>
        btn.addEventListener('click', () => { v.photos.splice(+btn.dataset.rm, 1); renderPhotos(); }));
      document.getElementById('v-photo-add')?.addEventListener('click', () =>
        document.getElementById('v-photo-file').click());
    };
    renderPhotos();
    document.getElementById('v-photo-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      // 跟家電照片同一套壓法:一張壓到塞得進 Google Sheet 單一儲存格
      const dataUrl = await Appliances.pickAndCompress(file, Appliances.PHOTO_ATTEMPTS);
      if (!dataUrl || v.photos.length >= this.MAX_PHOTOS) return;
      v.photos.push(dataUrl);
      renderPhotos();
    });

    const done = () => {
      this.render();
      if (backToDetail) this.openDetail(p.id); else Modal.close();
    };

    document.getElementById('v-save').addEventListener('click', () => {
      const rec = {
        ...v,
        id: existing ? existing.id : 'v' + Date.now(),
        placeId: p.id,
        date: document.getElementById('v-date').value || todayStr(),
        time: document.getElementById('v-time').value || '',
        dishes: document.getElementById('v-dishes').value.trim(),
        cost: +document.getElementById('v-cost').value || 0,
        who: document.getElementById('v-who').value.trim(),
        notes: document.getElementById('v-notes').value.trim(),
      };
      const visits = this.visits();
      const idx = visits.findIndex(x => x.id === rec.id);
      if (idx >= 0) visits[idx] = rec; else visits.push(rec);
      this.saveVisits(visits);
      let msg = existing ? '已儲存' : '已記錄這一餐 😋';
      if (!existing && p.status !== 'been') {
        // 吃過了就從「想吃」移到「吃過」;還想再去的話,到店家詳情把狀態切回「想吃」就好
        const places = this.places();
        const pp = places.find(x => x.id === p.id);
        if (pp) {
          pp.status = 'been';
          this.savePlaces(places);
          this.sync('upsertFoodPlace', Sheets.foodPlaceToRow(pp));
          msg = `已記錄!「${p.name}」移到「吃過」`;
        }
      }
      done();
      this.sync('upsertFoodVisit', Sheets.foodVisitToRow(rec), msg);
    });

    document.getElementById('v-delete')?.addEventListener('click', () => {
      if (!confirm('確定要刪除這筆紀錄嗎?')) return;
      this.saveVisits(this.visits().filter(x => x.id !== existing.id));
      this.sync('deleteFoodVisit', { id: existing.id });
      done();
      toast('已刪除');
    });
  },
};
