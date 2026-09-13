// Article view — the single renderer for a newsroom story. The SPA page (src/pages/article.js) and the
// wnba-web publishing Worker both call articleView(), so the first HTTP response and the hydrated page
// carry the same headline, copy, timestamps, evidence and links.
//   photographic hero + credit → desk → headline → deck → byline + timestamps → body → story links →
//   bettor modules → evidence & method (trust layer) → related coverage.
import { html } from '../lib/dom.js';
import { marketStrip, avatar } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { KIND_LABEL, DESK, articleCard, headlineText } from '../ui/articles.js';
import { storyMedia, creditLine } from '../ui/story-media.js';
import { fmtDateTimeET, fmtDateET } from '../lib/format.js';

export const loadArticle = async (api, slug) => api.article(slug);

// Where a reader goes next from each desk: ordinary crawlable links into the rest of the product.
const DESK_LINKS = {
  injury: [['/injuries', 'Injury Desk: every listed player'], ['/news/c/injury', 'More injury stories']],
  transaction: [['/news/c/transaction', 'More roster moves'], ['/teams', 'All team rosters']],
  preview: [['/matchups', 'All upcoming matchups'], ['/props', 'Best-line board']],
  performance: [['/news/c/performance', 'More recaps'], ['/stats', 'Season stat leaders']],
  result: [['/news/c/performance', 'More recaps'], ['/standings', 'Standings']],
  trend: [['/news/c/trend', 'More team trends'], ['/props', 'Best-line board']],
  props: [['/props', 'Player props & best lines'], ['/news/c/props', 'More Prop Watch']],
  market: [['/props', 'Best-line board'], ['/news/c/market', 'More Market Watch']],
  brief: [['/news/c/brief', 'More News Briefs'], ['/injuries', 'Injury Desk']]
};

export function articleView({ article: a, related = [] }) {
  const teams = (a.entities || []).filter((e) => e && e.type === 'team');
  const players = (a.entities || []).filter((e) => e && e.type === 'player');
  const games = (a.entities || []).filter((e) => e && e.type === 'game');
  const b = a.bettor_angle || {};
  const mw = a.market_watch || {};
  const ng = a.context?.next_game || a.context?.game || null;
  const gameForStrip = ng ? { home: ng.home, away: ng.away } : null;
  const deskKind = a.kind === 'result' ? 'performance' : a.kind;
  const pictured = new Set((a.media?.subjects || []).map((s) => s.player_id));
  const photoOf = (p) => (a.media?.subjects || []).find((s) => s.player_id === String(p.id));
  const published = a.first_published_at || a.published_at;
  const revised = a.revised_at && Date.parse(a.revised_at) > Date.parse(published || 0) ? a.revised_at : null;
  const gameLinks = games.length ? games : mw.game_id ? [{ id: mw.game_id, name: ng ? `${ng.away?.abbr || ''} @ ${ng.home?.abbr || ''}` : 'This game', start_utc: ng?.start_utc }] : [];

  return html`
    <article class="story">
      <div class="story-hero">${storyMedia(a.media, { slot: 'hero', eager: true })}</div>

      <header class="story-head">
        <div class="story-kicker">
          <a class="cat" href="/news/c/${deskKind}">${DESK[a.kind] || KIND_LABEL[a.kind] || a.category}</a>
          <span class="story-teams">${teams.slice(0, 2).map((t) => html`<a href="/teams/${t.id}" aria-label="${t.name}">${teamLogo({ team_id: t.id, name: t.name }, 26)}</a>`)}</span>
        </div>
        <h1>${headlineText(a.headline)}</h1>
        <p class="deck">${headlineText(a.deck)}</p>
        <div class="byline">
          <span class="by">By the <a href="/about">PropBetEdge WNBA Newsroom</a></span>
          <span>Published <time datetime="${published}">${fmtDateTimeET(published)}</time></span>
          ${revised ? html`<span>Updated <time datetime="${revised}">${fmtDateTimeET(revised)}</time></span>` : ''}
          <span>Source record ${fmtDateTimeET(a.published_at)}</span>
        </div>
      </header>

      <div class="story-layout">
        <div class="story-body art-body">
          ${a.sections?.length
            ? a.sections.map((s) => html`<h2>${s.title}</h2>${a.body.slice(s.first, s.first + s.count).map((p) => html`<p>${p}</p>`)}`)
            : a.body.map((p) => html`<p>${p}</p>`)}
        </div>
        <aside class="story-aside">
          ${players.length ? html`<section><h2 class="aside-title">In this story</h2>
            ${players.slice(0, 6).map((p) => { const s = photoOf(p); return html`<a class="aside-row" href="/players/${p.id}">${avatar({ name: p.name, photo: s ? { square: s.square } : null })}<b>${p.name}</b>${pictured.has(String(p.id)) ? html`<span class="note">pictured</span>` : ''}</a>`; })}
          </section>` : ''}
          ${teams.length ? html`<section><h2 class="aside-title">Teams</h2>${teams.map((t) => html`<a class="aside-row" href="/teams/${t.id}">${teamLogo({ team_id: t.id, name: t.name }, 28)}<b>${t.name}</b></a>`)}</section>` : ''}
          ${gameLinks.length ? html`<section><h2 class="aside-title">Game</h2>${gameLinks.map((g) => html`<a class="aside-row" href="/matchups/${g.id}"><b>${g.name}</b><span class="note">${g.start_utc ? `${fmtDateET(g.start_utc, { month: 'short', day: 'numeric' })} · ` : ''}Matchup research →</span></a><a class="aside-row" href="/cast/${g.id}"><b>WNBACast</b><span class="note">Live game &amp; replay →</span></a>`)}</section>` : ''}
          <section><h2 class="aside-title">Keep reading</h2>
            ${(DESK_LINKS[a.kind] || []).map(([href, label]) => html`<a class="aside-row" href="${href}"><b>${label}</b></a>`)}
            <a class="aside-row" href="/news"><b>WNBA newsroom front page</b></a>
          </section>
        </aside>
      </div>

      <section class="premium">
        <div class="bettor-box">
          <span class="module-kicker">Bettor angle</span>
          <h2>Why it matters for bettors</h2>
          <p class="bettor-summary">${b.summary}</p>
          ${(b.supporting || []).map((x) => html`<p>${x}</p>`)}
          <div class="counter">
            <div><h3>What argues against it</h3>${(b.against || []).map((x) => html`<p>${x}</p>`)}</div>
            <div><h3>Still unknown</h3>${(b.unknown || []).map((x) => html`<p>${x}</p>`)}</div>
          </div>
          <p class="module-note">Markets touched: ${(b.markets || []).join(' · ').replaceAll('_', ' ')}</p>
        </div>
        <div class="takeaway">
          <span class="module-kicker">Market angle</span>
          <h2>What the market shows</h2>
          ${(mw.text || []).length ? (mw.text || []).map((x) => html`<p>${x}</p>`) : html`<p>No stored market capture is attached to this story. Market context lives on the <a href="/props">best-line board</a>, captured at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.</p>`}
          ${mw.market && gameForStrip ? html`<div class="strip-wrap">${marketStrip(mw.market, gameForStrip)}</div>` : ''}
          ${mw.game_id ? html`<p class="module-links"><a class="sec-link" href="/matchups/${mw.game_id}">Full matchup and line context →</a><a class="sec-link" href="/cast/${mw.game_id}">WNBACast →</a></p>` : ''}
        </div>
      </section>

      <section class="trust-layer">
        <h2 class="sec-title bc">Evidence &amp; method</h2>
        <ol class="evidence">
          ${(a.evidence || []).map((e) => html`<li><b>${e.kind === 'publisher_report' ? `${e.publisher} (publisher report)` : e.source}</b>${e.headline ? html` — “${e.headline}”` : ''}${e.published_at ? ` · published ${fmtDateTimeET(e.published_at)}` : ''}${e.captured_at ? ` · captured ${fmtDateTimeET(e.captured_at)}` : ''}${e.url ? html` · <a href="${e.url}" rel="noopener" target="_blank">source ↗</a>` : ''}</li>`)}
        </ol>
        ${(a.method || []).map((x) => html`<p class="note">${x}</p>`)}
        <p class="note">Written by PropBetEdge’s deterministic newsroom generator (${a.generator?.version}) from the records above and checked by the publication gate: every number traces to a cited record, publisher reporting stays attributed to the publisher, and a story that fails the gate is held rather than published.</p>
        ${a.media?.subjects?.length ? html`<p class="note">Photograph: ${creditLine(a.media)}. The pictured player is matched to her Wikidata entry by exact name and date of birth, and the photo is reviewed before use; the frame is a PropBetEdge composition of the licensed original.</p>` : html`<p class="note">No licensed photograph of this story’s subject is approved yet, so the story runs with a team composition rather than a stand-in.</p>`}
        <p class="note trust-links"><a href="/editorial-policy">Editorial policy</a> · <a href="/corrections">Corrections &amp; revisions</a> · <a href="/methodology">Methodology</a> · <a href="/sources">Sources</a></p>
      </section>

      ${related.length ? html`<section class="section related">
        <div class="sec-head"><h2 class="sec-title bc">Related coverage</h2><a class="sec-link" href="/news">Newsroom →</a></div>
        <div class="ngrid">${related.slice(0, 3).map((c) => articleCard(c))}</div>
      </section>` : ''}
    </article>
  `;
}
