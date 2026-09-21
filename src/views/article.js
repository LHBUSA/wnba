// Article view — the single renderer for a newsroom story. The SPA page (src/pages/article.js) and the
// wnba-web publishing Worker both call articleView(), so the first HTTP response and the hydrated page
// carry the same headline, copy, timestamps, evidence and links.
//   photographic hero + credit → desk → headline → deck → byline + timestamps → body (Game Highlights after the
//   opening section when a verified official video exists) → story links → bettor modules → evidence & method
//   (trust layer) → related coverage.
import { html } from '../lib/dom.js';
import { marketStrip, avatar } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { KIND_LABEL, DESK, articleCard, headlineText } from '../ui/articles.js';
import { storyMedia, creditLine } from '../ui/story-media.js';
import { fmtDateTimeET, fmtDateET } from '../lib/format.js';
import { intelligenceOf } from '../lib/intelligence.js';
import { gameHighlights } from '../ui/video.js';
import { winbaSeriesNav, winbaSeriesNavView, winbaIndexCards, WINBA_INDEX_KIND } from './winba-index.js';
import { winbaIndexLeaderboard } from './winba-leaderboard.js';

// A `metric` entity carries no id-based route: it is the canonical explainer
// for a PropBetEdge statistic. Routing it here lets the generator keep URLs out
// of prose and still have "WinBA Score" linked once, under the same
// first-mention rule that governs players and teams.
const METRIC_HREF = { winba: '/winba-score' };
const entityHref = (e) => e?.type === 'player' ? `/players/${e.id}`
  : e?.type === 'team' ? `/teams/${e.id}`
    : e?.type === 'metric' ? METRIC_HREF[String(e.id)] || null
      : null;
const entityKey = (e) => `${e?.type || ''}:${e?.id || ''}`;
const boundary = (ch) => !ch || !/[A-Za-z0-9]/.test(ch);
const nameVariants = (name) => {
  const n = String(name || '').trim();
  if (!n) return [];
  return [...new Set([n, n.replaceAll("'", '’'), n.replaceAll('’', "'")])];
};

/** Link the first in-body mention of every known player/team entity to its canonical profile. */
export function linkArticleEntities(text, entities, seen = new Set()) {
  const src = String(text || '');
  const lower = src.toLocaleLowerCase('en-US');
  const matches = [];

  for (const e of entities || []) {
    const href = entityHref(e);
    const key = entityKey(e);
    if (!href || seen.has(key) || !e?.name) continue;
    let best = null;
    for (const variant of nameVariants(e.name)) {
      const needle = variant.toLocaleLowerCase('en-US');
      let from = 0;
      while (from < lower.length) {
        const i = lower.indexOf(needle, from);
        if (i < 0) break;
        const end = i + needle.length;
        if (boundary(src[i - 1]) && boundary(src[end])) {
          const candidate = { start: i, end, e, href, key };
          if (!best || candidate.start < best.start) best = candidate;
          break;
        }
        from = i + 1;
      }
    }
    if (best) matches.push(best);
  }

  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const chosen = [];
  let cursor = -1;
  for (const m of matches) {
    if (m.start < cursor) continue;
    chosen.push(m);
    cursor = m.end;
  }
  if (!chosen.length) return html`${src}`;

  const parts = [];
  let at = 0;
  for (const m of chosen) {
    parts.push(src.slice(at, m.start));
    parts.push(html`<a class="entity-link" href="${m.href}">${src.slice(m.start, m.end)}</a>`);
    seen.add(m.key);
    at = m.end;
  }
  parts.push(src.slice(at));
  return html`${parts}`;
}

export const loadArticle = async (api, slug) => api.article(slug);

/**
 * The published WinBA Index series, for previous/next navigation on an edition.
 *
 * Read at request time so a newly published month links backwards without
 * anything being written into the older article. Only fetched for an Index, and
 * a failure simply means no nav strip.
 */
export const loadArticleSeries = async (api, article) => (article?.kind === WINBA_INDEX_KIND
  ? api.articles({ limit: 400 }).then((r) => (r?.data?.items || [])).catch(() => [])
  : []);

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
  brief: [['/news/c/brief', 'More News Briefs'], ['/injuries', 'Injury Desk']],
  international: [['/international', 'International women’s basketball'], ['/news/c/international', 'More international stories']]
};

const REVISION_LABEL = { data_update: 'Updated with new source data', editorial_upgrade: 'Rewritten by an improved generator (no facts changed)', editorial_quality_upgrade: 'Editorial quality upgrade (same facts)', depth_upgrade: 'Developed into a fuller story', metadata_correction: 'Timestamp metadata corrected', integrity_correction: 'Newsroom integrity correction', integrity_retirement: 'Removed from live listings after integrity audit', integrity_restoration: 'Restored to live listings: the integrity failure did not hold', demoted_to_external_coverage: 'Moved to external coverage' };
const MARKET_NAME = { spread: 'Spread', total: 'Total', moneyline: 'Moneyline', 'player props': 'Player props', line: 'Line' };

/**
 * Timestamps shown on a story. Published = the newsroom's first publication (immutable); Updated = the latest
 * revision; "Source data as of" = when the evidence was observed. A source observation later than the time the
 * displayed version was produced is impossible, so it is never shown (legacy stories stored an event/estimate clock
 * in published_at; that value is not an observation).
 */
export function storyClock(a) {
  const published = a.first_published_at || a.published_at;
  const revised = a.revised_at && Date.parse(a.revised_at) > Date.parse(published || 0) ? a.revised_at : null;
  const version = revised || published;
  const obs = a.provenance?.source_observed_at || null;
  const showObserved = obs && Date.parse(obs) <= Date.parse(version || 0) ? obs : null;
  return { published, revised, observed: showObserved };
}

/**
 * PropBetEdge Intelligence — ONE module, driven only by the shared decision (src/lib/intelligence.js). Relevance
 * "none" renders nothing; "contextual" renders context without market labels or sportsbook links; "actionable" may
 * render betting relevance, market evidence and markets touched. Subsections render only with real content, and the
 * module shows only copy that ADDS to the article body (intel.copy); with nothing additive it does not render at all.
 */
export function intelligenceView(a) {
  const intel = intelligenceOf(a);
  const b = intel.copy;
  if (!intel.render.intelligence || !b?.summary) return '';
  const mw = a.market_watch || {};
  const ng = a.context?.next_game || a.context?.game || null;
  const gameForStrip = ng ? { home: ng.home, away: ng.away } : null;
  const actionable = intel.market_relevance === 'actionable';
  // When the article body carries its own "The market" section, the capture is already reported there: the module
  // attaches the market without restating it.
  const bodyMarket = (a.sections || []).some((x) => /^The market$/i.test(x.title || ''));
  const evidence = actionable && intel.render.market_evidence && !bodyMarket && ((mw.text || []).length || (mw.market && gameForStrip));
  return html`<section class="pbe-intel" data-relevance="${intel.market_relevance}">
    <div class="pbe-intel-head"><span class="module-kicker">PropBetEdge Intelligence</span><h2>${intel.label}</h2></div>
    <div class="pbe-intel-grid">
      <div class="pbe-intel-main">
        <p class="bettor-summary">${b.summary}</p>
        ${(b.supporting || []).map((x) => html`<p>${x}</p>`)}
        ${intel.render.markets_touched ? html`<p class="module-note">Markets touched: ${intel.markets_touched.map((m) => MARKET_NAME[m] || m).join(' · ')}</p>` : ''}
      </div>
      ${evidence ? html`<div class="pbe-intel-market"><h3>Market evidence</h3>${(mw.text || []).map((x) => html`<p>${x}</p>`)}${mw.market && gameForStrip ? html`<div class="strip-wrap">${marketStrip(mw.market, gameForStrip)}</div>` : ''}${intel.render.sportsbook_links && mw.game_id ? html`<p class="module-links"><a class="sec-link" href="/matchups/${mw.game_id}">Full matchup and line context →</a></p>` : ''}</div>` : ''}
    </div>
    ${(b.against || []).length || (b.unknown || []).length ? html`<div class="counter">
      ${(b.against || []).length ? html`<div><h3>What argues against it</h3>${b.against.map((x) => html`<p>${x}</p>`)}</div>` : ''}
      ${(b.unknown || []).length ? html`<div><h3>Unknowns</h3>${b.unknown.map((x) => html`<p>${x}</p>`)}</div>` : ''}
    </div>` : ''}
  </section>`;
}

export function articleView({ article: a, related = [], series = [] }) {
  const teams = (a.entities || []).filter((e) => e && e.type === 'team');
  const players = (a.entities || []).filter((e) => e && e.type === 'player');
  const games = (a.entities || []).filter((e) => e && e.type === 'game');
  const intl = (a.entities || []).filter((e) => e && (e.type === 'intl_team' || e.type === 'intl_game'));
  const mw = a.market_watch || {};
  const ng = a.context?.next_game || a.context?.game || null;
  const intel = intelligenceOf(a);
  const deskKind = a.kind === 'result' ? 'performance' : a.kind;
  const pictured = new Set((a.media?.subjects || []).map((s) => s.player_id));
  const photoOf = (p) => (a.media?.subjects || []).find((s) => s.player_id === String(p.id));
  const { published, revised, observed } = storyClock(a);
  const gameLinks = games.length ? games : mw.game_id ? [{ id: mw.game_id, name: ng ? `${ng.away?.abbr || ''} @ ${ng.home?.abbr || ''}` : 'This game', start_utc: ng?.start_utc }] : [];
  // Metrics link last so a player or team name always wins a contested span.
  const metrics = (a.entities || []).filter((e) => e && e.type === 'metric' && entityHref(e));
  const linkedEntities = [...players, ...teams, ...metrics];
  const linkedSeen = new Set();
  // An Index edition carries previous/next navigation across the published
  // series, resolved from the series passed in rather than stored on the
  // article: a later month appearing must not rewrite an earlier record.
  // The visual leaderboard is the product of an Index edition, so it renders
  // straight after the opening read rather than below several hundred words of
  // analysis. Every value in it comes from the article's frozen board. When it
  // renders, the prose top-ten section is suppressed on the page — the board
  // states the same frozen facts better — but it stays in the stored body for
  // feeds and for the edition's own word count.
  const indexBoard = a.kind === WINBA_INDEX_KIND ? winbaIndexLeaderboard(a) : '';
  const seriesNav = a.kind === WINBA_INDEX_KIND && a.period
    ? winbaSeriesNav(winbaIndexCards({ items: series }), a.period)
    : null;
  const winba = a.winba_reference && a.winba_sentence ? a.winba_reference : null;
  const winbaAfter = winba ? (a.winba_placement?.after_section ?? null) : null;
  // The reference is frozen at publication, so this paragraph is the score the
  // story reported, not the score the leaderboard holds now.
  const winbaPara = (key) => (winba && winbaAfter !== null && String(key) === String(winbaAfter)
    ? html`<p class="winba-context">${linkArticleEntities(a.winba_sentence, linkedEntities, linkedSeen)}</p>`
    : '');
  const winbaTrailing = winba && (winbaAfter === null || !(a.sections || []).some((s) => String(s.key || s.title) === String(winbaAfter)))
    ? html`<p class="winba-context">${linkArticleEntities(a.winba_sentence, linkedEntities, linkedSeen)}</p>`
    : '';

  return html`
    <article class="story">
      <div class="story-hero">${storyMedia(a.media, { slot: 'hero', eager: true, credit: true })}</div>

      ${a.quality_state === 'legacy_acceptable' ? html`<aside class="coverage-note" role="note"><b>Archived under an earlier newsroom standard.</b> This article remains part of the publication record but is no longer promoted in the current newsroom or search index.</aside>` : ''}\n      ${a.quality_state === 'retired_from_index' && !a.external_coverage ? html`<aside class="coverage-note" role="note"><b>No longer listed in the newsroom.</b> ${a.quality_review?.reason ? `${a.quality_review.reason.charAt(0).toUpperCase()}${a.quality_review.reason.slice(1)}.` : ''} The record below is kept as published.</aside>` : ''}
      ${a.external_coverage ? html`<aside class="coverage-note" role="note"><b>Moved to external coverage.</b> This item was a note on another publisher’s feature rather than a newsroom event, so it is no longer listed in the PropBetEdge newsroom. ${a.external_coverage.source_url ? html`Read <a href="${a.external_coverage.source_url}" rel="noopener" target="_blank">${a.external_coverage.source_name || 'the original report'} ↗</a>. ` : ''}The record below is kept for transparency.</aside>` : ''}
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
          ${observed ? html`<span>Source data as of ${fmtDateTimeET(observed)}</span>` : ''}
        </div>
        ${players.length || teams.length ? html`<nav class="story-entity-rail" aria-label="Players and teams in this story">
          <span>In this story</span>
          ${players.map((p) => html`<a href="/players/${p.id}">${p.name}</a>`)}
          ${teams.map((t) => html`<a href="/teams/${t.id}">${t.name}</a>`)}
          ${winba ? html`<a href="${METRIC_HREF.winba}" title="WinBA Score — PropBetEdge overall WNBA player rating">WinBA ${Math.round(winba.score)}</a>` : ''}
        </nav>` : ''}
        ${seriesNav ? winbaSeriesNavView(seriesNav) : ''}
      </header>

      <div class="story-layout">
        <div class="story-body art-body">
          ${a.sections?.length
            ? html`${a.body.slice(0, a.sections[0].first).map((p) => html`<p>${linkArticleEntities(p, linkedEntities, linkedSeen)}</p>`)}${a.sections.map((s, i) => (indexBoard && s.render === 'winba_leaders' ? '' : html`${s.title ? html`<h2>${s.title}</h2>` : ''}${a.body.slice(s.first, s.first + s.count).map((p) => html`<p>${linkArticleEntities(p, linkedEntities, linkedSeen)}</p>`)}${winbaPara(s.key || s.title)}${i === 0 ? indexBoard : ''}${i === 0 && a.sections.length > 1 ? gameHighlights(a) : ''}`))}`
            : a.body.map((p) => html`<p>${linkArticleEntities(p, linkedEntities, linkedSeen)}</p>`)}${winbaTrailing}${a.sections?.length > 1 ? '' : gameHighlights(a)}
        </div>
        <aside class="story-aside">
          ${players.length ? html`<section><h2 class="aside-title">In this story</h2>
            ${players.slice(0, 6).map((p) => { const s = photoOf(p); return html`<a class="aside-row" href="/players/${p.id}">${avatar({ name: p.name, photo: s ? { square: s.square } : null })}<b>${p.name}</b>${pictured.has(String(p.id)) ? html`<span class="note">pictured</span>` : ''}</a>`; })}
          </section>` : ''}
          ${teams.length ? html`<section><h2 class="aside-title">Teams</h2>${teams.map((t) => html`<a class="aside-row" href="/teams/${t.id}">${teamLogo({ team_id: t.id, name: t.name }, 28)}<b>${t.name}</b></a>`)}</section>` : ''}
          ${gameLinks.length ? html`<section><h2 class="aside-title">Game</h2>${gameLinks.map((g) => html`<a class="aside-row" href="/matchups/${g.id}"><b>${g.name}</b><span class="note">${g.start_utc ? `${fmtDateET(g.start_utc, { month: 'short', day: 'numeric' })} · ` : ''}Matchup research →</span></a><a class="aside-row" href="/cast/${g.id}"><b>WNBACast</b><span class="note">Live game &amp; replay →</span></a>`)}</section>` : ''}
          ${intl.length ? html`<section><h2 class="aside-title">International</h2>${intl.map((e) => html`<a class="aside-row" href="${e.type === 'intl_team' ? `/international/teams/${e.id}` : `/international/games/${e.id}`}"><b>${e.name}</b><span class="note">${e.type === 'intl_team' ? 'National team →' : 'Box score & play-by-play →'}</span></a>`)}</section>` : ''}
          <section><h2 class="aside-title">Keep reading</h2>
            ${(DESK_LINKS[a.kind] || []).map(([href, label]) => html`<a class="aside-row" href="${href}"><b>${label}</b></a>`)}
            <a class="aside-row" href="/news"><b>WNBA newsroom front page</b></a>
          </section>
        </aside>
      </div>

      ${intelligenceView(a)}

      <section class="trust-layer" id="evidence">
        <details class="evidence-method">
          <summary><span class="sec-title bc">Evidence &amp; methodology</span><span class="note">${(a.evidence || []).length} cited ${(a.evidence || []).length === 1 ? 'record' : 'records'} · how this story was built</span></summary>
          <h3 class="em-h">Records cited</h3>
          <ol class="evidence">
            ${(a.evidence || []).map((e) => html`<li><b>${e.kind === 'publisher_report' ? `${e.publisher} (publisher report)` : e.source}</b>${e.headline ? html` — “${e.headline}”` : ''}${e.published_at ? ` · published ${fmtDateTimeET(e.published_at)}` : ''}${e.captured_at ? ` · observed ${fmtDateTimeET(e.captured_at)}` : ''}${e.url ? html` · <a href="${e.url}" rel="noopener" target="_blank">source ↗</a>` : ''}</li>`)}
          </ol>
          <h3 class="em-h">How this story was built</h3>
          ${(a.method || []).map((x) => html`<p class="note">${x}</p>`)}
          ${a.media?.subjects?.length ? html`<p class="note">${creditLine(a.media, { compact: true })}.</p>` : ''}
          ${a.quality_state === 'legacy_acceptable' ? html`<p class="note">Published under an earlier newsroom standard (${a.quality_review?.generator || 'an earlier generator'}). ${a.quality_review?.reason ? `Current review: ${a.quality_review.reason}.` : ''}</p>` : ''}
          <p class="note">Generated by PropBetEdge’s deterministic newsroom (${a.generator?.version}${a.provenance?.generator ? ` · ${a.provenance.generator}` : ''}${a.depth?.label ? ` · ${a.depth.label} story, ${a.depth.version}` : ''}) and checked by the publication gate before release${intel.market_relevance === 'none' ? '' : `; betting relevance: ${intel.market_relevance}`}.</p>
          ${(a.revisions || []).length ? html`<h3 class="em-h">Revisions</h3><ul class="revisions">${a.revisions.map((r) => html`<li><time datetime="${r.at}">${fmtDateTimeET(r.at)}</time> · ${REVISION_LABEL[r.kind] || r.kind.replaceAll('_', ' ')}${r.from && r.to ? ` (${r.from} → ${r.to})` : ''}</li>`)}</ul>` : ''}
          <p class="note trust-links"><a href="/editorial-policy">Editorial policy</a> · <a href="/corrections">Corrections &amp; revisions</a> · <a href="/methodology">Methodology</a> · <a href="/sources">Sources</a></p>
        </details>
      </section>

      ${related.length ? html`<section class="section related">
        <div class="sec-head"><h2 class="sec-title bc">Related coverage</h2><a class="sec-link" href="/news">Newsroom →</a></div>
        <div class="ngrid">${related.slice(0, 3).map((c) => articleCard(c))}</div>
      </section>` : ''}
    </article>
  `;
}
