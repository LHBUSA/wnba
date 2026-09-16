// The ONLY data adapter in the browser. Every request goes to an owned
// Cloudflare Worker (wnba-api or wnba-news). No provider host, no secret, no
// Vercel function. Never throws: always resolves { ok, data, meta, error }.

export const API_BASE = import.meta.env.VITE_WNBA_API || 'https://wnba-api.sales-fd3.workers.dev';
export const NEWS_BASE = import.meta.env.VITE_WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
export const INTL_BASE = import.meta.env.VITE_WNBA_INTL || 'https://wnba-international.sales-fd3.workers.dev';
// Credentialed surfaces (sign-in, account, WNBA Pro data) answer only on the propbetedge.ai API host, where the
// HttpOnly __Host-wnba_session cookie lives. Never memory-cached: access is decided per request by the server.
export const PRIVATE_BASE = import.meta.env.VITE_WNBA_PRIVATE_API || 'https://wnba-api.propbetedge.ai';

// The credentialed host exists only once the wnba-api release that serves /v1/pbe/status is deployed. Until /health
// lists that route, private calls resolve locally as unavailable (signed out) instead of failing in the browser.
let privateReady = null;
function privateAvailable() {
  if (!privateReady) privateReady = getJson(`${API_BASE}/health`).then((r) => Boolean(r.ok && Array.isArray(r.routes) && r.routes.includes('/v1/pbe/status'))).catch(() => false);
  return privateReady;
}

async function privateJson(path, { method = 'GET', body, timeoutMs = 12000 } = {}) {
  if (!(await privateAvailable())) return { ok: false, status: 0, data: null, error: { code: 'private_api_unavailable' } };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${PRIVATE_BASE}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: body ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, status: res.status, data: null, error: { code: `http_${res.status}` } };
    return { ...json, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: { code: e.name === 'AbortError' ? 'timeout' : 'network', message: e.message } };
  }
}

const mem = new Map(); // url -> { at, body }
const inflight = new Map();

// Client-side memory windows (ms). Short: the Worker owns real caching.
const MEM_TTL = [
  [/\/live(\?|$)/, 0],
  [/\/v1\/international\/(games|competitions)/, 4000],
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

const etCompactDate = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
};

const scheduleSummary = (games) => {
  const live = games.filter((g) => g.status?.state === 'in').length;
  const final = games.filter((g) => g.status?.state === 'post').length;
  const scheduled = games.filter((g) => g.status?.state === 'pre').length;
  return { live, final, scheduled, total: games.length, state: live ? 'LIVE' : scheduled && !final ? 'SCHEDULED' : final && !scheduled ? 'FINAL' : scheduled || final ? 'MIXED' : 'EMPTY' };
};

async function scheduleWithVerifiedFallback(params = {}) {
  const primary = await getJson(`${API_BASE}/v1/schedule${q(params)}`);
  if (primary.ok) return primary;
  if (params.season) return primary;
  const today = etCompactDate();
  const eligible = params.date ? params.date === today : params.from && params.to ? params.from <= today && today <= params.to : !params.from && !params.to;
  if (!eligible) return primary;
  const verified = await getJson(`${API_BASE}/v1/today`, { fresh: true });
  if (!verified.ok) return primary;
  const candidates = [...(verified.data?.last_results?.games || []), ...(verified.data?.slate?.games || [])];
  const seen = new Set();
  const games = candidates.filter((g) => {
    if (!g?.game_id || !g?.start_utc || seen.has(g.game_id)) return false;
    const day = etCompactDate(new Date(g.start_utc));
    const inRange = params.date ? day === params.date : (!params.from || day >= params.from) && (!params.to || day <= params.to);
    if (!inRange) return false;
    seen.add(g.game_id);
    return true;
  });
  if (!games.length) return primary;
  games.sort((a, b) => String(a.start_utc).localeCompare(String(b.start_utc)));
  return { ok: true, data: { requested: { date: params.date || null, from: params.from || null, to: params.to || null, season: null }, day: verified.data?.slate?.date || verified.data?.last_results?.date || null, games, summary: scheduleSummary(games) }, meta: { ...(verified.meta || {}), semantics: 'SCHEDULE_FALLBACK_VERIFIED_SLATE', degraded: [...((verified.meta?.degraded || []).filter(Boolean)), `primary_schedule:${primary.error?.code || 'unavailable'}`] } };
}

export const api = {
  today: () => getJson(`${API_BASE}/v1/today`),
  season: () => getJson(`${API_BASE}/v1/season`),
  schedule: (p) => scheduleWithVerifiedFallback(p),
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
  account: () => privateJson('/v1/account'),
  authRequest: (email, next) => privateJson('/v1/auth/request', { method: 'POST', body: { email, next } }),
  authLogout: () => privateJson('/v1/auth/logout', { method: 'POST', body: {} }),
  pbePicks: () => privateJson('/v1/pbe/picks'),
  pbeGame: (id) => privateJson(`/v1/pbe/games/${encodeURIComponent(id)}`),
  pbeTeam: (id) => privateJson(`/v1/pbe/teams/${encodeURIComponent(id)}`),
  playerLoad: () => privateJson('/v1/player-load'),
  playerLoadPlayer: (id) => privateJson(`/v1/player-load/${encodeURIComponent(id)}`),
  propEdge: () => privateJson('/v1/pro/prop-edge'),
  trackRecordLedger: () => privateJson('/v1/track-record/ledger'),
  pbeStatus: async () => ((await privateAvailable()) ? getJson(`${API_BASE}/v1/pbe/status`) : { ok: false, data: null, error: { code: 'pbe_api_unavailable', message: 'Model details are not published yet.' } }),
  pbeCoverage: async () => ((await privateAvailable()) ? getJson(`${API_BASE}/v1/pbe/coverage`, { fresh: true }) : { ok: false, data: null, error: { code: 'pbe_api_unavailable' } }),
  sources: () => getJson(`${API_BASE}/v1/sources`, { fresh: true, timeoutMs: 30000 }),
  health: () => getJson(`${API_BASE}/health`, { fresh: true }),
  news: (p) => getJson(`${NEWS_BASE}/v1/news${q(p)}`),
  articles: (p) => getJson(`${NEWS_BASE}/v1/articles${q(p)}`),
  article: (slug) => getJson(`${NEWS_BASE}/v1/articles/${encodeURIComponent(slug)}`),
  story: (id) => getJson(`${NEWS_BASE}/v1/news/story/${encodeURIComponent(id)}`),
  newsSources: () => getJson(`${NEWS_BASE}/v1/news/sources`),
  intl: () => getJson(`${INTL_BASE}/v1/international`),
  intlCompetition: (id, view) => getJson(`${INTL_BASE}/v1/international/competitions/${encodeURIComponent(id)}${view ? `/${view}` : ''}`),
  intlGame: (id, opts) => getJson(`${INTL_BASE}/v1/international/games/${encodeURIComponent(id)}`, opts),
  intlTeam: (id) => getJson(`${INTL_BASE}/v1/international/teams/${encodeURIComponent(id)}`),
  intlPlayer: (id) => getJson(`${INTL_BASE}/v1/international/players/${encodeURIComponent(id)}`),
  intlForWnba: (id) => getJson(`${INTL_BASE}/v1/international/wnba/${encodeURIComponent(id)}`)
};
