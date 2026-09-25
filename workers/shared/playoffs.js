// Playoff bracket contract — sport-agnostic core (pbe-playoffs/1.0.0).
//
// A bracket is DERIVED from verified postseason games; no provider publishes a trustworthy bracket
// resource. This module knows nothing about ESPN or the WNBA: a sport adapter (playoffs-wnba.js today,
// an NBA adapter later) hands it normalized games, round definitions and league seeds, and it returns
// either a validated snapshot or the list of reasons it refused to build one.
//
// Truth rules:
//   * A series exists only where a game names BOTH teams. Placeholder (TBD) games stay unassigned and
//     are never attached to a guessed matchup; the round shows TBD slots instead.
//   * Series wins are counted from FINAL game scores. The provider's own series summary is a cross-check.
//   * best_of comes from what the source published: the series' own game count, or the highest game
//     number scheduled in the round ("Game 5 If Necessary" proves a best-of-five).
//   * Seeds come from the league seed table the adapter supplies. Nothing is inferred from a format rule.
//   * An invalid build is refused whole; callers keep serving their last good snapshot.

export const PLAYOFFS_CONTRACT = 'pbe-playoffs/1.0.0';

export const SERIES_STATUS = Object.freeze({ TBD: 'TBD', UPCOMING: 'UPCOMING', LIVE: 'LIVE', IN_PROGRESS: 'IN_PROGRESS', FINAL: 'FINAL' });
export const GAME_STATUS = Object.freeze({ SCHEDULED: 'SCHEDULED', LIVE: 'LIVE', FINAL: 'FINAL', POSTPONED: 'POSTPONED', CANCELED: 'CANCELED', SUSPENDED: 'SUSPENDED', NOT_NEEDED: 'NOT_NEEDED', UNKNOWN: 'UNKNOWN' });
export const BRACKET_STATUS = Object.freeze({ NOT_STARTED: 'NOT_STARTED', IN_PROGRESS: 'IN_PROGRESS', COMPLETE: 'COMPLETE' });

const PLAYED = new Set([GAME_STATUS.LIVE, GAME_STATUS.FINAL]);
const VOID = new Set([GAME_STATUS.CANCELED, GAME_STATUS.NOT_NEEDED]);

const isInt = (v) => Number.isInteger(v) && v >= 0;
const byStart = (a, b) => String(a.start_utc || '').localeCompare(String(b.start_utc || '')) || (a.game_number ?? 99) - (b.game_number ?? 99) || String(a.game_id).localeCompare(String(b.game_id));

/** Public team shape carried in series/games. */
function teamOut(t, seed = null) {
  return t ? { team_id: t.team_id, team_name: t.name, abbreviation: t.abbreviation, short_name: t.short_name ?? null, logo: t.logo ?? null, seed } : null;
}

function gameOut(g, status = g.status) {
  return {
    game_id: g.game_id,
    start_utc: g.start_utc,
    time_tbd: Boolean(g.time_tbd),
    status,
    status_detail: g.status_detail ?? null,
    game_number: g.game_number ?? null,
    if_necessary: Boolean(g.if_necessary),
    home_team: teamOut(g.home),
    away_team: teamOut(g.away),
    home_score: PLAYED.has(status) ? g.home_score : null,
    away_score: PLAYED.has(status) ? g.away_score : null,
    winner_team_id: status === GAME_STATUS.FINAL ? (g.home_score > g.away_score ? g.home.team_id : g.away.team_id) : null,
    venue: g.venue ?? null
  };
}

/** Canonical content of a game, used to tell an identical repeat from a conflicting duplicate. */
const gameSig = (g) => JSON.stringify([g.round_label, g.game_number, g.status, g.start_utc, g.home?.team_id ?? null, g.away?.team_id ?? null, g.home_score ?? null, g.away_score ?? null]);

function validTeam(t) {
  return t && /^[A-Za-z0-9_-]{1,40}$/.test(String(t.team_id || '')) && String(t.abbreviation || '').trim() && String(t.name || '').trim();
}

/**
 * @param {object} input
 * @param {number} input.season
 * @param {Array<{round_id,name,order,is_final?:boolean,match:(label:string)=>boolean}>} input.rounds
 * @param {Array<object>} input.games      adapter-normalized games (see playoffs-wnba.js)
 * @param {Array<object>} input.seeds      [{ seed, team_id, team_name, abbreviation, logo, wins, losses, clinch_status, clinch_code, clinch_label }]
 * @param {string|null} input.phase
 * @param {string} input.capturedAt
 * @param {object} input.source           { id, name, authority, endpoints[] } — descriptions, never URLs with secrets
 * @param {object} input.provenance       extra provenance fields merged into the snapshot
 * @returns {{ ok: boolean, errors: string[], warnings: string[], snapshot: object|null }}
 */
export function buildPlayoffs({ sport, league, season, rounds: roundDefs, games: rawGames, seeds = [], phase = null, capturedAt, source, sourceUpdatedAt = null, provenance = {} }) {
  const errors = [];
  const warnings = [];
  const defs = [...roundDefs].sort((a, b) => a.order - b.order);

  // 1. per-game validation + de-duplication by game id
  const byId = new Map();
  let duplicatesCollapsed = 0;
  for (const g of rawGames) {
    const id = String(g?.game_id ?? '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) { errors.push(`malformed_game_id:${id || '(empty)'}`); continue; }
    if (byId.has(id)) {
      if (gameSig(byId.get(id)) === gameSig(g)) duplicatesCollapsed += 1;
      else errors.push(`duplicate_game_conflict:${id}`);
      continue;
    }
    byId.set(id, g);
  }
  const games = [...byId.values()];

  for (const g of games) {
    if (g.season_year !== season) errors.push(`season_mismatch:${g.game_id}:${g.season_year}`);
    for (const side of ['home', 'away']) if (g[side] && !validTeam(g[side])) errors.push(`malformed_team:${g.game_id}:${side}`);
    if (g.home && g.away && g.home.team_id === g.away.team_id) errors.push(`same_team_both_sides:${g.game_id}`);
    g.round = defs.find((d) => d.match(String(g.round_label || ''))) || null;
    if (!g.round) errors.push(`unsupported_round_label:${g.game_id}:${g.round_label || '(none)'}`);
    if (g.status === GAME_STATUS.FINAL) {
      if (!g.home || !g.away) errors.push(`final_without_teams:${g.game_id}`);
      else if (!isInt(g.home_score) || !isInt(g.away_score) || g.home_score === g.away_score) errors.push(`final_without_valid_score:${g.game_id}`);
    }
    if (g.status === GAME_STATUS.LIVE && (!g.home || !g.away)) errors.push(`live_without_teams:${g.game_id}`);
    if (g.status === GAME_STATUS.UNKNOWN) warnings.push(`unknown_game_status:${g.game_id}:${g.status_detail || ''}`);
  }
  if (errors.length) return { ok: false, errors, warnings, snapshot: null };

  const seedOf = new Map(seeds.filter((s) => s.team_id).map((s) => [String(s.team_id), s.seed]));
  const seedNums = seeds.map((s) => s.seed).filter((n) => n !== null && n !== undefined);
  if (new Set(seedNums).size !== seedNums.length) warnings.push('duplicate_seed_numbers');

  // 2. rounds
  const rounds = [];
  const gameOwner = new Map(); // game_id -> series_id (a game may belong to exactly one series)
  for (const def of defs) {
    const inRound = games.filter((g) => g.round === def).sort(byStart);
    if (!inRound.length) continue;
    const numbered = inRound.map((g) => g.game_number).filter(Number.isInteger);
    const roundMaxGame = numbered.length ? Math.max(...numbered) : null;
    const g1Count = inRound.filter((g) => g.game_number === 1).length;

    const pairs = new Map();
    const unassigned = [];
    for (const g of inRound) {
      if (!g.home || !g.away) { unassigned.push(g); continue; }
      const ids = [g.home.team_id, g.away.team_id].sort();
      const key = ids.join('-');
      if (!pairs.has(key)) pairs.set(key, { ids, games: [] });
      pairs.get(key).games.push(g);
    }

    // A team can play in one series per round.
    const teamSeries = new Map();
    for (const [key, p] of pairs) for (const t of p.ids) {
      if (teamSeries.has(t)) errors.push(`team_in_multiple_series:${def.round_id}:${t}`);
      teamSeries.set(t, key);
    }

    const series = [];
    for (const [key, p] of pairs) {
      const s = buildSeries({ season, def, key, pair: p, roundMaxGame, seedOf, errors, warnings });
      for (const g of s.games) {
        if (gameOwner.has(g.game_id)) errors.push(`game_in_multiple_series:${g.game_id}`);
        gameOwner.set(g.game_id, s.series_id);
      }
      series.push(s);
    }
    series.sort((a, b) => (a.higher_seed?.seed ?? 99) - (b.higher_seed?.seed ?? 99) || String(a.series_id).localeCompare(String(b.series_id)));

    const expected = g1Count || (numbered.length ? Math.max(...[...new Set(numbered)].map((n) => inRound.filter((g) => g.game_number === n).length)) : series.length);
    if (series.length > expected) errors.push(`more_series_than_scheduled:${def.round_id}:${series.length}>${expected}`);
    const tbdSlots = Math.max(0, expected - series.length);
    const roundBestOf = series.find((s) => s.best_of)?.best_of ?? oddOrNull(roundMaxGame, warnings, `${def.round_id}:round_schedule`);
    for (let i = 1; i <= tbdSlots; i += 1) {
      series.push({
        series_id: `${season}-${def.round_id}-tbd-${i}`,
        status: SERIES_STATUS.TBD,
        best_of: roundBestOf,
        wins_needed: roundBestOf ? Math.floor(roundBestOf / 2) + 1 : null,
        higher_seed: null,
        lower_seed: null,
        higher_wins: null,
        lower_wins: null,
        winner_team_id: null,
        next_game_id: null,
        live_game_id: null,
        last_result: null,
        summary: 'Matchup not set by the source yet',
        seeding_basis: null,
        source_summary: null,
        games: []
      });
    }

    rounds.push({
      round_id: def.round_id,
      name: def.name,
      order: def.order,
      is_final: Boolean(def.is_final),
      status: roundStatus(series, expected),
      best_of: roundBestOf,
      series_expected: expected,
      series,
      unassigned_games: unassigned.map((g) => gameOut(g))
    });
  }
  if (errors.length) return { ok: false, errors, warnings, snapshot: null };

  // 3. overall state + champion
  const all = rounds.flatMap((r) => r.series.flatMap((s) => s.games)).concat(rounds.flatMap((r) => r.unassigned_games));
  const started = all.some((g) => PLAYED.has(g.status));
  const last = rounds.at(-1);
  const finalRound = rounds.find((r) => r.is_final) || null;
  const finalSeries = finalRound && finalRound.series.length === 1 ? finalRound.series[0] : null;
  let champion = null;
  if (finalSeries?.status === SERIES_STATUS.FINAL) {
    const w = finalSeries.winner_team_id === finalSeries.higher_seed.team_id ? finalSeries.higher_seed : finalSeries.lower_seed;
    const l = w === finalSeries.higher_seed ? finalSeries.lower_seed : finalSeries.higher_seed;
    const clincher = [...finalSeries.games].reverse().find((g) => g.status === GAME_STATUS.FINAL);
    champion = {
      ...w,
      series_id: finalSeries.series_id,
      series_score: `${Math.max(finalSeries.higher_wins, finalSeries.lower_wins)}-${Math.min(finalSeries.higher_wins, finalSeries.lower_wins)}`,
      opponent: l,
      clinched_game_id: clincher?.game_id ?? null,
      clinched_at: clincher?.start_utc ?? null
    };
  }
  const status = champion ? BRACKET_STATUS.COMPLETE : started ? BRACKET_STATUS.IN_PROGRESS : BRACKET_STATUS.NOT_STARTED;
  if (last && last !== finalRound && status !== BRACKET_STATUS.NOT_STARTED) warnings.push('final_round_not_scheduled_yet');

  const inBracket = new Set(rounds.flatMap((r) => r.series.flatMap((s) => [s.higher_seed?.team_id, s.lower_seed?.team_id])).filter(Boolean));
  const seedsOut = seeds.map((s) => ({ ...s, in_bracket: inBracket.has(String(s.team_id)) }));
  const seriesCount = rounds.reduce((n, r) => n + r.series.filter((s) => s.status !== SERIES_STATUS.TBD).length, 0);

  return {
    ok: true,
    errors,
    warnings,
    snapshot: {
      contract: PLAYOFFS_CONTRACT,
      sport,
      league,
      season,
      phase,
      status,
      updated_at: capturedAt,
      seeds: seedsOut,
      rounds,
      champion,
      source,
      source_updated_at: sourceUpdatedAt,
      freshness: null, // set at serve time by the API from the snapshot's age
      frozen: status === BRACKET_STATUS.COMPLETE,
      provenance: {
        captured_at: capturedAt,
        provider: source?.id ?? null,
        season,
        postseason_game_count: games.length,
        played_game_count: all.filter((g) => PLAYED.has(g.status)).length,
        series_count: seriesCount,
        duplicates_collapsed: duplicatesCollapsed,
        warnings,
        ...provenance
      }
    }
  };
}

function oddOrNull(n, warnings, where) {
  if (!Number.isInteger(n) || n < 1) return null;
  if (n % 2 === 1) return n;
  warnings.push(`even_best_of_ignored:${where}:${n}`);
  return null;
}

function buildSeries({ season, def, key, pair, roundMaxGame, seedOf, errors, warnings }) {
  const series_id = `${season}-${def.round_id}-${key}`;
  const list = [...pair.games].sort(byStart);
  const [a, b] = pair.ids;
  const teamOf = (id) => (list.find((g) => g.home.team_id === id)?.home || list.find((g) => g.away.team_id === id)?.away);

  // Game numbers are unique among the games that count.
  const nums = list.filter((g) => !VOID.has(g.status) && Number.isInteger(g.game_number)).map((g) => g.game_number);
  if (new Set(nums).size !== nums.length) errors.push(`duplicate_game_number:${series_id}`);

  // best_of from published evidence: the provider's per-series count, and the game numbers on the schedule.
  const totals = [...new Set(list.map((g) => g.source_series?.total).filter((n) => Number.isInteger(n) && n > 0))];
  if (totals.length > 1) warnings.push(`series_total_disagrees:${series_id}:${totals.join('/')}`);
  const seriesMaxGame = nums.length ? Math.max(...nums) : null;
  const evidence = [...totals, seriesMaxGame, roundMaxGame].filter((n) => Number.isInteger(n) && n > 0);
  const best_of = evidence.length ? oddOrNull(Math.max(...evidence), warnings, series_id) : null;
  const need = best_of ? Math.floor(best_of / 2) + 1 : null;

  // Wins counted from final scores, in order, so a game after a clinch is detectable.
  const wins = { [a]: 0, [b]: 0 };
  let winner = null;
  const games = [];
  for (const g of list) {
    let status = g.status;
    if (winner && (status === GAME_STATUS.SCHEDULED || status === GAME_STATUS.POSTPONED)) status = GAME_STATUS.NOT_NEEDED;
    if (winner && PLAYED.has(g.status)) errors.push(`game_after_clinch:${series_id}:${g.game_id}`);
    if (g.status === GAME_STATUS.FINAL) {
      const w = g.home_score > g.away_score ? g.home.team_id : g.away.team_id;
      wins[w] += 1;
      if (need && wins[w] >= need && !winner) winner = w;
    }
    games.push(gameOut(g, status));
  }
  if (need && (wins[a] > need || wins[b] > need)) errors.push(`wins_exceed_best_of:${series_id}`);
  if (need && wins[a] >= need && wins[b] >= need) errors.push(`two_series_winners:${series_id}`);

  // Cross-check against the provider's own series record (the latest one it published).
  const src = list.map((g) => g.source_series).filter(Boolean).sort((x, y) => sumWins(y) - sumWins(x))[0] || null;
  if (src) {
    for (const [id, n] of Object.entries(src.wins || {})) if (!isInt(n)) errors.push(`impossible_series_wins:${series_id}:${id}:${n}`);
    if (src.wins && (src.wins[a] !== wins[a] || src.wins[b] !== wins[b])) warnings.push(`source_series_wins_differ:${series_id}:${a}=${src.wins[a]}/${wins[a]},${b}=${src.wins[b]}/${wins[b]}`);
    if (src.completed === true && !winner) errors.push(`completed_series_without_winner:${series_id}`);
    if (src.completed === false && winner) warnings.push(`source_not_yet_completed:${series_id}`);
  }

  // Seeds: league seed table when both teams carry one; otherwise Game 1's listing with no seed claimed.
  const sa = seedOf.get(a) ?? null;
  const sb = seedOf.get(b) ?? null;
  let hi;
  let lo;
  let seeding_basis;
  if (sa !== null && sb !== null) {
    [hi, lo] = sa <= sb ? [a, b] : [b, a];
    seeding_basis = 'league_seed';
  } else {
    const g1 = list.find((g) => g.game_number === 1) || list[0];
    [hi, lo] = [g1.home.team_id, g1.away.team_id];
    seeding_basis = 'unseeded_game1_home';
    warnings.push(`seeds_missing:${series_id}`);
  }

  const live = games.find((g) => g.status === GAME_STATUS.LIVE) || null;
  const next = winner ? null : games.find((g) => g.status === GAME_STATUS.SCHEDULED) || null;
  const lastFinal = [...games].reverse().find((g) => g.status === GAME_STATUS.FINAL) || null;
  const status = winner ? SERIES_STATUS.FINAL : live ? SERIES_STATUS.LIVE : games.some((g) => g.status === GAME_STATUS.FINAL) ? SERIES_STATUS.IN_PROGRESS : SERIES_STATUS.UPCOMING;

  const hiTeam = teamOf(hi);
  const loTeam = teamOf(lo);
  const lead = wins[hi] === wins[lo] ? null : wins[hi] > wins[lo] ? hiTeam : loTeam;
  const score = `${Math.max(wins[hi], wins[lo])}-${Math.min(wins[hi], wins[lo])}`;
  const summary = winner
    ? `${(winner === hi ? hiTeam : loTeam).abbreviation} wins series ${score}`
    : status === SERIES_STATUS.UPCOMING ? 'Series has not started'
      : lead ? `${lead.abbreviation} leads series ${score}` : `Series tied ${score}`;

  return {
    series_id,
    status,
    best_of,
    wins_needed: need,
    higher_seed: teamOut(hiTeam, seeding_basis === 'league_seed' ? seedOf.get(hi) : null),
    lower_seed: teamOut(loTeam, seeding_basis === 'league_seed' ? seedOf.get(lo) : null),
    higher_wins: wins[hi],
    lower_wins: wins[lo],
    winner_team_id: winner,
    next_game_id: next?.game_id ?? null,
    live_game_id: live?.game_id ?? null,
    last_result: lastFinal ? { game_id: lastFinal.game_id, game_number: lastFinal.game_number, start_utc: lastFinal.start_utc, winner_team_id: lastFinal.winner_team_id, home_team_id: lastFinal.home_team.team_id, away_team_id: lastFinal.away_team.team_id, home_score: lastFinal.home_score, away_score: lastFinal.away_score } : null,
    summary,
    seeding_basis,
    source_summary: src?.summary ?? null,
    games
  };
}

const sumWins = (s) => Object.values(s?.wins || {}).reduce((n, v) => n + (Number(v) || 0), 0);

function roundStatus(series, expected) {
  const real = series.filter((s) => s.status !== SERIES_STATUS.TBD);
  if (!real.length) return SERIES_STATUS.TBD;
  if (real.some((s) => s.status === SERIES_STATUS.LIVE)) return SERIES_STATUS.LIVE;
  if (real.length === expected && real.every((s) => s.status === SERIES_STATUS.FINAL)) return SERIES_STATUS.FINAL;
  if (real.some((s) => s.status === SERIES_STATUS.IN_PROGRESS || s.status === SERIES_STATUS.FINAL)) return SERIES_STATUS.IN_PROGRESS;
  return SERIES_STATUS.UPCOMING;
}

// ------------------------------------------------------------------ serve-time helpers

/** How long a snapshot stays inside its freshness window (seconds). A completed bracket never goes stale. */
export function playoffsStaleAfterS(snapshot) {
  if (!snapshot) return null;
  if (snapshot.status === BRACKET_STATUS.COMPLETE) return null;
  const games = (snapshot.rounds || []).flatMap((r) => [...r.series.flatMap((s) => s.games), ...(r.unassigned_games || [])]);
  if (games.some((g) => g.status === GAME_STATUS.LIVE)) return 360;
  return snapshot.status === BRACKET_STATUS.IN_PROGRESS ? 1800 : 3 * 3600;
}

/** Semantics label for a served snapshot. Never lets a prior season read as current. */
export function playoffsSemantics(snapshot, { isCurrentSeason, stale }) {
  if (!isCurrentSeason) return snapshot.status === BRACKET_STATUS.COMPLETE ? 'PRIOR_SEASON_FINAL' : 'PRIOR_SEASON_SNAPSHOT';
  if (snapshot.status === BRACKET_STATUS.COMPLETE) return 'POSTSEASON_COMPLETE';
  if (stale) return 'POSTSEASON_SNAPSHOT';
  return snapshot.status === BRACKET_STATUS.IN_PROGRESS ? 'CURRENT_POSTSEASON' : 'POSTSEASON_NOT_STARTED';
}

/** Games worth watching closely: live now, tipping soon, or recently tipped (for the ingest cadence). */
export function playoffsHot(snapshot, now = Date.now()) {
  const games = (snapshot?.rounds || []).flatMap((r) => [...r.series.flatMap((s) => s.games), ...(r.unassigned_games || [])]);
  return games.some((g) => {
    if (g.status === GAME_STATUS.LIVE) return true;
    const t = Date.parse(g.start_utc);
    if (!Number.isFinite(t) || g.time_tbd) return false;
    const m = (t - now) / 60e3;
    return (g.status === GAME_STATUS.SCHEDULED && m <= 45 && m >= -240) || (g.status === GAME_STATUS.FINAL && m >= -300 && m <= 0);
  });
}

/** Stable signature of the bracket's truth (excludes capture timestamps) — unchanged truth is not rewritten. */
export function playoffsSignature(snapshot) {
  const s = snapshot || {};
  return JSON.stringify([s.season, s.phase, s.status, s.seeds, s.rounds, s.champion, s.provenance?.missing_event_ids || []]);
}
