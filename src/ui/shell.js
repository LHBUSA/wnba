import { html, render, raw } from '../lib/dom.js';
import { NETWORK, CURRENT_SPORT } from './network.js';

// Shell revision lets the latest Vercel client reconcile header/footer chrome when the
// publishing Worker is still serving an older SSR shell. Main content is never replaced.
export const SHELL_REV = '2026-09-16.4';

// Desktop header: keep the highest-frequency game/research destinations flat.
// Lower-frequency league/reference destinations live behind one "More" disclosure.
// The drawer (tablet/mobile) still lists every destination.
export const PRIMARY_NAV = [
  ['today', '/', 'Today'],
  ['pbe-picks', '/pbe-picks', 'PBE Picks'],
  ['cast', '/cast', 'WNBACast'],
  ['props', '/props', 'Props'],
  ['matchups', '/matchups', 'Matchups'],
  ['injuries', '/injuries', 'Injuries'],
  ['news', '/news', 'News'],
  ['international', '/international', 'International']
];
export const SECONDARY_NAV = [
  ['players', '/players', 'Players'],
  ['history', '/history', 'History'],
  ['standings', '/standings', 'Standings'],
  ['stats', '/stats', 'Stats'],
  ['teams', '/teams', 'Teams'],
  ['track-record', '/track-record', 'Track Record']
];
export const NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** Route id → the nav group it lights up (sub-pages highlight their section). */
export const NAV_GROUP = { 'pbe-model': 'pbe-picks', player: 'players', team: 'teams', story: 'news', article: 'news', 'news-cat': 'news', 'news-team': 'news', 'intl-game': 'international', 'intl-team': 'international', 'intl-player': 'international', 'intl-competition': 'international', 'world-cup': 'international' };

const ICON = {
  today: '<path d="M4 5h16v15H4zM4 9h16M9 3v4M15 3v4" />',
  cast: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4v16M7 6.5c3 3 3 8 0 11M17 6.5c-3 3-3 8 0 11"/>',
  props: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  news: '<path d="M5 4h11v16H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1zM16 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3"/>',
  more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  pbe: '<path d="M4 19h16"/><path d="M6 16l4-5 3 3 5-7"/><circle cx="18" cy="7" r="1.6"/>'
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1c1813"/><circle cx="32" cy="32" r="19" fill="none" stroke="#d4af37" stroke-width="3.5"/><path d="M13 32h38M32 13v38M19 18c7 6 7 22 0 28M45 18c-7 6-7 22 0 28" fill="none" stroke="#ff7a2f" stroke-width="2.6" stroke-linecap="round"/></svg>`;

const MOTHER_VERIFY_URL = 'https://mother.proptechusa.ai/verify/xgH9unhpY6TDvTtmG8CsUWrq0O6M10TS';
// Same-origin passthrough to Mother AI's official live SVG. Vercel proxies this path to
// api.mother.proptechusa.ai so the badge remains stateful/verifiable without weakening CSP.
const MOTHER_BADGE_URL = '/mother-ai-protected.svg';

/** The site shell as HTML. `main` is the page content (server-rendered by the publishing Worker); `ssrPath` marks it. */
export function shellHtml({ main = '', ssrPath = null } = {}) {
  return html`
    <header class="hdr" data-shell-rev="${SHELL_REV}">
      <div class="hdr-in">
        <a class="brand" href="/" aria-label="PropBetEdge WNBA home">
          ${raw(BRAND_MARK)}
          <span class="brand-txt"><b>PropBetEdge <span>WNBA</span></b><small>WNBA intelligence desk</small></span>
        </a>
        <nav class="nav" aria-label="Primary">
          ${PRIMARY_NAV.map(([id, href, label]) => id === 'pbe-picks'
            ? html`<a href="${href}" data-nav="${id}" class="nav-pbe">${label}<span class="nav-pro" aria-label="WNBA Pro">PRO</span></a>`
            : html`<a href="${href}" data-nav="${id}" class="${id === 'cast' ? 'cast-link' : ''}">${label}</a>`)}
          <div class="nav-more" data-more-wrap>
            <button class="nav-more-btn" type="button" aria-expanded="false" aria-controls="nav-more-menu" data-more>More<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <div class="nav-more-menu" id="nav-more-menu" hidden>
              ${SECONDARY_NAV.map(([id, href, label]) => html`<a href="${href}" data-nav="${id}">${label}</a>`)}
            </div>
          </div>
        </nav>
        <div class="hdr-actions">
          <a class="btn-pro" href="/pro" data-nav="pro">WNBA Pro</a>
          <button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" data-menu>${raw(svg('more'))}</button>
        </div>
      </div>
    </header>
    <div class="drawer" id="drawer" aria-hidden="true" data-shell-rev="${SHELL_REV}">
      <div class="drawer-bg" data-close></div>
      <div class="drawer-panel" role="dialog" aria-label="Menu">
        <div class="drawer-head"><span class="eyebrow">Navigate</span><button class="menu-btn" style="display:inline-flex" type="button" aria-label="Close menu" data-close>✕</button></div>
        ${NAV.map(([id, href, label]) => html`<a href="${href}" data-nav="${id}">${label}</a>`)}
        <a href="/pro" data-nav="pro">WNBA Pro</a>
      </div>
    </div>
    <main id="main" tabindex="-1" ${ssrPath ? html`data-ssr-path="${ssrPath}"` : ''}>${main}</main>
    <footer class="foot" data-shell-rev="${SHELL_REV}">
      <div class="foot-in foot-world">
        <section class="foot-pro-panel" aria-label="WNBA Pro">
          <div class="foot-pro-copy">
            <span class="foot-kicker">WNBA PRO · PROPBETEDGE INTELLIGENCE</span>
            <h3>Go deeper than the box score.</h3>
            <p>Live PBE Picks, matchup intelligence, model context and a permanent track record — built for people who want the research layer behind every game.</p>
          </div>
          <a class="foot-pro-cta" href="/pro">Get WNBA Pro <span aria-hidden="true">→</span></a>
        </section>

        <div class="foot-brand-col">
          <a class="brand" href="/" aria-label="PropBetEdge WNBA home">${raw(BRAND_MARK)}<span class="brand-txt"><b>PropBetEdge <span>WNBA</span></b><small>Independent WNBA intelligence</small></span></a>
          <p class="note foot-brand-note">Built from real WNBA source data with visible source and freshness on volatile numbers. Sportsbook prices, market consensus and PropBetEdge model outputs stay clearly separated.</p>
          <div class="foot-trust-chips" aria-label="PropBetEdge WNBA trust principles">
            <span>Independent</span><span>Source-linked</span><span>Auditable</span>
          </div>
        </div>

        <div class="foot-col">
          <h4>WNBA Intelligence</h4>
          <ul>
            <li><a href="/">Today</a></li>
            <li><a href="/pbe-picks">PBE Picks <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/cast">WNBACast</a></li>
            <li><a href="/matchups">Matchups</a></li>
            <li><a href="/news">News</a></li>
            <li><a href="/history">WNBA History</a></li>
            <li><a href="/track-record">Track Record</a></li>
          </ul>
        </div>

        <div class="foot-col">
          <h4>Research &amp; Trust</h4>
          <ul>
            <li><a href="/methodology">Methodology</a></li>
            <li><a href="/about">About the newsroom</a></li>
            <li><a href="/editorial-policy">Editorial policy</a></li>
            <li><a href="/corrections">Corrections &amp; revisions</a></li>
            <li><a href="/rss.xml">Newsroom RSS</a></li>
          </ul>
        </div>

        <div class="foot-col foot-network-col">
          <h4>PropBetEdge Network</h4>
          <ul class="foot-network-links">
            <li><a href="${NETWORK.news.href}">${NETWORK.news.label}</a></li>
            <li><a href="${NETWORK.store.href}">${NETWORK.store.label}</a></li>
            <li><a href="${NETWORK.discord.href}">${NETWORK.discord.label}</a></li>
          </ul>
          <div class="sports-rail" aria-label="PropBetEdge sports network">
            ${NETWORK.sports.map((s) => html`<a href="${s.href}" class="${s.key === CURRENT_SPORT ? 'here' : ''}" ${s.key === CURRENT_SPORT ? raw('aria-current="true"') : ''} title="${s.name}">${s.label}</a>`)}
          </div>
          <p class="note foot-network-note">One research network across the major sports desks.</p>
        </div>

        <div class="foot-security">
          <a class="foot-mother-badge" href="${MOTHER_VERIFY_URL}" target="_blank" rel="noopener noreferrer" aria-label="Verify PropTechUSA.ai Mother AI protection status (opens in a new tab)">
            <img src="${MOTHER_BADGE_URL}" alt="Mother AI Protected — AI Controls Active" width="236" height="48" loading="lazy" decoding="async" />
          </a>
          <div class="foot-security-copy">
            <strong>Mother AI Protected</strong>
            <span>Live verification for the PropTechUSA.ai network security layer.</span>
            <a href="${MOTHER_VERIFY_URL}" target="_blank" rel="noopener noreferrer">Verify protection status →</a>
          </div>
        </div>

        <p class="foot-note">PropBetEdge WNBA is independent and is not affiliated with, endorsed by or sponsored by the WNBA, its teams or players. Scores, play-by-play, rosters, standings and injury statuses are sourced from ESPN's public data; sportsbook prices from The Odds API; external news links open on the publisher's site. Player photos are Wikimedia Commons images used under their stated licenses with credit on each player page. For entertainment and research — bet responsibly. 21+.</p>
      </div>
    </footer>
    <nav class="mnav" aria-label="Primary mobile" data-shell-rev="${SHELL_REV}">
      <a href="/" data-nav="today">${raw(svg('today'))}Today</a>
      <a href="/cast" data-nav="cast">${raw(svg('cast'))}Cast</a>
      <a href="/pbe-picks" data-nav="pbe-picks" class="mnav-pbe">${raw(svg('pbe'))}<span>PBE<sup>PRO</sup></span></a>
      <a href="/props" data-nav="props">${raw(svg('props'))}Props</a>
      <a href="/news" data-nav="news">${raw(svg('news'))}News</a>
      <a href="#menu" data-menu>${raw(svg('more'))}More</a>
    </nav>
  `;
}

function reconcileChrome(root) {
  const header = root.querySelector('header.hdr');
  if (!header || header.dataset.shellRev === SHELL_REV) return;

  const staging = document.createElement('div');
  render(staging, shellHtml());
  for (const selector of ['header.hdr', '#drawer', 'footer.foot', 'nav.mnav']) {
    const current = root.querySelector(selector);
    const fresh = staging.querySelector(selector);
    if (current && fresh) current.replaceWith(fresh);
  }
}

export function mountShell(root) {
  // The SSR Worker can lag a Vercel frontend deployment. If its shell chrome is old,
  // replace only header/drawer/footer/mobile-nav from the latest client bundle and keep
  // the server-rendered <main> intact. This prevents live data from masking stale chrome.
  if (!root.querySelector('header.hdr') || !root.querySelector('#main')) render(root, shellHtml());
  else reconcileChrome(root);

  const drawer = root.querySelector('#drawer');
  const open = (v) => {
    drawer.classList.toggle('open', v);
    drawer.setAttribute('aria-hidden', String(!v));
    root.querySelectorAll('[data-menu]').forEach((b) => b.setAttribute('aria-expanded', String(v)));
  };
  // Desktop "More" disclosure: click to toggle, Escape or an outside click closes, choosing a link closes.
  const moreBtn = root.querySelector('[data-more]');
  const moreMenu = root.querySelector('#nav-more-menu');
  const setMore = (v, { focusButton = false } = {}) => {
    if (!moreBtn || !moreMenu) return;
    moreBtn.setAttribute('aria-expanded', String(v));
    moreMenu.hidden = !v;
    if (!v && focusButton) moreBtn.focus();
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { e.preventDefault(); setMore(moreBtn.getAttribute('aria-expanded') !== 'true'); return; }
    if (e.target.closest('#nav-more-menu a')) setMore(false);
    if (e.target.closest('[data-menu]')) { e.preventDefault(); open(true); return; }
    if (e.target.closest('[data-close]')) { open(false); return; }
    if (e.target.closest('.drawer a')) open(false);
  });
  document.addEventListener('click', (e) => { if (moreBtn && !e.target.closest('[data-more-wrap]')) setMore(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (moreBtn?.getAttribute('aria-expanded') === 'true') setMore(false, { focusButton: true });
    open(false);
  });
  // Keyboard users who tab out of the open menu leave it closed behind them.
  root.querySelector('[data-more-wrap]')?.addEventListener('focusout', (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMore(false); });

  return {
    outlet: root.querySelector('main'),
    setActive(id) {
      const group = NAV_GROUP[id] || id;
      root.querySelectorAll('[data-nav]').forEach((a) => {
        if (a.dataset.nav === group) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      // A destination inside "More" lights up the More control itself.
      moreBtn?.classList.toggle('on', SECONDARY_NAV.some(([navId]) => navId === group));
    }
  };
}
