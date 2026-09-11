// Article cards for the in-house WNBA newsroom (hub, home, team, player, game pages).
import { html, raw } from '../lib/dom.js';
import { teamLogo, logoEntry, teamColors } from './logo.js';
import { relTime } from '../lib/format.js';

export const KIND_LABEL = {
  injury: 'Injuries',
  transaction: 'Transactions',
  performance: 'Performances',
  result: 'Results',
  preview: 'Previews',
  trend: 'Team trends',
  props: 'Prop watch',
  market: 'Market moves'
};

export const KIND_ORDER = ['preview', 'injury', 'performance', 'trend', 'transaction', 'props', 'market', 'result'];

const teamsOf = (c) => (c.entities || []).filter((e) => e && e.type === 'team').slice(0, 2);

export function articleCard(c, { lead = false } = {}) {
  const teams = teamsOf(c);
  const tc = teamColors({ team_id: c.lead_team_id });
  const leadLogo = logoEntry(c.lead_team_id);
  const href = `/news/${c.slug}`;
  return html`<a class="ncard ${lead ? 'lead' : ''}" href="${href}" style="--tc1:${tc.color || '#d4af37'}">
    ${lead && leadLogo ? html`<img class="bg-logo" src="${leadLogo.files['320']}" alt="" width="240" height="240" loading="lazy" decoding="async" />` : ''}
    <div class="nc-top"><span class="nc-logos">${teams.map((t) => teamLogo({ team_id: t.id, name: t.name }, lead ? 32 : 24))}</span><span class="cat">${KIND_LABEL[c.kind] || c.category}</span><span class="badge pbe">PBE Newsroom</span></div>
    <h3>${c.headline}</h3>
    ${c.deck ? html`<p class="deck">${c.deck}</p>` : ''}
    ${lead && c.bettor_snippet ? html`<p class="angle"><b style="color:var(--market);font:700 10px/1 var(--f-data);letter-spacing:.14em;text-transform:uppercase;display:block;margin-bottom:4px">Why it matters for bettors</b>${c.bettor_snippet}</p>` : ''}
    <div class="src"><span>${relTime(c.published_at)}</span>${c.market ? html`<span class="badge market">${c.market.away_abbr ? `${c.market.away_abbr} @ ${c.market.home_abbr} · ` : ''}${c.market.spread !== null ? `${c.market.home_abbr || 'Home'} ${c.market.spread > 0 ? '+' : ''}${c.market.spread}` : ''}${c.market.total !== null ? ` · O/U ${c.market.total}` : ''}</span>` : ''}<span>Sources: ${(c.sources || []).slice(0, 2).join(', ')}</span></div>
  </a>`;
}

export function articleList(items, { empty = 'No PropBetEdge articles for this yet.' } = {}) {
  if (!items?.length) return html`<p class="note">${empty}</p>`;
  return html`<div class="ngrid">${items.map((c) => articleCard(c))}</div>`;
}

/** Compact list for sidebars. */
export function articleMini(items) {
  return html`${(items || []).map((c) => html`<a class="change-row" href="/news/${c.slug}" style="grid-template-columns:auto minmax(0,1fr)">
    <span class="nc-logos">${teamsOf(c).slice(0, 1).map((t) => teamLogo({ team_id: t.id, name: t.name }, 28))}</span>
    <span><span class="cat" style="font:700 10px/1 var(--f-data);letter-spacing:.14em;text-transform:uppercase;color:var(--flame)">${KIND_LABEL[c.kind] || c.category}</span><b style="display:block;font:600 15px/1.3 var(--f-editorial);margin-top:4px">${c.headline}</b><span class="note">${relTime(c.published_at)}</span></span>
  </a>`)}`;
}
