// PBE runner in dry-run: scoring cadence, shadow observations, one lock at T-15m, incomplete-row refusal,
// grading from the final, arming refusal, and zero Supabase traffic outside armed mode. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pbeTask, modeOf, ROWS_KEY, eligibleFinals } from '../workers/wnba-ingest/src/pbe-runner.js';

const ROWS = zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/pbe-wnba-model/rows-2025-2026.jsonl.gz', import.meta.url))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function kvStore() {
  const m = new Map();
  return { map: m, async get(k, t) { const v = m.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); } };
}

/** Raw ESPN-shaped events rebuilt from the fixture rows (finals), keyed by season. */
function eventsFromRows(season) {
  const by = new Map();
  for (const r of ROWS.filter((x) => x.season === season)) {
    if (!by.has(r.event_id)) by.set(r.event_id, { id: r.event_id, date: r.start_utc, season: { year: season, type: r.season_type }, status: { type: { name: 'STATUS_FINAL' } }, competitions: [{ neutralSite: r.neutral, competitors: [] }] });
    by.get(r.event_id).competitions[0].competitors.push({ id: r.team_id, homeAway: r.home_away, score: String(r.pts), team: { abbreviation: r.team_id } });
  }
  return [...by.values()];
}
function scheduled(id, tipIso, home = '20', away = '18') {
  return { id, date: tipIso, season: { year: 2026, type: 2 }, status: { type: { name: 'STATUS_SCHEDULED' } }, competitions: [{ neutralSite: false, competitors: [{ id: home, homeAway: 'home', team: { abbreviation: 'ATL', displayName: 'Atlanta Dream' } }, { id: away, homeAway: 'away', team: { abbreviation: 'CON', displayName: 'Connecticut Sun' } }] }] };
}

// "now" = the ET day after the last 2026 fixture final, so every prior final is required and present.
const LAST_FINAL = Math.max(...ROWS.filter((r) => r.season === 2026).map((r) => Date.parse(r.start_utc)));
const NOW = LAST_FINAL + 2 * 86400e3;

async function setup({ drop = null } = {}) {
  const kv = kvStore();
  for (const season of [2025, 2026]) {
    const rows = ROWS.filter((r) => r.season === season && r.event_id !== drop);
    await kv.put(ROWS_KEY(season), JSON.stringify({ season, rows, event_ids: [...new Set(rows.map((r) => r.event_id))] }));
  }
  const events = { 2025: eventsFromRows(2025), 2026: [...eventsFromRows(2026), scheduled('G_LOCK', new Date(NOW + 14 * 60e3).toISOString()), scheduled('G_LATER', new Date(NOW + 5 * 3600e3).toISOString(), '9', '17')] };
  const latest = { captured_at: new Date(NOW - 3600e3).toISOString(), events: [{ game_id: 'G_LOCK', home_team_id: '20', away_team_id: '18', commence_time: new Date(NOW + 14 * 60e3).toISOString(), moneyline: { books: [{ book: 'a', home: -500, away: 380 }, { book: 'b', home: -450, away: 350 }] } }] };
  await kv.put('odds:v1:latest', JSON.stringify(latest));
  return { kv, events, env: { WNBA_KV: kv, PBE_MODE: 'dry_run' }, eventsFor: async (y) => events[y] || [] };
}

const noSummaries = async (id) => { throw new Error(`summary fetch not expected in this test (${id})`); };

test('mode gate: off does nothing; armed without owner authorization refuses; unknown mode refuses', async () => {
  const { env, eventsFor } = await setup();
  assert.deepEqual(await pbeTask({ ...env, PBE_MODE: undefined }, { now: NOW, eventsFor }), { skipped: 'PBE_MODE=off' });
  assert.throws(() => modeOf({ PBE_MODE: 'armed' }), /requires PBE_ARMED_BY/);
  assert.throws(() => modeOf({ PBE_MODE: 'live' }), /invalid PBE_MODE/);
  assert.deepEqual(modeOf({ PBE_MODE: 'dry_run' }), { mode: 'dry_run', ledger: 'shadow' });
});

test('dry run: scores, writes shadow observations, locks G_LOCK once at T-15m, never touches Supabase', async (t) => {
  const { kv, env, eventsFor } = await setup();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { throw new Error(`network call in dry run: ${u}`); };
  t.after(() => { globalThis.fetch = realFetch; });

  const s1 = await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries });
  assert.equal(s1.ledger, 'shadow');
  assert.equal(s1.upcoming, 2);
  assert.equal(s1.scored, 2);
  assert.equal(s1.locks, 1);
  assert.deepEqual(s1.skipped, []);
  const lock = JSON.parse(kv.map.get('pbe:v1:shadow:lock:G_LOCK'));
  const pred = JSON.parse(kv.map.get('pbe:v1:shadow:pred:G_LOCK'));
  assert.equal(lock.ledger, 'shadow');
  assert.equal(lock.feature_hash, pred.feature_hash);
  assert.equal(lock.win_probability, pred.pick_probability);
  assert.equal(lock.market_at_lock.available, true);
  assert.ok(!kv.map.has('pbe:v1:shadow:lock:G_LATER'), 'a pre-lock game is never locked');
  assert.ok([...kv.map.keys()].every((k) => !k.startsWith('pbe:v1:official:')), 'dry run writes nothing official');
  assert.equal(JSON.parse(kv.map.get('pbe:v1:shadow:obs:G_LOCK')).length, 1);

  // a minute later: the lock is final, G_LATER is not due (5h out, not a 5-minute mark), nothing re-locks
  const s2 = await pbeTask(env, { now: NOW + 60e3, minute: 1, eventsFor, fetchSummary: noSummaries });
  assert.equal(s2.locks, 0);
  assert.equal(s2.scored, 0);
  assert.equal(kv.map.get('pbe:v1:shadow:lock:G_LOCK'), JSON.stringify(lock), 'lock unchanged');
  const index = JSON.parse(kv.map.get('pbe:v1:shadow:index'));
  assert.deepEqual(index.locked_history, ['G_LOCK']);
  assert.ok(index.games.find((g) => g.game_id === 'G_LOCK').locked);

  // 5-minute mark: G_LATER re-scores; unchanged inputs create no new observation
  const s3 = await pbeTask(env, { now: NOW + 5 * 60e3, minute: 5, eventsFor, fetchSummary: noSummaries });
  assert.equal(s3.scored, 1);
  assert.equal(s3.observations, 0);
});

test('incomplete rows: a missing prior final blocks scoring and locking', async () => {
  const dropped = ROWS.find((r) => r.season === 2026).event_id;
  const { kv, env, eventsFor } = await setup({ drop: dropped });
  const s = await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: async () => { throw new Error('ESPN unavailable'); } });
  assert.deepEqual(s.skipped, ['rows_incomplete']);
  assert.equal(s.rows[2026].complete, false);
  assert.equal(s.scored, 0);
  assert.ok(!kv.map.has('pbe:v1:shadow:lock:G_LOCK'));
});

test('grading: after the final, the shadow lock is graded deterministically from the score', async () => {
  const { kv, env, events, eventsFor } = await setup();
  await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries });
  const lock = JSON.parse(kv.map.get('pbe:v1:shadow:lock:G_LOCK'));
  const g = events[2026].find((e) => e.id === 'G_LOCK');
  g.status.type.name = 'STATUS_FINAL';
  g.competitions[0].competitors[0].score = '88'; // home 20
  g.competitions[0].competitors[1].score = '79'; // away 18
  const s = await pbeTask(env, { now: NOW + 3 * 3600e3, minute: 2, eventsFor, fetchSummary: noSummaries });
  assert.equal(s.grades, 1);
  const grade = JSON.parse(kv.map.get('pbe:v1:shadow:grade:G_LOCK'));
  assert.equal(grade.winner_team_id, '20');
  assert.equal(grade.result, lock.selected_team_id === '20' ? 'win' : 'loss');
  assert.equal(grade.revision, 1);
  const again = await pbeTask(env, { now: NOW + 4 * 3600e3, minute: 3, eventsFor, fetchSummary: noSummaries });
  assert.equal(again.grades, 0, 'never re-graded in place');
});

test('eligible finals use the training franchise rule (>= 10 regular-season finals)', () => {
  const ev = [...eventsFromRows(2026), { id: 'ALLSTAR', date: '2026-07-19T00:00:00Z', season: { year: 2026, type: 2 }, status: { type: { name: 'STATUS_FINAL' } }, competitions: [{ competitors: [{ id: '96', homeAway: 'home' }, { id: '97', homeAway: 'away' }] }] }];
  const finals = eligibleFinals(ev, 2026);
  assert.ok(!finals.some((e) => e.id === 'ALLSTAR'));
  assert.equal(finals.length, new Set(ROWS.filter((r) => r.season === 2026).map((r) => r.event_id)).size);
});
