// Provider fetch with an edge cache and a last-good fallback.
//
// * Edge cache (Cache API) absorbs user traffic: many readers, one upstream call
//   per colo per TTL.
// * A last-good copy in KV (optional) lets a route answer STALE, with its real
//   age, when the provider fails. It never pretends to be current.
// * ESPN site traffic has two observed hosts. A transport failure or invalid
//   payload on one gets one failover attempt on the other before we fall back.
// * ESPN's broad WNBA scoreboard date ranges can return 403 even while team
//   schedule endpoints remain healthy. When both scoreboard hosts reject a
//   date range, rebuild that range from the 15 team schedules and de-duplicate
//   by ESPN event id. No game is invented.
// * In-isolate coalescing: concurrent identical requests share one fetch.

const inflight = new Map();

const DEFAULT_UA = 'PropBetEdge-WNBA/1.0 (+https://wnba.propbetedge.ai)';
const ESPN_SITE_HOSTS = Object.freeze(['site.web.api.espn.com', 'site.api.espn.com']);
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

async function rawJson(url, { timeoutMs = 9000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': DEFAULT_UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    cf: { cacheTtl: 0 }
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`upstream_${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 200);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('upstream_not_json');
    err.status = res.status;
    err.body = text.slice(0, 200);
    throw err;
  }
}

function rangeRequest(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!ESPN_SITE_HOSTS.includes(u.hostname) || !u.pathname.endsWith('/scoreboard')) return null;
  const dates = u.searchParams.get('dates') || '';
  const m = dates.match(/^(\d{8})-(\d{8})$/);
  if (!m) return null;
  return { url: u, from: m[1], to: m[2], season: Number(m[1].slice(0, 4)) };
}

function eventEtDate(event) {
  const d = new Date(event?.date || '');
  if (!Number.isFinite(d.getTime())) return null;
  return ET_DATE.format(d).replaceAll('-', '');
}

async function fetchWithHostFailover(url, options) {
  let lastError = null;
  for (const candidate of providerCandidates(url)) {
    try {
      return await rawJson(candidate, options);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('upstream_unavailable');
}

async function rebuildScoreboardRangeFromTeamSchedules(request, options) {
  const root = `${request.url.origin}${request.url.pathname.replace(/\/scoreboard$/, '')}`;
  const teamsBody = await fetchWithHostFailover(`${root}/teams`, options);
  const teamIds = [...new Set(
    (teamsBody?.sports?.[0]?.leagues?.[0]?.teams || [])
      .map((x) => String(x?.team?.id || ''))
      .filter(Boolean)
  )];
  if (!teamIds.length) throw new Error('schedule_fallback_no_teams');

  const results = await Promise.allSettled(
    teamIds.map(async (teamId) => ({
      teamId,
      body: await fetchWithHostFailover(`${root}/teams/${teamId}/schedule?season=${request.season}`, options)
    }))
  );

  const eventMap = new Map();
  let season = null;
  let succeeded = 0;
  const failedTeams = [];
  for (let i = 0; i < results.length; i += 1) {
    const row = results[i];
    if (row.status !== 'fulfilled') {
      failedTeams.push(teamIds[i]);
      continue;
    }
    succeeded += 1;
    const body = row.value.body;
    for (const event of body?.events || []) {
      const id = String(event?.id || '');
      const day = eventEtDate(event);
      if (!id || !day || day < request.from || day > request.to) continue;
      if (!season && event?.season) season = event.season;
      const prior = eventMap.get(id);
      // Team schedule responses describe the same event twice. Prefer the copy
      // carrying the larger competition payload, otherwise keep first-seen.
      if (!prior || JSON.stringify(event?.competitions || []).length > JSON.stringify(prior?.competitions || []).length) {
        eventMap.set(id, event);
      }
    }
  }

  const events = [...eventMap.values()].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')) || String(a?.id || '').localeCompare(String(b?.id || '')));
  if (!events.length) {
    const err = new Error('schedule_fallback_empty');
    err.failed_teams = failedTeams;
    throw err;
  }

  return {
    season: season || { year: request.season },
    events,
    pbe_schedule_recovery: {
      method: 'team_schedules',
      requested_teams: teamIds.length,
      succeeded_teams: succeeded,
      failed_teams: failedTeams,
      from: request.from,
      to: request.to
    }
  };
}

export async function fetchJsonWithTimeout(url, { timeoutMs = 9000, headers = {} } = {}) {
  const options = { timeoutMs, headers };
  try {
    return await fetchWithHostFailover(url, options);
  } catch (e) {
    const range = rangeRequest(url);
    if (!range) throw e;
    try {
      return await rebuildScoreboardRangeFromTeamSchedules(range, options);
    } catch (fallbackError) {
      fallbackError.cause = e;
      throw fallbackError;
    }
  }
}

function providerCandidates(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return [url]; }
  const i = ESPN_SITE_HOSTS.indexOf(parsed.hostname);
  if (i === -1) return [url];
  const alt = new URL(url);
  alt.hostname = ESPN_SITE_HOSTS[(i + 1) % ESPN_SITE_HOSTS.length];
  return [url, alt.toString()];
}

async function fetchValidatedJson(url, { timeoutMs, validate }) {
  let lastError = null;
  // fetchJsonWithTimeout already tries the alternate ESPN site host and, for
  // rejected WNBA date ranges, the team-schedule recovery path. Keep this loop
  // for non-ESPN providers and backward-compatible behavior.
  for (const candidate of providerCandidates(url)) {
    try {
      const body = await fetchJsonWithTimeout(candidate, { timeoutMs });
      if (!validate(body)) throw new Error('upstream_invalid_shape');
      return body;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('upstream_unavailable');
}

function hashKey(value) {
  // FNV-1a, good enough for compact per-URL KV keys. The original URL remains
  // the edge-cache key; this is only the durable last-good lookup key.
  let h = 0x811c9dc5;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function durableKey(kv, kvKey, url) {
  if (!kv) return null;
  return kvKey || `lastgood:v1:${hashKey(url)}`;
}

/**
 * @returns {Promise<{body:any, fetchedAt:string|null, cache:'network'|'edge'|'edge-stale'|'kv-stale'|'none', error:string|null}>}
 */
export async function cachedJson({
  url,
  ttlS,
  keepS = 6 * 3600,
  kv = null,
  kvKey = null,
  kvWriteMinIntervalS = 300,
  validate = () => true,
  ctx = null,
  timeoutMs = 9000
}) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://edge-cache.wnba.internal/${encodeURIComponent(url)}`);
  const lastGoodKey = durableKey(kv, kvKey, url);

  let cached = null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const fetchedAt = hit.headers.get('x-fetched-at');
      const age = fetchedAt ? (Date.now() - Date.parse(fetchedAt)) / 1000 : Infinity;
      cached = { body: await hit.json(), fetchedAt, age };
      if (age <= ttlS) return { body: cached.body, fetchedAt, cache: 'edge', error: null };
    }
  }

  const key = url;
  if (!inflight.has(key)) {
    inflight.set(
      key,
      (async () => {
        try {
          const body = await fetchValidatedJson(url, { timeoutMs, validate });
          return { body, fetchedAt: new Date().toISOString(), error: null };
        } catch (e) {
          return { body: null, fetchedAt: null, error: e.message || String(e) };
        } finally {
          setTimeout(() => inflight.delete(key), 0);
        }
      })()
    );
  }
  const fresh = await inflight.get(key);

  if (fresh.body !== null) {
    if (cache) {
      const res = new Response(JSON.stringify(fresh.body), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${keepS}`,
          'x-fetched-at': fresh.fetchedAt
        }
      });
      const put = cache.put(cacheKey, res);
      if (ctx) ctx.waitUntil(put); else await put;
    }
    if (kv && lastGoodKey) {
      const write = maybeWriteKv(kv, lastGoodKey, fresh.body, fresh.fetchedAt, kvWriteMinIntervalS);
      if (ctx) ctx.waitUntil(write); else await write;
    }
    return { body: fresh.body, fetchedAt: fresh.fetchedAt, cache: 'network', error: null };
  }

  if (cached) return { body: cached.body, fetchedAt: cached.fetchedAt, cache: 'edge-stale', error: fresh.error };
  if (kv && lastGoodKey) {
    const lastGood = await kv.get(lastGoodKey, 'json');
    if (lastGood?.body) return { body: lastGood.body, fetchedAt: lastGood.fetchedAt, cache: 'kv-stale', error: fresh.error };
  }
  return { body: null, fetchedAt: null, cache: 'none', error: fresh.error };
}

async function maybeWriteKv(kv, key, body, fetchedAt, minIntervalS) {
  try {
    const metaKey = `${key}:w`;
    const last = await kv.get(metaKey);
    if (last && Date.now() - Number(last) < minIntervalS * 1000) return;
    await kv.put(key, JSON.stringify({ body, fetchedAt }), { expirationTtl: 60 * 60 * 24 * 14 });
    await kv.put(metaKey, String(Date.now()), { expirationTtl: minIntervalS });
  } catch (e) {
    console.warn('kv last-good write failed', key, e.message);
  }
}
