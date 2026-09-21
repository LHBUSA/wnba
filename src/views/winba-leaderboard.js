// The WinBA Index visual leaderboard — the flagship product of the monthly
// edition, rendered near the top of the article.
//
// EVERY number here comes from the article's FROZEN board (`winba_board`,
// `winba_board_media`, `winba_movement`). Nothing reads the live leaderboard:
// that belongs on /winba-score. An edition published in September still shows
// September's ranks, scores and components after the live board has moved on.
//
// Plain HTML and CSS so the ranking is in the first server response — the names,
// scores and links are editorial content and must be crawlable and readable
// without script.

import { html } from '../lib/dom.js';
import { avatar } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { fmtDateET } from '../lib/format.js';

const f1 = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 10) / 10) : null);
const whole = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v))) : null);
/** A 0–100 metric renders as a 0–100 bar. No rescaling, no invented range. */
const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

const COMPONENT_LABELS = [
  ['production_percentile', 'Production', 'League percentile of Box Impact per 36 minutes'],
  ['win_rate', 'Win rate', 'Share of her games the team won'],
  ['winning_output_share', 'Output in wins', 'Share of her Box Impact produced in wins'],
  ['court_share', 'Court share', 'Average minutes as a share of 40']
];

/** Movement for one player, only when a real prior edition supplied it. */
function movementFor(article, playerId) {
  const all = Array.isArray(article?.winba_movement?.moves) ? article.winba_movement.moves : null;
  if (!all) return null;
  const m = all.find((x) => String(x.player_id) === String(playerId));
  if (!m || m.rank_delta === null || m.rank_delta === undefined) return null;
  return m;
}

function movementChip(m) {
  if (!m) return '';
  if (m.rank_delta === 0) return html`<span class="wb-move wb-move--flat" title="Unchanged from the previous edition">—</span>`;
  const up = m.rank_delta > 0;
  return html`<span class="wb-move ${up ? 'wb-move--up' : 'wb-move--down'}" title="${up ? 'Up' : 'Down'} ${Math.abs(m.rank_delta)} from No. ${m.prior_rank} in the previous edition">${up ? '▲' : '▼'} ${Math.abs(m.rank_delta)}</span>`;
}

const mediaFor = (article, playerId) => (article?.winba_board_media || []).find((x) => String(x.player_id) === String(playerId)) || null;

/** A player image, or the safe monogram fallback. Never another person. */
function playerImage(article, row, size) {
  const m = mediaFor(article, row.player_id);
  const src = size === 'podium' ? m?.image?.podium || m?.image?.portrait : m?.image?.square;
  if (src) {
    return html`<img src="${src}" alt="${row.player_name}" width="${size === 'podium' ? 300 : 56}" height="${size === 'podium' ? 270 : 56}" loading="lazy" decoding="async" />`;
  }
  return avatar({ name: row.player_name, photo: null, team: { team_id: row.team_id, name: row.team_name } }, { teamColor: null });
}

function componentBars(row) {
  const c = row.components || {};
  const rows = COMPONENT_LABELS.filter(([k]) => Number.isFinite(Number(c[k])));
  if (!rows.length) return '';
  return html`<dl class="wb-components">
    ${rows.map(([k, label, title]) => html`
      <dt title="${title}">${label}</dt>
      <dd><span class="wb-cbar"><i style="width:${pct(c[k])}%"></i></span><b>${whole(c[k])}</b></dd>
    `)}
  </dl>`;
}

function statLine(row) {
  const a = row.averages || {};
  const cells = [
    ['PTS', f1(a.pts)],
    ['REB', f1(a.reb)],
    ['AST', f1(a.ast)]
  ].filter(([, v]) => v !== null);
  if (!cells.length) return '';
  return html`<ul class="wb-stats">${cells.map(([l, v]) => html`<li><b>${v}</b><span>${l}</span></li>`)}</ul>`;
}

const teamLink = (row) => (row.team_id
  ? html`<a class="wb-team" href="/teams/${row.team_id}">${teamLogo({ team_id: row.team_id, name: row.team_name }, 18)}<span>${row.team_name || `Team ${row.team_id}`}</span></a>`
  : '');

/**
 * The top three, as cards. Photo, team, rating, the conventional line, and the
 * four published components so a reader can see why No. 1 and No. 2 are close.
 */
function podium(article, rows, firstEdition) {
  return html`<ol class="wb-podium">
    ${rows.map((row) => html`<li class="wb-podium-card wb-rank-${row.rank}">
      <a class="wb-podium-photo" href="/players/${row.player_id}" aria-label="${row.player_name}">
        ${playerImage(article, row, 'podium')}
        <span class="wb-rank-chip">${row.rank}</span>
      </a>
      <div class="wb-podium-body">
        <a class="wb-name" href="/players/${row.player_id}">${row.player_name}</a>
        ${teamLink(row)}
        <p class="wb-score"><b>${whole(row.score)}</b> <a href="/winba-score">WinBA</a>
          ${firstEdition ? html`<span class="wb-first">First edition</span>` : movementChip(movementFor(article, row.player_id))}</p>
        ${statLine(row)}
        ${row.position || Number.isFinite(Number(row.games)) ? html`<p class="wb-meta">${[row.position, Number.isFinite(Number(row.games)) ? `${whole(row.games)} games` : null, Number.isFinite(Number(row.averages?.min)) ? `${f1(row.averages.min)} min` : null].filter(Boolean).join(' · ')}</p>` : ''}
        ${componentBars(row)}
      </div>
    </li>`)}
  </ol>`;
}

/** Ranks 4 and down, as rows with a 0–100 score bar. */
function rankRows(article, rows, firstEdition) {
  if (!rows.length) return '';
  return html`<ol class="wb-rows">
    ${rows.map((row) => html`<li class="wb-row">
      <span class="wb-row-rank">${row.rank}</span>
      <a class="wb-row-photo" href="/players/${row.player_id}" aria-label="${row.player_name}">${playerImage(article, row, 'square')}</a>
      <div class="wb-row-id">
        <a class="wb-name" href="/players/${row.player_id}">${row.player_name}</a>
        <span class="wb-row-sub">${teamLink(row)}${row.position ? html`<span class="wb-pos">${row.position}</span>` : ''}</span>
      </div>
      <div class="wb-row-bar"><span class="wb-bar" role="img" aria-label="WinBA ${whole(row.score)} of 100"><i style="width:${pct(row.score)}%"></i></span></div>
      <span class="wb-row-score">${whole(row.score)}</span>
      ${statLine(row)}
      <span class="wb-row-move">${firstEdition ? '' : movementChip(movementFor(article, row.player_id))}</span>
    </li>`)}
  </ol>`;
}

/**
 * What the shape of the board says, which the podium and the rows do not.
 *
 * The top ten is already listed twice above, so repeating it as a bar chart
 * would be the same ranking a third time. This instead shows the SPREAD across
 * the whole frozen board — how tightly the leaders are bunched, where the
 * board thins out — and the gap from No. 1, which is information the ordered
 * list cannot convey.
 */
function distribution(article, rows) {
  const scored = rows.filter((r) => Number.isFinite(Number(r.score)));
  if (scored.length < 6) return '';
  const top = Number(scored[0].score);
  const last = Number(scored.at(-1).score);
  const span = Math.max(top - last, 0.1);
  // Biggest single drop between consecutive ranks: where the board breaks.
  let cliff = null;
  for (let i = 1; i < scored.length; i += 1) {
    const drop = Number(scored[i - 1].score) - Number(scored[i].score);
    if (!cliff || drop > cliff.drop) cliff = { drop, above: scored[i - 1], below: scored[i] };
  }
  return html`<figure class="wb-spread">
    <figcaption>How the top ${scored.length} is spread</figcaption>
    <ol class="wb-spread-scale" aria-label="WinBA score by rank across the frozen board">
      ${scored.map((r) => html`<li class="${r.rank <= 3 ? 'is-podium' : r.rank <= 10 ? 'is-top10' : ''}" style="height:${Math.max(8, ((Number(r.score) - last) / span) * 100)}%" title="No. ${r.rank} ${r.player_name} — ${whole(r.score)}"><span>${r.rank <= 3 || r.rank % 5 === 0 ? r.rank : ''}</span></li>`)}
    </ol>
    <dl class="wb-spread-facts">
      <dt>Top to No. ${scored.length}</dt><dd>${whole(top)} → ${whole(last)}, a ${f1(top - last)}-point spread</dd>
      ${cliff && cliff.drop >= 0.6 ? html`<dt>Biggest single drop</dt><dd>${f1(cliff.drop)} points, between No. ${cliff.above.rank} ${cliff.above.player_name} and No. ${cliff.below.rank} ${cliff.below.player_name}</dd>` : ''}
    </dl>
  </figure>`;
}

/** Ranks 11 and beyond: supporting data, available without being heavy. */
function continuation(article, rows) {
  if (!rows.length) return '';
  return html`<details class="wb-more">
    <summary>View ranks ${rows[0].rank}–${rows.at(-1).rank}</summary>
    <ol class="wb-more-rows">
      ${rows.map((row) => html`<li>
        <span class="wb-more-rank">${row.rank}</span>
        <a class="wb-more-photo" href="/players/${row.player_id}" aria-hidden="true" tabindex="-1">${playerImage(article, row, 'square')}</a>
        <a class="wb-more-name" href="/players/${row.player_id}">${row.player_name}</a>
        ${row.team_id ? html`<a class="wb-more-team" href="/teams/${row.team_id}">${row.team_name || `Team ${row.team_id}`}</a>` : html`<span></span>`}
        <b class="wb-more-score">${whole(row.score)}</b>
      </li>`)}
    </ol>
  </details>`;
}

/**
 * TEAM DEPTH: which rosters place several players on the frozen board.
 *
 * Computed from the article's frozen board only, so it is the depth that was
 * true that month — a later trade cannot reshape a published edition. Teams are
 * ordered deterministically (most ranked players, then best rank, then name),
 * but teams on the same count are presented as EQUAL: the order is a render
 * decision, not a claim that one roster is deeper than another on the same
 * number.
 */
export function winbaTeamDepthData(article) {
  const rows = article?.winba_board?.rows || [];
  const byTeam = new Map();
  for (const r of rows) {
    if (!r.team_id) continue;
    const t = byTeam.get(String(r.team_id)) || { team_id: String(r.team_id), team_name: r.team_name, players: [] };
    t.players.push(r);
    byTeam.set(String(r.team_id), t);
  }
  return [...byTeam.values()]
    .filter((t) => t.players.length >= 2)
    .map((t) => ({ ...t, players: [...t.players].sort((a, b) => a.rank - b.rank) }))
    .sort((a, b) => b.players.length - a.players.length
      || a.players[0].rank - b.players[0].rank
      || String(a.team_name || a.team_id).localeCompare(String(b.team_name || b.team_id)));
}

export function winbaTeamDepth(article) {
  const teams = winbaTeamDepthData(article);
  if (!teams.length) return '';
  const total = (article?.winba_board?.rows || []).length;
  const label = article?.winba_board?.period_label || article?.period_label || '';
  const most = teams[0].players.length;

  return html`<section class="wb-depth" aria-labelledby="wb-depth-title">
    <header class="wb-depth-head">
      <h2 id="wb-depth-title">Teams with the most top-${total} WinBA players</h2>
      <p>Which rosters place multiple players among ${label ? `${label}’s` : 'the month’s'} ${total} highest-rated <a href="/winba-score">WinBA</a> players.</p>
    </header>

    <ol class="wb-depth-rank" aria-label="Top-${total} depth by team">
      ${teams.map((t) => html`<li class="${t.players.length === most ? 'is-most' : ''}">
        <b>${t.players.length}</b>
        <span class="wb-depth-meter"><i style="width:${Math.round((t.players.length / most) * 100)}%"></i></span>
        <a href="/teams/${t.team_id}">${t.team_name || `Team ${t.team_id}`}</a>
      </li>`)}
    </ol>

    <ol class="wb-depth-cards">
      ${teams.map((t) => html`<li class="wb-depth-card">
        <header>
          <a class="wb-depth-team" href="/teams/${t.team_id}">${teamLogo({ team_id: t.team_id, name: t.team_name }, 28)}<span>${t.team_name || `Team ${t.team_id}`}</span></a>
          <p class="wb-depth-count"><b>${t.players.length}</b> <span>top-${total} ${t.players.length === 1 ? 'player' : 'players'}</span></p>
        </header>
        <ol class="wb-depth-players">
          ${t.players.map((row) => html`<li>
            <a class="wb-depth-photo" href="/players/${row.player_id}" aria-hidden="true" tabindex="-1">${playerImage(article, row, 'square')}</a>
            <span class="wb-depth-prank">#${row.rank}</span>
            <a class="wb-depth-name" href="/players/${row.player_id}">${row.player_name}</a>
            <b class="wb-depth-score">${whole(row.score)}</b>
          </li>`)}
        </ol>
      </li>`)}
    </ol>
  </section>`;
}

/**
 * The aside for an Index edition. An ordinary story's generic Teams list is
 * redundant here — the board already links every team several times — so the
 * space carries the series instead: the live board, and this edition's top
 * three from its frozen snapshot.
 */
export function winbaIndexAside(article) {
  const rows = (article?.winba_board?.rows || []).slice(0, 3);
  if (!rows.length) return '';
  return html`<section class="wb-aside">
    <h2 class="aside-title">This edition</h2>
    <ol class="wb-aside-top">
      ${rows.map((r) => html`<li>
        <span>${r.rank}</span>
        <a href="/players/${r.player_id}">${r.player_name}</a>
        <b>${whole(r.score)}</b>
      </li>`)}
    </ol>
    <a class="aside-row" href="/winba-score"><b>Live WinBA leaderboard</b><span class="note">Current board, updated from completed games →</span></a>
    <a class="aside-row" href="/news/winba-index"><b>All WinBA Index editions</b><span class="note">The permanent series archive →</span></a>
  </section>`;
}

/**
 * The full visual leaderboard for one edition.
 *
 * Returns '' when the article carries no frozen board, so an article can never
 * render an empty ranking frame.
 */
export function winbaIndexLeaderboard(article) {
  const rows = article?.winba_board?.rows || [];
  if (!rows.length) return '';
  const top10 = rows.slice(0, 10);
  const rest = rows.slice(10);
  const firstEdition = !article?.winba_movement;
  const label = article.winba_board.period_label || article.period_label || '';
  const asOf = article.winba_board.leaderboard_as_of || article.winba_board.snapshot_at || null;

  return html`<section class="wb-board" aria-labelledby="wb-board-title">
    <header class="wb-board-head">
      <p class="wb-board-status"><span class="wb-frozen">Frozen monthly snapshot</span><a href="/winba-score">Live rankings →</a></p>
      <h2 id="wb-board-title">Top 10 WinBA rankings</h2>
      <p class="wb-board-note">${[label, asOf ? `frozen ${fmtDateET(asOf, { month: 'short', day: 'numeric' })}` : null, article.winba_board.qualified_count ? `${article.winba_board.qualified_count} qualified players` : null].filter(Boolean).join(' · ')} · <a href="/winba-score">How WinBA works →</a></p>
    </header>
    ${podium(article, top10.slice(0, 3), firstEdition)}
    ${rankRows(article, top10.slice(3), firstEdition)}
    ${continuation(article, rest)}
    ${distribution(article, rows)}
  </section>`;
}

/**
 * The promoted current-edition module. Used on the newsroom, the live
 * leaderboard and the series home so a freshly published Index is surfaced
 * rather than buried in the archive.
 */
export function winbaCurrentEditionModule(card, { heading = 'The WinBA Index' } = {}) {
  if (!card) return '';
  const rows = (card.winba_board?.rows || []).slice(0, 3);
  return html`<aside class="wb-current" aria-labelledby="wb-current-title">
    <span class="eyebrow">Current edition</span>
    <h2 id="wb-current-title"><a href="/news/${card.slug}">${heading}</a></h2>
    <p class="wb-current-period">${card.period_label || card.period || ''} rankings</p>
    ${rows.length ? html`<ol class="wb-current-top">
      ${rows.map((r) => html`<li><span>${r.rank}</span><a href="/players/${r.player_id}">${r.player_name}</a><b>${whole(r.score)}</b></li>`)}
    </ol>` : ''}
    <a class="wb-current-cta" href="/news/${card.slug}">Read the ${card.period_label || ''} Index →</a>
  </aside>`;
}
