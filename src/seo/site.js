// Publishing identity for wnba.propbetedge.ai. One definition shared by the browser router, the
// wnba-web publishing Worker (server-visible HTML, sitemaps, RSS, share cards) and the tests.
// The canonical host is fixed here so preview hosts and query strings never leak into metadata.

export const SITE = 'https://wnba.propbetedge.ai';
export const SITE_NAME = 'PropBetEdge WNBA';
export const PUBLICATION_NAME = 'PropBetEdge WNBA';
export const NEWSROOM_NAME = 'PropBetEdge WNBA Newsroom';
export const LANG = 'en-US';
// PropBetEdge's own network X account (official 2026-09-26). Publisher identity only:
// league, team and player X accounts are third-party and never go here.
export const PROPBETEDGE_X_URL = 'https://x.com/PROPBETEDGE';
export const PROPBETEDGE_X_HANDLE = '@PROPBETEDGE';

export const IDS = Object.freeze({
  org: 'https://propbetedge.ai/#org',
  newsroom: `${SITE}/#newsroom`,
  website: `${SITE}/#website`
});

export const DEFAULT_IMAGE = Object.freeze({
  url: `${SITE}/share/propbetedge-wnba-social-v2.jpg`,
  width: 1200,
  height: 630,
  alt: 'PropBetEdge WNBA — WNBA intelligence desk: WNBACast, props, matchups and newsroom.'
});

export const LOGO = Object.freeze({ url: `${SITE}/share/propbetedge-wnba-logo-512.png`, width: 512, height: 512 });

export const DEFAULT_DESCRIPTION = 'PropBetEdge WNBA is the independent WNBA intelligence desk: live WNBACast, sourced injuries, matchup context, sportsbook odds, player research and original WNBA newsroom coverage.';

export const abs = (path) => (/^https?:\/\//.test(String(path || '')) ? String(path) : `${SITE}${String(path || '/').startsWith('/') ? '' : '/'}${path || ''}`);

/** Canonical path: no trailing slash (except root), no query, no hash. */
export function canonicalPath(pathname) {
  const p = String(pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '');
  return p || '/';
}

// Newsroom desks as published at /news/c/:kind (the crawlable category pages).
export const DESKS = Object.freeze({
  brief: 'News Briefs',
  international: 'International',
  injury: 'Injury Desk',
  transaction: 'Roster Moves',
  league: 'League',
  performance: 'Performances',
  preview: 'Previews',
  trend: 'Team Trends',
  props: 'Prop Watch',
  market: 'Market Watch'
});

export const TRUST_PAGES = Object.freeze([
  ['/about', 'About'],
  ['/editorial-policy', 'Editorial policy'],
  ['/corrections', 'Corrections'],
  ['/methodology', 'Methodology'],
  ['/sources', 'Sources']
]);
