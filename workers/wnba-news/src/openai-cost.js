// OpenAI usage telemetry + governance for the WNBA newsroom — one record per actual Responses API call.
//
//   KV key openai:v1:calls:<YYYY-MM-DD UTC>  -> [{ worker, sport, id, model, response_model, trigger, attempt,
//                                                story_class, routing_lane, routing_reason, pool, router_version,
//                                                input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
//                                                total_eligible_tokens, latency_ms, status, response_id,
//                                                nominal_standard_cost, digest, error, at }]
//   (2.1.0) Each entry is written IMMEDIATELY after its call (callLogWriter: serialized, one base read, retried at the
//   end of the pass) — a pass that dies mid-way no longer loses the calls it already paid for. Billed usage reported on
//   an incomplete / failed / refused / malformed response is recorded, not zeroed. nominal_standard_cost is priced per
//   model from the router's rates table (cached input at the cached rate); null for a model with no configured rate.
//
// Two quantities, never conflated:
//   ELIGIBLE SHARED TOKENS  — input + output tokens actually sent. The org is enrolled in OpenAI's data-sharing program
//                             (complimentary eligible tokens/day, OPENAI_SHARED_DAILY_TOKEN_ALLOWANCE, a pool shared with
//                             Soccer and other eligible traffic). This is what the WNBA operating guard counts.
//   NOMINAL STANDARD COST   — what the same traffic would cost at standard API rates. NOT the billed amount: eligible
//                             traffic inside the complimentary allowance may bill nothing.
// Governance: WNBA_OPENAI_DAILY_TOKEN_SOFT_CAP (default 400k, below the shared allowance) — a health warning at
// WNBA_OPENAI_DAILY_TOKEN_WARN (350k) and, at the cap, new AI rewrites defer to deterministic copy for the rest of the UTC
// day unless an explicit admin override. WNBA_OPENAI_DAILY_MAX_USD (default $25 nominal) is only an emergency ceiling far
// above normal usage. Triggers: new_story | manual_reedit | canary | repair (pre-fix logs also hold revision | backfill).

import { aiConfig, nominalStandardCost, ROUTER_VERSION } from './ai-router.js';

// Standard-rate constant (the same one UFC and Tennis record against) — used for pre-2.1.0 entries, the re-edit estimate
// and as the conservative emergency-ceiling estimate for a call whose model has no configured rate.
export const USD_PER_MTOK = { input: 1.25, output: 10 };
export const OPENAI_COST_VERSION = 'wnba-openai-cost/2.1.0';

export const dayOf = (iso) => String(iso || new Date().toISOString()).slice(0, 10);
const keyOf = (iso) => `openai:v1:calls:${dayOf(iso)}`;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
export const costUsd = (i, o, price = USD_PER_MTOK) => round6((i * price.input + o * price.output) / 1e6);
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

export function callEntry({ worker, id, model, trigger, attempt, input_tokens = 0, cached_input_tokens = 0, output_tokens = 0, reasoning_tokens = 0, response_id = null, response_model = null, digest = null, error = null, status = null, latency_ms = null, story_class = null, routing = null, rates = null, at }) {
  const i = Number(input_tokens) || 0; const o = Number(output_tokens) || 0; const ci = Number(cached_input_tokens) || 0;
  const cfg = rates ? { rates } : aiConfig();
  return {
    worker, sport: 'wnba', id, model, response_model: response_model || null, trigger, attempt,
    story_class, routing_lane: routing?.lane || null, routing_reason: routing?.reason || null, pool: routing?.pool || null, router_version: routing?.router_version || (routing ? ROUTER_VERSION : null),
    input_tokens: i, cached_input_tokens: ci, output_tokens: o, reasoning_tokens: Number(reasoning_tokens) || 0, total_eligible_tokens: i + o,
    latency_ms: Number.isFinite(latency_ms) ? latency_ms : null, status: status || (error ? 'error' : 'completed'), response_id,
    nominal_standard_cost: nominalStandardCost(model, { input_tokens: i, cached_input_tokens: ci, output_tokens: o }, cfg), digest, error, at
  };
}

// Pre-2.0.0 entries carry estimated_usd and no total_eligible_tokens.
export const tokensOfCall = (c) => c.total_eligible_tokens ?? ((c.input_tokens || 0) + (c.output_tokens || 0));
export const nominalOfCall = (c) => c.nominal_standard_cost ?? c.estimated_usd ?? 0;
export const eligibleTokens = (calls) => (calls || []).reduce((s, c) => s + tokensOfCall(c), 0);
export const nominalUsd = (calls) => round6((calls || []).reduce((s, c) => s + nominalOfCall(c), 0));
// The emergency ceiling never lets an unpriced model (nominal null) spend for free: such a call counts at the standard
// constant. Reporting keeps nominal_standard_cost null — this estimate exists only for the breaker.
export const guardOfCall = (c) => c.nominal_standard_cost ?? c.estimated_usd ?? costUsd(c.input_tokens || 0, c.output_tokens || 0);
export const guardUsd = (calls) => round6((calls || []).reduce((s, c) => s + guardOfCall(c), 0));

export function governanceOf(env) {
  return {
    shared_daily_token_allowance: num(env?.OPENAI_SHARED_DAILY_TOKEN_ALLOWANCE, 1000000),
    soft_cap_tokens: num(env?.WNBA_OPENAI_DAILY_TOKEN_SOFT_CAP, 400000),
    warn_at_tokens: num(env?.WNBA_OPENAI_DAILY_TOKEN_WARN, 350000),
    nominal_emergency_usd: num(env?.WNBA_OPENAI_DAILY_MAX_USD, 25)
  };
}

/** Where today's WNBA usage stands against its guards. */
export function governanceState(calls, env) {
  const g = governanceOf(env);
  const tokens = eligibleTokens(calls);
  const nominal = nominalUsd(calls);
  const capped = g.soft_cap_tokens > 0 && tokens >= g.soft_cap_tokens;
  const warn = g.warn_at_tokens > 0 && tokens >= g.warn_at_tokens;
  // The emergency stop counts unpriced models at the standard constant (guardUsd) so a model with no configured rate is never free.
  const emergency = g.nominal_emergency_usd > 0 && guardUsd(calls) >= g.nominal_emergency_usd;
  return {
    ...g,
    eligible_tokens_today: tokens,
    pct_of_wnba_soft_cap: g.soft_cap_tokens ? Math.round((tokens / g.soft_cap_tokens) * 1000) / 10 : null,
    pct_of_shared_allowance: g.shared_daily_token_allowance ? Math.round((tokens / g.shared_daily_token_allowance) * 1000) / 10 : null,
    nominal_standard_cost_today: nominal,
    status: emergency ? 'EMERGENCY_STOP' : capped ? 'CAPPED' : warn ? 'WARN' : 'OK'
  };
}

export async function readCallLog(kv, iso) {
  return (await kv.get(keyOf(iso), 'json')) || [];
}

export async function appendCallLog(kv, iso, calls) {
  if (!calls.length) return;
  const prior = await readCallLog(kv, iso);
  await kv.put(keyOf(iso), JSON.stringify([...prior, ...calls]), { expirationTtl: 400 * 86400 });
}

/**
 * Per-call log writer for one pass (the caller holds the newsroom lease, so this pass is the only writer). Appends are
 * serialized through one promise chain (concurrent desk workers can never interleave read-modify-writes); the day's log
 * is read ONCE and extended in memory, so a KV read-after-write lag cannot drop an entry written a moment earlier. A
 * failed write keeps its entries pending; flush() retries them at the end of the pass and reports what never landed.
 */
export function callLogWriter(kv, iso) {
  let base = null;
  const pending = [];
  const failures = [];
  let written = 0;
  let chain = Promise.resolve();
  const drain = async () => {
    if (!pending.length) return;
    if (base === null) base = await readCallLog(kv, iso);
    const batch = pending.splice(0);
    const next = [...base, ...batch];
    try {
      await kv.put(keyOf(iso), JSON.stringify(next), { expirationTtl: 400 * 86400 });
      base = next;
      written += batch.length;
    } catch (e) { pending.unshift(...batch); throw e; }
  };
  const run = () => { chain = chain.then(drain).catch((e) => { failures.push(String(e?.message || e).slice(0, 160)); }); return chain; };
  return {
    append(entry) { pending.push(entry); return run(); },
    async flush() { await run(); return { written, pending: pending.length, failures: [...failures] }; },
    get pending() { return pending.length; }
  };
}

// The class a paid call belongs to. Existing-revision and legacy-upgrade calls are impossible after
// wnba-editorial-eligibility/1.0.0; the labels exist so a pre-fix log (revision/backfill) is still counted honestly.
export const classOfTrigger = (t) => (t === 'new_story' ? 'new_story' : ['manual_reedit', 'canary', 'repair'].includes(t) ? 'manual' : t === 'revision' ? 'existing_revision' : ['backfill', 'legacy_upgrade'].includes(t) ? 'legacy_upgrade' : 'other');

/** The day's report: guard state, calls by class, totals, by story — and any story paid twice for the SAME draft. */
export function costReport(calls, day, env = {}) {
  const by = (f) => calls.reduce((m, c) => { const k = f(c); const x = (m[k] ||= { calls: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, eligible_tokens: 0, nominal_standard_cost: 0, unpriced_calls: 0 }); x.calls += 1; x.input_tokens += c.input_tokens || 0; x.cached_input_tokens += c.cached_input_tokens || 0; x.output_tokens += c.output_tokens || 0; x.reasoning_tokens += c.reasoning_tokens || 0; x.eligible_tokens += tokensOfCall(c); if (c.nominal_standard_cost === null) x.unpriced_calls += 1; x.nominal_standard_cost = round6(x.nominal_standard_cost + nominalOfCall(c)); return m; }, {});
  const perDigest = {};
  for (const c of calls) if (c.digest && c.attempt === 1 && !['canary', 'repair'].includes(c.trigger)) (perDigest[`${c.id}|${c.digest}`] ||= []).push(c.at);
  const repeated = Object.entries(perDigest).filter(([, xs]) => xs.length > 1).map(([k, xs]) => ({ id: k.split('|')[0], digest: k.split('|')[1], calls: xs.length, at: xs }));
  const cls = { new_story: 0, manual: 0, existing_revision: 0, legacy_upgrade: 0, other: 0 };
  for (const c of calls) cls[classOfTrigger(c.trigger)] += 1;
  const gov = governanceState(calls, env);
  return {
    version: OPENAI_COST_VERSION,
    day,
    calls_today: calls.length,
    eligible_tokens_today: gov.eligible_tokens_today,
    wnba_soft_cap_tokens: gov.soft_cap_tokens,
    pct_of_wnba_soft_cap: gov.pct_of_wnba_soft_cap,
    guard_status: gov.status,
    nominal_standard_cost_today: gov.nominal_standard_cost_today,
    nominal_note: 'standard-rate equivalent, not the billed amount: eligible tokens inside the complimentary data-sharing allowance may bill nothing',
    new_story_calls: cls.new_story,
    manual_calls: cls.manual,
    existing_revision_calls: cls.existing_revision,
    legacy_upgrade_calls: cls.legacy_upgrade,
    invariant_ok: cls.existing_revision === 0 && cls.legacy_upgrade === 0,
    governance: gov,
    pricing_usd_per_mtok: USD_PER_MTOK,
    rates_usd_per_mtok: aiConfig(env).rates,
    totals: { calls: calls.length, input_tokens: calls.reduce((s, c) => s + (c.input_tokens || 0), 0), cached_input_tokens: calls.reduce((s, c) => s + (c.cached_input_tokens || 0), 0), output_tokens: calls.reduce((s, c) => s + (c.output_tokens || 0), 0), reasoning_tokens: calls.reduce((s, c) => s + (c.reasoning_tokens || 0), 0), eligible_tokens: gov.eligible_tokens_today, nominal_standard_cost: gov.nominal_standard_cost_today, unpriced_calls: calls.filter((c) => c.nominal_standard_cost === null).length, failed_calls: calls.filter((c) => c.error).length },
    by_trigger: by((c) => c.trigger),
    // Pre-2.1.0 entries carry no routing: they group under "unrouted".
    by_lane: by((c) => c.routing_lane || 'unrouted'),
    by_pool: by((c) => c.pool || 'unrouted'),
    by_model: by((c) => c.model || 'unknown'),
    by_story: by((c) => c.id),
    unchanged_draft_recalls: repeated,
    calls
  };
}
