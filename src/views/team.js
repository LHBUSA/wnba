// Team view — shared by the SPA page and the wnba-web publishing Worker.
import { html, raw } from '../lib/dom.js';
import { sourceLine, errorState, playerCard, gameCard, statusBadge, avatar, badge } from '../ui/components.js';
import { logoEntry, teamColors } from '../ui/logo.js';
import { articleList } from '../ui/articles.js';
import { num, fmtDateET, relTime } from '../lib/format.js';
import { pbeTeaser } from '../ui/pbe.js';

export async function loadTeam(api, id) {
  // External coverage (features, profiles, analysis from approved publishers) lives here and on player pages — linked,
  // attributed, never a PropBetEdge newsroom story of its own.
  const [res, arts, wire] = await Promise.all([api.team(id), api.articles({ team: id, limit: 8 }), api.news ? api.news({ team: id, lane: 'external', limit: 6 }).catch(() => null) : Promise.resolve(null)]);
  return { id, res, arts, wire };
}

export function teamView({ id, res, arts, wire }) {
  if (!res?.ok) return errorState(res, 'This team');
  const d = res.data;
  const t = d.team;
  const col = teamColors(t);
  const logo = logoEntry(t);
  const upcoming = d.schedule.filter((g) => g.status?.state !== 'post').slice(0, 3);
  const recent = d.schedule.filter((g) => g.status?.state === 'post').slice(-10).reverse();
  const res10 = recent.map((g) => { const us = g.home?.team_id === id ? g.home : g.away; const them = g.home?.team_id === id ? g.away : g.home; return { g, us, them, w: us?.score > them?.score }; });
  const players = d.roster.map((a) => ({ ...a, team: t }));
  const winbaByPlayer = new Map((d.roster || []).map((p) => [String(p.athlete_id), p.winba || null]));
  const rot = (d.rotation?.rows || []).filter((r) => r.appearances > 0).map((r) => ({ ...r, winba: winbaByPlayer.get(String(r.athlete_id)) || null }));
  const s = d.season_stats || {};
  const st = d.standing;

  return html`
    <section class="team-hero" style="--tc1:${col.color || '#d4af37'};--tc2:${col.alt || '#ff7a2f'}">
      ${logo ? html`<img class="big-logo" src="${logo.files['320']}" alt="${t.name} logo" width="320" height="320" decoding="async" />` : ''}
      <div class="team-hero-in">
        <span class="kicker" style="font:700 11px/1 var(--f-data);letter-spacing:.24em;text-transform:uppercase;color:var(--gold)">${d.season?.label || ''}${st ? html` · <a href="/standings">${st.conference_name}</a>` : ''}</span>
        <h1 style="font:800 clamp(40px,6.4vw,78px)/.9 var(--f-display);text-transform:uppercase;margin-top:12px">${t.name}</h1>
        <div class="tiles" style="margin-top:18px">
          <div class="tile"><small>Record</small><b>${st ? `${st.wins}-${st.losses}` : '—'}</b><span>${st ? `seed ${st.seed ?? '—'} · ${st.games_behind} GB` : ''}</span></div>
          <div class="tile"><small>Last 10</small><b>${st?.last_ten || '—'}</b><span>${st?.streak ? `streak ${st.streak}` : ''}</span></div>
          <div class="tile"><small>Points</small><b>${num(s.avgPoints)}</b><span>allowed ${num(s.opp_avgPoints)}</span></div>
          <div class="tile"><small>Net</small><b>${st?.differential !== null && st?.differential !== undefined ? `${st.differential > 0 ? '+' : ''}${st.differential}` : '—'}</b><span>avg margin</span></div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:14px" aria-label="Last 10 results">${res10.map((x) => html`<a href="/cast/${x.g.game_id}" title="${fmtDateET(x.g.start_utc, { month: 'short', day: 'numeric' })} ${x.g.home?.team_id === id ? 'vs' : '@'} ${x.them?.abbr} ${x.us?.score}-${x.them?.score}" class="badge" style="${x.w ? 'color:var(--pos);border-color:rgba(82,181,127,.4)' : 'color:var(--neg);border-color:rgba(224,90,90,.4)'}">${x.w ? 'W' : 'L'} ${x.them?.abbr}</a>`)}</div>
      </div>
    </section>

    ${upcoming[0] ? html`<div class="pbe-slot" data-pbe-slot>${pbeTeaser(nextMatchup(upcoming[0], id))}</div>` : ''}

    ${upcoming.length ? html`<section class="section"><div class="sec-head"><h2 class="sec-title bc">Next games · lines</h2><span class="note">stored snapshots · PropSports.PropTechUSA.ai</span></div><div class="slate-grid">${upcoming.map((g) => gameCard(g, { showDate: true }))}</div></section>` : ''}

    <div class="section split">
      <div>
        <section>
          <div class="sec-head"><h2 class="sec-title bc">Newsroom · ${t.short_name}</h2><a class="sec-link" href="/news">All news →</a></div>
          ${articleList(arts?.ok ? arts.data.items : [], { empty: `No PropBetEdge articles on the ${t.short_name} in the current window.` })}
        </section>
        ${wire?.ok && wire.data.items.length ? html`<section class="section">
          <div class="sec-head"><h2 class="sec-title bc">External coverage · ${t.short_name}</h2><span class="note">approved publishers · linked, not republished</span></div>
          <div class="card"><div class="card-body">${wire.data.items.map((i) => html`<article class="nitem"><div class="nmeta">${badge('ext', i.source?.name || 'Publisher')}<span>${relTime(i.published_at)}</span></div><h3 style="font-size:16px"><a href="${i.url}" ${raw('rel="noopener" target="_blank"')}>${i.headline}</a></h3></article>`)}</div></div>
        </section>` : ''}
        <section class="section">
          <div class="sec-head"><h2 class="sec-title bc">Roster highlights · observed rotation</h2><span class="note">last ${d.rotation?.sample || 0} games</span></div>
          <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Role</th><th>GS</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th title="PropBetEdge WinBA Score">WINBA</th></tr></thead><tbody>
            ${rot.map((r) => html`<tr><td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: t.color })}${r.name}</a></td><td class="l">${r.role}</td><td>${r.starts}/${r.games}</td><td>${num(r.min)}</td><td class="hi">${num(r.pts)}</td><td>${num(r.reb)}</td><td>${num(r.ast)}</td><td>${r.winba ? num(r.winba.score) : '—'}</td></tr>`)}
          </tbody></table></div><div class="card-body"><p class="note">${d.rotation?.method || ''}</p></div></div>
        </section>
        <section class="section">
          <div class="sec-head"><h2 class="sec-title bc">Season profile</h2><span class="note">per game · PropSports team totals · <a href="/stats">league stats →</a></span></div>
          <div class="tiles">
            ${[['FG%', s.fieldGoalPct], ['3P%', s.threePointFieldGoalPct], ['3PA', s.avgThreePointFieldGoalsAttempted], ['REB', s.avgRebounds], ['AST', s.avgAssists], ['TOV', s.avgTurnovers], ['STL', s.avgSteals], ['BLK', s.avgBlocks]].map(([k, v]) => html`<div class="tile"><small>${k}</small><b>${num(v)}</b></div>`)}
          </div>
        </section>
      </div>
      <aside class="grid" style="gap:16px;align-content:start">
        <section class="card"><div class="card-head"><span class="card-title">Availability</span><a class="sec-link" href="/injuries">Desk →</a></div><div class="card-body">
          ${d.availability?.length ? d.availability.map((i) => html`<div class="change-row">${avatar({ name: i.name }, { teamColor: t.color })}<div><a href="/players/${i.athlete_id}"><b>${i.name}</b></a><div class="note">${[i.side, i.body_part].filter(Boolean).join(' ')} · ${fmtDateET(i.source_updated_at, { month: 'short', day: 'numeric' })}</div></div>${statusBadge(i.status)}</div>`) : html`<p class="note">No players on the injury feed.</p>`}
        </div></section>
        <section class="card"><div class="card-head"><span class="card-title">Coach</span></div><div class="card-body"><b>${d.coach?.[0] || '—'}</b><p class="note">per PropSports roster</p></div></section>
        ${recent.length ? html`<section class="card"><div class="card-head"><span class="card-title">Recent matchups</span><a class="sec-link" href="/matchups">All →</a></div><div class="card-body">
          ${recent.slice(0, 5).map((x) => { const them = x.home?.team_id === id ? x.away : x.home; return html`<p><a href="/matchups/${x.game_id}">${fmtDateET(x.start_utc, { month: 'short', day: 'numeric' })} ${x.home?.team_id === id ? 'vs' : '@'} ${them?.name || them?.abbr || ''}</a></p>`; })}
        </div></section>` : ''}
      </aside>
    </div>

    <section class="section">
      <div class="sec-head"><h2 class="sec-title bc">Roster · ${players.length}</h2></div>
      <div class="pgrid">${players.map(playerCard)}</div>
    </section>
    <div style="margin-top:16px">${sourceLine(res.meta)}</div>
  `;
}

/** The team's next game as the PBE teaser needs it: identity and tip time only. */
export function nextMatchup(g, id) {
  const isHome = String(g.home?.team_id) === String(id);
  return { team: isHome ? g.home : g.away, opponent: isHome ? g.away : g.home, isHome, tipUtc: g.start_utc, gameId: g.game_id, next: `/pro?next=${encodeURIComponent(`/teams/${id}`)}` };
}
