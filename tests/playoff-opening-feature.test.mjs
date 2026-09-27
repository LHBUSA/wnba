import test from 'node:test';
import assert from 'node:assert/strict';
import { articleView } from '../src/views/article.js';
import { visualsFailures } from '../workers/wnba-news/src/visuals.js';
import { articleIdentityFailures, auditStoredIdentity, IDENTITY_VERSION } from '../workers/wnba-news/src/identity.js';

import {
  PLAYOFF_OPENING_ID,
  PLAYOFF_OPENING_KEY,
  PLAYOFF_OPENING_LEGACY_SLUG,
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
  assert.match(a.slug, /-[a-f0-9]{6}$/);
  assert.deepEqual(a.aliases, [PLAYOFF_OPENING_LEGACY_SLUG]);
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
  assert.equal(a.visuals.length, 3);
  assert.deepEqual(visualsFailures(a.visuals), []);
  assert.ok(a.visuals.some((v) => v.id === 'playoff-model-market' && v.type === 'comparison_bars'));
  assert.ok(a.visuals.some((v) => v.id === 'atlanta-model-drivers' && v.type === 'impact_bars'));
  const board = a.visuals.find((v) => v.id === 'september-winba-top-five' && v.type === 'rank_cards');
  assert.ok(board);
  assert.ok(board.cards.every((card) => card.photo?.square), 'all five WinBA cards use approved player photography');
  assert.ok(a.winba_board_media?.length >= 5);
  assert.ok(a.media, 'article hero resolves through reviewed newsroom media');
});

test('playoff feature renders player, WinBA, model and matchup navigation with server-side charts', () => {
  const a = playoffOpeningArticle('2026-09-27T14:30:00.000Z');
  const h = String(articleView({ article: { ...a, media: null }, related: [] }));
  const hrefs = ['/players/4433791','/players/4433791/dna','/players/3149391','/players/4433402','/players/4065870','/players/4433403','/winba-score','/news/winba-index','/pbe-picks','/pbe-picks/model','/track-record','/playoffs','/matchups/401918013','/matchups/401918014','/matchups/401918015','/matchups/401918016'];
  for (const href of hrefs) assert.ok(h.includes(`href="${href}"`), href);
  assert.match(h, /PBE model vs de-vigged market/);
  assert.match(h, /Why the model is highest on Atlanta/);
  assert.match(h, /September WinBA top five/);
  assert.match(h, /PropBetEdge research stack/);
  assert.match(h, /Olivia Miles Player DNA/);
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


test('force migration repairs the previously published unroutable legacy slug', async () => {
  const oldCard = {
    id: PLAYOFF_OPENING_ID,
    slug: PLAYOFF_OPENING_LEGACY_SLUG,
    aliases: [],
    kind: 'commissioned_feature',
    status: 'published',
    quality_state: 'current_quality',
    first_published_at: '2026-09-27T14:30:00.000Z',
    published_at: '2026-09-27T14:30:00.000Z',
    updated_at: '2026-09-27T14:30:00.000Z',
    entities: []
  };
  const oldArticle = {
    ...playoffOpeningArticle('2026-09-27T14:30:00.000Z'),
    slug: PLAYOFF_OPENING_LEGACY_SLUG,
    aliases: [],
    first_published_at: '2026-09-27T14:30:00.000Z',
    published_at: '2026-09-27T14:30:00.000Z'
  };
  const store = kv({
    'art:v1:index': [oldCard],
    [`art:v1:item:${PLAYOFF_OPENING_ID}`]: oldArticle
  });

  const out = await publishPlayoffOpening({ NEWS_KV: store }, { at: '2026-09-27T15:00:00.000Z', force: true });
  assert.equal(out.status, 'regenerated');
  assert.equal(out.slug, PLAYOFF_OPENING_SLUG);

  const index = await store.get('art:v1:index', 'json');
  assert.equal(index[0].slug, PLAYOFF_OPENING_SLUG);
  assert.deepEqual(index[0].aliases, [PLAYOFF_OPENING_LEGACY_SLUG]);

  const article = await store.get(`art:v1:item:${PLAYOFF_OPENING_ID}`, 'json');
  assert.equal(article.slug, PLAYOFF_OPENING_SLUG);
  assert.deepEqual(article.aliases, [PLAYOFF_OPENING_LEGACY_SLUG]);
  assert.equal(article.first_published_at, '2026-09-27T14:30:00.000Z');
});


test('league-wide playoff feature survives the scheduled full-catalog identity audit', async () => {
  const article = playoffOpeningArticle('2026-09-27T14:30:00.000Z');
  assert.deepEqual(articleIdentityFailures(article, { dict: null }), []);

  const card = {
    id: article.id,
    slug: article.slug,
    kind: article.kind,
    status: 'published',
    quality_state: 'current_quality',
    first_published_at: article.first_published_at,
    published_at: article.published_at,
    revised_at: article.revised_at,
    entities: article.entities,
    identity_mode: article.identity_mode
  };
  let stored = structuredClone(article);
  const out = await auditStoredIdentity([card], {
    dict: null,
    at: '2026-09-27T15:10:00.000Z',
    getItem: async () => stored,
    putItem: async (next) => { stored = next; }
  });
  assert.equal(out.retired, 0);
  assert.equal(out.passed, 1);
  assert.equal(card.quality_state, 'current_quality');
  assert.equal(card.identity_audit.version, IDENTITY_VERSION);
  assert.equal(card.identity_audit.ok, true);
});
