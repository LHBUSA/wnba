import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/wnba-news/src/index-live.js';
import { ARTICLE_RETENTION_VERSION, migrateArticleRetention, putArticle } from '../workers/wnba-news/src/article-retention.js';

class KV {
  constructor() { this.m = new Map(); this.puts = []; }
  async get(key, type) {
    if (!this.m.has(key)) return null;
    const v = this.m.get(key);
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value, options) {
    this.m.set(key, value);
    this.puts.push({ key, value, options });
  }
}

test('production newsroom boundary imports and exposes fetch/scheduled', () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
});

test('published article writes have no expiration', async () => {
  const kv = new KV();
  await putArticle(kv, { id: 'abc123', headline: 'Permanent' });
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, 'art:v1:item:abc123');
  assert.equal(kv.puts[0].options, undefined);
});

test('retention migration makes unseen and later-revised articles permanent', async () => {
  const kv = new KV();
  await kv.put('art:v1:item:a', JSON.stringify({ id: 'a', headline: 'A' }), { expirationTtl: 10 });
  await kv.put('art:v1:item:b', JSON.stringify({ id: 'b', headline: 'B' }), { expirationTtl: 10 });
  kv.puts = [];

  const first = await migrateArticleRetention(kv, [
    { id: 'a', first_published_at: '2026-09-16T10:00:00Z' },
    { id: 'b', first_published_at: '2026-09-16T11:00:00Z' }
  ], { batchSize: 10 });
  assert.equal(first.version, ARTICLE_RETENTION_VERSION);
  assert.equal(first.status, 'COMPLETE');
  assert.equal(first.permanent, 2);
  assert.ok(kv.puts.filter((p) => p.key.startsWith('art:v1:item:')).every((p) => p.options === undefined));

  // A canonical story revision can be written by the legacy writer with a TTL.
  // The next retention pass must see revised_at and remove that expiry again.
  await kv.put('art:v1:item:a', JSON.stringify({ id: 'a', headline: 'A revised' }), { expirationTtl: 10 });
  kv.puts = [];
  const revisedAt = new Date(Date.parse(first.at) + 1000).toISOString();
  const second = await migrateArticleRetention(kv, [
    { id: 'a', first_published_at: '2026-09-16T10:00:00Z', revised_at: revisedAt },
    { id: 'b', first_published_at: '2026-09-16T11:00:00Z' }
  ], { batchSize: 10 });
  assert.equal(second.revised_candidates_this_pass, 1);
  const rewrite = kv.puts.find((p) => p.key === 'art:v1:item:a');
  assert.ok(rewrite, 'revised article should be rewritten');
  assert.equal(rewrite.options, undefined);
});
