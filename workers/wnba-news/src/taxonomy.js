// Event taxonomy and materiality gate for the WNBA source wire — wnba-taxonomy/1.2.0.
//
// Deterministic and stated: regular expressions over the publisher's headline, short summary and categories, plus
// the source's tier. Nothing here calls a language model and nothing reads an article body.
//
//   event_type  what happened (injury, signing, waiver, trade, coaching, awards, cba, …)
//   lane        which newsroom desk the event belongs to (injuries, roster, league, international, games, market, other)
//   story_type  the legacy v1 type, kept so existing consumers (briefs, feed filters, Supabase rows) keep working
//   materiality { score, level, material, reasons, flags } — whether the event can become a PropBetEdge story

export const TAXONOMY_VERSION = 'wnba-taxonomy/1.2.0';

/** Score at or above which a source-wire event may become a new PropBetEdge story. */
export const MATERIAL_THRESHOLD = 3.5;

export const EVENT_TYPES = {
  injury: { lane: 'injuries', base: 3, legacy: 'injury', label: 'Injury' },
  availability: { lane: 'injuries', base: 2.5, legacy: 'injury', label: 'Availability' },
  trade: { lane: 'roster', base: 4, legacy: 'trade', label: 'Trade' },
  signing: { lane: 'roster', base: 3, legacy: 'transaction', label: 'Signing' },
  waiver: { lane: 'roster', base: 3, legacy: 'transaction', label: 'Waiver / release' },
  roster_move: { lane: 'roster', base: 3, legacy: 'transaction', label: 'Roster move' },
  coaching: { lane: 'league', base: 3.5, legacy: 'coaching', label: 'Coaching' },
  front_office: { lane: 'league', base: 3, legacy: 'coaching', label: 'Front office' },
  awards: { lane: 'league', base: 3, legacy: 'league', label: 'Awards' },
  record: { lane: 'games', base: 2.5, legacy: 'performance', label: 'Record / milestone' },
  playoff: { lane: 'league', base: 2.5, legacy: 'playoffs', label: 'Playoff picture' },
  expansion: { lane: 'league', base: 3.5, legacy: 'league', label: 'Expansion' },
  cba: { lane: 'league', base: 3.5, legacy: 'league', label: 'CBA / labor' },
  draft: { lane: 'league', base: 2.5, legacy: 'league', label: 'Draft' },
  league: { lane: 'league', base: 2.5, legacy: 'league', label: 'League' },
  business: { lane: 'league', base: 1.5, legacy: 'news', label: 'Business' },
  international: { lane: 'international', base: 1.5, legacy: 'news', label: 'International' },
  lineup: { lane: 'games', base: 2, legacy: 'lineup', label: 'Lineup' },
  market: { lane: 'market', base: 0.5, legacy: 'preview', label: 'Market / prop watch' },
  preview: { lane: 'games', base: 0.5, legacy: 'preview', label: 'Preview' },
  result: { lane: 'games', base: 1, legacy: 'recap', label: 'Result' },
  performance: { lane: 'games', base: 1, legacy: 'performance', label: 'Performance' },
  news: { lane: 'other', base: 1, legacy: 'news', label: 'News' }
};

export const LANES = {
  injuries: 'Injuries',
  roster: 'Roster Moves',
  league: 'League',
  international: 'International',
  games: 'Games',
  market: 'Market',
  other: 'Other'
};

export const INTERNATIONAL_RE = /\b(fiba|world cup|olympic|olympics|eurobasket|eurocup|euroleague|team usa|national team|americup|asia cup|afrobasket)\b/i;

const NOT_A_NAME = '(?!Playoff|Schedule|Statement|Video|Report|Details|List|Jersey|Poster|Trailer|Uniform|Guidelines|Findings|Survey|Data|Ratings|Numbers|Documentary|Film|Tickets?|Merch|Collection|Plans?|Update)';
const RELEASE_PLAYER = new RegExp(`\\b[Rr]eleas(?:e|es|ed|ing)\\s+(?:[Gg]uard|[Ff]orward|[Cc]enter|[Rr]ookie|[Vv]eteran|${NOT_A_NAME}[A-Z][a-z]+\\s[A-Z][A-Za-z'’-]+)`);

// Ordered: the first rule that matches wins. Structural/league rules run before player verbs so "Commissioner to
// retire" is league news, and roster verbs run before injury words so "Storm sign X after Y's injury" is a roster move.
const RULES = [
  ['business', /\b(sign(s|ed|ing)? (a |an )?(multi-year |new |lifetime |signature )?(shoe|endorsement|sponsorship|nil|media|broadcast|apparel|marketing) (deal|contract|partnership)|signature shoe|media rights deal)\b/i],
  ['cba', /\b(cba|collective bargaining|wnbpa|players'? association|labor (deal|talks|agreement|negotiations?)|lockout|work stoppage|salary cap|revenue shar(e|ing)|max(imum)? salary|minimum salary|opt(s|ed)? out of the (cba|agreement))\b/i],
  ['expansion', /\b(expansion (team|franchise|fee|draft|bid|city|cities|process)|expand(s|ing)? to \d+ teams|awarded (a|an) (wnba )?(franchise|team)|new franchise|wnba expansion)\b/i],
  ['league', /\b(commissioner|league office|board of governors)\b/i],
  ['trade', /\b(traded|trade[sd]? (for|with|to|away)|in a trade|trade (deal|package|agreement)|deal sends|acquire[sd]?|acquisition of|sign-and-trade)\b/i],
  ['waiver', /\b(waive[sd]?|waiving|claim(s|ed)? off waivers|cut[s]? (guard|forward|center)|parts? ways with (guard|forward|center))\b/i],
  ['signing', /\b(sign(s|ed)? (?!of\b|autographs?\b|day\b)|signing (?!day\b|of\b|autographs?\b)|re-sign(s|ed|ing)?|inks?|agree(s|d)? to (a )?(terms|deal|contract)|rest-of-season contract|seven-day contract|7-day contract|hardship (contract|exception)|training camp contract|contract extension|sign(s|ed)? .{0,40}(contract|extension|deal)$)/i],
  ['roster_move', /\b(activate[sd]?|hardship|suspend(s|ed)?|suspension|placed on|reinstate[sd]?|announces? (her |his )?retirement|retire[sd]? from|option (exercised|declined)|core(d)? (designation|player)|roster (move|cut|spot|update)|contract (suspended|terminated)|free agen(t|cy))\b/i],
  ['injury', /\b(injur(y|ies|ed)|out for (the )?(season|year|remainder)|(for|out) (the )?rest of (the )?season|los(e|es|ing) .{2,40} for (the )?(rest of (the )?)?season|season-ending|ruled out|will miss|miss(es)? (the )?(rest|remainder)|questionable|doubtful|day-to-day|torn|tear(s|ing)? (her |his |an? |the )?(left |right )?(acl|achilles|meniscus|mcl|labrum|ligament)|\bacl\b|achilles|meniscus|sprain(ed)?|fracture[sd]?|surgery|(knee|ankle|foot|hip|hand|wrist|back|shoulder|calf|hamstring) (procedure|surgery|injury|soreness|contusion)|undergoes|underwent|concussion|protocol|sidelined|health update|setback|strain(ed)?|out indefinitely)\b/i],
  ['availability', /\b(return(s|ed|ing)? (to|from) (practice|injury|action|the lineup|the court|play)|cleared to (play|return)|back (at|to) practice|expected to (play|return)|available (to play|for)|upgraded to|downgraded to|will play|won't play|load management|rest(s|ed)? (for|against))\b/i],


  ['front_office', /\b(general manager|\bgm\b|president of basketball|team president|front office|ownership group|new owners?|sale of the (team|franchise)|minority stake|chief executive|ceo)\b/i],
  ['draft', /\b(draft (lottery|pick|prospects?|order|board|night|rights)|no\. \d+ pick|first-round pick|\d{4} wnba draft|wnba draft)\b/i],
  ['record', /\b((sets?|breaks?|broke|ties?|tied|new|franchise|league|wnba|career|single-game|single-season) record|record-(setting|breaking)|rookie (?:points?|scoring) record|(?:breaks?|broke|passes?|passed|surpasses?|surpassed) .{1,70}\b(?:rookie|wnba|league|franchise) (?:points?|scoring)? ?record|milestone|career-high|all-time (leader|scoring|assists|rebounds)|first player (ever )?to|becomes the (first|fastest|youngest)|triple-double)\b/i],
  ['awards', /\b(mvp|most valuable player|(player|rookie|coach|sixth player) of the (week|month)|defensive player of the year|dpoy|rookie of the year|sixth (player|woman) of the year|most improved player|coach of the year|executive of the year|all-wnba|all-defensive|all-rookie|player of the (week|month)|rookie of the month|all-star (starters?|reserves?|selections?|roster|captains?|voting)|named (an? )?all-star|award(s|ed)?|honou?rs? (for|as))\b/i],
  ['coaching', /\b(head coach|interim coach|assistant coach|coach(es|ing)? (fired|hire[sd]?|search|change|staff)|(fires?|fired|hires?|hired|names?|named|parts? ways with|dismiss(es|ed)?) .{0,40}\bcoach)\b/i],
  ['playoff', /\b(clinch(es|ed|ing)?|eliminat(ed|ion)|magic number|tiebreakers?|wnba finals|first-round (series|bye)|playoff (seed|seeding|race|picture|schedule|bracket|spot|berth)|postseason (seed|seeding|race|picture|schedule|bracket|spot|berth)|earn(s|ed)? (a |the )?(playoff|postseason) (spot|berth))\b/i],
  ['league', /\b(wnba (announces|unveils|releases|reveals|sets|approves|fines|suspends)|schedule release|rule change|fine[sd]?|disciplin(e|ary)|investigation|commissioner'?s cup|all-star game|league-wide)\b/i],
  ['business', /\b(sponsor(ship)?|endorsement|media (rights|deal)|broadcast (deal|partner)|tv deal|streaming deal|ratings|viewership|attendance|sell-?outs?|ticket (sales|prices)|valuation|revenue|arena|practice facility|performance center|investment|investors?|lawsuit|sues|sued)\b/i],
  ['lineup', /\b(starting lineup|start(s|ing)? in place of|move(s|d)? to the bench|minutes restriction|rotation change|role change|will start)\b/i],
  ['market', /\b(odds|best bets?|picks|player props?|props|betting|point spread|over\/under|moneyline|futures)\b/i],
  ['preview', /\b(preview|what to watch|keys to|prediction(s)?|matchup to watch|storylines)\b/i],
  ['result', /\b(beat|beats|defeat(s|ed)?|top(s|ped)|rout(s|ed)?|edge(s|d)|win(s)? over|fall(s)? to|snap(s|ped)?|hold(s)? off|rall(y|ies|ied) past|outlast(s|ed)?|recaps?)\b/i],
  ['performance', /\b(\d{2}-point|\d{2} points|double-double|scores? \d{2}|season-high|drops \d{2}|career night)\b/i]
];

const OPINION_STRONG = /\b(power rankings?|rankings|mailbag|takeaways|grades?|overreactions?|hot takes?|debate|column|opinion|podcast|film (room|study)|mock draft|mvp (race|ladder|odds|watch|case)|awards? (watch|predictions|ballot|picks|race|case)|winners and losers|report card|stock (up|down)|ranking every|ranked|top \d+|\d+ (things|takeaways|questions|reasons|players|storylines|keys|thoughts|observations|stats|moments|bold|best|worst)|trade (rumou?rs?|targets|ideas|candidates|machine)|rumou?rs?|speculation|what (we|i) learned|reaction(s)?|vibe check|explained|explainer|deep dive|profile|has faith in|express(es|ed)? thoughts on|shares? thoughts on|speaks? on|weighs? in on|ready to hype)\b/i;
const SPECULATIVE = /(^\s*(why|how)\b|\b(should|could|would|might|may be|why the|why she|why they|why it|what's next|what’s next|what next|reasons|feels like|potential|candidates|frontrunners?|shortlist|contenders|in the running|not worried|homecoming)\b)/i;
const EXPLAINER = /\b(how do|how does|how the .{0,30} work|what to know|everything (you need|to know)|guides?\b|explained|explainer|dates, format|faq|primer|cheat sheet)\b/i;
const RECYCLED = /\b(on this day|throwback|flashback|look(ing)? back|lookback|anniversary|years ago|revisit(ing|ed)?|remember when|rewind|history of|oral history|retrospective|from the archives|best ever|all-time (list|team|greatest))\b/i;
const MEDIA_NOISE = /\b(how to watch|tv schedule|tv channel|live stream|streaming info|tickets?|ticket information|watch:|video:|highlights|photos?|gallery|giveaway|promo code|sweepstakes|merch(andise)?|presented by|game ?day|behind the|tracker|schedule & results|schedule and results)\b/i;
const COMMUNITY = /\b(honorees?|mural(ist)?|community|initiative|foundation|appreciation night|donat(es|ed|ion)|back-to-school|youth clinic|legend night|heritage night|pride night)\b/i;
const NOISE_CATEGORIES = /\b(community|foundation|tickets?|promotions?|partners?|photos?|gallery|video|in-arena|entertainment|fan experience|season ticket|shop|merch)\b/i;
const ROSTER_CATEGORIES = /\b(player[- ]movement|transactions?|roster)\b/i;
const INJURY_CATEGORIES = /\b(injur(y|ies)|medical)\b/i;

/** Event type from publisher text (+ optional categories). */
export function eventType(text, { categories = [] } = {}) {
  const t = String(text || '');
  const cats = (categories || []).join(' | ');
  let type = null;
  if (RELEASE_PLAYER.test(t)) type = 'waiver';
  for (const [name, re] of RULES) {
    if (type) break;
    if (re.test(t)) type = name;
  }
  if (!type && ROSTER_CATEGORIES.test(cats)) type = 'roster_move';
  if (!type && INJURY_CATEGORIES.test(cats)) type = 'injury';
  type = type || 'news';
  // International competition coverage stays in the international lane unless it carries a WNBA consequence
  // (an injury, availability change or roster move).
  if (INTERNATIONAL_RE.test(t) && !['injury', 'availability', 'trade', 'signing', 'waiver', 'roster_move', 'cba', 'expansion', 'coaching', 'front_office'].includes(type)) type = 'international';
  // Missing an international tournament (a passport, a withdrawal) is international news, not a WNBA injury.
  if (type === 'injury' && /\b(will miss|misses|to miss|withdraws? from|out of)\b.{0,30}\b(fiba|world cup|olympics?|eurobasket|americup|asia cup|afrobasket)\b/i.test(t) && !/\b(acl|torn|tear|surgery|fracture|season)\b/i.test(t)) type = 'international';
  return type;
}

export const laneOf = (type) => EVENT_TYPES[type]?.lane || 'other';
export const legacyType = (type) => EVENT_TYPES[type]?.legacy || 'news';

const sourceAdjust = (priority) => (priority === 1 ? 1.5 : priority === 2 ? 0.5 : priority === 4 ? -0.5 : 0);
// An official source is authoritative for announcements — its own roster, injuries, staff, honours and league office
// decisions — not for its promotional and matchday posts. A team's playoff post earns the boost only when it reports
// a clinch, elimination or seeding.
const OFFICIAL_AUTHORITY = new Set(['injury', 'availability', 'trade', 'signing', 'waiver', 'roster_move', 'coaching', 'front_office', 'awards', 'expansion', 'cba', 'draft', 'league']);
const PLAYOFF_FACT = /\b(clinch(es|ed|ing)?|eliminat(ed|ion)|earn(s|ed)? (a |the )?(playoff|postseason) (spot|berth)|playoff (seed|seeding|bracket|schedule)|no\. \d seed|first-round bye)\b/i;
const LEAGUE_OFFICE_FACT = /\b(commissioner|league office)\b.{0,50}\b(resign(s|ed|ing)?|steps? down|retires?|retirement|appoint(s|ed|ment)?|names?|named|hires?|hired|fires?|fired|dismiss(es|ed)?|search|successor)\b|\b(resign(s|ed|ing)?|steps? down|appoint(s|ed|ment)?|names?|named|hires?|hired|fires?|fired|dismiss(es|ed)?)\b.{0,50}\bcommissioner\b/i;
const MINOR_HONOR = /\b(player of the week|rookie of the week|coach of the week|of the month|player of the game|honou?r roll)\b/i;
const round = (x) => Math.round(x * 10) / 10;

/**
 * Materiality of one source item. `entities` are the linked WNBA entities; `source` is the registry entry (or an
 * object with `priority`/`kind`). `timestampQuality` is 'publisher' (exact source time), 'date_only' or 'capture'.
 */
export function materiality({ headline = '', summary = '', categories = [] } = {}, { type, entities = [], source = {}, timestampQuality = 'publisher' } = {}) {
  const text = `${headline} ${summary || ''}`;
  const def = EVENT_TYPES[type] || EVENT_TYPES.news;
  const reasons = [];
  const flags = [];
  const players = entities.filter((e) => e?.type === 'player');
  const teams = entities.filter((e) => e?.type === 'team');
  let score = def.base;
  reasons.push(`${type} base ${def.base}`);
  // Player-specific event types without a linked player are weak: nobody PropBetEdge can verify is named.
  // (An official team announcement of its own roster or injury move is authoritative even before the player is in
  // the roster dictionary — a newly signed player usually is not.)
  if (['injury', 'availability', 'signing', 'waiver', 'awards', 'record', 'lineup'].includes(type) && !players.length && !(source.priority === 1 && ['roster', 'injuries'].includes(def.lane))) {
    score -= 1.5;
    reasons.push('no linked player −1.5');
  }
  const officialCovers = OFFICIAL_AUTHORITY.has(type) || (type === 'playoff' && PLAYOFF_FACT.test(headline));
  const adj = source.priority === 1 && !officialCovers ? 0 : sourceAdjust(source.priority);
  if (source.priority === 1 && !officialCovers) reasons.push('official source, but not an announcement it is authoritative for: no boost');
  if (type === 'awards' && MINOR_HONOR.test(headline)) { score -= 2.5; flags.push('minor_honor'); reasons.push('weekly/monthly honour −2.5'); }
  if (type === 'league' && LEAGUE_OFFICE_FACT.test(headline)) { score += 1.5; flags.push('league_office_fact'); reasons.push('concrete league-office action +1.5'); }
  if (adj) { score += adj; reasons.push(`${source.priority === 1 ? 'official source' : `priority ${source.priority} source`} ${adj > 0 ? '+' : '−'}${Math.abs(adj)}`); }
  // The team an official team site belongs to is attribution, not a content link, so it earns no bonus.
  if (players.length || teams.some((t) => t.method !== 'source_team')) { score += 0.5; reasons.push('linked WNBA entity +0.5'); }
  if (COMMUNITY.test(headline)) { score -= 2; flags.push('community'); reasons.push('community/promotional feature −2'); }
  if (OPINION_STRONG.test(headline)) { score -= 3; flags.push('opinion'); reasons.push('opinion/analysis/listicle −3'); }
  if (SPECULATIVE.test(headline)) { score -= 1.5; flags.push('speculative'); reasons.push('speculative framing −1.5'); }
  if (EXPLAINER.test(headline)) { score -= 3; flags.push('explainer'); reasons.push('explainer/guide −3'); }
  if (/\?\s*$/.test(headline)) { score -= 1.5; flags.push('question'); reasons.push('question headline −1.5'); }
  if (RECYCLED.test(text)) { score -= 4; flags.push('recycled'); reasons.push('recycled/retrospective −4'); }
  if (MEDIA_NOISE.test(headline) || NOISE_CATEGORIES.test((categories || []).join(' | '))) { score -= 3; flags.push('promo_or_media'); reasons.push('promo, tickets, media or community −3'); }
  if (timestampQuality !== 'publisher') { flags.push(`timestamp_${timestampQuality}`); reasons.push(`timestamp ${timestampQuality}: may corroborate, cannot create a story`); }
  score = round(score);
  const material = score >= MATERIAL_THRESHOLD && timestampQuality === 'publisher';
  return { score, level: score >= 4.5 ? 'high' : score >= MATERIAL_THRESHOLD ? 'medium' : 'low', material, reasons, flags, threshold: MATERIAL_THRESHOLD };
}

/** Classify one item: event type, lane, legacy story type and materiality. */
export function classify(item, { entities = [], source = {}, timestampQuality = 'publisher' } = {}) {
  // Headline-first: a summary word never overrides what the headline says happened. The summary may only name a
  // player-level roster or injury event the headline is too terse to type ("Ezi Magbegor update"), and only when a
  // player is linked — a passing "draft" or "playoffs" in a feature's summary does not make it that event.
  const headType = eventType(item.headline || '', { categories: item.tags || [] });
  const fullType = eventType(`${item.headline || ''} ${item.summary || ''}`, { categories: item.tags || [] });
  const summaryUsable = headType === 'news' && ['injuries', 'roster'].includes(laneOf(fullType)) && entities.some((e) => e?.type === 'player');
  const event_type = summaryUsable ? fullType : headType;
  return {
    event_type,
    lane: laneOf(event_type),
    story_type: legacyType(event_type),
    materiality: materiality({ headline: item.headline, summary: item.summary, categories: item.tags }, { type: event_type, entities, source, timestampQuality })
  };
}

/** Event-level materiality: the strongest member, plus corroboration by independent publishers. */
export function eventMateriality(members) {
  const scored = (members || []).filter((m) => m?.materiality && Number.isFinite(m.materiality.score));
  if (!scored.length) return null;
  const best = [...scored].sort((a, b) => b.materiality.score - a.materiality.score)[0];
  const publishers = new Set(scored.map((m) => m.source_id));
  const bonus = Math.min(publishers.size - 1, 2) * 0.5;
  const score = round(best.materiality.score + bonus);
  // A story needs at least one member with an exact publisher timestamp.
  const timed = scored.some((m) => !(m.materiality.flags || []).some((f) => f.startsWith('timestamp_')));
  const vetoed = (best.materiality.flags || []).some((f) => f === 'recycled');
  return {
    score,
    material: timed && !vetoed && score >= MATERIAL_THRESHOLD,
    level: score >= 4.5 ? 'high' : score >= MATERIAL_THRESHOLD ? 'medium' : 'low',
    publishers: publishers.size,
    reasons: [...best.materiality.reasons, ...(bonus ? [`corroborated by ${publishers.size} publishers +${bonus}`] : []), ...(timed ? [] : ['no exact publisher timestamp']), ...(vetoed ? ['recycled content cannot be a new story'] : [])]
  };
}
