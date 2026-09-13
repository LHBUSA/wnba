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
  injury: 'WNBA Injury News & Availability Analysis',
  transaction: 'WNBA Transactions & Roster Moves',
  performance: 'WNBA Game Recaps & Performances',
  preview: 'WNBA Game Previews',
  trend: 'WNBA Betting Trends: Against the Spread & Totals',
  props: 'WNBA Prop Watch',
  market: 'WNBA Line Movement & Market Watch'
};
const DESK_DESCRIPTIONS = {
  brief: 'PropBetEdge News Briefs on material WNBA events, with the originating publisher attributed and PropBetEdge’s own structured records alongside.',
  injury: 'WNBA injury and availability stories from ESPN’s injury feed: the minutes at stake, who absorbs them and what the records do not show.',
  transaction: 'WNBA signings, waivers, hardship contracts and roster moves from the transactions log, with rotation context.',
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
        section: DESKS[deskOf(a.kind)] || 'Newsroom'
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
    case 'track-record':
      return m({ title: `PropBetEdge WNBA Track Record | ${BRAND}`, description: 'How PropBetEdge WNBA records and grades picks: recorded before the outcome, priced at the recorded line, graded deterministically, losses shown as losses.' });
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
    default:
      return notFound(base.path);
  }

  function notFound(p) {
    return { ...base, path: p, url: `${SITE}${p}`, title: `Page not found | ${BRAND} WNBA`, robots: NOINDEX_ROBOTS, status: 404 };
  }
}
