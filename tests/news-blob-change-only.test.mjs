import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readBlob, putBlobsIfChanged, blobForceDue, BLOB_KEYS } from '../workers/wnba-news/src/blob-writes.js';

function countingKv(seed = {}) {
  const map = new Map(Object.entries(seed));
  const puts = [];
  return { map, puts, async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v, o) { puts.push({ k, o }); map.set(k, v); } };
}

const ITEMS = { a1: { item_id: 'a1', headline: 'Liberty re-sign Stewart', published_at: '2026-10-06T12:00:00Z', first_captured_at: '2026-10-06T12:01:00Z' } };
const HEALTH = { espn: { last_ok_at: '2026-10-07T12:00:00Z', ok: 3 } };

test('identical blobs are not rewritten; readers see exactly the same stored text', async () => {
  const kv = countingKv({ 'news:v1:items': JSON.stringify(ITEMS), 'news:v1:source-health': JSON.stringify(HEALTH) });
  const seen = new Map();
  const items = await readBlob(kv, 'news:v1:items', seen);
  const health = await readBlob(kv, 'news:v1:source-health', seen);
  const missing = await readBlob(kv, 'news:v1:events', seen);
  assert.equal(missing, null);
  const before = new Map(kv.map);
  health.espn = { ...health.espn, last_ok_at: '2026-10-07T12:05:00Z', ok: 4 }; // health moved, items did not
  const r = await putBlobsIfChanged(kv, [['news:v1:items', items], ['news:v1:source-health', health], ['news:v1:events', { events: [] }]], seen, { force: false });
  assert.deepEqual(r, { written: ['news:v1:events', 'news:v1:source-health'], unchanged: ['news:v1:items'] });
  assert.equal(kv.map.get('news:v1:items'), before.get('news:v1:items'));
  // every written value is exactly the old serialization, with no TTL option (none of these keys ever had one)
  assert.equal(kv.map.get('news:v1:source-health'), JSON.stringify(health));
  assert.ok(kv.puts.every((p) => p.o === undefined));
});

test('parity: final KV state equals the old write-everything pass for the same inputs', async () => {
  const seed = { 'news:v1:items': JSON.stringify(ITEMS), 'news:v1:http': JSON.stringify({ espn: { etag: 'x' } }) };
  const next = [['news:v1:items', ITEMS], ['news:v1:http', { espn: { etag: 'y' } }], ['news:v1:clusters', []]];
  const oldKv = countingKv(seed);
  for (const [k, v] of next) await oldKv.put(k, JSON.stringify(v));
  const newKv = countingKv(seed);
  const seen = new Map();
  for (const k of ['news:v1:items', 'news:v1:http', 'news:v1:clusters']) await readBlob(newKv, k, seen);
  await putBlobsIfChanged(newKv, next, seen);
  assert.deepEqual(newKv.map, oldKv.map);
  assert.ok(newKv.puts.length < oldKv.puts.length);
});

test('forced reconcile: manual passes and the first cron tick of each hour write every blob', async () => {
  assert.equal(blobForceDue('manual', Date.parse('2026-10-07T12:37:00Z')), true);
  assert.equal(blobForceDue('cron', Date.parse('2026-10-07T12:00:00Z')), true);
  assert.equal(blobForceDue('cron', Date.parse('2026-10-07T12:04:59Z')), true);
  assert.equal(blobForceDue('cron', Date.parse('2026-10-07T12:05:00Z')), false);
  const kv = countingKv({ 'news:v1:items': JSON.stringify(ITEMS) });
  const seen = new Map();
  const items = await readBlob(kv, 'news:v1:items', seen);
  const r = await putBlobsIfChanged(kv, [['news:v1:items', items]], seen, { force: true });
  assert.deepEqual(r.written, ['news:v1:items']);
});

test('the ingest pass routes all six whole-store blobs through the change-only writer', () => {
  const src = readFileSync(new URL('../workers/wnba-news/src/index.js', import.meta.url), 'utf8');
  for (const k of BLOB_KEYS) {
    assert.ok(src.includes(`readBlob(env.NEWS_KV, '${k}', blobSeen)`), `read ${k}`);
    assert.ok(src.includes(`['${k}',`), `write ${k}`);
    assert.ok(!src.includes(`env.NEWS_KV.put('${k}'`), `no unconditional put of ${k}`);
  }
});

test('the article pass compares art:v1:index against the exact text it read', () => {
  const src = readFileSync(new URL('../workers/wnba-news/src/articles-run.js', import.meta.url), 'utf8');
  assert.ok(src.includes("const priorIndexText = await env.NEWS_KV.get('art:v1:index');"));
  assert.ok(src.includes("putBlobsIfChanged(env.NEWS_KV, [['art:v1:index', next]], new Map([['art:v1:index', priorIndexText ?? null]])"));
  assert.ok(!src.includes("env.NEWS_KV.put('art:v1:index'"));
});
