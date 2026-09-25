import { MILES_RECORD_BAD_SLUG, MILES_ID, isMilesRecordSlug, correctMilesRecordArticle, correctArticleListResponse } from '../../../src/lib/news-corrections.js';

// Server-side twin of src/data/api.js: the same method names and { ok, data, meta, error, status } results,
// but every call goes through a Cloudflare service binding (API = wnba-api, NEWS = wnba-news) instead of the
// public workers.dev hosts. The shared views call these methods exactly as the browser page does.

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export function bindingApi(env, { timeoutMs = 9000 } = {}) {
  const memo = new Map(); // one request per distinct path per page render
  const get = (binding, host, path) => {
    const key = `${host}${path}`;
    if (!memo.has(key)) {
      memo.set(key, (async () => {
        try {
          const res = await binding.fetch(new Request(`https://${host}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }));
          const body = await res.json().catch(() => null);
          if (!body) return { ok: false, status: res.status, data: null, meta: null, error: { code: `http_${res.status}` } };
          return { ...body, status: res.status };
        } catch (e) {
          return { ok: false, status: 0, data: null, meta: null, error: { code: e.name === 'TimeoutError' ? 'timeout' : 'network', message: e.message } };
        }
      })());
    }
    return memo.get(key);
  };
  const A = (path) => get(env.API, 'wnba-api', path);
  const N = (path) => get(env.NEWS, 'wnba-news', path);
  const I = (path) => get(env.INTL, 'wnba-international', path);
  return {
    today: () => A('/v1/today'),
    schedule: (p) => A(`/v1/schedule${qs(p)}`),
    game: (id) => A(`/v1/games/${encodeURIComponent(id)}`),
    matchup: (id) => A(`/v1/matchups/${encodeURIComponent(id)}`),
    standings: () => A('/v1/standings'),
    playoffs: (season) => A(`/v1/playoffs${qs({ season })}`),
    teams: () => A('/v1/teams'),
    team: (id) => A(`/v1/teams/${encodeURIComponent(id)}`),
    players: () => A('/v1/players'),
    player: (id) => A(`/v1/players/${encodeURIComponent(id)}`),
    injuries: () => A('/v1/injuries'),
    statsWinba: () => A('/v1/stats/winba'),
    statsPlayers: () => A('/v1/stats/players'),
    statsTeams: () => A('/v1/stats/teams'),
    props: () => A('/v1/props'),
    pbeCoverage: () => A('/v1/pbe/coverage'),
    trackRecord: () => A('/v1/track-record'),
    news: (p) => N(`/v1/news${qs(p)}`),
    articles: async (p = {}) => correctArticleListResponse(
      await N(`/v1/articles${qs(p)}`),
      { playerId: p.player ?? null, teamId: p.team ?? null, archive: p.archive === 1 || p.archive === '1' }
    ),
    article: async (slug) => {
      const incident = isMilesRecordSlug(slug);
      const sourceSlug = incident ? MILES_RECORD_BAD_SLUG : slug;
      const [res, player] = await Promise.all([
        N(`/v1/articles/${encodeURIComponent(sourceSlug)}`),
        incident ? A(`/v1/players/${encodeURIComponent(MILES_ID)}`) : Promise.resolve(null)
      ]);
      if (!res?.ok || !res.data?.article) return res;
      const article = incident ? correctMilesRecordArticle(res.data.article, player?.ok ? player.data : null) : res.data.article;
      const related = Array.isArray(res.data.related)
        ? correctArticleListResponse({ ok: true, data: { items: res.data.related } }).data.items
        : res.data.related;
      return { ...res, data: { ...res.data, article, related } };
    },
    newsSources: () => N('/v1/news/sources'),
    intl: () => I('/v1/international'),
    intlCompetition: (id, view) => I(`/v1/international/competitions/${encodeURIComponent(id)}${view ? `/${view}` : ''}`),
    intlGame: (id) => I(`/v1/international/games/${encodeURIComponent(id)}`),
    intlTeam: (id) => I(`/v1/international/teams/${encodeURIComponent(id)}`),
    intlPlayer: (id) => I(`/v1/international/players/${encodeURIComponent(id)}`),
    intlForWnba: (id) => I(`/v1/international/wnba/${encodeURIComponent(id)}`)
  };
}
