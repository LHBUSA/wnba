// Historical-archive publishing layer for wnba-web.
// The main publishing Worker remains the fallback for every existing route. This
// layer also owns public, data-free premium landing responses so protected values
// are never server-rendered into public HTML.
import current from './index.js';
import { bindingApi } from './api.js';
import { composeDocument } from './render.js';
import { intlHomeView } from '../../../src/views/international.js';
import { playerLoadPublicView } from '../../../src/views/player-load.js';
import { historyView } from '../../../src/views/history.js';
import { pbePicksPublicView } from '../../../src/views/pbe-picks-public.js';
import { dailyBriefView } from '../../../src/views/daily-brief.js';
import { proFeaturePublicView } from '../../../src/views/pro-intelligence.js';
import { PRO_INTELLIGENCE } from '../../../src/data/pro-features.js';
import { INTERNATIONAL_HISTORY, internationalHistoryFor, historicalCompetitionView } from '../../../src/views/international-history.js';
import { historicalCompetitionMeta, historicalCompetitionGraph } from '../../../src/seo/international-history-meta.js';
import { routeMeta } from '../../../src/seo/meta.js';
import { pageGraph } from '../../../src/seo/jsonld.js';
import { competitionById, COMPETITIONS } from '../../wnba-international/src/registry.js';

const SITE = 'https://wnba.propbetedge.ai';
const HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://a.espncdn.com https://cdn.wnba.com https://www.google-analytics.com https://*.google-analytics.com; connect-src 'self' https://wnba-api.sales-fd3.workers.dev https://wnba-api.propbetedge.ai https://wnba-news.sales-fd3.workers.dev https://wnba-international.sales-fd3.workers.dev https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://buy.stripe.com"
};
const SHELL_HOSTS = /^(wnba\.propbetedge\.ai|wnba-[a-z0-9-]+-justins-projects-ad4f4bb7\.vercel\.app)$/;
const HISTORICAL_ROUTE = /^\/international\/([a-z0-9-]+-\d{4})(?:\/(games|bracket|standings|leaders|teams|players))?$/;
const PREMIUM_PUBLIC_ROUTES = new Map(PRO_INTELLIGENCE.map((f) => [f.href, f]));
let shellMemo = { at: 0, host: '', html: '' };

const respond = (body, status, headers = {}) => new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
const publicHost = (request) => request.headers.get('x-forwarded-host') || new URL(request.url).host;

async function loadShell(host) {
  const origin = SHELL_HOSTS.test(host || '') ? `https://${host}` : SITE;
  if (shellMemo.html && shellMemo.host === origin && Date.now() - shellMemo.at < 60e3) return shellMemo.html;
  const res = await fetch(`${origin}/app-shell.html`, { cf: { cacheTtlByStatus: { '200-299': 60, '400-599': 0 } } });
  if (!res.ok) { if (origin !== SITE) return loadShell('wnba.propbetedge.ai'); throw new Error(`shell ${res.status}`); }
  const html = await res.text();
  shellMemo = { at: Date.now(), host: origin, html };
  return html;
}

function archiveHomeModel(home) {
  if (!home?.ok) return home;
  return { ...home, data: { ...home.data, competitions: (home.data.competitions || []).map((c) => { const archive = internationalHistoryFor(c.competition_id); return archive ? { ...c, coverage: 'full', status: `historical · ${archive.champion} champion` } : c; }) } };
}

async function historicalHome(request, env) {
  const api = bindingApi(env);
  const home = archiveHomeModel(await api.intl());
  if (!home?.ok) return current.fetch(request, env, { waitUntil() {} });
  const meta = routeMeta('international', { path: '/international' });
  const page = { status: 200, route: 'international', meta, main: String(intlHomeView({ home })), graph: pageGraph('international', meta, home.data) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': 'wnba-web/1.0.0 international-history-home' });
}

async function pbePicksLanding(request) {
  const seed = routeMeta('pbe-picks', { path: '/pbe-picks' });
  const meta = { ...seed, description: 'PBE WNBA intelligence: independent win probabilities, de-vigged market comparison, model-market disagreement, confidence, driver-by-driver reasoning, matchup research and a permanent locked track record.' };
  const page = { status: 200, route: 'pbe-picks', meta, main: String(pbePicksPublicView()), graph: pageGraph('pbe-picks', meta, {}) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': 'wnba-web/1.0.0 pbe-picks-public' });
}

async function playerLoadLanding(request) {
  const meta = routeMeta('player-load', { path: '/player-load' });
  const page = { status: 200, route: 'player-load', meta, main: String(playerLoadPublicView()), graph: pageGraph('player-load', meta, {}) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': 'wnba-web/1.0.0 player-load-public' });
}

async function dailyBriefLanding(request, env) {
  const api = bindingApi(env, { timeoutMs: 12000 });
  const [today, coverage, track, injuries, teams] = await Promise.all([api.today(), api.pbeCoverage(), api.trackRecord(), api.injuries(), api.teams()]);
  const meta = routeMeta('daily-brief', { path: '/brief' });
  const page = { status: 200, route: 'daily-brief', meta, main: String(dailyBriefView({ today, coverage, track, injuries, teams, generatedAt: new Date().toISOString() })), graph: pageGraph('daily-brief', meta, {}) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': 'wnba-web/1.0.0 daily-brief' });
}

async function premiumLanding(request, feature) {
  const meta = routeMeta(feature.routeId, { path: feature.href });
  const page = { status: 200, route: feature.routeId, meta, main: String(proFeaturePublicView(feature)), graph: pageGraph(feature.routeId, meta, {}) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': `wnba-web/1.0.0 ${feature.routeId}-public` });
}

async function historyLanding(request) {
  const meta = routeMeta('history', { path: '/history' });
  const page = { status: 200, route: 'history', meta, main: String(historyView()), graph: pageGraph('history', meta, {}) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': 'wnba-web/1.1.0 history' });
}

async function historicalCompetition(request, slug, section) {
  const competition = competitionById(slug);
  const archive = competition ? internationalHistoryFor(competition.competition_id) : null;
  if (!competition || !archive) return null;
  if (section) return respond(null, 301, { location: `${SITE}/international/${competition.slug}`, 'cache-control': 'public, max-age=300, s-maxage=3600' });
  const meta = historicalCompetitionMeta(competition, archive);
  const page = { status: 200, route: 'intl-competition', meta, main: String(historicalCompetitionView(competition, archive)), graph: historicalCompetitionGraph(competition, archive, meta) };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE, 'x-pbe-render': 'wnba-web/1.0.0 intl-history' });
}

async function sitemapWithArchives(request, env, ctx) {
  const base = await current.fetch(request, env, ctx);
  if (!base.ok) return base;
  const text = await base.text();
  if (!text.includes('</urlset>')) return new Response(text, { status: base.status, headers: base.headers });
  const urls = [`${SITE}/pbe-picks`, `${SITE}/player-load`, `${SITE}/brief`, ...PRO_INTELLIGENCE.map((f) => `${SITE}${f.href}`), ...COMPETITIONS.filter((c) => INTERNATIONAL_HISTORY[c.competition_id]).map((c) => `${SITE}/international/${c.slug}`)]
    .filter((u) => !text.includes(`<loc>${u}</loc>`));
  const rows = urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n');
  const body = text.replace('</urlset>', `${rows ? `${rows}\n` : ''}</urlset>`);
  return new Response(body, { status: base.status, headers: base.headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/history') {
      try { return await historyLanding(request); } catch (e) { console.error('history landing failed', e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/pbe-picks') {
      try { return await pbePicksLanding(request); } catch (e) { console.error('pbe picks landing failed', e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/player-load') {
      try { return await playerLoadLanding(request); } catch (e) { console.error('player load landing failed', e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/brief') {
      try { return await dailyBriefLanding(request, env); } catch (e) { console.error('daily brief landing failed', e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && PREMIUM_PUBLIC_ROUTES.has(url.pathname)) {
      try { return await premiumLanding(request, PREMIUM_PUBLIC_ROUTES.get(url.pathname)); } catch (e) { console.error('premium landing failed', url.pathname, e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/international') {
      try { return await historicalHome(request, env); } catch (e) { console.error('historical home failed', e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD')) {
      const m = url.pathname.match(HISTORICAL_ROUTE);
      if (m) { try { const response = await historicalCompetition(request, m[1], m[2] || null); if (response) return response; } catch (e) { console.error('historical competition failed', url.pathname, e?.stack || e); } }
      if (url.pathname === '/sitemap.xml') return sitemapWithArchives(request, env, ctx);
    }
    return current.fetch(request, env, ctx);
  }
};
