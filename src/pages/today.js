import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { gameCard, sourceLine, empty, errorState, skeleton, avatar, statusBadge, entityChips, badge, startFreshTicker } from '../ui/components.js';
import { fmtCompactDate, fmtDateET, fmtDateTimeET, relTime, plural, fmtTimeET } from '../lib/format.js';
import { createPoller } from '../lib/poller.js';

export const title = () => null;
export const description = () => 'Today in the WNBA: the current slate with live/final/scheduled state, sourced injuries, market snapshot age, WNBACast and the WNBA-only newsroom.';

export async function mount(root, ctx) {
  render(root, html`<div class="hero">${skeleton(180)}</div><div class="section">${skeleton(140, 2)}</div>`);
  let poller = null;
  let stopTicker = startFreshTicker(root);

  const draw = async () => {
    const [today, news, injuries, standings] = await Promise.all([api.today(), api.news({ limit: 8 }), api.injuries(), api.standings()]);
    if (!ctx.isCurrent()) return;
    if (!today.ok) { render(root, errorState(today, 'The WNBA slate')); return; }
    const d = today.data;
    const slate = d.slate;
    const live = slate.summary.live > 0;
    poller?.setInterval(live ? 20000 : 120000);

    const heroTitle = slate.kind === 'TODAY'
      ? live ? html`<em>Live</em> WNBA tonight` : html`Today’s <em>WNBA</em> slate`
      : slate.kind === 'NEXT' ? html`No games today. <em>Next slate</em> ${fmtCompactDate(slate.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : html`No WNBA games <em>scheduled</em>`;
    const slateLabel = slate.kind === 'TODAY' ? `Today · ${fmtCompactDate(d.today_et)}` : slate.kind === 'NEXT' ? `Next slate · ${fmtCompactDate(slate.date)} · not today` : 'No upcoming games published';

    const changes = (injuries.ok ? injuries.data.changes : []) || [];
    const lastResults = d.last_results?.games || [];
    const deskItems = news.ok ? news.data.items.filter((i) => i.lane === 'pbe').slice(0, 3) : [];
    const extItems = news.ok ? news.data.items.filter((i) => i.lane === 'external').slice(0, 5) : [];
    const seeds = standings.ok ? standings.data.groups.map((g) => ({ name: g.name, top: g.entries.slice(0, 4) })) : [];
    const firstUpcoming = slate.games[0];
    const lastFinal = lastResults[0];

    render(root, html`
      <section class="hero">
        <div class="hero-grid">
          <div>
            <span class="eyebrow">${d.season?.label || 'WNBA'}${d.phase ? ` · ${d.phase}` : ''}</span>
            <h1 style="margin-top:12px">${heroTitle}</h1>
            <p class="lead">${slate.kind === 'TODAY'
              ? `${plural(slate.summary.total, 'game')} on the board — ${slate.summary.live} live, ${slate.summary.final} final, ${slate.summary.scheduled} scheduled.`
              : slate.kind === 'NEXT'
                ? `The WNBA has no games on ${fmtCompactDate(d.today_et, { weekday: 'long', month: 'long', day: 'numeric' })}. The next published slate is ${fmtCompactDate(slate.date)} with ${plural(slate.games.length, 'game')}.`
                : 'No upcoming WNBA games are published by the source right now.'}
              ${d.next_phase ? ` ${d.next_phase.name} begins ${fmtDateET(d.next_phase.starts, { month: 'long', day: 'numeric' })}.` : ''}</p>
            <div style="margin-top:14px">${sourceLine(today.meta, { label: slateLabel })}</div>
          </div>
          <div class="hero-stats">
            <div class="tile"><small>${slate.kind === 'TODAY' ? 'Games today' : 'Next slate'}</small><b>${slate.games.length}</b><span>${slate.kind === 'TODAY' ? 'ET calendar' : fmtCompactDate(slate.date, { month: 'short', day: 'numeric' })}</span></div>
            <div class="tile"><small>Players out</small><b>${d.availability?.out ?? '—'}</b><span>${d.availability?.count !== null ? `${d.availability.count} on injury feed` : 'feed unavailable'}</span></div>
            <div class="tile"><small>Market</small><b>${d.market?.events ?? 0}</b><span>${d.market?.captured_at ? `snapshot ${relTime(d.market.captured_at)}` : 'no snapshot yet'}</span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sec-head"><h2 class="sec-title">${slateLabel}</h2><a class="sec-link" href="/cast">Open WNBACast →</a></div>
        ${slate.games.length ? html`<div class="slate-grid">${slate.games.map((g) => gameCard(g, { showDate: slate.kind !== 'TODAY' }))}</div>` : empty('Quiet slate', 'No WNBA games are published for the coming days. Replays of completed games stay available in WNBACast.')}
      </section>

      <div class="section split">
        <div>
          <section>
            <div class="sec-head"><h2 class="sec-title">Research actions</h2></div>
            <div class="actions">
              ${firstUpcoming ? html`<a class="action" href="/matchups/${firstUpcoming.game_id}"><span><b>Matchup: ${firstUpcoming.away?.abbr} @ ${firstUpcoming.home?.abbr}</b><small>Pace, form, rest, observed rotations, availability — ${fmtDateTimeET(firstUpcoming.start_utc)}</small></span><span class="arrow">→</span></a>` : ''}
              <a class="action" href="/props"><span><b>Best line board</b><small>${d.market?.captured_at ? `Sportsbook prices and no-vig consensus · captured ${fmtDateTimeET(d.market.captured_at)}` : 'Market snapshots are captured at 8:00, 1:00 and 6:00 ET'}</small></span><span class="arrow">→</span></a>
              ${lastFinal ? html`<a class="action" href="/cast/${lastFinal.game_id}"><span><b>Replay: ${lastFinal.away?.abbr} ${lastFinal.away?.score} – ${lastFinal.home?.abbr} ${lastFinal.home?.score}</b><small>Every published play, shot and run from ${fmtDateET(lastFinal.start_utc, { month: 'short', day: 'numeric' })}</small></span><span class="arrow">→</span></a>` : ''}
              <a class="action" href="/injuries"><span><b>Availability desk</b><small>${d.availability?.count ?? '—'} players on the injury feed · sourced statuses, no invented return dates</small></span><span class="arrow">→</span></a>
            </div>
          </section>

          ${lastResults.length ? html`<section class="section">
            <div class="sec-head"><h2 class="sec-title">Last results · ${fmtDateET(lastResults[0].start_utc, { weekday: 'short', month: 'short', day: 'numeric' })}</h2><a class="sec-link" href="/standings">Standings →</a></div>
            <div class="slate-grid">${lastResults.map((g) => gameCard(g))}</div>
          </section>` : ''}

          <section class="section">
            <div class="sec-head"><h2 class="sec-title">WNBA newsroom</h2><a class="sec-link" href="/news">All news →</a></div>
            <div class="card card-pad">
              ${deskItems.map((i) => html`<article class="nitem"><div class="nmeta">${badge('pbe', 'PBE Desk')}<span>${relTime(i.published_at)}</span></div><h3><a href="/news/story/${i.id}">${i.headline}</a></h3><div class="nents">${entityChips(i.entities)}</div></article>`)}
              ${extItems.map((i) => html`<article class="nitem"><div class="nmeta">${badge('ext', i.source.name)}<span>${relTime(i.published_at)}</span><span>${i.kind}</span></div><h3><a href="${i.url}" rel="noopener" target="_blank">${i.headline}</a></h3><div class="nents">${entityChips(i.entities)}</div></article>`)}
              ${!news.ok ? html`<p class="note">The newsroom lane is unavailable right now. Scores and research are unaffected.</p>` : ''}
            </div>
          </section>
        </div>

        <aside>
          <section>
            <div class="sec-head"><h2 class="sec-title">What changed</h2></div>
            <div class="card card-pad">
              ${changes.length
                ? changes.slice(0, 8).map((c) => html`<div class="change-row">${avatar({ name: c.name })}<div><a href="${c.athlete_id ? `/players/${c.athlete_id}` : '/injuries'}"><b>${c.name}</b></a><div class="note">${c.status_before || 'Not listed'} <span class="arrow">→</span> ${c.status_after || 'Off feed'}</div></div><span class="note">${relTime(c.captured_at)}</span></div>`)
                : html`<p class="note">No availability changes recorded yet. PropBetEdge only reports a change after two captures of the source disagree — the ledger started ${injuries.ok ? 'recording this week' : 'when the feed returns'}.</p>`}
            </div>
          </section>

          ${seeds.length ? html`<section class="section">
            <div class="sec-head"><h2 class="sec-title">Top seeds</h2><a class="sec-link" href="/standings">Full table →</a></div>
            <div class="card">
              ${seeds.map((g) => html`<div class="card-head"><span class="card-title">${g.name}</span></div>
                <div class="tbl-wrap"><table class="tbl"><tbody>${g.top.map((t) => html`<tr><td class="l"><a class="pname" href="/teams/${t.team_id}">${t.seed ?? '—'} · ${t.name}${t.clincher ? html`<span class="clinch">${t.clincher}</span>` : ''}</a></td><td>${t.wins}-${t.losses}</td><td>${t.games_behind}</td></tr>`)}</tbody></table></div>`)}
            </div>
          </section>` : ''}

          <section class="section">
            <div class="card card-pad" style="border-color:var(--gold-line)">
              <span class="eyebrow">Basketball network</span>
              <p style="margin-top:10px;color:var(--paper-2)">The same research desk covers the NBA season — WNBA methods, NBA data.</p>
              <a class="sec-link" style="display:inline-block;margin-top:10px" href="https://nba.propbetedge.ai/">PropBetEdge NBA →</a>
            </div>
          </section>
        </aside>
      </div>
    `);
  };

  poller = createPoller(draw, { intervalMs: 120000 });
  return () => { poller?.stop(); stopTicker(); };
}
