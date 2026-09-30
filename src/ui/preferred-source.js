// Google Preferred Sources — shared PropBetEdge control (reference: LHBUSA/propbetedge-news-site
// src/components/preferred-source.js, 753069e).
//
// The control is OUR markup, rendered inside the shell/footer, so it is visible on first paint and never
// depends on when an async Google script runs. Clicks go through one delegated document listener, which
// covers every later render (SPA navigation, SSR chrome reconciliation) and cannot double-bind.
//
// Source policy (checked in google.com/preferences/source on 2026-09-30):
//   eligible:   propbetedge.ai, mlb.propbetedge.ai, ufc.propbetedge.ai -> Google SDK, own host
//   not listed: nfl/nba/wnba/nhl/tennis/soccer.propbetedge.ai        -> deeplink to propbetedge.ai
// wnba.propbetedge.ai is not listed, so this site never loads publisher.js (the SDK always targets the
// current page, which Google would reject); the control deeplinks to the parent source.

import { html } from '../lib/dom.js';

const PARENT_SOURCE = 'propbetedge.ai';
const ELIGIBLE_SOURCES = new Set(['propbetedge.ai', 'mlb.propbetedge.ai', 'ufc.propbetedge.ai']);
const SPORT = 'wnba';

let installed = false;

export function preferredSourceTarget(host = typeof location === 'undefined' ? PARENT_SOURCE : location.hostname) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (ELIGIBLE_SOURCES.has(h)) return { source: h, sdk: true };
  return { source: PARENT_SOURCE, sdk: false };
}

export function preferredSourceDeeplink(source = PARENT_SOURCE) {
  return `https://www.google.com/preferences/source?q=${encodeURIComponent(source)}`;
}

// surface: 'footer' | 'article'. Rendered identically on the server (wnba-web SSR, publish-shell) and the
// client, so the href is the source policy for wnba.propbetedge.ai (the parent), never location-dependent.
export function preferredSourceHtml({ surface = 'footer' } = {}) {
  const href = preferredSourceDeeplink(PARENT_SOURCE);
  const label = 'Add PropBetEdge as a preferred source in Google Search (opens Google)';
  if (surface === 'article') {
    return html`<aside class="pbe-psrc pbe-psrc--article" aria-labelledby="pbe-psrc-article-title">
      <div class="pbe-psrc-copy">
        <strong id="pbe-psrc-article-title">Enjoy PropBetEdge reporting?</strong>
        <span>Make us a preferred source in Google.</span>
      </div>
      <a class="pbe-psrc-btn" href="${href}" target="_blank" rel="noopener" data-pbe-preferred-source data-surface="article" data-sport="${SPORT}" aria-label="${label}">Add PropBetEdge</a>
    </aside>`;
  }
  return html`<div class="pbe-psrc pbe-psrc--footer">
      <div class="pbe-psrc-copy">
        <span class="pbe-psrc-eyebrow">Google Search</span>
        <strong>Make PropBetEdge a preferred source</strong>
        <span>See more PropBetEdge reporting in Google.</span>
      </div>
      <a class="pbe-psrc-btn" href="${href}" target="_blank" rel="noopener" data-pbe-preferred-source data-surface="footer" data-sport="${SPORT}" aria-label="${label}">Add as preferred source</a>
    </div>`;
}

// Idempotent. The href does the navigation; this only records the click.
export function mountPreferredSource({ win = window, doc = document } = {}) {
  if (installed || !doc) return;
  installed = true;
  doc.addEventListener('click', (event) => {
    const el = event.target?.closest?.('[data-pbe-preferred-source]');
    if (!el || typeof win.gtag !== 'function') return;
    win.gtag('event', 'preferred_source_click', {
      surface: el.dataset.surface || 'footer',
      sport: el.dataset.sport || SPORT,
      method: 'deeplink_fallback'
    });
  });
}
