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

export const INTELLIGENCE_VERSION = 'pbe-intelligence/1.0.0';

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

/** The stored decision, or the same decision recomputed for an article written before the contract existed. */
export function intelligenceOf(a) {
  if (a?.intelligence?.version && a.intelligence.render) return a.intelligence;
  return decideIntelligence({ kind: a?.kind, entities: a?.entities, market: a?.market_watch || a?.market_angle || null, international: a?.kind === 'international' });
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
