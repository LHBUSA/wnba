// One-time opening-day playoff feature for September 27, 2026.
//
// This feature is deliberately independent of the live article generators. It
// publishes only from the frozen, checked snapshot committed for this date, so
// a temporary upstream/API outage cannot turn a playoff feature into a moving
// target. The model calls are explicitly PRE-LOCK; official locked picks remain
// the authority for the track record.
//
// The source snapshot is committed at:
// data/commissions/playoff-opening-2026-09-27.json

export const PLAYOFF_OPENING_KEY = 'playoff-opening-2026-09-27';
export const PLAYOFF_OPENING_VERSION = 'pbe-wnba-playoff-opening/1.0.0';
export const PLAYOFF_OPENING_ID = '92f70927c6e1';
export const PLAYOFF_OPENING_LEGACY_SLUG = 'wnba-playoffs-today-model-picks-winba-leader-september-27-2026';
export const PLAYOFF_OPENING_SLUG = `${PLAYOFF_OPENING_LEGACY_SLUG}-${PLAYOFF_OPENING_ID.slice(0, 6)}`;

const SNAPSHOT_AT = '2026-09-27T14:10:36.238Z';
const MARKET_AT = '2026-09-27T12:00:58.883Z';
const OFFICIAL_PREVIEW = 'https://www.wnba.com/news/2026-playoffs-series-preview-first-round';
const OFFICIAL_FAQ = 'https://www.wnba.com/news/2026-wnba-postseason-faq';

const games = [
  {
    id: '401918014',
    tip: '2:00 p.m. ET',
    away: { id: '9', abbr: 'NY', name: 'New York Liberty', seed: 8, record: '26-18' },
    home: { id: '8', abbr: 'MIN', name: 'Minnesota Lynx', seed: 1, record: '33-11' },
    probability: 64.0, confidence: 'medium', market: 70.9, edge: -6.9, moneyline: -280,
    drivers: [
      '+4.5 schedule-adjusted net rating per 100 possessions (+11.6 model-impact points)',
      'home court (+6.9)',
      'recent form running 7.4 points per 100 below the Lynx season baseline (-2.0)',
      'two days of rest versus three for New York (-1.4)'
    ]
  },
  {
    id: '401918015',
    tip: '4:00 p.m. ET',
    away: { id: '5', abbr: 'IND', name: 'Indiana Fever', seed: 6, record: '28-16' },
    home: { id: '17', abbr: 'LVA', name: 'Las Vegas Aces', seed: 3, record: '31-13' },
    probability: 56.0, confidence: 'low', market: 60.2, edge: -4.2, moneyline: -165,
    drivers: [
      'home court (+7.3 model-impact points)',
      'a last-10 performance level 9.1 points per 100 above the Aces season baseline (+3.1)',
      'rotation availability trailing Indiana, 89% of recent minutes versus 97% (-3.1)',
      'Indiana holding a small +0.3 schedule-adjusted net-rating edge (-0.9)'
    ]
  },
  {
    id: '401918013',
    tip: '7:00 p.m. ET',
    away: { id: '16', abbr: 'WAS', name: 'Washington Mystics', seed: 5, record: '28-16' },
    home: { id: '20', abbr: 'ATL', name: 'Atlanta Dream', seed: 4, record: '30-14' },
    probability: 75.3, confidence: 'high', market: 69.8, edge: 5.5, moneyline: -270,
    drivers: [
      '+6.7 schedule-adjusted net rating per 100 possessions (+15.7 model-impact points)',
      'home court (+5.8)',
      'three days of rest versus two for Washington (+0.9)',
      '99% recent rotation availability versus 98% for Washington (+0.6)'
    ]
  },
  {
    id: '401918016',
    tip: '9:00 p.m. ET',
    away: { id: '3', abbr: 'DAL', name: 'Dallas Wings', seed: 7, record: '27-17' },
    home: { id: '129689', abbr: 'GSV', name: 'Golden State Valkyries', seed: 2, record: '32-12' },
    probability: 71.2, confidence: 'high', market: 70.7, edge: 0.4, moneyline: -285,
    drivers: [
      '+3.8 schedule-adjusted net rating per 100 possessions (+9.1 model-impact points)',
      'home court (+6.3)',
      '94% recent rotation availability versus 83% for Dallas (+4.0)',
      'two days of rest versus three for Dallas (-1.3)',
      'Dallas running 6.6 points per 100 above its season baseline over the last 10 (-1.0)'
    ]
  }
];

const entities = [
  ...games.flatMap((g) => [
    { type: 'game', id: g.id, name: `${g.away.abbr} @ ${g.home.abbr}` },
    { type: 'team', id: g.away.id, name: g.away.name },
    { type: 'team', id: g.home.id, name: g.home.name }
  ]),
  { type: 'player', id: '4433791', name: 'Olivia Miles', team_id: '8' },
  { type: 'metric', id: 'winba', name: 'WinBA Score' }
];

const body = [
  'The 2026 WNBA playoffs open Sunday with four first-round Game 1s and a useful distinction between who the PropBetEdge model thinks is most likely to win and where it sees the best price relative to the market. At 10:10 a.m. ET, the strongest model probability on the board belonged to Atlanta: 75.3% at home against Washington. Golden State followed at 71.2%, Minnesota at 64.0% and Las Vegas at 56.0%. Those are live pre-lock reads, not official graded picks. PropBetEdge locks its official call 15 minutes before tip, so this snapshot is a transparent look at what the model saw early in the day rather than a rewrite of the later record.',
  'The other headline is the latest frozen WinBA board. Olivia Miles enters the postseason as the No. 1 player on the published September WinBA Index at 87.0. The live ranking service is separate from this article; the number used here is the frozen September publication, so it will not change underneath the story. That makes the opening Minnesota-New York series especially interesting: the top seed begins the playoffs with the current WinBA leader at the center of its season-level player profile.',
  'The model board is not a list of four equally strong bets. Atlanta is the only game in this morning snapshot where the model both favors the home team and assigns it a meaningfully higher win probability than the de-vigged market consensus. The Dream sit at 75.3% in the model against 69.8% in the market, a +5.5 percentage-point PBE Edge. Golden State is a 71.2% model favorite, but the market is already at 70.7%, leaving only a +0.4-point gap. Minnesota and Las Vegas are model favorites too, yet both are priced more aggressively by the market than by PBE. That difference between a projected winner and a value edge is the most important way to read this slate.',
  'Atlanta is the cleanest model case. Its largest positive input is team quality: a +6.7 schedule-adjusted net-rating advantage, worth +15.7 model-impact points in the current explanation packet. Home court adds another +5.8, the rest differential adds +0.9, and recent rotation availability adds +0.6. The data-quality record attached to this run carries no flags and both teams clear the model eligibility contract with at least 44 current-season games in the feature set.',
  'The official matchup context makes that signal more interesting rather than simpler. Atlanta finished the regular season 30-14 and won its final five games, while Washington finished 28-16 and built one of the league’s best defenses, allowing 82.7 points per game. Atlanta scored 91.3 per game. Washington also won the two most recent regular-season meetings by five points apiece after Atlanta took the first meeting decisively. In other words, the algorithm is not merely following the season series. It is weighting the larger schedule-adjusted quality profile, home court, rest and current rotation continuity more heavily than those two recent head-to-head losses.',
  'That is why Atlanta is the featured algorithm read at this snapshot: 75.3% win probability, high confidence and a +5.5-point edge over the de-vigged market probability. A model advantage is not a guarantee, and Washington’s defense and recent head-to-head results are real counter-evidence. But among the four Game 1s, this is the only matchup where the model’s confidence and its disagreement with the market are both meaningfully positive at the same time.',
  'Golden State is the other high-confidence model favorite, but it is a different kind of read. The Valkyries are at 71.2% against a 70.7% de-vigged market consensus, almost exactly the same probability. Their support comes from a +3.8 schedule-adjusted net-rating edge, home court and a notable rotation-availability advantage: 94% of Golden State’s recent minutes came from players present in its latest game, compared with 83% for Dallas. The official season profile supports the matchup difficulty for Dallas as well: Golden State enters with the league’s top defense at 75.1 points allowed per game and the highest-scoring bench at 35.9 points per game. The model likes Golden State; the market already knows most of that.',
  'Minnesota is the biggest example of why the winner column and the value column must stay separate. PBE has the Lynx at 64.0% to beat New York, but the de-vigged market consensus is 70.9%. Minnesota owns a +4.5 schedule-adjusted net-rating advantage and home court, yet its recent form is running 7.4 points per 100 possessions below its season baseline and New York has the extra day of rest. The official series preview adds another reason for caution: New York won the regular-season series 2-1. PBE still makes Minnesota the more likely winner, but at this snapshot it is less bullish than the market by 6.9 percentage points.',
  'Las Vegas is similar. The Aces are a 56.0% model favorite over Indiana, but the de-vigged market sits at 60.2%. Home court and a strong recent-form adjustment support Las Vegas, while Indiana owns a small schedule-adjusted quality edge and a stronger recent rotation-availability mark. The official preview notes that Las Vegas closed the regular season with seven straight wins, while Indiana brings an historically productive offense into the series. The algorithm’s call is Las Vegas, but its current probability is lower than the price implied by the broader market.',
  'WinBA adds a player-level lens to the slate without pretending to be the game model. Olivia Miles is No. 1 on the frozen September board at 87.0. WinBA is an association-with-winning index built from four components: league-relative production, team win rate, the share of a player’s production recorded in wins and court share. It is not a causal wins-added statistic and it does not replace matchup probability. Its value here is different: Minnesota starts the postseason with the top-rated player on the latest published monthly board, while the game model independently evaluates the Lynx at 64.0% against New York.',
  'That separation matters. The PBE game model is answering “how likely is this team to win this game given the pregame team state?” WinBA is answering “how strong has this player’s production-plus-winning-context profile been in the completed-game archive?” The market comparison is answering a third question: “how does the model probability differ from the current de-vigged consensus?” Putting all three on one page gives a deeper picture without collapsing distinct measurements into a single magic number.',
  'Every probability in this article is tied to the 10:10 a.m. ET model snapshot, while the sportsbook comparison uses an 8:00 a.m. ET multi-book capture from 11 books. At that moment there were zero official locked predictions for the day, so none of these four pre-lock reads should be counted in the public PBE track record yet. The official ledger remains the source of truth after each call locks and each game is graded.',
  'For the opening slate, the hierarchy is clear. Atlanta is the strongest combination of model probability, confidence and positive market disagreement. Golden State has a high win probability but almost no model-market gap. Minnesota remains the model’s pick even though the market is materially more confident. Las Vegas is the narrowest favorite and carries low confidence in the current snapshot. The numbers can move before lock as inputs update; this page preserves exactly what the system saw at the stated time.'
];

const sections = [
  { title: 'The opening-day snapshot', first: 0, count: 3 },
  { title: 'Why Atlanta is the algorithm’s strongest read', first: 3, count: 3 },
  { title: 'Golden State: high confidence, almost fully priced', first: 6, count: 1 },
  { title: 'Minnesota and Las Vegas: picks without a positive price edge', first: 7, count: 2 },
  { title: 'Olivia Miles leads the latest published WinBA board', first: 9, count: 2 },
  { title: 'How to read the probabilities', first: 11, count: 2 }
];

const pickRows = games.map((g) => ({
  game_id: g.id,
  matchup: `${g.away.abbr} at ${g.home.abbr}`,
  tip_et: g.tip,
  pick_team_id: g.home.id,
  pick: g.home.name,
  model_probability: g.probability,
  confidence: g.confidence,
  market_devig_probability: g.market,
  pbe_edge_points: g.edge,
  consensus_moneyline: g.moneyline,
  drivers: g.drivers
}));

export function playoffOpeningArticle(at) {
  const publishedAt = at || new Date().toISOString();
  return {
    id: PLAYOFF_OPENING_ID,
    slug: PLAYOFF_OPENING_SLUG,
    aliases: [PLAYOFF_OPENING_LEGACY_SLUG],
    kind: 'commissioned_feature',
    desk: 'feature',
    category: 'Playoffs',
    series: 'PropBetEdge Playoff Intelligence',
    status: 'published',
    quality_state: 'current_quality',
    headline: 'WNBA Playoffs Today: Atlanta Is the Model’s Strongest Pick — and Olivia Miles Leads WinBA',
    deck: 'PropBetEdge’s opening-day model makes Atlanta its strongest current Game 1 read at 75.3%, while the frozen September WinBA board has Olivia Miles No. 1 at 87.0. Here is the full four-game probability board, market gap and model reasoning.',
    body,
    sections,
    lead_player_id: '4433791',
    lead_team_id: '20',
    primary_subject: '2026 WNBA Playoffs',
    identity_mode: 'league',
    subject_type: 'playoff_feature',
    entities,
    evidence: [
      {
        kind: 'internal_snapshot',
        source: 'PropBetEdge PBE WNBA model v1 — frozen pre-lock observation set',
        captured_at: SNAPSHOT_AT,
        detail: 'Four Game 1 observations; zero locked predictions at snapshot; data-quality flags empty; minimum current-season sample 44 games; eligibility contract pbe-wnba-eligibility/1.'
      },
      {
        kind: 'internal_snapshot',
        source: 'The Odds API — PropBetEdge stored multi-book market capture',
        captured_at: MARKET_AT,
        detail: '11-book moneyline consensus, de-vigged book-by-book then medianed.'
      },
      {
        kind: 'internal_snapshot',
        source: 'The WinBA Index — frozen September 2026 board',
        url: '/news/winba-index',
        detail: 'Olivia Miles No. 1, WinBA Score 87.0. Published frozen board; not recomputed for this feature.'
      },
      {
        kind: 'publisher_report',
        publisher: 'WNBA',
        source: 'First Round Series Preview: 2026 WNBA Playoffs',
        url: OFFICIAL_PREVIEW,
        captured_at: '2026-09-27T14:00:00.000Z'
      },
      {
        kind: 'publisher_report',
        publisher: 'WNBA',
        source: '2026 WNBA Postseason: FAQ and Things to Know',
        url: OFFICIAL_FAQ,
        captured_at: '2026-09-27T14:00:00.000Z'
      }
    ],
    facts: {
      snapshot_at: SNAPSHOT_AT,
      market_captured_at: MARKET_AT,
      prediction_state: 'pre_lock',
      locked_predictions_at_snapshot: 0,
      model_id: 'pbe-wnba-model-v1',
      eligibility_contract: 'pbe-wnba-eligibility/1',
      data_quality_flags: [],
      winba: {
        period: '2026-09',
        rank: 1,
        player_id: '4433791',
        player_name: 'Olivia Miles',
        team_id: '8',
        score: 87.0,
        frozen: true
      },
      picks: pickRows
    },
    commission: {
      key: PLAYOFF_OPENING_KEY,
      version: PLAYOFF_OPENING_VERSION,
      ordered: 'newsroom editor',
      note: 'Opening-day playoff intelligence feature combining the frozen pre-lock game-model snapshot, the current published WinBA leader and official playoff-series context.',
      presentation: 'natural_news',
      autopilot: false
    },
    winba_reference: {
      period: '2026-09',
      period_label: 'September 2026',
      rank: 1,
      score: 87.0,
      player_id: '4433791',
      player_name: 'Olivia Miles',
      snapshot_at: '2026-09-21T03:17:45.205Z',
      frozen: true
    },
    links: {
      playoffs: '/playoffs',
      picks: '/pbe-picks',
      model: '/pbe-picks/model',
      track_record: '/track-record',
      winba: '/winba-score',
      winba_index: '/news/winba-index'
    },
    seo: {
      title: 'WNBA Playoff Picks Today: Model Odds & WinBA Leader',
      description: 'PropBetEdge’s Sep. 27 WNBA playoff model picks Atlanta, Golden State, Minnesota and Las Vegas, with win probabilities, market gaps, model drivers and the latest WinBA leader.',
      keywords: [
        'WNBA playoff picks today',
        'WNBA predictions September 27 2026',
        'WNBA model picks',
        'Atlanta Dream vs Washington Mystics prediction',
        'Minnesota Lynx vs New York Liberty prediction',
        'Las Vegas Aces vs Indiana Fever prediction',
        'Golden State Valkyries vs Dallas Wings prediction',
        'Olivia Miles WinBA',
        'WNBA playoff odds'
      ]
    },
    method: [
      'This feature is generated from a frozen 10:10 a.m. ET PBE model snapshot. It does not recompute probabilities when the page loads.',
      'The four model reads were pre-lock at publication. Official PBE picks lock 15 minutes before tip and only locked calls enter the public track record.',
      'PBE Edge is model win probability minus the de-vigged sportsbook consensus probability. A team can be the model’s projected winner while still carrying a negative PBE Edge if the market is even more confident.',
      'The market snapshot was captured from 11 books at 8:00 a.m. ET and de-vigged book-by-book before taking the median probability.',
      'WinBA is reported from the frozen September 2026 published board. It is a player association-with-winning index, not the game prediction model and not a causal wins-added estimate.',
      'Official playoff records, series results and league context are attributed to the WNBA’s first-round series preview and postseason FAQ.'
    ],
    published_at: publishedAt,
    first_published_at: publishedAt,
    updated_at: publishedAt,
    revised_at: null,
    revisions: [],
    provenance: {
      generated_at: publishedAt,
      source_observed_at: SNAPSHOT_AT,
      generator: PLAYOFF_OPENING_VERSION,
      frozen_input: 'data/commissions/playoff-opening-2026-09-27.json'
    },
    generator: { type: 'commissioned_deterministic', version: PLAYOFF_OPENING_VERSION },
    words: body.join(' ').split(/\s+/).filter(Boolean).length
  };
}

export function playoffOpeningCard(article) {
  return {
    id: article.id,
    slug: article.slug,
    aliases: article.aliases || [],
    kind: article.kind,
    desk: article.desk,
    category: article.category,
    series: article.series,
    event_type: 'commissioned_feature',
    headline: article.headline,
    deck: article.deck,
    status: 'published',
    quality_state: 'current_quality',
    published_at: article.published_at,
    first_published_at: article.first_published_at,
    updated_at: article.updated_at,
    revised_at: null,
    revisions: [],
    lead_player_id: article.lead_player_id,
    lead_team_id: article.lead_team_id,
    entities: article.entities,
    has_market: true,
    sources: ['PropBetEdge PBE WNBA model v1', 'WNBA'],
    identity_mode: 'league',
    commission: article.commission,
    winba_reference: article.winba_reference
  };
}

/**
 * Idempotent manual publisher. This does not run on cron. It is invoked only by
 * POST /run?commission=playoff-opening-2026-09-27, keeping the editorial act
 * explicit while preserving deterministic inputs and output.
 */
export async function publishPlayoffOpening(env, { at, force = false } = {}) {
  const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  const existing = index.find((c) => c.id === PLAYOFF_OPENING_ID || c.slug === PLAYOFF_OPENING_SLUG || c.slug === PLAYOFF_OPENING_LEGACY_SLUG || (c.aliases || []).includes(PLAYOFF_OPENING_LEGACY_SLUG));
  if (existing && !force) return { key: PLAYOFF_OPENING_KEY, status: 'already_published', id: existing.id, slug: existing.slug };

  const prior = existing ? await env.NEWS_KV.get(`art:v1:item:${existing.id}`, 'json') : null;
  const article = playoffOpeningArticle(prior?.first_published_at || existing?.first_published_at || at);
  if (prior || existing) {
    article.first_published_at = prior?.first_published_at || existing?.first_published_at || article.first_published_at;
    article.published_at = article.first_published_at;
    article.updated_at = at;
    article.revised_at = at;
    article.revisions = [...(prior?.revisions || existing?.revisions || []), { at, kind: 'editorial_upgrade', generator: PLAYOFF_OPENING_VERSION }].slice(-20);
  }

  await env.NEWS_KV.put(`art:v1:item:${article.id}`, JSON.stringify(article), { expirationTtl: 120 * 86400 });
  const next = [playoffOpeningCard(article), ...index.filter((c) => c.id !== article.id && c.slug !== article.slug)];
  await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));

  return {
    key: PLAYOFF_OPENING_KEY,
    status: existing ? 'regenerated' : 'published',
    id: article.id,
    slug: article.slug,
    words: article.words,
    snapshot_at: SNAPSHOT_AT,
    prediction_state: 'pre_lock'
  };
}
