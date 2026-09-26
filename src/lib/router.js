// Path router: one route authority per surface. Each page module exports
// mount(root, ctx) and returns an unmount function; the router always calls it
// before mounting the next page, so no poller or listener outlives its page.
//
// Server-visible HTML: the wnba-web publishing Worker renders the requested page into
// <main data-ssr-path> using the same views. On that first load the router mounts the live page
// into a hidden, layout-neutral wrapper and swaps it in only once the page has real content, so the
// reader never flashes from the published story to a skeleton.

import { routeMeta } from '../seo/meta.js';
import { SITE } from '../seo/site.js';
import { ROUTE_TABLE, resolveRoute } from './routes.js';
import { reloadOnceForStaleChunk, installStaleBuildRecovery } from './stale-build.js';

const PAGES = {
  today: () => import('../pages/today.js'),
  cast: () => import('../pages/cast.js'),
  props: () => import('../pages/props.js'),
  matchups: () => import('../pages/matchups.js'),
  players: () => import('../pages/players.js'),
  player: () => import('../pages/player.js'),
  'player-dna': () => import('../pages/player-dna.js'),
  injuries: () => import('../pages/injuries.js'),
  news: () => import('../pages/news.js'),
  'news-archive': () => import('../pages/news-archive.js'),
  'winba-index': () => import('../pages/winba-index.js'),
  'news-cat': () => import('../pages/news.js'),
  'news-team': () => import('../pages/news.js'),
  story: () => import('../pages/story.js'),
  article: () => import('../pages/article.js'),
  history: () => import('../pages/history.js'),
  standings: () => import('../pages/standings.js'),
  playoffs: () => import('../pages/playoffs.js'),
  stats: () => import('../pages/stats.js'),
  teams: () => import('../pages/teams.js'),
  team: () => import('../pages/team.js'),
  'pbe-picks': () => import('../pages/pbe-picks.js'),
  'pbe-model': () => import('../pages/pbe-model.js'),
  'player-load': () => import('../pages/player-load.js'),
  'daily-brief': () => import('../pages/daily-brief.js'),
  'edge-timeline': () => import('../pages/edge-timeline.js'),
  'rotation-impact': () => import('../pages/rotation-impact.js'),
  'scenario-lab': () => import('../pages/scenario-lab.js'),
  watchlist: () => import('../pages/watchlist.js'),
  'track-record': () => import('../pages/track-record.js'),
  pro: () => import('../pages/pro.js'),
  'winba-score': () => import('../pages/winba-score.js'),
  sources: () => import('../pages/sources.js'),
  about: () => import('../pages/trust.js'),
  'editorial-policy': () => import('../pages/trust.js'),
  corrections: () => import('../pages/trust.js'),
  methodology: () => import('../pages/trust.js'),
  international: () => import('../pages/international.js'),
  'intl-game': () => import('../pages/international.js'),
  'intl-team': () => import('../pages/international.js'),
  'intl-player': () => import('../pages/international.js'),
  'intl-competition': () => import('../pages/international.js'),
  'world-cup': () => import('../pages/international.js'),
  'not-found': () => import('../pages/not-found.js')
};

export const ROUTES = ROUTE_TABLE.map((r) => ({ ...r, load: PAGES[r.id] }));

export function resolve(pathname) {
  const { id, params, path } = resolveRoute(pathname);
  return { route: { id, load: PAGES[id] }, params, path };
}

function meta(selector, value) {
  const node = document.querySelector(selector);
  if (node && value) node.setAttribute('content', value);
}

/** Apply a routeMeta() result (src/seo/meta.js) on client-side navigation. */
export function setMeta(m) {
  document.title = m.title;
  meta('meta[name="description"]', m.description);
  meta('meta[name="robots"]', m.robots);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', m.url || `${SITE}${m.path}`);
  meta('meta[property="og:type"]', m.type);
  meta('meta[property="og:title"]', m.title);
  meta('meta[property="og:description"]', m.description);
  meta('meta[property="og:url"]', m.url);
  meta('meta[property="og:image"]', m.image?.url);
  meta('meta[property="og:image:secure_url"]', m.image?.url);
  meta('meta[property="og:image:alt"]', m.image?.alt);
  meta('meta[name="twitter:title"]', m.title);
  meta('meta[name="twitter:description"]', m.description);
  meta('meta[name="twitter:image"]', m.image?.url);
  meta('meta[name="twitter:image:alt"]', m.image?.alt);
}

const SSR_MAX_WAIT_MS = 10000;

/** Resolve when the live page has painted real content (no skeleton left) or after a ceiling. */
function whenPainted(el) {
  const ready = () => el.childElementCount > 0 && !el.querySelector('.skel');
  if (ready()) return Promise.resolve();
  return new Promise((resolveReady) => {
    const done = () => { obs.disconnect(); clearTimeout(t); resolveReady(); };
    const obs = new MutationObserver(() => { if (ready()) done(); });
    const t = setTimeout(done, SSR_MAX_WAIT_MS);
    obs.observe(el, { childList: true, subtree: true });
  });
}

export function createRouter({ outlet, onRoute, onMounted }) {
  if (typeof window !== 'undefined') installStaleBuildRecovery(window); // vite:preloadError -> reload once
  let current = null;
  let token = 0;
  let firstMount = true;

  async function go(url, { replace = false, scroll = true } = {}) {
    const u = new URL(url, location.origin);
    if (u.origin !== location.origin) { location.href = u.href; return; }
    if (replace) history.replaceState({}, '', u.pathname + u.search + u.hash);
    else if (u.pathname + u.search !== location.pathname + location.search) history.pushState({}, '', u.pathname + u.search + u.hash);
    await mount(scroll);
  }

  async function mount(scroll = true) {
    const my = ++token;
    const { route, params, path } = resolve(location.pathname);
    const query = Object.fromEntries(new URLSearchParams(location.search));
    const adopt = firstMount && outlet.dataset.ssrPath === path && outlet.childElementCount > 0;
    firstMount = false;
    delete outlet.dataset.ssrPath;
    if (current?.unmount) { try { current.unmount(); } catch (e) { console.warn(e); } }
    current = null;
    onRoute?.(route.id, path);
    outlet.setAttribute('aria-busy', 'true');
    let mod;
    try {
      mod = await route.load();
    } catch (e) {
      if (reloadOnceForStaleChunk(e)) return; // tab spans a deploy: old hashed chunk is gone -> reload once
      outlet.innerHTML = '<div class="empty err"><h3>Page failed to load</h3><p>Refresh to try again.</p></div>';
      return;
    }
    if (my !== token) return;
    let root = outlet;
    if (adopt) {
      root = document.createElement('div');
      root.className = 'ssr-live';
      root.hidden = true;
      outlet.append(root);
    } else {
      outlet.innerHTML = '';
      document.querySelector('script[data-ld="page"]')?.remove();
      setMeta(routeMeta(route.id, { path, params }));
    }
    const ctx = { params, query, path, routeId: route.id, go, isCurrent: () => my === token, setMeta: (m) => { if (!adopt) setMeta(m); } };
    const mounted = mod.mount(root, ctx);
    if (adopt) {
      await whenPainted(root);
      if (my === token) {
        for (const n of [...outlet.childNodes]) if (n !== root) n.remove();
        root.hidden = false;
      }
    }
    const unmount = await mounted;
    if (my !== token) { if (typeof unmount === 'function') unmount(); return; }
    current = { unmount };
    outlet.removeAttribute('aria-busy');
    onMounted?.({ routeId: route.id, path, params, query });
    if (scroll && !location.hash && !adopt) window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.external !== undefined) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/media/') || /\.(xml|png|jpg|txt)$/.test(href)) return;
    e.preventDefault();
    go(href);
  });
  window.addEventListener('popstate', () => mount(false));
  return { go, mount };
}
