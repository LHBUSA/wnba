// WNBA Pro — three account states, decided by the server (wnba-api /v1/account on wnba-api.propbetedge.ai).
// The browser never grants itself access: no query flag, cookie it can write, localStorage value or DOM state can
// move a visitor out of the state the server returns. Sign-in only proves an email; WNBA Pro is the billing ledger.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, badge } from '../ui/components.js';
import { PLANS, DEFAULT_PLAN, checkoutReady } from '../data/pricing.js';
import { fmtDateET } from '../lib/format.js';

export const title = () => 'WNBA Pro';
export const description = () => 'WNBA Pro: PBE Picks with independent win probabilities, market comparison, PBE Edge and model reasoning, plus the live track record, WNBACast, Best Line, matchups and availability. $9.99/month or $3.99/week.';

const FLAGSHIP = [
  ['PBE Picks', 'Independent win probabilities, market comparison and PBE Edge.'],
  ['Model reasoning', 'See what pushed the probability and what pushed against it.'],
  ['Live track record', 'Every official locked call. Wins and losses stay on the board.']
];
const DESK = [
  ['WNBACast', 'Live event stream, published shot charts, runs and full replays for every game.'],
  ['Best Line', 'The best sportsbook price and the no-vig consensus for every game, kept apart from the model.'],
  ['Matchup intelligence', 'Pace, form, rest, observed rotations and availability in one view.'],
  ['Availability', 'Every injury-feed change as a before → after ledger with source timestamps.']
];

const safeNext = (n) => (/^\/(?!\/)[A-Za-z0-9\-._~/?=&%]{0,200}$/.test(String(n || '')) ? n : '/pbe-picks');

export async function mount(root, ctx) {
  render(root, skeleton(480));
  const res = await api.account();
  if (!ctx.isCurrent()) return;
  let account = res.ok ? res.data : { state: 'signed_out', entitled: false, purchase_activation: 'inactive' };
  const signInReady = res.ok; // the credentialed API answered; sign-in can be offered
  let preview = null;
  // Design-review states exist only in local dev builds (tree-shaken from production).
  if (import.meta.env.DEV && ['free', 'pro'].includes(ctx.query.preview)) {
    preview = ctx.query.preview;
    account = preview === 'pro'
      ? { state: 'pro', entitled: true, access: 'subscriber', email: 'specimen@example.com', plan: 'monthly', status: 'active', current_period_end: new Date(Date.now() + 21 * 864e5).toISOString(), cancel_at_period_end: false, purchase_activation: 'inactive' }
      : { state: 'free', entitled: false, email: 'specimen@example.com', purchase_activation: 'inactive' };
  }
  const next = safeNext(ctx.query.next);
  let selected = DEFAULT_PLAN;
  let signin = { status: 'idle', message: '' };

  const planPicker = () => html`<div class="plans" role="radiogroup" aria-label="Choose a plan">
    ${Object.values(PLANS).map((p) => html`<button type="button" class="plan" role="radio" aria-checked="${selected === p.id}" data-plan="${p.id}">
      <span class="ptag ${p.id === 'weekly' ? 'flex' : ''}">${p.tag}</span>
      <div class="pname">${p.label}</div>
      <div class="pprice">${p.price}<small>/ ${p.per}</small></div>
      <div class="pnote">${p.note}</div>
    </button>`)}
  </div>`;

  const checkout = () => {
    const plan = PLANS[selected];
    return checkoutReady(plan, account)
      ? html`<a class="btn gold block" style="margin-top:16px" href="${plan.url}${account.email ? `?prefilled_email=${encodeURIComponent(account.email)}` : ''}" data-external>Unlock WNBA Pro · ${plan.price}/${plan.per}</a>`
      : html`<button class="btn gold block" style="margin-top:16px" type="button" disabled aria-disabled="true">Founding Season checkout opens soon</button>
        <p class="note" style="margin-top:10px;text-align:center">Purchases are not open yet. Nothing is charged from this page until secure Stripe checkout is live.</p>`;
  };

  const signInBlock = () => html`<div style="border-top:1px solid var(--line);margin-top:18px;padding-top:14px">
    <p class="note"><b>Already a member, or want to sign in first?</b> Enter your email and we’ll send a one-time sign-in link. No password.</p>
    ${signInReady ? html`<form class="signin-form" data-signin novalidate>
      <input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" aria-label="Email address" required ${signin.status === 'sending' ? 'disabled' : ''} />
      <button class="btn" type="submit" ${signin.status === 'sending' ? 'disabled' : ''}>${signin.status === 'sending' ? 'Sending…' : 'Email me a link'}</button>
    </form>
    ${signin.message ? html`<p class="signin-msg ${signin.status === 'error' ? 'err' : ''}" role="status">${signin.message}</p>` : ''}`
    : html`<p class="note" style="margin-top:8px">Member sign-in opens with WNBA Pro checkout.</p>`}
  </div>`;

  const valueList = (rows) => html`<ul class="pro-list">${rows.map(([h, t]) => html`<li><span><b style="color:var(--paper)">${h}.</b> ${t}</span></li>`)}</ul>`;

  const draw = () => {
    const s = account.state;
    render(root, html`
      ${preview ? html`<div class="callout warn" style="margin-bottom:16px">DESIGN PREVIEW · dev build only · state “${preview}” with specimen values. Production renders only the state the server returns.</div>` : ''}
      <div class="pro-wrap">
        <section class="pro-hero">
          <span class="eyebrow">Founding Season</span>
          <h1 style="margin-top:14px">WNBA <span>Pro</span></h1>
          <p style="margin-top:14px;color:var(--paper-2);font-size:16px;max-width:52ch">PBE Picks: an independent model call for every covered WNBA game, with the market beside it, never inside it.</p>
          ${valueList(FLAGSHIP)}
          <span class="eyebrow" style="display:block;margin-top:22px">The full WNBA desk</span>
          ${valueList(DESK)}
          ${s !== 'pro' ? html`<a class="btn gold" style="margin-top:22px" href="#plans">Unlock WNBA Pro</a>` : ''}
          <p class="note" style="margin-top:18px">Model details: <a class="sec-link" href="/pbe-picks/model">how the PBE model works</a> · <a class="sec-link" href="/track-record">live track record</a>. On 2026 games the de-vigged market predicted better than the model, so PBE Edge is a measure of disagreement, not a promise.</p>
        </section>

        ${s === 'pro' ? proPanel() : html`<section class="card pro-panel" id="plans">
          <div class="pro-state">${s === 'free' ? html`${badge('final', 'Signed in')}<span>${account.email}</span>` : html`${badge('sched', 'Choose your plan')}`}</div>
          <h2 style="font:800 30px/1 var(--f-display);text-transform:uppercase;margin:16px 0">${s === 'free' ? 'Upgrade to WNBA Pro' : 'Unlock WNBA Pro'}</h2>
          ${planPicker()}
          ${checkout()}
          <ul class="note" style="margin:16px 0 0;padding-left:18px;display:grid;gap:4px"><li>No free trial</li><li>Cancel anytime</li><li>WNBA Pro is separate from NBA, NHL and UFC Pro</li></ul>
          ${s === 'free' ? html`${account.entitlement_check === 'UNAVAILABLE' ? html`<p class="callout warn" style="margin-top:14px">We couldn’t confirm your subscription just now. If you’re a member, reload in a minute.</p>` : ''}<button class="btn" style="margin-top:14px" type="button" data-logout>Sign out</button>` : signInBlock()}
        </section>`}
      </div>
    `);
    root.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.plan; draw(); }));
    root.querySelector('[data-signin]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = String(new FormData(e.target).get('email') || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { signin = { status: 'error', message: 'Enter a valid email address.' }; return draw(); }
      signin = { status: 'sending', message: '' }; draw();
      const r = await api.authRequest(email, next);
      signin = r.ok ? { status: 'sent', message: `Check ${email} for your sign-in link. It works once, for 15 minutes.` } : { status: 'error', message: r.error?.message || 'We could not send the link. Try again shortly.' };
      draw();
    });
    root.querySelector('[data-logout]')?.addEventListener('click', async () => { await api.authLogout(); location.reload(); });
  };

  const proPanel = () => html`<section class="card pro-panel desk-active">
    <div class="pro-state">${badge('pbe', account.access === 'owner' ? 'WNBA Pro · Owner' : 'WNBA Pro · Active')}<span>${account.email}</span></div>
    <h2 style="font:800 34px/1 var(--f-display);text-transform:uppercase;margin:16px 0 6px">Your WNBA desk</h2>
    <p class="note">Verified sign-in · entitlement from the PropBetEdge billing ledger</p>
    ${account.access === 'subscriber' ? html`<dl class="kv" style="margin-top:18px">
      <dt>Plan</dt><dd>${PLANS[account.plan]?.label || '—'} · ${PLANS[account.plan]?.price || ''}/${PLANS[account.plan]?.per || ''}</dd>
      <dt>Status</dt><dd>${account.status}${account.cancel_at_period_end ? ' · ends at period end' : ''}</dd>
      <dt>${account.cancel_at_period_end ? 'Access until' : 'Renews'}</dt><dd>${fmtDateET(account.current_period_end, { month: 'long', day: 'numeric', year: 'numeric' })}</dd>
    </dl>` : ''}
    <a class="btn gold block" style="margin-top:20px" href="/pbe-picks">Open PBE Picks</a>
    <div class="pill-row" style="margin-top:12px;justify-content:center"><a class="pill" href="/track-record">Track record</a><a class="pill" href="/cast">WNBACast</a><a class="pill" href="/props">Best line</a><a class="pill" href="/matchups">Matchups</a></div>
    <button class="btn block" style="margin-top:16px" type="button" data-logout>Sign out</button>
    <p class="note" style="margin-top:14px;text-align:center">Billing is managed by Stripe. Manage or cancel from your Stripe receipt email.</p>
  </section>`;

  draw();
}
