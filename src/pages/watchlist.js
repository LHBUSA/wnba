import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { proApi } from '../data/pro-api.js';
import { skeleton } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { teamName } from '../ui/pbe.js';
import { routeMeta } from '../seo/meta.js';
import { intelligenceFeature } from '../data/pro-features.js';
import { proFeaturePublicView, proSuiteRail, proUnavailableView } from '../views/pro-intelligence.js';

const FEATURE = intelligenceFeature('watchlist');
const severe = (s) => /out|doubtful|suspended|inactive/i.test(String(s || ''));
const edge = (x) => Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pts` : '—';

function meta() {
  return routeMeta('watchlist', { path: FEATURE.href });
}

export async function mount(root, ctx) {
  ctx.setMeta(meta());
  render(root, html`<section class="pi-shell">${skeleton(500)}</section>`);
  const account = await api.account();
  if (!ctx.isCurrent()) return;
  if (!(account.ok && account.data?.state === 'pro')) return render(root, proFeaturePublicView(FEATURE, { signedIn: account.ok && account.data?.state === 'free' }));

  const [saved, teams, picks, load, injuries] = await Promise.all([
    proApi.watchlist(), api.teams(), api.pbePicks(), api.playerLoad(), api.injuries()
  ]);
  if (!ctx.isCurrent()) return;
  if (!saved.ok) return render(root, proUnavailableView(FEATURE, saved.error?.message));

  const allTeams = teams.ok ? teams.data?.teams || [] : [];
  let selected = new Set((saved.data?.team_ids || []).map(String));
  let threshold = Number(saved.data?.edge_threshold_pts ?? 5);
  let status = '';
  let saving = false;

  const save = async () => {
    saving = true; status = ''; draw();
    const res = await proApi.saveWatchlist({ team_ids: [...selected], edge_threshold_pts: threshold });
    saving = false;
    status = res.ok ? 'Watchlist saved.' : (res.error?.message || 'Could not save watchlist.');
    draw();
  };

  const draw = () => {
    const alerts = buildAlerts({ selected, threshold, picks, load, injuries });
    render(root, html`<section class="pi-shell">
      ${proSuiteRail(FEATURE.id)}
      <header class="pi-hero"><div><span class="eyebrow">WNBA Pro · Monitor what matters</span><h1>Watchlist & <span>Live Alerts</span></h1><p class="lead">Save the teams you care about and pull their current PBE, Player Load and availability signals into one live board. This first release is in-app monitoring; it does not claim email or push delivery that is not enabled yet.</p></div><aside><span>Watched teams</span><b>${selected.size}</b><small>${alerts.length} live signal${alerts.length === 1 ? '' : 's'} right now</small><em>Server-saved WNBA Pro preferences</em></aside></header>

      <div class="wl-layout">
        <section class="wl-settings"><div class="db-card-head"><div><span class="eyebrow">Your watchlist</span><h2>Choose up to 6 teams</h2></div></div>
          <div class="wl-team-grid">${allTeams.map((t) => html`<button type="button" data-team="${t.team_id}" aria-pressed="${selected.has(String(t.team_id))}" class="${selected.has(String(t.team_id)) ? 'on' : ''}">${teamLogo(t, 28)}<span>${t.short_name || t.name || t.abbr}</span></button>`)}</div>
          <label class="wl-threshold"><span>PBE gap alert threshold</span><input type="number" min="0" max="25" step="0.5" value="${threshold}" data-threshold /><b>probability pts</b></label>
          <button class="btn gold block" type="button" data-save ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save Watchlist'}</button>${status ? html`<p class="wl-status">${status}</p>` : ''}
        </section>

        <section class="wl-alerts"><div class="db-card-head"><div><span class="eyebrow">Live alert board</span><h2>Signals on watched teams</h2></div><span>${alerts.length}</span></div>
          ${selected.size === 0 ? html`<div class="pi-status-card"><b>Build your watchlist.</b><p>Select teams on the left. WNBA Pro will then consolidate their current PBE calls, high Player Load readings and sourced availability listings here.</p></div>` : alerts.length ? html`<div class="wl-alert-list">${alerts.map(alertRow)}</div>` : html`<div class="pi-status-card"><b>No active alert conditions right now.</b><p>Your teams are saved. The board remains quiet until a current PBE, Player Load or availability signal meets the display rules.</p></div>`}
        </section>
      </div>
      <section class="pi-explain"><h2>What counts as a live alert</h2><p>A watched team surfaces here when it has a current PBE call, an absolute model-market gap at or above your threshold, a Heavy/Extreme Player Load player, or a sourced availability listing. Alerts summarize existing data; they do not create new predictions.</p></section>
    </section>`);

    root.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => {
      const id = String(b.dataset.team);
      if (selected.has(id)) selected.delete(id);
      else if (selected.size < 6) selected.add(id);
      else status = 'Watchlists are limited to 6 teams for this release.';
      draw();
    }));
    root.querySelector('[data-threshold]')?.addEventListener('change', (e) => { threshold = Math.max(0, Math.min(25, Number(e.target.value) || 0)); draw(); });
    root.querySelector('[data-save]')?.addEventListener('click', save);
  };
  draw();
}

function buildAlerts({ selected, threshold, picks, load, injuries }) {
  const out = [];
  if (picks.ok) for (const p of picks.data?.picks || []) {
    const teams = [String(p.game?.home_team_id || ''), String(p.game?.away_team_id || '')];
    const watched = teams.find((id) => selected.has(id));
    if (!watched) continue;
    if (p.call === 'PICK') out.push({ type: 'PBE CALL', level: 'model', team_id: watched, title: `Current PBE call: ${teamName(p.game?.home_team_id === p.pick_team_id ? { team_id: p.game.home_team_id, ...(p.game.home || {}) } : { team_id: p.game.away_team_id, ...(p.game.away || {}) })}`, detail: `${(p.pick_probability * 100).toFixed(1)}% · ${p.confidence || '—'} confidence`, href: '/pbe-picks' });
    if (Number.isFinite(p.market?.pbe_edge_pts) && Math.abs(p.market.pbe_edge_pts) >= threshold) out.push({ type: 'PBE GAP', level: 'edge', team_id: watched, title: `Model-market disagreement ${edge(p.market.pbe_edge_pts)}`, detail: `Threshold ${threshold.toFixed(1)} pts · ${p.market.book_count || 0} books`, href: '/edge-timeline' });
  }
  if (load.ok) for (const p of load.data?.players || []) {
    if (!selected.has(String(p.team?.team_id || '')) || !['HEAVY', 'EXTREME'].includes(p.band)) continue;
    out.push({ type: 'PLAYER LOAD', level: 'load', team_id: String(p.team.team_id), title: `${p.name} · ${p.score} ${p.band}`, detail: (p.signals || []).slice(0, 2).join(' · ') || 'Elevated workload pressure', href: `/players/${p.athlete_id}` });
  }
  if (injuries.ok) for (const x of injuries.data?.items || []) {
    if (!selected.has(String(x.team_id || '')) || !x.status) continue;
    out.push({ type: 'AVAILABILITY', level: severe(x.status) ? 'high' : 'availability', team_id: String(x.team_id), title: `${x.name || x.athlete_name || 'Player'} · ${x.status}`, detail: x.detail || x.description || 'Sourced availability listing', href: x.athlete_id ? `/players/${x.athlete_id}` : '/injuries' });
  }
  return out.slice(0, 40);
}

function alertRow(a) {
  return html`<a class="wl-alert ${a.level}" href="${a.href}"><span>${a.type}</span>${teamLogo({ team_id: a.team_id }, 30)}<div><b>${a.title}</b><small>${a.detail}</small></div><em>Open →</em></a>`;
}
