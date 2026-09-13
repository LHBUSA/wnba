// Final newsroom hardening: legacy-story policy, trend materiality, Market vs Intelligence separation, record / draft /
// league-business desk readiness on REAL stored records (tests/fixtures/newsroom-desks-2026-09-13.json: source-wire
// items and the wnba-api records they link to), health metrics, maturation and paraphrase-level duplication.
// QA fixtures only — nothing here is published.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { briefArticles, verifyRecordClaim } from '../workers/wnba-news/src/briefs.js';
import { assessDepth, SCOUTING_LANGUAGE, BUSINESS_CLAIMS } from '../workers/wnba-news/src/depth.js';
import { reviewStory, listedCard, needsReview, LEGACY_POLICY_VERSION } from '../workers/wnba-news/src/legacy.js';
import { newsroomHealth, demoteExternalCoverage } from '../workers/wnba-news/src/articles-run.js';
import { trendMateriality } from '../workers/wnba-news/src/deep.js';
import { trendArticles, previewArticles, withSlug, cardOf } from '../workers/wnba-news/src/articles.js';
import { mergeArticles } from '../workers/wnba-news/src/lifecycle.js';
import { buildDictionary } from '../workers/wnba-news/src/editorial.js';
import { repeatsIdea, duplicatedIdeas, ideaOf } from '../src/lib/semantic.js';
import { intelligenceOf } from '../src/lib/intelligence.js';
import { articleView } from '../src/views/article.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const DESKS = read('./fixtures/newsroom-desks-2026-09-13.json');
const FX = read('./fixtures/newsroom-2026-09-11.json');
const dapi = async (p) => DESKS.api[p] ?? null;
const dStandings = new Map((DESKS.api['/v1/standings'].groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
const dctx = { api: dapi, season: 2026, injuries: [], transactions: [], schedule: DESKS.api['/v1/schedule?from=20260913&to=20260920'].games, standingsById: dStandings, dict: { teamById: new Map() } };
const wire = (re) => DESKS.wire.filter((w) => re.test(w.headline));

// ------------------------------------------------------------ 1–3: legacy policy

const card = (o = {}) => ({ id: 'legacy000001', slug: 'x-legacy', kind: 'result', status: 'published', input_hash: 'wnba-articles/1.2.0|g|h|d', first_published_at: '2026-09-11T18:49:07.399Z', revisions: [], ...o });
const thinResult = { kind: 'result', headline: 'The New York Liberty beat the Chicago Sky, 85–66', deck: 'Final from Saturday.', lead_team_id: '9', body: ['The New York Liberty beat the Chicago Sky 85–66 on Saturday, August 29, and the result moved them to a better record in the standings.', 'The Liberty shot well.'], sections: [{ title: 'The read', first: 0, count: 1 }, { title: 'How it happened', first: 1, count: 1 }], facts: { box_lines: [{ name: 'A', team_id: '9', pts: 20 }], quarters: [{}], team_stats: { w: {} }, after: { w: { w: 30, l: 9 } }, next: [{}], lead: {} }, evidence: [{ kind: 'record', source: 'ESPN box score', record: {} }], entities: [{ type: 'game', id: '401857184' }] };

test('1 · legacy-state classification: every live story gets one intentional state', () => {
  const now = Date.parse('2026-09-13T20:00:00Z');
  assert.equal(reviewStory({ card: card({ status: 'external_coverage', coverage_review: { reason: 'coverage' } }), item: thinResult, now }).state, 'external_coverage');
  assert.equal(reviewStory({ card: card(), item: thinResult, now, withheld: true }).state, 'retired_from_index');
  const rebuilt = reviewStory({ card: card(), item: thinResult, now, regeneration: { passed: true } });
  assert.equal(rebuilt.state, 'quality_upgrade_available');
  const legacy = reviewStory({ card: card(), item: thinResult, now, regeneration: { passed: false, failures: ['depth: 248 words is below the Full floor of 300'] } });
  assert.equal(legacy.state, 'legacy_acceptable');
  assert.match(legacy.reason, /published under wnba-articles\/1\.2\.0; the current generator cannot rebuild it/);
  assert.equal(legacy.policy, LEGACY_POLICY_VERSION);
  // A repetitive legacy body is an integrity failure: it leaves the index.
  const repetitive = { ...thinResult, body: [thinResult.body[0], thinResult.body[0]] };
  assert.equal(reviewStory({ card: card(), item: repetitive, now }).state, 'retired_from_index');
  // An injury whose listing ended, with a later story for the player, is not current news.
  const injury = card({ id: 'inj000000001', kind: 'injury', lead_player_id: '4257500', listing_ended_at: '2026-09-13T13:43:22.684Z' });
  const later = { id: 'fcf4e61beefe', kind: 'transaction', lead_player_id: '4257500', first_published_at: '2026-09-12T23:40:57.581Z' };
  const r = reviewStory({ card: injury, item: { ...thinResult, kind: 'injury' }, now, cards: [injury, later] });
  assert.equal(r.state, 'retired_from_index');
  assert.match(r.reason, /listing this story reports ended 2026-09-13 and a later story covers the player \(fcf4e61beefe\)/);
  // A withheld trend no longer stands alone.
  assert.equal(reviewStory({ card: card({ kind: 'trend' }), item: { ...thinResult, kind: 'trend' }, now, deskDecision: { decision: 'withheld', reason: '3-7 against the spread, but by only 1.6 points a game on average' } }).state, 'retired_from_index');
  assert.equal(needsReview(card({ quality_review: { policy: LEGACY_POLICY_VERSION, at: '2026-09-13T19:00:00Z' } })), false, 'reviewed once per policy version');
  assert.equal(needsReview(card({ quality_review: { policy: LEGACY_POLICY_VERSION, at: '2026-09-13T19:00:00Z' }, revised_at: '2026-09-13T19:30:00Z' })), true, '…and again after a revision');
});

test('2 · a weak historical story can remain intentionally preserved, listed and labelled', () => {
  const c = card({ quality_state: 'legacy_acceptable', quality_review: { policy: LEGACY_POLICY_VERSION, state: 'legacy_acceptable', generator: 'wnba-articles/1.2.0', reason: 'published under wnba-articles/1.2.0; kept as a legitimate short story' } });
  assert.equal(listedCard(c), true);
  const html = String(articleView({ article: { ...thinResult, ...c, first_published_at: c.first_published_at, media: null, method: [] }, related: [] }));
  assert.match(html, /Published under an earlier newsroom standard \(wnba-articles\/1\.2\.0\)/);
  assert.equal(c.first_published_at, '2026-09-11T18:49:07.399Z');
});

test('3 · external coverage and retirement leave the newsroom without deleting the URL or history', async () => {
  const item = { id: 'e22194684c40', slug: 'carla-e22194', kind: 'brief', evidence: [{ kind: 'publisher_report', publisher: 'Swish Appeal', headline: 'Carla Leite is the special talent firing up the relaunched Portland Fire' }], facts: { brief: { linked_entities: [] } }, context: { brief: {} }, revisions: [{ at: '2026-09-13T12:08:23Z', kind: 'data_update' }] };
  const cards = [{ id: item.id, slug: item.slug, kind: 'brief', status: 'published', revisions: item.revisions }];
  const puts = [];
  await demoteExternalCoverage(cards, { at: '2026-09-13T18:35:52Z', getItem: async () => item, putItem: async (x) => puts.push(x) });
  assert.equal(listedCard(cards[0]), false);
  assert.equal(puts[0].id, item.id);
  assert.equal(cards[0].slug, 'carla-e22194', 'URL kept');
  assert.deepEqual(cards[0].revisions.map((r) => r.kind), ['data_update', 'demoted_to_external_coverage'], 'history kept and extended');
  const retired = card({ quality_state: 'retired_from_index', quality_review: { reason: 'the injury listing this story reports ended 2026-09-13' } });
  assert.equal(listedCard(retired), false);
  assert.match(String(articleView({ article: { ...thinResult, ...retired, media: null, method: [] }, related: [] })), /No longer listed in the newsroom/);
});

// ------------------------------------------------------------ 4–5: trends

const row = (i, total, line, ou = total > line ? 'O' : 'U') => ({ game_id: `g${i}`, total, total_line: line, ou, margin: 0, spread: 0, ats: 'P' });
test('4 · a trend with one weak datapoint is withheld', () => {
  const lopsided = Array.from({ length: 10 }, (_, i) => row(i, 170, i < 8 ? 171 : 169)); // 8 unders, each by one point
  const m = trendMateriality(lopsided, { market: 'total' });
  assert.equal(m.material, false);
  assert.match(m.reason, /by only 0\.\d points a game/);
  const oneBig = Array.from({ length: 10 }, (_, i) => row(i, i === 0 ? 150 : 172, i < 8 ? 176 : 170));
  assert.match(trendMateriality(oneBig, { market: 'total' }).reason, /only 1 of the 10 games missed the total by 10 or more/);
  assert.equal(trendMateriality(lopsided.slice(0, 7), { market: 'total' }).material, false, 'fewer than eight lined games is no run');
});

test('5 · a trend with enough evidence passes, and says what it cannot show', async () => {
  const S = {};
  const standingsById = new Map((FX.api['/v1/standings']?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
  const players = FX.api['/v1/players'];
  const teams = []; const seen = new Set();
  for (const p of players.players) if (p.team && !seen.has(p.team.team_id)) { seen.add(p.team.team_id); teams.push(p.team); }
  const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
  const longSched = FX.api[`/v1/schedule?from=${add('20260911', -50)}&to=20260911`];
  const finalsByTeam = new Map();
  for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }
  const xs = await trendArticles({ api: async (p) => FX.api[p] ?? null, finalsByTeam, teams: teams.filter((t) => t.team_id === '19'), schedule: FX.api[`/v1/schedule?from=${add('20260911', -14)}&to=${add('20260911', 7)}`].games, standingsById, now: Date.parse(FX.as_of) });
  S.sky = await withSlug(xs[0]);
  assert.equal(xs.decisions[0].decision, 'standalone');
  assert.match(xs.decisions[0].reason, /8 of 10 unders, 7\.5 points a game, 4 by 10 or more/);
  const titles = S.sky.sections.map((s) => s.title);
  for (const t of ['The read', 'The evidence', 'The market now', 'The team and the opponent', 'The counter-case']) assert.ok(titles.includes(t), t);
  const text = S.sky.body.join(' ');
  assert.match(text, /Does it persist across the window\?/);
  assert.match(text, /small sample/);
  assert.doesNotMatch(text, /consensus[^.]*across books/i, 'no manufactured cross-book depth from a single book');
  assert.equal(S.sky.status, 'published', S.sky.gate.failures.join('\n'));
  assert.equal(assessDepth(S.sky, { now: Date.parse(FX.as_of) }).pass, true);
});

// ------------------------------------------------------------ 6: Market vs Intelligence

test('6 · preview Market (facts) and Intelligence (analysis) cannot duplicate one another', async () => {
  const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
  const games = FX.api[`/v1/schedule?from=${add('20260911', -14)}&to=${add('20260911', 7)}`].games;
  const injuries = FX.api['/v1/injuries'].items;
  const [p] = await previewArticles({ api: async (x) => FX.api[x] ?? null, upcoming: games.filter((g) => String(g.game_id) === '401857194'), injuries, now: Date.parse(FX.as_of), teams: [] });
  const market = p.body.slice(p.sections.find((s) => s.title === 'The market').first, p.sections.find((s) => s.title === 'The market').first + p.sections.find((s) => s.title === 'The market').count);
  assert.ok(market.length >= 1);
  assert.doesNotMatch(market.join(' '), /Where the price sits|strongest record support|Set against the evidence|combined season scoring|case against/i, 'no analysis in The market');
  assert.match(market.join(' '), /PropBetEdge’s latest capture \(Sep \d+ at [\d:]+ [AP]M ET, \d+ books, The Odds API\)/);
  const intel = intelligenceOf(p);
  assert.equal(intel.render.intelligence, true);
  assert.match(intel.copy.summary, /^Where the price sits: the 8\.5-point spread is/);
  assert.deepEqual(duplicatedIdeas([intel.copy.summary, ...intel.copy.supporting], [p.headline, p.deck, ...p.body]), [], 'Intelligence adds to the body');
  assert.deepEqual(p.market_watch.text, [], 'the market module does not restate the capture');
  const html = String(articleView({ article: { ...p, slug: 'x-03dcc7', first_published_at: FX.as_of, media: null }, related: [] }));
  assert.doesNotMatch(html, /Market evidence/, 'no second rendering of the capture inside Intelligence');
  // If Intelligence merely restated the line it would not render.
  const restating = { ...p, intelligence: undefined, bettor_angle: { ...p.bettor_angle, summary: 'The key consideration for bettors is that the Aces are 8.5-point favorites.', supporting: [] } };
  assert.equal(intelligenceOf(restating).render.intelligence, false);
});

// ------------------------------------------------------------ 7: record desk (real Angel Reese record)

test('7 · a record story requires the achievement in PropBetEdge records (real Angel Reese 29th double-double)', async () => {
  const items = wire(/Reese breaks/);
  const now = Date.parse('2026-08-30T23:00:00Z');
  const [a] = await briefArticles({ externalItems: items, structured: [], now, ctx: dctx });
  assert.equal(a.status, 'published', a.gate.failures.join('\n'));
  assert.equal(a.facts.brief.verified.record.verified, true);
  assert.equal(a.facts.brief.verified.record.season_count, 29);
  const text = a.body.join('\n');
  assert.match(text, /PropBetEdge’s game log confirms the count: Angel Reese has 29 double-doubles in 40 games of the 2026 regular season/);
  assert.match(text, /makes no comparison with earlier seasons or league history; the record itself is ESPN’s reporting/);
  assert.equal(assessDepth(a, { now }).pass, true, assessDepth(a, { now }).failures.join('\n'));
  // The same claim with a count the log does not support stays external coverage.
  const wrong = items.map((x) => ({ ...x, headline: x.headline.replace('29th', '31st') }));
  const out = await briefArticles({ externalItems: wrong, structured: [], now, ctx: dctx });
  assert.equal(out.length, 0);
  assert.match(out.decisions.at(-1).reason, /record claim not verified in PropBetEdge records \(the 2026 Regular Season log shows 29, not 31\)/);
  assert.equal(verifyRecordClaim(DESKS.api['/v1/players/4433402'], 'Angel Reese named to All-WNBA team', '2026-08-30T19:00:00Z', 2026), null, 'no checkable claim → no verification');
});

// ------------------------------------------------------------ 8–10: draft and league/business

test('8 · a draft story cannot invent scouting adjectives; physical data only as the record carries it', async () => {
  const miles = DESKS.api['/v1/players/4433791'].player;
  const item = { item_id: 'draft-qa-1', cluster_id: 'c_draft_qa', source_id: 'espn_wnba', source_name: 'ESPN', priority: 2, canonical_url: 'https://www.espn.com/wnba/story/qa-draft', headline: 'Lynx acquire first-round pick in the 2027 WNBA draft', published_at: '2026-09-13T12:00:00Z', event_type: 'draft', materiality: { score: 3.5, material: true, flags: [], reasons: ['QA fixture: draft desk readiness'] }, entities: [{ type: 'player', id: miles.athlete_id, name: miles.name, team_id: '8' }, { type: 'team', id: '8', name: 'Minnesota Lynx' }] };
  const [a] = await briefArticles({ externalItems: [item], structured: [], now: Date.parse('2026-09-13T12:30:00Z'), ctx: dctx });
  assert.ok(a, 'draft desk produces a story from real player/team records');
  const text = a.body.join(' ');
  assert.match(text, /PropBetEdge’s player record lists Olivia Miles as a 5' 10" guard from TCU, age 23\./);
  assert.doesNotMatch(text, SCOUTING_LANGUAGE);
  assert.match(text, /not in PropBetEdge’s records until the draft itself is recorded/);
  const invented = { ...a, body: [...a.body.slice(0, -1), 'She brings a high motor and elite feel to a WNBA-ready guard room.'] };
  assert.ok(assessDepth(invented, { now: Date.parse('2026-09-13T12:30:00Z') }).failures.some((f) => /scouting language is not a record/.test(f)));
  // A publisher's own words inside its quoted headline are attribution, not PropBetEdge copy.
  const quoted = { ...a, body: [`ESPN ran “Carla Leite is the special talent firing up the Fire” as its headline.`, ...a.body.slice(1)] };
  assert.ok(!assessDepth(quoted, { now: Date.parse('2026-09-13T12:30:00Z') }).failures.some((f) => /scouting/.test(f)));
});

test('9–10 · league/business stories: FACT → CONTEXT → IMPLICATION → UNKNOWN, no invented money, motive or legal conclusion, no betting module', async () => {
  // Real Cathy Engelbert retirement reports (ESPN + Winsidr; the WNBA.com press item is under source-policy review).
  const now = Date.parse('2026-09-04T20:00:00Z');
  const [league] = await briefArticles({ externalItems: wire(/Engelbert/), structured: [], now, ctx: dctx });
  assert.equal(league.status, 'published', league.gate.failures.join('\n'));
  assert.deepEqual(league.sections.map((s) => s.title), ['What changed', 'What remains unresolved']);
  assert.ok(!JSON.stringify(league.evidence).includes('wnba.com'), 'no review-required source');
  assert.equal(league.bettor_angle, null);
  assert.equal(intelligenceOf(league).render.intelligence, false);
  assert.equal(assessDepth(league, { now }).pass, true);
  // Real Kanter Freedom lawsuit reports: below materiality in production; forced material here to exercise the desk.
  const suit = wire(/Kanter Freedom files suit|Sues Chicago Sky/).map((x) => ({ ...x, materiality: { ...x.materiality, score: 4, material: true, flags: [], reasons: ['QA fixture: forced material to exercise the desk'] } }));
  const [biz] = await briefArticles({ externalItems: suit, structured: [], now: Date.parse('2026-09-04T22:00:00Z'), ctx: dctx });
  assert.ok(biz);
  assert.equal(biz.bettor_angle, null, 'business news has no sportsbook component');
  assert.equal(intelligenceOf(biz).render.intelligence, false);
  assert.match(biz.body.join(' '), /PropBetEdge makes no legal or financial assessment/);
  assert.doesNotMatch(biz.body.join(' ').replace(/“[^”]*”/g, ''), BUSINESS_CLAIMS);
  const invented = { ...biz, body: [...biz.body, 'The Sky seek to avoid a $2 million settlement, and the claim is meritless.'] };
  assert.ok(assessDepth(invented, { now: Date.parse('2026-09-04T22:00:00Z') }).failures.some((f) => /unsourced financial, motive or legal claim/.test(f)));
  // Real Sparks general-manager hire: the team context comes from records, the next game is stated, nothing is inferred.
  const [fo] = await briefArticles({ externalItems: wire(/Andonian/), structured: [], now: Date.parse('2026-09-05T12:00:00Z'), ctx: dctx });
  assert.match(fo.body.join(' '), /The roster the change inherits: the heaviest minutes over the Sparks’ last five games belong to/);
  assert.equal(assessDepth(fo, { now: Date.parse('2026-09-05T12:00:00Z') }).pass, true);
});

// ------------------------------------------------------------ 11: health

test('11 · health metrics reflect the actual stored states', () => {
  const cards = [
    { id: 'a', kind: 'injury', quality_state: 'current_quality', depth: { class: 'full', words: 470, contract: 'injury' }, intel: { rendered: true, suppressed: false }, has_market: true },
    { id: 'b', kind: 'result', quality_state: 'legacy_acceptable', quality_review: { depth: { words: 248, contract: 'game' } } },
    { id: 'c', kind: 'brief', status: 'external_coverage' },
    { id: 'd', kind: 'trend', quality_state: 'retired_from_index' },
    { id: 'e', kind: 'preview', quality_state: 'current_quality', depth: { class: 'full', words: 706, contract: 'preview' }, intel: { rendered: false, suppressed: true } }
  ];
  const h = newsroomHealth(cards, { held: [{ failures: ['depth: 199 words is below the Full floor of 300'] }, { failures: ['provenance: source observed after generation'] }] });
  assert.deepEqual(h.quality_states, { current_quality: 2, quality_upgrade_available: 0, legacy_acceptable: 1, external_coverage: 1, retired_from_index: 1 });
  assert.equal(h.legacy_below_standard, 1);
  assert.equal(h.market_modules_with_attached_market, 1);
  assert.equal(h.intelligence_suppressed_non_additive, 1);
  assert.equal(h.held_for_substance, 1);
  assert.equal(h.provenance_failures_this_run, 1);
  assert.deepEqual(h.live_depth_classes, { full: 2, unclassified: 1 });
  assert.deepEqual(h.words_by_desk, { injury: 470, game: 248, preview: 706 });
});

// ------------------------------------------------------------ 12: maturation

test('12 · depth maturation Flash → Brief → Full → Deep at one URL, and a later move out of the newsroom keeps the trail', async () => {
  const store = new Map();
  const deps = { getItem: async (id) => store.get(id) || null, putItem: async (x) => store.set(x.id, structuredClone(x)), versionOf: () => 'wnba-briefs/2.0.0', cardOf };
  const base = { id: 'mature000001', kind: 'brief', published_at: '2026-09-13T10:00:00.000Z', category: 'News Briefs', headline: 'Portland Fire roster move: the team it changes', deck: 'A deck long enough for a card.', body: ['x'], sections: [], entities: [], evidence: [], facts: { brief: { event_type: 'signing' } }, status: 'published', gate: { ok: true, failures: [] } };
  let index = [];
  const steps = [['flash', '2026-09-13T10:03:00.000Z'], ['brief', '2026-09-13T10:20:00.000Z'], ['full', '2026-09-13T10:35:00.000Z'], ['deep', '2026-09-13T12:00:00.000Z']];
  for (const [i, [cls, at]] of steps.entries()) {
    const a = await withSlug({ ...structuredClone(base), depth: { class: cls }, input_hash: `v${i}`, headline: `${base.headline}${i ? ` (${cls})` : ''}` });
    ({ index } = await mergeArticles({ index, articles: [a], started: at, now: Date.parse(at), ...deps }));
  }
  const c = index[0];
  assert.equal(index.length, 1);
  assert.equal(c.first_published_at, steps[0][1]);
  assert.equal(c.slug.endsWith('-mature'), true);
  assert.deepEqual(c.revisions.map((r) => `${r.kind}:${r.from}>${r.to}`), ['depth_upgrade:flash>brief', 'depth_upgrade:brief>full', 'depth_upgrade:full>deep']);
  // The report later proves not to be an event: it moves out of the newsroom, history intact.
  store.set(c.id, { ...store.get(c.id), evidence: [{ kind: 'publisher_report', publisher: 'Swish Appeal', headline: 'Why the Fire should sign a guard this offseason' }], facts: { brief: { linked_entities: [] } } });
  await demoteExternalCoverage(index, { at: '2026-09-13T14:00:00.000Z', getItem: deps.getItem, putItem: deps.putItem });
  assert.equal(index[0].status, 'external_coverage');
  assert.deepEqual(index[0].revisions.map((r) => r.kind), ['depth_upgrade', 'depth_upgrade', 'depth_upgrade', 'demoted_to_external_coverage']);
  assert.equal(index[0].first_published_at, steps[0][1]);
});

// ------------------------------------------------------------ 13: paraphrases

test('13 · semantic duplication catches paraphrases, not only repeated strings', () => {
  assert.equal(repeatsIdea('The key consideration for bettors is player availability.', ['This matters because of player availability.']), true);
  assert.equal(repeatsIdea('What to watch is who takes her minutes in the rotation.', ['Her 22.3 minutes leave a hole in the rotation.']), true);
  assert.equal(repeatsIdea('The Sky average 82.5 points in those games.', ['The Sky have gone under in eight of 10.']), false, 'a new figure is new information');
  assert.equal(repeatsIdea('Rebounding is the edge: the Aces are +4.1 a game on the glass.', ['The Aces are 8.5-point favorites.']), false, 'a different idea');
  assert.deepEqual([...ideaOf('The key consideration for bettors is player availability.').concepts], ['availability']);
  assert.deepEqual(duplicatedIdeas(['For bettors, the injury listing is what matters most.'], ['ESPN’s injury feed lists her as Out.']), ['For bettors, the injury listing is what matters most.']);
});
