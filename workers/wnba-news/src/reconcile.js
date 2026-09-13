// Reconcile — an ADDED publication gate for WNBA newsroom articles.
//
// gate.js validate() is unchanged and still runs first. reconcileArticle() runs after it and can HOLD a story
// the number gate cannot see is wrong: a number can be "in a cited record" and still be the wrong season, an
// injury list can be grounded and still be incomplete, a headline can be true and still imply one player did
// what two did. Every check reads the article's own facts plus the full current injury feed; none trusts a
// count the generator computed about itself when an independent record is available.
//
//   R0  prose lint (corpus-wide patterns: a/an before numbers, zero constructions, duplicated numbers, spacing,
//       placeholders, rest wording, definitive-availability wording, unlabelled return dates)
//   R1  season-year integrity (player stats carry a provenance; prior-season stats must name year + team and
//       never sit next to "this season"; current-season stats must come from current-season games)
//   R2  absence context (no "has to be absorbed" language for an absence the team has already played through)
//   R3  injury-feed reconciliation (every current feed listing for a team the story describes is named)
//   R4  co-leaders (a headline/deck that names one of several materially equivalent lines names all of them)
//   R5  market-type alignment (the bettor analysis leads with the market the story is about)
//   R6  rest semantics (a stated rest figure equals the source's rest_days; no derived "days before tip")
//   R7  ESPN injury-comment text never appears in generated prose (8-word shingles)

import { aan } from './prose.js';

export const RECONCILE_VERSION = 'wnba-reconcile/1.0.0';

const proseParts = (a) => [a.headline, a.deck, ...(a.body || []), a.bettor_angle?.summary, ...(a.bettor_angle?.supporting || []), ...(a.bettor_angle?.against || []), ...(a.bettor_angle?.unknown || []), ...(a.market_watch?.text || [])].filter(Boolean);
const sentencesOf = (t) => String(t || '').split(/(?<=[.!?”])\s+/).filter(Boolean);
// Headline, deck and each paragraph are separate prose units: a sentence never spans two of them.
const allSentences = (parts) => parts.flatMap((p) => sentencesOf(p));
const MONTH_DAY = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?\b/g;
const CLOCKY = /\b\d{1,2}:\d{2}(?: ?(?:a\.m\.|p\.m\.|AM|PM))?(?: ET)?\b/g;
const scrubDates = (s) => String(s).replace(MONTH_DAY, ' ').replace(CLOCKY, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ');

// ------------------------------------------------------------ R0 lint

export const LINT_RULES = [
  ['zero construction', /(?<![\d.:])[+\-−]?0(?:\.0+)?\s+(?:a game|per game|points? a game|starts?|games?|minutes?|rebounds?|assists?|lead changes?|ties?|books?|players?)\b/i],
  ['signed zero', /(?<![\d.:])[+\-−]0(?:\.0+)?(?![\d.])/],
  ['duplicated number ("34 and 34")', /(?<!,\s)(?<![\d.])(\d+(?:\.\d+)?) and \1(?![\d.])/],
  ['double space', /\S {2,}\S/],
  ['space before punctuation', / [,.;:!?](?:\s|$)/],
  ['placeholder text', /\b(undefined|NaN|null)\b|\[object /],
  // Deterministic singular/plural agreement for counted stat nouns: "1 assists" and "3 assist" never ship.
  ['singular count with a plural noun', /(?<![\d.,])1 (points|rebounds|assists|steals|blocks|turnovers|fouls|minutes|three-pointers|free throws|games|starts|offensive rebounds|defensive rebounds|lead changes|ties|wins|losses)\b/i],
  ['plural count with a singular noun', /(?<![\d.,])(?:[02-9]|\d{2,}) (point|rebound|assist|steal|block|turnover|foul|minute|three-pointer|free throw|offensive rebound|lead change)(?![-\w])/i],
  ['repeated word', /\b([A-Za-z]{3,}) \1\b/i],
  ['derived rest wording ("days before tip")', /\bdays? before (?:this |the )?tip\b/i],
  ['definitive availability from an estimate', /\b(?:will|is expected to|are expected to|is set to|are set to|is slated to|are slated to) (?:return|play|be back|be available)\b/i]
];

export function lintProse(text) {
  const issues = [];
  const t = String(text || '');
  for (const [name, re] of LINT_RULES) { const m = t.match(re); if (m) issues.push(`${name}: “${t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\n/g, ' ')}”`); }
  for (const m of t.matchAll(/\b(a|an)\s+([+\-−]?\d[\d,]*(?:\.\d+)?)/gi)) {
    const want = aan(m[2]);
    if (m[1].toLowerCase() !== want) issues.push(`article: “${m[0]}” should be “${want} ${m[2]}”`);
  }
  for (const s of sentencesOf(t)) {
    if (/\breturn date\b|\bestimated return\b/i.test(s) && !(/ESPN/i.test(s) && /estimat/i.test(s) && /updat/i.test(s))) issues.push(`return date without ESPN + estimate + feed update: “${s.slice(0, 160)}”`);
  }
  return issues;
}

// ------------------------------------------------------------ R4 co-leaders

/**
 * "Materially equivalent" lines, stated as a rule:
 *   points     — every player within 2 points of the game high, when the game high is 20 or more;
 *   rebounds   — when the headline line is a rebounding line (15+), every player within 1 rebound of it;
 *   assists    — when the headline line is an assist line (12+), every player within 1 assist of it;
 *   triple-double — every triple-double in the game.
 * Two lines that meet the rule are the same story; naming one of them alone implies a solo performance.
 */
export const CO_LEADER_RULE = { points: { within: 2, min_high: 20 }, rebounds: { within: 1, min: 15 }, assists: { within: 1, min: 12 } };
const isTD = (r) => (r.pts ?? 0) >= 10 && (r.reb ?? 0) >= 10 && (r.ast ?? 0) >= 10;
export function coLeaders(lines, stat = 'pts') {
  const xs = (lines || []).filter((r) => r && r.name);
  if (!xs.length) return [];
  if (stat === 'td') return xs.filter(isTD);
  if (stat === 'reb' || stat === 'ast') {
    const R = stat === 'reb' ? CO_LEADER_RULE.rebounds : CO_LEADER_RULE.assists;
    const hi = Math.max(...xs.map((r) => r[stat] ?? 0));
    if (hi < R.min) return [];
    return xs.filter((r) => (r[stat] ?? 0) >= hi - R.within && (r[stat] ?? 0) >= R.min);
  }
  const hi = Math.max(...xs.map((r) => r.pts ?? 0));
  if (hi < CO_LEADER_RULE.points.min_high) return [];
  return xs.filter((r) => (r.pts ?? 0) >= hi - CO_LEADER_RULE.points.within);
}

// ------------------------------------------------------------ R5 market vocabulary

const MARKET_WORDS = {
  // "over"/"under" only in a betting sense — not the preposition ("Over their last 10 …")
  total: /\b(?:totals?|overs|unders|combined points|combined scoring|(?:went|goes|going|landed|stayed|cleared|sits?|sat)\s+(?:over|under)|(?:over|under)\s+the\s+total)\b/i,
  spread: /\b(spread|cover(?:ed|s)?|favou?rites?|favou?red|underdogs?|lay|lays|laid|against the spread)\b/i,
  moneyline: /\b(moneylines?|win price|implied (?:chance|probability)|to win outright)\b/i
};
export function firstMarket(text) {
  let best = null;
  for (const [k, re] of Object.entries(MARKET_WORDS)) { const m = String(text || '').match(re); if (m && (best === null || m.index < best.i)) best = { k, i: m.index }; }
  return best?.k || null;
}

// ------------------------------------------------------------ R7 comment shingles

// Alphabetic tokens only: two texts citing the same averages are not copied text, they are the same records.
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z]+/g, ' ').trim();
function shingles(text, n = 8) {
  const w = norm(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  return out;
}

// ------------------------------------------------------------ the check

export function reconcileArticle(a, ctx = {}) {
  const failures = [];
  const parts = proseParts(a);
  const all = parts.join('\n');
  const f = a.facts || {};

  // R0 — each prose unit separately, so a lint pattern never spans a headline and a deck
  for (const part of parts) for (const x of lintProse(part)) failures.push(`R0 lint — ${x}`);

  // R1 season-year integrity
  const season = ctx.season;
  const SEASON_WORDS = /\b(this season|season so far|so far this season|her season|season average|season mark|on the season)\b/i;
  for (const pv of f.provenance || []) {
    if (!season) break;
    if (pv.year === season) {
      if (!(pv.games > 0) || pv.season_name !== `${season} Regular Season`) failures.push(`R1 season — ${pv.name}: stat provenance claims ${season} but is ${pv.season_name || 'unlabelled'} with ${pv.games || 0} games`);
      continue;
    }
    const stats = [pv.games, pv.pts, pv.min, pv.reb].filter((v) => Number.isFinite(v)).map((v) => String(Math.round(v * 10) / 10));
    let labelled = false;
    for (const s of allSentences(parts)) {
      const aboutHer = s.includes(pv.name) || /^(Her|She)\b/.test(s);
      if (!aboutHer) continue;
      if (s.includes(pv.name) && SEASON_WORDS.test(s) && !s.includes(String(pv.year))) failures.push(`R1 season — ${pv.name}: “${s.slice(0, 120)}” uses current-season language, but her stats are from ${pv.year}`);
      const nums = (scrubDates(s).match(/(?<![\w.])\d+(?:\.\d+)?/g) || []);
      if (nums.some((x) => stats.includes(x))) {
        if (!s.includes(String(pv.year)) || (pv.team && !s.includes(pv.team.split(' ').pop()))) failures.push(`R1 season — ${pv.name}: “${s.slice(0, 140)}” states ${pv.year} stats without naming the year and team`);
        else labelled = true;
      }
    }
    if (!labelled && parts.join(' ').includes(pv.name)) { /* prior-season stats omitted entirely: allowed */ }
  }
  if (season && SEASON_WORDS.test(all) && (f.provenance || []).length && !(f.provenance || []).some((pv) => pv.year === season)) failures.push('R1 season — current-season language with no current-season stat provenance');

  // R2 absence context
  if (['long', 'intermittent'].includes(f.absence?.mode)) {
    const m = all.match(/\b(?:has|have) to (?:be )?(?:absorb|replace|cover)\w*|\bto be absorbed\b|\bgo somewhere\b|\bmust (?:be )?absorb\w*/i);
    if (m) failures.push(`R2 absence — “${m[0]}” for a ${f.absence.mode} absence (${f.absence.games_since ?? '?'} team games since her last appearance)`);
  }

  // R3 injury-feed reconciliation, against the full current feed (not the generator's own list)
  if (ctx.injuries) {
    for (const tid of f.injury_scope || []) {
      const feed = ctx.injuries.filter((x) => String(x.team_id) === String(tid));
      const missing = feed.filter((x) => !all.includes(x.name));
      if (missing.length) failures.push(`R3 injuries — team ${tid}: feed lists ${feed.length}, story names ${feed.length - missing.length} (missing ${missing.map((x) => x.name).join(', ')})`);
    }
  } else if ((f.injury_scope || []).length && !f.injury_feed_unavailable) failures.push('R3 injuries — no feed supplied to reconcile against');

  // R4 co-leaders
  if (f.box_lines && f.headline_stat) {
    const cl = coLeaders(f.box_lines, f.headline_stat);
    if (cl.length > 1) {
      for (const [where, text] of [['headline', a.headline], ['deck', a.deck]]) {
        const named = cl.filter((p) => text.includes(p.name));
        if (named.length && named.length < cl.length) failures.push(`R4 co-leaders — ${where} names ${named.map((p) => p.name).join(', ')} but not ${cl.filter((p) => !named.includes(p)).map((p) => p.name).join(', ')} (materially equivalent lines)`);
      }
    }
  }

  // R5 market-type alignment
  if (a.market_type) {
    const lead = [a.bettor_angle?.summary, ...(a.bettor_angle?.supporting || [])].join(' ');
    const got = firstMarket(lead);
    if (got !== a.market_type) failures.push(`R5 market — a ${a.market_type} story whose bettor analysis leads with ${got || 'no market'}`);
    const read = (a.sections || []).find((s) => s.title === 'The read');
    const readText = read ? a.body.slice(read.first, read.first + read.count).join(' ') : a.body[0];
    const gotRead = firstMarket(readText);
    if (gotRead && gotRead !== a.market_type) failures.push(`R5 market — “The read” of a ${a.market_type} story leads with ${gotRead}`);
  }

  // R6 rest semantics
  for (const m of all.matchAll(/(\d+) days? of rest/gi)) if (!(f.rest_days || []).includes(Number(m[1]))) failures.push(`R6 rest — “${m[0]}” is not a rest_days value in the source (${(f.rest_days || []).join(', ') || 'none'})`);

  // R7 ESPN injury-comment text never in prose
  if (ctx.injuries) {
    const ours = shingles(all);
    for (const x of ctx.injuries) for (const c of [x.short_comment, x.long_comment]) {
      if (!c || norm(c).split(' ').length < 8) continue;
      for (const sh of shingles(c)) if (ours.has(sh)) { failures.push(`R7 comment text — prose repeats ESPN comment text for ${x.name}: “${sh}”`); break; }
    }
  }

  return { ok: failures.length === 0, failures, version: RECONCILE_VERSION };
}
