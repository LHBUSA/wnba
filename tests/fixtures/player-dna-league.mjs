// Synthetic WNBA-shaped archive for Player DNA tests (tests/player-dna*.test.mjs).
// Deterministic: no Math.random, no clock. Four franchises, round-robin, archive-doc shape of game:v1:final.

export const FRANCHISES = ['1', '2', '3', '4'];

function teamStats(rows) {
  const s = (k) => rows.reduce((a, r) => a + (r.dnp ? 0 : Number(r[k]) || 0), 0);
  return {
    'fieldGoalsMade-fieldGoalsAttempted': `${s('fgm')}-${s('fga')}`,
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted': `${s('fg3m')}-${s('fg3a')}`,
    'freeThrowsMade-freeThrowsAttempted': `${s('ftm')}-${s('fta')}`,
    totalRebounds: String(s('reb')),
    offensiveRebounds: String(s('oreb')),
    defensiveRebounds: String(s('dreb')),
    assists: String(s('ast')),
    turnovers: String(s('tov')),
    totalTurnovers: String(s('tov')),
    fouls: String(s('pf'))
  };
}

export function makeDoc({ id, tip, season = 2026, type = 2, home, away, rows, periods = 4, stats = null, completed = true }) {
  const pts = (tid) => rows.filter((r) => r.team_id === tid && !r.dnp).reduce((a, r) => a + (r.pts || 0), 0);
  const line = (n) => Array.from({ length: n }, () => 20);
  return {
    archived_at: tip,
    checksum: `ck-${id}`,
    summary: {
      game: {
        game_id: id,
        season: { year: season, type },
        start_utc: tip,
        status: { completed, state: completed ? 'post' : 'in' },
        home: { team_id: home, name: `Team ${home}`, score: pts(home), linescores: line(periods) },
        away: { team_id: away, name: `Team ${away}`, score: pts(away), linescores: line(periods) }
      },
      box: {
        teams: stats || [
          { team_id: home, stats: teamStats(rows.filter((r) => r.team_id === home)) },
          { team_id: away, stats: teamStats(rows.filter((r) => r.team_id === away)) }
        ],
        players: rows
      },
      injuries: [],
      plays: []
    }
  };
}

// Deterministic pseudo-random ints (no Math.random).
function lcg(seed) {
  let s = seed >>> 0;
  return (lo, hi) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return lo + (s % (hi - lo + 1));
  };
}

export function playerLine(pid, teamId, gi, k) {
  const rnd = lcg(Number(pid) * 7919 + gi * 104729);
  const baseMin = [32, 30, 28, 26, 24, 14, 6][k];
  const min = Math.max(1, baseMin + rnd(-4, 4));
  const fga = Math.max(0, Math.round(min / 3) + rnd(-3, 3) + (k === 0 ? 4 : 0));
  const fgm = Math.min(fga, Math.round(fga * (0.35 + rnd(0, 20) / 100)));
  const fg3a = k === 4 ? 0 : Math.min(fga, rnd(0, k === 1 ? 8 : 4)); // k=4: a non-shooting big
  const fg3m = Math.min(fg3a, fgm, rnd(0, 3));
  const fta = rnd(0, k === 0 ? 9 : 4);
  const ftm = Math.min(fta, rnd(0, fta));
  const oreb = rnd(0, k >= 3 ? 4 : 2);
  const dreb = rnd(0, k >= 3 ? 8 : 4);
  return {
    athlete_id: pid, name: `P${pid}`, team_id: teamId, starter: k < 5, dnp: false, dnp_reason: null, active: true,
    min, pts: 2 * (fgm - fg3m) + 3 * fg3m + ftm, fgm, fga, fg3m, fg3a, ftm, fta,
    oreb, dreb, reb: oreb + dreb, ast: rnd(0, k === 1 ? 9 : 4), stl: rnd(0, 3), blk: rnd(0, k >= 3 ? 3 : 1),
    tov: rnd(0, 4), pf: rnd(0, 5), plus_minus: rnd(-15, 15)
  };
}

/** Round-robin league over FRANCHISES: 7 players per team, `rounds` rounds of 2 games. */
export function league({ season = 2026, rounds = 24, start = Date.UTC(2026, 4, 10, 23), type = 2, idBase = 1000 } = {}) {
  const pairings = [[['1', '2'], ['3', '4']], [['1', '3'], ['2', '4']], [['1', '4'], ['2', '3']]];
  const docs = [];
  let gi = 0;
  for (let r = 0; r < rounds; r += 1) {
    for (const [j, [a, b]] of pairings[r % 3].entries()) {
      const [home, away] = r % 2 ? [b, a] : [a, b];
      const rows = [];
      for (const t of [home, away]) {
        for (let k = 0; k < 7; k += 1) {
          const pid = `${t}${k}${season % 100}`;
          // player k=5 of team 4 misses every third game (DNP) -> availability < 1
          if (t === '4' && k === 5 && r % 3 === 0) { rows.push({ athlete_id: pid, name: `P${pid}`, team_id: t, starter: false, dnp: true, dnp_reason: 'COACH\'S DECISION', min: null }); continue; }
          rows.push(playerLine(pid, t, gi, k));
        }
      }
      const tip = new Date(start + r * 2 * 86400e3 + j * 3600e3).toISOString();
      const doc = makeDoc({ id: String(idBase + gi), tip, season, type, home, away, rows });
      // no ties: WNBA games cannot end level
      if (doc.summary.game.home.score === doc.summary.game.away.score) {
        rows.find((x) => x.team_id === home && !x.dnp).pts += 1;
        doc.summary.game.home.score += 1;
      }
      docs.push(doc);
      gi += 1;
    }
  }
  return docs;
}

export const ALL_STAR = makeDoc({
  id: '401857320', tip: '2026-06-20T00:30:00Z', season: 2026, type: 2, home: '133384', away: '133383',
  rows: [
    { ...playerLine('1026', '133384', 999, 0) },
    { ...playerLine('2126', '133383', 998, 1) },
    { ...playerLine('3026', '133384', 997, 0) },
    { ...playerLine('4326', '133383', 996, 3) }
  ]
});
