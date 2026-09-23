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

export function initAnalytics({ win = window, doc = document } = {}) {
  if (!isProductionWnbaHost(win?.location?.hostname)) return false;

  win.dataLayer = win.dataLayer || [];
  win.gtag = win.gtag || function () { win.dataLayer.push(arguments); };

  gtag(win, 'js', new Date());
  gtag(win, 'set', { pbe_surface: GA_SURFACE });
  gtag(win, 'config', GA_ID, {
    send_page_view: false,
    cookie_domain: '.propbetedge.ai',
    cookie_flags: 'SameSite=Lax;Secure'
  });

  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  if (!doc.querySelector(`script[data-pbe-ga4="${GA_ID}"]`)) {
    const script = doc.createElement('script');
    script.async = true;
    script.src = src;
    script.dataset.pbeGa4 = GA_ID;
    script.crossOrigin = 'anonymous';
    doc.head.appendChild(script);
  }

  if (!networkClickInstalled) {
    networkClickInstalled = true;
    doc.addEventListener('click', (event) => {
      const target = event.target?.closest?.('a[href]');
      if (!target) return;

      try {
        const url = new URL(target.href, win.location.href);
        const currentHost = String(win.location.hostname || '').toLowerCase();
        const targetHost = String(url.hostname || '').toLowerCase();
        const inNetwork = targetHost === 'propbetedge.ai' || targetHost.endsWith('.propbetedge.ai');

        if (inNetwork && targetHost !== currentHost) {
          gtag(win, 'event', 'pbe_network_click', {
            pbe_surface: GA_SURFACE,
            source_host: currentHost,
            target_host: targetHost,
            link_url: url.href
          });
        }
      } catch {
        // Ignore malformed/non-http hrefs.
      }
    }, { capture: true });
  }

  enabled = true;
  return true;
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
