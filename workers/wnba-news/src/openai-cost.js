// OpenAI cost telemetry for the WNBA newsroom — one record per actual Responses API call.
//
//   KV key openai:v1:calls:<YYYY-MM-DD UTC>  -> [{ worker, id, model, trigger, attempt, input_tokens, output_tokens,
//                                                estimated_usd, digest, error, at }]
//
// Triggers: new_story | revision | manual_reedit | backfill | canary | repair. Written once per pass under the newsroom
// lease (no concurrent writers). "How much did WNBA OpenAI cost today?" = GET /v1/newsroom/openai-cost (admin).

// Account pricing constant, the same one UFC and Tennis record against; overridable per deployment.
export const USD_PER_MTOK = { input: 1.25, output: 10 };
export const OPENAI_COST_VERSION = 'wnba-openai-cost/1.0.0';

export const dayOf = (iso) => String(iso || new Date().toISOString()).slice(0, 10);
const keyOf = (iso) => `openai:v1:calls:${dayOf(iso)}`;
export const costUsd = (i, o, price = USD_PER_MTOK) => Math.round(((i * price.input + o * price.output) / 1e6) * 1e6) / 1e6;

export function callEntry({ worker, id, model, trigger, attempt, input_tokens = 0, output_tokens = 0, digest = null, error = null, at }) {
  return { worker, id, model, trigger, attempt, input_tokens, output_tokens, estimated_usd: costUsd(input_tokens, output_tokens), digest, error, at };
}

export const spentUsd = (calls) => Math.round((calls || []).reduce((s, c) => s + (c.estimated_usd || 0), 0) * 1e6) / 1e6;

export async function readCallLog(kv, iso) {
  return (await kv.get(keyOf(iso), 'json')) || [];
}

export async function appendCallLog(kv, iso, calls) {
  if (!calls.length) return;
  const prior = await readCallLog(kv, iso);
  await kv.put(keyOf(iso), JSON.stringify([...prior, ...calls]), { expirationTtl: 400 * 86400 });
}

/** The day's cost report: totals, by trigger, by story — and any story paid twice for the SAME draft digest. */
export function costReport(calls, day) {
  const by = (f) => calls.reduce((m, c) => { const k = f(c); const x = (m[k] ||= { calls: 0, input_tokens: 0, output_tokens: 0, estimated_usd: 0 }); x.calls += 1; x.input_tokens += c.input_tokens; x.output_tokens += c.output_tokens; x.estimated_usd = Math.round((x.estimated_usd + c.estimated_usd) * 1e6) / 1e6; return m; }, {});
  const perDigest = {};
  for (const c of calls) if (c.digest && c.attempt === 1 && !['canary', 'repair'].includes(c.trigger)) (perDigest[`${c.id}|${c.digest}`] ||= []).push(c.at);
  const repeated = Object.entries(perDigest).filter(([, xs]) => xs.length > 1).map(([k, xs]) => ({ id: k.split('|')[0], digest: k.split('|')[1], calls: xs.length, at: xs }));
  return {
    version: OPENAI_COST_VERSION,
    day,
    pricing_usd_per_mtok: USD_PER_MTOK,
    totals: { calls: calls.length, input_tokens: calls.reduce((s, c) => s + c.input_tokens, 0), output_tokens: calls.reduce((s, c) => s + c.output_tokens, 0), estimated_usd: spentUsd(calls), failed_calls: calls.filter((c) => c.error).length },
    by_trigger: by((c) => c.trigger),
    by_story: by((c) => c.id),
    unchanged_draft_recalls: repeated,
    calls
  };
}
