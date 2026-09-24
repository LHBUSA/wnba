import { html, raw } from '../lib/dom.js';
import { PRO_INTELLIGENCE } from '../data/pro-features.js';
import { allAccessCardHtml } from '../lib/pbe-membership.js';
import { membershipFrom } from '../lib/membership.js';

/** Public (non-member) view. `membership` is the server's verdict when a page has it; the SSR/static fallback is FREE.
 *  Members never see this view, so the All Access card beneath the WNBA CTA is always the free-state card. */
export function proFeaturePublicView(feature, { signedIn = false, membership = null } = {}) {
  const current = feature || PRO_INTELLIGENCE[0];
  const m = membership || membershipFrom(null);
  return html`
    <section class="pi-public">
      <div class="pi-public-copy">
        <span class="eyebrow">WNBA Pro · ${current.eyebrow}</span>
        <h1>${current.name}</h1>
        <p class="lead">${current.short}</p>
        <div class="pi-value-grid">
          <div><b>Live WNBA context</b><span>Built from the same owned WNBA data layer that powers PBE Picks, matchups, availability and Player Load.</span></div>
          <div><b>Internal research links</b><span>Move from a signal into teams, matchups, players, methodology and the permanent track record without leaving the desk.</span></div>
          <div><b>Transparent by design</b><span>Derived signals are labeled for what they are. No invented certainty and no protected values hidden in public HTML.</span></div>
          <div><b>One membership</b><span>Every premium WNBA intelligence layer is included with WNBA Pro and with PropBetEdge All Access.</span></div>
        </div>
        <div class="pi-actions">
          <a class="btn gold" href="/pro?next=${encodeURIComponent(current.href)}">${signedIn ? 'Upgrade to WNBA Pro' : 'Unlock WNBA Pro'}</a>
          <a class="btn" href="/brief">Read the free Daily Brief</a>
          <a class="sec-link" href="/pbe-picks">Preview PBE Picks →</a>
        </div>
        ${raw(allAccessCardHtml(m, { compact: true }))}
      </div>
      <aside class="pi-suite-card">
        <span class="pi-suite-kicker">WNBA PRO SUITE</span>
        <h2>One membership. The full intelligence stack.</h2>
        <div class="pi-suite-list">
          ${PRO_INTELLIGENCE.map((f) => html`<a href="${f.href}" class="${f.id === current.id ? 'on' : ''}"><span>${f.name}</span><b>PRO</b></a>`)}
        </div>
        <div class="pi-price"><strong>$9.99</strong><span>/month</span><small>or $3.99/week · cancel anytime</small></div>
      </aside>
    </section>
  `;
}

export function proUnavailableView(feature, message) {
  const current = feature || PRO_INTELLIGENCE[0];
  return html`
    <section class="pi-shell pi-unavailable-shell">
      ${proSuiteRail(current.id)}
      <header class="pi-hero pi-unavailable-hero">
        <div>
          <span class="eyebrow">WNBA Pro · ${current.eyebrow}</span>
          <h1>${current.name}</h1>
          <p class="lead">${current.short}</p>
        </div>
        <aside>
          <span>LIVE DATA STATUS</span>
          <b>—</b>
          <small>Snapshot unavailable</small>
          <em>No guessed values shown</em>
        </aside>
      </header>

      <div class="pi-status-card">
        <span class="eyebrow">Live data temporarily unavailable</span>
        <h2>The intelligence surface is still here.</h2>
        <p>${message || 'The latest WNBA Pro snapshot could not be loaded. No substitute or guessed values are shown.'}</p>
        <div class="pi-actions"><a class="btn" href="${current.href || '/pro'}">Retry live data</a><a class="btn gold" href="/pbe-picks">Open PBE Picks</a></div>
      </div>

      <div class="pi-value-grid">
        <div><b>What this measures</b><span>${current.pitch || current.short}</span></div>
        <div><b>Source-grounded only</b><span>When the live snapshot is unavailable, PropBetEdge does not invent replacement values or silently reuse unrelated data.</span></div>
        <div><b>Connected research</b><span>Use PBE Picks, Player Load, Matchups, Availability and the permanent Track Record while this live layer refreshes.</span></div>
        <div><b>Automatic recovery</b><span>The Cloudflare data lane continues rebuilding the latest snapshot in the background; the page becomes live again when a valid snapshot is available.</span></div>
      </div>

      <section class="pi-explain">
        <h2>About ${current.name}</h2>
        <p>${current.pitch || current.short}</p>
      </section>
    </section>`;
}

export function proSuiteRail(currentId = '') {
  return html`<nav class="pi-suite-rail" aria-label="WNBA Pro intelligence suite">
    ${PRO_INTELLIGENCE.map((f) => html`<a href="${f.href}" class="${f.id === currentId ? 'on' : ''}"><span>${f.name}</span><b>PRO</b></a>`)}
    <a href="/brief" class="free"><span>WNBA Daily Brief</span><b>FREE</b></a>
  </nav>`;
}
