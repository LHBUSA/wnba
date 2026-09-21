// Storycraft gate — reader-facing editorial quality for the WNBA newsroom.
//
// Grounding gates answer "is this supported?" Storycraft answers a different
// question: "does this read like a real sports article?" It is deliberately
// deterministic so a technically correct data memo cannot publish as journalism.
//
// The strictest rules apply to external-source briefs because that lane is most
// vulnerable to turning source metadata, verification notes and internal audit
// language into reader-facing copy.

export const STORYCRAFT_VERSION = 'wnba-storycraft/1.0.0';

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const countMatches = (text, re) => [...String(text || '').matchAll(re)].length;

const INTERNAL_PROCESS = [
  ['internal verification prose', /\bWhat PropBetEdge can verify\b|\bPropBetEdge(?:’s|'s) (?:own )?(?:structured )?(?:records?|game log) (?:are used here|covers|can verify)\b/i],
  ['editorial-process prose', /\b(?:this story (?:is|was|will be)|the details beyond that headline remain|not being stretched|publisher reporting|the record that would confirm)\b/i],
  ['article-type disclaimer', /\bThis is a (?:scoring-record|record|injury|transaction|awards|preview|recap) story\b/i]
];

const GENERIC_SECTION = /^(?:The development|What PropBetEdge(?:’s|'s) records show|What PropBetEdge can verify|Where the team stands|What remains unresolved|What mechanically changes|What comes next|What the record does not decide|Correction)$/i;
const PROCESS_SECTION = /^(?:Evidence|Methodology|Correction|What PropBetEdge can verify)$/i;

function publisherNames(a) {
  return [...new Set((a?.evidence || [])
    .filter((e) => e?.kind === 'publisher_report' && e.publisher)
    .map((e) => String(e.publisher).trim())
    .filter(Boolean))];
}

function startsWithPublisher(text, names) {
  const t = norm(text).toLowerCase();
  return names.some((name) => t.startsWith(String(name).toLowerCase()));
}

export function storyCraftFailures(a) {
  const out = [];
  if (!a) return ['storycraft: missing article'];

  const headline = norm(a.headline);
  const deck = norm(a.deck);
  const body = (a.body || []).map(norm).filter(Boolean);
  const first = body[0] || '';
  const bodyText = body.join(' ');
  const sections = a.sections || [];
  const pubs = publisherNames(a);

  if (!headline) out.push('storycraft: missing headline');
  if (!deck) out.push('storycraft: missing deck');
  if (!first) out.push('storycraft: missing lede');

  // Corrections are publication metadata, not a giant article section.
  if (sections.some((s) => PROCESS_SECTION.test(String(s?.title || '')))) {
    out.push('storycraft: internal process/correction section is reader-facing');
  }

  // Internal audit/process language belongs in the collapsed evidence layer.
  for (const [label, re] of INTERNAL_PROCESS) {
    if (re.test(bodyText) || re.test(deck)) out.push(`storycraft: ${label} leaked into reader-facing copy`);
  }

  if (a.kind === 'brief') {
    if (words(deck) > 55) out.push(`storycraft: brief deck is ${words(deck)} words; target is 55 or fewer`);
    if (words(first) < 18) out.push(`storycraft: brief lede is only ${words(first)} words`);
    if (startsWithPublisher(first, pubs) || /^(?:according to|reports? from)\b/i.test(first)) {
      out.push('storycraft: brief lede starts with sourcing instead of the basketball event');
    }
    if (/under the headline\s+[“"]/i.test(bodyText)) {
      out.push('storycraft: publisher headline is quoted in article body instead of left in evidence');
    }
    const quoteCount = countMatches(bodyText, /[“”"]/g);
    if (quoteCount >= 2) out.push('storycraft: brief body contains publisher-style quotation clutter');

    const namesInDeck = pubs.filter((name) => deck.toLowerCase().includes(name.toLowerCase())).length;
    if (namesInDeck >= 3) out.push('storycraft: deck is a source list instead of a reader-facing summary');

    const generic = sections.filter((s) => GENERIC_SECTION.test(String(s?.title || '')));
    if (generic.length >= 2) out.push(`storycraft: ${generic.length} generic/process section headings make the brief read like a template`);

    const pbeMentions = countMatches(bodyText, /\bPropBetEdge(?:’s|'s)?\b/g);
    if (pbeMentions > 1) out.push(`storycraft: PropBetEdge process/data language appears ${pbeMentions} times in the brief body`);
    if (/^PropBetEdge(?:’s|'s)?\b/i.test(first)) out.push('storycraft: brief lede leads with PropBetEdge instead of the event');

    // A source-driven brief should still read as a sequence of basketball facts.
    if (body.length >= 3) {
      const short = body.filter((p) => words(p) < 12).length;
      if (short >= 2) out.push('storycraft: brief is fragmented into note-like paragraphs');
    }
  }

  // All story types: prohibit boilerplate that describes the publishing system
  // instead of the event. This catches regressions outside the brief lane too.
  if (/\b(?:this story is updated at the same address|generated by PropBetEdge|publication gate)\b/i.test(bodyText)) {
    out.push('storycraft: publishing-system boilerplate leaked into article body');
  }

  return [...new Set(out)];
}

export function storyCraftAssessment(a) {
  const failures = storyCraftFailures(a);
  return {
    version: STORYCRAFT_VERSION,
    pass: failures.length === 0,
    failures,
    headline_words: words(a?.headline),
    deck_words: words(a?.deck),
    body_words: words((a?.body || []).join(' ')),
    section_count: (a?.sections || []).length
  };
}
