// WNBA News & Intelligence — the PropBetEdge editorial front page, desk pages and team news pages.
// PropBetEdge's own reporting leads: a dominant photographic lead story, top stories, Latest, then the desks
// (Injury Desk, Roster Moves, League, Previews, Performances, Team Trends). The external Source Wire sits last,
// visibly attributed and subordinate — headlines and links only; the reporting belongs to them.
// Navigation stays compact: four primary desks as chips, a team selector and one "More desks" menu — all plain
// crawlable links inside native <details> disclosures, identical in the server render and the SPA.
// Shared by the SPA page and the wnba-web publishing Worker.
import { html } from '../lib/dom.js';
import { errorState, badge, entityChips } from '../ui/components.js';
import { articleCard, articleRow, KIND_LABEL, DESK } from '../ui/articles.js';
import { teamLogo } from '../ui/logo.js';
import { relTime, fmtDateTimeET } from '../lib/format.js';
import { chooseLead, topStories, storyPublishedAt } from '../lib/news-ranking.js';

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

const dateline = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDay = (ms) => ET_DAY.format(new Date(ms));
const gameEntityOf = (c) => (c?.entities || []).find((e) => e?.type === 'game' && e.start_utc) || null;
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
  const official = wire?.ok ? wire.data.items.filter((i) => OFFICIAL_KINDS.has(i.source.kind)).length : 0;
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
  // Keep the editorial lead/top-story river separate from the game slate. A six-day-old canonical
  // preview can be essential tonight without pretending it was newly published tonight.
  const headlinePool = items.filter((c) => !gameDayIds.has(c.id));
  const rankingPool = headlinePool.length ? headlinePool : items;
  const lead = chooseLead(rankingPool);
  const tops = topStories(rankingPool, lead, { limit: 3 });
  const shown = new Set([lead?.id, ...tops.map((c) => c.id), ...gameDayIds]);
  // Latest is newest-first by editorial origin, so a revision never floats old coverage back up the river.
  const latest = items.filter((c) => !shown.has(c.id)).sort((a, b) => storyPublishedAt(b) - storyPublishedAt(a)).slice(0, 8);
  const deskItems = (k) => ofKind(items, k).filter((c) => !shown.has(c.id));

  return {
    empty: false,
    body: html`
      ${mast}
      <section class="front-top">
        <div class="front-lead">${articleCard(lead, { size: 'lead', eager: true })}</div>
        <div class="front-side">
          <h2 class="rail-title">Top stories</h2>
          ${tops.length ? tops.map((c) => articleCard(c, { size: 'feature' })) : html`<p class="note">No additional stories from the last 72 hours.</p>`}
        </div>
      </section>

      ${gameDay.length ? html`<section class="desk section game-day-slate">
        <div class="sec-head"><div><h2 class="sec-title bc">Tonight’s WNBA Slate</h2><p class="desk-sub">Every upcoming game on today’s ET slate — form, rest, availability and the latest stored market. Ordered by tip time, independent of when the canonical preview was first published.</p></div><a class="sec-link" href="/news/c/preview">All previews →</a></div>
        <div class="ngrid">${gameDay.map((c) => articleCard(c))}</div>
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

      <section class="trust section">
        <span class="eyebrow">How we write</span>
        <p>Every story is generated by PropBetEdge from structured records and passes a publication gate before it goes live: each number must appear in a cited record, the only quotations allowed are a publisher’s own headline with the publisher named, there are no picks or unsupported projection claims, and every bettor angle states what argues against it and what is still unknown. Stories that fail are held, not published. Photographs are licensed Wikimedia Commons images, matched to the player by exact name and date of birth and credited on the image.</p>
        <p class="note"><a href="/editorial-policy">Editorial policy</a> · <a href="/corrections">Corrections &amp; revisions</a> · <a href="/methodology">Methodology</a> · <a href="/rss.xml">RSS feed</a></p>
        <p class="note">Auto-updating this tab every 2 minutes · last newsroom pass ${lastRun ? `${relTime(lastRun)} (${fmtDateTimeET(lastRun)})` : 'unknown'} · ${arts.data.total} stories live.</p>
      </section>
    `
  };
}
