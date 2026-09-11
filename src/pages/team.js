import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { sourceLine, errorState, skeleton, playerCard, gameCard, statusBadge, avatar, badge, entityChips, safeColor } from '../ui/components.js';
import { num, relTime, fmtDateET } from '../lib/format.js';

export const title = () => 'Team';

export async function mount(root, ctx) {
  render(root, html`${skeleton(140)}${skeleton(420)}`);
  const id = ctx.params.teamId;
  const [res, news] = await Promise.all([api.team(id), api.news({ team: id, limit: 8 })]);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'This team'));
  const d = res.data;
  const t = d.team;
  ctx.setMeta({ title: t.name, description: `${t.name}: WNBA roster, schedule and results, observed rotation, season stats, availability and news.` });
  const upcoming = d.schedule.filter((g) => g.status?.state !== 'post').slice(0, 4);
  const recent = d.schedule.filter((g) => g.status?.state === 'post').slice(-6).reverse();
  const players = d.roster.map((a) => ({ ...a, team: t }));
  const s = d.season_stats || {};

  render(root, html`
    <section class="hero" style="border-top:4px solid ${safeColor(t.color, 'var(--gold)')}">
      <span class="eyebrow">${d.season?.label || ''}${d.standing ? ` · ${d.standing.conference_name}` : ''}</span>
      <h1 style="margin-top:10px">${t.name}</h1>
      <div class="tiles" style="margin-top:16px;max-width:760px">
        <div class="tile"><small>Record</small><b>${d.standing ? `${d.standing.wins}-${d.standing.losses}` : '—'}</b><span>${d.standing ? `seed ${d.standing.seed ?? '—'} · ${d.standing.games_behind} GB` : ''}</span></div>
        <div class="tile"><small>Points</small><b>${num(s.avgPoints)}</b><span>allowed ${num(s.opp_avgPoints)}</span></div>
        <div class="tile"><small>Last 10</small><b>${d.standing?.last_ten || '—'}</b><span>${d.standing?.streak || ''}</span></div>
        <div class="tile"><small>Coach</small><b style="font-size:18px;line-height:1.2">${d.coach?.[0] || '—'}</b><span>per ESPN roster</span></div>
      </div>
    </section>

    ${upcoming.length ? html`<section class="section"><div class="sec-head"><h2 class="sec-title">Next games</h2></div><div class="slate-grid">${upcoming.map((g) => gameCard(g, { showDate: true }))}</div></section>` : ''}

    <section class="section">
      <div class="sec-head"><h2 class="sec-title">Roster · ${players.length}</h2></div>
      <div class="pgrid">${players.map(playerCard)}</div>
    </section>

    <div class="section split">
      <section class="card">
        <div class="card-head"><span class="card-title">Observed rotation · last ${d.rotation?.sample || 0} games</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Role</th><th>GS</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>
          ${(d.rotation?.rows || []).filter((r) => r.appearances > 0).map((r) => html`<tr><td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: t.color })}${r.name}</a></td><td class="l">${r.role}</td><td>${r.starts}/${r.games}</td><td>${num(r.min)}</td><td>${num(r.pts)}</td><td>${num(r.reb)}</td><td>${num(r.ast)}</td></tr>`)}
        </tbody></table></div>
        <div class="card-body"><p class="note">${d.rotation?.method || ''}</p></div>
      </section>
      <aside class="grid" style="gap:16px;align-content:start">
        <section class="card"><div class="card-head"><span class="card-title">Availability</span><a class="sec-link" href="/injuries">Desk →</a></div><div class="card-body">
          ${d.availability?.length ? d.availability.map((i) => html`<div class="change-row">${avatar({ name: i.name }, { teamColor: t.color })}<div><a href="/players/${i.athlete_id}"><b>${i.name}</b></a><div class="note">${[i.side, i.body_part].filter(Boolean).join(' ')} · ${fmtDateET(i.source_updated_at, { month: 'short', day: 'numeric' })}</div></div>${statusBadge(i.status)}</div>`) : html`<p class="note">No players on the injury feed.</p>`}
        </div></section>
        <section class="card"><div class="card-head"><span class="card-title">Recent results</span></div><div class="card-body">
          ${recent.map((g) => { const us = g.home?.team_id === id ? g.home : g.away; const them = g.home?.team_id === id ? g.away : g.home; const w = us?.score > them?.score; return html`<div class="change-row" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="badge ${w ? 'final' : ''}" style="${w ? 'color:var(--pos)' : 'color:var(--neg)'}">${w ? 'W' : 'L'}</span><a href="/cast/${g.game_id}">${g.home?.team_id === id ? 'vs' : '@'} ${them?.abbr} · ${us?.score}-${them?.score}</a><span class="note">${fmtDateET(g.start_utc, { month: 'short', day: 'numeric' })}</span></div>`; })}
        </div></section>
        <section class="card"><div class="card-head"><span class="card-title">News</span></div><div class="card-body">
          ${news.ok && news.data.items.length ? news.data.items.map((i) => html`<article class="nitem"><div class="nmeta">${i.lane === 'pbe' ? badge('pbe', 'PBE Desk') : badge('ext', i.source.name)}<span>${relTime(i.published_at)}</span></div><h3 style="font-size:16px"><a href="${i.lane === 'pbe' ? `/news/story/${i.id}` : i.url}">${i.headline}</a></h3></article>`) : html`<p class="note">No linked WNBA stories in the last three weeks.</p>`}
        </div></section>
      </aside>
    </div>
    <div style="margin-top:16px">${sourceLine(res.meta)}</div>
  `);
}
