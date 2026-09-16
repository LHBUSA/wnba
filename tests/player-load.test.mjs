import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerLoadSnapshot, playerLoadBand } from '../workers/shared/player-load.js';

const NOW = Date.parse('2026-09-16T20:00:00Z');
const game = (id, hoursAgo, playerRows, period = 4) => ({
  game_id: id,
  start_utc: new Date(NOW - hoursAgo * 3600e3).toISOString(),
  status: { state: 'post', completed: true, period },
  home: { team_id: 'A' }, away: { team_id: 'B' },
  players: playerRows
});
const row = (id, team, min, starter = true) => ({ athlete_id: id, name: id === '1' ? 'High Load' : 'Low Load', team_id: team, min, starter, dnp: false });
const teammateRows = (id, min, starter = true) => [row(id, 'A', min, starter), ...Array.from({ length: 6 }, (_, i) => ({ athlete_id: `R${i}`, name: `R${i}`, team_id: 'A', min: 20, starter: i < 4, dnp: false }))];

const games = [
  game('g1', 18, teammateRows('1', 40), 5),
  game('g2', 62, teammateRows('1', 39)),
  game('g3', 92, teammateRows('1', 38)),
  game('g4', 132, teammateRows('1', 37)),
  game('g5', 18, [row('2', 'B', 20)])
];
const upcoming = [{ game_id: 'next', start_utc: new Date(NOW + 6 * 3600e3).toISOString(), home: { team_id: 'A' }, away: { team_id: 'C' }, status: { state: 'pre' } }];

function build(status = 'Questionable') {
  return buildPlayerLoadSnapshot({
    now: NOW,
    games,
    upcomingGames: upcoming,
    athletes: [{ athlete_id: '1', name: 'High Load', team_id: 'A' }, { athlete_id: '2', name: 'Low Load', team_id: 'B' }],
    teams: [{ team_id: 'A', name: 'Alpha', abbr: 'ALP' }, { team_id: 'B', name: 'Beta', abbr: 'BET' }],
    availability: { items: { one: { athlete_id: '1', team_id: 'A', status } } }
  });
}

test('load bands are deterministic at documented cut points', () => {
  assert.equal(playerLoadBand(34), 'LIGHT');
  assert.equal(playerLoadBand(35), 'NORMAL');
  assert.equal(playerLoadBand(55), 'ELEVATED');
  assert.equal(playerLoadBand(70), 'HEAVY');
  assert.equal(playerLoadBand(85), 'EXTREME');
});

test('dense minutes, short turnaround and overtime rank above a light workload', () => {
  const snap = build();
  const high = snap.players.find((p) => p.athlete_id === '1');
  const low = snap.players.find((p) => p.athlete_id === '2');
  assert.ok(high.score >= 70, `expected heavy load, got ${high.score}`);
  assert.ok(high.score > low.score);
  assert.ok(high.signals.some((s) => /turnaround/i.test(s)));
  assert.equal(high.metrics.overtime_games_7d, 1);
  assert.equal(snap.players[0].athlete_id, '1');
});

test('availability is context only and never changes the score', () => {
  const a = build('Questionable').players.find((p) => p.athlete_id === '1');
  const b = build('Out').players.find((p) => p.athlete_id === '1');
  assert.equal(a.score, b.score);
  assert.equal(a.availability_affects_score, false);
  assert.notEqual(a.availability.status, b.availability.status);
});
