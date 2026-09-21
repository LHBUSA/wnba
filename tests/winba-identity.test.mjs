// The identity contract for a recurring ranking article, and the restoration of
// a record retired under a contract that did not apply to it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  articleIdentityFailures,
  seriesIdentityFailures,
  identityModeOf,
  auditStoredIdentity
} from '../workers/wnba-news/src/identity.js';

const GEN = '2026-09-21T20:48:01.908Z';
const index = (over = {}) => ({
  kind: 'winba_index', identity_mode: 'series', primary_subject: 'The WinBA Index', period: '2026-09',
  lead_player_id: '4433791', lead_team_id: '8',
  entities: [
    { type: 'player', id: '4433791', name: 'Olivia Miles' },
    { type: 'team', id: '8', name: 'Minnesota Lynx' }
  ],
  provenance: { generated_at: GEN },
  winba_board: {
    period: '2026-09', snapshot_at: '2026-09-21T03:17:45.205Z', frozen_at: GEN,
    rows: [
      { rank: 1, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: 87 },
      { rank: 2, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', score: 85.7 }
    ]
  },
  ...over
});

test('THE LIVE FAILURE: a series subject is not a player mismatch', () => {
  const a = index();
  assert.equal(identityModeOf(a), 'series');
  // This is the exact pair that retired the September edition in production:
  // primary_subject "The WinBA Index" with lead player Olivia Miles.
  assert.deepEqual(articleIdentityFailures(a), []);
});

test('the mode is inferred for records written before the field existed', () => {
  const { identity_mode, ...legacy } = index();
  assert.equal(identityModeOf(legacy), 'series');
  assert.deepEqual(articleIdentityFailures(legacy), []);
});

test('a normal player story with a genuinely mismatched subject still fails', () => {
  const failures = articleIdentityFailures({
    kind: 'performance', primary_subject: 'Kelsey Mitchell',
    lead_player_id: '4065870', lead_team_id: '17',
    entities: [
      { type: 'player', id: '4065870', name: 'Jackie Young', team_id: '17' },
      { type: 'team', id: '17', name: 'Las Vegas Aces' }
    ]
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /primary subject "Kelsey Mitchell" disagrees with lead player "Jackie Young"/);
});

test('the wrong-team records still fail under the player contract', () => {
  const clark = articleIdentityFailures({
    kind: 'brief', primary_subject: 'Caitlin Clark', lead_player_id: '4433403', lead_team_id: '8',
    entities: [
      { type: 'player', id: '4433403', name: 'Caitlin Clark', team_id: '5' },
      { type: 'team', id: '8', name: 'Minnesota Lynx' }
    ]
  });
  assert.ok(clark.some((f) => /was linked to team 5 in this event, not lead team 8/.test(f)));
});

test('the series contract catches what can actually be wrong with a board', () => {
  assert.deepEqual(seriesIdentityFailures(index()), []);
  const bad = (over) => seriesIdentityFailures(index(over)).join(' | ');

  assert.match(bad({ primary_subject: 'Olivia Miles' }), /is not the registered series/);
  assert.match(bad({ period: 'not-a-period' }), /not a valid ranking period/);
  assert.match(bad({ period: '2026-13' }), /not a valid ranking period/);
  assert.match(bad({ winba_board: null }), /frozen board is missing/);
  assert.match(bad({ lead_player_id: '3149391' }), /is not the board leader/);
  assert.match(bad({ lead_team_id: '17' }), /is not the board leader/);
  assert.match(bad({ entities: [{ type: 'player', id: '4433791', name: 'Someone Else' }] }), /disagrees with linked player/);
  assert.match(bad({ kind: 'not_a_series' }), /is not a registered editorial series/);
});

test('board-internal coherence is asserted', () => {
  const withRows = (rows, over = {}) => seriesIdentityFailures(index({ winba_board: { ...index().winba_board, rows }, ...over })).join(' | ');
  assert.match(withRows([{ rank: 2, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: 87 }]), /not a complete 1\.\.n sequence/);
  assert.match(withRows([
    { rank: 1, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: 80 },
    { rank: 2, player_id: '3149391', player_name: "A'ja Wilson", team_id: '17', score: 99 }
  ]), /do not descend with rank/);
  assert.match(withRows([{ rank: 1, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: null }]), /no score/);
  assert.match(withRows([{ rank: 1, player_id: 'abc', player_name: '', team_id: '8', score: 87 }]), /(does|do) not resolve to a named player id/);
  assert.match(seriesIdentityFailures(index({ winba_board: { ...index().winba_board, rows: [] } })).join(' | '), /no ranked players/);
  assert.match(seriesIdentityFailures(index({ winba_board: { ...index().winba_board, period: '2026-08' } })).join(' | '), /covers 2026-08/);
});

test('timestamps must be coherent', () => {
  const b = index().winba_board;
  assert.match(seriesIdentityFailures(index({ winba_board: { ...b, snapshot_at: '2026-09-25T00:00:00.000Z' } })).join(' | '), /newer than the article/);
  assert.match(seriesIdentityFailures(index({ winba_board: { ...b, frozen_at: '2026-09-25T00:00:00.000Z' } })).join(' | '), /frozen after the article was generated/);
});

test('a frozen board may contain players no longer on any roster', () => {
  // This is the whole point of a historical edition: demanding a current-roster
  // match would reject exactly the editions that are most correct.
  const dict = { playerById: new Map([['4433791', { name: 'Olivia Miles', team_id: '8' }]]) };
  assert.deepEqual(seriesIdentityFailures(index({
    winba_board: {
      period: '2026-09', snapshot_at: '2026-09-21T03:17:45.205Z', frozen_at: GEN,
      rows: [
        { rank: 1, player_id: '4433791', player_name: 'Olivia Miles', team_id: '8', score: 87 },
        { rank: 2, player_id: '9999999', player_name: 'Released Player', team_id: '17', score: 70 }
      ]
    }
  }), { dict }), []);
});

// ------------------------------------------------------------- restoration

const PUBLISHED = '2026-09-21T20:48:01.908Z';
const retiredPair = () => {
  const item = {
    ...index(),
    id: 'x', slug: 'the-winba-index-september-2026-00e543',
    published_at: PUBLISHED, first_published_at: PUBLISHED,
    revisions: [{ at: '2026-09-21T21:55:45.648Z', kind: 'integrity_retirement', note: 'identity: primary subject "The WinBA Index" disagrees with lead player "Olivia Miles"' }],
    quality_state: 'retired_from_index',
    quality_review: { policy: 'wnba-news-identity/1.1.0', state: 'retired_from_index', reason: 'identity: primary subject "The WinBA Index" disagrees with lead player "Olivia Miles"' }
  };
  const card = {
    id: 'x', slug: item.slug, quality_state: 'retired_from_index',
    quality_review: item.quality_review, published_at: PUBLISHED, first_published_at: PUBLISHED
  };
  return { item, card };
};

test('an invalidly retired record is restored without moving the publication', async () => {
  const { item, card } = retiredPair();
  let put = null;
  const r = await auditStoredIdentity([card], { getItem: async () => item, putItem: async (v) => { put = v; }, at: '2026-09-21T22:30:00.000Z' });
  assert.equal(r.restored, 1);
  assert.equal(r.retired, 0);
  assert.equal(card.quality_state, 'current_quality');
  assert.equal(put.published_at, PUBLISHED, 'published_at must not move');
  assert.equal(put.first_published_at, PUBLISHED);
  assert.equal(put.slug, item.slug, 'the canonical URL must not change');
  assert.deepEqual(put.winba_board, item.winba_board, 'the frozen board is untouched');
  assert.deepEqual(put.body, item.body);
});

test('the retirement stays in the history — it is not pretended away', async () => {
  const { item, card } = retiredPair();
  let put = null;
  await auditStoredIdentity([card], { getItem: async () => item, putItem: async (v) => { put = v; }, at: '2026-09-21T22:30:00.000Z' });
  assert.deepEqual(put.revisions.map((x) => x.kind), ['integrity_retirement', 'integrity_restoration']);
  assert.match(put.quality_review.reason, /does not hold under wnba-news-identity/);
  assert.equal(put.quality_review.restored_from.reason, item.quality_review.reason);
});

test('a genuinely failing record is never restored', async () => {
  const item = {
    id: 'y', kind: 'brief', primary_subject: 'Caitlin Clark', lead_player_id: '4433403', lead_team_id: '8',
    entities: [
      { type: 'player', id: '4433403', name: 'Caitlin Clark', team_id: '5' },
      { type: 'team', id: '8', name: 'Minnesota Lynx' }
    ]
  };
  const card = { id: 'y', slug: 'clark-lynx-6ff81a', quality_state: 'retired_from_index', quality_review: { policy: 'wnba-news-identity/1.1.0', reason: 'identity: …' } };
  const r = await auditStoredIdentity([card], { getItem: async () => item, putItem: async () => {}, at: '2026-09-21T22:30:00.000Z' });
  assert.equal(r.restored, 0);
  assert.equal(r.retired, 1);
  assert.equal(card.quality_state, 'retired_from_index');
});

test('only an identity retirement is reversed by the identity audit', async () => {
  // A record withheld by another policy (storycraft, the trend desk) stays
  // withheld: this pass must not overrule a decision it did not make.
  const { item, card } = retiredPair();
  card.quality_review = { policy: 'wnba-legacy-policy/1.2.0', state: 'retired_from_index', reason: 'storycraft: …' };
  let put = null;
  const r = await auditStoredIdentity([card], { getItem: async () => item, putItem: async (v) => { put = v; }, at: '2026-09-21T22:30:00.000Z' });
  assert.equal(r.restored, 0);
  assert.equal(card.quality_state, 'retired_from_index');
  assert.equal(put, null);
});
