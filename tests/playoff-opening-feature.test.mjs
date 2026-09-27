import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYOFF_OPENING_ID,
  PLAYOFF_OPENING_KEY,
  PLAYOFF_OPENING_SLUG,
  playoffOpeningArticle,
  publishPlayoffOpening
} from '../workers/wnba-news/src/playoff-opening.js';

function kv(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    async get(key, type) {
      const raw = m.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) { m.set(key, value); },
    _m: m
  };
}

test('Sep 27 playoff feature preserves the audited pre-lock slate and SEO identity', () => {
  const a = playoffOpeningArticle('2026-09-27T14:30:00.000Z');
  assert.equal(a.id, PLAYOFF_OPENING_ID);
  assert.equal(a.slug, PLAYOFF_OPENING_SLUG);
  assert.equal(a.kind, 'commissioned_feature');
  assert.equal(a.category, 'Playoffs');
  assert.equal(a.facts.prediction_state, 'pre_lock');
  assert.equal(a.facts.locked_predictions_at_snapshot, 0);
  assert.equal(a.facts.picks.length, 4);

  const atl = a.facts.picks.find((p) => p.pick === 'Atlanta Dream');
  assert.equal(atl.model_probability, 75.3);
  assert.equal(atl.market_devig_probability, 69.8);
  assert.equal(atl.pbe_edge_points, 5.5);
  assert.equal(a.winba_reference.player_name, 'Olivia Miles');
  assert.equal(a.winba_reference.rank, 1);
  assert.equal(a.winba_reference.score, 87);

  assert.match(a.headline, /WNBA Playoffs Today/);
  assert.match(a.seo.title, /WNBA Playoff Picks Today/);
  assert.ok(a.seo.description.length >= 120 && a.seo.description.length <= 220);
  assert.ok(a.words >= 700);
  assert.ok(a.links.playoffs);
  assert.ok(a.links.picks);
  assert.ok(a.links.model);
  assert.ok(a.links.track_record);
});

test('playoff feature publisher is idempotent and force regenerates without moving first publication', async () => {
  const store = kv({ 'art:v1:index': [] });
  const env = { NEWS_KV: store };

  const first = await publishPlayoffOpening(env, { at: '2026-09-27T14:30:00.000Z' });
  assert.equal(first.key, PLAYOFF_OPENING_KEY);
  assert.equal(first.status, 'published');

  const index1 = await store.get('art:v1:index', 'json');
  assert.equal(index1[0].id, PLAYOFF_OPENING_ID);
  const saved1 = await store.get(`art:v1:item:${PLAYOFF_OPENING_ID}`, 'json');
  assert.equal(saved1.first_published_at, '2026-09-27T14:30:00.000Z');

  const again = await publishPlayoffOpening(env, { at: '2026-09-27T14:40:00.000Z' });
  assert.equal(again.status, 'already_published');

  const forced = await publishPlayoffOpening(env, { at: '2026-09-27T14:50:00.000Z', force: true });
  assert.equal(forced.status, 'regenerated');
  const saved2 = await store.get(`art:v1:item:${PLAYOFF_OPENING_ID}`, 'json');
  assert.equal(saved2.first_published_at, '2026-09-27T14:30:00.000Z');
  assert.equal(saved2.revised_at, '2026-09-27T14:50:00.000Z');
  assert.equal(saved2.revisions.length, 1);
});
