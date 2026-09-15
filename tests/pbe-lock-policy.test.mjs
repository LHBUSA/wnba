// Lock-policy review analysis: evidence completeness, material changes per window, flips and deltas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGame, summarize } from '../scripts/pbe/lock-policy-analysis.mjs';

const P = (status, upd = 'u1') => [{ key: '1', athlete_id: '1', team_id: '20', status, source_updated_at: upd }];
const pred = (p_home, pick = '20', edge = 0.05) => ({ call: 'PICK', p_home, pick_team_id: pick, pick_probability: Math.max(p_home, 1 - p_home), pbe_edge: edge, generated_at: 'g', flags: [] });
const cp = (minutes_before_tip, players, prediction, feed_age_s = 60) => ({ recorded_at: 'r', minutes_before_tip, feed_captured_at: 'f', feed_age_s, players, prediction });
const game = (id, checkpoints) => ({ game: { game_id: id, scheduled_tip_utc: '2026-09-17T23:30:00Z' }, checkpoints });

test('clean game: complete evidence, no material change, no flip', () => {
  const r = analyzeGame(game('A', { 60: cp(60, P('Day-To-Day'), pred(0.62)), 30: cp(30, P('Day-To-Day', 'u2'), pred(0.62)), 15: cp(15, P('Day-To-Day', 'u2'), pred(0.621)), 0: cp(0, P('Day-To-Day', 'u2'), null) }), { completed: true });
  assert.equal(r.evidence_complete, true);
  assert.equal(r.windows['T-60→T-30'].material_change, false);
  assert.equal(r.windows['T-60→T-30'].source_updates, 1);
  assert.equal(r.windows['T-30→T-15'].probability_delta_pts, 0.1);
  assert.equal(r.windows['T-15→T-0'].prediction_flip, null, 'no prediction recorded at T-0');
  assert.deepEqual(r.material_change_after, { 'T-60': false, 'T-30': false, 'T-15': false });
});

test('late poll and stale feed make evidence incomplete; status change after T-15 is material', () => {
  const late = analyzeGame(game('B', { 60: cp(52, P('Questionable'), pred(0.55)), 30: cp(30, P('Questionable'), pred(0.55)), 15: cp(15, P('Questionable'), pred(0.55), 900), 0: cp(0, P('Out'), null) }), { completed: true });
  assert.equal(late.evidence_complete, false);
  assert.deepEqual(late.problems, ['T-60 recorded 8 min late', 'T-15 feed age 900s']);
  assert.equal(late.material_change_after['T-15'], true);
  const flip = analyzeGame(game('C', { 60: cp(60, P('Questionable'), pred(0.52, '20')), 30: cp(30, P('Out'), pred(0.47, '18')), 15: cp(15, P('Out'), pred(0.47, '18')), 0: cp(0, P('Out'), null) }), { completed: true });
  assert.equal(flip.windows['T-60→T-30'].material_change, true);
  assert.equal(flip.windows['T-60→T-30'].prediction_flip, true);
  assert.equal(flip.windows['T-60→T-30'].probability_delta_pts, 5);
  const s = summarize([late, flip, analyzeGame(game('D', {}), { completed: false })]);
  assert.equal(s.completed_games, 2);
  assert.equal(s.reviewed_games, 1);
  assert.equal(s.operational_completeness_pct, 50);
  assert.equal(s.windows['T-60→T-30'].prediction_flip_rate_pct, 100);
  assert.equal(s.material_change_after_pct['T-60'], 100);
  assert.equal(s.review_ready, false);
});
