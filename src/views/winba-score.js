import { html } from '../lib/dom.js';
import { pageHead } from '../ui/components.js';
import { fmtDateTimeET } from '../lib/format.js';

const one = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(1));

export async function loadWinbaScore(api) {
  const [winba, teams] = await Promise.all([api.statsWinba(), api.teams()]);
  return { winba, teams };
}

function leaderCard(row, teamMap) {
  const team = teamMap.get(String(row.team_id));
  return html`<a class="winba-authority-leader" href="/players/${row.athlete_id}">
    <span class="winba-authority-rank">#${row.rank}</span>
    <span class="winba-authority-player"><b>${row.name}</b><small>${team?.name || 'WNBA'} · ${row.sample?.games ?? '—'} GP · ${row.sample?.minutes ?? '—'} MIN</small></span>
    <span class="winba-score">${one(row.score)}<em>WINBA</em></span>
  </a>`;
}

export function winbaScoreView({ winba = null, teams = null } = {}) {
  const d = winba?.ok ? winba.data : null;
  const teamMap = new Map((teams?.ok ? teams.data?.teams || [] : []).map((t) => [String(t.team_id), t]));
  const leaders = (d?.rows || []).filter((r) => r.qualified && r.rank).sort((a, b) => a.rank - b.rank).slice(0, 5);
  const updated = d?.generated_at ? fmtDateTimeET(d.generated_at) : null;
  return html`
    ${pageHead({ eyebrow: 'PropBetEdge original metric', title: 'WinBA Score', sub: 'A 0–100 WNBA winning-impact index built to show how player production, playing time and team results fit together across the regular season.' })}

    <section class="winba-authority-hero section">
      <div class="winba-authority-hero__copy">
        <span class="eyebrow">Home of the WinBA Score</span>
        <h2>One number for a player’s season-long winning impact.</h2>
        <p>WinBA is a transparent, deterministic PropBetEdge metric. It rewards efficient box-score production, how often a player’s team wins when she appears, how much of her production comes in wins, and how much of the 40-minute game she is actually on the floor.</p>
        <div class="pill-row"><a class="btn gold" href="/stats">See WinBA in WNBA player stats →</a><a class="pill" href="/players">Explore player profiles</a></div>
      </div>
      <div class="winba-authority-scale" aria-label="WinBA Score range"><strong>0–100</strong><span>WNBA winning-impact index</span><small>Season metric · higher reflects a stronger combination of the four published components below.</small></div>
    </section>

    <section class="winba-authority-section section" id="how-winba-is-calculated">
      <span class="eyebrow">WinBA formula</span>
      <h2>How WinBA Score is calculated</h2>
      <p class="winba-authority-lead">Every WinBA score is the same four-part formula. There is no hidden weighting layer and no sportsbook input.</p>
      <div class="winba-formula winba-formula--authority">
        <span><b>45%</b><strong>Production percentile</strong><small>Box Impact per 36 compared with qualification-eligible WNBA players.</small></span>
        <span><b>25%</b><strong>Player win rate</strong><small>Team wins divided by games in which the player appeared.</small></span>
        <span><b>20%</b><strong>Winning-output share</strong><small>The share of a player’s total Box Impact produced in team wins.</small></span>
        <span><b>10%</b><strong>Court share</strong><small>Average minutes played divided by a 40-minute WNBA game.</small></span>
      </div>
      <div class="winba-box-impact"><span>BOX IMPACT</span><strong>PTS + 1.2 × REB + 1.5 × AST</strong><p>Box Impact is the production base used for the per-36 percentile and winning-output share.</p></div>
    </section>

    <section class="winba-authority-section section" id="winba-rankings">
      <div class="winba-section-head"><div><span class="eyebrow">Current season</span><h2>WNBA WinBA rankings</h2></div>${d ? html`<div class="winba-live-meta"><b>${d.season || 'Current'} season</b><span>${d.games_used ?? '—'} regular-season finals · ${d.qualified_count ?? '—'} qualified</span>${updated ? html`<small>Updated ${updated}</small>` : ''}</div>` : ''}</div>
      ${leaders.length ? html`<div class="winba-authority-leaders">${leaders.map((r) => leaderCard(r, teamMap))}</div><p class="note">Top five qualified players in the current WinBA snapshot. <a href="/stats">Open the full WNBA player leaderboard →</a></p>` : html`<div class="empty"><h3>Live WinBA rankings are reconnecting.</h3><p>The formula, qualification rules and interpretation on this page remain the published WinBA v1 methodology. Current rankings will return when the live snapshot is available.</p></div>`}
    </section>

    <section class="winba-authority-section section" id="how-to-read-winba">
      <span class="eyebrow">How to read the number</span>
      <h2>What a WinBA Score means — and what it does not</h2>
      <div class="winba-reading-grid">
        <div><b>Higher score</b><span>A stronger season-long combination of production, team-win association and playing time under the same formula.</span></div>
        <div><b>Qualified</b><span>At least 10 appearances or 250 minutes. Qualified players establish the production benchmark and can receive a league rank.</span></div>
        <div><b>Provisional</b><span>A player below the qualification threshold can still receive a score, but she does not move the qualified production benchmark and has no league rank.</span></div>
        <div><b>Regular season only</b><span>WinBA v1 uses archived completed regular-season games. DNP and zero-minute rows are excluded.</span></div>
      </div>
      <div class="winba-not-list"><h3>WinBA is not:</h3><ul><li>a causal estimate of wins added</li><li>a single-game grade</li><li>a live projection or win probability</li><li>a betting pick or sportsbook market rating</li></ul></div>
    </section>

    <section class="winba-authority-section section" id="where-winba-appears">
      <span class="eyebrow">Across PropBetEdge WNBA</span>
      <h2>WinBA is built into the product — not isolated on one leaderboard.</h2>
      <div class="winba-surface-grid">
        <a href="/stats"><b>WNBA Stats</b><span>Compare WinBA beside season scoring, rebounding, assists, shooting and minutes.</span></a>
        <a href="/players"><b>Player profiles</b><span>See each player’s WinBA score, qualification state, league rank and season sample.</span></a>
        <a href="/cast"><b>WNBACast</b><span>WinBA sits beside the box score as season context while you follow live games and replays.</span></a>
        <a href="/teams"><b>Team research</b><span>Move from team rosters and rotations into player-level WinBA context.</span></a>
      </div>
    </section>

    <section class="winba-authority-section winba-faq section" id="winba-faq">
      <span class="eyebrow">WinBA FAQ</span>
      <h2>Frequently asked questions about WinBA Score</h2>
      <details open><summary>What is WinBA Score?</summary><p>WinBA Score is PropBetEdge’s 0–100 WNBA winning-impact index. It combines box-score production, player win rate, production in wins and playing time into one season metric.</p></details>
      <details><summary>How is WinBA Score calculated?</summary><p>WinBA is 45% league percentile of Box Impact per 36, 25% player win rate, 20% share of Box Impact produced in wins and 10% court share. Box Impact is PTS + 1.2 × REB + 1.5 × AST.</p></details>
      <details><summary>Is WinBA the same as wins added?</summary><p>No. WinBA describes box production and playing time associated with team wins. It does not claim that the score is a causal estimate of wins added.</p></details>
      <details><summary>What makes a player qualified or provisional?</summary><p>A player qualifies with at least 10 appearances or 250 minutes. Players below that threshold can receive a provisional score, but they do not move the qualified production benchmark and do not receive a league rank.</p></details>
      <details><summary>How often does WinBA update?</summary><p>PropBetEdge checks the archived final-game index every 10 minutes and rebuilds the season WinBA snapshot only when that archive changes.</p></details>
      <details><summary>Does WinBA predict games or make betting picks?</summary><p>No. WinBA is a season player metric. It is separate from PBE Picks, live game projections and sportsbook market data.</p></details>
    </section>

    <section class="winba-source-note section"><b>Data note.</b> WinBA v1 is derived from archived regular-season final player box scores in the PropBetEdge WNBA replay layer. The metric itself is PropBetEdge’s calculation; underlying provenance and system status remain available on the <a href="/sources">data sources page</a>.</section>
  `;
}
