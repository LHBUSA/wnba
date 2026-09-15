// PBE WNBA model — the ONE feature implementation.
//
// Training (scripts/model/build-dataset.mjs) and the live runtime call exactly
// these functions, so a probability shown on the site is computed from the same
// definitions the model was validated on.
//
// Integrity rules enforced here, not by convention:
//   * A feature may only read team-game rows whose game started strictly before
//     `asOf` AND whose ET calendar date is earlier than the target game's ET date
//     (no same-day games, even if they finished before tip).
//   * The target game's own row is never readable (it fails both tests).
//   * Only FINAL regular-season / postseason rows with a complete box count.
//   * Sportsbook prices are never read. There is no odds field on a row.
//   * No injury report is read: ESPN publishes current injuries only, with no
//     timestamped history, so availability comes from observed minutes alone.
//
// Pure functions. No fetch, no clock, no randomness.

export const FEATURE_SCHEMA = 'pbe-wnba-features/1.0.0';
export const ROW_SCHEMA = 'pbe-wnba-team-game/1';

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDateOf = (iso) => ET.format(new Date(iso));

const DAY = 86400000;

// Seasons played at a single site. ESPN lists a nominal home team but does not
// set neutralSite for the 2020 IMG Academy (Bradenton, FL) bubble.
export const SINGLE_SITE_SEASONS = Object.freeze([2020]);

// ------------------------------------------------------------------ rows

function madeAtt(v) {
  const m = /^(\d+)-(\d+)$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function intOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function statMap(teamBox) {
  const out = {};
  for (const s of teamBox?.statistics || []) out[s.name] = s.displayValue;
  return out;
}
function parseTeamBox(teamBox) {
  const s = statMap(teamBox);
  const fg = madeAtt(s['fieldGoalsMade-fieldGoalsAttempted']);
  const fg3 = madeAtt(s['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
  const ft = madeAtt(s['freeThrowsMade-freeThrowsAttempted']);
  const oreb = intOf(s.offensiveRebounds);
  const dreb = intOf(s.defensiveRebounds);
  // totalTurnovers includes team turnovers; older payloads only carry turnovers.
  const tov = intOf(s.totalTurnovers) ?? intOf(s.turnovers);
  if (!fg || !fg3 || !ft || oreb === null || dreb === null || tov === null) return null;
  if (fg[1] === 0) return null;
  return { fgm: fg[0], fga: fg[1], fg3m: fg3[0], fg3a: fg3[1], ftm: ft[0], fta: ft[1], oreb, dreb, tov };
}

function minutesOf(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '--') return 0;
  if (/^\d+:\d{2}$/.test(s)) { const [m, sec] = s.split(':').map(Number); return m + sec / 60; }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parsePlayers(playerBlock) {
  const stat = playerBlock?.statistics?.[0];
  if (!stat) return null;
  const idx = (stat.keys || []).indexOf('minutes');
  if (idx < 0) return null;
  const players = [];
  for (const a of stat.athletes || []) {
    const id = a?.athlete?.id;
    if (!id) continue;
    const min = a.didNotPlay ? 0 : minutesOf(a.stats?.[idx]);
    if (min > 0) players.push({ id: String(id), min: Math.round(min * 100) / 100, starter: Boolean(a.starter) });
  }
  return players;
}

/**
 * Normalize one ESPN summary into two per-team game rows (away, home).
 * Throws on a non-final or structurally broken game (fail loud; never a guessed row).
 * eventMeta may override { season, season_type } when the caller already knows them.
 */
export function teamGameRowFromSummary(summary, eventMeta = {}) {
  const header = summary?.header;
  const comp = header?.competitions?.[0];
  if (!comp) throw new Error('summary_without_competition');
  if (comp.status?.type?.name !== 'STATUS_FINAL') throw new Error(`not_final:${comp.status?.type?.name}`);
  const eventId = String(header.id || comp.id);
  const season = intOf(eventMeta.season ?? header.season?.year);
  const seasonType = intOf(eventMeta.season_type ?? header.season?.type);
  const startUtc = new Date(comp.date).toISOString();
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) throw new Error('missing_competitors');
  const hPts = intOf(home.score); const aPts = intOf(away.score);
  if (hPts === null || aPts === null) throw new Error('missing_score');

  const boxTeams = summary?.boxscore?.teams || [];
  const boxPlayers = summary?.boxscore?.players || [];
  const boxFor = (id) => parseTeamBox(boxTeams.find((t) => String(t?.team?.id) === String(id)));
  const playersFor = (id) => parsePlayers(boxPlayers.find((p) => String(p?.team?.id) === String(id)));

  const hb = boxFor(home.id); const ab = boxFor(away.id);
  const hp = playersFor(home.id); const ap = playersFor(away.id);
  const periods = Math.max(home.linescores?.length || 0, away.linescores?.length || 0);
  // Pre-2006 WNBA played two 20-minute halves; from 2006 four 10-minute quarters.
  const regPeriods = season !== null && season < 2006 ? 2 : 4;
  const otPeriods = periods > regPeriods ? periods - regPeriods : 0;
  const minutesGame = 40 + 5 * otPeriods;

  const possOf = (b) => b.fga - b.oreb + b.tov + 0.44 * b.fta;
  const poss = hb && ab ? (possOf(hb) + possOf(ab)) / 2 : null;

  const row = (team, opp, own, other, pts, oppPts, players, ha) => ({
    schema: ROW_SCHEMA,
    event_id: eventId,
    season,
    season_type: seasonType,
    start_utc: startUtc,
    et_date: etDateOf(startUtc),
    neutral: Boolean(comp.neutralSite) || SINGLE_SITE_SEASONS.includes(season),
    team_id: String(team.id),
    opp_id: String(opp.id),
    home_away: ha,
    pts,
    opp_pts: oppPts,
    won: pts > oppPts,
    box_complete: Boolean(own && other),
    players_complete: Boolean(players && players.length >= 5),
    minutes_game: minutesGame,
    poss: poss === null ? null : Math.round(poss * 1000) / 1000,
    own: own || null,
    opp: other || null,
    players: players || []
  });
  return [
    row(away, home, ab, hb, aPts, hPts, ap, 'away'),
    row(home, away, hb, ab, hPts, aPts, hp, 'home')
  ];
}

// ------------------------------------------------------------------ aggregation

/** Rows a prediction for `game` may read, as of `asOf` (ISO). */
export function visibleRows(rows, game, asOf) {
  const cutoff = Date.parse(asOf);
  const gameDate = etDateOf(game.start_utc);
  return (rows || []).filter((r) =>
    r && r.event_id !== String(game.event_id) &&
    (r.season_type === 2 || r.season_type === 3) &&
    r.box_complete && r.poss > 0 &&
    Date.parse(r.start_utc) < cutoff &&
    r.et_date < gameDate
  ).sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
}

function block(rows) {
  const n = rows.length;
  if (!n) return null;
  let pts = 0, opp = 0, poss = 0, min = 0;
  const o = { fgm: 0, fga: 0, fg3m: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, tov: 0 };
  const d = { fgm: 0, fga: 0, fg3m: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, tov: 0 };
  for (const r of rows) {
    pts += r.pts; opp += r.opp_pts; poss += r.poss; min += r.minutes_game;
    for (const k of Object.keys(o)) { o[k] += r.own[k]; d[k] += r.opp[k]; }
  }
  const efg = (x) => (x.fgm + 0.5 * x.fg3m) / x.fga;
  const tovp = (x) => x.tov / (x.fga + 0.44 * x.fta + x.tov);
  return {
    n,
    ortg: (100 * pts) / poss,
    drtg: (100 * opp) / poss,
    net: (100 * (pts - opp)) / poss,
    efg_margin: efg(o) - efg(d),
    tov_margin: tovp(d) - tovp(o),
    orb_margin: o.oreb / (o.oreb + d.dreb) - d.oreb / (d.oreb + o.dreb),
    ftr_margin: o.ftm / o.fga - d.ftm / d.fga,
    pace: (40 * poss) / min
  };
}

const QUALITY = ['net', 'efg_margin', 'tov_margin', 'orb_margin', 'ftr_margin'];

function shrink(cur, prior, k, r) {
  const out = {};
  const n = cur?.n || 0;
  for (const q of QUALITY) {
    const p = prior ? r * prior[q] : 0;
    out[q] = (n * (cur ? cur[q] : 0) + k * p) / (n + k);
  }
  return out;
}

function lastRows(rows, n) { return rows.slice(Math.max(0, rows.length - n)); }

function rotation(curRows) {
  if (!curRows.length) return null;
  const last = curRows[curRows.length - 1];
  const window = lastRows(curRows, 10).filter((r) => r.players?.length);
  if (!window.length || !last.players?.length) return null;
  const inLast = new Set(last.players.map((p) => p.id));
  let total = 0, fromLast = 0;
  const byPlayer = new Map();
  for (const r of window) for (const p of r.players) {
    total += p.min;
    if (inLast.has(p.id)) fromLast += p.min;
    byPlayer.set(p.id, (byPlayer.get(p.id) || 0) + p.min);
  }
  // Core five = the five players with the most minutes in the window.
  const core = [...byPlayer.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([id]) => id);
  const lastStarters = new Set(last.players.filter((p) => p.starter).map((p) => p.id));
  const continuity = core.filter((id) => lastStarters.has(id)).length / 5;
  let hhi = 0;
  for (const m of byPlayer.values()) hhi += (m / total) ** 2;
  return { availability: total ? fromLast / total : null, continuity, concentration: hhi };
}

function restDays(prev, gameStart) {
  if (!prev) return null;
  const a = Date.parse(etDateOf(prev.start_utc) + 'T00:00:00Z');
  const b = Date.parse(etDateOf(gameStart) + 'T00:00:00Z');
  return Math.round((b - a) / DAY) - 1;
}

export const DEFAULT_PARAMS = Object.freeze({ prior_games: 8, carryover: 0.6, min_current_games: 3 });

/**
 * Per-team as-of state for a target game. `leagueRows` (all teams) enables the
 * strength-of-schedule adjustment; without it sos is 0.
 */
export function teamState({ teamId, game, rows, asOf, params = DEFAULT_PARAMS, leagueIndex = null }) {
  const vis = visibleRows(rows, game, asOf).filter((r) => r.team_id === String(teamId));
  const cur = vis.filter((r) => r.season === game.season);
  const prior = vis.filter((r) => r.season === game.season - 1);
  const curB = block(cur);
  const priorB = prior.length >= 10 ? block(prior) : null;
  const shr = shrink(curB, priorB, params.prior_games, params.carryover);
  const l5 = cur.length >= 3 ? block(lastRows(cur, 5)) : null;
  const l10 = cur.length >= 3 ? block(lastRows(cur, 10)) : null;
  const last = vis[vis.length - 1] || null;
  const lastCur = cur[cur.length - 1] || null;
  const rest = restDays(lastCur, game.start_utc);
  const g7 = cur.filter((r) => Date.parse(r.start_utc) >= Date.parse(game.start_utc) - 7 * DAY).length;

  let sos = 0;
  if (leagueIndex && cur.length) {
    let s = 0;
    for (const r of cur) s += leagueIndex(r.opp_id);
    sos = s / cur.length;
  }
  return {
    team_id: String(teamId),
    n_current: cur.length,
    n_prior: prior.length,
    carryover: Boolean(priorB),
    shrunk: shr,
    season_to_date: curB,
    last5: l5,
    last10: l10,
    form5: l5 ? l5.net - shr.net : 0,
    form10: l10 ? l10.net - shr.net : 0,
    rest_days: rest,
    rest_clamped: rest === null ? 3 : Math.max(0, Math.min(3, rest)),
    back_to_back: rest === 0 ? 1 : 0,
    games_last7: g7,
    rotation: rotation(cur),
    sos,
    last_game_utc: last?.start_utc || null
  };
}

/** Index: team id -> as-of shrunk net rating, for opponents (no sos recursion). */
export function leagueNetIndex({ leagueRows, game, asOf, params = DEFAULT_PARAMS }) {
  const vis = visibleRows(leagueRows, game, asOf);
  const byTeam = new Map();
  for (const r of vis) {
    if (r.season !== game.season && r.season !== game.season - 1) continue;
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  }
  const cache = new Map();
  return (teamId) => {
    const id = String(teamId);
    if (cache.has(id)) return cache.get(id);
    const rows = byTeam.get(id) || [];
    const cur = rows.filter((r) => r.season === game.season);
    const prior = rows.filter((r) => r.season === game.season - 1);
    const v = shrink(block(cur), prior.length >= 10 ? block(prior) : null, params.prior_games, params.carryover).net;
    cache.set(id, v);
    return v;
  };
}

// ------------------------------------------------------------------ features

/** Candidate features, all oriented HOME minus AWAY. Order here is canonical. */
export const CANDIDATES = Object.freeze([
  { name: 'net_rating', family: 'team_quality', unit: 'pts/100', def: 'Shrunk season-to-date net rating (prior season carryover) home minus away' },
  { name: 'sos_adj_net', family: 'team_quality', unit: 'pts/100', def: 'Shrunk net rating plus mean as-of opponent net rating (strength of schedule), home minus away' },
  { name: 'efg_margin', family: 'team_quality', unit: 'eFG pts', def: 'Shrunk eFG% minus opponent eFG%, home minus away' },
  { name: 'tov_margin', family: 'team_quality', unit: 'TOV% pts', def: 'Shrunk opponent TOV% minus own TOV%, home minus away' },
  { name: 'orb_margin', family: 'team_quality', unit: 'ORB% pts', def: 'Shrunk ORB% minus opponent ORB%, home minus away' },
  { name: 'ftr_margin', family: 'team_quality', unit: 'FT/FGA', def: 'Shrunk FTM/FGA minus opponent FTM/FGA, home minus away' },
  { name: 'pace', family: 'team_quality', unit: 'poss/40', def: 'Season-to-date pace, home minus away (0 when either team has no current games)' },
  { name: 'form10', family: 'form', unit: 'pts/100', def: 'Last-10 net rating minus shrunk season net rating, home minus away (0 below 3 games)' },
  { name: 'form5', family: 'form', unit: 'pts/100', def: 'Last-5 net rating minus shrunk season net rating, home minus away (0 below 3 games)' },
  { name: 'home_court', family: 'situation', unit: 'flag', def: '1 when the listed home team plays in its own arena, 0 at a neutral site' },
  { name: 'rest', family: 'situation', unit: 'days', def: 'Rest days clamped 0..3 (3 when no current-season game), home minus away' },
  { name: 'back_to_back', family: 'situation', unit: 'flag', def: 'Second night of a back-to-back, home minus away' },
  { name: 'games_last7', family: 'situation', unit: 'games', def: 'Games played in the previous 7 days, home minus away' },
  { name: 'availability', family: 'rotation', unit: 'share', def: 'Share of last-10 minutes played by players who appeared in the most recent game, home minus away' },
  { name: 'continuity', family: 'rotation', unit: 'share', def: 'Share of the last-10 core five (most minutes) who started the most recent game, home minus away' },
  { name: 'concentration', family: 'rotation', unit: 'HHI', def: 'Herfindahl index of last-10 player minute shares, home minus away' }
]);
export const CANDIDATE_NAMES = Object.freeze(CANDIDATES.map((c) => c.name));

/**
 * Build the as-of feature vector for one game.
 *   game: { event_id, season, season_type, start_utc, neutral, home_id, away_id }
 *   homeRows / awayRows: that team's rows (any season); leagueRows optional (sos)
 *   asOf: ISO instant the prediction is made
 *   featureNames: ordered subset (defaults to all candidates)
 */
export function buildFeatures({ game, homeRows, awayRows, leagueRows = null, asOf, params = DEFAULT_PARAMS, featureNames = CANDIDATE_NAMES }) {
  if (!game?.start_utc || !game.home_id || !game.away_id) throw new Error('buildFeatures: incomplete game');
  if (!asOf || !(Date.parse(asOf) <= Date.parse(game.start_utc))) throw new Error('buildFeatures: asOf must be at or before tip');
  const leagueIndex = leagueRows ? leagueNetIndex({ leagueRows, game, asOf, params }) : null;
  const H = teamState({ teamId: game.home_id, game, rows: homeRows, asOf, params, leagueIndex });
  const A = teamState({ teamId: game.away_id, game, rows: awayRows, asOf, params, leagueIndex });
  const bothRot = H.rotation && A.rotation;
  const bothCur = H.season_to_date && A.season_to_date;
  const all = {
    net_rating: H.shrunk.net - A.shrunk.net,
    sos_adj_net: (H.shrunk.net + H.sos) - (A.shrunk.net + A.sos),
    efg_margin: 100 * (H.shrunk.efg_margin - A.shrunk.efg_margin),
    tov_margin: 100 * (H.shrunk.tov_margin - A.shrunk.tov_margin),
    orb_margin: 100 * (H.shrunk.orb_margin - A.shrunk.orb_margin),
    ftr_margin: 100 * (H.shrunk.ftr_margin - A.shrunk.ftr_margin),
    pace: bothCur ? H.season_to_date.pace - A.season_to_date.pace : 0,
    form10: H.form10 - A.form10,
    form5: H.form5 - A.form5,
    home_court: game.neutral ? 0 : 1,
    rest: H.rest_clamped - A.rest_clamped,
    back_to_back: H.back_to_back - A.back_to_back,
    games_last7: H.games_last7 - A.games_last7,
    availability: bothRot ? H.rotation.availability - A.rotation.availability : 0,
    continuity: bothRot ? H.rotation.continuity - A.rotation.continuity : 0,
    concentration: bothRot ? H.rotation.concentration - A.rotation.concentration : 0
  };
  for (const [k, v] of Object.entries(all)) if (!Number.isFinite(v)) throw new Error(`buildFeatures: non-finite ${k}`);
  const reasons = [];
  if (H.n_current < params.min_current_games) reasons.push(`home_team_under_${params.min_current_games}_current_games`);
  if (A.n_current < params.min_current_games) reasons.push(`away_team_under_${params.min_current_games}_current_games`);
  return {
    schema: FEATURE_SCHEMA,
    event_id: String(game.event_id),
    as_of: new Date(asOf).toISOString(),
    feature_names: [...featureNames],
    vector: featureNames.map((n) => {
      if (!(n in all)) throw new Error(`buildFeatures: unknown feature ${n}`);
      return all[n];
    }),
    all,
    teams: { home: summarizeState(H), away: summarizeState(A) },
    eligible: reasons.length === 0,
    ineligible_reasons: reasons
  };
}

function r3(x) { return x === null || x === undefined ? null : Math.round(x * 1000) / 1000; }
function summarizeState(S) {
  return {
    team_id: S.team_id,
    n_current: S.n_current,
    n_prior: S.n_prior,
    carryover: S.carryover,
    net_shrunk: r3(S.shrunk.net),
    net_season: r3(S.season_to_date?.net ?? null),
    ortg_season: r3(S.season_to_date?.ortg ?? null),
    drtg_season: r3(S.season_to_date?.drtg ?? null),
    net_last5: r3(S.last5?.net ?? null),
    net_last10: r3(S.last10?.net ?? null),
    efg_margin: r3(100 * S.shrunk.efg_margin),
    tov_margin: r3(100 * S.shrunk.tov_margin),
    orb_margin: r3(100 * S.shrunk.orb_margin),
    ftr_margin: r3(100 * S.shrunk.ftr_margin),
    sos: r3(S.sos),
    pace: r3(S.season_to_date?.pace ?? null),
    rest_days: S.rest_days,
    back_to_back: S.back_to_back,
    games_last7: S.games_last7,
    availability: r3(S.rotation?.availability ?? null),
    continuity: r3(S.rotation?.continuity ?? null),
    concentration: r3(S.rotation?.concentration ?? null),
    last_game_utc: S.last_game_utc
  };
}
