// wnba-editorial-eligibility/1.0.0 — automatic paid OpenAI = genuinely NEW stories only. These tests drive the real
// editorial pass (editorial-pass.js) and the real editArticle/callModel, and count calls at the fetch transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEditorialGate, paidEligibility, reeditPlan, PENDING_NEW_STORY_MS } from '../workers/wnba-news/src/editorial-pass.js';
import { draftDigest } from '../workers/wnba-news/src/editorial-desk.js';
import { costUsd } from '../workers/wnba-news/src/openai-cost.js';
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
const NAMES = { players: ['Breanna Stewart', 'Napheesa Collier', 'Sabrina Ionescu'], teams: [{ name: 'New York Liberty', short_name: 'Liberty' }, { name: 'Minnesota Lynx', short_name: 'Lynx' }, { name: 'Las Vegas Aces', short_name: 'Aces' }] };

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
const fakeFetch = (responses) => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    if (r.status) return { ok: false, status: r.status, json: async () => ({ error: { message: r.message || 'boom' } }) };
    return { ok: true, status: 200, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: typeof r === 'string' ? r : JSON.stringify(r) }] }], usage: { input_tokens: 100, output_tokens: 50 } }) };
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
const story = (i, extra = {}) => ({ ...structuredClone(DRAFT), id: `story${String(i).padStart(3, '0')}abcdef`, ...extra });
function harness({ prior = [], stored = {}, options = null, env = {}, assess = passAll, fetch, kv = memKV() }) {
  const held = []; const publishable = []; const errors = [];
  const gate = makeEditorialGate({
    env: { ...ENV, NEWS_KV: kv, ...env }, started: new Date().toISOString(), now: Date.now(), priorIndex: prior, priorIds: new Set(prior.map((c) => c.id)),
    getStored: async (id) => (stored[id] ? structuredClone(stored[id]) : null), withSlug: async (a) => ({ ...a, slug: a.slug || a.id }), assessCandidate: assess,
    stampAssessment: (a, r) => { a.gate = { failures: r.failures }; a.reconcile = { failures: [] }; a.depth = { class: 'full', score: 1, words: 100 }; a.status = r.failures.length ? 'held' : 'published'; return a; },
    slugFor: (a) => a.id, sectionKey, names: NAMES, held, publishable, errors, editorialOptions: options, fetchImpl: fetch,
    findPredecessor: (a, cards) => ({ prev: cards.find((c) => c.id === a.id) || null }), listedCard: () => true, lateCoverage: () => null
  });
  return { ...gate, held, publishable, errors, kv };
}
// An existing catalog: `n` published stories, each stored with `editorialOf(story)`; `draft` is this pass's draft.
async function catalog(n, editorialOf = () => undefined, { from = 0, draft = (s) => s } = {}) {
  const prior = []; const stored = {}; const drafts = [];
  for (let i = from; i < from + n; i++) {
    const s = story(i);
    prior.push({ id: s.id, kind: s.kind, status: 'published' });
    const ed = await editorialOf(s);
    stored[s.id] = { ...s, ...(ed ? { editorial: ed.record, ...(ed.rewrite ? { headline: GOOD.headline, deck: GOOD.deck, editorial_draft: { headline: s.headline } } : {}) } : {}) };
    drafts.push(draft(structuredClone(s)));
  }
  return { prior, stored, drafts };
}
const applied = (version = 'wnba-editorial/1.0.0', digest = 'old-digest') => async () => ({ record: { provider: 'openai', status: 'applied', version, draft_digest: digest, at: '2026-09-28T00:00:00Z' }, rewrite: true });

test('A: 50 existing stories with NO editorial record -> 0 OpenAI calls, deterministic maintenance', async () => {
  const f = fakeFetch([GOOD]);
  const { prior, stored, drafts } = await catalog(50);
  const h = harness({ prior, stored, fetch: f });
  const out = await h.gateMany(drafts);
  assert.equal(f.calls.length, 0);
  assert.equal(h.edStats.eligibility.existing_revision_candidates, 50);
  assert.equal(h.edStats.eligibility.existing_revision_openai_calls, 0);
  assert.ok(out.every((a) => a.status === 'published' && a.editorial.status === 'deterministic_revision' && a.editorial.previous === null));
});

test('B: 50 existing stories on an OLD desk version -> 0 calls; the published rewrite and its version stay intact', async () => {
  const f = fakeFetch([GOOD]);
  const { prior, stored, drafts } = await catalog(50, applied('wnba-editorial/0.9.0'));
  const h = harness({ prior, stored, fetch: f });
  const out = await h.gateMany(drafts);
  assert.equal(f.calls.length, 0);
  assert.ok(out.every((a) => a.headline === GOOD.headline && a.editorial.version === 'wnba-editorial/0.9.0'));
  assert.equal(h.edStats.kept_published_rewrite, 50);
});

test('C: existing story whose draft digest AND facts changed -> 0 automatic calls; deterministic revision keeps provenance', async () => {
  const f = fakeFetch([GOOD]);
  const { prior, stored, drafts } = await catalog(1, applied(), { draft: (s) => ({ ...s, facts: { scores: { w: 93, l: 75, margin: 18 } }, body: [...s.body.slice(0, 4), 'Next up: Game 2.'] }) });
  const h = harness({ prior, stored, fetch: f });
  const [a] = await h.gateMany(drafts);
  assert.equal(f.calls.length, 0);
  assert.equal(a.status, 'published'); assert.equal(a.headline, DRAFT.headline);
  assert.equal(a.editorial.status, 'deterministic_revision'); assert.equal(a.editorial.previous.status, 'applied');
});

test('D: existing story gains a new code-built visual -> 0 calls; the rewrite stands with the new visual', async () => {
  const f = fakeFetch([GOOD]);
  const visuals = [{ kind: 'player_dna', id: 'v1' }];
  const { prior, stored, drafts } = await catalog(1, applied(), { draft: (s) => ({ ...s, visuals }) });
  const h = harness({ prior, stored, fetch: f });
  const [a] = await h.gateMany(drafts);
  assert.equal(f.calls.length, 0);
  assert.equal(a.headline, GOOD.headline); assert.deepEqual(a.visuals, visuals);
});

test('E: the legacy upgrade pass rebuilds 40 stories -> 0 calls (no transport path, even for an unseen id)', async () => {
  const f = fakeFetch([GOOD]);
  const { prior, stored, drafts } = await catalog(40);
  const h = harness({ prior, stored, fetch: f });
  await h.gateMany([...drafts, story(900)], { allowEditorial: false });
  assert.equal(f.calls.length, 0);
  assert.equal(h.edStats.eligibility.legacy_upgrade_candidates, 41);
  assert.equal(h.edStats.eligibility.legacy_upgrade_openai_calls, 0);
});

test('F: 1 genuinely new story + 50 old upgrade candidates -> exactly 1 call, logged as new_story', async () => {
  const f = fakeFetch([GOOD]);
  const { prior, stored, drafts } = await catalog(50, applied('wnba-editorial/0.9.0'));
  const h = harness({ prior, stored, fetch: f });
  const out = await h.gateMany([story(500), ...drafts]);
  assert.equal(f.calls.length, 1);
  assert.equal(out[0].editorial.status, 'applied'); assert.equal(out[0].editorial.eligibility, 'new_story');
  assert.equal(h.edStats.eligibility.new_story_openai_calls, 1);
  assert.equal(h.edStats.eligibility.existing_revision_openai_calls, 0);
  const log = JSON.parse([...h.kv.m.entries()].find(([k]) => k.startsWith('openai:v1:calls:'))[1]);
  assert.deepEqual(log.map((c) => [c.trigger, c.attempt]), [['new_story', 1]]);
});

test('G: 2 new stories -> 2 calls; a 3rd is deferred and keeps its ONE call for the next pass', async () => {
  const f = fakeFetch([GOOD]);
  const h = harness({ fetch: f });
  const out = await h.gateMany([story(600), story(601), story(602)]);
  assert.equal(f.calls.length, 2);
  const deferred = out.find((a) => a.editorial.status === 'deferred');
  assert.equal(deferred.editorial.pending_new_story, true);
  // next pass: the deferred new story is stored and listed — it still gets its one call; the 2 applied ones get none
  const prior = out.map((a) => ({ id: a.id, kind: a.kind, status: 'published' }));
  const stored = Object.fromEntries(out.map((a) => [a.id, a]));
  const f2 = fakeFetch([GOOD]);
  const h2 = harness({ prior, stored, fetch: f2 });
  await h2.gateMany([story(600), story(601), story(602)]);
  assert.equal(f2.calls.length, 1);
  // a pending new story past 24h is ordinary maintenance
  assert.equal(paidEligibility({ existing: true, pe: { status: 'deferred', pending_new_story: true, pending_since: new Date(Date.now() - PENDING_NEW_STORY_MS - 1).toISOString() } }).paid, false);
});

test('H: a new story whose rewrite fails the gates -> 1 call, deterministic fallback, NO paid repair', async () => {
  const f = fakeFetch([GOOD, GOOD]);
  const assess = (a) => (a.headline === GOOD.headline ? { failures: ['depth: invented detail'], depth: { elements: [] } } : passAll());
  const h = harness({ fetch: f, assess, env: { WNBA_EDITORIAL_ATTEMPTS: '2' } });
  const [a] = await h.gateMany([story(700)]);
  assert.equal(f.calls.length, 1);
  assert.equal(a.status, 'published'); assert.equal(a.headline, DRAFT.headline); assert.equal(a.editorial.status, 'fallback');
});

test('I: explicit admin re-edit of an existing story -> 1 call (manual_reedit); the same draft is not bought twice that day', async () => {
  const kv = memKV();
  const opts = { only: new Set([story(1).id]), force: true, maxCalls: 1 };
  const { prior, stored, drafts } = await catalog(3, applied());
  const f = fakeFetch([GOOD]);
  const h = harness({ prior, stored, fetch: f, options: opts, kv });
  await h.gateMany(drafts);
  assert.equal(f.calls.length, 1);
  assert.equal(h.edStats.eligibility.manual_reedit_calls, 1);
  const f2 = fakeFetch([GOOD]);
  await harness({ prior, stored, fetch: f2, options: opts, kv }).gateMany(drafts);
  assert.equal(f2.calls.length, 0);
});

test('J: EDITORIAL_DESK_VERSION changes over a mixed existing catalog -> 0 existing-story calls', async () => {
  const f = fakeFetch([GOOD]);
  const mixed = async (s) => {
    const n = Number(s.id.slice(5, 8));
    if (n % 3 === 0) return undefined;
    return applied(n % 2 ? 'wnba-editorial/0.8.0' : 'wnba-editorial/1.0.0', n % 4 ? 'stale' : await draftDigest(s))();
  };
  const { prior, stored, drafts } = await catalog(30, mixed, { draft: (s) => (Number(s.id.slice(5, 8)) % 5 ? s : { ...s, facts: { scores: { w: 88, l: 80, margin: 8 } } }) });
  const h = harness({ prior, stored, fetch: f, env: { WNBA_EDITORIAL_MAX_CALLS: '50' } });
  await h.gateMany(drafts);
  assert.equal(f.calls.length, 0);
  assert.equal(h.edStats.eligibility.existing_revision_openai_calls, 0);
});

test('breaker default is $1/day and automatic attempts are pinned to 1 whatever the env says', () => {
  const h = harness({ fetch: fakeFetch([GOOD]), env: { WNBA_EDITORIAL_ATTEMPTS: '2' } });
  assert.equal(h.edBudget.dailyMaxUsd, 1);
  assert.equal(h.edBudget.attempts, 1);
});

test('manual backfill plan: explicit ids, explicit max, confirmed cost estimate — or nothing runs', () => {
  assert.equal(reeditPlan({ ids: [], max: 1, costUsd }).ok, false);
  assert.equal(reeditPlan({ ids: ['all'], max: 1, costUsd }).ok, false);
  assert.equal(reeditPlan({ ids: ['abcdef123456'], costUsd }).ok, false);
  assert.equal(reeditPlan({ ids: ['abcdef123456', 'bcdef1234567'], max: 1, costUsd }).ok, false);
  const p = reeditPlan({ ids: ['abcdef123456'], max: 1, costUsd });
  assert.equal(p.ok, true); assert.equal(p.confirmed, false); assert.ok(p.estimate_usd > 0);
  assert.equal(reeditPlan({ ids: ['abcdef123456'], max: 1, confirmUsd: String(p.estimate_usd), costUsd }).confirmed, true);
});
