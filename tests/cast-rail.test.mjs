// WNBACast rail: every live card is fed by /v1/today, starting with the first
// selected-game paint. Regression: the refresh timestamp used to start at
// Date.now(), which swallowed the first refresh and left other live games blank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { groupRailGames, patchRailGame, mergeSlate, createRailRefresher, railGames, RAIL_REFRESH_MS } from '../src/lib/cast-rail.js';

const game = (id, state, o = {}) => ({ game_id: id, start_utc: o.start || '2026-09-18T23:30Z', status: { state, period: o.period ?? 0, clock: o.clock ?? null }, away: { abbr: o.away || 'SEA', score: o.as ?? null }, home: { abbr: o.home || 'LV', score: o.hs ?? null } });
const today = (games, last = []) => ({ ok: true, data: { slate: { games }, last_results: { games: last } } });
const score = (rail, id) => { const g = railGames(rail).find((x) => x.game_id === id); return g ? `${g.away.score}-${g.home.score}` : null; };

// The schedule the rail is built from: two games already live but carrying no
// score yet (the schedule feed lags), plus a final that is the selected game.
const schedule = () => [
  game('401857197', 'in', { away: 'NY', home: 'IND' }),
  game('401857198', 'in', { away: 'MIN', home: 'PHX' }),
  game('401857190', 'post', { start: '2026-09-17T23:00Z', as: 80, hs: 77 })
];

test('1 · the first refresh fires immediately and fills both live games, neither selected', async () => {
  let clock = Date.parse('2026-09-18T23:50:00Z');
  let calls = 0;
  const refresh = createRailRefresher({
    now: () => clock,
    fetchToday: async () => { calls += 1; return today([game('401857197', 'in', { away: 'NY', home: 'IND', as: 21, hs: 18, period: 1 }), game('401857198', 'in', { away: 'MIN', home: 'PHX', as: 9, hs: 14, period: 1 })]); }
  });
  let rail = groupRailGames(schedule());
  assert.equal(score(rail, '401857197'), 'null-null', 'blank before the slate lands');

  // First selected-game paint (the selected game is the final, 401857190).
  const fresh = await refresh();
  assert.equal(calls, 1, 'no 15-second wait before the first /v1/today');
  rail = mergeSlate(rail, fresh, { keep: game('401857190', 'post', { as: 80, hs: 77 }) });
  assert.equal(score(rail, '401857197'), '21-18');
  assert.equal(score(rail, '401857198'), '9-14');
  assert.deepEqual(rail.live.map((g) => g.game_id), ['401857197', '401857198']);
});

test('2 · after the initial refresh the 15-second throttle holds, then both scores advance again', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const frames = [
    [game('401857197', 'in', { as: 21, hs: 18 }), game('401857198', 'in', { as: 9, hs: 14 })],
    [game('401857197', 'in', { as: 30, hs: 29 }), game('401857198', 'in', { as: 22, hs: 25 })]
  ];
  const refresh = createRailRefresher({ now: () => clock, fetchToday: async () => today(frames[calls++]) });
  let rail = mergeSlate(groupRailGames(schedule()), await refresh());

  clock += 8000; // the selected game's own 8s poll
  assert.equal(await refresh(), null, 'throttled');
  clock += RAIL_REFRESH_MS - 8001;
  assert.equal(await refresh(), null, 'still throttled at 14.999s');
  assert.equal(calls, 1);

  clock += 1;
  rail = mergeSlate(rail, await refresh());
  assert.equal(calls, 2);
  assert.equal(score(rail, '401857197'), '30-29');
  assert.equal(score(rail, '401857198'), '22-25');
});

test('3 · games re-group as states advance: pre → live → final', () => {
  let rail = groupRailGames([game('A', 'pre'), game('B', 'in', { as: 50, hs: 48 }), game('C', 'post', { start: '2026-09-17T23:00Z', as: 70, hs: 66 })]);
  rail = mergeSlate(rail, [game('A', 'in', { as: 2, hs: 0 }), game('B', 'post', { as: 88, hs: 81 })]);
  assert.deepEqual(rail.upcoming.map((g) => g.game_id), []);
  assert.deepEqual(rail.live.map((g) => g.game_id), ['A']);
  assert.deepEqual(rail.finals.map((g) => g.game_id), ['B', 'C']);
  assert.equal(score(rail, 'B'), '88-81');
  assert.equal(railGames(rail).length, 3, 'merged by game_id, never duplicated');
});

test('4 · a slate game the rail has never seen is added; a stale slate never steps the selected game back', () => {
  let rail = groupRailGames([game('A', 'in', { as: 40, hs: 41 })]);
  const own = game('A', 'in', { as: 44, hs: 41 }); // selected game, from /live
  rail = patchRailGame(rail, own);
  rail = mergeSlate(rail, [game('A', 'in', { as: 40, hs: 41 }), game('Z', 'in', { as: 5, hs: 3 })], { keep: own });
  assert.equal(score(rail, 'A'), '44-41');
  assert.equal(score(rail, 'Z'), '5-3');
  // …but the slate may still move the selected game forward a phase.
  rail = mergeSlate(rail, [game('A', 'post', { as: 90, hs: 85 })], { keep: own });
  assert.deepEqual(rail.finals.map((g) => g.game_id), ['A']);
});

test('5 · a failed or empty /v1/today leaves the rail alone', async () => {
  const bad = createRailRefresher({ now: () => 5e6, fetchToday: async () => ({ ok: false }) });
  assert.equal(await bad(), null);
  const emptySlate = createRailRefresher({ now: () => 5e6, fetchToday: async () => today([]) });
  assert.equal(await emptySlate(), null);
});

test('6 · cast.js uses the shared refresher and keeps the rail ticking while other games are live', () => {
  const src = readFileSync(new URL('../src/pages/cast.js', import.meta.url), 'utf8');
  assert.ok(!/lastRailRefreshAt/.test(src), 'no page-local refresh timestamp');
  assert.match(src, /createRailRefresher\(/);
  assert.match(src, /othersLive \? RAIL_REFRESH_MS/);
});
