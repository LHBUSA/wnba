import test from 'node:test';
import assert from 'node:assert/strict';

import {
  winbaReferenceFor,
  winbaEligibility,
  winbaSentence,
  winbaStatLine,
  winbaRankPhrase,
  applyWinbaContext,
  claimWinbaSlot,
  winbaSlotTaken,
  winbaPlacement,
  WINBA_URL,
  WINBA_LABEL,
  WINBA_METRIC_ENTITY,
  WINBA_EDITORIAL_MAX_RANK,
  WINBA_MAX_AGE_MS
} from '../workers/wnba-news/src/winba-editorial.js';
import { classifyDepth, evidenceDimensions } from '../workers/wnba-news/src/depth.js';
import { buildWinbaSnapshotAsOf, buildWinbaSnapshot } from '../workers/shared/winba.js';

const SNAP_AT = '2026-09-21T03:17:45.205Z';
const NOW = Date.parse('2026-09-21T20:45:00.000Z');
const GEN_AT = '2026-09-21T20:40:00.000Z';

const row = (over = {}) => ({
  athlete_id: '3149391', name: "A'ja Wilson", team_id: '17', score: 85.7, rank: 2,
  qualified: true, status: 'QUALIFIED',
  sample: { games: 40, wins: 29, losses: 11, minutes: 1260 },
  averages: { min: 31.5, pts: 25.8, reb: 9.2, ast: 3.2 },
  components: { production_percentile: 99.1, win_rate: 72.5 },
  ...over
});

const snapshot = (rows = [row()], over = {}) => ({
  version: 'winba/1.0.0', season: 2026, generated_at: SNAP_AT,
  qualified_count: 193, provisional_count: 44, rows, ...over
});

const article = (over = {}) => ({
  id: 'a62da4b87f00', kind: 'performance', slug: 'aces-story-abc123',
  lead_player_id: '3149391', lead_team_id: '17', primary_subject: 'Aces',
  entities: [
    { type: 'player', id: '3149391', name: "A'ja Wilson", team_id: '17' },
    { type: 'team', id: '17', name: 'Las Vegas Aces' }
  ],
  sections: [{ title: 'The read', key: 'the-read', first: 0, count: 1 }],
  body: ['Las Vegas won by 37.'],
  depth: { class: 'full', pass: true },
  provenance: { generated_at: GEN_AT },
  ...over
});

const freshState = () => ({ version: 'test', days: {} });

// ---------------------------------------------------------------- daily lane

test('an eligible story receives a frozen WinBA reference and the metric entity', () => {
  const out = applyWinbaContext(article(), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(),
    averages: row().averages, teamName: 'Aces'
  });
  assert.equal(out.applied, true);
  const ref = out.article.winba_reference;
  assert.equal(ref.player_id, '3149391');
  assert.equal(ref.score, 85.7);
  assert.equal(ref.rank, 2);
  assert.equal(ref.frozen, true);
  assert.equal(ref.snapshot_at, SNAP_AT);
  assert.equal(ref.canonical_url, WINBA_URL);
  assert.match(out.article.winba_sentence, /86 WinBA Score/);
  assert.ok(out.article.entities.some((e) => e.type === 'metric' && e.id === 'winba'));
});

test('the second eligible story the same day does not get a reference', () => {
  const s0 = freshState();
  const first = applyWinbaContext(article(), { snapshot: snapshot(), state: s0, at: new Date(NOW).toISOString(), averages: row().averages });
  assert.equal(first.applied, true);
  const second = applyWinbaContext(article({ id: 'different-story' }), {
    snapshot: snapshot(), state: first.state, at: new Date(NOW).toISOString(), averages: row().averages
  });
  assert.equal(second.applied, false);
  assert.match(second.reason, /daily WinBA slot is already used/);
  assert.equal(second.article.winba_reference, undefined);
});

test('the slot reopens the next New York day, and a late tip does not open a second', () => {
  const claimed = claimWinbaSlot(freshState(), { at: '2026-09-21T20:45:00.000Z', articleId: 'a1', ref: { player_id: '1', score: 80 } });
  assert.equal(claimed.claimed, true);
  // 02:00Z on the 22nd is still the 21st in New York.
  assert.equal(winbaSlotTaken(claimed.state, '2026-09-22T02:00:00.000Z', 'a2'), true);
  // Midday on the 22nd ET is a new day.
  assert.equal(winbaSlotTaken(claimed.state, '2026-09-22T16:00:00.000Z', 'a2'), false);
});

test('re-claiming for the same story is idempotent, so a regenerated article keeps its reference', () => {
  const first = claimWinbaSlot(freshState(), { at: '2026-09-21T20:45:00.000Z', articleId: 'same', ref: { player_id: '1', score: 80 } });
  const again = claimWinbaSlot(first.state, { at: '2026-09-21T21:45:00.000Z', articleId: 'same', ref: { player_id: '1', score: 80 } });
  assert.equal(again.claimed, true);
  assert.equal(Object.keys(again.state.days).length, 1);
});

test('a missing or unscored player yields no reference', () => {
  assert.equal(winbaReferenceFor(snapshot(), '9999999', { generatedAt: GEN_AT, now: NOW }), null);
  assert.equal(winbaReferenceFor(snapshot([row({ score: null })]), '3149391', { generatedAt: GEN_AT, now: NOW }), null);
  assert.equal(winbaReferenceFor(null, '3149391', { generatedAt: GEN_AT, now: NOW }), null);
});

test('a provisional player is never quoted: her rank is not a league-wide statement', () => {
  const ref = winbaReferenceFor(snapshot([row({ qualified: false, status: 'PROVISIONAL' })]), '3149391', { generatedAt: GEN_AT, now: NOW });
  assert.equal(ref, null);
});

test('a stale leaderboard yields no reference', () => {
  const later = Date.parse(SNAP_AT) + WINBA_MAX_AGE_MS + 60e3;
  assert.equal(winbaReferenceFor(snapshot(), '3149391', { generatedAt: new Date(later).toISOString(), now: later }), null);
});

test('a historical article never receives a later leaderboard', () => {
  // The story was generated a week before this snapshot existed.
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: '2026-09-14T12:00:00.000Z', now: NOW });
  assert.equal(ref, null);

  const out = applyWinbaContext(article({ provenance: { generated_at: '2026-09-14T12:00:00.000Z' } }), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(), averages: row().averages
  });
  assert.equal(out.applied, false);
  assert.equal(out.article.winba_reference, undefined);
});

test('a published reference does not change when the live leaderboard moves', () => {
  const out = applyWinbaContext(article(), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(), averages: row().averages
  });
  const published = JSON.parse(JSON.stringify(out.article));
  // The leaderboard later moves her to 91 and No. 1. The stored story is untouched.
  snapshot([row({ score: 91, rank: 1 })]);
  assert.equal(published.winba_reference.score, 85.7);
  assert.equal(published.winba_reference.rank, 2);
  assert.match(published.winba_sentence, /86 WinBA Score/);
  assert.doesNotMatch(published.winba_sentence, /91/);
});

test('one player can never receive another player’s rating', () => {
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: GEN_AT, now: NOW });
  // The story is about Jackie Young; the reference belongs to Wilson.
  const verdict = winbaEligibility(article({
    lead_player_id: '4065870',
    entities: [{ type: 'player', id: '4065870', name: 'Jackie Young', team_id: '17' }]
  }), ref);
  assert.equal(verdict.eligible, false);
  assert.match(verdict.reason, /not the lead player/);
});

test('a reference whose name disagrees with the linked player is refused', () => {
  const ref = winbaReferenceFor(snapshot([row({ name: 'Someone Else' })]), '3149391', { generatedAt: GEN_AT, now: NOW });
  const verdict = winbaEligibility(article(), ref);
  assert.equal(verdict.eligible, false);
  assert.match(verdict.reason, /disagrees with linked player/);
});

test('mid-pack ratings stay out of stories, where they would carry no context', () => {
  const ref = winbaReferenceFor(snapshot([row({ score: 53, rank: 96 })]), '3149391', { generatedAt: GEN_AT, now: NOW });
  const verdict = winbaEligibility(article(), ref);
  assert.equal(verdict.eligible, false);
  assert.match(verdict.reason, new RegExp(`outside the top ${WINBA_EDITORIAL_MAX_RANK}`));
});

test('administrative and market-only stories are not WinBA surfaces', () => {
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: GEN_AT, now: NOW });
  for (const kind of ['brief', 'market', 'props', 'winba_index']) {
    const verdict = winbaEligibility(article({ kind }), ref);
    assert.equal(verdict.eligible, false, `${kind} should not be eligible`);
  }
});

test('a story that fails its own substance gate cannot be dressed up with a rating', () => {
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: GEN_AT, now: NOW });
  const verdict = winbaEligibility(article({ depth: { class: 'full', pass: false } }), ref);
  assert.equal(verdict.eligible, false);
  assert.match(verdict.reason, /does not pass on its own substance/);
});

test('the article is unchanged and still valid when WinBA does not apply', () => {
  const a = article({ lead_player_id: '9999999' });
  const out = applyWinbaContext(a, { snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString() });
  assert.equal(out.applied, false);
  assert.deepEqual(out.article, a);
});

// ------------------------------------------------- substance neutrality (P1)

test('WinBA cannot raise a story’s depth class, dimensions or pass state', () => {
  const base = article({
    facts: { season_log: { last10: {} }, standing: { w: 20 }, next_game: {}, rotation: [{}] },
    evidence: [{ kind: 'record' }, { kind: 'publisher_report', publisher: 'ESPN' }, { kind: 'publisher_report', publisher: 'CBS' }]
  });
  const withRef = applyWinbaContext(base, {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(), averages: row().averages
  });
  assert.equal(withRef.applied, true);

  const before = classifyDepth(base, { now: NOW });
  const after = classifyDepth(withRef.article, { now: NOW });
  assert.equal(before.class, after.class);
  assert.equal(before.pass, after.pass);
  assert.equal(before.words, after.words, 'the sentence must not enter the word count');
  assert.deepEqual(evidenceDimensions(base).sort(), evidenceDimensions(withRef.article).sort());
});

test('the sentence is never written into the body, which is why it is depth-neutral', () => {
  const out = applyWinbaContext(article(), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(), averages: row().averages
  });
  assert.deepEqual(out.article.body, article().body);
  assert.equal(out.article.winba_placement.in_body, false);
  assert.equal(out.article.winba_placement.after_section, 'the-read');
});

// --------------------------------------------------------------- copy + links

test('rank phrasing is factual and never invents a qualitative band', () => {
  assert.equal(winbaRankPhrase({ rank: 1 }), 'the highest mark in the league');
  assert.equal(winbaRankPhrase({ rank: 3 }), 'No. 3 in the league');
  assert.equal(winbaRankPhrase({ rank: 9 }), 'No. 9, inside the league’s top 10');
  assert.equal(winbaRankPhrase({ rank: 18, qualified_count: 193 }), 'No. 18 of 193 qualified players');
  assert.equal(winbaRankPhrase({ rank: 96, qualified_count: 193 }), null);
  for (const rank of [1, 3, 9, 18]) {
    const s = winbaSentence({ ...row(), player_name: "A'ja Wilson", rank, score: 86, player_id: '1' }, { articleId: 'x' });
    assert.doesNotMatch(s, /\belite\b|\bgenerational\b|\bsuperstar\b/i);
  }
});

test('the treatment varies deterministically and is stable for a given story', () => {
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: GEN_AT, now: NOW });
  const opts = { averages: row().averages, teamName: 'Aces' };
  const a1 = winbaSentence(ref, { ...opts, articleId: 'story-a' });
  const a2 = winbaSentence(ref, { ...opts, articleId: 'story-a' });
  assert.equal(a1, a2, 'same story must regenerate the same phrasing');
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(winbaSentence(ref, { ...opts, articleId: `story-${i}` }));
  assert.ok(seen.size >= 3, `expected varied treatments, saw ${seen.size}`);
});

test('the stat line puts WinBA beside the conventional stats and links the explainer', () => {
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: GEN_AT, now: NOW });
  const line = winbaStatLine(ref, row().averages);
  assert.deepEqual(line.cells.map((c) => c.label), ['PTS', 'REB', 'AST', 'WINBA']);
  const winba = line.cells.at(-1);
  assert.equal(winba.value, '86');
  assert.equal(winba.href, WINBA_URL);
  assert.match(winba.title, /PropBetEdge overall WNBA player rating/);
});

test('the metric entity is what makes the renderer link the phrase, so prose holds no URL', () => {
  assert.equal(WINBA_METRIC_ENTITY.type, 'metric');
  assert.equal(WINBA_METRIC_ENTITY.name, WINBA_LABEL);
  const out = applyWinbaContext(article(), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(), averages: row().averages
  });
  assert.doesNotMatch(out.article.winba_sentence, /https?:|\/winba-score/);
  assert.match(out.article.winba_sentence, new RegExp(WINBA_LABEL));
});

test('placement falls back to the last section when no production section exists', () => {
  assert.equal(winbaPlacement({ sections: [{ key: 'the-move' }, { key: 'what-is-known' }] }).after_section, 'what-is-known');
  assert.equal(winbaPlacement({ sections: [] }).after_section, null);
});

// --------------------------------------------------------- as-of snapshot (P1)

const gameDoc = (id, startUtc, players) => ({
  summary: {
    game: { id, start_utc: startUtc, status: { completed: true }, season: { type: 2, year: 2026 }, home: { team_id: '17', score: 90 }, away: { team_id: '14', score: 80 } },
    box: { players }
  }
});
const line = (athleteId, teamId, over = {}) => ({ athlete_id: athleteId, name: `P${athleteId}`, team_id: teamId, min: 32, pts: 20, reb: 6, ast: 4, starter: true, ...over });

test('an as-of snapshot uses only games already played, so it is a genuine historical state', () => {
  const docs = [
    gameDoc('g1', '2026-08-10T23:00:00Z', [line('1', '17'), line('2', '14')]),
    gameDoc('g2', '2026-09-15T23:00:00Z', [line('1', '17', { pts: 40 }), line('2', '14')])
  ];
  const august = buildWinbaSnapshotAsOf(docs, { season: 2026, asOf: '2026-09-01T00:00:00.000Z' });
  const whole = buildWinbaSnapshot(docs, { season: 2026 });
  assert.equal(august.archive_docs_in_window, 1);
  assert.equal(august.games_used, 1);
  assert.equal(whole.games_used, 2);
  const p1Aug = august.rows.find((r) => r.athlete_id === '1');
  const p1All = whole.rows.find((r) => r.athlete_id === '1');
  assert.equal(p1Aug.sample.games, 1);
  assert.equal(p1All.sample.games, 2, 'the September game must not appear in the August state');
  assert.equal(august.as_of, '2026-09-01T00:00:00.000Z');
});

test('an as-of cutoff is exclusive, so the period’s own games count', () => {
  const docs = [gameDoc('g1', '2026-09-30T23:00:00Z', [line('1', '17'), line('2', '14')])];
  const september = buildWinbaSnapshotAsOf(docs, { season: 2026, asOf: '2026-10-01T00:00:00.000Z' });
  assert.equal(september.games_used, 1);
});

test('an unparseable as-of is refused rather than silently treated as now', () => {
  assert.throws(() => buildWinbaSnapshotAsOf([], { asOf: 'not-a-date' }), /parseable asOf/);
});


// ------------------------------------------------------------- renderer wiring

const { articleView } = await import('../src/views/article.js');

const rendered = (over = {}) => {
  const out = applyWinbaContext(article(over), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(),
    averages: row().averages, teamName: 'Aces'
  });
  assert.equal(out.applied, true, 'fixture should be eligible');
  return { html: String(articleView({ article: { ...out.article, media: null, method: [] }, related: [] })), article: out.article };
};

test('the renderer prints the frozen sentence and links the metric to the explainer', () => {
  const { html, article: a } = rendered();
  assert.ok(html.includes('winba-context'), 'the sentence renders inside the body');
  assert.ok(html.includes(`href="${WINBA_URL}"`), 'WinBA Score links to the canonical explainer');
  // The score in the markup is the frozen score, not a live read.
  assert.ok(html.includes(`${Math.round(a.winba_reference.score)} <a class="entity-link" href="${WINBA_URL}">WinBA Score</a>`), 'the frozen score sits next to the linked metric');
  assert.ok(!/WinBA Score<\/a>[^<]*<a[^>]*>WinBA Score/.test(html), 'the metric is linked once, not repeatedly');
});

test('the spoken score takes the right indefinite article', () => {
  const ref = winbaReferenceFor(snapshot(), '3149391', { generatedAt: GEN_AT, now: NOW });
  assert.match(winbaSentence({ ...ref, rank: null }, { articleId: 'x', averages: row().averages }), /carries an 86 WinBA Score/);
  assert.match(winbaSentence({ ...ref, score: 74, rank: null }, { articleId: 'x', averages: row().averages }), /carries a 74 WinBA Score/);
  assert.match(winbaSentence({ ...ref, score: 81, rank: null }, { articleId: 'x', averages: row().averages }), /carries an 81 WinBA Score/);
});

test('the metric appears in the In this story rail with its frozen value', () => {
  const { html } = rendered();
  assert.match(html, /In this story/);
  assert.match(html, /WinBA 86/);
  assert.match(html, /PropBetEdge overall WNBA player rating/);
});

test('a player or team name still wins a contested span over the metric', () => {
  const { html } = rendered();
  // Wilson is linked to her profile, not swallowed by the metric link.
  assert.match(html, /href="\/players\/3149391"/);
  assert.match(html, /href="\/teams\/17"/);
});

test('an article with no WinBA reference renders no WinBA markup at all', () => {
  const plain = String(articleView({ article: { ...article(), media: null, method: [] }, related: [] }));
  assert.ok(!plain.includes('winba-context'));
  assert.ok(!plain.includes(WINBA_URL));
  assert.ok(!/WinBA/.test(plain));
});

test('the sentence renders exactly once even when placement does not match a section', () => {
  const out = applyWinbaContext(article({ sections: [] }), {
    snapshot: snapshot(), state: freshState(), at: new Date(NOW).toISOString(), averages: row().averages
  });
  const html = String(articleView({ article: { ...out.article, media: null, method: [] }, related: [] }));
  const hits = (html.match(/winba-context/g) || []).length;
  assert.equal(hits, 1, `expected one WinBA paragraph, saw ${hits}`);
});
