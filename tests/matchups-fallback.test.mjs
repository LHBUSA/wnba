import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMatchupsList, matchupsListView } from '../src/views/matchups.js';

const GAME = {
  game_id: 'canary-game',
  start_utc: '2026-09-17T00:00:00Z',
  status: { state: 'pre', name: 'STATUS_SCHEDULED' },
  away: { team_id: '1', abbr: 'AWY', short_name: 'Away', name: 'Away', score: null },
  home: { team_id: '2', abbr: 'HME', short_name: 'Home', name: 'Home', score: null },
  venue: null,
  market: null
};

test('matchups list falls back to the API verified current/next slate when range schedule is unavailable', async () => {
  const api = {
    schedule: async () => ({ ok: false, error: { code: 'schedule_unavailable' } }),
    today: async () => ({
      ok: true,
      data: { slate: { date: '20260917', games: [GAME], summary: { state: 'SCHEDULED', total: 1 } } },
      meta: { freshness: 'CURRENT', degraded: [] }
    })
  };

  const out = await loadMatchupsList(api);
  assert.equal(out.res.ok, true);
  assert.equal(out.res.data.games.length, 1);
  assert.equal(out.res.meta.semantics, 'SCHEDULE_FALLBACK_VERIFIED_SLATE');
  assert.deepEqual(out.res.meta.degraded, ['primary_schedule:schedule_unavailable']);

  const rendered = String(matchupsListView(out));
  assert.match(rendered, /Showing the next verified slate/);
  assert.match(rendered, /canary-game/);
  assert.doesNotMatch(rendered, /The schedule is unavailable/);
});

test('matchups list keeps the full schedule response when it succeeds', async () => {
  let todayCalls = 0;
  const schedule = {
    ok: true,
    data: { games: [GAME] },
    meta: { semantics: 'SCHEDULE', freshness: 'CURRENT' }
  };
  const api = {
    schedule: async () => schedule,
    today: async () => { todayCalls += 1; return { ok: false }; }
  };

  const out = await loadMatchupsList(api);
  assert.equal(out.res, schedule);
  assert.equal(todayCalls, 0);
  assert.doesNotMatch(String(matchupsListView(out)), /Showing the next verified slate/);
});
