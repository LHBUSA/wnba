import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduled, freshTickStatusCurrent, SNAPSHOT_KEY, STATUS_KEY, VERSION, REFRESH_MS } from '../workers/wnba-player-load/src/index.js';

function countingKv(seed = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const puts = [];
  return {
    map, puts,
    async get(key, type) { const v = map.get(key); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { puts.push(key); map.set(key, value); }
  };
}

const T0 = Date.parse('2026-10-07T12:00:00Z');
const snapshot = (at) => ({ schema: 'pbe-player-load/1', generated_at: new Date(at).toISOString(), summary: { players: 3 } });
const healthy = (at, gen) => ({ service: 'wnba-player-load', version: VERSION, state: 'HEALTHY', last_attempt_at: new Date(at).toISOString(), last_success_at: new Date(at).toISOString(), last_error: null, snapshot_generated_at: gen });

test('fresh-snapshot ticks after a healthy refresh write nothing (was 2 status writes per minute)', async () => {
  const snap = snapshot(T0);
  const kv = countingKv({ [SNAPSHOT_KEY]: snap, [STATUS_KEY]: healthy(T0, snap.generated_at) });
  const before = new Map(kv.map);
  for (let m = 1; m < 15; m += 1) {
    const r = await runScheduled({ WNBA_KV: kv }, { now: T0 + m * 60e3 });
    assert.deepEqual(r, { skipped: 'fresh_snapshot', generated_at: snap.generated_at });
  }
  assert.equal(kv.puts.length, 0);
  // Readers (GET /health) see exactly the same snapshot and status values.
  assert.deepEqual(kv.map, before);
});

test('status is rewritten when its meaningful content differs (legacy version, error, other snapshot)', async () => {
  const snap = snapshot(T0);
  for (const status of [
    { ...healthy(T0, snap.generated_at), version: '1.0.4' },
    { ...healthy(T0, snap.generated_at), state: 'ERROR', last_error: 'boom' },
    { ...healthy(T0, snap.generated_at), state: 'RUNNING' },
    healthy(T0, '2026-10-07T11:00:00.000Z'),
    null
  ]) {
    const kv = countingKv({ [SNAPSHOT_KEY]: snap, ...(status ? { [STATUS_KEY]: status } : {}) });
    await runScheduled({ WNBA_KV: kv }, { now: T0 + 60e3 });
    assert.deepEqual(kv.puts, [STATUS_KEY]);
    const written = JSON.parse(kv.map.get(STATUS_KEY));
    // Same record the pre-1.0.5 HEALTHY_SKIPPED_FRESH write produced.
    assert.equal(written.state, 'HEALTHY_SKIPPED_FRESH');
    assert.equal(written.version, VERSION);
    assert.equal(written.last_error, null);
    assert.equal(written.snapshot_generated_at, snap.generated_at);
    assert.deepEqual(written.last_result, { skipped: 'fresh_snapshot', generated_at: snap.generated_at });
    // and the next minute is quiet again
    await runScheduled({ WNBA_KV: kv }, { now: T0 + 120e3 });
    assert.equal(kv.puts.length, 1);
  }
});

test('heartbeat: a status older than the refresh window is force-written even when nothing changed', async () => {
  const gen = T0 + 5 * 60e3;
  const snap = snapshot(gen);
  const st = healthy(T0 - 11 * 60e3, snap.generated_at);
  assert.equal(freshTickStatusCurrent(st, snap.generated_at, T0 - 11 * 60e3 + REFRESH_MS - 1), true);
  assert.equal(freshTickStatusCurrent(st, snap.generated_at, T0 - 11 * 60e3 + REFRESH_MS), false);
  const kv = countingKv({ [SNAPSHOT_KEY]: snap, [STATUS_KEY]: st });
  await runScheduled({ WNBA_KV: kv }, { now: T0 - 11 * 60e3 + REFRESH_MS });
  assert.deepEqual(kv.puts, [STATUS_KEY]);
});
