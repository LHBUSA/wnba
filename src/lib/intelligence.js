// PropBetEdge Intelligence — the ONE article-level decision about betting relevance.
//
// Shared by the newsroom generators (workers/wnba-news finalize), the publication gate, the article renderer,
// story cards and share cards. Nothing else may infer relevance: the Bettor/Market modules, "markets touched"
// labels, model language and sportsbook links all read `decideIntelligence()` or its stored result.
//
//   market_relevance   actionable  stored facts connect the story to a current WNBA player/team/game AND a stored
//                                  market capture is attached — betting relevance, market evidence and markets
//                                  touched may render.
//                      contextual  the story touches a current WNBA player/team/game (availability, roster, workload)
//                                  but no market capture is attached — context may render, never as a market edge,
//                                  never with markets touched or sportsbook links.
//                      none        no current WNBA player/team/game is involved — no betting or market module at all.
//   market_data_status attached | available | unavailable | not_applicable
//
// Why a single decision: the v1 contract let each generator write a bettor summary, a separate `markets` list and a
// separate market module. An international story with no WNBA participant said "nothing here bears on a WNBA line",
// listed "Markets touched: player workload" and rendered a Market Angle advertising the props board — three
// modules, three independent inferences.

import { sentencesOf, numbersOf, restates, repeatsIdea } from './semantic.js';

// 1.2.0: additive copy also rejects paraphrased ideas (semantic.js repeatsIdea). Copy stored under an older version is
// re-filtered on read, so a page never shows a module the current rule would suppress.
export const INTELLIGENCE_VERSION = 'pbe-intelligence/1.2.0';

// Kinds whose article is built on a stored sportsbook capture by definition.
const MARKET_KINDS = new Set(['props', 'market', 'trend']);

/** Markets a stored capture actually carries. Nothing here comes from a generator's wish list. */
export function attachedMarkets(kind, market) {
  const m = market?.market || null;
  const out = [];
  if (m) {
    if (m.spread && (m.spread.home_line !== undefined && m.spread.home_line !== null)) out.push('spread');
    if (m.total && m.total.line !== undefined && m.total.line !== null) out.push('total');
    if (m.moneyline || m.h2h) out.push('moneyline');
  }
  if (market?.line && !out.length) out.push(market.line.market || 'line');
  if (kind === 'props') out.push('player props');
  return [...new Set(out)];
}

/**
 * The decision. `entities` are the article's entities: WNBA links are `player`, `team` and `game` entities (the
 * international crosswalk emits `player` only for a current WNBA roster player). `market_angle`/`market_watch` is
 * the stored capture, if any.
 */
export function decideIntelligence({ kind, entities = [], market = null, international = false } = {}) {
  const links = (entities || []).filter((e) => e && ['player', 'team', 'game'].includes(e.type) && e.id !== null && e.id !== undefined && e.id !== '');
  const markets = attachedMarkets(kind, market);
  const attached = Boolean(market?.market || market?.line || MARKET_KINDS.has(kind));
  const relevance = links.length && attached ? 'actionable' : links.length ? 'contextual' : 'none';
  const data_status = attached ? 'attached' : market?.game_id ? 'available' : links.length ? 'unavailable' : 'not_applicable';
  return {
    version: INTELLIGENCE_VERSION,
    market_relevance: relevance,
    market_data_status: relevance === 'none' ? 'not_applicable' : data_status,
    markets_touched: relevance === 'actionable' ? markets : [],
    links: links.map((e) => ({ type: e.type, id: String(e.id) })),
    label: relevance === 'actionable' ? 'Betting relevance' : relevance === 'contextual' ? (international ? 'What carries back to the WNBA' : 'WNBA context') : null,
    // Renderer switches — derived here, once, so no module can decide differently.
    render: {
      intelligence: relevance !== 'none',
      betting_relevance: relevance === 'actionable',
      context: relevance === 'contextual',
      market_evidence: relevance === 'actionable' && attached,
      markets_touched: relevance === 'actionable' && markets.length > 0,
      sportsbook_links: relevance === 'actionable',
      model_context: false // no PropBetEdge WNBA model is published
    }
  };
}

// Sentences that carry no information of their own: standing disclaimers and process notes. They never justify a module.
export const INTELLIGENCE_BOILERPLATE = /(context,? (rather than|not) a signal|matters (for a line or prop )?only if|is revised when one does|captured only inside 36 hours|check the availability panel|^next up:|no closing line is available|depth moves rarely move a game line|one game is a sample of one|provider status,? not the league’s official|every comparison (here|in this preview) describes the past|details not present in PropBetEdge structured records|whether this development changes official availability|read it as a description of the (spread )?pricing, not a forecast)/i;

/**
 * pbe-intelligence/1.1.0 — the article body and PropBetEdge Intelligence have distinct jobs. The body reports; the
 * module may only ADD derived or market intelligence. Every sentence of the generator's bettor copy is kept only when
 * it is not boilerplate and does not restate the body (src/lib/semantic.js restates). Without an attached market
 * (contextual relevance) a sentence must also introduce a figure the body does not state — context the article already
 * explains is not repeated as "intelligence". No additive summary → no module.
 */
export function additiveCopy(a, { relevance = null } = {}) {
  const b = a?.bettor_angle;
  if (!b) return null;
  const corpus = sentencesOf([a.headline, a.deck, ...(a.body || [])].filter(Boolean).join(' '));
  const nums = new Set(corpus.flatMap(numbersOf));
  const rel = relevance || decideIntelligence({ kind: a.kind, entities: a.entities, market: a.market_watch || a.market_angle || null }).market_relevance;
  const newFigure = (x) => numbersOf(x).some((n) => !/^[0-5]$/.test(n) && !nums.has(n));
  // Restating a sentence OR repeating its idea in other words ("the key consideration for bettors is availability")
  // is not additive.
  const keep = (x) => x && !INTELLIGENCE_BOILERPLATE.test(x) && !restates(x, corpus, nums) && !repeatsIdea(x, corpus) && (rel === 'actionable' || newFigure(x));
  const read = [b.summary, ...(b.supporting || [])].filter(Boolean).flatMap(sentencesOf);
  const kept = read.filter(keep);
  const against = (b.against || []).filter(keep);
  const unknown = (b.unknown || []).filter(keep);
  return { summary: kept[0] || null, supporting: kept.slice(1), against, unknown, dropped: read.length - kept.length + (b.against || []).length - against.length + (b.unknown || []).length - unknown.length };
}

/** The stored decision, or the same decision recomputed for an article written before the contract existed. */
export function intelligenceOf(a) {
  const base = a?.intelligence?.version && a.intelligence.render ? a.intelligence : decideIntelligence({ kind: a?.kind, entities: a?.entities, market: a?.market_watch || a?.market_angle || null, international: a?.kind === 'international' });
  if (base.copy !== undefined && base.version === INTELLIGENCE_VERSION) return base;
  // Legacy record: the module renders only the additive part of its copy.
  const copy = base.render.intelligence ? additiveCopy(a, { relevance: base.market_relevance }) : null;
  return { ...base, copy, render: { ...base.render, intelligence: base.render.intelligence && Boolean(copy?.summary) } };
}

// Language that sells a market position. Allowed only when relevance is actionable; never for context or none.
export const ACTIONABLE_LANGUAGE = /\b(edge|value (play|bet|side)|mispric\w*|best bet|bet (on|against)|lean (to|toward|towards|the)?\s*(over|under)|take the (over|under)|fade|sharp (money|action|side)|(line|spread|total|odds|price) (moved|movement|move|moves|shifted|shift|dropped|rose|jumped)|market (edge|gap)|expected value|\+EV|play the (over|under)|smash)\b/i;
const PRICE = /(\b[-+]\d{3,}\b|\bO\/U \d|\b(favou?rites?|underdogs?) by\b|\b\d+(\.\d)?-point (favou?rite|underdog)s?\b)/i;

/** Contract check used by the publication gate. Returns failure strings. */
export function intelligenceFailures(a) {
  const intel = intelligenceOf(a);
  const out = [];
  const angle = a.bettor_angle;
  const copy = angle ? [angle.summary, ...(angle.supporting || []), ...(angle.against || []), ...(angle.unknown || [])].filter(Boolean).join(' ') : '';
  const marketText = (a.market_watch?.text || []).join(' ');
  if (intel.market_relevance === 'none') {
    if (copy.trim()) out.push('intelligence: relevance is none but betting copy exists');
    if (marketText.trim()) out.push('intelligence: relevance is none but market copy exists');
    if ((angle?.markets || []).length) out.push('intelligence: markets touched without market relevance');
  }
  if (intel.market_relevance !== 'actionable') {
    if ((angle?.markets || []).length) out.push('intelligence: markets touched require actionable relevance');
    if (ACTIONABLE_LANGUAGE.test(`${copy} ${marketText}`)) out.push('intelligence: actionable market language without actionable relevance');
    if (PRICE.test(`${copy} ${marketText}`)) out.push('intelligence: price language without an attached market');
  }
  if (intel.market_relevance === 'actionable') {
    if (!intel.links.length) out.push('intelligence: actionable relevance without a WNBA player, team or game');
    if (intel.market_data_status !== 'attached') out.push('intelligence: actionable relevance without an attached market');
  }
  for (const m of angle?.markets || []) if (!intel.markets_touched.includes(m)) out.push(`intelligence: market "${m}" is not in the attached capture`);
  return out;
}
