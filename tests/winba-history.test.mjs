// Historical reconstruction integrity: a past period's board cannot be moved by
// anything that happened after its cutoff, and a published board cannot be
// rewritten by a re-freeze.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildWinbaSnapshotAsOf, WINBA_QUALIFICATION } from '../workers/shared/winba.js';
import { freezeWinbaMonthly, winbaMovement, runWinbaIndex } from '../workers/wnba-news/src/winba-index.js';

const doc = (id, startUtc, home, away, players) => ({
  summary: {
    game: { id, start_utc: startUtc, status: { completed: true }, season: { type: 2, year: 2026 }, home, away },
    box: { players }
  }
});
// These fixtures replay months that are later than the real clock, so the
// freeze guard is handed the fixture's own instant.
const NOW = Date.parse('2026-11-04T00:00:00.000Z');
const line = (athleteId, name, teamId, over = {}) => ({ athlete_id: athleteId, name, team_id: teamId, min: 32, pts: 20, reb: 6, ast: 4, ...over });

// Twelve June games, then twelve more in July. A June board must not see July.
const JUNE = Array.from({ length: 12 }, (_, i) => doc(`j${i}`, `2026-06-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
  { team_id: '8', score: 90 }, { team_id: '17', score: 80 },
  [line('1', 'June Star', '8'), line('2', 'Other', '17', { pts: 10 })]));
const JULY = Array.from({ length: 12 }, (_, i) => doc(`l${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
  { team_id: '17', score: 95 }, { team_id: '8', score: 70 },
  [line('2', 'Other', '17', { pts: 45 }), line('1', 'June Star', '8', { pts: 2 })]));

const hash = (b) => crypto.createHash('sha256')
  .update(JSON.stringify((b.rows || []).map((r) => [r.rank, r.player_id, r.score, r.team_id])))
  .digest('hex');

test('the qualification rule is a disjunction, as the metric defines it', () => {
  assert.deepEqual({ ...WINBA_QUALIFICATION }, { min_games: 10, min_minutes: 250 });
  // Twelve appearances at five minutes each: nowhere near 250 minutes, so if
  // qualification needed BOTH she would be excluded. It needs either.
  const short = Array.from({ length: 12 }, (_, i) => doc(`s${i}`, `2026-06-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
    { team_id: '8', score: 90 }, { team_id: '17', score: 80 },
    [line('1', 'Few Minutes', '8', { min: 5, pts: 4 }), line('2', 'Other', '17', { min: 5 })]));
  const b = buildWinbaSnapshotAsOf(short, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  const p = b.rows.find((r) => r.athlete_id === '1');
  assert.equal(p.sample.games, 12);
  assert.ok(p.sample.minutes < WINBA_QUALIFICATION.min_minutes, 'under the minutes threshold');
  assert.equal(p.qualified, true, 'appearances alone qualify her');
});

test('games played after the cutoff cannot change a historical board', () => {
  const juneOnly = buildWinbaSnapshotAsOf(JUNE, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  const withJuly = buildWinbaSnapshotAsOf([...JUNE, ...JULY], { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  assert.equal(juneOnly.games_used, 12);
  assert.equal(withJuly.games_used, 12, 'July games are not in the June window');
  const a = freezeWinbaMonthly(juneOnly, { period: '2026-06', at: '2026-09-02T10:00:00.000Z' });
  const b = freezeWinbaMonthly(withJuly, { period: '2026-06', at: '2026-09-02T10:00:00.000Z' });
  assert.equal(hash(a), hash(b), 'the June board is identical with July present or absent');
  // July's own board does see them.
  const july = buildWinbaSnapshotAsOf([...JUNE, ...JULY], { season: 2026, asOf: '2026-08-01T00:00:00.000Z' });
  assert.equal(july.games_used, 24);
});

test('a later team change cannot rewrite a historical team assignment', () => {
  const june = buildWinbaSnapshotAsOf(JUNE, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  const frozen = freezeWinbaMonthly(june, { period: '2026-06', at: '2026-09-02T10:00:00.000Z' });
  assert.equal(frozen.rows.find((r) => r.player_id === '1').team_id, '8', 'the team she played for in June');
  // Today's dictionary says she is elsewhere; the frozen board is unmoved.
  const traded = freezeWinbaMonthly(june, {
    period: '2026-06', at: '2026-09-02T10:00:00.000Z',
    playerById: new Map([['1', { name: 'June Star', team_id: '99' }]]),
    teamById: new Map([['99', { name: 'Somewhere Else' }]])
  });
  assert.equal(traded.rows.find((r) => r.player_id === '1').team_id, '8', 'the box score decides, not the roster');
});

test('current roster status cannot remove a player who qualified historically', () => {
  const june = buildWinbaSnapshotAsOf(JUNE, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  // An empty roster dictionary: every player is "off roster" today.
  const frozen = freezeWinbaMonthly(june, { period: '2026-06', at: '2026-09-02T10:00:00.000Z', playerById: new Map(), teamById: new Map() });
  assert.ok(frozen.rows.length >= 1);
  assert.ok(frozen.rows.some((r) => r.player_id === '1'), 'she stays on the board');
});

test('a frozen board is deterministic across repeated builds', () => {
  const june = buildWinbaSnapshotAsOf(JUNE, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  const hashes = [1, 2, 3, 4].map(() => hash(freezeWinbaMonthly(june, { period: '2026-06', at: '2026-09-02T10:00:00.000Z' })));
  assert.equal(new Set(hashes).size, 1, `expected one hash, saw ${new Set(hashes).size}`);
});

test('movement between historical months comes only from frozen ranks', () => {
  const june = freezeWinbaMonthly(buildWinbaSnapshotAsOf(JUNE, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' }), { period: '2026-06', at: '2026-09-02T10:00:00.000Z' });
  const july = freezeWinbaMonthly(buildWinbaSnapshotAsOf([...JUNE, ...JULY], { season: 2026, asOf: '2026-08-01T00:00:00.000Z' }), { period: '2026-07', at: '2026-09-02T10:00:00.000Z' });
  const m = winbaMovement(july, june);
  assert.equal(m.from_period, '2026-06');
  assert.equal(m.to_period, '2026-07');
  const other = m.moves.find((x) => x.player_id === '2');
  assert.equal(other.prior_rank, june.rows.find((r) => r.player_id === '2').rank);
  assert.ok(Number.isFinite(other.rank_delta));
  // No prior board at all means no movement, never an inferred one.
  assert.equal(winbaMovement(june, null), null);
});

test('a re-freeze refuses to change a published board', async () => {
  const monthly = new Map();
  const articles = new Map();
  let state = null;
  const io = {
    getMonthly: async (p) => monthly.get(p) || null,
    putMonthly: async (p, v) => { monthly.set(p, v); },
    getIndexState: async () => state,
    putIndexState: async (v) => { state = v; },
    getArticle: async (id) => articles.get(id) || null,
    putArticle: async (a) => { articles.set(a.id, a); }
  };
  const snap = buildWinbaSnapshotAsOf(JUNE, { season: 2026, asOf: '2026-07-01T00:00:00.000Z' });
  monthly.set('2026-06', freezeWinbaMonthly(snap, { period: '2026-06', at: '2026-09-02T10:00:00.000Z' }));
  const before = JSON.parse(JSON.stringify(monthly.get('2026-06')));

  // A snapshot whose ranks differ from the published board.
  const moved = { ...snap, rows: snap.rows.map((r) => ({ ...r, score: r.athlete_id === '2' ? 99 : r.score, rank: r.athlete_id === '2' ? 1 : 2 })) };
  const res = await runWinbaIndex({ period: '2026-06', snapshot: moved, at: '2026-11-03T10:00:00.000Z', force: true, refreeze: true, ...io , now: NOW });
  assert.equal(res.status, 'refreeze_refused');
  assert.deepEqual(monthly.get('2026-06'), before, 'the published board is untouched');
});
