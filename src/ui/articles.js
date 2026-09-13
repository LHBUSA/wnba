// Article cards for the in-house WNBA newsroom (hub, home, team, player, game pages).
// Each card leads with its story media (licensed photo, matchup or team composition) and keeps the
// photo credit visible. The headline link is stretched over the card so credit links stay real links.
// Market prices stay on dedicated market surfaces and inside the article's market section; they are
// intentionally not injected into editorial story cards.
import { html } from '../lib/dom.js';
import { teamLogo } from './logo.js';
import { relTime } from '../lib/format.js';
import { storyMedia, storyThumb } from './story-media.js';
import { storyOriginIso } from '../lib/news-ranking.js';

export const KIND_LABEL = {
  brief: 'News Briefs',
  international: 'International',
  injury: 'Injuries',
  transaction: 'Transactions',
  performance: 'Performances',
  result: 'Results',
  preview: 'Previews',
  trend: 'Team trends',
  props: 'Prop watch',
  market: 'Market moves'
};

// Desk names used on the front page (editorial voice), keyed by kind.
export const DESK = {
  brief: 'News Briefs',
  international: 'International',
  injury: 'Injury Desk',
  transaction: 'Roster Moves',
  performance: 'Performances',
  result: 'Results',
  preview: 'Previews',
  trend: 'Team Trends',
  props: 'Prop Watch',
  market: 'Market Watch'
};

export const KIND_ORDER = ['brief', 'international', 'preview', 'injury', 'performance', 'trend', 'transaction', 'props', 'market', 'result'];

const teamsOf = (c) => (c.entities || []).filter((e) => e && e.type === 'team').slice(0, 2);
// The visible story age is canonical newsroom publication time. Source/event timestamps may
// move when an existing article is revised, but that must not make old coverage look newly published.
const storyTime = storyOriginIso;
// Short source labels for cards (the full, cited list is on the article page).
const srcLabel = (s) => String(s).replace(/^wnba-api matchup research.*/i, 'PBE matchup research').replace(/\s*\(.*$/, '').replace(/\s*—.*$/, '');
const sourcesOf = (c) => [...new Set((c.sources || []).map(srcLabel))].slice(0, 2).join(', ');
// Headline/deck text with number-dash tokens kept on one line; the text itself is unchanged.
// Both score forms are atomic: "111-91" (hyphen) and "111–91" (en dash, which wnba-articles/1.2.0
// emits so gate.js does not read "-91" as a moneyline). Also covers "7-3", "3.5-point", "24-16".
export const headlineText = (t) => String(t ?? '').split(/(\d[\d.]*[-–][\w.]+)/).map((s, i) => (i % 2 ? html`<span class="nobr">${s}</span>` : s));

/** Standard story card. size: 'lead' | 'feature' | 'card' | 'compact'. */
export function articleCard(c, { lead = false, size = null, eager = false } = {}) {
  const sz = size || (lead ? 'lead' : 'card');
  const href = `/news/${c.slug}`;
  const slot = sz === 'lead' ? 'lead' : sz === 'compact' ? 'small' : 'card';
  return html`<article class="scard scard--${sz}">
    ${storyMedia(c.media, { slot, eager })}
    <div class="scard-body">
      <div class="scard-kicker"><span class="cat">${DESK[c.kind] || KIND_LABEL[c.kind] || c.category}</span><span class="scard-time">${relTime(storyTime(c))}</span></div>
      <h3 class="scard-h"><a href="${href}">${headlineText(c.headline)}</a></h3>
      ${sz !== 'compact' && c.deck ? html`<p class="deck">${headlineText(c.deck)}</p>` : ''}
      ${sz !== 'lead' ? html`<div class="scard-meta">${teamsOf(c).map((t) => teamLogo({ team_id: t.id, name: t.name }, 20))}<span class="scard-src">PBE Newsroom · ${sourcesOf(c)}</span></div>` : ''}
    </div>
    ${sz === 'lead' ? html`<div class="scard-foot">
      ${c.bettor_snippet ? html`<p class="angle"><b>Why it matters for bettors</b>${c.bettor_snippet}</p>` : ''}
      <div class="scard-meta">${teamsOf(c).map((t) => teamLogo({ team_id: t.id, name: t.name }, 20))}<span class="scard-src">PBE Newsroom · ${sourcesOf(c)}</span></div>
    </div>` : ''}
  </article>`;
}

export function articleList(items, { empty = 'No PropBetEdge articles for this yet.', size = 'card' } = {}) {
  if (!items?.length) return html`<p class="note">${empty}</p>`;
  return html`<div class="ngrid">${items.map((c) => articleCard(c, { size }))}</div>`;
}

function thumbCredit(m) {
  const s = m?.layout === 'single' ? m.subjects?.[0] : m?.layout === 'matchup' ? m.subjects?.[1] : null;
  if (!s) return '';
  const cr = s.credit || {};
  return html`<span class="srow-credit">${s.name} · Photo: ${cr.source_page ? html`<a href="${cr.source_page}" rel="noopener nofollow" target="_blank">${cr.author || 'Unknown author'}</a>` : cr.author || 'Unknown author'} · ${cr.license} (cropped)</span>`;
}

/** River row: square thumbnail of the pictured player (else team mark), desk, headline, time. */
export function articleRow(c) {
  return html`<article class="srow">
    ${storyThumb(c.media, 64)}
    <div class="srow-body">
      <div class="scard-kicker"><span class="cat">${DESK[c.kind] || KIND_LABEL[c.kind] || c.category}</span><span class="scard-time">${relTime(storyTime(c))}</span></div>
      <h3 class="srow-h"><a href="/news/${c.slug}">${headlineText(c.headline)}</a></h3>
      ${thumbCredit(c.media)}
    </div>
  </article>`;
}

/** Compact list for sidebars. */
export function articleMini(items) {
  return html`<div class="srows">${(items || []).map(articleRow)}</div>`;
}
