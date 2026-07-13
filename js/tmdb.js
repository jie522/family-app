/* TMDB 電影資料庫 API */
const TMDB = {
  IMG: 'https://image.tmdb.org/t/p/w342',

  key() {
    return (Store.load('settings', {}).tmdbKey || '').trim();
  },

  async search(query) {
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
