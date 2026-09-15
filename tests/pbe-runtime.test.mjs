// PBE WNBA runtime — market comparison, canonical document, orientation, ledger-row invariants, lock policy,
// grading and the public aggregate. Rows are the committed 2025–2026 fixture; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  canonicalJson, featureHash, marketComparison, buildPredictionDoc, orientDoc, observationRow, observationDue,
  lockAt, lockPhase, scoringDue, lockDoc, gradeFromFinal, trackRecordAggregate, probToAmerican, LOCK_POLICY
} from '../workers/shared/pbe-runtime.js';

const FX = new URL('./fixtures/pbe-wnba-model/', import.meta.url);
const ROWS = zlib.gunzipSync(fs.readFileSync(new URL('rows-2025-2026.jsonl.gz', FX))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// A real 2026 regular-season game from the fixture (home 3, away 18), predicted 15 minutes before tip.
const GAME = { event_id: '401857189', season: 2026, season_type: 2, start_utc: '2026-08-31T00:30:00.000Z', neutral: false, home_id: '3', away_id: '18' };
const AS_OF = new Date(Date.parse(GAME.start_utc) - 15 * 60e3).toISOString();
const NOW = Date.parse(AS_OF);
const EVENT = {
  home_team_id: '3', away_team_id: '18',
  moneyline: { books: [
    { book: 'a', home: -150, away: 130 },
    { book: 'b', home: -145, away: 122 },
    { book: 'c', home: -160, away: 135 }
  ] }
};
const CAPTURED = new Date(NOW - 2 * 3600e3).toISOString();

const doc = (extra = {}) => buildPredictionDoc({ game: GAME, leagueRows: ROWS, asOf: AS_OF, runId: 'test', mode: 'dry_run', now: NOW, ...extra });

test('canonical JSON is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test('the market never changes the probability, the call or the feature hash', async () => {
  const bare = await doc();
  const priced = await doc({ marketEvent: EVENT, marketCapturedAt: CAPTURED });
  assert.equal(priced.p_home, bare.p_home);
  assert.equal(priced.call, bare.call);
  assert.equal(priced.pick_team_id, bare.pick_team_id);
  assert.equal(priced.feature_hash, bare.feature_hash);
  assert.equal(bare.market.available, false);
  assert.equal(bare.market.pbe_edge, null);
});

test('feature hash changes when any feature value changes', async () => {
  const d = await doc();
  const h1 = await featureHash({ ...d, model_id: d.model.model_id, feature_spec_sha256: d.model.feature_spec_sha256, event_id: d.game.game_id });
  const v = [...d.feature_vector]; v[0] += 1e-9;
  const h2 = await featureHash({ ...d, model_id: d.model.model_id, feature_spec_sha256: d.model.feature_spec_sha256, event_id: d.game.game_id, feature_vector: v });
  assert.notEqual(h1, h2);
  assert.match(d.feature_hash, /^[0-9a-f]{64}$/);
});

test('market comparison: medians, de-vig and PBE Edge are exact and oriented to the pick', () => {
  const pred = { home_team_id: '3', away_team_id: '18', pick_team_id: '3', pick_probability: 0.64 };
  const m = marketComparison(pred, EVENT, CAPTURED, NOW);
  const books = EVENT.moneyline.books.map((b) => {
    const ih = 1 / (1 + 100 / Math.abs(b.home)); const ia = 1 / (1 + b.away / 100);
    return { ih, ia, nv: ih / (ih + ia) };
  });
  const med = (xs) => xs.sort((a, b) => a - b)[1];
  assert.equal(m.available, true);
  assert.equal(m.book_count, 3);
  assert.equal(m.pick_side, 'home');
  assert.equal(m.home.devig_probability_exact, med(books.map((b) => b.nv)));
  assert.equal(m.home.implied_probability, Math.round(med(books.map((b) => b.ih)) * 1e4) / 1e4);
  assert.equal(m.home.consensus_moneyline, probToAmerican(med(books.map((b) => b.ih))));
  assert.equal(m.pbe_edge, 0.64 - m.home.devig_probability_exact);
  assert.ok(Math.abs(m.home.devig_probability_exact + m.away.devig_probability_exact - 1) < 1e-12);
  assert.equal(m.current, true);
});

test('market comparison fails closed: <2 books, orientation mismatch, NO_CALL has no edge', () => {
  const pred = { home_team_id: '3', away_team_id: '18', pick_team_id: '3', pick_probability: 0.6 };
  assert.equal(marketComparison(pred, { ...EVENT, moneyline: { books: [EVENT.moneyline.books[0]] } }, CAPTURED, NOW).available, false);
  assert.equal(marketComparison(pred, { ...EVENT, home_team_id: '18', away_team_id: '3' }, CAPTURED, NOW).reason, 'market_team_orientation_mismatch');
  const nc = marketComparison({ ...pred, pick_team_id: null, pick_probability: null }, EVENT, CAPTURED, NOW);
  assert.equal(nc.available, true);
  assert.equal(nc.pbe_edge, null);
  assert.equal(nc.pick, null);
});

test('both team pages resolve to the ONE document, mirrored', async () => {
  const d = await doc({ marketEvent: EVENT, marketCapturedAt: CAPTURED });
  const h = orientDoc(d, '3');
  const a = orientDoc(d, '18');
  assert.equal(h.game_id, a.game_id);
  assert.equal(h.feature_hash, a.feature_hash);
  assert.equal(h.team_probability, a.opponent_probability);
  assert.ok(Math.abs(h.team_probability + a.team_probability - 1) < 1e-12);
  assert.equal(h.pick_team_id, a.pick_team_id);
  assert.equal(h.team_is_pick, !a.team_is_pick);
  assert.deepEqual(h.market, a.market);
  // Every reason for the home team is the same contribution, negated, against the away team.
  for (const r of d.reasoning.home.supporting) {
    const m = d.reasoning.away.opposing.find((o) => o.feature === r.feature);
    assert.ok(m, `mirror of ${r.feature}`);
    assert.ok(Math.abs(m.contribution_logit + r.contribution_logit) < 1e-12);
  }
  assert.equal(d.reasoning.home.supporting.length, d.reasoning.away.opposing.length);
  assert.throws(() => orientDoc(d, '99'), /team not in game/);
});

test('observation row satisfies the ledger constraints (call rules, hash format, exact edge)', async () => {
  const d = await doc({ marketEvent: EVENT, marketCapturedAt: CAPTURED });
  const o = observationRow(d);
  assert.match(o.feature_hash, /^[0-9a-f]{64}$/);
  assert.ok(o.p_home > 0 && o.p_home < 1);
  assert.ok(Date.parse(o.as_of) <= Date.parse(o.scheduled_tip_utc));
  if (o.call === 'PICK') {
    assert.ok([o.home_team_id, o.away_team_id].includes(o.pick_team_id));
    assert.ok(o.pick_probability >= 0.5 && ['high', 'medium', 'low'].includes(o.confidence));
    assert.equal(o.no_call_reason, null);
    assert.ok(Math.abs(o.pbe_edge - (o.pick_probability - o.market_devig_probability)) < 1e-9);
  } else {
    assert.equal(o.pick_team_id, null);
    assert.ok(o.no_call_reason);
  }
});

test('observation cadence: first, changed features, changed market, hourly; otherwise unchanged', async () => {
  const d = await doc({ marketEvent: EVENT, marketCapturedAt: CAPTURED });
  assert.equal(observationDue(d, null, NOW).due, true);
  const last = { feature_hash: d.feature_hash, market_captured_at: CAPTURED, generated_at: new Date(NOW - 10 * 60e3).toISOString() };
  assert.deepEqual(observationDue(d, last, NOW), { due: false, reason: 'unchanged' });
  assert.equal(observationDue(d, { ...last, feature_hash: 'x' }, NOW).reason, 'features_changed');
  assert.equal(observationDue(d, { ...last, market_captured_at: 'older' }, NOW).reason, 'market_changed');
  assert.equal(observationDue(d, { ...last, generated_at: new Date(NOW - 61 * 60e3).toISOString() }, NOW).reason, 'interval');
});

test('lock policy T-15m: phases and scoring cadence', () => {
  const tip = '2026-09-17T23:30:00.000Z';
  const t = Date.parse(tip);
  assert.equal(lockAt(tip), '2026-09-17T23:15:00.000Z');
  assert.equal(lockPhase(tip, t - 16 * 60e3), 'pre_lock');
  assert.equal(lockPhase(tip, t - 15 * 60e3), 'lock_due');
  assert.equal(lockPhase(tip, t), 'tipped');
  assert.equal(scoringDue(tip, 7, t - 20 * 60e3), true);   // inside 30 min: every minute
  assert.equal(scoringDue(tip, 7, t - 5 * 3600e3), false); // far: only on 5-minute marks
  assert.equal(scoringDue(tip, 10, t - 5 * 3600e3), true);
  assert.equal(scoringDue(tip, 10, t - 49 * 3600e3), false);
  assert.equal(LOCK_POLICY.id, 'T-15m/v1');
});

test('lock snapshot freezes exactly the pre-lock document values', async () => {
  const d = await doc({ marketEvent: EVENT, marketCapturedAt: CAPTURED });
  const l = lockDoc(d, { now: NOW, ledger: 'shadow' });
  assert.equal(l.feature_hash, d.feature_hash);
  assert.equal(l.p_home, d.p_home);
  assert.equal(l.win_probability, d.pick_probability);
  assert.deepEqual(l.reasoning, d.reasoning);
  assert.deepEqual(l.market_at_lock, d.market);
  assert.equal(l.pbe_edge_at_lock, d.market.pbe_edge);
  assert.equal(l.ledger, 'shadow');
});

test('grading is deterministic from the final score; ties and non-finals never grade', () => {
  const lock = { call: 'PICK', selected_team_id: '3', game: { home_team_id: '3', away_team_id: '18' } };
  const ref = { provider: 'espn', event: '401857189' };
  assert.equal(gradeFromFinal(lock, { status: 'STATUS_FINAL', home_score: 80, away_score: 70, reference: ref }).result, 'win');
  const loss = gradeFromFinal(lock, { status: 'STATUS_FINAL', home_score: 70, away_score: 80, reference: ref });
  assert.deepEqual([loss.result, loss.winner_team_id], ['loss', '18']);
  assert.equal(gradeFromFinal(lock, { status: 'STATUS_IN_PROGRESS', home_score: 10, away_score: 8 }), null);
  assert.equal(gradeFromFinal({ ...lock, call: 'NO_CALL' }, { status: 'STATUS_FINAL', home_score: 1, away_score: 0 }), null);
  assert.throws(() => gradeFromFinal(lock, { status: 'STATUS_FINAL', home_score: 70, away_score: 70 }), /invalid final/);
});

test('track record aggregate: counts, Brier, no calibration under 50 graded, small-sample note', () => {
  const rows = [
    { call: 'PICK', win_probability: 0.7, grade: { result: 'win' } },
    { call: 'PICK', win_probability: 0.6, grade: { result: 'loss' } },
    { call: 'PICK', win_probability: 0.55, grade: null },
    { call: 'NO_CALL', win_probability: null, grade: null }
  ];
  const a = trackRecordAggregate(rows);
  assert.deepEqual([a.official_locks, a.picks, a.no_calls, a.graded, a.pending, a.wins, a.losses], [4, 3, 1, 2, 1, 1, 1]);
  assert.equal(a.hit_rate, 0.5);
  assert.equal(a.brier, Math.round((((0.7 - 1) ** 2 + 0.6 ** 2) / 2) * 1e4) / 1e4);
  assert.equal(a.calibration, null);
  assert.ok(a.sample_note);
  const empty = trackRecordAggregate([]);
  assert.deepEqual([empty.wins, empty.losses, empty.hit_rate, empty.brier], [0, 0, null, null]);
});
