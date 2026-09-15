// Route metadata: one function decides the title, description, canonical, robots and share image for
// every route. The wnba-web Worker writes it into the first HTTP response; the browser router applies
// the same result on client-side navigation, so a crawler and a reader see the same page identity.
// Titles describe what is actually on the page; descriptions only state numbers present in the data.

import { SITE, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DESKS, abs, canonicalPath } from './site.js';

const BRAND = 'PropBetEdge';
export const INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
export const NOINDEX_ROBOTS = 'noindex, follow';

const TZ = 'America/New_York';
const dayET = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }) : '');
const one = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(1));
/**
 * The player's most recent regular season from the ESPN game log, labelled with its year. wnba-api's
 * recent.season carries no year, so it is never used for public copy.
 */
export function regularSeasonLine(d) {
  const s = (d?.gamelog?.seasons || []).filter((x) => /^\d{4} Regular Season$/.test(x.name || '')).sort((a, b) => b.name.localeCompare(a.name))[0];
  const games = (s?.games || []).filter((g) => g.min);
  if (!games.length) return null;
  const avg = (k) => games.reduce((t, g) => t + (Number(g[k]) || 0), 0) / games.length;
  return { year: Number(s.name.slice(0, 4)), games: games.length, pts: avg('pts'), reb: avg('reb'), ast: avg('ast') };
}
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

const DESK_TITLES = {
  brief: 'WNBA News Briefs',
  international: 'International Women’s Basketball News: World Cup, Olympics & FIBA',
  injury: 'WNBA Injury News & Availability Analysis',
  transaction: 'WNBA Transactions & Roster Moves',
  league: 'WNBA League News: Awards, Coaching, Front Offices, Playoffs & CBA',
  performance: 'WNBA Game Recaps & Performances',
  preview: 'WNBA Game Previews',
  trend: 'WNBA Betting Trends: Against the Spread & Totals',
  props: 'WNBA Prop Watch',
  market: 'WNBA Line Movement & Market Watch'
};
const DESK_DESCRIPTIONS = {
  brief: 'PropBetEdge News Briefs on material WNBA events, with the originating publisher attributed and PropBetEdge’s own structured records alongside.',
  international: 'PropBetEdge international desk: medal-game results and national-team stories built from structured box scores, with every WNBA player linked to her WNBA profile.',
  injury: 'WNBA injury and availability stories from ESPN’s injury feed: the minutes at stake, who absorbs them and what the records do not show.',
  transaction: 'WNBA signings, waivers, hardship contracts and roster moves from the transactions log and official team announcements, with rotation context.',
  league: 'WNBA league news from official league and team announcements and national reporting: awards, coaching and front-office changes, the playoff picture, expansion and labor, each checked for materiality and attributed.',
  performance: 'WNBA game recaps and standout performances built from box scores and compared with each player’s season.',
  preview: 'WNBA game previews: form, rest, observed rotations, availability and the stored sportsbook market for the next slate.',
  trend: 'WNBA against-the-spread and totals trends measured against a named sportsbook’s lines, with the sample shown.',
  props: 'WNBA player-prop stories built only from stored player-prop snapshots.',
  market: 'WNBA line-movement stories from PropBetEdge’s stored multi-book market captures.'
};

/** A share-image object for a path on this domain. */
export const shareImage = (path, alt, { width = 1200, height = 630 } = {}) => ({ url: abs(path), width, height, alt });

export function articleShareImage(a) {
  if (!a?.slug) return DEFAULT_IMAGE;
  const v = Date.parse(a.revised_at || a.first_published_at || a.published_at || '') || 0;
  return shareImage(`/og/news/${a.slug}.png?v=${v.toString(36)}`, `${a.headline} — PropBetEdge WNBA ${DESKS[deskOf(a.kind)] || 'Newsroom'}`);
}

export const deskOf = (kind) => (kind === 'result' ? 'performance' : kind);

/**
 * @param {string} route  router id ('news', 'article', 'player', …)
 * @param {object} o      { path, params, data, empty }
 */
export function routeMeta(route, { path = '/', params = {}, data = null, empty = false } = {}) {
  const base = { path: canonicalPath(path), description: DEFAULT_DESCRIPTION, image: DEFAULT_IMAGE, type: 'website', robots: INDEX_ROBOTS };
  const m = (x) => ({ ...base, ...x, url: `${SITE}${(x.path ?? base.path) === '/' ? '/' : x.path ?? base.path}` });
  switch (route) {
    case 'today':
      return m({ title: 'PropBetEdge WNBA — WNBA News, Injuries, Odds & Live Game Intelligence', description: 'Independent WNBA intelligence: today’s slate with stored sportsbook lines, WNBACast live games, sourced injuries, standings and an original PropBetEdge WNBA newsroom.' });
    case 'news':
      return m({ title: `WNBA News Today, Injuries, Transactions & Analysis | ${BRAND}`, description: 'The PropBetEdge WNBA newsroom: original, source-grounded WNBA news briefs, injury and roster-move stories, game previews, recaps and market analysis, updated every 10 minutes.' });
    case 'news-team': {
      const t = data?.team;
      if (!t) return m({ title: `WNBA Team News | ${BRAND}`, robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS });
      return m({ title: `${t.name} News: Injuries, Roster Moves & Official Announcements | ${BRAND}`, description: clip(`${t.name} news from the PropBetEdge WNBA newsroom: injury and roster-move stories, the team’s official announcements and beat coverage, attributed and checked against PropBetEdge’s WNBA records.`, 300), robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS });
    }
    case 'news-cat': {
      const k = params.kind;
      if (!DESK_TITLES[k]) return notFound(base.path);
      return m({ title: `${DESK_TITLES[k]} | ${BRAND}`, description: DESK_DESCRIPTIONS[k], robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS });
    }
    case 'article': {
      const a = data;
      if (!a) return m({ title: `WNBA News | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const modified = a.revised_at && Date.parse(a.revised_at) > Date.parse(a.first_published_at || 0) ? a.revised_at : null;
      return m({
        path: `/news/${a.slug}`,
        title: `${a.headline} | ${BRAND} WNBA`,
        description: clip(a.deck, 300),
        image: articleShareImage(a),
        type: 'article',
        published: a.first_published_at || a.published_at,
        modified,
        section: DESKS[deskOf(a.kind)] || 'Newsroom',
        // A story moved to external coverage keeps its URL and record but is no longer a newsroom page for search.
        ...(a.external_coverage || a.quality_state === 'retired_from_index' ? { robots: NOINDEX_ROBOTS } : {})
      });
    }
    case 'player': {
      const p = data?.player;
      if (!p) return m({ title: `WNBA Player | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const s = regularSeasonLine(data);
      const stats = s ? ` ${s.year} regular season: ${one(s.pts)} points, ${one(s.reb)} rebounds and ${one(s.ast)} assists per game in ${s.games} games.` : '';
      const img = data.photo ? shareImage(`/og/players/${p.athlete_id}.png`, `${p.name}${p.team ? `, ${p.team.name}` : ''} — PropBetEdge WNBA player card`) : DEFAULT_IMAGE;
      return m({
        title: `${p.name} WNBA Stats, Game Log, Injuries & News | ${BRAND}`,
        description: clip(`${p.name}${p.team ? ` (${p.team.name}${p.position_name ? `, ${p.position_name}` : ''})` : ''}: season and recent stats, full game log, injury status and PropBetEdge WNBA news.${stats}`, 300),
        image: img,
        type: 'profile'
      });
    }
    case 'team': {
      const t = data?.team;
      if (!t) return m({ title: `WNBA Team | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const st = data.standing;
      const rec = st ? ` ${st.wins}-${st.losses}${st.seed ? `, No. ${st.seed} seed in the ${st.conference_name || 'conference'}` : ''}.` : '';
      return m({
        title: `${t.name} Roster, Schedule, Stats, Injuries & News | ${BRAND}`,
        description: clip(`${t.name}: current roster, schedule and results, observed rotation, season profile, injuries and PropBetEdge newsroom coverage.${rec}`, 300),
        image: shareImage(`/og/teams/${t.team_id}.png`, `${t.name} — PropBetEdge WNBA team card`)
      });
    }
    case 'matchups': {
      if (!params.gameId) return m({ title: `WNBA Matchups: Upcoming Games, Form & Availability | ${BRAND}`, description: 'Every upcoming WNBA game with a research card: team form, rest, observed rotations, injuries and the stored sportsbook market.' });
      const g = data?.game;
      if (!g) return m({ title: `WNBA Matchup | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const when = dayET(g.start_utc);
      return m({
        title: `${g.away?.name} vs ${g.home?.name} WNBA Matchup, Injuries & Analysis | ${BRAND}`,
        description: clip(`${g.away?.name} at ${g.home?.name}${when ? `, ${when}` : ''}${g.venue?.name ? ` at ${g.venue.name}` : ''}: team form, rest, observed rotations, injury report, stored sportsbook lines and PropBetEdge analysis.`, 300),
        image: shareImage(`/og/matchups/${g.game_id}.png`, `${g.away?.name} at ${g.home?.name}${when ? `, ${when}` : ''} — PropBetEdge WNBA matchup card`)
      });
    }
    case 'cast': {
      const g = data?.game;
      if (!params.gameId) return m({ title: `WNBACast: Live WNBA Scores & Play-by-Play | ${BRAND}`, description: 'WNBACast follows every WNBA game live: scoreboard, play-by-play, published shot locations and replay of completed games from the persisted event stream.' });
      if (!g) return m({ title: `WNBACast | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const final = g.status?.state === 'post';
      return m({
        title: `${g.away?.name} vs ${g.home?.name} ${final ? 'Replay & Play-by-Play' : 'Live Score & Play-by-Play'}: WNBACast | ${BRAND}`,
        description: clip(`${g.away?.name} at ${g.home?.name}, ${dayET(g.start_utc)}: ${final ? 'final score, full play-by-play replay' : 'live scoreboard and play-by-play'} in WNBACast.`, 300),
        image: shareImage(`/og/matchups/${g.game_id}.png`, `${g.away?.name} at ${g.home?.name} — WNBACast`)
      });
    }
    case 'injuries':
      return m({ title: `WNBA Injuries Today & Player Availability | ${BRAND}`, description: 'Every WNBA player on the injury feed with status, reported detail, source update time and capture time, grouped by team. No invented return dates.' });
    case 'props':
      return m({ title: `WNBA Player Props & Best Sportsbook Lines | ${BRAND}`, description: 'The WNBA best-line board: the best sportsbook price and the no-vig market consensus for every game and captured player prop, with book and capture time.' });
    case 'standings':
      return m({ title: `WNBA Standings & Playoff Race | ${BRAND}`, description: 'Current WNBA standings by conference: seeds, games back, last 10, streaks, home and road records, point differential and clinch marks.' });
    case 'stats':
      return m({ title: `WNBA Stats Leaders & Team Profiles | ${BRAND}`, description: 'WNBA season stat leaders and team profiles, including estimated pace, straight from current-season source data with the sample shown.' });
    case 'teams':
      return m({ title: `WNBA Teams: Records, Rosters & Schedules | ${BRAND}`, description: 'All WNBA teams with current record and seed, linking to each team’s roster, schedule, observed rotation, injuries and news.' });
    case 'players':
      return m({ title: `WNBA Players: Rosters, Stats & Profiles | ${BRAND}`, description: 'Every current WNBA roster player with team and position, linking to season stats, game logs, injury status and news. Photos only where license and identity are verified.' });
    case 'pbe-picks':
      return m({ title: `PBE Picks: WNBA Model Win Probabilities & PBE Edge | ${BRAND}`, description: 'PBE WNBA model calls: an independent win probability for every covered game, the de-vigged sportsbook consensus beside it, PBE Edge, confidence and the model reasoning. Locked 15 minutes before tip.' });
    case 'pbe-model':
      return m({ title: `How the PBE WNBA Model Works | ${BRAND}`, description: 'How PBE WNBA model v1 turns pregame team data into a win probability: features, walk-forward validation, calibration, the market benchmark, lock policy and known limits.' });
    case 'track-record':
      return m({ title: `PBE WNBA Live Track Record | ${BRAND}`, description: 'Every official PBE WNBA locked call, graded from the final score. Wins and losses stay on the board; backtests are never counted.' });
    case 'pro':
      return m({ title: `PropBetEdge WNBA Pro | ${BRAND}`, description: 'PropBetEdge WNBA Pro membership: the full WNBA research desk. $9.99 a month or $3.99 a week, cancel anytime.' });
    case 'sources':
      return m({ title: `WNBA Data Sources & Live Source Status | ${BRAND}`, description: 'The sources behind PropBetEdge WNBA — ESPN public data, The Odds API, the source wire and Wikimedia Commons — with live source status and freshness.' });
    case 'about':
      return m({ title: `About the PropBetEdge WNBA Newsroom | ${BRAND}`, description: 'Who publishes PropBetEdge WNBA, how the automated newsroom works, and how it keeps publisher reporting, structured records and market data separate.' });
    case 'editorial-policy':
      return m({ title: `Editorial Policy | ${BRAND} WNBA`, description: 'The PropBetEdge WNBA editorial policy: deterministic generation from cited records, the publication gate, source attribution, headlines, images and what is never published.' });
    case 'corrections':
      return m({ title: `Corrections & Revisions Policy | ${BRAND} WNBA`, description: 'How PropBetEdge WNBA corrects and revises stories: original publication time is immutable, revisions carry an Updated time, and a new material event is a new story.' });
    case 'methodology':
      return m({ title: `Methodology: How PropBetEdge WNBA Builds Its Data | ${BRAND}`, description: 'How PropBetEdge WNBA computes rotations, form, rest, pace, market snapshots and no-vig consensus, and how the newsroom decides what is a new story.' });
    case 'story':
      return m({ title: `PropBetEdge WNBA Desk Note | ${BRAND}`, robots: NOINDEX_ROBOTS });
    case 'international':
      return m({ title: `International Women’s Basketball: World Cup, Olympics & FIBA | ${BRAND}`, description: 'National-team women’s basketball — FIBA World Cup, Olympics, qualifiers and continental championships — with live scores, box scores, standings and links to the WNBA players involved.' });
    case 'intl-competition': {
      const c = data?.competition;
      if (!c) return m({ title: `International Competition | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const sec = params.section || '';
      const SUFFIX = { '': 'Live Scores, Schedule & Stats', games: 'Schedule & Results', bracket: 'Bracket & Knockout Results', standings: 'Group Standings', leaders: 'Stat Leaders', teams: 'Teams & Records', players: 'Player Stats' };
      const n = data.counts;
      const when = c.start_date ? `${new Date(`${c.start_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}–${new Date(`${c.end_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : String(c.season);
      return m({
        path: `/international/${c.slug}${sec ? `/${sec}` : ''}`,
        // Registry-only competitions have no data yet: the title must not promise scores or stats.
        title: c.coverage === 'full' ? `${c.name} ${SUFFIX[sec] || SUFFIX['']} | ${BRAND}` : `${c.name} | ${BRAND}`,
        description: clip(`${c.name}${c.host ? `, ${c.host.city}` : ''}, ${when}: ${n ? `${n.games} games, ${n.teams} teams, ${n.wnba_mapped} WNBA players. ` : ''}Live scores, box scores, bracket, group standings, tournament leaders and the WNBA players at the tournament.`, 300),
        robots: c.coverage === 'full' ? INDEX_ROBOTS : NOINDEX_ROBOTS
      });
    }
    case 'intl-game': {
      const g = data?.game;
      if (!g) return m({ title: `International Game | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const c = data.competition;
      const state = g.status === 'final' ? 'Final Score & Box Score' : g.status === 'live' ? 'Live Score & Box Score' : 'Preview, Rosters & Tip Time';
      const score = g.status === 'final' || g.status === 'live' ? ` ${g.away_team.name} ${g.away_score}, ${g.home_team.name} ${g.home_score}${g.status === 'final' ? ' (final)' : ' (live)'}.` : '';
      return m({
        path: `/international/games/${g.provider_ids?.espn || String(g.game_id).replace(/^g-/, '')}`,
        title: `${g.away_team.name} vs ${g.home_team.name} — ${c.short_name} ${g.round_name}: ${state} | ${BRAND}`,
        description: clip(`${g.away_team.name} vs ${g.home_team.name}, ${g.round_name} of the ${c.name}${g.venue?.name ? ` at ${g.venue.name}` : ''}.${score} Quarter scores, full box score, play-by-play and WNBA players in the game.`, 300),
        image: shareImage(`/og/intl-games/${g.provider_ids?.espn || String(g.game_id).replace(/^g-/, '')}.png`, `${g.away_team.name} vs ${g.home_team.name}, ${g.round_name} — PropBetEdge international game card`)
      });
    }
    case 'intl-team': {
      const t = data?.team;
      if (!t) return m({ title: `National Team | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const c0 = data.competitions?.[0];
      const noun = t.country_code === 'USA' ? 'USA Women’s Basketball' : `${t.name} Women’s Basketball National Team`;
      return m({
        path: `/international/teams/${t.slug}`,
        title: `${noun}: Roster, Schedule & Results | ${BRAND}`,
        description: clip(`${noun}${c0 ? ` at the ${c0.competition.name}: ${c0.record.wins}-${c0.record.losses}, ${one(c0.averages.pts)} points per game` : ''}. Roster and player stats, results, box scores${data.wnba_players?.length ? ` and ${data.wnba_players.length} WNBA players` : ''}.`, 300)
      });
    }
    case 'intl-player': {
      const p = data?.player;
      if (!p) return m({ title: `International Player | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const c0 = data.competitions?.[0];
      const games = (data.competitions || []).reduce((s, c) => s + (c.games || 0), 0);
      const pid = String(p.player_id).replace(/^p-/, '');
      const slug = String(p.name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return m({
        path: `/international/players/${pid}-${slug}`,
        title: p.wnba ? `${p.name} International Basketball Stats & WNBA Profile | ${BRAND}` : `${p.name} (${p.team.name}) International Stats & Game Log | ${BRAND}`,
        description: clip(`${p.name}, ${p.team.name}${c0 ? ` at the ${c0.competition.name}: ${one(c0.averages.pts)} points, ${one(c0.averages.reb)} rebounds and ${one(c0.averages.ast)} assists per game in ${c0.games} games` : ''}.${p.wnba ? ` WNBA: ${p.wnba.wnba_team?.name || 'profile'}.` : ''} Game log, highs and box scores.`, 300),
        type: 'profile',
        // A single appearance with no WNBA connection is too thin to index.
        robots: games >= 2 || p.wnba ? INDEX_ROBOTS : NOINDEX_ROBOTS
      });
    }
    case 'world-cup':
      return m({ title: `FIBA Women’s Basketball World Cup | ${BRAND}`, robots: NOINDEX_ROBOTS });
    default:
      return notFound(base.path);
  }

  function notFound(p) {
    return { ...base, path: p, url: `${SITE}${p}`, title: `Page not found | ${BRAND} WNBA`, robots: NOINDEX_ROBOTS, status: 404 };
  }
}
