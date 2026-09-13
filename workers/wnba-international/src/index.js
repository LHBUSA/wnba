// wnba-international — PropBetEdge international women's basketball data Worker.
//
// Provider: ESPN public JSON, league `fiba` (no key, no login). FIBA's own digital API requires a subscription
// key and FIBA grants no API licence, so it is not used (docs/INTERNATIONAL_SOURCE_AUDIT.md).
//
// Freshness:
//   scoreboard / live game  read-through, Cache API, 10 s while any game is live or about to tip
//   completed game box       normalized once, stored in KV permanently (a final box score does not change)
//   aggregates               rebuilt by Cron every 2 minutes (standings, bracket, rosters, stats, leaders, crosswalk)
//   player bio (DOB/height)  read-through, 1 day
// Every response carries fetched_at, age and a freshness state; a failed provider serves KV last-good as STALE.

import { cachedJson } from '../../shared/fetcher.js';
import { ok, fail, meta, preflight, FRESHNESS, SOURCES } from '../../shared/envelope.js';
import { COMPETITIONS, competitionById, competitionStatus, currentEdition } from './registry.js';
import { normalizeGame, normalizeSummary } from './normalize.js';
import { PBP_VERSION } from '../../shared/pbp.js';
import { groupStandings, bracket, playerAndTeamStats, leaders, teamRecords, dedupeGames } from './aggregate.js';
import { linkInternationalPlayers } from './crosswalk.js';

export const SERVICE = 'wnba-international';
export const VERSION = '1.0.0';
// site.web.api.espn.com: ESPN's site.api host refuses Cloudflare egress (403); every WNBA Worker uses this host.
const ESPN = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues';
const SOURCE = { ...SOURCES.espn, note: 'Public ESPN JSON for the FIBA competition (league "fiba"). Not an official FIBA data feed.' };
const LIVE_TTL_S = 10;
const IDLE_TTL_S = 120;

const m = (route, extra = {}) => meta({ service: SERVICE, version: VERSION, route, source: SOURCE, ...extra });

// ------------------------------------------------------------ provider reads

function hasLiveOrImminent(games, now = Date.now()) {
  return games.some((g) => g.status === 'live' || (g.status === 'scheduled' && Math.abs(Date.parse(g.scheduled_at) - now) < 45 * 60e3));
}

export async function loadScoreboard(env, comp, ctx, { ttlS } = {}) {
  const p = comp.provider_ids.espn;
  const kvKey = `sb:${comp.competition_id}`;
  const last = await env.INTL_KV.get(kvKey, 'json');
  const ttl = ttlS ?? (last && !hasLiveOrImminent(last.games) && competitionStatus(comp) !== 'active' ? 3600 : last && !hasLiveOrImminent(last.games) ? IDLE_TTL_S : LIVE_TTL_S);
  const r = await cachedJson({ url: `${ESPN}/${p.league}/scoreboard?dates=${p.dates}&limit=200`, ttlS: ttl, keepS: 86400, validate: (b) => Array.isArray(b?.events), ctx, timeoutMs: 8000 });
  if (r.body) {
    const games = dedupeGames(r.body.events.filter((e) => (e.competitions?.[0]?.notes || []).some((n) => String(n.headline || '').startsWith(p.note_prefix))).map((e) => normalizeGame(e, { competitionId: comp.competition_id, fetchedAt: r.fetchedAt })));
    if (games.length && (r.cache === 'network' || !last)) {
      const write = env.INTL_KV.put(kvKey, JSON.stringify({ fetched_at: r.fetchedAt, games }));
      if (ctx) ctx.waitUntil(write); else await write;
    }
    return { games, fetched_at: r.fetchedAt, cache: r.cache, error: r.error, ttl };
  }
  if (last) return { games: last.games, fetched_at: last.fetched_at, cache: 'kv-stale', error: r.error, ttl };
  return { games: [], fetched_at: null, cache: 'none', error: r.error, ttl };
}

export async function loadGameDetail(env, comp, espnId, ctx, { live = true } = {}) {
  const kvKey = `box:${espnId}`;
  const stored = await env.INTL_KV.get(kvKey, 'json');
  // A stored final is immutable game data, but its NORMALIZATION is versioned: a detail written before the current play
  // normalizer is rebuilt once from the provider summary (the stored copy is served if the provider is unreachable).
  if (stored?.game?.status === 'final' && stored.normalizer === PBP_VERSION) return { ...stored, cache: 'kv' };
  const r = await cachedJson({ url: `${ESPN}/${comp.provider_ids.espn.league}/summary?event=${espnId}`, ttlS: live ? LIVE_TTL_S : IDLE_TTL_S, keepS: 86400, validate: (b) => Boolean(b?.header?.competitions?.length), ctx, timeoutMs: 8000 });
  if (r.body) {
    // Re-normalizing a stored final keeps its original observation time: the game record did not change, only its shape.
    const observed = stored?.game?.status === 'final' && stored.fetched_at ? stored.fetched_at : r.fetchedAt;
    const detail = { ...normalizeSummary(r.body, { competitionId: comp.competition_id, eventId: espnId, fetchedAt: observed }), fetched_at: observed, normalizer: PBP_VERSION };
    if (detail.game.status === 'final' && detail.boxscore) {
      const write = env.INTL_KV.put(kvKey, JSON.stringify(detail));
      if (ctx) ctx.waitUntil(write); else await write;
    }
    return { ...detail, cache: r.cache, error: r.error };
  }
  if (stored) return { ...stored, cache: 'kv-stale', error: r.error };
  return null;
}

async function wnbaPlayers(env) {
  try {
    const res = await env.API.fetch(new Request('https://wnba-api/v1/players', { headers: { accept: 'application/json' } }));
    const body = await res.json();
    return body?.ok ? { players: body.data.players, captured_at: body.meta?.fetched_at || new Date().toISOString() } : null;
  } catch {
    return null;
  }
}

/** Rebuild one competition's aggregate from the scoreboard and stored final box scores. */
export async function buildAggregate(env, comp, ctx = null) {
  const sb = await loadScoreboard(env, comp, ctx, { ttlS: 30 });
  // Never persist an aggregate built from a failed or empty provider read; keep the last good one.
  if (!sb.games.length) throw new Error(`scoreboard_unavailable:${sb.error || 'empty'}`);
  const finals = sb.games.filter((g) => g.status === 'final');
  const boxes = [];
  // Box scores are immutable once final: fetch only what KV does not hold yet (bounded per build).
  let fetched = 0;
  for (const g of finals) {
    const espnId = g.provider_ids.espn;
    let d = await env.INTL_KV.get(`box:${espnId}`, 'json');
    if (!d && fetched < 40) { d = await loadGameDetail(env, comp, espnId, null, { live: false }); fetched += 1; }
    if (d?.boxscore) boxes.push({ game: g, boxscore: d.boxscore });
  }
  const stats = playerAndTeamStats(boxes);
  const w = await wnbaPlayers(env);
  if (w) linkInternationalPlayers(stats.players, w.players, { capturedAt: w.captured_at });
  const records = teamRecords(sb.games);
  const agg = {
    competition_id: comp.competition_id,
    built_at: new Date().toISOString(),
    scoreboard_fetched_at: sb.fetched_at,
    games: sb.games,
    standings: groupStandings(sb.games),
    bracket: bracket(sb.games),
    players: stats.players,
    teams: stats.teams.map((t) => ({ ...t, record: records.get(t.team.team_id) || { wins: 0, losses: 0 } })),
    leaders: leaders(stats.players),
    wnba_players: stats.players.filter((p) => p.wnba).map((p) => ({ player_id: p.player_id, name: p.name, team: p.team, games: p.games, averages: p.averages, wnba: p.wnba })),
    counts: { games: sb.games.length, finals: finals.length, box_scores: boxes.length, teams: stats.teams.length, players: stats.players.length, wnba_mapped: stats.players.filter((p) => p.wnba).length },
    wnba_roster_available: Boolean(w)
  };
  await env.INTL_KV.put(`agg:${comp.competition_id}`, JSON.stringify(agg));
  return agg;
}

async function aggregateFor(env, comp, ctx) {
  const agg = await env.INTL_KV.get(`agg:${comp.competition_id}`, 'json');
  if (agg?.games?.length) return agg;
  return buildAggregate(env, comp, ctx);
}

// ------------------------------------------------------------ views over the aggregate

const summarizeComp = (c, now = Date.now()) => ({ competition_id: c.competition_id, slug: c.slug, name: c.name, short_name: c.short_name, competition_type: c.competition_type, governing_body: c.governing_body, region: c.region, season: c.season, host: c.host || null, start_date: c.start_date, end_date: c.end_date, coverage: c.coverage, status: competitionStatus(c, now), qualification_relationships: c.qualification_relationships });

/** Overlay live scoreboard state on aggregate games (the aggregate is rebuilt every 2 minutes). */
function withLive(agg, sb) {
  const byId = new Map(sb.games.map((g) => [g.game_id, g]));
  return agg.games.map((g) => byId.get(g.game_id) || g);
}

export function freshness(fetchedAt, games, cache) {
  const age = fetchedAt ? (Date.now() - Date.parse(fetchedAt)) / 1000 : Infinity;
  const live = games.some((g) => g.status === 'live');
  const staleAfter = live ? 60 : 900;
  return { state: !fetchedAt ? FRESHNESS.ERROR : age > staleAfter || /stale/.test(cache || '') ? FRESHNESS.STALE : cache === 'network' ? FRESHNESS.CURRENT : FRESHNESS.CACHED, stale: !fetchedAt || age > staleAfter || /stale/.test(cache || ''), stale_after_s: staleAfter };
}

function playerCard(p) {
  return { player_id: p.player_id, name: p.name, jersey: p.jersey, team: p.team, games: p.games, starts: p.starts, averages: p.averages, wnba: p.wnba || null };
}

async function route(path, url, env, ctx) {
  const now = Date.now();
  const parts = path.split('/').filter(Boolean); // v1 international ...
  if (parts[0] !== 'v1' || parts[1] !== 'international') return null;
  const rest = parts.slice(2);

  if (!rest.length) {
    const comps = COMPETITIONS.map((c) => summarizeComp(c, now));
    const active = COMPETITIONS.filter((c) => c.coverage === 'full');
    const live = [];
    const recent = [];
    const wnba = [];
    let fetchedAt = null;
    let cache = 'network';
    for (const c of active) {
      const [agg, sb] = await Promise.all([aggregateFor(env, c, ctx), loadScoreboard(env, c, ctx)]);
      const games = withLive(agg, sb);
      fetchedAt = sb.fetched_at; cache = sb.cache;
      live.push(...games.filter((g) => g.status === 'live'));
      recent.push(...games.filter((g) => g.status === 'final').slice(-6).reverse());
      wnba.push(...agg.wnba_players.map((p) => ({ ...p, competition_id: c.competition_id })));
      const upcoming = games.filter((g) => g.status === 'scheduled').slice(0, 4);
      comps.find((x) => x.competition_id === c.competition_id).next_games = upcoming;
    }
    const f = freshness(fetchedAt, live, cache);
    return ok({ competitions: comps, live, recent, wnba_players: wnba }, m(path, { fetchedAt, freshness: f.state, cache, staleAfterS: f.stale_after_s, extra: { stale: f.stale } }), { maxAge: 10 });
  }

  if (rest[0] === 'competitions') {
    if (rest.length === 1) return ok({ competitions: COMPETITIONS.map((c) => summarizeComp(c, now)) }, m(path, { freshness: FRESHNESS.CURRENT, fetchedAt: new Date().toISOString() }), { maxAge: 300 });
    const comp = competitionById(rest[1]);
    if (!comp) return fail('competition_not_found', `No competition ${rest[1]}`, m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
    if (comp.coverage !== 'full') return ok({ competition: summarizeComp(comp, now), coverage: comp.coverage }, m(path, { freshness: FRESHNESS.UNAVAILABLE }), { maxAge: 300 });
    const [agg, sb] = await Promise.all([aggregateFor(env, comp, ctx), loadScoreboard(env, comp, ctx)]);
    const games = withLive(agg, sb);
    const f = freshness(sb.fetched_at, games, sb.cache);
    const mm = m(path, { fetchedAt: sb.fetched_at, freshness: f.state, cache: sb.cache, staleAfterS: f.stale_after_s, extra: { stale: f.stale, aggregate_built_at: agg.built_at, counts: agg.counts, provider_error: sb.error || null } });
    const maxAge = hasLiveOrImminent(games) ? 5 : 30;
    const view = rest[2] || 'overview';
    const todayKey = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const hostDay = (g) => new Date(g.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const scoreboard = () => {
      const live = games.filter((g) => g.status === 'live');
      const today = games.filter((g) => hostDay(g) === todayKey);
      const next = games.filter((g) => g.status === 'scheduled').slice(0, 4);
      const last = games.filter((g) => g.status === 'final').slice(-4).reverse();
      return { live, today, next, recent: last, host_date: todayKey };
    };
    switch (view) {
      case 'overview':
        return ok({ competition: summarizeComp(comp, now), scoreboard: scoreboard(), bracket: bracket(games), standings: agg.standings, leaders: agg.leaders.map((l) => ({ ...l, rows: l.rows.slice(0, 5) })), wnba_players: agg.wnba_players, teams: agg.teams.map((t) => ({ team: t.team, record: t.record, games: t.games })), counts: agg.counts }, mm, { maxAge });
      case 'scoreboard': return ok({ competition: summarizeComp(comp, now), ...scoreboard() }, mm, { maxAge });
      case 'schedule': return ok({ competition: summarizeComp(comp, now), games }, mm, { maxAge });
      case 'standings': return ok({ competition: summarizeComp(comp, now), standings: agg.standings }, mm, { maxAge: 60 });
      case 'bracket': return ok({ competition: summarizeComp(comp, now), bracket: bracket(games) }, mm, { maxAge });
      case 'teams': return ok({ competition: summarizeComp(comp, now), teams: agg.teams.map((t) => ({ team: t.team, record: t.record, games: t.games, averages: t.averages, roster_size: t.roster.length, wnba_players: agg.wnba_players.filter((p) => p.team.team_id === t.team.team_id).length })) }, mm, { maxAge: 60 });
      case 'players': return ok({ competition: summarizeComp(comp, now), players: agg.players.map(playerCard).sort((a, b) => a.name.localeCompare(b.name)) }, mm, { maxAge: 60 });
      case 'leaders': return ok({ competition: summarizeComp(comp, now), leaders: agg.leaders }, mm, { maxAge: 60 });
      default: return fail('not_found', 'Unknown competition view', mm, 404);
    }
  }

  if (rest[0] === 'games' && rest[1]) {
    const espnId = String(rest[1]).replace(/^g-/, '');
    if (!/^\d{6,12}$/.test(espnId)) return fail('game_not_found', 'Unknown game id', m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
    for (const comp of COMPETITIONS.filter((c) => c.coverage === 'full')) {
      const sb = await loadScoreboard(env, comp, ctx);
      const sbGame = sb.games.find((g) => g.provider_ids.espn === espnId);
      if (!sbGame) continue;
      const liveish = sbGame.status === 'live' || hasLiveOrImminent([sbGame]);
      const detail = await loadGameDetail(env, comp, espnId, ctx, { live: liveish });
      const agg = await aggregateFor(env, comp, ctx);
      const game = detail?.game ? { ...sbGame, ...detail.game, round: sbGame.round, round_name: sbGame.round_name, phase: sbGame.phase, group: sbGame.group } : sbGame;
      const byPlayer = new Map(agg.players.map((p) => [p.player_id, p]));
      const box = detail?.boxscore ? { teams: detail.boxscore.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, wnba: byPlayer.get(p.player_id)?.wnba || null })) })) } : null;
      const fetchedAt = detail?.fetched_at || sb.fetched_at;
      const f = freshness(fetchedAt, [game], detail?.cache || sb.cache);
      const mm = m(path, { fetchedAt, freshness: f.state, cache: detail?.cache || sb.cache, staleAfterS: f.stale_after_s, extra: { stale: f.stale } });
      const wnbaIn = agg.players.filter((p) => p.wnba && [game.home_team_id, game.away_team_id].includes(p.team.team_id)).map(playerCard);
      const teamRec = (id) => agg.teams.find((t) => t.team.team_id === id)?.record || null;
      const payload = { competition: summarizeComp(comp, now), game, records: { home: teamRec(game.home_team_id), away: teamRec(game.away_team_id) }, boxscore: box, plays_available: Boolean(detail?.plays?.length), wnba_players: wnbaIn };
      if (rest[2] === 'boxscore') return ok({ game, boxscore: box }, mm, { maxAge: game.status === 'live' ? 5 : 60 });
      if (rest[2] === 'playbyplay') return ok({ game, plays: detail?.plays || [] }, mm, { maxAge: game.status === 'live' ? 5 : 60 });
      return ok({ ...payload, plays: (detail?.plays || []).slice(-400) }, mm, { maxAge: game.status === 'live' ? 5 : game.status === 'final' ? 300 : 30 });
    }
    return fail('game_not_found', `Game ${espnId} is not in a covered competition`, m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
  }

  if (rest[0] === 'teams' && rest[1]) {
    const slug = String(rest[1]).replace(/^nt-/, '');
    const comps = [];
    let team = null;
    let fetchedAt = null;
    for (const comp of COMPETITIONS.filter((c) => c.coverage === 'full')) {
      const agg = await aggregateFor(env, comp, ctx);
      const t = agg.teams.find((x) => x.team.slug === slug);
      if (!t) continue;
      team = t.team;
      fetchedAt = agg.built_at;
      comps.push({ competition: summarizeComp(comp, now), record: t.record, averages: t.averages, games: agg.games.filter((g) => [g.home_team_id, g.away_team_id].includes(t.team.team_id)), roster: t.roster.map((r) => playerCard(agg.players.find((p) => p.player_id === r.player_id) || r)), standing: agg.standings.flatMap((s) => s.entries.map((e) => ({ ...e, group: s.group }))).find((e) => e.team.team_id === t.team.team_id) || null, medal: ['gold', 'silver', 'bronze'].find((k) => agg.bracket?.medals?.[k]?.team_id === t.team.team_id) || null });
    }
    if (!team) return fail('team_not_found', `No national team ${slug}`, m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
    const wnba = comps.flatMap((c) => c.roster.filter((p) => p.wnba));
    return ok({ team, competitions: comps, wnba_players: wnba }, m(path, { fetchedAt, freshness: FRESHNESS.CACHED, extra: { stale: false } }), { maxAge: 60 });
  }

  if (rest[0] === 'players' && rest[1]) {
    const id = String(rest[1]).replace(/^p-/, '');
    if (!/^\d{3,12}$/.test(id)) return fail('player_not_found', 'Unknown player id', m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
    const comps = [];
    let player = null;
    for (const comp of COMPETITIONS.filter((c) => c.coverage === 'full')) {
      const agg = await aggregateFor(env, comp, ctx);
      const p = agg.players.find((x) => x.provider_ids.espn === id);
      if (!p) continue;
      player = player || { player_id: p.player_id, provider_ids: p.provider_ids, name: p.name, jersey: p.jersey, team: p.team, wnba: p.wnba || null };
      comps.push({ competition: summarizeComp(comp, now), team: p.team, games: p.games, starts: p.starts, averages: p.averages, totals: p.totals, highs: p.highs, log: p.log });
    }
    if (!player) return fail('player_not_found', `No international player ${id}`, m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
    const bio = await cachedJson({ url: `${ESPN_CORE}/fiba/athletes/${id}`, ttlS: 86400, keepS: 7 * 86400, validate: (b) => Boolean(b?.id), ctx, timeoutMs: 6000 });
    player.bio = bio.body ? { dob: bio.body.dateOfBirth ? String(bio.body.dateOfBirth).slice(0, 10) : null, height: bio.body.displayHeight || null, citizenship: bio.body.citizenship || null } : null;
    return ok({ player, competitions: comps }, m(path, { fetchedAt: bio.fetchedAt, freshness: FRESHNESS.CACHED, extra: { stale: false } }), { maxAge: 300 });
  }

  if (rest[0] === 'wnba' && rest[1]) {
    // Reverse crosswalk for the WNBA player page: international career by WNBA player id.
    const out = [];
    for (const comp of COMPETITIONS.filter((c) => c.coverage === 'full')) {
      const agg = await aggregateFor(env, comp, ctx);
      const p = agg.players.find((x) => x.wnba?.wnba_player_id === String(rest[1]));
      if (p) out.push({ competition: summarizeComp(comp, now), player_id: p.player_id, provider_ids: p.provider_ids, name: p.name, team: p.team, games: p.games, averages: p.averages, log: p.log.slice(-8), mapping: { method: p.wnba.mapping_method, confidence: p.wnba.mapping_confidence } });
    }
    return ok({ wnba_player_id: String(rest[1]), international: out }, m(path, { freshness: out.length ? FRESHNESS.CACHED : FRESHNESS.UNAVAILABLE, extra: { stale: false } }), { maxAge: 300 });
  }

  if (rest[0] === 'health') {
    const rows = [];
    for (const comp of COMPETITIONS.filter((c) => c.coverage === 'full')) {
      const agg = await env.INTL_KV.get(`agg:${comp.competition_id}`, 'json');
      const last = await env.INTL_KV.get(`sb:${comp.competition_id}`, 'json');
      rows.push({ competition_id: comp.competition_id, aggregate_built_at: agg?.built_at || null, scoreboard_fetched_at: last?.fetched_at || null, counts: agg?.counts || null });
    }
    return ok({ service: SERVICE, version: VERSION, provider: SOURCE, competitions: rows }, m(path, { freshness: FRESHNESS.CURRENT, fetchedAt: new Date().toISOString() }));
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return preflight();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health') return ok({ service: SERVICE, version: VERSION }, m(path, { freshness: FRESHNESS.CURRENT, fetchedAt: new Date().toISOString() }));
    try {
      const res = await route(path, url, env, ctx);
      if (res) return res;
      return fail('not_found', 'Unknown route', m(path, { freshness: FRESHNESS.UNAVAILABLE }), 404);
    } catch (e) {
      console.error(`[${SERVICE}] ${path}`, e?.stack || e);
      return fail('internal_error', 'Unhandled error', m(path, { freshness: FRESHNESS.ERROR }), 500);
    }
  },
  async scheduled(event, env, ctx) {
    for (const comp of COMPETITIONS.filter((c) => c.coverage === 'full' && competitionStatus(c) !== 'historical')) {
      ctx.waitUntil(buildAggregate(env, comp, ctx).catch((e) => console.error('aggregate failed', comp.competition_id, e?.stack || e)));
    }
  }
};

export { currentEdition };
