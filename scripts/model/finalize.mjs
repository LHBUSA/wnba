#!/usr/bin/env node
// PBE WNBA model v1 — write feature_spec.json, validation_receipt.json, manifest.json.
//
// Run after: walkforward.py select -> walkforward.py holdout -> walkforward.py freeze
//            -> leakage-audit.mjs.
//
// The product policy thresholds below (eligibility, no-call, confidence, reasoning)
// were fixed BEFORE the holdout evaluation and are not tuned on it; the receipt
// reports how they behave on validation and holdout.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CANDIDATES, FEATURE_SCHEMA, ROW_SCHEMA, SINGLE_SITE_SEASONS } from '../../workers/shared/pbe-wnba-features.js';

const ROOT = process.env.WNBA_MODEL_DATA || 'D:/Workers/wnba-model-data';
const DERIVED = path.join(ROOT, 'derived');
const MODEL_DIR = new URL('../../model/pbe-wnba-model-v1/', import.meta.url);

export const POLICY = Object.freeze({
  eligibility: { min_current_games: 3, note: 'Both teams need at least 3 final games this season before the prediction instant.' },
  no_call: { min_pick_probability: 0.53, note: 'Below 53% for the favoured side the model publishes NO CALL (model_near_coin_flip).' },
  confidence: {
    high_min_prob: 0.7,
    medium_min_prob: 0.6,
    full_depth_min_games: 8,
    note: 'Tier from pick probability (Low < 60% <= Medium < 70% <= High); downgraded one tier when either team has fewer than 8 current-season games.'
  },
  reasoning: {
    method: 'Contribution = coefficient x standardized feature value (home term: coefficient x home_court flag). impact_pts = 100 x (p - p with that term removed). Oriented to the viewed team by sign.',
    baseline: 'A standardized feature at 0 means the training-set average game; a factor is relative to that baseline.',
    min_abs_impact_pts: 0.5,
    max_supporting: 3,
    max_opposing: 2
  }
});

// Display-only rule added AFTER the holdout evaluation (it changes no probability,
// metric or pick). A factor whose learned coefficient sign contradicts the plain-
// language direction of its feature (e.g. more starter continuity lowering the
// probability) is not presented as a reason for or against a team; it is listed
// under `adjustments` with its exact contribution instead.
export const DISPLAY_POLICY_AFTER_HOLDOUT = Object.freeze({
  expected_sign: { net_rating: 1, sos_adj_net: 1, efg_margin: 1, tov_margin: 1, orb_margin: 1, ftr_margin: 1, pace: 0, form10: 1, form5: 1, home_court: 1, rest: 1, back_to_back: -1, games_last7: -1, availability: 1, continuity: 1, concentration: 0 },
  rule: 'Contributions from a feature whose coefficient sign differs from expected_sign (0 = no expectation) go to adjustments, not supporting/opposing. Every contribution stays in the prediction record.',
  added: 'after holdout; display only'
});

export const canonical = (obj) => JSON.stringify(obj, null, 2) + '\n';
export const sha256 = (s) => createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function main() {
  const artifactText = await readFile(new URL('artifact.json', MODEL_DIR), 'utf8');
  const artifact = JSON.parse(artifactText);
  const selection = await readJson(path.join(DERIVED, 'selection.json'));
  const holdout = await readJson(path.join(DERIVED, 'holdout.json'));
  const leakage = await readJson(path.join(DERIVED, 'leakage.json'));
  const audit = await readJson(path.join(DERIVED, 'audit.json'));
  if (!leakage.pass) throw new Error('leakage audit did not pass');

  const byName = new Map(CANDIDATES.map((c) => [c.name, c]));
  const spec = {
    spec_id: 'pbe-wnba-model-v1/feature-spec',
    model_id: artifact.model_id,
    feature_schema: FEATURE_SCHEMA,
    row_schema: ROW_SCHEMA,
    implementation: 'workers/shared/pbe-wnba-features.js (the same module builds the training dataset and live vectors)',
    orientation: 'Every feature is listed-home-team minus away-team; the model outputs P(listed home team wins).',
    as_of_rule: 'A feature reads only FINAL regular-season/postseason team-game rows with a complete box whose game started strictly before as_of AND whose America/New_York calendar date is earlier than the target game date. The target game is never readable. Historical training rows use as_of = scheduled tip - 15 minutes.',
    params: artifact.params,
    params_definition: {
      prior_games: 'Weight, in games, of the prior-season value when shrinking season-to-date team quality: (n x current + prior_games x carryover x prior) / (n + prior_games).',
      carryover: 'Fraction of the prior full season (>= 10 games) carried into the new season before shrinkage; 0 prior (league mean) for a franchise without one.',
      min_current_games: 'Eligibility floor (see eligibility).'
    },
    features: artifact.feature_order.map((name) => ({ name, ...byName.get(name) })),
    windows: { form: 'last 5 / last 10 current-season finals, 0 below 3 games', rotation: 'last 10 current-season finals', schedule_density: 'previous 7 days', rest: 'ET calendar days between games minus 1, clamped 0..3' },
    single_site_seasons: SINGLE_SITE_SEASONS,
    candidates_considered: CANDIDATES,
    excluded_inputs: [
      'Sportsbook prices, lines and moneylines (market is compared after prediction, never a feature)',
      'Injury reports (ESPN publishes current injuries only, with no timestamped history; availability comes from observed minutes)',
      'Target game final score, box score or play-by-play',
      'Any row from the target game date or later, and any future roster state',
      'Closing prices observed after lock'
    ],
    eligibility: POLICY.eligibility,
    no_call: POLICY.no_call,
    confidence: POLICY.confidence,
    reasoning: { ...POLICY.reasoning, expected_sign: DISPLAY_POLICY_AFTER_HOLDOUT.expected_sign, sign_rule: DISPLAY_POLICY_AFTER_HOLDOUT.rule },
    source: 'ESPN site.web.api WNBA scoreboard (dates=YYYY) + summary?event=<id>'
  };
  const specText = canonical(spec);
  await writeFile(new URL('feature_spec.json', MODEL_DIR), specText);

  const strip = (m) => { if (!m) return m; const { reliability, ...rest } = m; return rest; };
  const receipt = {
    receipt_id: 'pbe-wnba-model-v1/validation',
    model_id: artifact.model_id,
    artifact_sha256: sha256(artifactText),
    feature_spec_sha256: sha256(specText),
    dataset: {
      source: spec.source,
      seasons_harvested: '2002-2026 (1997-2001 scoreboard statuses are unusable: IN_PROGRESS/TBD for finals)',
      usable_final_games: audit.games_usable,
      team_game_rows: audit.rows,
      rows_sha256: audit.rows_sha256,
      excluded: audit.excluded,
      box_completeness: Object.fromEntries(Object.entries(audit.seasons).map(([s, v]) => [s, { usable_finals: v.usable_finals || 0, box_complete: v.box_complete || 0 }])),
      first_target_season: 2005,
      market_data_available: '2026 only (ESPN pickcenter moneyline, 301 games) — evaluation only'
    },
    protocol: {
      split: 'walk-forward by season; train on prior seasons only (window chosen in selection); no random split',
      validation_seasons: selection.validation_seasons,
      holdout_seasons: [2025, 2026],
      holdout_evaluated_once: true,
      selection_metric: selection.selection_metric,
      simplicity_rule: selection.simplicity_rule,
      configs_evaluated: selection.configs_evaluated,
      grid: selection.grid
    },
    chosen_recipe: selection.chosen,
    best_by_validation_log_loss: selection.best_by_log_loss,
    validation: {
      logistic_chosen: { pooled: selection.logistic_chosen.pooled, per_season: Object.fromEntries(Object.entries(selection.logistic_chosen.per_season).map(([s, m]) => [s, strip(m)])) },
      hgb_tree_baseline_best: selection.hgb_best,
      hgb_runs: selection.hgb_runs,
      naive_baselines: selection.naive,
      tiers: holdout.validation_tiers || null
    },
    holdout: {
      logistic_chosen: { pooled: holdout.pooled, per_season: Object.fromEntries(Object.entries(holdout.per_season).map(([s, m]) => [s, strip(m)])) },
      hgb_tree_baseline: strip(holdout.hgb_pooled),
      naive_baselines: holdout.naive,
      by_min_current_games: holdout.by_min_current_games,
      tiers: holdout.tiers || null,
      market_comparison_2026_eval_only: holdout.market_comparison_2026_eval_only || null
    },
    production_artifact: {
      note: 'The frozen artifact is the chosen recipe refit on every eligible game in its training window through the freeze date. Holdout numbers measure the recipe trained without 2025/2026; they are not in-sample scores of this artifact.',
      training_window: artifact.training_window
    },
    leakage_audit: leakage,
    policy_fixed_before_holdout: POLICY,
    display_policy_added_after_holdout: DISPLAY_POLICY_AFTER_HOLDOUT,
    known_limits: [
      'No historical injury reports exist in the source; late scratches are invisible to the model until they show up in observed minutes.',
      'Rotation features see only who played, not why a player did not.',
      'Travel is not modelled (not objectively derivable from the source without a venue geography layer).',
      'Market data for evaluation exists for 2026 only; pickcenter timing is not published.',
      'Postseason games are scored with the same regular-season model.'
    ]
  };
  await writeFile(new URL('validation_receipt.json', MODEL_DIR), canonical(receipt));

  const files = {};
  for (const f of ['artifact.json', 'feature_spec.json', 'validation_receipt.json']) files[f] = sha256(await readFile(new URL(f, MODEL_DIR), 'utf8'));
  const manifest = {
    model_id: artifact.model_id,
    frozen_at: new Date().toISOString(),
    hash: 'sha256 of file bytes as committed (LF line endings)',
    files,
    training_window: artifact.training_window,
    dataset_sha256: artifact.dataset_sha256,
    rows_sha256: artifact.rows_sha256
  };
  await writeFile(new URL('manifest.json', MODEL_DIR), canonical(manifest));
  console.log(JSON.stringify(manifest, null, 1));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'model', 'finalize.mjs'));
if (isMain) await main();
