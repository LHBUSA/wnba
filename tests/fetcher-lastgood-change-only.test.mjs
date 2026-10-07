import test from 'node:test';
import assert from 'node:assert/strict';
import { maybeWriteKv, parseWriteMark, KV_LASTGOOD_FORCE_S, KV_LASTGOOD_TTL_S } from '../workers/shared/fetcher.js';

function countingKv(seed = {}) {
  const map = new Map(Object.entries(seed));
  const puts = [];
  return {
    map, puts,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value, opts) { puts.push({ key, value, opts }); map.set(key, value); }
  };
}

const T0 = Date.parse('2026-10-07T12:00:00Z');
const BODY = { events: [{ id: '401', name: 'A @ B', competitions: [{ status: { type: { state: 'post' } } }] }], season: { year: 2026 } };
const MIN = 300;

test('stored last-good value is byte-identical to the pre-change JSON.stringify({ body, fetchedAt })', async () => {
  const kv = countingKv();
  const fetchedAt = new Date(T0).toISOString();
  assert.equal(await maybeWriteKv(kv, 'lg:x', BODY, fetchedAt, MIN, T0), 'written');
  assert.equal(kv.map.get('lg:x'), JSON.stringify({ body: BODY, fetchedAt }));
  assert.equal(kv.puts[0].opts.expirationTtl, KV_LASTGOOD_TTL_S);
  // the write mark keeps the old numeric prefix, so a reader of the old format still parses a timestamp
  assert.equal(Number(kv.map.get('lg:x:w').split('|')[0]), T0);
  assert.ok(kv.puts[1].opts.expirationTtl >= KV_LASTGOOD_FORCE_S);
});

test('unchanged bodies are not rewritten until the forced window passes; changed bodies keep the old cadence', async () => {
  const kv = countingKv();
  const iso = (ms) => new Date(ms).toISOString();
  // old behaviour: one body+mark write every MIN seconds while traffic continues -> 6 body writes in 30 min
  let bodyWrites = 0;
  for (let t = 0; t < KV_LASTGOOD_FORCE_S; t += 60) {
    const r = await maybeWriteKv(kv, 'lg:x', BODY, iso(T0 + t * 1000), MIN, T0 + t * 1000);
    if (r === 'written') bodyWrites += 1;
  }
  assert.equal(bodyWrites, 1);
  // readers still get the identical body (only fetchedAt of the stored copy is the first observation)
  assert.deepEqual(JSON.parse(kv.map.get('lg:x')).body, BODY);
  // forced reconcile write once the window has passed
  assert.equal(await maybeWriteKv(kv, 'lg:x', BODY, iso(T0 + KV_LASTGOOD_FORCE_S * 1000), MIN, T0 + KV_LASTGOOD_FORCE_S * 1000), 'written');
  assert.equal(JSON.parse(kv.map.get('lg:x')).fetchedAt, iso(T0 + KV_LASTGOOD_FORCE_S * 1000));
  // a changed body is written at the first refresh after the min interval, exactly as before
  const changed = { ...BODY, season: { year: 2027 } };
  const t1 = T0 + (KV_LASTGOOD_FORCE_S + 60) * 1000;
  assert.equal(await maybeWriteKv(kv, 'lg:x', changed, iso(t1), MIN, t1), 'throttled');
  const t2 = T0 + (KV_LASTGOOD_FORCE_S + MIN) * 1000;
  assert.equal(await maybeWriteKv(kv, 'lg:x', changed, iso(t2), MIN, t2), 'written');
  assert.deepEqual(JSON.parse(kv.map.get('lg:x')), { body: changed, fetchedAt: iso(t2) });
});

test('legacy numeric write marks (pre-hash) behave exactly as before: throttle, then write', async () => {
  assert.deepEqual(parseWriteMark(String(T0)), { at: T0, h: null });
  assert.equal(parseWriteMark(null), null);
  const kv = countingKv({ 'lg:x:w': String(T0) });
  assert.equal(await maybeWriteKv(kv, 'lg:x', BODY, 'a', MIN, T0 + 1000), 'throttled');
  assert.equal(await maybeWriteKv(kv, 'lg:x', BODY, 'b', MIN, T0 + MIN * 1000), 'written');
});

test('an expired write mark (TTL boundary) always forces the write', async () => {
  const kv = countingKv();
  await maybeWriteKv(kv, 'lg:x', BODY, 'a', MIN, T0);
  kv.map.delete('lg:x:w'); // KV expired the mark
  assert.equal(await maybeWriteKv(kv, 'lg:x', BODY, 'b', MIN, T0 + MIN * 1000), 'written');
});
