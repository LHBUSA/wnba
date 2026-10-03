// Live track record: official locked calls only, graded from the final score. The aggregate is public; the
// per-game ledger is WNBA Pro and comes from a separate endpoint that checks entitlement first.
import { html, render, raw } from '../lib/dom.js';
import { allAccessHeroHtml, allAccessDividerHtml } from '../ui/all-access.js';
import { membershipFrom } from '../lib/membership.js';
import { api } from '../data/api.js';
import { pageHead, errorState, skeleton } from '../ui/components.js';
import { fmtDateET, fmtTimeET, american } from '../lib/format.js';
import { teamName } from '../ui/pbe.js';
import { loadAlgoVsMarket, trackAvmMarkup, within, AVM_POLL_MS } from '../data/kalshi.js';

export const title = () => 'Track record';
export const description = () => 'Every official PBE WNBA locked call, graded from the final score. Wins and losses stay on the board; backtests are never counted.';

const pc = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const TRACK_REFRESH_MS = 10_000;

function normalizeTrackData(d) {
  if (d?.record === undefined && Number.isInteger(d?.picks_recorded)) {
    d.record = { official_locks: d.picks_recorded, picks: d.picks_recorded, no_calls: 0, graded: d.graded, pending: d.pending, voided: 0, wins: d.wins, losses: d.losses, hit_rate: null, brier: null, calibration: null, calibration_note: 'Calibration is shown from 50 graded picks.', sample_note: null };
    d.starts = 'The live record starts at 0-0 with the first official locked pick. Backtests are never counted here.';
  }
  return d;
}

function trackSummary(d) {
  const r = d?.record;
  if (!r) return html`<div class="pbe-empty">The official ledger is ${d?.ledger_status === 'NOT_CONNECTED' ? 'not connected to this service yet' : 'temporarily unreachable'}. No record is shown rather than a guessed one.</div>`;
  return html`<div class="tr-tiles">
      <div class="tile"><small>Official locks</small><b>${r.official_locks}</b><span>${r.picks} picks · ${r.no_calls} no calls</span></div>
      <div class="tile"><small>Record</small><b>${r.wins}-${r.losses}</b><span>${r.pending} pending${r.voided ? ` · ${r.voided} void` : ''}</span></div>
      <div class="tile"><small>Hit rate</small><b>${pc(r.hit_rate)}</b><span>n = ${r.graded}</span></div>
      <div class="tile"><small>Brier</small><b>${Number.isFinite(r.brier) ? r.brier.toFixed(3) : '—'}</b><span>lower is better · coin flip 0.250</span></div>
    </div>
    ${r.sample_note ? html`<p class="note" style="margin-top:10px">${r.sample_note}</p>` : ''}
    ${r.calibration ? html`<section class="card section"><div class="card-head"><span class="card-title">Calibration</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Probability</th><th>Picks</th><th>Avg probability</th><th>Hit rate</th></tr></thead><tbody>${r.calibration.map((b) => html`<tr><td class="l">${pc(b.from)}–${pc(b.to)}</td><td>${b.n}</td><td>${pc(b.mean_probability)}</td><td>${pc(b.hit_rate)}</td></tr>`)}</tbody></table></div></section>` : html`<p class="note" style="margin-top:6px">${r.calibration_note}</p>`}`;
}

const avmTeam = (teamId) => teamName({ team_id: teamId }, { short: true });

export async function mount(root, ctx) {
  const head = pageHead({ eyebrow: 'PBE Picks', title: 'Live track record', sub: 'Every official locked call, graded from the final score. Wins and losses stay on the board. The backtest lives on How the Model Works and is never counted here.', right: html`<div class="pbe-links"><a class="pill" href="/pbe-picks">PBE Picks</a><a class="pill" href="/pbe-picks/model">How the Model Works</a></div>` });
  render(root, html`${head}${skeleton(300)}`);
  const avmLoad = loadAlgoVsMarket();
  const [res, acct] = await Promise.all([api.trackRecord(), api.account()]);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, html`${head}${errorState(res, 'The track record')}`);
  const d = normalizeTrackData(res.data);
  const r = d.record;

  let ledgerRows = [];
  let ledger = html`<section class="pbe-card pbe-teaser"><div class="pbe-head"><span class="pbe-eyebrow">Full call ledger</span><span class="pbe-lock">WNBA Pro</span></div><div class="pbe-teaser-body"><b>Every locked call, game by game</b><span>Original probability · opponent · market comparison · PBE Edge · locked time · result · model version</span></div>${raw(allAccessHeroHtml(membershipFrom(acct), { variant: 'compact' }))}${raw(allAccessDividerHtml())}<a class="btn gold pbe-cta" href="/pro?next=%2Ftrack-record">Unlock WNBA Pro</a></section>`;
  if (acct.ok && acct.data?.state === 'pro') {
    const L = await api.trackRecordLedger();
    if (!ctx.isCurrent()) return;
    if (L.ok && L.data.availability === 'MODEL_IN_VALIDATION') ledger = html`<p class="note">The per-game ledger fills from the first official lock.</p>`;
    else if (L.ok) { ledger = ledgerTable(L.data); ledgerRows = L.data.rows || []; }
  }
  // Bounded first-paint wait (it was requested with the record, so it is normally already here).
  let avmBody = await within(avmLoad, 800);
  if (!ctx.isCurrent()) return;
  const avmFirst = trackAvmMarkup(avmBody ?? null, ledgerRows, avmTeam);

  render(root, html`${head}
    <div class="section" data-track-summary>${trackSummary(d)}</div>
    <div class="${avmFirst ? 'section' : ''}" data-track-avm>${raw(avmFirst)}</div>
    ${r && r.official_locks === 0 ? html`<div class="callout section">${d.starts}</div>` : ''}
    <div class="section" data-track-ledger>${ledger}</div>
    <section class="card card-pad section"><span class="eyebrow">Ledger rules</span><ul class="pro-list">
      <li>A call is official only once it is locked, 15 minutes before scheduled tip.</li>
      <li>After the lock, the pick, probability, inputs, reasoning and market comparison can never change. The database rejects edits and deletions.</li>
      <li>Grades come from the final score. A correction is added as a new revision; the original grade stays visible.</li>
      <li>Losing calls are never removed. Backtests are never counted.</li>
    </ul></section>`);

  let avmShown = avmFirst;
  const paintAvm = (markup) => {
    const host = root.querySelector('[data-track-avm]');
    if (!host || markup === avmShown) return;
    avmShown = markup;
    host.innerHTML = markup;
    host.classList.toggle('section', Boolean(markup));
  };
  if (avmBody === undefined) avmLoad.then((b) => { if (!ctx.isCurrent()) return; avmBody = b; paintAvm(trackAvmMarkup(b, ledgerRows, avmTeam)); });
  let avmAt = Date.now();

  let refreshing = false;
  const pro = acct.ok && acct.data?.state === 'pro';
  const refresh = async () => {
    if (refreshing || !ctx.isCurrent()) return;
    refreshing = true;
    try {
      const [nextTrack, nextLedger] = await Promise.all([
        api.trackRecord(),
        pro ? api.trackRecordLedger() : Promise.resolve(null)
      ]);
      if (!ctx.isCurrent()) return;
      if (nextTrack?.ok) {
        const next = normalizeTrackData(nextTrack.data);
        const host = root.querySelector('[data-track-summary]');
        if (host) render(host, trackSummary(next));
      }
      if (Date.now() - avmAt >= AVM_POLL_MS) {
        avmAt = Date.now();
        const nextAvm = await loadAlgoVsMarket();
        if (!ctx.isCurrent()) return;
        if (nextAvm) { avmBody = nextAvm; paintAvm(trackAvmMarkup(nextAvm, ledgerRows, avmTeam)); } // a failed read keeps what is shown
      }
      if (pro && nextLedger?.ok) {
        if (nextLedger.data?.rows) ledgerRows = nextLedger.data.rows;
        const host = root.querySelector('[data-track-ledger]');
        if (host) render(host, nextLedger.data.availability === 'MODEL_IN_VALIDATION'
          ? html`<p class="note">The per-game ledger fills from the first official lock.</p>`
          : ledgerTable(nextLedger.data));
      }
    } catch (error) {
      console.warn('[track-record] live refresh failed', error);
    } finally {
      refreshing = false;
    }
  };
  const timer = setInterval(refresh, TRACK_REFRESH_MS);
  return () => clearInterval(timer);
}

function ledgerTable(data) {
  if (!data.rows.length) return html`<div class="pbe-empty">${data.shadow ? 'No shadow locks yet.' : 'No official locks yet. The first locked call starts the record at 0-0.'}</div>`;
  return html`<section class="card">
    <div class="card-head"><span class="card-title">${data.shadow ? 'Shadow ledger · owner only · not official' : 'Official call ledger'}</span></div>
    <div class="tbl-wrap"><table class="tbl tr-table"><thead><tr><th>Game</th><th>Pick</th><th>Prob</th><th>Market</th><th>De-vig</th><th>PBE Edge</th><th>Locked</th><th>Result</th><th>Model</th></tr></thead><tbody>
      ${data.rows.map((x) => html`<tr>
        <td class="l">${fmtDateET(x.game.scheduled_tip_utc, { month: 'short', day: 'numeric' })} ${teamName({ team_id: x.game.away_team_id }, { short: true })} @ ${teamName({ team_id: x.game.home_team_id }, { short: true })}</td>
        <td class="l">${x.call === 'PICK' ? teamName({ team_id: x.selected_team_id }, { short: true }) : 'No call'}</td>
        <td>${pc(x.win_probability)}</td><td>${american(x.consensus_moneyline)}</td><td>${pc(x.market_devig_probability)}</td>
        <td>${Number.isFinite(x.pbe_edge_pts) ? `${x.pbe_edge_pts > 0 ? '+' : ''}${x.pbe_edge_pts.toFixed(1)}` : '—'}</td>
        <td>${fmtTimeET(x.locked_at)}</td>
        <td class="${x.grade?.result || ''}">${x.grade ? `${x.grade.result.toUpperCase()}${x.grade.revision > 1 ? ` (rev ${x.grade.revision})` : ''}` : x.call === 'PICK' ? 'Pending' : '—'}</td>
        <td class="l">${x.model_id}</td>
      </tr>`)}
    </tbody></table></div></section>`;
}
