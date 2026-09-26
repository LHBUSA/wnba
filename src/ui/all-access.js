// PropBetEdge All Access — the WNBA presentation layer for the network's PRIMARY offer.
//
// All Access (every current and future PropBetEdge Pro sport) is the first thing a FREE visitor sees on every
// purchase surface; WNBA Pro is the single-sport alternative beneath an "ONLY WANT WNBA?" seam.
// WNBA PRO ACTIVE members see the UPGRADE TO ALL ACCESS variant. ALL ACCESS ACTIVE and OWNER never see it.
//
// Every commercial fact (price, promo code, checkout link, learn link) is read from the shared contract
// (src/lib/pbe-membership.js ALL_ACCESS_OFFER) and never restated here. Nothing here decides entitlement:
// the state comes from the server verdict carried by src/lib/membership.js.

import { html, raw, esc } from '../lib/dom.js';
import { ALL_ACCESS_OFFER } from '../lib/pbe-membership.js';

export const ALL_ACCESS_SPORTS = 'MLB · NFL · NBA · NHL · WNBA · UFC · Tennis';
export const ALL_ACCESS_NEXT = 'plus every Pro sport added next.';
export const ALL_ACCESS_BADGE = 'BEST VALUE · MOST COMPLETE';
export const WNBA_ONLY_LABEL = 'ONLY WANT WNBA?';
const NO_OFFER_STATES = new Set(['all_access', 'owner']);

/** The offer renders for FREE visitors and as an upgrade for WNBA Pro members; never for All Access or the owner. */
export const showsAllAccess = (m) => !NO_OFFER_STATES.has(String(m?.state || 'free'));

/** The hero. `variant`: 'panel' (the /pro purchase panel) or 'compact' (teasers on secondary surfaces). */
export function allAccessHeroHtml(m, { variant = 'panel' } = {}) {
  if (!showsAllAccess(m)) return '';
  const o = ALL_ACCESS_OFFER;
  const state = String(m?.state || 'free');
  const upgrade = state === 'sport_pro';
  const [amount, cadence] = String(o.price).split('/');
  const promo = raw(esc(o.promoLine).replace(o.promoCode, `<b class="wnba-aa-code">${esc(o.promoCode)}</b>`));
  return html`<aside class="wnba-aa-hero is-${variant}${upgrade ? ' is-upgrade' : ''}" data-wnba-all-access="hero" data-wnba-all-access-state="${state}" aria-label="PropBetEdge All Access">
    <div class="wnba-aa-top"><span class="wnba-aa-eyebrow">PROPBETEDGE NETWORK</span><span class="wnba-aa-badge">${ALL_ACCESS_BADGE}</span></div>
    <div class="wnba-aa-title-row"><h3 class="wnba-aa-title">${upgrade ? 'UPGRADE TO ALL ACCESS' : 'ALL ACCESS'}</h3><span class="wnba-aa-price" aria-label="${o.price}"><strong>${amount}</strong>/${cadence}</span></div>
    <p class="wnba-aa-tagline">${o.tagline}</p>
    <p class="wnba-aa-sports"><b>${ALL_ACCESS_SPORTS}</b> <span>${ALL_ACCESS_NEXT}</span></p>
    <p class="wnba-aa-promo">Launch offer: ${promo}</p>
    <div class="wnba-aa-actions">
      <a class="wnba-aa-cta" href="${o.checkoutUrl}" rel="noopener" data-pbe-placement="all_access_checkout" data-wnba-all-access-cta="checkout">GET ALL ACCESS</a>
      <a class="wnba-aa-learn" href="${o.learnUrl}" rel="noopener" data-wnba-all-access-cta="learn">WHAT'S INCLUDED</a>
    </div>
  </aside>`;
}

/** The seam between the umbrella and the single-sport alternative. */
export function allAccessDividerHtml(label = WNBA_ONLY_LABEL) {
  return html`<div class="wnba-aa-divider" role="separator" aria-label="${label}" data-wnba-all-access="divider"><span>${label}</span></div>`;
}

/** One-line gold entry for surfaces that only have room for a strip (the public PBE Picks flagship copy). */
export function allAccessMiniHtml(m) {
  if (!showsAllAccess(m)) return '';
  const o = ALL_ACCESS_OFFER;
  return html`<a class="wnba-aa-mini" href="${o.checkoutUrl}" rel="noopener" data-pbe-placement="all_access_checkout" data-wnba-all-access="mini"><span>ALL ACCESS</span><b>${o.price}</b><i>every PropBetEdge Pro sport · code ${o.promoCode} for 25% off →</i></a>`;
}
