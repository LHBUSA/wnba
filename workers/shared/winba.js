// WinBA Score — PropBetEdge WNBA winning-impact index.
//
// V1 is intentionally transparent and deterministic. It uses only final WNBA
// game records already archived by PropBetEdge: points, rebounds, assists,
// minutes played, and whether the player's team won or lost.
//
// Box Impact = PTS + 1.2*REB + 1.5*AST
// WinBA Score =
//   45% league percentile of Box Impact per 36
// + 25% player win rate in games appeared
// + 20% share of Box Impact produced in wins
// + 10% court share (average minutes / 40)
//
// This is an association-with-winning index, not a causal estimate of wins added.

export const WINBA_VERSION = 'winba/1.0.0';
export const WINBA_WEIGHTS = Object.freeze({
  production: 0.45,
  win_rate: 0.25,
  winning_output: 0.20,
  court_share: 0.10
});
export const WINBA_QUALIFICATION = Object.freeze({ min_games: 10, min_minutes: 250 });

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const round = (v, d = 1) => {
  const p = 10 ** d;
  return Math.round((Number(v) || 0) * p) / p;
};

export function winbaBoxImpact({ pts = 0, reb = 0, ast = 0 } = {}) {
  return n(pts) + 1.2 * n(reb) + 1.5 * n(ast);
}

function percentile(value, values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length || !Number.isFinite(value)) return 0;
  if (rows.length === 1) return 1;
  let less = 0;
  let equal = 0;
  for (const x of rows) {
    if (x < value) less += 1;
    else if (x === value) equal += 1;
  }
  // Average tied rank, normalized so the bottom is 0 and top is 1.
  const rank0 = less + Math.max(0, equal - 1) / 2;
  return clamp01(rank0 / (rows.length - 1));
}

function resultForTeam(game, teamId) {
  const h = game?.home;
  const a = game?.away;
  if (!h || !a || !teamId) return null;
  const hs = n(h.score);
  const as = n(a.score);
  if (hs === as) return 'T';
  if (String(teamId) === String(h.team_id)) return hs > as ? 'W' : 'L';
  if (String(teamId) === String(a.team_id)) return as > hs ? 'W' : 'L';
  return null;
}

function regularSeasonOf(doc) {
  const s = doc?.summary?.game?.season;
  return Number(s?.type) === 2;
}

function playerPlayed(row) {
  return !row?.dnp && n(row?.min) > 0 && row?.athlete_id;
}

export function aggregateWinbaArchives(docs = [], { season = null } = {}) {
  const byPlayer = new Map();
  let gamesUsed = 0;
  for (const doc of docs) {
    const summary = doc?.summary;
    const game = summary?.game;
    if (!game?.status?.completed || !regularSeasonOf(doc)) continue;
    if (season !== null && Number(game?.season?.year) !== Number(season)) continue;
    const players = summary?.box?.players || [];
    if (!players.length) continue;
    gamesUsed += 1;
    for (const row of players) {
      if (!playerPlayed(row)) continue;
      const id = String(row.athlete_id);
      const result = resultForTeam(game, row.team_id);
      if (!result || result === 'T') continue;
      const impact = winbaBoxImpact(row);
      const cur = byPlayer.get(id) || {
        athlete_id: id,
        name: row.name || null,
        team_id: row.team_id ? String(row.team_id) : null,
        games: 0,
        wins: 0,
        losses: 0,
        minutes: 0,
        pts: 0,
        reb: 0,
        ast: 0,
        box_impact: 0,
        winning_box_impact: 0,
        latest_game_at: null
      };
      cur.name = row.name || cur.name;
      cur.team_id = row.team_id ? String(row.team_id) : cur.team_id;
      cur.games += 1;
      if (result === 'W') cur.wins += 1;
      else cur.losses += 1;
      cur.minutes += n(row.min);
      cur.pts += n(row.pts);
      cur.reb += n(row.reb);
      cur.ast += n(row.ast);
      cur.box_impact += impact;
      if (result === 'W') cur.winning_box_impact += impact;
      cur.latest_game_at = game.start_utc || cur.latest_game_at;
      byPlayer.set(id, cur);
    }
  }
  return { players: [...byPlayer.values()], games_used: gamesUsed };
}

export function scoreWinbaPlayers(aggregates = [], { season = null, generatedAt = new Date().toISOString() } = {}) {
  const bases = aggregates
    .filter((p) => p.games > 0 && p.minutes > 0)
    .map((p) => {
      const avgMin = p.minutes / p.games;
      const productionPer36 = p.box_impact / p.minutes * 36;
      const winRate = p.games ? p.wins / p.games : 0;
      const winningOutput = p.box_impact > 0 ? p.winning_box_impact / p.box_impact : 0;
      const courtShare = clamp01(avgMin / 40);
      const qualified = p.games >= WINBA_QUALIFICATION.min_games || p.minutes >= WINBA_QUALIFICATION.min_minutes;
      return {
        ...p,
        qualified,
        averages: {
          min: round(avgMin),
          pts: round(p.pts / p.games),
          reb: round(p.reb / p.games),
          ast: round(p.ast / p.games)
        },
        raw: {
          box_impact_per36: productionPer36,
          win_rate: winRate,
          winning_output_share: winningOutput,
          court_share: courtShare
        }
      };
    });
  const qualifiedProductionValues = bases.filter((p) => p.qualified).map((p) => p.raw.box_impact_per36);
  const productionValues = qualifiedProductionValues.length >= 2
    ? qualifiedProductionValues
    : bases.map((p) => p.raw.box_impact_per36);
  const scored = bases.map((p) => {
    const production = percentile(p.raw.box_impact_per36, productionValues);
    const components = {
      production,
      win_rate: clamp01(p.raw.win_rate),
      winning_output: clamp01(p.raw.winning_output_share),
      court_share: clamp01(p.raw.court_share)
    };
    const score = 100 * (
      WINBA_WEIGHTS.production * components.production
      + WINBA_WEIGHTS.win_rate * components.win_rate
      + WINBA_WEIGHTS.winning_output * components.winning_output
      + WINBA_WEIGHTS.court_share * components.court_share
    );
    return {
      athlete_id: p.athlete_id,
      name: p.name,
      team_id: p.team_id,
      season: season !== null ? Number(season) : null,
      score: round(score),
      status: p.qualified ? 'QUALIFIED' : 'PROVISIONAL',
      qualified: p.qualified,
      rank: null,
      sample: {
        games: p.games,
        wins: p.wins,
        losses: p.losses,
        minutes: round(p.minutes, 0)
      },
      averages: p.averages,
      components: {
        production_percentile: round(components.production * 100),
        win_rate: round(components.win_rate * 100),
        winning_output_share: round(components.winning_output * 100),
        court_share: round(components.court_share * 100)
      },
      raw: {
        box_impact_per36: round(p.raw.box_impact_per36, 2),
        box_impact_total: round(p.box_impact, 2),
        winning_box_impact: round(p.winning_box_impact, 2),
        avg_minutes: round(p.averages.min, 1)
      },
      generated_at: generatedAt,
      version: WINBA_VERSION
    };
  });
  const qualified = scored.filter((p) => p.qualified).sort((a, b) => b.score - a.score || b.sample.minutes - a.sample.minutes || a.name.localeCompare(b.name));
  qualified.forEach((p, i) => { p.rank = i + 1; });
  const rankById = new Map(qualified.map((p) => [p.athlete_id, p.rank]));
  const rows = scored
    .map((p) => ({ ...p, rank: rankById.get(p.athlete_id) ?? null }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.score - a.score || a.name.localeCompare(b.name));
  return {
    version: WINBA_VERSION,
    season: season !== null ? Number(season) : null,
    generated_at: generatedAt,
    formula: {
      box_impact: 'PTS + 1.2*REB + 1.5*AST',
      score: '45% production percentile + 25% player win rate + 20% winning-output share + 10% court share',
      production_benchmark: 'Box Impact per 36 percentile against the qualification-eligible league population; provisional players are scored against that benchmark but do not move it.',
      weights: WINBA_WEIGHTS,
      qualification: WINBA_QUALIFICATION,
      interpretation: 'A 0-100 PropBetEdge index of box-score production, playing time and how that production is associated with team wins. It is not a causal wins-added metric.'
    },
    rows,
    qualified_count: qualified.length,
    provisional_count: rows.length - qualified.length
  };
}

export function buildWinbaSnapshot(docs = [], { season = null, generatedAt = new Date().toISOString() } = {}) {
  const agg = aggregateWinbaArchives(docs, { season });
  return {
    ...scoreWinbaPlayers(agg.players, { season, generatedAt }),
    games_used: agg.games_used,
    source: 'PropBetEdge final-game archive derived from ESPN box scores'
  };
}

export function winbaForPlayer(snapshot, athleteId) {
  if (!snapshot?.rows) return null;
  return snapshot.rows.find((r) => String(r.athlete_id) === String(athleteId)) || null;
}
