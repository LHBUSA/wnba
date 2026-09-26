// Server-visible <head> block. The wnba-web Worker replaces the shell's <!--seo:start-->…<!--seo:end-->
// region with this output; the static shell keeps a site-default copy of the same block for local dev.

import { SITE_NAME, SITE, LANG, PROPBETEDGE_X_HANDLE } from './site.js';
import { jsonLdText } from './jsonld.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imageType = (url) => /\.png(?:[?#]|$)/i.test(String(url || '')) ? 'image/png' : /\.webp(?:[?#]|$)/i.test(String(url || '')) ? 'image/webp' : 'image/jpeg';

export function headTags(meta, graph) {
  const t = [];
  const tag = (s) => t.push(s);
  tag(`<title>${esc(meta.title)}</title>`);
  tag(`<meta name="description" content="${esc(meta.description)}" />`);
  tag(`<meta name="robots" content="${esc(meta.robots)}" />`);
  tag(`<link rel="canonical" href="${esc(meta.url)}" />`);
  tag(`<link rel="alternate" type="application/rss+xml" title="${esc(`${SITE_NAME} Newsroom`)}" href="${SITE}/rss.xml" />`);
  tag(`<meta property="og:site_name" content="${esc(SITE_NAME)}" />`);
  tag(`<meta property="og:locale" content="${LANG.replace('-', '_')}" />`);
  tag(`<meta property="og:type" content="${esc(meta.type)}" />`);
  tag(`<meta property="og:url" content="${esc(meta.url)}" />`);
  tag(`<meta property="og:title" content="${esc(meta.title)}" />`);
  tag(`<meta property="og:description" content="${esc(meta.description)}" />`);
  tag(`<meta property="og:image" content="${esc(meta.image.url)}" />`);
  tag(`<meta property="og:image:secure_url" content="${esc(meta.image.url)}" />`);
  tag(`<meta property="og:image:width" content="${meta.image.width}" />`);
  tag(`<meta property="og:image:type" content="${imageType(meta.image.url)}" />`);
  tag(`<meta property="og:image:height" content="${meta.image.height}" />`);
  tag(`<meta property="og:image:alt" content="${esc(meta.image.alt)}" />`);
  if (meta.type === 'article') {
    tag('<meta name="author" content="PropBetEdge WNBA Newsroom" />');
    tag(`<meta property="article:published_time" content="${esc(meta.published)}" />`);
    if (meta.modified) {
      tag(`<meta property="article:modified_time" content="${esc(meta.modified)}" />`);
      tag(`<meta property="og:updated_time" content="${esc(meta.modified)}" />`);
    }
    tag(`<meta property="article:section" content="${esc(meta.section)}" />`);
    tag(`<meta property="article:author" content="${SITE}/about" />`);
    tag(`<meta property="article:publisher" content="${SITE}/about" />`);
  }
  if (meta.type === 'profile' && meta.profile) {
    if (meta.profile.firstName) tag(`<meta property="profile:first_name" content="${esc(meta.profile.firstName)}" />`);
    if (meta.profile.lastName) tag(`<meta property="profile:last_name" content="${esc(meta.profile.lastName)}" />`);
    if (meta.profile.username) tag(`<meta property="profile:username" content="${esc(meta.profile.username)}" />`);
  }
  tag('<meta name="twitter:card" content="summary_large_image" />');
  tag(`<meta name="twitter:site" content="${PROPBETEDGE_X_HANDLE}" />`);
  tag(`<meta name="twitter:url" content="${esc(meta.url)}" />`);
  tag(`<meta name="twitter:title" content="${esc(meta.title)}" />`);
  tag(`<meta name="twitter:description" content="${esc(meta.description)}" />`);
  tag(`<meta name="twitter:image" content="${esc(meta.image.url)}" />`);
  tag(`<meta name="twitter:image:alt" content="${esc(meta.image.alt)}" />`);
  if (graph) tag(`<script type="application/ld+json" data-ld="page">${jsonLdText(graph)}</script>`);
  return t.join('\n    ');
}
