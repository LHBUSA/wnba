import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { routeMeta } from '../seo/meta.js';
import { playerLoadPublicView } from '../views/player-load.js';

const BAND_ORDER = ['EXTREME', 'HEAVY', 'ELEVATED', 'NORMAL', 'LIGHT'];
const fmt = (v, suffix = '') => v === null || v === undefined ? '—' : `${v}${suffix}`;

function customMeta() {
  const base = routeMeta('pro', { path: '/player-load' });
  return {
    ...base,
    path: '/player-load',
    url: 'https://wnba.propbetedge.ai/player-load',
    title: 'WNBA Player Load Intelligence: Workload, Rest & Rotation Pressure | PropBetEdge',
    description: 'WNBA Pro Player Load Intelligence: a 0–100 workload and schedule-pressure index built from recent minutes, game density, turnaround, overtime and rotation context.'
  };
}

export async function mount(root, ctx) {
  ctx.setMeta(customMeta());
  render(root, skeleton(520));
  const res = await api.playerLoad();
  if (!ctx.isCurrent()) return;

  if (!res.ok && (res.status === 401 || res.status === 403 || res.error?.code === 'wnba_pro_required')) {
    render(root, playerLoadPublicView());
    return;
  }
  if (!res.ok) {
    render(root, html`<section class="pl-shell"><div class="empty err"><h3>Player Load is warming up</h3><p>${res.error?.message || 'The latest workload snapshot is not available yet. No stand-in values are shown.'}</p></div></section>`);
    return;
  }

  const d = res.data;
  let team = 'all';
  let band = 'all';
  let search = '';
  const teams = [...new Map((d.players || []).map((p) => [p.team?.team_id, p.team]).filter(([id]) => id)).values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const draw = () => {
    const q = search.trim().toLowerCase();
    const rows = (d.players || []).filter((p) =>
      (team === 'all' || p.team?.team_id === team) &&
      (band === 'all' || p.band === band) &&
      (!q || String(p.name || '').toLowerCase().includes(q) || String(p.team?.name || '').toLowerCase().includes(q))
    );
    render(root, html`
      <section class="pl-shell">
        <header class="pl-hero">
          <div>
            <span class="eyebrow">WNBA Pro · Player Intelligence</span>
            <h1>Player <span>Load</span></h1>
            <p class="lead">A live 0–100 workload and schedule-pressure board. Higher scores mean more recent minutes, denser scheduling, shorter turnaround or overtime pressure — not a medical diagnosis and not a guaranteed betting signal.</p>
          </div>
          <div class="pl-snapshot">
            <span>Snapshot</span>
            <b>${d.summary?.players ?? 0}</b>
            <small>players monitored</small>
            <em>${d.summary?.heavy_or_extreme ?? 0} heavy / extreme</em>
          </div>
        </header>

        <div class="pl-toolbar">
          <label>Search<input type="search" value="${search}" placeholder="Player or team" data-pl-search /></label>
          <label>Team<select data-pl-team><option value="all">All teams</option>${teams.map((t) => html`<option value="${t.team_id}" ${team === t.team_id ? 'selected' : ''}>${t.name || t.abbr || t.team_id}</option>`)}</select></label>
          <label>Load band<select data-pl-band><option value="all">All bands</option>${BAND_ORDER.map((b) => html`<option value="${b}" ${band === b ? 'selected' : ''}>${b}</option>`)}</select></label>
          <div class="pl-fresh"><span>${d.stale ? 'STALE SNAPSHOT' : 'LIVE SNAPSHOT'}</span><small>${d.coverage?.finals_archived ?? '—'}/${d.coverage?.finals_expected ?? '—'} recent finals archived</small></div>
        </div>

        <div class="pl-band-key">${BAND_ORDER.map((b) => html`<span class="pl-band pl-${b.toLowerCase()}">${b}</span>`)}</div>

        ${rows.length ? html`<div class="pl-grid">${rows.map((p) => card(p))}</div>` : html`<div class="empty"><h3>No players match those filters</h3><p>Clear a team, band or search filter.</p></div>`}

        <footer class="pl-method-note">
          <b>How Player Load works</b>
          <p>${d.disclaimer}</p>
          <span>Score inputs: recent minutes · 7-day game density · three-game minutes · change vs 10-game baseline · tip-to-tip turnaround · overtime. Current injury status is context only and does not change the score.</span>
        </footer>
      </section>
    `);
    root.querySelector('[data-pl-search]')?.addEventListener('input', (e) => { search = e.target.value; draw(); });
    root.querySelector('[data-pl-team]')?.addEventListener('change', (e) => { team = e.target.value; draw(); });
    root.querySelector('[data-pl-band]')?.addEventListener('change', (e) => { band = e.target.value; draw(); });
  };

  draw();
}

function card(p) {
  const m = p.metrics || {};
  const availability = p.availability?.status ? html`<span class="pl-context">Availability: <b>${p.availability.status}</b></span>` : '';
  return html`<article class="pl-card pl-card-${String(p.band || 'LIGHT').toLowerCase()}">
    <div class="pl-card-head">
      <div class="pl-player-id">${teamLogo(p.team || {}, 36)}<div><a href="/players/${p.athlete_id}">${p.name || `Player ${p.athlete_id}`}</a><span>${p.team?.abbr || p.team?.short_name || p.team?.name || ''}${p.position ? ` · ${p.position}` : ''}</span></div></div>
      <div class="pl-score"><b>${p.score}</b><span class="pl-band pl-${String(p.band || 'LIGHT').toLowerCase()}">${p.band}</span></div>
    </div>
    <div class="pl-metrics">
      <div><span>Last game</span><b>${fmt(m.last_game_minutes, ' min')}</b></div>
      <div><span>Avg L3</span><b>${fmt(m.avg_minutes_last3, ' min')}</b></div>
      <div><span>7-day load</span><b>${fmt(m.minutes_7d, ' min')}</b></div>
      <div><span>Games / 5d</span><b>${fmt(m.games_5d)}</b></div>
      <div><span>Turnaround</span><b>${fmt(m.turnaround_hours, 'h')}</b></div>
      <div><span>Rotation 12+</span><b>${fmt(m.recent_rotation_depth_12plus)}</b></div>
    </div>
    ${p.signals?.length ? html`<div class="pl-signals">${p.signals.slice(0, 4).map((s) => html`<span>${s}</span>`)}</div>` : html`<div class="pl-signals"><span>No elevated workload driver beyond the score inputs.</span></div>`}
    ${availability}
  </article>`;
}
