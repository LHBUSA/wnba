// Article Market module on WNBA news (contract article-market/1). The fixture is a REAL production response
// (GET /v1/article-market/wnba/401918295, NY @ ATL semifinal Game 1, captured 2026-10-04 ~15:49Z for a story first
// published 15:40Z): Kalshi canonical link + Polymarket related market (RULES DIFFER), no PBE decision yet.
// Owner rules: prospective only (no backfill), canonical ESPN event id only, venues separate, nothing rendered when
// nothing is eligible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ARTICLE_MARKET_ACTIVATED_AT, articleMarketEvent, articleMarketHtml, articleMarketSlot, articleMarketWithin, loadArticleMarket } from '../src/data/article-market.js';
import { articleView } from '../src/views/article.js';

const payload = JSON.parse(readFileSync(new URL('./fixtures/article-market-wnba-401918295.json', import.meta.url), 'utf8'));
const GAME = '401918295';
const article = (over = {}) => ({
  id: 'x', slug: 'x', kind: 'result', headline: 'H', deck: 'D', first_published_at: '2026-10-04T15:40:00.000Z', published_at: '2026-10-04T15:39:00Z',
  entities: [{ type: 'game', id: GAME, name: 'NY @ ATL', start_utc: '2026-10-04T18:00Z' }, { type: 'team', id: '9', name: 'New York Liberty' }],
  body: ['First paragraph.', 'Second paragraph.', 'Third paragraph.'], sections: [{ title: 'One', first: 0, count: 1 }, { title: 'Two', first: 1, count: 2 }],
  ...over,
});

test('activation constant equals the production ARTICLE_MARKET_ACTIVATED_AT (never moved backward)', () => {
  assert.equal(ARTICLE_MARKET_ACTIVATED_AT, '2026-10-04T14:31:40Z');
  assert.equal(Date.parse(payload.activated_at), Date.parse(ARTICLE_MARKET_ACTIVATED_AT));
});

test('eligibility: exactly one ESPN game entity + ORIGINAL first publication at/after activation; nothing else', () => {
  assert.deepEqual(articleMarketEvent(article()), { id: GAME, publishedAt: '2026-10-04T15:40:00.000Z' });
  assert.equal(articleMarketEvent(article({ first_published_at: '2026-10-04T14:31:39Z' })), null, 'pre-activation story: no module, ever');
  assert.equal(articleMarketEvent(article({ first_published_at: null, published_at: '2026-10-04T16:00:00Z' })), null, 'published_at (event clock / revision) is never the baseline');
  assert.equal(articleMarketEvent(article({ revised_at: '2026-10-05T00:00:00Z' })).publishedAt, '2026-10-04T15:40:00.000Z', 'a revision never moves the baseline');
  assert.equal(articleMarketEvent(article({ entities: [{ type: 'team', id: '9' }] })), null, 'no game link: no module');
  assert.equal(articleMarketEvent(article({ entities: [{ type: 'game', id: GAME }, { type: 'game', id: '401918296' }] })), null, 'two games: no single event');
  assert.equal(articleMarketEvent(article({ entities: [{ type: 'game', id: 'NY @ ATL' }] })), null, 'never a title');
});

test('slot: pre-activation / unlinked article renders nothing at all (no empty state)', () => {
  assert.equal(articleMarketSlot(article({ first_published_at: '2026-10-02T04:01:25.242Z' }), { now: payload }), '');
  assert.equal(articleMarketSlot(article({ entities: [] }), { now: payload }), '');
});

test('real payload: LIVE MARKET WATCH, Kalshi + Polymarket separate (RULES DIFFER), "No official call", no inline styles', () => {
  const html = articleMarketSlot(article(), { now: payload });
  assert.match(html, /data-art-market/);
  assert.match(html, /Live market watch/);
  assert.match(html, />Kalshi</);
  assert.match(html, />Polymarket</);
  assert.match(html, /RULES DIFFER/);
  assert.match(html, /No official call/);
  assert.match(html, /does not mean this story moved the market/);
  assert.doesNotMatch(html, /\sstyle="/, 'strict CSP');
  assert.doesNotMatch(html, /consensus|average of/i);
});

test('article view: slot after the first section only; the view without a slot is unchanged (publishing Worker)', () => {
  const a = article();
  const bare = String(articleView({ article: a }));
  assert.doesNotMatch(bare, /data-art-market/);
  const withSlot = String(articleView({ article: a, marketSlot: articleMarketSlot(a, { now: payload }) }));
  const i1 = withSlot.indexOf('<h2>One</h2>'), im = withSlot.indexOf('data-art-market'), i2 = withSlot.indexOf('<h2>Two</h2>');
  assert.ok(i1 > -1 && im > i1 && i2 > im, 'between section one and section two');
  assert.equal(withSlot.replace(/<div class="art-market" data-art-market>[\s\S]*?<\/section><\/div>/, ''), bare, 'prose is identical with and without the module');
});

test('ineligible / failed reads render nothing; read uses the owned markets Worker + original published_at', async () => {
  assert.equal(articleMarketHtml(null), '');
  assert.equal(articleMarketHtml({ ...payload, eligible: false, packet: null, live: null }), '');
  assert.equal(await loadArticleMarket(GAME, '2026-10-04T15:40:00.000Z', async () => ({ ok: false })), null);
  assert.equal(await loadArticleMarket(GAME, '2026-10-04T15:40:00.000Z', async () => { throw new Error('net'); }), null);
  assert.equal(await loadArticleMarket(GAME, '2026-10-04T15:40:00.000Z', async () => ({ ok: true, json: async () => ({ eligible: false }) })), null);
  let url = null;
  await loadArticleMarket(GAME, '2026-10-04T15:40:00.000Z', async (u) => { url = u; return { ok: false }; });
  assert.equal(url, `https://propsports-markets.sales-fd3.workers.dev/v1/article-market/wnba/${GAME}?published_at=2026-10-04T15%3A40%3A00.000Z`);
  let called = false;
  assert.deepEqual(await articleMarketWithin(article({ first_published_at: '2026-10-01T00:00:00Z' }), 800, async () => { called = true; }), { now: null, pending: null });
  assert.equal(called, false, 'a pre-activation story never even reads');
});

test('vendored article-market client pinned byte-for-byte to propbetedge-workers 8d3b73f (SHA-256)', () => {
  const sha = (f) => createHash('sha256').update(readFileSync(new URL(`../src/vendor/kalshi/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(sha('article-market-ui.js'), '2149e2854142657a554ef119533680c77657f0d2b1ea8406fe4de711e4fbe635');
  assert.equal(sha('article-market-ui.css'), '60c223f6afbe32059ea272aeaff648759c254f3494106c41822afaf328c7aa4e');
});
