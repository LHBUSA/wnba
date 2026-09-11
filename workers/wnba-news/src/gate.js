// Publication gate for WNBA newsroom articles.
//
// Ported from the UFC newsroom (LHBUSA/UFC workers/ufc-news-enrich/src/
// editorial.mjs validate() + packet.mjs factNumbers/numberTokens, contract in
// docs/editorial_contract.md). Same rules, same failure messages:
//   * two-class numbers: class A = our structured records (may be stated);
//     class B = appears only in a publisher report (the sentence must name the
//     publisher); anything else is class C and fails the article;
//   * absence discipline: no price/favourite language without a stored market,
//     no model language ever (no WNBA model is published);
//   * banned certainty / filler phrases;
//   * the primary subject must be named in the headline or deck;
//   * a bettor angle needs a summary, at least one counter-case and one unknown.
// A failing article is HELD (stored with its failures), never published.

export function numberTokens(text) {
  const normalised = String(text || '')
    .replace(/(\d)\s*[-‐-―]\s*(?=\d)/g, '$1 ')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return [...normalised.matchAll(/(?<![\w.])[-+]?\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

const OPAQUE_KEY = /(^|_)(id|ids|url|href|slug|hash|key|token|image|photo|portrait|square|source_page|odds_event_id|game_id|athlete_id|team_id|checksum)$/i;
const URL_LIKE = /^(https?:)?\/\//i;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/;

/** Every number a set of records contains, tagged with its class. */
export function factNumbers(records, cls = 'A', out = new Map()) {
  const walk = (node, key = '') => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
    if (typeof node === 'object') { for (const [k, v] of Object.entries(node)) walk(v, k); return; }
    if (OPAQUE_KEY.test(key)) return;
    if (typeof node === 'number' && Number.isFinite(node)) {
      for (const v of [node, Math.abs(node), Math.round(node * 10) / 10, Math.abs(Math.round(node * 10) / 10), Math.round(node), Math.round(node * 1000) / 10]) {
        const k = String(v);
        if (!out.has(k) || (out.get(k) === 'B' && cls === 'A')) out.set(k, cls);
      }
      return;
    }
    if (typeof node === 'string' && !URL_LIKE.test(node.trim()) && !ISO_LIKE.test(node.trim())) {
      for (const t of numberTokens(node)) {
        for (const v of [Number(t), Math.abs(Number(t))]) {
          const k = String(v);
          if (k !== 'NaN' && (!out.has(k) || (out.get(k) === 'B' && cls === 'A'))) out.set(k, cls);
        }
      }
    }
  };
  walk(records);
  return out;
}

const BANNED = [
  /\block\b/i, /\bguaranteed\b/i, /\bsure thing\b/i, /\beasy money\b/i, /\bfree money\b/i, /\bbest bet\b/i,
  /\bin the world of\b/i, /\bit remains to be seen\b/i, /\bonly time will tell\b/i,
  /\ba testament to\b/i, /\bspeaks volumes\b/i, /\bthe perfect storm\b/i,
  /\bmake no mistake\b/i, /\bat the end of the day\b/i, /\bsources (say|said|tell)\b/i, /\breportedly\b/i
];

const MONTH_DAY = /\b(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(t|tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\.? \d{1,2}(,? \d{4})?\b/g;
const CLOCK = /\b\d{1,2}:\d{2}( (a\.m\.|p\.m\.|AM|PM))?( ET)?\b/g;
const sentences = (text) => String(text || '').split(/(?<=[.!?”])\s+/);
const words = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);

export function validateArticle(a, { minWords = 110 } = {}) {
  const failures = [];
  const headline = String(a.headline || '').trim();
  const deck = String(a.deck || '').trim();
  const body = (a.body || []).join('\n\n');
  const angle = a.bettor_angle;
  const market = a.market_watch;

  if (headline.length < 24 || headline.length > 160) failures.push(`headline length ${headline.length}`);
  if (deck.length < 40 || deck.length > 400) failures.push(`deck length ${deck.length}`);
  if (words(body) < minWords) failures.push(`too short: ${words(body)} words < ${minWords}`);

  // --- two-class number gate over every prose field
  const allowed = factNumbers([a.facts, a.evidence.filter((e) => e.kind !== 'publisher_report')], 'A');
  const reports = a.evidence.filter((e) => e.kind === 'publisher_report');
  factNumbers(reports.map((r) => r.headline), 'B', allowed);
  const prose = [headline, deck, body, angle?.summary, ...(angle?.supporting || []), ...(angle?.against || []), ...(angle?.unknown || []), ...(market?.text || [])].join('\n');
  for (const sent of sentences(prose)) {
    const scrubbed = sent.replace(MONTH_DAY, ' ').replace(CLOCK, ' ').replace(/\b(Q[1-4]|\d?OT|No\. \d{1,2})\b/g, ' ').replace(/\b\d{1,2}(st|nd|rd|th)\b/g, ' ').replace(/\blast-\d+\b/gi, ' ');
    for (const tok of numberTokens(scrubbed)) {
      const n = Number(tok);
      if (Number.isInteger(n) && ((n >= 0 && n <= 5) || (n >= 1990 && n <= 2100))) continue;
      const k = String(n);
      const cls = allowed.get(k) || allowed.get(String(Math.abs(n)));
      if (!cls) { failures.push(`class C number "${tok}" is in no cited record. In: "${sent.trim().slice(0, 160)}"`); continue; }
      if (cls === 'B' && !reports.some((r) => sent.includes(r.publisher))) failures.push(`class B number "${tok}" comes only from a publisher report; the sentence must name the publisher. In: "${sent.trim().slice(0, 160)}"`);
    }
  }

  // --- quotation discipline: only a named publisher's own headline
  const heads = new Set(reports.map((r) => r.headline));
  for (const q of [...prose.matchAll(/“([^”]+)”/g)].map((m) => m[1])) if (!heads.has(q)) failures.push(`quotation is not a cited publisher headline: “${q.slice(0, 80)}”`);

  // --- absence discipline
  const hasMarket = Boolean(market?.market || market?.line || a.kind === 'props' || a.kind === 'market' || a.kind === 'trend');
  if (!hasMarket && /(\b[-+]\d{3,}\b|\bfavou?rites?\b|\bunderdogs?\b|\bmoneyline\b|\bspread\b)/i.test(prose)) failures.push('price or market-position language without a stored market');
  if (/\b(our model|model projects|fair price|model edge|projected probability|we make it|our projection)\b/i.test(prose)) failures.push('model claim — no PropBetEdge WNBA model is published');
  for (const re of BANNED) if (re.test(prose)) failures.push(`banned phrase: ${re.source}`);

  // --- subject discipline
  const subj = a.primary_subject;
  if (subj) {
    const last = subj.split(/\s+/).pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${last}\\b`, 'i').test(`${headline} ${deck}`)) failures.push(`headline and deck never name the primary subject (${subj})`);
  }

  // --- the bettor angle
  if (!angle) failures.push('missing bettor_angle');
  else {
    if (words(angle.summary) < 12) failures.push('bettor_angle.summary is too thin to be a read');
    if (!angle.against?.length) failures.push('bettor_angle needs at least one counter-case');
    if (!angle.unknown?.length) failures.push('bettor_angle needs at least one open unknown');
  }
  return { ok: failures.length === 0, failures };
}
