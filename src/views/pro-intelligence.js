import { html } from '../lib/dom.js';
import { PRO_INTELLIGENCE } from '../data/pro-features.js';

export function proFeaturePublicView(feature, { signedIn = false } = {}) {
  const current = feature || PRO_INTELLIGENCE[0];
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
          <div><b>One Pro entitlement</b><span>All premium WNBA intelligence layers are included with WNBA Pro.</span></div>
        </div>
        <div class="pi-actions">
          <a class="btn gold" href="/pro?next=${encodeURIComponent(current.href)}">${signedIn ? 'Upgrade to WNBA Pro' : 'Unlock WNBA Pro'}</a>
          <a class="btn" href="/brief">Read the free Daily Brief</a>
          <a class="sec-link" href="/pbe-picks">Preview PBE Picks →</a>
        </div>
      </div>
      <aside class="pi-suite-card">
        <span class="pi-suite-kicker">WNBA PRO SUITE</span>
        <h2>One subscription. The full intelligence stack.</h2>
        <div class="pi-suite-list">
          ${PRO_INTELLIGENCE.map((f) => html`<a href="${f.href}" class="${f.id === current.id ? 'on' : ''}"><span>${f.name}</span><b>PRO</b></a>`)}
        </div>
        <div class="pi-price"><strong>$9.99</strong><span>/month</span><small>or $3.99/week · cancel anytime</small></div>
      </aside>
    </section>
  `;
}

export function proUnavailableView(feature, message) {
  return html`
    <section class="pi-shell">
      <div class="pi-status-card">
        <span class="eyebrow">${feature?.name || 'WNBA Pro'}</span>
        <h1>Live data temporarily unavailable.</h1>
        <p>${message || 'The latest WNBA Pro snapshot could not be loaded. No substitute or guessed values are shown.'}</p>
        <div class="pi-actions"><a class="btn" href="${feature?.href || '/pro'}">Retry</a><a class="btn gold" href="/pbe-picks">Open PBE Picks</a></div>
      </div>
    </section>`;
}

export function proSuiteRail(currentId = '') {
  return html`<nav class="pi-suite-rail" aria-label="WNBA Pro intelligence suite">
    ${PRO_INTELLIGENCE.map((f) => html`<a href="${f.href}" class="${f.id === currentId ? 'on' : ''}"><span>${f.name}</span><b>PRO</b></a>`)}
    <a href="/brief" class="free"><span>WNBA Daily Brief</span><b>FREE</b></a>
  </nav>`;
}
