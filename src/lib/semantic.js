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

// ------------------------------------------------------------ ideas (paraphrase-level repetition)
//
// A sentence's IDEA is the set of basketball/market concepts it is about, plus the figures and names it states.
// Framing words ("this matters because", "the key consideration for bettors is", "worth watching") are not ideas.
// A sentence repeats an idea when everything it is about is already covered by one earlier sentence and it states no
// figure or name the corpus does not already carry: "the key consideration for bettors is player availability"
// repeats "this matters because of player availability".

export const CONCEPTS = {
  availability: /\b(availab\w*|injur\w*|listed (out|as)|out for|ruled out|absence|absent|without (her|them)|return(s|ed|ing)?( date)?|day-to-day|questionable|doubtful|healthy|scratch\w*|feed)\b/i,
  minutes: /\b(minutes?|workload|rotation|role|starts?|starter|bench|reserves?)\b/i,
  spread: /\b(spread|favou?rites?|underdogs?|cover\w*|line|lay|laying|points? (favou?rites?|underdogs?))\b/i,
  total: /\b(totals?|over\b|under\b|overs|unders|combined (points|scoring))\b/i,
  moneyline: /\b(moneylines?|no-vig|implied (chance|probability)|win probability)\b/i,
  movement: /\b(mov(e|ed|es|ement)|shift\w*|opened|opening|drift\w*|steam)\b/i,
  form: /\b(form|last (5|10|five|ten)|recent\w*|streak|margins?)\b/i,
  season_record: /\b(season (record|differential|average)|differentials?|\d+-\d+ record|standings?|seed)\b/i,
  rest: /\b(rest|back-to-back|days? off|layoff)\b/i,
  pace: /\b(pace|possessions?)\b/i,
  shooting: /\b(shoot\w*|shot|field goal|from three|3-point|percent|%|efficien\w*)\b/i,
  rebounding: /\b(rebound\w*|glass|boards)\b/i,
  turnovers: /\b(turnovers?|giveaways?|steals?)\b/i,
  schedule: /\b(next (game|opponent|up)|schedule|host\w*|visit\w*|on the road|at home)\b/i,
  sample: /\b(sample|small|fragile|one game|window)\b/i,
  props: /\b(props?|player lines?|prop lines?)\b/i,
  scoring: /\b(scor\w*|points? (a|per) game|ppg)\b/i
};
// Audience/framing words carry no information of their own.
const FRAMING = /\b(bettors?|betting|for bettors|matters?|key consideration|important|worth (watching|noting)|the question|what to watch|to watch|consideration|relevant|relevance|note that|notably)\b/gi;

export function ideaOf(sentence) {
  const text = String(sentence || '').replace(FRAMING, ' ');
  const concepts = new Set(Object.entries(CONCEPTS).filter(([, re]) => re.test(text)).map(([k]) => k));
  const numbers = new Set(numbersOf(text).filter((n) => !/^[0-5]$/.test(n)));
  const names = new Set([...text.matchAll(/\b([A-Z][a-z’']+(?:\s+[A-Z][a-z’']+)+)\b/g)].map((m) => m[1]).filter((n) => !/^(The|That|This|Her|Their|Its|Over|Against|On|In|At|With|For|What|When|Next|Rest|Season|Recent)\b/.test(n)));
  return { concepts, numbers, names };
}

/**
 * Does `sentence` repeat an idea already expressed in `corpus` (an array of sentences)? True when its concept set is
 * non-empty and contained in one corpus sentence's concepts, and it adds no new figure or name.
 */
export function repeatsIdea(sentence, corpus) {
  const s = ideaOf(sentence);
  if (!s.concepts.size) return false;
  const allNumbers = new Set(corpus.flatMap((c) => [...ideaOf(c).numbers]));
  const allNames = new Set(corpus.flatMap((c) => [...ideaOf(c).names]));
  if ([...s.numbers].some((n) => !allNumbers.has(n))) return false;
  if ([...s.names].some((n) => !allNames.has(n) && ![...allNames].some((m) => m.includes(n) || n.includes(m)))) return false;
  return corpus.some((c) => { const k = ideaOf(c).concepts; return k.size > 0 && [...s.concepts].every((x) => k.has(x)); });
}

/** Sentences in `later` (e.g. an Intelligence module) that restate or repeat the ideas of `earlier` (e.g. the body). */
export function duplicatedIdeas(later, earlier) {
  const corpus = earlier.flatMap(sentencesOf);
  const nums = new Set(corpus.flatMap(numbersOf));
  return later.flatMap(sentencesOf).filter((s) => restates(s, corpus, nums) || repeatsIdea(s, corpus));
}
