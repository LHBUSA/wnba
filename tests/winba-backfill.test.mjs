// The historical publication contract, the authorised tie-order correction and
// the surgical qualification-copy fix.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  freezeWinbaMonthly,
  composeWinbaIndex,
  correctQualificationCopy,
  runWinbaIndex
} from '../workers/wnba-news/src/winba-index.js';

const SNAP_AT = '2026-07-01T00:00:00.000Z';
const PUBLISHED_NOW = '2026-09-02T10:00:00.000Z';
const NOW = Date.parse('2026-10-08T00:00:00.000Z');

const mkRow = (id, name, score, teamId, teamName, over = {}) => ({
  athlete_id: id, name, team_id: teamId, score, qualified: true,
  sample: { games: 20, wins: 12, minutes: 620 },
  averages: { min: 31, pts: 19, reb: 6, ast: 4 },
  components: { production_percentile: 95, win_rate: 70, winning_output_share: 72, court_share: 77 },
  ...over
});
const ranked = (rows) => {
  const q = [...rows].sort((a, b) => b.score - a.score
    || (b.sample?.minutes || 0) - (a.sample?.minutes || 0)
    || String(a.name).localeCompare(String(b.name)));
  const rank = new Map(q.map((r, i) => [r.athlete_id, i + 1]));
  return rows.map((r) => ({ ...r, rank: rank.get(r.athlete_id) }));
};
const SNAP = {
  version: 'winba/1.0.0', season: 2026, generated_at: SNAP_AT, as_of: SNAP_AT,
  qualified_count: 158, provisional_count: 50, games_used: 145,
  rows: ranked([
    mkRow('1', 'Alpha One', 87, '8', 'Minnesota Lynx'),
    mkRow('2', 'Beta Two', 85, '17', 'Las Vegas Aces'),
    mkRow('3', 'Gamma Three', 83, '20', 'Atlanta Dream'),
    mkRow('4', 'Delta Four', 81, '5', 'Indiana Fever'),
    mkRow('5', 'Echo Five', 80, '3', 'Dallas Wings'),
    mkRow('6', 'Foxtrot Six', 79, '9', 'New York Liberty'),
    mkRow('7', 'Golf Seven', 78, '8', 'Minnesota Lynx'),
    mkRow('8', 'Hotel Eight', 77, '17', 'Las Vegas Aces'),
    mkRow('9', 'India Nine', 76, '20', 'Atlanta Dream'),
    mkRow('10', 'Juliet Ten', 75, '5', 'Indiana Fever'),
    mkRow('11', 'Kilo Eleven', 74, '3', 'Dallas Wings'),
    mkRow('12', 'Lima Twelve', 73, '9', 'New York Liberty'),
    mkRow('13', 'Mike Thirteen', 72, '8', 'Minnesota Lynx'),
    mkRow('14', 'November Fourteen', 71, '17', 'Las Vegas Aces')
  ])
};
const PLAYERS = new Map(SNAP.rows.map((r) => [r.athlete_id, { name: r.name, position: 'G', experience_years: 4 }]));
const TEAMS = new Map([['8', { name: 'Minnesota Lynx' }], ['17', { name: 'Las Vegas Aces' }], ['20', { name: 'Atlanta Dream' }], ['5', { name: 'Indiana Fever' }], ['3', { name: 'Dallas Wings' }], ['9', { name: 'New York Liberty' }]]);
const freeze = (period = '2026-06', at = PUBLISHED_NOW) => freezeWinbaMonthly(SNAP, { period, playerById: PLAYERS, teamById: TEAMS, at });

function harness() {
  const monthly = new Map();
  const articles = new Map();
  let state = null;
  return {
    monthly, articles, get state() { return state; },
    io: {
      getMonthly: async (p) => monthly.get(p) || null,
      putMonthly: async (p, v) => { monthly.set(p, v); },
      getIndexState: async () => state,
      putIndexState: async (v) => { state = v; },
      getArticle: async (id) => articles.get(id) || null,
      putArticle: async (a) => { articles.set(a.id, a); }
    }
  };
}

// ------------------------------------------------ publication contract

test('a reconstructed edition is never backdated and says it was reconstructed', async () => {
  const h = harness();
  h.monthly.set('2026-06', freeze('2026-06'));
  const res = await runWinbaIndex({
    period: '2026-06', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS,
    at: PUBLISHED_NOW, force: true, backfill: true, ...h.io
  , now: NOW });
  assert.equal(res.status, 'published');
  const a = h.articles.get(res.id);
  assert.equal(a.published_at, PUBLISHED_NOW, 'the real publication instant, not a June date');
  assert.equal(a.first_published_at, PUBLISHED_NOW);
  assert.equal(a.historical_backfill, true);
  assert.equal(a.period, '2026-06', 'the period is where the month lives');
  assert.equal(a.snapshot_as_of, SNAP_AT, 'the cutoff is recorded separately');
  assert.match(a.body.join(' '), /reconstructed from PropBetEdge's archived game record/);
  assert.match(a.body.join(' '), /published later, and its publication date reflects that/);
  // The publication date must not fall inside the period it covers.
  assert.ok(Date.parse(a.published_at) > Date.parse(a.snapshot_as_of));
});

test('a same-period edition is not marked as a backfill', async () => {
  const h = harness();
  h.monthly.set('2026-06', freeze('2026-06'));
  const res = await runWinbaIndex({
    period: '2026-06', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS,
    at: PUBLISHED_NOW, force: true, ...h.io
  , now: NOW });
  const a = h.articles.get(res.id);
  assert.equal(a.historical_backfill, false);
  assert.doesNotMatch(a.body.join(' '), /reconstructed from PropBetEdge/);
});

test('schema uses the real publication date, never the period', async () => {
  const { newsArticle } = await import('../src/seo/jsonld.js');
  const { routeMeta } = await import('../src/seo/meta.js');
  const h = harness();
  h.monthly.set('2026-06', freeze('2026-06'));
  const res = await runWinbaIndex({
    period: '2026-06', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS,
    at: PUBLISHED_NOW, force: true, backfill: true, ...h.io
  , now: NOW });
  const a = { ...h.articles.get(res.id), entities: [], evidence: [] };
  const ld = newsArticle(a, routeMeta('article', { path: `/news/${a.slug}`, data: a }));
  assert.equal(ld.datePublished, PUBLISHED_NOW);
  assert.ok(!String(ld.datePublished).startsWith('2026-06'), 'no June publication date is claimed');
  assert.equal(ld.articleSection, 'The WinBA Index');
});

// ------------------------------------------- authorised tie-order correction

/** A published board whose tied pair is ordered the old (athlete-id) way. */
function tiedPair() {
  const rows = ranked([
    ...SNAP.rows.filter((r) => !['okot', 'tyus'].includes(r.athlete_id)),
    // Equal scores. Okot has MORE minutes, so the metric ranks her first;
    // ordering by athlete id would put 'okot' after 'tyus'.
    mkRow('okot', 'Madina Okot', 72.2, '20', 'Atlanta Dream', { sample: { games: 20, wins: 9, minutes: 700 } }),
    mkRow('tyus', 'Cheyenne Parker-Tyus', 72.2, '17', 'Las Vegas Aces', { sample: { games: 20, wins: 11, minutes: 400 } })
  ]);
  const snap = { ...SNAP, rows };
  const correct = freezeWinbaMonthly(snap, { period: '2026-09', playerById: PLAYERS, teamById: TEAMS, at: PUBLISHED_NOW });
  // Simulate the ALREADY-PUBLISHED board with the two ranks swapped.
  const okotRank = correct.rows.find((r) => r.player_id === 'okot').rank;
  const tyusRank = correct.rows.find((r) => r.player_id === 'tyus').rank;
  const published = {
    ...correct,
    rows: correct.rows
      .map((r) => (r.player_id === 'okot' ? { ...r, rank: tyusRank } : r.player_id === 'tyus' ? { ...r, rank: okotRank } : r))
      .sort((a, b) => a.rank - b.rank)
  };
  return { snap, correct, published };
}

test('a tie-order correction is refused without explicit authorisation', async () => {
  const h = harness();
  const { snap, published } = tiedPair();
  h.monthly.set('2026-09', published);
  const before = JSON.parse(JSON.stringify(published));
  const res = await runWinbaIndex({
    period: '2026-09', snapshot: snap, playerById: PLAYERS, teamById: TEAMS,
    at: PUBLISHED_NOW, force: true, refreeze: true, ...h.io
  , now: NOW });
  assert.equal(res.status, 'refreeze_refused');
  assert.equal(res.tie_order_only, true, 'it knows only tied ranks differ');
  assert.match(res.refusal, /needs explicit authorisation/);
  assert.deepEqual(h.monthly.get('2026-09'), before, 'nothing changed');
});

test('an authorised tie-order correction reorders ties and records a revision', async () => {
  const h = harness();
  const { snap, published, correct } = tiedPair();
  h.monthly.set('2026-09', published);
  // Publish first so there is an article with a published_at to preserve.
  h.articles.set('seed', {});
  const first = await runWinbaIndex({ period: '2026-09', snapshot: snap, playerById: PLAYERS, teamById: TEAMS, at: '2026-09-21T20:48:01.908Z', ...h.io , now: NOW });
  const originalPublished = h.articles.get(first.id).published_at;

  const res = await runWinbaIndex({
    period: '2026-09', snapshot: snap, playerById: PLAYERS, teamById: TEAMS,
    at: PUBLISHED_NOW, force: true, refreeze: true, acceptRankCorrection: true, ...h.io
  , now: NOW });
  assert.notEqual(res.status, 'refreeze_refused');
  const board = h.monthly.get('2026-09');
  assert.deepEqual(board.rows.map((r) => [r.rank, r.player_id]), correct.rows.map((r) => [r.rank, r.player_id]));
  // Scores and components are untouched; only the order of equals moved.
  assert.deepEqual(board.rows.map((r) => r.score).sort(), correct.rows.map((r) => r.score).sort());
  const a = h.articles.get(res.id);
  assert.equal(a.published_at, originalPublished, 'published_at does not move');
  assert.equal(a.slug, first.slug, 'the canonical slug does not move');
  const correction = a.revisions.find((r) => r.kind === 'integrity_correction');
  assert.ok(correction, 'the correction is in the ledger');
  assert.match(correction.note, /ordered tied scores by athlete id/);
  assert.match(correction.note, /score -> minutes -> name/);
  assert.ok(a.revisions.length >= 2, 'earlier history is kept, not replaced');
});

test('an authorised correction still cannot change a score', async () => {
  const h = harness();
  const { published } = tiedPair();
  h.monthly.set('2026-09', published);
  const before = JSON.parse(JSON.stringify(published));
  // A snapshot where a score actually moved: not a tie-order correction.
  const moved = { ...SNAP, rows: ranked(published.rows.map((r) => ({
    athlete_id: r.player_id, name: r.player_name, team_id: r.team_id,
    score: r.player_id === 'okot' ? 99 : r.score, qualified: true,
    sample: { games: 20, wins: 10, minutes: 600 }, averages: r.averages, components: r.components
  }))) };
  const res = await runWinbaIndex({
    period: '2026-09', snapshot: moved, playerById: PLAYERS, teamById: TEAMS,
    at: PUBLISHED_NOW, force: true, refreeze: true, acceptRankCorrection: true, ...h.io
  , now: NOW });
  assert.equal(res.status, 'refreeze_refused');
  assert.equal(res.tie_order_only, false);
  assert.deepEqual(h.monthly.get('2026-09'), before);
});

// ------------------------------------------------ surgical copy correction

test('the qualification clause is corrected without touching other copy', () => {
  const item = {
    id: 'x', slug: 'the-winba-index-september-2026-00e543',
    published_at: '2026-09-21T20:48:01.908Z', first_published_at: '2026-09-21T20:48:01.908Z',
    revisions: [{ at: '2026-09-21T21:00:00.000Z', kind: 'editorial_upgrade' }],
    body: [
      'Olivia Miles finishes September 2026 at the top of WinBA Score.',
      'A second paragraph that must not change.',
      'WinBA Score is built only from completed WNBA games. It is an association-with-winning index, not a causal estimate of wins added. 193 players qualified this month at 10 games and 250 minutes.',
      'A closing paragraph that must not change.'
    ]
  };
  const fix = correctQualificationCopy(item, { at: PUBLISHED_NOW });
  assert.ok(fix);
  assert.equal(fix.paragraph, 2);
  assert.match(fix.article.body[2], /at least 10 appearances or 250 minutes/);
  assert.doesNotMatch(fix.article.body[2], /10 games and 250 minutes/);
  // Everything else is byte-identical.
  assert.equal(fix.article.body[0], item.body[0]);
  assert.equal(fix.article.body[1], item.body[1]);
  assert.equal(fix.article.body[3], item.body[3]);
  assert.equal(fix.article.body.length, item.body.length);
  // The rest of the corrected paragraph survives untouched.
  assert.match(fix.article.body[2], /^WinBA Score is built only from completed WNBA games\./);
  assert.match(fix.article.body[2], /not a causal estimate of wins added/);
  // Publication identity is preserved and the correction is logged.
  assert.equal(fix.article.published_at, item.published_at);
  assert.equal(fix.article.slug, item.slug);
  assert.equal(fix.article.revised_at, PUBLISHED_NOW);
  assert.equal(fix.article.revisions.length, 2);
  assert.match(fix.article.revisions.at(-1).note, /at least 10 appearances OR 250 minutes, not both/);
});

test('the copy correction is idempotent and leaves correct copy alone', () => {
  const good = { body: ['193 players qualified for the league ranking, which takes at least 10 appearances or 250 minutes.'] };
  assert.equal(correctQualificationCopy(good), null);
  assert.equal(correctQualificationCopy({ body: [] }), null);
  assert.equal(correctQualificationCopy({}), null);
  assert.equal(correctQualificationCopy(null), null);
});
