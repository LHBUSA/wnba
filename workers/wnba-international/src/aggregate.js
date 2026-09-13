// Competition aggregates computed by PropBetEdge from normalized games and box scores. Pure and deterministic.
//
// Standings: group-phase games only. FIBA classification points (2 for a win, 1 for a loss); ties broken by the
// games between the tied teams (classification points, then point difference, then points scored), then by all
// group games (point difference, then points scored). The method is published with the table.

export const STANDINGS_METHOD = 'Computed by PropBetEdge from group-phase results: 2 classification points for a win, 1 for a loss; ties broken by the games between the tied teams (points, point difference, points scored), then by point difference and points scored in all group games.';
export const EFFICIENCY_METHOD = 'Efficiency (FIBA formula) = PTS + REB + AST + STL + BLK − missed field goals − missed free throws − turnovers, computed by PropBetEdge from provider box scores.';

const row = (team) => ({ team, played: 0, wins: 0, losses: 0, points_for: 0, points_against: 0, diff: 0, class_points: 0 });

function table(games, teamIds) {
  const rows = new Map(teamIds.map((id) => [id, null]));
  for (const g of games) {
    for (const [us, them, ps, pa] of [[g.home_team, g.away_team, g.home_score, g.away_score], [g.away_team, g.home_team, g.away_score, g.home_score]]) {
      if (!rows.has(us.team_id)) continue;
      if (!teamIds.includes(them.team_id)) continue;
      const r = rows.get(us.team_id) || row(us);
      r.played += 1; r.points_for += ps; r.points_against += pa; r.diff = r.points_for - r.points_against;
      if (ps > pa) { r.wins += 1; r.class_points += 2; } else { r.losses += 1; r.class_points += 1; }
      rows.set(us.team_id, r);
    }
  }
  return rows;
}

export function groupStandings(games) {
  const finals = games.filter((g) => g.phase === 'group' && g.status === 'final' && g.home_score !== null && g.away_score !== null);
  const groups = new Map();
  for (const g of games.filter((x) => x.phase === 'group')) {
    if (!groups.has(g.group)) groups.set(g.group, new Map());
    for (const t of [g.home_team, g.away_team]) groups.get(g.group).set(t.team_id, t);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, teams]) => {
    const ids = [...teams.keys()];
    const gg = finals.filter((g) => g.group === group);
    const all = table(gg, ids);
    const entries = ids.map((id) => all.get(id) || row(teams.get(id)));
    const cmp = (x, y) => y.class_points - x.class_points;
    entries.sort(cmp);
    // Resolve each block of teams level on classification points with the tied-teams mini-table.
    const out = [];
    for (let i = 0; i < entries.length;) {
      let j = i;
      while (j < entries.length && entries[j].class_points === entries[i].class_points) j += 1;
      const block = entries.slice(i, j);
      if (block.length > 1) {
        const tiedIds = block.map((r) => r.team.team_id);
        const mini = table(gg, tiedIds);
        const m = (r) => mini.get(r.team.team_id) || row(r.team);
        block.sort((x, y) => m(y).class_points - m(x).class_points || m(y).diff - m(x).diff || m(y).points_for - m(x).points_for || y.diff - x.diff || y.points_for - x.points_for || x.team.name.localeCompare(y.team.name));
      }
      out.push(...block);
      i = j;
    }
    return { group, entries: out.map((r, k) => ({ rank: k + 1, ...r })), method: STANDINGS_METHOD };
  });
}

const ROUND_ORDER = ['QQF', 'QF', 'SF', 'FINAL'];

/** Knockout bracket as rounds of games; each game links to the game its winner plays next (by team presence). */
export function bracket(games) {
  const ko = games.filter((g) => g.phase === 'knockout').sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)) || a.game_id.localeCompare(b.game_id));
  const rounds = ROUND_ORDER.map((r) => ({ round: r, round_name: ko.find((g) => g.round === r)?.round_name || r, games: ko.filter((g) => g.round === r) })).filter((r) => r.games.length);
  for (let i = 0; i < rounds.length - 1; i += 1) {
    for (const g of rounds[i].games) {
      const next = rounds[i + 1].games.find((n) => g.winner && [n.home_team_id, n.away_team_id].includes(g.winner));
      g.next_game_id = next?.game_id || null;
    }
  }
  const bronze = ko.filter((g) => g.round === 'BRONZE');
  const final = ko.find((g) => g.round === 'FINAL') || null;
  const medals = final?.status === 'final' ? {
    gold: final.winner === final.home_team_id ? final.home_team : final.away_team,
    silver: final.winner === final.home_team_id ? final.away_team : final.home_team,
    bronze: bronze[0]?.status === 'final' ? (bronze[0].winner === bronze[0].home_team_id ? bronze[0].home_team : bronze[0].away_team) : null
  } : null;
  return { rounds, bronze_game: bronze[0] || null, medals };
}

/** Players and teams across the competition from completed box scores. */
export function playerAndTeamStats(boxes) {
  const players = new Map();
  const teams = new Map();
  for (const { game, boxscore } of boxes) {
    if (!boxscore || game.status !== 'final') continue;
    for (const side of boxscore.teams) {
      const t = side.team;
      const opp = side.team.team_id === game.home_team_id ? game.away_team : game.home_team;
      const tr = teams.get(t.team_id) || { team: t, games: 0, totals: {}, roster: new Map() };
      tr.games += 1;
      for (const [k, v] of Object.entries(side.totals)) if (Number.isFinite(v)) tr.totals[k] = (tr.totals[k] || 0) + v;
      teams.set(t.team_id, tr);
      for (const p of side.players) {
        if (p.did_not_play || !p.min) continue;
        const pr = players.get(p.player_id) || { player_id: p.player_id, provider_ids: p.provider_ids, name: p.name, jersey: p.jersey, team: t, games: 0, starts: 0, totals: {}, log: [] };
        pr.games += 1; pr.starts += p.starter ? 1 : 0; pr.jersey = p.jersey || pr.jersey;
        for (const k of ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'pf']) if (Number.isFinite(p[k])) pr.totals[k] = (pr.totals[k] || 0) + p[k];
        pr.log.push({ game_id: game.game_id, scheduled_at: game.scheduled_at, round_name: game.round_name, opponent: opp, result: game.winner === t.team_id ? 'W' : 'L', team_score: t.team_id === game.home_team_id ? game.home_score : game.away_score, opp_score: t.team_id === game.home_team_id ? game.away_score : game.home_score, min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, tov: p.tov, fgm: p.fgm, fga: p.fga, fg3m: p.fg3m, fg3a: p.fg3a, ftm: p.ftm, fta: p.fta, starter: p.starter });
        players.set(p.player_id, pr);
        tr.roster.set(p.player_id, { player_id: p.player_id, name: p.name, jersey: p.jersey });
      }
    }
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const eff = (t) => (t.pts || 0) + (t.reb || 0) + (t.ast || 0) + (t.stl || 0) + (t.blk || 0) - ((t.fga || 0) - (t.fgm || 0)) - ((t.fta || 0) - (t.ftm || 0)) - (t.tov || 0);
  const playerList = [...players.values()].map((p) => {
    const per = Object.fromEntries(Object.entries(p.totals).map(([k, v]) => [k, r1(v / p.games)]));
    const highs = Object.fromEntries(['pts', 'reb', 'ast'].map((k) => [k, p.log.reduce((m, g) => (Number.isFinite(g[k]) && g[k] > (m?.value ?? -1) ? { value: g[k], game_id: g.game_id } : m), null)]));
    return { ...p, log: p.log.sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))), averages: { ...per, eff: r1(eff(p.totals) / p.games), fg_pct: p.totals.fga ? r1((100 * p.totals.fgm) / p.totals.fga) : null, fg3_pct: p.totals.fg3a ? r1((100 * p.totals.fg3m) / p.totals.fg3a) : null, ft_pct: p.totals.fta ? r1((100 * p.totals.ftm) / p.totals.fta) : null }, highs };
  });
  const teamList = [...teams.values()].map((t) => ({ team: t.team, games: t.games, averages: Object.fromEntries(Object.entries(t.totals).map(([k, v]) => [k, r1(v / t.games)])), roster: [...t.roster.values()].sort((a, b) => Number(a.jersey || 99) - Number(b.jersey || 99)) }));
  return { players: playerList, teams: teamList };
}

export const LEADER_STATS = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['eff', 'Efficiency']];

/** Per-game leaders; a player qualifies after appearing in at least `minGames` games. */
export function leaders(players, { minGames = 3, limit = 10 } = {}) {
  return LEADER_STATS.map(([stat, label]) => ({
    stat, label, min_games: minGames, method: stat === 'eff' ? EFFICIENCY_METHOD : 'Per-game average across completed games, computed by PropBetEdge from provider box scores.',
    rows: players.filter((p) => p.games >= minGames && Number.isFinite(p.averages[stat])).sort((a, b) => b.averages[stat] - a.averages[stat] || b.games - a.games || a.name.localeCompare(b.name)).slice(0, limit)
      .map((p, i) => ({ rank: i + 1, player_id: p.player_id, name: p.name, team: p.team, games: p.games, value: p.averages[stat] }))
  }));
}

export function teamRecords(games) {
  const rec = new Map();
  for (const g of games.filter((x) => x.status === 'final' && x.winner)) {
    for (const t of [g.home_team, g.away_team]) {
      const r = rec.get(t.team_id) || { wins: 0, losses: 0 };
      if (g.winner === t.team_id) r.wins += 1; else r.losses += 1;
      rec.set(t.team_id, r);
    }
  }
  return rec;
}

/** Remove duplicate games (same provider id) keeping the most recently fetched copy. */
export function dedupeGames(games) {
  const by = new Map();
  for (const g of games) {
    const k = g.provider_ids?.espn || g.game_id;
    const prev = by.get(k);
    if (!prev || String(g.fetched_at || '') >= String(prev.fetched_at || '')) by.set(k, g);
  }
  return [...by.values()].sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)) || a.game_id.localeCompare(b.game_id));
}
