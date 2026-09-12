// wnba-api — PropBetEdge WNBA public read API (Cloudflare Worker).
//
// Browser -> this Worker -> provider (ESPN) / KV snapshots / Supabase.
// The browser never calls a provider directly and never holds a secret.
// Every response is an envelope: { ok, data, meta } with source + freshness.

import { FRESHNESS, SOURCES, meta, ok, fail, preflight, json, nowIso } from '../../shared/envelope.js';
import { cachedJson } from '../../shared/fetcher.js';
import {
  ESPN,
  normalizeScoreboard,
  normalizeSummary,
  normalizeStandings,
  normalizeTeams,
  normalizeRoster,
  normalizeInjuries,
  normalizeAthleteOverview,
  normalizeGamelog,
  normalizeAthleteStats,
  normalizeLeaders,
  normalizeTransactions,
  normalizeScoreboardEvent
} from '../../shared/espn.js';
import { deriveGame, shotChart, possessions } from '../../shared/derive.js';
import { etCompact, addDays, isCompactDate, gameEtDate, daysBetween } from '../../shared/time.js';
import { photoFor, photoCoverage } from './photos.js';
import { PBE_MODEL } from '../../shared/market.js';
import { attachMarkets, marketForGame, marketHistory, marketSnapshots } from './market.js';
import { accountState, credentialedCors, PRODUCT_KEY } from './session.js';

const SERVICE = 'wnba-api';
const VERSION = '1.0.0';

// Freshness windows (seconds). Live data is short; season aggregates are long.
const TTL = {
  scoreboardLive: 8,
  scoreboard: 60,
  summaryLive: 6,
  summaryFinal: 86400,
  summaryPre: 120,
  standings: 600,
  injuries: 300,
  roster: 3600,
  teams: 86400,
  athlete: 3600,
  leaders: 1800,
  schedule: 900,
  transactions: 900
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return preflight(credentialedCors(request));
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: { code: 'method_not_allowed' } }, { status: 405 });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const route = matchRoute(path);
    if (!route) return json({ ok: false, error: { code: 'not_found', message: `No route ${path}` }, routes: ROUTE_LIST }, { status: 404 });
    try {
      return await route.handler({ request, env, ctx, url, params: route.params, path });
    } catch (e) {
      console.error(`[${SERVICE}] ${path}`, e?.stack || e);
      return fail('internal_error', 'Unhandled error in wnba-api', base(path, { freshness: FRESHNESS.ERROR }), 500);
    }
  }
};

const ROUTES = [
  ['/health', health],
  ['/v1/sources', sources],
  ['/v1/today', today],
  ['/v1/season', season],
  ['/v1/schedule', schedule],
  ['/v1/games/:id', game],
  ['/v1/games/:id/live', gameLive],
  ['/v1/games/:id/events', gameEvents],
  ['/v1/games/:id/boxscore', gameBox],
  ['/v1/games/:id/shots', gameShots],
  ['/v1/matchups/:id', matchup],
  ['/v1/standings', standings],
  ['/v1/teams', teams],
  ['/v1/teams/:id', team],
  ['/v1/teams/:id/roster', teamRoster],
  ['/v1/players', players],
  ['/v1/players/:id', player],
  ['/v1/players/:id/gamelog', playerGamelog],
  ['/v1/injuries', injuries],
  ['/v1/transactions', transactions],
  ['/v1/stats/players', statsPlayers],
  ['/v1/stats/teams', statsTeams],
  ['/v1/odds', odds],
  ['/v1/props', props],
  ['/v1/track-record', trackRecord],
  ['/v1/account', account]
];
const ROUTE_LIST = ROUTES.map(([p]) => p);

function matchRoute(path) {
  for (const [pattern, handler] of ROUTES) {
    const pp = pattern.split('/');
    const xs = path.split('/');
    if (pp.length !== xs.length) continue;
    const params = {};
    let hit = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(xs[i])) { hit = false; break; }
        params[pp[i].slice(1)] = xs[i];
      } else if (pp[i] !== xs[i]) { hit = false; break; }
    }
    if (hit) return { handler, params };
  }
  return null;
}

function base(route, extra = {}) {
  return meta({ service: SERVICE, version: VERSION, route, ...extra });
}

function freshnessOf(r, ttlS) {
  if (!r.body) return r.error ? FRESHNESS.ERROR : FRESHNESS.UNAVAILABLE;
  if (r.cache === 'edge-stale' || r.cache === 'kv-stale') return FRESHNESS.STALE;
  if (r.cache === 'edge') return FRESHNESS.CACHED;
  return FRESHNESS.CURRENT;
}

async function espn(env, ctx, url, ttlS, { kvKey = null, validate } = {}) {
  return cachedJson({ url, ttlS, ctx, kv: env.WNBA_KV || null, kvKey, validate });
}

function degradedFrom(r) {
  return r.error ? [`source_error:${r.error}`] : [];
}

// ---------------------------------------------------------------- health

async function health({ env, path }) {
  const ingest = env.WNBA_KV ? await env.WNBA_KV.get('ingest:v1:status', 'json') : null;
  return json({
    ok: true,
    service: SERVICE,
    version: VERSION,
    runtime: 'cloudflare-workers',
    served_at: nowIso(),
    bindings: {
      kv: Boolean(env.WNBA_KV),
      supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
    },
    system_of_record: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'NOT_CONFIGURED',
    provider_hosts: ESPN,
    ingest_status: ingest,
    photo_coverage: photoCoverage(),
    routes: ROUTE_LIST
  });
}

// Canary from Cloudflare egress: proves which provider hosts answer the Worker.
async function sources({ env, ctx, path }) {
  const probes = [
    ['scoreboard', `${ESPN.site}/scoreboard`],
    ['summary', `${ESPN.site}/summary?event=401857189`],
    ['standings', `${ESPN.v2}/standings`],
    ['injuries', `${ESPN.site}/injuries`],
    ['teams', `${ESPN.site}/teams`],
    ['roster', `${ESPN.site}/teams/3/roster`],
    ['athlete', `${ESPN.common}/athletes/4433730`],
    ['gamelog', `${ESPN.common}/athletes/4433730/gamelog`],
    ['leaders', `${ESPN.common}/statistics/byathlete?season=2026&seasontype=2&limit=5`],
    ['transactions', `${ESPN.site}/transactions?limit=5`],
    ['core_plays', `${ESPN.core}/events/401857189/competitions/401857189/plays?limit=5`],
    ['site_api_host', 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard']
  ];
  const results = await Promise.all(
    probes.map(async ([name, u]) => {
      const t0 = Date.now();
      try {
        const res = await fetch(u, { headers: { 'user-agent': 'PropBetEdge-WNBA/1.0 canary' }, signal: AbortSignal.timeout(8000) });
        const text = await res.text();
        let isJson = false;
        try { JSON.parse(text); isJson = true; } catch {}
        return { name, host: new URL(u).host, status: res.status, json: isJson, bytes: text.length, ms: Date.now() - t0, pass: res.ok && isJson };
      } catch (e) {
        return { name, host: new URL(u).host, status: null, json: false, bytes: 0, ms: Date.now() - t0, pass: false, error: e.message };
      }
    })
  );
  const odds = env.WNBA_KV ? await env.WNBA_KV.get('odds:v1:latest', 'json') : null;
  return ok(
    { egress: 'cloudflare-workers', probes: results, odds_snapshot: odds ? { captured_at: odds.captured_at, events: odds.events?.length ?? 0 } : null },
    base(path, { source: SOURCES.pbe, fetchedAt: nowIso(), freshness: FRESHNESS.CURRENT, semantics: 'CANARY' }),
    { maxAge: 0 }
  );
}

// ---------------------------------------------------------------- season / schedule

async function seasonState(env, ctx) {
  const r = await espn(env, ctx, `${ESPN.v2}/standings`, TTL.standings, { kvKey: 'lg:standings' });
  const s = r.body ? normalizeStandings(r.body) : null;
  const now = Date.now();
  let phase = null;
  let phaseEnd = null;
  let next = null;
  for (const t of s?.season_types || []) {
    const a = Date.parse(t.start);
    const b = Date.parse(t.end);
    if (now >= a && now < b) { phase = t.name; phaseEnd = t.end; }
    if (!next && a > now) next = t;
  }
  return {
    r,
    season: s?.season || null,
    phase,
    phase_end: phaseEnd,
    next_phase: next ? { name: next.name, starts: next.start } : null,
    types: s?.season_types || []
  };
}

async function season({ env, ctx, path }) {
  const st = await seasonState(env, ctx);
  return ok(
    { season: st.season, phase: st.phase, phase_end: st.phase_end, next_phase: st.next_phase, types: st.types },
    base(path, { fetchedAt: st.r.fetchedAt, freshness: freshnessOf(st.r), staleAfterS: TTL.standings, cache: st.r.cache, semantics: 'SEASON_CALENDAR', season: st.season, degraded: degradedFrom(st.r) }),
    { maxAge: 60 }
  );
}

async function scoreboardFor(env, ctx, dates) {
  const url = dates ? `${ESPN.site}/scoreboard?dates=${dates}&limit=100` : `${ESPN.site}/scoreboard`;
  const isToday = !dates || dates === etCompact();
  const r = await espn(env, ctx, url, isToday ? TTL.scoreboardLive : TTL.scoreboard, { kvKey: dates ? null : 'sb:undated', validate: (b) => Array.isArray(b?.events) });
  return { r, sb: r.body ? normalizeScoreboard(r.body) : null };
}

function slateSemantics(games) {
  const live = games.filter((g) => g.status?.state === 'in').length;
  const final = games.filter((g) => g.status?.state === 'post').length;
  const pre = games.filter((g) => g.status?.state === 'pre').length;
  return { live, final, scheduled: pre, total: games.length, state: live ? 'LIVE' : pre && !final ? 'SCHEDULED' : final && !pre ? 'FINAL' : pre || final ? 'MIXED' : 'EMPTY' };
}

async function today({ env, ctx, path }) {
  const todayEt = etCompact();
  const [{ r, sb }, st, recent] = await Promise.all([
    scoreboardFor(env, ctx, todayEt),
    seasonState(env, ctx),
    scoreboardFor(env, ctx, `${addDays(todayEt, -30)}-${addDays(todayEt, -1)}`)
  ]);
  if (!sb) return fail('scoreboard_unavailable', 'Today scoreboard unavailable from source', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }), 502);

  let slate = { kind: 'TODAY', date: todayEt, games: sb.games.filter((g) => gameEtDate(g.start_utc) === todayEt) };
  let nextFetched = null;
  if (!slate.games.length) {
    // No games today. The undated scoreboard returns ESPN's next game day; it is
    // labelled NEXT with its own date and never presented as today.
    const nx = await scoreboardFor(env, ctx, null);
    nextFetched = nx.r;
    const nextDay = nx.sb?.day ? nx.sb.day.replaceAll('-', '') : null;
    const upcoming = (nx.sb?.games || []).filter((g) => g.status?.state === 'pre' || g.status?.state === 'in');
    slate = { kind: upcoming.length ? 'NEXT' : 'NONE', date: nextDay, games: upcoming, today_date: todayEt };
  }
  slate.games = await attachMarkets(env, slate.games);
  const recentGames = (recent.sb?.games || []).filter((g) => g.status?.state === 'post').sort((a, b) => String(b.start_utc).localeCompare(String(a.start_utc)));
  const lastDay = recentGames[0] ? gameEtDate(recentGames[0].start_utc) : null;

  const odds = env.WNBA_KV ? await env.WNBA_KV.get('odds:v1:latest', 'json') : null;
  const inj = await espn(env, ctx, `${ESPN.site}/injuries`, TTL.injuries, { kvKey: 'lg:injuries' });
  const injList = inj.body ? normalizeInjuries(inj.body) : null;

  return ok(
    {
      today_et: todayEt,
      season: st.season,
      phase: st.phase,
      next_phase: st.next_phase,
      slate: { ...slate, summary: slateSemantics(slate.games) },
      last_results: { date: lastDay, games: recentGames.filter((g) => gameEtDate(g.start_utc) === lastDay) },
      availability: injList
        ? { count: injList.length, out: injList.filter((i) => /out/i.test(i.status || '')).length, day_to_day: injList.filter((i) => /day/i.test(i.status || '')).length, fetched_at: inj.fetchedAt, freshness: freshnessOf(inj) }
        : { count: null, freshness: freshnessOf(inj) },
      market: odds
        ? { captured_at: odds.captured_at, events: odds.events?.length ?? 0, books_max: Math.max(0, ...(odds.events || []).map((e) => e.book_count || 0)), semantics: 'LAST_VERIFIED_MARKET' }
        : { captured_at: null, events: 0, semantics: 'NO_SNAPSHOT' }
    },
    base(path, {
      fetchedAt: r.fetchedAt,
      freshness: freshnessOf(r),
      staleAfterS: TTL.scoreboardLive,
      cache: r.cache,
      semantics: slate.kind === 'TODAY' ? 'TODAY_SLATE' : slate.kind === 'NEXT' ? 'NEXT_SLATE_NOT_TODAY' : 'NO_UPCOMING_GAMES',
      season: st.season,
      degraded: [...degradedFrom(r), ...(nextFetched ? degradedFrom(nextFetched) : [])]
    }),
    { maxAge: 5 }
  );
}

async function schedule({ env, ctx, url, path }) {
  const date = url.searchParams.get('date');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const seasonYear = url.searchParams.get('season');
  let dates = null;
  let ttl = TTL.schedule;
  if (date) {
    if (!isCompactDate(date)) return fail('bad_request', 'date must be YYYYMMDD', base(path, { freshness: FRESHNESS.ERROR }), 400);
    dates = date;
  } else if (from && to) {
    if (!isCompactDate(from) || !isCompactDate(to) || to < from) return fail('bad_request', 'from/to must be YYYYMMDD', base(path, { freshness: FRESHNESS.ERROR }), 400);
    if (daysBetween(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6)}`, `${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6)}`) > 60) return fail('bad_request', 'range limited to 60 days', base(path, { freshness: FRESHNESS.ERROR }), 400);
    dates = `${from}-${to}`;
  } else if (seasonYear) {
    if (!/^\d{4}$/.test(seasonYear)) return fail('bad_request', 'season must be YYYY', base(path, { freshness: FRESHNESS.ERROR }), 400);
    dates = `${seasonYear}0401-${seasonYear}1101`;
    ttl = 1800;
  }
  const url2 = dates ? `${ESPN.site}/scoreboard?dates=${dates}&limit=1000` : `${ESPN.site}/scoreboard`;
  const r = await espn(env, ctx, url2, dates && dates.includes(etCompact()) ? TTL.scoreboardLive : ttl, { validate: (b) => Array.isArray(b?.events) });
  const sb = r.body ? normalizeScoreboard(r.body) : null;
  if (!sb) return fail('schedule_unavailable', 'Schedule unavailable from source', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  return ok(
    { requested: { date, from, to, season: seasonYear }, day: sb.day, games: await attachMarkets(env, sb.games), summary: slateSemantics(sb.games) },
    base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: ttl, cache: r.cache, semantics: 'SCHEDULE', season: sb.season, degraded: degradedFrom(r) }),
    { maxAge: 10 }
  );
}

// ---------------------------------------------------------------- games

async function loadSummary(env, ctx, id) {
  // First look for an immutable archive (written by wnba-ingest for final games).
  const archived = env.WNBA_KV ? await env.WNBA_KV.get(`game:v1:final:${id}`, 'json') : null;
  if (archived?.summary) return { summary: archived.summary, fetchedAt: archived.archived_at, cache: 'archive', error: null, archived: true };
  const probe = await cachedJson({ url: `${ESPN.site}/summary?event=${id}`, ttlS: TTL.summaryLive, ctx, validate: (b) => b?.header?.id });
  if (!probe.body) return { summary: null, fetchedAt: null, cache: probe.cache, error: probe.error };
  const summary = normalizeSummary(probe.body);
  return { summary, fetchedAt: probe.fetchedAt, cache: probe.cache, error: probe.error, archived: false };
}

function gameSemantics(g, archived) {
  const s = g?.status?.state;
  if (s === 'in') return 'LIVE_SOURCE';
  if (s === 'post') return archived ? 'FINAL_PERSISTED_ARCHIVE' : 'FINAL_PROVIDER_ARCHIVE';
  if (s === 'pre') return 'SCHEDULED';
  return 'UNKNOWN_STATE';
}

function gameMeta(path, L) {
  const g = L.summary?.game;
  const live = g?.status?.state === 'in';
  return base(path, {
    fetchedAt: L.fetchedAt,
    sourceUpdatedAt: g?.source_updated_at || null,
    freshness: !L.summary ? (L.error ? FRESHNESS.ERROR : FRESHNESS.UNAVAILABLE) : L.cache === 'edge-stale' ? FRESHNESS.STALE : L.cache === 'edge' || L.cache === 'archive' ? FRESHNESS.CACHED : FRESHNESS.CURRENT,
    staleAfterS: live ? 30 : g?.status?.state === 'post' ? null : TTL.summaryPre,
    cache: L.cache,
    semantics: gameSemantics(g, L.archived),
    season: g?.season || null,
    degraded: L.error ? [`source_error:${L.error}`] : []
  });
}

const cacheFor = (g) => (g?.status?.state === 'post' ? 300 : g?.status?.state === 'in' ? 0 : 30);

async function game({ env, ctx, params, path }) {
  const L = await loadSummary(env, ctx, params.id);
  if (!L.summary) return fail('game_unavailable', `Game ${params.id} unavailable`, gameMeta(path, L), L.error?.includes('404') ? 404 : 502);
  const d = deriveGame(L.summary);
  const market = await marketForGame(env, L.summary.game);
  const history = market ? await marketHistory(env, market.odds_event_id) : [];
  return ok(
    { game: L.summary.game, linescore: d.linescore, leaders: L.summary.leaders, injuries: L.summary.injuries, season_series: L.summary.season_series, pickcenter: L.summary.pickcenter, market, market_history: history, pbe_model: PBE_MODEL, event_count: L.summary.plays.length },
    gameMeta(path, L),
    { maxAge: cacheFor(L.summary.game) }
  );
}

// One call powering WNBACast: state + events since a sequence + box + derived context.
async function gameLive({ env, ctx, url, params, path }) {
  const since = Number(url.searchParams.get('since') || 0);
  const L = await loadSummary(env, ctx, params.id);
  if (!L.summary) return fail('game_unavailable', `Game ${params.id} unavailable`, gameMeta(path, L), 502);
  const s = L.summary;
  const d = deriveGame(s);
  const events = since > 0 ? s.plays.filter((p) => (p.seq ?? 0) > since) : s.plays;
  return ok(
    {
      game: s.game,
      linescore: d.linescore,
      events,
      events_total: s.plays.length,
      last_seq: s.plays.at(-1)?.seq ?? null,
      box: s.box,
      derived: { runs: d.runs, lead: d.lead, fouls: d.fouls, progression: d.progression },
      shots: shotChart(s.plays),
      leaders: s.leaders,
      injuries: s.injuries,
      pickcenter: s.pickcenter,
      market: await marketForGame(env, s.game),
      pbe_model: PBE_MODEL
    },
    gameMeta(path, L),
    { maxAge: cacheFor(s.game) }
  );
}

async function gameEvents({ env, ctx, params, path }) {
  const L = await loadSummary(env, ctx, params.id);
  if (!L.summary) return fail('game_unavailable', `Game ${params.id} unavailable`, gameMeta(path, L), 502);
  return ok({ game_id: params.id, status: L.summary.game.status, events: L.summary.plays }, gameMeta(path, L), { maxAge: cacheFor(L.summary.game) });
}

async function gameBox({ env, ctx, params, path }) {
  const L = await loadSummary(env, ctx, params.id);
  if (!L.summary) return fail('game_unavailable', `Game ${params.id} unavailable`, gameMeta(path, L), 502);
  return ok({ game: L.summary.game, box: L.summary.box }, gameMeta(path, L), { maxAge: cacheFor(L.summary.game) });
}

async function gameShots({ env, ctx, params, path }) {
  const L = await loadSummary(env, ctx, params.id);
  if (!L.summary) return fail('game_unavailable', `Game ${params.id} unavailable`, gameMeta(path, L), 502);
  return ok({ game_id: params.id, ...shotChart(L.summary.plays) }, gameMeta(path, L), { maxAge: cacheFor(L.summary.game) });
}

// ---------------------------------------------------------------- matchups

async function teamScheduleGames(env, ctx, teamId, year) {
  const r = await espn(env, ctx, `${ESPN.site}/teams/${teamId}/schedule?season=${year}`, TTL.schedule, { validate: (b) => Array.isArray(b?.events) });
  const games = (r.body?.events || []).map(normalizeScoreboardEvent);
  return { r, games };
}

async function matchup({ env, ctx, params, path }) {
  const L = await loadSummary(env, ctx, params.id);
  if (!L.summary) return fail('game_unavailable', `Game ${params.id} unavailable`, gameMeta(path, L), 502);
  const g = L.summary.game;
  const year = g.season?.year;
  const sides = [g.away, g.home].filter(Boolean);
  const [stand, leaders, teamStats, inj, ...scheds] = await Promise.all([
    espn(env, ctx, `${ESPN.v2}/standings`, TTL.standings, { kvKey: 'lg:standings' }),
    espn(env, ctx, `${ESPN.common}/statistics/byathlete?season=${year}&seasontype=2&limit=400`, TTL.leaders, { kvKey: `lg:leaders:${year}` }),
    espn(env, ctx, `${ESPN.common}/statistics/byteam?season=${year}&seasontype=2`, TTL.leaders, { kvKey: `lg:teamstats:${year}` }),
    espn(env, ctx, `${ESPN.site}/injuries`, TTL.injuries, { kvKey: 'lg:injuries' }),
    ...sides.map((t) => teamScheduleGames(env, ctx, t.team_id, year))
  ]);
  const standingsRows = stand.body ? normalizeStandings(stand.body).groups.flatMap((x) => x.entries.map((e) => ({ ...e, conference_name: x.name }))) : [];
  const lead = leaders.body ? normalizeLeaders(leaders.body).rows : [];
  const tstats = teamStats.body ? teamStatsRows(teamStats.body) : [];
  const injList = inj.body ? normalizeInjuries(inj.body) : [];
  const tip = Date.parse(g.start_utc);

  const teamsOut = sides.map((t, i) => {
    const sched = scheds[i]?.games || [];
    const played = sched.filter((x) => x.status?.state === 'post' && Date.parse(x.start_utc) < tip).sort((a, b) => String(b.start_utc).localeCompare(String(a.start_utc)));
    const last10 = played.slice(0, 10).map((x) => {
      const us = x.home?.team_id === t.team_id ? x.home : x.away;
      const them = x.home?.team_id === t.team_id ? x.away : x.home;
      return { game_id: x.game_id, date: x.start_utc, opponent: them?.abbr, home_away: us?.home_away, pts: us?.score, opp_pts: them?.score, result: us?.score !== null && them?.score !== null ? (us.score > them.score ? 'W' : 'L') : null };
    });
    const prev = played[0] || null;
    const restDays = prev ? Math.floor(daysBetween(prev.start_utc, g.start_utc) - 0.0001) : null;
    const in7 = played.filter((x) => daysBetween(x.start_utc, g.start_utc) <= 7).length;
    const ts = tstats.find((x) => x.team_id === t.team_id) || null;
    const poss = ts ? possessions({ fga: ts.avgFieldGoalsAttempted, oreb: ts.avgOffensiveRebounds, tov: ts.avgTurnovers ?? ts.avgTotalTurnovers, fta: ts.avgFreeThrowsAttempted }) : null;
    return {
      team: t,
      standing: standingsRows.find((x) => x.team_id === t.team_id) || null,
      form: {
        last10,
        record_last10: last10.length ? `${last10.filter((x) => x.result === 'W').length}-${last10.filter((x) => x.result === 'L').length}` : null,
        avg_margin_last10: last10.length ? round1(last10.reduce((a, x) => a + ((x.pts ?? 0) - (x.opp_pts ?? 0)), 0) / last10.length) : null,
        sample: last10.length
      },
      schedule_context: {
        previous_game: prev ? { game_id: prev.game_id, date: prev.start_utc, venue: prev.venue, opponent: (prev.home?.team_id === t.team_id ? prev.away : prev.home)?.abbr } : null,
        rest_days: restDays,
        back_to_back: restDays !== null ? restDays < 1 : null,
        games_last_7_days: in7,
        method: 'Rest = whole days between the previous completed game tip and this tip (ESPN team schedule). Travel distance is not computed.'
      },
      pace: ts && poss !== null
        ? { possessions_per_game: round1(poss), points_per_game: ts.avgPoints ?? null, method: 'Possessions ≈ FGA − OREB + TOV + 0.44·FTA from season per-game team totals (ESPN). Standard estimate, labelled as such.' }
        : null,
      season_stats: ts,
      season_leaders: lead.filter((p) => p.team_id === t.team_id).sort((a, b) => (b.avgPoints ?? 0) - (a.avgPoints ?? 0)).slice(0, 5).map((p) => ({ ...p, photo: photoFor(p.athlete_id) })),
      season_leaders_note: 'ESPN season leaders list covers qualified players only (127 league-wide on 2026-09-11); recent acquisitions can be missing. Use the observed rotation for current roles.',
      availability: injList.filter((x) => x.team_id === t.team_id)
    };
  });

  const rotations = await Promise.all(sides.map((t, i) => observedRotation(env, ctx, t.team_id, (scheds[i]?.games || []).filter((x) => Date.parse(x.start_utc) < tip))));
  teamsOut.forEach((t, i) => { t.rotation = rotations[i]; });

  const odds = env.WNBA_KV ? await env.WNBA_KV.get('odds:v1:latest', 'json') : null;
  const mk = odds?.events?.find((e) => e.home_team_id === g.home?.team_id && e.away_team_id === g.away?.team_id && Math.abs(Date.parse(e.commence_time) - tip) < 36 * 3600e3) || null;

  return ok(
    {
      game: g,
      season_series: L.summary.season_series,
      teams: teamsOut,
      market: mk ? { ...mk, captured_at: odds.captured_at, semantics: 'LAST_VERIFIED_MARKET' } : null,
      market_summary: await marketForGame(env, g),
      market_history: mk ? await marketHistory(env, mk.odds_event_id) : [],
      pbe_model: PBE_MODEL
    },
    base(path, { fetchedAt: L.fetchedAt, freshness: FRESHNESS.CURRENT, staleAfterS: TTL.schedule, cache: L.cache, semantics: 'MATCHUP_RESEARCH', season: g.season, degraded: [stand, leaders, teamStats, inj, ...scheds.map((s) => s.r)].flatMap(degradedFrom) }),
    { maxAge: 60 }
  );
}

/**
 * Observed rotation over a team's most recent completed games, from the real
 * box scores (archive or provider). Role labels are rules on observed minutes,
 * not projections.
 */
async function observedRotation(env, ctx, teamId, games, n = 5) {
  const recent = games.filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => String(b.start_utc).localeCompare(String(a.start_utc))).slice(0, n);
  const loads = await Promise.all(recent.map((g) => loadSummary(env, ctx, g.game_id)));
  const agg = new Map();
  let sample = 0;
  for (const L of loads) {
    if (!L.summary) continue;
    sample += 1;
    for (const r of L.summary.box.players.filter((x) => x.team_id === String(teamId))) {
      const a = agg.get(r.athlete_id) || { athlete_id: r.athlete_id, name: r.name, position: r.position, games: 0, appearances: 0, starts: 0, min: 0, pts: 0, reb: 0, ast: 0, dnp: 0 };
      a.games += 1;
      if (r.dnp || !r.min) a.dnp += 1;
      else {
        a.appearances += 1;
        a.min += r.min || 0;
        a.pts += r.pts || 0;
        a.reb += r.reb || 0;
        a.ast += r.ast || 0;
      }
      if (r.starter) a.starts += 1;
      agg.set(r.athlete_id, a);
    }
  }
  const rows = [...agg.values()].map((a) => {
    const div = a.appearances || 1;
    const avgMin = a.appearances ? a.min / div : 0;
    const role = a.starts >= Math.ceil(sample / 2) ? 'starter' : avgMin >= 15 ? 'rotation' : a.appearances ? 'reserve' : 'did_not_play';
    return { ...a, min: round1(avgMin), pts: round1(a.pts / div), reb: round1(a.reb / div), ast: round1(a.ast / div), role, photo: photoFor(a.athlete_id) };
  });
  rows.sort((x, y) => y.min - x.min);
  return {
    method: `Observed over the last ${sample} completed game${sample === 1 ? '' : 's'} (ESPN box scores). Starter = started at least half; rotation = 15+ avg minutes; averages are per appearance.`,
    sample,
    games: recent.map((g) => g.game_id),
    rows
  };
}

function teamStatsRows(body) {
  // common/v3 byteam (verified 2026-09-11): top-level categories carry `names`
  // only on the first occurrence of each name; each team repeats every category
  // as "Own …" (splitId 0) then "Opponent …" (splitId 900). Opponent values are
  // prefixed opp_ so they can never overwrite the team's own numbers.
  const names = {};
  for (const c of body?.categories || []) if (c.names && !names[c.name]) names[c.name] = c.names;
  return (body?.teams || []).map((t) => {
    const row = { team_id: String(t.team?.id ?? ''), abbr: t.team?.abbreviation ?? null, name: t.team?.displayName ?? null };
    for (const c of t.categories || []) {
      const opp = String(c.splitId) === '900' || /^opponent/i.test(c.displayName || '');
      (names[c.name] || []).forEach((n, i) => {
        const v = Number(String(c.values?.[i] ?? '').replace(/,/g, ''));
        const key = opp ? `opp_${n}` : n;
        if (!(key in row)) row[key] = Number.isFinite(v) ? v : null;
      });
    }
    return row;
  });
}

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// ---------------------------------------------------------------- league tables

async function standings({ env, ctx, path }) {
  const st = await seasonState(env, ctx);
  const r = st.r;
  if (!r.body) return fail('standings_unavailable', 'Standings unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  const s = normalizeStandings(r.body);
  const isCurrent = st.season && s.season?.year === st.season.year && st.phase !== 'Off Season';
  return ok(
    { ...s, phase: st.phase, is_current: Boolean(isCurrent), label: isCurrent ? `${s.season.label} — current` : `${s.season?.label || 'Season'} — final (prior)` },
    base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: TTL.standings, cache: r.cache, semantics: isCurrent ? 'CURRENT_SEASON' : 'PRIOR_SEASON_FINAL', season: s.season, degraded: degradedFrom(r) }),
    { maxAge: 60 }
  );
}

async function teams({ env, ctx, path }) {
  const r = await espn(env, ctx, `${ESPN.site}/teams`, TTL.teams, { kvKey: 'lg:teams' });
  if (!r.body) return fail('teams_unavailable', 'Teams unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  return ok({ teams: normalizeTeams(r.body) }, base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: TTL.teams, cache: r.cache, semantics: 'REFERENCE', degraded: degradedFrom(r) }), { maxAge: 3600 });
}

async function loadRoster(env, ctx, teamId) {
  const r = await espn(env, ctx, `${ESPN.site}/teams/${teamId}/roster`, TTL.roster, { kvKey: `roster:${teamId}`, validate: (b) => Array.isArray(b?.athletes) });
  return { r, roster: r.body ? normalizeRoster(r.body) : null };
}

async function teamRoster({ env, ctx, params, path }) {
  const { r, roster } = await loadRoster(env, ctx, params.id);
  if (!roster) return fail('roster_unavailable', 'Roster unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  roster.athletes = roster.athletes.map((a) => ({ ...a, photo: photoFor(a.athlete_id) }));
  return ok(roster, base(path, { fetchedAt: r.fetchedAt, sourceUpdatedAt: roster.source_timestamp, freshness: freshnessOf(r), staleAfterS: TTL.roster, cache: r.cache, semantics: 'CURRENT_ROSTER', season: roster.season, degraded: degradedFrom(r) }), { maxAge: 300 });
}

async function team({ env, ctx, params, path }) {
  const st = await seasonState(env, ctx);
  const year = st.season?.year;
  const [{ r, roster }, sched, stats, inj] = await Promise.all([
    loadRoster(env, ctx, params.id),
    year ? teamScheduleGames(env, ctx, params.id, year) : Promise.resolve({ r: { body: null }, games: [] }),
    espn(env, ctx, `${ESPN.common}/statistics/byteam?season=${year}&seasontype=2`, TTL.leaders, { kvKey: `lg:teamstats:${year}` }),
    espn(env, ctx, `${ESPN.site}/injuries`, TTL.injuries, { kvKey: 'lg:injuries' })
  ]);
  if (!roster) return fail('team_unavailable', 'Team unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  const standingsRows = st.r.body ? normalizeStandings(st.r.body).groups.flatMap((x) => x.entries.map((e) => ({ ...e, conference_name: x.name }))) : [];
  return ok(
    {
      team: roster.team,
      season: roster.season,
      coach: roster.coach,
      standing: standingsRows.find((x) => x.team_id === params.id) || null,
      roster: roster.athletes.map((a) => ({ ...a, photo: photoFor(a.athlete_id) })),
      schedule: await attachMarkets(env, sched.games),
      rotation: await observedRotation(env, ctx, params.id, sched.games),
      season_stats: stats.body ? teamStatsRows(stats.body).find((x) => x.team_id === params.id) || null : null,
      availability: inj.body ? normalizeInjuries(inj.body).filter((x) => x.team_id === params.id) : null
    },
    base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: TTL.roster, cache: r.cache, semantics: 'TEAM_PAGE', season: st.season, degraded: [r, sched.r, stats, inj].flatMap(degradedFrom) }),
    { maxAge: 120 }
  );
}

async function allRosters(env, ctx) {
  const t = await espn(env, ctx, `${ESPN.site}/teams`, TTL.teams, { kvKey: 'lg:teams' });
  const list = t.body ? normalizeTeams(t.body) : [];
  const rosters = await Promise.all(list.map((x) => loadRoster(env, ctx, x.team_id)));
  return { teamsR: t, list, rosters };
}

async function players({ env, ctx, path }) {
  const { teamsR, list, rosters } = await allRosters(env, ctx);
  if (!list.length) return fail('players_unavailable', 'Player index unavailable', base(path, { freshness: freshnessOf(teamsR), degraded: degradedFrom(teamsR) }));
  const out = [];
  const missing = [];
  rosters.forEach((x, i) => {
    if (!x.roster) { missing.push(list[i].abbr); return; }
    for (const a of x.roster.athletes) out.push({ ...a, team: list[i], photo: photoFor(a.athlete_id) });
  });
  out.sort((a, b) => String(a.last_name || a.name).localeCompare(String(b.last_name || b.name)));
  const oldest = rosters.map((x) => x.r.fetchedAt).filter(Boolean).sort()[0] || null;
  return ok(
    { players: out, teams: list.length, missing_teams: missing, photo_coverage: photoCoverage() },
    base(path, { fetchedAt: oldest, freshness: missing.length ? FRESHNESS.STALE : FRESHNESS.CURRENT, staleAfterS: TTL.roster, cache: 'mixed', semantics: 'CURRENT_ROSTERS', degraded: missing.map((m) => `roster_missing:${m}`) }),
    { maxAge: 300 }
  );
}

async function player({ env, ctx, params, path }) {
  const id = params.id;
  const [ov, gl, stats, inj] = await Promise.all([
    espn(env, ctx, `${ESPN.common}/athletes/${id}`, TTL.athlete, { validate: (b) => b?.athlete?.id }),
    espn(env, ctx, `${ESPN.common}/athletes/${id}/gamelog`, TTL.athlete),
    espn(env, ctx, `${ESPN.common}/athletes/${id}/stats`, TTL.athlete),
    espn(env, ctx, `${ESPN.site}/injuries`, TTL.injuries, { kvKey: 'lg:injuries' })
  ]);
  if (!ov.body) return fail('player_unavailable', `Player ${id} unavailable`, base(path, { freshness: freshnessOf(ov), degraded: degradedFrom(ov) }), 404);
  const overview = normalizeAthleteOverview(ov.body);
  const gamelog = gl.body ? normalizeGamelog(gl.body) : null;
  const games = gamelog?.seasons?.find((s) => /regular/i.test(s.name || ''))?.games || gamelog?.seasons?.[0]?.games || [];
  return ok(
    {
      player: overview,
      photo: photoFor(id),
      gamelog,
      recent: recentForm(games),
      career: stats.body ? normalizeAthleteStats(stats.body) : null,
      availability: inj.body ? normalizeInjuries(inj.body).filter((x) => x.athlete_id === id) : null
    },
    base(path, { fetchedAt: ov.fetchedAt, freshness: freshnessOf(ov), staleAfterS: TTL.athlete, cache: ov.cache, semantics: 'PLAYER_PAGE', degraded: [ov, gl, stats, inj].flatMap(degradedFrom) }),
    { maxAge: 120 }
  );
}

function recentForm(games) {
  const played = games.filter((g) => g.min !== null && g.min > 0);
  const win = (n) => {
    const s = played.slice(0, n);
    if (!s.length) return null;
    const avg = (k) => round1(s.reduce((a, g) => a + (g[k] ?? 0), 0) / s.length);
    return { games: s.length, min: avg('min'), pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), fg3m: avg('fg3m'), tov: avg('tov') };
  };
  return {
    method: 'Simple averages over the most recent games with minutes played (ESPN game log). Sample size shown.',
    last5: win(5),
    last10: win(10),
    season: win(999),
    minutes_trend: played.slice(0, 10).map((g) => ({ game_id: g.game_id, date: g.date, min: g.min })).reverse()
  };
}

async function playerGamelog({ env, ctx, params, path }) {
  const gl = await espn(env, ctx, `${ESPN.common}/athletes/${params.id}/gamelog`, TTL.athlete);
  if (!gl.body) return fail('gamelog_unavailable', 'Game log unavailable', base(path, { freshness: freshnessOf(gl), degraded: degradedFrom(gl) }));
  return ok(normalizeGamelog(gl.body), base(path, { fetchedAt: gl.fetchedAt, freshness: freshnessOf(gl), staleAfterS: TTL.athlete, cache: gl.cache, semantics: 'GAME_LOG', degraded: degradedFrom(gl) }), { maxAge: 300 });
}

async function injuries({ env, ctx, path }) {
  const r = await espn(env, ctx, `${ESPN.site}/injuries`, TTL.injuries, { kvKey: 'lg:injuries' });
  if (!r.body) return fail('injuries_unavailable', 'Injury feed unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  const list = normalizeInjuries(r.body).map((x) => ({ ...x, photo: photoFor(x.athlete_id) }));
  const changes = env.WNBA_KV ? (await env.WNBA_KV.get('avail:v1:changes', 'json')) || [] : [];
  return ok(
    {
      items: list,
      changes: changes.slice(0, 60),
      change_ledger: changes.length ? 'Recorded by wnba-ingest from consecutive captures of this feed (before → after).' : 'No changes recorded yet. The ledger fills as wnba-ingest observes the feed change.',
      authority: 'ESPN injury feed (provider). Not the league’s official injury report.'
    },
    base(path, { fetchedAt: r.fetchedAt, sourceUpdatedAt: r.body?.timestamp || null, freshness: freshnessOf(r), staleAfterS: TTL.injuries, cache: r.cache, semantics: 'AVAILABILITY_FEED', degraded: degradedFrom(r) }),
    { maxAge: 30 }
  );
}

async function transactions({ env, ctx, path }) {
  const r = await espn(env, ctx, `${ESPN.site}/transactions?limit=100`, TTL.transactions, { kvKey: 'lg:transactions' });
  if (!r.body) return fail('transactions_unavailable', 'Transactions unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  return ok({ items: normalizeTransactions(r.body) }, base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: TTL.transactions, cache: r.cache, semantics: 'TRANSACTIONS', degraded: degradedFrom(r) }), { maxAge: 120 });
}

async function statsPlayers({ env, ctx, url, path }) {
  const st = await seasonState(env, ctx);
  const year = url.searchParams.get('season') || st.season?.year;
  const r = await espn(env, ctx, `${ESPN.common}/statistics/byathlete?season=${year}&seasontype=2&limit=400`, TTL.leaders, { kvKey: `lg:leaders:${year}` });
  if (!r.body) return fail('stats_unavailable', 'Player stats unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  const L = normalizeLeaders(r.body);
  const isCurrent = String(year) === String(st.season?.year);
  return ok(
    { season: L.season, is_current: isCurrent, rows: L.rows.map((p) => ({ ...p, photo: photoFor(p.athlete_id) })) },
    base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: TTL.leaders, cache: r.cache, semantics: isCurrent ? 'SEASON_TO_DATE' : 'PRIOR_SEASON', season: L.season, degraded: degradedFrom(r) }),
    { maxAge: 300 }
  );
}

async function statsTeams({ env, ctx, url, path }) {
  const st = await seasonState(env, ctx);
  const year = url.searchParams.get('season') || st.season?.year;
  const r = await espn(env, ctx, `${ESPN.common}/statistics/byteam?season=${year}&seasontype=2`, TTL.leaders, { kvKey: `lg:teamstats:${year}` });
  if (!r.body) return fail('stats_unavailable', 'Team stats unavailable', base(path, { freshness: freshnessOf(r), degraded: degradedFrom(r) }));
  const rows = teamStatsRows(r.body).map((t) => ({
    ...t,
    possessions_per_game: round1(possessions({ fga: t.avgFieldGoalsAttempted, oreb: t.avgOffensiveRebounds, tov: t.avgTurnovers ?? t.avgTotalTurnovers, fta: t.avgFreeThrowsAttempted }))
  }));
  const isCurrent = String(year) === String(st.season?.year);
  return ok(
    { season: { year: Number(year) }, is_current: isCurrent, rows, pace_method: 'Possessions ≈ FGA − OREB + TOV + 0.44·FTA per game (ESPN team totals).' },
    base(path, { fetchedAt: r.fetchedAt, freshness: freshnessOf(r), staleAfterS: TTL.leaders, cache: r.cache, semantics: isCurrent ? 'SEASON_TO_DATE' : 'PRIOR_SEASON', degraded: degradedFrom(r) }),
    { maxAge: 300 }
  );
}

// ---------------------------------------------------------------- market (snapshots only)

async function odds({ env, url, path }) {
  if (!env.WNBA_KV) return fail('not_configured', 'Market snapshot store not bound', base(path, { source: SOURCES.odds_api, freshness: FRESHNESS.NOT_CONFIGURED }), 503);
  const snap = await env.WNBA_KV.get('odds:v1:latest', 'json');
  const status = await env.WNBA_KV.get('odds:v1:status', 'json');
  const gameEventId = url.searchParams.get('event');
  if (!snap) return ok({ events: [], ingest: status, pbe_model: PBE_MODEL }, base(path, { source: SOURCES.odds_api, freshness: FRESHNESS.UNAVAILABLE, semantics: 'NO_SNAPSHOT_YET' }), { maxAge: 30 });
  let history = null;
  if (gameEventId && /^[a-f0-9]{32}$/.test(gameEventId)) history = (await env.WNBA_KV.get(`odds:v1:hist:${gameEventId}`, 'json')) || [];
  const age = (Date.now() - Date.parse(snap.captured_at)) / 1000;
  return ok(
    { captured_at: snap.captured_at, schedule: snap.schedule, events: snap.events, history, ingest: status, pbe_model: PBE_MODEL, credits: snap.credits || null },
    base(path, { source: SOURCES.odds_api, fetchedAt: snap.captured_at, freshness: age > 12 * 3600 ? FRESHNESS.STALE : FRESHNESS.CACHED, staleAfterS: 12 * 3600, cache: 'snapshot', semantics: 'LAST_VERIFIED_MARKET' }),
    { maxAge: 30 }
  );
}

async function props({ env, path }) {
  if (!env.WNBA_KV) return fail('not_configured', 'Market snapshot store not bound', base(path, { source: SOURCES.odds_api, freshness: FRESHNESS.NOT_CONFIGURED }), 503);
  const snap = await env.WNBA_KV.get('props:v1:latest', 'json');
  if (!snap) return ok({ games: [], pbe_model: PBE_MODEL }, base(path, { source: SOURCES.odds_api, freshness: FRESHNESS.UNAVAILABLE, semantics: 'NO_SNAPSHOT_YET' }), { maxAge: 30 });
  const games = (snap.games || []).map((g) => ({ ...g, props: g.props.map((p) => ({ ...p, photo: photoFor(p.athlete_id) })) }));
  const age = (Date.now() - Date.parse(snap.captured_at)) / 1000;
  return ok(
    { captured_at: snap.captured_at, markets: snap.markets, games, pbe_model: PBE_MODEL },
    base(path, { source: SOURCES.odds_api, fetchedAt: snap.captured_at, freshness: age > 12 * 3600 ? FRESHNESS.STALE : FRESHNESS.CACHED, staleAfterS: 12 * 3600, cache: 'snapshot', semantics: 'LAST_VERIFIED_MARKET' }),
    { maxAge: 30 }
  );
}

// ---------------------------------------------------------------- trust surfaces

async function trackRecord({ path }) {
  // No WNBA pick has been recorded. The ledger is empty by fact, not by error.
  return ok(
    {
      picks_recorded: 0,
      graded: 0,
      pending: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      roi: null,
      roi_note: 'ROI is computed only from picks with a recorded market price at pick time.',
      doctrine: [
        'A pick exists only if it was recorded before its game started.',
        'The line and price used are frozen with the pick.',
        'Grading is deterministic from the final box score.',
        'Losses stay losses. Nothing is backfilled or deleted.',
        'Sample size is shown next to every rate.'
      ],
      model: PBE_MODEL
    },
    base(path, { source: SOURCES.pbe, fetchedAt: nowIso(), freshness: FRESHNESS.CURRENT, semantics: 'EMPTY_LEDGER' }),
    { maxAge: 60 }
  );
}

async function account({ request, env, path }) {
  // Fail closed, and server-decided end to end:
  //   pbe_session cookie (HS256, verified here against the shared secret)
  //     -> verified email
  //     -> Supabase pbe_has_sport_entitlement(email, 'wnba_pro') under the service role.
  // No query parameter, request header, request body or browser storage can influence
  // the answer; the browser cannot even read the cookie (HttpOnly). Every failure lands
  // on "not entitled", and a lookup we could not perform is reported as UNAVAILABLE
  // rather than silently downgrading a paying subscriber into the free state.
  const state = await accountState(request, env);
  return json(
    {
      ok: true,
      data: {
        ...state,
        product_key: PRODUCT_KEY,
        purchase_activation: env.WNBA_PURCHASE_ACTIVE === 'true' ? 'active' : 'inactive',
        authority: 'server_session_and_supabase_ledger'
      },
      meta: base(path, {
        source: SOURCES.pbe,
        fetchedAt: nowIso(),
        freshness: FRESHNESS.CURRENT,
        semantics: state.state === 'pro' ? 'ACCOUNT_ENTITLED' : 'ACCOUNT_FAIL_CLOSED',
        degraded: state.entitlement_check === 'UNAVAILABLE' ? ['entitlement_lookup_unavailable'] : []
      })
    },
    { maxAge: 0, headers: credentialedCors(request) }
  );
}
