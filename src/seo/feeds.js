// Sitemaps and RSS. Pure functions over the public newsroom article list (/v1/articles), which already
// excludes superseded stories and collapsed duplicates. Every publication date is the story's immutable
// editorial origin (first_published_at): a revision never makes a story newly eligible or newly dated.

import { SITE, PUBLICATION_NAME, NEWSROOM_NAME, DESKS, TRUST_PAGES } from './site.js';
import { deskOf, articleShareImage } from './meta.js';

export const NEWS_SITEMAP_WINDOW_MS = 48 * 3600e3;
const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };
const origin = (c) => c.first_published_at || null;

/** Canonical, live newsroom articles, newest editorial origin first, one entry per canonical URL. */
export function canonicalArticles(items) {
  const seen = new Set();
  return (items || [])
    .filter((c) => c && c.slug && !c.superseded_by && !c.duplicate_of && c.status !== 'held' && ms(origin(c)) !== null)
    .filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)))
    .sort((a, b) => ms(origin(b)) - ms(origin(a)));
}

export function newsSitemapEntries(items, { now = Date.now(), windowMs = NEWS_SITEMAP_WINDOW_MS } = {}) {
  return canonicalArticles(items).filter((c) => { const t = ms(origin(c)); return t <= now + 5 * 60e3 && now - t <= windowMs; }).slice(0, 1000);
}

export function newsSitemapXml(items, opts) {
  const rows = newsSitemapEntries(items, opts).map((c) => `  <url>
    <loc>${xml(`${SITE}/news/${c.slug}`)}</loc>
    <news:news>
      <news:publication><news:name>${xml(PUBLICATION_NAME)}</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>${xml(new Date(ms(origin(c))).toISOString())}</news:publication_date>
      <news:title>${xml(c.headline)}</news:title>
    </news:news>
  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${rows.join('\n')}
</urlset>
`;
}

export const STATIC_PATHS = ['/', '/news', '/news/archive', '/news/winba-index', '/injuries', '/standings', '/stats', '/props', '/matchups', '/players', '/teams', '/cast', '/track-record', '/winba-score', '/international', ...TRUST_PAGES.map(([p]) => p)];

const COMBINING = new RegExp('[\u0300-\u036f]', 'g');
export const intlPlayerPath = (p) => `/international/players/${String(p.player_id).replace(/^p-/, '')}-${String(p.name || '').normalize('NFKD').replace(COMBINING, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

/**
 * @param {object} o { articles, players, teams, games, desks } — desks: kinds that currently have stories.
 * lastmod is emitted only where a real content date exists (article origin / revision); never the build time.
 */
export function sitemapXml({ articles = [], players = [], teams = [], games = [], desks = Object.keys(DESKS), teamNews = [], international = null } = {}) {
  const urls = [];
  const add = (path, lastmod) => urls.push(`  <url><loc>${xml(`${SITE}${path}`)}</loc>${lastmod ? `<lastmod>${xml(new Date(ms(lastmod)).toISOString())}</lastmod>` : ''}</url>`);
  const seen = new Set();
  const once = (path, lastmod) => { if (!seen.has(path)) { seen.add(path); add(path, lastmod); } };
  const newest = canonicalArticles(articles)[0];
  for (const p of STATIC_PATHS) once(p, p === '/news' && newest ? newest.first_published_at : null);
  for (const k of desks) if (DESKS[k]) once(`/news/c/${k}`);
  // Team news pages are listed only for teams with at least one live newsroom story (empty ones are noindex).
  for (const id of teamNews) once(`/news/teams/${id}`);
  for (const c of canonicalArticles(articles)) {
    const rev = ms(c.revised_at);
    once(`/news/${c.slug}`, rev && rev > ms(origin(c)) ? c.revised_at : origin(c));
  }
  for (const t of teams) if (t?.team_id) once(`/teams/${t.team_id}`);
  for (const p of players) if (p?.athlete_id) once(`/players/${p.athlete_id}`);
  for (const g of games) if (g?.game_id) once(`/matchups/${g.game_id}`);
  if (international) {
    for (const c of international.competitions || []) {
      if (c.coverage !== 'full') continue;
      for (const s of ['', '/games', '/bracket', '/standings', '/leaders', '/teams', '/players']) once(`/international/${c.slug}${s}`);
    }
    for (const g of international.games || []) once(`/international/games/${String(g.game_id).replace(/^g-/, '')}`);
    for (const t of international.teams || []) once(`/international/teams/${t.slug}`);
    // Thin player pages (one appearance, no WNBA link) are noindex and stay out of the sitemap.
    for (const p of international.players || []) if (p.games >= 2 || p.wnba) once(intlPlayerPath(p));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

const rfc822 = (iso) => new Date(ms(iso)).toUTCString();

export function rssXml(items, { limit = 50, now = Date.now() } = {}) {
  const list = canonicalArticles(items).filter((c) => ms(origin(c)) <= now + 5 * 60e3).slice(0, limit);
  const entries = list.map((c) => {
    const url = `${SITE}/news/${c.slug}`;
    const img = articleShareImage(c);
    const rev = ms(c.revised_at);
    return `    <item>
      <title>${xml(c.headline)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <pubDate>${rfc822(origin(c))}</pubDate>
      ${rev && rev > ms(origin(c)) ? `<atom:updated>${new Date(rev).toISOString()}</atom:updated>\n      ` : ''}<dc:creator>${xml(NEWSROOM_NAME)}</dc:creator>
      <category>${xml(DESKS[deskOf(c.kind)] || 'Newsroom')}</category>
      <description>${xml(c.deck)}</description>
      <media:content url="${xml(img.url)}" medium="image" type="image/png" width="${img.width}" height="${img.height}" />
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xml(`${PUBLICATION_NAME} Newsroom`)}</title>
    <link>${SITE}/news</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Original, source-grounded WNBA news, injury and roster-move stories, previews, recaps and market analysis from the PropBetEdge WNBA newsroom.</description>
    <language>en-us</language>
    <copyright>© PropBetEdge</copyright>
    <ttl>10</ttl>
    ${list[0] ? `<lastBuildDate>${rfc822(list.map((c) => c.revised_at && ms(c.revised_at) > ms(origin(c)) ? c.revised_at : origin(c)).sort((a, b) => ms(b) - ms(a))[0])}</lastBuildDate>` : ''}
    <image><url>${SITE}/share/propbetedge-wnba-logo-512.png</url><title>${xml(`${PUBLICATION_NAME} Newsroom`)}</title><link>${SITE}/news</link></image>
${entries.join('\n')}
  </channel>
</rss>
`;
}
