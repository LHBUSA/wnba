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

// Identity V3 (2026-09-26). Assets are built from the canonical PropBetEdge artwork by
// scripts/brand/build-brand-assets.py (docs/BRAND.md). Social networks cache cards by URL, so a new
// card design always ships at a new URL — never overwrite a published card in place.
export const SOCIAL_CARD_PATH = '/share/propbetedge-wnba-social-v3.jpg';
export const DEFAULT_IMAGE = Object.freeze({
  url: `${SITE}${SOCIAL_CARD_PATH}`,
  width: 1200,
  height: 630,
  alt: 'PropBetEdge WNBA — live sports intelligence: WNBACast, Player DNA, WinBA, matchups and news. @PROPBETEDGE'
});

// Dynamic /og/* card design revision. Bump it whenever the card chrome changes so X and LinkedIn refetch.
export const OG_REV = '3';

// The PropBetEdge mark (canonical artwork) on the site ink: Organization and publisher logo everywhere.
export const LOGO = Object.freeze({ url: `${SITE}/share/propbetedge-logo-v3-512.png`, width: 512, height: 512 });

export const DEFAULT_DESCRIPTION = 'Live WNBA intelligence from PropBetEdge: WNBACast, Player DNA, WinBA, matchups, availability, analytics and original data-backed news.';

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
