// WNBA offline AI canary harness (Newsroom V4 stage 2) — library. NEVER publishes, never writes KV or the database.
//
// Takes frozen REAL production deterministic drafts (the draft the editorial desk would be handed) and runs, for each,
// the SAME prompt (INSTRUCTIONS + inputOf), SAME strict JSON schema (schemaFor), SAME rewrite gate (rewriteFailures)
// and the offline-reproducible publication gates, with model A (standard, gpt-5.6-sol) and model B (flagship candidate,
// gpt-6-astra). One attempt per model per draft (the automatic-pass rule). Outputs a blinded review sheet: each draft's
// two versions are labelled VERSION A / VERSION B in random order; the model mapping lives only in a separate SEALED
// key file.
//
// Offline gates: the fact gate is the editorial rewrite gate (numbers, dates, times, names, quotes, market/model
// language, characterisation, repetition, structure). The quality gate is regate (the article validator) + provenance/
// visual/storycraft quality + the depth contract, plus the rule that a depth element the draft met must stay met. The
// live reconcile check (season stats / injury feed at run time) needs production state and is NOT re-run offline.
//
// dry mode: no API. A local echo transport returns the draft itself as the "rewrite" with synthetic usage, so every
// stage (packet, schema, gates, metrics, blinding, files) runs without a key or a network call.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { draftSections, inputOf, schemaFor, callModel, applyRewrite, rewriteFailures, statedValues, EDITORIAL_DESK_VERSION } from '../../workers/wnba-news/src/editorial-desk.js';
import { route, laneEnv, nominalStandardCost, aiConfig, ROUTER_VERSION } from '../../workers/wnba-news/src/ai-router.js';
import { sectionKey, assessDepth } from '../../workers/wnba-news/src/depth.js';
import { regate } from '../../workers/wnba-news/src/articles.js';
import { qualityFailures } from '../../workers/wnba-news/src/quality.js';

export const CANARY_VERSION = 'wnba-ai-canary/1.0.0';
export const DEFAULT_MODELS = ['gpt-5.6-sol', 'gpt-6-astra'];

/** The deterministic draft of a stored production article: its editorial_draft when a rewrite was applied. */
export function draftOfStored(a) {
  if (!a || typeof a !== 'object') return null;
  const base = { ...a };
  delete base.media; delete base.video; delete base.related;
  if (a.editorial?.status === 'applied' && a.editorial_draft) return { ...base, ...a.editorial_draft, editorial: null, editorial_draft: undefined };
  return { ...base, editorial: null };
}

const words = (xs) => (xs || []).join(' ').split(/\s+/).filter(Boolean).length;

/** Share of 5-word shingles in the body that repeat an earlier shingle (0 = none). */
export function repetitionScore(body) {
  const toks = (body || []).join(' ').toLowerCase().replace(/[^a-z0-9’' ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (toks.length < 5) return 0;
  const seen = new Set(); let rep = 0; let n = 0;
  for (let i = 0; i + 5 <= toks.length; i += 1) { const g = toks.slice(i, i + 5).join(' '); n += 1; if (seen.has(g)) rep += 1; else seen.add(g); }
  return Math.round((rep / n) * 1e4) / 1e4;
}

/** Offline publication gates on a candidate. */
export function qualityGate(candidate, { now = Date.now() } = {}) {
  const f = [];
  const safe = (label, fn) => { try { return fn(); } catch (e) { f.push(`${label}: gate error ${String(e?.message || e).slice(0, 80)}`); return null; } };
  const g = safe('regate', () => regate(candidate));
  if (g) f.push(...g.failures);
  const q = safe('quality', () => qualityFailures(candidate, { generatedAt: candidate.provenance?.generated_at || candidate.updated_at }));
  if (q) f.push(...q);
  const d = safe('depth', () => assessDepth(candidate, { now }));
  if (d && !d.pass) f.push(...d.failures);
  return { failures: [...new Set(f)], depth: d };
}

const namesOf = (a) => ({
  players: (a.entities || []).filter((e) => e?.type === 'player' && e.name).map((e) => e.name),
  teams: (a.entities || []).filter((e) => e?.type === 'team' && e.name).map((e) => ({ name: e.name, short_name: String(e.name).split(' ').slice(-1)[0] }))
});

/** Local echo transport for --dry: the draft comes back unchanged; usage is synthetic; NOTHING leaves the machine. */
export function dryTransport() {
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    const packet = JSON.parse(String(body.input).slice(String(body.input).indexOf('PACKET:') + 'PACKET:'.length));
    const out = { headline: packet.draft.headline, deck: packet.draft.deck, sections: packet.draft.sections.map((s) => ({ key: s.key, title: s.title || s.key, paragraphs: s.paragraphs })) };
    const inTok = Math.ceil(String(body.input).length / 4) + 1500;
    f.calls.push({ url, model: body.model });
    return { ok: true, status: 200, json: async () => ({ id: `dry_${f.calls.length}`, model: `${body.model}-dry`, status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }], usage: { input_tokens: inTok, input_tokens_details: { cached_tokens: 0 }, output_tokens: 900, output_tokens_details: { reasoning_tokens: 400 } } }) };
  };
  f.calls = [];
  return f;
}

/** One model on one frozen draft: same prompt, schema and gates as production; one attempt. */
export async function runOne(draft, model, { env, fetchImpl, timeoutMs = 120e3, now = Date.now() }) {
  const sections = draftSections(draft, sectionKey);
  const detQ = qualityGate(draft, { now });
  const metBefore = new Set((detQ.depth?.elements || []).filter((e) => e.met).map((e) => e.key));
  // The canary pins the model: the router's standard lane with this model, flagship off (effort / cap from the lane).
  const routing = route({ story: draft, trigger: 'canary', env: { ...env, WNBA_AI_STANDARD_MODEL: model, WNBA_AI_FLAGSHIP_ENABLED: 'false' }, hasKey: true });
  const laneE = laneEnv(env, { ...routing, max_output_tokens: model === aiConfig(env).flagshipModel ? aiConfig(env).flagshipMaxOutput : routing.max_output_tokens, reasoning_effort: model === aiConfig(env).flagshipModel ? aiConfig(env).flagshipEffort : routing.reasoning_effort });
  const base = { model, max_output_tokens: Number(laneE.WNBA_EDITORIAL_MAX_OUTPUT_TOKENS), reasoning_effort: laneE.WNBA_EDITORIAL_EFFORT };
  let r;
  try {
    r = await callModel(laneE, { input: inputOf(draft, sections), schema: schemaFor(sections), timeoutMs, fetchImpl });
  } catch (e) {
    const c = e.call || {};
    return { ...base, ok: false, error: String(e.message).slice(0, 200), status: c.status || 'error', response_model: c.response_model || null, latency_ms: c.latency_ms ?? null, usage: c.usage || { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, nominal_standard_cost: nominalStandardCost(model, c.usage || {}, aiConfig(env)) };
  }
  const out = r.json;
  const valid = out && typeof out === 'object' && Array.isArray(out.sections);
  const cand = valid ? applyRewrite(draft, sections, out) : null;
  const factFailures = valid ? rewriteFailures(draft, out, cand, { names: namesOf(draft), draftSectionsList: sections }) : ['provider: malformed rewrite'];
  const q = cand ? qualityGate(cand, { now }) : { failures: ['no candidate'], depth: null };
  const metAfter = new Set((q.depth?.elements || []).filter((e) => e.met).map((e) => e.key));
  const qualityFailuresList = [...q.failures, ...[...metBefore].filter((k) => !metAfter.has(k)).map((k) => `depth regression: the draft met "${k}" and the rewrite does not`)];
  return {
    ...base, ok: true, status: r.status, response_model: r.response_model, latency_ms: r.latency_ms, usage: r.usage,
    nominal_standard_cost: nominalStandardCost(model, r.usage, aiConfig(env)),
    fact_gate: { pass: factFailures.length === 0, failures: factFailures.slice(0, 12) },
    quality_gate: { pass: qualityFailuresList.length === 0, failures: qualityFailuresList.slice(0, 12) },
    words: cand ? words(cand.body) : 0, draft_words: words(draft.body), repetition_score: cand ? repetitionScore(cand.body) : null,
    sections: cand ? cand.sections.length : 0, new_numbers: cand ? [...statedValues([cand.headline, cand.deck, ...cand.body].join(' ')).nums].filter((n) => !statedValues([draft.headline, draft.deck, ...(draft.body || [])].join(' ')).nums.has(n)) : [],
    rewrite: cand ? { headline: cand.headline, deck: cand.deck, sections: cand.sections.map((s) => ({ title: s.title, paragraphs: cand.body.slice(s.first, s.first + s.count) })) } : null
  };
}

const esc = (t) => String(t ?? '').replace(/\r?\n/g, ' ');
const med = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Per-model aggregates (objective metrics only). */
export function aggregate(results) {
  const agg = {};
  for (const r of results) for (const x of r.versions) {
    const a = (agg[x.model] ||= { drafts: 0, completed: 0, fact_gate_pass: 0, quality_gate_pass: 0, both_pass: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, latency: [], words: [], repetition: [], nominal: 0, cost_known: true });
    a.drafts += 1;
    if (!x.ok) continue;
    a.completed += 1;
    if (x.fact_gate.pass) a.fact_gate_pass += 1;
    if (x.quality_gate.pass) a.quality_gate_pass += 1;
    if (x.fact_gate.pass && x.quality_gate.pass) a.both_pass += 1;
    a.input_tokens += x.usage.input_tokens || 0; a.output_tokens += x.usage.output_tokens || 0; a.reasoning_tokens += x.usage.reasoning_tokens || 0;
    a.latency.push(x.latency_ms); a.words.push(x.words); a.repetition.push(x.repetition_score);
    if (x.nominal_standard_cost == null) a.cost_known = false; else a.nominal += x.nominal_standard_cost;
  }
  return Object.fromEntries(Object.entries(agg).map(([m, a]) => [m, {
    drafts: a.drafts, completed: a.completed, fact_gate_pass: a.fact_gate_pass, quality_gate_pass: a.quality_gate_pass, both_pass: a.both_pass,
    avg_input_tokens: a.completed ? Math.round(a.input_tokens / a.completed) : null, avg_output_tokens: a.completed ? Math.round(a.output_tokens / a.completed) : null,
    avg_reasoning_tokens: a.completed ? Math.round(a.reasoning_tokens / a.completed) : null, median_latency_ms: med(a.latency), median_words: med(a.words), median_repetition_score: med(a.repetition),
    nominal_standard_cost_usd: a.cost_known ? Math.round(a.nominal * 1e4) / 1e4 : 'rate not configured (WNBA_AI_RATES) — nominal, never billed'
  }]));
}

/** Blinded review sheet: VERSION A / VERSION B per draft, order randomized; model names never appear. */
export function blindSheet(results, labels) {
  const md = ['# WNBA AI canary — blind review', '', `${CANARY_VERSION} · desk ${EDITORIAL_DESK_VERSION} · router ${ROUTER_VERSION}`, '',
    'Two versions per frozen production draft: identical instructions, packet, schema and gates, one attempt each. Model names are hidden — score every draft first, then open the SEALED key file.', '',
    '## Scoring (1–5; gates are objective)', '1 fact gate · 2 quality gate · 3 headline · 4 deck · 5 section titles · 6 flow / synthesis vs stat recitation · 7 repetition (5 = none) · 8 basketball analysis · 9 readability', ''];
  for (const r of results) {
    const lab = labels[r.id];
    md.push(`## ${r.n}. ${esc(r.kind)} · ${esc(r.id)} · depth ${esc(r.depth_class || '—')}`, '', `Deterministic draft headline: _${esc(r.draft_headline)}_`, '');
    for (const L of ['A', 'B']) {
      const v = r.versions.find((x) => x.model === lab[L]);
      md.push(`### VERSION ${L}`);
      if (!v?.ok) { md.push('', `_no output (${esc(v?.status || 'missing')})_`, ''); continue; }
      md.push(`- fact gate: ${v.fact_gate.pass ? 'PASS' : `FAIL (${v.fact_gate.failures.slice(0, 3).map(esc).join('; ')})`} · quality gate: ${v.quality_gate.pass ? 'PASS' : `FAIL (${v.quality_gate.failures.slice(0, 3).map(esc).join('; ')})`}`, `- ${v.words} words (draft ${v.draft_words}) · ${v.sections} sections · repetition ${v.repetition_score}`, '', `**${esc(v.rewrite.headline)}**`, '', `_${esc(v.rewrite.deck)}_`, '');
      for (const s of v.rewrite.sections) md.push(`#### ${esc(s.title || '(untitled)')}`, '', ...s.paragraphs.map(esc).flatMap((p) => [p, '']));
    }
    md.push('| criterion | A | B |', '|---|---|---|', ...['1 fact gate', '2 quality gate', '3 headline', '4 deck', '5 section titles', '6 flow', '7 repetition', '8 basketball analysis', '9 readability'].map((c) => `| ${c} | | |`), '', 'Preferred: A / B / tie — note:', '');
  }
  return md.join('\n') + '\n';
}

/**
 * Run the canary over frozen drafts. Returns { dir, results, metrics, labels, calls }. `dry` uses the echo transport
 * (no key, no network). `fetchImpl` may be injected for tests; in dry mode any non-echo transport is refused.
 */
export async function runCanary({ drafts, models = DEFAULT_MODELS, dry = false, env = {}, out, seed = null, fetchImpl = null, now = Date.now(), log = () => {} }) {
  if (!Array.isArray(drafts) || !drafts.length) throw new Error('no drafts: pass --drafts <file.json> or --slugs');
  if (models.length !== 2) throw new Error('exactly two models (A/B)');
  if (!dry && !env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required outside --dry (read from the environment, never printed)');
  const transport = dry ? dryTransport() : fetchImpl || fetch;
  const runEnv = dry ? { ...env, OPENAI_API_KEY: 'dry-run-no-key' } : env;
  const rand = seed === null ? () => crypto.randomInt(0, 2) : (() => { let h = crypto.createHash('sha256').update(String(seed)).digest(); let i = 0; return () => { if (i >= h.length) { h = crypto.createHash('sha256').update(h).digest(); i = 0; } return h[i++] & 1; }; })();
  const results = [];
  const labels = {};
  for (const [i, d0] of drafts.entries()) {
    const draft = draftOfStored(d0);
    const versions = [];
    for (const m of models) {
      versions.push(await runOne(draft, m, { env: runEnv, fetchImpl: transport, now }));
      log(`${i + 1}/${drafts.length} ${draft.id} · model ${m === models[0] ? 'A-slot' : 'B-slot'} done`);
    }
    const flip = rand() === 1;
    labels[draft.id] = { A: flip ? models[1] : models[0], B: flip ? models[0] : models[1] };
    results.push({ n: i + 1, id: draft.id, kind: draft.kind, depth_class: draft.depth?.class || null, draft_headline: draft.headline, versions });
  }
  const metrics = aggregate(results);
  fs.mkdirSync(path.join(out, 'raw'), { recursive: true });
  const stamp = { version: CANARY_VERSION, generated_at: new Date(now).toISOString(), dry, models_count: models.length, drafts: drafts.length };
  // Raw outputs are keyed by blinded label (model, response model, lane cap/effort and nominal cost stripped) so the
  // reviewer can open them without unblinding.
  for (const r of results) {
    const lab = labels[r.id];
    const blinded = { ...r, versions: ['A', 'B'].map((L) => { const v = r.versions.find((x) => x.model === lab[L]); const { model, response_model, max_output_tokens, reasoning_effort, nominal_standard_cost, ...rest } = v; return { label: `VERSION ${L}`, ...rest }; }) };
    fs.writeFileSync(path.join(out, 'raw', `${String(r.n).padStart(2, '0')}-${String(r.id).replace(/[^a-z0-9_-]/gi, '_')}.json`), JSON.stringify(blinded, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(out, 'drafts.frozen.json'), JSON.stringify(drafts, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'blind-review.md'), blindSheet(results, labels));
  // Per-model aggregates name the models, so they are sealed too (open after scoring).
  fs.writeFileSync(path.join(out, 'SEALED-metrics.json'), JSON.stringify({ ...stamp, warning: 'SEALED: names the models — open after scoring', note: 'per-model objective metrics; nominal cost is a standard-rate equivalent, never a billed amount', metrics }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'SEALED-model-key.json'), JSON.stringify({ ...stamp, warning: 'SEALED: do not open until every draft in blind-review.md is scored', labels, response_models: Object.fromEntries(results.map((r) => [r.id, Object.fromEntries(r.versions.map((v) => [v.model, v.response_model]))])) }, null, 2) + '\n');
  return { dir: out, results, metrics, labels, calls: dry ? transport.calls.length : null };
}
