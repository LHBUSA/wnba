import { html } from '../lib/dom.js';
import { teamLogo } from './logo.js';
import { fmtDateET, fmtTimeET, relTime, american } from '../lib/format.js';
import { phaseLine, teamName } from './pbe.js';

const pct1 = (p) => Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—';
const points = (x) => Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pts` : '—';
const impact = (x) => Number.isFinite(x) ? `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}` : '—';
const conf = (x) => x ? `${String(x).slice(0, 1).toUpperCase()}${String(x).slice(1).toLowerCase()}` : '—';
const teamOf = (g, id) => String(g.home_team_id) === String(id)
  ? { team_id: g.home_team_id, ...(g.home || {}) }
  : { team_id: g.away_team_id, ...(g.away || {}) };

function teamRow(team, probability, picked) {
  return html`<a class="pbe-f-team ${picked ? 'picked' : ''}" href="/teams/${team.team_id}" aria-label="Open ${teamName(team)} team intelligence">
    ${teamLogo(team, 38)}
    <span><b>${teamName(team)}</b><small>Team intelligence →</small></span>
    <strong>${pct1(probability)}</strong>
  </a>`;
}

function reasons(rows, empty) {
  if (!rows?.length) return html`<p class="pbe-f-empty-reason">${empty}</p>`;
  return html`<ul>${rows.map((r) => html`<li><span class="pbe-f-impact ${r.impact_pts > 0 ? 'pos' : 'neg'}">${impact(r.impact_pts)}</span><span>${r.text}</span></li>`)}</ul>`;
}

function marketCompare(item, pick) {
  const m = item.market;
  if (!m?.available) return html`<div class="pbe-f-market unavailable"><span>Market benchmark</span><b>No consensus yet</b><small>${m?.reason === 'fewer_than_two_books' ? 'Fewer than two books priced this game.' : 'No stored sportsbook consensus for this game yet.'}</small></div>`;
  const side = m[m.pick_side || (String(pick.team_id) === String(item.game.home_team_id) ? 'home' : 'away')];
  return html`<div class="pbe-f-compare">
    <div><span>PBE model</span><b>${pct1(item.pick_probability)}</b><small>independent win probability</small></div>
    <div><span>Market</span><b>${pct1(side?.devig_probability)}</b><small>${american(side?.consensus_moneyline)} consensus · ${m.book_count} books</small></div>
    <div class="gap ${m.pbe_edge_pts > 0 ? 'pos' : m.pbe_edge_pts < 0 ? 'neg' : ''}"><span>Model-market gap</span><b>${points(m.pbe_edge_pts)}</b><small>PBE Edge · disagreement, not a promise</small></div>
  </div>`;
}

function researchLinks(item, away, home) {
  const gameId = item.game.game_id;
  return html`<nav class="pbe-f-research" aria-label="Research this PBE call">
    <a href="/matchups/${gameId}"><b>Matchup</b><span>Form · rest · rotations →</span></a>
    <a href="/teams/${away.team_id}"><b>${teamName(away, { short: true })}</b><span>Team desk →</span></a>
    <a href="/teams/${home.team_id}"><b>${teamName(home, { short: true })}</b><span>Team desk →</span></a>
    <a href="/player-load"><b>Player Load</b><span>Workload pressure →</span></a>
    <a href="/injuries"><b>Availability</b><span>Injury context →</span></a>
  </nav>`;
}

export function flagshipPbeCard(item) {
  const g = item.game;
  const away = teamOf(g, g.away_team_id);
  const home = teamOf(g, g.home_team_id);
  const isPick = item.call === 'PICK';
  const pick = isPick ? teamOf(g, item.pick_team_id) : null;
  const grade = item.grade?.result ? String(item.grade.result).toUpperCase() : null;
  const hash = item.feature_hash ? String(item.feature_hash).slice(0, 14) : null;

  return html`<article class="pbe-f-card" data-phase="${item.phase}" data-call="${item.call || 'NONE'}">
    <header class="pbe-f-top">
      <div>
        <span class="pbe-f-date">${fmtDateET(g.scheduled_tip_utc)} · ${fmtTimeET(g.scheduled_tip_utc)}</span>
        <p>${phaseLine(item)}${item.shadow ? html`<span class="pbe-shadow">Shadow · owner only</span>` : ''}${grade ? html`<span class="pbe-f-grade ${grade.toLowerCase()}">${grade}</span>` : ''}</p>
      </div>
      <a class="pbe-f-matchup-link" href="/matchups/${g.game_id}">Open full matchup →</a>
    </header>

    <div class="pbe-f-teams">
      ${teamRow(away, item.p_away, pick && String(pick.team_id) === String(away.team_id))}
      ${teamRow(home, item.p_home, pick && String(pick.team_id) === String(home.team_id))}
    </div>

    ${isPick ? html`
      <section class="pbe-f-decision">
        <div class="pbe-f-pick">
          <span>PBE PICK</span>
          <div>${teamLogo(pick, 42)}<strong>${teamName(pick)}</strong></div>
          <p><b>${pct1(item.pick_probability)}</b> model win probability <i>·</i> <b class="conf-${String(item.confidence || '').toLowerCase()}">${conf(item.confidence)} confidence</b></p>
        </div>
        ${marketCompare(item, pick)}
      </section>

      <section class="pbe-f-analysis">
        <div class="support"><h3>Why PBE likes ${teamName(pick, { short: true })}</h3>${reasons(item.reasoning?.supporting, 'No single factor dominates this call; the probability comes from the combined feature set.')}</div>
        <div class="oppose"><h3>What pushes back</h3>${reasons(item.reasoning?.opposing, 'No displayed factor meaningfully pushes against the pick.')}</div>
      </section>
    ` : item.call === 'NO_CALL' ? html`
      <section class="pbe-f-no-call"><span>NO CALL</span><div><b>${item.no_call_reason === 'model_near_coin_flip' ? 'The model sees a game too close to force.' : 'The data-depth gate blocked an official pick.'}</b><p>PBE does not manufacture a pick when its own eligibility rules say not to.</p></div></section>
    ` : html`<section class="pbe-f-no-call"><span>NO OFFICIAL CALL</span><div><b>The game passed the lock point without an official recorded call.</b><p>No stale provisional pick is substituted after tip.</p></div></section>`}

    ${researchLinks(item, away, home)}

    <footer class="pbe-f-audit">
      <span><b>Model</b> ${item.model?.model_id || '—'}</span>
      <span><b>Model snapshot</b> ${item.generated_at ? relTime(item.generated_at) : '—'}</span>
      ${item.market?.available ? html`<span><b>Market snapshot</b> ${relTime(item.market.captured_at)}${item.market.current ? '' : ' · stale'}</span>` : ''}
      ${hash ? html`<span title="${item.feature_hash}"><b>Feature hash</b> ${hash}…</span>` : ''}
    </footer>
  </article>`;
}
