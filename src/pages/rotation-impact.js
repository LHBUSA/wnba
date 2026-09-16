import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { routeMeta } from '../seo/meta.js';
import { intelligenceFeature } from '../data/pro-features.js';
import { proFeaturePublicView, proSuiteRail, proUnavailableView } from '../views/pro-intelligence.js';

const FEATURE = intelligenceFeature('rotation-impact');
const severe = (s) => /out|doubtful|suspended|inactive/i.test(String(s || ''));
const activeLike = (s) => !severe(s);
const loadRank = { EXTREME: 5, HEAVY: 4, ELEVATED: 3, NORMAL: 2, LIGHT: 1 };

function meta() {
  const base = routeMeta('pro', { path: FEATURE.href });
  return { ...base, path: FEATURE.href, url: `https://wnba.propbetedge.ai${FEATURE.href}`, title: 'WNBA Rotation Impact: Availability, Workload & Opportunity Pressure | PropBetEdge', description: 'WNBA Pro Rotation Impact combines Player Load, sourced availability and recent baseline minutes into a team-by-team rotation pressure desk.' };
}

export async function mount(root, ctx) {
  ctx.setMeta(meta());
  render(root, html`<section class="pi-shell">${skeleton(520)}</section>`);
  const account = await api.account();
  if (!ctx.isCurrent()) return;
  if (!(account.ok && account.data?.state === 'pro')) return render(root, proFeaturePublicView(FEATURE, { signedIn: account.ok && account.data?.state === 'free' }));

  const [load, injuries, teams] = await Promise.all([api.playerLoad(), api.injuries(), api.teams()]);
  if (!ctx.isCurrent()) return;
  if (!load.ok) return render(root, proUnavailableView(FEATURE, load.error?.message));

  const players = load.data?.players || [];
  const injuryItems = injuries.ok ? injuries.data?.items || [] : [];
  const teamRows = new Map();
  for (const p of players) {
    const id = String(p.team?.team_id || '');
    if (!id) continue;
    const row = teamRows.get(id) || { team: p.team || { team_id: id }, players: [], injuries: [] };
    row.players.push(p);
    teamRows.set(id, row);
  }
  for (const x of injuryItems) {
    const id = String(x.team_id || '');
    if (!id) continue;
    const row = teamRows.get(id) || { team: { team_id: id }, players: [], injuries: [] };
    row.injuries.push(x);
    teamRows.set(id, row);
  }
  if (teams.ok) for (const t of teams.data?.teams || []) {
    const id = String(t.team_id || '');
    if (teamRows.has(id)) teamRows.get(id).team = { ...t, ...teamRows.get(id).team };
  }

  const rows = [...teamRows.values()].map((r) => {
    r.players.sort((a, b) => (loadRank[b.band] || 0) - (loadRank[a.band] || 0) || (b.score || 0) - (a.score || 0));
    r.injuries.sort((a, b) => Number(severe(b.status)) - Number(severe(a.status)));
    r.heavy = r.players.filter((p) => ['HEAVY', 'EXTREME'].includes(p.band)).length;
    r.unavailable = r.injuries.filter((x) => severe(x.status)).length;
    const unavailableIds = new Set(r.injuries.filter((x) => severe(x.status)).map((x) => String(x.athlete_id || '')));
    r.coverage = r.players
      .filter((p) => !unavailableIds.has(String(p.athlete_id)) && activeLike(p.availability?.status))
      .sort((a, b) => (b.metrics?.baseline_minutes_last10 || 0) - (a.metrics?.baseline_minutes_last10 || 0))
      .slice(0, 4);
    return r;
  }).sort((a, b) => (b.unavailable - a.unavailable) || (b.heavy - a.heavy) || String(a.team?.name || '').localeCompare(String(b.team?.name || '')));

  let teamFilter = '';
  const draw = () => {
    const shown = rows.filter((r) => !teamFilter || String(r.team.team_id) === teamFilter);
    render(root, html`<section class="pi-shell">
      ${proSuiteRail(FEATURE.id)}
      <header class="pi-hero"><div><span class="eyebrow">WNBA Pro · Opportunity pressure</span><h1>Rotation <span>Impact</span></h1><p class="lead">A team-by-team view of where recent workload and sourced availability could concentrate minutes pressure. It identifies context and likely workload absorbers from recent baseline minutes — it does not pretend to know a coach's future rotation.</p></div><aside><span>Teams monitored</span><b>${rows.length}</b><small>${rows.reduce((n, r) => n + r.unavailable, 0)} currently unavailable listings</small><em>${rows.reduce((n, r) => n + r.heavy, 0)} heavy / extreme loads</em></aside></header>

      <div class="pi-selector"><label>Team<select data-team><option value="">All teams</option>${rows.map((r) => html`<option value="${r.team.team_id}" ${teamFilter === String(r.team.team_id) ? 'selected' : ''}>${r.team.name || r.team.short_name || r.team.abbr || r.team.team_id}</option>`)}</select></label><div class="pi-selector-links"><a href="/player-load">Player Load →</a><a href="/injuries">Availability →</a></div></div>

      <div class="ri-grid">${shown.map((r) => teamCard(r))}</div>
      <section class="pi-explain"><h2>How to use Rotation Impact</h2><p>Start with teams carrying unavailable players or multiple Heavy/Extreme Player Load scores. Then look at the highest recent baseline-minute players who remain active-like. Those names are workload-coverage candidates, not projected minute gains. Availability is sourced context; Player Load remains a separate deterministic metric.</p></section>
    </section>`);
    root.querySelector('[data-team]')?.addEventListener('change', (e) => { teamFilter = e.target.value; draw(); });
  };
  draw();
}

function teamCard(r) {
  const t = r.team || {};
  const highest = r.players.slice(0, 3);
  const impacted = r.injuries.slice(0, 4);
  return html`<article class="ri-card">
    <header><a href="/teams/${t.team_id}">${teamLogo(t, 42)}<span><b>${t.name || t.short_name || t.abbr || t.team_id}</b><small>Team intelligence →</small></span></a><div><strong>${r.unavailable}</strong><span>unavailable</span><strong>${r.heavy}</strong><span>heavy+</span></div></header>
    <div class="ri-columns">
      <section><h3>Pressure points</h3>${impacted.length ? impacted.map((x) => html`<a class="ri-player" href="${x.athlete_id ? `/players/${x.athlete_id}` : '/injuries'}"><span>${x.name || x.athlete_name || 'Player'}</span><b>${x.status || 'listed'}</b></a>`) : html`<p>No current injury-feed listings for this team.</p>`}</section>
      <section><h3>Highest Player Load</h3>${highest.length ? highest.map((p) => html`<a class="ri-player" href="/players/${p.athlete_id}"><span>${p.name}</span><b>${p.score} · ${p.band}</b></a>`) : html`<p>No Player Load values are available for this team yet.</p>`}</section>
    </div>
    <div class="ri-coverage"><h3>Workload coverage candidates</h3><p>Highest recent 10-game baseline minutes among current active-like players.</p><div>${r.coverage.length ? r.coverage.map((p) => html`<a href="/players/${p.athlete_id}"><b>${p.name}</b><span>${p.metrics?.baseline_minutes_last10 ?? '—'} min baseline · Load ${p.score}</span></a>`) : html`<span>No eligible coverage candidates in the current snapshot.</span>`}</div></div>
  </article>`;
}
