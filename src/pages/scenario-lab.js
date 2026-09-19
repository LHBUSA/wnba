import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { teamName } from '../ui/pbe.js';
import { routeMeta } from '../seo/meta.js';
import { intelligenceFeature } from '../data/pro-features.js';
import { proFeaturePublicView, proSuiteRail, proUnavailableView } from '../views/pro-intelligence.js';

const FEATURE = intelligenceFeature('scenario-lab');
const pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
const pts = (x) => Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pts` : '—';
const sumImpact = (rows = []) => rows.reduce((n, r) => n + (Number(r.impact_pts) || 0), 0);

function meta() {
  return routeMeta('scenario-lab', { path: FEATURE.href });
}

function sideTeam(item, id) {
  const g = item.game;
  return String(id) === String(g.home_team_id) ? { team_id: g.home_team_id, ...(g.home || {}) } : { team_id: g.away_team_id, ...(g.away || {}) };
}

export async function mount(root, ctx) {
  ctx.setMeta(meta());
  render(root, html`<section class="pi-shell">${skeleton(500)}</section>`);
  const account = await api.account();
  if (!ctx.isCurrent()) return;
  if (!(account.ok && account.data?.state === 'pro')) return render(root, proFeaturePublicView(FEATURE, { signedIn: account.ok && account.data?.state === 'free' }));

  const res = await api.pbePicks();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, proUnavailableView(FEATURE, res.error?.message));
  const picks = (res.data?.picks || []).filter((p) => p.call === 'PICK');
  let selected = picks[0]?.game?.game_id ? String(picks[0].game.game_id) : '';

  const draw = () => {
    const item = picks.find((p) => String(p.game.game_id) === selected) || null;
    render(root, html`<section class="pi-shell">
      ${proSuiteRail(FEATURE.id)}
      <header class="pi-hero"><div><span class="eyebrow">WNBA Pro · Game paths</span><h1>PBE Scenario <span>Lab</span></h1><p class="lead">Turn a pick into a decision map. Scenario Lab v1 uses the model's actual supporting and opposing feature contributions plus the current market benchmark. It does not manufacture a Monte Carlo distribution that the model does not run.</p></div><aside><span>Current picks</span><b>${picks.length}</b><small>eligible calls in the live PBE window</small><em>Evidence paths · not synthetic sims</em></aside></header>

      <div class="pi-selector"><label>Game<select data-game><option value="">Choose a PBE pick</option>${picks.map((p) => html`<option value="${p.game.game_id}" ${selected === String(p.game.game_id) ? 'selected' : ''}>${teamName({ team_id: p.game.away_team_id, ...(p.game.away || {}) }, { short: true })} @ ${teamName({ team_id: p.game.home_team_id, ...(p.game.home || {}) }, { short: true })}</option>`)}</select></label>${item ? html`<div class="pi-selector-links"><a href="/matchups/${item.game.game_id}">Matchup →</a><a href="/edge-timeline">Edge Timeline →</a></div>` : ''}</div>

      ${item ? scenario(item) : html`<div class="pi-status-card"><b>No current official pick is available.</b><p>Scenario Lab only opens a game once PBE has an eligible PICK. It will not turn NO_CALL into a forced prediction.</p><a class="btn" href="/pbe-picks">Open PBE Picks</a></div>`}
      <section class="pi-explain"><h2>Scenario Lab is an explanation layer</h2><p>The Base Case is the current PBE probability. Support and Counter paths are the model's real feature-contribution explanations. The Market path is the de-vigged sportsbook consensus comparison. These paths explain the call; they are not separate independently simulated forecasts.</p></section>
    </section>`);
    root.querySelector('[data-game]')?.addEventListener('change', (e) => { selected = e.target.value; draw(); });
  };
  draw();
}

function scenario(item) {
  const pick = sideTeam(item, item.pick_team_id);
  const opp = String(item.pick_team_id) === String(item.game.home_team_id)
    ? sideTeam(item, item.game.away_team_id)
    : sideTeam(item, item.game.home_team_id);
  const support = item.reasoning?.supporting || [];
  const oppose = item.reasoning?.opposing || [];
  const side = item.market?.pick_side ? item.market[item.market.pick_side] : null;
  const market = side?.devig_probability;
  const gap = item.market?.pbe_edge_pts;
  return html`<div class="sl-grid">
    <article class="sl-card base"><span>BASE CASE</span><div class="sl-team">${teamLogo(pick, 42)}<h2>${teamName(pick)}</h2></div><strong>${pct(item.pick_probability)}</strong><p>PBE's current independent win probability · ${item.confidence || '—'} confidence.</p><a href="/teams/${pick.team_id}">Open ${teamName(pick, { short: true })} intelligence →</a></article>
    <article class="sl-card support"><span>SUPPORT PATH</span><h2>If the model's strongest drivers hold</h2><b>${pts(sumImpact(support))}</b><ul>${support.length ? support.map((r) => html`<li><strong>${pts(r.impact_pts)}</strong><span>${r.text}</span></li>`) : html`<li><span>No single supporting factor dominates this call.</span></li>`}</ul></article>
    <article class="sl-card counter"><span>COUNTER PATH</span><h2>How ${teamName(opp, { short: true })} can break the call</h2><b>${pts(sumImpact(oppose))}</b><ul>${oppose.length ? oppose.map((r) => html`<li><strong>${pts(r.impact_pts)}</strong><span>${r.text}</span></li>`) : html`<li><span>No displayed factor meaningfully pushes against the pick.</span></li>`}</ul><a href="/teams/${opp.team_id}">Open ${teamName(opp, { short: true })} intelligence →</a></article>
    <article class="sl-card market"><span>MARKET PATH</span><h2>What the market says</h2>${item.market?.available ? html`<div class="sl-market"><div><small>PBE</small><b>${pct(item.pick_probability)}</b></div><div><small>De-vig market</small><b>${pct(market)}</b></div><div><small>Disagreement</small><b>${pts(gap)}</b></div></div><p>${item.market.book_count} books in the stored consensus. PBE Edge is disagreement with that benchmark, not guaranteed betting value.</p>` : html`<p>No stored multi-book market consensus is available for this game right now.</p>`}<a href="/props">Open Best Line board →</a></article>
  </div>`;
}
