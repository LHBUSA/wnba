import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, gameCard, sourceLine, empty, errorState, skeleton, avatar, statusBadge, teamDot, safeColor } from '../ui/components.js';
import { fmtDateET, fmtTimeET, fmtDateTimeET, num, pct, american, bookName, signed } from '../lib/format.js';
import { versusBar } from '../ui/charts.js';
import { etCompact, addDays } from '../../workers/shared/time.js';

export const title = (p) => (p.gameId ? 'Matchup research' : 'Matchups');
export const description = () => 'WNBA matchup research: pace, recent form, rest, observed rotations and roles, availability and season stats, with sample sizes and sources.';

export async function mount(root, ctx) {
  if (!ctx.params.gameId) return list(root, ctx);
  return detail(root, ctx);
}

async function list(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Research', title: 'Matchups', sub: 'Every upcoming WNBA game with a full research card: pace, form, rest, observed rotations and availability.' })}${skeleton(160, 2)}`);
  const today = etCompact();
  const res = await api.schedule({ from: today, to: addDays(today, 12) });
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'The schedule'));
  const games = res.data.games.filter((g) => g.status?.state !== 'post').sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  render(root, html`${pageHead({ eyebrow: 'Research', title: 'Matchups', sub: 'Every upcoming WNBA game with a full research card: pace, form, rest, observed rotations and availability.' })}
    ${games.length ? html`<div class="slate-grid">${games.map((g) => gameCard(g, { showDate: true }))}</div>` : empty('No upcoming games', 'No WNBA games are scheduled in the next 12 days in the source schedule.')}
    <div style="margin-top:16px">${sourceLine(res.meta)}</div>`);
}

async function detail(root, ctx) {
  render(root, html`${skeleton(120)}${skeleton(420)}`);
  const res = await api.matchup(ctx.params.gameId);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'This matchup'));
  const d = res.data;
  const g = d.game;
  const [A, H] = d.teams; // away, home
  ctx.setMeta({ title: `${g.away?.abbr} @ ${g.home?.abbr} matchup`, description: `${g.away?.name} at ${g.home?.name} — WNBA matchup research: pace, form, rest, rotations, availability.` });

  const stat = (t, k) => t.season_stats?.[k] ?? null;
  const cmp = (label, k, { d = 1, higher = true, fmt } = {}) => {
    const a = stat(A, k);
    const h = stat(H, k);
    if (a === null && h === null) return '';
    const f = fmt || ((v) => num(v, d));
    return html`<div class="cmp-row"><span class="lbl">${label}</span><span class="va mono">${f(a)}</span>${raw(versusBar(a, h, { higherIsBetter: higher }))}<span class="vb mono">${f(h)}</span></div>`;
  };
  const teamPanel = (t) => html`<section class="card">
    <div class="card-head"><span class="card-title" style="display:flex;gap:8px;align-items:center">${teamDot(t.team)}${t.team.name}</span><a class="sec-link" href="/teams/${t.team.team_id}">Team page →</a></div>
    <div class="card-body">
      <div class="tiles">
        <div class="tile"><small>Record</small><b>${t.standing ? `${t.standing.wins}-${t.standing.losses}` : t.team.record || '—'}</b><span>${t.standing ? `${t.standing.conference_name?.replace(' Conference', '')} · seed ${t.standing.seed ?? '—'}` : ''}</span></div>
        <div class="tile"><small>Last ${t.form.sample || 10}</small><b>${t.form.record_last10 || '—'}</b><span>avg margin ${signed(t.form.avg_margin_last10)}</span></div>
        <div class="tile"><small>Rest</small><b>${t.schedule_context.rest_days ?? '—'}${t.schedule_context.rest_days !== null ? html`<small style="display:inline;font-size:12px;letter-spacing:0"> days</small>` : ''}</b><span>${t.schedule_context.back_to_back ? 'back-to-back' : `${t.schedule_context.games_last_7_days} games in last 7 days`}</span></div>
        <div class="tile"><small>Pace</small><b>${t.pace ? num(t.pace.possessions_per_game) : '—'}</b><span>poss/game (est.)</span></div>
      </div>
      <div class="form-chips" style="margin-top:12px" aria-label="Last 10 results, most recent first">${t.form.last10.map((x) => html`<span class="${x.result}" title="${fmtDateET(x.date, { month: 'short', day: 'numeric' })} ${x.home_away === 'home' ? 'vs' : '@'} ${x.opponent} ${x.pts}-${x.opp_pts}">${x.result}</span>`)}</div>
      ${t.schedule_context.previous_game ? html`<p class="note" style="margin-top:10px">Previous game: ${fmtDateET(t.schedule_context.previous_game.date, { weekday: 'short', month: 'short', day: 'numeric' })} vs ${t.schedule_context.previous_game.opponent}${t.schedule_context.previous_game.venue?.city ? ` in ${t.schedule_context.previous_game.venue.city}` : ''}. ${t.schedule_context.method}</p>` : ''}

      <div style="margin-top:16px"><span class="card-title">Observed rotation · last ${t.rotation.sample} games</span>
        <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Player</th><th>Role</th><th>GS</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>
          ${t.rotation.rows.filter((r) => r.appearances > 0).slice(0, 11).map((r) => html`<tr><td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: t.team.color })}${r.name}</a></td><td class="l">${r.role}</td><td>${r.starts}/${r.games}</td><td>${num(r.min)}</td><td>${num(r.pts)}</td><td>${num(r.reb)}</td><td>${num(r.ast)}</td></tr>`)}
        </tbody></table></div>
        <p class="note" style="margin-top:6px">${t.rotation.method}</p>
      </div>

      <div style="margin-top:16px"><span class="card-title">Availability</span>
        ${t.availability.length ? t.availability.map((i) => html`<div class="change-row">${avatar({ name: i.name, photo: i.photo }, { teamColor: t.team.color })}<div><a href="/players/${i.athlete_id}"><b>${i.name}</b></a><div class="note">${[i.side, i.body_part].filter(Boolean).join(' ') || '—'} · updated ${fmtDateET(i.source_updated_at, { month: 'short', day: 'numeric' })}</div></div>${statusBadge(i.status)}</div>`) : html`<p class="note" style="margin-top:6px">No players listed on the injury feed.</p>`}
      </div>
    </div>
  </section>`;

  const mk = d.market;
  render(root, html`
    <div class="card card-pad" style="margin-bottom:16px">
      <span class="eyebrow">Matchup research · ${fmtDateET(g.start_utc, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTimeET(g.start_utc)}</span>
      <div class="mu-head" style="margin-top:12px">
        <div class="mu-team"><b>${g.away?.name}</b><small>${g.away?.record || ''} · away</small></div>
        <span class="mu-vs">AT</span>
        <div class="mu-team home"><b>${g.home?.name}</b><small>${g.home?.record || ''} · home${g.venue?.name ? ` · ${g.venue.name}` : ''}</small></div>
      </div>
      <div class="pill-row" style="margin-top:14px"><a class="pill" href="/cast/${g.game_id}">WNBACast</a><a class="pill" href="/props">Best line board</a>${d.season_series?.[0]?.summary ? html`<span class="chip">${d.season_series[0].summary}</span>` : ''}</div>
    </div>

    <section class="card card-pad" style="margin-bottom:16px">
      <div class="sec-head"><h2 class="sec-title">Season profile · ${A.team.abbr} vs ${H.team.abbr}</h2><span class="note">per game, ESPN team totals</span></div>
      <div class="cmp">
        ${cmp('Points scored', 'avgPoints')}
        ${cmp('Points allowed', 'opp_avgPoints', { higher: false })}
        ${cmp('Field goal %', 'fieldGoalPct')}
        ${cmp('3-point %', 'threePointFieldGoalPct')}
        ${cmp('3PA per game', 'avgThreePointFieldGoalsAttempted')}
        ${cmp('Rebounds', 'avgRebounds')}
        ${cmp('Assists', 'avgAssists')}
        ${cmp('Turnovers', 'avgTurnovers', { higher: false })}
        ${A.pace && H.pace ? html`<div class="cmp-row"><span class="lbl">Pace (possessions, est.)</span><span class="va mono">${num(A.pace.possessions_per_game)}</span>${raw(versusBar(A.pace.possessions_per_game, H.pace.possessions_per_game))}<span class="vb mono">${num(H.pace.possessions_per_game)}</span></div>` : ''}
      </div>
      <p class="note" style="margin-top:10px">${A.pace?.method || ''}</p>
    </section>

    <section class="card card-pad" style="margin-bottom:16px">
      <div class="sec-head"><h2 class="sec-title">Market</h2>${mk ? html`<span class="note">Snapshot ${fmtDateTimeET(mk.captured_at)}</span>` : ''}</div>
      ${mk ? html`<div class="tiles">
          <div class="tile"><small>Best ML ${g.away?.abbr}</small><b>${american(mk.moneyline.best.away?.price)}</b><span>${bookName(mk.moneyline.best.away?.book)}</span></div>
          <div class="tile"><small>Best ML ${g.home?.abbr}</small><b>${american(mk.moneyline.best.home?.price)}</b><span>${bookName(mk.moneyline.best.home?.book)}</span></div>
          <div class="tile"><small>Consensus spread</small><b>${mk.spread.consensus_line !== null ? `${g.home?.abbr} ${mk.spread.consensus_line > 0 ? '+' : ''}${mk.spread.consensus_line}` : '—'}</b><span>${mk.book_count} books</span></div>
          <div class="tile"><small>Consensus total</small><b>${mk.total.consensus_line ?? '—'}</b><span class="cons">no-vig benchmark</span></div>
          <div class="tile"><small>PBE fair value</small><b class="na">—</b><span>not published</span></div>
        </div>` : html`<p class="note">No market snapshot matched to this game yet. Snapshots run at 8:00, 1:00 and 6:00 ET.</p>`}
    </section>

    <div class="grid g2">${teamPanel(A)}${teamPanel(H)}</div>
    <div style="margin-top:16px">${sourceLine(res.meta, { label: 'Matchup research' })}</div>
  `);
}
