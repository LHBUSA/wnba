// Newsroom quality overhaul: the single PropBetEdge Intelligence decision, international media, game-story depth,
// temporal provenance, grammar and regeneration — anchored on the real Spain 81–58 Germany bronze-medal records
// (tests/fixtures/international/bronze-401917259-overhaul.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { decideIntelligence, intelligenceOf, intelligenceFailures } from '../src/lib/intelligence.js';
import { storyFor, intlStoryId } from '../workers/wnba-news/src/international.js';
import { buildGameFacts, writeGameStory, depthFailures, requiredWords, count, participated, wordCount } from '../workers/wnba-news/src/game-story.js';
import { internationalMediaFrom } from '../workers/wnba-news/src/media-resolve.js';
import { provenanceFailures, visualFailures } from '../workers/wnba-news/src/quality.js';
import { lintProse, reconcileArticle } from '../workers/wnba-news/src/reconcile.js';
import { mergeArticles } from '../workers/wnba-news/src/lifecycle.js';
import { cardOf, withSlug, finalize } from '../workers/wnba-news/src/articles.js';
import { articleView, storyClock } from '../src/views/article.js';
import { storyMedia, storyThumb } from '../src/ui/story-media.js';
import { articleCard } from '../src/ui/articles.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const FX = read('./fixtures/international/bronze-401917259-overhaul.json');
const MANIFEST = read('../data/newsroom-media.json').players;
const CUTOFF = new Date(Date.parse(FX.captured_at) + 60e3).toISOString();
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

const spain = async (over = {}) => storyFor({ competition: FX.competition, detail: over.detail || FX.detail, schedule: FX.schedule, priorDetails: FX.prior, medals: FX.medals, cutoff: over.cutoff || CUTOFF, backfill: over.backfill || false });
const withMedia = (a) => ({ ...a, media: internationalMediaFrom(MANIFEST, a) });
/** The same game with every WNBA crosswalk link removed: a truly WNBA-free international story. */
const noWnbaDetail = () => ({ ...FX.detail, boxscore: { teams: FX.detail.boxscore.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, wnba: null })) })) }, wnba_players: [] });
const BETTING = /PropBetEdge Intelligence|Bettor angle|Why it matters for bettors|Markets touched|Market angle|Market evidence|What the market shows|best-line board|href="\/props"|joins a WNBA roster|No licensed photograph|No stored market capture/i;

// ------------------------------------------------------------ 1–6, 16: one relevance decision

test('1 · relevance none suppresses every betting and market module (WNBA-free international game)', async () => {
  const a = withMedia(await spain({ detail: noWnbaDetail() }));
  assert.equal(a.intelligence.market_relevance, 'none');
  assert.equal(a.intelligence.market_data_status, 'not_applicable');
  assert.equal(a.bettor_angle, null);
  assert.deepEqual(a.market_watch, { text: [], market: null, game_id: null });
  assert.ok(!a.entities.some((e) => e.type === 'player'));
  const html = String(articleView({ article: { ...a, slug: 'x-8ccc44', first_published_at: CUTOFF }, related: [] }));
  assert.doesNotMatch(html, BETTING);
  assert.doesNotMatch(html, /pbe-intel/);
  assert.ok(!a.sections.some((s) => s.title === 'WNBA connection'), '15 · no WNBA connection without a WNBA participant');
});

test('2 · contextual relevance cannot carry actionable market language', async () => {
  const a = await spain();
  assert.equal(a.intelligence.market_relevance, 'contextual', 'current WNBA players appeared, no market is attached');
  const pushed = { ...a, bettor_angle: { summary: 'Awa Fam gives bettors an edge: lean the over on her rebounds next week in Seattle.', supporting: [], against: [], unknown: [], markets: [] } };
  assert.ok(intelligenceFailures(pushed).includes('intelligence: actionable market language without actionable relevance'));
  const priced = { ...a, bettor_angle: { summary: 'The Storm are 6.5-point underdogs in their next game after this World Cup run.', supporting: [], against: [], unknown: [], markets: [] } };
  assert.ok(intelligenceFailures(priced).includes('intelligence: price language without an attached market'));
});

test('3 · actionable relevance requires a WNBA link AND an attached market capture', () => {
  const market = { market: { spread: { home_line: -4.5 }, total: { line: 168.5 }, books: 7, captured_at: '2026-09-13T12:00:00Z' }, game_id: '401857199' };
  assert.equal(decideIntelligence({ kind: 'preview', entities: [], market }).market_relevance, 'none', 'a market without a WNBA link is not actionable');
  assert.equal(decideIntelligence({ kind: 'preview', entities: [{ type: 'team', id: '14' }], market: null }).market_relevance, 'contextual', 'a WNBA link without a capture is context');
  const act = decideIntelligence({ kind: 'preview', entities: [{ type: 'team', id: '14' }], market });
  assert.equal(act.market_relevance, 'actionable');
  assert.deepEqual(act.markets_touched, ['spread', 'total']);
  const faked = { kind: 'preview', entities: [], intelligence: { ...act, links: [], market_data_status: 'unavailable' }, bettor_angle: { summary: 's', markets: ['spread'] }, market_watch: {} };
  const f = intelligenceFailures(faked);
  assert.ok(f.includes('intelligence: actionable relevance without a WNBA player, team or game'));
  assert.ok(f.includes('intelligence: actionable relevance without an attached market'));
});

test('4 · markets touched cannot exist without supported market relevance, and a generator list is ignored', async () => {
  const a = finalize({ id: 'ctx000000001', kind: 'injury', category: 'Injuries', headline: 'Ezi Magbegor listed out for the Storm: the minutes and who takes them', deck: 'ESPN’s injury feed lists Ezi Magbegor as out for the Seattle Storm.', body: ['ESPN’s injury feed lists Ezi Magbegor as out for the Seattle Storm, and the team has several games left on its schedule to play without her.'.repeat(4)], bettor: ['Her absence moves real rotation minutes to teammates, which is context for anyone reading Storm player markets later.'], markets: ['spread', 'total', 'player_props'], market_angle: { text: [], market: null, game_id: null }, entities: [{ type: 'player', id: '4420318', name: 'Ezi Magbegor' }], facts: {}, evidence: [{ kind: 'record', source: 'ESPN WNBA injury feed' }], primary_subject: 'Ezi Magbegor', published_at: '2026-09-13T12:00:00Z' });
  assert.equal(a.intelligence.market_relevance, 'contextual');
  assert.deepEqual(a.bettor_angle.markets, [], 'the generator’s wish list never becomes “markets touched”');
  const tampered = { ...a, bettor_angle: { ...a.bettor_angle, markets: ['player_props'] } };
  assert.ok(intelligenceFailures(tampered).some((x) => x.startsWith('intelligence: markets touched require actionable relevance')));
  assert.doesNotMatch(String(articleView({ article: { ...a, slug: 'ezi-000000', first_published_at: a.published_at }, related: [] })), /Markets touched/);
});

test('5 · article, card and renderer cannot disagree: all read the one stored decision', async () => {
  for (const detail of [FX.detail, noWnbaDetail()]) {
    const a = withMedia(await withSlug(await spain({ detail })));
    const card = cardOf(a);
    assert.equal(card.intelligence.market_relevance, a.intelligence.market_relevance);
    assert.equal(intelligenceOf(a).market_relevance, a.intelligence.market_relevance);
    // A legacy copy without the stored decision recomputes the SAME answer from the same facts.
    const legacy = { ...a, intelligence: undefined };
    assert.equal(intelligenceOf(legacy).market_relevance, a.intelligence.market_relevance);
    const html = String(articleView({ article: { ...a, first_published_at: CUTOFF }, related: [] }));
    assert.equal(/pbe-intel/.test(html), a.intelligence.render.intelligence);
    assert.equal(Boolean(card.bettor_snippet), a.intelligence.market_relevance === 'actionable' && Boolean(a.bettor_angle));
  }
});

test('6 · no attached market suppresses market-specific claims and modules', async () => {
  const a = await spain();
  const claim = { ...a, market_watch: { text: ['The spread moved two points toward Spain before tip.'], market: null, game_id: null } };
  assert.ok(intelligenceFailures(claim).includes('intelligence: actionable market language without actionable relevance'));
  assert.doesNotMatch(String(articleView({ article: { ...claim, slug: 's-8ccc44', first_published_at: CUTOFF }, related: [] })), /Market evidence|moved two points/);
});

test('16 · no unsupported betting relevance: the Spain–Germany story renders zero betting modules', async () => {
  const a = withMedia(await withSlug(await spain()));
  assert.equal(a.bettor_angle, null, 'the desk supplies no betting copy');
  assert.equal(a.intelligence.render.intelligence, false);
  const html = String(articleView({ article: { ...a, first_published_at: CUTOFF }, related: [] }));
  assert.doesNotMatch(html, BETTING);
});

// ------------------------------------------------------------ 7–9: media

test('7 · international story gets an approved featured-subject photo, else the deterministic scoreboard', async () => {
  const a = await spain();
  const m = internationalMediaFrom(MANIFEST, a);
  assert.equal(m.layout, 'intl_photo');
  assert.equal(m.subjects[0].name, 'Maria Conde', 'the first featured player with an approved photo');
  assert.ok(a.body.join(' ').includes('Maria Conde'), 'the pictured player appears in the article');
  assert.ok(m.subjects[0].credit.license && m.subjects[0].credit.source_page);
  const none = internationalMediaFrom({}, a);
  assert.equal(none.layout, 'intl_game');
  assert.deepEqual(visualFailures(a, m), []);
  assert.deepEqual(visualFailures(a, none), []);
  assert.deepEqual(visualFailures(a, { layout: 'team', teams: [] }), ['visual: international story has no resolved hero (approved photo or scoreboard)']);
  // Never an unrelated stand-in: a featured list without approved photos falls back to the scoreboard.
  assert.equal(internationalMediaFrom(MANIFEST, { ...a, context: { ...a.context, international: { ...a.context.international, featured: [{ espn_id: '4433627', name: 'Iyana Martin' }] } } }).layout, 'intl_game');
});

test('8 · deterministic fallback shows the correct teams, flags, score, medal and competition', async () => {
  const m = internationalMediaFrom({}, await spain());
  const html = String(storyMedia(m, { slot: 'hero', eager: true }));
  const t = text(html);
  assert.match(html, /src="\/media\/flags\/esp\.svg"/);
  assert.match(html, /src="\/media\/flags\/ger\.svg"/);
  assert.match(t, /Spain\s+81/);
  assert.match(t, /Germany\s+58/);
  assert.match(t, /Bronze medal/);
  assert.match(t, /FIBA Women’s Basketball World Cup 2026/);
  assert.match(t, /PropBetEdge International/);
  assert.match(html, /aria-label="Spain 81, Germany 58\. Bronze medal · Final\./);
  assert.doesNotMatch(t, /No licensed|stand-in|not approved/i);
});

test('9 · story cards, rows and related cards receive the same image metadata', async () => {
  const a = await withSlug(await spain());
  const card = cardOf(a);
  assert.equal(card.intl.winner.name, 'Spain');
  const cm = internationalMediaFrom({}, card);
  assert.equal(cm.layout, 'intl_game');
  assert.deepEqual(cm.visual.teams.map((x) => [x.name, x.score]), [['Spain', 81], ['Germany', 58]]);
  const photoCard = internationalMediaFrom(MANIFEST, card);
  assert.equal(photoCard.subjects[0].name, 'Maria Conde', 'the card resolves the same subject as the article');
  const cardHtml = String(articleCard({ ...card, media: cm }));
  assert.match(cardHtml, /class="ib ib--full ib--card"/);
  assert.match(text(String(storyThumb(cm, 64))), /81–58/);
});

// ------------------------------------------------------------ 10: grammar

test('10 · deterministic singular/plural for counted stat nouns, enforced by the prose lint', () => {
  for (const [noun, plural] of [['point', 'points'], ['rebound', 'rebounds'], ['assist', 'assists'], ['steal', 'steals'], ['block', 'blocks'], ['turnover', 'turnovers'], ['minute', 'minutes'], ['foul', 'fouls'], ['three-pointer', 'three-pointers']]) {
    assert.equal(count(1, noun), `1 ${noun}`);
    assert.equal(count(2, noun), `2 ${plural}`);
    assert.ok(lintProse(`She had 1 ${plural} in the game.`).some((x) => x.startsWith('singular count with a plural noun')), `1 ${plural}`);
  }
  assert.ok(lintProse('She had 3 assist in the game.').some((x) => x.startsWith('plural count with a singular noun')));
  assert.deepEqual(lintProse('She had 11 assists, 21 points and an 8-point run.'), []);
});

// ------------------------------------------------------------ 11–12: provenance

test('11 · generation cannot precede its source observations; the byline never shows an impossible source time', async () => {
  const a = await spain();
  assert.deepEqual(provenanceFailures(a, { generatedAt: CUTOFF }), []);
  assert.ok(Date.parse(a.published_at) <= Date.parse(CUTOFF), 'source clock is the observation, not an estimated game end');
  assert.equal(a.published_at, FX.detail.game.fetched_at);
  const early = new Date(Date.parse(FX.detail.game.fetched_at) - 3600e3).toISOString();
  assert.ok(provenanceFailures(a, { generatedAt: early }).some((x) => x.startsWith('provenance: source observed')));
  // The old article: published 16:36Z, "source record" 17:00Z (tip-off + 2.5h estimate). That line can no longer render.
  const old = FX.old_article;
  assert.ok(Date.parse(old.published_at) > Date.parse(old.first_published_at), 'fixture reproduces the bug');
  assert.equal(storyClock(old).observed, null);
  assert.doesNotMatch(String(articleView({ article: { ...old, media: null }, related: [] })), /Source record|Source data as of/);
});

test('12 · play-by-play and source records observed after the cutoff cannot leak into a revision', () => {
  const plays = [
    { period: 1, clock: '9:40', scoring: true, points: 2, home_score: 0, away_score: 2, team_id: 'nt-spain', type: 'LayUpShot', player_ids: ['p-4433627'], wallclock: '2026-09-13T14:32:00Z' },
    { period: 4, clock: '0:10', scoring: true, points: 3, home_score: 58, away_score: 81, team_id: 'nt-spain', type: 'JumpShot', player_ids: ['p-4433627'], wallclock: '2026-09-13T16:25:00Z' }
  ];
  const detail = { ...FX.detail, plays, plays_available: true, fetched_at: '2026-09-13T16:30:00Z', game: { ...FX.detail.game, fetched_at: '2026-09-13T16:30:00Z' } };
  const early = buildGameFacts({ competition: FX.competition, detail, schedule: FX.schedule, priorDetails: FX.prior, cutoff: '2026-09-13T15:00:00Z' });
  assert.equal(early.error, 'source_observed_after_cutoff', 'a record observed after the cutoff cannot be used at all');
  const detail2 = { ...detail, fetched_at: '2026-09-13T16:00:00Z', game: { ...detail.game, fetched_at: '2026-09-13T16:00:00Z' } };
  const f = buildGameFacts({ competition: FX.competition, detail: detail2, schedule: FX.schedule, priorDetails: FX.prior, cutoff: '2026-09-13T16:10:00Z' }).facts;
  assert.equal(f.provenance.plays_published, 2);
  assert.equal(f.provenance.plays_used, 1, 'a play whose wall clock is after the observation/cutoff is excluded');
  // Earlier games count only when they finished and were observed before the cutoff.
  const lateSchedule = FX.schedule.map((g) => ({ ...g, fetched_at: '2026-09-13T18:00:00Z' }));
  const g2 = buildGameFacts({ competition: FX.competition, detail: detail2, schedule: lateSchedule, priorDetails: FX.prior, cutoff: '2026-09-13T16:10:00Z' }).facts;
  assert.equal(g2.path.winner.games.length, 0);
});

// ------------------------------------------------------------ 13–14: depth

test('13 · a rich-data medal-game story fails the depth gate when it is only a short summary', async () => {
  const built = buildGameFacts({ competition: FX.competition, detail: FX.detail, schedule: FX.schedule, priorDetails: FX.prior, cutoff: CUTOFF, medals: FX.medals });
  const s = writeGameStory(built.facts);
  // No play-by-play was published for this game, so the data-aware requirement is below the full 800.
  assert.equal(requiredWords(built.facts), 710);
  assert.deepEqual(depthFailures({ facts: built.facts, coverage: s.coverage, body: s.body, sections: s.sections }), []);
  const shallow = { body: s.body.slice(0, 3), sections: s.sections.slice(0, 2), coverage: ['lede', 'flow'] };
  const f = depthFailures({ facts: built.facts, ...shallow });
  assert.ok(f.some((x) => /medal story has \d+ words; the available data requires at least 710/.test(x)));
  assert.ok(f.includes('depth: missing why coverage'));
  // …and the desk holds such a story rather than publishing it.
  const a = await spain();
  assert.equal(a.status, 'published', a.gate.failures.join('\n'));
});

test('14 · a breaking story with genuinely sparse data may stay short', () => {
  const sparse = { ...FX.detail, boxscore: null };
  const built = buildGameFacts({ competition: FX.competition, detail: sparse, schedule: [], cutoff: CUTOFF });
  assert.equal(built.facts.story_class, 'breaking');
  const s = writeGameStory(built.facts);
  assert.ok(wordCount(s.body) < 60);
  assert.equal(requiredWords(built.facts), 60);
});

// ------------------------------------------------------------ Spain–Germany acceptance

test('Spain–Germany acceptance: a real game story, grammatical, grounded, gated', async () => {
  const a = await spain();
  const body = a.body.join('\n');
  const words = wordCount(a.body);
  assert.ok(words >= 800 && words <= 1300, `${words} words`);
  assert.ok(wordCount(FX.old_article.body) < 150, 'the old story was a database summary');
  const titles = a.sections.map((s) => s.title).filter(Boolean);
  for (const t of ['How the game unfolded', 'The stretch that decided it', 'Why Spain won', 'Who delivered', 'What Germany couldn’t overcome', 'What bronze means', 'WNBA connection']) assert.ok(titles.includes(t), t);
  assert.match(body, /1 assist\b/);
  assert.doesNotMatch(body, /\b1 assists\b/);
  assert.match(body, /Spain won the third quarter 21–15/);
  assert.match(body, /Germany gave the ball away 18 times/);
  assert.match(body, /In the group stage Spain beat Germany 83–53/);
  assert.match(body, /Awa Fam \(Seattle Storm\)/, 'WNBA participation read from the box score, not from minutes');
  assert.doesNotMatch(body, /No player on a current WNBA roster logged minutes/);
  assert.doesNotMatch(body, /joins a WNBA roster|wanted it more/i);
  assert.equal(a.gate.ok, true, a.gate.failures.join('\n'));
  const rec = reconcileArticle(await withSlug(a), { season: 2026, injuries: [] });
  assert.equal(rec.ok, true, rec.failures.join('\n'));
  assert.equal(participated({ min: null, starter: false, pts: 0, reb: 0, ast: 0, pf: 0 }), false);
  assert.equal(participated({ min: null, starter: true }), true);
});

// ------------------------------------------------------------ 17–19: evidence, URL stability, revisions

test('17 · Evidence & methodology remains available (collapsed, crawlable) with sources and method', async () => {
  const a = withMedia(await withSlug(await spain()));
  const html = String(articleView({ article: { ...a, first_published_at: CUTOFF }, related: [] }));
  assert.match(html, /<details class="evidence-method">/);
  assert.match(html, /Evidence &amp; methodology/);
  assert.match(html, /href="https:\/\/wnba\.propbetedge\.ai\/international\/games\/401917259"/);
  assert.match(text(html), /Built by PropBetEdge from the FIBA Women’s Basketball World Cup 2026 game record/);
  assert.match(text(html), /Photo: .*CC BY/);
});

test('18–19 · regeneration keeps the id, slug and first publication, and records revision history', async () => {
  const old = FX.old_card;
  assert.equal(await intlStoryId('401917259'), old.id, 'story id is stable across generator versions');
  const store = new Map();
  const deps = { getItem: async () => null, putItem: async (x) => store.set(x.id, x), versionOf: () => 'wnba-international-desk/2.0.0', cardOf };
  const regen = await withSlug(await spain({ backfill: true }));
  const t1 = '2026-09-13T18:00:00.000Z';
  const r1 = await mergeArticles({ index: [old], articles: [regen], started: t1, now: Date.parse(t1), ...deps });
  const c = r1.index.find((x) => x.id === old.id);
  assert.equal(r1.index.length, 1);
  assert.equal(c.slug, old.slug, 'URL unchanged');
  assert.equal(c.first_published_at, old.first_published_at, 'original publication preserved');
  assert.equal(c.revised_at, t1);
  assert.deepEqual(c.revisions.map((x) => x.kind), ['metadata_correction', 'editorial_upgrade']);
  // A later data update appends; history survives.
  const later = await withSlug(await spain());
  later.input_hash += '|box-correction';
  const t2 = '2026-09-13T19:00:00.000Z';
  const r2 = await mergeArticles({ index: r1.index, articles: [later], started: t2, now: Date.parse(t2), ...deps });
  assert.deepEqual(r2.index[0].revisions.map((x) => x.kind), ['metadata_correction', 'editorial_upgrade', 'data_update']);
  assert.equal(r2.index[0].slug, old.slug);
  assert.equal(r2.index[0].first_published_at, old.first_published_at);
});

test('source policy: a brief whose only publisher report is a review-required source is withheld; approved briefs are not', async () => {
  const { withheldBySourcePolicy, publicItem, NEWS_SOURCES, PUBLIC_REVIEW_REQUIRED } = await import('../workers/wnba-news/src/sources.js');
  assert.equal(PUBLIC_REVIEW_REQUIRED, false);
  assert.equal(withheldBySourcePolicy({ kind: 'brief', sources: ['Seattle Storm (official)', 'ESPN standings', 'ESPN schedule'] }), true);
  assert.equal(withheldBySourcePolicy({ kind: 'brief', sources: ['Swish Appeal', 'ESPN game log (2026 Regular Season)'] }), false);
  assert.equal(withheldBySourcePolicy({ kind: 'international', sources: [] }), false);
  assert.equal(publicItem({ source_id: 'wnba_com' }), false);
  assert.equal(publicItem({ source_id: 'team_storm' }), false);
  assert.equal(publicItem({ source_id: 'espn_wnba' }), true);
  for (const s of NEWS_SOURCES.filter((x) => x.policy_status === 'review_required')) assert.match(s.policy_note, /written permission|legal review/i);
});

test('backfill through the desk labels a regeneration as an editorial upgrade even inside the fresh window', async () => {
  const { internationalArticles } = await import('../workers/wnba-news/src/international.js');
  const overview = { competition: FX.competition, bracket: { rounds: [], bronze_game: FX.bronze_game, medals: FX.medals } };
  const intlGet = async (path) => (path.endsWith('/schedule') ? { games: FX.schedule } : path.includes('/competitions/') ? overview : path.endsWith('/401917259') ? FX.detail : path.endsWith('/playbyplay') ? { plays: [] } : FX.prior[path.split('/').pop()] ? { ...FX.prior[path.split('/').pop()], game: {} } : null);
  const clock = () => CUTOFF;
  const inWindow = Date.parse(FX.detail.game.scheduled_at) + 3 * 3600e3;
  const [fresh] = await internationalArticles({ intlGet, now: inWindow, clock });
  assert.equal(fresh.context.regeneration, null, 'a normal pass is not an upgrade');
  const [up] = await internationalArticles({ intlGet, now: inWindow, clock, backfill: new Set(['401917259']) });
  assert.equal(up.context.regeneration, 'editorial_upgrade');
  const [late] = await internationalArticles({ intlGet, now: inWindow + 48 * 3600e3, clock, backfill: new Set(['401917259']) });
  assert.equal(late.context.regeneration, 'editorial_upgrade', 'outside the window only backfill regenerates it');
  assert.deepEqual(await internationalArticles({ intlGet, now: inWindow + 48 * 3600e3, clock }), [], 'and nothing new is created without backfill');
});
