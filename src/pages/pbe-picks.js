// PBE Picks — flagship WNBA Pro intelligence desk. What renders is exactly what wnba-api decided:
//   signed out / free     public product + coverage window, never protected values
//   Pro, not published    MODEL_IN_VALIDATION notice
//   owner, not published  shadow calls, explicitly labelled
//   Pro, published        live PRE-LOCK + LOCKED calls with research context

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, pageHead, errorState } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { fmtDateET, fmtTimeET } from '../lib/format.js';
import { pbeValidationNotice, teamName } from '../ui/pbe.js';
import { flagshipPbeCard } from '../ui/pbe-flagship.js';
import { pbePicksPublicView } from '../views/pbe-picks-public.js';

export const title = () => 'PBE Picks';
export const description = () => 'PBE WNBA intelligence: independent win probabilities, de-vigged market comparison, model-market disagreement, confidence, driver-by-driver reasoning, matchup research and a permanent locked track record.';

const LINKS = html`<div class="pbe-links"><a class="pill" href="/edge-timeline">Edge Timeline</a><a class="pill" href="/scenario-lab">Scenario Lab</a><a class="pill" href="/rotation-impact">Rotation Impact</a><a class="pill" href="/watchlist">Watchlist</a><a class="pill" href="/track-record">Track Record</a><a class="pill" href="/player-load">Player Load</a><a class="pill" href="/pbe-picks/model">How the Model Works</a></div>`;
const SUB = 'The flagship WNBA Pro research board. Model probability first; market benchmark beside it; real drivers, opposing factors, team intelligence and matchup research underneath. Calls lock 15 minutes before tip.';
const pc = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
const n3 = (x) => Number.isFinite(x) ? x.toFixed(3) : '—';
const edge = (x) => Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pts` : '—';
const norm = (x) => String(x || '').toLowerCase();

export async function mount(root, ctx) {
  const head = pageHead({ eyebrow: 'WNBA Pro · Flagship', title: 'PBE Picks', sub: SUB, right: LINKS });
  render(root, html`${head}${skeleton(420)}`);
  const [acct, cov, status, initialTrack] = await Promise.all([api.account(), api.pbeCoverage(), api.pbeStatus(), api.trackRecord()]);
  let track = initialTrack;
  if (!ctx.isCurrent()) return;

  if (!(acct.ok && acct.data?.state === 'pro')) return render(root, html`${head}${teaserView(cov, acct)}`);

  const res = await api.pbePicks();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, html`${head}${res.status === 401 || res.status === 403 ? teaserView(cov, acct) : errorState(res, 'PBE Picks')}`);
  if (res.data.availability === 'MODEL_IN_VALIDATION') return render(root, html`${head}${pbeValidationNotice()}${researchStack()}`);

  const all = res.data.picks || [];
  const state = { phase: 'all', calls: 'all', team: '' };
  const teams = [...new Map(all.flatMap((p) => [
    [String(p.game.home_team_id), { team_id: p.game.home_team_id, ...(p.game.home || {}) }],
    [String(p.game.away_team_id), { team_id: p.game.away_team_id, ...(p.game.away || {}) }]
  ])).values()].sort((a, b) => teamName(a).localeCompare(teamName(b)));

  const draw = () => {
    const shown = all.filter((p) =>
      (state.phase === 'all' || p.phase === state.phase) &&
      (state.calls === 'all' || (state.calls === 'picks' ? p.call === 'PICK' : p.call !== 'PICK')) &&
      (!state.team || String(p.game.home_team_id) === state.team || String(p.game.away_team_id) === state.team));
    const btn = (key, val, label) => html`<button type="button" data-f="${key}" data-v="${val}" aria-pressed="${state[key] === val}">${label}</button>`;

    render(root, html`${head}
      ${res.data.availability === 'SHADOW_OWNER_ONLY' ? html`<div class="callout" style="margin-top:12px">Owner view of the <b>dry-run shadow ledger</b>. Shadow calls never enter the official track record.</div>` : ''}
      ${commandCenter(all, status, track, res.data.generated_at)}
      <div class="pbe-filters" role="toolbar" aria-label="Filter PBE calls">
        ${btn('phase', 'all', 'All calls')}${btn('phase', 'PRE_LOCK', 'Pre-lock')}${btn('phase', 'LOCKED', 'Locked')}
        ${btn('calls', 'picks', 'Picks')}${btn('calls', 'nocall', 'No call')}
        <select data-team aria-label="Filter by team"><option value="">All teams</option>${teams.map((t) => html`<option value="${t.team_id}" ${state.team === String(t.team_id) ? 'selected' : ''}>${teamName(t)}</option>`)}</select>
      </div>
      ${shown.length ? html`<div class="pbe-flagship-board">${shown.map(flagshipPbeCard)}</div>` : html`<div class="pbe-empty">${all.length ? 'No calls match these filters.' : 'No covered games are inside the current scoring window. PBE calls appear as games enter the model window.'}</div>`}
    `);

    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.f;
      const v = b.dataset.v;
      state[k] = state[k] === v && k === 'calls' ? 'all' : v;
      draw();
    }));
    root.querySelector('[data-team]')?.addEventListener('change', (e) => { state.team = e.target.value; draw(); });
  };
  draw();

  let trackRefreshInFlight = false;
  const timer = setInterval(async () => {
    if (trackRefreshInFlight || !ctx.isCurrent()) return;
    trackRefreshInFlight = true;
    try {
      const next = await api.trackRecord();
      if (ctx.isCurrent() && next?.ok) {
        track = next;
        draw();
      }
    } catch (error) {
      console.warn('[pbe-picks] track record refresh failed', error);
    } finally {
      trackRefreshInFlight = false;
    }
  }, 10_000);
  return () => clearInterval(timer);
}

function commandCenter(all, status, track, generatedAt) {
  const picks = all.filter((p) => p.call === 'PICK');
  const locked = all.filter((p) => p.phase === 'LOCKED').length;
  const high = picks.filter((p) => norm(p.confidence) === 'high').length;
  const priced = picks.filter((p) => p.market?.available && Number.isFinite(p.market.pbe_edge_pts));
  const biggest = [...priced].sort((a, b) => Math.abs(b.market.pbe_edge_pts) - Math.abs(a.market.pbe_edge_pts))[0] || null;
  const nextLock = all.filter((p) => p.phase === 'PRE_LOCK' && p.lock_at).sort((a, b) => Date.parse(a.lock_at) - Date.parse(b.lock_at))[0] || null;
  const record = track.ok ? track.data?.record : null;
  const model = status.ok ? status.data : null;
  const picked = biggest ? pickTeam(biggest) : null;

  return html`<section class="pbe-command">
    <div class="pbe-command-top">
      <div><span class="eyebrow">PBE Command Center</span><h2>Every call should open into research.</h2><p>Use the model as the first layer, not the last click. Open the observation timeline, scenario paths, rotation pressure, either team, the full matchup, Player Load and availability from the same call. Market consensus stays separate from the model so disagreement is visible instead of blended away.</p></div>
      <span class="pbe-command-badge">${generatedAt ? `BOARD UPDATED ${fmtTimeET(generatedAt)}` : 'LIVE WNBA PRO'}</span>
    </div>
    <div class="pbe-command-tiles">
      <div><span>Covered games</span><b>${all.length}</b><small>inside the current model window</small></div>
      <div><span>Official picks</span><b>${picks.length}</b><small>${all.length - picks.length} no-call / uncalled</small></div>
      <div><span>Locked</span><b>${locked}</b><small>frozen before scheduled tip</small></div>
      <div><span>High confidence</span><b>${high}</b><small>probability + data-depth tier</small></div>
      <div><span>Live record</span><b>${record ? `${record.wins}-${record.losses}` : '—'}</b><small>${record ? `${record.pending} pending · ${record.graded} graded` : 'official ledger'}</small></div>
    </div>
    <div class="pbe-command-links">
      <a href="/edge-timeline"><b>PBE Edge Timeline</b><span>First read → latest → lock</span></a>
      <a href="/scenario-lab"><b>Scenario Lab</b><span>Base · support · counter · market</span></a>
      <a href="/rotation-impact"><b>Rotation Impact</b><span>Availability · workload · opportunity</span></a>
      <a href="/watchlist"><b>Watchlist & Live Alerts</b><span>Your teams · one signal board</span></a>
      <a href="/player-load"><b>Player Load Intelligence</b><span>Workload · density · turnaround</span></a>
      <a href="/matchups"><b>Matchup Research</b><span>Form · rest · rotations</span></a>
      <a href="/injuries"><b>Availability</b><span>Sourced injury context</span></a>
      <a href="/track-record"><b>Track Record</b><span>Every official locked call</span></a>
      <a href="/pbe-picks/model"><b>Model Lab</b><span>Validation · methodology · limits</span></a>
      <a href="/brief"><b>Free Daily Brief</b><span>Public funnel · slate · coverage · changes</span></a>
    </div>
    <div class="pbe-truth-panel">
      <div><b>Board signal</b><p>${biggest && picked ? `Largest current model-market disagreement: ${teamName(picked)} ${edge(biggest.market.pbe_edge_pts)}. This is disagreement with the de-vigged market, not a guaranteed betting edge.` : 'No current call has a stored multi-book market consensus, so no model-market disagreement is displayed.'}${nextLock ? ` Next pre-lock call freezes at ${fmtTimeET(nextLock.lock_at)}.` : ''}</p></div>
      <div><b>Model transparency</b><p>${model?.market_benchmark_note || 'PBE publishes its benchmark and known limits alongside its calls rather than presenting model probability as certainty.'}</p>${model?.holdout ? html`<div class="pbe-truth-metrics"><span>Holdout n<strong>${model.holdout.n ?? '—'}</strong></span><span>Log loss<strong>${n3(model.holdout.log_loss)}</strong></span><span>Brier<strong>${n3(model.holdout.brier)}</strong></span><span>Accuracy<strong>${pc(model.holdout.accuracy)}</strong></span></div>` : ''}</div>
    </div>
  </section>`;
}

function researchStack() {
  return html`<section class="card card-pad section"><span class="eyebrow">WNBA Pro research stack</span><h2 style="margin-top:8px">PBE Picks is the decision layer — not a lonely pick card.</h2><div class="pill-row" style="margin-top:14px"><a class="pill" href="/edge-timeline">Edge Timeline</a><a class="pill" href="/scenario-lab">Scenario Lab</a><a class="pill" href="/rotation-impact">Rotation Impact</a><a class="pill" href="/watchlist">Watchlist</a><a class="pill" href="/player-load">Player Load</a><a class="pill" href="/matchups">Matchups</a><a class="pill" href="/injuries">Availability</a><a class="pill" href="/track-record">Track Record</a><a class="pill" href="/pbe-picks/model">Model methodology</a></div></section>`;
}

function pickTeam(item) {
  if (!item?.pick_team_id) return null;
  return String(item.pick_team_id) === String(item.game.home_team_id)
    ? { team_id: item.game.home_team_id, ...(item.game.home || {}) }
    : { team_id: item.game.away_team_id, ...(item.game.away || {}) };
}

function teaserView(cov, acct) {
  const games = cov.ok ? cov.data.games || [] : [];
  const published = cov.ok && cov.data.published;
  const signedIn = acct.ok && acct.data?.state === 'free';
  return html`${pbePicksPublicView()}
    <section class="pbe-card pbe-teaser pbe-upcoming-window">
      <div class="pbe-head"><span class="pbe-eyebrow">Current PBE window</span><span class="pbe-lock">WNBA Pro</span></div>
      <div class="pbe-teaser-body"><b>${published ? 'Live model calls are on the other side of WNBA Pro' : 'PBE model window'}</b><span>The public view shows only covered games and tip times. Probabilities, market disagreement, confidence and reasoning are entitlement-gated.</span></div>
      ${games.length ? html`<div class="pbe-teaser-list">${games.map((g) => html`<div class="pbe-teaser-row"><div class="m"><a href="/teams/${g.away_team_id}">${teamLogo({ team_id: g.away_team_id }, 26)}<span>${teamName({ team_id: g.away_team_id }, { short: true })}</span></a><em class="note">at</em><a href="/teams/${g.home_team_id}"><span>${teamName({ team_id: g.home_team_id }, { short: true })}</span>${teamLogo({ team_id: g.home_team_id }, 26)}</a></div><small><a href="/matchups/${g.game_id}">${fmtDateET(g.scheduled_tip_utc)} · ${fmtTimeET(g.scheduled_tip_utc)} →</a></small></div>`)}</div>` : html`<div class="pbe-empty" style="margin-top:14px">No covered games are in the current public window.</div>`}
      <div class="pbe-public-actions" style="margin-top:14px"><a class="btn gold pbe-cta" href="/pro?next=%2Fpbe-picks">${signedIn ? 'Upgrade to WNBA Pro' : 'Unlock the full PBE board'}</a><a class="btn" href="/brief">Read the free Daily Brief</a></div>
    </section>`;
}
