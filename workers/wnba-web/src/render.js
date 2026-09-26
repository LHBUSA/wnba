// Route → server-visible page. Uses the SAME views as the SPA (src/views/*), the shared route table and the
// shared metadata/JSON-LD builders, so crawlers and readers receive the same editorial content.
// Pure with respect to the network: everything comes through the injected `api` adapter.

import { html, raw } from '../../../src/lib/dom.js';
import { resolveRoute } from '../../../src/lib/routes.js';
import { shellHtml } from '../../../src/ui/shell.js';
import { pageHead } from '../../../src/ui/components.js';
import { routeMeta, NOINDEX_ROBOTS } from '../../../src/seo/meta.js';
import { pageGraph } from '../../../src/seo/jsonld.js';
import { headTags } from '../../../src/seo/head.js';
import { DESKS } from '../../../src/seo/site.js';
import { articleView, loadArticle, loadArticleSeries } from '../../../src/views/article.js';
import { loadWinbaIndexArchive, winbaIndexArchiveView } from '../../../src/views/winba-index.js';
import { loadNews, newsView, loadArchive, archiveView } from '../../../src/views/news.js';
import { loadPlayer, playerView } from '../../../src/views/player.js';
import { loadTeam, teamView } from '../../../src/views/team.js';
import { loadMatchup, matchupView, loadMatchupsList, matchupsListView } from '../../../src/views/matchups.js';
import { loadInjuries, injuriesView, loadStandings, standingsView, loadTeams, teamsView, loadPlayers, playersView, loadStats, statsView } from '../../../src/views/league.js';
import { loadToday, todayView } from '../../../src/views/today.js';
import { loadWinbaScore, winbaScoreView } from '../../../src/views/winba-score.js';
import { loadPlayoffs, playoffsView } from '../../../src/views/playoffs.js';
import { TRUST_VIEWS, sourcesHead, sourcesRegistryView, newsHealthView } from '../../../src/views/trust.js';
import { fmtDateET, fmtTimeET } from '../../../src/lib/format.js';
import { loadIntlHome, intlHomeView, loadCompetition, competitionView, loadIntlGame, intlGameView, loadNationalTeam, nationalTeamView, loadIntlPlayer, intlPlayerView, playerHref } from '../../../src/views/international.js';

export const CURRENT_WORLD_CUP = 'world-cup-2026';

const intro = (eyebrow, title, sub, links = []) => html`${pageHead({ eyebrow, title, sub })}${links.length ? html`<p class="pill-row">${links.map(([href, label]) => html`<a class="pill" href="${href}">${label}</a>`)}</p>` : ''}`;
const notFoundBody = () => html`<div class="empty" style="margin-top:40px"><h3>That page isn’t on the court</h3><p>Try <a class="gold" href="/">Today</a>, <a class="gold" href="/cast">WNBACast</a> or <a class="gold" href="/news">News</a>.</p></div>`;

/** 404 when the API says the entity does not exist; 503 (retryable) for any other failure. */
const failStatus = (res) => (res?.status === 404 || res?.error === 'not_found' || res?.error?.code === 'not_found' ? 404 : 503);

/**
 * @returns {Promise<{ status:number, redirect?:string, meta:object, graph?:object, main:string, route:string }>}
 */
export async function renderRoute(pathname, api) {
  const { id, params, path } = resolveRoute(pathname);
  const out = (status, meta, main, graphData) => ({ status, route: id, meta, main: String(main ?? ''), graph: graphData === null ? null : pageGraph(id, meta, graphData || {}) });
  const nf = () => { const meta = routeMeta('not-found', { path }); return out(404, meta, notFoundBody(), null); };
  const unavailable = (what, res) => {
    const status = failStatus(res);
    if (status === 404) return nf();
    const meta = { ...routeMeta(id, { path, params }), robots: NOINDEX_ROBOTS };
    return out(503, meta, html`<div class="empty err"><h3>${what} is unavailable</h3><p>The source did not answer. Nothing is shown in its place — no stand-in numbers.</p></div>`, null);
  };

  switch (id) {
    case 'today': {
      const data = await loadToday(api);
      return out(200, routeMeta(id, { path }), todayView(data).body);
    }
    case 'news-archive': {
      const archive = await loadArchive(api);
      const v = archiveView(archive);
      const meta = routeMeta(id, { path, data: { items: v.items || [] }, empty: !v.items?.length });
      if (v.error) return out(503, { ...meta, robots: NOINDEX_ROBOTS }, v.body, null);
      return out(200, meta, v.body, { items: v.items || [] });
    }
    case 'winba-index': {
      const data = await loadWinbaIndexArchive(api);
      const v = winbaIndexArchiveView(data);
      const meta = routeMeta(id, { path, data: { items: v.items || [] }, empty: !v.items?.length });
      if (data.error) return out(503, { ...meta, robots: NOINDEX_ROBOTS }, v.body, null);
      return out(200, meta, v.body, { items: v.items || [] });
    }
    case 'news':
    case 'news-cat': {
      if (id === 'news-cat' && !DESKS[params.kind]) return nf();
      const data = await loadNews(api, params.kind || null);
      const v = newsView(data);
      const meta = routeMeta(id, { path, params, empty: v.empty });
      if (v.error) return out(503, { ...meta, robots: NOINDEX_ROBOTS }, v.body, null);
      return out(200, meta, v.body, { kind: params.kind, items: data.arts.data.items });
    }
    case 'news-team': {
      const data = await loadNews(api, null, params.teamId);
      if (data.teamsOk && !data.team) return nf();
      if (!data.team) return unavailable('This team’s news', { status: 503 });
      const v = newsView(data);
      const meta = routeMeta(id, { path, params, data: { team: data.team }, empty: v.empty });
      if (v.error) return out(503, { ...meta, robots: NOINDEX_ROBOTS }, v.body, null);
      return out(200, meta, v.body, { team: data.team, items: data.arts.data.items });
    }
    case 'article': {
      const res = await loadArticle(api, params.slug);
      if (!res?.ok) return res?.status === 404 || res?.error === 'not_found' ? nf() : unavailable('This article', res);
      const a = res.data.article;
      // A collapsed duplicate URL (or a legacy slug) resolves to the canonical story: redirect there permanently.
      if (a.slug && a.slug !== params.slug) return { status: 301, redirect: `/news/${a.slug}`, route: id };
      const meta = routeMeta(id, { path, data: a });
      const series = await loadArticleSeries(api, a);
      return out(200, meta, articleView({ article: a, related: res.data.related || [], series }), { article: a });
    }
    case 'player': {
      const data = await loadPlayer(api, params.playerId);
      if (!data.res?.ok) return unavailable('This player', data.res);
      return out(200, routeMeta(id, { path, params, data: data.res.data }), playerView(data), data.res.data);
    }
    case 'player-dna': {
      // Client-rendered from /v1/dna/* (prepared KV documents); the server sends a noindex placeholder the SPA replaces.
      // dna-page--loading reserves height so the footer stays below the fold until the profile paints (no CLS).
      return out(200, routeMeta(id, { path, params }), html`<div class="dna-page dna-page--loading"><div class="skel" style="height:320px"></div></div>`, null);
    }
    case 'team': {
      const data = await loadTeam(api, params.teamId);
      if (!data.res?.ok) {
        // wnba-api answers an unknown team with a 5xx; the team index decides whether the id exists.
        const teams = await api.teams();
        if (teams?.ok && !teams.data.teams.some((t) => String(t.team_id) === String(params.teamId))) return nf();
        return unavailable('This team', data.res);
      }
      return out(200, routeMeta(id, { path, params, data: data.res.data }), teamView(data), data.res.data);
    }
    case 'matchups': {
      if (!params.gameId) {
        const data = await loadMatchupsList(api);
        return out(data.res?.ok ? 200 : 503, routeMeta(id, { path, params }), matchupsListView(data));
      }
      const data = await loadMatchup(api, params.gameId);
      if (!data.res?.ok) {
        const game = await api.game(params.gameId);
        return game?.ok ? unavailable('This matchup', data.res) : nf();
      }
      return out(200, routeMeta(id, { path, params, data: data.res.data }), matchupView(data), { game: data.res.data.game });
    }
    case 'cast': {
      if (!params.gameId) return out(200, routeMeta(id, { path, params }), intro('Live games', 'WNBACast', 'Every WNBA game live: scoreboard, play-by-play, published shot locations, and replay of completed games from the persisted event stream.', [['/matchups', 'Matchups'], ['/news', 'Newsroom']]));
      const res = await api.game(params.gameId);
      if (!res?.ok) return nf();
      const g = res.data.game;
      const meta = routeMeta(id, { path, params, data: { game: g } });
      const state = g.status?.state === 'post' ? `Final: ${g.away?.abbr} ${g.away?.score}, ${g.home?.abbr} ${g.home?.score}` : g.status?.state === 'in' ? 'Live now' : `${fmtDateET(g.start_utc, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTimeET(g.start_utc)}`;
      return out(200, meta, intro('WNBACast', `${g.away?.name} at ${g.home?.name}`, `${state}${g.venue?.name ? ` · ${g.venue.name}` : ''}. Scoreboard and play-by-play load live in WNBACast.`, [[`/matchups/${g.game_id}`, 'Matchup research'], [`/teams/${g.away?.team_id}`, g.away?.name], [`/teams/${g.home?.team_id}`, g.home?.name]]), { game: g });
    }
    case 'injuries': {
      const data = await loadInjuries(api);
      return out(data.res?.ok ? 200 : 503, routeMeta(id, { path }), injuriesView(data));
    }
    case 'playoffs': {
      const data = await loadPlayoffs(api);
      if (!data.res?.ok) return unavailable('The playoff bracket', data.res);
      return out(200, routeMeta(id, { path }), playoffsView(data));
    }
    case 'standings': {
      const data = await loadStandings(api);
      return out(data.res?.ok ? 200 : 503, routeMeta(id, { path }), standingsView(data));
    }
    case 'teams': {
      const data = await loadTeams(api);
      return out(data.teams?.ok ? 200 : 503, routeMeta(id, { path }), teamsView(data));
    }
    case 'players': {
      const data = await loadPlayers(api);
      return out(data.res?.ok ? 200 : 503, routeMeta(id, { path }), playersView(data));
    }
    case 'stats': {
      const data = await loadStats(api);
      return out(200, routeMeta(id, { path }), statsView(data));
    }
    case 'props':
      return out(200, routeMeta(id, { path }), intro('Best line', 'Props & best line', 'The best price a sportsbook offers and the market’s no-vig consensus, clearly separated and timestamped. Player props are captured inside 36 hours of tip.', [['/matchups', 'Matchups'], ['/news/c/props', 'Prop Watch stories'], ['/methodology', 'How market data works']]));
    case 'pbe-picks':
      return out(200, routeMeta(id, { path }), intro('WNBA Pro', 'PBE Picks', 'An independent WNBA win probability for every covered game, built only from pregame team data, with the de-vigged sportsbook consensus beside it. Calls lock 15 minutes before tip.', [['/track-record', 'Track Record'], ['/pbe-picks/model', 'How the Model Works'], ['/pro', 'WNBA Pro']]));
    case 'pbe-model':
      return out(200, routeMeta(id, { path }), intro('PBE Picks', 'How the model works', 'A deterministic probability model from pregame team data: walk-forward validated, calibrated, benchmarked against the market, locked 15 minutes before tip.', [['/pbe-picks', 'PBE Picks'], ['/track-record', 'Track Record']]));
    case 'track-record':
      return out(200, routeMeta(id, { path }), intro('PBE Picks', 'Live track record', 'Every official locked call, graded from the final score. Wins and losses stay on the board; backtests are never counted.', [['/pbe-picks', 'PBE Picks'], ['/pbe-picks/model', 'How the Model Works']]));
    case 'pro':
      return out(200, routeMeta(id, { path }), intro('Membership', 'PropBetEdge WNBA Pro', 'The full WNBA research desk: $9.99 a month or $3.99 a week. Cancel anytime.'));
    case 'winba-score': {
      const data = await loadWinbaScore(api);
      return out(200, routeMeta(id, { path }), winbaScoreView(data), { winba: data.winba?.ok ? data.winba.data : null });
    }
    case 'sources': {
      const news = api.newsSources ? await api.newsSources() : { ok: false };
      return out(200, routeMeta(id, { path }), html`${sourcesHead()}${sourcesRegistryView()}${newsHealthView(news)}`);
    }
    case 'about':
    case 'editorial-policy':
    case 'corrections':
    case 'methodology':
      return out(200, routeMeta(id, { path }), TRUST_VIEWS[id]());
    case 'world-cup':
      return { status: 301, redirect: `/international/${CURRENT_WORLD_CUP}`, route: id };
    case 'international': {
      const data = await loadIntlHome(api);
      if (!data.home?.ok) return unavailable('International data', data.home);
      return out(200, routeMeta(id, { path }), intlHomeView(data), data.home.data);
    }
    case 'intl-competition': {
      if (params.competition === 'world-cup') return { status: 301, redirect: `/international/${CURRENT_WORLD_CUP}${params.section ? `/${params.section}` : ''}`, route: id };
      const data = await loadCompetition(api, params.competition, params.section || null);
      if (!data.ov?.ok) return unavailable('This competition', data.ov);
      return out(200, routeMeta(id, { path, params, data: data.ov.data }), competitionView(data), data.ov.data);
    }
    case 'intl-game': {
      const data = await loadIntlGame(api, params.gameId);
      if (!data.res?.ok) return unavailable('This game', data.res);
      return out(200, routeMeta(id, { path, params, data: data.res.data }), intlGameView(data), data.res.data);
    }
    case 'intl-team': {
      const data = await loadNationalTeam(api, params.teamSlug);
      if (!data.res?.ok) return unavailable('This national team', data.res);
      return out(200, routeMeta(id, { path, params, data: data.res.data }), nationalTeamView(data), data.res.data);
    }
    case 'intl-player': {
      const data = await loadIntlPlayer(api, params.playerId);
      if (!data.res?.ok) return unavailable('This player', data.res);
      const canonical = playerHref(data.res.data.player);
      if (path !== canonical) return { status: 301, redirect: canonical, route: id };
      return out(200, routeMeta(id, { path, params, data: data.res.data }), intlPlayerView(data), data.res.data);
    }
    case 'story':
      return out(200, routeMeta(id, { path }), intro('PropBetEdge Desk', 'Desk note', 'A legacy PropBetEdge desk note. Current coverage lives in the newsroom.', [['/news', 'Newsroom']]), null);
    default:
      return nf();
  }
}

/** Compose the full document from the deployed SPA shell. */
export function composeDocument(shell, page) {
  const head = headTags(page.meta, page.graph);
  // page.main is markup produced by the escaped view templates.
  const body = shellHtml({ main: raw(page.main), ssrPath: page.status === 200 ? page.meta.path : null });
  const start = shell.indexOf('<!--seo:start-->');
  const end = shell.indexOf('<!--seo:end-->');
  if (start < 0 || end < 0 || !shell.includes('<div id="app"></div>')) throw new Error('shell markers missing');
  // Function replacements: page copy may contain "$" sequences that string replacement would interpret.
  return `${shell.slice(0, start)}<!--seo:start-->\n    ${head}\n    ${shell.slice(end)}`.replace('<div id="app"></div>', () => `<div id="app">${body}</div>`);
}

