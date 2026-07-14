/* TMDB 電影資料庫 API
 * 有兩種取得金鑰的方式:
 * 1. 這支手機自己在設定頁貼金鑰(存 localStorage,只有這台裝置能用)
 * 2. 透過 Google Sheet 同步用的 Apps Script 代理(金鑰存在 Apps Script 的指令碼屬性,
 *    全家共用同步就自動有海報,不用每支手機各貼一次)
 * search() 會優先試代理,代理沒設定金鑰或連不上時退回這支手機自己的金鑰。
 */
const TMDB = {
  IMG: 'https://image.tmdb.org/t/p/w342',

  key() {
    return (Store.load('settings', {}).tmdbKey || '').trim();
  },

  available() {
    return !!this.key() || Sheets.enabled();
  },

  async search(query) {
    if (Sheets.enabled()) {
      try {
        const json = await Sheets.call('tmdbSearch', { query });
        if (json.ok) return json.results || [];
        if (json.error === 'BAD_KEY') throw new Error('BAD_KEY'); // Apps Script 設定的金鑰是壞的,直接告知
        // 其他情況(NO_KEY / 未知錯誤)→ 往下試試這支手機自己的金鑰
      } catch (e) {
        if (e.message === 'BAD_KEY') throw e;
        // 代理連不上或壞掉 → 往下退回本機金鑰
      }
    }

    const key = this.key();
    if (!key) throw new Error('NO_KEY');
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(key)}` +
      `&language=zh-TW&include_adult=false&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (res.status === 401) throw new Error('BAD_KEY');
    if (!res.ok) throw new Error('HTTP_' + res.status);
    const data = await res.json();
    return (data.results || [])
      .filter(r => r.media_type === 'tv' || r.media_type === 'movie')
      .slice(0, 10)
      .map(r => ({
        tmdbId: r.id,
        type: r.media_type,
        title: r.name || r.title || '(無標題)',
        year: (r.first_air_date || r.release_date || '').slice(0, 4),
        poster: r.poster_path ? this.IMG + r.poster_path : '',
        overview: r.overview || '',
      }));
  },
};
