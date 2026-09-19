// Matchup research views (list + game) — shared by the SPA page and the wnba-web publishing Worker.
import { html, raw } from '../lib/dom.js';
import { pageHead, gameCard, sourceLine, empty, errorState, avatar, statusBadge, marketStrip } from '../ui/components.js';
import { fmtDateET, fmtTimeET, fmtDateTimeET, num, signed } from '../lib/format.js';
import { versusBar, sparkline } from '../ui/charts.js';
import { teamLogo, teamColors } from '../ui/logo.js';
import { articleList } from '../ui/articles.js';
import { etCompact, addDays } from '../../workers/shared/time.js';

const LIST_HEAD = { eyebrow: 'Research', title: 'Matchups', sub: 'Every upcoming WNBA game with a full research card: pace, form, rest, observed rotations and availability.' };
export const matchupsListHead = () => pageHead(LIST_HEAD);

export async function loadMatchupsList(api) {
  const today = etCompact();
  const to = addDays(today, 12);
  const res = await api.schedule({ from: today, to });
  if (res?.ok) return { res };

  // A wide provider schedule read should never blank the entire research desk
  // when the owned Today endpoint still has a verified current/next slate.
  // This is a bounded failover, not invented schedule data: it renders only
  // games that the API itself returned and labels the degraded condition.
  const fallback = await api.today();
  const slate = fallback?.ok ? fallback.data?.slate : null;
  if (slate?.games?.length) {
    return {
      res: {
        ok: true,
        data: {
          requested: { from: today, to },
          day: slate.date || null,
          games: slate.games,
          summary: slate.summary || null
        },
        meta: {
          ...(fallback.meta || {}),
          semantics: 'SCHEDULE_FALLBACK_VERIFIED_SLATE',
          degraded: [
            ...((fallback.meta?.degraded || []).filter(Boolean)),
            `primary_schedule:${res?.error?.code || 'unavailable'}`
          ]
        }
      }
    };
  }

  return { res };
}

export function matchupsListView({ res }) {
  if (!res?.ok) return html`${pageHead(LIST_HEAD)}${errorState(res, 'The schedule')}`;
  const games = res.data.games.filter((g) => g.status?.state !== 'post').sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  const fallback = res.meta?.semantics === 'SCHEDULE_FALLBACK_VERIFIED_SLATE';
  return html`${pageHead(LIST_HEAD)}
    ${fallback ? html`<div class="empty" style="margin-bottom:16px"><h3>Showing the next verified slate</h3><p>The full 12-day schedule feed is temporarily degraded. These games come from the current PropBetEdge WNBA slate and are not stand-in data.</p></div>` : ''}
    ${games.length ? html`<div class="slate-grid">${games.map((g) => gameCard(g, { showDate: true }))}</div>` : empty('No upcoming games', 'No WNBA games are scheduled in the next 12 days in the source schedule.')}
    <div style="margin-top:16px">${sourceLine(res.meta)}</div>`;
}

export async function loadMatchup(api, gameId) {
  const [res, arts, winba] = await Promise.all([api.matchup(gameId), api.articles({ game: gameId, limit: 6 }), api.statsWinba()]);
  return { res, arts, winba };
}

export function matchupView({ res, arts, winba }) {
  if (!res?.ok) return errorState(res, 'This matchup');
  const d = res.data;
  const g = d.game;
  const [A, H] = d.teams; // away, home
  const winbaByPlayer = new Map((winba?.ok ? winba.data.rows || [] : []).map((r) => [String(r.athlete_id), r]));

  const stat = (t, k) => t.season_stats?.[k] ?? null;
  const cmp = (label, k, { d: dp = 1, higher = true, fmt } = {}) => {
    const a = stat(A, k);
    const h = stat(H, k);
    if (a === null && h === null) return '';
    const f = fmt || ((v) => num(v, dp));
    return html`<div class="cmp-row"><span class="lbl">${label}</span><span class="va mono">${f(a)}</span>${raw(versusBar(a, h, { higherIsBetter: higher }))}<span class="vb mono">${f(h)}</span></div>`;
  };
  const teamPanel = (t) => html`<section class="card">
    <div class="card-head"><span class="card-title" style="display:flex;gap:10px;align-items:center">${teamLogo(t.team, 28)}${t.team.name}</span><a class="sec-link" href="/teams/${t.team.team_id}">Team page →</a></div>
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
        <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Player</th><th>Role</th><th>GS</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th title="PropBetEdge WinBA Score">WINBA</th></tr></thead><tbody>
          ${t.rotation.rows.filter((r) => r.appearances > 0).slice(0, 11).map((r) => {
            const w = winbaByPlayer.get(String(r.athlete_id));
            return html`<tr><td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: t.team.color })}${r.name}</a></td><td class="l">${r.role}</td><td>${r.starts}/${r.games}</td><td>${num(r.min)}</td><td>${num(r.pts)}</td><td>${num(r.reb)}</td><td>${num(r.ast)}</td><td>${w ? num(w.score) : '—'}</td></tr>`;
          })}
        </tbody></table></div>
        <p class="note" style="margin-top:6px">${t.rotation.method}</p>
      </div>

      <div style="margin-top:16px"><span class="card-title">Availability</span> <a class="sec-link" href="/injuries">Injury Desk →</a>
        ${t.availability.length ? t.availability.map((i) => html`<div class="change-row">${avatar({ name: i.name, photo: i.photo }, { teamColor: t.team.color })}<div><a href="/players/${i.athlete_id}"><b>${i.name}</b></a><div class="note">${[i.side, i.body_part].filter(Boolean).join(' ') || '—'} · updated ${fmtDateET(i.source_updated_at, { month: 'short', day: 'numeric' })}</div></div>${statusBadge(i.status)}</div>`) : html`<p class="note" style="margin-top:6px">No players listed on the injury feed.</p>`}
      </div>
    </div>
  </section>`;

  const when = `${fmtDateET(g.start_utc, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTimeET(g.start_utc)}`;
  return html`
    <section class="team-hero" style="--tc1:${teamColors(g.away).color || '#8fb4ff'};--tc2:${teamColors(g.home).color || '#d4af37'};margin-bottom:16px">
      <div style="padding:clamp(18px,3vw,34px)">
        <span class="eyebrow">Matchup research · ${when}</span>
        <h1 class="sr">${g.away?.name} at ${g.home?.name}: WNBA matchup research</h1>
        <div class="mu-head" style="margin-top:16px">
          <div class="mu-team" style="display:flex;gap:14px;align-items:center">${teamLogo(g.away, 72)}<span><b><a href="/teams/${g.away?.team_id}">${g.away?.name}</a></b><small>${g.away?.record || ''} · away</small></span></div>
          <span class="mu-vs">AT</span>
          <div class="mu-team home" style="display:flex;gap:14px;align-items:center;justify-content:flex-end"><span><b><a href="/teams/${g.home?.team_id}">${g.home?.name}</a></b><small>${g.home?.record || ''} · home${g.venue?.name ? ` · ${g.venue.name}` : ''}</small></span>${teamLogo(g.home, 72)}</div>
        </div>
        <div class="pill-row" style="margin-top:16px"><a class="pill on" href="/cast/${g.game_id}">WNBACast</a><a class="pill" href="/props">Best line board</a><a class="pill" href="/injuries">Injury Desk</a>${d.season_series?.[0]?.summary ? html`<span class="chip">${d.season_series[0].summary}</span>` : ''}</div>
      </div>
    </section>

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
      <div class="sec-head"><h2 class="sec-title bc">Line context</h2>${d.market_summary ? html`<span class="note">${d.market_summary.semantics === 'LAST_PRE_TIP_SNAPSHOT' ? 'Last pre-tip capture' : 'Stored snapshot'} · ${fmtDateTimeET(d.market_summary.captured_at)}</span>` : ''}</div>
      ${d.market_summary ? html`${marketStrip(d.market_summary, g)}
        <div class="tiles" style="margin-top:12px">
          <div class="tile"><small>No-vig ${g.home?.abbr} win</small><b class="cons">${d.market_summary.moneyline.home_no_vig !== null ? `${(d.market_summary.moneyline.home_no_vig * 100).toFixed(1)}%` : '—'}</b><span>market benchmark</span></div>
          <div class="tile"><small>Spread moves</small><b style="height:30px">${raw(sparkline((d.market_history || []).map((h) => h.spread), { width: 110, height: 28 }))}</b><span>${(d.market_history || []).length} capture${(d.market_history || []).length === 1 ? '' : 's'}</span></div>
          <div class="tile"><small>Player props</small><b>${d.market_summary.props?.available ? d.market_summary.props.players : '—'}</b><span>${d.market_summary.props?.available ? 'players captured' : '36h capture window'}</span></div>
          <div class="tile"><small>Books captured</small><b>${d.market_summary.books ?? '—'}</b><span>sportsbooks in snapshot</span></div>
        </div>` : html`<p class="note">No market snapshot matched to this game yet. Snapshots run at 8:00, 1:00 and 6:00 ET; a page view never requests new prices.</p>`}
    </section>

    <section class="section" style="margin:0 0 16px">
      <div class="sec-head"><h2 class="sec-title bc">Newsroom on this game</h2><a class="sec-link" href="/news/c/preview">All previews →</a></div>
      ${articleList(arts?.ok ? arts.data.items : [], { empty: 'No PropBetEdge article on this game yet.' })}
    </section>

    <div class="grid g2">${teamPanel(A)}${teamPanel(H)}</div>
    <div style="margin-top:16px">${sourceLine(res.meta, { label: 'Matchup research' })}</div>
  `;
}
