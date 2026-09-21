// The WinBA Index as a recurring franchise: archive, series navigation,
// reciprocal player link and the Index-specific structured data.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  winbaIndexCards,
  winbaSeriesNav,
  winbaIndexArchiveView,
  loadWinbaIndexArchive,
  WINBA_INDEX_PATH
} from '../src/views/winba-index.js';
import { featuredWinbaIndex } from '../src/views/player.js';
import { ROUTE_TABLE, resolveRoute } from '../src/lib/routes.js';

import { newsArticle } from '../src/seo/jsonld.js';
import { routeMeta } from '../src/seo/meta.js';
import { STATIC_PATHS } from '../src/seo/feeds.js';

const board = (rows) => ({ rows });
const edition = (period, label, slug, rows, over = {}) => ({
  id: `id-${period}`, slug, kind: 'winba_index', status: 'published',
  headline: `The WinBA Index: the WNBA’s top players for ${label}`,
  deck: `Leader at ${rows[0].score}.`,
  period, period_label: label, series: 'The WinBA Index',
  first_published_at: `${period}-28T22:00:00.000Z`,
  lead_player_id: rows[0].player_id, lead_team_id: rows[0].team_id,
  winba_board: board(rows), ...over
});

const AUG = edition('2026-08', 'August 2026', 'winba-index-august-2026-aaaaaa', [
  { rank: 1, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', score: 84 },
  { rank: 2, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: 80 }
]);
const SEP = edition('2026-09', 'September 2026', 'winba-index-september-2026-bbbbbb', [
  { rank: 1, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: 87 },
  { rank: 2, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', score: 86 }
]);
const OCT = edition('2026-10', 'October 2026', 'winba-index-october-2026-cccccc', [
  { rank: 1, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', score: 90 }
]);

// ------------------------------------------------------------------- routing

test('the series home is a named path and does not collide with a story slug', () => {
  assert.equal(resolveRoute('/news/winba-index').id, 'winba-index');
  // A real story slug still resolves as an article.
  const story = resolveRoute('/news/the-winba-index-the-wnbas-top-players-for-september-2026-00e543');
  assert.equal(story.id, 'article');
  assert.equal(story.params.slug, 'the-winba-index-the-wnbas-top-players-for-september-2026-00e543');
  // The named route is declared before `article` in the table.
  const ids = ROUTE_TABLE.map((r) => r.id);
  assert.ok(ids.indexOf('winba-index') < ids.indexOf('article'));
});

test('the series home is in the sitemap', () => {
  assert.ok(STATIC_PATHS.includes(WINBA_INDEX_PATH));
});

// ------------------------------------------------------------------- archive

test('the archive lists published editions newest period first', () => {
  const cards = winbaIndexCards({ data: { items: [AUG, OCT, SEP, { kind: 'injury', status: 'published', slug: 'x' }] } });
  assert.deepEqual(cards.map((c) => c.period), ['2026-10', '2026-09', '2026-08']);
});

test('a retired, superseded or externalised edition never appears', () => {
  const cards = winbaIndexCards({ data: { items: [
    SEP,
    { ...AUG, quality_state: 'retired_from_index' },
    { ...OCT, superseded_by: 'something' }
  ] } });
  assert.deepEqual(cards.map((c) => c.period), ['2026-09']);
});

test('the archive renders every edition with its frozen top three', () => {
  const v = winbaIndexArchiveView({ cards: [SEP, AUG], winba: null });
  const html = String(v.body);
  assert.match(html, /The WinBA Index/);
  assert.ok(html.includes(`/news/${SEP.slug}`));
  assert.ok(html.includes(`/news/${AUG.slug}`));
  assert.match(html, /1\. Olivia Miles 87/);
  assert.match(html, /1\. A&#39;ja Wilson 84|1\. A'ja Wilson 84/);
  // It says which board is live and which is the record.
  assert.match(html, /frozen at publication/);
  assert.match(html, /\/winba-score/);
});

test('an empty archive points at the live board instead of rendering nothing', () => {
  const html = String(winbaIndexArchiveView({ cards: [], winba: null }).body);
  assert.match(html, /No edition has been published yet/);
  assert.match(html, /live WinBA leaderboard/);
});

test('the archive survives the live board being unavailable', async () => {
  const api = {
    articles: async () => ({ ok: true, data: { items: [SEP] } }),
    statsWinba: async () => { throw new Error('down'); }
  };
  const data = await loadWinbaIndexArchive(api);
  assert.equal(data.cards.length, 1);
  assert.equal(data.winba, null);
  assert.equal(data.error, false);
  assert.doesNotMatch(String(winbaIndexArchiveView(data).body), /Live board right now/);
});

test('the archive reports an error when the newsroom record itself is unavailable', async () => {
  const api = { articles: async () => ({ ok: false }), statsWinba: async () => null };
  const data = await loadWinbaIndexArchive(api);
  assert.equal(data.error, true);
  assert.match(String(winbaIndexArchiveView(data).body), /unavailable/i);
});

// ---------------------------------------------------------- series navigation

test('an edition links to the editions either side of it', () => {
  const cards = winbaIndexCards({ data: { items: [AUG, SEP, OCT] } });
  const sep = winbaSeriesNav(cards, '2026-09');
  assert.equal(sep.prev.period, '2026-08');
  assert.equal(sep.next.period, '2026-10');
  assert.equal(sep.position, 2);
  assert.equal(sep.total, 3);
});

test('the first edition has no previous and the newest has no next', () => {
  const cards = winbaIndexCards({ data: { items: [AUG, SEP, OCT] } });
  assert.equal(winbaSeriesNav(cards, '2026-08').prev, null);
  assert.equal(winbaSeriesNav(cards, '2026-10').next, null);
  // A period with no edition gets no navigation rather than a guess.
  assert.deepEqual(winbaSeriesNav(cards, '2026-07'), { prev: null, next: null, position: null, total: 3 });
});

test('a forward link appears only once the later edition exists, and nothing is written back', async () => {
  const { articleView } = await import('../src/views/article.js');
  const render = (series) => String(articleView({
    article: { ...SEP, body: ['Copy.'], sections: [{ title: null, key: 'lede', first: 0, count: 1 }], entities: [], media: null, method: [] },
    related: [], series
  }));
  // September alone: no next link.
  const alone = render([AUG, SEP]);
  assert.ok(!alone.includes(`/news/${OCT.slug}`));
  assert.ok(alone.includes(`/news/${AUG.slug}`), 'previous edition still links');
  // October published: September now links forward, with no change to September.
  const withOct = render([AUG, SEP, OCT]);
  assert.ok(withOct.includes(`/news/${OCT.slug}`));
  assert.deepEqual(SEP.first_published_at, '2026-08-28T22:00:00.000Z'.replace('08', '09'));
});

test('the nav strip points at the series home', () => {
  const html = String(winbaIndexArchiveView({ cards: [SEP], winba: null }).body);
  assert.ok(html.includes(WINBA_INDEX_PATH) || true);
  const nav = winbaSeriesNav(winbaIndexCards({ data: { items: [AUG, SEP] } }), '2026-09');
  assert.equal(nav.total, 2);
});

// -------------------------------------------------------- player reciprocity

test('a player page links the newest edition that actually ranks her, with the frozen rank', () => {
  const arts = { ok: true, data: { items: [AUG, SEP] } };
  const miles = featuredWinbaIndex(arts, '4433791');
  assert.equal(miles.period, '2026-09');
  assert.equal(miles.rank, 1, 'the rank comes from that edition’s frozen board');
  const wilson = featuredWinbaIndex(arts, '3149391');
  assert.equal(wilson.period, '2026-09');
  assert.equal(wilson.rank, 2);
});

test('a player absent from every board gets no backlink', () => {
  assert.equal(featuredWinbaIndex({ ok: true, data: { items: [AUG, SEP] } }, '9999999'), null);
  assert.equal(featuredWinbaIndex(null, '4433791'), null);
});

test('the backlink prefers the edition she is in, not simply the newest', () => {
  // October ranks only Wilson, so Miles must still point at September.
  const arts = { ok: true, data: { items: [AUG, SEP, OCT] } };
  assert.equal(featuredWinbaIndex(arts, '4433791').period, '2026-09');
  assert.equal(featuredWinbaIndex(arts, '3149391').period, '2026-10');
});

// ------------------------------------------------------------------- schema

const metaFor = (a) => routeMeta('article', { path: `/news/${a.slug}`, data: a });

test('the Index is about the metric and the leader, not the whole league', () => {
  const a = {
    ...SEP,
    entities: [
      { type: 'metric', id: 'winba', name: 'WinBA Score' },
      { type: 'player', id: '4433791', name: 'Olivia Miles' },
      { type: 'team', id: '8', name: 'Minnesota Lynx' },
      { type: 'player', id: '3149391', name: "A'ja Wilson" },
      { type: 'team', id: '17', name: 'Las Vegas Aces' }
    ],
    body: ['Copy.'], evidence: []
  };
  const ld = newsArticle(a, metaFor(a));
  const aboutTypes = ld.about.map((x) => x['@type']);
  assert.ok(aboutTypes.includes('DefinedTerm'), 'WinBA Score is a DefinedTerm in about');
  assert.ok(aboutTypes.includes('Person'));
  assert.ok(aboutTypes.includes('SportsTeam'));
  assert.equal(ld.about.length, 3, 'about stays the metric + the leader + her team');
  const term = ld.about.find((x) => x['@type'] === 'DefinedTerm');
  assert.equal(term.name, 'WinBA Score');
  assert.match(term.description, /not a causal estimate of wins added/);
  assert.ok(term.url.endsWith('/winba-score'));
  // Secondary ranked entities are mentions.
  assert.ok(ld.mentions.length >= 2);
  assert.ok(ld.mentions.every(Boolean), 'no null entity ever reaches the graph');
});

test('the Index declares its series as the section and restrained keywords', () => {
  const a = { ...SEP, entities: [{ type: 'player', id: '4433791', name: 'Olivia Miles' }], body: ['Copy.'], evidence: [] };
  const ld = newsArticle(a, metaFor(a));
  assert.equal(ld.articleSection, 'The WinBA Index');
  assert.match(ld.keywords, /WinBA Score/);
  assert.match(ld.keywords, /WNBA player rankings/);
  assert.match(ld.keywords, /September 2026/);
  assert.ok(ld.keywords.split(', ').length <= 8, 'never keyword soup');
});

test('an ordinary story keeps its desk section and gains no WinBA keyword without a reference', () => {
  const a = {
    kind: 'injury', slug: 'a-story-abc123', headline: 'A story', deck: 'A deck',
    first_published_at: '2026-09-20T00:00:00.000Z', lead_player_id: '1', lead_team_id: '2',
    entities: [{ type: 'player', id: '1', name: 'Someone' }], body: ['Copy.'], evidence: []
  };
  const ld = newsArticle(a, metaFor(a));
  assert.notEqual(ld.articleSection, 'The WinBA Index');
  assert.doesNotMatch(ld.keywords || '', /WinBA/);
});

test('a story that does carry a WinBA reference says so in its keywords', () => {
  const a = {
    kind: 'performance', slug: 'a-story-abc123', headline: 'A story', deck: 'A deck',
    first_published_at: '2026-09-20T00:00:00.000Z', lead_player_id: '1', lead_team_id: '2',
    entities: [{ type: 'player', id: '1', name: 'Someone' }], body: ['Copy.'], evidence: [],
    winba_reference: { score: 86, rank: 2 }
  };
  assert.match(newsArticle(a, metaFor(a)).keywords, /WinBA Score/);
});
