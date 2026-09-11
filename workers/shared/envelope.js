// Response envelope + freshness semantics shared by every WNBA Worker.
// Pattern learned from NBA src/data/freshness.js; the states are identical so
// the frontend can treat every PropBetEdge surface the same way.

export const FRESHNESS = Object.freeze({
  CURRENT: 'CURRENT',       // fetched from the source inside its freshness window
  CACHED: 'CACHED',         // served from our edge cache, still inside the window
  STALE: 'STALE',           // last good copy, older than the window or source failing
  UNAVAILABLE: 'UNAVAILABLE', // source has nothing for this request (not an error)
  ERROR: 'ERROR',           // source failed and we hold no copy
  NOT_CONFIGURED: 'NOT_CONFIGURED' // capability needs a binding/secret that is absent
});

export const SOURCES = Object.freeze({
  espn: {
    id: 'espn',
    name: 'ESPN',
    authority: 'EXTERNAL_PROVIDER',
    note: 'Public ESPN JSON (site.web.api / sports.core.api). Scores, events, box scores, rosters, standings, injuries.'
  },
  odds_api: {
    id: 'odds_api',
    name: 'The Odds API',
    authority: 'EXTERNAL_MARKET',
    note: 'Sportsbook prices aggregated by The Odds API. Snapshot ingest on a fixed schedule; user traffic never triggers provider spend.'
  },
  pbe: {
    id: 'pbe',
    name: 'PropBetEdge',
    authority: 'OWNED_DERIVED',
    note: 'Derived by PropBetEdge from the cited source records. Method is stated on every derived field.'
  }
});

export function nowIso() {
  return new Date().toISOString();
}

export function ageSeconds(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

/**
 * Build the meta block. `fetchedAt` is when a Worker last received the payload
 * from the source; `sourceUpdatedAt` is the source's own timestamp when it
 * publishes one. Age is measured from the OLDER of the two.
 */
export function meta({
  service,
  version,
  route,
  source = SOURCES.espn,
  fetchedAt = null,
  sourceUpdatedAt = null,
  freshness,
  staleAfterS = null,
  semantics = null,
  season = null,
  degraded = [],
  cache = 'network',
  extra = {}
}) {
  const ages = [ageSeconds(fetchedAt), ageSeconds(sourceUpdatedAt)].filter((v) => v !== null);
  return {
    service,
    version,
    route,
    source: source ? { id: source.id, name: source.name, authority: source.authority } : null,
    fetched_at: fetchedAt,
    source_updated_at: sourceUpdatedAt,
    served_at: nowIso(),
    age_s: ages.length ? Math.max(...ages) : null,
    stale_after_s: staleAfterS,
    freshness,
    cache,
    semantics,
    season,
    degraded,
    ...extra
  };
}

export function json(body, { status = 200, maxAge = 0, sMaxAge = null, headers = {} } = {}) {
  const h = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  if (maxAge <= 0 && sMaxAge === null) h.set('cache-control', 'no-store');
  else h.set('cache-control', `public, max-age=${Math.max(0, maxAge)}${sMaxAge !== null ? `, s-maxage=${sMaxAge}` : ''}`);
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function ok(data, metaBlock, opts) {
  return json({ ok: true, data, meta: metaBlock }, opts);
}

export function fail(code, message, metaBlock, status = 502) {
  return json({ ok: false, error: { code, message }, data: null, meta: metaBlock }, { status });
}

export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400'
    }
  });
}
