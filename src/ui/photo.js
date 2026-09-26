// Player photo fallback chain for API photos (workers/wnba-api/src/photos.js).
//
// A photo may carry `sources`: hotlinked WNBA/ESPN headshots (external_editorial)
// followed by the self-hosted Commons crop (licensed). The <img> starts on the
// first source; when it fails, one capture-phase error listener swaps to the
// next, and after the last one replaces the image with the sibling
// <template data-photo-fallback> (the initials avatar/card). CSP forbids inline
// onerror handlers, hence the single delegated listener.
//
// cdn.wnba.com answers an unknown id with HTTP 200 and a generic silhouette, which
// never fires `error`. Its 1040x760 portrait silhouette is 1094x800, so a WNBA
// portrait carries data-photo-guard="1040x760" and a load of any other size is
// treated as a failure. (The 260x190 square silhouette has the real size; square
// ids are only shipped after s11_provider_ids.mjs verified the live image.)

import { html, raw } from '../lib/dom.js';

/** Ordered, de-duplicated [{ url, source }] for a variant ('square' | 'portrait'). Legacy photos are a one-entry chain. */
export function photoChain(photo, variant = 'square') {
  const list = photo?.sources?.length ? photo.sources : photo ? [photo] : [];
  const seen = new Set();
  const out = [];
  for (const source of list) {
    const url = source?.[variant];
    if (url && !seen.has(url)) { seen.add(url); out.push({ url, source }); }
  }
  return out;
}

/** The rights-reviewed Commons photo only, never a hotlink. Photos without `sources` predate providers and were always Commons. */
export function licensedPhoto(photo) {
  if (!photo) return null;
  if (photo.sources) return photo.licensed || null;
  return photo.rights === 'external_editorial' ? null : photo;
}

/**
 * <img> for a photo chain plus its exhausted-chain fallback markup. `attrs` is a
 * trusted attribute string (sizes, loading, class); `fallback` is html`` markup.
 * Returns '' when the chain is empty so callers can branch on it.
 */
export function photoImg(photo, variant, { alt = '', attrs = '', fallback = '' } = {}) {
  const chain = photoChain(photo, variant);
  if (!chain.length) return '';
  const next = chain.slice(1).map((c) => c.url).join(' ');
  const guard = variant === 'portrait' ? photoGuard(chain[0].source) : '';
  return html`<img src="${chain[0].url}" alt="${alt}" ${raw(attrs)} data-photo-next="${next}" data-photo-stage="0"${guard ? raw(` data-photo-guard="${guard}"`) : ''} /><template data-photo-fallback>${fallback}</template>`;
}

/** Expected natural size ("WxH") for a portrait source whose provider hides misses behind a 200, else ''. */
export function photoGuard(source) {
  return source?.provider === 'wnba' && source.width && source.height ? `${source.width}x${source.height}` : '';
}

/**
 * Credit lines for every stage of the chain; only the active one is visible.
 * `line(source)` renders one credit; `none` renders the no-photo note.
 */
export function photoCredits(photo, variant, line, none) {
  const chain = photoChain(photo, variant);
  return html`${chain.map((c, i) => html`<span data-photo-credit="${i}" ${i ? raw('hidden') : ''}>${line(c.source)}</span>`)}<span data-photo-credit="${chain.length}" ${chain.length ? raw('hidden') : ''}>${none}</span>`;
}

function showStage(el, stage) {
  const root = el.closest('[data-photo-root]');
  if (!root) return;
  for (const c of root.querySelectorAll('[data-photo-credit]')) c.hidden = Number(c.getAttribute('data-photo-credit')) !== stage;
}

let installed = false;

/** Install the one document-level image error handler. Idempotent. */
export function installPhotoFallback(doc = document) {
  if (installed) return;
  installed = true;
  const advance = (el) => {
    el.removeAttribute('data-photo-guard'); // only the first (WNBA) stage is guarded
    const next = el.getAttribute('data-photo-next').split(' ').filter(Boolean);
    const stage = Number(el.getAttribute('data-photo-stage') || 0) + 1;
    el.setAttribute('data-photo-stage', String(stage));
    showStage(el, stage);
    if (next.length) {
      el.setAttribute('data-photo-next', next.slice(1).join(' '));
      if (el.tagName.toLowerCase() === 'image') el.setAttribute('href', next[0]);
      else el.setAttribute('src', next[0]);
      return;
    }
    el.removeAttribute('data-photo-next');
    const tpl = el.nextElementSibling;
    if (tpl && tpl.tagName.toLowerCase() === 'template' && tpl.hasAttribute('data-photo-fallback')) {
      el.replaceWith(tpl.content.cloneNode(true));
      tpl.remove();
    } else {
      el.remove();
    }
  };
  const chained = (el) => el && typeof el.getAttribute === 'function' && el.hasAttribute('data-photo-next');
  doc.addEventListener('error', (e) => { if (chained(e.target)) advance(e.target); }, true);
  doc.addEventListener('load', (e) => {
    const el = e.target;
    if (!chained(el) || !el.hasAttribute('data-photo-guard')) return;
    const [w, h] = el.getAttribute('data-photo-guard').split('x').map(Number);
    if (el.naturalWidth && (el.naturalWidth !== w || el.naturalHeight !== h)) advance(el);
    else el.removeAttribute('data-photo-guard');
  }, true);
}
