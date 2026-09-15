// PBE WNBA model v1 — artifact integrity, JS/Python parity, feature reproducibility,
// leakage, orientation symmetry and reasoning provenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildFeatures, teamGameRowFromSummary, etDateOf } from '../workers/shared/pbe-wnba-features.js';
import { ARTIFACT, FEATURE_SPEC, MANIFEST, MODEL_ID, predict, contributions, predictGame, predictFromRows, reasons, orient, confidenceTier } from '../workers/shared/pbe-wnba-model.js';
import { verifyArtifact } from '../scripts/model/verify-artifact.mjs';

const FX = new URL('./fixtures/pbe-wnba-model/', import.meta.url);
const parity = JSON.parse(fs.readFileSync(new URL('parity.json', FX), 'utf8'));
const rows = zlib.gunzipSync(fs.readFileSync(new URL('rows-2025-2026.jsonl.gz', FX))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const games = new Map(JSON.parse(fs.readFileSync(new URL('games-2026.json', FX), 'utf8')).map((g) => [g.event_id, g]));
const asOfFor = (g) => new Date(Date.parse(g.start_utc) - 15 * 60000).toISOString();
const sigmoidInv = (p) => Math.log(p / (1 - p));

test('artifact, feature spec and receipt match the manifest hashes', async () => {
  const r = await verifyArtifact();
  assert.equal(r.ok, true, JSON.stringify(r, null, 1));
  assert.equal(MODEL_ID, 'pbe-wnba-model-v1');
  assert.equal(parity.artifact_sha256, MANIFEST.files['artifact.json']);
});

test('JS probabilities equal the Python fit on every parity game (1e-9)', () => {
  assert.ok(parity.games.length >= 50);
  for (const g of parity.games) {
    const p = predict(g.vector);
    assert.ok(Math.abs(p - g.p_home) < 1e-9, `${g.event_id}: js ${p} py ${g.p_home}`);
  }
});

test('live feature build reproduces the training vectors from raw rows', () => {
  for (const pg of parity.games) {
    const g = games.get(pg.event_id);
    const pred = predictFromRows({ game: g, leagueRows: rows, asOf: asOfFor(g) });
    pred.feature_vector.forEach((v, i) => assert.ok(Math.abs(v - pg.vector[i]) < 1e-9, `${pg.event_id} ${ARTIFACT.feature_order[i]}: ${v} vs ${pg.vector[i]}`));
    assert.ok(Math.abs(pred.p_home - pg.p_home) < 1e-9);
  }
});

test('row normalizer: the committed ESPN final yields the same rows the dataset holds', () => {
  const summary = JSON.parse(fs.readFileSync(new URL('./fixtures/espn-summary-401857189.json', import.meta.url), 'utf8'));
  const [away, home] = teamGameRowFromSummary(summary);
  assert.equal(home.pts, 97); assert.equal(away.pts, 71); assert.equal(home.won, true);
  const stored = rows.filter((r) => r.event_id === '401857189');
  assert.equal(stored.length, 2);
  for (const r of [away, home]) {
    const s = stored.find((x) => x.team_id === r.team_id);
    for (const k of ['pts', 'opp_pts', 'poss', 'minutes_game', 'et_date']) assert.equal(r[k], s[k], k);
    assert.deepEqual(r.own, s.own);
  }
});

function corrupt(r) {
  const c = structuredClone(r);
  c.pts += 50; c.won = !c.won; c.poss *= 1.5;
  for (const k of Object.keys(c.own)) c.own[k] = c.own[k] * 2 + 3;
  c.players = [{ id: 'leak', min: 40, starter: true }];
  return c;
}

test('leakage: the target game and everything on/after its ET date are invisible', () => {
  for (const pg of parity.games.slice(0, 15)) {
    const g = games.get(pg.event_id);
    const base = predictFromRows({ game: g, leagueRows: rows, asOf: asOfFor(g) });
    const gd = etDateOf(g.start_utc);
    const mutated = rows.map((r) => (r.et_date >= gd ? corrupt(r) : r));
    const sameDayEarly = new Date(Date.parse(g.start_utc) - 2 * 3600000).toISOString();
    const injected = [g.home_id, g.away_id].map((t, i) => ({ ...corrupt(rows.find((r) => r.team_id === t)), event_id: `same-day-${i}`, start_utc: sameDayEarly, et_date: etDateOf(sameDayEarly), season: g.season }));
    const after = predictFromRows({ game: g, leagueRows: [...mutated, ...(etDateOf(sameDayEarly) === gd ? injected : [])], asOf: asOfFor(g) });
    assert.deepEqual(after.feature_vector, base.feature_vector, pg.event_id);
    assert.equal(after.p_home, base.p_home);
  }
});

test('leakage: a prediction instant after tip is refused', () => {
  const g = games.get(parity.games[0].event_id);
  assert.throws(() => predictFromRows({ game: g, leagueRows: rows, asOf: new Date(Date.parse(g.start_utc) + 1000).toISOString() }), /asOf must be at or before tip/);
});

test('no sportsbook or injury input exists in the feature or model code', () => {
  for (const f of ['../workers/shared/pbe-wnba-features.js', '../workers/shared/pbe-wnba-model.js']) {
    const code = fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const t of ['odds', 'moneyline', 'moneyLine', 'pickcenter', 'price', 'injur']) assert.ok(!code.includes(t), `${f} contains ${t}`);
  }
});

test('contributions sum to the logit; reasons are exactly those contributions', () => {
  const g = games.get(parity.games.at(-1).event_id);
  const pred = predictFromRows({ game: g, leagueRows: rows, asOf: asOfFor(g) });
  const sum = pred.contributions.reduce((s, c) => s + c.contribution, 0);
  assert.ok(Math.abs(sum - sigmoidInv(pred.p_home)) < 1e-9);
  const r = reasons(pred, { orientTeam: pred.home_team_id });
  for (const x of [...r.supporting, ...r.opposing, ...r.adjustments]) {
    const c = pred.contributions.find((k) => k.feature === x.feature);
    assert.equal(x.contribution_logit, c.contribution);
    assert.ok(Math.abs(x.impact_pts) >= FEATURE_SPEC.reasoning.min_abs_impact_pts);
    assert.ok(typeof x.text === 'string' && x.text.length > 3);
  }
});

test('orientation: both team pages resolve to the same prediction, mirrored', () => {
  for (const pg of parity.games.slice(-20)) {
    const g = games.get(pg.event_id);
    const pred = predictFromRows({ game: g, leagueRows: rows, asOf: asOfFor(g) });
    const h = orient(pred, g.home_id);
    const a = orient(pred, g.away_id);
    assert.ok(Math.abs(h.team_probability + a.team_probability - 1) < 1e-15);
    assert.equal(h.pick_team_id, a.pick_team_id);
    assert.equal(h.confidence, a.confidence);
    assert.equal(h.team_is_pick !== a.team_is_pick || pred.call === 'NO_CALL', true);
    const rh = reasons(pred, { orientTeam: g.home_id });
    const ra = reasons(pred, { orientTeam: g.away_id });
    assert.deepEqual(rh.supporting.map((x) => x.feature), ra.opposing.map((x) => x.feature));
    assert.deepEqual(rh.opposing.map((x) => x.feature), ra.supporting.map((x) => x.feature));
    rh.supporting.forEach((x, i) => assert.equal(x.contribution_logit, -ra.opposing[i].contribution_logit));
    assert.deepEqual(rh.adjustments.map((x) => x.feature), ra.adjustments.map((x) => x.feature));
  }
});

test('a factor whose learned sign contradicts its meaning is never shown as a reason', () => {
  for (const pg of parity.games) {
    const g = games.get(pg.event_id);
    const pred = predictFromRows({ game: g, leagueRows: rows, asOf: asOfFor(g) });
    for (const team of [g.home_id, g.away_id]) {
      const r = reasons(pred, { orientTeam: team });
      for (const x of [...r.supporting, ...r.opposing]) {
        const coef = pred.contributions.find((c) => c.feature === x.feature).coefficient;
        const expected = FEATURE_SPEC.reasoning.expected_sign[x.feature];
        assert.ok(expected === 0 || Math.sign(coef) === expected, `${x.feature} shown with contradictory sign`);
      }
    }
  }
});

test('eligibility: a team with fewer than 3 current games gets NO CALL', () => {
  const firsts = [...games.values()].sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  const g = firsts[0];
  const pred = predictFromRows({ game: g, leagueRows: rows, asOf: asOfFor(g) });
  assert.equal(pred.call, 'NO_CALL');
  assert.match(pred.no_call_reason, /under_3_current_games/);
  assert.equal(pred.pick_team_id, null);
  assert.equal(pred.pick_probability, null);
});

test('confidence tiers follow the frozen policy', () => {
  assert.equal(confidenceTier(0.75, 20), 'High');
  assert.equal(confidenceTier(0.75, 5), 'Medium');
  assert.equal(confidenceTier(0.65, 20), 'Medium');
  assert.equal(confidenceTier(0.65, 5), 'Low');
  assert.equal(confidenceTier(0.55, 30), 'Low');
});

test('a coin-flip prediction is a NO CALL, never a pick', () => {
  const g = games.get(parity.games.at(-1).event_id);
  const f = buildFeatures({ game: g, homeRows: rows.filter((r) => r.team_id === g.home_id), awayRows: rows.filter((r) => r.team_id === g.away_id), leagueRows: rows, asOf: asOfFor(g), params: ARTIFACT.params });
  for (const k of Object.keys(f.all)) f.all[k] = 0;
  // home_court 0 and every other feature at 0 -> probability near 0.5 only if means are ~0; force it.
  const pred = predictGame({ ...f, all: Object.fromEntries(ARTIFACT.feature_order.map((n, i) => [n, n === 'home_court' ? 0 : ARTIFACT.standardization.mean[ARTIFACT.standardized_features.indexOf(n)]])) });
  assert.ok(Math.abs(pred.p_home - 0.5) < 1e-12);
  assert.equal(pred.call, 'NO_CALL');
  assert.equal(pred.no_call_reason, 'model_near_coin_flip');
});
