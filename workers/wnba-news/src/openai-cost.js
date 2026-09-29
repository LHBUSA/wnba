// OpenAI usage telemetry + governance for the WNBA newsroom — one record per actual Responses API call.
//
//   KV key openai:v1:calls:<YYYY-MM-DD UTC>  -> [{ worker, id, model, trigger, attempt, input_tokens, cached_input_tokens,
//                                                output_tokens, total_eligible_tokens, response_id,
//                                                nominal_standard_cost, digest, error, at }]
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

// Standard-rate constant (the same one UFC and Tennis record against). All input is priced at the input rate, cached
// input included, so the nominal figure is an upper bound.
export const USD_PER_MTOK = { input: 1.25, output: 10 };
export const OPENAI_COST_VERSION = 'wnba-openai-cost/2.0.0';

export const dayOf = (iso) => String(iso || new Date().toISOString()).slice(0, 10);
const keyOf = (iso) => `openai:v1:calls:${dayOf(iso)}`;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
export const costUsd = (i, o, price = USD_PER_MTOK) => round6((i * price.input + o * price.output) / 1e6);
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

export function callEntry({ worker, id, model, trigger, attempt, input_tokens = 0, cached_input_tokens = 0, output_tokens = 0, response_id = null, digest = null, error = null, at }) {
  return { worker, id, model, trigger, attempt, input_tokens, cached_input_tokens, output_tokens, total_eligible_tokens: input_tokens + output_tokens, response_id, nominal_standard_cost: costUsd(input_tokens, output_tokens), digest, error, at };
}

// Pre-2.0.0 entries carry estimated_usd and no total_eligible_tokens.
export const tokensOfCall = (c) => c.total_eligible_tokens ?? ((c.input_tokens || 0) + (c.output_tokens || 0));
export const nominalOfCall = (c) => c.nominal_standard_cost ?? c.estimated_usd ?? 0;
export const eligibleTokens = (calls) => (calls || []).reduce((s, c) => s + tokensOfCall(c), 0);
export const nominalUsd = (calls) => round6((calls || []).reduce((s, c) => s + nominalOfCall(c), 0));

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
  const emergency = g.nominal_emergency_usd > 0 && nominal >= g.nominal_emergency_usd;
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

// The class a paid call belongs to. Existing-revision and legacy-upgrade calls are impossible after
// wnba-editorial-eligibility/1.0.0; the labels exist so a pre-fix log (revision/backfill) is still counted honestly.
export const classOfTrigger = (t) => (t === 'new_story' ? 'new_story' : ['manual_reedit', 'canary', 'repair'].includes(t) ? 'manual' : t === 'revision' ? 'existing_revision' : ['backfill', 'legacy_upgrade'].includes(t) ? 'legacy_upgrade' : 'other');

/** The day's report: guard state, calls by class, totals, by story — and any story paid twice for the SAME draft. */
export function costReport(calls, day, env = {}) {
  const by = (f) => calls.reduce((m, c) => { const k = f(c); const x = (m[k] ||= { calls: 0, input_tokens: 0, output_tokens: 0, eligible_tokens: 0, nominal_standard_cost: 0 }); x.calls += 1; x.input_tokens += c.input_tokens || 0; x.output_tokens += c.output_tokens || 0; x.eligible_tokens += tokensOfCall(c); x.nominal_standard_cost = round6(x.nominal_standard_cost + nominalOfCall(c)); return m; }, {});
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
    totals: { calls: calls.length, input_tokens: calls.reduce((s, c) => s + (c.input_tokens || 0), 0), cached_input_tokens: calls.reduce((s, c) => s + (c.cached_input_tokens || 0), 0), output_tokens: calls.reduce((s, c) => s + (c.output_tokens || 0), 0), eligible_tokens: gov.eligible_tokens_today, nominal_standard_cost: gov.nominal_standard_cost_today, failed_calls: calls.filter((c) => c.error).length },
    by_trigger: by((c) => c.trigger),
    by_story: by((c) => c.id),
    unchanged_draft_recalls: repeated,
    calls
  };
}
