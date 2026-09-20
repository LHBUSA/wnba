// Route metadata: one function decides the title, description, canonical, robots and share image for
// every route. The wnba-web Worker writes it into the first HTTP response; the browser router applies
// the same result on client-side navigation, so a crawler and a reader see the same page identity.
// Titles describe what is actually on the page; descriptions only state numbers present in the data.

import { SITE, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DESKS, abs, canonicalPath } from './site.js';
import { careerMetaLine } from '../lib/player-career.js';

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
export const pageShareImage = (key, alt) => shareImage(`/og/pages/${key}.png`, alt);

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
      return m({ title: 'PropBetEdge WNBA — WNBA News, Injuries, Odds & Live Game Intelligence', description: 'Independent WNBA intelligence: today’s slate with stored sportsbook lines, WNBACast live games, sourced injuries, standings and an original PropBetEdge WNBA newsroom.', image: pageShareImage('home', 'PropBetEdge WNBA — live WNBA intelligence') });
    case 'news':
      return m({ title: `WNBA News Today, Injuries, Transactions & Analysis | ${BRAND}`, description: 'The PropBetEdge WNBA newsroom: original, source-grounded WNBA news briefs, injury and roster-move stories, game previews, recaps and market analysis, updated every 10 minutes.', image: pageShareImage('news', 'PropBetEdge WNBA Newsroom') });
    case 'news-archive':
      return m({
        title: `WNBA News Archive: Past Stories & Published Record | ${BRAND}`,
        description: 'Browse the canonical PropBetEdge WNBA newsroom archive: past injury reports, roster moves, game previews, results, player performances, team trends and league coverage, newest first.',
        image: pageShareImage('news', 'PropBetEdge WNBA News Archive'),
        robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS
      });
    case 'news-team': {
      const t = data?.team;
      if (!t) return m({ title: `WNBA Team News | ${BRAND}`, robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS });
      return m({ title: `${t.name} News: Injuries, Roster Moves & Official Announcements | ${BRAND}`, description: clip(`${t.name} news from the PropBetEdge WNBA newsroom: injury and roster-move stories, the team’s official announcements and beat coverage, attributed and checked against PropBetEdge’s WNBA records.`, 300), image: shareImage(`/og/teams/${t.team_id}.png`, `${t.name} — PropBetEdge WNBA team card`), robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS });
    }
    case 'news-cat': {
      const k = params.kind;
      if (!DESK_TITLES[k]) return notFound(base.path);
      return m({ title: `${DESK_TITLES[k]} | ${BRAND}`, description: DESK_DESCRIPTIONS[k], image: pageShareImage(`news-${k}`, `${DESK_TITLES[k]} — PropBetEdge WNBA`), robots: empty ? NOINDEX_ROBOTS : INDEX_ROBOTS });
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
      const career = careerMetaLine(data?.career);
      const winba = data?.winba?.score !== null && data?.winba?.score !== undefined ? ` WinBA: ${one(data.winba.score)}.` : '';
      const img = shareImage(`/og/players/${p.athlete_id}.png`, `${p.name}${p.team ? `, ${p.team.name}` : ''} — PropBetEdge WNBA player card`);
      return m({
        title: `${p.name} WNBA Career Stats, Game Log, WinBA & News | ${BRAND}`,
        description: clip(`${p.name}${p.team ? ` (${p.team.name}${p.position_name ? `, ${p.position_name}` : ''})` : ''}: career totals, season and recent stats, full game log, WinBA, injury status and PropBetEdge WNBA news.${career}${stats}${winba}`, 300),
        image: img,
        type: 'profile',
        profile: { firstName: p.first_name || null, lastName: p.last_name || null, username: String(p.athlete_id) }
      });
    }
    case 'team': {
      const t = data?.team;
      if (!t) return m({ title: `WNBA Team | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const st = data.standing;
      const rec = st ? ` ${st.wins}-${st.losses}${st.seed ? `, No. ${st.seed} seed in the ${st.conference_name || 'conference'}` : ''}.` : '';
      return m({
        title: `${t.name} Roster, Player Stats, Schedule, Injuries & News | ${BRAND}`,
        description: clip(`${t.name}: current roster, schedule and results, observed rotation, season profile, injuries and PropBetEdge newsroom coverage.${rec}`, 300),
        image: shareImage(`/og/teams/${t.team_id}.png`, `${t.name} — PropBetEdge WNBA team card`)
      });
    }
    case 'matchups': {
      if (!params.gameId) return m({ title: `WNBA Matchups: Upcoming Games, Form & Availability | ${BRAND}`, description: 'Every upcoming WNBA game with a research card: team form, rest, observed rotations, injuries and the stored sportsbook market.', image: pageShareImage('matchups', 'WNBA matchups — PropBetEdge') });
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
      if (!params.gameId) return m({ title: `WNBACast: Live WNBA Scores & Play-by-Play | ${BRAND}`, description: 'WNBACast follows every WNBA game live: scoreboard, play-by-play, published shot locations and replay of completed games from the persisted event stream.', image: pageShareImage('cast', 'WNBACast — live WNBA scores and play-by-play') });
      if (!g) return m({ title: `WNBACast | ${BRAND}`, robots: NOINDEX_ROBOTS });
      const final = g.status?.state === 'post';
      return m({
        title: `${g.away?.name} vs ${g.home?.name} ${final ? 'Replay & Play-by-Play' : 'Live Score & Play-by-Play'}: WNBACast | ${BRAND}`,
        description: clip(`${g.away?.name} at ${g.home?.name}, ${dayET(g.start_utc)}: ${final ? 'final score, full play-by-play replay' : 'live scoreboard and play-by-play'} in WNBACast.`, 300),
        image: shareImage(`/og/matchups/${g.game_id}.png`, `${g.away?.name} at ${g.home?.name} — WNBACast`)
      });
    }
    case 'injuries':
      return m({ title: `WNBA Injuries Today & Player Availability | ${BRAND}`, description: 'Every WNBA player on the injury feed with status, reported detail, source update time and capture time, grouped by team. No invented return dates.', image: pageShareImage('injuries', 'WNBA Injuries Today & Player Availability — PropBetEdge WNBA') });
    case 'props':
      return m({ title: `WNBA Player Props & Best Sportsbook Lines | ${BRAND}`, description: 'The WNBA best-line board: the best sportsbook price and the no-vig market consensus for every game and captured player prop, with book and capture time.', image: pageShareImage('props', 'WNBA Player Props & Best Sportsbook Lines — PropBetEdge WNBA') });
    case 'standings':
      return m({ title: `WNBA Standings & Playoff Race | ${BRAND}`, description: 'Current WNBA standings by conference: seeds, games back, last 10, streaks, home and road records, point differential and clinch marks.', image: pageShareImage('standings', 'WNBA Standings & Playoff Race — PropBetEdge WNBA') });
    case 'stats':
      return m({ title: `WNBA Stats Leaders & Team Profiles | ${BRAND}`, description: 'WNBA season stat leaders and team profiles, including estimated pace, straight from current-season source data with the sample shown.', image: pageShareImage('stats', 'WNBA Stats Leaders & Team Profiles — PropBetEdge WNBA') });
    case 'teams':
      return m({ title: `WNBA Teams: Records, Rosters & Schedules | ${BRAND}`, description: 'All WNBA teams with current record and seed, linking to each team’s roster, schedule, observed rotation, injuries and news.', image: pageShareImage('teams', 'WNBA Teams: Records, Rosters & Schedules — PropBetEdge WNBA') });
    case 'players':
      return m({ title: `WNBA Players: Rosters, Stats & Profiles | ${BRAND}`, description: 'Every current WNBA roster player with team and position, linking to season stats, game logs, injury status and news. Photos only where license and identity are verified.', image: pageShareImage('players', 'WNBA Players: Rosters, Stats & Profiles — PropBetEdge WNBA') });
    case 'pbe-picks':
      return m({ title: `PBE Picks: WNBA Model Win Probabilities & PBE Edge | ${BRAND}`, description: 'PBE WNBA model calls: an independent win probability for every covered game, the de-vigged sportsbook consensus beside it, PBE Edge, confidence and the model reasoning. Locked 15 minutes before tip.', image: pageShareImage('pbe-picks', 'PBE Picks: WNBA Model Win Probabilities & PBE Edge — PropBetEdge WNBA') });
    case 'history':
      return m({ title: `WNBA History: Eras, Championships, Franchises & Records | ${BRAND}`, description: 'WNBA history from 1997 to today: eras, milestones, championships, franchise lineage and the PropBetEdge historical intelligence archive.', image: pageShareImage('history', 'WNBA History — eras, championships, franchises and records') });
    case 'player-load':
      return m({ title: `WNBA Player Load Intelligence: Workload, Rest & Rotation Pressure | ${BRAND}`, description: 'WNBA Pro Player Load Intelligence: a 0–100 workload and schedule-pressure index built from recent minutes, game density, turnaround, overtime and rotation context.', image: pageShareImage('player-load', 'WNBA Player Load Intelligence — PropBetEdge') });
    case 'daily-brief':
      return m({ title: `Free WNBA Daily Brief: Slate, PBE Coverage & Availability | ${BRAND}`, description: 'A free WNBA intelligence brief with the current slate, PBE coverage window, sourced availability movement and the public PBE track record.', image: pageShareImage('brief', 'Free WNBA Daily Brief — PropBetEdge') });
    case 'edge-timeline':
      return m({ title: `PBE Edge Timeline: How WNBA Model Calls Move | ${BRAND}`, description: 'WNBA Pro PBE Edge Timeline shows how model probability, market disagreement, confidence and calls changed from first read to lock.', image: pageShareImage('edge-timeline', 'PBE Edge Timeline — PropBetEdge WNBA Pro') });
    case 'rotation-impact':
      return m({ title: `WNBA Rotation Impact: Availability, Workload & Opportunity Pressure | ${BRAND}`, description: 'WNBA Pro Rotation Impact combines Player Load, sourced availability and recent baseline minutes into a team-by-team rotation pressure desk.', image: pageShareImage('rotation-impact', 'WNBA Rotation Impact — PropBetEdge WNBA Pro') });
    case 'scenario-lab':
      return m({ title: `PBE Scenario Lab: WNBA Game Paths & Counter-Drivers | ${BRAND}`, description: 'WNBA Pro Scenario Lab breaks each current PBE call into its base case, supporting drivers, counter-drivers and market disagreement without inventing simulated probabilities.', image: pageShareImage('scenario-lab', 'PBE Scenario Lab — PropBetEdge WNBA Pro') });
    case 'watchlist':
      return m({ title: `WNBA Pro Watchlist & Live Alerts | ${BRAND}`, description: 'Save WNBA teams and surface current PBE, Player Load and sourced availability signals in one WNBA Pro live alert board.', image: pageShareImage('watchlist', 'WNBA Pro Watchlist & Live Alerts — PropBetEdge') });
    case 'pbe-model':
      return m({ title: `How the PBE WNBA Model Works | ${BRAND}`, description: 'How PBE WNBA model v1 turns pregame team data into a win probability: features, walk-forward validation, calibration, the market benchmark, lock policy and known limits.', image: pageShareImage('pbe-model', 'How the PBE WNBA Model Works — PropBetEdge WNBA') });
    case 'track-record':
      return m({ title: `PBE WNBA Live Track Record | ${BRAND}`, description: 'Every official PBE WNBA locked call, graded from the final score. Wins and losses stay on the board; backtests are never counted.', image: pageShareImage('track-record', 'PBE WNBA Live Track Record — PropBetEdge WNBA') });
    case 'pro':
      return m({ title: `PropBetEdge WNBA Pro | ${BRAND}`, description: 'PropBetEdge WNBA Pro membership: the full WNBA research desk. $9.99 a month or $3.99 a week, cancel anytime.', image: pageShareImage('pro', 'PropBetEdge WNBA Pro — PropBetEdge WNBA') });
    case 'sources':
      return m({ title: `WNBA Data Sources & Live Source Status | ${BRAND}`, description: 'The sources behind PropBetEdge WNBA — PropSports.PropTechUSA.ai, the publisher source wire and licensed Wikimedia Commons imagery — with live source status and freshness.', image: pageShareImage('sources', 'WNBA Data Sources & Live Source Status — PropBetEdge WNBA') });
    case 'about':
      return m({ title: `About the PropBetEdge WNBA Newsroom | ${BRAND}`, description: 'Who publishes PropBetEdge WNBA, how the automated newsroom works, and how it keeps publisher reporting, structured records and market data separate.', image: pageShareImage('about', 'About the PropBetEdge WNBA Newsroom — PropBetEdge WNBA') });
    case 'editorial-policy':
      return m({ title: `Editorial Policy | ${BRAND} WNBA`, description: 'The PropBetEdge WNBA editorial policy: deterministic generation from cited records, the publication gate, source attribution, headlines, images and what is never published.', image: pageShareImage('editorial-policy', 'Editorial Policy — PropBetEdge WNBA') });
    case 'corrections':
      return m({ title: `Corrections & Revisions Policy | ${BRAND} WNBA`, description: 'How PropBetEdge WNBA corrects and revises stories: original publication time is immutable, revisions carry an Updated time, and a new material event is a new story.', image: pageShareImage('corrections', 'Corrections & Revisions Policy — PropBetEdge WNBA') });
    case 'methodology':
      return m({ title: `Methodology: How PropBetEdge WNBA Builds Its Data | ${BRAND}`, description: 'How PropBetEdge WNBA computes rotations, form, rest, pace, market snapshots and no-vig consensus, and how the newsroom decides what is a new story.', image: pageShareImage('methodology', 'Methodology: How PropBetEdge WNBA Builds Its Data — PropBetEdge WNBA') });
    case 'story':
      return m({ title: `PropBetEdge WNBA Desk Note | ${BRAND}`, robots: NOINDEX_ROBOTS });
    case 'international':
      return m({ title: `International Women’s Basketball: World Cup, Olympics & FIBA | ${BRAND}`, description: 'National-team women’s basketball — FIBA World Cup, Olympics, qualifiers and continental championships — with live scores, box scores, standings and links to the WNBA players involved.', image: pageShareImage('international', 'International Women’s Basketball: World Cup, Olympics & FIBA — PropBetEdge WNBA') });
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
        image: shareImage(`/og/intl-comps/${c.slug}--${sec || 'overview'}.png`, `${c.name}${sec ? ` — ${SUFFIX[sec] || sec}` : ''} — PropBetEdge`),
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
        description: clip(`${noun}${c0 ? ` at the ${c0.competition.name}: ${c0.record.wins}-${c0.record.losses}, ${one(c0.averages.pts)} points per game` : ''}. Roster and player stats, results, box scores${data.wnba_players?.length ? ` and ${data.wnba_players.length} WNBA players` : ''}.`, 300),
        image: shareImage(`/og/intl-teams/${t.slug}.png`, `${noun} — PropBetEdge international team card`)
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
        image: shareImage(`/og/intl-players/${pid}.png`, `${p.name}, ${p.team.name} — PropBetEdge international player card`),
        type: 'profile',
        profile: { firstName: p.name?.split(' ')?.[0] || null, lastName: p.name?.split(' ')?.slice(1).join(' ') || null, username: pid },
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
