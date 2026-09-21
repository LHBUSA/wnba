// WNBA News & Intelligence — live newsroom wrapper.
//
// news-base.js owns the established editorial layout. This layer adds a visible
// historical archive rail backed by the permanent article catalog without
// weakening the publication gate. Current-story curation and publication history
// are intentionally separate.

import { html, raw } from '../lib/dom.js';
import { currentWinbaEdition } from './winba-index.js';
import { winbaCurrentEditionModule } from './winba-leaderboard.js';
import { articleCard, articleRow } from '../ui/articles.js';
import * as base from './news-base.js';

export const DESKS = base.DESKS;
export const PRIMARY_DESKS = base.PRIMARY_DESKS;
export const MORE_DESKS = base.MORE_DESKS;
export const DESK_KINDS = base.DESK_KINDS;
export const deskNav = base.deskNav;
export const newsHeadView = base.newsHeadView;

const TIP_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short'
});

const ARCHIVE_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});
const ARCHIVE_MONTH = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'long',
  year: 'numeric'
});
const articleAt = (c) => Date.parse(c?.first_published_at || c?.published_at || 0) || 0;
const canonicalArchiveItems = (archive) => (archive?.data?.items || [])
  .filter((c) => !['duplicate', 'superseded'].includes(c.archive_state))
  .sort((a, b) => articleAt(b) - articleAt(a));

export async function loadNews(api, kind = null, teamId = null) {
  const isFront = !kind && !teamId;
  const [arts, wire, teams, archive, previews, today] = await Promise.all([
    api.articles({ limit: teamId ? 60 : 200, kind: kind || undefined, team: teamId || undefined }),
    kind ? Promise.resolve({ ok: false }) : api.news({ limit: teamId ? 30 : 40, lane: 'external', team: teamId || undefined }),
    api.teams().catch(() => ({ ok: false })),
    isFront ? api.articles({ limit: 250, archive: 1 }).catch(() => ({ ok: false })) : Promise.resolve({ ok: false }),
    isFront ? api.articles({ limit: 20, kind: 'preview' }).catch(() => ({ ok: false })) : Promise.resolve({ ok: false }),
    isFront && api.today ? api.today({ fresh: true }).catch(() => ({ ok: false })) : Promise.resolve({ ok: false })
  ]);
  const teamList = teams?.ok ? [...teams.data.teams].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const team = teamId ? teamList.find((t) => String(t.team_id) === String(teamId)) || null : null;
  return { kind, teamId, team, teams: teamList, teamsOk: Boolean(teams?.ok), arts, wire, archive, previews, today };
}

function archiveRail(archive) {
  if (!archive?.ok || !archive.data?.items?.length) return '';
  const canonical = canonicalArchiveItems(archive);
  const cutoff = Date.now() - 72 * 3600e3;
  const older = canonical.filter((c) => articleAt(c) > 0 && articleAt(c) < cutoff);
  const historical = (older.length ? older : canonical).slice(0, 8);
  if (!historical.length) return '';
  return html`<section class="desk section archive-record" aria-label="PropBetEdge WNBA published archive">
    <div class="archive-record-head">
      <div class="archive-record-copy">
        <span class="eyebrow">Published archive</span>
        <h2 class="sec-title bc">From the PropBetEdge record</h2>
        <p class="desk-sub">Older PropBetEdge coverage stays browsable instead of disappearing when the live newsroom moves on.</p>
      </div>
      <div class="archive-record-count" aria-label="${canonical.length} browsable published stories">
        <b>${canonical.length}</b>
        <span>stories</span>
        <small>in the record</small>
      </div>
    </div>
    <div class="archive-record-grid">${historical.map(articleRow)}</div>
    <div class="archive-record-foot">
      <span>Showing older published coverage</span>
      <a href="/news/archive">Browse the full archive →</a>
    </div>
  </section>`;
}

const sid = (v) => (v === null || v === undefined ? '' : String(v));

function scheduledGameForPreview(preview, games) {
  const gameEntity = (preview.entities || []).find((e) => e?.type === 'game');
  const direct = gameEntity?.id ? games.find((g) => sid(g.game_id) === sid(gameEntity.id)) : null;
  if (direct) return direct;

  const away = preview.matchup?.away_team_id;
  const home = preview.matchup?.home_team_id;
  if (away && home) {
    const byMatchup = games.find((g) => sid(g.away?.team_id) === sid(away) && sid(g.home?.team_id) === sid(home));
    if (byMatchup) return byMatchup;
  }

  const teams = (preview.entities || []).filter((e) => e?.type === 'team').map((e) => sid(e.id));
  if (teams.length >= 2) {
    return games.find((g) => teams.includes(sid(g.away?.team_id)) && teams.includes(sid(g.home?.team_id))) || null;
  }
  return null;
}

function enrichPreviewWithSlate(preview, games) {
  const game = scheduledGameForPreview(preview, games);
  if (!game?.start_utc) return preview;
  const entities = (preview.entities || []).filter((e) => e?.type !== 'game');
  entities.unshift({
    type: 'game',
    id: game.game_id,
    name: `${game.away?.abbr || game.away?.short_name || 'AWAY'} @ ${game.home?.abbr || game.home?.short_name || 'HOME'}`,
    start_utc: game.start_utc,
    status_state: game.status?.state || null
  });
  return { ...preview, entities };
}

function withDedicatedPreviews(data) {
  if (data.kind || data.teamId || !data.arts?.ok || !data.previews?.ok) return data;
  const slateGames = data.today?.ok ? (data.today.data?.slate?.games || []) : [];
  const previewItems = (data.previews.data?.items || []).map((p) => enrichPreviewWithSlate(p, slateGames));
  if (!previewItems.length) return data;

  // The dedicated preview route supplies canonical preview cards. The Today endpoint supplies
  // authoritative game state/start time. Joining the two keeps editorial origin and game relevance separate.
  const previewById = new Map(previewItems.map((p) => [p.id, p]));
  const seen = new Set();
  const items = (data.arts.data?.items || []).map((c) => {
    const p = previewById.get(c.id);
    if (p) {
      seen.add(c.id);
      return p;
    }
    return c;
  });
  for (const p of previewItems) if (!seen.has(p.id)) items.push(p);

  return {
    ...data,
    arts: {
      ...data.arts,
      data: { ...data.arts.data, items }
    }
  };
}

/**
 * Game Day is driven by the live Today slate, not article publication age.
 * That means a canonical preview may keep its true Sep 11 origin while still being
 * promoted for a Sep 17 game. A game disappears as soon as the authoritative slate
 * moves it out of pregame state. No global freshness clock is rewritten.
 */
function gameDayRail(data) {
  if (!data.today?.ok || !data.previews?.ok) return '';
  const now = Date.now();
  const games = (data.today.data?.slate?.games || [])
    .filter((g) => g?.status?.state === 'pre' && Date.parse(g.start_utc || '') > now)
    .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  if (!games.length) return '';

  const previews = data.previews.data?.items || [];
  const cards = [];
  const seenGames = new Set();
  for (const game of games) {
    const key = sid(game.game_id);
    if (!key || seenGames.has(key)) continue;
    const preview = previews.find((p) => scheduledGameForPreview(p, [game]));
    if (!preview) continue;
    seenGames.add(key);
    cards.push({ game, preview: enrichPreviewWithSlate(preview, [game]) });
  }
  if (!cards.length) return '';

  return html`<section class="desk section game-day-slate" data-game-day-count="${cards.length}">
    <div class="sec-head"><div>
      <span class="eyebrow">Game Day</span>
      <h2 class="sec-title bc">Tonight’s WNBA Slate</h2>
      <p class="desk-sub">Pregame intelligence for every scheduled game with a published PropBetEdge preview — form, rest, availability and the latest stored market. Ordered by tip, not article age.</p>
    </div><a class="sec-link" href="/news/c/preview">All previews →</a></div>
    <div class="ngrid">${cards.map(({ game, preview }) => articleCard(preview, { timeLabel: `Tonight · ${TIP_TIME.format(new Date(game.start_utc))}` }))}</div>
  </section>`;
}


export async function loadArchive(api) {
  return api.articles({ limit: 500, archive: 1 }).catch(() => ({ ok: false }));
}

export function archiveView(archive) {
  if (!archive?.ok) return {
    error: true,
    body: html`<header class="masthead"><span class="eyebrow">PropBetEdge · WNBA</span><h1 class="mast-title">News Archive</h1></header><div class="empty err"><h3>Archive temporarily unavailable</h3><p>The publication record could not be read. No partial archive is shown in its place.</p></div>`
  };
  const items = canonicalArchiveItems(archive);
  const groups = [];
  for (const item of items) {
    const at = articleAt(item);
    const key = at ? ARCHIVE_MONTH.format(new Date(at)) : 'Date unavailable';
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return {
    error: false,
    items,
    body: html`
      <header class="masthead archive-mast">
        <div class="mast-row"><span class="eyebrow">Published record</span><a class="sec-link" href="/news">← Current newsroom</a></div>
        <h1 class="mast-title">WNBA News Archive</h1>
        <p class="mast-sub">Every canonical PropBetEdge newsroom story remains reachable here after it leaves the live-news rotation. Newest first, with duplicate and superseded URLs collapsed out of the browse view.</p>
        <div class="archive-summary"><b>${items.length}</b><span>browsable stories</span><small>through ${items[0] ? ARCHIVE_DAY.format(new Date(articleAt(items[0]))) : 'today'}</small></div>
      </header>
      <div class="archive-page">
        ${groups.map((g) => html`<section class="archive-month">
          <div class="archive-month-head"><h2>${g.key}</h2><span>${g.items.length} stories</span></div>
          <div class="archive-page-grid">${g.items.map(articleRow)}</div>
        </section>`)}
      </div>
    `
  };
}

export function newsView(data) {
  const effective = withDedicatedPreviews(data);
  const view = base.newsView(effective);
  if (view?.error || effective.kind || effective.teamId) return view;

  let body = String(view.body);

  // Prefer the base renderer if it already produced Game Day. Otherwise inject the authoritative
  // Today × Preview rail immediately above Latest/Market Watch.
  if (!body.includes('game-day-slate')) {
    const gameDay = gameDayRail(data);
    if (gameDay) {
      const marker = '<section class="front-band section">';
      body = body.includes(marker) ? body.replace(marker, `${String(gameDay)}${marker}`) : `${body}${String(gameDay)}`;
    }
  }

  // The current WinBA Index is promoted here by an explicit module rather than
  // left to chronological story cards, which would bury a flagship monthly
  // ranking within hours. It stays promoted until a later period publishes.
  const currentIndex = winbaCurrentEditionModule(currentWinbaEdition(effective.arts));
  if (currentIndex) {
    const band = '<section class="front-band section">';
    body = body.includes(band)
      ? body.replace(band, `${String(currentIndex)}${band}`)
      : `${String(currentIndex)}${body}`;
  }

  const archive = archiveRail(effective.archive);
  if (archive) {
    const trust = '<section class="trust section">';
    body = body.includes(trust)
      ? body.replace(trust, `${String(archive)}${trust}`)
      : `${body}${String(archive)}`;
  }

  return { ...view, body: raw(body) };
}
