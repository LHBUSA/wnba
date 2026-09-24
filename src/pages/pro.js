// WNBA Pro — account states decided by the server (wnba-api /v1/account on wnba-api.propbetedge.ai).
// The browser never grants itself access: no query flag, cookie it can write, localStorage value or DOM state can
// move a visitor out of the state the server returns. Sign-in only proves an email; access is the billing ledger.
//
// Membership vocabulary = the shared PropBetEdge contract (src/lib/pbe-membership.js): FREE · WNBA PRO ACTIVE ·
// ALL ACCESS ACTIVE · OWNER, read from the server's `membership` object and never re-derived here.
//   free       WNBA plan picker (monthly / weekly, live checkout) + the All Access card beneath
//   sport_pro  plan active, manage link, All Access as the optional upgrade
//   all_access ALL ACCESS ACTIVE, manage link, network row — no purchase CTA anywhere
//   owner      OWNER — no purchase CTA, no manage link

import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, badge } from '../ui/components.js';
import { PLANS, DEFAULT_PLAN, checkoutReady } from '../data/pricing.js';
import { fmtDateET } from '../lib/format.js';
import { PRO_INTELLIGENCE } from '../data/pro-features.js';
import { membershipBadgeHtml, planText, manageLinkHtml, allAccessCardHtml, networkLinksHtml, deriveMembership, ALL_ACCESS_URL } from '../lib/pbe-membership.js';
import { membershipFrom, isMember, announceMembership, SPORT } from '../lib/membership.js';

export const title = () => 'WNBA Pro';
export const description = () => 'WNBA Pro: PBE Picks, PBE Prop Edge, Edge Timeline, Player Load, Rotation Impact, Scenario Lab, Watchlist, model reasoning and the live locked track record. $9.99/month or $3.99/week, or included with PropBetEdge All Access.';

const FLAGSHIP = [
  ['PBE Picks', 'Independent win probabilities, market comparison, PBE Edge and driver-by-driver reasoning.'],
  ['PBE Prop Edge', 'Independent player projections, Over/Under probabilities, market disagreement, Player Load context and transparent drivers across Points, Rebounds, Assists and 3PM.'],
  ['PBE Edge Timeline', 'Every real pre-lock observation from first read through the latest model state.'],
  ['Player Load Intelligence', 'A 0–100 workload and schedule-pressure index using recent minutes, density, turnaround and overtime.'],
  ['Rotation Impact', 'Availability plus Player Load and recent baseline minutes, organized team by team.'],
  ['PBE Scenario Lab', 'Base case, supporting drivers, counter-drivers and the market disagreement — without fake simulated certainty.'],
  ['Watchlist & Live Alerts', 'Save teams and consolidate their PBE, Player Load and availability signals in one live board.'],
  ['Live track record', 'Every official locked game call. Wins and losses stay on the board. Prop Edge remains tracking beta until its own locked ledger is validated and promoted.']
];
const DESK = [
  ['WNBA Daily Brief — FREE', 'A genuinely useful free layer that shows the slate, PBE coverage window, availability movement and public record.'],
  ['WNBACast', 'Live event stream, published shot charts, runs and full replays for every game.'],
  ['Best Line', 'The best sportsbook price and the no-vig consensus for every game, kept apart from the model.'],
  ['Matchup intelligence', 'Pace, form, rest, observed rotations and availability in one view.'],
  ['Availability', 'Every injury-feed change as a before → after ledger with source timestamps.']
];

const safeNext = (n) => (/^\/(?!\/)[A-Za-z0-9\-._~/?=&%]{0,200}$/.test(String(n || '')) ? n : '/pbe-picks');
// After a Stripe Payment Link completes the buyer lands here (pricing.js). Re-read the account while the webhook
// settles the ledger; stop as soon as the server says entitled or the visitor leaves the page.
const CHECKOUT_RECHECK_MS = [6000, 20000];

// Dev-only design specimens (tree-shaken from production): ?preview=free|pro|all_access|owner
function previewAccount(kind) {
  const email = 'specimen@example.com';
  const periodEnd = new Date(Date.now() + 21 * 864e5).toISOString();
  if (kind === 'free') return { state: 'free', entitled: false, email, purchase_activation: 'active', membership: deriveMembership({ sport: SPORT, entitled: false, email }) };
  const source = kind === 'owner' ? 'owner' : kind === 'all_access' ? 'all_access' : 'sport';
  const sub = source === 'owner' ? {} : { plan: 'monthly', current_period_end: periodEnd, product_key: source === 'all_access' ? 'pbe_all_access' : 'wnba_pro' };
  return {
    state: 'pro', entitled: true, access: source === 'owner' ? 'owner' : 'subscriber', email, plan: sub.plan || null, status: source === 'owner' ? 'owner' : 'active', current_period_end: sub.current_period_end || null, cancel_at_period_end: false, purchase_activation: 'active',
    membership: deriveMembership({ sport: SPORT, entitled: true, accessSource: source, productKey: sub.product_key || null, plan: sub.plan || null, email, currentPeriodEnd: sub.current_period_end || null })
  };
}

export async function mount(root, ctx) {
  render(root, skeleton(480));
  const res = await api.account();
  if (!ctx.isCurrent()) return;
  let account = res.ok ? res.data : { state: 'signed_out', entitled: false, purchase_activation: 'inactive' };
  let m = membershipFrom(res);
  const signInReady = res.ok;
  let preview = null;
  if (import.meta.env.DEV && ['free', 'pro', 'all_access', 'owner'].includes(ctx.query.preview)) {
    preview = ctx.query.preview;
    account = previewAccount(preview);
    m = membershipFrom({ ok: true, data: account });
  }
  const next = safeNext(ctx.query.next);
  const checkoutSuccess = ctx.query.checkout === 'success';
  let selected = DEFAULT_PLAN;
  let signin = { status: 'idle', message: '' };

  const planPicker = () => html`<span class="eyebrow" style="display:block;margin:16px 0 10px">Founding Season rate</span><div class="plans" role="radiogroup" aria-label="Choose a plan">
    ${Object.values(PLANS).map((p) => html`<button type="button" class="plan" role="radio" aria-checked="${selected === p.id}" data-plan="${p.id}">
      <span class="ptag ${p.id === 'weekly' ? 'flex' : ''}">${p.tag}</span><div class="pname">${p.label}</div><div class="pprice">${p.price}<small>/ ${p.per}</small></div><div class="pnote">${p.note}</div>
    </button>`)}</div>`;
  const checkout = () => {
    const plan = PLANS[selected];
    return checkoutReady(plan, account)
      ? html`<a class="btn gold block" style="margin-top:16px" href="${plan.url}${account.email ? `?prefilled_email=${encodeURIComponent(account.email)}` : ''}" data-external>Unlock WNBA Pro · ${plan.price}/${plan.per}</a>`
      : html`<button class="btn gold block" style="margin-top:16px" type="button" disabled aria-disabled="true">Checkout opens soon</button><p class="note" style="margin-top:10px;text-align:center">Purchases are not open yet. Nothing is charged from this page until secure checkout is live.</p>`;
  };
  const signInBlock = ({ lead = null } = {}) => html`<div style="border-top:1px solid var(--line);margin-top:18px;padding-top:14px"><p class="note">${lead ? html`<b>${lead}</b>` : html`<b>Already a member, or want to sign in first?</b>`} Enter your email and we’ll send a one-time sign-in link. No password.</p>${signInReady ? html`<form class="signin-form" data-signin novalidate><input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" aria-label="Email address" required ${signin.status === 'sending' ? 'disabled' : ''} /><button class="btn" type="submit" ${signin.status === 'sending' ? 'disabled' : ''}>${signin.status === 'sending' ? 'Sending…' : 'Email me a link'}</button></form>${signin.message ? html`<p class="signin-msg ${signin.status === 'error' ? 'err' : ''}" role="status">${signin.message}</p>` : ''}` : html`<p class="note" style="margin-top:8px">Member sign-in is temporarily unavailable. Reload in a minute.</p>`}</div>`;
  const valueList = (rows) => html`<ul class="pro-list">${rows.map(([h, t]) => html`<li><span><b style="color:var(--paper)">${h}.</b> ${t}</span></li>`)}</ul>`;

  // Plan · Status · Renews, from the contract's plan text (All Access and Owner never show a "— · /" WNBA plan).
  const planRows = () => {
    if (m.state === 'owner') return html`<p class="pbe-mbr-plan" style="margin-top:18px">${planText(m)}</p>`;
    const wnbaPlan = m.state === 'sport_pro' ? PLANS[m.plan] : null;
    return html`<dl class="kv" style="margin-top:18px">
      <dt>Plan</dt><dd>${planText(m)}${wnbaPlan ? ` · ${wnbaPlan.price}/${wnbaPlan.per}` : ''}</dd>
      <dt>Status</dt><dd>${m.cancel_at_period_end ? 'Active · ends at period end' : 'Active'}</dd>
      ${m.current_period_end ? html`<dt>${m.cancel_at_period_end ? 'Access until' : 'Renews'}</dt><dd>${fmtDateET(m.current_period_end, { month: 'long', day: 'numeric', year: 'numeric' })}</dd>` : ''}
    </dl>`;
  };

  const memberPanel = () => html`<section class="card pro-panel desk-active">
    <div class="pro-state">${raw(membershipBadgeHtml(m))}<span>${m.email}</span></div>
    <h2 style="font:800 34px/1 var(--f-display);text-transform:uppercase;margin:16px 0 6px">Your WNBA desk</h2><p class="note">Verified sign-in · entitlement from the PropBetEdge billing ledger</p>
    ${planRows()}
    <a class="btn gold block" style="margin-top:20px" href="/pbe-picks">Open PBE Picks</a>
    <a class="btn block" style="margin-top:10px;border-color:var(--gold-line)" href="/props#pbe-prop-edge">Open PBE Prop Edge</a>
    <a class="btn block" style="margin-top:10px;border-color:var(--gold-line)" href="/player-load">Open Player Load Intelligence</a>
    <div class="pi-suite-rail" style="margin-top:12px">${PRO_INTELLIGENCE.map((f) => html`<a href="${f.href}"><span>${f.name}</span><b>PRO</b></a>`)}</div>
    <div class="pill-row" style="margin-top:12px;justify-content:center"><a class="pill" href="/brief">Free Daily Brief</a><a class="pill" href="/track-record">Track record</a><a class="pill" href="/cast">WNBACast</a><a class="pill" href="/props">Best line</a><a class="pill" href="/matchups">Matchups</a></div>
    ${m.state === 'sport_pro' ? raw(allAccessCardHtml(m)) : ''}
    ${m.state === 'all_access' || m.state === 'owner' ? html`<div class="pbe-mbr-links"><a class="pbe-mbr-network-link" href="${ALL_ACCESS_URL}" rel="noopener">${m.state === 'all_access' ? 'Your network' : 'PropBetEdge All Access'}</a></div>${raw(networkLinksHtml(SPORT))}` : ''}
    ${m.show_manage ? html`<div class="pbe-mbr-links">${raw(manageLinkHtml(m))}</div>` : ''}
    <button class="btn block" style="margin-top:16px" type="button" data-logout>Sign out</button>
    ${m.show_manage ? html`<p class="note" style="margin-top:14px;text-align:center">Manage or cancel any time from Manage subscription. Access continues to the end of the paid period.</p>` : ''}
  </section>`;

  const freePanel = () => {
    const signedIn = account.state === 'free';
    return html`<section class="card pro-panel" id="plans">
      <div class="pro-state">${signedIn ? html`${raw(membershipBadgeHtml(m))}<span>${m.email}</span>` : badge('sched', 'Choose your plan')}</div>
      <h2 style="font:800 30px/1 var(--f-display);text-transform:uppercase;margin:16px 0">${signedIn ? 'Upgrade to WNBA Pro' : 'Unlock WNBA Pro'}</h2>
      ${checkoutSuccess && !signedIn ? signInBlock({ lead: 'Sign in with your checkout email to open your desk.' }) : ''}
      ${planPicker()}${checkout()}
      <ul class="note" style="margin:16px 0 0;padding-left:18px;display:grid;gap:4px"><li>No free trial</li><li>Cancel anytime</li><li>Also included with PropBetEdge All Access</li></ul>
      ${raw(allAccessCardHtml(m))}
      ${signedIn
        ? html`${account.entitlement_check === 'UNAVAILABLE' ? html`<p class="callout warn" style="margin-top:14px">We couldn’t confirm your subscription just now. If you’re a member, reload in a minute.</p>` : ''}<button class="btn" style="margin-top:14px" type="button" data-logout>Sign out</button>`
        : checkoutSuccess ? '' : signInBlock()}
    </section>`;
  };

  const successBanner = () => {
    if (!checkoutSuccess) return '';
    const detail = isMember(m)
      ? `Your desk is open below as ${m.email}.`
      : account.state === 'free'
        ? 'Your payment went through. Your desk unlocks as soon as the billing ledger confirms it — this page re-checks automatically.'
        : 'Sign in with your checkout email to open your desk. We email a one-time link — no password.';
    return html`<div class="pro-checkout-success" role="status"><b>WNBA Pro is active</b><span>${detail}</span></div>`;
  };

  const draw = () => {
    const member = isMember(m);
    render(root, html`${preview ? html`<div class="callout warn" style="margin-bottom:16px">DESIGN PREVIEW · dev build only · state “${preview}” with specimen values. Production renders only the state the server returns.</div>` : ''}${successBanner()}<div class="pro-wrap"><section class="pro-hero">${member ? raw(membershipBadgeHtml(m)) : html`<span class="eyebrow">PropBetEdge WNBA</span>`}<h1 style="margin-top:14px">WNBA <span>Pro</span></h1><p style="margin-top:14px;color:var(--paper-2);font-size:16px;max-width:58ch">PBE Picks is the center of a full intelligence stack: game calls, player-prop projections, model movement, player workload, rotation pressure, scenario paths, live watchlists and a permanent locked-call record.</p>${valueList(FLAGSHIP)}<span class="eyebrow" style="display:block;margin-top:22px">The full WNBA desk</span>${valueList(DESK)}<div class="pill-row" style="margin-top:18px"><a class="pill on" href="/brief">Try the free Daily Brief</a>${PRO_INTELLIGENCE.map((f) => html`<a class="pill" href="${f.href}">${f.name}</a>`)}</div>${member ? '' : html`<a class="btn gold" style="margin-top:22px" href="#plans">Unlock WNBA Pro</a>`}<p class="note" style="margin-top:18px">Player Load measures workload and schedule pressure, not medical fatigue. PBE Prop Edge V1 is a tracking beta until its historical validation and locked prop record are complete. Scenario Lab v1 explains evidence paths rather than inventing simulations. Model details: <a class="sec-link" href="/pbe-picks/model">how the PBE model works</a> · <a class="sec-link" href="/track-record">live track record</a>.</p></section>${member ? memberPanel() : freePanel()}</div>`);
    root.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.plan; draw(); }));
    root.querySelector('[data-signin]')?.addEventListener('submit', async (e) => { e.preventDefault(); const email = String(new FormData(e.target).get('email') || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { signin = { status: 'error', message: 'Enter a valid email address.' }; return draw(); } signin = { status: 'sending', message: '' }; draw(); const r = await api.authRequest(email, next); signin = r.ok ? { status: 'sent', message: `Check ${email} for your sign-in link. It works once, for 15 minutes.` } : { status: 'error', message: r.error?.message || 'We could not send the link. Try again shortly.' }; draw(); });
    root.querySelector('[data-logout]')?.addEventListener('click', async () => { await api.authLogout(); location.reload(); });
  };
  draw();

  if (checkoutSuccess && !preview && !isMember(m)) {
    for (const delay of CHECKOUT_RECHECK_MS) {
      setTimeout(async () => {
        if (!ctx.isCurrent() || isMember(m)) return;
        const again = await api.account();
        if (!ctx.isCurrent()) return;
        if (again.ok) { account = again.data; m = membershipFrom(again); announceMembership(m); draw(); }
      }, delay);
    }
  }
}
