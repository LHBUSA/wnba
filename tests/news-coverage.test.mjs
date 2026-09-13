// Newsroom coverage expansion: official team + league sources, national/beat publishers, the taxonomy, the materiality
// gate, the persisted fact-based event registry, conditional fetching, source health and the desk / team navigation.
// Offline: every source is a fixture shaped like the real payloads probed on 2026-09-13.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { NEWS_SOURCES, AUDITED_NOT_INGESTED } from '../workers/wnba-news/src/sources.js';
import { parseWnbaPlatform, parseNewsSitemap, parseRss, PARSE_VERSION } from '../workers/wnba-news/src/parse.js';
import { buildDictionary, clusterItems, relevance, linkEntities } from '../workers/wnba-news/src/editorial.js';
import { eventType, classify, materiality, MATERIAL_THRESHOLD, laneOf } from '../workers/wnba-news/src/taxonomy.js';
import { assignEvents, factKey, seedFromClusters } from '../workers/wnba-news/src/events.js';
import { normalizeItem } from '../workers/wnba-news/src/ingest.js';
import { fetchSource, updateHealth } from '../workers/wnba-news/src/fetcher.js';
import { briefArticles, BRIEF_MAX_AGE_MS } from '../workers/wnba-news/src/briefs.js';
import { mergeArticles, collapseBriefsOntoStructured } from '../workers/wnba-news/src/lifecycle.js';
import { cardOf, withSlug } from '../workers/wnba-news/src/articles.js';
import { newsSitemapEntries, newsSitemapXml, sitemapXml } from '../src/seo/feeds.js';
import { renderRoute, composeDocument } from '../workers/wnba-web/src/render.js';
import { resolveRoute } from '../src/lib/routes.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60e3).toISOString();
const HOUR = 60;
const src = (id) => NEWS_SOURCES.find((s) => s.source_id === id);

const dict = buildDictionary({
  players: [
    { athlete_id: '4420318', name: 'Ezi Magbegor', team_id: '14' },
    { athlete_id: '3058890', name: 'Katie Lou Samuelson', team_id: '14' },
    { athlete_id: '2998928', name: 'Kalani Brown', team_id: '17' },
    { athlete_id: '4281929', name: 'Satou Sabally', team_id: '9' }
  ],
  teams: [
    { team_id: '14', name: 'Seattle Storm', short_name: 'Storm' },
    { team_id: '8', name: 'Minnesota Lynx', short_name: 'Lynx' },
    { team_id: '17', name: 'Las Vegas Aces', short_name: 'Aces' },
    { team_id: '9', name: 'New York Liberty', short_name: 'Liberty' }
  ]
});

const ingest = async (raw, sourceId, { at = NOW } = {}) => {
  const n = await normalizeItem(raw, src(sourceId), dict, { startedAt: new Date(at).toISOString(), now: at });
  assert.ok(!n.reject, `${sourceId} item rejected: ${n.reject}`);
  return { ...n.record, cluster_id: null, _rel: n.rel };
};
const withEvents = (items, registry = null) => {
  const { registry: reg, clusters } = assignEvents(items, registry, { now: NOW });
  const byItem = Object.fromEntries(clusters.flatMap((c) => c.members.map((m) => [m, c.cluster_id])));
  return { reg, clusters, items: items.map((i) => ({ ...i, cluster_id: byItem[i.item_id] })) };
};

const storm = (minutesAgo) => ingest({ headline: 'Ezi Magbegor Injury Update', url: 'https://storm.wnba.com/news/ezi-magbegor-injury-update', summary: null, published_at: iso(minutesAgo), tags: ['Press Releases'] }, 'team_storm');
const cbs = (minutesAgo) => ingest({ headline: 'Ezi Magbegor tears ACL at World Cup, is out for remainder of WNBA season: What it means for the Storm', url: 'https://www.cbssports.com/wnba/news/ezi-magbegor-acl/', summary: 'The Storm center was hurt in Berlin.', published_at: iso(minutesAgo), tags: ['WNBA'] }, 'cbs_wnba');
const jws = (minutesAgo) => ingest({ headline: 'Seattle Storm’s Ezi Magbegor Suffers Season-Ending ACL Tear at FIBA World Cup', url: 'https://justwomenssports.com/reads/ezi-magbegor-acl/', summary: 'Magbegor will miss the rest of the season.', published_at: iso(minutesAgo), tags: ['WNBA'] }, 'jws_wnba');
const times = (minutesAgo) => ingest({ headline: 'Storm lose Ezi Magbegor for season with knee injury', url: 'https://nypost.com/2026/09/10/sports/magbegor-knee/', summary: 'Publisher text that must not be stored.', published_at: iso(minutesAgo), tags: [] }, 'nypost_liberty');

// ------------------------------------------------------------ registry

test('source registry: every WNBA team has an official source, fields are complete, nothing paywalled is ingested', () => {
  const teams = NEWS_SOURCES.filter((s) => s.kind === 'team_official');
  assert.equal(teams.length, 15);
  assert.equal(new Set(teams.map((s) => s.team.name)).size, 15);
  for (const s of NEWS_SOURCES) {
    for (const k of ['source_id', 'name', 'kind', 'tier', 'feed_url', 'format', 'wnba_scope', 'reliability', 'timestamp_quality', 'rights', 'attribution', 'priority', 'failure_behavior', 'usage_policy']) assert.ok(s[k] !== undefined && s[k] !== '', `${s.source_id}.${k}`);
    assert.ok(/^https:\/\//.test(s.feed_url), s.source_id);
    assert.doesNotMatch(s.feed_url, /nytimes|athletic|apnews|yardbarker|essentiallysports/i, 'rejected sources stay out');
  }
  assert.equal(new Set(NEWS_SOURCES.map((s) => s.source_id)).size, NEWS_SOURCES.length);
  assert.ok(teams.every((s) => s.priority === 1 && s.summary_policy === 'none'));
  assert.ok(AUDITED_NOT_INGESTED.some((x) => x.source_id === 'athletic_wnba' && x.decision === 'rejected'));
  assert.ok(!NEWS_SOURCES.some((s) => s.source_id === 'seattle_times_storm'), 'blocked from Cloudflare egress: not ingested');
  assert.ok(AUDITED_NOT_INGESTED.some((x) => x.source_id === 'wnba_transactions_json' && /user agent/i.test(x.reason)));
});

// ------------------------------------------------------------ parsing (no bodies)

test('official platform parser reads post metadata from team-site flight data and never keeps the embedded body', () => {
  const post = { id: 107845, type: 'post', title: 'Ezi Magbegor Injury Update', permalink: 'https://storm.wnba.com/news/ezi-magbegor-injury-update', excerpt: '', date: '2026-09-10T21:23:43Z', modified: '2026-09-10T21:30:00Z', category: 'Press Releases', taxonomy: { categories: { 'press-release': 'Press Releases' } }, content: 'SECRET BODY TEXT Magbegor suffered a torn right ACL', blocksV2: [{ html: 'SECRET BODY TEXT' }] };
  const chunk = JSON.stringify(`1:["$","div",null,{"posts":[${JSON.stringify(post)}]}]`);
  const html = `<html><body><script>self.__next_f.push([1,${chunk}])</script></body></html>`;
  const [item] = parseWnbaPlatform(html, { excerpts: false });
  assert.equal(item.headline, 'Ezi Magbegor Injury Update');
  assert.equal(item.url, post.permalink);
  assert.equal(item.published_at, '2026-09-10T21:23:43.000Z');
  assert.deepEqual(item.tags, ['Press Releases']);
  assert.equal(item.summary, null);
  assert.doesNotMatch(JSON.stringify(item), /SECRET BODY TEXT/);
  // www.wnba.com carries the same schema inside __NEXT_DATA__.
  const nd = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { newsData: { items: [{ ...post, id: 270435, title: 'WNBA Commissioner Cathy Engelbert to Retire', permalink: 'https://www.wnba.com/news/engelbert', excerpt: '<p>Following seven years…</p>' }] } } } })}</script>`;
  const [www] = parseWnbaPlatform(nd);
  assert.equal(www.summary, 'Following seven years…');
  assert.doesNotMatch(JSON.stringify(www), /SECRET BODY TEXT/);
});

test('news sitemap items keep date-only timestamps flagged, and only recent entries are read', () => {
  const xml = `<urlset><url><loc>https://mercury.wnba.com/news/a</loc><news:news><news:publication_date>2026-09-12</news:publication_date><news:title>Mercury sign guard</news:title></news:news></url><url><loc>https://mercury.wnba.com/news/old</loc><news:news><news:publication_date>2021-05-27</news:publication_date><news:title>Old</news:title></news:news></url></urlset>`;
  const items = parseNewsSitemap(xml, { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].timestamp_quality, 'date_only');
});

// ------------------------------------------------------------ taxonomy

test('roster move taxonomy: signings, waivers, trades, hardship and activations — and a schedule release is not a player release', () => {
  const cases = [
    ['Minnesota Lynx Sign Guard Aari McDonald', 'signing'],
    ['Aces sign Kalani Brown to rest-of-season hardship contract', 'signing'],
    ['Sparks waive Kate Martin, claim Aaliyah Nye off waivers', 'waiver'],
    ['Dream Release Guard Jaylyn Sherrod', 'waiver'],
    ['Wings trade for Natasha Howard in three-team deal', 'trade'],
    ['Valkyries activate Cecilia Zandalasini', 'roster_move'],
    ['Sun suspend contract of guard for remainder of season', 'roster_move']
  ];
  for (const [h, t] of cases) { assert.equal(eventType(h), t, h); assert.equal(laneOf(t), 'roster'); }
  assert.equal(eventType('WNBA Releases Full 2026 Playoff Schedule'), 'playoff');
  assert.equal(eventType('WNBA releases 2026 playoff schedule for NBC Sports and Peacock'), 'playoff');
});

test('league news taxonomy: commissioner, CBA, expansion, coaching, front office, awards, draft', () => {
  const cases = [
    ['WNBA Commissioner Cathy Engelbert to Retire at the End of 2026', 'league'],
    ['WNBA and WNBPA agree to extend CBA negotiation window', 'cba'],
    ['WNBA awards expansion franchise to Philadelphia', 'expansion'],
    ['Fever fire head coach after first-round exit', 'coaching'],
    ['Sparks name Ariana Andonian general manager', 'front_office'],
    ['A’ja Wilson named WNBA MVP for fourth time', 'awards'],
    ['Dream land No. 1 pick in 2027 WNBA Draft lottery', 'draft']
  ];
  for (const [h, t] of cases) { assert.equal(eventType(h), t, h); assert.equal(laneOf(t), 'league'); }
  // An injury at an international tournament is WNBA news (a WNBA consequence), a tournament result is international.
  assert.equal(eventType("Storm's Ezi Magbegor suffers torn ACL at World Cup"), 'injury');
  assert.equal(eventType('U.S. Women Top Spain 76-66 to Reach the FIBA World Cup Final Against France'), 'international');
  assert.equal(eventType('Li Yueru Will Miss 2026 FIBA World Cup After Her Passport Got Lost in Mail'), 'international');
});

test('materiality gate: official roster and injury news is material; opinion, listicles, recycled, explainers and promos are not', () => {
  const magbegor = [{ type: 'player', id: '4420318' }];
  const high = [
    [{ headline: 'Minnesota Lynx Sign Guard Aari McDonald' }, 'signing', [{ type: 'team', id: '8', method: 'source_team' }], { priority: 1 }],
    [{ headline: 'Ezi Magbegor Injury Update' }, 'injury', magbegor, { priority: 1 }],
    [{ headline: 'Ezi Magbegor tears ACL at World Cup, is out for remainder of WNBA season' }, 'injury', magbegor, { priority: 3 }],
    [{ headline: 'WNBA Commissioner Cathy Engelbert to Retire at the End of 2026' }, 'league', [], { priority: 1 }],
    [{ headline: 'Dallas Wings Clinch 2026 Playoff Berth' }, 'playoff', [{ type: 'team', id: '3', method: 'source_team' }], { priority: 1 }]
  ];
  for (const [item, type, entities, source] of high) assert.equal(materiality(item, { type, entities, source }).material, true, item.headline);
  const low = [
    ['WNBA power rankings: Lynx stay on top heading into the final week', 'news', { priority: 3 }],
    ['5 takeaways from the Lynx win over the Aces', 'result', { priority: 3 }],
    ['On this day: Diana Taurasi becomes the all-time scoring leader', 'record', { priority: 1 }],
    ['Why Kalani Brown signing with the Las Vegas Aces feels like a homecoming', 'signing', { priority: 3 }],
    ['How do the WNBA playoffs work? Dates, format and more', 'playoff', { priority: 2 }],
    ['Golden State Valkyries Announce 2026 WNBA Playoffs Ticket Information', 'playoff', { priority: 1 }],
    ['Seafoam Central: Playoffs Bound', 'playoff', { priority: 1 }],
    ['Wings Seek Playoff Berth Tuesday Night, Hosting Fire', 'playoff', { priority: 1 }],
    ['Veronica Burton Named Western Conference Player of the Week', 'awards', { priority: 1 }],
    ['Seattle Storm Names 2026 Believe in Women Honorees', 'news', { priority: 1 }],
    ['Should the Fever trade for a center before next season?', 'trade', { priority: 3 }],
    ['USA vs. France FIBA Women’s World Cup final: Channel, time, how to watch', 'international', { priority: 2 }]
  ];
  for (const [headline, type, source] of low) {
    const m = materiality({ headline }, { type, entities: magbegor, source });
    assert.equal(m.material, false, `${headline} scored ${m.score}`);
    assert.ok(m.score < MATERIAL_THRESHOLD);
  }
  // No exact publisher timestamp: may corroborate, never creates a story.
  assert.equal(materiality({ headline: 'Mercury sign guard to rest-of-season contract' }, { type: 'signing', entities: [], source: { priority: 1 }, timestampQuality: 'date_only' }).material, false);
});

// ------------------------------------------------------------ event identity + stories

test('an official team event creates one canonical PropBetEdge story filed to the Injury Desk', async () => {
  const off = await storm(90);
  assert.equal(off.source_kind, 'team_official');
  assert.ok(off.entities.some((e) => e.type === 'team' && e.id === '14' && e.method === 'source_team'), 'official site links its own team');
  assert.ok(off.entities.some((e) => e.type === 'player' && e.id === '4420318'));
  assert.equal(off.event_type, 'injury');
  assert.equal(off.materiality.material, true);
  assert.equal(off.summary, null, 'team-site excerpts are not stored');
  const { clusters, items } = withEvents([off]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].canonical_item_id, off.item_id);
  const out = await briefArticles({ externalItems: items, structured: [], now: NOW });
  assert.equal(out.length, 1);
  const a = out[0];
  assert.equal(a.status, 'published', a.gate.failures.join('\n'));
  assert.equal(a.lead_player_id, '4420318', 'the story pictures the linked player (single-subject media path)');
  assert.equal(a.context.brief.event_type, 'injury');
  assert.equal(cardOf(await withSlug(a)).desk, 'injury');
  assert.ok(a.evidence.some((e) => e.kind === 'publisher_report' && /Seattle Storm \(official\)/.test(e.publisher)));
});

test('national and beat follow-ups revise the same story: one event, one id, first publication immutable, revision stamped', async () => {
  const first = withEvents([await storm(90)]);
  const [v1] = await briefArticles({ externalItems: first.items, structured: [], now: NOW });
  // Three more publishers report the same event over the next hour; the registry carries forward.
  const later = [await storm(90), await cbs(60), await jws(45), await times(30)];
  const second = withEvents(later, first.reg);
  assert.equal(second.clusters.length, 1, 'duplicate publishers do not create duplicate events');
  assert.equal(second.clusters[0].cluster_id, first.clusters[0].cluster_id);
  assert.equal(second.clusters[0].publishers, 4);
  const [v2] = await briefArticles({ externalItems: second.items, structured: [], now: NOW + 60 * 60e3 });
  assert.equal(v2.id, v1.id);
  assert.notEqual(v2.input_hash, v1.input_hash);
  assert.ok(v2.evidence.filter((e) => e.kind === 'publisher_report').length >= 3);
  // Beat publisher that opts out of automated text reuse: headline + link only.
  assert.equal(later[3].summary, null);

  const store = new Map();
  const deps = { getItem: async () => null, putItem: async (x) => store.set(x.id, x), versionOf: () => 'wnba-briefs/1.1.0', cardOf };
  const t1 = iso(80);
  const r1 = await mergeArticles({ index: [], articles: [await withSlug(v1)], started: t1, now: Date.parse(t1), ...deps });
  const t2 = new Date(NOW + 60 * 60e3).toISOString();
  const r2 = await mergeArticles({ index: r1.index, articles: [await withSlug(v2)], started: t2, now: Date.parse(t2), ...deps });
  assert.equal(r2.index.length, 1);
  assert.equal(r2.index[0].first_published_at, t1, 'first_published_at never moves');
  assert.equal(r2.index[0].revised_at, t2, 'revised_at records the revision');
  assert.equal(r2.events[0].event, 'revision');
});

test('transaction identity is stable: a newly added source with an earlier report joins the event instead of renaming it', async () => {
  const lynx = await ingest({ headline: 'Aces Sign Kalani Brown to Rest-of-Season Contract', url: 'https://aces.wnba.com/news/aces-sign-kalani-brown', published_at: iso(5 * HOUR), tags: ['Player Movement'] }, 'team_aces');
  const run1 = withEvents([lynx]);
  const id = run1.clusters[0].cluster_id;
  assert.ok(factKey(lynx)?.startsWith('roster:'));
  // A beat source added later surfaces a report timed BEFORE the official post.
  const beat = await ingest({ headline: 'Aces sign Kalani Brown to rest-of-season deal', url: 'https://www.reviewjournal.com/sports/aces/kalani-brown-returns/', published_at: iso(6 * HOUR), tags: ['Aces'] }, 'lvrj_aces');
  const run2 = withEvents([lynx, beat], run1.reg);
  assert.equal(run2.clusters.length, 1);
  assert.equal(run2.clusters[0].cluster_id, id, 'event id is fixed when first seen');
  const run3 = withEvents([lynx, beat], run2.reg);
  assert.equal(run3.clusters[0].cluster_id, id, 're-running is idempotent');
  // v1 recomputed clusters from scratch and named them after the earliest member — the earlier report renamed the event.
  const legacy = clusterItems([lynx, beat].map((x) => ({ ...x, story_type: 'transaction' })));
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].cluster_id, `c_${beat.item_id}`);
  assert.notEqual(legacy[0].cluster_id, id);
  // Seeding the registry from v1 clusters keeps existing ids (and the briefs keyed to them).
  const seeded = seedFromClusters([{ cluster_id: 'c_legacy01', members: [lynx.item_id] }], { [lynx.item_id]: lynx });
  assert.equal(withEvents([lynx, beat], seeded).clusters[0].cluster_id, 'c_legacy01');
});

test('different facts stay different events: a replacement signing after an injury is a new story', async () => {
  const inj = await storm(120);
  const sign = await ingest({ headline: 'Storm Sign Kalani Brown to Hardship Contract', url: 'https://storm.wnba.com/news/storm-sign-brown', published_at: iso(60), tags: ['Player Movement'] }, 'team_storm');
  const { clusters, items } = withEvents([inj, sign]);
  assert.equal(clusters.length, 2);
  const out = await briefArticles({ externalItems: items, structured: [], now: NOW });
  assert.equal(new Set(out.map((a) => a.id)).size, 2);
});

test('an old article cannot become fresh: late-discovered old reports and late corroboration create no new story', async () => {
  const old = await ingest({ headline: 'Storm Sign Kalani Brown to Hardship Contract', url: 'https://storm.wnba.com/news/old-signing', published_at: new Date(NOW - BRIEF_MAX_AGE_MS - 3 * 3600e3).toISOString(), tags: [] }, 'team_storm');
  assert.equal(old.materiality.material, true, 'material, but old');
  const late = await ingest({ headline: 'Kalani Brown joins Storm on hardship deal', url: 'https://www.reviewjournal.com/sports/aces/brown-hardship/', published_at: iso(10), tags: [] }, 'lvrj_aces');
  const { items } = withEvents([old, late]);
  assert.equal(new Set(items.map((i) => i.cluster_id)).size, 1, 'the late report joins the old event');
  assert.equal((await briefArticles({ externalItems: items, structured: [], now: NOW })).length, 0);
  // …unless a brief for that event is already published, which the late report may revise.
  const briefId = (await briefArticles({ externalItems: items, structured: [], now: Date.parse(old.published_at) + 60e3 }))[0].id;
  assert.equal((await briefArticles({ externalItems: items, structured: [], now: NOW, existingIds: new Set([briefId]) }))[0].id, briefId);
  // An item with no publisher timestamp is flagged and cannot pass as fresh news.
  const n = await normalizeItem({ headline: 'Storm Sign Guard', url: 'https://storm.wnba.com/news/undated' }, src('team_storm'), dict, { startedAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(n.record.timestamp_quality, 'capture');
  assert.equal(n.record.materiality.material, false);
});

test('a brief and the later structured story for the same player event collapse onto one story with the earliest origin', () => {
  const brief = { id: 'brief0000001', kind: 'brief', desk: 'injury', lead_player_id: '4420318', first_published_at: iso(40), updated_at: iso(40), entities: [] };
  const injury = { id: 'injury000001', kind: 'injury', lead_player_id: '4420318', first_published_at: iso(30), updated_at: iso(30), entities: [], episode: '4420318|out' };
  const other = { id: 'brief0000002', kind: 'brief', desk: 'league', lead_player_id: null, first_published_at: iso(35), entities: [] };
  const cards = [brief, injury, other];
  const repairs = collapseBriefsOntoStructured(cards);
  assert.equal(brief.duplicate_of, 'injury000001');
  assert.equal(injury.first_published_at, iso(40), 'origin is the brief’s earlier publication');
  assert.equal(injury.revised_at, iso(30));
  assert.equal(other.duplicate_of, undefined);
  assert.ok(repairs.some((r) => r.fix === 'brief_collapsed_onto_structured'));
  collapseBriefsOntoStructured(cards);
  assert.equal(injury.first_published_at, iso(40), 'idempotent');
});

test('Satou lifecycle stays fixed: re-minted injury ids are still one story and a brief for her collapses onto it', async () => {
  const card = (id, injuryId, origin) => ({ id, kind: 'injury', lead_player_id: '4281929', episode: '4281929|out', first_published_at: origin, published_at: origin, updated_at: origin, input_hash: `v|${injuryId}`, entities: [] });
  const index = [card('satou0000001', '51294', iso(4 * 24 * HOUR)), card('satou0000002', '51389', iso(30))];
  const brief = { id: 'satoubrief01', kind: 'brief', desk: 'injury', lead_player_id: '4281929', published_at: iso(20), first_published_at: iso(20), updated_at: iso(20), input_hash: 'b', entities: [] };
  const { index: next } = await mergeArticles({ index: [...index, brief], articles: [], started: iso(1), now: NOW - 60e3, feed: [{ athlete_id: '4281929', status: 'Out' }], getItem: async () => null, putItem: async () => {}, versionOf: () => 'v', cardOf });
  const live = next.filter((c) => !c.superseded_by);
  assert.equal(live.length, 1);
  assert.equal(live[0].first_published_at, iso(4 * 24 * HOUR));
  assert.equal(next.find((c) => c.id === 'satoubrief01').duplicate_of, live[0].id);
});

test('International lane stays separate: tournament results never enter the WNBA wire; WNBA consequences do', async () => {
  const result = await normalizeItem({ headline: 'U.S. Women Top Spain 76-66 to Reach the FIBA World Cup Final Against France', url: 'https://www.espn.com/wnba/story/usa-spain', published_at: iso(60), tags: [] }, src('espn_wnba'), dict, { startedAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(result.international, true);
  assert.equal(result.rel.accept, false);
  assert.equal(result.record.event_type, 'international');
  const injury = await normalizeItem({ headline: "Storm's Ezi Magbegor suffers torn ACL at World Cup", url: 'https://www.espn.com/wnba/story/magbegor', published_at: iso(60), tags: [] }, src('espn_wnba'), dict, { startedAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(injury.international, true, 'kept for the international desk too');
  assert.equal(injury.rel.accept, true);
  assert.equal(injury.record.lane, 'injuries');
});

// ------------------------------------------------------------ fetching + health

test('conditional fetch: validators are replayed, a 304 is a successful empty poll, failures are isolated', async () => {
  const rss = '<rss><channel><item><title>Aces sign Kalani Brown</title><link>https://x.com/a</link><pubDate>Sat, 12 Sep 2026 10:00:00 +0000</pubDate></item></channel></rss>';
  const seen = [];
  const fake = (status, body = '', headers = {}) => async (url, init) => { seen.push(init.headers); return new Response(status === 304 ? null : body, { status, headers }); };
  const s = src('jws_wnba');
  const a = await fetchSource(s, { fetchImpl: fake(200, rss, { etag: '"abc"', 'last-modified': 'Sat, 12 Sep 2026 10:00:00 GMT' }), now: NOW });
  assert.equal(a.status, 'PASS');
  assert.equal(a.items.length, 1);
  assert.deepEqual([a.validators.etag, a.validators.parser], ['"abc"', PARSE_VERSION]);
  const b = await fetchSource(s, { validators: a.validators, fetchImpl: fake(304), now: NOW + 300e3 });
  assert.equal(seen[1]['if-none-match'], '"abc"');
  assert.equal(seen[1]['if-modified-since'], 'Sat, 12 Sep 2026 10:00:00 GMT');
  assert.equal(b.status, 'NOT_MODIFIED');
  assert.equal(b.items.length, 0);
  // Validators from an older parser are not replayed: a parser change re-reads the source once.
  await fetchSource(s, { validators: { ...a.validators, parser: 'old' }, fetchImpl: fake(200, rss), now: NOW });
  assert.equal(seen[2]['if-none-match'], undefined);
  const c = await fetchSource(s, { fetchImpl: fake(503), now: NOW });
  assert.equal(c.status, 'FAIL');
  assert.equal(c.error, 'http_503');
  const d = await fetchSource(src('team_mercury'), { validators: { at: new Date(NOW - 10 * 60e3).toISOString(), parser: PARSE_VERSION }, fetchImpl: fake(200, ''), now: NOW });
  assert.equal(d.status, 'SKIPPED', 'daily sitemap is not re-polled inside its interval');
});

test('source health records attempts, successes, failures, new events and staleness', () => {
  const s = src('team_storm');
  const h1 = updateHealth(null, s, { status: 'PASS', http_status: 200, fetched: 6, accepted: 4, new: 2, new_events: 1, duplicates_url: 2, latest_item_at: iso(30) }, { now: NOW });
  assert.equal(h1.last_status, 'PASS');
  assert.equal(h1.last_success_at, new Date(NOW).toISOString());
  assert.equal(h1.totals_24h.new_events, 1);
  assert.equal(h1.staleness, 'CURRENT');
  const h2 = updateHealth(h1, s, { status: 'FAIL', http_status: 403, error: 'http_403' }, { now: NOW + 20 * 60e3 });
  assert.equal(h2.consecutive_failures, 1);
  assert.equal(h2.last_success_at, h1.last_success_at);
  assert.equal(h2.staleness, 'STALE_FETCH');
  assert.equal(h2.error, 'http_403');
  const h3 = updateHealth(h2, s, { status: 'NOT_MODIFIED', http_status: 304 }, { now: NOW + 25 * 60e3 });
  assert.equal(h3.consecutive_failures, 0);
  assert.equal(h3.conditional, '304 honoured');
});

// ------------------------------------------------------------ publishing surfaces

const SHELL = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ok = (data, extra = {}) => ({ ok: true, status: 200, data, meta: { last_run_at: iso(3) }, ...extra });
const leagueBrief = { id: 'a1b2c3d4e5f6', slug: 'wnba-labor-news-a1b2c3', kind: 'brief', desk: 'league', event_type: 'cba', category: 'News Briefs', headline: 'WNBA labor news: the WNBA.com report and what PropBetEdge’s records show', deck: 'WNBA.com published “WNBA and WNBPA extend negotiation window”.', status: 'published', published_at: iso(200), first_published_at: iso(180), revised_at: iso(20), entities: [], lead_team_id: null, lead_player_id: null, has_market: true, market: { spread: -4.5, total: 170.5, books: 8, captured_at: iso(60), home_abbr: 'NY', away_abbr: 'LV' }, sources: ['WNBA.com'] };
const stormBrief = { ...leagueBrief, id: 'f6e5d4c3b2a1', slug: 'ezi-magbegor-injury-report-f6e5d4', desk: 'injury', event_type: 'injury', headline: 'Ezi Magbegor injury report for the Seattle Storm: what the availability records show', deck: 'Seattle Storm (official) published “Ezi Magbegor Injury Update”.', lead_team_id: '14', lead_player_id: '4420318', entities: [{ type: 'player', id: '4420318', name: 'Ezi Magbegor' }, { type: 'team', id: '14', name: 'Seattle Storm' }], has_market: false, market: null };
const cards = [leagueBrief, stormBrief];
const teams = [{ team_id: '14', name: 'Seattle Storm', short_name: 'Storm' }, { team_id: '9', name: 'New York Liberty', short_name: 'Liberty' }];
const webApi = {
  articles: async (p = {}) => ok({ items: cards.filter((c) => (!p.kind || c.kind === p.kind || c.desk === p.kind) && (!p.team || c.lead_team_id === p.team)), total: cards.length }),
  news: async (p = {}) => ok({ items: p.team === '14' ? [{ lane: 'external', id: 'x1', headline: 'Ezi Magbegor Injury Update', url: 'https://storm.wnba.com/news/ezi-magbegor-injury-update', source: { id: 'team_storm', name: 'Seattle Storm (official)', kind: 'team_official' }, published_at: iso(90), entities: [], publishers: 4 }] : [] }),
  teams: async () => ok({ teams })
};
const page = async (path) => { const p = await renderRoute(path, webApi); return { ...p, doc: p.meta ? composeDocument(SHELL, p) : null }; };

test('newsroom navigation: Latest + four desk chips, a team selector and More desks — crawlable links, no sportsbook chips on cards', async () => {
  const { status, doc } = await page('/news');
  assert.equal(status, 200);
  const nav = doc.match(/<nav class="desk-nav"[\s\S]*?<\/nav>/)[0];
  const chips = [...nav.replace(/<details[\s\S]*?<\/details>/g, '').matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(chips, [['/news', 'Latest'], ['/news/c/injury', 'Injuries'], ['/news/c/transaction', 'Roster Moves'], ['/news/c/league', 'League'], ['/news/c/international', 'International']]);
  assert.match(nav, /<details class="desk-menu" data-desk-menu>\s*<summary[^>]*>Teams/);
  assert.ok(nav.includes('href="/news/teams/14"') && nav.includes('href="/news/teams/9"'));
  assert.match(nav, /<summary[^>]*>More desks/);
  for (const k of ['brief', 'preview', 'performance', 'trend', 'props', 'market']) assert.ok(nav.includes(`href="/news/c/${k}"`), k);
  assert.doesNotMatch(doc.replace(/<aside class="panel mw">[\s\S]*?<\/aside>/, ''), /class="badge market"/, 'no sportsbook chips on editorial cards');
});

test('League desk and team news pages render server-side with the right stories, titles and 404s', async () => {
  const league = await page('/news/c/league');
  assert.equal(league.status, 200);
  assert.ok(league.doc.includes('WNBA labor news'));
  assert.ok(!league.doc.includes('Ezi Magbegor injury report'), 'league desk holds league events only');
  assert.match(league.doc, /<title>WNBA League News: Awards, Coaching/);
  const injuries = await page('/news/c/injury');
  assert.ok(injuries.doc.includes('Ezi Magbegor injury report'), 'an injury brief files to the Injury Desk');

  assert.equal(resolveRoute('/news/teams/14').id, 'news-team');
  const team = await page('/news/teams/14');
  assert.equal(team.status, 200);
  assert.match(team.doc, /<title>Seattle Storm News: Injuries, Roster Moves &amp; Official Announcements/);
  assert.match(team.doc, /<h1 class="mast-title">Seattle Storm News<\/h1>/);
  assert.ok(team.doc.includes('Ezi Magbegor injury report'));
  assert.ok(team.doc.includes('href="https://storm.wnba.com/news/ezi-magbegor-injury-update"'), 'official announcement linked, attributed');
  assert.match(team.doc, /Seattle Storm · Official/);
  assert.match(team.doc, /href="\/teams\/14"/);
  const ld = JSON.parse(team.doc.match(/<script type="application\/ld\+json" data-ld="page">([\s\S]*?)<\/script>/)[1]);
  assert.ok(ld['@graph'].some((x) => x['@type'] === 'BreadcrumbList' && JSON.stringify(x).includes('Seattle Storm news')));
  assert.equal((await page('/news/teams/999')).status, 404);
  const quiet = await page('/news/teams/9');
  assert.match(quiet.doc, /<meta name="robots" content="noindex, follow"/, 'an empty team page is noindex');
});

test('sitemaps: League desk and team news pages are listed only when live; the news sitemap keeps original publication', () => {
  const xml = sitemapXml({ articles: cards, teams, desks: ['league', 'injury'], teamNews: ['14'] });
  assert.ok(xml.includes('https://wnba.propbetedge.ai/news/c/league'));
  assert.ok(xml.includes('https://wnba.propbetedge.ai/news/teams/14'));
  assert.ok(!xml.includes('/news/teams/9<'));
  const entries = newsSitemapEntries([leagueBrief], { now: NOW });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, leagueBrief.id);
  const news = newsSitemapXml([leagueBrief], { now: NOW });
  assert.ok(news.includes(`<news:publication_date>${leagueBrief.first_published_at}</news:publication_date>`), 'revision does not move the Google News publication date');
});

test('league brief NewsArticle schema: datePublished is the first publication, dateModified the revision', async () => {
  const article = { ...leagueBrief, body: ['WNBA.com published the announcement on the league site. PropBetEdge links the report to no player or team.'], sections: [], evidence: [{ kind: 'publisher_report', publisher: 'WNBA.com', headline: 'WNBA and WNBPA extend negotiation window', url: 'https://www.wnba.com/news/x', published_at: iso(200) }], bettor_angle: { summary: 's', supporting: [], against: ['a'], unknown: ['u'], markets: [] }, market_watch: { text: [], market: null }, method: [], generator: { version: 'wnba-briefs/1.1.0' }, media: { layout: 'team', subjects: [], teams: [] } };
  const p = await renderRoute(`/news/${leagueBrief.slug}`, { ...webApi, article: async () => ok({ article, related: [] }) });
  const doc = composeDocument(SHELL, p);
  const g = JSON.parse(doc.match(/<script type="application\/ld\+json" data-ld="page">([\s\S]*?)<\/script>/)[1])['@graph'];
  const art = g.find((x) => x['@type'] === 'NewsArticle');
  assert.equal(art.datePublished, leagueBrief.first_published_at);
  assert.equal(art.dateModified, leagueBrief.revised_at);
  assert.equal(art.articleSection, 'News Briefs');
  assert.ok(art.citation.some((c) => c.url === 'https://www.wnba.com/news/x'));
});

test('RSS parser still strips tracking and keeps the Atom published/updated clocks (NBC Sports)', () => {
  const atom = '<feed><entry><title>WNBA releases 2026 playoff schedule</title><link href="https://www.nbcsports.com/wnba/news/x?utm_source=rss"/><published>2026-09-10T16:26:00Z</published><updated>2026-09-10T18:00:00Z</updated><summary>Dates set.</summary></entry></feed>';
  const [i] = parseRss(atom);
  assert.equal(i.published_at, '2026-09-10T16:26:00.000Z');
  assert.equal(i.updated_at, '2026-09-10T18:00:00.000Z');
});

test('relevance: team-scoped official and beat sources are in scope, a mixed feed still filters another sport', () => {
  const it = { headline: 'Lakers strengthen basketball operations with major hires', summary: '' };
  assert.equal(relevance(it, linkEntities(it, dict), src('nypost_liberty')).accept, false);
  const team = { headline: 'Behind the Glow: Rayah Marshall', summary: '' };
  assert.equal(relevance(team, linkEntities(team, dict), src('team_sun')).accept, true);
  assert.equal(classify(team, { entities: [], source: src('team_sun') }).materiality.material, false);
});
