import { html, render, raw } from '../lib/dom.js';
import { NETWORK, CURRENT_SPORT } from './network.js';
import { membershipBadgeHtml, ALL_ACCESS_OFFER, ALL_ACCESS_URL } from '../lib/pbe-membership.js';
import { isMember } from '../lib/membership.js';

// Shell revision lets the latest Vercel client reconcile header/footer chrome when the
// publishing Worker is still serving an older SSR shell. Main content is never replaced.
export const SHELL_REV = '2026-09-26.4';

// Desktop header: keep the highest-frequency game/research destinations flat.
// Lower-frequency league/reference destinations live behind one "More" disclosure.
// The drawer (tablet/mobile) still lists every destination.
export const PRIMARY_NAV = [
  ['today', '/', 'Today'],
  ['pbe-picks', '/pbe-picks', 'PBE Picks'],
  ['cast', '/cast', 'WNBACast'],
  ['playoffs', '/playoffs', 'Playoffs'],
  ['props', '/props', 'Props'],
  ['matchups', '/matchups', 'Matchups'],
  ['news', '/news', 'News']
];
export const SECONDARY_NAV = [
  ['daily-brief', '/brief', 'Daily Brief · FREE'],
  ['injuries', '/injuries', 'Injuries'],
  ['players', '/players', 'Players'],
  ['player-load', '/player-load', 'Player Load'],
  ['international', '/international', 'International'],
  ['history', '/history', 'History'],
  ['standings', '/standings', 'Standings'],
  ['stats', '/stats', 'Stats'],
  ['winba-score', '/winba-score', 'WinBA Score'],
  ['teams', '/teams', 'Teams'],
  ['track-record', '/track-record', 'Track Record']
];
export const NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** Route id → the nav group it lights up (sub-pages highlight their section). */
export const NAV_GROUP = { 'pbe-model': 'pbe-picks', 'edge-timeline': 'pbe-picks', 'rotation-impact': 'pbe-picks', 'scenario-lab': 'pbe-picks', watchlist: 'pbe-picks', player: 'players', team: 'teams', story: 'news', article: 'news', 'news-archive': 'news', 'news-cat': 'news', 'news-team': 'news', 'intl-game': 'international', 'intl-team': 'international', 'intl-player': 'international', 'intl-competition': 'international', 'world-cup': 'international' };

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

/** Short header badge for phones; the full label stays in the contract badge and the link's aria-label. */
const SHORT_LABEL = (m) => m.state === 'owner' ? 'OWNER' : m.state === 'all_access' ? 'ALL ACCESS' : m.legacy_tier === 'founding' ? 'FOUNDING' : m.legacy_tier === 'season_pass' ? 'PASS' : 'WNBA PRO';

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
          <a class="btn-aa" href="${ALL_ACCESS_URL}" data-nav="all-access" data-all-access-sell rel="noopener" aria-label="PropBetEdge All Access — every Pro sport, ${ALL_ACCESS_OFFER.price}">ALL ACCESS</a>
          <a class="btn-pro" href="/pro" data-nav="pro">WNBA Pro</a>
          <button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" data-menu>${raw(svg('more'))}</button>
        </div>
      </div>
    </header>
    <div class="drawer" id="drawer" aria-hidden="true" data-shell-rev="${SHELL_REV}">
      <div class="drawer-bg" data-close></div>
      <div class="drawer-panel" role="dialog" aria-label="Menu">
        <div class="drawer-head"><span class="eyebrow">Navigate</span><button class="menu-btn" style="display:inline-flex" type="button" aria-label="Close menu" data-close>✕</button></div>
        <a class="drawer-aa" href="${ALL_ACCESS_URL}" data-nav="all-access" data-all-access-sell rel="noopener">ALL ACCESS <small>${ALL_ACCESS_OFFER.price} · every Pro sport</small></a>
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
            <h3>One call. A full intelligence stack.</h3>
            <p>PBE Picks, Edge Timeline, Player Load, Rotation Impact, Scenario Lab, Watchlist, matchup research and a permanent track record — included with WNBA Pro and PropBetEdge All Access.</p>
            <div class="foot-aa-links">
              <a class="foot-aa-link" href="${ALL_ACCESS_URL}" rel="noopener" data-all-access-sell data-pbe-footer-all-access>ALL ACCESS <b>${ALL_ACCESS_OFFER.price}</b></a>
              <a class="foot-aa-included" href="${ALL_ACCESS_URL}" rel="noopener" data-pbe-footer-all-access-included>WHAT'S INCLUDED →</a>
            </div>
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
            <li><a href="/brief">Daily Brief <span class="foot-pro-mini">FREE</span></a></li>
            <li><a href="/pbe-picks">PBE Picks <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/edge-timeline">Edge Timeline <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/player-load">Player Load <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/rotation-impact">Rotation Impact <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/scenario-lab">Scenario Lab <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/watchlist">Watchlist <span class="foot-pro-mini">PRO</span></a></li>
            <li><a href="/track-record">Track Record</a></li>
          </ul>
        </div>

        <div class="foot-col">
          <h4>Research &amp; Trust</h4>
          <ul>
            <li><a href="/playoffs">Playoffs &amp; bracket</a></li>
            <li><a href="/matchups">Matchups</a></li>
            <li><a href="/injuries">Availability</a></li>
            <li><a href="/pbe-picks/model">PBE methodology</a></li>
            <li><a href="/winba-score">WinBA Score</a></li>
            <li><a href="/methodology">Data methodology</a></li>
            <li><a href="/about">About the newsroom</a></li>
            <li><a href="/editorial-policy">Editorial policy</a></li>
            <li><a href="/corrections">Corrections &amp; revisions</a></li>
          </ul>
        </div>

        <div class="foot-col foot-network-col">
          <h4>PropBetEdge Network</h4>
          <ul class="foot-network-links">
            <li><a class="foot-net-aa" href="${ALL_ACCESS_URL}" rel="noopener" data-all-access-sell>All Access · ${ALL_ACCESS_OFFER.price}</a></li>
            <li><a href="${NETWORK.news.href}">${NETWORK.news.label}</a></li>
            <li><a href="${NETWORK.learn.href}">${NETWORK.learn.label}</a></li>
            <li><a href="${NETWORK.store.href}">${NETWORK.store.label}</a></li>
            <li><a href="https://billing.stripe.com/p/login/cNi3cv2vY7em3lr4oj7wA00" target="_blank" rel="noopener noreferrer">Manage billing ↗</a></li>
            <li><a href="mailto:sales@proptechusa.ai">Contact us</a></li>
            <li><a href="${NETWORK.discord.href}">${NETWORK.discord.label}</a></li>
            <li><a class="foot-x" href="${NETWORK.x.href}" target="_blank" rel="noopener noreferrer" aria-label="${NETWORK.x.title} (${NETWORK.x.label})" title="${NETWORK.x.title}"><span aria-hidden="true">𝕏</span> ${NETWORK.x.label}</a></li>
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

        <p class="foot-note">PropBetEdge WNBA is independent and is not affiliated with, endorsed by or sponsored by the WNBA, its teams or players. Scores, play-by-play, rosters, standings, injury statuses and market snapshots are delivered through PropSports.PropTechUSA.ai; underlying source provenance is documented on the Sources page; external news links open on the publisher's site. Player headshots are hotlinked from WNBA.com and ESPN where available, otherwise Wikimedia Commons images used under their stated licenses with credit on each player page. For entertainment and research — bet responsibly. 21+.</p>
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
  root.querySelector('[data-more-wrap]')?.addEventListener('focusout', (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMore(false); });

  // Membership chrome. The static shell is neutral ("WNBA Pro" + the All Access link), which is exactly the free
  // state, so nothing changes until the server's verdict arrives; members then see their badge (WNBA PRO ACTIVE /
  // ALL ACCESS ACTIVE / OWNER) linking to /pro, the footer stops selling them something they already have, and
  // members who hold the umbrella (ALL ACCESS ACTIVE / OWNER) are never sold All Access anywhere in the chrome.
  const setMembership = (m) => {
    if (!isMember(m)) return;
    if (m.state === 'all_access' || m.state === 'owner') root.querySelectorAll('[data-all-access-sell]').forEach((a) => a.classList.add('aa-sold'));
    for (const a of root.querySelectorAll('a[data-nav="pro"]')) {
      if (a.classList.contains('btn-pro')) {
        a.classList.add('is-member');
        a.setAttribute('aria-label', `${m.label} · your WNBA Pro desk`);
        // Phones (<=480px) show a short badge so brand + badge + menu fit at 320-430 in every state;
        // the full contract badge returns from 481px. The link's aria-label carries the full label.
        a.innerHTML = `${membershipBadgeHtml(m)}<span class="pbe-mbr-badge is-${m.state} pbe-mbr-badge-short" aria-hidden="true">${SHORT_LABEL(m)}</span>`;
      } else {
        a.textContent = m.label;
      }
    }
    const foot = root.querySelector('.foot-pro-cta');
    if (foot) foot.innerHTML = 'Open your WNBA desk <span aria-hidden="true">→</span>';
    const kicker = root.querySelector('.foot-kicker');
    if (kicker) kicker.textContent = `${m.label} · PROPBETEDGE INTELLIGENCE`;
  };
  document.addEventListener('pbe:membership', (e) => setMembership(e.detail));

  return {
    outlet: root.querySelector('main'),
    setMembership,
    setActive(id) {
      const group = NAV_GROUP[id] || id;
      root.querySelectorAll('[data-nav]').forEach((a) => {
        if (a.dataset.nav === group) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      moreBtn?.classList.toggle('on', SECONDARY_NAV.some(([navId]) => navId === group));
    }
  };
}
