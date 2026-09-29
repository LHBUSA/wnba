// SAME FACTS ≠ NEW ARTICLE. Regression suite for the WNBA newsroom repetition defect (2026-09-28):
// trend identity was team + calendar date, and the lifecycle keyed a trend to its exact ten-game window, so every
// new final minted a new "Unders in 8 of the Lynx's last 10" story while the previous one stayed listed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { trendDeep } from '../workers/wnba-news/src/deep.js';
import { cardOf } from '../workers/wnba-news/src/articles.js';
import { mergeArticles, applyTrendDecisions, repairIndex, noveltyKey, TREND_UNLISTED } from '../workers/wnba-news/src/lifecycle.js';
import { listedCardAt, reviewStory } from '../workers/wnba-news/src/legacy.js';
import { latestNewsRail } from '../src/lib/homepage-lead.js';

const T0 = Date.parse('2026-09-27T12:00:00Z');
const H = 3600e3;
const iso = (t) => new Date(t).toISOString();

// ------------------------------------------------------------------ trend-desk fixture (the real generator)
const LYNX = { team_id: '8', abbr: 'MIN', short_name: 'Lynx', name: 'Minnesota Lynx', location: 'Minnesota' };
const OPP = { team_id: '9', abbr: 'NY', short_name: 'Liberty', name: 'New York Liberty', location: 'New York' };

/** n finals, newest first. `totals[i]` is the combined score of game i against a line of 170; margins alternate so ATS never runs. */
function finals(ids, totals) {
  return ids.map((id, i) => {
    const total = totals[i];
    const margin = i % 2 ? -5 : 5;
    const us = (total + margin) / 2;
    return { game_id: id, start_utc: iso(T0 - (i + 1) * 30 * H), status: { state: 'post', completed: true }, home: { ...LYNX, score: us }, away: { ...OPP, score: total - us } };
  });
}
const UNDER_RUN = [155, 155, 180, 155, 155, 155, 180, 155, 155, 155]; // 8 of 10 under by 15, 2 over by 10
const OVER_RUN = [185, 185, 185, 185, 185, 150, 150, 150, 150, 150]; // 5-5: the run is over

async function runDesk(games, now) {
  const api = async (path) => {
    const m = /^\/v1\/games\/(.+)$/.exec(path);
    return m ? { pickcenter: [{ spread: 0, over_under: 170, provider: 'DraftKings' }] } : null;
  };
  return trendDeep({ api, finalsByTeam: new Map([[LYNX.team_id, games]]), teams: [LYNX], schedule: [], standingsById: new Map(), now, historical: false });
}

function newsroom() {
  const items = new Map();
  let index = [];
  const run = async (articles, at, decisions = null) => {
    const started = iso(at);
    const out = await mergeArticles({
      index, articles, started, now: at, feed: null,
      getItem: async (id) => items.get(id) || null,
      putItem: async (a) => { items.set(a.id, structuredClone(a)); },
      versionOf: () => 'wnba-articles/test', cardOf
    });
    index = out.index;
    if (decisions) applyTrendDecisions(index, decisions, { at: started, publishedIds: new Set(articles.filter((a) => a.kind === 'trend').map((a) => a.id)) });
    return out;
  };
  return { run, items, get index() { return index; }, listed: (at) => index.filter((c) => listedCardAt(c, at)) };
}

const W1 = ['g10', 'g9', 'g8', 'g7', 'g6', 'g5', 'g4', 'g3', 'g2', 'g1'];

test('TREND · the generator id is the run, never the calendar date', async () => {
  const a = await runDesk(finals(W1, UNDER_RUN), T0);
  const b = await runDesk(finals(W1, UNDER_RUN), T0 + 5 * 86400e3);
  assert.equal(a.length, 1);
  assert.equal(a[0].market_type, 'total');
  assert.equal(a[0].id, b[0].id, 'five days later, same games, same id');
  assert.deepEqual(a.decisions.map((d) => [d.market, d.decision]), [['total', 'standalone'], ['spread', 'not_extreme']]);
});

test('TREND · same facts, same day → same story; a second cron run writes nothing', async () => {
  const n = newsroom();
  const first = await n.run(await runDesk(finals(W1, UNDER_RUN), T0), T0);
  assert.equal(first.novelty.new_story, 1);
  const again = await n.run(await runDesk(finals(W1, UNDER_RUN), T0 + 10 * 60e3), T0 + 10 * 60e3);
  assert.deepEqual(again.novelty, { new_story: 0, revision: 0, unchanged: 1, rekeyed: 0 });
  assert.equal(again.written, 0);
  assert.equal(n.index.length, 1);
});

test('TREND · crossing ET midnight with identical facts creates ZERO new articles', async () => {
  const n = newsroom();
  const before = Date.parse('2026-09-28T03:59:00Z'); // 23:59 ET, Sep 27
  const after = Date.parse('2026-09-28T04:01:00Z'); // 00:01 ET, Sep 28
  const x = await n.run(await runDesk(finals(W1, UNDER_RUN), before), before);
  const y = await n.run(await runDesk(finals(W1, UNDER_RUN), after), after);
  assert.equal(x.novelty.new_story, 1);
  assert.equal(y.novelty.new_story, 0);
  assert.equal(y.written, 0);
  assert.equal(n.index.length, 1);
  assert.equal(n.index[0].first_published_at, iso(before));
  assert.equal(n.index[0].revised_at, null, 'nothing changed, so nothing is marked revised');
});

test('TREND · a new final in the same run revises the existing episode; origin never moves', async () => {
  const n = newsroom();
  const d1 = await runDesk(finals(W1, UNDER_RUN), T0);
  await n.run(d1, T0, d1.decisions);
  const origin = n.index[0].first_published_at;
  const W2 = ['g11', ...W1.slice(0, 9)];
  const d2 = await runDesk(finals(W2, [155, ...UNDER_RUN.slice(0, 9)]), T0 + 30 * H);
  assert.notEqual(d2[0].id, d1[0].id, 'the generator sees a new window');
  const r = await n.run(d2, T0 + 30 * H, d2.decisions);
  assert.equal(r.novelty.new_story, 0);
  assert.equal(r.novelty.revision, 1);
  assert.equal(n.index.length, 1);
  assert.equal(n.index[0].id, d1[0].id, 'same story id');
  assert.equal(n.index[0].slug, n.items.get(d1[0].id).slug, 'same URL');
  assert.equal(n.index[0].first_published_at, origin);
  assert.equal(n.index[0].revised_at, iso(T0 + 30 * H));
  assert.equal(n.index[0].trend_window.split(',')[0], 'g11');
  assert.equal(n.index[0].trend_state, 'current');
  assert.equal(n.listed(T0 + 30 * H).length, 1);
});

test('TREND · a run that stops qualifying is retired from current listings; a later new run is a new story', async () => {
  const n = newsroom();
  const d1 = await runDesk(finals(W1, UNDER_RUN), T0);
  await n.run(d1, T0, d1.decisions);
  // The desk measures the market and the run is over: no article, the episode ends.
  const W2 = ['g13', 'g12', 'g11', 'g10', 'g9', 'g8', 'g7', 'g6', 'g5', 'g4'];
  const d2 = await runDesk(finals(W2, OVER_RUN), T0 + 3 * 86400e3);
  assert.equal(d2.length, 0);
  assert.deepEqual(d2.decisions.find((d) => d.market === 'total').decision, 'not_extreme');
  await n.run(d2, T0 + 3 * 86400e3, d2.decisions);
  const ended = n.index[0];
  assert.equal(ended.trend_state, 'ended');
  assert.equal(ended.quality_state, 'retired_from_index');
  assert.equal(n.listed(T0 + 3 * 86400e3).length, 0, 'no longer current news');
  // Review cannot re-stamp an ended run as current news.
  assert.equal(reviewStory({ card: ended, item: n.items.get(ended.id) }).state, 'retired_from_index');
  // A genuinely new under run later: overlapping games, but the old episode ENDED, so this is a new episode.
  const W3 = ['g17', 'g16', 'g15', 'g14', 'g13', 'g12', 'g11', 'g10', 'g9', 'g8'];
  const d3 = await runDesk(finals(W3, UNDER_RUN), T0 + 6 * 86400e3);
  const r = await n.run(d3, T0 + 6 * 86400e3, d3.decisions);
  assert.equal(r.novelty.new_story, 1);
  assert.equal(n.index.length, 2);
  const fresh = n.index.find((c) => c.id !== ended.id);
  assert.equal(fresh.first_published_at, iso(T0 + 6 * 86400e3));
  assert.notEqual(fresh.story_key, ended.story_key);
  assert.equal(n.index.find((c) => c.id === ended.id).first_published_at, ended.first_published_at, 'the old story is not resurrected as new');
  assert.equal(n.listed(T0 + 6 * 86400e3).map((c) => c.id).join(), fresh.id);
});

test('TREND · a pass that could not measure (too few lined games) never ends an episode', async () => {
  const n = newsroom();
  const d1 = await runDesk(finals(W1, UNDER_RUN), T0);
  await n.run(d1, T0, d1.decisions);
  const d2 = await runDesk(finals(W1.slice(0, 5), UNDER_RUN.slice(0, 5)), T0 + 86400e3);
  assert.ok(d2.decisions.every((d) => d.decision === 'insufficient'));
  await n.run(d2, T0 + 86400e3, d2.decisions);
  assert.equal(n.index[0].trend_state, 'current');
  assert.equal(n.listed(T0 + 86400e3).length, 1);
});

test('TREND · one current trend per team: a still-material other market steps aside (dormant) and continues later', async () => {
  const cards = [
    { id: 'tot', kind: 'trend', lead_team_id: '8', market_type: 'total', trend_window: 'g9,g8', first_published_at: iso(T0 - 2 * 86400e3), quality_state: 'current_quality' },
    { id: 'spr', kind: 'trend', lead_team_id: '8', market_type: 'spread', trend_window: 'g10,g9', first_published_at: iso(T0), quality_state: 'current_quality' }
  ];
  applyTrendDecisions(cards, [{ team_id: '8', market: 'spread', decision: 'standalone', reason: '7-3' }, { team_id: '8', market: 'total', decision: 'secondary', reason: '8 of 10' }], { at: iso(T0), publishedIds: new Set(['spr']) });
  assert.equal(cards[0].trend_state, 'dormant');
  assert.ok(TREND_UNLISTED.has(cards[0].trend_state));
  assert.equal(listedCardAt(cards[0], T0), false);
  assert.equal(listedCardAt(cards[1], T0), true);
  // The team's story moves back to totals: the dormant episode is current again, with its ORIGINAL origin.
  applyTrendDecisions(cards, [{ team_id: '8', market: 'total', decision: 'standalone', reason: '8 of 10' }, { team_id: '8', market: 'spread', decision: 'not_extreme', reason: '6-4' }], { at: iso(T0 + 86400e3), publishedIds: new Set(['tot']) });
  assert.equal(cards[0].trend_state, 'current');
  assert.equal(cards[0].quality_state, undefined, 'the normal review decides its quality again');
  assert.equal(cards[1].trend_state, 'ended');
  assert.equal(cards[0].first_published_at, iso(T0 - 2 * 86400e3));
});

// ------------------------------------------------------------------ production duplicate cleanup (exact shapes)

test('CLEANUP · the production Lynx/Dream re-mints collapse onto one canonical story with the earliest origin', async () => {
  const H10 = 'wnba-articles/1.5.0';
  const index = [
    { id: 'd42480f8ecfa', kind: 'trend', lead_team_id: '8', headline: 'Unders in 8 of the Lynx’s last 10: the Lynx’s own scoring is the bigger part', first_published_at: '2026-09-28T04:05:16.085Z', published_at: '2026-09-27T18:00Z', updated_at: '2026-09-28T04:05:48.552Z', revised_at: null, input_hash: `${H10}|401918014,401857217,401857209,401857201,401857196,401857186,401857171,401857161,401857157,401857147|h|d`, story_key: 'trend:8:401918014,401857217,401857209,401857201,401857196,401857186,401857171,401857161,401857157,401857147', entities: [], quality_state: 'current_quality' },
    { id: '235e9b481463', kind: 'trend', lead_team_id: '8', headline: 'Unders in 8 of the Lynx’s last 10: the Lynx’s own scoring is the bigger part', first_published_at: '2026-09-25T04:00:10.000Z', published_at: '2026-09-24T00:00Z', updated_at: '2026-09-26T04:05:00.000Z', revised_at: '2026-09-26T04:05:00.000Z', input_hash: `${H10}|401857217,401857209,401857201,401857196,401857186,401857171,401857161,401857157,401857147,401857140|h|d`, story_key: 'trend:8:401857217,401857209,401857201,401857196,401857186,401857171,401857161,401857157,401857147,401857140', entities: [], quality_state: 'current_quality' },
    { id: 'd915d78d64c0', kind: 'trend', lead_team_id: '20', headline: 'The Dream are 8-2 against the spread in their last 10', published_at: '2026-09-25T23:00Z', first_published_at: '2026-09-26T04:05:00.000Z', updated_at: '2026-09-26T04:05:30.000Z', input_hash: `${H10}|401857213,401857206,a,b,c,d,e,f,g,h|h|d`, story_key: 'trend:20:401857213,401857206,a,b,c,d,e,f,g,h', entities: [] },
    { id: '544c9fff7de5', kind: 'trend', lead_team_id: '20', headline: 'The Dream are 7-3 against the spread in their last 10', published_at: '2026-09-22T23:00Z', first_published_at: '2026-09-22T23:05:00.000Z', updated_at: '2026-09-22T23:05:30.000Z', input_hash: `${H10}|401857206,a,b,c,d,e,f,g,h,i|h|d`, story_key: 'trend:20:401857206,a,b,c,d,e,f,g,h,i', entities: [] },
    { id: 'f5e53b5a2851', kind: 'trend', lead_team_id: '20', headline: 'The Dream are 7-3 against the spread in their last 10', published_at: '2026-09-21T20:00Z', first_published_at: '2026-09-21T20:12:00.000Z', updated_at: '2026-09-21T20:12:30.000Z', input_hash: `${H10}|401857199,401857206x,a,b,c,d,e,f,g,h|h|d`, story_key: 'trend:20:401857199,401857206x,a,b,c,d,e,f,g,h', entities: [] },
    // A different team's run is never merged into these.
    { id: '13227b4cde3b', kind: 'trend', lead_team_id: '9', headline: 'Unders in 8 of the Liberty’s last 10', published_at: '2026-09-27T18:00Z', first_published_at: '2026-09-28T04:05:16.085Z', updated_at: '2026-09-28T04:05:40.000Z', input_hash: `${H10}|401918014,401857217,x1,x2,x3,x4,x5,x6,x7,x8|h|d`, story_key: 'trend:9:401918014,401857217,x1,x2,x3,x4,x5,x6,x7,x8', entities: [] }
  ];
  const { cards, repairs } = await repairIndex(index, {});
  const by = new Map(cards.map((c) => [c.id, c]));
  assert.equal(by.get('235e9b481463').duplicate_of, 'd42480f8ecfa');
  assert.equal(by.get('d42480f8ecfa').first_published_at, '2026-09-25T04:00:10.000Z', 'canonical carries the episode origin');
  assert.equal(by.get('d42480f8ecfa').revised_at, '2026-09-28T04:05:48.552Z');
  assert.equal(by.get('544c9fff7de5').duplicate_of, 'd915d78d64c0');
  assert.equal(by.get('f5e53b5a2851').duplicate_of, 'd915d78d64c0');
  assert.equal(by.get('d915d78d64c0').first_published_at, '2026-09-21T20:12:00.000Z');
  assert.equal(by.get('13227b4cde3b').duplicate_of, undefined);
  assert.ok(repairs.some((r) => r.fix === 'trend_episode_assigned'));
  // Idempotent.
  const again = await repairIndex(cards, {});
  assert.deepEqual(again.repairs, []);
  assert.deepEqual(again.cards, cards);
  // Duplicates leave every listing; their URLs stay resolvable (served as the canonical story).
  const merged = await mergeArticles({ index, articles: [], started: '2026-09-28T12:00:00.000Z', putItem: async () => {}, versionOf: () => 'x', cardOf });
  const listed = merged.index.filter((c) => listedCardAt(c, Date.parse('2026-09-28T12:00:00.000Z')));
  assert.deepEqual(listed.map((c) => c.id).sort(), ['13227b4cde3b', 'd42480f8ecfa', 'd915d78d64c0']);
  assert.equal(merged.index.length, 6, 'no record is deleted');
});

// ------------------------------------------------------------------ other desks

const game = (id, start) => ({ type: 'game', id, name: 'MIN @ NY', start_utc: start });
const art = (over) => ({ status: 'published', published_at: iso(T0 - H), headline: 'h', deck: 'd', body: ['p'], evidence: [{ source: 'ESPN' }], facts: {}, entities: [], lead_team_id: '8', lead_player_id: null, category: 'x', ...over });

test('PREVIEW · one canonical story per game, even if a generator mints another id for it', async () => {
  const n = newsroom();
  await n.run([art({ id: 'prev0000aaaa', kind: 'preview', input_hash: 'a', entities: [game('401918017', iso(T0 + 30 * H))], slug: 'liberty-at-lynx-aaaaaa' })], T0);
  const r = await n.run([art({ id: 'prev0000bbbb', kind: 'preview', input_hash: 'b', headline: 'reworded', entities: [game('401918017', iso(T0 + 30 * H))], slug: 'reworded-bbbbbb' })], T0 + H);
  assert.equal(r.novelty.new_story, 0);
  assert.equal(n.index.length, 1);
  assert.equal(n.index[0].id, 'prev0000aaaa');
  assert.equal(n.index[0].slug, 'liberty-at-lynx-aaaaaa', 'URL kept');
  assert.equal(noveltyKey(n.index[0]), 'preview:401918017');
});

test('PREVIEW FINAL · once the game tips the preview leaves current listings but keeps its URL', async () => {
  const card = cardOf(art({ id: 'prev0000cccc', kind: 'preview', entities: [game('401918017', iso(T0 + 2 * H))], slug: 'p-cccccc', published_at: iso(T0), updated_at: iso(T0) }));
  card.quality_state = 'current_quality';
  assert.equal(listedCardAt(card, T0), true);
  assert.equal(listedCardAt(card, T0 + 2 * H), false, 'tip-off');
  assert.equal(listedCardAt(card, T0 + 30 * H), false, 'final');
});

test('RESULT · one canonical result per game', async () => {
  const n = newsroom();
  await n.run([art({ id: 'res000000001', kind: 'result', input_hash: '1', entities: [game('401918014', iso(T0 - 5 * H))] })], T0);
  const r = await n.run([art({ id: 'res000000002', kind: 'performance', input_hash: '2', headline: 'Stewart scores 30', entities: [game('401918014', iso(T0 - 5 * H))] })], T0 + H);
  assert.equal(r.novelty.new_story, 0);
  assert.equal(r.novelty.revision, 1);
  assert.equal(n.index.length, 1);
});

const inj = (id, status, sourceAt, over = {}) => art({ id, kind: 'injury', lead_player_id: '3913', input_hash: sourceAt, published_at: sourceAt, entities: [{ type: 'player', id: '3913', name: 'Satou Sabally' }], facts: { injury: { injury_id: id, athlete_id: '3913', status, source_updated_at: sourceAt } }, ...over });

test('INJURY · a continuing episode stays one article; a genuinely new status is a new article', async () => {
  const n = newsroom();
  await n.run([inj('inj000000001', 'Out', iso(T0))], T0);
  const same = await n.run([inj('inj000000002', 'Out', iso(T0 + 6 * H), { headline: 'refreshed' })], T0 + 6 * H);
  assert.equal(same.novelty.new_story, 0, 'ESPN re-minted the id; same player, same status');
  assert.equal(n.index.length, 1);
  const change = await n.run([inj('inj000000003', 'Day-To-Day', iso(T0 + 30 * H))], T0 + 30 * H);
  assert.equal(change.novelty.new_story, 1, 'a status change is a new development');
  assert.equal(n.index.filter((c) => !c.superseded_by).length, 1, 'still only one current story per player');
});

test('REVISION · updated/revised clocks move, first_published_at cannot', async () => {
  const n = newsroom();
  await n.run([art({ id: 'res000000009', kind: 'result', input_hash: 'v1', entities: [game('g', iso(T0 - H))] })], T0);
  const origin = n.index[0].first_published_at;
  for (let i = 1; i <= 3; i += 1) await n.run([art({ id: 'res000000009', kind: 'result', input_hash: `v${i + 1}`, headline: `rev ${i}`, entities: [game('g', iso(T0 - H))] })], T0 + i * H);
  assert.equal(n.index[0].first_published_at, origin);
  assert.equal(n.index[0].revised_at, iso(T0 + 3 * H));
  assert.equal(n.index[0].revisions.length, 3);
});

// ------------------------------------------------------------------ Latest News presentation

const story = (id, kind, hAgo, over = {}) => ({ id, kind, status: 'published', quality_state: 'current_quality', first_published_at: iso(T0 - hAgo * H), entities: [], ...over });

test('LATEST NEWS · avoidable same-desk repetition yields to varied current news', () => {
  const lead = story('lead', 'performance', 0.5);
  const rail = latestNewsRail([lead, story('t1', 'trend', 1), story('t2', 'trend', 1.1), story('p1', 'preview', 1.2), story('p2', 'preview', 1.3), story('i1', 'injury', 3), story('f1', 'commissioned_feature', 5)], lead, { limit: 4, now: T0 });
  assert.deepEqual(rail.map((c) => c.kind), ['trend', 'preview', 'injury', 'commissioned_feature'], 'one per desk, newest first');
});

test('LATEST NEWS · breaking/material news always wins over cosmetics', () => {
  const lead = story('lead', 'performance', 0.5);
  const rail = latestNewsRail([lead, story('i1', 'injury', 1), story('i2', 'injury', 1.5), story('i3', 'injury', 2), story('t1', 'trend', 2.5), story('f1', 'commissioned_feature', 3)], lead, { limit: 4, now: T0 });
  assert.deepEqual(rail.map((c) => c.id), ['i1', 'i2', 'i3', 't1'], 'three fresh availability changes are all shown');
});

test('LATEST NEWS · no forced diversity when only one desk has news', () => {
  const lead = story('lead', 'preview', 0.5);
  assert.deepEqual(latestNewsRail([lead, story('p1', 'preview', 1), story('p2', 'preview', 2), story('p3', 'preview', 3)], lead, { limit: 3, now: T0 }).map((c) => c.id), ['p1', 'p2', 'p3']);
});

// ------------------------------------------------------------------ archive

test('ARCHIVE · every historical URL survives cleanup and retirement (the Worker serves a duplicate as its canonical)', async () => {
  // The route itself (index.js articleRoute: slug -> card -> duplicate_of -> canonical item) is verified against
  // production; node cannot load index.js (bundled JSON imports). Here: the records the route needs are never dropped.
  const at = Date.parse('2026-09-28T12:00:00.000Z');
  const index = [
    { id: 'd42480f8ecfa', slug: 'unders-lynx-d42480', kind: 'trend', lead_team_id: '8', headline: 'Unders in 8 of the Lynx’s last 10', first_published_at: '2026-09-28T04:05:16.085Z', published_at: '2026-09-27T18:00Z', updated_at: '2026-09-28T04:05:48.552Z', input_hash: 'v|g11,g10,g9,g8,g7,g6,g5,g4,g3,g2|h|d', entities: [] },
    { id: '235e9b481463', slug: 'unders-lynx-235e9b', kind: 'trend', lead_team_id: '8', headline: 'Unders in 8 of the Lynx’s last 10', first_published_at: '2026-09-25T04:00:10.000Z', published_at: '2026-09-24T00:00Z', updated_at: '2026-09-26T04:05:00.000Z', input_hash: 'v|g10,g9,g8,g7,g6,g5,g4,g3,g2,g1|h|d', entities: [] },
    { id: 'prev0000dddd', slug: 'liberty-at-lynx-dddd', kind: 'preview', first_published_at: '2026-09-25T14:20:00.000Z', published_at: '2026-09-25T14:20:00.000Z', entities: [{ type: 'game', id: '401918014', start_utc: '2026-09-27T18:00Z' }] }
  ];
  const { index: next } = await mergeArticles({ index, articles: [], started: iso(at), putItem: async () => {}, versionOf: () => 'x', cardOf });
  const by = new Map(next.map((c) => [c.id, c]));
  assert.equal(next.length, 3);
  assert.equal(by.get('235e9b481463').slug, 'unders-lynx-235e9b', 'the old URL is still in the index');
  assert.equal(by.get('235e9b481463').duplicate_of, 'd42480f8ecfa', 'and resolves to the canonical story');
  assert.equal(by.get('prev0000dddd').slug, 'liberty-at-lynx-dddd');
  assert.deepEqual(next.filter((c) => listedCardAt(c, at)).map((c) => c.id), ['d42480f8ecfa'], 'only current news is listed');
});

// ------------------------------------------------------------------ external wire: same publisher, same report

import { assignEvents } from '../workers/wnba-news/src/events.js';

const wireItem = (id, url, headline, at, source = 'the_ix') => ({ item_id: id, source_id: source, source_name: source, canonical_url: url, headline, published_at: at, first_captured_at: at, event_type: 'news', story_type: 'news', priority: 3, entities: [{ type: 'player', id: '2998928', name: 'Breanna Stewart' }] });

test('WIRE · one publisher re-filing the same report under another URL is ONE event (production: The IX, 2026-09-28)', () => {
  const at = '2026-09-28T17:46:06.000Z';
  const h = 'Breanna Stewart was ‘putting out fires’ in historic Game 1 performance';
  const a = wireItem('21664e1bca796d26f7d0', 'https://www.theixsports.com/uncategorized/breanna-stewart-putting-out-fires-historic-game-1-performance-new-york-liberty', h, at);
  const b = wireItem('910e6ce19985d4261bde', 'https://www.theixsports.com/features/breanna-stewart-putting-out-fires-historic-game-1-performance-new-york-liberty', h, at);
  const fresh = assignEvents([a, b], null, { now: Date.parse(at) + H });
  assert.equal(fresh.clusters.length, 1);
  assert.equal(fresh.joined[0].rule, 'same_publisher_variant');
  // The registry production already holds (two events, minted before the rule) is repaired in place.
  const split = { version: 'wnba-events/1.0.0', item_event: { [a.item_id]: `c_${a.item_id}`, [b.item_id]: `c_${b.item_id}` }, events: {
    [`c_${a.item_id}`]: { event_id: `c_${a.item_id}`, event_type: 'news', fact_keys: [], players: ['2998928'], teams: [], first_published_at: at, last_published_at: at, first_seen_at: at, members: [{ item_id: a.item_id, source_id: 'the_ix', headline: h, published_at: at, event_type: 'news' }] },
    [`c_${b.item_id}`]: { event_id: `c_${b.item_id}`, event_type: 'news', fact_keys: [], players: ['2998928'], teams: [], first_published_at: at, last_published_at: at, first_seen_at: at, members: [{ item_id: b.item_id, source_id: 'the_ix', headline: h, published_at: at, event_type: 'news' }] }
  } };
  const repaired = assignEvents([a, b], split, { now: Date.parse(at) + H });
  assert.equal(repaired.clusters.length, 1);
  assert.equal(repaired.repaired.length, 1);
  assert.equal(repaired.clusters[0].cluster_id, `c_${a.item_id}`, 'the first-minted event id is kept');
  // Idempotent.
  assert.equal(assignEvents([a, b], repaired.registry, { now: Date.parse(at) + 2 * H }).repaired.length, 0);
});

test('WIRE · genuinely different reports from one publisher stay separate', () => {
  const g1 = wireItem('espn-g1', 'https://www.espn.com/video/clip?id=46600001', 'Las Vegas Aces vs. Indiana Fever - Game Highlights', '2026-09-28T02:30:00.000Z', 'espn_wnba');
  const g2 = wireItem('espn-g2', 'https://www.espn.com/video/clip?id=46600002', 'Las Vegas Aces vs. Indiana Fever - Game Highlights', '2026-09-30T02:30:00.000Z', 'espn_wnba');
  const qf = wireItem('ix-qf', 'https://www.theixsports.com/features/liberty-lynx-quarterfinal-preview-keys', 'Liberty vs Lynx quarterfinal preview: three keys', '2026-09-28T10:00:00.000Z');
  const sf = wireItem('ix-sf', 'https://www.theixsports.com/features/liberty-lynx-semifinal-preview-keys', 'Liberty vs Lynx semifinal preview: three keys', '2026-09-28T12:00:00.000Z');
  const out = assignEvents([g1, g2, qf, sf], null, { now: Date.parse('2026-09-30T03:00:00.000Z') });
  assert.equal(out.clusters.length, 4, 'Game 1 vs Game 2 highlights, quarterfinal vs semifinal preview');
});
