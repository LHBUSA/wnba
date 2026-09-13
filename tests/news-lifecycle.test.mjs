import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseLead, topStories, storyPublishedAt, storyOriginIso } from '../src/lib/news-ranking.js';
import { articleFirstPublishedAt, injuryIdentity } from '../workers/wnba-news/src/articles-run.js';
import { mergeArticles, repairIndex, RELIST_GAP_MS } from '../workers/wnba-news/src/lifecycle.js';
import { cardOf } from '../workers/wnba-news/src/articles.js';
import { briefArticles } from '../workers/wnba-news/src/briefs.js';

const NOW = Date.parse('2026-09-13T13:30:00.000Z');
const ago = (minutes) => new Date(NOW - minutes * 60e3).toISOString();
const DAY = 24 * 60;

// A generated injury article shaped like deep.js output: the generator hashes source_updated_at into the
// id, and ESPN re-mints injury_id for the same absence on routine refreshes.
const injury = ({ id, player = '4281929', name = 'Satou Sabally', status = 'Out', injuryId, sourceAt, headline = `${name} out for the season`, deck = 'Deck.' }) => ({
  id,
  kind: 'injury',
  category: 'Injuries',
  headline,
  deck,
  status: 'published',
  published_at: sourceAt,
  updated_at: sourceAt,
  lead_team_id: '9',
  lead_player_id: player,
  entities: [{ type: 'player', id: player, name }, { type: 'team', id: '9', name: 'New York Liberty' }],
  evidence: [{ kind: 'record', source: 'ESPN WNBA injury feed' }],
  facts: { injury: { injury_id: injuryId, athlete_id: player, status, source_updated_at: sourceAt } },
  slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${id.slice(0, 6)}`
});
const feedFor = (...entries) => entries.map(([athlete_id, status]) => ({ athlete_id, status }));

const trend = ({ id, team = '129689', window, headline = 'The Valkyries are 7-3 against the spread in their last 10', at }) => ({
  id, kind: 'trend', category: 'Team trends', headline, deck: 'Deck.', status: 'published', published_at: '2026-08-30T23:00Z', updated_at: at,
  lead_team_id: team, lead_player_id: null, entities: [{ type: 'team', id: team, name: 'Golden State Valkyries' }], evidence: [{ source: 'ESPN' }], input_hash: window,
  slug: `trend-${id.slice(0, 6)}`
});

async function pass({ index, articles, minutesAgo = 0, feed = feedFor(['4281929', 'Out']), items = new Map() }) {
  const started = ago(minutesAgo);
  const out = await mergeArticles({
    index,
    articles: articles.map((a) => ({ ...a, updated_at: started })),
    started,
    now: Date.parse(started),
    feed,
    getItem: async (id) => items.get(id) || null,
    putItem: async (a) => { items.set(a.id, structuredClone(a)); },
    versionOf: () => 'test-v1',
    cardOf
  });
  return { ...out, items };
}
const live = (index) => index.filter((c) => !c.superseded_by);

test('PRODUCTION REGRESSION: an ESPN feed refresh of an old injury cannot outrank a genuinely new News Brief', async () => {
  // Days-old canonical Satou story, and a Carla Leite brief first published an hour ago.
  const satouOrigin = ago(4 * DAY);
  const satou = { ...cardOf(injury({ id: 'satou000orig', injuryId: '51294', sourceAt: ago(4 * DAY + 40) })), input_hash: 'test-v1||Satou Sabally out for the season|Deck.', first_published_at: satouOrigin, revised_at: null, episode: '4281929|out' };
  const carla = { id: 'carla0brief1', kind: 'brief', headline: 'Swish Appeal: Carla Leite is the special talent', published_at: ago(150), first_published_at: ago(60), revised_at: null, updated_at: ago(60), entities: [], input_hash: 'x' };

  // Five minutes ago ESPN re-minted the record (new injury_id, new source_updated_at) and the copy changed.
  const refreshed = injury({ id: 'satou05mnew1', injuryId: '51389', sourceAt: ago(6), headline: 'Satou Sabally out for the season — the Liberty have played 23 games without her' });
  const { index, items, events } = await pass({ index: [satou, carla], articles: [refreshed], minutesAgo: 5 });

  const stories = live(index);
  assert.equal(stories.filter((c) => c.lead_player_id === '4281929').length, 1, 'one canonical Satou story');
  const s = stories.find((c) => c.lead_player_id === '4281929');
  assert.equal(s.id, 'satou000orig', 'the refresh revises the existing story id');
  assert.equal(s.first_published_at, satouOrigin, 'editorial origin is immutable');
  assert.equal(s.revised_at, ago(5), 'the revision is recorded as Updated');
  assert.equal(items.get('satou000orig').first_published_at, satouOrigin, 'the article page payload carries the original publication time');
  assert.equal(items.get('satou000orig').revised_at, ago(5));
  assert.deepEqual(events.map((e) => e.event), ['revision']);

  // Hero, displayed age, Top Stories and Latest all use the editorial origin.
  assert.equal(chooseLead(stories).id, 'carla0brief1');
  assert.equal(storyOriginIso(s), satouOrigin);
  assert.equal(storyPublishedAt(s), Date.parse(satouOrigin));
  assert.ok(!topStories(stories, chooseLead(stories), { now: NOW }).some((c) => c.id === s.id), 'revision time cannot re-enter Top Stories');
  assert.deepEqual(stories.map((c) => c.id), ['carla0brief1', 'satou000orig'], 'Latest/index order is by origin, not revision');
});

test('repeated ESPN refreshes with re-minted injury ids keep one story id and one origin', async () => {
  let index = [];
  const items = new Map();
  let r = await pass({ index, items, articles: [injury({ id: 'satouAAAAAA1', injuryId: '51294', sourceAt: ago(3 * DAY) })], minutesAgo: 3 * DAY - 10 });
  index = r.index;
  const origin = index[0].first_published_at;
  for (const [i, [injuryId, m]] of [['51297', 2 * DAY], ['51387', 70], ['51389', 10]].entries()) {
    r = await pass({ index, items, articles: [injury({ id: `satouBBBBBB${i}`, injuryId, sourceAt: ago(m + 20), deck: `Deck ${i}.` })], minutesAgo: m });
    index = r.index;
  }
  assert.equal(index.length, 1, 'no duplicate cards are created');
  assert.equal(index[0].id, 'satouAAAAAA1');
  assert.equal(index[0].first_published_at, origin);
  assert.equal(index[0].revised_at, ago(10));
  assert.equal(index[0].injury_key, '51389', 'the latest ESPN id is kept as provenance only');
  assert.equal(injuryIdentity(injury({ id: 'x', injuryId: 51389, sourceAt: ago(1) })), '51389');
});

test('migration repairs the exact corrupted production Satou/trend state', async () => {
  // Stored values captured from art:v1:index on 2026-09-13 (ids, clocks and keys as they were in KV).
  const S = (id, first, pub, upd, extra) => ({ id, kind: 'injury', lead_player_id: '4281929', headline: 'Satou Sabally out for the season', published_at: pub, first_published_at: first, updated_at: upd, entities: [], ...extra });
  const legacyItem = (id, injury_id) => ({ id, kind: 'injury', lead_player_id: '4281929', facts: { injury: { injury_id, status: 'Out' } } });
  const index = [
    S('dfe9a7abed53', '2026-09-13T13:21:07.642Z', '2026-09-13T13:01Z', '2026-09-13T13:21:39.907Z', { episode: '4281929|out', injury_key: '51389', revised_at: null }),
    S('ee5db21862b4', '2026-09-11T20:28:06.168Z', '2026-09-13T12:01Z', '2026-09-13T12:21:30.000Z', { episode: '4281929|out', injury_key: '51387', superseded_by: 'dfe9a7abed53' }),
    S('08f19acb2754', '2026-09-11T19:30:04.725Z', '2026-09-11T19:00Z', '2026-09-11T19:30:30.000Z', { superseded_by: 'dfe9a7abed53' }),
    S('5649e9469b57', '2026-09-11T18:49:07.399Z', '2026-09-11T18:06Z', '2026-09-11T18:59:37.475Z', { superseded_by: 'dfe9a7abed53' }),
    { id: 'e22194684c40', kind: 'brief', headline: 'Swish Appeal: Carla Leite', published_at: '2026-09-13T11:00:00.000Z', first_published_at: '2026-09-13T12:08:23.560Z', updated_at: '2026-09-13T12:08:50.512Z', entities: [] },
    { id: 'd1db2714b963', kind: 'trend', lead_team_id: '129689', headline: 'Valkyries 7-3 ATS', published_at: '2026-08-30T23:00Z', first_published_at: '2026-09-13T04:10:57.595Z', updated_at: '2026-09-13T04:11:21.774Z', input_hash: 'wnba-articles/1.2.0|401857188,401857178|h|d', entities: [] },
    { id: 'c95e492814c5', kind: 'trend', lead_team_id: '129689', headline: 'Valkyries 7-3 ATS', published_at: '2026-08-30T23:00Z', first_published_at: '2026-09-12T04:10:52.530Z', updated_at: '2026-09-12T04:11:12.923Z', input_hash: 'wnba-articles/1.2.0|401857188,401857178|h|d', entities: [] },
    { id: '3a169f86e481', kind: 'trend', lead_team_id: '129689', headline: 'Valkyries 7-3 ATS', published_at: '2026-08-30T23:00Z', first_published_at: '2026-09-11T18:49:07.399Z', updated_at: '2026-09-11T20:28:39.063Z', input_hash: 'wnba-articles/1.1.0|401857188,401857178|h|d', entities: [] }
  ];
  const stored = new Map([['08f19acb2754', legacyItem('08f19acb2754', '51297')], ['5649e9469b57', legacyItem('5649e9469b57', '51294')]]);
  const { cards, repairs } = await repairIndex(index, { getItem: async (id) => stored.get(id) || null });
  const by = new Map(cards.map((c) => [c.id, c]));

  assert.equal(by.get('dfe9a7abed53').first_published_at, '2026-09-11T18:49:07.399Z', 'poisoned 13:21 origin restored to the first PBE publication');
  assert.equal(by.get('dfe9a7abed53').revised_at, '2026-09-13T13:21:39.907Z');
  for (const id of ['ee5db21862b4', '08f19acb2754', '5649e9469b57']) assert.equal(by.get(id).duplicate_of, 'dfe9a7abed53');
  assert.equal(by.get('d1db2714b963').first_published_at, '2026-09-11T18:49:07.399Z');
  for (const id of ['c95e492814c5', '3a169f86e481']) assert.equal(by.get(id).duplicate_of, 'd1db2714b963');
  assert.ok(repairs.some((r) => r.fix === 'origin_restored' && r.id === 'dfe9a7abed53'));

  // Idempotent: a second repair changes nothing.
  const again = await repairIndex(cards, { getItem: async (id) => stored.get(id) || null });
  assert.deepEqual(again.repairs, []);
  assert.deepEqual(again.cards, cards);

  // And the merged index leads with Carla, with no duplicates live.
  const { index: merged } = await pass({ index, articles: [], items: stored });
  const stories = live(merged);
  assert.equal(chooseLead(stories).id, 'e22194684c40');
  assert.deepEqual(stories.map((c) => c.id).sort(), ['d1db2714b963', 'dfe9a7abed53', 'e22194684c40']);

  // The next generated Satou article — whatever its hash id, even one equal to a collapsed duplicate — revises the canonical.
  const nextSatou = injury({ id: 'ee5db21862b4', injuryId: '51391', sourceAt: '2026-09-13T13:31Z', deck: 'New deck.' });
  const { index: after } = await pass({ index: merged, articles: [nextSatou], items: stored });
  const satou = live(after).filter((c) => c.lead_player_id === '4281929');
  assert.equal(satou.length, 1);
  assert.equal(satou[0].id, 'dfe9a7abed53');
  assert.equal(satou[0].first_published_at, '2026-09-11T18:49:07.399Z');
});

test('a genuinely different injury event becomes a new story', async () => {
  const items = new Map();
  const base = await pass({ items, index: [], articles: [injury({ id: 'jadeOUT00001', player: '5017726', name: 'Jade Melbourne', status: 'Day-To-Day', injuryId: '36300', sourceAt: ago(2 * DAY) })], minutesAgo: 2 * DAY, feed: feedFor(['5017726', 'Day-To-Day']) });

  // Status change: Day-To-Day -> Out is a new material event that supersedes the old one.
  const changed = await pass({ items, index: base.index, articles: [injury({ id: 'jadeOUT00002', player: '5017726', name: 'Jade Melbourne', status: 'Out', injuryId: '51310', sourceAt: ago(40) })], minutesAgo: 30, feed: feedFor(['5017726', 'Out']) });
  const now = live(changed.index);
  assert.deepEqual(now.map((c) => c.id), ['jadeOUT00002']);
  assert.equal(now[0].first_published_at, ago(30));
  assert.equal(now[0].revised_at, null);
  assert.equal(changed.index.find((c) => c.id === 'jadeOUT00001').superseded_by, 'jadeOUT00002');
});

test('re-listing after the player left the feed is a new event; a brief feed gap is not', async () => {
  const items = new Map();
  const plum = (o) => injury({ player: '3065570', name: 'Kelsey Plum', ...o });
  const A = plum({ id: 'plumA0000001', injuryId: '36225', sourceAt: ago(3 * DAY) });
  let r = await pass({ items, index: [], articles: [A], minutesAgo: 3 * DAY, feed: feedFor(['3065570', 'Out']) });

  // Feed fetch failed: listing continuity is untouched.
  r = await pass({ items, index: r.index, articles: [], minutesAgo: 2 * DAY + 60, feed: null });
  assert.equal(r.index[0].listing_ended_at, undefined);

  // Off the feed briefly, then back within the gap: still the same event.
  r = await pass({ items, index: r.index, articles: [], minutesAgo: 2 * DAY, feed: feedFor() });
  assert.equal(r.index[0].listing_ended_at, ago(2 * DAY));
  r = await pass({ items, index: r.index, articles: [plum({ id: 'plumB0000001', injuryId: '36230', sourceAt: ago(2 * DAY - 60), deck: 'Back.' })], minutesAgo: 2 * DAY - 60, feed: feedFor(['3065570', 'Out']) });
  assert.equal(live(r.index).length, 1);
  assert.equal(live(r.index)[0].id, 'plumA0000001');

  // Off the feed longer than the relist gap, then listed again: a new story.
  r = await pass({ items, index: r.index, articles: [], minutesAgo: DAY, feed: feedFor() });
  const back = Math.round(DAY - RELIST_GAP_MS / 60e3 - 60);
  r = await pass({ items, index: r.index, articles: [plum({ id: 'plumC0000001', injuryId: '51500', sourceAt: ago(back), deck: 'Again.' })], minutesAgo: back, feed: feedFor(['3065570', 'Out']) });
  const stories = live(r.index);
  assert.deepEqual(stories.map((c) => c.id), ['plumC0000001']);
  assert.equal(stories[0].first_published_at, ago(back));
  assert.equal(stories[0].relisted_after, 'plumA0000001');
});

test('News Brief: the same cluster revises one story; a different cluster is a new story', async () => {
  const wire = (o = {}) => ({ item_id: 'item-a', cluster_id: 'c_item-a', source_id: 'nbc_sports_wnba', source_name: 'NBC Sports', priority: 2, canonical_url: 'https://www.nbcsports.com/wnba/news/league-update', headline: 'WNBA announces a new league operations update', published_at: ago(70), source_updated_at: null, story_type: 'league', relevance: 5, entities: [], ...o });
  const items = new Map();
  // wnba-briefs/2.0.0: a league report with no linked WNBA subject needs an independent second publisher to stand alone.
  const cbs = wire({ item_id: 'item-a2', source_id: 'cbs_wnba', source_name: 'CBS Sports', canonical_url: 'https://www.cbssports.com/wnba/news/league-update', headline: 'WNBA league operations update confirmed', published_at: ago(68) });
  const first = await briefArticles({ externalItems: [wire(), cbs], structured: [], now: Date.parse(ago(60)) });
  let r = await pass({ items, index: [], articles: first, minutesAgo: 60 });
  const origin = r.index[0].first_published_at;

  const corroborated = await briefArticles({ externalItems: [wire(), cbs, wire({ item_id: 'item-b', source_id: 'espn_wnba', source_name: 'ESPN', priority: 2, canonical_url: 'https://www.espn.com/wnba/story/update', headline: 'WNBA league operations update draws new details', published_at: ago(20) })], structured: [], now: Date.parse(ago(10)) });
  r = await pass({ items, index: r.index, articles: corroborated, minutesAgo: 10 });
  assert.equal(r.index.length, 1, 'no duplicate brief');
  assert.equal(r.index[0].first_published_at, origin);
  assert.equal(r.index[0].revised_at, ago(10));

  const other = await briefArticles({ externalItems: [wire({ item_id: 'item-c', cluster_id: 'c_item-c', canonical_url: 'https://www.nbcsports.com/wnba/news/second-event', headline: 'WNBA announces a separate expansion update', published_at: ago(8) }), wire({ item_id: 'item-c2', cluster_id: 'c_item-c', source_id: 'cbs_wnba', source_name: 'CBS Sports', canonical_url: 'https://www.cbssports.com/wnba/news/expansion-update', headline: 'WNBA expansion update confirmed', published_at: ago(7) })], structured: [], now: Date.parse(ago(5)) });
  r = await pass({ items, index: r.index, articles: other, minutesAgo: 5 });
  assert.equal(live(r.index).length, 2);
  const fresh = r.index.find((c) => c.first_published_at === ago(5));
  assert.ok(fresh, 'the different cluster is first published now');
  assert.equal(chooseLead(live(r.index)).id, fresh.id);
});

test('trend: the same game window on a new day is a revision; a new window is a new story', async () => {
  const items = new Map();
  let r = await pass({ items, index: [], articles: [trend({ id: 'trendDay1aaa', window: 'g10,g9,g8', at: ago(2 * DAY) })], minutesAgo: 2 * DAY });
  r = await pass({ items, index: r.index, articles: [trend({ id: 'trendDay2bbb', window: 'g10,g9,g8', headline: 'The Valkyries are 7-3 ATS: new structure', at: ago(DAY) })], minutesAgo: DAY });
  assert.equal(r.index.length, 1);
  assert.equal(r.index[0].id, 'trendDay1aaa');
  assert.equal(r.index[0].first_published_at, ago(2 * DAY));
  assert.equal(r.index[0].revised_at, ago(DAY));

  r = await pass({ items, index: r.index, articles: [trend({ id: 'trendDay3ccc', window: 'g11,g10,g9', at: ago(10) })], minutesAgo: 10 });
  assert.equal(r.index.length, 2);
  assert.equal(r.index[0].id, 'trendDay3ccc');
  assert.equal(r.index[0].first_published_at, ago(10));
});

test('a revised card with no origin clock claims no freshness from its source clock', () => {
  const revisedNoOrigin = { id: 'r', kind: 'preview', published_at: ago(1), revised_at: ago(1) };
  const legacy = { id: 'l', kind: 'result', published_at: ago(600) };
  assert.equal(storyOriginIso(revisedNoOrigin), null);
  assert.equal(storyPublishedAt(revisedNoOrigin), 0);
  assert.equal(articleFirstPublishedAt(legacy), legacy.published_at);
  assert.equal(storyOriginIso(legacy), legacy.published_at);
});

test('a revision cannot make an old canonical story new enough to reclaim the headline', () => {
  const oldInjury = { id: 'satou', kind: 'injury', first_published_at: ago(6 * 60), published_at: ago(5), revised_at: ago(5), media: { layout: 'single' } };
  const newBrief = { id: 'brief', kind: 'brief', first_published_at: ago(120), published_at: ago(120) };
  assert.equal(chooseLead([oldInjury, newBrief]).id, 'brief');
  assert.equal(storyPublishedAt(oldInjury), Date.parse(oldInjury.first_published_at));
});

test('a revised old story cannot re-enter Top Stories through a fresh source timestamp', () => {
  const lead = { id: 'lead', kind: 'brief', first_published_at: ago(15), published_at: ago(15) };
  const oldRevised = { id: 'old', kind: 'injury', first_published_at: ago(4 * DAY), published_at: ago(2), revised_at: ago(2), media: { layout: 'single' } };
  const freshPreview = { id: 'preview', kind: 'preview', first_published_at: ago(90), published_at: ago(90) };
  assert.deepEqual(topStories([lead, oldRevised, freshPreview], lead, { now: NOW }).map((x) => x.id), ['preview']);
});
