// Today / command center view — shared by the SPA page and the wnba-web publishing Worker.
import { html } from '../lib/dom.js';
import { gameCard, empty, errorState, gameState } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { articleCard, articleRow } from '../ui/articles.js';
import { fmtCompactDate, fmtDateET, fmtDateTimeET, relTime, fmtTimeET, american, bookName } from '../lib/format.js';
import logoManifest from '../../data/team-logos.json' with { type: 'json' };
import { buildTicker } from '../lib/ticker.js';
import { countdownLabel, resolveTodayHero } from '../lib/today-hero.js';

export async function loadToday(api) {
  // The ticker reads the international canonical layer too (live, recent finals, next games); a failure there only
  // removes international items, never the page. Today is explicitly fresh so a live hero is never held by browser TTL.
  const [today, arts, injuries, standings, intl] = await Promise.all([
    api.today({ fresh: true }),
    api.articles({ limit: 12 }),
    api.injuries(),
    api.standings(),
    api.intl ? api.intl().catch(() => null) : Promise.resolve(null)
  ]);
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

const signed = (v) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${v}`);
const teamName = (t) => t?.short_name || t?.abbr || t?.name || 'TBD';
const teamAbbr = (t) => t?.abbr || t?.short_name || 'TBD';

function heroTitle(hero) {
  const cd = hero.primary?.start_utc
    ? html`<em data-live-countdown="${hero.primary.start_utc}">${countdownLabel(hero.primary.start_utc)}</em>`
    : html`<em>LIVE DESK</em>`;
  if (hero.mode === 'LIVE') return html`LIVE <em>NOW</em>`;
  if (hero.mode === 'PREGAME') return html`NEXT TIP IN ${cd}`;
  if (hero.mode === 'BETWEEN') return html`NEXT UP IN ${cd}`;
  if (hero.mode === 'FINAL') return html`${hero.totals.final} GAMES <em>FINAL</em>`;
  if (hero.mode === 'OFFDAY') return html`NEXT TIP IN ${cd}`;
  if (hero.mode === 'DELAYED') return html`GAME <em>DELAYED</em>`;
  return html`WNBA ${cd}`;
}

function heroEyebrow(hero) {
  if (hero.mode === 'LIVE') return 'Live WNBA desk';
  if (hero.mode === 'PREGAME') return 'Pregame desk';
  if (hero.mode === 'BETWEEN') return 'Between games';
  if (hero.mode === 'FINAL') return 'Slate final';
  if (hero.mode === 'OFFDAY') return 'WNBA live desk';
  if (hero.mode === 'DELAYED') return 'Schedule watch';
  return 'WNBA intelligence desk';
}

function heroSubcopy(hero) {
  if (hero.mode === 'LIVE') return 'Live score and game clock from the WNBA feed, with stored pre-tip market context and sourced availability alongside it.';
  if (hero.mode === 'PREGAME' || hero.mode === 'BETWEEN') return 'The next tip, market snapshot and availability context update automatically as the slate moves.';
  if (hero.mode === 'FINAL') return 'The live slate has closed. Final scores stay on the desk while newsroom and availability signals continue updating.';
  if (hero.mode === 'OFFDAY') return 'No WNBA game is live right now. The desk stays on with the next tip, market snapshot, availability and newsroom intelligence.';
  if (hero.mode === 'DELAYED') return 'The scheduled game is not in normal pre-tip state. The desk will move automatically when the source status changes.';
  return 'Live scores, scheduled games, sourced availability and newsroom intelligence in one continuously refreshed desk.';
}

function renderHeroMatchup(hero) {
  const g = hero.primary;
  if (!g) return html`<div class="lh-empty"><b>Desk is live.</b><span>No WNBA game is published in the current or next slate yet.</span></div>`;
  const st = gameState(g);
  const showScore = g.status?.state === 'in' || g.status?.state === 'post';
  return html`${hero.mode === 'LIVE' ? html`<div class="lh-feed-label"><span>Live score feed</span><small>Score + clock · 10s refresh</small></div>` : ''}
  <div class="lh-matchup" aria-live="polite" aria-atomic="true">
    <div class="lh-team lh-away">
      ${teamLogo(g.away, 58)}
      <span class="lh-team-name"><small>Away</small><b>${teamName(g.away)}</b><span>${g.away?.record || teamAbbr(g.away)}</span></span>
      ${showScore ? html`<strong class="lh-score">${g.away?.score ?? '—'}</strong>` : ''}
    </div>
    <div class="lh-game-state">
      <span class="lh-state ${hero.mode === 'LIVE' ? 'is-live' : ''}">${st.label}</span>
      <b>${g.status?.state === 'pre' ? 'AT' : '—'}</b>
      <small>${fmtDateET(g.start_utc, { month: 'short', day: 'numeric' })}</small>
    </div>
    <div class="lh-team lh-home">
      ${teamLogo(g.home, 58)}
      <span class="lh-team-name"><small>Home</small><b>${teamName(g.home)}</b><span>${g.home?.record || teamAbbr(g.home)}</span></span>
      ${showScore ? html`<strong class="lh-score">${g.home?.score ?? '—'}</strong>` : ''}
    </div>
  </div>`;
}

function renderHeroMarket(hero) {
  const g = hero.primary;
  if (!g) return '';
  const m = g.market;
  if (!m) return html`<div class="lh-market-block">
    <div class="lh-market-label"><span>Market odds</span><small>Stored snapshot · not published yet</small></div>
    <div class="lh-market lh-market-empty"><span>Market snapshot</span><b>Not published yet</b><small>Nothing is filled with a stand-in number.</small></div>
  </div>`;
  return html`<div class="lh-market-block ${hero.mode === 'LIVE' ? 'is-live-context' : ''}">
    <div class="lh-market-label"><span>Market odds</span><small>Stored snapshot${m.captured_at ? ` · captured ${relTime(m.captured_at)}` : ''}</small></div>
    <div class="lh-market" aria-label="Stored market snapshot">
    <div><span>Spread</span><b>${teamAbbr(g.home)} ${signed(m.spread?.home_line)}</b><small>${m.spread?.home_best ? `${american(m.spread.home_best.price)} · ${bookName(m.spread.home_best.book)}` : 'best price unavailable'}</small></div>
    <div><span>Total</span><b>${m.total?.line ?? '—'}</b><small>${m.total?.over_best ? `O ${american(m.total.over_best.price)}` : 'price unavailable'}</small></div>
    <div><span>Moneyline</span><b>${teamAbbr(g.away)} ${american(m.moneyline?.away_best?.price)}</b><small>${teamAbbr(g.home)} ${american(m.moneyline?.home_best?.price)}</small></div>
    <div class="lh-market-age"><span>Captured</span><b>${m.captured_at ? relTime(m.captured_at) : '—'}</b><small>${m.books ? `${m.books} books` : 'stored snapshot'}</small></div>
    </div>
  </div>`;
}

function renderHeroSelectors(hero) {
  if ((hero.selectors || []).length < 2) return '';
  return html`<nav class="lh-selectors" aria-label="Slate game selectors">
    ${hero.selectors.map((g) => {
      const st = gameState(g);
      const active = g.game_id === hero.primary?.game_id;
      const score = g.status?.state === 'pre' ? st.label : `${g.away?.score ?? '—'}–${g.home?.score ?? '—'} · ${st.label}`;
      return html`<a class="lh-selector ${active ? 'active' : ''}" href="/cast/${g.game_id}" aria-current="${active ? 'true' : 'false'}"><b>${teamAbbr(g.away)} @ ${teamAbbr(g.home)}</b><span>${score}</span></a>`;
    })}
  </nav>`;
}

function renderHeroActions(hero) {
  const g = hero.primary;
  if (!g) return html`<div class="lh-actions"><a class="pill on" href="/news">Newsroom</a><a class="pill" href="/injuries">Availability</a></div>`;
  const castLabel = hero.mode === 'LIVE' ? 'Open live WNBACast' : hero.mode === 'FINAL' ? 'Open replay' : 'Open WNBACast';
  return html`<div class="lh-actions">
    <a class="pill on" href="/cast/${g.game_id}">${castLabel}</a>
    <a class="pill" href="/matchups/${g.game_id}">Matchup</a>
    ${g.status?.state === 'pre' ? html`<a class="pill" href="/props">Best line</a>` : ''}
    <a class="pill" href="/injuries">Availability</a>
  </div>`;
}

function relatedChange(changes, g) {
  if (!changes.length) return null;
  const ids = new Set([g?.away?.team_id, g?.home?.team_id].filter(Boolean).map(String));
  return changes.find((x) => ids.has(String(x.team_id))) || null;
}

function renderHeroIntel({ hero, leadStory, changes, d }) {
  const g = hero.primary;
  const change = relatedChange(changes, g);
  const fallbackChange = changes[0] || null;
  const useChange = change || (!leadStory ? fallbackChange : null);
  const title = hero.mode === 'LIVE' ? 'Live intelligence' : useChange ? 'Availability movement' : 'Latest intelligence';
  const st = g ? gameState(g) : null;
  const firstTile = hero.mode === 'LIVE' && st
    ? { label: 'Game state', value: st.label, note: 'scoreboard feed' }
    : hero.mode === 'FINAL'
      ? { label: 'Final', value: hero.totals.final, note: `${hero.totals.games} games on slate` }
      : g
        ? { label: 'Tip', value: fmtTimeET(g.start_utc), note: fmtDateET(g.start_utc, { month: 'short', day: 'numeric' }) }
        : { label: 'Slate', value: hero.totals.games, note: 'published games' };
  const secondTile = g?.market
    ? { label: 'Market', value: `${teamAbbr(g.home)} ${signed(g.market.spread?.home_line)}`, note: `Total ${g.market.total?.line ?? '—'}` }
    : { label: 'Players out', value: d.availability?.out ?? '—', note: 'injury feed' };

  return html`<aside class="hero-feature lh-intel">
    <span class="eyebrow">${title}</span>
    ${useChange ? html`<a class="lh-intel-main" href="${useChange.athlete_id ? `/players/${useChange.athlete_id}` : '/injuries'}">
      <div class="lh-intel-logos">${teamLogo({ team_id: useChange.team_id }, 34)}</div>
      <b>${useChange.name}</b>
      <span>${useChange.status_before || 'Not listed'} → ${useChange.status_after || 'Off feed'}${useChange.captured_at ? ` · ${relTime(useChange.captured_at)}` : ''}</span>
    </a>` : leadStory ? html`<a class="lh-intel-main" href="/news/${leadStory.slug}">
      <div class="lh-intel-logos">${(leadStory.entities || []).filter((e) => e?.type === 'team').slice(0, 2).map((t) => teamLogo({ team_id: t.id, name: t.name }, 34))}</div>
      <b>${leadStory.headline}</b>
      <span>${leadStory.deck}</span>
    </a>` : html`<div class="lh-intel-main"><b>Desk is current.</b><span>No new sourced availability or newsroom item is published right now.</span></div>`}
    <div class="tiles lh-tiles">
      <div class="tile"><small>${firstTile.label}</small><b>${firstTile.value}</b><span>${firstTile.note}</span></div>
      <div class="tile"><small>${secondTile.label}</small><b>${secondTile.value}</b><span>${secondTile.note}</span></div>
    </div>
  </aside>`;
}

function renderHeroMeta(meta, live) {
  const at = meta?.fetched_at || meta?.served_at || '';
  return html`<div class="lh-meta">
    <span class="lh-presence ${live ? 'is-live' : ''}"><i></i>${live ? 'LIVE' : 'CURRENT'}</span>
    <span>Source <b><a href="https://propsports.proptechusa.ai" rel="noopener" target="_blank">propsports.proptechusa.ai</a></b></span>
    ${at ? html`<span data-live-age="${at}">Updated ${relTime(at)}</span>` : html`<span>Update time unavailable</span>`}
    <span>${live ? '10s scoreboard refresh' : '30s desk refresh'}</span>
  </div>`;
}

function renderEditorialFront(leadStory, secondaryStories) {
  return html`<section class="editorial-front" aria-label="Top WNBA stories">
    <div class="sec-head sports-front-head">
      <div><span class="eyebrow">Top stories</span><h2 class="sec-title bc">Around the WNBA</h2></div>
      <a class="sec-link" href="/news">All news →</a>
    </div>
    <div class="editorial-grid">
      <div class="editorial-lead">
        ${leadStory
          ? articleCard(leadStory, { lead: true, eager: true })
          : html`<div class="card card-pad sports-story-empty"><span class="eyebrow">PBE Newsroom</span><h2 class="sec-title bc">The league desk is current.</h2><p class="note">The next sourced WNBA story will lead this page when it clears the newsroom gate.</p><a class="btn gold" href="/news">Open newsroom</a></div>`}
      </div>
      <aside class="editorial-rail" aria-label="Latest WNBA stories">
        <div class="editorial-rail-head"><span class="eyebrow">Latest</span><span class="note">Fresh from the PBE newsroom</span></div>
        ${secondaryStories.length
          ? html`<div class="srows editorial-rail-stories">${secondaryStories.map((c) => articleRow(c))}</div>`
          : html`<p class="note editorial-rail-empty">No additional stories have cleared the newsroom gate yet.</p>`}
        <a class="editorial-rail-more" href="/news">Open the newsroom →</a>
      </aside>
    </div>
  </section>`;
}

function gameStripLabel(hero) {
  if (hero.mode === 'FINAL') return 'Latest final';
  if (hero.mode === 'DELAYED') return 'Schedule watch';
  if (hero.mode === 'BETWEEN') return 'Next up';
  if (hero.mode === 'OFFDAY') return 'Next WNBA game';
  if (hero.mode === 'PREGAME') return 'Tonight';
  return 'Game center';
}

function renderGameStrip(hero) {
  const g = hero.primary;
  if (!g) return '';
  const st = gameState(g);
  const showScore = g.status?.state === 'in' || g.status?.state === 'post';
  const m = g.market;
  return html`<section class="sports-game-strip" aria-label="${gameStripLabel(hero)}">
    <div class="sports-game-strip-label">
      <span class="eyebrow">${gameStripLabel(hero)}</span>
      <b>${st.label}</b>
      <small>${fmtDateET(g.start_utc, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeET(g.start_utc)}</small>
    </div>
    <div class="sports-game-strip-matchup">
      <a href="/teams/${g.away?.team_id || ''}" class="sports-game-strip-team">
        ${teamLogo(g.away, 42)}
        <span><small>Away</small><b>${teamName(g.away)}</b><em>${g.away?.record || teamAbbr(g.away)}</em></span>
        ${showScore ? html`<strong>${g.away?.score ?? '—'}</strong>` : ''}
      </a>
      <span class="sports-game-strip-at">${showScore ? '—' : '@'}</span>
      <a href="/teams/${g.home?.team_id || ''}" class="sports-game-strip-team">
        ${teamLogo(g.home, 42)}
        <span><small>Home</small><b>${teamName(g.home)}</b><em>${g.home?.record || teamAbbr(g.home)}</em></span>
        ${showScore ? html`<strong>${g.home?.score ?? '—'}</strong>` : ''}
      </a>
    </div>
    <div class="sports-game-strip-market">
      ${m ? html`
        <span><small>Spread</small><b>${teamAbbr(g.home)} ${signed(m.spread?.home_line)}</b></span>
        <span><small>Total</small><b>${m.total?.line ?? '—'}</b></span>
      ` : html`<span><small>Market</small><b>Not published</b></span>`}
    </div>
    <div class="sports-game-strip-actions">
      <a class="pill on" href="/cast/${g.game_id}">${g.status?.state === 'post' ? 'Replay' : 'WNBACast'}</a>
      <a class="pill" href="/matchups/${g.game_id}">Matchup</a>
    </div>
  </section>`;
}

function renderLiveFront(hero, meta) {
  const g = hero.primary;
  return html`<section class="sports-live-hero is-live" aria-label="Live WNBA game">
    <div class="sports-game-head">
      <div>
        <span class="kicker lh-kicker"><i class="lh-kicker-dot is-live"></i>Live now</span>
        <h1>${g ? `${teamName(g.away)} at ${teamName(g.home)}` : 'WNBA live desk'}</h1>
      </div>
      <a class="sports-game-all" href="/cast">Full scoreboard →</a>
    </div>
    <p class="sports-game-status">${heroEyebrow(hero)} · ${g ? gameState(g).label : 'Live feed'}</p>
    ${renderHeroMatchup(hero)}
    ${renderHeroMarket(hero)}
    ${renderHeroSelectors(hero)}
    ${renderHeroActions(hero)}
    ${renderHeroMeta(meta, true)}
  </section>`;
}

export function todayView({ today, arts, injuries, standings, intl = null }) {
  if (!today?.ok) return { body: errorState(today, 'The WNBA slate'), live: false };
  const d = today.data;
  const slate = d.slate;
  const hero = resolveTodayHero(d);
  const live = hero.mode === 'LIVE';
  const games = slate.games;
  const priced = games.filter((g) => g.market);
  const stories = arts.ok ? arts.data.items : [];
  // The newsroom endpoint is newest-first, but keep the homepage contract explicit:
  // the hero is always the freshest editorial origin, never pinned by story kind.
  const freshStories = [...stories].sort((a, b) =>
    String(b.first_published_at || b.published_at || '').localeCompare(String(a.first_published_at || a.published_at || ''))
  );
  // Historical WinBA backfills belong in the newsroom archive and series pages,
  // not in the live Today/front-page news stack. They are newly published records
  // of older periods, so sorting by publication time must not make them headline news.
  const frontPageStories = freshStories.filter((a) => a?.historical_backfill !== true);
  const leadStory = frontPageStories[0];
  const secondaryStories = frontPageStories.filter((c) => c.id !== leadStory?.id).slice(0, 3);
  const heroStoryIds = new Set([leadStory?.id, ...secondaryStories.map((c) => c.id)].filter(Boolean));
  const moreStories = frontPageStories.filter((c) => !heroStoryIds.has(c.id)).slice(0, 5);
  const changes = (injuries.ok ? injuries.data.changes : []) || [];
  const lastResults = d.last_results?.games || [];
  const seeds = standings.ok ? standings.data.groups.map((g) => ({ name: g.name, top: g.entries.slice(0, 4) })) : [];
  const I = intl?.ok ? intl.data : null;
  const ticker = buildTicker({
    wnbaGames: games,
    wnbaRecent: lastResults,
    intlLive: I?.live || [],
    intlUpcoming: (I?.competitions || []).flatMap((c) => c.next_games || []),
    intlRecent: I?.recent || [],
    stories: frontPageStories
  });
  const intlLive = ticker.items.some((x) => x.sport_scope === 'international' && x.item_type === 'live_game');

  return { live: live || intlLive, body: html`
    ${tickerRail(ticker, { freshness: today.meta?.served_at ? `Updated ${relTime(today.meta.served_at)}` : null })}

    ${live
      ? html`${renderLiveFront(hero, today.meta)}${renderEditorialFront(leadStory, secondaryStories)}`
      : html`${renderEditorialFront(leadStory, secondaryStories)}${renderGameStrip(hero)}`}

    <nav class="card sports-team-rail" aria-label="WNBA teams">
      ${logoManifest.teams.map((t) => html`<a href="/teams/${t.team_id}" title="${t.name}" style="flex:none;padding:6px;border-radius:10px">${teamLogo({ team_id: t.team_id, name: t.name }, 40)}</a>`)}
    </nav>

    <section class="card card-pad" style="margin-top:16px;border-color:var(--gold-line);background:linear-gradient(110deg,rgba(212,175,55,.11),rgba(255,122,47,.04) 55%,transparent)">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px">
        <div style="flex:1 1 620px;min-width:0">
          <span class="eyebrow">PropBetEdge original metric</span>
          <h2 class="sec-title bc" style="margin-top:7px">PropBetEdge — Home of the WinBA Score.</h2>
          <p class="note" style="margin-top:8px;max-width:78ch">WinBA is PropBetEdge’s 0–100 WNBA winning-impact index, built from archived regular-season finals to show box-score production, playing time and how that production is associated with team wins.</p>
        </div>
        <div class="pill-row" style="margin:0">
          <a class="btn gold" href="/winba-score">Learn about the WinBA Score →</a>
          <a class="pill" href="/stats">See WinBA in player stats →</a>
        </div>
      </div>
    </section>


    <section class="section">
      <div class="sec-head"><h2 class="sec-title bc">${slate.kind === 'TODAY' ? `Today · ${fmtCompactDate(d.today_et)}` : slate.kind === 'NEXT' ? `Next slate · ${fmtCompactDate(slate.date)}` : 'Upcoming'}</h2><a class="sec-link" href="/cast">All games in WNBACast →</a></div>
      ${games.length ? html`<div class="slate-grid">${games.map((g) => gameCard(g, { showDate: slate.kind !== 'TODAY' }))}</div>` : empty('Quiet slate', 'No WNBA games are published for the coming days. Replays of completed games stay available in WNBACast.')}
    </section>

    ${priced.length ? html`<section class="section">
      <div class="sec-head"><h2 class="sec-title bc">Market board</h2><span class="note"><a href="https://propsports.proptechusa.ai/" target="_blank" rel="noopener noreferrer">PropSports.PropTechUSA.ai Market Feed</a> · best price across books · captured ${fmtDateTimeET(d.market.captured_at)} · never refreshed by page views</span></div>
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

    <section class="card card-pad sports-pro-strip" style="border-color:var(--gold-line);background:linear-gradient(110deg,rgba(212,175,55,.08),rgba(255,122,47,.035) 55%,transparent)">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px">
        <div style="flex:1 1 560px;min-width:0">
          <span class="eyebrow">WNBA Pro · $9.99/month or just $3.99/week</span>
          <h2 class="sec-title bc" style="margin-top:7px">Get the full WNBA research desk.</h2>
          <p class="note" style="margin-top:8px;max-width:74ch"><b>PBE Picks is our self-learning algorithm</b>, built to learn from graded results, adapt as new games are played, and compare its probabilities against the market — designed to give you an edge without hiding the track record. WNBA Pro also includes model reasoning, WNBACast, Best Line, matchup research and availability context.</p>
          <div class="pill-row" style="margin-top:12px">
            <span class="pill">Self-learning PBE Picks</span><span class="pill">Model reasoning</span><span class="pill">Live track record</span><span class="pill">Best Line + Matchups</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="text-align:right"><b style="display:block;font:700 25px/1 var(--f-editorial)">$3.99</b><span class="note">per week · or $9.99/month</span></div>
          <a class="btn-pro" href="/pro">Get WNBA Pro</a>
        </div>
      </div>
    </section>

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
