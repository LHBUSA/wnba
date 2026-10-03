// WNBACast live cadence: ~5s while any game is live, end-to-end. The browser
// poll, the rail throttle and the wnba-api live TTLs move together; a 5s poll
// over a 6s/8s cache would only see a new provider read every ~10s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pollIntervalFor, createRailRefresher, LIVE_POLL_MS, RAIL_REFRESH_MS, PRE_POLL_MS } from '../src/lib/cast-rail.js';
import { mergeLiveEvents, isBackwards, liveSnapshotKey } from '../src/lib/cast-live.js';
import { TTL } from '../workers/wnba-api/src/ttl.js';

const castSrc = readFileSync(new URL('../src/pages/cast.js', import.meta.url), 'utf8');

test('1 · interval contract: live 5s, rail 5s, pregame 60s, final stops', () => {
  assert.equal(LIVE_POLL_MS, 5000);
  assert.equal(RAIL_REFRESH_MS, 5000);
  assert.equal(pollIntervalFor('in', false), 5000, 'live selected game');
  assert.equal(pollIntervalFor('in', true), 5000);
  assert.equal(pollIntervalFor('post', true), 5000, 'final selected, another game live');
  assert.equal(pollIntervalFor('pre', true), 5000, 'pregame selected, another game live');
  assert.equal(pollIntervalFor('pre', false), PRE_POLL_MS);
  assert.equal(PRE_POLL_MS, 60000);
  assert.equal(pollIntervalFor('post', false), 0, 'final, nothing live: stop');
});

test('2 · cast.js: start and game switch at the live cadence, no stray 8s/15s timers, honest copy', () => {
  assert.match(castSrc, /createPoller\(load, \{ intervalMs: LIVE_POLL_MS \}\)/);
  assert.match(castSrc, /history\.pushState[\s\S]{0,200}poller\?\.setInterval\(LIVE_POLL_MS\)/);
  assert.ok(!/\b8000\b|\b15000\b/.test(castSrc), 'no hard-coded 8s/15s cadence');
  assert.ok(!/\bsetInterval\(load/.test(castSrc), 'no raw setInterval polling');
  assert.match(castSrc, /Updates every ~5 seconds while live/);
  assert.ok(!/real-time every|5-second source feed/i.test(castSrc));
});

test('3 · Worker TTL contract: live windows below the 5s poll; slow windows untouched', () => {
  assert.ok(TTL.summaryLive < LIVE_POLL_MS / 1000);
  assert.ok(TTL.scoreboardLive < RAIL_REFRESH_MS / 1000);
  assert.equal(TTL.summaryFinal, 86400);
  assert.equal(TTL.summaryPre, 120);
  assert.equal(TTL.scoreboard, 60);
  assert.equal(TTL.schedule, 900);
  const api = readFileSync(new URL('../workers/wnba-api/src/index.js', import.meta.url), 'utf8');
  assert.match(api, /import \{ TTL \} from '\.\/ttl\.js'/);
  assert.match(api, /ttlS: TTL\.summaryLive/);
  assert.match(api, /maxAge: TTL\.scoreboardLive/, '/v1/today browser copy cannot outlive a rail tick');
});

test('4 · rail throttle at 5s: consecutive live ticks (5s + latency apart) each fetch', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const refresh = createRailRefresher({ now: () => clock, fetchToday: async () => { calls += 1; return { ok: true, data: { slate: { games: [{ game_id: 'x' }] } } }; } });
  await refresh();
  for (let i = 0; i < 5; i++) { clock += 5000 + 180; await refresh(); }
  assert.equal(calls, 6);
});

// ---------------------------------------------------------------- poller (fake DOM + timers)

function fakeDocument() {
  const listeners = new Set();
  return {
    visibilityState: 'visible',
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    fire() { for (const fn of listeners) fn(); },
    listeners
  };
}

async function withPoller(t, body) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const doc = fakeDocument();
  globalThis.document = doc;
  const { createPoller } = await import('../src/lib/poller.js');
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  try { await body({ createPoller, doc, tick: async (ms) => { t.mock.timers.tick(ms); await flush(); } }); }
  finally { delete globalThis.document; }
}

test('5 · poller: request finishes → wait 5s → next request; never overlaps a slow request', async (t) => {
  await withPoller(t, async ({ createPoller, tick }) => {
    const starts = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let release;
    const fn = () => { starts.push(Date.now()); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise((r) => { release = () => { inFlight--; r(); }; }); };
    const p = createPoller(fn, { intervalMs: LIVE_POLL_MS });
    await tick(0);
    assert.equal(starts.length, 1, 'immediate first request');
    await tick(12000); // slow request: 12s, longer than two intervals
    assert.equal(starts.length, 1, 'no overlapping request while one is in flight');
    release(); await tick(0);
    await tick(4999);
    assert.equal(starts.length, 1);
    await tick(1);
    assert.equal(starts.length, 2, 'next request 5s after the previous finished');
    assert.equal(starts[1] - starts[0], 12000 + 5000, 'start-to-start = latency + 5s');
    assert.equal(maxInFlight, 1);
    p.stop();
  });
});

test('6 · poller: hidden tab pauses, visible resumes, stop ends it', async (t) => {
  await withPoller(t, async ({ createPoller, doc, tick }) => {
    let calls = 0;
    const p = createPoller(async () => { calls++; }, { intervalMs: LIVE_POLL_MS });
    await tick(0);
    assert.equal(calls, 1);
    doc.visibilityState = 'hidden';
    await tick(30000);
    assert.equal(calls, 1, 'no requests while hidden');
    doc.visibilityState = 'visible';
    doc.fire(); await tick(0);
    assert.equal(calls, 2, 'resumes on visible');
    p.stop();
    await tick(30000);
    assert.equal(calls, 2, 'stopped');
    assert.equal(doc.listeners.size, 0);
  });
});

test('7 · poller: re-setting the same interval does not push the next tick back', async (t) => {
  await withPoller(t, async ({ createPoller, tick }) => {
    let calls = 0;
    const p = createPoller(async () => { calls++; }, { intervalMs: LIVE_POLL_MS });
    await tick(0);
    await tick(3000);
    p.setInterval(LIVE_POLL_MS); // late rail refresh calling setPollInterval()
    await tick(2000);
    assert.equal(calls, 2, 'tick still lands 5s after the request finished');
    p.setInterval(0);
    await tick(60000);
    assert.equal(calls, 2, 'interval 0 stops polling');
    p.stop();
  });
});

// ---------------------------------------------------------------- seq integrity

const ev = (seq, text = `play ${seq}`) => ({ seq, text });

test('8 · no-change poll: empty incremental merge keeps the stream identical (no duplicate plays)', () => {
  const stream = [ev(1), ev(2), ev(3)];
  const next = mergeLiveEvents(stream, [], 3);
  assert.deepEqual(next, stream);
  const again = mergeLiveEvents(next, [ev(3)], 3); // provider re-sends the boundary play
  assert.deepEqual(again.map((e) => e.seq), [1, 2, 3], 'merge by seq: no duplicate');
});

test('9 · seq merge is deterministic regardless of arrival order; incoming wins on the same seq', () => {
  const stream = [ev(1), ev(2), ev(4)];
  const a = mergeLiveEvents(stream, [ev(6), ev(3), ev(5)], 4);
  const b = mergeLiveEvents(stream, [ev(5), ev(6), ev(3)], 4);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
  const corrected = mergeLiveEvents(a, [ev(4, 'corrected')], 6);
  assert.equal(corrected.find((e) => e.seq === 4).text, 'corrected');
  assert.equal(corrected.length, 6);
  assert.deepEqual(mergeLiveEvents(stream, [ev(1)], undefined), [ev(1)], 'full load replaces');
});

test('10 · backwards guard: an older snapshot never steps the stream back', () => {
  assert.equal(isBackwards([ev(1), ev(9)], 8), true);
  assert.equal(isBackwards([ev(1), ev(9)], 9), false);
  assert.equal(isBackwards([ev(1), ev(9)], null), false);
  assert.equal(isBackwards([], 3), false);
  assert.match(castSrc, /isBackwards\(state\.events, d\.last_seq\)\) return;/);
});

test('11 · snapshot key: same provider state → same key (no repaint); any real change → new key', () => {
  const d = { last_seq: 40, events_total: 40, game: { status: { state: 'in', period: 2, clock: '4:12' }, away: { score: 30 }, home: { score: 28 } } };
  const m = { fetched_at: '2026-10-02T23:00:00Z', source_updated_at: null, freshness: 'CURRENT', degraded: [] };
  const k = liveSnapshotKey(d, m);
  assert.equal(liveSnapshotKey(structuredClone(d), { ...m, fetched_at: '2026-10-02T23:00:05Z' }), k, 'a later fetch of the same state is not a change');
  assert.notEqual(liveSnapshotKey({ ...d, game: { ...d.game, status: { ...d.game.status, clock: '4:05' } } }, m), k, 'clock moved');
  assert.notEqual(liveSnapshotKey({ ...d, game: { ...d.game, home: { score: 30 } } }, m), k, 'score moved');
  assert.notEqual(liveSnapshotKey({ ...d, last_seq: 41, events_total: 41 }, m), k, 'new play');
  assert.notEqual(liveSnapshotKey(d, { ...m, freshness: 'STALE' }), k, 'freshness change repaints');
});
