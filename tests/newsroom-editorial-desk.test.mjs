// wnba-editorial/1.0.0 — the OpenAI editorial desk is fail-closed and may not add a fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editArticle, rewriteFailures, draftSections, applyRewrite, statedValues, isConfigured, callModel, draftDigest, redact, EDITORIAL_DESK_VERSION, INSTRUCTIONS } from '../workers/wnba-news/src/editorial-desk.js';
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
const SECTIONS = draftSections(DRAFT, sectionKey);

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
const run = (fetchImpl, assess = passAll) => editArticle(ENV, DRAFT, { keyOf: sectionKey, assess, draftAssessment: { depth: { elements: [] } }, names: NAMES, fetchImpl, timeoutMs: 5000 });

test('configuration: the secret is the switch, and WNBA_EDITORIAL=off disables it', () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured(ENV), true);
  assert.equal(isConfigured({ ...ENV, WNBA_EDITORIAL: 'off' }), false);
});

test('the request is store:false, strict JSON schema, no tools, sections enumerated by the draft keys', async () => {
  const f = fakeFetch([GOOD]);
  const r = await run(f);
  assert.equal(r.editorial.status, 'applied', JSON.stringify(r.editorial.failures));
  const body = f.calls[0].body;
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(body.store, false);
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.properties.sections.items.properties.key.enum, ['lede', 'performers', 'flow', 'context']);
  assert.equal(body.instructions, INSTRUCTIONS);
  assert.match(body.input, /PACKET:/);
  assert.equal(r.editorial.version, EDITORIAL_DESK_VERSION);
  assert.equal(r.editorial.model, 'gpt-5.6-sol');
});

test('an applied rewrite keeps facts, evidence and entities byte-identical and carries section keys', async () => {
  const r = await run(fakeFetch([GOOD]));
  const a = r.article;
  assert.deepEqual(a.facts, DRAFT.facts);
  assert.deepEqual(a.evidence, DRAFT.evidence);
  assert.deepEqual(a.entities, DRAFT.entities);
  assert.deepEqual(a.sections.map((s) => s.key), ['lede', 'performers', 'flow', 'context']);
  assert.equal(a.body.length, 5);
});

test('provider unavailable, timeout or malformed output falls back without an article', async () => {
  for (const resp of [[{ status: 500 }], [new Error('network down')], ['{not json'], [{ headline: 'x' }]]) {
    const r = await run(fakeFetch(resp));
    assert.equal(r.article, null);
    assert.equal(r.editorial.status, 'fallback');
    assert.ok(r.editorial.failures.length);
  }
});

test('error text never carries the key', async () => {
  const r = await run(fakeFetch([{ status: 401, message: 'Incorrect API key provided: sk-test-secret-value-123456. You can find' }]));
  assert.doesNotMatch(JSON.stringify(r.editorial), /sk-test-secret/);
  assert.equal(redact('Bearer sk-abcdefghijklmnop'), 'Bearer …');
});

test('a rewrite that adds a number is rejected; the corrective retry can fix it', async () => {
  const bad = structuredClone(GOOD);
  bad.sections[1].paragraphs = ['Stewart finished with 34 points, 12 rebounds and 7 assists on 11-of-18 shooting in 38 minutes.'];
  const f = fakeFetch([bad, GOOD]);
  const r = await run(f);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].body.input, /CORRECTIVE REWRITE REQUIRED[\s\S]*number: "7"/);
  assert.equal(r.editorial.status, 'applied');
  const f2 = fakeFetch([bad, bad]);
  const r2 = await run(f2);
  assert.equal(r2.article, null);
  assert.ok(r2.editorial.failures.some((x) => /number: "7"/.test(x)));
});

const check = (mut) => { const out = structuredClone(GOOD); mut(out); return rewriteFailures(DRAFT, out, applyRewrite(DRAFT, SECTIONS, out), { names: NAMES, draftSectionsList: SECTIONS }); };

test('the clean rewrite passes the editorial gate', () => {
  assert.deepEqual(check(() => {}), []);
});

test('no unsupported player, team, venue or quotation', () => {
  assert.ok(check((o) => { o.sections[1].paragraphs.push('Sabrina Ionescu added support for the Liberty.'); }).some((x) => /player "Sabrina Ionescu"/.test(x)));
  assert.ok(check((o) => { o.deck = 'New York took Game 1 91–75 and now looks like the Aces of the East, leading 1–0.'; }).some((x) => /team "Aces"/.test(x)));
  assert.ok(check((o) => { o.sections[0].paragraphs[0] += ' Coach Sandy Brondello was pleased.'; }).some((x) => /proper noun "(Sandy|Brondello)"/.test(x)));
  assert.ok(check((o) => { o.sections[1].paragraphs[0] += ' “She was unstoppable,” one observer said.'; }).some((x) => /^quote:/.test(x)));
});

test('no market or model language the draft does not license; no predictions', () => {
  const noMarket = { ...DRAFT, body: DRAFT.body.map((p) => p.replace('Player props enter the board inside 36 hours of tip.', '')) };
  const secs = draftSections(noMarket, sectionKey);
  const out = structuredClone(GOOD);
  out.sections[3].paragraphs = ['Next up: Game 2, MIN at NY on Sep 30, and the spread will reflect it.'];
  const f = rewriteFailures(noMarket, out, applyRewrite(noMarket, secs, out), { names: NAMES, draftSectionsList: secs });
  assert.ok(f.some((x) => /^market:/.test(x)));
  assert.ok(check((o) => { o.sections[3].paragraphs.push('Our model projects the Liberty to advance.'); }).some((x) => /^model:|will|projected/.test(x)));
  assert.ok(check((o) => { o.sections[3].paragraphs.push('Stewart will play in Game 2.'); }).some((x) => /language: “will play”/.test(x)));
});

test('no unsupported superlatives, momentum, or causal claims beyond the draft', () => {
  assert.ok(check((o) => { o.sections[0].paragraphs[0] += ' It was a dominant, historic night.'; }).some((x) => /characterisation: “(dominant|historic)”/.test(x)));
  assert.ok(check((o) => { o.sections[2].paragraphs.push('The Liberty seized the momentum.'); }).some((x) => /momentum/.test(x)));
  assert.ok(check((o) => { o.sections[2].paragraphs.push('That happened because the Lynx were tired, which is why New York led, and thanks to depth, due to rest.'); }).some((x) => /^causality:/.test(x)));
});

test('structure: keys in order, no memo headings, no markdown, no repeated sentence, no padding', () => {
  assert.ok(check((o) => { o.sections.reverse(); }).some((x) => /^structure: sections must be/.test(x)));
  assert.ok(check((o) => { o.sections[1].title = 'The read'; }).some((x) => /memo-style heading/.test(x)));
  assert.ok(check((o) => { o.sections[1].paragraphs = ['**Stewart** finished with 34 points and 12 rebounds on 11-of-18 shooting in 38 minutes.']; }).some((x) => /markdown/.test(x)));
  assert.ok(check((o) => { o.sections[2].paragraphs.push(o.sections[2].paragraphs[0]); }).some((x) => /^repetition:/.test(x)));
  assert.ok(check((o) => { o.headline = 'Liberty at Lynx: injuries, recent form and the matchup'; }).some((x) => /template headline/.test(x)));
});

test('dates and clock times must be the draft’s', () => {
  assert.ok(check((o) => { o.sections[3].paragraphs = ['Next up: Game 2, MIN at NY on Oct 1. Player props enter the board inside 36 hours of tip.']; }).some((x) => /^date: 10-1/.test(x)));
  assert.deepEqual([...statedValues('Sunday, September 27 at 8:30 PM ET, ten assists, 91–75').nums].sort(), ['10', '75', '91']);
});

test('the full gate chain is applied to the rewrite, and a depth element the draft met must stay met', async () => {
  const r = await run(fakeFetch([GOOD, GOOD]), () => ({ failures: ['R0 lint — article: “a 18” should be “an 18”'], depth: { elements: [] } }));
  assert.equal(r.article, null);
  assert.ok(r.editorial.failures.some((x) => /R0 lint/.test(x)));
  const regress = await editArticle(ENV, DRAFT, { keyOf: sectionKey, assess: () => ({ failures: [], depth: { elements: [{ key: 'team_context', met: false }] } }), draftAssessment: { depth: { elements: [{ key: 'team_context', met: true }] } }, names: NAMES, fetchImpl: fakeFetch([GOOD]), timeoutMs: 5000, attempts: 1 });
  assert.ok(regress.editorial.failures.some((x) => /depth regression: the draft met "team_context"/.test(x)));
});

test('the draft digest is stable for an unchanged draft and moves when a fact moves', async () => {
  assert.equal(await draftDigest(DRAFT), await draftDigest(structuredClone(DRAFT)));
  assert.notEqual(await draftDigest(DRAFT), await draftDigest({ ...DRAFT, facts: { scores: { w: 92, l: 75, margin: 17 } } }));
});

test('transport: a refusal or incomplete response is an error, not an article', async () => {
  const refusal = async () => ({ ok: true, status: 200, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }) });
  await assert.rejects(callModel(ENV, { input: 'x', schema: {}, timeoutMs: 1000, fetchImpl: refusal }), /refusal/);
  const incomplete = async () => ({ ok: true, status: 200, json: async () => ({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(callModel(ENV, { input: 'x', schema: {}, timeoutMs: 1000, fetchImpl: incomplete }), /incomplete/);
});
