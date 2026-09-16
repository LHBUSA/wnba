// WNBA News & Intelligence — live newsroom wrapper.
//
// news-base.js owns the established editorial layout. This layer adds the two
// things a live newsroom needs without weakening the publication gate:
//   * a fresh attributed wire near the top of the page, refreshed every pass;
//   * a visible historical archive rail backed by the permanent article catalog.
// Current-story curation and publication history are intentionally separate.

import { html, raw } from '../lib/dom.js';
import { badge, entityChips } from '../ui/components.js';
import { articleRow } from '../ui/articles.js';
import { relTime } from '../lib/format.js';
import * as base from './news-base.js';

export const DESKS = base.DESKS;
export const PRIMARY_DESKS = base.PRIMARY_DESKS;
export const MORE_DESKS = base.MORE_DESKS;
export const DESK_KINDS = base.DESK_KINDS;
export const deskNav = base.deskNav;
export const newsHeadView = base.newsHeadView;

const OFFICIAL_KINDS = new Set(['official', 'team_official']);

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

function livePulse(wire) {
  if (!wire?.ok || !wire.data?.items?.length) return '';
  const items = wire.data.items.slice(0, 10);
  return html`<section class="wire-wrap section" aria-label="Live WNBA source wire">
    <div class="sec-head"><div>
      <span class="eyebrow">Live desk · source wire</span>
      <h2 class="sec-title bc">Around the league now</h2>
      <p class="desk-sub">Fresh attributed reports from the newsroom’s monitored WNBA sources. Headlines and links belong to the publishers; PropBetEdge uses this wire to decide what deserves a sourced in-house story.</p>
    </div><a class="sec-link" href="/sources">29-source status →</a></div>
    <ol class="wire">${items.map((i) => html`<li>
      <div class="nmeta">${badge(OFFICIAL_KINDS.has(i.source?.kind) ? 'pbe' : 'ext', OFFICIAL_KINDS.has(i.source?.kind) ? `${String(i.source?.name || '').replace(/\s*\(official\)$/, '')} · Official` : i.source?.name || 'Source')}<span>${relTime(i.published_at)}</span>${i.publishers > 1 ? html`<span class="note">${i.publishers} publishers</span>` : ''}</div>
      <a href="${i.url}" rel="noopener" target="_blank">${i.headline}&nbsp;<span class="note" aria-hidden="true">↗</span></a>
      <div class="nents">${entityChips(i.entities || [])}</div>
    </li>`)}</ol>
  </section>`;
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
  const pulse = livePulse(data.wire);
  if (pulse) body = body.replace('</header>', `</header>${String(pulse)}`);

  const archive = archiveRail(data.archive, data.arts?.data?.items || []);
  if (archive) {
    const trust = '<section class="trust section">';
    body = body.includes(trust)
      ? body.replace(trust, `${String(archive)}${trust}`)
      : `${body}${String(archive)}`;
  }

  return { ...view, body: raw(body) };
}
