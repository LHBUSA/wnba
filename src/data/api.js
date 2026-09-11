// The ONLY data adapter in the browser. Every request goes to an owned
// Cloudflare Worker (wnba-api or wnba-news). No provider host, no secret, no
// Vercel function. Never throws: always resolves { ok, data, meta, error }.

export const API_BASE = import.meta.env.VITE_WNBA_API || 'https://wnba-api.sales-fd3.workers.dev';
export const NEWS_BASE = import.meta.env.VITE_WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';

const mem = new Map(); // url -> { at, body }
const inflight = new Map();

// Client-side memory windows (ms). Short: the Worker owns real caching.
const MEM_TTL = [
  [/\/live(\?|$)/, 0],
  [/\/v1\/today/, 15000],
  [/\/v1\/news/, 60000],
  [/\/v1\/(standings|teams|players|stats)/, 120000],
  [/.*/, 30000]
];

function memTtl(url) {
  for (const [re, ms] of MEM_TTL) if (re.test(url)) return ms;
  return 0;
}

async function getJson(url, { fresh = false, timeoutMs = 15000 } = {}) {
  const ttl = memTtl(url);
  const hit = mem.get(url);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.body;
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      const body = await res.json().catch(() => null);
      if (!body) return { ok: false, data: null, meta: null, error: { code: `http_${res.status}` } };
      if (body.ok) mem.set(url, { at: Date.now(), body });
      return body;
    } catch (e) {
      // Keep showing the last good copy, explicitly marked STALE.
      if (hit) return { ...hit.body, meta: { ...(hit.body.meta || {}), freshness: 'STALE', client_error: e.name } };
      return { ok: false, data: null, meta: null, error: { code: e.name === 'AbortError' ? 'timeout' : 'network', message: e.message } };
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  today: () => getJson(`${API_BASE}/v1/today`),
  season: () => getJson(`${API_BASE}/v1/season`),
  schedule: (p) => getJson(`${API_BASE}/v1/schedule${q(p)}`),
  game: (id) => getJson(`${API_BASE}/v1/games/${encodeURIComponent(id)}`),
  live: (id, since, opts) => getJson(`${API_BASE}/v1/games/${encodeURIComponent(id)}/live${q({ since })}`, opts),
  matchup: (id) => getJson(`${API_BASE}/v1/matchups/${encodeURIComponent(id)}`),
  standings: () => getJson(`${API_BASE}/v1/standings`),
  teams: () => getJson(`${API_BASE}/v1/teams`),
  team: (id) => getJson(`${API_BASE}/v1/teams/${encodeURIComponent(id)}`),
  players: () => getJson(`${API_BASE}/v1/players`),
  player: (id) => getJson(`${API_BASE}/v1/players/${encodeURIComponent(id)}`),
  injuries: () => getJson(`${API_BASE}/v1/injuries`),
  transactions: () => getJson(`${API_BASE}/v1/transactions`),
  statsPlayers: () => getJson(`${API_BASE}/v1/stats/players`),
  statsTeams: () => getJson(`${API_BASE}/v1/stats/teams`),
  odds: (event) => getJson(`${API_BASE}/v1/odds${q({ event })}`),
  props: () => getJson(`${API_BASE}/v1/props`),
  trackRecord: () => getJson(`${API_BASE}/v1/track-record`),
  account: () => getJson(`${API_BASE}/v1/account`, { fresh: true }),
  sources: () => getJson(`${API_BASE}/v1/sources`, { fresh: true, timeoutMs: 30000 }),
  health: () => getJson(`${API_BASE}/health`, { fresh: true }),
  news: (p) => getJson(`${NEWS_BASE}/v1/news${q(p)}`),
  articles: (p) => getJson(`${NEWS_BASE}/v1/articles${q(p)}`),
  article: (slug) => getJson(`${NEWS_BASE}/v1/articles/${encodeURIComponent(slug)}`),
  story: (id) => getJson(`${NEWS_BASE}/v1/news/story/${encodeURIComponent(id)}`),
  newsSources: () => getJson(`${NEWS_BASE}/v1/news/sources`)
};
