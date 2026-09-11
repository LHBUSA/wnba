// Path router: one route authority per surface. Each page module exports
// mount(root, ctx) and returns an unmount function; the router always calls it
// before mounting the next page, so no poller or listener outlives its page.

export const ROUTES = [
  { id: 'today', re: /^\/$/, load: () => import('../pages/today.js') },
  { id: 'cast', re: /^\/cast(?:\/(\d{6,12}))?$/, keys: ['gameId'], load: () => import('../pages/cast.js') },
  { id: 'props', re: /^\/props$/, load: () => import('../pages/props.js') },
  { id: 'matchups', re: /^\/matchups(?:\/(\d{6,12}))?$/, keys: ['gameId'], load: () => import('../pages/matchups.js') },
  { id: 'players', re: /^\/players$/, load: () => import('../pages/players.js') },
  { id: 'player', re: /^\/players\/(\d{3,12})$/, keys: ['playerId'], load: () => import('../pages/player.js') },
  { id: 'injuries', re: /^\/injuries$/, load: () => import('../pages/injuries.js') },
  { id: 'news', re: /^\/news$/, load: () => import('../pages/news.js') },
  { id: 'news-cat', re: /^\/news\/c\/([a-z]+)$/, keys: ['kind'], load: () => import('../pages/news.js') },
  { id: 'story', re: /^\/news\/story\/(pbe_[a-f0-9]{18})$/, keys: ['storyId'], load: () => import('../pages/story.js') },
  { id: 'article', re: /^\/news\/([a-z0-9-]+-[a-f0-9]{6})$/, keys: ['slug'], load: () => import('../pages/article.js') },
  { id: 'standings', re: /^\/standings$/, load: () => import('../pages/standings.js') },
  { id: 'stats', re: /^\/stats$/, load: () => import('../pages/stats.js') },
  { id: 'teams', re: /^\/teams$/, load: () => import('../pages/teams.js') },
  { id: 'team', re: /^\/teams\/(\d{1,8})$/, keys: ['teamId'], load: () => import('../pages/team.js') },
  { id: 'track-record', re: /^\/track-record$/, load: () => import('../pages/track-record.js') },
  { id: 'pro', re: /^\/pro$/, load: () => import('../pages/pro.js') },
  { id: 'sources', re: /^\/sources$/, load: () => import('../pages/sources.js') }
];

const NOT_FOUND = { id: 'not-found', load: () => import('../pages/not-found.js') };
const SITE = 'https://wnba.propbetedge.ai';
const DEFAULT_DESCRIPTION = 'PropBetEdge WNBA is the independent WNBA intelligence desk: live WNBACast, sourced injuries, matchup context, sportsbook odds, player research and original WNBA newsroom coverage.';
const DEFAULT_IMAGE = `${SITE}/share/propbetedge-wnba-social.png`;

export function resolve(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => { if (m[i + 1]) params[k] = m[i + 1]; });
      return { route: r, params, path };
    }
  }
  return { route: NOT_FOUND, params: {}, path };
}

function meta(selector, value) {
  const node = document.querySelector(selector);
  if (node && value) node.setAttribute('content', value);
}

export function setMeta({ title, description, path, image }) {
  const pageTitle = title ? `${title} · PropBetEdge WNBA` : 'PropBetEdge WNBA — Live WNBA Intelligence';
  const pageDescription = description || DEFAULT_DESCRIPTION;
  const pageUrl = `${SITE}${path === '/' ? '/' : path}`;
  // A page may supply its own share image (a newsroom story's credited og.jpg, on this domain).
  const pageImage = image ? `${SITE}${image}` : DEFAULT_IMAGE;

  document.title = pageTitle;
  meta('meta[name="description"]', pageDescription);

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', pageUrl);

  meta('meta[property="og:title"]', pageTitle);
  meta('meta[property="og:description"]', pageDescription);
  meta('meta[property="og:url"]', pageUrl);
  meta('meta[property="og:image"]', pageImage);
  meta('meta[property="og:image:secure_url"]', pageImage);

  meta('meta[name="twitter:title"]', pageTitle);
  meta('meta[name="twitter:description"]', pageDescription);
  meta('meta[name="twitter:image"]', pageImage);
}

export function createRouter({ outlet, onRoute }) {
  let current = null;
  let token = 0;

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
    if (current?.unmount) { try { current.unmount(); } catch (e) { console.warn(e); } }
    current = null;
    onRoute?.(route.id, path);
    outlet.setAttribute('aria-busy', 'true');
    let mod;
    try {
      mod = await route.load();
    } catch (e) {
      outlet.innerHTML = '<div class="empty err"><h3>Page failed to load</h3><p>Refresh to try again.</p></div>';
      return;
    }
    if (my !== token) return;
    outlet.innerHTML = '';
    const ctx = { params, query, path, go, isCurrent: () => my === token, setMeta: (m) => setMeta({ ...m, path }) };
    setMeta({ title: mod.title?.(params) || null, description: mod.description?.(params), path });
    const unmount = await mod.mount(outlet, ctx);
    if (my !== token) { if (typeof unmount === 'function') unmount(); return; }
    current = { unmount };
    outlet.removeAttribute('aria-busy');
    if (scroll && !location.hash) window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.external !== undefined) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/media/')) return;
    e.preventDefault();
    go(href);
  });
  window.addEventListener('popstate', () => mount(false));
  return { go, mount };
}
