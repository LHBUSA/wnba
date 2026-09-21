// THE WINBA INDEX — the permanent archive of the monthly editorial franchise.
//
// The archive is the series' home: every published month, newest first, each
// one a frozen record of that month's board. It is deliberately separate from
// /winba-score, which is the LIVE leaderboard. One is current truth, the other
// is the published record, and the copy on both says which is which.
//
// Previous/next navigation is computed HERE, at read time, from the published
// series. Nothing is written back into an older article, so no published
// timestamp or frozen value is ever touched to add a forward link.

import { html } from '../lib/dom.js';
import { errorState } from '../ui/components.js';
import { fmtDateET } from '../lib/format.js';

export const WINBA_INDEX_PATH = '/news/winba-index';
export const WINBA_SCORE_PATH = '/winba-score';
export const WINBA_INDEX_KIND = 'winba_index';
export const WINBA_INDEX_SERIES = 'The WinBA Index';

const listable = (c) => c && c.status === 'published' && c.quality_state !== 'retired_from_index'
  && c.quality_state !== 'external_coverage' && !c.superseded_by && !c.duplicate_of;

/** Published editions, newest period first. Period ordering, not publish order. */
export function winbaIndexCards(articles) {
  const items = articles?.data?.items || articles?.items || [];
  return items
    .filter((c) => c.kind === WINBA_INDEX_KIND && listable(c))
    .sort((a, b) => String(b.period || b.first_published_at || '').localeCompare(String(a.period || a.first_published_at || '')));
}

/**
 * THE CURRENT EDITION: the latest valid published edition by PERIOD.
 *
 * By period, not by recency of publication, so a late-published or corrected
 * back issue can never displace the newest month. A freshly published Index
 * stays the promoted current edition until a later period publishes, at which
 * point the earlier one becomes permanent series history automatically —
 * nothing has to be flipped by hand.
 */
export function currentWinbaEdition(articles) {
  return winbaIndexCards(articles)[0] || null;
}

/** Is this card the current edition of the series? */
export function isCurrentWinbaEdition(card, articles) {
  const current = currentWinbaEdition(articles);
  return Boolean(current && card && String(current.id) === String(card.id));
}

/**
 * The edition before and after a given period.
 *
 * "Next" exists only once a later edition has actually been published, which is
 * why it is resolved on every read instead of being stamped into the earlier
 * article when the later one appears.
 */
export function winbaSeriesNav(cards, period) {
  const ordered = [...(cards || [])].sort((a, b) => String(a.period || '').localeCompare(String(b.period || '')));
  const i = ordered.findIndex((c) => String(c.period) === String(period));
  if (i < 0) return { prev: null, next: null, position: null, total: ordered.length };
  return {
    prev: ordered[i - 1] || null,
    next: ordered[i + 1] || null,
    position: i + 1,
    total: ordered.length
  };
}

export async function loadWinbaIndexArchive(api) {
  // The live board is shown only as a pointer, so a failure there must not take
  // the archive down: the archive is the published record and stands alone.
  const [articles, winba] = await Promise.all([
    api.articles({ limit: 400 }),
    api.statsWinba().catch(() => null)
  ]);
  return { cards: winbaIndexCards(articles), winba, error: !articles?.ok };
}

const leadLine = (c) => {
  const rows = c?.winba_board?.rows || [];
  if (!rows.length) return null;
  return rows.slice(0, 3).map((r) => `${r.rank}. ${r.player_name} ${Math.round(r.score)}`).join(' · ');
};

/** The series nav strip rendered on an Index article. */
export function winbaSeriesNavView(nav) {
  // Renders for every edition, not only when a neighbour exists: the first
  // edition still needs a way into the series home.
  if (!nav) return '';
  return html`<nav class="winba-series-nav" aria-label="The WinBA Index editions">
    ${nav.prev ? html`<a class="winba-series-prev" href="/news/${nav.prev.slug}"><span>Previous</span><b>${nav.prev.period_label || nav.prev.period}</b></a>` : html`<span></span>`}
    <a class="winba-series-all" href="${WINBA_INDEX_PATH}">All editions${nav.total ? html` (${nav.total})` : ''}</a>
    ${nav.next ? html`<a class="winba-series-next" href="/news/${nav.next.slug}"><span>Next</span><b>${nav.next.period_label || nav.next.period}</b></a>` : html`<span></span>`}
  </nav>`;
}

export function winbaIndexArchiveView({ cards = [], winba = null, error = false } = {}) {
  if (error) return { body: errorState('The WinBA Index archive is unavailable', 'The newsroom record did not answer. Nothing is shown in its place.'), items: [] };
  // The newest edition gets the premium treatment; earlier ones stay compact.
  const current = cards[0] || null;
  const older = cards.slice(1);
  const imageFor = (card, playerId) => {
    const m = (card?.winba_board_media || []).find((x) => String(x.player_id) === String(playerId));
    return m?.image?.square || null;
  };
  const live = winba?.ok ? winba.data : null;
  const liveTop = (live?.rows || []).filter((r) => r.qualified && r.rank).sort((a, b) => a.rank - b.rank).slice(0, 3);

  return {
    items: cards,
    body: html`
      <header class="masthead">
        <span class="eyebrow">PropBetEdge original metric · monthly record</span>
        <h1 class="mast-title">${WINBA_INDEX_SERIES}</h1>
        <p class="mast-sub">The monthly editorial record of WinBA Score, PropBetEdge’s 0–100 WNBA winning-impact rating. Each edition is frozen at publication: its ranks and scores are the ones that were true that month, and they do not change when the live board moves.</p>
      </header>

      ${liveTop.length ? html`<aside class="winba-live-pointer">
        <span class="eyebrow">Live board right now</span>
        <p>${liveTop.map((r) => `${r.rank}. ${r.name} ${Math.round(r.score)}`).join(' · ')}</p>
        <a href="${WINBA_SCORE_PATH}">Open the live WinBA leaderboard →</a>
      </aside>` : ''}

      ${current ? html`<section class="section wbx-current-edition">
        <span class="eyebrow">Current edition</span>
        <a class="wbx-hero" href="/news/${current.slug}">
          <h2>${current.headline}</h2>
          ${(current.winba_board?.rows || []).length ? html`<ol class="wbx-hero-top">
            ${(current.winba_board.rows || []).slice(0, 3).map((r) => html`<li>
              ${imageFor(current, r.player_id) ? html`<img src="${imageFor(current, r.player_id)}" alt="${r.player_name}" width="72" height="72" loading="lazy" decoding="async" />` : html`<span class="wbx-hero-blank" aria-hidden="true"></span>`}
              <span class="wbx-hero-rank">${r.rank}</span>
              <b>${r.player_name}</b>
              <span class="wbx-hero-team">${r.team_name || ''}</span>
              <span class="wbx-hero-score">${Math.round(Number(r.score))}</span>
            </li>`)}
          </ol>` : ''}
          <span class="wbx-hero-cta">Read the ${current.period_label || ''} Index →</span>
        </a>
        ${current.first_published_at ? html`<small class="winba-edition-date">Published ${fmtDateET(current.first_published_at, { month: 'long', day: 'numeric', year: 'numeric' })}</small>` : ''}
      </section>` : ''}

      <section class="section">
        ${older.length ? html`<h2 class="wbx-older-title">${current ? 'Previous editions' : 'Editions'}</h2>` : ''}
        ${older.length ? html`<ol class="winba-edition-list">
          ${older.map((c) => html`<li class="winba-edition">
            <a class="winba-edition-link" href="/news/${c.slug}">
              <span class="winba-edition-period">${c.period_label || c.period || ''}</span>
              <b class="winba-edition-headline">${c.headline}</b>
              ${leadLine(c) ? html`<span class="winba-edition-top">${leadLine(c)}</span>` : ''}
              ${c.first_published_at ? html`<small class="winba-edition-date">Published ${fmtDateET(c.first_published_at, { month: 'short', day: 'numeric', year: 'numeric' })}</small>` : ''}
            </a>
          </li>`)}
        </ol>` : html`<div class="empty">
          <h3>No edition has been published yet.</h3>
          <p>The WinBA Index publishes once per completed ranking period. The <a href="${WINBA_SCORE_PATH}">live WinBA leaderboard</a> is current in the meantime.</p>
        </div>`}
      </section>

      <section class="section">
        <h2>What WinBA Score measures</h2>
        <p>WinBA Score is built only from completed WNBA games: Box Impact (points plus 1.2 times rebounds plus 1.5 times assists) measured per 36 minutes against the league, the player’s win rate, the share of her production that came in wins, and her court share. It is an association-with-winning index, not a causal estimate of wins added. <a href="${WINBA_SCORE_PATH}#how-winba-is-calculated">Read the full method →</a></p>
      </section>
    `
  };
}
