// WNBA AI router — wnba-ai-router/1.0.0 (Newsroom V4 stage 2, owner brief 2026-09-29).
//
// Model selection is an explicit, deterministic POLICY decision recorded on every model call — never a model name
// hardcoded through the newsroom, and never a model asked whether to use a model. Mirrors the Tennis reference
// (tennis-ai-router) so every PropBetEdge newsroom routes, logs and governs the same way.
//
//   DETERMINISTIC        no model call: the fact-safe deterministic draft publishes (existing revisions, legacy
//                        upgrades, anything outside the trigger allow-list, no key)
//   VOLUME               an approved mini/nano-pool model for low-value, high-volume work. No WNBA editorial task uses
//                        it today (classification, briefs, charts and cards are deterministic code); the lane exists so
//                        a future task has a policy home. route() never selects it for article prose.
//   STANDARD_EDITORIAL   the default premium newsroom model (gpt-5.6-sol)
//   FLAGSHIP_EDITORIAL   candidate premium flagship (gpt-6-astra). Only for a deterministically flagship-eligible story,
//                        only when WNBA_AI_FLAGSHIP_ENABLED === "true", and only for eligibility classes released in
//                        WNBA_AI_FLAGSHIP_CLASSES (empty = none). Off until the offline canary earns it.
//
// TRIGGER ALLOW-LIST (enforced HERE, not by callers): only new_story, manual_reedit and canary may reach a model
// transport; a corrective `repair` attempt is allowed only as attempt 2 of a manual_reedit or canary. Everything else
// (existing_revision, legacy_upgrade, version changes, corrections, backfills) is DETERMINISTIC with reason
// `trigger_not_eligible:<trigger>` — so a legacy repair can never reach a premium transport even if a caller bypasses
// paidEligibility (editorial-pass.js).
//
// Pools, model names, caps, efforts and nominal rates are configuration (env), not permanent truth. The OpenAI
// complimentary daily pools are SHARED across the organisation (Tennis, Soccer, ...); the WNBA token soft cap in
// openai-cost.js stays the operating guard.

export const ROUTER_VERSION = 'wnba-ai-router/1.0.0';

export const LANES = Object.freeze({ DETERMINISTIC: 'DETERMINISTIC', VOLUME: 'VOLUME', STANDARD: 'STANDARD_EDITORIAL', FLAGSHIP: 'FLAGSHIP_EDITORIAL' });

// model -> shared pool. gpt-6-luna is PREMIUM (not mini/nano). Unknown models are premium (the stricter guard).
// Override with WNBA_AI_POOLS (JSON { model: pool }).
export const DEFAULT_POOLS = Object.freeze({
  'gpt-6-astra': 'premium', 'gpt-6-sol': 'premium', 'gpt-6-luna': 'premium', 'gpt-5.6-sol': 'premium',
  'gpt-5.4-mini': 'volume', 'gpt-5.4-nano': 'volume'
});

// Nominal STANDARD list rates (USD per 1M tokens), used only to report nominal_standard_cost — never a billed amount
// (eligible traffic inside the complimentary data-sharing allowance may bill nothing). Only the rate already recorded
// for gpt-5.6-sol is a default; any other model reports null until WNBA_AI_RATES (JSON { model: { input, cached_input,
// output } }) sets it.
export const DEFAULT_RATES = Object.freeze({ 'gpt-5.6-sol': Object.freeze({ input: 1.25, cached_input: 0.125, output: 10 }) });

// Triggers that may reach a model transport. `repair` is conditional (see route()).
export const ELIGIBLE_TRIGGERS = Object.freeze(['new_story', 'manual_reedit', 'canary']);
const REPAIR_PARENTS = new Set(['manual_reedit', 'canary']);

// Flagship eligibility classes (see flagshipEligibility and docs/NEWSROOM_V4_AI_ROUTING.md).
export const FLAGSHIP_CLASS_IDS = Object.freeze(['finals_result', 'series_clinch_result', 'decider_preview', 'major_trend_episode', 'rich_packet', 'commissioned']);

const num = (v, d) => (v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const json = (v, d) => { try { const x = v ? JSON.parse(v) : d; return x && typeof x === 'object' && !Array.isArray(x) ? x : d; } catch { return d; } };

export function aiConfig(env = {}) {
  return {
    standardModel: env.WNBA_AI_STANDARD_MODEL || env.WNBA_EDITORIAL_MODEL || 'gpt-5.6-sol',
    flagshipModel: env.WNBA_AI_FLAGSHIP_MODEL || 'gpt-6-astra',
    flagshipEnabled: String(env.WNBA_AI_FLAGSHIP_ENABLED || 'false') === 'true',
    // Per-class release: only the eligibility ids listed here may use the flagship model, even when enabled. Empty = none.
    flagshipClasses: new Set(String(env.WNBA_AI_FLAGSHIP_CLASSES || '').split(',').map((x) => x.trim()).filter(Boolean)),
    volumeModel: env.WNBA_AI_VOLUME_MODEL || 'gpt-5.4-mini',
    // Standard keeps the governed 5k output cap (WNBA_EDITORIAL_MAX_OUTPUT_TOKENS) unless the lane knob overrides it.
    standardMaxOutput: num(env.WNBA_AI_STANDARD_MAX_OUTPUT, num(env.WNBA_EDITORIAL_MAX_OUTPUT_TOKENS, 5000)),
    flagshipMaxOutput: num(env.WNBA_AI_FLAGSHIP_MAX_OUTPUT, 8000),
    volumeMaxOutput: num(env.WNBA_AI_VOLUME_MAX_OUTPUT, 2000),
    standardEffort: env.WNBA_AI_STANDARD_EFFORT || env.WNBA_EDITORIAL_EFFORT || 'medium',
    flagshipEffort: env.WNBA_AI_FLAGSHIP_EFFORT || 'medium',
    volumeEffort: env.WNBA_AI_VOLUME_EFFORT || 'low',
    richEvidence: num(env.WNBA_AI_FLAGSHIP_RICH_EVIDENCE, 8),
    pools: { ...DEFAULT_POOLS, ...json(env.WNBA_AI_POOLS, {}) },
    rates: { ...DEFAULT_RATES, ...json(env.WNBA_AI_RATES, {}) }
  };
}

export const poolOf = (model, cfg = aiConfig()) => (model ? cfg.pools[model] || 'premium' : 'none');

const depthOf = (a) => a?.depth?.class || null;
const deepish = (a) => ['full', 'deep'].includes(depthOf(a));
const records = (a) => (a?.evidence || []).filter((e) => e && e.kind !== 'publisher_report').length;

/**
 * Deterministic flagship eligibility from the stored story's facts and kind only — never a model, never the prose.
 * Returns { eligible, id, reason }.
 *   finals_result         result/performance of a WNBA Finals game (playoff round named "Finals"), full/deep packet
 *   series_clinch_result  result/performance of a game that decided a playoff series (clinch = elimination), deep packet
 *   decider_preview       preview of a winner-take-all playoff game (both teams one win from advancing), full/deep packet
 *   major_trend_episode   betting-trend episode that is a long run: ≥ 9 of the window one way, ≥ 4 games by 10+, deep
 *   rich_packet           any editorial story at depth class deep with ≥ WNBA_AI_FLAGSHIP_RICH_EVIDENCE cited records
 *   commissioned          a commissioned editorial feature (its own lane today; listed so the policy is complete)
 */
export function flagshipEligibility(a = {}, cfg = aiConfig()) {
  const kind = a.kind || '';
  const f = a.facts || {};
  const po = f.playoff || null;
  if (kind === 'commissioned' || a.context?.commission) return { eligible: true, id: 'commissioned', reason: 'commissioned editorial feature' };
  if ((kind === 'result' || kind === 'performance') && po) {
    if (/\bfinals?\b/i.test(String(po.round || '')) && !/semi/i.test(String(po.round || '')) && deepish(a)) return { eligible: true, id: 'finals_result', reason: `WNBA Finals result (${po.round}, game ${po.game_number ?? '?'}) with a ${depthOf(a)} packet` };
    if (po.decided_by_this_game && depthOf(a) === 'deep') return { eligible: true, id: 'series_clinch_result', reason: `series-deciding result (${po.round}) with a deep packet` };
  }
  if (kind === 'preview' && po && Object.values(po.stakes || {}).includes('decider') && deepish(a)) return { eligible: true, id: 'decider_preview', reason: `winner-take-all preview (${po.round}, game ${po.game_number ?? '?'})` };
  if (kind === 'trend' && depthOf(a) === 'deep') {
    const run = Math.max(Number(f.atsW) || 0, Number(f.atsL) || 0, Number(f.ov) || 0, Number(f.un) || 0);
    const big = Number(f.materiality?.big) || 0;
    if (f.materiality?.material !== false && run >= 9 && big >= 4) return { eligible: true, id: 'major_trend_episode', reason: `long betting-trend run (${run} of ${f.n ?? '?'}, ${big} by 10+)` };
  }
  if (depthOf(a) === 'deep' && records(a) >= cfg.richEvidence) return { eligible: true, id: 'rich_packet', reason: `deep packet with ${records(a)} cited records (>= ${cfg.richEvidence})` };
  return { eligible: false, id: null, reason: 'routine story: standard editorial' };
}

/**
 * route({ story, trigger, attempt, parentTrigger, env, hasKey }) -> routing decision:
 *   { lane, model, pool, reason, max_output_tokens, reasoning_effort, flagship_eligible, flagship_class, trigger,
 *     router_version }
 * `story` is the deterministic draft (kind, facts, depth, evidence). Pure.
 */
export function route({ story = {}, trigger = 'new_story', attempt = 1, parentTrigger = null, env = {}, hasKey = true } = {}) {
  const cfg = aiConfig(env);
  const base = (lane, model, reason, extra = {}) => ({
    lane, model, pool: poolOf(model, cfg), reason,
    max_output_tokens: lane === LANES.FLAGSHIP ? cfg.flagshipMaxOutput : lane === LANES.STANDARD ? cfg.standardMaxOutput : lane === LANES.VOLUME ? cfg.volumeMaxOutput : 0,
    reasoning_effort: lane === LANES.FLAGSHIP ? cfg.flagshipEffort : lane === LANES.STANDARD ? cfg.standardEffort : lane === LANES.VOLUME ? cfg.volumeEffort : null,
    trigger, story_class: story?.kind || null, router_version: ROUTER_VERSION, ...extra
  });
  // TRIGGER ALLOW-LIST. A repair is only ever the second attempt of an explicit admin re-edit or canary.
  const repairOk = trigger === 'repair' && Number(attempt) >= 2 && REPAIR_PARENTS.has(parentTrigger);
  if (!ELIGIBLE_TRIGGERS.includes(trigger) && !repairOk) return base(LANES.DETERMINISTIC, null, `trigger_not_eligible:${trigger}`, { flagship_eligible: false, flagship_class: null });
  if (!hasKey) return base(LANES.DETERMINISTIC, null, 'no OPENAI_API_KEY (or WNBA_EDITORIAL=off): deterministic draft', { flagship_eligible: false, flagship_class: null });
  const fl = flagshipEligibility(story, cfg);
  if (fl.eligible && cfg.flagshipEnabled && cfg.flagshipClasses.has(fl.id)) return base(LANES.FLAGSHIP, cfg.flagshipModel, `flagship: ${fl.reason}`, { flagship_eligible: true, flagship_class: fl.id });
  const why = !fl.eligible ? `standard: ${fl.reason}`
    : !cfg.flagshipEnabled ? `standard: flagship-eligible (${fl.id}) but WNBA_AI_FLAGSHIP_ENABLED is off`
      : `standard: flagship-eligible (${fl.id}) but the class is not released in WNBA_AI_FLAGSHIP_CLASSES`;
  return base(LANES.STANDARD, cfg.standardModel, why, { flagship_eligible: fl.eligible, flagship_class: fl.id });
}

/** True when the routing decision may reach a model transport at all. */
export const reachesTransport = (r) => Boolean(r && r.model && (r.lane === LANES.STANDARD || r.lane === LANES.FLAGSHIP || r.lane === LANES.VOLUME));

/**
 * The env overlay that carries a routing decision into the editorial desk (the same technique the canary route uses):
 * editArticle/callModel read the model, effort and output cap from these keys.
 */
export function laneEnv(env, r) {
  if (!reachesTransport(r)) throw new Error(`routing: lane ${r?.lane} never reaches a model transport (${r?.reason})`);
  return { ...env, WNBA_EDITORIAL_MODEL: r.model, WNBA_EDITORIAL_EFFORT: r.reasoning_effort || 'medium', WNBA_EDITORIAL_MAX_OUTPUT_TOKENS: String(r.max_output_tokens) };
}

/** Nominal standard-rate cost (USD) of one call; null when the model's rate is not configured. Never a billed amount. */
export function nominalStandardCost(model, u = {}, cfg = aiConfig()) {
  const r = cfg.rates[model];
  if (!r) return null;
  const cached = Math.max(0, Number(u.cached_input_tokens) || 0);
  const input = Math.max(0, (Number(u.input_tokens) || 0) - cached);
  const usd = (input * r.input + cached * (r.cached_input ?? r.input) + (Number(u.output_tokens) || 0) * r.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
