// PropBetEdge WNBA GA4 bootstrap.
//
// Keep analytics code in the bundled first-party module so the production CSP
// can stay strict (no 'unsafe-inline'). GA's loader is the only external script.
// Page views are emitted by the path router with send_page_view disabled so SPA
// navigation is counted exactly once.

export const GA_ID = 'G-BRS48R8PG9';
export const GA_SURFACE = 'wnba';

let enabled = false;
let lastPageKey = '';
let networkClickInstalled = false;

function isProductionWnbaHost(hostname = '') {
  return String(hostname).toLowerCase() === 'wnba.propbetedge.ai';
}

function gtag(win, ...args) {
  if (typeof win?.gtag === 'function') win.gtag(...args);
}

export function initAnalytics({ win = window } = {}) {
  if (!isProductionHost(win?.location?.hostname)) return false;
  const p = win?.PBEPrivacy;
  if (!p) return false;
  p.initAnalytics({ surface: GA_SURFACE, analytics: true, sendPageView: false });
  return p.analyticsAllowed();
}

export function trackPageView({ routeId = null, path = null, win = window, doc = document } = {}) {
  if (!enabled || !isProductionWnbaHost(win?.location?.hostname) || typeof win.gtag !== 'function') return false;

  const pagePath = `${win.location.pathname}${win.location.search}${win.location.hash}`;
  const pageKey = `${pagePath}|${doc.title}`;
  if (pageKey === lastPageKey) return false;
  lastPageKey = pageKey;

  const payload = {
    page_title: doc.title,
    page_location: win.location.href,
    page_path: pagePath,
    pbe_surface: GA_SURFACE,
    pbe_route_type: 'path'
  };
  if (routeId) payload.pbe_route_id = routeId;
  if (path) payload.pbe_route_path = path;

  gtag(win, 'event', 'page_view', payload);
  return true;
}
