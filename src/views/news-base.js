// WNBA News & Intelligence — the PropBetEdge editorial front page, desk pages and team news pages.
// PropBetEdge's own reporting leads: a rotating editorial hero, Game Day, recaps/highlights, Latest, then the desks
// (Injury Desk, Roster Moves, League, Previews, Performances, Team Trends). The external Source Wire sits last,
// visibly attributed and subordinate — headlines and links only; the reporting belongs to them.
// Navigation stays compact: four primary desks as chips, a team selector and one "More desks" menu — all plain
// crawlable links inside native <details> disclosures, identical in the server render and the SPA.
// Shared by the SPA page and the wnba-web publishing Worker.
import { html } from '../lib/dom.js';
import { errorState, badge, entityChips } from '../ui/components.js';
import { articleCard, articleRow, KIND_LABEL, DESK } from '../ui/articles.js';
import { teamLogo } from '../ui/logo.js';
import { storyMedia } from '../ui/story-media.js';
import { VIDEO_ID } from '../ui/video.js';
import { relTime, fmtDateTimeET } from '../lib/format.js';
import { storyPublishedAt } from '../lib/news-ranking.js';

export const DESKS = [
  ['injury', 'Injury Desk', 'Status changes from ESPN’s injury feed and attributed reporting: the minutes at stake and what argues against the obvious read.'],
  ['transaction', 'Roster Moves', 'Signings, waivers, trades and hardship contracts from ESPN’s transactions log and attributed reporting.'],
  ['league', 'League', 'Awards, coaching and front-office changes, the playoff picture, expansion and labor — material league events, attributed and checked against PropBetEdge’s records.'],
  ['preview', 'Previews', 'Form, rest, availability and the stored market for the next slate.'],
  ['performance', 'Performances', 'Box-score stories: who carried the night and how it compares with her season.'],
  ['trend', 'Team Trends', 'Against-the-spread and totals runs, measured against a named sportsbook’s lines.']
];
/** Primary desk chips, then the lower-traffic desks behind "More desks". */
export const PRIMARY_DESKS = ['injury', 'transaction', 'league', 'international'];
export const MORE_DESKS = ['brief', 'preview', 'performance', 'trend', 'props', 'market'];
export const DESK_KINDS = [...PRIMARY_DESKS, ...MORE_DESKS];

const HOUR = 3600e3;
const HERO_FRESH_MS = 72 * HOUR;
const HERO_CURRENT_MS = 7 * 24 * HOUR;
const RECAP_CURRENT_MS = 48 * HOUR;
const HERO_NEWS_KINDS = new Set(['brief', 'international', 'injury', 'transaction', 'league', 'preview', 'performance', 'result']);
const dateline = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDay = (ms) => ET_DAY.format(new Date(ms));
const gameEntityOf = (c) => (c?.entities || []).find((e) => e?.type === 'game' && e.start_utc) || null;
const storyGroup = (c) => c?.kind === 'result' ? 'performance' : c?.desk || c?.kind || 'story';
const heroStoryAt = (c, now) => {
  const origin = storyPublishedAt(c);
  if (c?.kind !== 'preview') return origin;
  const game = gameEntityOf(c);
  const start = Date.parse(game?.start_utc || '');
  if (!Number.isFinite(start)) return origin;
  // A preview stops being a hero candidate as soon as its game tips. The recap/highlights system
  // owns the postgame surface instead of leaving stale pregame framing at the top of the newsroom.
  if (start <= now) return 0;
  if (etDay(start) !== etDay(now)) return origin;
  // Same-day previews are current because the event is current, even if the canonical story was
  // first published days ago. Keep the real publication timestamp untouched everywhere else.
  // The nearest upcoming tip ranks highest inside the single Preview hero slot.
  return now - Math.max(0, start - now) / 1000;
};
// A story files under its kind, and a News Brief also under its event's desk (an official injury update → Injury Desk).
const ofKind = (items, k) => items.filter((c) => c.kind === k || c.desk === k || (k === 'performance' && c.kind === 'result'));
const OFFICIAL_KINDS = new Set(['official', 'team_official']);

/**
 * Current ET game-day previews are event-relevant even when the canonical article was first
 * published days earlier. This does not mutate editorial freshness: it is a separate game slate.
 * Once tip passes, the preview leaves the slate naturally. One canonical game = one card.
 */
export function gameDayPreviewItems(items, { now = Date.now() } = {}) {
  const today = etDay(now);
  const seen = new Set();
  return (items || [])
    .filter((c) => c?.kind === 'preview' && c?.status !== 'held')
    .map((c) => ({ c, game: gameEntityOf(c) }))
    .filter(({ game }) => {
      const start = Date.parse(game?.start_utc || '');
      return Number.isFinite(start) && start > now && etDay(start) === today;
    })
    .sort((a, b) => Date.parse(a.game.start_utc) - Date.parse(b.game.start_utc))
    .filter(({ game }) => {
      const key = String(game.id || `${game.name}|${game.start_utc}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ c }) => c);
}

/**
 * Hero ranking is freshness-first. Variety is preferred inside the fresh 72-hour pool, but an
 * older story can never displace a fresher story just to manufacture desk diversity. Same-day
 * previews get game-time relevance without rewriting their canonical publication clock. Only when
 * fewer than four fresh candidates exist may still-current older coverage fill the remaining slots.
 */
export function heroStoryItems(items, { now = Date.now(), limit = 4 } = {}) {
  const candidates = (items || [])
    .filter((c) => c?.status !== 'held' && HERO_NEWS_KINDS.has(c?.kind))
    .map((c) => ({ c, at: heroStoryAt(c, now) }))
    .filter(({ at }) => at > 0 && now - at >= 0 && now - at <= HERO_CURRENT_MS)
    .sort((a, b) => b.at - a.at);

  const fresh = candidates.filter(({ at }) => now - at <= HERO_FRESH_MS);
  const older = candidates.filter(({ at }) => now - at > HERO_FRESH_MS);
  const out = [];
  const seenGroups = new Set();

  const addDiverse = (pool) => {
    for (const { c } of pool) {
      if (out.length >= limit) break;
      const group = storyGroup(c);
      if (seenGroups.has(group)) continue;
      out.push(c);
      seenGroups.add(group);
    }
  };
  const addAny = (pool) => {
    for (const { c } of pool) {
      if (out.length >= limit) break;
      if (out.some((x) => x.id === c.id)) continue;
      out.push(c);
      seenGroups.add(storyGroup(c));
    }
  };

  // Never reach backward in time for variety while fresh stories can still fill the hero.
  addDiverse(fresh);
  addAny(fresh);
  if (out.length < limit) {
    addDiverse(older);
    addAny(older);
  }
  return out;
}

/**
 * Recent completed-game coverage becomes a dedicated recap/highlights rail. One card per game,
 * with official-video stories preferred and broad result recaps preferred over secondary performance
 * stories when both exist. Event time, not article revision time, controls how long a game stays current.
 */
export function recapHighlightItems(items, { now = Date.now(), limit = 6, maxAgeMs = RECAP_CURRENT_MS } = {}) {
  const candidates = (items || [])
    .filter((c) => ['result', 'performance'].includes(c?.kind) && c?.status !== 'held')
    .map((c) => {
      const game = gameEntityOf(c);
      const eventAt = Date.parse(game?.start_utc || '') || storyPublishedAt(c);
      return { c, game, eventAt };
    })
    .filter(({ eventAt }) => eventAt > 0 && eventAt <= now && now - eventAt <= maxAgeMs);

  const byGame = new Map();
  const score = (c) => (c?.video ? 4 : 0) + (c?.kind === 'result' ? 2 : 0) + (c?.media ? 1 : 0);
  for (const row of candidates) {
    const key = String(row.game?.id || row.c?.context?.game?.game_id || row.c.id);
    const prev = byGame.get(key);
    if (!prev || score(row.c) > score(prev.c) || (score(row.c) === score(prev.c) && storyPublishedAt(row.c) > storyPublishedAt(prev.c))) {
      byGame.set(key, row);
    }
  }
  return [...byGame.values()]
    .sort((a, b) => b.eventAt - a.eventAt)
    .slice(0, limit)
    .map(({ c }) => c);
}
const videoDuration = (seconds) => Number.isFinite(Number(seconds)) && Number(seconds) > 0
  ? `${Math.floor(Number(seconds) / 60)}:${String(Math.round(Number(seconds)) % 60).padStart(2, '0')}`
  : null;
const hasPlayableCardVideo = (c) => c?.video?.provider === 'youtube' && VIDEO_ID.test(c.video.video_id || '');

function highlightVideoCard(c, { lead = false } = {}) {
  const v = c.video;
  const href = `/news/${c.slug}`;
  const len = videoDuration(v.duration_s);
  return html`<article class="vrecap ${lead ? 'vrecap--lead' : ''}">
    <div class="vrecap-media" data-gh-frame>
      ${storyMedia(c.media, { slot: lead ? 'lead' : 'card', eager: lead, credit: false })}
      <button class="vrecap-play" type="button" data-gh-play="${v.video_id}" data-gh-title="${v.title}" aria-label="${`Play highlights: ${v.title}. Loads the official YouTube player.`}">
        <span class="vrecap-play-icon" aria-hidden="true">▶</span>
        <span class="vrecap-play-copy"><b>Watch highlights</b><small>${v.channel_name || 'Official video'}${len ? ` · ${len}` : ''}</small></span>
      </button>
    </div>
    <div class="vrecap-copy">
      <div class="vrecap-kicker"><span>${DESK[c.kind] || KIND_LABEL[c.kind] || c.category}</span><span>${relTime(storyPublishedAt(c))}</span></div>
      <h3 class="vrecap-title"><a href="${href}">${headlineText(c.headline)}</a></h3>
      ${lead && c.deck ? html`<p class="vrecap-deck">${headlineText(c.deck)}</p>` : ''}
      <div class="vrecap-actions"><a href="${href}">Read recap →</a><span>Official highlights</span></div>
    </div>
  </article>`;
}

function recapHighlightsView(recaps) {
  const videos = recaps.filter(hasPlayableCardVideo);
  const textOnly = recaps.filter((c) => !hasPlayableCardVideo(c));
  if (!videos.length) return html`<div class="ngrid">${recaps.map((c) => articleCard(c))}</div>`;

  const lead = videos[0];
  const side = videos.slice(1, 3);
  const more = videos.slice(3, 6);
  return html`
    <div class="video-recap-stage">
      ${highlightVideoCard(lead, { lead: true })}
      ${side.length ? html`<div class="video-recap-side">${side.map((c) => highlightVideoCard(c))}</div>` : ''}
    </div>
    ${more.length ? html`<div class="video-recap-more">${more.map((c) => highlightVideoCard(c))}</div>` : ''}
    ${textOnly.length ? html`<div class="recap-text-more"><span class="module-kicker">More final-score coverage</span><div class="srows srows--grid">${textOnly.map(articleRow)}</div></div>` : ''}
  `;
}

export async function loadNews(api, kind = null, teamId = null) {
  const [arts, wire, teams] = await Promise.all([
    api.articles({ limit: teamId ? 60 : 200, kind: kind || undefined, team: teamId || undefined }),
    kind ? Promise.resolve({ ok: false }) : api.news({ limit: teamId ? 30 : 20, lane: 'external', team: teamId || undefined }),
    api.teams().catch(() => ({ ok: false }))
  ]);
  const teamList = teams?.ok ? [...teams.data.teams].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const team = teamId ? teamList.find((t) => String(t.team_id) === String(teamId)) || null : null;
  return { kind, teamId, team, teams: teamList, teamsOk: Boolean(teams?.ok), arts, wire };
}

function marketWatch(items) {
  const seen = new Set();
  const rows = items.filter((c) => c.has_market && c.market).filter((c) => { const k = `${c.market.away_abbr}@${c.market.home_abbr}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  if (!rows.length) return html`<p class="note">No stored market capture is attached to a current story. Captures run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.</p>`;
  return html`<div class="mw-rows">${rows.map((c) => html`<a class="mw-row" href="/news/${c.slug}">
      <span class="mw-game">${c.market.away_abbr && c.market.home_abbr ? `${c.market.away_abbr} @ ${c.market.home_abbr}` : KIND_LABEL[c.kind]}</span>
      <span class="mw-line">${c.market.spread !== null ? `${c.market.home_abbr || 'Home'} ${c.market.spread > 0 ? '+' : ''}${c.market.spread}` : '—'}</span>
      <span class="mw-line">${c.market.total !== null ? `O/U ${c.market.total}` : '—'}</span>
      <span class="mw-meta">${c.market.books} books · ${relTime(c.market.captured_at)}</span>
    </a>`)}</div>
    <p class="note" style="margin-top:10px">Stored sportsbook prices and no-vig market consensus from The Odds API, with book count and capture time kept visible.</p>`;
}

function sourceWire(wire, { limit = 12, empty = 'Source wire unavailable.' } = {}) {
  if (!wire?.ok) return html`<p class="note">${empty}</p>`;
  if (!wire.data.items.length) return html`<p class="note">No attributed reports in the current window.</p>`;
  return html`<ol class="wire">${wire.data.items.slice(0, limit).map((i) => html`<li>
      <div class="nmeta">${badge(OFFICIAL_KINDS.has(i.source.kind) ? 'pbe' : 'ext', OFFICIAL_KINDS.has(i.source.kind) ? `${i.source.name.replace(/\s*\(official\)$/, '')} · Official` : i.source.name)}<span>${relTime(i.published_at)}</span>${i.publishers > 1 ? html`<span class="note">${i.publishers} publishers</span>` : ''}</div>
      <a href="${i.url}" rel="noopener" target="_blank">${i.headline}&nbsp;<span class="note" aria-hidden="true">↗</span></a>
      <div class="nents">${entityChips(i.entities)}</div>
    </li>`)}</ol>`;
}

/** Desk chips + team selector + "More desks". Native <details> menus: keyboard operable without script, links crawlable. */
export function deskNav({ kind = null, teamId = null, teams = [] } = {}) {
  const chip = (href, label, on) => html`<a class="${on ? 'on' : ''}" href="${href}" ${on ? html`aria-current="page"` : ''}>${label}</a>`;
  const moreOn = MORE_DESKS.includes(kind);
  const current = teamId ? teams.find((t) => String(t.team_id) === String(teamId)) : null;
  return html`<nav class="desk-nav" aria-label="Newsroom desks">
    ${chip('/news', 'Latest', !kind && !teamId)}
    ${PRIMARY_DESKS.map((k) => chip(`/news/c/${k}`, k === 'injury' ? 'Injuries' : DESK[k], kind === k))}
    ${teams.length ? html`<details class="desk-menu" data-desk-menu>
      <summary class="${teamId ? 'on' : ''}">${current ? current.short_name || current.name : 'Teams'}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="desk-menu-list desk-menu-list--teams">${teams.map((t) => html`<a href="/news/teams/${t.team_id}" class="${String(t.team_id) === String(teamId) ? 'on' : ''}" ${String(t.team_id) === String(teamId) ? html`aria-current="page"` : ''}>${teamLogo({ team_id: t.team_id, name: t.name }, 18)}<span>${t.name}</span></a>`)}</div>
    </details>` : ''}
    <details class="desk-menu" data-desk-menu>
      <summary class="${moreOn ? 'on' : ''}">${moreOn ? DESK[kind] : 'More desks'}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="desk-menu-list">${MORE_DESKS.map((k) => html`<a href="/news/c/${k}" class="${kind === k ? 'on' : ''}" ${kind === k ? html`aria-current="page"` : ''}>${DESK[k]}</a>`)}</div>
    </details>
  </nav>`;
}

export function newsHeadView(kind, team = null) {
  return html`<header class="masthead"><span class="eyebrow">PropBetEdge · WNBA</span><h1 class="mast-title">${team ? `${team.name} News` : kind ? DESK[kind] || KIND_LABEL[kind] || 'Newsroom' : 'WNBA News & Intelligence'}</h1></header>`;
}

/** Team news page: PBE stories on the team, then the team's official announcements and beat reports, attributed. */
function teamNewsView({ team, teams, arts, wire }) {
  const items = arts.data.items;
  const lastRun = arts.meta?.last_run_at || null;
  const mast = html`<header class="masthead">
    <div class="mast-row"><span class="eyebrow">PropBetEdge · WNBA · Team news</span><span class="mast-date">${dateline()}${lastRun ? ` · AUTO · updated ${relTime(lastRun)}` : ''}</span></div>
    <h1 class="mast-title">${team.name} News</h1>
    <p class="mast-sub">PropBetEdge stories on the ${team.name} — injuries, roster moves, previews and recaps — plus attributed beat and national coverage. <a class="gold" href="/teams/${team.team_id}">${team.short_name || team.name} team page →</a></p>
    ${deskNav({ teamId: team.team_id, teams })}
  </header>`;
  const empty = !items.length && !(wire?.ok && wire.data.items.length);
  const [first, ...rest] = items;
  return {
    empty,
    body: html`${mast}
      ${first ? html`<section class="front-lead front-lead--desk">${articleCard(first, { size: 'lead', eager: true })}</section>
        ${rest.length ? html`<div class="ngrid section">${rest.slice(0, 12).map((c) => articleCard(c))}</div>` : ''}` : html`<div class="empty"><h3>No PropBetEdge stories on the ${team.name} in the current window</h3><p>The newsroom publishes only when a record supports a story. Official announcements and beat reports are below.</p></div>`}
      <section class="wire-wrap section">
        <div class="sec-head"><div><h2 class="sec-title bc">Beat &amp; national reports</h2><p class="desk-sub">Attributed beat and national reports — headline and link only; the reporting is theirs.</p></div></div>
        ${sourceWire(wire, { limit: 20 })}
      </section>
      <p class="note section">Auto-updating · last newsroom pass ${lastRun ? relTime(lastRun) : 'unknown'} · <a href="/sources">Source status</a></p>`
  };
}

function heroCarousel(items) {
  if (!items.length) return '';
  return html`<section class="news-hero" data-news-hero data-news-hero-count="${items.length}" aria-label="Top WNBA stories" aria-roledescription="carousel">
    <div class="news-hero-track" aria-live="off">
      ${items.map((c, i) => html`<div class="news-hero-slide ${i === 0 ? 'is-active' : ''}" data-news-hero-slide="${i}" aria-hidden="${i === 0 ? 'false' : 'true'}" role="group" aria-label="Story ${i + 1} of ${items.length}">
        <div class="front-lead">${articleCard(c, { size: 'lead', eager: i === 0 })}</div>
      </div>`)}
    </div>
    ${items.length > 1 ? html`<div class="news-hero-controls" aria-label="Hero story controls">
      <button class="news-hero-arrow" type="button" data-news-hero-prev aria-label="Previous story">‹</button>
      <div class="news-hero-dots">${items.map((c, i) => html`<button class="news-hero-dot ${i === 0 ? 'is-active' : ''}" type="button" data-news-hero-dot="${i}" aria-label="Show story ${i + 1}: ${c.headline}" ${i === 0 ? html`aria-current="true"` : ''}></button>`)}</div>
      <button class="news-hero-arrow" type="button" data-news-hero-next aria-label="Next story">›</button>
      <span class="news-hero-note">Top 4 · rotates every 8 seconds</span>
    </div>` : ''}
  </section>`;
}

/** Returns { body, empty } — `empty` lets the Worker mark a desk with no stories noindex. */
export function newsView({ kind = null, teamId = null, team = null, teams = [], arts, wire = { ok: false } }) {
  if (!arts?.ok) return { body: html`${newsHeadView(kind, team)}${errorState(arts, 'WNBA News & Intelligence')}`, empty: true, error: true };
  if (teamId && team) return teamNewsView({ team, teams, arts, wire });
  const items = arts.data.items;
  const lastRun = arts.meta?.last_run_at || null;
  const autoStatus = lastRun ? `AUTO · updated ${relTime(lastRun)}` : 'AUTO';
  const mast = html`<header class="masthead">
    <div class="mast-row"><span class="eyebrow">PropBetEdge · WNBA</span><span class="mast-date">${dateline()} · ${autoStatus}</span></div>
    <h1 class="mast-title">${kind ? DESK[kind] || KIND_LABEL[kind] : 'WNBA News & Intelligence'}</h1>
    <p class="mast-sub">${kind ? (DESKS.find(([k]) => k === kind)?.[2] || 'Stories from this desk, newest first.') : 'Automated, source-grounded WNBA reporting and market intelligence — continuously refreshed from injuries, transactions, box scores, standings, attributed publisher reporting and sportsbook captures.'}</p>
    ${deskNav({ kind, teams })}
  </header>`;

  if (!items.length) {
    return { body: html`${mast}<div class="empty"><h3>Nothing on this desk yet</h3><p>The newsroom publishes only when a record supports a story. Quiet days stay quiet.</p></div>`, empty: true };
  }

  if (kind) {
    const [first, ...rest] = items;
    return {
      body: html`${mast}
        <section class="front-lead front-lead--desk">${articleCard(first, { size: 'lead', eager: true })}</section>
        <div class="ngrid section">${rest.map((c) => articleCard(c))}</div>
        <p class="note section">Auto-updating · last newsroom pass ${lastRun ? relTime(lastRun) : 'unknown'} · ${arts.data.total} stories on this desk.</p>`,
      empty: false
    };
  }

  const gameDay = gameDayPreviewItems(items);
  const gameDayIds = new Set(gameDay.map((c) => c.id));
  // Game-day previews are intentionally allowed to appear here and in Tonight's Slate: the hero
  // answers "what matters now," while the slate is the complete schedule context.
  const hero = heroStoryItems(items);
  const recaps = recapHighlightItems(items);
  const heroIds = new Set(hero.map((c) => c.id));
  const recapIds = new Set(recaps.map((c) => c.id));
  const shown = new Set([...heroIds, ...gameDayIds, ...recapIds]);
  // Latest is newest-first by editorial origin, so a revision never floats old coverage back up the river.
  const latest = items.filter((c) => !shown.has(c.id)).sort((a, b) => storyPublishedAt(b) - storyPublishedAt(a)).slice(0, 8);
  const deskItems = (k) => ofKind(items, k).filter((c) => !shown.has(c.id));

  return {
    empty: false,
    body: html`
      ${mast}
      ${heroCarousel(hero)}

      ${gameDay.length ? html`<section class="desk section game-day-slate">
        <div class="sec-head"><div><span class="eyebrow">Game Day</span><h2 class="sec-title bc">Tonight’s WNBA Slate</h2><p class="desk-sub">Every upcoming game on today’s ET slate — form, rest, availability and the latest stored market. Ordered by tip time, independent of when the canonical preview was first published.</p></div><a class="sec-link" href="/news/c/preview">All previews →</a></div>
        <div class="ngrid">${gameDay.map((c) => articleCard(c))}</div>
      </section>` : ''}

      ${recaps.length ? html`<section class="desk section recap-highlights" data-recap-count="${recaps.length}">
        <div class="sec-head"><div><span class="eyebrow">Finals · Video</span><h2 class="sec-title bc">Recaps &amp; Highlights</h2><p class="desk-sub">Completed games from the last 48 hours — final-score recaps first, with official game highlights surfaced whenever the verified video feed has them.</p></div><a class="sec-link" href="/news/c/performance">All recaps →</a></div>
        ${recapHighlightsView(recaps)}
      </section>` : ''}

      <section class="front-band section">
        <div>
          <div class="sec-head"><h2 class="sec-title bc">Latest</h2><span class="note">newest first · auto · last pass ${lastRun ? relTime(lastRun) : 'unknown'}</span></div>
          <div class="srows">${latest.map(articleRow)}</div>
        </div>
        <aside class="panel mw">
          <div class="sec-head"><h2 class="sec-title bc">Market Watch</h2><a class="sec-link" href="/props">Best lines →</a></div>
          ${marketWatch(items)}
        </aside>
      </section>

      ${DESKS.map(([k, name, sub]) => {
        const xs = deskItems(k).slice(0, k === 'transaction' || k === 'league' ? 4 : 6);
        if (!xs.length) return '';
        return html`<section class="desk section">
          <div class="sec-head"><div><h2 class="sec-title bc">${name}</h2><p class="desk-sub">${sub}</p></div><a class="sec-link" href="/news/c/${k}">All ${name.toLowerCase()} →</a></div>
          ${k === 'transaction' || k === 'league' ? html`<div class="srows srows--grid">${xs.map(articleRow)}</div>` : html`<div class="ngrid">${xs.map((c) => articleCard(c))}</div>`}
        </section>`;
      })}

      <section class="wire-wrap section">
        <div class="sec-head"><div><h2 class="sec-title bc">Source wire</h2><p class="desk-sub">The external publishers the newsroom tracks — attributed, headline and link only. This is their reporting, not PropBetEdge’s. <a href="/sources">Source status →</a></p></div></div>
        ${sourceWire(wire)}
      </section>

      <section class="trust section newsroom-trust" aria-labelledby="newsroom-trust-title">
        <div class="newsroom-trust-main">
          <span class="eyebrow">How we write</span>
          <h2 id="newsroom-trust-title">Grounded first. Published second.</h2>
          <p>PropBetEdge stories are built from structured records and attributed reporting, then checked by a publication gate. Unsupported numbers, projection claims and unbalanced bettor angles do not publish.</p>
        </div>
        <div class="newsroom-trust-side">
          <nav class="newsroom-trust-links" aria-label="Newsroom standards">
            <a href="/editorial-policy">Editorial policy</a>
            <a href="/corrections">Corrections</a>
            <a href="/methodology">Methodology</a>
            <a href="/rss.xml">RSS</a>
          </nav>
          <p class="newsroom-trust-status"><span aria-hidden="true"></span>Auto-updating every 2 minutes · last pass ${lastRun ? `${relTime(lastRun)} (${fmtDateTimeET(lastRun)})` : 'unknown'} · ${arts.data.total} stories live</p>
        </div>
      </section>
    `
  };
}