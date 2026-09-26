// Share actions — one component for every customer-facing share surface: X · LinkedIn · Copy.
//
// Every action carries the page's CANONICAL URL (src/seo/site.js canonicalPath on SITE): never the current
// address bar, so transient state (?scope=, ?vs=, utm_*, #fragments) is never shared or copied. The X intent
// names @PROPBETEDGE through `via`. X and LinkedIn are plain links (they work without JavaScript); Copy is
// progressive enhancement bound once by bindShareActions(). No other networks, no third-party scripts.

import { html, raw } from '../lib/dom.js';
import { SITE, canonicalPath } from '../seo/site.js';

export const X_INTENT = 'https://x.com/intent/post';
export const LINKEDIN_SHARE = 'https://www.linkedin.com/sharing/share-offsite/';
const X_VIA = 'PROPBETEDGE';

/** Absolute canonical URL for a site path: no query, no hash, no trailing slash. */
export const canonicalUrl = (path) => {
  const p = canonicalPath(String(path || '/').replace(/^https?:\/\/[^/]+/i, ''));
  return `${SITE}${p === '/' ? '/' : p}`;
};

export function shareLinks({ path, title }) {
  const url = canonicalUrl(path);
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  const q = new URLSearchParams({ text: t, url, via: X_VIA });
  return {
    url,
    x: `${X_INTENT}?${q.toString()}`,
    linkedin: `${LINKEDIN_SHARE}?${new URLSearchParams({ url }).toString()}`
  };
}

const X_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.72H5.58L16.67 19.2Z"/></svg>';
const IN_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3v-11Zm6.5 0h3.83v1.5h.05c.53-1 1.84-2.06 3.79-2.06 4.05 0 4.8 2.67 4.8 6.13v5.43h-4v-4.82c0-1.15-.02-2.63-1.6-2.63-1.6 0-1.85 1.25-1.85 2.55v4.9h-4v-11Z"/></svg>';
const COPY_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 9h10v11H9zM5 15V4h10"/></svg>';

/**
 * @param {{ path: string, title: string, label?: string }} o  path = the page's own path; title = headline / page title
 */
export function shareBar({ path, title, label = 'Share' }) {
  const s = shareLinks({ path, title });
  return html`<div class="share-bar" role="group" aria-label="${label}">
    <span class="share-bar__label">${label}</span>
    <a class="share-btn" href="${s.x}" target="_blank" rel="noopener noreferrer" aria-label="Share on X">${raw(X_GLYPH)}<span>X</span></a>
    <a class="share-btn" href="${s.linkedin}" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">${raw(IN_GLYPH)}<span>LinkedIn</span></a>
    <button class="share-btn" type="button" data-share-copy="${s.url}" aria-label="Copy link">${raw(COPY_GLYPH)}<span data-share-copy-label>Copy</span></button>
  </div>`;
}

/** Delegated Copy handler (one listener for every share bar, including ones rendered after navigation). */
export function bindShareActions(doc = document) {
  if (doc.__pbeShareBound) return;
  doc.__pbeShareBound = true;
  doc.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('[data-share-copy]');
    if (!btn) return;
    e.preventDefault();
    const url = btn.getAttribute('data-share-copy');
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* fall through */ }
    if (!ok) {
      try {
        const ta = doc.createElement('textarea');
        ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        doc.body.appendChild(ta); ta.select(); ok = doc.execCommand('copy'); ta.remove();
      } catch { ok = false; }
    }
    const lbl = btn.querySelector('[data-share-copy-label]');
    if (lbl) {
      lbl.textContent = ok ? 'Copied' : 'Copy failed';
      btn.classList.toggle('is-copied', ok);
      clearTimeout(btn.__t);
      btn.__t = setTimeout(() => { lbl.textContent = 'Copy'; btn.classList.remove('is-copied'); }, 1800);
    }
  });
}

