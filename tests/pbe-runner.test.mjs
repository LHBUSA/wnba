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

test('lock-policy evidence: checkpoints due at T-60/T-30/T-15/T-0, feed diff, near-tip flag and recorded snapshots', async () => {
  const { checkpointsDue, diffAvailability, teamAvailability } = await import('../workers/wnba-ingest/src/pbe-runner.js');
  const tip = '2026-09-17T23:30:00.000Z';
  const t = Date.parse(tip);
  assert.deepEqual(checkpointsDue(tip, [], t - 61 * 60e3), []);
  assert.deepEqual(checkpointsDue(tip, [], t - 45 * 60e3), [60]);
  assert.deepEqual(checkpointsDue(tip, ['60'], t - 16 * 60e3), [30]);
  assert.deepEqual(checkpointsDue(tip, ['60', '30'], t - 60e3), [15]);
  assert.deepEqual(checkpointsDue(tip, ['60', '30', '15'], t + 60e3), [0]);
  assert.deepEqual(checkpointsDue(tip, [], t + 30 * 60e3), [], 'too late to record honestly');
  const snap = { items: { a: { athlete_id: '1', team_id: '20', status: 'Day-To-Day', source_updated_at: 'x' }, b: { athlete_id: '2', team_id: '18', status: 'Out', source_updated_at: 'y' }, c: { athlete_id: '3', team_id: '5', status: 'Out' } } };
  const before = teamAvailability(snap, ['20', '18']);
  assert.equal(before.length, 2);
  const after = teamAvailability({ items: { a: { ...snap.items.a, status: 'Out', source_updated_at: 'z' }, d: { athlete_id: '4', team_id: '20', status: 'Questionable' } } }, ['20', '18']);
  assert.deepEqual(diffAvailability(before, after).map((c) => c.kind).sort(), ['added', 'removed', 'status_changed']);

  const { kv, env, eventsFor } = await setup();
  await kv.put('avail:v1:snapshot', JSON.stringify({ captured_at: new Date(NOW - 60e3).toISOString(), ...snap }));
  const s = await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries });
  assert.ok(Date.parse(kv.map.get('pbe:v1:near_tip_until')) > NOW, 'near-tip flag set (G_LOCK tips in 14 min)');
  const chk = JSON.parse(kv.map.get('pbe:v1:shadow:availchk:G_LOCK'));
  assert.deepEqual(Object.keys(chk.checkpoints).sort(), ['15', '30', '60']);
  assert.equal(chk.checkpoints['15'].players.length, 2);
  assert.ok(!kv.map.has('pbe:v1:shadow:availchk:G_LATER'), 'a game 5h out records nothing');
  assert.equal(s.availability_checkpoints, 3);
});

// ------------------------------------------------------------------ armed mode (official ledger) against a fake PostgREST

/** Minimal PostgREST stand-in. `lockFail(row)` may return { status, code, message } to refuse a lock insert. */
function fakeSupabase({ lockFail = () => null, existingLocks = [], existingGrades = [] } = {}) {
  const db = { observations: [], locks: [...existingLocks], grades: [...existingGrades], calls: [] };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (u, init = {}) => {
    const url = new URL(u);
    if (url.hostname !== 'ledger.test') throw new Error(`unexpected network call: ${u}`);
    const table = url.pathname.split('/').pop();
    db.calls.push(`${init.method || 'GET'} ${table}`);
    if ((init.method || 'GET') === 'GET') {
      if (table === 'wnba_pbe_locked_predictions') {
        const gid = (url.searchParams.get('game_id') || '').replace('eq.', '');
        return reply(db.locks.filter((l) => l.game_id === gid));
      }
      if (table === 'wnba_pbe_grade_revisions') {
        const pid = (url.searchParams.get('prediction_id') || '').replace('eq.', '');
        const rev = Number((url.searchParams.get('revision') || '').replace('eq.', ''));
        return reply(db.grades.filter((g) => g.prediction_id === pid && (!Number.isFinite(rev) || g.revision === rev)));
      }
      throw new Error(`unexpected GET table ${table}`);
    }
    const row = JSON.parse(init.body);
    if (table === 'wnba_pbe_prediction_observations') {
      const stored = { ...row, observation_id: `obs-${db.observations.length + 1}`, recorded_at: new Date().toISOString() };
      db.observations.push(stored);
      return reply([stored], 201);
    }
    if (table === 'wnba_pbe_locked_predictions') {
      const refuse = lockFail(row);
      if (refuse) return reply({ code: refuse.code, message: refuse.message }, refuse.status);
      if (db.locks.some((l) => l.game_id === row.game_id)) return reply({ code: '23505', message: 'duplicate key value violates unique constraint "wnba_pbe_lock_one_per_game"' }, 409);
      const stored = { ...row, prediction_id: `pred-${db.locks.length + 1}`, locked_at: '2026-01-01T00:00:00+00:00' };
      db.locks.push(stored);
      return reply([stored], 201);
    }
    if (table === 'wnba_pbe_grade_revisions') {
      if (db.grades.some((g) => g.prediction_id === row.prediction_id && g.revision === row.revision)) {
        return reply({ code: '23505', message: 'duplicate key value violates unique constraint "wnba_pbe_grade_revision_unique"' }, 409);
      }
      const stored = { ...row, grade_id: `grade-${db.grades.length + 1}`, graded_at: '2026-01-01T03:00:00+00:00' };
      db.grades.push(stored);
      return reply([stored], 201);
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { db, fetchImpl };
}

/** Two games sharing one tip time (the normal WNBA slate shape), both inside the lock window. */
async function armedSetup(t, supabase) {
  const base = await setup();
  const tip = new Date(NOW + 14 * 60e3).toISOString();
  base.events[2026] = [...eventsFromRows(2026), scheduled('G_A', tip), scheduled('G_B', tip, '9', '17')];
  const realFetch = globalThis.fetch;
  globalThis.fetch = supabase.fetchImpl;
  t.after(() => { globalThis.fetch = realFetch; });
  const env = { WNBA_KV: base.kv, PBE_MODE: 'armed', PBE_ARMED_BY: 'test approval', PBE_SUPABASE_URL: 'https://ledger.test', PBE_SUPABASE_SERVICE_ROLE_KEY: 'k' };
  return { ...base, env };
}

test('armed: two games at one tip time both lock, each from its own recorded observation', async (t) => {
  const supabase = fakeSupabase();
  const { kv, env, eventsFor } = await armedSetup(t, supabase);
  const s = await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries });
  assert.equal(s.locks, 2);
  assert.deepEqual(s.errors, []);
  for (const id of ['G_A', 'G_B']) {
    const lock = JSON.parse(kv.map.get(`pbe:v1:official:lock:${id}`));
    const row = supabase.db.locks.find((l) => l.game_id === id);
    assert.equal(lock.prediction_id, row.prediction_id);
    assert.equal(supabase.db.observations.find((o) => o.observation_id === row.source_observation_id).game_id, id);
  }
  assert.deepEqual(JSON.parse(kv.map.get('pbe:v1:official:index')).locked_history, ['G_A', 'G_B']);
});

test('armed: one refused lock never takes the other game at that tip time down with it, and the error is kept', async (t) => {
  const supabase = fakeSupabase({ lockFail: (row) => row.game_id === 'G_A' ? { status: 400, code: 'P0001', message: 'wnba_pbe: lock for game G_A does not match its source observation' } : null });
  const { kv, env, eventsFor } = await armedSetup(t, supabase);
  await assert.rejects(pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries }), /pbe_armed_errors:G_A@lock:.*does not match its source observation/);
  assert.ok(!kv.map.has('pbe:v1:official:lock:G_A'), 'a refused lock is never mirrored');
  assert.ok(kv.map.has('pbe:v1:official:lock:G_B'), 'the second game still locks in the same pass');
  const index = JSON.parse(kv.map.get('pbe:v1:official:index'));
  assert.deepEqual(index.locked_history, ['G_B']);
  assert.equal(index.last_errors.errors[0].game_id, 'G_A');
  assert.equal(index.last_errors.errors[0].stage, 'lock');
  assert.equal(index.last_summary.locks, 1);
});

test('armed: a lock the ledger already holds is mirrored from the ledger row, not skipped and not rebuilt', async (t) => {
  const ledgerRow = { game_id: 'G_A', contract: 'game_winner_v1', prediction_id: 'pred-first', locked_at: '2026-09-01T00:00:00+00:00', generated_at: '2026-08-31T23:59:00+00:00', call: 'PICK', no_call_reason: null, p_home: 0.61, selected_team_id: '20', selected_side: 'home', win_probability: 0.61, confidence: 'medium', feature_vector: { order: ['f'], values: [1] }, feature_hash: 'a'.repeat(64), reasoning: { home: { supporting: [], opposing: [], adjustments: [] }, away: { supporting: [], opposing: [], adjustments: [] } }, market_at_lock: null, pbe_edge_at_lock: null };
  const supabase = fakeSupabase({ existingLocks: [ledgerRow] });
  const { kv, env, eventsFor } = await armedSetup(t, supabase);
  const s = await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries });
  assert.ok(s.skipped.includes('already_locked_mirrored:G_A'));
  const lock = JSON.parse(kv.map.get('pbe:v1:official:lock:G_A'));
  assert.equal(lock.prediction_id, 'pred-first');
  assert.equal(lock.p_home, 0.61, 'the frozen ledger value, not the newer document');
  assert.equal(lock.win_probability, 0.61);
  assert.equal(lock.mirrored_from_ledger, true);
  assert.ok(kv.map.has('pbe:v1:official:lock:G_B'));
  // next minute: nothing is re-attempted for either game
  const before = supabase.db.calls.length;
  const s2 = await pbeTask(env, { now: NOW + 60e3, minute: 1, eventsFor, fetchSummary: noSummaries });
  assert.equal(s2.locks, 0);
  assert.equal(supabase.db.calls.length, before);
});


test('armed: grade written to ledger but missing from KV is recovered idempotently on the next pass', async (t) => {
  const supabase = fakeSupabase();
  const { kv, env, events, eventsFor } = await armedSetup(t, supabase);
  await pbeTask(env, { now: NOW, minute: 0, eventsFor, fetchSummary: noSummaries });

  for (const id of ['G_A', 'G_B']) {
    const g = events[2026].find((e) => e.id === id);
    g.status.type.name = 'STATUS_FINAL';
    g.competitions[0].competitors[0].score = id === 'G_A' ? '88' : '77';
    g.competitions[0].competitors[1].score = id === 'G_A' ? '79' : '81';
  }

  const originalPut = kv.put.bind(kv);
  let failOnce = true;
  kv.put = async (key, value, opts) => {
    if (failOnce && key === 'pbe:v1:official:grade:G_A') {
      failOnce = false;
      throw new Error('simulated KV mirror failure after grade insert');
    }
    return originalPut(key, value, opts);
  };

  await assert.rejects(
    pbeTask(env, { now: NOW + 3 * 3600e3, minute: 2, eventsFor, fetchSummary: noSummaries }),
    /pbe_armed_errors:G_A@grade:simulated KV mirror failure/
  );
  assert.equal(supabase.db.grades.filter((g) => g.prediction_id === supabase.db.locks.find((l) => l.game_id === 'G_A').prediction_id).length, 1, 'ledger got exactly one grade');
  assert.ok(kv.map.has('pbe:v1:official:grade:G_B'), 'other final still grades in the same pass');
  assert.ok(!kv.map.has('pbe:v1:official:grade:G_A'), 'the simulated mirror failure left A missing in KV');

  kv.put = originalPut;
  const s2 = await pbeTask(env, { now: NOW + 4 * 3600e3, minute: 3, eventsFor, fetchSummary: noSummaries });
  assert.equal(s2.grades, 1, 'the missing KV grade is repaired');
  assert.ok(s2.skipped.includes('already_graded_mirrored:G_A'));
  const repaired = JSON.parse(kv.map.get('pbe:v1:official:grade:G_A'));
  const ledgerGrade = supabase.db.grades.find((g) => g.prediction_id === supabase.db.locks.find((l) => l.game_id === 'G_A').prediction_id);
  assert.equal(repaired.grade_id, ledgerGrade.grade_id);
  assert.equal(repaired.result, ledgerGrade.result);
  assert.equal(supabase.db.grades.filter((g) => g.prediction_id === ledgerGrade.prediction_id).length, 1, 'no duplicate grade inserted');
});
