// Article Market module for WNBA news (contract article-market/1; propbetedge-workers
// docs/POST_EVENT_MARKET_RESULT.md). ONE module with a lifecycle on an article linked to ONE game:
// LIVE MARKET WATCH while the market trades -> THE MARKET RESULT once the game is over.
//
// - Link = the article's single `game` entity (the ESPN event id the WNBA product and the propsports-markets wnba
//   lane both key games by). Never a title match; an article naming two games has no single event -> no module.
// - Prospective only (owner 2026-10-04, NO BACKFILL): the shared API refuses articles first published before its
//   activation time. ACTIVATED_AT below only saves a request for older stories; the API stays the authority.
// - published_at = the ORIGINAL first publication (first_published_at). Revisions never move the market baseline;
//   a story without a recorded first publication gets no module.
// - Read from the owned markets Worker (MARKETS_BASE, already in the CSP like every WNBA market read). Never Kalshi
//   or Polymarket directly.
// - Nothing eligible / nothing observed / a failed read -> nothing rendered (never a placeholder).
import { articleMarketModule, mountArticleMarket } from '../vendor/kalshi/article-market-ui.js';
import { MARKETS_BASE, within } from './kalshi.js';

export const ARTICLE_MARKET_ACTIVATED_AT = '2026-10-04T14:31:40Z';
export const ARTICLE_MARKET_REFRESH_MS = 30_000;
export const ARTICLE_MARKET_FIRST_PAINT_MS = 800;
const BASE = String(MARKETS_BASE).replace(/\/+$/, '');

/** { id, publishedAt } of an eligible article, else null. */
export function articleMarketEvent(a) {
  const publishedAt = a?.first_published_at || null;
  const pub = Date.parse(publishedAt || '');
  if (!Number.isFinite(pub) || pub < Date.parse(ARTICLE_MARKET_ACTIVATED_AT)) return null;
  const games = (a?.entities || []).filter((e) => e && e.type === 'game');
  if (games.length !== 1) return null;
  const id = String(games[0].id ?? '');
  return /^\d{6,12}$/.test(id) ? { id, publishedAt } : null;
}

export async function loadArticleMarket(id, publishedAt, fetchImpl = (...x) => globalThis.fetch(...x)) {
  try {
    const r = await fetchImpl(`${BASE}/v1/article-market/wnba/${encodeURIComponent(id)}?published_at=${encodeURIComponent(publishedAt)}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const body = await r.json();
    return body?.eligible ? body : null;
  } catch { return null; }
}

/** Load-time read bounded by the first-paint budget. { now, pending }: pending = the still-running read. */
export async function articleMarketWithin(a, ms = ARTICLE_MARKET_FIRST_PAINT_MS, fetchImpl) {
  const ev = articleMarketEvent(a);
  if (!ev) return { now: null, pending: null };
  const p = loadArticleMarket(ev.id, ev.publishedAt, fetchImpl);
  const now = await within(p, ms);
  return { now: now === undefined ? null : now, pending: now === undefined ? p : null };
}

export const articleMarketHtml = (payload) => (payload ? articleMarketModule(payload, { placement: 'wnba-article' }) : '');

/** The in-body slot: only on an eligible article (pre-activation / unlinked -> '' — nothing at all). */
export function articleMarketSlot(a, mk) {
  return articleMarketEvent(a) ? `<div class="art-market" data-art-market>${articleMarketHtml(mk?.now)}</div>` : '';
}

/**
 * Mount on the rendered article. First paint already holds the module when the read beat the budget; a late answer
 * is inserted only while its slot is below the viewport (no visible layout shift), then refreshes ~30 s while visible.
 */
export function mountArticleMarketSlot(root, a, { now = null, pending = null } = {}) {
  const slot = root.querySelector('[data-art-market]');
  const ev = articleMarketEvent(a);
  if (!slot || !ev) return () => {};
  const start = (initial) => mountArticleMarket(slot, { base: BASE, sport: 'wnba', eventId: ev.id, publishedAt: ev.publishedAt, initial, refreshMs: ARTICLE_MARKET_REFRESH_MS });
  if (now) return start(now);
  if (!pending) return () => {};
  let stop = () => {};
  let dead = false;
  pending.then((late) => {
    if (dead || !late || !slot.isConnected) return;
    if (slot.getBoundingClientRect().top < window.innerHeight) return; // would shift what the reader sees: skip
    stop = start(late);
  });
  return () => { dead = true; stop(); };
}
