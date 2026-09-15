// PBE WNBA runtime — the deterministic glue between the frozen model, the market, and the ledger.
//
// Pure functions (no I/O). Used by the wnba-ingest runner (writes) and wnba-api (reads/serves), and pinned by
// tests/pbe-runtime.test.mjs. Order of operations is fixed and one-directional:
//
//   rows (ESPN finals) -> model probability (pbe-wnba-model.js)      <- sportsbook prices are NEVER an input
//                      -> market comparison AFTER the probability exists (presentation + PBE Edge only)
//                      -> prediction document -> observation -> (at lock) official lock -> grade revisions
//
// PBE Edge = PBE probability of the picked side − de-vigged multi-book consensus probability of that side,
// in probability points. It is a disagreement measure, not a claimed value: on the 2026 evaluation the
// de-vigged market out-predicted the model (log loss 0.579 vs 0.591, docs/PBE_WNBA_MODEL_V1.md).

import { predictFromRows, reasons, orient, MODEL_ID, MANIFEST, FEATURE_SPEC, ARTIFACT } from './pbe-wnba-model.js';
import ELIGIBILITY from '../../model/pbe-wnba-model-v1/eligibility/eligibility_contract.json' with { type: 'json' };

export const RUNTIME_VERSION = 'pbe-wnba-runtime/1.1.0';
export const CONTRACT = 'game_winner_v1';

// Frozen eligibility contract (owner decision 2026-09-15). The runtime refuses to load if the contract is not
// FROZEN, is for different model bytes, or disagrees with the floor the frozen artifact and spec already enforce.
export { ELIGIBILITY };
export const NO_CALL_BELOW = ELIGIBILITY.rule.no_call_below;
(function assertEligibilityContract() {
  const bad = [];
  if (ELIGIBILITY.status !== 'FROZEN') bad.push(`status ${ELIGIBILITY.status}`);
  if (ELIGIBILITY.applies_to_model !== MODEL_ID) bad.push('model id');
  if (ELIGIBILITY.model_hashes.artifact_sha256 !== MANIFEST.files['artifact.json']) bad.push('artifact hash');
  if (ELIGIBILITY.model_hashes.feature_spec_sha256 !== MANIFEST.files['feature_spec.json']) bad.push('feature spec hash');
  if (ELIGIBILITY.model_hashes.validation_receipt_sha256 !== MANIFEST.files['validation_receipt.json']) bad.push('validation receipt hash');
  if (NO_CALL_BELOW !== ARTIFACT.params.min_current_games || NO_CALL_BELOW !== FEATURE_SPEC.eligibility.min_current_games) bad.push('floor differs from artifact/spec');
  if (bad.length) throw new Error(`eligibility contract mismatch: ${bad.join(', ')}`);
})();

/** Non-model metadata flags from the frozen contract (never change probability, pick, confidence or grading). */
export function eligibilityFlags(minCurrentGames) {
  return ELIGIBILITY.metadata_flags
    .filter((f) => f.flag === 'LIMITED_TEAM_HISTORY' ? minCurrentGames >= NO_CALL_BELOW && minCurrentGames <= 5 : false)
    .map((f) => f.flag);
}

// Lock policy v1: official call is frozen 15 minutes before scheduled tip. Provisional (pre-lock) scoring runs
// every 5 minutes, every minute inside the final 30 minutes. The policy id is stored with every lock.
export const LOCK_POLICY = Object.freeze({
  id: 'T-15m/v1',
  lock_minutes_before_tip: 15,
  scoring_window_hours: 48,
  near_tip_minutes: 30,
  cadence_minutes_far: 5,
  cadence_minutes_near: 1,
  observation_min_interval_minutes: 60,
  market_current_max_age_hours: 12,
  note: 'Initial policy. To be re-measured against observed WNBA availability-report timing before it is made permanent.'
});

// ------------------------------------------------------------------ hashing

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash of exactly what the model read: model identity, feature order and values. */
export async function featureHash(prediction) {
  return sha256Hex(canonicalJson({
    model_id: prediction.model_id,
    feature_spec_sha256: prediction.feature_spec_sha256,
    feature_order: prediction.feature_order,
    feature_vector: prediction.feature_vector,
    event_id: prediction.event_id
  }));
}

// ------------------------------------------------------------------ market (after the probability exists)

const decimalOf = (american) => {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
};
export function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

/**
 * Market comparison for one canonical prediction, from one normalized Odds API event (wnba-ingest shape:
 * moneyline.books[{book, home, away, updated}]). Requires ≥ 2 books with both sides priced.
 *   consensus_moneyline   median raw implied probability per side, shown as an American price (vig included)
 *   implied_probability   that median raw implied probability for the side (vig included)
 *   devig_probability     median of each book's own no-vig probability for the side
 *   pbe_edge              pick probability − devig probability of the pick side (null for NO_CALL / no market)
 */
export function marketComparison(prediction, event, capturedAt, now = Date.now()) {
  const empty = (reason) => ({ available: false, reason, captured_at: capturedAt || null, age_s: capturedAt ? Math.max(0, Math.round((now - Date.parse(capturedAt)) / 1000)) : null, book_count: 0, pbe_edge: null });
  if (!event) return empty('no_market_snapshot_for_game');
  if (String(event.home_team_id) !== String(prediction.home_team_id) || String(event.away_team_id) !== String(prediction.away_team_id)) {
    return empty('market_team_orientation_mismatch');
  }
  const rows = (event.moneyline?.books || [])
    .map((b) => {
      const dh = decimalOf(b.home); const da = decimalOf(b.away);
      if (!dh || !da) return null;
      const ih = 1 / dh; const ia = 1 / da;
      return { book: b.book, updated: b.updated || null, implied_home: ih, implied_away: ia, nv_home: ih / (ih + ia), hold: ih + ia - 1 };
    })
    .filter(Boolean);
  if (rows.length < 2) return empty('fewer_than_two_books');
  const impliedHome = median(rows.map((r) => r.implied_home));
  const impliedAway = median(rows.map((r) => r.implied_away));
  const devigHome = median(rows.map((r) => r.nv_home));
  const side = (s) => {
    const implied = s === 'home' ? impliedHome : impliedAway;
    const devig = s === 'home' ? devigHome : 1 - devigHome;
    // devig_probability_exact is the ledger value (PBE Edge is computed from it); the rounded fields are display.
    return { consensus_moneyline: probToAmerican(implied), implied_probability: r4(implied), devig_probability: r4(devig), devig_probability_exact: devig };
  };
  const age = capturedAt ? Math.max(0, Math.round((now - Date.parse(capturedAt)) / 1000)) : null;
  const pickSide = prediction.pick_team_id === prediction.home_team_id ? 'home' : prediction.pick_team_id === prediction.away_team_id ? 'away' : null;
  const pick = pickSide ? side(pickSide) : null;
  const edge = pickSide && Number.isFinite(prediction.pick_probability) ? prediction.pick_probability - (pickSide === 'home' ? devigHome : 1 - devigHome) : null;
  return {
    available: true,
    source: 'The Odds API',
    method: 'median across books; de-vig = each book normalized to 100% then median',
    captured_at: capturedAt,
    age_s: age,
    current: age !== null && age <= LOCK_POLICY.market_current_max_age_hours * 3600,
    book_count: rows.length,
    median_hold: r4(median(rows.map((r) => r.hold))),
    home: side('home'),
    away: side('away'),
    pick_side: pickSide,
    pick: pick,
    // Exact value is the ledger value; display rounding happens in the UI.
    pbe_edge: edge,
    pbe_edge_pts: edge === null ? null : Math.round(edge * 1000) / 10
  };
}

// ------------------------------------------------------------------ prediction document

/**
 * The provisional (pre-lock) prediction document for one game. Everything a Pro surface shows comes from this
 * object; team pages orient it, they never recompute it.
 */
export async function buildPredictionDoc({ game, leagueRows, asOf, marketEvent = null, marketCapturedAt = null, runId, mode, now = Date.now() }) {
  const prediction = predictFromRows({
    game: { event_id: game.event_id, season: game.season, season_type: game.season_type, start_utc: game.start_utc, neutral: Boolean(game.neutral), home_id: game.home_id, away_id: game.away_id },
    leagueRows,
    asOf
  });
  const hash = await featureHash(prediction);
  const reasoning = {
    home: reasons(prediction, { orientTeam: prediction.home_team_id }),
    away: reasons(prediction, { orientTeam: prediction.away_team_id })
  };
  const market = marketComparison(prediction, marketEvent, marketCapturedAt, now);
  const minGames = Math.min(prediction.teams.home.n_current, prediction.teams.away.n_current);
  const insufficient = prediction.call === 'NO_CALL' && minGames < NO_CALL_BELOW;
  return {
    schema: 'pbe-wnba-prediction/1',
    runtime: RUNTIME_VERSION,
    contract: CONTRACT,
    mode,
    run_id: runId,
    generated_at: new Date(now).toISOString(),
    as_of: asOf,
    game: {
      game_id: String(game.event_id),
      season: game.season,
      season_type: game.season_type,
      scheduled_tip_utc: game.start_utc,
      neutral_site: Boolean(game.neutral),
      home_team_id: prediction.home_team_id,
      away_team_id: prediction.away_team_id,
      home: game.home || null,
      away: game.away || null
    },
    model: { model_id: prediction.model_id, artifact_sha256: prediction.artifact_sha256, feature_spec_sha256: prediction.feature_spec_sha256, feature_schema: prediction.feature_schema },
    call: prediction.call,
    // Contract reason code for the history floor; the model's own detail string is kept alongside.
    no_call_reason: insufficient ? ELIGIBILITY.rule.reason : prediction.no_call_reason,
    no_call_detail: insufficient ? prediction.no_call_reason : null,
    p_home: prediction.p_home,
    p_away: prediction.p_away,
    pick_team_id: prediction.pick_team_id,
    pick_probability: prediction.pick_probability,
    confidence: prediction.confidence ? prediction.confidence.toLowerCase() : null,
    eligibility: { contract_id: ELIGIBILITY.contract_id, no_call_below: NO_CALL_BELOW, min_current_games: minGames },
    flags: eligibilityFlags(minGames),
    feature_order: prediction.feature_order,
    feature_vector: prediction.feature_vector,
    feature_hash: hash,
    contributions: prediction.contributions,
    reasoning,
    data_quality: {
      home_games_current: prediction.teams.home.n_current,
      away_games_current: prediction.teams.away.n_current,
      home_carryover: prediction.teams.home.carryover ?? null,
      away_carryover: prediction.teams.away.carryover ?? null,
      min_current_games: minGames,
      flags: eligibilityFlags(minGames),
      eligibility_contract: ELIGIBILITY.contract_id
    },
    teams_state: prediction.teams,
    market,
    lock_policy: LOCK_POLICY.id
  };
}

/** A stored prediction doc re-expressed in the shape orient() expects. */
function asPrediction(doc) {
  return {
    model_id: doc.model.model_id,
    event_id: doc.game.game_id,
    home_team_id: doc.game.home_team_id,
    away_team_id: doc.game.away_team_id,
    p_home: doc.p_home,
    p_away: doc.p_away,
    call: doc.call,
    no_call_reason: doc.no_call_reason,
    pick_team_id: doc.pick_team_id,
    pick_probability: doc.pick_probability,
    confidence: doc.confidence,
    contributions: doc.contributions,
    teams: doc.teams_state
  };
}

/**
 * Team-page view of the ONE canonical document: the same probability, pick, market and edge, oriented to
 * `teamId`. Reasons come from the reasoning frozen in the document (the same object a lock stores).
 */
export function orientDoc(doc, teamId) {
  const id = String(teamId);
  const isHome = id === doc.game.home_team_id;
  if (!isHome && id !== doc.game.away_team_id) throw new Error('orientDoc: team not in game');
  const o = orient(asPrediction(doc), id);
  const r = doc.reasoning[isHome ? 'home' : 'away'];
  const max = FEATURE_SPEC.reasoning;
  return {
    game_id: doc.game.game_id,
    team_id: id,
    opponent_id: o.opponent_id,
    is_home: isHome,
    team_probability: o.team_probability,
    opponent_probability: o.opponent_probability,
    call: doc.call,
    no_call_reason: doc.no_call_reason,
    pick_team_id: doc.pick_team_id,
    team_is_pick: doc.pick_team_id === id,
    pick_probability: doc.pick_probability,
    confidence: doc.confidence,
    supporting: r.supporting.slice(0, max.max_supporting),
    opposing: r.opposing.slice(0, max.max_opposing),
    adjustments: r.adjustments,
    market: doc.market,
    feature_hash: doc.feature_hash,
    model: doc.model,
    generated_at: doc.generated_at
  };
}

// ------------------------------------------------------------------ observation / lock rows (ledger shape)

/** Row for wnba_pbe_prediction_observations (matches the applied migration). */
export function observationRow(doc) {
  return {
    run_id: doc.run_id,
    game_id: doc.game.game_id,
    season: doc.game.season,
    season_type: doc.game.season_type,
    scheduled_tip_utc: doc.game.scheduled_tip_utc,
    home_team_id: doc.game.home_team_id,
    away_team_id: doc.game.away_team_id,
    neutral_site: doc.game.neutral_site,
    model_id: doc.model.model_id,
    generated_at: doc.generated_at,
    as_of: doc.as_of,
    call: doc.call,
    no_call_reason: doc.no_call_reason,
    p_home: doc.p_home,
    pick_team_id: doc.pick_team_id,
    pick_probability: doc.pick_probability,
    confidence: doc.confidence,
    feature_vector: { order: doc.feature_order, values: doc.feature_vector },
    feature_hash: doc.feature_hash,
    reasoning: doc.reasoning,
    data_quality: doc.data_quality,
    market: doc.market.available ? doc.market : null,
    market_devig_probability: doc.market.available && doc.market.pick ? doc.market.pick.devig_probability_exact : null,
    pbe_edge: doc.market.pbe_edge
  };
}

/** Does this pass deserve an auditable observation (vs. an unchanged re-score)? */
export function observationDue(doc, last, now = Date.now()) {
  if (!last) return { due: true, reason: 'first_observation' };
  if (last.feature_hash !== doc.feature_hash) return { due: true, reason: 'features_changed' };
  if ((last.market_captured_at || null) !== (doc.market.captured_at || null)) return { due: true, reason: 'market_changed' };
  if (now - Date.parse(last.generated_at) >= LOCK_POLICY.observation_min_interval_minutes * 60e3) return { due: true, reason: 'interval' };
  return { due: false, reason: 'unchanged' };
}

// ------------------------------------------------------------------ lock policy

export function lockAt(tipIso) {
  return new Date(Date.parse(tipIso) - LOCK_POLICY.lock_minutes_before_tip * 60e3).toISOString();
}

/** 'pre_lock' | 'lock_due' | 'tipped' for a scheduled tip at `now`. */
export function lockPhase(tipIso, now = Date.now()) {
  const tip = Date.parse(tipIso);
  if (!Number.isFinite(tip)) return 'unknown';
  if (now >= tip) return 'tipped';
  if (now >= Date.parse(lockAt(tipIso))) return 'lock_due';
  return 'pre_lock';
}

/** Scoring cadence: every minute close to tip, every 5 minutes otherwise. */
export function scoringDue(tipIso, minuteOfHour, now = Date.now()) {
  const minsToTip = (Date.parse(tipIso) - now) / 60e3;
  if (minsToTip <= 0 || minsToTip > LOCK_POLICY.scoring_window_hours * 60) return false;
  if (minsToTip <= LOCK_POLICY.near_tip_minutes) return true;
  return minuteOfHour % LOCK_POLICY.cadence_minutes_far === 0;
}

/** Frozen lock snapshot built from the latest pre-lock document. Never recomputed after this point. */
export function lockDoc(doc, { now = Date.now(), ledger }) {
  return {
    schema: 'pbe-wnba-lock/1',
    ledger, // 'shadow' (dry run, KV only, never public) | 'official' (Supabase, armed + owner-approved)
    contract: CONTRACT,
    lock_policy: LOCK_POLICY.id,
    locked_at: new Date(now).toISOString(),
    source_generated_at: doc.generated_at,
    game: doc.game,
    model: doc.model,
    call: doc.call,
    no_call_reason: doc.no_call_reason,
    flags: doc.flags || [],
    eligibility: doc.eligibility || null,
    p_home: doc.p_home,
    selected_team_id: doc.pick_team_id,
    selected_side: doc.pick_team_id ? (doc.pick_team_id === doc.game.home_team_id ? 'home' : 'away') : null,
    win_probability: doc.pick_probability,
    confidence: doc.confidence,
    feature_order: doc.feature_order,
    feature_vector: doc.feature_vector,
    feature_hash: doc.feature_hash,
    reasoning: doc.reasoning,
    market_at_lock: doc.market,
    pbe_edge_at_lock: doc.market.pbe_edge
  };
}

// ------------------------------------------------------------------ grading

/** Grade for a PICK lock from the final. Returns null for NO_CALL or a non-final game. */
export function gradeFromFinal(lock, final) {
  if (!lock || lock.call !== 'PICK') return null;
  if (!final || final.status !== 'STATUS_FINAL') {
    if (final && ['STATUS_CANCELED', 'STATUS_POSTPONED', 'STATUS_FORFEIT'].includes(final.status) && final.void_final) {
      return { result: 'void', home_score: null, away_score: null, winner_team_id: null, result_reference: final.reference };
    }
    return null;
  }
  const hs = Number(final.home_score); const as = Number(final.away_score);
  if (!Number.isInteger(hs) || !Number.isInteger(as) || hs === as) throw new Error('gradeFromFinal: invalid final score');
  const winner = hs > as ? lock.game.home_team_id : lock.game.away_team_id;
  return {
    result: winner === lock.selected_team_id ? 'win' : 'loss',
    home_score: hs,
    away_score: as,
    winner_team_id: winner,
    result_reference: final.reference
  };
}

// ------------------------------------------------------------------ track record

const MIN_CALIBRATION_SAMPLE = 50;

/**
 * Public aggregate over official locks + their CURRENT grade revision. Never includes game-level values.
 * `rows` = [{ win_probability, call, grade: { result } | null }]
 */
export function trackRecordAggregate(rows) {
  const picks = rows.filter((r) => r.call === 'PICK');
  const graded = picks.filter((r) => r.grade && r.grade.result !== 'void');
  const wins = graded.filter((r) => r.grade.result === 'win').length;
  const losses = graded.length - wins;
  const brier = graded.length ? graded.reduce((s, r) => s + (r.win_probability - (r.grade.result === 'win' ? 1 : 0)) ** 2, 0) / graded.length : null;
  let calibration = null;
  if (graded.length >= MIN_CALIBRATION_SAMPLE) {
    const bins = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.0001]];
    calibration = bins.map(([lo, hi]) => {
      const b = graded.filter((r) => r.win_probability >= lo && r.win_probability < hi);
      return { from: lo, to: Math.min(hi, 1), n: b.length, mean_probability: b.length ? r4(b.reduce((s, r) => s + r.win_probability, 0) / b.length) : null, hit_rate: b.length ? r4(b.filter((r) => r.grade.result === 'win').length / b.length) : null };
    });
  }
  return {
    official_locks: rows.length,
    picks: picks.length,
    no_calls: rows.length - picks.length,
    graded: graded.length,
    pending: picks.filter((r) => !r.grade).length,
    voided: picks.filter((r) => r.grade?.result === 'void').length,
    wins,
    losses,
    hit_rate: graded.length ? r4(wins / graded.length) : null,
    brier: brier === null ? null : r4(brier),
    calibration,
    calibration_note: graded.length >= MIN_CALIBRATION_SAMPLE ? null : `Calibration is shown from ${MIN_CALIBRATION_SAMPLE} graded picks; ${graded.length} so far.`,
    sample_note: graded.length > 0 && graded.length < 30 ? 'Small sample: early results say little about the model.' : null
  };
}

export { MODEL_ID, MANIFEST };
