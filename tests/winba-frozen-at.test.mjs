// `frozen_at` is provenance, and provenance cannot be in the future.
//
// A backfill once wrote a placeholder freeze instant six weeks ahead of the
// articles that published the boards. Nothing reader-facing used the value, but
// the identity audit did: it correctly concluded the board had been frozen after
// the story was written and retired two editions from the newsroom. These tests
// cover both halves of the fix — the guard that stops it being written, and the
// correction for the boards that already carry it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { freezeWinbaMonthly, winbaMonthlyKey, WINBA_MONTHLY_INDEX_KEY } from '../workers/wnba-news/src/winba-index.js';
import { runWinbaFrozenAtCorrection } from '../workers/wnba-news/src/winba-run.js';
import { seriesIdentityFailures } from '../workers/wnba-news/src/identity.js';

const NOW = Date.parse('2026-09-21T23:40:00.000Z');
const SNAP = {
  version: 'winba/1.0.0',
  season: 2026,
  generated_at: '2026-07-01T00:00:00.000Z',
  qualified_count: 158,
  games_used: 145,
  rows: [
    { athlete_id: '3149391', name: "A'ja Wilson", team_id: '17', score: 87.1, rank: 1, qualified: true, sample: { games: 19, wins: 14, minutes: 613 }, averages: { min: 32.3, pts: 25.7, reb: 9.4, ast: 2.9 }, components: { production_percentile: 100, win_rate: 73.7, winning_output_share: 78, court_share: 80.7 } },
    { athlete_id: '4433791', name: 'Olivia Miles', team_id: '8', score: 86.8, rank: 2, qualified: true, sample: { games: 19, wins: 15, minutes: 585 }, averages: { min: 30.8, pts: 18.7, reb: 4.8, ast: 5.7 }, components: { production_percentile: 96.8, win_rate: 78.9, winning_output_share: 79, court_share: 77 } }
  ]
};
const PLAYERS = new Map([['3149391', { name: "A'ja Wilson" }], ['4433791', { name: 'Olivia Miles' }]]);
const TEAMS = new Map([['17', { name: 'Las Vegas Aces' }], ['8', { name: 'Minnesota Lynx' }]]);

test('a board cannot be frozen in the future', () => {
  const ok = freezeWinbaMonthly(SNAP, { period: '2026-06', playerById: PLAYERS, teamById: TEAMS, at: '2026-09-21T23:28:00.000Z', now: NOW });
  assert.ok(ok, 'a real instant freezes');
  assert.equal(ok.frozen_at, '2026-09-21T23:28:00.000Z');
  // The exact placeholder that reached production.
  assert.equal(freezeWinbaMonthly(SNAP, { period: '2026-06', playerById: PLAYERS, teamById: TEAMS, at: '2026-11-02T10:00:00.000Z', now: NOW }), null);
  assert.equal(freezeWinbaMonthly(SNAP, { period: '2026-06', playerById: PLAYERS, teamById: TEAMS, at: 'not-a-date', now: NOW }), null);
  // A minute of clock skew is tolerated, an hour is not.
  assert.ok(freezeWinbaMonthly(SNAP, { period: '2026-06', playerById: PLAYERS, teamById: TEAMS, at: new Date(NOW + 30e3).toISOString(), now: NOW }));
  assert.equal(freezeWinbaMonthly(SNAP, { period: '2026-06', playerById: PLAYERS, teamById: TEAMS, at: new Date(NOW + 3600e3).toISOString(), now: NOW }), null);
});

test('the identity audit is what catches a future freeze instant', () => {
  const board = freezeWinbaMonthly(SNAP, { period: '2026-06', playerById: PLAYERS, teamById: TEAMS, at: '2026-09-21T23:28:00.000Z', now: NOW });
  const article = {
    kind: 'winba_index', identity_mode: 'series', primary_subject: 'The WinBA Index',
    period: '2026-06',
    lead_player_id: '3149391', lead_team_id: '17',
    entities: [{ type: 'player', id: '3149391', name: "A'ja Wilson", team_id: '17' }],
    winba_board: board,
    provenance: { generated_at: '2026-09-21T23:28:39.791Z' },
    published_at: '2026-09-21T23:28:39.791Z'
  };
  assert.deepEqual(seriesIdentityFailures(article, {}), [], 'a truthful board passes');
  const future = { ...article, winba_board: { ...board, frozen_at: '2026-11-02T10:00:00.000Z' } };
  assert.deepEqual(seriesIdentityFailures(future, {}), ['identity: the board was frozen after the article was generated']);
});

// ---- the correction for boards already published with the defect

function kv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    NEWS_KV: {
      get: async (k, type) => (store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v) => { store.set(k, v); }
    }
  };
}
const read = (h, k) => JSON.parse(h.store.get(k));

const EDITION = (period, id, frozenAt, generatedAt) => ({
  id,
  slug: `index-${period}`,
  kind: 'winba_index',
  period,
  body: ['A paragraph that must not change.'],
  published_at: generatedAt,
  first_published_at: generatedAt,
  provenance: { generated_at: generatedAt },
  revisions: [{ at: generatedAt, kind: 'integrity_retirement', note: 'identity: the board was frozen after the article was generated' }],
  identity_mode: 'series',
  primary_subject: 'The WinBA Index',
  lead_player_id: '3149391',
  lead_team_id: '17',
  entities: [{ type: 'player', id: '3149391', name: "A'ja Wilson", team_id: '17' }],
  winba_board: { period, period_label: period, frozen_at: frozenAt, snapshot_at: `${period}-30T00:00:00.000Z`, qualified_count: 158, rows: [{ rank: 1, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', team_name: 'Las Vegas Aces', score: 87.1, components: { win_rate: 73.7 } }] }
});

const seedWorld = () => {
  const boards = {
    [winbaMonthlyKey('2026-07')]: { period: '2026-07', frozen_at: '2026-11-02T10:00:00.000Z', snapshot_at: '2026-07-30T00:00:00.000Z', rows: [{ rank: 1, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', team_name: 'Las Vegas Aces', score: 87.1, components: { win_rate: 73.7 } }] },
    [winbaMonthlyKey('2026-09')]: { period: '2026-09', frozen_at: '2026-09-21T20:48:01.908Z', snapshot_at: '2026-09-21T03:17:45.205Z', rows: [{ rank: 1, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', team_name: 'Minnesota Lynx', score: 87, components: { win_rate: 78 } }] }
  };
  return kv({
    [WINBA_MONTHLY_INDEX_KEY]: { published: {
      '2026-07': { id: 'july1', slug: 'index-2026-07', period: '2026-07', published_at: '2026-09-21T23:28:44.270Z', frozen_at: '2026-11-02T10:00:00.000Z' },
      '2026-09': { id: 'sept1', slug: 'index-2026-09', period: '2026-09', published_at: '2026-09-21T20:48:01.908Z', frozen_at: '2026-09-21T20:48:01.908Z' }
    } },
    'art:v1:item:july1': EDITION('2026-07', 'july1', '2026-11-02T10:00:00.000Z', '2026-09-21T23:28:44.270Z'),
    'art:v1:item:sept1': EDITION('2026-09', 'sept1', '2026-09-21T20:48:01.908Z', '2026-09-21T20:48:01.908Z'),
    'art:v1:index': [{ id: 'july1', slug: 'index-2026-07' }, { id: 'sept1', slug: 'index-2026-09' }],
    ...boards
  });
};

test('the correction moves only the defective frozen_at, and nothing else', async () => {
  const h = seedWorld();
  const before = read(h, 'art:v1:item:july1');
  const res = await runWinbaFrozenAtCorrection(h, { at: '2026-09-22T02:00:00.000Z' });

  assert.equal(res.checked, 2);
  assert.deepEqual(res.corrected.map((c) => c.period), ['2026-07'], 'only the defective edition');
  assert.deepEqual(res.unchanged, ['2026-09'], 'a healthy edition is untouched');
  assert.equal(res.corrected[0].from, '2026-11-02T10:00:00.000Z');
  assert.equal(res.corrected[0].to, '2026-09-21T23:28:44.270Z', 'corrected to the article generation time it can be proven by');

  const board = read(h, winbaMonthlyKey('2026-07'));
  assert.equal(board.frozen_at, '2026-09-21T23:28:44.270Z');
  assert.equal(board.frozen_at_corrected_from, '2026-11-02T10:00:00.000Z');
  assert.deepEqual(board.rows, before.winba_board.rows, 'no ranked value moves');
  assert.equal(board.snapshot_at, '2026-07-30T00:00:00.000Z', 'and neither does the observation time');

  const after = read(h, 'art:v1:item:july1');
  assert.equal(after.published_at, before.published_at, 'publication date never moves');
  assert.equal(after.slug, before.slug);
  assert.deepEqual(after.body, before.body, 'not a word of copy changes');
  assert.equal(after.winba_board.frozen_at, '2026-09-21T23:28:44.270Z');
  const rev = after.revisions.at(-1);
  assert.equal(rev.kind, 'metadata_correction');
  assert.match(rev.note, /frozen_at corrected from 2026-11-02T10:00:00.000Z to 2026-09-21T23:28:44.270Z/);
  assert.match(rev.note, /No ranked value, score, publication date or word of copy changed/);
  assert.deepEqual(after.revisions.slice(0, -1), before.revisions, 'the earlier ledger is kept');

  // The listing card learns it was revised, and the ledger agrees.
  assert.equal(read(h, 'art:v1:index').find((c) => c.id === 'july1').revised_at, '2026-09-22T02:00:00.000Z');
  assert.equal(read(h, WINBA_MONTHLY_INDEX_KEY).published['2026-07'].frozen_at, '2026-09-21T23:28:44.270Z');
});

test('the correction clears the retirement it caused, and is safe to run twice', async () => {
  const h = seedWorld();
  await runWinbaFrozenAtCorrection(h, { at: '2026-09-22T02:00:00.000Z' });
  const corrected = read(h, 'art:v1:item:july1');
  assert.deepEqual(seriesIdentityFailures(corrected, {}), [], 'the failure that retired it no longer holds');

  const second = await runWinbaFrozenAtCorrection(h, { at: '2026-09-22T03:00:00.000Z' });
  assert.deepEqual(second.corrected, [], 'nothing left to correct');
  assert.deepEqual(second.unchanged.sort(), ['2026-07', '2026-09']);
  const again = read(h, 'art:v1:item:july1');
  assert.equal(again.revisions.length, corrected.revisions.length, 'and no second revision is logged');
  assert.equal(again.revised_at, corrected.revised_at);
});

test('the correction refuses to write if the board rows would change', async () => {
  const h = seedWorld();
  // A board whose rows no longer match what the article published.
  const item = read(h, 'art:v1:item:july1');
  h.store.set('art:v1:item:july1', JSON.stringify({ ...item, provenance: { generated_at: 'not-a-date' }, published_at: 'not-a-date' }));
  const res = await runWinbaFrozenAtCorrection(h, { at: '2026-09-22T02:00:00.000Z' });
  assert.deepEqual(res.corrected, [], 'an unreadable generation time is not a licence to guess one');
  assert.equal(read(h, winbaMonthlyKey('2026-07')).frozen_at, '2026-11-02T10:00:00.000Z', 'the board is left as it was');
});
