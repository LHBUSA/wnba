// WNBA adapter for the playoff contract (workers/shared/playoffs.js). ESPN is the source.
//
// Source fields used (verified 2026-09-25 against the 2025 completed and 2026 scheduled postseasons,
// see docs/PLAYOFFS.md):
//   scoreboard event: id, date, season.{year,type}, status.type.{name,state,completed,shortDetail}
//   competitions[0]: notes[].headline ("First Round - Game 1", "Semifinals - Game 5 If Necessary",
//     "WNBA FINALS - Game 3"), series.{completed,totalCompetitions,summary,competitors[].{id,wins}},
//     competitors[].{homeAway,score,team.{id,abbreviation,displayName,...}}, timeValid, venue
//   league standings (standings?level=1): playoffSeed (league seed), clincher (code + description)
//   seasons[].types[] (Postseason window) and scoreboard leagues[0].calendar (whitelisted game days)
// Placeholder events use team ids -1/-2 and abbreviation "TBD": they are schedule slots, not teams.

import { buildPlayoffs, GAME_STATUS } from './playoffs.js';

export const WNBA_ROUNDS = Object.freeze([
  { round_id: 'first-round', name: 'First Round', order: 1, match: (l) => /^first round$/i.test(l.trim()) },
  // 2025 headlines say "WNBA Semifinals", the 2026 schedule says "Semifinals".
  { round_id: 'semifinals', name: 'Semifinals', order: 2, match: (l) => /^(wnba )?semi-?finals$/i.test(l.trim()) },
  // "WNBA Finals" and "WNBA FINALS" both occur in 2025.
  { round_id: 'finals', name: 'WNBA Finals', order: 3, is_final: true, match: (l) => /^(wnba )?finals$/i.test(l.trim()) }
]);

export const WNBA_PLAYOFFS_SOURCE = Object.freeze({
  id: 'espn',
  name: 'ESPN',
  authority: 'EXTERNAL_PROVIDER',
  endpoints: [
    'site scoreboard per postseason game day (season.type = 3 events: notes, series, competitors)',
    'league standings level=1 (playoffSeed, clincher)',
    'core seasons/{year}/types/3/events (completeness cross-check)'
  ],
  derivation: 'Bracket derived by PropBetEdge from postseason game records. ESPN publishes no bracket resource.'
});

const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));

/** "Semifinals - Game 5 If Necessary" -> { label: 'Semifinals', game_number: 5, if_necessary: true } */
export function parseRoundNote(headline) {
  const h = String(headline || '').trim();
  const m = h.match(/^(.+?)\s*[-–—]\s*Game\s+(\d{1,2})(\s+if necessary)?\s*$/i);
  if (m) return { label: m[1].trim(), game_number: Number(m[2]), if_necessary: Boolean(m[3]) };
  return { label: h, game_number: null, if_necessary: false };
}

export function gameStatusOf(type = {}) {
  const name = String(type.name || '');
  if (/POSTPONED/.test(name)) return GAME_STATUS.POSTPONED;
  if (/CANCELED|CANCELLED/.test(name)) return GAME_STATUS.CANCELED;
  if (/SUSPENDED/.test(name)) return GAME_STATUS.SUSPENDED;
  if (type.state === 'post' && type.completed) return GAME_STATUS.FINAL;
  if (type.state === 'in') return GAME_STATUS.LIVE;
  if (type.state === 'pre') return GAME_STATUS.SCHEDULED;
  return GAME_STATUS.UNKNOWN;
}

const isPlaceholder = (t) => !t || !/^\d+$/.test(String(t.id ?? '')) || String(t.abbreviation || '').toUpperCase() === 'TBD';

function teamOf(t, logoFor) {
  if (isPlaceholder(t)) return null;
  const id = String(t.id);
  return { team_id: id, abbreviation: str(t.abbreviation), name: str(t.displayName), short_name: str(t.shortDisplayName || t.name), location: str(t.location), logo: logoFor ? logoFor(id) : null };
}

const scoreOf = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(typeof v === 'object' ? v.value ?? v.displayValue : v);
  return Number.isFinite(n) ? n : null;
};

/** One ESPN scoreboard event -> adapter game for buildPlayoffs. */
export function normalizePostseasonEvent(e, { logoFor = null } = {}) {
  const c = e?.competitions?.[0] || {};
  const type = e?.status?.type || c?.status?.type || {};
  const status = gameStatusOf(type);
  const note = parseRoundNote((c.notes || []).find((n) => n?.type === 'event')?.headline || c.notes?.[0]?.headline || '');
  const comp = (side) => (c.competitors || []).find((x) => x.homeAway === side) || null;
  const h = comp('home');
  const a = comp('away');
  const played = status === GAME_STATUS.FINAL || status === GAME_STATUS.LIVE;
  const series = c.series && c.series.type === 'playoff'
    ? {
      completed: typeof c.series.completed === 'boolean' ? c.series.completed : null,
      total: Number.isInteger(c.series.totalCompetitions) ? c.series.totalCompetitions : null,
      summary: str(c.series.summary),
      wins: Object.fromEntries((c.series.competitors || []).filter((x) => /^\d+$/.test(String(x.id ?? ''))).map((x) => [String(x.id), Number(x.wins)]))
    }
    : null;
  return {
    game_id: str(e?.id),
    season_year: Number(e?.season?.year),
    season_type: Number(e?.season?.type),
    start_utc: str(e?.date || c.date),
    time_tbd: c.timeValid === false,
    status,
    status_detail: str(type.shortDetail || type.detail),
    round_label: note.label,
    game_number: note.game_number,
    if_necessary: note.if_necessary,
    home: teamOf(h?.team, logoFor),
    away: teamOf(a?.team, logoFor),
    home_score: played ? scoreOf(h?.score) : null,
    away_score: played ? scoreOf(a?.score) : null,
    // Placeholder teams (-1/-2) never count: only real team ids reach the series record.
    source_series: series && Object.keys(series.wins).length ? series : series ? { ...series, wins: null } : null,
    venue: c.venue ? { name: str(c.venue.fullName), city: str(c.venue.address?.city), state: str(c.venue.address?.state) } : null
  };
}

/** League seed table from standings?level=1. The clincher description is the source's own label. */
export function seedsFromLeagueStandings(body, { logoFor = null } = {}) {
  const entries = body?.standings?.entries || [];
  const out = [];
  for (const e of entries) {
    const stat = (n) => (e.stats || []).find((s) => s.name === n);
    const seed = Number(stat('playoffSeed')?.value ?? stat('playoffSeed')?.displayValue);
    const c = stat('clincher');
    const code = str(c?.displayValue);
    const label = str(c?.description);
    const t = e.team || {};
    if (!/^\d+$/.test(String(t.id ?? ''))) continue;
    out.push({
      seed: Number.isInteger(seed) && seed > 0 ? seed : null,
      team_id: String(t.id),
      team_name: str(t.displayName),
      abbreviation: str(t.abbreviation),
      logo: logoFor ? logoFor(String(t.id)) : null,
      wins: Number.isFinite(Number(stat('wins')?.value)) ? Number(stat('wins').value) : null,
      losses: Number.isFinite(Number(stat('losses')?.value)) ? Number(stat('losses').value) : null,
      clinch_status: clinchStatus(code, label),
      clinch_code: code,
      clinch_label: label
    });
  }
  return out.sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
}

/** Map ESPN clinch marks to a small closed vocabulary; the description decides, not a guessed letter. */
export function clinchStatus(code, label) {
  const d = String(label || '');
  if (/eliminated/i.test(d)) return 'ELIMINATED';
  if (/best (league )?record/i.test(d)) return 'CLINCHED_BEST_RECORD';
  if (/clinched/i.test(d)) return 'CLINCHED_PLAYOFFS';
  if (!code) return null; // no mark published: still in contention, or the source is silent
  return 'MARKED_UNKNOWN';
}

/** Season calendar window for one year from the standings payload's seasons[].types[]. */
export function seasonWindow(body, year) {
  const s = (body?.seasons || []).find((x) => Number(x.year) === Number(year));
  const t = (id) => (s?.types || []).find((x) => String(x.id) === String(id)) || null;
  const post = t(3);
  return {
    year: Number(year),
    postseason: post ? { start: str(post.startDate), end: str(post.endDate) } : null,
    types: (s?.types || []).map((x) => ({ id: Number(x.id), name: str(x.name), start: str(x.startDate), end: str(x.endDate) }))
  };
}

const PHASE = { 1: 'PRESEASON', 2: 'REGULAR_SEASON', 3: 'POSTSEASON', 4: 'OFFSEASON' };

export function phaseAt(window, now = Date.now()) {
  for (const t of window?.types || []) if (now >= Date.parse(t.start) && now < Date.parse(t.end)) return PHASE[t.id] || null;
  return null;
}

const compact = (iso) => String(iso || '').slice(0, 10).replaceAll('-', '');

/**
 * Postseason game days to fetch: the scoreboard calendar's whitelisted days inside the postseason window.
 * Falls back to every day of the window when the calendar is absent.
 */
export function postseasonDays(scoreboardBody, window, { maxDays = 60 } = {}) {
  if (!window?.postseason?.start || !window?.postseason?.end) return [];
  // Calendar entries are day starts (07:00Z); the window bounds are the same day starts, so no slack is needed.
  const from = Date.parse(window.postseason.start);
  const to = Date.parse(window.postseason.end);
  const cal = scoreboardBody?.leagues?.[0]?.calendar;
  let days = [];
  if (Array.isArray(cal) && cal.length && typeof cal[0] === 'string') {
    days = cal.filter((d) => { const t = Date.parse(d); return t >= from && t <= to; }).map(compact);
  } else {
    for (let t = Date.parse(window.postseason.start); t <= Date.parse(window.postseason.end); t += 86400e3) days.push(compact(new Date(t).toISOString()));
  }
  return [...new Set(days)].sort().slice(0, maxDays);
}

/** Full WNBA build: raw ESPN postseason events + league standings -> validated contract snapshot. */
export function buildWnbaPlayoffs({ season, events, standingsBody, capturedAt, now = Date.now(), logoFor = null, provenance = {} }) {
  const window = seasonWindow(standingsBody, season);
  const standingsSeason = Number(standingsBody?.standings?.season);
  const seeds = standingsSeason === Number(season) ? seedsFromLeagueStandings(standingsBody, { logoFor }) : [];
  const games = events.filter((e) => Number(e?.season?.type) === 3).map((e) => normalizePostseasonEvent(e, { logoFor }));
  const result = buildPlayoffs({
    sport: 'basketball',
    league: 'WNBA',
    season: Number(season),
    rounds: WNBA_ROUNDS,
    games,
    seeds,
    phase: phaseAt(window, now),
    capturedAt,
    source: WNBA_PLAYOFFS_SOURCE,
    provenance: {
      postseason_window: window.postseason,
      seeds_source: seeds.length ? 'espn_league_standings_level1' : null,
      source_event_count: events.length,
      ...provenance
    }
  });
  if (standingsSeason !== Number(season)) result.warnings.push(`standings_season_mismatch:${standingsSeason}`);
  if (!seeds.length) result.warnings.push('seeds_unavailable');
  return result;
}
