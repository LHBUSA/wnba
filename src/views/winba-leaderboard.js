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
 * The chart view: the top ten as one horizontal comparison, so the shape of the
 * board is readable at a glance. HTML and CSS, not canvas, so it is in the SSR
 * response and available to assistive technology.
 */
function chart(article, rows) {
  const max = Math.max(...rows.map((r) => Number(r.score) || 0), 1);
  return html`<figure class="wb-chart">
    <figcaption>Top 10 by WinBA Score</figcaption>
    <ol>
      ${rows.map((row) => html`<li>
        <span class="wb-chart-rank">${row.rank}</span>
        <a class="wb-chart-thumb" href="/players/${row.player_id}" aria-hidden="true" tabindex="-1">${playerImage(article, row, 'square')}</a>
        <a class="wb-chart-name" href="/players/${row.player_id}">${row.player_name}</a>
        ${row.team_id ? html`<a class="wb-chart-team" href="/teams/${row.team_id}" aria-label="${row.team_name || ''}">${teamLogo({ team_id: row.team_id, name: row.team_name }, 16)}</a>` : html`<span class="wb-chart-team"></span>`}
        <span class="wb-chart-bar"><i style="width:${Math.max(6, (Number(row.score) / max) * 100)}%"></i></span>
        <b class="wb-chart-score">${whole(row.score)}</b>
      </li>`)}
    </ol>
  </figure>`;
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
  const firstEdition = !article?.winba_movement;
  const label = article.winba_board.period_label || article.period_label || '';

  return html`<section class="wb-board" aria-labelledby="wb-board-title">
    <header class="wb-board-head">
      <h2 id="wb-board-title">${label ? `${label} WinBA leaderboard` : 'The WinBA leaderboard'}</h2>
      <p class="wb-board-note">Frozen at publication${article.winba_board.qualified_count ? ` · ${article.winba_board.qualified_count} qualified players` : ''} · <a href="/winba-score">how WinBA Score works</a></p>
    </header>
    ${podium(article, top10.slice(0, 3), firstEdition)}
    ${rankRows(article, top10.slice(3), firstEdition)}
    ${chart(article, top10)}
    ${rows.length > 10 ? html`<p class="wb-board-more">Ranks 11–${rows.length} are recorded in this edition’s frozen board.</p>` : ''}
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
