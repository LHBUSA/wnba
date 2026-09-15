// wnba-ingest — PropBetEdge WNBA background lane (Cloudflare Cron).
//
// Cloudflare owns every schedule here. GitHub Actions schedules nothing.
// Writes: Cloudflare KV (edge snapshots, replay archive, change ledgers) and,
// when SUPABASE_* secrets are bound, the Supabase system of record.
//
// Tasks (cron "* * * * *", dispatched by minute / Eastern hour):
//   live         every minute   today's games; live event deltas; archive finals
//   availability every 10 min   injury feed diff -> before/after change ledger
//   backfill     every 10 min   archive up to N completed season games for replay
//   schedule     every 30 min   season schedule -> wnba_games
//   reference    hourly :15     teams, rosters, standings snapshot
//   odds         08/13/18 ET    featured markets + near-term props (credit-bounded)
//   pbe          every minute   PBE WNBA model runner (PBE_MODE; dry_run = shadow ledger only)

import { fetchJsonWithTimeout, cachedJson } from '../../shared/fetcher.js';
import { ESPN, normalizeScoreboard, normalizeSummary, normalizeInjuries, normalizeTeams, normalizeRoster, normalizeStandings } from '../../shared/espn.js';
import { shotChart } from '../../shared/derive.js';
import { normalizeOddsEvent, normalizeProps, teamIndex, normalizeName } from '../../shared/market.js';
import { upsert, insert, supabaseConfigured } from '../../shared/supabase.js';
import { etCompact, addDays, etHour } from '../../shared/time.js';
import { pbeTask } from './pbe-runner.js';

const SERVICE = 'wnba-ingest';
const VERSION = '1.0.0';
const ODDS_HOURS_ET = [8, 13, 18];
const PROP_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_threes'];
const PROPS_WINDOW_H = 36;
const BACKFILL_PER_RUN = 12;

export default {
  async scheduled(event, env, ctx) {
    const d = new Date(event.scheduledTime);
    const minute = d.getUTCMinutes();
    const tasks = ['live', 'pbe'];
    if (minute % 10 === 0) tasks.push('availability', 'backfill');
    // Lock-policy evidence: while a covered game tips within 75 minutes, read the injury feed every 2 minutes.
    else if (minute % 2 === 0 && env.WNBA_KV && Date.parse((await env.WNBA_KV.get('pbe:v1:near_tip_until')) || 0) > Date.now()) tasks.push('availability');
    if (minute % 30 === 5) tasks.push('schedule');
    if (minute === 15) tasks.push('reference');
    if (minute <= 1 && ODDS_HOURS_ET.includes(etHour(d))) tasks.push('odds');
    ctx.waitUntil(runTasks(env, ctx, tasks, 'cron'));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return j({ ok: true, service: SERVICE, version: VERSION, runtime: 'cloudflare-workers', scheduler: 'cloudflare-cron', kv: Boolean(env.WNBA_KV), supabase: supabaseConfigured(env), odds_key: Boolean(env.ODDS_API_KEY), odds_hours_et: ODDS_HOURS_ET });
    }
    if (url.pathname === '/status') {
      const status = env.WNBA_KV ? await env.WNBA_KV.get('ingest:v1:status', 'json') : null;
      return j({ ok: true, service: SERVICE, version: VERSION, status });
    }
    const m = url.pathname.match(/^\/run\/(live|availability|backfill|schedule|reference|odds|pbe)$/);
    if (m && request.method === 'POST') {
      if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return j({ ok: false, error: 'unauthorized' }, 401);
      const result = await runTasks(env, ctx, [m[1]], 'manual');
      return j({ ok: true, result });
    }
    return j({ ok: false, error: 'not_found' }, 404);
  }
};

async function runTasks(env, ctx, tasks, trigger) {
  const results = {};
  for (const t of tasks) {
    const t0 = Date.now();
    try {
      results[t] = { ok: true, ...(await TASKS[t](env, ctx)), ms: Date.now() - t0 };
    } catch (e) {
      console.error(`[${SERVICE}] task ${t} failed`, e?.stack || e);
      results[t] = { ok: false, error: e.message || String(e), ms: Date.now() - t0 };
    }
  }
  if (env.WNBA_KV) {
    const prev = (await env.WNBA_KV.get('ingest:v1:status', 'json')) || {};
    const at = new Date().toISOString();
    for (const [t, r] of Object.entries(results)) prev[t] = { ...r, at, trigger };
    prev.version = VERSION;
    prev.supabase = supabaseConfigured(env);
    await env.WNBA_KV.put('ingest:v1:status', JSON.stringify(prev));
  }
  return results;
}

// pbe: PBE WNBA runner (pbe-runner.js). PBE_MODE off | dry_run | armed; it decides per game whether anything is due.
const TASKS = { live, availability, backfill, schedule, reference, odds, pbe: (env) => pbeTask(env) };

// ---------------------------------------------------------------- rows

function gameRow(g, capturedAt) {
  return {
    game_id: g.game_id,
    season: g.season?.year ?? null,
    season_type: g.season?.type ?? null,
    start_utc: g.start_utc,
    home_team_id: g.home?.team_id ?? null,
    away_team_id: g.away?.team_id ?? null,
    status_state: g.status?.state ?? null,
    status_name: g.status?.name ?? null,
    completed: Boolean(g.status?.completed),
    period: g.status?.period ?? null,
    clock: g.status?.clock ?? null,
    home_score: g.home?.score ?? null,
    away_score: g.away?.score ?? null,
    venue_name: g.venue?.name ?? null,
    venue_city: g.venue?.city ?? null,
    venue_state: g.venue?.state ?? null,
    neutral_site: g.neutral_site ?? null,
    source: 'espn',
    source_updated_at: g.source_updated_at ?? null,
    captured_at: capturedAt,
    updated_at: capturedAt
  };
}

function eventRows(gameId, plays, capturedAt) {
  return plays.map((p) => ({
    game_id: gameId,
    event_id: p.id,
    seq: p.seq,
    period: p.period,
    clock: p.clock,
    elapsed_s: p.elapsed_s,
    wallclock: p.wallclock,
    type_id: p.type_id,
    type: p.type,
    text: p.text,
    team_id: p.team_id,
    athlete_ids: p.athlete_ids,
    home_score: p.home_score,
    away_score: p.away_score,
    scoring: p.scoring,
    points: p.points,
    shooting: p.shooting,
    points_attempted: p.points_attempted,
    made: p.made,
    coord_x: p.coordinate?.x ?? null,
    coord_y: p.coordinate?.y ?? null,
    source: 'espn',
    last_captured_at: capturedAt
  }));
}

function statRows(gameId, box, final, capturedAt) {
  const players = box.players.map((r) => ({
    game_id: gameId, athlete_id: r.athlete_id, team_id: r.team_id, starter: r.starter, dnp: r.dnp, dnp_reason: r.dnp_reason,
    min: r.min ?? null, pts: r.pts ?? null, fgm: r.fgm ?? null, fga: r.fga ?? null, fg3m: r.fg3m ?? null, fg3a: r.fg3a ?? null,
    ftm: r.ftm ?? null, fta: r.fta ?? null, reb: r.reb ?? null, oreb: r.oreb ?? null, dreb: r.dreb ?? null, ast: r.ast ?? null,
    stl: r.stl ?? null, blk: r.blk ?? null, tov: r.tov ?? null, pf: r.pf ?? null, plus_minus: r.plus_minus ?? null, final, captured_at: capturedAt
  }));
  const teams = box.teams.map((t) => ({ game_id: gameId, team_id: t.team_id, home_away: t.home_away, stats: t.stats, final, captured_at: capturedAt }));
  return { players, teams };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- live

async function live(env, ctx) {
  const now = new Date();
  const today = etCompact(now);
  const days = etHour(now) < 4 ? [addDays(today, -1), today] : [today];
  const capturedAt = now.toISOString();
  let games = [];
  for (const day of days) {
    const sb = normalizeScoreboard(await fetchJsonWithTimeout(`${ESPN.site}/scoreboard?dates=${day}&limit=100`));
    games = games.concat(sb.games);
  }
  if (!games.length) return { games: 0, live: 0, archived: 0 };
  await upsert(env, 'wnba_games', games.map((g) => gameRow(g, capturedAt)), 'game_id');

  let liveCount = 0;
  let archived = 0;
  let events = 0;
  for (const g of games) {
    if (g.status?.state === 'in') {
      liveCount += 1;
      const s = normalizeSummary(await fetchJsonWithTimeout(`${ESPN.site}/summary?event=${g.game_id}`));
      const lastKey = `live:v1:seq:${g.game_id}`;
      const last = Number((env.WNBA_KV && (await env.WNBA_KV.get(lastKey))) || 0);
      // Re-send a small overlap so source corrections to recent plays land too.
      const delta = s.plays.filter((p) => (p.seq ?? 0) > last - 5);
      await upsert(env, 'wnba_games', [gameRow(s.game, capturedAt)], 'game_id');
      await upsert(env, 'wnba_game_events', eventRows(g.game_id, delta, capturedAt), 'game_id,event_id');
      const st = statRows(g.game_id, s.box, false, capturedAt);
      await upsert(env, 'wnba_player_game_stats', st.players, 'game_id,athlete_id');
      await upsert(env, 'wnba_team_game_stats', st.teams, 'game_id,team_id');
      events += delta.length;
      if (env.WNBA_KV && s.plays.length) await env.WNBA_KV.put(lastKey, String(s.plays.at(-1).seq ?? 0), { expirationTtl: 86400 });
    } else if (g.status?.state === 'post' && g.status?.completed) {
      if (await archiveGame(env, g.game_id)) archived += 1;
    }
  }
  return { games: games.length, live: liveCount, archived, events_written: events, supabase: supabaseConfigured(env) };
}

/** Archive a completed game once. Returns true if newly archived. */
async function archiveGame(env, gameId) {
  if (!env.WNBA_KV) return false;
  const key = `game:v1:final:${gameId}`;
  if (await env.WNBA_KV.get(`${key}:done`)) return false;
  const raw = await fetchJsonWithTimeout(`${ESPN.site}/summary?event=${gameId}`, { timeoutMs: 15000 });
  const s = normalizeSummary(raw);
  if (!s.game?.status?.completed) return false; // only archive what the source says is final
  if (!s.plays.length) return false; // nothing to replay yet; try again later
  const capturedAt = new Date().toISOString();
  const checksum = await sha256(JSON.stringify(s.plays));
  const chart = shotChart(s.plays);
  await env.WNBA_KV.put(key, JSON.stringify({ archived_at: capturedAt, checksum, summary: s }));
  await env.WNBA_KV.put(`${key}:done`, capturedAt);
  await upsert(env, 'wnba_games', [gameRow(s.game, capturedAt)], 'game_id');
  await upsert(env, 'wnba_game_events', eventRows(gameId, s.plays, capturedAt), 'game_id,event_id');
  const st = statRows(gameId, s.box, true, capturedAt);
  await upsert(env, 'wnba_player_game_stats', st.players, 'game_id,athlete_id');
  await upsert(env, 'wnba_team_game_stats', st.teams, 'game_id,team_id');
  await upsert(env, 'wnba_replay_archives', [{ game_id: gameId, archived_at: capturedAt, event_count: s.plays.length, plotted_shots: chart.plotted, checksum, source: 'espn' }], 'game_id', { ignoreDuplicates: true });
  const idx = (await env.WNBA_KV.get('archive:v1:index', 'json')) || [];
  if (!idx.includes(gameId)) {
    idx.push(gameId);
    await env.WNBA_KV.put('archive:v1:index', JSON.stringify(idx));
  }
  return true;
}

// ---------------------------------------------------------------- backfill

async function backfill(env) {
  if (!env.WNBA_KV) return { skipped: 'no_kv' };
  const sched = await seasonSchedule();
  const finals = sched.games.filter((g) => g.status?.state === 'post' && g.status?.completed).sort((a, b) => String(b.start_utc).localeCompare(String(a.start_utc)));
  const idx = new Set((await env.WNBA_KV.get('archive:v1:index', 'json')) || []);
  const todo = finals.filter((g) => !idx.has(g.game_id)).slice(0, BACKFILL_PER_RUN);
  let done = 0;
  for (const g of todo) if (await archiveGame(env, g.game_id)) done += 1;
  return { finals: finals.length, archived_total: idx.size + done, archived_now: done, remaining: finals.length - idx.size - done };
}

async function seasonSchedule() {
  const sb = normalizeScoreboard(await fetchJsonWithTimeout(`${ESPN.site}/scoreboard`));
  const year = sb.season?.year || Number(etCompact().slice(0, 4));
  const r = await cachedJson({ url: `${ESPN.site}/scoreboard?dates=${year}0401-${year}1101&limit=1000`, ttlS: 1500, timeoutMs: 20000 });
  if (!r.body) throw new Error(`season_schedule_unavailable:${r.error}`);
  return { year, ...normalizeScoreboard(r.body) };
}

// ---------------------------------------------------------------- schedule

async function schedule(env) {
  const sched = await seasonSchedule();
  const capturedAt = new Date().toISOString();
  const res = await upsert(env, 'wnba_games', sched.games.map((g) => gameRow(g, capturedAt)), 'game_id');
  return { season: sched.year, games: sched.games.length, written: res.count, supabase: !res.skipped };
}

// ---------------------------------------------------------------- reference

async function reference(env) {
  const capturedAt = new Date().toISOString();
  const teams = normalizeTeams(await fetchJsonWithTimeout(`${ESPN.site}/teams`));
  await upsert(env, 'wnba_teams', teams.map((t) => ({ ...t, source: 'espn', captured_at: capturedAt, updated_at: capturedAt })), 'team_id');
  let players = 0;
  let rosterRows = 0;
  const allRosters = [];
  for (const t of teams) {
    const roster = normalizeRoster(await fetchJsonWithTimeout(`${ESPN.site}/teams/${t.team_id}/roster`));
    allRosters.push(roster);
    const season = roster.season?.year;
    const prow = roster.athletes.map((a) => ({ athlete_id: a.athlete_id, name: a.name, first_name: a.first_name, last_name: a.last_name, position: a.position, height: a.height, dob: a.dob, college: a.college, source: 'espn', captured_at: capturedAt, updated_at: capturedAt }));
    await upsert(env, 'wnba_players', prow, 'athlete_id');
    await upsert(env, 'wnba_rosters', roster.athletes.map((a) => ({ season, team_id: t.team_id, athlete_id: a.athlete_id, jersey: a.jersey, status: a.status, last_seen_at: capturedAt })), 'season,team_id,athlete_id');
    players += prow.length;
    rosterRows += roster.athletes.length;
  }
  if (env.WNBA_KV) {
    // Entity dictionary for props name joins (and a copy the news lane may read).
    const dict = allRosters.flatMap((r) => r.athletes.map((a) => ({ athlete_id: a.athlete_id, name: a.name, team_id: a.team_id })));
    await env.WNBA_KV.put('ref:v1:athletes', JSON.stringify({ captured_at: capturedAt, athletes: dict, teams }));
  }
  const st = normalizeStandings(await fetchJsonWithTimeout(`${ESPN.v2}/standings`));
  const srows = st.groups.flatMap((g) => g.entries.map((e) => ({ season: st.season.year, season_type: st.season.type, team_id: e.team_id, conference: g.name, seed: e.seed, wins: e.wins, losses: e.losses, win_pct: e.win_pct, games_behind: e.games_behind, streak: e.streak, clincher: e.clincher, captured_at: capturedAt })));
  await upsert(env, 'wnba_standings_snapshots', srows.filter((r) => r.wins !== null && r.losses !== null), 'season,season_type,team_id,wins,losses', { ignoreDuplicates: true });
  return { teams: teams.length, players, roster_rows: rosterRows, standings_rows: srows.length, supabase: supabaseConfigured(env) };
}

// ---------------------------------------------------------------- availability

function availKey(i) {
  return i.athlete_id || `name:${normalizeName(i.name)}`;
}

async function availability(env) {
  if (!env.WNBA_KV) return { skipped: 'no_kv' };
  const capturedAt = new Date().toISOString();
  const list = normalizeInjuries(await fetchJsonWithTimeout(`${ESPN.site}/injuries`));
  const prev = await env.WNBA_KV.get('avail:v1:snapshot', 'json');
  const cur = {};
  for (const i of list) cur[availKey(i)] = { athlete_id: i.athlete_id, team_id: i.team_id, name: i.name, status: i.status, body_part: i.body_part, detail: i.detail, side: i.side, source_return_date: i.source_return_date, short_comment: i.short_comment, source_injury_id: i.injury_id, source_updated_at: i.source_updated_at };

  const changes = [];
  if (prev?.items) {
    for (const [k, v] of Object.entries(cur)) {
      const b = prev.items[k];
      if (!b) changes.push({ change_kind: 'added', ...pick(v), status_before: null, status_after: v.status, detail_before: null, detail_after: detailOf(v) });
      else if (b.status !== v.status) changes.push({ change_kind: 'status_changed', ...pick(v), status_before: b.status, status_after: v.status, detail_before: detailOf(b), detail_after: detailOf(v) });
      else if (b.source_updated_at !== v.source_updated_at && (b.short_comment !== v.short_comment || b.source_return_date !== v.source_return_date)) changes.push({ change_kind: 'detail_changed', ...pick(v), status_before: b.status, status_after: v.status, detail_before: detailOf(b), detail_after: detailOf(v) });
    }
    for (const [k, b] of Object.entries(prev.items)) {
      if (!cur[k]) changes.push({ change_kind: 'removed', ...pick(b), status_before: b.status, status_after: null, detail_before: detailOf(b), detail_after: null, source_updated_at: null });
    }
  }
  const stamped = changes.map((c) => ({ ...c, source: 'espn', captured_at: capturedAt, previous_captured_at: prev?.captured_at || null }));
  if (stamped.length) {
    const ledger = (await env.WNBA_KV.get('avail:v1:changes', 'json')) || [];
    await env.WNBA_KV.put('avail:v1:changes', JSON.stringify([...stamped, ...ledger].slice(0, 400)));
  }
  await env.WNBA_KV.put('avail:v1:snapshot', JSON.stringify({ captured_at: capturedAt, items: cur }));
  await upsert(env, 'wnba_availability_current', Object.values(cur).filter((v) => v.athlete_id).map((v) => ({ ...v, source: 'espn', captured_at: capturedAt })), 'athlete_id');
  await upsert(env, 'wnba_availability_events', stamped.filter((c) => c.athlete_id).map(({ previous_captured_at, ...c }) => c), 'athlete_id,change_kind,status_after,source_updated_at', { ignoreDuplicates: true });
  return { items: list.length, baseline: !prev, changes: stamped.length };
}

function pick(v) {
  return { athlete_id: v.athlete_id, team_id: v.team_id, name: v.name, source_injury_id: v.source_injury_id, source_updated_at: v.source_updated_at };
}
function detailOf(v) {
  return { body_part: v.body_part, detail: v.detail, side: v.side, source_return_date: v.source_return_date, short_comment: v.short_comment };
}

// ---------------------------------------------------------------- odds

async function oddsCall(env, path) {
  const res = await fetch(`https://api.the-odds-api.com/v4${path}${path.includes('?') ? '&' : '?'}apiKey=${env.ODDS_API_KEY}`, { signal: AbortSignal.timeout(20000) });
  const credits = { last: Number(res.headers.get('x-requests-last')), used: Number(res.headers.get('x-requests-used')), remaining: Number(res.headers.get('x-requests-remaining')) };
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`odds_api_${res.status}:${text.slice(0, 160)}`), { credits });
  return { body: JSON.parse(text), credits };
}

async function odds(env) {
  if (!env.WNBA_KV) return { skipped: 'no_kv' };
  const slot = `${etCompact()}-${etHour()}`;
  const lockKey = `odds:v1:lock:${slot}`;
  if (await env.WNBA_KV.get(lockKey)) return { skipped: 'already_ran_this_slot', slot };
  await env.WNBA_KV.put(lockKey, '1', { expirationTtl: 3 * 3600 });
  if (!env.ODDS_API_KEY) {
    await env.WNBA_KV.put('odds:v1:status', JSON.stringify({ at: new Date().toISOString(), status: 'NOT_CONFIGURED' }));
    return { skipped: 'no_odds_key' };
  }
  const capturedAt = new Date().toISOString();
  const teams = normalizeTeams(await fetchJsonWithTimeout(`${ESPN.site}/teams`));
  const tIdx = teamIndex(teams);
  const featured = await oddsCall(env, '/sports/basketball_wnba/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american');
  let credits = featured.credits;
  let spent = credits.last || 0;

  // Join each market event to an ESPN game: exact team ids + tip within 6h.
  const today = etCompact();
  const sb = normalizeScoreboard(await fetchJsonWithTimeout(`${ESPN.site}/scoreboard?dates=${addDays(today, -1)}-${addDays(today, 10)}&limit=200`));
  const events = featured.body.map((ev) => {
    const n = normalizeOddsEvent(ev, tIdx);
    const g = sb.games.find((x) => x.home?.team_id === n.home_team_id && x.away?.team_id === n.away_team_id && Math.abs(Date.parse(x.start_utc) - Date.parse(n.commence_time)) < 6 * 3600e3);
    return { ...n, game_id: g?.game_id || null };
  });

  // Props: only for games tipping inside the window (bounded spend).
  const soon = events.filter((e) => Date.parse(e.commence_time) - Date.now() < PROPS_WINDOW_H * 3600e3 && Date.parse(e.commence_time) > Date.now());
  const propGames = [];
  for (const e of soon) {
    try {
      const r = await oddsCall(env, `/sports/basketball_wnba/events/${e.odds_event_id}/odds?regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american`);
      credits = r.credits;
      spent += r.credits.last || 0;
      const rosterIdx = new Map();
      for (const tid of [e.home_team_id, e.away_team_id].filter(Boolean)) {
        const ro = normalizeRoster(await fetchJsonWithTimeout(`${ESPN.site}/teams/${tid}/roster`));
        for (const a of ro.athletes) rosterIdx.set(normalizeName(a.name), a);
      }
      propGames.push({ odds_event_id: e.odds_event_id, game_id: e.game_id, commence_time: e.commence_time, home_team: e.home_team, away_team: e.away_team, home_team_id: e.home_team_id, away_team_id: e.away_team_id, props: normalizeProps(r.body, rosterIdx) });
    } catch (err) {
      propGames.push({ odds_event_id: e.odds_event_id, game_id: e.game_id, error: err.message, props: [] });
    }
  }

  const snap = { captured_at: capturedAt, schedule: `${ODDS_HOURS_ET.join('/')} ET`, events, credits: { spent_this_run: spent, remaining: credits.remaining } };
  await env.WNBA_KV.put('odds:v1:latest', JSON.stringify(snap));
  await env.WNBA_KV.put('props:v1:latest', JSON.stringify({ captured_at: capturedAt, markets: PROP_MARKETS, window_hours: PROPS_WINDOW_H, games: propGames }));

  // Last pre-tip snapshot per ESPN game: after tip the event leaves the Odds API
  // feed, so this is what game/replay pages show as the closing market.
  for (const e of events) {
    if (e.game_id && Date.parse(e.commence_time) > Date.now()) {
      await env.WNBA_KV.put(`odds:v1:game:${e.game_id}`, JSON.stringify({ captured_at: capturedAt, event: e }), { expirationTtl: 400 * 86400 });
    }
  }

  // Movement history per event (compact: consensus + best at the modal line).
  for (const e of events) {
    const hk = `odds:v1:hist:${e.odds_event_id}`;
    const h = (await env.WNBA_KV.get(hk, 'json')) || [];
    h.push({ at: capturedAt, ml_home: e.moneyline.consensus?.home_fair_american ?? null, ml_best_home: e.moneyline.best.home?.price ?? null, ml_best_away: e.moneyline.best.away?.price ?? null, spread: e.spread.consensus_line, total: e.total.consensus_line, books: e.book_count });
    await env.WNBA_KV.put(hk, JSON.stringify(h.slice(-90)), { expirationTtl: 60 * 86400 });
  }

  // Durable rows (Supabase) — every book/outcome/price as published.
  const rows = [];
  for (const ev of featured.body) {
    const e = events.find((x) => x.odds_event_id === ev.id);
    for (const b of ev.bookmakers || []) for (const m of b.markets || []) for (const o of m.outcomes || []) {
      rows.push({ captured_at: capturedAt, odds_event_id: ev.id, game_id: e?.game_id || null, commence_time: ev.commence_time, market: m.key, book: b.key, outcome: o.name, participant: null, athlete_id: null, point: o.point ?? null, price: o.price, book_updated_at: m.last_update || b.last_update || null, source: 'odds_api' });
    }
  }
  for (const g of propGames) for (const p of g.props) for (const b of p.books) {
    for (const [side, price] of [['Over', b.over], ['Under', b.under]]) if (price !== null) rows.push({ captured_at: capturedAt, odds_event_id: g.odds_event_id, game_id: g.game_id, commence_time: g.commence_time, market: p.market, book: b.book, outcome: side, participant: p.player, athlete_id: p.athlete_id, point: p.point, price, book_updated_at: b.updated || null, source: 'odds_api' });
  }
  await upsert(env, 'wnba_odds_snapshots', rows, 'odds_event_id,market,book,outcome,participant,point,book_updated_at', { ignoreDuplicates: true });
  await insert(env, 'wnba_odds_runs', [{ kind: 'featured+props', events: events.length, credits_last: spent, credits_used: credits.used, credits_remaining: credits.remaining, status: 'PASS', detail: { prop_games: propGames.length, rows: rows.length } }]);
  const status = { at: capturedAt, status: 'PASS', events: events.length, prop_games: propGames.length, credits_spent: spent, credits_remaining: credits.remaining, rows: rows.length };
  await env.WNBA_KV.put('odds:v1:status', JSON.stringify(status));
  return status;
}

function j(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
