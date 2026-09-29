// wnba-ai-router/1.0.0 (Newsroom V4 stage 2) — lanes, trigger allow-list, pools, rates, flagship gating, per-call
// telemetry written immediately, and the id-drift fix (transaction / brief canonical story key). These tests drive the
// real editorial pass and the real editArticle/callModel, and count calls at the fetch transport. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { route, aiConfig, poolOf, flagshipEligibility, nominalStandardCost, laneEnv, reachesTransport, LANES, DEFAULT_POOLS, ROUTER_VERSION } from '../workers/wnba-news/src/ai-router.js';
import { makeEditorialGate } from '../workers/wnba-news/src/editorial-pass.js';
import { callModel } from '../workers/wnba-news/src/editorial-desk.js';
import { callEntry, costReport, callLogWriter, governanceState } from '../workers/wnba-news/src/openai-cost.js';
import { findPredecessor, canonicalStoryKey } from '../workers/wnba-news/src/lifecycle.js';
import { sectionKey } from '../workers/wnba-news/src/depth.js';

const DRAFT = {
  id: 'abc123def456', kind: 'result', category: 'Results', primary_subject: 'Liberty',
  headline: 'Breanna Stewart’s 34 points lead the Liberty past the Lynx in Game 1, 91–75',
  deck: 'Breanna Stewart set the pace with 34 points in a 16-point Liberty win.',
  body: [
    'Breanna Stewart led the Liberty with 34 points and 12 rebounds as the New York Liberty beat the Minnesota Lynx 91–75 on Sunday, September 27. Game 1 of the first round: the Liberty lead the best-of-three series 1–0.',
    'Breanna Stewart: 34 points and 12 rebounds on 11-of-18 shooting in 38 minutes.',
    'The second quarter was the swing — the Liberty won it 28–14 — and they led 50–37 at halftime.',
    'The Liberty made 34-70 from the field (49%); rebounds went 40–31.',
    'Next up: Game 2, MIN at NY on Sep 30. Player props enter the board inside 36 hours of tip.'
  ],
  sections: [{ title: 'Game story', first: 0, count: 1 }, { title: 'Who stood out', first: 1, count: 1 }, { title: 'How it happened', first: 2, count: 2 }, { title: 'What it means', first: 4, count: 1 }],
  entities: [{ type: 'team', id: '9', name: 'New York Liberty' }, { type: 'team', id: '8', name: 'Minnesota Lynx' }, { type: 'player', id: '1', name: 'Breanna Stewart' }],
  evidence: [{ kind: 'record', source: 'ESPN box score', record: { final: 'NY 91 - MIN 75' } }],
  facts: { scores: { w: 91, l: 75, margin: 16 } }
};
const NAMES = { players: ['Breanna Stewart'], teams: [{ name: 'New York Liberty', short_name: 'Liberty' }, { name: 'Minnesota Lynx', short_name: 'Lynx' }] };
const GOOD = {
  headline: 'Breanna Stewart’s 34 points put the Liberty one win from knocking out the Lynx',
  deck: 'New York took Game 1 91–75 in Minnesota and leads the best-of-three series 1–0.',
  sections: [
    { key: 'lede', title: 'Game 1 goes to New York', paragraphs: ['The New York Liberty beat the Minnesota Lynx 91–75 on Sunday, September 27, behind 34 points and 12 rebounds from Breanna Stewart. Game 1 of the first round belongs to the Liberty, who lead the best-of-three series 1–0.'] },
    { key: 'performers', title: 'Stewart set the terms', paragraphs: ['Stewart finished with 34 points and 12 rebounds on 11-of-18 shooting in 38 minutes.'] },
    { key: 'flow', title: 'Where it turned', paragraphs: ['The second quarter decided it: New York won the period 28–14 and went to halftime ahead 50–37.', 'The Liberty shot 34-70 from the field (49%) and won the rebounding battle 40–31.'] },
    { key: 'context', title: 'What comes next', paragraphs: ['Next up: Game 2, MIN at NY on Sep 30. Player props enter the board inside 36 hours of tip.'] }
  ]
};
const USAGE = { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 120 } };
// responses: a rewrite object, an Error (thrown), { status } (HTTP error), or { body } (a raw response body)
const fakeFetch = (responses, { onCall = null } = {}) => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (onCall) await onCall(calls.length);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    if (r.status) return { ok: false, status: r.status, json: async () => ({ error: { message: 'boom' } }) };
    if (r.body) return { ok: true, status: 200, json: async () => r.body };
    return { ok: true, status: 200, json: async () => ({ id: `resp_${calls.length}`, model: `${JSON.parse(init.body).model}-2026-09-01`, status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(r) }] }], usage: USAGE }) };
  };
  f.calls = calls;
  return f;
};
const ENV = { OPENAI_API_KEY: 'sk-test-secret-value-123456' };
const passAll = () => ({ failures: [], depth: { elements: [] } });
const memKV = () => {
  const m = new Map();
  return { m, get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); } };
};
const logOf = (kv) => JSON.parse([...kv.m.entries()].find(([k]) => k.startsWith('openai:v1:calls:'))?.[1] || '[]');
const story = (i, extra = {}) => ({ ...structuredClone(DRAFT), id: `story${String(i).padStart(3, '0')}abcdef`, ...extra });
function harness({ prior = [], stored = {}, options = null, env = {}, assess = passAll, fetch, kv = memKV(), realPredecessor = false, depth = 'full' }) {
  const held = []; const publishable = []; const errors = [];
  const gate = makeEditorialGate({
    env: { ...ENV, NEWS_KV: kv, ...env }, started: new Date().toISOString(), now: Date.now(), priorIndex: prior, priorIds: new Set(prior.map((c) => c.id)),
    getStored: async (id) => (stored[id] ? structuredClone(stored[id]) : null), withSlug: async (a) => ({ ...a, slug: a.slug || a.id }), assessCandidate: assess,
    stampAssessment: (a, r) => { a.gate = { failures: r.failures }; a.reconcile = { failures: [] }; a.depth = { class: depth, score: 1, words: 100 }; a.status = r.failures.length ? 'held' : 'published'; return a; },
    slugFor: (a) => a.id, sectionKey, names: NAMES, held, publishable, errors, editorialOptions: options, fetchImpl: fetch,
    ...(realPredecessor ? {} : { findPredecessor: (a, cards) => ({ prev: cards.find((c) => c.id === a.id) || null }) }), listedCard: () => true, lateCoverage: () => null
  });
  return { ...gate, held, publishable, errors, kv };
}
const FINALS = { playoff: { round: 'WNBA Finals', game_number: 3, decided_by_this_game: false, stakes: {} } };

// ---------------------------------------------------------------- router: lanes, allow-list, pools, rates

test('router: a new story routes STANDARD_EDITORIAL on gpt-5.6-sol (premium pool, 5k output, medium effort)', () => {
  const r = route({ story: story(1), trigger: 'new_story' });
  assert.equal(r.lane, LANES.STANDARD); assert.equal(r.model, 'gpt-5.6-sol'); assert.equal(r.pool, 'premium');
  assert.equal(r.max_output_tokens, 5000); assert.equal(r.reasoning_effort, 'medium'); assert.equal(r.router_version, ROUTER_VERSION);
  assert.equal(ROUTER_VERSION, 'wnba-ai-router/1.0.0');
  // standard model fallbacks: WNBA_AI_STANDARD_MODEL > WNBA_EDITORIAL_MODEL > default
  assert.equal(route({ story: story(1), trigger: 'new_story', env: { WNBA_EDITORIAL_MODEL: 'gpt-6-sol' } }).model, 'gpt-6-sol');
  assert.equal(route({ story: story(1), trigger: 'new_story', env: { WNBA_EDITORIAL_MODEL: 'gpt-6-sol', WNBA_AI_STANDARD_MODEL: 'gpt-6-luna' } }).model, 'gpt-6-luna');
  assert.equal(route({ story: story(1), trigger: 'manual_reedit' }).lane, LANES.STANDARD);
  assert.equal(route({ story: story(1), trigger: 'canary' }).lane, LANES.STANDARD);
  assert.equal(route({ story: story(1), trigger: 'new_story', hasKey: false }).lane, LANES.DETERMINISTIC);
});

test('router: trigger allow-list — revision / legacy / backfill / anything else is DETERMINISTIC, never a transport', () => {
  for (const t of ['existing_revision', 'legacy_upgrade', 'revision', 'backfill', 'version_upgrade', 'correction', 'nope']) {
    const r = route({ story: story(1, { facts: FINALS }), trigger: t, env: { WNBA_AI_FLAGSHIP_ENABLED: 'true', WNBA_AI_FLAGSHIP_CLASSES: 'finals_result' } });
    assert.equal(r.lane, LANES.DETERMINISTIC, t); assert.equal(r.model, null); assert.equal(r.pool, 'none');
    assert.equal(r.reason, `trigger_not_eligible:${t}`);
    assert.equal(reachesTransport(r), false);
    assert.throws(() => laneEnv(ENV, r), /never reaches a model transport/);
  }
  // repair only as attempt 2 of an explicit re-edit or canary
  assert.equal(route({ story: story(1), trigger: 'repair', attempt: 2, parentTrigger: 'canary' }).lane, LANES.STANDARD);
  assert.equal(route({ story: story(1), trigger: 'repair', attempt: 2, parentTrigger: 'manual_reedit' }).lane, LANES.STANDARD);
  assert.equal(route({ story: story(1), trigger: 'repair', attempt: 2, parentTrigger: 'new_story' }).lane, LANES.DETERMINISTIC);
  assert.equal(route({ story: story(1), trigger: 'repair', attempt: 1, parentTrigger: 'canary' }).lane, LANES.DETERMINISTIC);
  assert.equal(route({ story: story(1), trigger: 'repair', attempt: 2, parentTrigger: 'legacy_upgrade' }).reason, 'trigger_not_eligible:repair');
});

test('router: pool mapping — premium vs volume, unknown = premium, WNBA_AI_POOLS override, bad JSON ignored', () => {
  const cfg = aiConfig({});
  for (const m of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol']) assert.equal(poolOf(m, cfg), 'premium', m);
  for (const m of ['gpt-5.4-mini', 'gpt-5.4-nano']) assert.equal(poolOf(m, cfg), 'volume', m);
  assert.equal(poolOf('gpt-7-unknown', cfg), 'premium');
  assert.equal(poolOf(null, cfg), 'none');
  assert.equal(Object.keys(DEFAULT_POOLS).length, 6);
  assert.equal(poolOf('gpt-6-luna', aiConfig({ WNBA_AI_POOLS: '{"gpt-6-luna":"volume"}' })), 'volume');
  assert.equal(poolOf('gpt-6-luna', aiConfig({ WNBA_AI_POOLS: '{not json' })), 'premium');
  assert.equal(aiConfig({}).volumeModel, 'gpt-5.4-mini');
});

test('router: nominal rates — only gpt-5.6-sol priced by default (cached input at cached rate); others null until WNBA_AI_RATES', () => {
  const u = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 300 };
  // 600 * 1.25 + 400 * 0.125 + 300 * 10 = 750 + 50 + 3000 = 3800 per 1e6
  assert.equal(nominalStandardCost('gpt-5.6-sol', u, aiConfig({})), 0.0038);
  assert.equal(nominalStandardCost('gpt-6-astra', u, aiConfig({})), null);
  assert.equal(nominalStandardCost('gpt-6-astra', u, aiConfig({ WNBA_AI_RATES: '{"gpt-6-astra":{"input":5,"cached_input":0.5,"output":40}}' })), 0.0152);
});

test('router: flagship is OFF by default; enabled alone is not enough — the class must be released', () => {
  const s = story(1, { facts: FINALS, depth: { class: 'full' } });
  assert.equal(flagshipEligibility(s).id, 'finals_result');
  const off = route({ story: s, trigger: 'new_story' });
  assert.equal(off.lane, LANES.STANDARD); assert.equal(off.model, 'gpt-5.6-sol'); assert.equal(off.flagship_eligible, true);
  assert.match(off.reason, /WNBA_AI_FLAGSHIP_ENABLED is off/);
  const unreleased = route({ story: s, trigger: 'new_story', env: { WNBA_AI_FLAGSHIP_ENABLED: 'true' } });
  assert.equal(unreleased.lane, LANES.STANDARD); assert.match(unreleased.reason, /not released/);
  const on = route({ story: s, trigger: 'new_story', env: { WNBA_AI_FLAGSHIP_ENABLED: 'true', WNBA_AI_FLAGSHIP_CLASSES: 'finals_result' } });
  assert.equal(on.lane, LANES.FLAGSHIP); assert.equal(on.model, 'gpt-6-astra'); assert.equal(on.pool, 'premium'); assert.equal(on.max_output_tokens, 8000);
  assert.equal(route({ story: s, trigger: 'new_story', env: { WNBA_AI_FLAGSHIP_ENABLED: 'TRUE', WNBA_AI_FLAGSHIP_CLASSES: 'finals_result' } }).lane, LANES.STANDARD, 'only the exact string "true" enables');
  // a routine story is never flagship even with every class released
  assert.equal(route({ story: story(2, { depth: { class: 'full' } }), trigger: 'new_story', env: { WNBA_AI_FLAGSHIP_ENABLED: 'true', WNBA_AI_FLAGSHIP_CLASSES: 'finals_result,series_clinch_result,decider_preview,major_trend_episode,rich_packet' } }).lane, LANES.STANDARD);
});

test('router: flagship eligibility classes are deterministic from stored facts and kind', () => {
  const deep = { class: 'deep' };
  assert.equal(flagshipEligibility({ kind: 'result', depth: { class: 'brief' }, facts: FINALS }).eligible, false, 'thin Finals packet');
  assert.equal(flagshipEligibility({ kind: 'result', depth: { class: 'full' }, facts: { playoff: { round: 'Semifinals', decided_by_this_game: false } } }).eligible, false);
  assert.equal(flagshipEligibility({ kind: 'performance', depth: deep, facts: { playoff: { round: 'Semifinals', decided_by_this_game: true } } }).id, 'series_clinch_result');
  assert.equal(flagshipEligibility({ kind: 'preview', depth: { class: 'full' }, facts: { playoff: { round: 'Semifinals', stakes: { 1: 'decider', 2: 'decider' } } } }).id, 'decider_preview');
  assert.equal(flagshipEligibility({ kind: 'preview', depth: { class: 'full' }, facts: { playoff: { round: 'Semifinals', stakes: { 1: 'closeout', 2: 'elimination' } } } }).eligible, false);
  assert.equal(flagshipEligibility({ kind: 'trend', depth: deep, facts: { atsW: 9, atsL: 1, n: 10, materiality: { material: true, big: 4 } } }).id, 'major_trend_episode');
  assert.equal(flagshipEligibility({ kind: 'trend', depth: deep, facts: { atsW: 7, atsL: 3, n: 10, materiality: { material: true, big: 2 } } }).eligible, false);
  const ev = Array.from({ length: 8 }, (_, i) => ({ kind: 'record', source: `r${i}` }));
  assert.equal(flagshipEligibility({ kind: 'injury', depth: deep, evidence: ev }).id, 'rich_packet');
  assert.equal(flagshipEligibility({ kind: 'injury', depth: deep, evidence: [...ev.slice(0, 7), { kind: 'publisher_report' }] }).eligible, false);
});

// ---------------------------------------------------------------- the pass: routing reaches the transport

test('pass: a new story is routed STANDARD — the transport receives the lane model, effort and 5k cap; one call', async () => {
  const f = fakeFetch([GOOD]);
  const h = harness({ fetch: f });
  const [a] = await h.gateMany([story(100)]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.model, 'gpt-5.6-sol'); assert.equal(f.calls[0].body.max_output_tokens, 5000); assert.equal(f.calls[0].body.reasoning.effort, 'medium');
  assert.equal(a.editorial.status, 'applied'); assert.equal(a.editorial.routing.lane, LANES.STANDARD); assert.equal(a.editorial.routing.pool, 'premium');
  assert.equal(h.edStats.routing.lanes.STANDARD_EDITORIAL, 1);
});

test('pass: flagship enabled + released class -> gpt-6-astra with its own cap; flagship off by default keeps Sol', async () => {
  const f = fakeFetch([GOOD]);
  await harness({ fetch: f }).gateMany([story(101, { facts: { ...DRAFT.facts, ...FINALS } })]);
  assert.equal(f.calls[0].body.model, 'gpt-5.6-sol');
  const f2 = fakeFetch([GOOD]);
  const h2 = harness({ fetch: f2, env: { WNBA_AI_FLAGSHIP_ENABLED: 'true', WNBA_AI_FLAGSHIP_CLASSES: 'finals_result' } });
  const [a] = await h2.gateMany([story(102, { facts: { ...DRAFT.facts, ...FINALS } })]);
  assert.equal(f2.calls.length, 1);
  assert.equal(f2.calls[0].body.model, 'gpt-6-astra'); assert.equal(f2.calls[0].body.max_output_tokens, 8000);
  assert.equal(a.editorial.model, 'gpt-6-astra'); assert.equal(a.editorial.routing.flagship_class, 'finals_result');
  const [c] = logOf(h2.kv);
  assert.equal(c.routing_lane, LANES.FLAGSHIP); assert.equal(c.model, 'gpt-6-astra'); assert.equal(c.nominal_standard_cost, null, 'no configured Astra rate -> null, never invented');
});

test('pass: existing revisions and the legacy pass route DETERMINISTIC — zero calls on the model transport', async () => {
  const f = fakeFetch([GOOD]);
  const prior = [story(1), story(2)].map((s) => ({ id: s.id, kind: s.kind, status: 'published' }));
  const stored = Object.fromEntries([story(1), story(2)].map((s) => [s.id, s]));
  const env = { WNBA_AI_FLAGSHIP_ENABLED: 'true', WNBA_AI_FLAGSHIP_CLASSES: 'finals_result,rich_packet' };
  const h = harness({ prior, stored, fetch: f, env });
  await h.gateMany([story(1, { facts: FINALS }), story(2)]);
  const h2 = harness({ prior, stored, fetch: f, env });
  await h2.gateMany([story(1), story(3)], { allowEditorial: false });
  assert.equal(f.calls.length, 0);
  assert.equal(h.edStats.routing.lanes.DETERMINISTIC, 2);
  assert.equal(h.edStats.routing.reasons['trigger_not_eligible:existing_revision'], 2);
  assert.equal(h2.edStats.routing.reasons['trigger_not_eligible:legacy_upgrade'], 2);
});

test('pass: ONE automatic attempt — a failed rewrite is not repaired even with WNBA_EDITORIAL_ATTEMPTS=2', async () => {
  const f = fakeFetch([GOOD, GOOD]);
  const assess = (a) => (a.headline === GOOD.headline ? { failures: ['depth: invented detail'], depth: { elements: [] } } : passAll());
  const h = harness({ fetch: f, assess, env: { WNBA_EDITORIAL_ATTEMPTS: '2' } });
  const [a] = await h.gateMany([story(103)]);
  assert.equal(f.calls.length, 1); assert.equal(h.edBudget.attempts, 1);
  assert.equal(a.editorial.status, 'fallback'); assert.equal(a.headline, DRAFT.headline);
  assert.deepEqual(logOf(h.kv).map((c) => [c.trigger, c.attempt]), [['new_story', 1]]);
});

test('pass: an explicit canary repair is attempt 2 only, logged as repair with its routing', async () => {
  const f = fakeFetch([GOOD, GOOD]);
  let n = 0;
  const assess = (a) => (a.headline === GOOD.headline && (n += 1) === 1 ? { failures: ['depth: invented detail'], depth: { elements: [] } } : passAll());
  const s = story(104);
  const h = harness({ prior: [{ id: s.id, kind: s.kind, status: 'published' }], stored: { [s.id]: s }, fetch: f, assess, options: { only: new Set([s.id]), force: true, canary: true, attempts: 2, maxCalls: 1 } });
  await h.gateMany([s]);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(logOf(h.kv).map((c) => [c.trigger, c.attempt, c.routing_lane]), [['canary', 1, 'STANDARD_EDITORIAL'], ['repair', 2, 'STANDARD_EDITORIAL']]);
});

// ---------------------------------------------------------------- telemetry

test('telemetry: every call records sport, story class, lane, reason, pool, reasoning tokens, latency, response model, status', async () => {
  const f = fakeFetch([GOOD]);
  const h = harness({ fetch: f });
  await h.gateMany([story(105)]);
  const [c] = logOf(h.kv);
  assert.equal(c.sport, 'wnba'); assert.equal(c.story_class, 'result'); assert.equal(c.routing_lane, 'STANDARD_EDITORIAL');
  assert.match(c.routing_reason, /^standard: /); assert.equal(c.pool, 'premium'); assert.equal(c.router_version, ROUTER_VERSION);
  assert.equal(c.input_tokens, 1000); assert.equal(c.cached_input_tokens, 400); assert.equal(c.output_tokens, 300); assert.equal(c.reasoning_tokens, 120);
  assert.ok(Number.isFinite(c.latency_ms) && c.latency_ms >= 0);
  assert.equal(c.response_model, 'gpt-5.6-sol-2026-09-01'); assert.equal(c.model, 'gpt-5.6-sol'); assert.equal(c.status, 'completed');
  assert.equal(c.nominal_standard_cost, 0.0038, 'cached input priced at the cached rate');
  assert.equal(c.total_eligible_tokens, 1300);
  assert.ok(!('billed_cost' in c) && !JSON.stringify(c).includes('billed'));
  assert.ok(!JSON.stringify(c).includes('sk-test'));
});

test('telemetry: billed usage on an incomplete response is recorded, not zeroed (and the draft still publishes)', async () => {
  const incomplete = { body: { id: 'resp_inc', model: 'gpt-5.6-sol-2026-09-01', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 2000, output_tokens: 5000, output_tokens_details: { reasoning_tokens: 4800 } } } };
  const f = fakeFetch([incomplete]);
  const h = harness({ fetch: f });
  const [a] = await h.gateMany([story(106)]);
  assert.equal(a.status, 'published'); assert.equal(a.editorial.status, 'fallback'); assert.equal(a.headline, DRAFT.headline);
  const [c] = logOf(h.kv);
  assert.equal(c.status, 'incomplete'); assert.match(c.error, /incomplete/);
  assert.equal(c.input_tokens, 2000); assert.equal(c.output_tokens, 5000); assert.equal(c.reasoning_tokens, 4800); assert.equal(c.response_id, 'resp_inc');
  assert.equal(h.edStats.usage.output_tokens, 5000);
  // a transport error has no body: 0 tokens with its status
  const t = await callModel(ENV, { input: 'x', schema: {}, timeoutMs: 1000, fetchImpl: async () => { throw new Error('socket hang up'); } }).catch((e) => e);
  assert.equal(t.call.status, 'transport_error'); assert.equal(t.call.usage, null);
  const http = await callModel(ENV, { input: 'x', schema: {}, timeoutMs: 1000, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate' } }) }) }).catch((e) => e);
  assert.equal(http.call.status, 'http_429');
});

test('telemetry: each entry is written IMMEDIATELY after its call (the 2nd call sees the 1st already in KV)', async () => {
  const kv = memKV();
  const seen = [];
  const f = fakeFetch([GOOD], { onCall: async (n) => { seen.push(logOf(kv).length); } });
  const h = harness({ fetch: f, kv, env: { WNBA_EDITORIAL_CONCURRENCY: '1' } });
  await h.gateMany([story(107), story(108)]);
  assert.deepEqual(seen, [0, 1]);
  assert.equal(logOf(kv).length, 2);
});

test('telemetry: the call-log writer serializes concurrent appends and retries a failed write at flush', async () => {
  const kv = memKV();
  let fail = 1;
  const put = kv.put;
  kv.put = async (k, v) => { if (fail > 0) { fail -= 1; throw new Error('kv 503'); } return put(k, v); };
  const w = callLogWriter(kv, '2026-09-29T10:00:00Z');
  const e = (i) => callEntry({ worker: 'wnba-news', id: `s${i}`, model: 'gpt-5.6-sol', trigger: 'new_story', attempt: 1, input_tokens: 10, output_tokens: 5, at: 'x' });
  await Promise.all([w.append(e(1)), w.append(e(2)), w.append(e(3))]);
  const r = await w.flush();
  assert.equal(r.pending, 0); assert.equal(r.written, 3); assert.equal(r.failures.length, 1);
  assert.deepEqual(logOf(kv).map((c) => c.id).sort(), ['s1', 's2', 's3']);
  // prior entries for the day are preserved
  const kv2 = memKV();
  kv2.m.set('openai:v1:calls:2026-09-29', JSON.stringify([{ id: 'old', input_tokens: 1, output_tokens: 1 }]));
  const w2 = callLogWriter(kv2, '2026-09-29T10:00:00Z');
  await w2.append(e(4)); await w2.append(e(5));
  assert.deepEqual(logOf(kv2).map((c) => c.id), ['old', 's4', 's5']);
});

test('telemetry: costReport groups by lane, pool and model; pre-2.1.0 entries are "unrouted"; unpriced calls still hit the emergency guard', () => {
  const r = (lane, model, pool) => ({ lane, model, pool, reason: 'x', router_version: ROUTER_VERSION });
  const calls = [
    callEntry({ worker: 'wnba-news', id: 'a', model: 'gpt-5.6-sol', trigger: 'new_story', attempt: 1, input_tokens: 1000, output_tokens: 100, routing: r('STANDARD_EDITORIAL', 'gpt-5.6-sol', 'premium'), at: 't' }),
    callEntry({ worker: 'wnba-news', id: 'b', model: 'gpt-6-astra', trigger: 'new_story', attempt: 1, input_tokens: 1000, output_tokens: 100, routing: r('FLAGSHIP_EDITORIAL', 'gpt-6-astra', 'premium'), at: 't' }),
    { worker: 'wnba-news', id: 'c', model: 'gpt-5.6-sol', trigger: 'new_story', attempt: 1, input_tokens: 10, output_tokens: 10, nominal_standard_cost: 0.0001, at: 't' }
  ];
  const rep = costReport(calls, '2026-09-29');
  assert.equal(rep.by_lane.STANDARD_EDITORIAL.calls, 1); assert.equal(rep.by_lane.FLAGSHIP_EDITORIAL.calls, 1); assert.equal(rep.by_lane.unrouted.calls, 1);
  assert.equal(rep.by_pool.premium.calls, 2); assert.equal(rep.by_pool.premium.eligible_tokens, 2200);
  assert.equal(rep.by_model['gpt-6-astra'].unpriced_calls, 1); assert.equal(rep.totals.unpriced_calls, 1);
  assert.match(rep.nominal_note, /not the billed amount/);
  // 1M Astra tokens with no configured rate still count toward the $25 nominal emergency ceiling (at the standard constant)
  const big = Array.from({ length: 3 }, () => callEntry({ worker: 'wnba-news', id: 'z', model: 'gpt-6-astra', trigger: 'new_story', attempt: 1, input_tokens: 1e6, output_tokens: 1e6, at: 't' }));
  assert.equal(governanceState(big, { WNBA_OPENAI_DAILY_TOKEN_SOFT_CAP: '0', WNBA_OPENAI_DAILY_TOKEN_WARN: '0' }).status, 'EMERGENCY_STOP');
});

// ---------------------------------------------------------------- id drift: canonical story key

const txn = (id, { team = '5', date = '2026-09-28T16:00:00Z', moves = ['Signed A'] } = {}) => ({
  ...structuredClone(DRAFT), id, kind: 'transaction', category: 'Transactions', lead_team_id: team, lead_player_id: null, published_at: date,
  facts: { moves }, headline: DRAFT.headline
});
const cardOfTxn = (a) => ({ id: a.id, kind: a.kind, status: 'published', lead_team_id: a.lead_team_id, lead_player_id: a.lead_player_id, published_at: a.published_at, first_published_at: a.published_at, entities: [] });

test('id drift: a transaction that gains a move the same day continues its story — 0 calls', async () => {
  const old = txn('txnold000001', { moves: ['Signed A'] });
  const f = fakeFetch([GOOD]);
  const h = harness({ prior: [cardOfTxn(old)], stored: { [old.id]: { ...old, editorial: { status: 'applied', draft_digest: 'x', version: 'wnba-editorial/1.0.0' } } }, fetch: f, realPredecessor: true });
  const [a] = await h.gateMany([txn('txnnew000002', { date: '2026-09-28T21:30:00Z', moves: ['Signed A', 'Waived B'] })]);
  assert.equal(f.calls.length, 0);
  assert.equal(a.editorial.status, 'deterministic_revision'); assert.equal(a.editorial.eligibility, 'existing_revision');
  assert.equal(findPredecessor(txn('txnnew000002'), [cardOfTxn(old)]).prev.id, old.id);
});

test('id drift: a genuinely new transaction (different team, or a different date) is a new story — 1 call each', async () => {
  const old = txn('txnold000001');
  for (const next of [txn('txnnew000003', { team: '6' }), txn('txnnew000004', { date: '2026-09-29T15:00:00Z' })]) {
    const f = fakeFetch([GOOD]);
    const h = harness({ prior: [cardOfTxn(old)], stored: { [old.id]: old }, fetch: f, realPredecessor: true });
    const [a] = await h.gateMany([next]);
    assert.equal(f.calls.length, 1, next.id);
    assert.equal(a.editorial.eligibility, 'new_story');
  }
});

const brief = (id, { player = '77', type = 'injury', at = '2026-09-28T12:00:00Z', team = '5' } = {}) => ({
  ...structuredClone(DRAFT), id, kind: 'brief', category: 'News Briefs', lead_player_id: player, lead_team_id: team, published_at: at,
  context: { brief: { cluster_id: `c_${id}`, event_type: type } }
});
const cardOfBrief = (a) => ({ ...cardOfTxn(a), event_type: a.context.brief.event_type });

test('id drift: a re-clustered brief (new cluster id, same event) continues its story — 0 calls', async () => {
  const old = brief('brfold000001');
  const f = fakeFetch([GOOD]);
  const h = harness({ prior: [cardOfBrief(old)], stored: { [old.id]: old }, fetch: f, realPredecessor: true });
  // availability vs injury wording is one event family (events.js factKey)
  const [a] = await h.gateMany([brief('brfnew000002', { type: 'availability', at: '2026-09-28T19:00:00Z' })]);
  assert.equal(f.calls.length, 0);
  assert.equal(a.editorial.eligibility, 'existing_revision');
});

test('id drift: a brief for another player, or the same player outside the 72h event window, stays a new story', async () => {
  const old = brief('brfold000001');
  assert.equal(findPredecessor(brief('brfnew000003', { player: '78' }), [cardOfBrief(old)]).prev, null);
  assert.equal(findPredecessor(brief('brfnew000004', { at: '2026-10-02T12:00:00Z' }), [cardOfBrief(old)]).prev, null);
  assert.equal(findPredecessor(brief('brfnew000005', { type: 'signing' }), [cardOfBrief(old)]).prev, null, 'a roster move is a different fact family');
  const f = fakeFetch([GOOD]);
  await harness({ prior: [cardOfBrief(old)], stored: { [old.id]: old }, fetch: f, realPredecessor: true }).gateMany([brief('brfnew000003', { player: '78' })]);
  assert.equal(f.calls.length, 1);
  // league-level briefs with no subject keep their cluster identity
  assert.equal(canonicalStoryKey({ kind: 'brief', event_type: 'cba', lead_player_id: null, lead_team_id: null }), null);
  assert.equal(canonicalStoryKey({ kind: 'brief', event_type: 'coaching', lead_player_id: null, lead_team_id: '5' }), 'brief:coaching:team:5');
  assert.equal(canonicalStoryKey({ kind: 'transaction', lead_team_id: '5', published_at: '2026-09-28T16:00:00Z' }), 'transaction:5:2026-09-28');
  assert.equal(canonicalStoryKey({ kind: 'result', lead_team_id: '5', published_at: '2026-09-28' }), null);
});

test('id drift: the merge keeps ONE transaction story (same id and URL) when the day gains a move', async () => {
  const { mergeArticles } = await import('../workers/wnba-news/src/lifecycle.js');
  const items = new Map();
  const cardOf = (a) => ({ id: a.id, slug: a.slug, kind: a.kind, status: 'published', headline: a.headline, deck: a.deck, lead_team_id: a.lead_team_id, lead_player_id: a.lead_player_id, published_at: a.published_at, updated_at: a.updated_at, entities: a.entities || [] });
  const run = (index, articles, started) => mergeArticles({ index, articles, started, getItem: async (id) => items.get(id) || null, putItem: async (a) => { items.set(a.id, structuredClone(a)); }, versionOf: () => 'test', cardOf });
  const first = await run([], [{ ...txn('txnold000001'), slug: 'first-slug', updated_at: '2026-09-28T16:05:00Z' }], '2026-09-28T16:05:00Z');
  assert.equal(first.novelty.new_story, 1);
  const second = await run(first.index, [{ ...txn('txnnew000002', { date: '2026-09-28T21:30:00Z', moves: ['Signed A', 'Waived B'] }), headline: `${DRAFT.headline} (updated)`, slug: 'second-slug', updated_at: '2026-09-28T21:35:00Z' }], '2026-09-28T21:35:00Z');
  assert.equal(second.novelty.new_story, 0); assert.equal(second.novelty.revision, 1);
  assert.deepEqual(second.index.map((c) => [c.id, c.slug]), [['txnold000001', 'first-slug']]);
});
