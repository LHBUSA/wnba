// WNBA Pro — three account states, decided by the server (wnba-api /v1/account).
// The browser never grants itself access: no query flag, cookie or localStorage
// value can move a visitor out of the state the server returns.

import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, badge } from '../ui/components.js';
import { PLANS, DEFAULT_PLAN, checkoutReady } from '../data/pricing.js';
import { fmtDateET } from '../lib/format.js';

export const title = () => 'WNBA Pro';
export const description = () => 'WNBA Pro Founding Season: $9.99/month or $3.99/week, no free trial, cancel anytime. The full PropBetEdge WNBA intelligence desk.';

const VALUE = [
  'WNBACast for every game — live event stream, published shot charts, runs, fouls and full replays',
  'Best-line board with sportsbook prices and no-vig consensus, kept apart from any model',
  'Matchup research: pace, form, rest, observed rotations and availability in one view',
  'Availability desk with a before → after change ledger and source timestamps',
  'The WNBA-only newsroom and PBE Desk, linked to every player and team'
];

export async function mount(root, ctx) {
  render(root, skeleton(480));
  const res = await api.account();
  if (!ctx.isCurrent()) return;
  let account = res.ok ? res.data : { state: 'signed_out', entitled: false, purchase_activation: 'inactive' };
  let preview = null;
  // Design-review states exist only in local dev builds (tree-shaken from production).
  if (import.meta.env.DEV && ['free', 'pro'].includes(ctx.query.preview)) {
    preview = ctx.query.preview;
    account = preview === 'pro'
      ? { state: 'pro', entitled: true, email: 'specimen@example.com', plan: 'monthly', status: 'active', current_period_end: new Date(Date.now() + 21 * 864e5).toISOString(), cancel_at_period_end: false, purchase_activation: 'inactive' }
      : { state: 'free', entitled: false, email: 'specimen@example.com', purchase_activation: 'inactive' };
  }
  let selected = DEFAULT_PLAN;

  const planPicker = () => html`<div class="plans" role="radiogroup" aria-label="Choose a plan">
    ${Object.values(PLANS).map((p) => html`<button type="button" class="plan" role="radio" aria-checked="${selected === p.id}" data-plan="${p.id}">
      <span class="ptag ${p.id === 'weekly' ? 'flex' : ''}">${p.tag}</span>
      <div class="pname">${p.label}</div>
      <div class="pprice">${p.price}<small>/ ${p.per}</small></div>
      <div class="pnote">${p.note}</div>
    </button>`)}
  </div>`;

  const cta = () => {
    const plan = PLANS[selected];
    const ready = checkoutReady(plan, account);
    return ready
      ? html`<a class="btn gold block" style="margin-top:16px" href="${plan.url}${account.email ? `?locked_prefilled_email=${encodeURIComponent(account.email)}` : ''}" data-external>Start WNBA Pro · ${plan.price}/${plan.per}</a>`
      : html`<button class="btn gold block" style="margin-top:16px" type="button" disabled aria-disabled="true">Founding Season checkout opens soon</button>
        <p class="note" style="margin-top:10px;text-align:center">Purchases are not open yet. Nothing is charged and no account is created from this page until secure Stripe checkout is live.</p>`;
  };

  const draw = () => {
    const s = account.state;
    render(root, html`
      ${preview ? html`<div class="callout warn" style="margin-bottom:16px">DESIGN PREVIEW · dev build only · state “${preview}” with specimen values. Production renders only the state the server returns.</div>` : ''}
      <div class="pro-wrap">
        <section class="pro-hero">
          <span class="eyebrow">Founding Season</span>
          <h1 style="margin-top:14px">WNBA <span>Pro</span></h1>
          <p style="margin-top:14px;color:var(--paper-2);font-size:16px;max-width:52ch">The complete PropBetEdge WNBA desk — built on real source data, with every number’s source and age on screen.</p>
          <ul class="pro-list">${VALUE.map((v) => html`<li>${v}</li>`)}</ul>
          <p class="note" style="margin-top:18px">One PropBetEdge account can hold WNBA Pro alongside NBA, NFL, NHL and UFC Pro — each subscription independent.</p>
        </section>

        ${s === 'pro' ? proPanel() : html`<section class="card pro-panel">
          <div class="pro-state">${s === 'free' ? html`${badge('final', 'Signed in')}<span>${account.email}</span>` : html`${badge('sched', 'Choose your plan')}`}</div>
          <h2 style="font:800 30px/1 var(--f-display);text-transform:uppercase;margin:16px 0">${s === 'free' ? 'Upgrade to WNBA Pro' : 'Join the Founding Season'}</h2>
          ${planPicker()}
          ${cta()}
          <ul class="note" style="margin:16px 0 0;padding-left:18px;display:grid;gap:4px"><li>No free trial</li><li>Cancel anytime from your Stripe receipt or account</li><li>Existing subscriptions are never silently repriced</li></ul>
          ${s === 'signed_out' ? html`<div style="border-top:1px solid var(--line);margin-top:18px;padding-top:14px"><p class="note">Already a PropBetEdge subscriber? Member sign-in for WNBA Pro opens with checkout — the same PropBetEdge account works across every sport.</p></div>` : ''}
        </section>`}
      </div>
    `);
    root.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.plan; draw(); }));
  };

  const proPanel = () => html`<section class="card pro-panel desk-active">
    <div class="pro-state">${badge('pbe', 'WNBA Pro · Active')}<span>${account.email}</span></div>
    <h2 style="font:800 34px/1 var(--f-display);text-transform:uppercase;margin:16px 0 6px">Your WNBA desk</h2>
    <p class="note">Verified PropBetEdge account · entitlement from the PropBetEdge ledger</p>
    <dl class="kv" style="margin-top:18px">
      <dt>Plan</dt><dd>${PLANS[account.plan]?.label || '—'} · ${PLANS[account.plan]?.price || ''}/${PLANS[account.plan]?.per || ''}</dd>
      <dt>Status</dt><dd>${account.status}${account.cancel_at_period_end ? ' · ends at period end' : ''}</dd>
      <dt>${account.cancel_at_period_end ? 'Access until' : 'Renews'}</dt><dd>${fmtDateET(account.current_period_end, { month: 'long', day: 'numeric', year: 'numeric' })}</dd>
    </dl>
    <a class="btn gold block" style="margin-top:20px" href="/cast">Open WNBACast</a>
    <div class="pill-row" style="margin-top:12px;justify-content:center"><a class="pill" href="/props">Best line</a><a class="pill" href="/matchups">Matchups</a><a class="pill" href="/injuries">Availability</a></div>
    <p class="note" style="margin-top:18px;text-align:center">Billing is managed by Stripe. Manage or cancel from your Stripe receipt email.</p>
  </section>`;

  draw();
}
