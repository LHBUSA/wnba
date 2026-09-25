// Generic playoff bracket renderer for the pbe-playoffs/1.0.0 contract (workers/shared/playoffs.js).
//
// Sport-agnostic: no league names, ids or routes live here. The caller injects how to draw a team mark,
// where a team or game links, and how to format dates. WNBA wires it in src/views/playoffs.js; an NBA
// surface can reuse it unchanged with its own adapter output.
//
// Truth in the drawing: rounds progress left to right, but no connector claims which series feeds which.
// The contract carries no such relationship until the source names both teams of a later-round series.

import { html } from '../lib/dom.js';

const STATUS_LABEL = { TBD: 'TBD', UPCOMING: 'Upcoming', LIVE: 'Live', IN_PROGRESS: 'In progress', FINAL: 'Final' };
const STATUS_KEY = { TBD: 'tbd', UPCOMING: 'sched', LIVE: 'live', IN_PROGRESS: 'prog', FINAL: 'final' };
const GAME_LABEL = { SCHEDULED: 'Scheduled', LIVE: 'Live', FINAL: 'Final', POSTPONED: 'Postponed', CANCELED: 'Canceled', SUSPENDED: 'Suspended', NOT_NEEDED: 'Not needed', UNKNOWN: 'Status unknown' };

export const seriesStatusLabel = (s) => STATUS_LABEL[s] || s;
export const gameStatusLabel = (s) => GAME_LABEL[s] || s;

const defaults = {
  logo: () => '',
  teamHref: () => null,
  gameHref: () => null,
  fmtDay: (iso) => String(iso || '').slice(0, 10),
  fmtTime: () => ''
};

/** Every game of a snapshot, flattened with its round/series context (series games + unassigned slots). */
export function allGames(snapshot) {
  const out = [];
  for (const r of snapshot?.rounds || []) {
    for (const s of r.series || []) for (const g of s.games || []) out.push({ ...g, round: r, series: s });
    for (const g of r.unassigned_games || []) out.push({ ...g, round: r, series: null });
  }
  return out.sort((a, b) => String(a.start_utc).localeCompare(String(b.start_utc)) || (a.game_number ?? 0) - (b.game_number ?? 0));
}

export function statusBadge(status, cls = 'pbadge') {
  return html`<span class="${cls} ${cls}--${STATUS_KEY[status] || 'tbd'}">${seriesStatusLabel(status)}</span>`;
}

function pips(wins, need) {
  if (!Number.isInteger(need) || need < 1 || need > 5) return '';
  return html`<span class="brk-pips" aria-hidden="true">${Array.from({ length: need }, (_, i) => html`<i class="${i < (wins || 0) ? 'on' : ''}"></i>`)}</span>`;
}

function teamRow(team, wins, s, o) {
  if (!team) {
    return html`<div class="brk-t brk-t--tbd"><span class="brk-seed">—</span><span class="brk-mark brk-mark--tbd" aria-hidden="true"></span><span class="brk-name"><b>TBD</b></span><span class="brk-w"></span></div>`;
  }
  const won = s.winner_team_id && s.winner_team_id === team.team_id;
  const lost = s.winner_team_id && s.winner_team_id !== team.team_id;
  const href = o.teamHref(team);
  const name = html`<b class="brk-full">${team.team_name || team.abbreviation}</b><b class="brk-abbr">${team.abbreviation}</b>`;
  return html`<div class="brk-t ${won ? 'is-win' : ''} ${lost ? 'is-out' : ''}">
    <span class="brk-seed" title="${team.seed ? `Seed ${team.seed}` : 'Seed not published'}">${team.seed ?? '—'}</span>
    <span class="brk-mark">${o.logo(team, 28)}</span>
    <span class="brk-name">${href ? html`<a href="${href}">${name}</a>` : name}</span>
    <span class="brk-w"><b>${wins ?? '—'}</b>${pips(wins, s.wins_needed)}</span>
  </div>`;
}

function gameLine(g, o, { prefix }) {
  if (!g) return '';
  const href = o.gameHref(g);
  const when = g.status === 'SCHEDULED' ? html`${o.fmtDay(g.start_utc)} · ${g.time_tbd ? 'Time TBD' : o.fmtTime(g.start_utc)}` : '';
  const score = g.status === 'FINAL' || g.status === 'LIVE'
    ? html`${g.away_team?.abbreviation} ${g.away_score} · ${g.home_team?.abbreviation} ${g.home_score}`
    : g.away_team && g.home_team ? html`${g.away_team.abbreviation} @ ${g.home_team.abbreviation}` : '';
  const body = html`<span class="brk-g-k">${prefix}${g.game_number ? ` · G${g.game_number}` : ''}</span><span class="brk-g-v">${score}${when ? html` <em>${when}</em>` : ''}${g.status === 'LIVE' ? html` <em class="live">LIVE</em>` : ''}</span>`;
  return href ? html`<a class="brk-g" href="${href}">${body}</a>` : html`<div class="brk-g">${body}</div>`;
}

export function seriesCard(s, round, opts = {}) {
  const o = { ...defaults, ...opts };
  const games = s.games || [];
  const live = games.find((g) => g.game_id === s.live_game_id) || null;
  const next = games.find((g) => g.game_id === s.next_game_id) || null;
  const last = s.last_result ? games.find((g) => g.game_id === s.last_result.game_id) : null;
  return html`<article class="brk-s brk-s--${STATUS_KEY[s.status] || 'tbd'}" data-series="${s.series_id}">
    <header class="brk-s-h">${statusBadge(s.status)}<span class="brk-bo">${s.best_of ? `Best of ${s.best_of}` : 'Format not published'}</span></header>
    ${teamRow(s.higher_seed, s.higher_wins, s, o)}
    ${teamRow(s.lower_seed, s.lower_wins, s, o)}
    <footer class="brk-s-f">
      ${s.status === 'TBD' ? html`<p class="brk-note">${s.summary}</p>` : html`<p class="brk-sum">${s.summary}</p>`}
      ${live ? gameLine(live, o, { prefix: 'Live now' }) : ''}
      ${!live && next ? gameLine(next, o, { prefix: 'Next' }) : ''}
      ${last ? gameLine(last, o, { prefix: 'Last' }) : ''}
    </footer>
  </article>`;
}

/** Horizontal rounds on desktop, a readable vertical progression on narrow screens (CSS decides). */
export function bracketBoard(snapshot, opts = {}) {
  const o = { ...defaults, ...opts };
  const rounds = snapshot?.rounds || [];
  if (!rounds.length) return '';
  const champ = snapshot.champion;
  return html`<div class="brk" style="--rounds:${rounds.length}">
    <nav class="brk-jump" aria-label="Jump to round">${rounds.map((r) => html`<a href="#round-${r.round_id}">${r.name}</a>`)}${champ ? html`<a href="#champion">Champion</a>` : ''}</nav>
    <div class="brk-cols">
      ${rounds.map((r) => html`<section class="brk-col" id="round-${r.round_id}" aria-labelledby="rh-${r.round_id}">
        <header class="brk-col-h">
          <h3 id="rh-${r.round_id}">${r.name}</h3>
          <span>${r.best_of ? `Best of ${r.best_of}` : ''}${r.series_expected ? ` · ${r.series_expected} series` : ''}</span>
          ${statusBadge(r.status)}
        </header>
        <div class="brk-col-b">${r.series.map((s) => seriesCard(s, r, o))}</div>
      </section>`)}
      ${champ ? html`<section class="brk-col brk-col--champ" id="champion" aria-label="Champion">
        <header class="brk-col-h"><h3>Champion</h3><span>${snapshot.season}</span></header>
        <div class="brk-col-b">${championCard(champ, o)}</div>
      </section>` : ''}
    </div>
  </div>`;
}

export function championCard(c, opts = {}) {
  const o = { ...defaults, ...opts };
  const href = o.teamHref(c);
  return html`<article class="brk-champ">
    <span class="brk-champ-k">${o.leagueChampionLabel || 'Champion'}</span>
    <span class="brk-champ-mark">${o.logo(c, 96)}</span>
    <b class="brk-champ-n">${href ? html`<a href="${href}">${c.team_name}</a>` : c.team_name}</b>
    <span class="brk-champ-s">${c.seed ? `No. ${c.seed} seed · ` : ''}won ${c.series_score} over ${c.opponent?.team_name || c.opponent?.abbreviation || 'opponent'}</span>
    ${c.clinched_game_id && o.gameHref({ game_id: c.clinched_game_id, status: 'FINAL', home_team: {}, away_team: {} }) ? html`<a class="brk-champ-g" href="${o.gameHref({ game_id: c.clinched_game_id, status: 'FINAL', home_team: {}, away_team: {} })}">Replay the clinching game →</a>` : ''}
  </article>`;
}
