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

// ------------------------------------------------------------------ frozen eligibility contract
import { createHash } from 'node:crypto';
import { ELIGIBILITY, NO_CALL_BELOW, eligibilityFlags } from '../workers/shared/pbe-runtime.js';
import { ARTIFACT, FEATURE_SPEC, MANIFEST, predictFromRows } from '../workers/shared/pbe-wnba-model.js';

const ELIG_DIR = new URL('../model/pbe-wnba-model-v1/eligibility/', import.meta.url);
const fileSha = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, ELIG_DIR))).digest('hex');

test('eligibility contract is FROZEN, bound to the model bytes, the pre-registration and the study receipt', () => {
  const receipt = JSON.parse(fs.readFileSync(new URL('eligibility_study_receipt.json', ELIG_DIR), 'utf8'));
  assert.equal(ELIGIBILITY.status, 'FROZEN');
  assert.equal(ELIGIBILITY.rule.reason, 'INSUFFICIENT_TEAM_HISTORY');
  assert.equal(NO_CALL_BELOW, 3);
  assert.equal(ELIGIBILITY.evidence.receipt_sha256, fileSha('eligibility_study_receipt.json'));
  assert.equal(ELIGIBILITY.derivation.preregistration_sha256, fileSha('preregistration.json'));
  assert.equal(receipt.preregistration_sha256, fileSha('preregistration.json'), 'receipt was produced under this exact pre-registration');
  assert.equal(receipt.chosen_K, 3);
  assert.equal(receipt.result, 'PASS');
  // mechanical: smallest K in 0..13 passing the pre-registered criteria on validation seasons
  const firstPass = receipt.criteria_by_K_validation.find((c) => c.pass).K;
  assert.equal(firstPass, 3);
  assert.deepEqual(receipt.criteria_by_K_validation.slice(0, 3).map((c) => c.pass), [false, false, false]);
  assert.equal(Math.max(firstPass, 3), ELIGIBILITY.rule.no_call_below);
  assert.equal(NO_CALL_BELOW, ARTIFACT.params.min_current_games);
  assert.equal(NO_CALL_BELOW, FEATURE_SPEC.eligibility.min_current_games);
  for (const [k, f] of [['artifact_sha256', 'artifact.json'], ['feature_spec_sha256', 'feature_spec.json'], ['validation_receipt_sha256', 'validation_receipt.json']]) assert.equal(ELIGIBILITY.model_hashes[k], MANIFEST.files[f]);
  assert.equal(receipt.holdout_confirmation.holdout_judged_same_way.c_entry_slice.pass, false, 'holdout caveat preserved, not hidden');
  assert.match(ELIGIBILITY.holdout_caveats.judged_the_same_way_for_K3, /FAIL on \(c\)/);
});

test('LIMITED_TEAM_HISTORY is metadata only; below the floor the reason is INSUFFICIENT_TEAM_HISTORY', async () => {
  assert.deepEqual([2, 3, 4, 5, 6].map((m) => eligibilityFlags(m)), [[], ['LIMITED_TEAM_HISTORY'], ['LIMITED_TEAM_HISTORY'], ['LIMITED_TEAM_HISTORY'], []]);
  const games = JSON.parse(fs.readFileSync(new URL('games-2026.json', FX), 'utf8')).sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  let limited = null; let insufficient = null; let deep = null;
  for (const g of games) {
    const asOf = new Date(Date.parse(g.start_utc) - 15 * 60e3).toISOString();
    const d = await buildPredictionDoc({ game: g, leagueRows: ROWS, asOf, runId: 't', mode: 'dry_run', now: Date.parse(asOf) });
    const m = d.eligibility.min_current_games;
    if (!insufficient && m < 3) insufficient = { d, g, asOf };
    if (!limited && m >= 3 && m <= 5) limited = { d, g, asOf };
    if (!deep && m >= 6) deep = { d, g, asOf };
    if (limited && insufficient && deep) break;
  }
  assert.ok(limited && insufficient && deep, 'fixture covers all three history states');
  for (const s of [limited, insufficient, deep]) {
    const raw = predictFromRows({ game: { ...s.g, event_id: s.g.event_id }, leagueRows: ROWS, asOf: s.asOf });
    assert.equal(s.d.p_home, raw.p_home, 'probability unchanged');
    assert.equal(s.d.call, raw.call);
    assert.equal(s.d.pick_team_id, raw.pick_team_id, 'pick unchanged');
    assert.equal(s.d.confidence, raw.confidence ? raw.confidence.toLowerCase() : null, 'frozen confidence tier unchanged');
  }
  assert.deepEqual(limited.d.flags, ['LIMITED_TEAM_HISTORY']);
  assert.deepEqual(deep.d.flags, []);
  assert.equal(insufficient.d.call, 'NO_CALL');
  assert.equal(insufficient.d.no_call_reason, 'INSUFFICIENT_TEAM_HISTORY');
  assert.match(insufficient.d.no_call_detail, /under_3_current_games/);
  const lock = lockDoc(limited.d, { ledger: 'shadow' });
  assert.deepEqual(lock.flags, ['LIMITED_TEAM_HISTORY'], 'flag travels with the frozen lock');
});

test('promotion generator accepts the frozen contract (emits SQL only; nothing applied)', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['scripts/model/promotion-sql.mjs', '--approved-by', 'TEST ONLY - not approved'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /insert into public\.wnba_pbe_model_promotions/);
  assert.match(r.stdout, new RegExp(fileSha('eligibility_contract.json')));
  assert.match(r.stdout, /pbe-wnba-eligibility\/1/);
});
