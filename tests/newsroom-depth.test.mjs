// Newsroom depth ladder (wnba-depth/1.0.0), original-value and external-coverage rules (wnba-briefs/2.0.0), additive
// PropBetEdge Intelligence (pbe-intelligence/1.1.0) and the whole-newsroom media ladder — across desks, on real
// fixtures: tests/fixtures/newsroom-2026-09-11.json (injury, transaction, result, preview, trend records),
// tests/fixtures/international/bronze-401917259-overhaul.json (Spain–Germany) and the Carla Leite source item.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { assessDepth, classifyDepth, contractOf, DEPTH_CLASSES } from '../workers/wnba-news/src/depth.js';
import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, withSlug, cardOf, finalize } from '../workers/wnba-news/src/articles.js';
import { briefArticles, underlyingEvent, originalValue } from '../workers/wnba-news/src/briefs.js';
import { storyFor } from '../workers/wnba-news/src/international.js';
import { mergeArticles, revisionKind, factsDigest } from '../workers/wnba-news/src/lifecycle.js';
import { demoteExternalCoverage, newsroomHealth } from '../workers/wnba-news/src/articles-run.js';
import { newsroomMediaFrom } from '../workers/wnba-news/src/media-resolve.js';
import { provenanceFailures, visualFailures } from '../workers/wnba-news/src/quality.js';
import { reconcileArticle, lintProse } from '../workers/wnba-news/src/reconcile.js';
import { buildDictionary } from '../workers/wnba-news/src/editorial.js';
import { additiveCopy, intelligenceOf } from '../src/lib/intelligence.js';
import { withheldBySourcePolicy } from '../workers/wnba-news/src/sources.js';
import { articleView } from '../src/views/article.js';
import { storyMedia, storyThumb } from '../src/ui/story-media.js';
import { routeMeta } from '../src/seo/meta.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const FX = read('./fixtures/newsroom-2026-09-11.json');
const BRONZE = read('./fixtures/international/bronze-401917259-overhaul.json');
const MANIFEST = read('../data/newsroom-media.json').players;
const html = (x) => String(x);
const words = (body) => body.join(' ').split(/\s+/).filter(Boolean).length;

// ------------------------------------------------------------ fixture harness (same records as newsroom-synthesis)
const now = Date.parse(FX.as_of);
const api = async (p) => (p in FX.api ? FX.api[p] : null);
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
const sched = FX.api[`/v1/schedule?from=${add('20260911', -14)}&to=${add('20260911', 7)}`];
const longSched = FX.api[`/v1/schedule?from=${add('20260911', -50)}&to=20260911`];
const standingsById = new Map((FX.api['/v1/standings']?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
const injuries = FX.api['/v1/injuries'].items;
const transactions = FX.api['/v1/transactions'].items;
const games = sched.games;
const teamsList = [];
const seenT = new Set();
for (const p of FX.api['/v1/players'].players) if (p.team && !seenT.has(p.team.team_id)) { seenT.add(p.team.team_id); teamsList.push(p.team); }
const dict = buildDictionary({ players: FX.api['/v1/players'].players.map((p) => ({ athlete_id: p.athlete_id, name: p.name, team_id: p.team_id })), teams: teamsList });
const regIds = new Set();
for (const k of Object.keys(FX.api)) if (/^\/v1\/schedule\?from=2026(05|06|07|08|09)/.test(k)) for (const g of FX.api[k]?.games || []) if (g.season?.type === 2) regIds.add(String(g.game_id));
const externalByPlayer = new Map();
for (const it of FX.wire) for (const e of it.entities || []) if (e.type === 'player') { if (!externalByPlayer.has(e.id)) externalByPlayer.set(e.id, []); externalByPlayer.get(e.id).push(it); }
const finalsByTeam = new Map();
for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }
const base = { api, injuries, externalByPlayer, schedule: games, standingsById, now, transactions, dict, teams: teamsList, props: null, season: FX.season, regIds, asOf: FX.as_of, finalsByTeam };
const one = async (fn, over) => { const xs = await fn({ ...base, ...over }); for (const a of xs) await withSlug(a); return xs; };

const S = {};
const desks = async () => {
  if (S.ready) return S;
  const inj = await one(injuryArticles, { injurySubjects: new Set(['4281929', '4420318']) });
  S.injury = inj.find((a) => String(a.lead_player_id) === '4420318');
  S.injuryLong = inj.find((a) => String(a.lead_player_id) === '4281929');
  S.transaction = (await one(transactionArticles, { transactions: transactions.filter((t) => t.team?.team_id === '17' && t.date.startsWith('2026-08-29')) }))[0];
  S.game = (await one(resultArticles, { finals: games.filter((g) => String(g.game_id) === '401857181') }))[0];
  S.preview = (await one(previewArticles, { upcoming: games.filter((g) => String(g.game_id) === '401857194') }))[0];
  S.trend = (await one(trendArticles, { teams: teamsList.filter((t) => t.team_id === '19') }))[0];
  const CUT = new Date(Date.parse(BRONZE.captured_at) + 60e3).toISOString();
  S.intl = await withSlug(await storyFor({ competition: BRONZE.competition, detail: BRONZE.detail, schedule: BRONZE.schedule, priorDetails: BRONZE.prior, medals: BRONZE.medals, cutoff: CUT }));
  S.intlCut = CUT;
  S.ready = true;
  return S;
};

// Source-wire items (shape of news:v1:items records).
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (m) => new Date(NOW - m * 60e3).toISOString();
const CARLA = { type: 'player', id: '5208982', name: 'Carla Leite', team_id: '132052', method: 'exact_full_name', on_current_roster: true };
const FIRE = { type: 'team', id: '132052', name: 'Portland Fire' };
const wire = (o = {}) => ({ item_id: 'w1', cluster_id: 'c_w1', source_id: 'swish_appeal', source_name: 'Swish Appeal', priority: 2, canonical_url: 'https://www.swishappeal.com/wnba/x', headline: 'Carla Leite is the special talent firing up the relaunched Portland Fire', story_type: 'news', relevance: 4, published_at: iso(60), entities: [CARLA, FIRE], ...o });
const game = (d, pts, min) => ({ game_id: `g${d}`, date: `2026-08-${String(d).padStart(2, '0')}T23:00Z`, team_id: '132052', min, pts, reb: 2, ast: 6, result: 'W' });
const carlaCtx = {
  season: 2026,
  api: async (path) => (path === '/v1/players/5208982' ? { player: { athlete_id: '5208982', name: 'Carla Leite', position_name: 'Guard', team: { team_id: '132052', name: 'Portland Fire', short_name: 'Fire' } }, gamelog: { seasons: [{ name: '2026 Regular Season', games: [game(28, 20, 30), game(26, 18, 29), game(24, 19, 28), game(22, 17, 30), game(20, 19, 29), game(18, 10, 22), game(16, 12, 24)] }] } } : null),
  injuries: [{ athlete_id: '5208982', team_id: '132052', name: 'Carla Leite', status: 'Out', body_part: 'Not Injury Related', source_updated_at: '2026-08-29T16:22Z' }],
  transactions: [],
  schedule: [{ game_id: '401857199', start_utc: '2026-09-17T23:00Z', status: { state: 'pre' }, home: { team_id: '132052', name: 'Portland Fire' }, away: { team_id: '129689', name: 'Golden State Valkyries' } }],
  standingsById: new Map([['132052', { wins: 14, losses: 22, seed: 9, conference_name: 'Western Conference', last_ten: '4-6', points_for_avg: 80.1, points_against_avg: 84.2 }]]),
  dict: { teamById: new Map([['132052', { name: 'Portland Fire' }]]) }
};

// ------------------------------------------------------------ 1–2: classes

test('1 · Flash requires genuinely sparse, developing evidence', async () => {
  const corroborated = [wire({ item_id: 'l1', cluster_id: 'c_l', headline: 'WNBA and WNBPA agree on a new collective bargaining agreement', story_type: 'league', entities: [], source_id: 'espn_wnba', source_name: 'ESPN', published_at: iso(20) }), wire({ item_id: 'l2', cluster_id: 'c_l', headline: 'WNBA, players union reach CBA deal', story_type: 'league', entities: [], source_id: 'cbs_wnba', source_name: 'CBS Sports', published_at: iso(15) })];
  const [flash] = await briefArticles({ externalItems: corroborated, structured: [], now: NOW });
  const c = classifyDepth(flash, { now: NOW });
  assert.equal(c.class, 'flash');
  assert.equal(c.developing, true);
  assert.equal(c.provisional, true);
  assert.equal(assessDepth(flash, { now: NOW }).pass, true, assessDepth(flash, { now: NOW }).failures.join('\n'));
  // The same thin record is no longer "developing" hours later: it is held to the Brief contract and does not pass.
  const later = classifyDepth(flash, { now: NOW + 6 * 3600e3 });
  assert.equal(later.class, 'brief');
  assert.equal(assessDepth(flash, { now: NOW + 6 * 3600e3 }).pass, false);
  // A rich structured story is never a Flash, however short a generator might make it.
  const { injury } = await desks();
  assert.notEqual(classifyDepth({ ...injury, body: injury.body.slice(0, 1) }, { now }).class, 'flash');
});

test('2 · Full is the normal class for a meaningful event with rich verified records', async () => {
  const s = await desks();
  for (const k of ['injury', 'transaction', 'game', 'preview']) {
    const d = assessDepth(s[k], { now });
    assert.ok(['full', 'deep'].includes(d.class), `${k}: ${d.class} (${d.reasons.join('; ')})`);
    assert.equal(d.pass, true, `${k}: ${d.failures.join(' | ')}`);
  }
  assert.equal(assessDepth(s.intl, { now: Date.parse(s.intlCut) }).class, 'deep', 'a medal game with the richest records is Deep');
  assert.equal(contractOf(s.trend), 'market');
});

// ------------------------------------------------------------ 3–4: maturation at one URL

test('3–4 · a story upgrades Flash → Full at the same id and URL, keeping its first publication', async () => {
  const s = await desks();
  const store = new Map();
  const deps = { getItem: async () => null, putItem: async (x) => store.set(x.id, x), versionOf: () => 'wnba-articles/1.2.0', cardOf };
  const flash = structuredClone(s.injury);
  flash.depth = { class: 'flash' };
  flash.input_hash = 'v1';
  const t1 = '2026-09-11T18:07:00.000Z';
  const r1 = await mergeArticles({ index: [], articles: [flash], started: t1, now: Date.parse(t1), ...deps });
  const full = structuredClone(s.injury);
  full.depth = { class: 'full' };
  full.input_hash = 'v2-rotation-and-schedule';
  full.headline = `${full.headline} (developed)`;
  const t2 = '2026-09-11T18:35:00.000Z';
  const r2 = await mergeArticles({ index: r1.index, articles: [await withSlug(full)], started: t2, now: Date.parse(t2), ...deps });
  assert.equal(r2.index.length, 1, 'one event, one story');
  const c = r2.index[0];
  assert.equal(c.id, flash.id);
  assert.equal(c.slug, r1.index[0].slug, 'same URL');
  assert.equal(c.first_published_at, t1, 'first publication is immutable');
  assert.equal(c.revised_at, t2);
  assert.equal(c.depth_class, 'full');
  assert.deepEqual(c.revisions.at(-1), { at: t2, kind: 'depth_upgrade', from: 'flash', to: 'full', generator: 'wnba-articles/1.2.0', depth_class: 'full' });
});

// ------------------------------------------------------------ 5–7: events, value, external coverage

test('5 · an external feature with no underlying event is suppressed as standalone news, and a published one is demoted deliberately', async () => {
  const out = await briefArticles({ externalItems: [wire()], structured: [], now: NOW, ctx: carlaCtx });
  assert.equal(out.length, 0);
  assert.equal(out.decisions[0].decision, 'external_coverage');
  assert.equal(underlyingEvent([wire()]).event, false);
  assert.equal(underlyingEvent([wire({ headline: 'Power rankings: Carla Leite and the ten most improved players' })]).event, false, 'commentary is coverage');
  // The live Carla Leite brief (published under the v1 rule) is demoted: listing removed, record and URL kept, revision logged.
  const item = { id: 'e22194684c40', slug: 'carla-e22194', kind: 'brief', status: 'published', evidence: [{ kind: 'publisher_report', publisher: 'Swish Appeal', headline: 'Carla Leite is the special talent firing up the relaunched Portland Fire', published_at: iso(60) }], facts: { brief: { linked_entities: [CARLA, FIRE] } }, context: { brief: { source_url: 'https://www.swishappeal.com/wnba/x', source_name: 'Swish Appeal' } }, revisions: [] };
  const cards = [{ id: item.id, slug: item.slug, kind: 'brief', status: 'published', revisions: [] }];
  const puts = [];
  const demoted = await demoteExternalCoverage(cards, { at: iso(0), getItem: async () => item, putItem: async (x) => puts.push(x) });
  assert.equal(demoted.length, 1);
  assert.equal(cards[0].status, 'external_coverage');
  assert.equal(cards[0].revisions.at(-1).kind, 'demoted_to_external_coverage');
  assert.equal(puts[0].id, item.id, 'the item is rewritten, never deleted');
  assert.equal(puts[0].external_coverage.source_name, 'Swish Appeal');
  assert.equal((await demoteExternalCoverage(cards, { at: iso(0), getItem: async () => item, putItem: async () => {} })).length, 0, 'idempotent');
  assert.equal(newsroomHealth(cards).external_coverage, 1);
  const view = html(articleView({ article: { ...puts[0], headline: 'Carla Leite in focus', deck: 'A deck long enough to render in the article view.', body: ['Body.'], sections: [], entities: [], media: null, first_published_at: iso(60) }, related: [] }));
  assert.match(view, /Moved to external coverage/);
  assert.equal(routeMeta('article', { path: '/news/carla-e22194', params: {}, data: { ...puts[0], headline: 'Carla Leite in focus', deck: 'A deck.', slug: 'carla-e22194' } }).robots, 'noindex, follow');
});

test('6 · an external report of a real underlying event may publish', async () => {
  const signing = wire({ headline: 'Portland Fire sign Carla Leite to contract extension', story_type: 'transaction' });
  const [a] = await briefArticles({ externalItems: [signing], structured: [], now: NOW, ctx: carlaCtx });
  assert.equal(a.status, 'published', a.gate.failures.join('\n'));
  assert.equal(a.facts.brief.underlying_event, true);
  assert.equal(contractOf(a), 'external', 'external reporting is held to the strictest contract');
  assert.equal(assessDepth(a, { now: NOW }).desk, 'transaction');
  assert.equal(assessDepth(a, { now: NOW }).class, 'brief', 'not yet confirmed by the transactions log or a second publisher');
  const d = assessDepth(a, { now: NOW });
  assert.equal(d.pass, true, d.failures.join('\n'));
});

test('7 · the PropBetEdge value-add requirement', async () => {
  const league = wire({ headline: 'WNBA announces a new league operations update', story_type: 'league', entities: [], source_id: 'nbc_sports_wnba', source_name: 'NBC Sports' });
  const alone = await briefArticles({ externalItems: [league], structured: [], now: NOW });
  assert.equal(alone.length, 0, 'one uncorroborated report with nothing PropBetEdge can verify is a link, not a story');
  assert.match(alone.decisions[0].reason, /single uncorroborated report with no PropBetEdge record to add/);
  assert.deepEqual(originalValue({}).dimensions, []);
  assert.equal(originalValue({ season: { last5: {} }, standing: {}, next_game: {} }).count, 4);
  // Beyond the developing window, a brief whose records add fewer than two dimensions does not meet the Brief contract.
  const thin = await briefArticles({ externalItems: [wire({ headline: 'Portland Fire sign Carla Leite to contract extension', story_type: 'transaction' })], structured: [], now: NOW });
  const late = assessDepth(thin[0], { now: NOW + 5 * 3600e3 });
  assert.equal(late.pass, false);
  assert.ok(late.unmet.includes('original_value'));
});

// ------------------------------------------------------------ 8–10: Intelligence has its own job

test('8 · article body and Intelligence cannot carry the same content block', async () => {
  const { preview } = await desks();
  const dup = structuredClone(preview);
  dup.intelligence = { ...dup.intelligence, copy: { summary: dup.body[0], supporting: [] }, render: { ...dup.intelligence.render, intelligence: true } };
  const d = assessDepth(dup, { now });
  assert.ok(d.failures.some((f) => /PropBetEdge Intelligence restates the article body/.test(f)), d.failures.join('\n'));
  // finalize never produces that: restating copy is removed before the module is decided.
  const copy = additiveCopy({ ...dup, bettor_angle: { summary: dup.body[0], supporting: [dup.body[1]], against: [], unknown: [] } });
  assert.equal(copy.summary, null);
});

test('9–10 · Intelligence disappears without additive information; contextual relevance never forces a betting block', async () => {
  const a = finalize({
    id: 'ctx000000001', kind: 'injury', category: 'Injuries', headline: 'Carla Leite listed out for the Portland Fire this week', deck: 'The Portland Fire guard has averaged 16.4 points in 27.4 minutes across seven games.',
    body: ['ESPN’s injury feed lists Carla Leite as Out, last updated Aug 29, and she has played 7 games this season at 16.4 points in 27.4 minutes a night for the Portland Fire, whose next game is against the Golden State Valkyries.'],
    bettor: ['For bettors, the report is context, not a signal.', 'Carla Leite has played 7 games this season at 16.4 points in 27.4 minutes a night.'], against: ['ESPN’s feed is a provider status, not the league’s official injury report.'], unknown: ['The official game-day status.'],
    market_angle: { text: [], market: null, game_id: null }, lead_team_id: '132052', lead_player_id: '5208982', primary_subject: 'Carla Leite', published_at: iso(10),
    entities: [CARLA, FIRE], facts: { season: { games: 7, pts: 16.4, min: 27.4 } }, evidence: [{ kind: 'record', source: 'ESPN game log', record: { games: 7, pts: 16.4, min: 27.4, date: 29 } }]
  });
  assert.equal(a.intelligence.market_relevance, 'contextual');
  assert.equal(a.intelligence.render.intelligence, false, 'boilerplate + restated context is not intelligence');
  assert.ok(a.bettor_angle, 'the reviewed analysis record is kept for the gate');
  assert.doesNotMatch(html(articleView({ article: { ...a, slug: 'x-ctx000', first_published_at: iso(10), media: null }, related: [] })), /pbe-intel/);
  assert.equal(cardOf(a).bettor_snippet, null);
  // Legacy records (no stored copy) get the same answer from intelligenceOf.
  const legacy = { ...a, intelligence: undefined, market_watch: null };
  assert.equal(intelligenceOf(legacy).render.intelligence, false);
});

// ------------------------------------------------------------ 11–13: substance beats word count

const keepParas = (a, keep) => {
  const body = [];
  const sections = [];
  for (const s of a.sections) {
    const idx = keep[s.key];
    if (!idx) continue;
    const ps = idx.map((i) => a.body[s.first + i]);
    sections.push({ ...s, first: body.length, count: ps.length });
    body.push(...ps);
  }
  return { ...a, body, sections };
};

test('11–12 · a strong 620-word story passes the substance gate', async () => {
  const { intl, intlCut } = await desks();
  const strong = keepParas(intl, { lede: [0, 1], flow: [0, 1], decisive: [0], why: [0, 1, 3], performers: [0, 1], opponent: [0], context: [1, 2], wnba: [0, 1] });
  const w = words(strong.body);
  assert.ok(w >= 600 && w <= 650, `${w} words`);
  const d = assessDepth(strong, { now: Date.parse(intlCut) });
  assert.equal(d.pass, true, d.failures.join('\n'));
  assert.ok(d.diagnostics.some((x) => /below the Deep target range/.test(x)), 'short of the target range is reported, not enforced');
});

test('13 · a repetitive 900-word story fails', async () => {
  const { intl, intlCut } = await desks();
  const pick = (key) => intl.body.slice(intl.sections.find((s) => s.key === key).first, intl.sections.find((s) => s.key === key).first + intl.sections.find((s) => s.key === key).count);
  const lede = pick('lede');
  const perf = pick('performers');
  const body = [...lede];
  const sections = [{ title: null, key: 'lede', first: 0, count: lede.length }];
  let i = 0;
  while (words(body) < 900) {
    const para = `${perf[i % perf.length]} ${perf[(i + 1) % perf.length]}`;
    sections.push({ title: `Who delivered, part ${i + 1}`, key: 'performers', first: body.length, count: 1 });
    body.push(para);
    i += 1;
  }
  const rep = { ...intl, body, sections };
  assert.ok(words(body) >= 900);
  const d = assessDepth(rep, { now: Date.parse(intlCut) });
  assert.equal(d.pass, false);
  assert.ok(d.failures.some((f) => /repeated sentences|phrase repetition/.test(f)), d.failures.join('\n'));
  assert.ok(d.failures.some((f) => /missing core substance/.test(f)));
});

// ------------------------------------------------------------ 14: desk contracts

test('14 · desk-specific substance contracts', async () => {
  const s = await desks();
  const drop = (a, key) => { const out = structuredClone(a); const i = out.sections.findIndex((x) => x.title === key); const sec = out.sections[i]; out.body.splice(sec.first, sec.count); out.sections.splice(i, 1); for (const x of out.sections.slice(i)) x.first -= sec.count; return out; };
  const inj = assessDepth(drop(s.injury, 'The latest'), { now });
  assert.ok(inj.unmet.includes('what_changed'), inj.unmet.join(','));
  const tx = assessDepth(drop(s.transaction, 'How it fits'), { now });
  assert.ok(tx.unmet.includes('roster_context'), tx.unmet.join(','));
  const pv = assessDepth(drop(s.preview, 'Availability'), { now });
  assert.ok(pv.unmet.includes('availability') && !pv.pass);
  const gm = assessDepth(drop(s.game, 'How it happened'), { now });
  assert.ok(gm.unmet.includes('game_flow') && !gm.pass);
  assert.deepEqual([contractOf(s.injury), contractOf(s.transaction), contractOf(s.preview), contractOf(s.game), contractOf(s.intl)], ['injury', 'transaction', 'preview', 'game', 'international']);
});

// ------------------------------------------------------------ 15–17, 19–20

test('15 · every standalone story resolves appropriate visual media — never blank, never a stand-in', async () => {
  const s = await desks();
  for (const k of ['injury', 'transaction', 'game', 'preview', 'trend', 'intl']) {
    const m = newsroomMediaFrom(MANIFEST, s[k]);
    assert.deepEqual(visualFailures(s[k], m), [], k);
    if (m.subjects.length && m.layout === 'single') assert.equal(m.subjects[0].player_id, String(s[k].lead_player_id), `${k}: the pictured player is the story's subject`);
  }
  const league = { kind: 'brief', entities: [], lead_team_id: null, lead_player_id: null };
  const m = newsroomMediaFrom(MANIFEST, league);
  assert.equal(m.layout, 'brand');
  assert.deepEqual(visualFailures(league, m), []);
  assert.match(html(storyMedia(m, { slot: 'hero' })), /sm--brand[\s\S]*News Brief[\s\S]*PropBetEdge WNBA/);
  assert.deepEqual(visualFailures(league, { layout: 'team', subjects: [], teams: [] }), ['visual: story has no resolved hero (approved photo, team composition or story visual)']);
});

test('15a · approved matchup player photos outrank team-logo fallback on cards and thumbnails', () => {
  const preview = {
    kind: 'preview',
    entities: [
      { type: 'team', id: '8', name: 'Minnesota Lynx' },
      { type: 'team', id: '5', name: 'Indiana Fever' },
      { type: 'player', id: '2529205', name: 'Kayla McBride' },
      { type: 'player', id: '4433403', name: 'Caitlin Clark' }
    ],
    matchup: { away_team_id: '8', home_team_id: '5' }
  };
  const m = newsroomMediaFrom(MANIFEST, preview);
  assert.equal(m.layout, 'matchup');
  assert.deepEqual(m.subjects.map((s) => s.player_id), ['2529205', '4433403']);
  assert.equal(m.resolved, 'approved_subject_photos');
  const card = html(storyMedia(m, { slot: 'card' }));
  assert.match(card, /sm--duo/);
  assert.match(card, /\/media\/news\/players\/2529205\//);
  assert.match(card, /\/media\/news\/players\/4433403\//);
  const thumb = html(storyThumb(m, 64));
  assert.match(thumb, /\/media\/players\/4433403\/square\.webp/);
});

test('16 · provenance chronology: a version never goes live before it was generated', async () => {
  const { intl } = await desks();
  const store = new Map();
  const a = structuredClone(intl);
  const started = new Date(Date.parse(a.provenance.generated_at) - 45e3).toISOString(); // the run began before the cutoff
  const r = await mergeArticles({ index: [], articles: [a], started, now: Date.parse(started), getItem: async () => null, putItem: async (x) => store.set(x.id, x), versionOf: () => 'wnba-international-desk/2.0.0', cardOf });
  const c = r.index[0];
  assert.ok(Date.parse(a.provenance.source_observed_at) <= Date.parse(a.provenance.generated_at));
  assert.ok(Date.parse(a.provenance.generated_at) <= Date.parse(c.first_published_at), `${a.provenance.generated_at} ≤ ${c.first_published_at}`);
  assert.deepEqual(provenanceFailures({ ...a, first_published_at: c.first_published_at }), []);
  // A regeneration with the same facts by a newer generator is an editorial quality upgrade, not a correction.
  assert.deepEqual(revisionKind(a, { input_hash: 'wnba-international-desk/1.0.0|x', facts_digest: factsDigest(a) }, 'wnba-international-desk/2.0.0'), { kind: 'editorial_quality_upgrade', from_generator: 'wnba-international-desk/1.0.0' });
  assert.equal(revisionKind({ ...a, facts: { ...a.facts, extra: 1 } }, { input_hash: 'wnba-international-desk/1.0.0|x', facts_digest: factsDigest(a) }, 'wnba-international-desk/2.0.0').kind, 'data_update');
});

test('15b · regenerating a legacy story by a newer generator is an editorial_quality_upgrade only when its facts are unchanged', async () => {
  const { injury } = await desks();
  const oldItem = structuredClone(injury);
  delete oldItem.facts.recent_games; // the earlier generator did not carry the enrichment keys
  const prevCard = { ...cardOf(oldItem), input_hash: `wnba-articles/1.2.0||${oldItem.headline}|${oldItem.deck}`, first_published_at: '2026-09-11T18:49:00.000Z', revisions: [] };
  const deps = (item) => ({ getItem: async () => item, putItem: async () => {}, versionOf: () => 'wnba-articles/1.3.0', cardOf });
  const t = '2026-09-13T19:00:00.000Z';
  const next = structuredClone(injury);
  next.body = [...next.body, 'An added paragraph from the enriched generator.'];
  const r = await mergeArticles({ index: [prevCard], articles: [next], started: t, now: Date.parse(t), ...deps(oldItem) });
  assert.equal(r.index[0].revisions.at(-1).kind, 'editorial_quality_upgrade');
  assert.equal(r.index[0].revisions.at(-1).from_generator, 'wnba-articles/1.2.0');
  assert.equal(r.index[0].first_published_at, '2026-09-11T18:49:00.000Z');
  const changed = structuredClone(oldItem);
  changed.facts.injury = { ...changed.facts.injury, status: 'Day-To-Day' };
  const r2 = await mergeArticles({ index: [prevCard], articles: [structuredClone(next)], started: t, now: Date.parse(t), ...deps(changed) });
  assert.equal(r2.index[0].revisions.at(-1).kind, 'data_update', 'a fact changed underneath: not labelled a quality upgrade');
});

test('17 · grammar stays enforced across desks and the new brief prose', async () => {
  const s = await desks();
  const [brief] = await briefArticles({ externalItems: [wire({ headline: 'Portland Fire sign Carla Leite to contract extension', story_type: 'transaction' })], structured: [], now: NOW, ctx: carlaCtx });
  for (const a of [s.injury, s.transaction, s.game, s.preview, s.trend, s.intl, brief]) for (const part of [a.headline, a.deck, ...a.body]) assert.deepEqual(lintProse(part), [], `${a.kind}: ${part.slice(0, 90)}`);
});

test('19 · source-policy restrictions stay intact: review-required sources create, corroborate and value nothing', async () => {
  const off = wire({ source_id: 'team_fire', source_name: 'Portland Fire (official)', priority: 1, headline: 'Portland Fire sign Carla Leite to contract extension', story_type: 'transaction' });
  assert.equal((await briefArticles({ externalItems: [off], structured: [], now: NOW, ctx: carlaCtx })).length, 0);
  assert.equal(withheldBySourcePolicy({ kind: 'brief', sources: ['Portland Fire (official)', 'ESPN standings'] }), true);
});

test('20 · enrichment introduces no unsupported facts: every desk passes the number gate and reconcile', async () => {
  const s = await desks();
  const [brief] = await briefArticles({ externalItems: [wire({ headline: 'Portland Fire sign Carla Leite to contract extension', story_type: 'transaction' })], structured: [], now: NOW, ctx: carlaCtx });
  for (const a of [s.injury, s.injuryLong, s.transaction, s.game, s.preview, s.trend, brief]) {
    assert.equal(a.gate.ok, true, `${a.kind}: ${a.gate.failures.join(' | ')}`);
    const rec = reconcileArticle(a, { season: 2026, injuries: a === brief ? carlaCtx.injuries : injuries });
    assert.equal(rec.ok, true, `${a.kind}: ${rec.failures.join(' | ')}`);
  }
  assert.ok(Object.keys(DEPTH_CLASSES).join() === 'flash,brief,full,deep');
});
