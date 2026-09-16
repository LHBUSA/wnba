import { html } from '../lib/dom.js';
import { teamLogo } from '../ui/logo.js';
import { fmtCompactDate, fmtTimeET, relTime } from '../lib/format.js';
import { PRO_INTELLIGENCE } from '../data/pro-features.js';

const safeItems = (x) => Array.isArray(x) ? x : [];
const statusRank = (s) => /out|doubtful|suspended|inactive/i.test(String(s || '')) ? 3 : /question/i.test(String(s || '')) ? 2 : /probable|day-to-day/i.test(String(s || '')) ? 1 : 0;

function teamIndex(teams) {
  return new Map(safeItems(teams?.data?.teams).map((t) => [String(t.team_id), t]));
}

function tname(t, id) {
  return t?.short_name || t?.name || t?.abbr || `Team ${id}`;
}

export function dailyBriefView({ today, coverage, track, injuries, teams, generatedAt = new Date().toISOString() } = {}) {
  const tIdx = teamIndex(teams);
  const slate = today?.ok ? today.data?.slate : null;
  const games = safeItems(slate?.games);
  const covered = coverage?.ok ? safeItems(coverage.data?.games) : [];
  const changes = injuries?.ok ? safeItems(injuries.data?.changes) : [];
  const injuryItems = injuries?.ok ? safeItems(injuries.data?.items) : [];
  const record = track?.ok ? track.data?.record : null;
  const live = games.filter((g) => g.status?.state === 'in').length;
  const priced = games.filter((g) => g.market).length;
  const topAvailability = (changes.length ? changes : injuryItems)
    .slice()
    .sort((a, b) => statusRank(b.status_after || b.status) - statusRank(a.status_after || a.status))
    .slice(0, 6);
  const label = slate?.kind === 'TODAY' ? 'Today' : slate?.kind === 'NEXT' ? 'Next WNBA slate' : 'WNBA desk';

  return html`
    <section class="db-shell">
      <header class="db-hero">
        <div>
          <span class="eyebrow">FREE · WNBA Intelligence</span>
          <h1>WNBA Daily <span>Brief</span></h1>
          <p class="lead">The free front door to PropBetEdge WNBA: the slate, current PBE coverage window, sourced availability movement and the public locked-call record — without exposing paid model probabilities or Player Load values.</p>
          <div class="db-actions"><a class="btn gold" href="/pro">Unlock the full WNBA Pro desk</a><a class="btn" href="/pbe-picks">See what PBE Picks includes</a></div>
        </div>
        <aside class="db-stamp"><span>${label}</span><b>${games.length}</b><small>${live ? `${live} live · ` : ''}${priced} priced</small><em>Updated ${relTime(generatedAt)}</em></aside>
      </header>

      <div class="db-metrics">
        <div><span>Slate</span><b>${games.length}</b><small>${slate?.date ? fmtCompactDate(slate.date, { month: 'short', day: 'numeric' }) : 'current slate'}</small></div>
        <div><span>PBE window</span><b>${covered.length}</b><small>covered games · values remain Pro</small></div>
        <div><span>Availability</span><b>${changes.length || injuryItems.length}</b><small>${changes.length ? 'recent recorded changes' : 'current feed entries'}</small></div>
        <div><span>Public record</span><b>${record ? `${record.wins}-${record.losses}` : '—'}</b><small>${record ? `${record.pending || 0} pending · ${record.graded || 0} graded` : 'official locked calls only'}</small></div>
      </div>

      <div class="db-grid">
        <section class="db-card db-pbe-window">
          <div class="db-card-head"><div><span class="eyebrow">PBE coverage</span><h2>Games entering the model window</h2></div><a class="sec-link" href="/pbe-picks">PBE Picks →</a></div>
          ${covered.length ? html`<div class="db-list">${covered.map((g) => {
            const away = tIdx.get(String(g.away_team_id));
            const home = tIdx.get(String(g.home_team_id));
            return html`<a class="db-game-row" href="/matchups/${g.game_id}"><span>${teamLogo({ team_id: g.away_team_id, ...(away || {}) }, 28)}<b>${tname(away, g.away_team_id)}</b></span><em>at</em><span><b>${tname(home, g.home_team_id)}</b>${teamLogo({ team_id: g.home_team_id, ...(home || {}) }, 28)}</span><small>${fmtTimeET(g.scheduled_tip_utc)} · ${g.phase === 'LOCKED' ? 'locked' : 'pre-lock'}</small></a>`;
          })}</div>` : html`<p class="db-empty">No covered games are inside the current PBE scoring window. The brief stays live even on quiet slates.</p>`}
          <div class="db-lock-note"><b>Free view:</b> schedule and coverage only. <a href="/pro?next=%2Fpbe-picks">WNBA Pro</a> unlocks probabilities, market disagreement, reasoning, Edge Timeline and Scenario Lab.</div>
        </section>

        <section class="db-card">
          <div class="db-card-head"><div><span class="eyebrow">Availability watch</span><h2>What changed</h2></div><a class="sec-link" href="/injuries">Full desk →</a></div>
          ${topAvailability.length ? html`<div class="db-list">${topAvailability.map((x) => {
            const tid = String(x.team_id || '');
            const team = tIdx.get(tid);
            const name = x.name || x.athlete_name || 'WNBA player';
            const before = x.status_before || 'not listed';
            const after = x.status_after || x.status || 'updated';
            const when = x.captured_at || x.source_updated_at || null;
            return html`<a class="db-avail-row" href="${x.athlete_id ? `/players/${x.athlete_id}` : '/injuries'}">${teamLogo({ team_id: tid, ...(team || {}) }, 26)}<span><b>${name}</b><small>${changes.length ? `${before} → ${after}` : after}${team ? ` · ${tname(team, tid)}` : ''}</small></span><em>${when ? relTime(when) : ''}</em></a>`;
          })}</div>` : html`<p class="db-empty">No sourced availability changes are available right now. Nothing is invented to fill the card.</p>`}
        </section>
      </div>

      <section class="db-pro-stack">
        <div class="db-pro-copy"><span class="eyebrow">Where the paid value starts</span><h2>The Daily Brief tells you what matters. WNBA Pro lets you open the research.</h2><p>The free layer deliberately stops before proprietary prediction values. Upgrade when you want the model movement, player workload pressure, rotation context, scenario paths and your own live watchlist.</p></div>
        <div class="db-feature-grid">${PRO_INTELLIGENCE.map((f) => html`<a href="${f.href}"><span>${f.eyebrow}</span><b>${f.name}</b><p>${f.short}</p><em>WNBA PRO →</em></a>`)}</div>
      </section>
    </section>
  `;
}
