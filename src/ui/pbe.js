// PBE Picks UI. Every component here renders ONLY what the server returned for this visitor.
// The teaser takes team identity and tip time — it has no parameter through which a probability could arrive.

import { html } from '../lib/dom.js';
import { teamLogo, logoEntry } from './logo.js';
import { fmtDateET, fmtTimeET, relTime, american } from '../lib/format.js';

const pct1 = (p) => (Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—');
const pts = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pts` : '—');
const impact = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}` : '');

export function teamName(t, { short = false } = {}) {
  const e = logoEntry(t);
  if (short) return t?.short_name || e?.short_name || (t?.name || e?.name || '').split(' ').slice(-1)[0] || t?.abbr || 'Team';
  return t?.name || e?.name || t?.abbr || 'Team';
}
const teamOf = (game, id) => (String(game.home_team_id) === String(id) ? { team_id: game.home_team_id, ...(game.home || {}) } : { team_id: game.away_team_id, ...(game.away || {}) });

const CONF = { high: 'High', medium: 'Medium', low: 'Low' };
const historyFlag = (item) => ((item.flags || []).includes('LIMITED_TEAM_HISTORY') ? html`<span class="pbe-flag" title="At least one team has played only 3–5 games this season. Shown for context; it does not change the probability, pick or confidence.">Limited current-season history</span>` : '');

export function phaseLine(item) {
  if (item.phase === 'LOCKED') return html`<span class="pbe-phase locked">Locked</span><span>${fmtTimeET(item.locked_at)} · ${item.lock_policy}</span>`;
  if (item.phase === 'PRE_LOCK') return html`<span class="pbe-phase pre">Pre-lock</span><span>recalculated ${relTime(item.generated_at)} · locks ${fmtTimeET(item.lock_at)}</span>`;
  return html`<span class="pbe-phase none">No official call</span><span>tip passed before a lock was recorded</span>`;
}

function shadowFlag(item) {
  return item.shadow ? html`<span class="pbe-shadow" title="Dry-run shadow ledger. Visible to the owner only and never part of the official record.">Shadow · owner only</span>` : '';
}

function marketCells(item, sideLabel) {
  const m = item.market;
  if (!m?.available) {
    return html`<div class="pbe-stat wide"><small>Market</small><b class="dim">No consensus</b><span>${m?.reason === 'fewer_than_two_books' ? 'fewer than two books priced this game' : 'no sportsbook snapshot for this game yet'}</span></div>`;
  }
  const side = m[item.market.pick_side || 'home'];
  return html`
    <div class="pbe-stat"><small>Market</small><b>${american(side?.consensus_moneyline)}</b><span>${sideLabel} · ${m.book_count} books</span></div>
    <div class="pbe-stat"><small>Market implied</small><b>${pct1(side?.implied_probability)}</b><span>de-vigged ${pct1(side?.devig_probability)}</span></div>
    <div class="pbe-stat edge ${m.pbe_edge_pts > 0 ? 'pos' : m.pbe_edge_pts < 0 ? 'neg' : ''}"><small>PBE Edge</small><b>${pts(m.pbe_edge_pts)}</b><span>vs de-vigged market</span></div>`;
}

function reasonList(rows, empty) {
  if (!rows?.length) return html`<p class="note">${empty}</p>`;
  return html`<ul class="pbe-reasons">${rows.map((r) => html`<li><span class="pbe-imp ${r.impact_pts > 0 ? 'pos' : 'neg'}">${impact(r.impact_pts)}</span><span>${r.text}</span></li>`)}</ul>`;
}

function marketFoot(item) {
  const m = item.market;
  return html`<p class="pbe-foot">${phaseLine(item)}${m?.available ? html`<span>market captured ${relTime(m.captured_at)}${m.current ? '' : ' · stale'}</span>` : ''}<span>${item.model?.model_id}</span></p>`;
}

/** WNBA Pro team-page module: the one canonical call for this team's next game, oriented to `teamId`. */
export function pbeTeamPicker(item, teamId) {
  const g = item.game;
  const us = teamOf(g, teamId);
  const them = teamOf(g, String(g.home_team_id) === String(teamId) ? g.away_team_id : g.home_team_id);
  const vs = String(g.home_team_id) === String(teamId) ? 'vs' : 'at';
  const head = html`<div class="pbe-head"><span class="pbe-eyebrow">PBE Team Picker</span>${shadowFlag(item)}</div>
    <h2 class="pbe-matchup">${teamLogo(us, 34)}<span>${teamName(us, { short: true })}</span><em>${vs}</em><span>${teamName(them, { short: true })}</span>${teamLogo(them, 34)}</h2>
    <p class="pbe-when">${fmtDateET(g.scheduled_tip_utc)} · ${fmtTimeET(g.scheduled_tip_utc)}</p>`;

  if (item.call === 'NO_CALL') {
    return html`<section class="pbe-card" aria-label="PBE Team Picker">${head}
      <div class="pbe-nocall"><b>PBE no call</b><span>${item.no_call_reason === 'model_near_coin_flip' ? 'The model sees this game as too close to call.' : 'Insufficient team history: a team has fewer than 3 current-season games.'}</span></div>
      <div class="pbe-stats"><div class="pbe-stat"><small>${teamName(us, { short: true })}</small><b>${pct1(item.oriented?.team_probability)}</b><span>model win probability</span></div><div class="pbe-stat"><small>${teamName(them, { short: true })}</small><b>${pct1(item.oriented?.opponent_probability)}</b><span>model win probability</span></div></div>
      ${marketFoot(item)}</section>`;
  }
  const pick = teamOf(g, item.pick_team_id);
  const pickName = teamName(pick, { short: true });
  const o = item.oriented;
  return html`<section class="pbe-card" aria-label="PBE Team Picker">${head}
    <div class="pbe-stats">
      <div class="pbe-stat pick"><small>PBE pick</small><b>${teamLogo(pick, 26)}${teamName(pick)}</b><span>${o?.team_is_pick ? 'this team' : `over ${teamName(us, { short: true })}`}</span></div>
      <div class="pbe-stat prob"><small>Win probability</small><b>${pct1(item.pick_probability)}</b><span>${o?.team_is_pick ? `${teamName(them, { short: true })} ${pct1(o?.opponent_probability)}` : `${teamName(us, { short: true })} ${pct1(o?.team_probability)}`}</span></div>
      ${marketCells(item, pickName)}
      <div class="pbe-stat"><small>Confidence</small><b class="conf ${item.confidence}">${CONF[item.confidence] || '—'}</b><span>probability + data depth</span>${historyFlag(item)}</div>
    </div>
    <div class="pbe-why">
      <div><h3>Why PBE likes ${pickName}</h3>${reasonList(item.reasoning?.supporting, 'No single factor stands out; the call is the sum of small edges.')}</div>
      <div><h3>What works against them</h3>${reasonList(item.reasoning?.opposing, 'No factor meaningfully pushes against this pick.')}</div>
    </div>
    ${marketFoot(item)}
  </section>`;
}

const TEASER_STATE = {
  available: 'Model call available',
  opens: 'Model call opens 48 hours before tip',
  validation: 'PBE model in validation · official calls start soon',
  unknown: 'PBE model calls for every covered game'
};

/** Signed-out / free team-page teaser. Takes identity, time and a coverage state only. */
export function pbeTeaser({ team, opponent, isHome, tipUtc, availability = 'unknown', next = '/pro' }) {
  return html`<section class="pbe-card pbe-teaser" aria-label="PBE Team Picker" data-pbe-teaser="${availability}">
    <div class="pbe-head"><span class="pbe-eyebrow">PBE Team Picker</span><span class="pbe-lock" aria-hidden="true">WNBA Pro</span></div>
    ${team && opponent ? html`<h2 class="pbe-matchup">${teamLogo(team, 34)}<span>${teamName(team, { short: true })}</span><em>${isHome ? 'vs' : 'at'}</em><span>${teamName(opponent, { short: true })}</span>${teamLogo(opponent, 34)}</h2>
    ${tipUtc ? html`<p class="pbe-when">${fmtDateET(tipUtc)} · ${fmtTimeET(tipUtc)}</p>` : ''}` : ''}
    <div class="pbe-teaser-body">
      <b>${TEASER_STATE[availability] || TEASER_STATE.unknown}</b>
      <span>Win probability · market comparison · PBE Edge · model reasoning</span>
    </div>
    <a class="btn gold pbe-cta" href="${next}">Unlock WNBA Pro</a>
  </section>`;
}

export function pbeValidationNotice({ compact = false } = {}) {
  return html`<section class="pbe-card pbe-validation">
    <div class="pbe-head"><span class="pbe-eyebrow">PBE Picks</span><span class="pbe-phase pre">In validation</span></div>
    <p>PBE WNBA model v1 is running in validation. Official calls appear here from the first owner-approved lock; the live record starts at 0-0 with that pick.</p>
    ${compact ? '' : html`<a class="sec-link" href="/pbe-picks/model">How the model works →</a>`}
  </section>`;
}

/** Central PBE Picks page card. */
export function pbeCallCard(item) {
  const g = item.game;
  const away = teamOf(g, g.away_team_id);
  const home = teamOf(g, g.home_team_id);
  const isPick = item.call === 'PICK';
  const pick = isPick ? teamOf(g, item.pick_team_id) : null;
  const probRow = (t, p) => html`<div class="pbe-row ${pick && String(pick.team_id) === String(t.team_id) ? 'is-pick' : ''}">${teamLogo(t, 30)}<b>${teamName(t)}</b><span class="pbe-p">${pct1(p)}</span></div>`;
  return html`<article class="pbe-card pbe-call" data-phase="${item.phase}" data-call="${item.call || 'NONE'}" data-teams="${g.home_team_id},${g.away_team_id}">
    <div class="pbe-head"><span class="pbe-when">${fmtDateET(g.scheduled_tip_utc)} · ${fmtTimeET(g.scheduled_tip_utc)}</span>${shadowFlag(item)}</div>
    ${item.call ? html`${probRow(away, item.p_away)}${probRow(home, item.p_home)}` : html`<div class="pbe-row">${teamLogo(away, 30)}<b>${teamName(away)}</b></div><div class="pbe-row">${teamLogo(home, 30)}<b>${teamName(home)}</b></div>`}
    ${isPick ? html`
      <div class="pbe-stats compact">
        <div class="pbe-stat pick"><small>PBE pick</small><b>${teamName(pick, { short: true })}</b><span>${pct1(item.pick_probability)}</span></div>
        ${marketCells(item, teamName(pick, { short: true }))}
        <div class="pbe-stat"><small>Confidence</small><b class="conf ${item.confidence}">${CONF[item.confidence]}</b>${historyFlag(item)}</div>
      </div>
      <details class="pbe-details"><summary>Model reasoning</summary>
        <div class="pbe-why"><div><h3>Why PBE likes ${teamName(pick, { short: true })}</h3>${reasonList(item.reasoning?.supporting, 'No single factor stands out.')}</div>
        <div><h3>What works against them</h3>${reasonList(item.reasoning?.opposing, 'Nothing meaningful.')}</div></div>
      </details>` : item.call === 'NO_CALL' ? html`<div class="pbe-nocall"><b>No call</b><span>${item.no_call_reason === 'model_near_coin_flip' ? 'too close to call' : 'insufficient team history'}</span></div>` : ''}
    ${item.call ? marketFoot(item) : html`<p class="pbe-foot">${phaseLine(item)}</p>`}
  </article>`;
}
