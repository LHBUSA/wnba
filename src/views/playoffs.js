// WNBA Playoffs — postseason command center. Shared by the SPA page (src/pages/playoffs.js) and the wnba-web
// publishing Worker. The bracket itself is the generic renderer (src/ui/bracket.js); everything WNBA-specific
// (routes, logos, copy, news, PBE coverage) is composed here.
import { html } from '../lib/dom.js';
import { pageHead, sourceLine, errorState, empty } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';
import { articleRow } from '../ui/articles.js';
import { fmtDateET, fmtTimeET, relTime } from '../lib/format.js';
import { bracketBoard, seriesCard, allGames, statusBadge, gameStatusLabel } from '../ui/bracket.js';

// PBE lock policy as published by workers/shared/pbe-runtime.js LOCK_POLICY (tests/playoffs-render.test.mjs
// asserts these stay equal, so the copy can never drift from the runtime).
export const PBE_POLICY_COPY = Object.freeze({ scoring_window_hours: 48, lock_minutes_before_tip: 15 });

const STATE_COPY = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETE: 'Complete'
};

const PLAYOFF_STORY = /\b(playoffs?|postseason|first[- ]round|semi-?finals?|wnba finals|finals mvp|clinch(?:es|ed)?|elimination game|game [1-7]\b)/i;

export const playoffsHead = () => pageHead({ eyebrow: 'WNBA Playoffs', title: 'WNBA Playoffs', sub: 'Live bracket + series center' });

export async function loadPlayoffs(api, { season = null } = {}) {
  const [res, arts, cov] = await Promise.all([
    api.playoffs(season || undefined),
    api.articles ? api.articles({ limit: 80 }) : Promise.resolve({ ok: false }),
    api.pbeCoverage ? api.pbeCoverage() : Promise.resolve({ ok: false })
  ]);
  return { res, arts, cov };
}

const wnbaOpts = {
  logo: (t, size) => teamLogo({ team_id: t.team_id, abbr: t.abbreviation, name: t.team_name }, size),
  teamHref: (t) => (t?.team_id ? `/teams/${t.team_id}` : null),
  // WNBACast is the game authority. Placeholder games (no teams named yet) have nothing to open.
  gameHref: (g) => (g?.game_id && (g.status === 'FINAL' || (g.home_team && g.away_team)) ? `/cast/${g.game_id}` : null),
  fmtDay: (iso) => fmtDateET(iso, { weekday: 'short', month: 'short', day: 'numeric' }),
  fmtTime: (iso) => fmtTimeET(iso),
  leagueChampionLabel: 'WNBA Champion'
};

/** Stories genuinely about the postseason, newest first, from the current season only. */
export function playoffStories(items, season) {
  const since = Date.parse(`${season}-08-01T00:00:00Z`);
  return (items || [])
    .filter((a) => a?.slug && PLAYOFF_STORY.test(`${a.headline || ''} ${a.deck || ''}`))
    .filter((a) => { const t = Date.parse(a.published_at || a.updated_at || a.created_at || ''); return !Number.isFinite(t) || t >= since; })
    .slice(0, 6);
}

/** Playoff standing of each seeded team, derived only from completed series and the source's clinch marks. */
export function pictureRows(d) {
  const out = new Map();
  const finals = (d.rounds || []).flatMap((r) => r.series.filter((s) => s.status === 'FINAL').map((s) => ({ r, s })));
  const alive = new Set((d.rounds || []).flatMap((r) => r.series.flatMap((s) => [s.higher_seed?.team_id, s.lower_seed?.team_id])).filter(Boolean));
  for (const { r, s } of finals) {
    const loser = s.winner_team_id === s.higher_seed?.team_id ? s.lower_seed : s.higher_seed;
    if (loser) { out.set(loser.team_id, `Out · ${r.name}`); alive.delete(loser.team_id); }
  }
  if (d.champion) out.set(d.champion.team_id, 'Champion');
  return (d.seeds || []).map((t) => {
    let state;
    let key;
    if (out.get(t.team_id) === 'Champion') { state = 'Champion'; key = 'champ'; }
    else if (out.has(t.team_id)) { state = out.get(t.team_id); key = 'out'; }
    else if (alive.has(t.team_id)) { state = 'Active'; key = 'active'; }
    else if (t.clinch_status === 'ELIMINATED') { state = 'Eliminated'; key = 'elim'; }
    else if (t.clinch_status === 'CLINCHED_PLAYOFFS' || t.clinch_status === 'CLINCHED_BEST_RECORD') { state = 'Clinched'; key = 'clinched'; }
    else { state = t.clinch_code ? `Marked ${t.clinch_code}` : 'No mark'; key = 'none'; }
    return { ...t, state, key };
  });
}

function nextGame(d) {
  return allGames(d).find((g) => g.status === 'LIVE') || allGames(d).find((g) => g.status === 'SCHEDULED') || null;
}

function statusTiles(d, meta) {
  const next = nextGame(d);
  const played = d.provenance?.played_game_count ?? 0;
  return html`<div class="po-tiles">
    <div class="po-tile"><small>Season</small><b>${d.season}</b><span>${d.is_current_season ? 'Postseason' : 'Prior season — final'}</span></div>
    <div class="po-tile"><small>Postseason</small><b>${STATE_COPY[d.status] || d.status}</b><span>${played} of ${d.provenance?.postseason_game_count ?? 0} scheduled games played</span></div>
    <div class="po-tile"><small>${next?.status === 'LIVE' ? 'Live now' : 'Next game'}</small><b>${next ? (next.time_tbd || next.status === 'LIVE' ? wnbaOpts.fmtDay(next.start_utc) : `${wnbaOpts.fmtDay(next.start_utc)}`) : '—'}</b><span>${next ? `${next.round.name}${next.game_number ? ` · G${next.game_number}` : ''} · ${next.away_team && next.home_team ? `${next.away_team.abbreviation} @ ${next.home_team.abbreviation}` : 'teams TBD'}${next.status === 'SCHEDULED' ? ` · ${next.time_tbd ? 'time TBD' : fmtTimeET(next.start_utc)}` : ''}` : d.status === 'COMPLETE' ? 'Postseason complete' : 'No game scheduled'}</span></div>
    <div class="po-tile"><small>Last verified</small><b>${relTime(meta?.fetched_at)}</b><span>${d.truth_changed_at ? `Last change ${relTime(d.truth_changed_at)}` : ''}</span></div>
  </div>`;
}

function contextCallout(d) {
  const tbd = (d.rounds || []).flatMap((r) => r.series).filter((s) => s.status === 'TBD').length;
  if (!d.rounds?.length) {
    return html`<div class="callout po-callout">The source has not published a ${d.season} postseason schedule yet. The bracket appears here as soon as it does — nothing is drawn in advance.</div>`;
  }
  if (d.status === 'NOT_STARTED' && tbd) {
    return html`<div class="callout po-callout">ESPN has published the ${d.season} postseason schedule — ${d.provenance?.postseason_game_count ?? 0} games across ${d.rounds.length} rounds — but has not named the matchups. A series appears the moment the source lists both teams; until then every slot stays TBD. The seed table below is the final league standing as published.</div>`;
  }
  if (tbd) return html`<div class="callout po-callout">Later-round slots stay TBD until the source names both teams. PropBetEdge never projects who advances.</div>`;
  return '';
}

function pictureModule(d) {
  const rows = pictureRows(d);
  if (!rows.length) return html`<section class="card po-mod"><div class="card-head"><span class="card-title">Playoff picture</span></div><div class="card-body">${empty('Seeds unavailable', 'The league seed table did not load. Seeds are never guessed from records.')}</div></section>`;
  return html`<section class="card po-mod" id="picture">
    <div class="card-head"><span class="card-title">Playoff picture</span><a class="sec-link" href="/standings">Regular-season standings →</a></div>
    <ol class="po-seeds">
      ${rows.map((t) => html`<li class="po-seed po-seed--${t.key}">
        <span class="po-seed-n">${t.seed ?? '—'}</span>
        <span class="po-seed-m">${teamLogo({ team_id: t.team_id, abbr: t.abbreviation, name: t.team_name }, 26)}</span>
        <a class="po-seed-t" href="/teams/${t.team_id}"><b>${t.team_name}</b><small>${t.wins ?? '—'}-${t.losses ?? '—'}</small></a>
        <span class="po-state po-state--${t.key}" title="${t.clinch_label ? `Source mark: ${t.clinch_code} — ${t.clinch_label}` : 'No clinch mark published'}">${t.state}</span>
      </li>`)}
    </ol>
    <p class="note po-foot">Seeds are the league seed table (ESPN league standings, playoffSeed) and clinch states are the source’s own marks. Active / Out states come only from completed series.</p>
  </section>`;
}

function seriesCenter(d) {
  const rounds = (d.rounds || []).map((r) => ({ r, list: r.series.filter((s) => s.status !== 'TBD') })).filter((x) => x.list.length);
  return html`<section class="po-sec" id="series">
    <div class="sec-head"><h2 class="sec-title">Series center</h2><span class="note">${rounds.reduce((n, x) => n + x.list.length, 0)} series with both teams named</span></div>
    ${rounds.length ? rounds.map(({ r, list }) => html`<div class="po-round"><h3 class="po-round-h">${r.name}${r.best_of ? html` <small>Best of ${r.best_of}</small>` : ''}</h3>
      <div class="po-series-grid">${list.map((s) => seriesCard(s, r, wnbaOpts))}</div></div>`)
      : empty('No series set yet', 'A series appears here once the source names both of its teams.')}
  </section>`;
}

function scheduleModule(d) {
  const games = allGames(d);
  if (!games.length) return '';
  const days = new Map();
  for (const g of games) {
    const k = fmtDateET(g.start_utc, { weekday: 'long', month: 'long', day: 'numeric' });
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(g);
  }
  return html`<section class="po-sec" id="schedule">
    <div class="sec-head"><h2 class="sec-title">Schedule &amp; results</h2><span class="note">${games.length} postseason games from the source schedule · times ET</span></div>
    <div class="card po-sched">
      ${[...days.entries()].map(([day, list]) => html`<div class="po-day"><h3 class="po-day-h">${day}</h3>
        ${list.map((g) => {
          const href = wnbaOpts.gameHref(g);
          const teams = g.away_team && g.home_team
            ? html`<span class="po-g-teams">${teamLogo({ team_id: g.away_team.team_id, abbr: g.away_team.abbreviation, name: g.away_team.team_name }, 20)}<b>${g.away_team.abbreviation}</b>${g.status === 'FINAL' || g.status === 'LIVE' ? html`<span class="po-sc">${g.away_score}</span>` : ''}<span class="po-at">@</span>${teamLogo({ team_id: g.home_team.team_id, abbr: g.home_team.abbreviation, name: g.home_team.team_name }, 20)}<b>${g.home_team.abbreviation}</b>${g.status === 'FINAL' || g.status === 'LIVE' ? html`<span class="po-sc">${g.home_score}</span>` : ''}</span>`
            : html`<span class="po-g-teams po-g-teams--tbd">TBD @ TBD</span>`;
          const right = g.status === 'SCHEDULED' ? (g.time_tbd ? 'Time TBD' : fmtTimeET(g.start_utc)) : gameStatusLabel(g.status);
          const inner = html`<span class="po-g-r">${g.round.name}${g.game_number ? ` · Game ${g.game_number}` : ''}${g.if_necessary && g.status === 'SCHEDULED' ? html` <em>if necessary</em>` : ''}</span>${teams}<span class="po-g-s po-g-s--${String(g.status).toLowerCase()}">${right}</span>`;
          return href ? html`<a class="po-g" href="${href}">${inner}</a>` : html`<div class="po-g">${inner}</div>`;
        })}
      </div>`)}
    </div>
  </section>`;
}

function leadersModule() {
  return html`<section class="card po-mod po-mod--unavail" id="leaders">
    <div class="card-head"><span class="card-title">Postseason leaders</span><span class="badge stale">Not published</span></div>
    <div class="card-body"><p class="note">PropBetEdge has not verified a postseason-only player stat feed yet, so no playoff leaders are shown here — regular-season numbers are never relabelled as playoff numbers. Box scores for every playoff game are in WNBACast.</p></div>
  </section>`;
}

function newsModule(d, arts) {
  const items = arts?.ok ? playoffStories(arts.data?.items || [], d.season) : [];
  return html`<section class="card po-mod" id="news">
    <div class="card-head"><span class="card-title">Playoff news</span><a class="sec-link" href="/news">Newsroom →</a></div>
    <div class="card-body">${!arts?.ok ? html`<p class="note">The newsroom did not answer. No stories are shown in its place.</p>` : items.length ? html`<div class="srows">${items.map(articleRow)}</div>` : html`<p class="note">No playoff stories in the newsroom yet this postseason.</p>`}</div>
  </section>`;
}

function pbeModule(d, cov) {
  const ids = new Set(allGames(d).map((g) => g.game_id));
  const games = cov?.ok ? (cov.data?.games || []).filter((g) => ids.has(String(g.game_id))) : [];
  const byId = new Map(allGames(d).map((g) => [g.game_id, g]));
  const phase = { LOCKED: 'Call locked', PRE_LOCK: 'Scored · locks 15 min before tip', NOT_LOCKED: 'Scored · not locked' };
  return html`<section class="card po-mod" id="pbe">
    <div class="card-head"><span class="card-title">PBE Picks · postseason</span><a class="sec-link" href="/pbe-picks">PBE Picks →</a></div>
    <div class="card-body">
      ${!cov?.ok ? html`<p class="note">PBE coverage is unavailable right now.</p>` : games.length ? html`<ul class="po-pbe">${games.map((g) => { const x = byId.get(String(g.game_id)); return html`<li><a href="/pbe-picks"><b>${x?.away_team?.abbreviation || 'TBD'} @ ${x?.home_team?.abbreviation || 'TBD'}</b><span>${x ? `${x.round.name}${x.game_number ? ` · G${x.game_number}` : ''}` : ''}</span><em>${phase[g.phase] || g.phase}</em></a></li>`; })}</ul>`
        : html`<p class="note">No playoff game is inside the PBE scoring window yet. PBE Picks scores a playoff game once the source names both teams, within ${PBE_POLICY_COPY.scoring_window_hours} hours of tip, and locks the call ${PBE_POLICY_COPY.lock_minutes_before_tip} minutes before tip. Every locked call is graded on the <a href="/track-record">track record</a>.</p>`}
    </div>
  </section>`;
}

export function playoffsView({ res, arts, cov }, { season = null } = {}) {
  if (!res?.ok) {
    const notCaptured = res?.error?.code === 'season_not_captured';
    return html`${playoffsHead()}${notCaptured ? empty(`No ${season || ''} postseason on file`, 'PropBetEdge has no verified bracket for that season.', html`<p><a href="/playoffs">Current playoffs →</a></p>`) : errorState(res, 'The playoff bracket')}
      <p class="note" style="margin-top:12px"><a href="/standings">Regular-season standings →</a></p>`;
  }
  const d = res.data;
  const prior = !d.is_current_season;
  const others = (d.available_seasons || []).filter((y) => Number(y) !== Number(d.season));
  return html`
    <div class="po">
      ${pageHead({
        eyebrow: prior ? `WNBA Playoffs · ${d.season} final` : 'WNBA Playoffs',
        title: prior ? `${d.season} WNBA Playoffs` : 'WNBA Playoffs',
        sub: prior ? `Final ${d.season} bracket. Not the current postseason.` : 'Live bracket + series center',
        right: html`<div class="po-head-r">${statusBadge(d.status === 'COMPLETE' ? 'FINAL' : d.status === 'IN_PROGRESS' ? (allGames(d).some((g) => g.status === 'LIVE') ? 'LIVE' : 'IN_PROGRESS') : 'UPCOMING')}<span class="po-state-l">${STATE_COPY[d.status] || d.status}</span></div>`
      })}
      ${statusTiles(d, res.meta)}
      <div class="po-src">${sourceLine(res.meta, { label: `${d.season} postseason · bracket derived by PropBetEdge from ESPN game records` })}</div>
      ${contextCallout(d)}
      ${d.champion ? html`<div class="po-champ-banner"><span>${d.season} WNBA Champion</span>${teamLogo({ team_id: d.champion.team_id, abbr: d.champion.abbreviation, name: d.champion.team_name }, 40)}<b><a href="/teams/${d.champion.team_id}">${d.champion.team_name}</a></b><em>${d.champion.series_score} over ${d.champion.opponent?.team_name || ''}</em></div>` : ''}
      <section class="po-sec" id="bracket" aria-label="Bracket">${bracketBoard(d, wnbaOpts) || ''}</section>
      <div class="po-grid">
        ${pictureModule(d)}
        <div class="po-side">${pbeModule(d, cov)}${newsModule(d, arts)}${leadersModule()}</div>
      </div>
      ${seriesCenter(d)}
      ${scheduleModule(d)}
      <nav class="po-links" aria-label="Related">
        <a href="/standings">Regular-season standings →</a>
        ${prior ? html`<a href="/playoffs">Current postseason →</a>` : ''}
        ${others.map((y) => html`<a href="/playoffs?season=${y}">${y} playoffs${Number(y) < Number(d.current_season) ? ' (final)' : ''} →</a>`)}
        <a href="/cast">WNBACast →</a>
      </nav>
      <p class="note po-method">Method: every series is built from ESPN postseason game records (round and game number from each game’s note, wins counted from final scores and checked against the source’s own series record). A matchup exists only when the source names both teams. Best-of comes from the published schedule. Seeds are the league seed table. Nothing is projected.</p>
    </div>
  `;
}
