// WNBA Player DNA V1 (wnba-player-dna/1.0.0). Spec: docs/WNBA_PLAYER_DNA_V1.md.
//
// An explainable VECTOR of 0-100 percentile dimensions per player and scope. There is no
// overall DNA score. Pattern mirrors NBA Player DNA V1 (nba-propbetedge, player-dna/1.0.0);
// the code is adapted, never imported, and no NBA number is reused as a WNBA input.
//
// Pure and deterministic: no clock, no randomness, no I/O. Same inputs -> byte-identical
// output. The only data read is the PropBetEdge final-game archive documents
// (KV `game:v1:final:<id>`, the same documents WinBA reads), restricted to games that
// tipped strictly before `asOf`.
//
// Explicitly NOT inputs (proved by tests/player-dna.test.mjs):
//   - Player Load (workers/shared/player-load.js) and anything derived from it
//   - injuries / availability feeds, `summary.injuries`, DNP reasons
//   - the stored WinBA board (`winba:v1:latest`): WinBA is recomputed with the frozen
//     canonical function from the same filtered archive documents at `asOf`
//   - odds, props, PBE picks, roster/bio snapshots, position

import { buildWinbaSnapshotAsOf, winbaForPlayer, WINBA_VERSION } from './winba.js';

export const PLAYER_DNA_VERSION = 'wnba-player-dna/1.0.0';
export const PLAYER_DNA_CONTRACT = 'wnba_player_dna.v1';
export const PLAYER_DNA_SOURCE = 'PropBetEdge archive of final WNBA box scores (source: ESPN), KV game:v1:final:<game_id>';

export const SCOPES = Object.freeze(['season', 'career', 'playoffs', 'last5', 'last10', 'last15', 'home', 'away', 'clutch']);

// WNBA gates. A regular season is 44 games of 40 minutes; gates are sized for that, not copied.
export const QUALIFICATION = Object.freeze({
  season: Object.freeze({ games: 10, minutes: 200, reference_minutes: 1000 }),
  career: Object.freeze({ games: 40, minutes: 800, reference_minutes: 3000 }),
  playoffs: Object.freeze({ games: 4, minutes: 80, reference_minutes: 200 }),
  last5: Object.freeze({ games: 5, minutes: 40, reference_minutes: 125 }),
  last10: Object.freeze({ games: 10, minutes: 80, reference_minutes: 250 }),
  last15: Object.freeze({ games: 15, minutes: 120, reference_minutes: 375 }),
  home: Object.freeze({ games: 6, minutes: 120, reference_minutes: 500 }),
  away: Object.freeze({ games: 6, minutes: 120, reference_minutes: 500 })
});
export const LAST_N = Object.freeze([5, 10, 15]);
export const MOVEMENT_WINDOW = 'last10';
export const LOW_POPULATION = 20;
export const LOW_POPULATION_CONFIDENCE_CAP = 0.45;
export const PROXY_CONFIDENCE_FACTOR = 0.75;
export const CONFIDENCE_LABELS = Object.freeze({ HIGH: 0.8, MEDIUM: 0.55 });
export const REGULATION_PERIODS = 4;
export const TEAM_MINUTES_REGULATION = 200; // 5 players x 40 minutes
export const TEAM_MINUTES_PER_OT = 25; // 5 players x 5 minutes
export const PLAYOFF_TRANSLATION_GATE = Object.freeze({ games: 4, minutes: 80 });
export const FORM_GATE = Object.freeze({ scope_games: 20, window: 10 });
export const MATCHUP_GATE = Object.freeze({ games: 6, minutes: 120, prior_games: 10, opponent_win_rate: 0.5 });
export const VOLATILITY_GATE = Object.freeze({ game_min_minutes: 10, games: 10 });
export const ROLE_THRESHOLDS = Object.freeze({ starter_rate: 0.6, rotation_mpg: 12.5, bench_mpg: 6.5 });

const SEASON_TYPE = Object.freeze({ 1: 'preseason', 2: 'regular', 3: 'postseason' });

/**
 * Dimensions. components: [key, direction] (+1 higher value = higher score, -1 inverted).
 * descriptive: never a strength or weakness. nba_key: the NBA Player DNA key this maps to
 * when the WNBA key is deliberately named differently (the NBA label overclaims).
 */
export const DIMENSIONS = Object.freeze([
  { key: 'scoring', label: 'Scoring', status: 'LIVE', components: [['pts_per36', 1], ['pts_per_game', 1]], desc: 'Points per 36 minutes and per game' },
  { key: 'creation', label: 'Creation', status: 'PROXY', proxy_reason: 'No unassisted-shot or pull-up data; usage rate and assists stand in for creation', components: [['usage_pct', 1], ['ast_per36', 1]], desc: 'Usage rate and assists per 36' },
  { key: 'efficiency', label: 'Efficiency', status: 'LIVE', components: [['ts_pct', 1], ['efg_pct', 1]], desc: 'True shooting and effective field goal percentage' },
  { key: 'shooting_profile', label: 'Shooting profile', status: 'PROXY', proxy_reason: 'No shot-location data; three-point volume and shooting percentages only', components: [['fg3a_per36', 1], ['fg3_pct', 1], ['ft_pct', 1]], desc: '3PA per 36, 3P%, FT%' },
  { key: 'ft_pressure', nba_key: 'rim_pressure', label: 'Free-throw pressure', status: 'PROXY', proxy_reason: 'Foul-drawing and two-point volume only. This is NOT rim pressure: no player paint, rim-attempt or shot-location data is stored', components: [['fta_per36', 1], ['ft_rate', 1], ['fg2a_per36', 1]], desc: 'FTA per 36, free-throw rate, 2PA per 36' },
  { key: 'playmaking', label: 'Playmaking', status: 'LIVE', components: [['ast_pct', 1], ['ast_per36', 1]], desc: 'Assist percentage and assists per 36' },
  { key: 'ball_security', label: 'Ball security', status: 'LIVE', components: [['tov_pct', -1]], desc: 'Turnover percentage (lower is better)' },
  { key: 'rebounding', label: 'Rebounding', status: 'LIVE', components: [['orb_pct', 1], ['drb_pct', 1]], desc: 'Offensive and defensive rebound percentage' },
  { key: 'defensive_activity', nba_key: 'defensive_impact', label: 'Defensive activity', status: 'PROXY', proxy_reason: 'Box-score events only (steals, blocks, fouls). No matchup, on/off or tracking data; this measures activity, not defensive impact', components: [['stl_per36', 1], ['blk_per36', 1], ['pf_per36', -1]], desc: 'Steals and blocks per 36, fouls per 36 (inverted)' },
  { key: 'pressure_clutch', label: 'Pressure / clutch', status: 'UNAVAILABLE', reason: 'CLUTCH_NOT_BUILT', components: [], desc: 'Play-by-play is archived, but per-player clutch attribution is not built or validated in V1' },
  { key: 'playoff_translation', label: 'Playoff translation', status: 'LIVE', components: [['playoff_gmsc36_delta', 1], ['playoff_ts_delta', 1]], desc: 'Game Score per 36 and TS% in archived postseason games minus archived regular season' },
  { key: 'role', label: 'Role', status: 'LIVE', descriptive: true, components: [['mpg', 1]], desc: 'Minutes per game (bigger role, not better)' },
  { key: 'durability', label: 'Availability', status: 'LIVE', components: [['availability', 1]], desc: 'Games played / archived team games between first and last appearance for that team. Box-score appearances only; no injury data' },
  { key: 'form', label: 'Form', status: 'LIVE', descriptive: true, components: [['form_gmsc36_delta', 1]], desc: 'Last 10 games of the scope minus the whole scope (Game Score per 36)' },
  { key: 'matchup_adaptability', label: 'Matchup adaptability', status: 'PROXY', proxy_reason: 'Team-level opponent strength only (opponent record before the game); no individual matchup data', components: [['vs_winning_gmsc36_delta', 1]], desc: 'Game Score per 36 vs .500+ opponents minus overall' },
  { key: 'volatility', label: 'Volatility', status: 'LIVE', descriptive: true, components: [['gmsc_sd', 1]], desc: 'Game-to-game spread of Game Score (higher = more volatile, not better)' },
  { key: 'winba', label: 'WinBA', status: 'LIVE', components: [], desc: `Canonical ${WINBA_VERSION} score, consumed unchanged (season scope only)` }
]);

export const DESCRIPTIVE_DIMENSIONS = Object.freeze(DIMENSIONS.filter((d) => d.descriptive).map((d) => d.key));

export const DIMENSION_DEFINITIONS = Object.freeze(DIMENSIONS.map((d) => Object.freeze({
  key: d.key,
  nba_key: d.nba_key ?? d.key,
  label: d.label,
  status: d.status,
  proxy: d.status === 'PROXY',
  proxy_reason: d.proxy_reason ?? null,
  reason: d.reason ?? null,
  descriptive: !!d.descriptive,
  components: d.components.map(([k, dir]) => ({ key: k, inverted: dir < 0 })),
  desc: d.desc
})));

// ------------------------------------------------------------------ helpers

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const z = (v) => num(v) ?? 0;
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const div = (a, b) => (b > 0 ? a / b : null);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function madeAtt(v) {
  const m = String(v ?? '').match(/^(\d+)-(\d+)$/);
  return m ? { made: Number(m[1]), att: Number(m[2]) } : { made: null, att: null };
}

/** Mid-rank percentile in [0,1] (same tie rule as winba/1.0.0): ties share the average rank. */
export function percentile(value, sortedValues) {
  if (!Number.isFinite(value) || !sortedValues.length) return null;
  if (sortedValues.length === 1) return 1;
  let less = 0;
  let equal = 0;
  for (const x of sortedValues) {
    if (x < value) less += 1;
    else if (x === value) equal += 1;
  }
  return Math.max(0, Math.min(1, (less + Math.max(0, equal - 1) / 2) / (sortedValues.length - 1)));
}

export const confidenceLabel = (c) => (c == null ? null : c >= CONFIDENCE_LABELS.HIGH ? 'HIGH' : c >= CONFIDENCE_LABELS.MEDIUM ? 'MEDIUM' : 'LOW');

/** Hollinger Game Score. Used for form, volatility, matchup and playoff deltas (not for WinBA). */
export function gameScore(l) {
  return z(l.pts) + 0.4 * z(l.fgm) - 0.7 * z(l.fga) - 0.4 * (z(l.fta) - z(l.ftm)) + 0.7 * z(l.oreb) + 0.3 * z(l.dreb)
    + z(l.stl) + 0.7 * z(l.ast) + 0.7 * z(l.blk) - 0.4 * z(l.pf) - z(l.tov);
}

export const teamMinutes = (periods) => TEAM_MINUTES_REGULATION + TEAM_MINUTES_PER_OT * Math.max(0, (Number(periods) || REGULATION_PERIODS) - REGULATION_PERIODS);

/** Team box line from the archived `box.teams[].stats` display strings. Null fields when unparseable. */
export function teamLineFromStats(stats = {}) {
  const fg = madeAtt(stats['fieldGoalsMade-fieldGoalsAttempted']);
  const ft = madeAtt(stats['freeThrowsMade-freeThrowsAttempted']);
  return {
    fgm: fg.made,
    fga: fg.att,
    ftm: ft.made,
    fta: ft.att,
    tov: num(stats.totalTurnovers) ?? num(stats.turnovers),
    oreb: num(stats.offensiveRebounds),
    dreb: num(stats.defensiveRebounds)
  };
}

const teamLineComplete = (t) => !!t && ['fgm', 'fga', 'fta', 'tov', 'oreb', 'dreb'].every((k) => Number.isFinite(t[k]));

// Small deterministic hash (FNV-1a 32-bit) for provenance. Not a security primitive.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ game selection

/**
 * Select the archive documents DNA may read at `asOf`.
 *
 * A game is used only when ALL hold:
 *   - it is completed and tipped strictly before asOf (leakage rule);
 *   - ESPN season type is 2 (regular) or 3 (postseason); preseason and exhibitions are out;
 *   - BOTH teams are in `franchiseTeamIds` (drops the All-Star Game, which ESPN tags as
 *     regular season with TEAM COOP / TEAM SPOON ids, and any international exhibition);
 *   - its id is not in `excludeGameIds` (explicit owner-decided exclusions, e.g. a cup final).
 */
export function selectDnaGames(docs = [], { asOf, franchiseTeamIds, excludeGameIds = [] } = {}) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('player-dna: asOf must be a parseable instant');
  const franchises = new Set((franchiseTeamIds || []).map(String));
  if (!franchises.size) throw new Error('player-dna: franchiseTeamIds is required (fail closed: non-team fixtures cannot be excluded without it)');
  const excludeIds = new Set((excludeGameIds || []).map(String));
  const excluded = { malformed: 0, after_as_of: 0, not_completed: 0, preseason_or_other: 0, non_franchise: 0, excluded_by_id: 0, duplicate: 0 };
  const excludedGames = { non_franchise: [], excluded_by_id: [] };
  // Stable order independent of input order: by game id, then archived_at, then checksum.
  const ordered = [...(docs || [])].filter(Boolean).sort((a, b) =>
    cmp(String(a?.summary?.game?.game_id ?? ''), String(b?.summary?.game?.game_id ?? ''))
    || cmp(String(a?.archived_at ?? ''), String(b?.archived_at ?? ''))
    || cmp(String(a?.checksum ?? ''), String(b?.checksum ?? '')));
  const seen = new Set();
  const selected = [];
  for (const doc of ordered) {
    const s = doc?.summary;
    const g = s?.game;
    const id = g?.game_id != null ? String(g.game_id) : null;
    const tipMs = Date.parse(g?.start_utc || '');
    if (!id || !Number.isFinite(tipMs) || !g?.home?.team_id || !g?.away?.team_id) { excluded.malformed += 1; continue; }
    if (seen.has(id)) { excluded.duplicate += 1; continue; }
    seen.add(id);
    if (!(tipMs < cutoff)) { excluded.after_as_of += 1; continue; }
    if (!g.status?.completed) { excluded.not_completed += 1; continue; }
    const seasonType = SEASON_TYPE[Number(g.season?.type)];
    if (seasonType !== 'regular' && seasonType !== 'postseason') { excluded.preseason_or_other += 1; continue; }
    if (!franchises.has(String(g.home.team_id)) || !franchises.has(String(g.away.team_id))) {
      excluded.non_franchise += 1;
      excludedGames.non_franchise.push(id);
      continue;
    }
    if (excludeIds.has(id)) { excluded.excluded_by_id += 1; excludedGames.excluded_by_id.push(id); continue; }
    selected.push(doc);
  }
  const games = selected.map((doc) => {
    const s = doc.summary;
    const g = s.game;
    const periods = Math.max(g.home?.linescores?.length || 0, g.away?.linescores?.length || 0) || REGULATION_PERIODS;
    const teams = new Map();
    for (const t of s.box?.teams || []) if (t?.team_id != null) teams.set(String(t.team_id), teamLineFromStats(t.stats));
    const hs = num(g.home.score);
    const as = num(g.away.score);
    return {
      doc,
      game_id: String(g.game_id),
      tip_ms: Date.parse(g.start_utc),
      tip_at: new Date(Date.parse(g.start_utc)).toISOString(),
      date: new Date(Date.parse(g.start_utc)).toISOString().slice(0, 10),
      season: Number(g.season?.year),
      season_type: SEASON_TYPE[Number(g.season?.type)],
      home_id: String(g.home.team_id),
      away_id: String(g.away.team_id),
      winner_id: hs != null && as != null && hs !== as ? (hs > as ? String(g.home.team_id) : String(g.away.team_id)) : null,
      team_minutes: teamMinutes(periods),
      teams,
      players: s.box?.players || []
    };
  }).sort((a, b) => a.tip_ms - b.tip_ms || cmp(a.game_id, b.game_id));
  return { games, excluded, excluded_games: excludedGames, as_of: new Date(cutoff).toISOString() };
}

// ------------------------------------------------------------------ totals

export const TOTAL_KEYS = Object.freeze([
  'games', 'starts', 'wins', 'min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf',
  'ctx_games', 'c_min', 'c_fgm', 'c_fga', 'c_fta', 'c_tov', 'c_ast', 'c_oreb', 'c_dreb',
  'tm_min', 'tm_fgm', 'tm_fga', 'tm_fta', 'tm_tov', 'tm_oreb', 'tm_dreb', 'opp_oreb', 'opp_dreb',
  'gmsc',
  'vol_n', 'vol_sum', 'vol_sumsq',
  'vw_games', 'vw_min', 'vw_gmsc',
  'tenure_team_games',
  'excluded_no_minutes'
]);

export function emptyTotals() {
  const t = {};
  for (const k of TOTAL_KEYS) t[k] = 0;
  t.first_date = null;
  t.last_date = null;
  return t;
}

export function mergeTotals(...parts) {
  const out = emptyTotals();
  for (const p of parts) {
    if (!p) continue;
    for (const k of TOTAL_KEYS) out[k] += p[k] || 0;
    if (p.first_date && (!out.first_date || p.first_date < out.first_date)) out.first_date = p.first_date;
    if (p.last_date && (!out.last_date || p.last_date > out.last_date)) out.last_date = p.last_date;
  }
  return out;
}

/** Opponent regular-season win rate before each game's tip (same season, >= prior_games), from selected games only. */
function opponentStrength(games) {
  const byTeam = new Map();
  for (const g of games) {
    if (g.season_type !== 'regular') continue;
    for (const id of [g.home_id, g.away_id]) {
      const key = `${g.season}|${id}`;
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push({ game_id: g.game_id, tip_ms: g.tip_ms, won: g.winner_id == null ? null : g.winner_id === id });
    }
  }
  const prior = (season, teamId, tip) => {
    let w = 0;
    let gp = 0;
    for (const r of byTeam.get(`${season}|${teamId}`) || []) {
      if (r.tip_ms >= tip) break;
      if (r.won != null) { gp += 1; if (r.won) w += 1; }
    }
    return gp >= MATCHUP_GATE.prior_games ? w / gp : null;
  };
  const out = new Map();
  for (const g of games) {
    out.set(`${g.game_id}|${g.home_id}`, prior(g.season, g.away_id, g.tip_ms));
    out.set(`${g.game_id}|${g.away_id}`, prior(g.season, g.home_id, g.tip_ms));
  }
  return { byTeam, out };
}

/** Totals for one box row; null for DNP / zero-minute / wrong-team rows; exclusion marker for played rows with no minutes. */
export function lineTotals(row, g, oppStrength) {
  if (!row?.athlete_id || row.dnp) return null;
  const teamId = String(row.team_id ?? '');
  if (teamId !== g.home_id && teamId !== g.away_id) return null;
  const t = emptyTotals();
  if (row.min == null) { t.excluded_no_minutes = 1; return t; }
  if (!(Number(row.min) > 0)) return null;
  const oppId = teamId === g.home_id ? g.away_id : g.home_id;
  const team = g.teams.get(teamId);
  const opp = g.teams.get(oppId);
  const gs = gameScore(row);
  t.games = 1;
  t.starts = row.starter === true ? 1 : 0;
  t.wins = g.winner_id === teamId ? 1 : 0;
  for (const k of ['min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf']) t[k] = z(row[k]);
  if (teamLineComplete(team) && teamLineComplete(opp)) {
    t.ctx_games = 1;
    t.c_min = z(row.min); t.c_fgm = z(row.fgm); t.c_fga = z(row.fga); t.c_fta = z(row.fta); t.c_tov = z(row.tov); t.c_ast = z(row.ast); t.c_oreb = z(row.oreb); t.c_dreb = z(row.dreb);
    t.tm_min = g.team_minutes;
    t.tm_fgm = team.fgm; t.tm_fga = team.fga; t.tm_fta = team.fta; t.tm_tov = team.tov; t.tm_oreb = team.oreb; t.tm_dreb = team.dreb;
    t.opp_oreb = opp.oreb; t.opp_dreb = opp.dreb;
  }
  t.gmsc = gs;
  if (z(row.min) >= VOLATILITY_GATE.game_min_minutes) { t.vol_n = 1; t.vol_sum = gs; t.vol_sumsq = gs * gs; }
  const os = oppStrength.get(`${g.game_id}|${teamId}`);
  if (os != null && os >= MATCHUP_GATE.opponent_win_rate) { t.vw_games = 1; t.vw_min = z(row.min); t.vw_gmsc = gs; }
  t.first_date = g.date;
  t.last_date = g.date;
  return t;
}

/** Per player: chronological records and season buckets (regular / postseason / home / away). */
export function aggregatePlayers(games) {
  const { byTeam, out: oppStrength } = opponentStrength(games);
  const players = new Map();
  const get = (id) => {
    if (!players.has(id)) players.set(id, { records: [], seasons: new Map(), apps: new Map(), name: null, team_id: null, last_tip: -Infinity });
    return players.get(id);
  };
  const bucketsFor = (p, season) => {
    if (!p.seasons.has(season)) p.seasons.set(season, { regular: emptyTotals(), postseason: emptyTotals(), home: emptyTotals(), away: emptyTotals() });
    return p.seasons.get(season);
  };
  for (const g of games) {
    const rows = [...g.players].sort((a, b) => cmp(String(a?.athlete_id ?? ''), String(b?.athlete_id ?? '')));
    for (const row of rows) {
      const t = lineTotals(row, g, oppStrength);
      if (!t) continue;
      const id = String(row.athlete_id);
      const p = get(id);
      const b = bucketsFor(p, g.season);
      b[g.season_type] = mergeTotals(b[g.season_type], t);
      if (!t.games) continue;
      p.records.push({ game_id: g.game_id, tip_ms: g.tip_ms, season: g.season, season_type: g.season_type, totals: t });
      if (g.tip_ms >= p.last_tip) { p.last_tip = g.tip_ms; p.team_id = String(row.team_id); p.name = row.name ?? p.name; }
      if (g.season_type === 'regular') {
        const side = String(row.team_id) === g.home_id ? 'home' : 'away';
        b[side] = mergeTotals(b[side], t);
        const key = `${g.season}|${row.team_id}`;
        const a = p.apps.get(key) || { first: g.tip_ms, last: g.tip_ms };
        if (g.tip_ms < a.first) a.first = g.tip_ms;
        if (g.tip_ms > a.last) a.last = g.tip_ms;
        p.apps.set(key, a);
      }
    }
  }
  // availability tenure: the team's archived regular-season games between first and last appearance, per team-season
  for (const p of players.values()) {
    const perSeason = new Map();
    for (const [key, a] of p.apps) {
      const season = Number(key.split('|')[0]);
      let n = 0;
      for (const r of byTeam.get(key) || []) if (r.tip_ms >= a.first && r.tip_ms <= a.last) n += 1;
      perSeason.set(season, (perSeason.get(season) || 0) + n);
    }
    for (const [season, n] of perSeason) p.seasons.get(season).regular.tenure_team_games = n;
    delete p.apps;
  }
  return players;
}

// ------------------------------------------------------------------ metrics

const per36 = (x, t) => (t.min > 0 ? (x / t.min) * 36 : null);
const gs36 = (t) => per36(t.gmsc, t);

/** Raw metrics for one Totals object; null when a metric's own gate fails (never 0 for missing). */
export function metrics(t) {
  const g = t.games;
  const tsa = t.fga + 0.44 * t.fta;
  const usgDen = t.c_min * (t.tm_fga + 0.44 * t.tm_fta + t.tm_tov);
  const usage = t.ctx_games > 0 && usgDen > 0 ? (100 * (t.c_fga + 0.44 * t.c_fta + t.c_tov) * (t.tm_min / 5)) / usgDen : null;
  const astDen = t.ctx_games > 0 && t.tm_min > 0 ? (t.c_min / (t.tm_min / 5)) * t.tm_fgm - t.c_fgm : 0;
  const orbDen = t.c_min * (t.tm_oreb + t.opp_dreb);
  const drbDen = t.c_min * (t.tm_dreb + t.opp_oreb);
  const volMean = t.vol_n > 0 ? t.vol_sum / t.vol_n : null;
  return {
    games: g,
    minutes: t.min,
    pts_per36: per36(t.pts, t),
    pts_per_game: div(t.pts, g),
    usage_pct: usage,
    ast_per36: per36(t.ast, t),
    ts_pct: g > 0 && tsa / g >= 4 && tsa > 0 ? t.pts / (2 * tsa) : null,
    efg_pct: g > 0 && tsa / g >= 4 && t.fga > 0 ? (t.fgm + 0.5 * t.fg3m) / t.fga : null,
    fg3a_per36: per36(t.fg3a, t),
    fg3_pct: g > 0 && t.fg3a / g >= 1 && t.fg3a >= 20 ? t.fg3m / t.fg3a : null,
    ft_pct: t.fta >= 15 ? t.ftm / t.fta : null,
    fta_per36: per36(t.fta, t),
    ft_rate: t.fga >= 40 ? t.fta / t.fga : null,
    fg2a_per36: per36(t.fga - t.fg3a, t),
    ast_pct: astDen > 0 ? (100 * t.c_ast) / astDen : null,
    tov_pct: usage != null && usage >= 12 && tsa + t.tov > 0 ? (100 * t.tov) / (tsa + t.tov) : null,
    orb_pct: t.ctx_games > 0 && orbDen > 0 ? (100 * t.c_oreb * (t.tm_min / 5)) / orbDen : null,
    drb_pct: t.ctx_games > 0 && drbDen > 0 ? (100 * t.c_dreb * (t.tm_min / 5)) / drbDen : null,
    stl_per36: per36(t.stl, t),
    blk_per36: per36(t.blk, t),
    pf_per36: per36(t.pf, t),
    mpg: div(t.min, g),
    start_rate: div(t.starts, g),
    availability: t.tenure_team_games > 0 ? Math.min(1, g / t.tenure_team_games) : null,
    gmsc_per36: gs36(t),
    vs_winning_gmsc36_delta: t.vw_games >= MATCHUP_GATE.games && t.vw_min >= MATCHUP_GATE.minutes && t.min > 0
      ? (t.vw_gmsc / t.vw_min) * 36 - (t.gmsc / t.min) * 36 : null,
    gmsc_sd: t.vol_n >= VOLATILITY_GATE.games ? Math.sqrt(Math.max(0, t.vol_sumsq / t.vol_n - volMean * volMean)) : null
  };
}

const RATE3_KEYS = new Set(['ts_pct', 'efg_pct', 'fg3_pct', 'ft_pct', 'ft_rate', 'availability', 'start_rate', 'playoff_ts_delta']);
const roundMetric = (k, v) => (RATE3_KEYS.has(k) ? r3(v) : r1(v));

function roleCategory(m) {
  if (m.start_rate != null && m.start_rate >= ROLE_THRESHOLDS.starter_rate) return 'STARTER';
  if (m.mpg != null && m.mpg >= ROLE_THRESHOLDS.rotation_mpg) return 'ROTATION';
  if (m.mpg != null && m.mpg >= ROLE_THRESHOLDS.bench_mpg) return 'BENCH';
  return 'FRINGE';
}

/** Which dimensions a scope can carry. */
export function dimensionInScope(key, scope) {
  if (key === 'durability' || key === 'matchup_adaptability' || key === 'form') return scope === 'season' || scope === 'career';
  if (key === 'winba') return scope === 'season';
  return true;
}

const NOT_TRAITS = new Set(DESCRIPTIVE_DIMENSIONS);
export function traits(dims) {
  const eligible = Object.entries(dims)
    .filter(([k, d]) => !NOT_TRAITS.has(k) && d.score != null && (d.status === 'LIVE' || d.status === 'PROXY') && d.confidence >= CONFIDENCE_LABELS.MEDIUM)
    .sort((a, b) => b[1].score - a[1].score || cmp(a[0], b[0]));
  return {
    strongest: eligible.slice(0, 3).map(([k]) => k),
    // weakest never repeats a strongest trait (NBA player-dna/1.0.0 can overlap with 4-5 eligible)
    weakest: eligible.slice(Math.max(3, eligible.length - 2)).reverse().map(([k]) => k),
    basis: `LIVE and PROXY dimensions with confidence >= MEDIUM, excluding ${[...NOT_TRAITS].join(', ')}`
  };
}

/**
 * Score one scope for a population.
 * entries: [{ id, totals, extra }]; winbaRows: Map id -> canonical WinBA row (season scope only).
 */
export function scoreScope(entries, scope, { winbaRows = null } = {}) {
  const q = QUALIFICATION[scope];
  const rows = entries.map((e) => ({
    id: e.id,
    totals: e.totals,
    m: { ...metrics(e.totals), ...(e.extra || {}) },
    qualified: e.totals.games >= q.games && e.totals.min >= q.minutes
  })).sort((a, b) => cmp(a.id, b.id));
  const pop = rows.filter((r) => r.qualified);
  const lowPop = pop.length < LOW_POPULATION;
  const lists = new Map();
  const listFor = (key, dir) => {
    const k = `${key}|${dir}`;
    if (!lists.has(k)) lists.set(k, pop.map((r) => r.m[key]).filter(Number.isFinite).map((v) => dir * v).sort((a, b) => a - b));
    return lists.get(k);
  };
  const out = new Map();
  for (const r of rows) {
    const sample = { games: r.totals.games, minutes: r.totals.min, starts: r.totals.starts, first_date: r.totals.first_date, last_date: r.totals.last_date, excluded_no_minutes: r.totals.excluded_no_minutes };
    if (!r.qualified) {
      out.set(r.id, { calculated: false, scope, reason: 'INSUFFICIENT_SAMPLE', sample, qualification: { games: q.games, minutes: q.minutes } });
      continue;
    }
    const sampleConf = Math.sqrt(Math.min(1, r.totals.min / q.reference_minutes));
    const capped = (c) => (lowPop ? Math.min(c, LOW_POPULATION_CONFIDENCE_CAP) : c);
    const dims = {};
    for (const d of DIMENSIONS) {
      if (!dimensionInScope(d.key, scope)) { dims[d.key] = { score: null, status: 'NOT_IN_SCOPE', label: d.label }; continue; }
      if (d.status === 'UNAVAILABLE') { dims[d.key] = { score: null, status: 'UNAVAILABLE', reason: d.reason, label: d.label }; continue; }
      if (d.key === 'winba') {
        const w = winbaRows?.get(r.id) || null;
        if (!w || !Number.isFinite(w.score)) { dims.winba = { score: null, status: 'INSUFFICIENT_DATA', label: d.label, version: WINBA_VERSION }; continue; }
        const c = capped(sampleConf);
        dims.winba = {
          score: Math.round(w.score),
          value: w.score,
          status: 'LIVE',
          proxy: false,
          label: d.label,
          confidence: r2(c),
          confidence_label: confidenceLabel(c),
          version: w.version,
          winba_status: w.status,
          rank: w.rank,
          components: Object.entries(w.components).map(([key, value]) => ({ key, value })),
          sample: w.sample
        };
        continue;
      }
      const comps = d.components.map(([key, dir]) => {
        const v = r.m[key];
        const p = Number.isFinite(v) ? percentile(dir * v, listFor(key, dir)) : null;
        const c = { key, value: Number.isFinite(v) ? roundMetric(key, v) : null, percentile: p == null ? null : Math.round(p * 100) };
        if (dir < 0) c.inverted = true;
        return c;
      });
      const present = comps.filter((c) => c.percentile != null);
      if (!present.length) {
        const dim = { score: null, status: 'INSUFFICIENT_DATA', proxy: d.status === 'PROXY', label: d.label, components: comps };
        if (d.status === 'PROXY') dim.proxy_reason = d.proxy_reason;
        dims[d.key] = dim;
        continue;
      }
      const score = Math.round(present.reduce((s, c) => s + c.percentile, 0) / present.length);
      const conf = capped(sampleConf * (d.status === 'PROXY' ? PROXY_CONFIDENCE_FACTOR : 1) * (present.length / comps.length));
      const dim = { score, status: d.status, proxy: d.status === 'PROXY', label: d.label, confidence: r2(conf), confidence_label: confidenceLabel(conf), components: comps };
      if (d.status === 'PROXY') dim.proxy_reason = d.proxy_reason;
      if (d.descriptive) dim.descriptive = true;
      if (d.key === 'role') { dim.category = roleCategory(r.m); dim.start_rate = r3(r.m.start_rate); }
      dims[d.key] = dim;
    }
    out.set(r.id, {
      calculated: true,
      scope,
      sample,
      flags: lowPop ? ['LOW_POPULATION'] : [],
      population: { n: pop.length, qualification: { games: q.games, minutes: q.minutes } },
      dimensions: dims,
      traits: traits(dims)
    });
  }
  return out;
}

// ------------------------------------------------------------------ build

function linesHash(games) {
  const parts = [];
  for (const g of games) {
    const rows = [...g.players].filter((r) => r?.athlete_id).sort((a, b) => cmp(String(a.athlete_id), String(b.athlete_id)));
    parts.push(`${g.game_id}:${g.home_id}-${g.away_id}:${g.winner_id}:` + rows.map((r) => [r.athlete_id, r.team_id, r.dnp ? 1 : 0, r.starter ? 1 : 0, r.min, r.pts, r.fgm, r.fga, r.fg3m, r.fg3a, r.ftm, r.fta, r.oreb, r.dreb, r.ast, r.stl, r.blk, r.tov, r.pf].join(',')).join(';'));
  }
  return fnv1a(parts.join('|'));
}

/**
 * Build Player DNA for every player who appeared in season S at `asOf`.
 *
 * @param docs            archive documents `{ archived_at, checksum, summary }` (KV game:v1:final:<id>)
 * @param asOf            ISO instant; only games with tip < asOf are read (exclusive)
 * @param franchiseTeamIds WNBA franchise team ids (required; e.g. ref:v1:athletes.teams)
 * @param excludeGameIds  explicit game ids to drop (recorded in provenance)
 * @param season          season S; default = latest season with a selected game before asOf
 */
export function buildPlayerDna(docs = [], { asOf, franchiseTeamIds, excludeGameIds = [], season = null } = {}) {
  const sel = selectDnaGames(docs, { asOf, franchiseTeamIds, excludeGameIds });
  const games = sel.games;
  const seasonsInWindow = [...new Set(games.map((g) => g.season))].filter(Number.isFinite).sort((a, b) => a - b);
  const S = season != null ? Number(season) : (seasonsInWindow.length ? seasonsInWindow.at(-1) : null);
  const base = {
    contract: PLAYER_DNA_CONTRACT,
    version: PLAYER_DNA_VERSION,
    as_of: sel.as_of,
    season: S,
    coverage: {
      seasons: seasonsInWindow,
      coverage_from: seasonsInWindow[0] ?? null,
      regular_games: games.filter((g) => g.season_type === 'regular').length,
      postseason_games: games.filter((g) => g.season_type === 'postseason').length
    },
    provenance: {
      source: PLAYER_DNA_SOURCE,
      kv_keys: ['archive:v1:index', 'game:v1:final:<game_id>'],
      docs_considered: (docs || []).length,
      games_used: games.length,
      excluded: sel.excluded,
      excluded_games: sel.excluded_games,
      franchise_team_ids: [...new Set((franchiseTeamIds || []).map(String))].sort(),
      lines_hash: linesHash(games),
      not_inputs: ['player_load', 'injuries', 'availability_feed', 'dnp_reason', 'winba_stored_board', 'odds', 'props', 'position', 'roster_bio']
    },
    versions: { player_dna: PLAYER_DNA_VERSION, winba: WINBA_VERSION },
    dimension_definitions: DIMENSION_DEFINITIONS,
    players: {}
  };
  if (S == null) return base;

  const players = aggregatePlayers(games.filter((g) => g.season <= S));
  const ids = [...players.keys()].filter((id) => {
    const b = players.get(id).seasons.get(S);
    return b && (b.regular.games + b.postseason.games + b.regular.excluded_no_minutes + b.postseason.excluded_no_minutes) > 0;
  }).sort(cmp);
  const priorCoverage = seasonsInWindow.some((s) => s < S);

  const regularOf = (p, s) => p.seasons.get(s)?.regular;
  const careerReg = new Map();
  const careerPost = new Map();
  for (const id of ids) {
    const p = players.get(id);
    const seasons = [...p.seasons.keys()].filter((s) => s <= S);
    careerReg.set(id, mergeTotals(...seasons.map((s) => regularOf(p, s))));
    careerPost.set(id, mergeTotals(...seasons.map((s) => p.seasons.get(s).postseason)));
  }
  const po = new Map();
  for (const id of ids) {
    const reg = careerReg.get(id);
    const post = careerPost.get(id);
    if (post.games >= PLAYOFF_TRANSLATION_GATE.games && post.min >= PLAYOFF_TRANSLATION_GATE.minutes && reg.min > 0) {
      const mr = metrics(reg);
      const mp = metrics(post);
      po.set(id, { playoff_gmsc36_delta: gs36(post) - gs36(reg), playoff_ts_delta: mr.ts_pct != null && mp.ts_pct != null ? mp.ts_pct - mr.ts_pct : null });
    }
  }
  const poExtra = (id) => po.get(id) || { playoff_gmsc36_delta: null, playoff_ts_delta: null };
  const formOf = (recs, total) => {
    if (total.games < FORM_GATE.scope_games || recs.length < FORM_GATE.window) return null;
    const a = gs36(mergeTotals(...recs.slice(-FORM_GATE.window).map((r) => r.totals)));
    const b = gs36(total);
    return a == null || b == null ? null : a - b;
  };

  const entries = {
    season: ids.map((id) => {
      const p = players.get(id);
      const t = regularOf(p, S);
      return { id, totals: t, extra: { ...poExtra(id), form_gmsc36_delta: formOf(p.records.filter((r) => r.season === S && r.season_type === 'regular'), t) } };
    }),
    playoffs: ids.map((id) => ({ id, totals: careerPost.get(id), extra: poExtra(id) })),
    home: ids.map((id) => ({ id, totals: players.get(id).seasons.get(S).home, extra: poExtra(id) })),
    away: ids.map((id) => ({ id, totals: players.get(id).seasons.get(S).away, extra: poExtra(id) }))
  };
  if (priorCoverage) {
    entries.career = ids.map((id) => ({ id, totals: careerReg.get(id), extra: { ...poExtra(id), form_gmsc36_delta: formOf(players.get(id).records.filter((r) => r.season_type === 'regular'), careerReg.get(id)) } }));
  }
  for (const n of LAST_N) {
    entries[`last${n}`] = ids.map((id) => ({ id, totals: mergeTotals(...players.get(id).records.slice(-n).map((r) => r.totals)), extra: poExtra(id) }));
  }

  // WinBA: the frozen canonical function over exactly the regular-season documents DNA selected, at asOf.
  const winbaSnapshot = buildWinbaSnapshotAsOf(games.filter((g) => g.season === S && g.season_type === 'regular').map((g) => g.doc), { season: S, asOf: sel.as_of, generatedAt: sel.as_of });
  const winbaRows = new Map(ids.map((id) => [id, winbaForPlayer(winbaSnapshot, id)]).filter(([, w]) => w));

  const scored = {};
  for (const [scope, list] of Object.entries(entries)) scored[scope] = scoreScope(list, scope, { winbaRows: scope === 'season' ? winbaRows : null });

  for (const id of ids) {
    const p = players.get(id);
    const scopes = {};
    for (const scope of SCOPES) {
      if (scope === 'clutch') { scopes.clutch = { calculated: false, scope, reason: 'CLUTCH_NOT_BUILT' }; continue; }
      if (scope === 'career' && !priorCoverage) {
        scopes.career = { calculated: false, scope, reason: 'NO_PRIOR_SEASON_COVERAGE', coverage_from: base.coverage.coverage_from };
        continue;
      }
      scopes[scope] = scored[scope].get(id);
    }
    let movement = null;
    const recent = scopes[MOVEMENT_WINDOW];
    if (scopes.season?.calculated && recent?.calculated) {
      const deltas = {};
      for (const d of DIMENSIONS) {
        const a = recent.dimensions[d.key]?.score;
        const b = scopes.season.dimensions[d.key]?.score;
        if (a != null && b != null) deltas[d.key] = a - b;
      }
      movement = { vs: MOVEMENT_WINDOW, deltas };
    }
    base.players[id] = { athlete_id: id, name: p.name, team_id: p.team_id, season: S, as_of: sel.as_of, scopes, movement };
  }
  base.winba = { version: WINBA_VERSION, games_used: winbaSnapshot.games_used, qualified_count: winbaSnapshot.qualified_count, as_of: winbaSnapshot.as_of };
  return base;
}

export function playerDnaFor(result, athleteId) {
  return result?.players?.[String(athleteId)] || null;
}
