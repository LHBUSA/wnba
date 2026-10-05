// PropBetEdge WNBA analytics — consent-gated by the shared network privacy runtime.

export const GA_ID = 'G-BRS48R8PG9';
export const GA_SURFACE = 'wnba';

let lastPageKey = '';

function isProductionWnbaHost(hostname = '') {
  return String(hostname).toLowerCase() === 'wnba.propbetedge.ai';
}

export function initAnalytics({ win = window } = {}) {
  if (!isProductionWnbaHost(win?.location?.hostname)) return false;
  const p = win?.PBEPrivacy;
  if (!p) return false;
  p.initAnalytics({ surface: GA_SURFACE, analytics: true, sendPageView: false });
  return p.analyticsAllowed();
}

export function trackPageView({ routeId = null, path = null, win = window, doc = document } = {}) {
  if (!isProductionWnbaHost(win?.location?.hostname)) return false;
  const p = win?.PBEPrivacy;
  if (!p) return false;

  const pagePath = `${win.location.pathname}${win.location.search}${win.location.hash}`;
  const pageKey = `${pagePath}|${doc.title}`;
  if (pageKey === lastPageKey) return false;

  const payload = {
    page_title: doc.title,
    page_location: win.location.href,
    page_path: pagePath,
    pbe_surface: GA_SURFACE,
    pbe_route_type: 'path'
  };
  if (routeId) payload.pbe_route_id = routeId;
  if (path) payload.pbe_route_path = path;

  if (p.analyticsAllowed()) {
    lastPageKey = pageKey;
    return p.track('page_view', payload);
  }

  p.whenAnalyticsAllowed(() => {
    if (pageKey === lastPageKey) return;
    lastPageKey = pageKey;
    p.track('page_view', payload);
  });
  return false;
}

export const __test = { reset() { lastPageKey = ''; } };
