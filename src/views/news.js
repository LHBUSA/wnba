// WNBA News & Intelligence — live newsroom wrapper.
//
// news-base.js owns the established editorial layout. This layer adds a visible
// historical archive rail backed by the permanent article catalog without
// weakening the publication gate. Current-story curation and publication history
// are intentionally separate.

import { html, raw } from '../lib/dom.js';
import { articleRow } from '../ui/articles.js';
import * as base from './news-base.js';

export const DESKS = base.DESKS;
export const PRIMARY_DESKS = base.PRIMARY_DESKS;
export const MORE_DESKS = base.MORE_DESKS;
export const DESK_KINDS = base.DESK_KINDS;
export const deskNav = base.deskNav;
export const newsHeadView = base.newsHeadView;

export async function loadNews(api, kind = null, teamId = null) {
  const [arts, wire, teams, archive] = await Promise.all([
    api.articles({ limit: teamId ? 60 : 200, kind: kind || undefined, team: teamId || undefined }),
    kind ? Promise.resolve({ ok: false }) : api.news({ limit: teamId ? 30 : 40, lane: 'external', team: teamId || undefined }),
    api.teams().catch(() => ({ ok: false })),
    !kind && !teamId ? api.articles({ limit: 250, archive: 1 }).catch(() => ({ ok: false })) : Promise.resolve({ ok: false })
  ]);
  const teamList = teams?.ok ? [...teams.data.teams].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const team = teamId ? teamList.find((t) => String(t.team_id) === String(teamId)) || null : null;
  return { kind, teamId, team, teams: teamList, teamsOk: Boolean(teams?.ok), arts, wire, archive };
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

export function newsView(data) {
  const view = base.newsView(data);
  if (view?.error || data.kind || data.teamId) return view;

  let body = String(view.body);

  const archive = archiveRail(data.archive, data.arts?.data?.items || []);
  if (archive) {
    const trust = '<section class="trust section">';
    body = body.includes(trust)
      ? body.replace(trust, `${String(archive)}${trust}`)
      : `${body}${String(archive)}`;
  }

  return { ...view, body: raw(body) };
}
