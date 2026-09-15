// PBE Picks — the WNBA equivalent of UFC PBE Picks. What renders is exactly what wnba-api decided:
//   signed out / free   coverage teaser (ids + tip times only) and the unlock CTA
//   Pro, not published  MODEL_IN_VALIDATION notice (no values exist in the response)
//   owner, not published  shadow calls, labelled as shadow
//   Pro, published      live calls: PRE-LOCK provisional and LOCKED official

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, pageHead, errorState } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { fmtDateET, fmtTimeET } from '../lib/format.js';
import { pbeCallCard, pbeValidationNotice, teamName } from '../ui/pbe.js';

export const title = () => 'PBE Picks';
export const description = () => 'PBE WNBA model calls: independent win probabilities, the de-vigged market beside them, PBE Edge, confidence and model reasoning, locked 15 minutes before tip.';

const LINKS = html`<div class="pbe-links"><a class="pill" href="/track-record">Track Record</a><a class="pill" href="/pbe-picks/model">How the Model Works</a></div>`;
const SUB = 'An independent WNBA win probability for every covered game, built only from pregame team data. The sportsbook market is shown beside it, never inside it. Calls lock 15 minutes before tip.';

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'WNBA Pro', title: 'PBE Picks', sub: SUB, right: LINKS })}${skeleton(320)}`);
  const [acct, cov] = await Promise.all([api.account(), api.pbeCoverage()]);
  if (!ctx.isCurrent()) return;
  const head = pageHead({ eyebrow: 'WNBA Pro', title: 'PBE Picks', sub: SUB, right: LINKS });

  if (!(acct.ok && acct.data?.state === 'pro')) {
    return render(root, html`${head}${teaserView(cov, acct)}`);
  }
  const res = await api.pbePicks();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, html`${head}${res.status === 401 || res.status === 403 ? teaserView(cov, acct) : errorState(res, 'PBE Picks')}`);
  if (res.data.availability === 'MODEL_IN_VALIDATION') return render(root, html`${head}${pbeValidationNotice()}`);

  const all = res.data.picks;
  const state = { phase: 'all', calls: 'all', team: '' };
  const teams = [...new Map(all.flatMap((p) => [[p.game.home_team_id, { team_id: p.game.home_team_id, ...(p.game.home || {}) }], [p.game.away_team_id, { team_id: p.game.away_team_id, ...(p.game.away || {}) }]])).values()];
  const draw = () => {
    const shown = all.filter((p) =>
      (state.phase === 'all' || p.phase === state.phase) &&
      (state.calls === 'all' || (state.calls === 'picks' ? p.call === 'PICK' : p.call !== 'PICK')) &&
      (!state.team || p.game.home_team_id === state.team || p.game.away_team_id === state.team));
    const btn = (key, val, label) => html`<button type="button" data-f="${key}" data-v="${val}" aria-pressed="${state[key] === val}">${label}</button>`;
    render(root, html`${head}
      ${res.data.availability === 'SHADOW_OWNER_ONLY' ? html`<div class="callout" style="margin-top:12px">Owner view of the <b>dry-run shadow ledger</b>. Subscribers see nothing here until the first official lock is approved; shadow calls never enter the track record.</div>` : ''}
      <div class="pbe-filters" role="toolbar" aria-label="Filter calls">
        ${btn('phase', 'all', 'All')}${btn('phase', 'PRE_LOCK', 'Pre-lock')}${btn('phase', 'LOCKED', 'Locked')}
        ${btn('calls', 'picks', 'Picks')}${btn('calls', 'nocall', 'No call')}
        <select data-team aria-label="Team"><option value="">All teams</option>${teams.map((t) => html`<option value="${t.team_id}" ${state.team === t.team_id ? 'selected' : ''}>${teamName(t)}</option>`)}</select>
      </div>
      ${shown.length ? html`<div class="pbe-grid">${shown.map(pbeCallCard)}</div>` : html`<div class="pbe-empty">${all.length ? 'No calls match these filters.' : 'No covered games in the next 48 hours. Calls appear as games enter the scoring window.'}</div>`}
    `);
    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.f; const v = b.dataset.v;
      state[k] = state[k] === v && k === 'calls' ? 'all' : v;
      draw();
    }));
    root.querySelector('[data-team]')?.addEventListener('change', (e) => { state.team = e.target.value; draw(); });
  };
  draw();
}

function teaserView(cov, acct) {
  const games = cov.ok ? cov.data.games : [];
  const published = cov.ok && cov.data.published;
  const signedIn = acct.ok && acct.data?.state === 'free';
  return html`
    <section class="pbe-card pbe-teaser" style="margin-top:8px">
      <div class="pbe-head"><span class="pbe-eyebrow">PBE Picks</span><span class="pbe-lock">WNBA Pro</span></div>
      <div class="pbe-teaser-body">
        <b>${published ? 'Model calls available' : 'PBE model in validation · official calls start soon'}</b>
        <span>Win probability · market comparison · PBE Edge · confidence · model reasoning</span>
      </div>
      ${games.length ? html`<div class="pbe-teaser-list">${games.map((g) => html`<div class="pbe-teaser-row"><div class="m">${teamLogo({ team_id: g.away_team_id }, 26)}<span>${teamName({ team_id: g.away_team_id }, { short: true })}</span><em class="note">at</em><span>${teamName({ team_id: g.home_team_id }, { short: true })}</span>${teamLogo({ team_id: g.home_team_id }, 26)}</div><small>${fmtDateET(g.scheduled_tip_utc)} · ${fmtTimeET(g.scheduled_tip_utc)}</small></div>`)}</div>` : ''}
      <a class="btn gold pbe-cta" href="/pro?next=%2Fpbe-picks">${signedIn ? 'Upgrade to WNBA Pro' : 'Unlock WNBA Pro'}</a>
    </section>`;
}
