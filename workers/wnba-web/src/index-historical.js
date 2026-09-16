// Historical-archive publishing layer for wnba-web.
//
// The main publishing Worker remains the fallback for every existing route. This
// thin layer owns only the verified historical international archives so the
// first HTTP response, metadata, JSON-LD and sitemap match the client product.
import current from './index.js';
import { bindingApi } from './api.js';
import { composeDocument } from './render.js';
import { intlHomeView } from '../../../src/views/international.js';
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
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://wnba-api.sales-fd3.workers.dev https://wnba-api.propbetedge.ai https://wnba-news.sales-fd3.workers.dev https://wnba-international.sales-fd3.workers.dev; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://buy.stripe.com"
};
const SHELL_HOSTS = /^(wnba\.propbetedge\.ai|wnba-[a-z0-9-]+-justins-projects-ad4f4bb7\.vercel\.app)$/;
const HISTORICAL_ROUTE = /^\/international\/([a-z0-9-]+-\d{4})(?:\/(games|bracket|standings|leaders|teams|players))?$/;
let shellMemo = { at: 0, host: '', html: '' };

const respond = (body, status, headers = {}) => new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
const publicHost = (request) => request.headers.get('x-forwarded-host') || new URL(request.url).host;

async function loadShell(host) {
  const origin = SHELL_HOSTS.test(host || '') ? `https://${host}` : SITE;
  if (shellMemo.html && shellMemo.host === origin && Date.now() - shellMemo.at < 60e3) return shellMemo.html;
  const res = await fetch(`${origin}/app-shell.html`, { cf: { cacheTtlByStatus: { '200-299': 60, '400-599': 0 } } });
  if (!res.ok) {
    if (origin !== SITE) return loadShell('wnba.propbetedge.ai');
    throw new Error(`shell ${res.status}`);
  }
  const html = await res.text();
  shellMemo = { at: Date.now(), host: origin, html };
  return html;
}

function archiveHomeModel(home) {
  if (!home?.ok) return home;
  return {
    ...home,
    data: {
      ...home.data,
      competitions: (home.data.competitions || []).map((c) => {
        const archive = internationalHistoryFor(c.competition_id);
        return archive ? { ...c, coverage: 'full', status: `historical · ${archive.champion} champion` } : c;
      })
    }
  };
}

async function historicalHome(request, env) {
  const api = bindingApi(env);
  const home = archiveHomeModel(await api.intl());
  if (!home?.ok) return current.fetch(request, env, { waitUntil() {} });
  const meta = routeMeta('international', { path: '/international' });
  const page = {
    status: 200,
    route: 'international',
    meta,
    main: String(intlHomeView({ home })),
    graph: pageGraph('international', meta, home.data)
  };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': HTML_CACHE,
    'x-pbe-render': 'wnba-web/1.0.0 international-history-home'
  });
}

async function historicalCompetition(request, slug, section) {
  const competition = competitionById(slug);
  const archive = competition ? internationalHistoryFor(competition.competition_id) : null;
  if (!competition || !archive) return null;
  if (section) return respond(null, 301, { location: `${SITE}/international/${competition.slug}`, 'cache-control': 'public, max-age=300, s-maxage=3600' });
  const meta = historicalCompetitionMeta(competition, archive);
  const page = {
    status: 200,
    route: 'intl-competition',
    meta,
    main: String(historicalCompetitionView(competition, archive)),
    graph: historicalCompetitionGraph(competition, archive, meta)
  };
  const shell = await loadShell(publicHost(request));
  return respond(composeDocument(shell, page), 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': HTML_CACHE,
    'x-pbe-render': 'wnba-web/1.0.0 intl-history'
  });
}

async function sitemapWithArchives(request, env, ctx) {
  const base = await current.fetch(request, env, ctx);
  if (!base.ok) return base;
  const text = await base.text();
  if (!text.includes('</urlset>')) return new Response(text, { status: base.status, headers: base.headers });
  const rows = COMPETITIONS
    .filter((c) => INTERNATIONAL_HISTORY[c.competition_id])
    .map((c) => `  <url><loc>${SITE}/international/${c.slug}</loc></url>`)
    .join('\n');
  const body = text.replace('</urlset>', `${rows ? `${rows}\n` : ''}</urlset>`);
  return new Response(body, { status: base.status, headers: base.headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/international') {
      try { return await historicalHome(request, env); }
      catch (e) { console.error('historical home failed', e?.stack || e); }
    }
    if ((request.method === 'GET' || request.method === 'HEAD')) {
      const m = url.pathname.match(HISTORICAL_ROUTE);
      if (m) {
        try {
          const response = await historicalCompetition(request, m[1], m[2] || null);
          if (response) return response;
        } catch (e) {
          console.error('historical competition failed', url.pathname, e?.stack || e);
        }
      }
      if (url.pathname === '/sitemap.xml') return sitemapWithArchives(request, env, ctx);
    }
    return current.fetch(request, env, ctx);
  }
};
