// WNBACast — one route authority for live games, pre-game and replay.
// Everything on screen comes from the published ESPN event stream served by
// wnba-api. Derivations reuse the exact module the Worker uses
// (workers/shared/derive.js), so the page and the API can never disagree.

import { html, render, raw, esc } from '../lib/dom.js';
import { api } from '../data/api.js';
import { createPoller } from '../lib/poller.js';
import { gameState, badge, sourceLine, empty, errorState, skeleton, avatar, safeColor, teamDot, periodName, startFreshTicker } from '../ui/components.js';
import { courtSvg } from '../ui/court.js';
import { teamLogo } from '../ui/logo.js';
import { articleMini } from '../ui/articles.js';
import { marketStrip } from '../ui/components.js';
import { marginChart, progressionChart } from '../ui/charts.js';
import { scoringRuns, leadTracker, foulContext, playerProgression, shotChart } from '../../workers/shared/derive.js';
import { fmtDateET, fmtTimeET, fmtDateTimeET, relTime, american, num } from '../lib/format.js';
import { etCompact, addDays } from '../../workers/shared/time.js';
import { pbpEmphasis } from '../ui/pbp.js';

export const title = (p) => (p.gameId ? 'WNBACast' : 'WNBACast — live WNBA games & replays');
export const description = () => 'WNBACast: live WNBA scoreboard, real play-by-play, published shot locations, scoring runs, box scores and full replays of completed games.';

const PBP_FILTERS = [['all', 'All'], ['scoring', 'Scoring'], ['shots', 'Shots'], ['fouls', 'Fouls'], ['turnovers', 'Turnovers'], ['rebounds', 'Rebounds'], ['subs', 'Subs']];
const EMPH = { 'lead-change': 'Lead change', tie: 'Tie', 'lead-taken': 'Lead' };
const TABS = [['box', 'Box score'], ['players', 'Player progression'], ['fouls', 'Fouls'], ['market', 'Line & market']];

export async function mount(root, ctx) {
  const state = {
    gameId: ctx.params.gameId || null,
    data: null,
    meta: null,
    events: [],
    cursor: null, // replay index (null = latest)
    playing: false,
    pbpFilter: 'all',
    pbpPeriod: 'all',
    pbpScroll: { top: 0, anchor: null, lastSeen: null },
    shotTeam: 'all',
    shotResult: 'all',
    shotPinnedSeq: null,
    animateShotSeq: null,
    tab: 'box',
    progPlayer: null,
    rail: []
  };
  let poller = null;
  let playTimer = null;
  const stopTicker = startFreshTicker(root);

  render(root, html`<div id="rail" class="cast-rail">${skeleton(60)}</div><div id="stage">${skeleton(160)}${skeleton(420)}</div>`);
  const $rail = root.querySelector('#rail');
  const $stage = root.querySelector('#stage');

  // ------------------------------------------------------------ rail
  const today = etCompact();
  const sched = await api.schedule({ from: addDays(today, -21), to: addDays(today, 10) });
  if (!ctx.isCurrent()) return () => {};
  const games = sched.ok ? sched.data.games : [];
  const live = games.filter((g) => g.status?.state === 'in');
  const upcoming = games.filter((g) => g.status?.state === 'pre').sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  const finals = games.filter((g) => g.status?.state === 'post').sort((a, b) => b.start_utc.localeCompare(a.start_utc));
  state.rail = { live, upcoming: upcoming.slice(0, 10), finals: finals.slice(0, 24) };

  if (!state.gameId) {
    const pick = live[0] || upcoming.find((g) => etCompact(new Date(g.start_utc)) === today) || finals[0] || upcoming[0];
    if (!pick) {
      render($stage, empty('No WNBA games to cast', 'The source has no live, upcoming or recent games in range.'));
      renderRail();
      return () => stopTicker();
    }
    state.gameId = pick.game_id;
    history.replaceState({}, '', `/cast/${pick.game_id}`);
  }
  renderRail();

  function railItem(g) {
    const st = gameState(g);
    return html`<a href="/cast/${g.game_id}" aria-current="${g.game_id === state.gameId ? 'true' : 'false'}">
      <div class="r-top"><span>${st.key === 'sched' ? fmtDateET(g.start_utc, { month: 'short', day: 'numeric' }) : st.label}</span><span>${st.key === 'sched' ? fmtTimeET(g.start_utc) : fmtDateET(g.start_utc, { month: 'short', day: 'numeric' })}</span></div>
      <div class="r-row"><span style="display:inline-flex;gap:6px;align-items:center">${teamLogo(g.away, 16)}${g.away?.abbr}</span><span>${g.status?.state === 'pre' ? '' : g.away?.score ?? ''}</span></div>
      <div class="r-row"><span style="display:inline-flex;gap:6px;align-items:center">${teamLogo(g.home, 16)}${g.home?.abbr}</span><span>${g.status?.state === 'pre' ? '' : g.home?.score ?? ''}</span></div>
    </a>`;
  }
  function renderRail() {
    const r = state.rail;
    render($rail, html`
      ${r.live?.length ? html`<span class="cast-rail-group">LIVE</span>${r.live.map(railItem)}` : ''}
      ${r.upcoming?.length ? html`<span class="cast-rail-group">NEXT</span>${r.upcoming.map(railItem)}` : ''}
      ${r.finals?.length ? html`<span class="cast-rail-group">REPLAY</span>${r.finals.map(railItem)}` : ''}
    `);
    const cur = $rail.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  let gameArticles = null;
  api.articles({ game: state.gameId, limit: 4 }).then((r) => { gameArticles = r.ok ? r.data.items : []; if (state.data && ctx.isCurrent()) draw(); });

  // ------------------------------------------------------------ data
  async function load() {
    const since = state.data?.game?.status?.state === 'in' && state.events.length ? state.events.at(-1).seq : undefined;
    const res = await api.live(state.gameId, since, { fresh: true });
    if (!ctx.isCurrent()) return;
    if (!res.ok) {
      if (!state.data) render($stage, errorState(res, 'This game'));
      else state.meta = { ...(state.meta || {}), freshness: 'STALE' };
      return;
    }
    const d = res.data;
    // Guard against our own past: never step a live stream backwards.
    if (state.data && d.last_seq !== null && state.events.length && d.last_seq < state.events.at(-1).seq) return;
    const prevLast = state.events.at(-1)?.seq ?? 0;
    if (since !== undefined) {
      const bySeq = new Map(state.events.map((e) => [e.seq, e]));
      for (const e of d.events) bySeq.set(e.seq, e);
      state.events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    } else {
      state.events = d.events;
    }
    state.newFrom = since !== undefined ? prevLast : null;
    state.animateShotSeq = since !== undefined
      ? ([...d.events].reverse().find((e) => e.shooting && e.coordinate)?.seq ?? null)
      : null;
    state.data = d;
    state.meta = res.meta;
    const s = d.game.status?.state;
    poller?.setInterval(s === 'in' ? 8000 : s === 'pre' ? 60000 : 0);
    if (s === 'post' && state.cursor === null) state.cursor = state.events.length - 1;
    draw();
  }

  // ------------------------------------------------------------ derived at cursor
  function view() {
    const d = state.data;
    const g = d.game;
    const replay = g.status?.state === 'post';
    const idx = replay && state.cursor !== null ? state.cursor : state.events.length - 1;
    const evs = state.events.slice(0, idx + 1);
    const atEnd = idx >= state.events.length - 1;
    const last = evs.at(-1) || null;
    const scored = [...evs].reverse().find((e) => e.home_score !== null && e.away_score !== null);
    const score = replay && !atEnd && scored ? { home: scored.home_score, away: scored.away_score } : { home: g.home?.score, away: g.away?.score };
    return {
      g,
      replay,
      atEnd,
      idx,
      evs,
      last,
      score,
      runs: scoringRuns(evs),
      lead: leadTracker(evs),
      fouls: foulContext(evs, atEnd ? d.box : null),
      prog: playerProgression(evs),
      shots: shotChart(evs),
      linescore: linescoreAt(evs, g, atEnd)
    };
  }

  function linescoreAt(evs, g, atEnd) {
    if (atEnd) return (g.home?.linescores || []).map((h, i) => ({ period: i + 1, home: h, away: g.away?.linescores?.[i] ?? null }));
    const out = [];
    let ph = 0;
    let pa = 0;
    let cur = null;
    for (const e of evs) {
      if (e.home_score === null) continue;
      if (!cur || e.period !== cur.period) { if (cur) { ph = cur.h; pa = cur.a; } cur = { period: e.period, h: e.home_score, a: e.away_score }; out[e.period - 1] = { period: e.period, home: 0, away: 0 }; }
      cur.h = e.home_score; cur.a = e.away_score;
      out[e.period - 1] = { period: e.period, home: e.home_score - ph, away: e.away_score - pa };
    }
    return out.filter(Boolean);
  }

  // ------------------------------------------------------------ render
  function draw() {
    const v = view();
    const { g } = v;
    const st = gameState(g, { replay: v.replay });
    const home = g.home;
    const away = g.away;
    ctx.setMeta({ title: `${away?.abbr} @ ${home?.abbr} · WNBACast`, description: `WNBACast for ${away?.name} at ${home?.name}, ${fmtDateET(g.start_utc, { month: 'long', day: 'numeric', year: 'numeric' })}: real play-by-play, shots, runs and box score.` });

    const periodLbl = v.replay && !v.atEnd && v.last ? `${periodName(v.last.period)} ${v.last.clock}` : st.label;
    const homeLost = g.status?.state === 'post' && v.atEnd && home.score < away.score;
    const awayLost = g.status?.state === 'post' && v.atEnd && away.score < home.score;
    const sem = state.meta?.semantics;
    const semLabel = sem === 'LIVE_SOURCE' ? 'Live source · ESPN play-by-play' : sem === 'FINAL_PERSISTED_ARCHIVE' ? 'Replay · PropBetEdge archive of the published event stream' : sem === 'FINAL_PROVIDER_ARCHIVE' ? 'Replay · provider event stream (archive pending)' : sem === 'SCHEDULED' ? 'Pre-game' : sem;

    render($stage, html`
      <section class="card card-pad" style="margin-bottom:16px;overflow:hidden;background:linear-gradient(115deg,rgba(240,179,35,.13),rgba(239,118,34,.05) 48%,rgba(18,17,14,.94));border-color:rgba(240,179,35,.28)" aria-labelledby="wnbacast-title">
        <div style="display:flex;gap:24px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div style="flex:1 1 520px">
            <span class="eyebrow">WNBACast · Live game intelligence</span>
            <h1 id="wnbacast-title" style="margin:10px 0 8px;font-size:clamp(1.65rem,4vw,2.7rem);line-height:.98">Every possession. Play by play.</h1>
            <p style="max-width:720px;color:var(--paper-2);font-size:1rem;line-height:1.55">Follow the game as it happens with an automatically updating event feed, live score, published shot locations, scoring runs and box-score context. No refresh needed.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;flex:0 1 430px;justify-content:flex-end">
            ${badge(g.status?.state === 'in' ? 'live' : 'sched', g.status?.state === 'in' ? 'Updates every 8 seconds' : g.status?.state === 'post' ? 'Full game replay' : 'Starts automatically at tip')}
            <span class="pill" style="cursor:default">Real play-by-play</span>
            <span class="pill" style="cursor:default">Shot chart + game flow</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="score-hdr">
          <div class="sh-team away ${awayLost ? 'lost' : ''}">
            ${teamLogo(away, 64)}
            <div class="nm"><b>${away?.name}</b><small>${away?.abbr}${away?.record ? ` · ${away.record}` : ''}${away?.possession ? html` · <span class="poss">POSSESSION (ESPN)</span>` : ''}</small></div>
            <span class="sc">${g.status?.state === 'pre' ? '' : v.score.away ?? ''}</span>
          </div>
          <div class="sh-mid">
            ${badge(st.key, g.status?.state === 'pre' ? 'Scheduled' : v.replay ? 'Replay' : st.label)}
            <span class="clock">${g.status?.state === 'pre' ? `${fmtDateET(g.start_utc, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeET(g.start_utc)}` : periodLbl}</span>
            <span class="note">${g.venue?.name || ''}</span>
          </div>
          <div class="sh-team home ${homeLost ? 'lost' : ''}">
            ${teamLogo(home, 64)}
            <div class="nm"><b>${home?.name}</b><small>${home?.abbr}${home?.record ? ` · ${home.record}` : ''}${home?.possession ? html` · <span class="poss">POSSESSION (ESPN)</span>` : ''}</small></div>
            <span class="sc">${g.status?.state === 'pre' ? '' : v.score.home ?? ''}</span>
          </div>
        </div>
        ${v.linescore.length ? html`<div class="tbl-wrap" style="border-top:1px solid var(--line)"><table class="tbl linescore"><thead><tr><th>Team</th>${v.linescore.map((l) => html`<th>${periodName(l.period)}</th>`)}<th>T</th></tr></thead><tbody>
          <tr><td>${away?.abbr}</td>${v.linescore.map((l) => html`<td>${l.away ?? ''}</td>`)}<td class="hi">${v.score.away ?? ''}</td></tr>
          <tr><td>${home?.abbr}</td>${v.linescore.map((l) => html`<td>${l.home ?? ''}</td>`)}<td class="hi">${v.score.home ?? ''}</td></tr>
        </tbody></table></div>` : ''}
        <div class="card-body" style="padding-top:10px;padding-bottom:12px">${sourceLine(state.meta, { label: semLabel })}</div>
      </section>

      ${v.replay ? html`<section class="card replay-bar" style="margin-top:12px" aria-label="Replay controls">
        <button class="rb-btn play" type="button" data-play aria-label="${state.playing ? 'Pause replay' : 'Play replay'}">${state.playing ? '❚❚' : '▶'}</button>
        <button class="rb-btn" type="button" data-restart aria-label="Restart replay">↺</button>
        <input type="range" min="0" max="${state.events.length - 1}" value="${v.idx}" data-scrub aria-label="Replay position" />
        <span class="pos">${v.last ? `${periodName(v.last.period)} ${v.last.clock}` : ''} · play ${v.idx + 1}/${state.events.length}</span>
      </section>` : ''}

      ${g.status?.state === 'pre' ? preGame(g) : liveBody(v)}
    `);
    bind();
  }

  function preGame(g) {
    const d = state.data;
    return html`<div class="grid g2" style="margin-top:16px">
      <section class="card card-pad">
        <span class="eyebrow">Pre-game</span>
        <p style="margin-top:10px;color:var(--paper-2)">Tip-off ${fmtDateTimeET(g.start_utc)}. WNBACast switches to the live event stream automatically at tip — no refresh needed.</p>
        <div class="actions" style="margin-top:14px">
          <a class="action" href="/matchups/${g.game_id}"><span><b>Full matchup research</b><small>Pace, form, rest, observed rotations, availability</small></span><span class="arrow">→</span></a>
          <a class="action" href="/props"><span><b>Best line board</b><small>Sportsbook prices vs. no-vig market consensus</small></span><span class="arrow">→</span></a>
        </div>
      </section>
      <section class="card card-pad">
        <span class="eyebrow">Availability for this game</span>
        ${(d.injuries || []).flatMap((t) => t.items.map((i) => ({ ...i, team_id: t.team_id }))).length
          ? html`<div style="margin-top:8px">${(d.injuries || []).flatMap((t) => t.items.map((i) => html`<div class="change-row">${avatar({ name: i.name })}<div><a href="/players/${i.athlete_id}"><b>${i.name}</b></a><div class="note">${[i.type, i.side].filter(Boolean).join(', ')}</div></div>${badge(/out/i.test(i.status || '') ? 'out' : 'dtd', i.status || '—')}</div>`))}</div>
            <p class="note" style="margin-top:8px">Statuses from ESPN's injury feed.</p>`
          : html`<p class="note" style="margin-top:8px">No players listed for either team in this game's source record.</p>`}
      </section>
    </div>`;
  }

  function liveBody(v) {
    const d = state.data;
    const g = v.g;
    const teamOf = (id) => (id === g.home?.team_id ? g.home : id === g.away?.team_id ? g.away : null);
    const plays = [...v.evs].reverse().filter((e) => {
      const f = state.pbpFilter;
      if (state.pbpPeriod !== 'all' && String(e.period) !== state.pbpPeriod) return false;
      // Canonical play families (workers/shared/pbp.js), with the provider type as the fallback for older payloads.
      if (f === 'scoring') return e.scoring;
      if (f === 'shots') return e.shooting;
      if (f === 'fouls') return e.family ? e.family === 'foul' : /foul/i.test(e.type || '');
      if (f === 'turnovers') return e.family ? e.family === 'turnover' : /turnover/i.test(e.type || '');
      if (f === 'rebounds') return e.family ? e.family === 'rebound' : /rebound/i.test(e.type || '');
      if (f === 'subs') return e.family ? e.family === 'substitution' : /substitution/i.test(e.type || '');
      return true;
    }).slice(0, 400);
    const periodsSeen = [...new Set(v.evs.map((e) => e.period).filter(Number.isFinite))];
    const shots = v.shots.shots.filter((s) =>
      (state.shotTeam === 'all' || s.team_id === state.shotTeam)
      && (state.shotResult === 'all' || (state.shotResult === 'made' ? s.made === true : s.made === false))
    );
    const lastShotSeq = shots.at(-1)?.seq ?? null;
    const madeBy = (tid) => {
      const xs = v.shots.shots.filter((s) => s.team_id === tid);
      return { m: xs.filter((s) => s.made).length, a: xs.length };
    };
    const ha = madeBy(g.home?.team_id);
    const aa = madeBy(g.away?.team_id);

    return html`
      <div class="cast-grid" style="margin-top:16px">
        <section class="card">
          <div class="card-head"><span class="card-title">Play-by-play</span><span class="note">${v.evs.length} events</span></div>
          <div class="card-body" style="padding-bottom:8px"><div class="pbp-controls"><label class="pbp-select"><span class="sr-only">Show</span><select data-pbp-filter aria-label="Filter plays">${PBP_FILTERS.map(([k, l]) => html`<option value="${k}" ${state.pbpFilter === k ? 'selected' : ''}>${l}</option>`)}</select></label><label class="pbp-select"><span class="sr-only">Period</span><select data-pbp-period aria-label="Filter by period"><option value="all">All periods</option>${periodsSeen.map((n) => html`<option value="${n}" ${state.pbpPeriod === String(n) ? 'selected' : ''}>${periodName(n)}</option>`)}</select></label><button class="pbp-latest" type="button" data-pbp-latest hidden>Jump to latest ↑</button></div></div>
          <div class="pbp" data-pbp-list role="log" aria-live="${g.status?.state === 'in' ? 'polite' : 'off'}">
            ${plays.length ? plays.map((e) => {
              const t = teamOf(e.team_id);
              const isNew = state.newFrom !== null && e.seq > state.newFrom;
              const emph = pbpEmphasis(e);
              const tags = emph.filter((x) => EMPH[x]);
              const nm = e.primary?.name && e.primary?.id && (e.text || '').startsWith(e.primary.name) ? e.primary : null;
              return html`<div class="pbp-row ${e.scoring ? 'score' : ''} ${emph.join(' ')} ${isNew ? 'new' : ''}" data-seq="${e.seq}">
                <span class="t">${periodName(e.period)} ${e.clock ?? ''}</span>
                <span class="bar" style="background:${t ? safeColor(t.color, 'var(--ink-4)') : 'transparent'}"></span>
                <span class="txt">${nm ? html`<a class="pbp-name" href="/players/${nm.id}">${nm.name}</a>${e.text.slice(nm.name.length)}` : e.text}${tags.length ? html` <span class="pbp-tag">${tags.map((x) => EMPH[x]).join(' · ')}</span>` : ''}</span>
                <span class="s">${e.home_score !== null ? `${e.away_score}–${e.home_score}` : ''}</span>
              </div>`;
            }) : html`<p class="note" style="padding:14px">No events match this filter yet.</p>`}
          </div>
        </section>

        <div class="grid" style="gap:16px">
          <section class="card">
            <div class="card-head shot-chart-head">
              <div>
                <span class="card-title">Shot chart</span>
                <span class="note shot-chart-hint">Hover, focus or tap a shot to inspect the play.</span>
              </div>
              <div class="shot-chart-controls" aria-label="Shot chart filters">
                <div class="pill-row">
                  <button class="pill" type="button" data-shot="all" aria-pressed="${state.shotTeam === 'all'}">Both</button>
                  <button class="pill" type="button" data-shot="${g.away?.team_id}" aria-pressed="${state.shotTeam === g.away?.team_id}">${g.away?.abbr}</button>
                  <button class="pill" type="button" data-shot="${g.home?.team_id}" aria-pressed="${state.shotTeam === g.home?.team_id}">${g.home?.abbr}</button>
                </div>
                <div class="pill-row shot-result-row">
                  <button class="pill" type="button" data-shot-result="all" aria-pressed="${state.shotResult === 'all'}">All</button>
                  <button class="pill" type="button" data-shot-result="made" aria-pressed="${state.shotResult === 'made'}">Makes</button>
                  <button class="pill" type="button" data-shot-result="missed" aria-pressed="${state.shotResult === 'missed'}">Misses</button>
                </div>
              </div>
            </div>
            <div class="card-body">
              <div class="court-shell" data-court-shell>
                <div class="court-wrap">${raw(courtSvg(shots, {
                  home: g.home,
                  away: g.away,
                  highlightSeq: lastShotSeq,
                  animateSeq: state.animateShotSeq
                }))}</div>
                <aside class="shot-tooltip" data-shot-tooltip hidden aria-live="polite">
                  <button class="shot-tooltip-close" type="button" data-shot-tip-close aria-label="Close shot details">×</button>
                  <span class="shot-tooltip-kicker" data-shot-tip-kicker></span>
                  <strong data-shot-tip-player></strong>
                  <span class="shot-tooltip-meta" data-shot-tip-meta></span>
                  <p data-shot-tip-text></p>
                  <span class="shot-tooltip-score" data-shot-tip-score></span>
                </aside>
              </div>
              <div class="legend shot-chart-legend" style="margin-top:10px">
                <span><i style="background:var(--away)"></i>${g.away?.abbr} ${aa.m}/${aa.a}</span>
                <span><i style="background:var(--home)"></i>${g.home?.abbr} ${ha.m}/${ha.a}</span>
                <span>● made · ✕ missed</span>
                ${lastShotSeq !== null ? html`<span class="shot-latest-key"><i></i>Latest visible shot</span>` : ''}
              </div>
              <p class="note" style="margin-top:8px">${shots.length} visible · ${v.shots.plotted} of ${v.shots.total_fga} field-goal attempts carry a published location and are plotted. ${v.shots.unplotted ? `${v.shots.unplotted} without a location are counted, not placed.` : 'Free throws have no location and are not drawn.'} Both teams are shown on one basket, as ESPN publishes them.</p>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><span class="card-title">Game flow</span>${v.lead ? html`<span class="note">${v.lead.lead_changes} lead changes · ${v.lead.ties} ties</span>` : ''}</div>
            <div class="card-body">
              ${v.lead?.margin_timeline?.length ? raw(marginChart(v.lead.margin_timeline, { home: g.home, away: g.away, periods: Math.max(4, v.last?.period || 4) })) : html`<p class="note">Flow appears after the first score.</p>`}
              ${v.lead ? html`<div class="tiles" style="margin-top:12px">
                <div class="tile"><small>${g.away?.abbr} largest lead</small><b>${v.lead.largest_lead.away.margin}</b><span>${v.lead.largest_lead.away.at || '—'}</span></div>
                <div class="tile"><small>${g.home?.abbr} largest lead</small><b>${v.lead.largest_lead.home.margin}</b><span>${v.lead.largest_lead.home.at || '—'}</span></div>
              </div>` : ''}
              ${v.runs ? html`<div class="run-list" style="margin-top:14px">
                <span class="card-title" style="margin-bottom:4px">Scoring runs</span>
                ${v.runs.current ? html`<div class="run"><b style="color:${safeColor(teamOf(v.runs.current.team_id)?.color, 'var(--gold)')}">${v.runs.current.points}-0</b><span>${teamOf(v.runs.current.team_id)?.abbr} ${v.g.status?.state === 'in' ? 'current run' : v.atEnd ? 'closing run' : 'run at this point'}</span><span class="note">${v.runs.current.from} → ${v.runs.current.to}</span></div>` : ''}
                ${Object.values(v.runs.largest).map((r) => html`<div class="run"><b>${r.points}-0</b><span>${teamOf(r.team_id)?.abbr} largest run</span><span class="note">${r.from} → ${r.to}</span></div>`)}
              </div><p class="note" style="margin-top:8px">${v.runs.method}</p>` : ''}
            </div>
          </section>
        </div>
      </div>

      <section class="card" style="margin-top:16px">
        <div class="tabs" role="tablist" style="padding:0 8px;margin-bottom:0">${TABS.map(([k, l]) => html`<button type="button" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}</button>`)}</div>
        <div class="card-body">${tabBody(v)}</div>
      </section>
      ${gameArticles?.length ? html`<section class="card" style="margin-top:16px"><div class="card-head"><span class="card-title">PBE Newsroom on this game</span><a class="sec-link" href="/matchups/${g.game_id}">Matchup →</a></div><div class="card-body">${articleMini(gameArticles)}</div></section>` : ''}
    `;
  }

  function tabBody(v) {
    const d = state.data;
    const g = v.g;
    if (state.tab === 'box') return boxScore(d, g, v);
    if (state.tab === 'players') return progression(d, g, v);
    if (state.tab === 'fouls') return foulsTab(d, g, v);
    return marketTab(d, g);
  }

  function boxScore(d, g, v) {
    const teams = [g.away, g.home];
    const note = v.replay && !v.atEnd ? html`<p class="callout" style="margin-bottom:12px">Box score shows the <b>final</b> line. The replay cursor drives the score, shots, flow and progression — not these totals.</p>` : '';
    return html`${note}${teams.map((t) => {
      const rows = d.box.players.filter((r) => r.team_id === t?.team_id);
      return html`<div style="margin-bottom:18px"><div class="sec-head"><h3 class="sec-title" style="display:flex;gap:8px;align-items:center">${teamDot(t)}${t?.name}</h3></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3PT</th><th>FT</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>+/-</th></tr></thead><tbody>
        ${rows.map((r, i) => html`<tr class="${i === 5 && rows[4]?.starter && !r.starter ? 'sep' : ''}"><td><a class="pname" href="/players/${r.athlete_id}">${r.name}${r.starter ? html`<span class="note"> · S</span>` : ''}</a></td>
          ${r.dnp ? html`<td colspan="12" class="l note">DNP${r.dnp_reason ? ` — ${r.dnp_reason}` : ''}</td>` : html`<td>${r.min ?? '—'}</td><td class="hi">${r.pts ?? '—'}</td><td>${r.reb ?? '—'}</td><td>${r.ast ?? '—'}</td><td>${r.fgm ?? '—'}-${r.fga ?? '—'}</td><td>${r.fg3m ?? '—'}-${r.fg3a ?? '—'}</td><td>${r.ftm ?? '—'}-${r.fta ?? '—'}</td><td>${r.stl ?? '—'}</td><td>${r.blk ?? '—'}</td><td>${r.tov ?? '—'}</td><td>${r.pf ?? '—'}</td><td>${r.plus_minus ?? '—'}</td>`}</tr>`)}
        </tbody></table></div></div>`;
    })}<p class="note">Box score as published by ESPN.</p>`;
  }

  function progression(d, g, v) {
    const players = d.box.players.filter((r) => !r.dnp && (r.min ?? 0) > 0).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
    if (!state.progPlayer && players[0]) state.progPlayer = players[0].athlete_id;
    const s = v.prog?.series?.[state.progPlayer];
    const p = players.find((x) => x.athlete_id === state.progPlayer);
    const maxT = Math.max(2400, v.evs.at(-1)?.elapsed_s || 0);
    return html`<div class="controls"><select class="select" data-prog aria-label="Player">${players.map((x) => html`<option value="${x.athlete_id}" ${x.athlete_id === state.progPlayer ? raw('selected') : ''}>${x.name} (${(x.team_id === g.home?.team_id ? g.home : g.away)?.abbr})</option>`)}</select></div>
      ${s ? raw(progressionChart([s.pts, s.reb, s.ast], { maxT, labels: ['PTS', 'REB', 'AST'] })) : html`<p class="note">No credited events for this player yet.</p>`}
      <p class="note" style="margin-top:10px">${v.prog?.method || ''}${p && v.atEnd ? ` Final box: ${p.pts} PTS · ${p.reb} REB · ${p.ast} AST.` : ''}</p>`;
  }

  function foulsTab(d, g, v) {
    const f = v.fouls;
    if (!f) return html`<p class="note">No fouls recorded yet.</p>`;
    const periods = Math.max(4, v.last?.period || 4);
    const row = (t) => html`<tr><td>${t?.abbr}</td>${Array.from({ length: periods }, (_, i) => html`<td>${f.team_fouls_by_period[`${t?.team_id}:${i + 1}`] ?? 0}${f.offensive_fouls_by_period[`${t?.team_id}:${i + 1}`] ? html`<span class="note"> +${f.offensive_fouls_by_period[`${t?.team_id}:${i + 1}`]} off</span>` : ''}</td>`)}</tr>`;
    return html`<div class="tbl-wrap"><table class="tbl linescore"><thead><tr><th>Team fouls</th>${Array.from({ length: periods }, (_, i) => html`<th>${periodName(i + 1)}</th>`)}</tr></thead><tbody>${row(g.away)}${row(g.home)}</tbody></table></div>
      ${f.foul_trouble?.length ? html`<div style="margin-top:14px"><span class="card-title">Foul trouble (4+ personal fouls)</span>${f.foul_trouble.map((p) => html`<div class="change-row">${avatar({ name: p.name })}<div><b>${p.name}</b><div class="note">${(p.team_id === g.home?.team_id ? g.home : g.away)?.abbr}</div></div>${badge(p.fouled_out ? 'out' : 'dtd', p.fouled_out ? 'Fouled out' : `${p.pf} PF`)}</div>`)}</div>` : ''}
      <p class="note" style="margin-top:10px">${f.method}</p>`;
  }

  function marketTab(d, g) {
    const pc = d.pickcenter || [];
    return html`${d.market ? html`<div style="margin-bottom:16px"><span class="card-title">PropBetEdge stored snapshot${d.market.semantics === 'LAST_PRE_TIP_SNAPSHOT' ? ' · last pre-tip capture' : ''}</span><div style="margin-top:10px">${marketStrip(d.market, g)}</div></div>` : html`<p class="note" style="margin-bottom:12px">No PropBetEdge market capture for this game (captures began September 11, 2026; they run at 8:00, 1:00 and 6:00 ET).</p>`}${pc.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Line (external)</th><th>Spread</th><th>Total</th><th>${g.away?.abbr} ML</th><th>${g.home?.abbr} ML</th></tr></thead><tbody>
      ${pc.map((o) => html`<tr><td>${o.provider} via ESPN</td><td>${o.details || '—'}</td><td>${o.over_under ?? '—'}</td><td>${american(o.away_moneyline)}</td><td>${american(o.home_moneyline)}</td></tr>`)}
      </tbody></table></div><p class="note" style="margin-top:8px">A single sportsbook's line relayed by ESPN. It is not a PropBetEdge price, consensus or model.</p>` : html`<p class="note">No line published for this game in the source record.</p>`}
      <div class="callout" style="margin-top:14px">PropBetEdge fair value: <b>not published</b>. No validated WNBA model exists yet, so there is no model line or edge here — by design.</div>
      <p style="margin-top:12px"><a class="sec-link" href="/props">Open the best-line board →</a></p>`;
  }

  // ------------------------------------------------------------ events
  function bind() {
    const fSel = $stage.querySelector('[data-pbp-filter]');
    if (fSel) fSel.addEventListener('change', () => { state.pbpFilter = fSel.value; state.newFrom = null; state.pbpScroll = { top: 0, anchor: null, lastSeen: null }; draw(); });
    const pSel = $stage.querySelector('[data-pbp-period]');
    if (pSel) pSel.addEventListener('change', () => { state.pbpPeriod = pSel.value; state.newFrom = null; state.pbpScroll = { top: 0, anchor: null, lastSeen: null }; draw(); });
    // Live follow: a reader scrolled back through the feed keeps the same play in view across polls (anchored by
    // sequence); newer plays are offered with "Jump to latest" instead of moving the list.
    const list = $stage.querySelector('[data-pbp-list]');
    const latest = $stage.querySelector('[data-pbp-latest]');
    if (list) {
      const rows = [...list.querySelectorAll('[data-seq]')];
      const newest = Number(rows[0]?.dataset.seq || 0);
      const sc = state.pbpScroll;
      if (sc.top > 40 && sc.anchor) {
        const row = rows.find((r) => r.dataset.seq === sc.anchor.seq);
        if (row) list.scrollTop = row.offsetTop - list.offsetTop + sc.anchor.delta;
        if (sc.lastSeen && newest > sc.lastSeen && latest) latest.hidden = false;
      } else sc.lastSeen = newest;
      list.addEventListener('scroll', () => {
        sc.top = list.scrollTop;
        const row = rows.find((r) => r.offsetTop - list.offsetTop + r.offsetHeight > list.scrollTop);
        sc.anchor = row ? { seq: row.dataset.seq, delta: list.scrollTop - (row.offsetTop - list.offsetTop) } : null;
        if (list.scrollTop <= 40) { sc.lastSeen = newest; if (latest) latest.hidden = true; }
      }, { passive: true });
      if (latest) latest.addEventListener('click', () => { list.scrollTop = 0; sc.top = 0; sc.anchor = null; sc.lastSeen = newest; latest.hidden = true; });
    }
    $stage.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', () => {
      state.shotTeam = b.dataset.shot;
      state.shotPinnedSeq = null;
      state.animateShotSeq = null;
      state.newFrom = null;
      draw();
    }));
    $stage.querySelectorAll('[data-shot-result]').forEach((b) => b.addEventListener('click', () => {
      state.shotResult = b.dataset.shotResult;
      state.shotPinnedSeq = null;
      state.animateShotSeq = null;
      state.newFrom = null;
      draw();
    }));
    bindShotChart();
    $stage.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; state.newFrom = null; draw(); }));
    const sel = $stage.querySelector('[data-prog]');
    if (sel) sel.addEventListener('change', () => { state.progPlayer = sel.value; draw(); });
    const scrub = $stage.querySelector('[data-scrub]');
    if (scrub) scrub.addEventListener('input', () => { stopPlay(); state.cursor = Number(scrub.value); state.newFrom = null; draw(); });
    const play = $stage.querySelector('[data-play]');
    if (play) play.addEventListener('click', () => (state.playing ? stopPlay() : startPlay()) || draw());
    const restart = $stage.querySelector('[data-restart]');
    if (restart) restart.addEventListener('click', () => { state.cursor = 0; startPlay(); draw(); });
  }
  function bindShotChart() {
    const shell = $stage.querySelector('[data-court-shell]');
    const tip = shell?.querySelector('[data-shot-tooltip]');
    if (!shell || !tip) return;
    const points = [...shell.querySelectorAll('[data-shot-point]')];
    const close = tip.querySelector('[data-shot-tip-close]');
    const kicker = tip.querySelector('[data-shot-tip-kicker]');
    const player = tip.querySelector('[data-shot-tip-player]');
    const meta = tip.querySelector('[data-shot-tip-meta]');
    const text = tip.querySelector('[data-shot-tip-text]');
    const score = tip.querySelector('[data-shot-tip-score]');

    const pointForPinned = () => points.find((p) => String(p.dataset.shotSeq) === String(state.shotPinnedSeq));
    const place = (point) => {
      const sr = shell.getBoundingClientRect();
      const pr = point.getBoundingClientRect();
      const cx = pr.left + pr.width / 2 - sr.left;
      const cy = pr.top + pr.height / 2 - sr.top;
      tip.hidden = false;
      tip.style.visibility = 'hidden';
      tip.style.left = '0px';
      tip.style.top = '0px';
      const w = tip.offsetWidth || 250;
      const h = tip.offsetHeight || 120;
      const x = Math.max(w / 2 + 8, Math.min(shell.clientWidth - w / 2 - 8, cx));
      const above = cy - h - 14 >= 6;
      tip.style.left = `${x}px`;
      tip.style.top = `${above ? cy - h - 12 : cy + 12}px`;
      tip.style.visibility = '';
    };
    const show = (point, { pinned = false } = {}) => {
      if (!point) return;
      const d = point.dataset;
      kicker.textContent = [d.shotResult, d.shotType].filter(Boolean).join(' · ');
      player.textContent = [d.shotPlayer, d.shotTeam].filter(Boolean).join(' · ') || 'Shot';
      meta.textContent = [d.shotPeriod, d.shotClock].filter(Boolean).join(' · ');
      text.textContent = d.shotText || 'Play description unavailable.';
      score.textContent = d.shotScore ? `Score after play · ${d.shotScore}` : '';
      tip.dataset.pinned = pinned ? 'true' : 'false';
      points.forEach((p) => p.classList.toggle('is-selected', p === point));
      place(point);
    };
    const hide = ({ keepPinned = true } = {}) => {
      const pinned = keepPinned ? pointForPinned() : null;
      if (pinned) return show(pinned, { pinned: true });
      tip.hidden = true;
      tip.dataset.pinned = 'false';
      points.forEach((p) => p.classList.remove('is-selected'));
    };
    const togglePin = (point) => {
      const seq = Number(point.dataset.shotSeq);
      if (state.shotPinnedSeq === seq) {
        state.shotPinnedSeq = null;
        hide({ keepPinned: false });
      } else {
        state.shotPinnedSeq = seq;
        show(point, { pinned: true });
      }
    };

    for (const point of points) {
      point.addEventListener('mouseenter', () => show(point, { pinned: state.shotPinnedSeq === Number(point.dataset.shotSeq) }));
      point.addEventListener('mouseleave', () => hide());
      point.addEventListener('focus', () => show(point, { pinned: state.shotPinnedSeq === Number(point.dataset.shotSeq) }));
      point.addEventListener('blur', () => hide());
      point.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePin(point); });
      point.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(point); }
        if (e.key === 'Escape') { state.shotPinnedSeq = null; hide({ keepPinned: false }); point.blur(); }
      });
    }
    close?.addEventListener('click', () => { state.shotPinnedSeq = null; hide({ keepPinned: false }); });
    shell.addEventListener('click', (e) => {
      if (!e.target.closest('[data-shot-point]') && !e.target.closest('[data-shot-tooltip]')) {
        state.shotPinnedSeq = null;
        hide({ keepPinned: false });
      }
    });
    const pinned = pointForPinned();
    if (pinned) show(pinned, { pinned: true });
  }

  function startPlay() {
    stopPlay();
    if (state.cursor === null || state.cursor >= state.events.length - 1) state.cursor = 0;
    state.playing = true;
    playTimer = setInterval(() => {
      if (!ctx.isCurrent()) return stopPlay();
      state.cursor = Math.min(state.events.length - 1, state.cursor + 1);
      state.newFrom = null;
      if (state.cursor >= state.events.length - 1) stopPlay();
      draw();
    }, 450);
  }
  function stopPlay() {
    state.playing = false;
    clearInterval(playTimer);
    playTimer = null;
  }

  poller = createPoller(load, { intervalMs: 8000 });
  return () => { poller?.stop(); stopPlay(); stopTicker(); };
}
