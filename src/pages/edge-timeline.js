import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { proApi } from '../data/pro-api.js';
import { skeleton } from '../ui/components.js';
import { fmtDateET, fmtTimeET, relTime } from '../lib/format.js';
import { teamName } from '../ui/pbe.js';
import { intelligenceFeature } from '../data/pro-features.js';
import { proFeaturePublicView, proSuiteRail, proUnavailableView } from '../views/pro-intelligence.js';
import { routeMeta } from '../seo/meta.js';

const FEATURE = intelligenceFeature('edge-timeline');
const pc = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
const pts = (x) => Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pts` : '—';

function meta() {
  return routeMeta('edge-timeline', { path: FEATURE.href });
}

function gameLabel(item) {
  const g = item?.game || {};
  return `${teamName({ team_id: g.away_team_id, ...(g.away || {}) }, { short: true })} @ ${teamName({ team_id: g.home_team_id, ...(g.home || {}) }, { short: true })}`;
}

export async function mount(root, ctx) {
  ctx.setMeta(meta());
  render(root, html`<section class="pi-shell">${skeleton(420)}</section>`);
  const account = await api.account();
  if (!ctx.isCurrent()) return;
  if (!(account.ok && account.data?.state === 'pro')) return render(root, proFeaturePublicView(FEATURE, { signedIn: account.ok && account.data?.state === 'free' }));

  const picks = await api.pbePicks();
  if (!ctx.isCurrent()) return;
  if (!picks.ok) return render(root, proUnavailableView(FEATURE, picks.error?.message));
  const items = picks.data?.picks || [];
  let selected = items[0]?.game?.game_id ? String(items[0].game.game_id) : '';
  let timeline = null;
  let loading = false;

  const loadTimeline = async (id) => {
    if (!id) { timeline = { ok: true, data: { observations: [] } }; return; }
    loading = true; draw();
    timeline = await proApi.pbeTimeline(id);
    loading = false; draw();
  };

  const draw = () => {
    const current = items.find((x) => String(x.game?.game_id) === selected) || null;
    const rows = timeline?.ok ? timeline.data?.observations || [] : [];
    const first = rows[0] || null;
    const last = rows.at(-1) || null;
    const move = first && last ? (last.p_home - first.p_home) * 100 : null;
    const callChanges = rows.reduce((n, r, i) => i && r.call !== rows[i - 1].call ? n + 1 : n, 0);
    const featureChanges = rows.reduce((n, r, i) => i && r.feature_hash !== rows[i - 1].feature_hash ? n + 1 : n, 0);

    render(root, html`<section class="pi-shell">
      ${proSuiteRail(FEATURE.id)}
      <header class="pi-hero">
        <div><span class="eyebrow">WNBA Pro · Model movement</span><h1>PBE Edge <span>Timeline</span></h1><p class="lead">See the actual pre-lock observation history behind a game: when the model moved, whether the call changed, what the market benchmark looked like and what ultimately froze at lock.</p></div>
        <aside><span>Why it matters</span><b>${rows.length}</b><small>stored observations for this game</small><em>Append-only ledger</em></aside>
      </header>

      <div class="pi-selector"><label>Game<select data-game><option value="">Choose a covered game</option>${items.map((p) => html`<option value="${p.game.game_id}" ${selected === String(p.game.game_id) ? 'selected' : ''}>${gameLabel(p)} · ${fmtDateET(p.game.scheduled_tip_utc, { month: 'short', day: 'numeric' })}</option>`)}</select></label>${current ? html`<div class="pi-selector-links"><a href="/matchups/${current.game.game_id}">Matchup →</a><a href="/pbe-picks">PBE call →</a></div>` : ''}</div>

      ${loading ? html`<div class="pi-status-card"><b>Loading observation ledger…</b><p>The page keeps the product context visible while the protected timeline is read.</p></div>` : !selected ? html`<div class="pi-status-card"><b>No covered game selected.</b><p>Choose a game above. The timeline fills from real PBE observation rows; no synthetic movement is generated.</p></div>` : !timeline?.ok ? proUnavailableView(FEATURE, timeline?.error?.message) : html`
        <div class="pi-metrics">
          <div><span>First home probability</span><b>${pc(first?.p_home)}</b><small>${first?.recorded_at ? relTime(first.recorded_at) : '—'}</small></div>
          <div><span>Latest home probability</span><b>${pc(last?.p_home)}</b><small>${last?.recorded_at ? relTime(last.recorded_at) : '—'}</small></div>
          <div><span>Net model move</span><b>${move === null ? '—' : pts(move)}</b><small>home-side probability points</small></div>
          <div><span>State changes</span><b>${callChanges}</b><small>${featureChanges} feature-vector changes</small></div>
        </div>

        ${rows.length ? html`<div class="pi-timeline">
          ${rows.map((r, i) => html`<article class="pi-timeline-row">
            <div class="pi-time"><b>${fmtTimeET(r.recorded_at)}</b><span>${i === 0 ? 'FIRST READ' : i === rows.length - 1 ? 'LATEST' : `OBS ${i + 1}`}</span></div>
            <div><span>Home model</span><b>${pc(r.p_home)}</b></div>
            <div><span>Call</span><b>${r.call === 'PICK' ? (String(r.pick_team_id) === String(r.home_team_id) ? 'HOME' : 'AWAY') : 'NO CALL'}</b></div>
            <div><span>Confidence</span><b>${r.confidence || '—'}</b></div>
            <div><span>Market</span><b>${pc(r.market_devig_probability)}</b></div>
            <div><span>PBE gap</span><b>${pts(r.pbe_edge_pts)}</b></div>
            <small>${r.feature_hash ? `feature ${String(r.feature_hash).slice(0, 10)}…` : 'no feature hash'}</small>
          </article>`)}
        </div>` : html`<div class="pi-status-card"><b>No historical observations yet.</b><p>This game may have just entered the scoring window. The first real pre-lock observation will appear here when the official runner records it; the page will not fabricate a line between points that do not exist.</p><a class="btn" href="/pbe-picks">Open current PBE Picks</a></div>`}
      `}

      <section class="pi-explain"><h2>What this page proves</h2><p>The timeline is read from the append-only PBE prediction-observation ledger. A later observation does not overwrite an earlier one, and an official locked call remains separate from the provisional history. Market prices are still presentation context, never model inputs.</p></section>
    </section>`);
    root.querySelector('[data-game]')?.addEventListener('change', (e) => { selected = e.target.value; timeline = null; loadTimeline(selected); });
  };

  draw();
  if (selected) await loadTimeline(selected);
}
