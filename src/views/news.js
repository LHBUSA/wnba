// WNBA News & Intelligence — live newsroom wrapper.
//
// news-base.js owns the established editorial layout. This layer adds a visible
// historical archive rail backed by the permanent article catalog without
// weakening the publication gate. Current-story curation and publication history
// are intentionally separate.

import { html, raw } from '../lib/dom.js';
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

function archiveRail(archive, currentItems = []) {
  if (!archive?.ok || !archive.data?.items?.length) return '';
  const current = new Set((currentItems || []).map((c) => c.id));
  const historical = archive.data.items
    .filter((c) => !current.has(c.id))
    .filter((c) => !['duplicate', 'superseded'].includes(c.archive_state))
    .slice(0, 10);
  if (!historical.length) return '';
  return html`<section class="desk section" aria-label="PropBetEdge WNBA published archive">
    <div class="sec-head"><div>
      <span class="eyebrow">Published archive</span>
      <h2 class="sec-title bc">From the PropBetEdge record</h2>
      <p class="desk-sub">Previously published newsroom work stays part of the historical record even when it is no longer promoted as current news. Dedupe changes prominence, not existence.</p>
    </div><span class="note">${archive.data.total} published records · ${archive.data.historical} historical</span></div>
    <div class="srows srows--grid">${historical.map(articleRow)}</div>
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

  const archive = archiveRail(effective.archive, effective.arts?.data?.items || []);
  if (archive) {
    const trust = '<section class="trust section">';
    body = body.includes(trust)
      ? body.replace(trust, `${String(archive)}${trust}`)
      : `${body}${String(archive)}`;
  }

  return { ...view, body: raw(body) };
}
