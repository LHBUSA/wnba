import test from 'node:test';
import assert from 'node:assert/strict';

import { briefArticles, BRIEF_MAX_AGE_MS } from '../workers/wnba-news/src/briefs.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60e3).toISOString();

const item = (overrides = {}) => ({
  item_id: 'item-a',
  cluster_id: 'c_item-a',
  // An approved national publisher (WNBA.com is under source-policy review and never supports a brief).
  source_id: 'nbc_sports_wnba',
  source_name: 'NBC Sports',
  priority: 2,
  canonical_url: 'https://www.nbcsports.com/wnba/news/league-update',
  headline: 'WNBA announces a new league operations update',
  published_at: iso(5),
  source_updated_at: null,
  story_type: 'league',
  relevance: 5,
  entities: [],
  ...overrides
});

// wnba-briefs/2.0.0: a single uncorroborated league report with nothing PropBetEdge can verify is a link, not a story;
// an independent second publisher corroborates the event and the brief publishes.
const corroboration = (overrides = {}) => item({ item_id: 'item-a2', source_id: 'espn_wnba', source_name: 'ESPN', canonical_url: 'https://www.espn.com/wnba/story/league-update', headline: 'WNBA league operations update confirmed', published_at: iso(4), ...overrides });

test('a fresh material source cluster becomes a publishable PBE News Brief', async () => {
  const alone = await briefArticles({ externalItems: [item()], structured: [], now: NOW });
  assert.equal(alone.length, 0, 'one uncorroborated report with no PropBetEdge record to add is not a standalone story');
  assert.equal(alone.decisions[0].decision, 'external_coverage');
  const out = await briefArticles({ externalItems: [item(), corroboration()], structured: [], now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'brief');
  assert.equal(out[0].category, 'News Briefs');
  assert.equal(out[0].status, 'published');
  assert.equal(out[0].gate.ok, true, out[0].gate.failures?.join('\n'));
  // V3 leads with the event, not the source registry. Attribution remains in
  // the article and evidence without quoting publisher headlines as body copy.
  assert.doesNotMatch(out[0].headline, /^NBC Sports:/);
  assert.ok(!out[0].headline.includes('WNBA announces a new league operations update'));
  assert.match(out[0].deck, /Multiple independent publishers are reporting the same WNBA league development/i);
  assert.match(out[0].body[0], /league-level change rather than a player-specific basketball event/i);
  assert.match(out[0].body.join(' '), /NBC Sports and ESPN both reported/i);
  assert.doesNotMatch(out[0].body.join(' '), /under the headline|The details beyond that headline remain/i);
  assert.deepEqual(out[0].sections.map((x) => x.title), ['What changed', 'League context']);
  assert.equal(out[0].published_at, iso(5));
  assert.equal(out[0].bettor_angle, null, 'no stored market: no standing betting disclaimer');
});

test('corroboration revises one stable brief instead of creating a duplicate story', async () => {
  const first = await briefArticles({ externalItems: [item(), corroboration()], structured: [], now: NOW });
  const secondSource = item({
    item_id: 'item-b',
    source_id: 'espn_wnba',
    source_name: 'ESPN',
    priority: 2,
    canonical_url: 'https://www.espn.com/wnba/story/update',
    headline: 'WNBA league operations update draws new details',
    published_at: iso(2)
  });
  const revised = await briefArticles({ externalItems: [item(), corroboration(), secondSource], structured: [], now: NOW });

  assert.equal(first.length, 1);
  assert.equal(revised.length, 1);
  assert.equal(revised[0].id, first[0].id);
  assert.notEqual(revised[0].input_hash, first[0].input_hash);
});

test('a different material cluster creates a genuinely new article id', async () => {
  const other = item({
    item_id: 'item-c',
    cluster_id: 'c_item-c',
    canonical_url: 'https://www.nbcsports.com/wnba/news/second-event',
    headline: 'WNBA announces a separate expansion update',
    published_at: iso(1)
  });
  const otherToo = corroboration({ item_id: 'item-c2', cluster_id: 'c_item-c', canonical_url: 'https://www.espn.com/wnba/story/expansion-update', headline: 'WNBA expansion update confirmed' });
  const out = await briefArticles({ externalItems: [item(), corroboration(), other, otherToo], structured: [], now: NOW });

  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id);
});

test('external injury coverage does not duplicate an already-published structured injury story', async () => {
  const injury = item({
    story_type: 'injury',
    headline: 'Alyssa Example ruled out with an ankle injury',
    entities: [{ type: 'player', id: '42', name: 'Alyssa Example', team_id: '7' }, { type: 'team', id: '7', name: 'Example Team' }]
  });
  const structured = [{ id: 'inj-42', kind: 'injury', status: 'published', lead_player_id: '42', lead_team_id: '7' }];
  const out = await briefArticles({ externalItems: [injury], structured, now: NOW });

  assert.equal(out.length, 0);
});

test('a different named player transaction on the same team is not suppressed', async () => {
  const tx = item({
    story_type: 'transaction',
    headline: 'Example Team signs Alyssa Example to a contract',
    entities: [{ type: 'player', id: '42', name: 'Alyssa Example', team_id: '7' }, { type: 'team', id: '7', name: 'Example Team' }]
  });
  const structured = [{ id: 'tx-other', kind: 'transaction', status: 'published', lead_player_id: '99', lead_team_id: '7' }];
  const out = await briefArticles({ externalItems: [tx], structured, now: NOW });

  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'brief');
});

test('a report from a source under policy review (WNBA.com) creates no brief', async () => {
  const out = await briefArticles({ externalItems: [item({ source_id: 'wnba_com', source_name: 'WNBA.com', priority: 1, canonical_url: 'https://www.wnba.com/news/league-update' })], structured: [], now: NOW });
  assert.equal(out.length, 0);
});

test('old source-wire events do not get promoted into new briefs', async () => {
  const old = item({ published_at: new Date(NOW - BRIEF_MAX_AGE_MS - 60e3).toISOString() });
  const out = await briefArticles({ externalItems: [old], structured: [], now: NOW });
  assert.equal(out.length, 0);
});

// ------------------------------------------------------------ wnba-briefs/1.1.0 editorial structure

import { reconcileArticle } from '../workers/wnba-news/src/reconcile.js';

const CARLA = { type: 'player', id: '5208982', name: 'Carla Leite', team_id: '132052', method: 'exact_full_name', on_current_roster: true };
const FIRE = { type: 'team', id: '132052', name: 'Portland Fire' };
const carlaItem = item({
  item_id: 'feb18fa744704c89169f', cluster_id: 'c_feb18fa744704c89169f', source_id: 'swish_appeal', source_name: 'Swish Appeal', priority: 2,
  canonical_url: 'https://www.swishappeal.com/wnba/86660/portland-fire-france-carla-leite',
  headline: 'Carla Leite is the special talent firing up the relaunched Portland Fire', story_type: 'news', relevance: 4, published_at: iso(60),
  summary: 'Publisher summary text that must never appear in PropBetEdge prose.',
  entities: [CARLA, FIRE]
});
const game = (d, pts, min) => ({ game_id: `g${d}`, date: `2026-08-${String(d).padStart(2, '0')}T23:00Z`, team_id: '132052', min, pts, reb: 2, ast: 6, result: 'W' });
const carlaCtx = {
  season: 2026,
  api: async (path) => (path === '/v1/players/5208982' ? {
    player: { athlete_id: '5208982', name: 'Carla Leite', position_name: 'Guard', team: { team_id: '132052', name: 'Portland Fire', short_name: 'Fire' } },
    gamelog: { seasons: [{ name: '2026 Regular Season', games: [game(28, 20, 30), game(26, 18, 29), game(24, 19, 28), game(22, 17, 30), game(20, 19, 29), game(18, 10, 22), game(16, 12, 24)] }] }
  } : null),
  injuries: [{ athlete_id: '5208982', team_id: '132052', name: 'Carla Leite', status: 'Out', body_part: 'Not Injury Related', source_updated_at: '2026-08-29T16:22Z', short_comment: 'The Fire temporarily suspended Leite contract Saturday before the World Cup break began.' }],
  transactions: [],
  schedule: [{ game_id: '401857199', start_utc: '2026-09-17T23:00Z', status: { state: 'pre' }, home: { team_id: '132052', name: 'Portland Fire' }, away: { team_id: '129689', name: 'Golden State Valkyries' } }],
  standingsById: new Map([['132052', { wins: 14, losses: 22, seed: 9, conference_name: 'Western Conference', last_ten: '4-6' }]]),
  dict: { teamById: new Map([['132052', { name: 'Portland Fire' }]]) }
};

test('Carla Leite acceptance: a feature about a player is publisher coverage, not a newsroom event', async () => {
  const out = await briefArticles({ externalItems: [carlaItem], structured: [], now: NOW, ctx: carlaCtx });
  assert.equal(out.length, 0, 'Swish Appeal publishing a profile creates no standalone PropBetEdge story');
  assert.deepEqual(out.decisions.map((d) => d.decision), ['external_coverage']);
  assert.match(out.decisions[0].reason, /event type "news" is coverage, not a development/);
  // …even with full PropBetEdge records available: original value cannot manufacture an event.
  const bare = await briefArticles({ externalItems: [carlaItem], structured: [], now: NOW });
  assert.equal(bare.length, 0);
});

const carlaSigning = item({
  item_id: 'carla-ext-01', cluster_id: 'c_carla-ext-01', source_id: 'swish_appeal', source_name: 'Swish Appeal', priority: 2,
  canonical_url: 'https://www.swishappeal.com/wnba/carla-leite-extension', headline: 'Portland Fire sign Carla Leite to contract extension', story_type: 'transaction', relevance: 4, published_at: iso(60),
  summary: 'Publisher summary text that must never appear in PropBetEdge prose.',
  entities: [CARLA, FIRE]
});

test('a material brief is a reader-first PBE article with grounded basketball context', async () => {
  const [a] = await briefArticles({ externalItems: [carlaSigning], structured: [], now: NOW, ctx: carlaCtx });
  assert.equal(a.status, 'published', a.gate.failures.join('\n'));
  assert.equal(a.headline, 'Portland Fire sign Carla Leite: the role she enters');
  assert.doesNotMatch(a.headline, /^Swish Appeal:|the report and/);
  assert.match(a.deck, /^Carla Leite brings 16\.4 points and 27\.4 minutes per game into a roster move/);
  assert.deepEqual(a.sections.map((x) => x.title), ['The move', 'Leite’s role', 'The Fire context', 'Next game']);
  const text = a.body.join('\n');
  assert.match(text, /Portland Fire are involved in a reported roster move with Carla Leite/);
  assert.match(text, /Carla Leite has averaged 16\.4 points, 2 rebounds and 6 assists in 27\.4 minutes across 7 games/);
  assert.match(text, /last five games.*18\.6 points in 29\.2 minutes.*2\.2 above her season scoring average/);
  assert.match(text, /Portland Fire are 14–22, No\. 9 in the Western Conference/);
  assert.match(text, /next play the Golden State Valkyries at home/);
  assert.doesNotMatch(text, /under the headline|What PropBetEdge|ESPN’s injury feed lists her as Out|Publisher summary text/);
  assert.equal(a.bettor_angle, null);
  assert.ok(a.method.some((m) => /does not reproduce the article body/.test(m)));
  assert.ok(a.evidence.some((e) => e.kind === 'publisher_report' && e.publisher === 'Swish Appeal'));
  assert.ok(a.evidence.some((e) => e.kind === 'record' && /ESPN game log \(2026 Regular Season\)/.test(e.source)));
  assert.ok(a.entities.some((e) => e.type === 'game' && e.id === '401857199'));
  assert.deepEqual(a.facts.brief.value.dimensions, ['season_production', 'recent_form', 'availability_listing', 'team_standing', 'schedule']);
  const rec = reconcileArticle(a, { season: 2026, injuries: carlaCtx.injuries });
  assert.equal(rec.ok, true, rec.failures.join('\n'));
});

test('a developing brief with no structured context still publishes truthfully and keeps its story identity', async () => {
  const [bare] = await briefArticles({ externalItems: [carlaSigning], structured: [], now: NOW });
  const [rich] = await briefArticles({ externalItems: [carlaSigning], structured: [], now: NOW, ctx: carlaCtx });
  assert.equal(bare.status, 'published', bare.gate.failures.join('\n'));
  assert.equal(bare.id, rich.id, 'structured context changes the copy, never the story id');
  assert.notEqual(bare.input_hash, rich.input_hash, 'a records change is a revision of the same story');
  assert.doesNotMatch(bare.body.join(' '), /\d+\.\d+ points/);
  // A bare report older than the developing window, with nothing PropBetEdge can add, does not publish.
  const stale = await briefArticles({ externalItems: [{ ...carlaSigning, published_at: iso(4 * 60) }], structured: [], now: NOW });
  assert.equal(stale.length, 0);
  assert.equal(stale.decisions.at(-1).decision, 'external_coverage');
});
