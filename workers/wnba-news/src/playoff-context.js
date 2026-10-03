// Playoff context for newsroom stories — pure, deterministic, from wnba-api records only.
//
//   /v1/playoffs (pbe-playoffs/1.0.0)  series, game numbers, if-necessary flags, finals
//   /v1/season                         ESPN season-type date windows
//
// Two facts every playoff story needs and the regular-season generators never had:
//   * which game of which series this is, and the series score BEFORE it (previews, injuries) or AFTER it (results);
//   * whether an "if necessary" game is actually going to be played. A Game 3 is not a game until the series is
//     tied 1-1; previewing it before then describes a game that may never exist.
// Series state is recomputed from the series' own FINAL games by tip time, never read from a summary string, so a
// story about Game 1 cannot pick up the result of Game 2.

export const PLAYOFF_CONTEXT_VERSION = 'wnba-playoff-context/1.0.0';

const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const PLAYOFF_NOTE = /\b(round|semifinal|final|game \d|play-?in|if necessary)\b/i;

/** Season phase of one schedule game: ESPN's season.type when present, else the /v1/season date windows. */
export function seasonPhase(g, types = []) {
  const t = g?.season?.type;
  if (t === 1) return 'preseason';
  if (t === 2) return 'regular';
  if (t === 3) return 'postseason';
  if ((g?.notes || []).some((n) => PLAYOFF_NOTE.test(String(n?.headline ?? n))) || g?.series) return 'postseason';
  const at = ms(g?.start_utc);
  if (at === null) return null;
  for (const w of types || []) {
    const a = ms(w.start); const b = ms(w.end);
    if (a !== null && b !== null && at >= a && at <= b) return { 1: 'preseason', 2: 'regular', 3: 'postseason', 4: 'offseason' }[w.type] || null;
  }
  return null;
}

/** Regular-season game ids from any schedule payloads (records and "this season" averages use only these). */
export function regularSeasonIds(games, types = []) {
  const out = new Set();
  for (const g of games || []) if (seasonPhase(g, types) === 'regular') out.add(String(g.game_id));
  return out;
}

/** The series (with its round) that contains a game, or null. */
export function seriesOf(playoffs, gameId) {
  const id = String(gameId ?? '');
  if (!id) return null;
  for (const r of playoffs?.rounds || []) {
    for (const s of r.series || []) {
      if ((s.games || []).some((x) => String(x.game_id) === id)) return { round: r, series: s };
    }
  }
  return null;
}

const teamOf = (s, tid) => [s.higher_seed, s.lower_seed].find((t) => String(t?.team_id) === String(tid)) || null;

/**
 * Series context for one game.
 *   before  wins per team from FINAL series games that tipped before this one
 *   after   (FINAL games only) wins including this game
 *   needed  false for an if-necessary game the series has not yet forced
 */
export function playoffContext(playoffs, gameId) {
  const hit = seriesOf(playoffs, gameId);
  if (!hit) return null;
  const { round, series: s } = hit;
  const game = s.games.find((x) => String(x.game_id) === String(gameId));
  const at = ms(game.start_utc);
  const hi = String(s.higher_seed?.team_id); const lo = String(s.lower_seed?.team_id);
  const count = (pred) => {
    const w = { [hi]: 0, [lo]: 0 };
    for (const x of s.games) if (x.status === 'FINAL' && x.winner_team_id && pred(x)) w[String(x.winner_team_id)] = (w[String(x.winner_team_id)] || 0) + 1;
    return w;
  };
  const before = count((x) => ms(x.start_utc) !== null && at !== null && ms(x.start_utc) < at && String(x.game_id) !== String(gameId));
  const final = game.status === 'FINAL' && game.winner_team_id;
  const after = final ? count((x) => (ms(x.start_utc) !== null && at !== null && ms(x.start_utc) < at) || String(x.game_id) === String(gameId)) : null;
  const need = s.wins_needed || Math.ceil((s.best_of || 1) / 2);
  const decidedBefore = before[hi] >= need || before[lo] >= need;
  // An if-necessary game is real once no team can have clinched before it: every earlier game is final and the
  // series is still open when it tips.
  const earlier = s.games.filter((x) => (x.game_number ?? 0) < (game.game_number ?? 0));
  const needed = !game.if_necessary || (!decidedBefore && earlier.every((x) => x.status === 'FINAL'));
  const side = (tid, w) => ({ team_id: String(tid), name: teamOf(s, tid)?.team_name || null, short_name: teamOf(s, tid)?.short_name || null, seed: teamOf(s, tid)?.seed ?? null, wins: w[String(tid)] || 0 });
  const home = String(game.home_team?.team_id ?? ''); const away = String(game.away_team?.team_id ?? '');
  const stakes = {};
  if (!decidedBefore) {
    for (const t of [hi, lo]) {
      const o = t === hi ? lo : hi;
      stakes[t] = before[t] === need - 1 && before[o] === need - 1 ? 'decider' : before[t] === need - 1 ? 'closeout' : before[o] === need - 1 ? 'elimination' : 'open';
    }
  }
  const winnerAfter = after ? [hi, lo].find((t) => after[t] >= need) || null : null;
  return {
    version: PLAYOFF_CONTEXT_VERSION,
    round: round.name,
    round_id: round.round_id,
    best_of: s.best_of,
    wins_needed: need,
    series_id: s.series_id,
    game_number: game.game_number ?? null,
    if_necessary: Boolean(game.if_necessary),
    needed,
    home_team_id: home,
    away_team_id: away,
    before: { [hi]: before[hi], [lo]: before[lo] },
    after: after ? { [hi]: after[hi], [lo]: after[lo] } : null,
    teams: { higher: side(hi, before), lower: side(lo, before) },
    stakes,
    decided_by_this_game: Boolean(winnerAfter),
    series_winner_team_id: winnerAfter
  };
}

const seriesWord = (n) => `best-of-${NUMW[n] || n}`;

/** "leads the best-of-three series 1–0", "the series is tied 1–1" — from one team's side. */
export function seriesScoreText(pc, teamId, state = 'before', nickOf = (t) => t.short_name || t.name) {
  const w = pc?.[state];
  if (!w) return null;
  const me = String(teamId);
  const them = [pc.teams.higher.team_id, pc.teams.lower.team_id].find((t) => t !== me);
  const a = w[me] || 0; const b = w[them] || 0;
  const other = pc.teams.higher.team_id === them ? pc.teams.higher : pc.teams.lower;
  const mine = pc.teams.higher.team_id === me ? pc.teams.higher : pc.teams.lower;
  if (a === 0 && b === 0) return `the ${seriesWord(pc.best_of)} ${pc.round.toLowerCase()} series opens`;
  if (a === b) return `the ${seriesWord(pc.best_of)} series is tied ${a}–${b}`;
  return a > b ? `the ${nickOf(mine)} lead the ${seriesWord(pc.best_of)} series ${a}–${b}` : `the ${nickOf(other)} lead the ${seriesWord(pc.best_of)} series ${b}–${a}`;
}

/** Facts a story may cite (grounding): game number, wins, best-of. */
export function playoffFacts(pc) {
  if (!pc) return null;
  const { version, teams, ...rest } = pc;
  return { ...rest, teams: { higher: { ...teams.higher }, lower: { ...teams.lower } } };
}

/**
 * The FINAL games of a series up to and including one game, oldest first, as frozen facts for a series strip.
 * Scores and winners only from the bracket's own game rows; a game without both scores is left out.
 */
export function seriesGames(playoffs, seriesId, { throughGameId = null } = {}) {
  const s = (playoffs?.rounds || []).flatMap((r) => r.series || []).find((x) => x.series_id === seriesId);
  if (!s) return [];
  const through = throughGameId ? s.games.find((x) => String(x.game_id) === String(throughGameId)) : null;
  const cut = through ? ms(through.start_utc) : null;
  return (s.games || [])
    .filter((x) => x.status === 'FINAL' && x.winner_team_id && Number.isFinite(Number(x.home_score)) && Number.isFinite(Number(x.away_score)))
    .filter((x) => cut === null || (ms(x.start_utc) !== null && ms(x.start_utc) <= cut))
    .sort((a, b) => (a.game_number ?? 0) - (b.game_number ?? 0))
    .map((x) => ({ game_id: String(x.game_id), game_number: x.game_number ?? null, start_utc: x.start_utc, home_team_id: String(x.home_team?.team_id ?? ''), away_team_id: String(x.away_team?.team_id ?? ''), home_abbr: x.home_team?.abbreviation || null, away_abbr: x.away_team?.abbreviation || null, home_score: Number(x.home_score), away_score: Number(x.away_score), winner_team_id: String(x.winner_team_id) }));
}

/**
 * Where a series winner goes next, read from the bracket: the later-round series that contains the team.
 * null when the bracket has not placed the team yet (or the series won was the Finals). Nothing is inferred.
 */
export function advanceOf(playoffs, teamId, fromSeriesId) {
  const tid = String(teamId);
  const rounds = playoffs?.rounds || [];
  const from = rounds.findIndex((r) => (r.series || []).some((s) => s.series_id === fromSeriesId));
  if (from < 0) return null;
  for (const r of rounds.slice(from + 1)) {
    for (const s of r.series || []) {
      const me = teamOf(s, tid);
      if (!me) continue;
      const opp = [s.higher_seed, s.lower_seed].find((t) => t && String(t.team_id) !== tid) || null;
      const g1 = (s.games || []).find((x) => (x.game_number ?? 0) === 1) || null;
      return {
        round: r.name,
        series_id: s.series_id,
        best_of: s.best_of ?? null,
        seed: me.seed ?? null,
        opponent: opp ? { team_id: String(opp.team_id), name: opp.team_name || null, short_name: opp.short_name || null, abbr: opp.abbreviation || null, seed: opp.seed ?? null } : null,
        game1: g1 ? { game_id: String(g1.game_id), start_utc: g1.start_utc || null, time_tbd: Boolean(g1.time_tbd), home_team_id: String(g1.home_team?.team_id ?? ''), venue: g1.venue?.name || null } : null
      };
    }
  }
  return null;
}

/**
 * Teams whose season is over while a postseason is running: never in the bracket, or lost a decided series.
 * Their injury listings and betting trends are not news until next season (no game can be affected).
 */
export function seasonOverTeams(playoffs) {
  const out = new Set();
  if (!playoffs || playoffs.phase !== 'POSTSEASON') return out;
  for (const s of playoffs.seeds || []) if (s.in_bracket === false) out.add(String(s.team_id));
  for (const r of playoffs.rounds || []) for (const s of r.series || []) {
    if (!s.winner_team_id) continue;
    for (const t of [s.higher_seed?.team_id, s.lower_seed?.team_id]) if (t && String(t) !== String(s.winner_team_id)) out.add(String(t));
  }
  return out;
}
