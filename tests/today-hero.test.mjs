import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownLabel, resolveTodayHero } from '../src/lib/today-hero.js';

const g = (id, state, start, extra = {}) => ({
  game_id: id,
  start_utc: start,
  status: { state, name: state === 'in' ? 'STATUS_IN_PROGRESS' : state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED', ...(extra.status || {}) },
  away: { abbr: `${id}A`, score: extra.awayScore ?? null },
  home: { abbr: `${id}H`, score: extra.homeScore ?? null },
  market: extra.market || null
});
const data = (kind, games) => ({ slate: { kind, games }, availability: { out: 4 } });

test('live games take hero priority and expose multiple live selectors', () => {
  const h = resolveTodayHero(data('TODAY', [
    g('1', 'in', '2026-09-16T23:00:00Z'),
    g('2', 'in', '2026-09-16T23:30:00Z'),
    g('3', 'pre', '2026-09-17T01:00:00Z')
  ]));
  assert.equal(h.mode, 'LIVE');
  assert.equal(h.primary.game_id, '1');
  assert.deepEqual(h.selectors.map((x) => x.game_id), ['1', '2']);
});

test('pregame mode uses the next scheduled game', () => {
  const h = resolveTodayHero(data('TODAY', [g('2', 'pre', '2026-09-17T01:00:00Z'), g('1', 'pre', '2026-09-16T23:00:00Z')]));
  assert.equal(h.mode, 'PREGAME');
  assert.equal(h.primary.game_id, '1');
});

test('between-games mode keeps the next tip primary and latest final available', () => {
  const h = resolveTodayHero(data('TODAY', [g('1', 'post', '2026-09-16T22:00:00Z'), g('2', 'pre', '2026-09-17T01:00:00Z')]));
  assert.equal(h.mode, 'BETWEEN');
  assert.equal(h.primary.game_id, '2');
  assert.equal(h.previous.game_id, '1');
});

test('all-final slate becomes final state', () => {
  const h = resolveTodayHero(data('TODAY', [g('1', 'post', '2026-09-16T22:00:00Z'), g('2', 'post', '2026-09-17T00:00:00Z')]));
  assert.equal(h.mode, 'FINAL');
  assert.equal(h.primary.game_id, '2');
  assert.equal(h.totals.final, 2);
});

test('next-slate data becomes off-day desk instead of no-games copy', () => {
  const h = resolveTodayHero(data('NEXT', [g('1', 'pre', '2026-09-17T23:30:00Z')]));
  assert.equal(h.mode, 'OFFDAY');
  assert.equal(h.primary.game_id, '1');
});

test('delayed-only slate gets an explicit delayed state', () => {
  const h = resolveTodayHero(data('TODAY', [g('1', 'pre', '2026-09-16T23:00:00Z', { status: { name: 'STATUS_DELAYED', short_detail: 'Delayed' } })]));
  assert.equal(h.mode, 'DELAYED');
  assert.equal(h.totals.disrupted, 1);
});

test('countdown labels stay compact and deterministic', () => {
  const now = Date.parse('2026-09-16T20:00:00Z');
  assert.equal(countdownLabel('2026-09-16T20:42:00Z', now), '42M');
  assert.equal(countdownLabel('2026-09-16T22:15:00Z', now), '2H 15M');
  assert.equal(countdownLabel('2026-09-17T22:00:00Z', now), '1D 2H');
});
