import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WINBA_VERSION,
  WINBA_WEIGHTS,
  WINBA_QUALIFICATION,
  winbaBoxImpact,
  aggregateWinbaArchives,
  scoreWinbaPlayers,
  buildWinbaSnapshot
} from '../workers/shared/winba.js';

test('WinBA v1 constants and Box Impact are frozen', () => {
  assert.equal(WINBA_VERSION, 'winba/1.0.0');
  assert.deepEqual(WINBA_WEIGHTS, {
    production: 0.45,
    win_rate: 0.25,
    winning_output: 0.20,
    court_share: 0.10
  });
  assert.deepEqual(WINBA_QUALIFICATION, { min_games: 10, min_minutes: 250 });
  assert.equal(winbaBoxImpact({ pts: 20, reb: 10, ast: 5 }), 39.5);
});

test('WinBA exact scoring and ranking are deterministic', () => {
  const rows = scoreWinbaPlayers([
    {
      athlete_id: 'a', name: 'Player A', team_id: '1',
      games: 10, wins: 8, losses: 2, minutes: 320,
      pts: 200, reb: 100, ast: 53.3333333333,
      box_impact: 400, winning_box_impact: 340
    },
    {
      athlete_id: 'b', name: 'Player B', team_id: '2',
      games: 10, wins: 5, losses: 5, minutes: 300,
      pts: 180, reb: 50, ast: 40,
      box_impact: 300, winning_box_impact: 150
    },
    {
      athlete_id: 'c', name: 'Player C', team_id: '3',
      games: 10, wins: 2, losses: 8, minutes: 200,
      pts: 100, reb: 30, ast: 9.3333333333,
      box_impact: 150, winning_box_impact: 20
    }
  ], { season: 2026, generatedAt: '2026-09-18T00:00:00.000Z' });

  const [a, b, c] = rows.rows;
  assert.equal(a.athlete_id, 'a');
  assert.equal(a.rank, 1);
  assert.equal(a.score, 90);
  assert.deepEqual(a.components, {
    production_percentile: 100,
    win_rate: 80,
    winning_output_share: 85,
    court_share: 80
  });

  assert.equal(b.rank, 2);
  assert.equal(b.score, 52.5);
  assert.equal(b.components.production_percentile, 50);

  assert.equal(c.rank, 3);
  assert.equal(c.score, 12.7);
  assert.equal(rows.qualified_count, 3);
  assert.equal(rows.provisional_count, 0);
});

test('provisional players receive a score but cannot move the qualified production benchmark', () => {
  const snap = scoreWinbaPlayers([
    { athlete_id: 'a', name: 'A', team_id: '1', games: 10, wins: 8, losses: 2, minutes: 320, pts: 0, reb: 0, ast: 0, box_impact: 400, winning_box_impact: 340 },
    { athlete_id: 'b', name: 'B', team_id: '2', games: 10, wins: 5, losses: 5, minutes: 300, pts: 0, reb: 0, ast: 0, box_impact: 300, winning_box_impact: 150 },
    { athlete_id: 'c', name: 'C', team_id: '3', games: 10, wins: 2, losses: 8, minutes: 200, pts: 0, reb: 0, ast: 0, box_impact: 150, winning_box_impact: 20 },
    // Extreme two-game sample: it may score highly, but must not lower A's official production percentile.
    { athlete_id: 'p', name: 'Provisional', team_id: '4', games: 2, wins: 2, losses: 0, minutes: 40, pts: 0, reb: 0, ast: 0, box_impact: 100, winning_box_impact: 100 }
  ], { season: 2026 });

  const a = snap.rows.find((x) => x.athlete_id === 'a');
  const p = snap.rows.find((x) => x.athlete_id === 'p');
  assert.equal(a.components.production_percentile, 100);
  assert.equal(a.rank, 1);
  assert.equal(p.status, 'PROVISIONAL');
  assert.equal(p.qualified, false);
  assert.equal(p.rank, null);
  assert.equal(p.components.production_percentile, 100);
  assert.equal(snap.qualified_count, 3);
  assert.equal(snap.provisional_count, 1);
});

function archive({
  id,
  season = 2026,
  type = 2,
  homeScore = 80,
  awayScore = 70,
  players = []
}) {
  return {
    summary: {
      game: {
        game_id: id,
        season: { year: season, type },
        start_utc: '2026-07-01T00:00:00Z',
        status: { state: 'post', completed: true },
        home: { team_id: 'H', score: homeScore },
        away: { team_id: 'A', score: awayScore }
      },
      box: { players }
    }
  };
}

test('archive aggregation uses regular-season finals, appearances and actual team result only', () => {
  const docs = [
    archive({
      id: 'g1',
      players: [
        { athlete_id: '1', name: 'Home Star', team_id: 'H', min: 32, pts: 20, reb: 10, ast: 5, dnp: false },
        { athlete_id: '2', name: 'Away Star', team_id: 'A', min: 30, pts: 18, reb: 4, ast: 6, dnp: false },
        { athlete_id: '3', name: 'DNP', team_id: 'H', min: 0, pts: 0, reb: 0, ast: 0, dnp: true }
      ]
    }),
    archive({
      id: 'post',
      type: 3,
      players: [{ athlete_id: '1', name: 'Home Star', team_id: 'H', min: 35, pts: 40, reb: 12, ast: 7, dnp: false }]
    })
  ];

  const agg = aggregateWinbaArchives(docs, { season: 2026 });
  assert.equal(agg.games_used, 1);
  assert.equal(agg.players.length, 2);

  const home = agg.players.find((p) => p.athlete_id === '1');
  const away = agg.players.find((p) => p.athlete_id === '2');
  assert.equal(home.games, 1);
  assert.equal(home.wins, 1);
  assert.equal(home.losses, 0);
  assert.equal(home.box_impact, 39.5);
  assert.equal(home.winning_box_impact, 39.5);
  assert.equal(away.wins, 0);
  assert.equal(away.losses, 1);
  assert.equal(away.winning_box_impact, 0);

  const snap = buildWinbaSnapshot(docs, { season: 2026, generatedAt: '2026-09-18T00:00:00.000Z' });
  assert.equal(snap.games_used, 1);
  assert.equal(snap.rows.length, 2);
  assert.match(snap.formula.interpretation, /not a causal wins-added metric/i);
  assert.match(snap.formula.production_benchmark, /provisional players.*do not move it/i);
});
