// Deterministic text-similarity primitives shared by the newsroom Worker (depth ladder, Intelligence de-duplication)
// and the article renderer. No language model, no stemming library: lower-cased content words, number tokens and set
// overlap, so the same two sentences always compare the same way.

const STOP = new Set('a an the and or but of to in on at for from by with as is are was were be been being it its this that these those their there they them she her he his we our you your not no so than then too very can could would should will just only into over under about after before when while which who whom what where why how all any each more most other some such own same both few also has have had do does did per via one two three four five six seven eight nine ten'.split(' '));

/** Sentences of a text. Splits after . ! ? (and a closing quote) followed by whitespace. */
export const sentencesOf = (t) => String(t || '').split(/(?<=[.!?”])\s+/).map((s) => s.trim()).filter(Boolean);

/** Lower-cased content words (stop words and 1–2 letter tokens removed). Numbers are kept as tokens. */
export function contentTokens(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']s\b/g, '')
    .replace(/[^a-z0-9.%+\- ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-+]+|[.\-]+$/g, ''))
    .filter((w) => w && (/\d/.test(w) || (w.length > 2 && !STOP.has(w))));
}

export const numbersOf = (t) => [...String(t || '').matchAll(/(?<![\w.])[-+−]?\d+(?:\.\d+)?/g)].map((m) => m[0].replace('−', '-').replace(/^\+/, ''));

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i += 1;
  return i / (A.size + B.size - i);
}

/** Share of `a`'s content tokens that also appear in `b` (containment, not symmetric). */
export function containment(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i += 1;
  return i / A.size;
}

/**
 * Does `sentence` restate something the `corpus` sentences already say? True when it overlaps one corpus sentence
 * heavily (Jaccard ≥ 0.5), or when most of its content is contained in one corpus sentence (≥ 0.7), or when every
 * number it states is already stated and its wording overlaps meaningfully (≥ 0.3 against the best sentence).
 */
export function restates(sentence, corpus, corpusNumbers = null) {
  const s = contentTokens(sentence);
  if (!s.length) return true;
  const nums = numbersOf(sentence).filter((n) => !/^[0-5]$/.test(n));
  const have = corpusNumbers || new Set(corpus.flatMap(numbersOf));
  let best = 0;
  let bestC = 0;
  for (const c of corpus) {
    const t = contentTokens(c);
    best = Math.max(best, jaccard(s, t));
    bestC = Math.max(bestC, containment(s, t));
  }
  if (best >= 0.5 || bestC >= 0.7) return true;
  return nums.length > 0 && nums.every((n) => have.has(n)) && best >= 0.3;
}
