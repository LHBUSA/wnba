// PBE WNBA model v1 — inference, contributions, reasoning, confidence, eligibility.
//
// Deterministic. The probability comes from the frozen artifact; every reason is
// a real per-feature contribution to that probability, rendered from the same
// as-of values the model read. No text is written by a language model and no
// sportsbook price is read here — market comparison happens after, elsewhere.
//
//   const pred = predictFromRows({ game, leagueRows, asOf });
//   const view = orient(pred, teamId);   // team page: same prediction, oriented
//
// One game has one canonical prediction (home-oriented). Both team pages call
// orient() on that same object; they never compute separately.

import ARTIFACT from '../../model/pbe-wnba-model-v1/artifact.json' with { type: 'json' };
import FEATURE_SPEC from '../../model/pbe-wnba-model-v1/feature_spec.json' with { type: 'json' };
import MANIFEST from '../../model/pbe-wnba-model-v1/manifest.json' with { type: 'json' };
import { buildFeatures } from './pbe-wnba-features.js';

export { ARTIFACT, FEATURE_SPEC, MANIFEST };
export const MODEL_ID = ARTIFACT.model_id;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Home-win probability for a vector in artifact.feature_order. */
export function predict(vector, artifact = ARTIFACT) {
  return sigmoid(logitParts(vector, artifact).logit);
}

function logitParts(vector, artifact) {
  const order = artifact.feature_order;
  if (!Array.isArray(vector) || vector.length !== order.length) throw new Error(`predict: expected ${order.length} features`);
  const parts = [];
  let logit = 0;
  const hi = order.indexOf(artifact.home_term.feature);
  if (hi >= 0) {
    const c = artifact.home_term.coefficient * vector[hi];
    parts.push({ feature: artifact.home_term.feature, value: vector[hi], z: null, coefficient: artifact.home_term.coefficient, contribution: c });
    logit += c;
  }
  artifact.standardized_features.forEach((name, j) => {
    const x = vector[order.indexOf(name)];
    if (!Number.isFinite(x)) throw new Error(`predict: non-finite ${name}`);
    const z = (x - artifact.standardization.mean[j]) / artifact.standardization.std[j];
    const c = artifact.coefficients[j] * z;
    parts.push({ feature: name, value: x, z, coefficient: artifact.coefficients[j], contribution: c });
    logit += c;
  });
  return { logit, parts };
}

/** Per-feature home-oriented logit contributions, largest magnitude first. */
export function contributions(vector, artifact = ARTIFACT) {
  const { logit, parts } = logitParts(vector, artifact);
  const p = sigmoid(logit);
  return parts
    .map((x) => ({ ...x, impact_pts: 100 * (p - sigmoid(logit - x.contribution)) }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || (a.feature < b.feature ? -1 : 1));
}

/** Confidence tier from pick probability and data depth (thresholds in feature_spec.json). */
export function confidenceTier(pickProb, minCurrentGames, spec = FEATURE_SPEC) {
  const t = spec.confidence;
  let tier = pickProb >= t.high_min_prob ? 'High' : pickProb >= t.medium_min_prob ? 'Medium' : 'Low';
  if (minCurrentGames < t.full_depth_min_games && tier !== 'Low') tier = tier === 'High' ? 'Medium' : 'Low';
  return tier;
}

/** Canonical (home-oriented) prediction for one game from an as-of feature build. */
export function predictGame(features, { artifact = ARTIFACT, spec = FEATURE_SPEC } = {}) {
  const vector = artifact.feature_order.map((n) => {
    if (!(n in features.all)) throw new Error(`predictGame: feature ${n} missing`);
    return features.all[n];
  });
  const pHome = predict(vector, artifact);
  const contribs = contributions(vector, artifact);
  const home = features.teams.home;
  const away = features.teams.away;
  const minGames = Math.min(home.n_current, away.n_current);
  const pickHome = pHome >= 0.5;
  const pickProb = pickHome ? pHome : 1 - pHome;

  let noCall = null;
  if (!features.eligible) noCall = features.ineligible_reasons.join(',');
  else if (pickProb < spec.no_call.min_pick_probability) noCall = 'model_near_coin_flip';

  return {
    model_id: artifact.model_id,
    artifact_sha256: MANIFEST.files['artifact.json'],
    feature_spec_sha256: MANIFEST.files['feature_spec.json'],
    feature_schema: features.schema,
    event_id: features.event_id,
    as_of: features.as_of,
    home_team_id: home.team_id,
    away_team_id: away.team_id,
    p_home: pHome,
    p_away: 1 - pHome,
    call: noCall ? 'NO_CALL' : 'PICK',
    no_call_reason: noCall,
    pick_team_id: noCall ? null : pickHome ? home.team_id : away.team_id,
    pick_probability: noCall ? null : pickProb,
    confidence: noCall ? null : confidenceTier(pickProb, minGames, spec),
    feature_order: [...artifact.feature_order],
    feature_vector: vector,
    contributions: contribs,
    teams: { home, away }
  };
}

/** Build features with the artifact's own params/order, then predict. */
export function predictFromRows({ game, leagueRows, asOf, artifact = ARTIFACT, spec = FEATURE_SPEC }) {
  const homeRows = leagueRows.filter((r) => r.team_id === String(game.home_id));
  const awayRows = leagueRows.filter((r) => r.team_id === String(game.away_id));
  const features = buildFeatures({ game, homeRows, awayRows, leagueRows, asOf, params: artifact.params });
  return predictGame(features, { artifact, spec });
}

// ------------------------------------------------------------------ reasoning

const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const signed = (x) => `${x >= 0 ? '+' : '−'}${fmt1(Math.abs(x))}`;
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : 'n/a');

// Text for one contribution, from the oriented team's point of view (T) against
// the opponent (O). `favors` says whether this factor pushes toward T.
const TEXT = {
  sos_adj_net: (T, O, favors) => {
    const d = (T.net_shrunk + T.sos) - (O.net_shrunk + O.sos);
    return favors
      ? `${signed(d)} schedule-adjusted net rating per 100 possessions`
      : `Opponent holds a ${signed(-d)} schedule-adjusted net rating edge per 100 possessions`;
  },
  net_rating: (T, O, favors) => {
    const d = T.net_shrunk - O.net_shrunk;
    return favors ? `${signed(d)} net rating per 100 possessions` : `Opponent holds a ${signed(-d)} net rating edge per 100 possessions`;
  },
  form10: (T, O, favors) => {
    const t = formOf(T); const o = formOf(O);
    if (favors) return Math.abs(t) >= Math.abs(o)
      ? `Last 10 games: ${signed(t)} per 100 vs its season baseline`
      : `Opponent's last 10 games: ${signed(o)} per 100 vs its season baseline`;
    return Math.abs(o) >= Math.abs(t)
      ? `Opponent's last 10 games: ${signed(o)} per 100 vs its season baseline`
      : `Last 10 games: ${signed(t)} per 100 vs its season baseline`;
  },
  form5: (T, O, favors) => TEXT.form10(T, O, favors).replace('10 games', '5 games'),
  home_court: (T, O, favors, ctx) => (ctx.orientIsHome ? 'Home court' : 'Opponent has home court'),
  rest: (T, O) => `Rest: ${restText(T)} vs opponent ${restText(O)}`,
  back_to_back: (T, O, favors) => (favors ? 'Opponent on the second night of a back-to-back' : 'On the second night of a back-to-back'),
  games_last7: (T, O) => `Schedule density: ${T.games_last7} games in the last 7 days vs opponent ${O.games_last7}`,
  availability: (T, O) => `Rotation availability: ${pct(T.availability)} of last-10 minutes came from players in the last game vs opponent ${pct(O.availability)}`,
  continuity: (T, O) => `Starter continuity model adjustment: ${Number.isFinite(T.continuity) ? Math.round(T.continuity * 5) : '–'}/5 core players started the last game vs opponent ${Number.isFinite(O.continuity) ? Math.round(O.continuity * 5) : '–'}/5`,
  concentration: (T, O) => `Minutes concentration: ${fmt1(100 * T.concentration)} vs opponent ${fmt1(100 * O.concentration)} (HHI)`,
  efg_margin: (T, O) => `Shooting margin (eFG%): ${signed(T.efg_margin)} vs opponent ${signed(O.efg_margin)}`,
  tov_margin: (T, O) => `Turnover margin: ${signed(T.tov_margin)} vs opponent ${signed(O.tov_margin)}`,
  orb_margin: (T, O) => `Offensive rebounding margin: ${signed(T.orb_margin)} vs opponent ${signed(O.orb_margin)}`,
  ftr_margin: (T, O) => `Free-throw rate margin: ${signed(T.ftr_margin)} vs opponent ${signed(O.ftr_margin)}`,
  pace: (T, O) => `Pace: ${fmt1(T.pace ?? 0)} vs opponent ${fmt1(O.pace ?? 0)} possessions per 40`
};
function formOf(S) { return S.net_last10 === null ? 0 : S.net_last10 - S.net_shrunk; }
function restText(S) { return S.rest_days === null ? 'season opener' : `${S.rest_days} day${S.rest_days === 1 ? '' : 's'}`; }

/**
 * Supporting and opposing factors for one team in a canonical prediction.
 * Oriented: the home page and the away page of the same game get mirrored lists.
 */
export function reasons(prediction, { orientTeam, spec = FEATURE_SPEC } = {}) {
  const id = String(orientTeam);
  const orientIsHome = id === prediction.home_team_id;
  if (!orientIsHome && id !== prediction.away_team_id) throw new Error('reasons: team not in game');
  const T = orientIsHome ? prediction.teams.home : prediction.teams.away;
  const O = orientIsHome ? prediction.teams.away : prediction.teams.home;
  const floor = spec.reasoning.min_abs_impact_pts;
  const rows = prediction.contributions
    .map((c) => {
      const oriented = orientIsHome ? c.contribution : -c.contribution;
      const impact = orientIsHome ? c.impact_pts : -c.impact_pts;
      const favors = oriented > 0;
      const expected = spec.reasoning.expected_sign?.[c.feature] ?? 0;
      const signConsistent = expected === 0 || Math.sign(c.coefficient) === expected;
      const text = (TEXT[c.feature] || (() => c.feature))(T, O, favors, { orientIsHome });
      return { feature: c.feature, family: familyOf(c.feature, spec), contribution_logit: oriented, impact_pts: impact, sign_consistent: signConsistent, text };
    })
    .filter((r) => Math.abs(r.impact_pts) >= floor);
  const shown = rows.filter((r) => r.sign_consistent);
  const supporting = shown.filter((r) => r.contribution_logit > 0).sort((a, b) => b.contribution_logit - a.contribution_logit);
  const opposing = shown.filter((r) => r.contribution_logit < 0).sort((a, b) => a.contribution_logit - b.contribution_logit);
  // Real contributions whose learned direction contradicts the feature's plain meaning:
  // kept visible and exact, never dressed up as a reason for or against the team.
  const adjustments = rows.filter((r) => !r.sign_consistent).sort((a, b) => Math.abs(b.contribution_logit) - Math.abs(a.contribution_logit));
  return { team_id: id, supporting, opposing, adjustments };
}

function familyOf(name, spec) {
  return spec.features.find((f) => f.name === name)?.family || null;
}

/** Team-page view of the ONE canonical prediction. */
export function orient(prediction, teamId, { spec = FEATURE_SPEC } = {}) {
  const id = String(teamId);
  const isHome = id === prediction.home_team_id;
  if (!isHome && id !== prediction.away_team_id) throw new Error('orient: team not in game');
  const r = reasons(prediction, { orientTeam: id, spec });
  return {
    model_id: prediction.model_id,
    event_id: prediction.event_id,
    team_id: id,
    opponent_id: isHome ? prediction.away_team_id : prediction.home_team_id,
    is_home: isHome,
    team_probability: isHome ? prediction.p_home : prediction.p_away,
    opponent_probability: isHome ? prediction.p_away : prediction.p_home,
    call: prediction.call,
    no_call_reason: prediction.no_call_reason,
    pick_team_id: prediction.pick_team_id,
    team_is_pick: prediction.pick_team_id === id,
    pick_probability: prediction.pick_probability,
    confidence: prediction.confidence,
    supporting: r.supporting.slice(0, spec.reasoning.max_supporting),
    opposing: r.opposing.slice(0, spec.reasoning.max_opposing),
    adjustments: r.adjustments
  };
}
