// wnba-web — the PropBetEdge WNBA publishing edge (Cloudflare Worker).
//
// Vercel keeps serving the static SPA build (assets, media, fonts, the app shell). Indexable HTML routes,
// sitemaps, RSS and share cards are proxied here by vercel.json external rewrites, so the first HTTP response
// carries the page's title, canonical, robots, Open Graph, JSON-LD and the same editorial content the SPA
// renders (shared views). No Vercel Function is involved; data comes from wnba-api / wnba-news service bindings.

import { bindingApi } from './api.js';
import { renderRoute, composeDocument } from './render.js';
import { newsSitemapXml, sitemapXml, rssXml } from '../../../src/seo/feeds.js';
import { DESKS } from '../../../src/seo/site.js';
import { etCompact, addDays } from '../../shared/time.js';

export const SERVICE = 'wnba-web';
export const VERSION = '1.0.0';
const SITE = 'https://wnba.propbetedge.ai';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://wnba-api.sales-fd3.workers.dev https://wnba-news.sales-fd3.workers.dev https://wnba-international.sales-fd3.workers.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://buy.stripe.com"
};

const HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const FEED_CACHE = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';
const NEWS_SITEMAP_CACHE = 'public, max-age=120, s-maxage=120, stale-while-revalidate=300';

// The deployed SPA shell (hashed asset URLs) is read from the same Vercel deployment family.
const SHELL_HOSTS = /^(wnba\.propbetedge\.ai|wnba-[a-z0-9-]+-justins-projects-ad4f4bb7\.vercel\.app)$/;
let shellMemo = { at: 0, host: '', html: '' };

async function loadShell(env, host) {
  const origin = SHELL_HOSTS.test(host || '') ? `https://${host}` : SITE;
  if (shellMemo.html && shellMemo.host === origin && Date.now() - shellMemo.at < 60e3) return shellMemo.html;
  const res = await fetch(`${origin}/app-shell.html`, { cf: { cacheTtlByStatus: { '200-299': 60, '400-599': 0 } } });
  if (!res.ok) {
    if (origin !== SITE) return loadShell(env, 'wnba.propbetedge.ai');
    throw new Error(`shell ${res.status}`);
  }
  const html = await res.text();
  shellMemo = { at: Date.now(), host: origin, html };
  return html;
}

const respond = (body, status, headers) => new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });

function publicHost(request) {
  // Vercel's external rewrite forwards the viewer's host; a direct workers.dev hit has none.
  return request.headers.get('x-forwarded-host') || new URL(request.url).host;
}

async function html(request, env, url) {
  const host = publicHost(request);
  const api = bindingApi(env);
  let page;
  try {
    page = await renderRoute(url.pathname, api);
  } catch (e) {
    console.error('render failed', url.pathname, e?.stack || e);
    page = { status: 503, route: 'error', meta: null, main: '', graph: null };
  }
  if (page.redirect) return respond(null, page.status, { location: `${SITE}${page.redirect}`, 'cache-control': 'public, max-age=300, s-maxage=3600' });
  const shell = await loadShell(env, host);
  // Render failures fall back to the plain SPA shell (site-default head) rather than a broken document.
  const body = page.meta ? composeDocument(shell, page) : shell;
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': page.status === 200 ? HTML_CACHE : page.status === 404 ? 'public, max-age=0, s-maxage=60' : 'no-store',
    'x-pbe-render': `${SERVICE}/${VERSION} ${page.route}`
  };
  return respond(body, page.status, headers);
}

async function feeds(env, url) {
  const api = bindingApi(env, { timeoutMs: 15000 });
  if (url.pathname === '/news-sitemap.xml' || url.pathname === '/rss.xml') {
    const arts = await api.articles({ limit: 400 });
    if (!arts.ok) return respond('temporarily unavailable', 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '120' });
    return url.pathname === '/rss.xml'
      ? respond(rssXml(arts.data.items), 200, { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': FEED_CACHE })
      : respond(newsSitemapXml(arts.data.items), 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': NEWS_SITEMAP_CACHE });
  }
  const today = etCompact();
  const [arts, players, teams, schedule, intl] = await Promise.all([api.articles({ limit: 400 }), api.players(), api.teams(), api.schedule({ from: addDays(today, -14), to: addDays(today, 14) }), api.intl()]);
  let international = null;
  if (intl.ok) {
    const full = intl.data.competitions.filter((c) => c.coverage === 'full');
    const parts = await Promise.all(full.map(async (c) => ({ schedule: await api.intlCompetition(c.slug, 'schedule'), teams: await api.intlCompetition(c.slug, 'teams'), players: await api.intlCompetition(c.slug, 'players') })));
    international = {
      competitions: intl.data.competitions,
      games: parts.flatMap((x) => (x.schedule.ok ? x.schedule.data.games : [])),
      teams: parts.flatMap((x) => (x.teams.ok ? x.teams.data.teams.map((t) => t.team) : [])),
      players: parts.flatMap((x) => (x.players.ok ? x.players.data.players : []))
    };
  }
  if (!arts.ok || !teams.ok) return respond('temporarily unavailable', 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' });
  const liveDesks = Object.keys(DESKS).filter((k) => arts.data.items.some((c) => c.kind === k || (k === 'performance' && c.kind === 'result')));
  const body = sitemapXml({
    articles: arts.data.items,
    players: players.ok ? players.data.players : [],
    teams: teams.data.teams,
    games: schedule.ok ? schedule.data.games : [],
    desks: liveDesks,
    international
  });
  return respond(body, 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': FEED_CACHE });
}

async function og(request, env, url, ctx) {
  const m = url.pathname.match(/^\/og\/(news|players|teams|matchups|intl-games)\/([a-z0-9-]{1,140})\.png$/);
  if (!m) return respond('not found', 404, { 'content-type': 'text/plain' });
  const cache = caches.default;
  const cacheKey = new Request(`https://wnba-web.internal${url.pathname}${url.search}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const fallback = (path) => respond(null, 302, { location: `${SITE}${path}`, 'cache-control': 'public, max-age=300' });
  try {
    const { ogResponse } = await import('./og.js');
    const out = await ogResponse(m[1], m[2], { api: bindingApi(env), fetchAsset: (p) => fetch(`${SITE}${p}`, { cf: { cacheTtl: 86400 } }) });
    if (!out) return fallback('/share/propbetedge-wnba-social-v2.jpg');
    const res = respond(out.png, 200, { 'content-type': 'image/png', 'cache-control': url.searchParams.has('v') ? 'public, max-age=86400, s-maxage=604800, immutable' : 'public, max-age=3600, s-maxage=21600' });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    console.error('og failed', url.pathname, e?.stack || e);
    return fallback('/share/propbetedge-wnba-social-v2.jpg');
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond('method not allowed', 405, { allow: 'GET, HEAD' });
    if (url.pathname === '/health') return respond(JSON.stringify({ ok: true, service: SERVICE, version: VERSION, runtime: 'cloudflare-workers' }), 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    // One canonical form per URL: no trailing slash.
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) return respond(null, 301, { location: `${SITE}${url.pathname.replace(/\/+$/, '')}${url.search}`, 'cache-control': 'public, max-age=3600' });
    if (/^\/(sitemap|news-sitemap)\.xml$|^\/rss\.xml$/.test(url.pathname)) return feeds(env, url);
    if (url.pathname.startsWith('/og/')) return og(request, env, url, ctx);
    // Asset-like paths never get an HTML page.
    if (/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return respond('not found', 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' });
    return html(request, env, url);
  }
};
