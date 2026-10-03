import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHomepageLead, latestNewsRail, homepageLeadContext, leadIneligibility } from '../src/lib/homepage-lead.js';
import { frontPageEditorialStories, todayView } from '../src/views/today.js';

const NOW = Date.parse('2026-09-28T10:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const story = (id, kind, at, over = {}) => ({
  id, slug: id, kind, status: 'published', quality_state: 'current_quality',
  headline: id, deck: '', first_published_at: at, published_at: at, entities: [], ...over
});
const game = (id, start) => ({ type: 'game', id, start_utc: start });
const team = (id) => ({ type: 'team', id });
const finalGame = (id, start, a = '1', h = '2') => ({ game_id: id, start_utc: start, status: { state: 'post' }, away: { team_id: a }, home: { team_id: h } });
const preGame = (id, start, a = '1', h = '2') => ({ game_id: id, start_utc: start, status: { state: 'pre' }, away: { team_id: a }, home: { team_id: h } });

const ctx = (over = {}) => ({ now: NOW, data: { phase: 'Postseason', last_results: { games: [] } }, hero: { mode: 'DESK' }, ...over });
const leadId = (stories, c = ctx()) => selectHomepageLead(stories, c).lead?.id ?? null;

// §12 — the exact production shape: two same-batch trends at 09:00, a playoff performance at 08:20.
const A = story('lynx-under', 'trend', '2026-09-28T09:00:00Z', { headline: 'Lynx under trend', entities: [game('g9', '2026-09-30T00:30Z')] });
const B = story('liberty-under', 'trend', '2026-09-28T09:00:00Z', { headline: 'Liberty under trend', entities: [game('g9', '2026-09-30T00:30Z')] });
const C = story('wilson-38', 'performance', '2026-09-28T08:20:00Z', { depth_class: 'full', entities: [game('g1', '2026-09-28T01:00Z'), team('17'), { type: 'player', id: '3149391' }] });

test('§12 · playoff performance leads over same-batch trends; Latest News stays chronological', () => {
  const front = frontPageEditorialStories([C, B, A], null);
  assert.deepEqual(front.map((x) => x.id).slice(0, 3).sort(), ['liberty-under', 'lynx-under', 'wilson-38'].sort());
  assert.equal(front[2].id, 'wilson-38', 'chronological: both 09:00 trends before the 08:20 performance');
  const { lead, diagnostics } = selectHomepageLead(front, ctx());
  assert.equal(lead.id, 'wilson-38');
  assert.equal(diagnostics.lead_kind, 'performance');
  assert.match(diagnostics.selection_reason, /playoff result\/performance[\s\S]*outranks newer generic team trend/);
  const rail = latestNewsRail(front, lead);
  assert.deepEqual(rail.map((x) => x.kind), ['trend', 'trend'], 'rail keeps newest-first order without the lead');
});

test('old policy would have led with the newest trend (regression anchor)', () => {
  const front = frontPageEditorialStories([A, B, C], null);
  assert.equal(front[0].kind, 'trend');
  assert.notEqual(leadId(front), front[0].id);
});

test('1-hour breaking injury beats 8-hour trend', () => {
  assert.equal(leadId([story('trend', 'trend', hoursAgo(8)), story('inj', 'injury', hoursAgo(1))]), 'inj');
});

test('2-hour playoff result beats 1-hour generic trend', () => {
  assert.equal(leadId([story('trend', 'trend', hoursAgo(1)), story('res', 'result', hoursAgo(2), { entities: [game('g1', hoursAgo(5))] })]), 'res');
});

test('30-hour playoff result does NOT beat a 1-hour current material story', () => {
  const res = story('res', 'performance', hoursAgo(30), { entities: [game('g1', hoursAgo(33))] });
  assert.equal(leadId([res, story('inj', 'injury', hoursAgo(1))]), 'inj');
  assert.equal(leadId([res, story('tx', 'transaction', hoursAgo(1))]), 'tx');
});

test('20-hour result does not beat a genuinely material 1-hour development', () => {
  const res = story('res', 'performance', hoursAgo(20), { depth_class: 'full', entities: [game('g1', hoursAgo(22))] });
  const c = ctx({ data: { phase: 'Postseason', last_results: { games: [finalGame('g1', hoursAgo(22))] } } });
  assert.equal(leadId([res, story('inj', 'injury', hoursAgo(1))], c), 'inj');
});

test('equal-time, equal-class stories resolve deterministically, id only as the final fallback', () => {
  const x = story('bbb', 'trend', hoursAgo(2), { depth: { words: 400 } });
  const y = story('aaa', 'trend', hoursAgo(2), { depth: { words: 400 } });
  assert.equal(leadId([x, y]), 'aaa');
  assert.equal(leadId([y, x]), 'aaa', 'input order does not matter');
  // An explicit field (depth) outranks the id.
  const deeper = story('zzz', 'trend', hoursAgo(2), { depth: { words: 600 } });
  assert.equal(leadId([x, y, deeper]), 'zzz');
});

test('same input → same hero across 100 runs (no rotation, no randomness)', () => {
  const stories = [A, B, C, story('p', 'preview', hoursAgo(3), { entities: [game('g2', '2026-09-29T00:00Z')] })];
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(leadId([...stories].sort(() => (i % 2 ? 1 : -1)), ctx()));
  assert.equal(seen.size, 1);
});

test('the ranking does not flip merely because the clock moved', () => {
  const stories = [A, B, C];
  for (const dh of [0, 1, 3, 6, 9]) assert.equal(leadId(stories, ctx({ now: NOW + dh * 3600e3 })), 'wilson-38');
});

test('revised_at alone does not promote an old story', () => {
  const oldRevised = story('old', 'injury', hoursAgo(80), { revised_at: hoursAgo(0.1), published_at: hoursAgo(0.1) });
  const trend = story('trend', 'trend', hoursAgo(3));
  assert.equal(leadId([oldRevised, trend]), 'trend');
  // A revised card with no origin clock claims no freshness at all.
  const noOrigin = { ...story('noorigin', 'injury', null), first_published_at: null, revised_at: hoursAgo(0.1), published_at: hoursAgo(0.1) };
  assert.equal(leadIneligibility(noOrigin), 'no_origin_clock');
});

test('historical WinBA, external coverage, unlisted, superseded and duplicate stories cannot lead', () => {
  const blocked = [
    story('hist', 'winba_index', hoursAgo(0.5), { historical_backfill: true }),
    story('ext', 'brief', hoursAgo(0.5), { status: 'external_coverage' }),
    story('retired', 'injury', hoursAgo(0.5), { quality_state: 'retired_from_index' }),
    story('legacy', 'injury', hoursAgo(0.5), { quality_state: 'legacy_acceptable' }),
    story('sup', 'injury', hoursAgo(0.5), { superseded_by: 'x' }),
    story('dup', 'injury', hoursAgo(0.5), { duplicate_of: 'x' })
  ];
  const ok = story('ok', 'trend', hoursAgo(5));
  const { lead, diagnostics } = selectHomepageLead([...blocked, ok], ctx());
  assert.equal(lead.id, 'ok');
  assert.deepEqual(diagnostics.excluded.map((e) => e.id).sort(), blocked.map((b) => b.id).sort());
});

test('an unlisted current lead is replaced immediately', () => {
  const inj = story('inj', 'injury', hoursAgo(1));
  assert.equal(leadId([inj, A]), 'inj');
  assert.equal(leadId([{ ...inj, quality_state: 'retired_from_index' }, A]), 'lynx-under');
});

test('final-game context boosts the matching fresh result over another result', () => {
  const matching = story('match', 'performance', hoursAgo(4), { entities: [game('g1', hoursAgo(6))] });
  const other = story('other', 'performance', hoursAgo(3), { entities: [game('g7', hoursAgo(5.5))] });
  const base = ctx({ data: { phase: 'Regular Season', last_results: { games: [] } } });
  assert.equal(leadId([matching, other], base), 'other', 'without context the newer result leads');
  const hero = { mode: 'FINAL', finalGames: [finalGame('g1', hoursAgo(6))] };
  const c = { now: NOW, hero, data: { phase: 'Regular Season', last_results: { games: [] } } };
  const { lead, diagnostics } = selectHomepageLead([matching, other], c);
  assert.equal(lead.id, 'match');
  assert.match(diagnostics.lead_components.context_label, /just went final/);
});

test('pregame mode: current preview and slate-team availability outrank a generic trend', () => {
  const hero = { mode: 'PREGAME', upcomingGames: [preGame('g5', '2026-09-28T23:00Z', '5', '17')] };
  const c = { now: NOW, hero, data: { phase: 'Regular Season' } };
  const trend = story('trend', 'trend', hoursAgo(0.5));
  assert.equal(leadId([trend, story('prev', 'preview', hoursAgo(3), { entities: [game('g5', '2026-09-28T23:00Z')] })], c), 'prev');
  assert.equal(leadId([trend, story('inj', 'injury', hoursAgo(5), { entities: [team('5')] })], c), 'inj');
});

test('a preview for a game already played never leads', () => {
  const stale = story('stale-prev', 'preview', hoursAgo(1), { entities: [game('g1', hoursAgo(10))] });
  assert.equal(leadId([stale, story('trend', 'trend', hoursAgo(2))]), 'trend');
});

test('no valid fresh story → graceful newest legitimate fallback', () => {
  const { lead, diagnostics } = selectHomepageLead([
    story('older-injury', 'injury', hoursAgo(200)),
    story('newest-trend', 'trend', hoursAgo(100))
  ], ctx());
  assert.equal(lead.id, 'newest-trend');
  assert.equal(diagnostics.pool, 'fallback');
  assert.equal(selectHomepageLead([], ctx()).lead, null);
});

test('freshness pool expands to 72h before falling back', () => {
  const { lead, diagnostics } = selectHomepageLead([story('t', 'trend', hoursAgo(30)), story('r', 'performance', hoursAgo(40))], ctx());
  assert.equal(diagnostics.pool, '72h');
  assert.equal(lead.id, 'r');
});

test('diagnostics expose the auditable fields', () => {
  const { diagnostics } = selectHomepageLead([A, B, C], ctx());
  for (const k of ['lead_story_id', 'lead_kind', 'lead_first_published_at', 'lead_score', 'lead_components', 'runner_up_ids', 'selection_reason']) {
    assert.ok(k in diagnostics, k);
  }
  assert.deepEqual(diagnostics.runner_up_ids.sort(), ['liberty-under', 'lynx-under']);
});

test('rail desk diversity: a third same-kind story yields to another desk, order stays chronological', () => {
  const t1 = story('t1', 'trend', hoursAgo(1));
  const t2 = story('t2', 'trend', hoursAgo(1.5));
  const t3 = story('t3', 'trend', hoursAgo(2));
  const p = story('p', 'preview', hoursAgo(4));
  const lead = story('lead', 'trend', hoursAgo(0.5));
  assert.deepEqual(latestNewsRail([lead, t1, t2, t3, p], lead, { limit: 2 }).map((x) => x.id), ['t1', 'p']);
  // When no other desk exists the slot is filled chronologically rather than left empty.
  assert.deepEqual(latestNewsRail([lead, t1, t2, t3], lead, { limit: 3 }).map((x) => x.id), ['t1', 't2', 't3']);
});

test('homepage context reads FINAL slate and recent last_results', () => {
  const c = homepageLeadContext({ now: NOW, hero: { mode: 'FINAL', finalGames: [finalGame('a', hoursAgo(3))] }, data: { phase: 'Postseason', last_results: { games: [finalGame('b', hoursAgo(20)), finalGame('old', hoursAgo(60))] } } });
  assert.equal(c.postseason, true);
  assert.deepEqual([...c.finalGameIds].sort(), ['a', 'b']);
});

test('todayView renders the selected lead as Top Story and keeps the rail chronological', () => {
  const today = { ok: true, meta: {}, data: { today_et: '2026-09-28', phase: 'Postseason', slate: { kind: 'NONE', games: [] }, last_results: { games: [] }, availability: {}, market: {} } };
  const { body } = todayView({ today, arts: { ok: true, data: { items: [A, B, C] } }, injuries: { ok: false }, standings: { ok: false } }, { now: NOW });
  const s = String(body);
  const cover = s.slice(s.indexOf('home-cover'), s.indexOf('editorial-rail'));
  assert.match(cover, /\/news\/wilson-38/);
  assert.match(s, /data-lead-id="wilson-38"/);
  const rail = s.slice(s.indexOf('editorial-rail'));
  assert.ok(rail.indexOf('lynx-under') > -1 && rail.indexOf('liberty-under') > -1);
});

// ---------------------------------------------------------------- 1.1.0: a preview's clock is its game

test('1.1.0 · tonight’s playoff preview drafted four days early beats a two-day-old trend', () => {
  const tonight = new Date(NOW + 10 * 3600e3).toISOString().replace(/:\d\d\.\d+Z$/, 'Z');
  const early = story('g2-preview', 'preview', hoursAgo(96), { depth_class: 'full', entities: [game('g2', tonight), team('8'), team('9')] });
  const trend = story('old-trend', 'trend', hoursAgo(48));
  const c = ctx({ hero: { mode: 'PREGAME', upcomingGames: [preGame('g2', tonight, '8', '9')] } });
  const { lead, diagnostics } = selectHomepageLead([trend, early], c);
  assert.equal(lead.id, 'g2-preview');
  assert.equal(diagnostics.lead_components.materiality_label, 'playoff preview');
});

test('1.1.0 · a preview for a game next week is not promoted early, and a fresh playoff result still beats it', () => {
  const nextWeek = new Date(NOW + 7 * 86400e3).toISOString();
  const early = story('far-preview', 'preview', hoursAgo(2), { entities: [game('g9', nextWeek)] });
  const res = story('res', 'result', hoursAgo(3), { entities: [game('g1', hoursAgo(6))] });
  assert.equal(leadId([early, res]), 'res');
});

test('1.1.0 · a revision clock cannot fake freshness: a trend revised an hour ago is still a two-day-old trend', () => {
  const revised = story('revised-trend', 'trend', hoursAgo(48), { revised_at: hoursAgo(1), updated_at: hoursAgo(1) });
  const res = story('res', 'performance', hoursAgo(6), { entities: [game('g1', hoursAgo(9))] });
  assert.equal(leadId([revised, res]), 'res');
});

test('1.1.0 · a new injury beats an ordinary same-age preview; a photo never decides the lead', () => {
  const soon = new Date(NOW + 20 * 3600e3).toISOString();
  const pv = story('pv', 'preview', hoursAgo(2), { entities: [game('g3', soon)], media: { resolved: 'approved_subject_photos' } });
  const inj = story('inj', 'injury', hoursAgo(2), { media: { resolved: 'team_composition' } });
  assert.equal(leadId([pv, inj]), 'inj');
});

// ---------------------------------------------------------------- 1.2.0: a result's clock is its game

test('1.2.0 · a day-late result (held, then released) cannot outrank tonight’s clinching result', () => {
  // Production 2026-10-03: Aces–Fever Game 3 (tip a day earlier) published 7 minutes after Valkyries–Wings Game 3.
  const tonight = hoursAgo(2.5);
  const yesterday = hoursAgo(26.5);
  const fresh = story('gs-g3', 'result', hoursAgo(0.15), { depth_class: 'full', entities: [game('g3', tonight), team('129689'), team('3')] });
  const late = story('lv-g3', 'performance', hoursAgo(0.02), { depth_class: 'full', entities: [game('l3', yesterday), team('17'), team('5')] });
  const c = ctx({ hero: { mode: 'FINAL', finalGames: [finalGame('g3', tonight, '3', '129689')] }, data: { phase: 'Postseason', last_results: { games: [finalGame('l3', yesterday, '5', '17')] } } });
  const { lead, diagnostics } = selectHomepageLead([late, fresh], c);
  assert.equal(lead.id, 'gs-g3');
  const lateRow = diagnostics.ranking.find((r) => r.id === 'lv-g3');
  assert.ok(lateRow.age_hours > 23, `the late story is judged from its game's end, not its publication (${lateRow.age_hours}h)`);
});

test('1.2.0 · a result published on time keeps its publication clock', () => {
  const r = story('r', 'result', hoursAgo(1), { entities: [game('g1', hoursAgo(3.5))] });
  const { diagnostics } = selectHomepageLead([r], ctx());
  assert.equal(diagnostics.ranking[0].age_hours, 1);
});
