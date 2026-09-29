// WNBA editorial desk — wnba-editorial/1.0.0.
//
//   FACT BLOCK -> DETERMINISTIC WNBA DRAFT -> OPENAI EDITORIAL DESK -> EDITORIAL REWRITE GATE -> EXISTING GATES -> PUBLISH
//
// The deterministic engine (wnba-articles) stays the source of truth: its fact block and evidence records are what the
// story may say, and its draft is the safe fallback. This desk only improves how the draft is WRITTEN — headline, deck,
// section titles, transitions, structure within each section — and is held to a stricter rule than the draft itself:
// every number and every proper name in the rewrite must already be in the deterministic draft. The model receives only
// the structured fact block, the draft, permitted metadata and style instructions: no web, no tools, no retrieval, no
// publisher article bodies, store:false.
//
// FAIL CLOSED. A timeout, malformed JSON, a refusal, or any rewrite-gate / publication-gate failure (after one corrective
// retry) discards the rewrite. The deterministic draft then publishes if it passes the existing gates on its own; the
// provider being unavailable never stops legitimate news. Every article records editorial.{provider, model, version,
// status, failures}; keys never appear in any record (error text is redacted).
//
// NO CHURN. The rewrite is cached on the stored item keyed by a digest of the deterministic draft + facts. An unchanged
// draft reuses the stored rewrite (or the stored fallback decision) without calling the model, so the lifecycle's novelty
// gate sees an unchanged story and nothing is revised.

import { numberTokens } from './gate.js';
import { sentencesOf, contentTokens } from '../../../src/lib/semantic.js';

export const EDITORIAL_DESK_VERSION = 'wnba-editorial/1.0.0';
export const DEFAULT_MODEL = 'gpt-5.6-sol';
const API = 'https://api.openai.com/v1/responses';

/** Desks the editor rewrites. WinBA, commissioned features, props/market notes and international keep their own lanes. */
export const EDITORIAL_KINDS = new Set(['injury', 'transaction', 'result', 'performance', 'preview', 'trend', 'brief']);

export const isConfigured = (env) => Boolean(env?.OPENAI_API_KEY) && String(env?.WNBA_EDITORIAL || 'on').toLowerCase() !== 'off';
export const modelOf = (env) => env?.WNBA_EDITORIAL_MODEL || DEFAULT_MODEL;
export const budgetOf = (env) => ({
  maxCalls: Math.max(0, Number(env?.WNBA_EDITORIAL_MAX_CALLS ?? 8)),
  deadlineMs: Math.max(10e3, Number(env?.WNBA_EDITORIAL_DEADLINE_MS ?? 150e3)),
  concurrency: Math.max(1, Math.min(4, Number(env?.WNBA_EDITORIAL_CONCURRENCY ?? 3))),
  timeoutMs: Math.max(5e3, Math.min(120e3, Number(env?.WNBA_EDITORIAL_TIMEOUT_MS ?? 80e3)))
});

// ------------------------------------------------------------ the draft as sections with stable keys

/**
 * The deterministic draft as keyed sections. `keyOf(section, i)` is depth.js sectionKey: the element key the depth
 * contract reads. A section whose title maps to no key keeps its title (the rewrite may not retitle it).
 */
export function draftSections(a, keyOf) {
  const secs = (a.sections || []).length ? a.sections : [{ title: null, first: 0, count: (a.body || []).length }];
  const out = [];
  const lead = secs[0]?.first > 0 ? (a.body || []).slice(0, secs[0].first) : [];
  if (lead.length) out.push({ key: 'lede', title: null, fixed_title: true, paragraphs: lead });
  secs.forEach((s, i) => {
    const k = keyOf(s, i);
    out.push({ key: k || `keep_${i}`, title: s.title || null, fixed_title: !k, paragraphs: (a.body || []).slice(s.first, s.first + s.count), visuals: s.visuals || null, visual: s.visual || null });
  });
  // Keys must be unique for the schema enum; a repeated key keeps its title fixed and gets an index.
  const seen = new Map();
  for (const s of out) { const n = seen.get(s.key) || 0; seen.set(s.key, n + 1); if (n) { s.key = `${s.key}_${n}`; s.fixed_title = true; } }
  return out;
}

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Digest of what the editor is given: the deterministic draft and its facts. Unchanged digest = reuse, no call. */
// Facts as the digest sees them: observation clocks and feed ordering are not facts a reader could see change, so they
// never invalidate a rewrite (the same canonical form lifecycle.js uses to decide whether facts changed).
const VOLATILE = /(captured_at|fetched_at|age_s|stale|generation_cutoff|generated_at|source_observed_at|observed_at|served_at|updated_at)$/;
const canon = (x) => (Array.isArray(x) ? x.map(canon).sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q)))
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !VOLATILE.test(k)).sort(([p], [q]) => p.localeCompare(q)).map(([k, v]) => [k, canon(v)]))
    : typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);

export async function draftDigest(a) {
  return sha(JSON.stringify([EDITORIAL_DESK_VERSION, a.headline, a.deck, a.body, (a.sections || []).map((s) => s.title), canon(a.facts || null)]));
}

// ------------------------------------------------------------ packet + instructions

const ANCHORS = {
  injury: [
    'The first section must say when ESPN’s injury feed was updated (keep the word "updated" and the date/time given).',
    'Keep her games played as "<n> games" and her minutes as "<x> minutes".',
    'The role/rotation section must still talk about minutes ("minutes" or "min").'
  ],
  transaction: ['Attribute the move to "the transactions log" in the first section.', 'Keep the mention of ESPN’s injury feed.'],
  preview: ['Keep the phrase "Season series" if the draft has it.', 'Keep rest as "<n> days of rest".', 'Keep "last 10" wording for recent form.'],
  game: ['The game-flow section must name a quarter or halftime.', 'Keep a field-goal percentage or "from the field", and keep rebounds or turnovers.', 'Keep the next-game sentence (it may start "Next up:").', 'For a playoff game keep the series score exactly as written.'],
  market: ['Keep the game-by-game evidence the draft lists.'],
  brief: ['The first section must state the development itself.']
};
const contractOfKind = (k) => (k === 'result' || k === 'performance' ? 'game' : k === 'trend' ? 'market' : k);

export const INSTRUCTIONS = `You are the lead editor of the PropBetEdge WNBA newsroom — a basketball intelligence publication for serious WNBA fans and bettors. A deterministic writer has produced a factually verified DRAFT from PropBetEdge's own structured records. Your job is to turn it into professional sports journalism without changing a single fact.

WHAT YOU ARE IMPROVING
- The headline: lead with the most consequential verified development. Specific, plain, searchable names and teams. No clickbait, no fake drama, no database-label headlines, no colons stacking three ideas. A number belongs in the headline only when it is the story.
- The deck: one sentence that tells a reader why this matters now.
- Flow: open with the news and its stakes, then the evidence, then the counter-case and what is still unknown. Vary sentence rhythm. Cut repetition, housekeeping and "audit memo" phrasing ("per the records", "that is box-score observation", "context, not a signal", "the records do not measure"). Say things once.
- Section titles: short, specific sports-desk headings that describe what the section says. Never generic memo labels such as "The read", "The evidence", "The counter-case", "What matters next", "The market", "The numbers".

WNBA VOICE
- Basketball intelligence: rotations, minutes, starting roles, pace, efficiency, rebounding, turnovers, series stakes. Mechanism over direction: explain what the numbers show about how a game was won or what an absence changes.
- Playoff stories: the series state and what is at stake (closeout, elimination, a deciding game) come first.
- Keep every caveat about sample size and every "this is not a projection" boundary. Uncertainty stays uncertain.
- Avoid clichés and betting clichés: no "momentum", "must-win", "statement win", "dominant", "surged", "red-hot", "lock", "sure thing", "value play", "sharp money", "buckle up", "it remains to be seen", "only time will tell".

HARD RULES — a rewrite that breaks any of these is discarded
1. Use ONLY the DRAFT and the FACT BLOCK. No outside knowledge of any kind.
2. Every number you write must already appear in the DRAFT, written the same way or as the same value in words. Do not round, add, subtract, convert or combine numbers. Do not introduce any date, time, score, record, percentage, line or count that is not in the DRAFT.
3. Every person, team, venue and publisher you name must already be named in the DRAFT.
4. No quotations, except a publisher headline reproduced exactly and credited to its publisher (only if the DRAFT does so).
5. No injury, return date, lineup, transaction, market, price, prediction or model claim that the DRAFT does not make. Never say a player will play, return, start or miss. No sportsbook language unless the DRAFT has it; no model language ever unless the DRAFT has it.
6. No new causal claims, superlatives or characterisations the DRAFT does not support.
7. Keep every section, in the same order, with the same key. Rewrite its title (unless marked fixed_title) and its paragraphs. Each section keeps the substance the DRAFT gives it.
8. Plain text only inside paragraphs: no Markdown, no bullet points, no headings inside paragraphs.
9. Do not repeat a sentence or an idea; do not restate the PropBetEdge Intelligence copy listed in the packet.`;

function packetOf(a, sections) {
  const publisherHeadlines = (a.evidence || []).filter((e) => e.kind === 'publisher_report').map((e) => ({ publisher: e.publisher, headline: e.headline }));
  const records = (a.evidence || []).filter((e) => e.kind !== 'publisher_report').map((e) => ({ source: e.source, record: e.record ?? null }));
  const intel = a.intelligence?.copy ? [a.intelligence.copy.summary, ...(a.intelligence.copy.supporting || [])].filter(Boolean) : [];
  return {
    story: { kind: a.kind, category: a.category, primary_subject: a.primary_subject || null, depth_class: a.depth?.class || null },
    permitted_names: (a.entities || []).filter((e) => e && e.type !== 'game').map((e) => `${e.name} (${e.type})`),
    publisher_headlines: publisherHeadlines,
    intelligence_copy_not_to_repeat: intel,
    draft: { headline: a.headline, deck: a.deck, sections: sections.map((s) => ({ key: s.key, title: s.title, fixed_title: s.fixed_title, paragraphs: s.paragraphs, ...(s.visuals ? { charts_beside_this_section: s.visuals.map((id) => (a.visuals || []).find((v) => v.id === id)?.title).filter(Boolean) } : {}) })) },
    fact_block: a.facts || {},
    cited_records: records
  };
}

function inputOf(a, sections, correction = null) {
  const words = (a.body || []).join(' ').split(/\s+/).filter(Boolean).length;
  const anchors = ANCHORS[contractOfKind(a.kind)] || [];
  return [
    'OUTPUT ACCEPTANCE FOR THIS STORY:',
    `- Keep all ${sections.length} sections, in order, with the same keys.`,
    `- Body length between ${Math.round(words * 0.9)} and ${Math.round(words * 1.35)} words (the draft has ${words}). Never restate a fact to add length; a shorter, tighter story is better than a padded one.`,
    ...anchors.map((x) => `- ${x}`),
    ...(correction ? ['', 'CORRECTIVE REWRITE REQUIRED — the previous rewrite was rejected for exactly these reasons:', ...correction.slice(0, 8).map((x) => `- ${x}`), 'Rewrite from the SAME packet and fix every one of them without adding any fact.'] : []),
    '',
    'PACKET:',
    JSON.stringify(packetOf(a, sections))
  ].join('\n');
}

function schemaFor(sections) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      deck: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', enum: sections.map((s) => s.key) },
            title: { type: 'string' },
            paragraphs: { type: 'array', items: { type: 'string' } }
          },
          required: ['key', 'title', 'paragraphs']
        }
      }
    },
    required: ['headline', 'deck', 'sections']
  };
}

// ------------------------------------------------------------ transport

export const redact = (s) => String(s || '').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer …').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…').replace(/Incorrect API key provided:[^.]*/i, 'Incorrect API key provided').slice(0, 300);

export async function callModel(env, { input, schema, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelOf(env),
        store: false,
        reasoning: { effort: env?.WNBA_EDITORIAL_EFFORT || 'medium' },
        instructions: INSTRUCTIONS,
        input,
        max_output_tokens: 16000,
        text: { format: { type: 'json_schema', name: 'wnba_editorial_rewrite', strict: true, schema } }
      })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`openai ${res.status}: ${redact(body?.error?.message || '')}`);
    if (body?.status === 'incomplete') throw new Error(`openai incomplete: ${body.incomplete_details?.reason || 'unknown'}`);
    if (body?.status === 'failed') throw new Error('openai failed');
    const text = [];
    for (const item of body?.output || []) for (const part of item?.content || []) {
      if (part?.type === 'refusal') throw new Error('openai refusal');
      if (part?.type === 'output_text' && part.text) text.push(String(part.text));
    }
    if (!text.length) throw new Error('openai empty output');
    let json;
    try { json = JSON.parse(text.join('')); } catch { throw new Error('openai malformed JSON'); }
    return { json, usage: { input_tokens: body?.usage?.input_tokens ?? null, output_tokens: body?.usage?.output_tokens ?? null } };
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? `openai timeout after ${timeoutMs}ms` : redact(e?.message || e));
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------ applying a rewrite

/** The rewrite applied to a copy of the article: headline, deck, body and keyed sections. Nothing else changes. */
export function applyRewrite(a, draft, out) {
  const body = [];
  const sections = [];
  for (const d of draft) {
    const s = (out.sections || []).find((x) => x.key === d.key);
    const paras = (s?.paragraphs || []).map((p) => String(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const title = d.fixed_title ? d.title : String(s?.title || '').replace(/\s+/g, ' ').trim() || d.title;
    // A fixed or untitled leading section keeps its original shape; keyed sections carry the key depth.js reads.
    // Chart placement is code's decision, not the editor's: each section keeps the visuals the draft placed on it.
    sections.push({ title, first: body.length, count: paras.length, ...(d.key.startsWith('keep_') || d.fixed_title ? {} : { key: d.key.replace(/_\d+$/, '') }), ...(d.visuals ? { visuals: d.visuals } : {}), ...(d.visual ? { visual: d.visual } : {}) });
    body.push(...paras);
  }
  return { ...a, headline: String(out.headline || '').replace(/\s+/g, ' ').trim(), deck: String(out.deck || '').replace(/\s+/g, ' ').trim(), body, sections: sections.filter((s) => s.count > 0 || s.title) };
}

// ------------------------------------------------------------ the editorial rewrite gate

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, twice: 2, double: 2, triple: 3, half: 0.5, dozen: 12 };
const MONTH = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const MONTH_DAY = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? (\d{1,2})\b/g;
const CLOCK = /\b(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.|AM|PM)?/gi;

/** Every value a text states: digits (scores and records split), number words, month-day dates, clock times. */
export function statedValues(text) {
  const t = String(text || '');
  const dates = new Set([...t.matchAll(MONTH_DAY)].map((m) => `${MONTH[m[1].toLowerCase().replace(/\.$/, '')]}-${Number(m[2])}`));
  const clocks = new Set([...t.matchAll(CLOCK)].map((m) => `${Number(m[1])}:${m[2]}${(m[3] || '').toLowerCase().replace(/\./g, '')}`));
  const scrubbed = t.replace(MONTH_DAY, ' ').replace(CLOCK, ' ');
  const nums = new Set(numberTokens(scrubbed).map((x) => String(Math.abs(Number(x)))));
  for (const w of scrubbed.toLowerCase().match(/\b[a-z]+\b/g) || []) if (NUMBER_WORDS[w] !== undefined) nums.add(String(NUMBER_WORDS[w]));
  return { nums, dates, clocks };
}

const STOP_CAPS = new Set('A An The And But Or Nor For So Yet In On At To Of By As If It Its Her Hers She He His They Their Them This That These Those There Then When While Where Which Who Whom Whose What Why How With Without After Before Over Under Into From Since Until Across Against Between Both Each Every Either Neither No Not Only Even Still Just Also Once One All Any Some Most More Less Few Many Much Next Last First Second Third Game Games Quarter Half Halftime Overtime ET PropBetEdge WNBA Intelligence Playoffs Playoff Postseason Season Series Round Monday Tuesday Wednesday Thursday Friday Saturday Sunday I We Our'.split(' '));
const CAPWORD = /(?<![A-Za-z’'-])([A-Z][a-zA-Z’'.-]*[a-zA-Z])/g;

/** Capitalised words that are not sentence-initial (proper-noun candidates). */
function properWords(text) {
  const out = new Set();
  for (const s of sentencesOf(String(text || ''))) {
    const trimmed = s.replace(/^[\s“"(—–-]+/, '');
    let first = true;
    for (const m of trimmed.matchAll(CAPWORD)) {
      const w = m[1].replace(/[’']s$/, '').replace(/[’']$/, '').replace(/\.$/, '');
      if (first && m.index === 0) { first = false; continue; }
      first = false;
      if (w.length > 1 && !STOP_CAPS.has(w)) out.add(w);
    }
  }
  return out;
}

const SUPERLATIVE = /\b(best|worst|most|least|highest|lowest|fewest|largest|biggest|smallest|record|records|historic|history|first-ever|career-high|season-high|franchise|elite|unstoppable|dominant|dominated|dominance|dominating|surge|surged|surging|collapse|collapsed|meltdown|clutch|red-hot|ice-cold|blowout|rout|routed|stunning|stunned|upset|shocking|massive|huge|incredible|remarkable|impressive|brilliant|sensational)\b/gi;
const CAUSAL = /\b(because|due to|thanks to|as a result|resulted in|caused|led to|which is why|that is why|fueled|powered|sparked|drove)\b/gi;
const BANNED_EDITORIAL = [
  /\bmomentum\b/i, /\bmust-win\b/i, /\bstatement (win|game|victory)\b/i, /\buneven recent stretch\b/i, /\bquestion for the next slate\b/i,
  /\bshrug off\b/i, /\bit(?:’|')s worth noting\b/i, /\bnotably\b/i, /\bin conclusion\b/i, /\bneedless to say\b/i, /\ball eyes\b/i, /\bbuckle up\b/i,
  /\blook no further\b/i, /\bthe stage is set\b/i, /\bsharp money\b/i, /\bvalue play\b/i, /\block of the\b/i, /\bslam dunk\b/i, /\bgame[- ]changer\b/i,
  /\bwill (win|beat|cover|advance|lose|bounce back|dominate|play|return|start|miss|be available|be back)\b/i, /\b(is|are) (expected|projected|poised|primed|set) to\b/i,
  /\bshould (win|cover|beat|advance)\b/i, /\bexpect (her|them|the)\b/i
];
const MEMO_HEADINGS = /^(the read|the evidence|the counter-case|the counter case|what matters next|the market|the numbers|the listing|the development|the move|the player|what propbetedge can verify)$/i;
const MARKET_WORDS = /\b(spread|spreads|favou?red|favou?rites?|underdogs?|moneylines?|totals?|odds|lines?|cover(?:ed|s|ing)?|over\/under|sportsbooks?|books|prices?|priced|consensus|market)\b/i;
const MODEL_WORDS = /\b(model|models|projection|projections|projected|projects|fair (?:price|value)|expected value|win probability)\b/i;
const QUOTE = /[“"]([^”"]{3,})[”"]/g;
const wordsIn = (xs) => xs.join(' ').split(/\s+/).filter(Boolean).length;
const jac = (a, b) => { const A = new Set(a); const B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i += 1; return i / (A.size + B.size - i); };

/**
 * The editorial rewrite gate: what the rewrite may NOT do relative to its deterministic draft. Returns failures (empty =
 * pass). `names` = { players: [full names], teams: [{ name, short_name }] } from the newsroom dictionary.
 */
export function rewriteFailures(draft, out, rewritten, { names = { players: [], teams: [] }, draftSectionsList = [] } = {}) {
  const f = [];
  const dProse = [draft.headline, draft.deck, ...(draft.body || [])].join('\n');
  const rProse = [rewritten.headline, rewritten.deck, ...(rewritten.body || [])].join('\n');
  const rTitles = (rewritten.sections || []).map((s) => s.title).filter(Boolean);

  // --- structure
  const outKeys = (out.sections || []).map((s) => s.key);
  const wantKeys = draftSectionsList.map((s) => s.key);
  if (JSON.stringify(outKeys) !== JSON.stringify(wantKeys)) f.push(`structure: sections must be ${wantKeys.join(', ')} in order; got ${outKeys.join(', ') || 'none'}`);
  for (const s of out.sections || []) {
    const d = draftSectionsList.find((x) => x.key === s.key);
    if (!(s.paragraphs || []).length) f.push(`structure: section ${s.key} has no paragraphs`);
    if ((s.paragraphs || []).length > 7) f.push(`structure: section ${s.key} has ${(s.paragraphs || []).length} paragraphs (max 7)`);
    if (d?.fixed_title && s.title && d.title && s.title !== d.title) f.push(`structure: section ${s.key} has a fixed title "${d.title}"`);
    for (const p of s.paragraphs || []) {
      if (/^\s*(#|[-*•]\s|\d+\.\s)|\*\*|__/.test(p)) f.push(`structure: markdown or list syntax inside a paragraph (${s.key})`);
      if (p.split(/\s+/).length > 140) f.push(`structure: a paragraph in ${s.key} runs ${p.split(/\s+/).length} words (max 140)`);
    }
  }
  if (rTitles.some((t) => t.length > 70 || /[:.]$/.test(t))) f.push('structure: section titles must be short and not end in punctuation');
  if (new Set(rTitles.map((t) => t.toLowerCase())).size !== rTitles.length) f.push('structure: duplicate section titles');
  for (const t of rTitles) if (MEMO_HEADINGS.test(t)) f.push(`structure: memo-style heading "${t}"`);
  const hl = rewritten.headline || '';
  if (hl.length < 24 || hl.length > 120) f.push(`headline length ${hl.length} (24–120)`);
  if ((rewritten.deck || '').length < 40 || (rewritten.deck || '').length > 320) f.push(`deck length ${(rewritten.deck || '').length} (40–320)`);
  if (/injuries, recent form and the matchup|uneven recent stretch|: the roster the move inherits/i.test(hl)) f.push('headline: template headline pattern');
  const dw = wordsIn(draft.body || []); const rw = wordsIn(rewritten.body || []);
  if (rw < Math.floor(dw * 0.85)) f.push(`length: rewrite has ${rw} words against the draft's ${dw} (minimum ${Math.floor(dw * 0.85)})`);
  // Padding ceiling: the rewrite cannot add evidence, so it may not grow much. (Canary rewrites ran 1.13–1.19x.)
  if (rw > Math.round(dw * 1.4)) f.push(`length: rewrite has ${rw} words against the draft's ${dw} (max ${Math.round(dw * 1.4)}) — padding`);

  // --- numbers, dates, clock times: every value must already be stated by the draft
  const D = statedValues(dProse);
  const R = statedValues(rProse);
  for (const n of R.nums) if (!D.nums.has(n)) f.push(`number: "${n}" is not in the deterministic draft`);
  for (const d of R.dates) if (!D.dates.has(d)) f.push(`date: ${d} is not in the deterministic draft`);
  for (const c of R.clocks) if (![...D.clocks].some((x) => x.startsWith(c.replace(/(am|pm)$/, '')))) f.push(`time: ${c} is not in the deterministic draft`);

  // --- names: players, teams and any other proper noun must already be in the draft
  const dl = dProse.toLowerCase();
  for (const p of names.players || []) if (p && rProse.includes(p) && !dProse.includes(p)) f.push(`entity: player "${p}" is not named in the draft`);
  for (const t of names.teams || []) {
    for (const n of [t.name, t.short_name].filter(Boolean)) {
      if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(rProse) && !dProse.includes(n)) f.push(`entity: team "${n}" is not named in the draft`);
    }
  }
  const dWords = new Set((dProse.match(/[A-Za-z][A-Za-z’'.-]*/g) || []).map((w) => w.replace(/[’']s$/, '').replace(/[’']$/, '').replace(/\.$/, '')));
  for (const w of properWords(rProse)) if (!dWords.has(w)) f.push(`entity: proper noun "${w}" is not in the draft`);

  // --- quotations, copied publisher text
  // Heights (6' 2") use the same mark as a quotation; they are measurements, not quotes.
  const unheight = (t) => t.replace(/\d+\s?['’]\s?\d{1,2}\s?["”]/g, ' ');
  const dQuotes = new Set([...unheight(dProse).matchAll(QUOTE)].map((m) => m[1]));
  for (const m of unheight(rProse).matchAll(QUOTE)) if (!dQuotes.has(m[1])) f.push(`quote: “${m[1].slice(0, 60)}” is not a quotation the draft makes`);

  // --- language the draft must license
  for (const re of BANNED_EDITORIAL) { const m = rProse.match(re); if (m && !dl.includes(m[0].toLowerCase())) f.push(`language: “${m[0]}”`); }
  if (MARKET_WORDS.test(rProse) && !MARKET_WORDS.test(dProse)) f.push(`market: sportsbook language (“${rProse.match(MARKET_WORDS)[0]}”) without a captured market in the draft`);
  if (MODEL_WORDS.test(rProse) && !MODEL_WORDS.test(dProse)) f.push(`model: model language (“${rProse.match(MODEL_WORDS)[0]}”) without a PropBetEdge model record`);
  for (const m of new Set((rProse.match(SUPERLATIVE) || []).map((x) => x.toLowerCase()))) if (!new RegExp(`\\b${m}\\b`, 'i').test(dProse)) f.push(`characterisation: “${m}” is not supported by the draft`);
  const causal = (t) => (t.match(CAUSAL) || []).length;
  if (causal(rProse) > causal(dProse) + 1) f.push(`causality: ${causal(rProse)} causal claims against the draft's ${causal(dProse)}`);

  // --- repetition
  const sents = sentencesOf((rewritten.body || []).join(' ')).map((s) => contentTokens(s).join(' ')).filter((s) => s.split(' ').length >= 5);
  if (new Set(sents).size !== sents.length) f.push('repetition: a sentence repeats');
  const paras = (rewritten.body || []).map((p) => contentTokens(p));
  for (let i = 0; i < paras.length; i += 1) for (let j = i + 1; j < paras.length; j += 1) if (paras[i].length >= 8 && jac(paras[i], paras[j]) >= 0.6) { f.push(`repetition: paragraphs ${i + 1} and ${j + 1} say the same thing`); i = paras.length; break; }
  if (contentTokens(rewritten.deck || '').join(' ') && sents.includes(contentTokens(rewritten.deck || '').join(' '))) f.push('repetition: the deck repeats a body sentence');
  return [...new Set(f)];
}

// ------------------------------------------------------------ orchestration for one article

/**
 * Rewrite one article. `assess(candidate)` runs the full existing publication gate chain on a candidate and returns its
 * failures; `draftAssessment` is that result for the deterministic draft (its met depth elements must stay met).
 * Returns { article: the rewritten article or null, editorial: record }.
 */
export async function editArticle(env, a, { keyOf, assess, draftAssessment, names, fetchImpl, timeoutMs, attempts: maxAttempts = 2 }) {
  const sections = draftSections(a, keyOf);
  const record = { provider: 'openai', model: modelOf(env), version: EDITORIAL_DESK_VERSION, status: 'fallback', failures: [], attempts: 0, usage: { input_tokens: 0, output_tokens: 0 } };
  const metBefore = new Set((draftAssessment?.depth?.elements || []).filter((e) => e.met).map((e) => e.key));
  let correction = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    record.attempts = attempt;
    let out;
    try {
      const r = await callModel(env, { input: inputOf(a, sections, correction), schema: schemaFor(sections), timeoutMs, fetchImpl });
      out = r.json;
      record.usage.input_tokens += r.usage.input_tokens || 0;
      record.usage.output_tokens += r.usage.output_tokens || 0;
    } catch (e) {
      record.failures = [`provider: ${redact(e.message)}`];
      record.status = 'fallback';
      return { article: null, editorial: record };
    }
    if (!out || typeof out !== 'object' || !Array.isArray(out.sections)) { record.failures = ['provider: malformed rewrite']; correction = record.failures; continue; }
    const candidate = applyRewrite(a, sections, out);
    const failures = rewriteFailures(a, out, candidate, { names, draftSectionsList: sections });
    const gate = assess(candidate);
    failures.push(...gate.failures);
    const metAfter = new Set((gate.depth?.elements || []).filter((e) => e.met).map((e) => e.key));
    for (const k of metBefore) if (!metAfter.has(k)) failures.push(`depth regression: the draft met "${k}" and the rewrite does not`);
    if (!failures.length) {
      record.status = 'applied';
      record.failures = [];
      return { article: candidate, editorial: record, gate };
    }
    record.failures = [...new Set(failures)].slice(0, 12);
    correction = record.failures;
  }
  record.status = 'fallback';
  return { article: null, editorial: record };
}
