// Offline AI canary harness (scripts/ai-canary) — DRY MODE ONLY. No key, no network: the echo transport stands in for
// the model, and global fetch is trapped so any real call fails the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCanary, draftOfStored, repetitionScore, blindSheet } from '../scripts/ai-canary/harness.mjs';

const DRAFT = {
  id: 'abc123def456', kind: 'result', category: 'Results', primary_subject: 'Liberty',
  headline: 'Breanna Stewart’s 34 points lead the Liberty past the Lynx in Game 1, 91–75',
  deck: 'Breanna Stewart set the pace with 34 points in a 16-point Liberty win.',
  body: [
    'Breanna Stewart led the Liberty with 34 points and 12 rebounds as the New York Liberty beat the Minnesota Lynx 91–75 on Sunday, September 27.',
    'Breanna Stewart: 34 points and 12 rebounds on 11-of-18 shooting in 38 minutes.',
    'The second quarter was the swing — the Liberty won it 28–14 — and they led 50–37 at halftime.',
    'Next up: Game 2, MIN at NY on Sep 30.'
  ],
  sections: [{ title: 'Game story', first: 0, count: 1 }, { title: 'Who stood out', first: 1, count: 1 }, { title: 'How it happened', first: 2, count: 1 }, { title: 'What it means', first: 3, count: 1 }],
  entities: [{ type: 'team', id: '9', name: 'New York Liberty' }, { type: 'team', id: '8', name: 'Minnesota Lynx' }, { type: 'player', id: '1', name: 'Breanna Stewart' }],
  evidence: [{ kind: 'record', source: 'ESPN box score', record: { final: 'NY 91 - MIN 75' } }],
  facts: { scores: { w: 91, l: 75, margin: 16 } },
  depth: { class: 'full' }
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wnba-ai-canary-'));
const trapFetch = () => { const real = globalThis.fetch; let hits = 0; globalThis.fetch = async () => { hits += 1; throw new Error('network is forbidden in dry mode'); }; return { restore: () => { globalThis.fetch = real; }, get hits() { return hits; } }; };

test('canary --dry: full pipeline with no API — blinded sheet, sealed key, raw outputs, metrics', async () => {
  const trap = trapFetch();
  const out = tmp();
  try {
    const applied = { ...DRAFT, id: 'def456abc123', headline: 'An edited headline that must not be used as the draft', editorial: { status: 'applied' }, editorial_draft: { headline: DRAFT.headline, deck: DRAFT.deck, body: DRAFT.body, sections: DRAFT.sections } };
    const r = await runCanary({ drafts: [DRAFT, applied], dry: true, out, seed: 'test-seed' });
    assert.equal(trap.hits, 0, 'no network call in dry mode');
    assert.equal(r.calls, 4, 'two drafts x two models, one attempt each (echo transport)');
    const files = fs.readdirSync(out).sort();
    assert.deepEqual(files, ['SEALED-metrics.json', 'SEALED-model-key.json', 'blind-review.md', 'drafts.frozen.json', 'raw']);
    assert.equal(fs.readdirSync(path.join(out, 'raw')).length, 2);
    const sheet = fs.readFileSync(path.join(out, 'blind-review.md'), 'utf8');
    assert.match(sheet, /### VERSION A/); assert.match(sheet, /### VERSION B/);
    assert.ok(!/gpt-|astra|sol\b/i.test(sheet), 'model names never appear in the review sheet');
    for (const f of fs.readdirSync(path.join(out, 'raw'))) assert.ok(!/gpt-|astra/i.test(fs.readFileSync(path.join(out, 'raw', f), 'utf8')), `raw ${f} is blinded`);
    const key = JSON.parse(fs.readFileSync(path.join(out, 'SEALED-model-key.json'), 'utf8'));
    assert.deepEqual(new Set(Object.values(key.labels[DRAFT.id])), new Set(['gpt-5.6-sol', 'gpt-6-astra']));
    assert.equal(key.dry, true);
    // the applied story is canaried from its deterministic draft, not the published rewrite
    const res2 = r.results.find((x) => x.id === 'def456abc123');
    assert.equal(res2.draft_headline, DRAFT.headline);
    // metrics: fact gate pass (echo = the draft), words, repetition, sections, tokens, latency
    const v = r.results[0].versions[0];
    assert.equal(v.ok, true); assert.equal(v.fact_gate.pass, true, v.fact_gate.failures.join('; '));
    assert.equal(typeof v.quality_gate.pass, 'boolean');
    assert.equal(v.words, v.draft_words); assert.equal(v.sections, 4); assert.equal(v.repetition_score, repetitionScore(DRAFT.body), 'echo = the draft');
    assert.ok(v.usage.input_tokens > 0 && v.usage.output_tokens === 900 && v.usage.reasoning_tokens === 400);
    assert.ok(Number.isFinite(v.latency_ms));
    const m = JSON.parse(fs.readFileSync(path.join(out, 'SEALED-metrics.json'), 'utf8')).metrics;
    assert.equal(m['gpt-5.6-sol'].completed, 2); assert.equal(m['gpt-6-astra'].completed, 2);
    assert.match(String(m['gpt-6-astra'].nominal_standard_cost_usd), /not configured/);
    assert.equal(typeof m['gpt-5.6-sol'].nominal_standard_cost_usd, 'number');
    // the sealed key is the ONLY place the mapping lives; the same seed reproduces the order
    const r2 = await runCanary({ drafts: [DRAFT, applied], dry: true, out: tmp(), seed: 'test-seed' });
    assert.deepEqual(r2.labels, r.labels);
  } finally { trap.restore(); }
});

test('canary: a live run without a key refuses to start (never silently calls)', async () => {
  await assert.rejects(runCanary({ drafts: [DRAFT], dry: false, env: {}, out: tmp() }), /OPENAI_API_KEY is required/);
  await assert.rejects(runCanary({ drafts: [], dry: true, out: tmp() }), /no drafts/);
});

test('canary helpers: repetition score, draft reconstruction, sheet blinding', () => {
  assert.equal(repetitionScore(['one two three four five six']), 0);
  assert.ok(repetitionScore(['one two three four five', 'one two three four five']) > 0);
  assert.equal(draftOfStored({ ...DRAFT, editorial: { status: 'fallback' } }).headline, DRAFT.headline);
  const sheet = blindSheet([{ n: 1, id: 'x', kind: 'result', draft_headline: 'h', versions: [{ model: 'm1', ok: false, status: 'timeout' }, { model: 'm2', ok: false, status: 'http_500' }] }], { x: { A: 'm2', B: 'm1' } });
  assert.match(sheet, /VERSION A[\s\S]*http_500[\s\S]*VERSION B[\s\S]*timeout/);
  assert.ok(!sheet.includes('m1') && !sheet.includes('m2'));
});

test('canary CLI --dry runs end to end from a drafts file (no key in the environment)', () => {
  const dir = tmp();
  const file = path.join(dir, 'drafts.json');
  fs.writeFileSync(file, JSON.stringify([DRAFT]));
  const out = path.join(dir, 'out');
  const env = { ...process.env }; delete env.OPENAI_API_KEY;
  const stdout = execFileSync(process.execPath, ['scripts/ai-canary/run.mjs', '--dry', '--drafts', file, '--out', out, '--seed', 's'], { encoding: 'utf8', env });
  assert.match(stdout, /DRY RUN \(no API calls\)/);
  assert.ok(fs.existsSync(path.join(out, 'blind-review.md')) && fs.existsSync(path.join(out, 'SEALED-model-key.json')));
});
