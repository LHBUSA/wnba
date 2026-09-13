// Today / command center view — shared by the SPA page and the wnba-web publishing Worker.
import { html, raw } from '../lib/dom.js';
import { gameCard, sourceLine, empty, errorState } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { articleCard, articleMini } from '../ui/articles.js';
import { HERO_ART } from '../ui/art.js';
import { fmtCompactDate, fmtDateET, fmtDateTimeET, relTime, plural, fmtTimeET, american, bookName } from '../lib/format.js';
import logoManifest from '../../data/team-logos.json' with { type: 'json' };
import { buildTicker } from '../lib/ticker.js';

export async function loadToday(api) {
  // The ticker reads the international canonical layer too (live, recent finals, next games); a failure there only
  // removes international items, never the page.
  const [today, arts, injuries, standings, intl] = await Promise.all([api.today(), api.articles({ limit: 12 }), api.injuries(), api.standings(), api.intl ? api.intl().catch(() => null) : Promise.resolve(null)]);
  return { today, arts, injuries, standings, intl };
}

/** Returns { body, live } — `live` lets the page pick its poll interval. */
/** The top rail as HTML: game state first (WNBA, then international), headlines only when no game item exists. */
export function tickerRail(ticker, { freshness = null } = {}) {
  const items = ticker.items;
  const lead = ticker.mode === 'live' ? ['tk-live', 'Live'] : ticker.mode === 'next' ? ['tk-next', 'Next'] : ticker.mode === 'final' ? ['tk-final', 'Final'] : ['tk-next', 'Headlines'];
  const item = (x, dup = false) => html`<a class="tk-item tk-${x.item_type} ${x.sport_scope === 'international' ? 'tk-intl' : ''}" href="${x.destination_url}" tabindex="${dup ? '-1' : '0'}" aria-hidden="${dup ? 'true' : 'false'}"><b class="tk-tag">${x.label}</b><span class="tk-text">${x.text}</span>${x.meta ? html`<span class="tk-meta">${x.meta}</span>` : ''}</a>`;
  return html`<div class="ticker" aria-label="${ticker.mode === 'headlines' ? 'Headlines' : 'Games: live, next and final'}" data-ticker-mode="${ticker.mode}">
      <span class="${lead[0]}">${lead[1]}</span>
      <span class="tk-scroll"><span class="tk-scroll-in ${items.length <= 2 ? 'tk-static' : ''}">${items.map((x) => item(x))}${items.length > 2 ? items.map((x) => item(x, true)) : ''}</span></span>
      ${freshness ? html`<span class="tk-fresh">${freshness}</span>` : ''}
    </div>`;
}

export function todayView({ today, arts, injuries, standings, intl = null }) {
  if (!today?.ok) return { body: errorState(today, 'The WNBA slate'), live: false };
  const d = today.data;
  const slate = d.slate;
  const live = slate.summary.live > 0;
  const games = slate.games;
  const priced = games.filter((g) => g.market);
  const stories = arts.ok ? arts.data.items : [];
  const leadStory = stories.find((c) => c.kind === 'preview' && c.has_market) || stories.find((c) => c.kind === 'injury') || stories[0];
  const moreStories = stories.filter((c) => c.id !== leadStory?.id).slice(0, 5);
  const changes = (injuries.ok ? injuries.data.changes : []) || [];
  const lastResults = d.last_results?.games || [];
  const seeds = standings.ok ? standings.data.groups.map((g) => ({ name: g.name, top: g.entries.slice(0, 4) })) : [];
  const slateWhen = slate.kind === 'TODAY' ? 'Tonight' : slate.kind === 'NEXT' ? fmtCompactDate(slate.date, { weekday: 'short', month: 'short', day: 'numeric' }) : '—';

  const heroTitle = slate.kind === 'TODAY'
    ? live ? html`<em>Live</em> WNBA, priced and in context` : html`Tonight’s <em>WNBA</em> slate, priced and in context`
    : slate.kind === 'NEXT' ? html`No games today. <em>${slate.games.length} games</em> ${fmtCompactDate(slate.date, { weekday: 'long' })}.` : html`The <em>WNBA</em> intelligence desk`;
  const I = intl?.ok ? intl.data : null;
  const ticker = buildTicker({
    wnbaGames: games,
    wnbaRecent: lastResults,
    intlLive: I?.live || [],
    intlUpcoming: (I?.competitions || []).flatMap((c) => c.next_games || []),
    intlRecent: I?.recent || [],
    stories
  });
  const intlLive = ticker.items.some((x) => x.sport_scope === 'international' && x.item_type === 'live_game');


  return { live: live || intlLive, body: html`
    ${tickerRail(ticker, { freshness: today.meta?.served_at ? `Updated ${relTime(today.meta.served_at)}` : null })}

    <section class="hero2">
      ${raw(HERO_ART)}
      <div class="hero2-in">
        <div>
          <span class="kicker">${d.season?.label || 'WNBA'}${d.next_phase ? ` · ${d.next_phase.name} ${fmtDateET(d.next_phase.starts, { month: 'short', day: 'numeric' })}` : ''}</span>
          <h1 style="margin-top:14px">${heroTitle}</h1>
          <p class="lead">The WNBA intelligence layer for bettors: live scores and WNBACast, stored sportsbook lines with their capture time, sourced availability, and an in-house newsroom that tells you why each story matters for the market.</p>
          <div class="pill-row" style="margin-top:16px">
            <a class="pill on" href="/cast">Open WNBACast</a><a class="pill" href="/props">Best line board</a><a class="pill" href="/news">Newsroom</a><a class="pill" href="/injuries">Availability</a>
          </div>
          <div style="margin-top:16px">${sourceLine(today.meta, { label: slate.kind === 'TODAY' ? 'Today · ET' : `Next slate ${fmtCompactDate(slate.date, { month: 'short', day: 'numeric' })} · not today` })}</div>
        </div>
        ${leadStory ? html`<div class="hero-feature">
          <span class="eyebrow">Lead story</span>
          <a href="/news/${leadStory.slug}" style="display:block;margin-top:10px">
            <div style="display:flex;gap:8px;align-items:center">${(leadStory.entities || []).filter((e) => e && e.type === 'team').slice(0, 2).map((t) => teamLogo({ team_id: t.id, name: t.name }, 30))}</div>
            <b style="display:block;font:600 22px/1.2 var(--f-editorial);margin-top:10px">${leadStory.headline}</b>
            <span class="note" style="display:block;margin-top:8px">${leadStory.deck}</span>
          </a>
          <div class="tiles" style="margin-top:14px">
            <div class="tile"><small>${slateWhen}</small><b>${games.length}</b><span>games · ${priced.length} priced</span></div>
            <div class="tile"><small>Players out</small><b>${d.availability?.out ?? '—'}</b><span>injury feed</span></div>
          </div>
        </div>` : ''}
      </div>
    </section>

    <nav class="card" style="margin-top:14px;padding:10px 12px;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none" aria-label="Teams">
      ${logoManifest.teams.map((t) => html`<a href="/teams/${t.team_id}" title="${t.name}" style="flex:none;padding:6px;border-radius:10px">${teamLogo({ team_id: t.team_id, name: t.name }, 40)}</a>`)}
    </nav>

    <section class="section">
      <div class="sec-head"><h2 class="sec-title bc">${slate.kind === 'TODAY' ? `Today · ${fmtCompactDate(d.today_et)}` : slate.kind === 'NEXT' ? `Next slate · ${fmtCompactDate(slate.date)}` : 'Upcoming'}</h2><a class="sec-link" href="/cast">All games in WNBACast →</a></div>
      ${games.length ? html`<div class="slate-grid">${games.map((g) => gameCard(g, { showDate: slate.kind !== 'TODAY' }))}</div>` : empty('Quiet slate', 'No WNBA games are published for the coming days. Replays of completed games stay available in WNBACast.')}
    </section>

    ${priced.length ? html`<section class="section">
      <div class="sec-head"><h2 class="sec-title bc">Market board</h2><span class="note">The Odds API · best price across books · captured ${fmtDateTimeET(d.market.captured_at)} · never refreshed by page views</span></div>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Game</th><th>Spread (home)</th><th>Total</th><th>Away ML</th><th>Home ML</th><th>Books</th><th>Props</th></tr></thead>
        <tbody>${priced.map((g) => html`<tr>
          <td><a class="pname" href="/matchups/${g.game_id}">${teamLogo(g.away, 22)}${g.away.abbr} @ ${teamLogo(g.home, 22)}${g.home.abbr}<span class="note">${fmtTimeET(g.start_utc)}</span></a></td>
          <td>${g.home.abbr} ${g.market.spread.home_line > 0 ? '+' : ''}${g.market.spread.home_line ?? '—'} <span class="note">${american(g.market.spread.home_best?.price)} ${bookName(g.market.spread.home_best?.book)}</span></td>
          <td>${g.market.total.line ?? '—'} <span class="note">O ${american(g.market.total.over_best?.price)}</span></td>
          <td>${american(g.market.moneyline.away_best?.price)} <span class="note">${bookName(g.market.moneyline.away_best?.book)}</span></td>
          <td>${american(g.market.moneyline.home_best?.price)} <span class="note">${bookName(g.market.moneyline.home_best?.book)}</span></td>
          <td>${g.market.books}</td>
          <td>${g.market.props?.available ? `${g.market.props.players} players` : html`<span class="note">36h window</span>`}</td>
        </tr>`)}</tbody></table></div>
        <div class="card-body"><p class="note">Sportsbook prices and the market’s no-vig consensus are shown separately on the <a class="gold" href="/props">best line board</a>, with source, book count and capture time kept visible.</p></div></div>
    </section>` : ''}

    <div class="section split">
      <div>
        <section>
          <div class="sec-head"><h2 class="sec-title bc">PBE Newsroom</h2><a class="sec-link" href="/news">All stories →</a></div>
          ${moreStories.length ? html`<div class="ngrid">${moreStories.map((c) => articleCard(c))}</div>` : html`<p class="note">${arts.ok ? 'No articles yet — the newsroom publishes only when a record supports a story.' : 'The newsroom lane is unavailable right now.'}</p>`}
        </section>
        ${lastResults.length ? html`<section class="section">
          <div class="sec-head"><h2 class="sec-title bc">Last results · ${fmtDateET(lastResults[0].start_utc, { weekday: 'short', month: 'short', day: 'numeric' })}</h2><a class="sec-link" href="/standings">Standings →</a></div>
          <div class="slate-grid">${lastResults.map((g) => gameCard(g))}</div>
        </section>` : ''}
      </div>
      <aside class="grid" style="gap:16px;align-content:start">
        <section class="card">
          <div class="card-head"><span class="card-title">What changed</span><a class="sec-link" href="/injuries">Desk →</a></div>
          <div class="card-body">
            ${changes.length
              ? changes.slice(0, 8).map((c) => html`<div class="change-row">${teamLogo({ team_id: c.team_id }, 28)}<div><a href="${c.athlete_id ? `/players/${c.athlete_id}` : '/injuries'}"><b>${c.name}</b></a><div class="note">${c.status_before || 'Not listed'} → ${c.status_after || 'Off feed'}</div></div><span class="note">${relTime(c.captured_at)}</span></div>`)
              : html`<p class="note">No availability changes recorded yet. A change is reported only when two consecutive captures of the source disagree. ${injuries.ok ? injuries.data.change_ledger : ''}</p>`}
          </div>
        </section>
        ${seeds.length ? html`<section class="card">
          <div class="card-head"><span class="card-title">Top seeds</span><a class="sec-link" href="/standings">Table →</a></div>
          ${seeds.map((g) => html`<div class="card-body" style="padding-bottom:4px"><span class="note">${g.name}</span>
            ${g.top.map((t) => html`<a class="change-row" href="/teams/${t.team_id}" style="grid-template-columns:auto minmax(0,1fr) auto">${teamLogo(t, 26)}<span><b>${t.seed ?? '—'} · ${t.short_name || t.name}</b>${t.clincher ? html`<span class="clinch">${t.clincher}</span>` : ''}</span><span class="mono">${t.wins}-${t.losses}</span></a>`)}</div>`)}
        </section>` : ''}
        <section class="card card-pad" style="border-color:var(--gold-line)">
          <span class="eyebrow">Basketball network</span>
          <p style="margin-top:10px;color:var(--paper-2)">The same research desk covers the NBA season.</p>
          <a class="sec-link" style="display:inline-block;margin-top:10px" href="https://nba.propbetedge.ai/">PropBetEdge NBA →</a>
        </section>
      </aside>
    </div>
  ` };
}
