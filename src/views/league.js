// League surfaces — injuries, standings, teams, players, stats. Shared by the SPA pages and the wnba-web
// publishing Worker. Interactive pages (filters, sorting, tabs) render their full default list here so the
// first HTTP response carries every row; the SPA re-draws the same list when a reader filters it.
import { html } from '../lib/dom.js';
import { pageHead, sourceLine, errorState, avatar, statusBadge, empty, teamDot, badge, playerCard, safeColor } from '../ui/components.js';
import { fmtDateET, fmtDateTimeET, relTime, num, signed } from '../lib/format.js';
import { teamLogo } from '../ui/logo.js';

// ------------------------------------------------------------ injuries

export const injuriesHead = () => pageHead({ eyebrow: 'Availability desk', title: 'Injuries' });
export const loadInjuries = async (api) => { const [res, teams] = await Promise.all([api.injuries(), api.teams()]); return { res, teams }; };
export const teamIndex = (teams) => new Map((teams?.ok ? teams.data.teams : []).map((t) => [t.team_id, t]));

export function injuryList(items, tIdx, meta, state = { team: '', status: '' }) {
  const list = items.filter((i) => (!state.team || i.team_id === state.team) && (!state.status || new RegExp(state.status, 'i').test(i.status || '')));
  const byTeam = new Map();
  for (const i of list) { if (!byTeam.has(i.team_id)) byTeam.set(i.team_id, []); byTeam.get(i.team_id).push(i); }
  return list.length ? html`${[...byTeam.entries()].map(([tid, rows]) => {
    const t = tIdx.get(tid) || { name: rows[0].team_name };
    return html`<div style="margin-bottom:10px"><div class="sec-head" style="margin:8px 0 0"><h3 class="sec-title" style="display:flex;gap:8px;align-items:center">${teamDot(t)}${t.name}</h3><a class="sec-link" href="/teams/${tid}">Team →</a></div>
      ${rows.map((i) => html`<div class="inj-row">
        ${avatar({ name: i.name, photo: i.photo }, { teamColor: t.color })}
        <div class="who"><a href="${i.athlete_id ? `/players/${i.athlete_id}` : '#'}"><b>${i.name}</b></a> ${statusBadge(i.status)}
          <small>${[i.position, [i.side, i.body_part].filter(Boolean).join(' '), i.detail].filter(Boolean).join(' · ') || 'No detail published'}</small>
          ${i.short_comment ? html`<blockquote>${i.short_comment}</blockquote>` : ''}
          ${i.source_return_date ? html`<small style="margin-top:6px">ESPN lists an expected return of ${fmtDateET(i.source_return_date + 'T16:00:00Z', { month: 'short', day: 'numeric' })} — source-reported, not a PropBetEdge estimate.</small>` : ''}
        </div>
        <div class="when">Source updated<br />${fmtDateTimeET(i.source_updated_at)}<br /><span>Captured ${relTime(meta?.fetched_at)}</span></div>
      </div>`)}</div>`;
  })}` : empty('Nobody matches', 'No listed players for this filter.');
}

export function injuriesView({ res, teams }) {
  if (!res?.ok) return html`${injuriesHead()}${errorState(res, 'The injury feed')}`;
  const tIdx = teamIndex(teams);
  const items = res.data.items;
  return html`
    ${pageHead({ eyebrow: 'Availability desk', title: 'Injuries', sub: 'Every status carries its source, when the source last updated it, and when PropBetEdge captured it. Reported notes stay attributed. Return dates appear only when the source publishes one — and are labelled as the source’s.' })}
    <div class="callout" style="margin-bottom:16px"><b>Authority:</b> ${res.data.authority} The league’s official game-day injury report is a separate document and is not yet ingested. <a href="/news/c/injury">Injury stories from the newsroom →</a></div>
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><small>Listed</small><b>${items.length}</b><span>players on feed</span></div>
      <div class="tile"><small>Out</small><b>${items.filter((i) => /out/i.test(i.status || '')).length}</b><span>incl. out for season</span></div>
      <div class="tile"><small>Day-to-day</small><b>${items.filter((i) => /day/i.test(i.status || '')).length}</b><span>status per ESPN</span></div>
      <div class="tile"><small>Changes logged</small><b>${res.data.changes.length}</b><span>before → after</span></div>
    </div>
    <div class="controls">
      <select class="select" data-team aria-label="Team"><option value="">All teams</option>${[...tIdx.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => html`<option value="${t.team_id}">${t.name}</option>`)}</select>
      <div class="pill-row">${[['', 'All'], ['out', 'Out'], ['day', 'Day-to-day']].map(([k, l]) => html`<button class="pill" type="button" data-status="${k}" aria-pressed="${k === ''}">${l}</button>`)}</div>
    </div>
    <div class="split">
      <section class="card card-pad" data-list>${injuryList(items, tIdx, res.meta)}</section>
      <aside>
        <section class="card">
          <div class="card-head"><span class="card-title">Change ledger</span></div>
          <div class="card-body">
            ${res.data.changes.length ? res.data.changes.slice(0, 30).map((c) => html`<div class="change-row">${avatar({ name: c.name }, { size: 'sm' })}<div><b>${c.athlete_id ? html`<a href="/players/${c.athlete_id}">${c.name}</a>` : c.name}</b><div class="note">${c.change_kind.replace('_', ' ')}: ${c.status_before || 'not listed'} → ${c.status_after || 'off feed'}</div></div><span class="note">${relTime(c.captured_at)}</span></div>`) : html`<p class="note">${res.data.change_ledger}</p>`}
          </div>
        </section>
      </aside>
    </div>
    <div style="margin-top:16px">${sourceLine(res.meta, { label: 'ESPN injury feed' })}</div>
  `;
}

// ------------------------------------------------------------ standings

export const standingsHead = () => pageHead({ eyebrow: 'League table', title: 'Standings' });
export const loadStandings = async (api) => ({ res: await api.standings() });

export function standingsView({ res }) {
  if (!res?.ok) return html`${standingsHead()}${errorState(res, 'Standings')}`;
  const d = res.data;
  return html`
    ${pageHead({ eyebrow: d.is_current ? 'Current season' : 'Prior season — final', title: 'Standings', sub: d.label, right: d.is_current ? badge('final', d.phase || 'Current') : badge('stale', 'Not current') })}
    <div class="grid g2">
      ${d.groups.map((g) => html`<section class="card">
        <div class="card-head"><span class="card-title">${g.name}</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>L10</th><th>STRK</th><th>HOME</th><th>ROAD</th><th>DIFF</th></tr></thead><tbody>
          ${g.entries.map((t) => html`<tr><td><a class="pname" href="/teams/${t.team_id}"><span class="mono faint" style="width:16px">${t.seed ?? ''}</span>${teamLogo(t, 26)}${t.name}${t.clincher ? html`<span class="clinch" title="ESPN clinch mark">${t.clincher}</span>` : ''}</a></td><td>${t.wins}</td><td>${t.losses}</td><td>${num(t.win_pct, 3).replace(/^0/, '')}</td><td>${t.games_behind}</td><td>${t.last_ten || '—'}</td><td>${t.streak || '—'}</td><td>${t.home || '—'}</td><td>${t.road || '—'}</td><td>${signed(t.differential)}</td></tr>`)}
        </tbody></table></div>
      </section>`)}
    </div>
    <p class="note" style="margin-top:12px">Clinch marks are ESPN’s (x = clinched a playoff berth; e/o = eliminated). Seeds as published by the source. Differential is average point margin per game. <a href="/matchups">Upcoming matchups →</a></p>
    <div style="margin-top:12px">${sourceLine(res.meta)}</div>
  `;
}

// ------------------------------------------------------------ teams

export const teamsHead = () => pageHead({ eyebrow: 'League', title: 'Teams' });
export const loadTeams = async (api) => { const [teams, st] = await Promise.all([api.teams(), api.standings()]); return { teams, st }; };

export function teamsView({ teams, st }) {
  if (!teams?.ok) return html`${teamsHead()}${errorState(teams, 'Teams')}`;
  const rows = st?.ok ? st.data.groups.flatMap((g) => g.entries.map((e) => ({ ...e, conf: g.name }))) : [];
  const list = teams.data.teams.map((t) => ({ ...t, st: rows.find((r) => r.team_id === t.team_id) })).sort((a, b) => a.name.localeCompare(b.name));
  return html`
    ${pageHead({ eyebrow: 'League', title: 'Teams', sub: `${list.length} teams in the ${st?.ok ? st.data.season?.label || '' : ''} season.` })}
    <div class="grid g3">
      ${list.map((t) => html`<a class="card card-pad" href="/teams/${t.team_id}" style="border-top:3px solid ${safeColor(t.color, 'var(--gold)')};display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center"><div>
        <div class="note" style="letter-spacing:.12em;text-transform:uppercase">${t.location}</div>
        <div style="font:800 28px/1 var(--f-display);text-transform:uppercase;margin-top:4px">${t.short_name}</div>
        <div class="src" style="margin-top:10px"><span><b>${t.st ? `${t.st.wins}-${t.st.losses}` : '—'}</b></span><span>${t.st ? `${t.st.conf.replace(' Conference', '')} · seed ${t.st.seed ?? '—'}` : ''}</span>${t.st?.streak ? html`<span>${t.st.streak}</span>` : ''}</div>
      </div>${teamLogo(t, 72)}</a>`)}
    </div>
    <div style="margin-top:14px">${sourceLine(teams.meta)}</div>
  `;
}

// ------------------------------------------------------------ players

export const playersHead = () => pageHead({ eyebrow: 'Player intelligence', title: 'Players' });
export const loadPlayers = async (api) => ({ res: await api.players() });

export function playerGrid(all, state = { q: '', team: '', pos: '' }) {
  const q = String(state.q || '').trim().toLowerCase();
  const list = all.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!state.team || p.team?.team_id === state.team) && (!state.pos || String(p.position || '').includes(state.pos)));
  return { list, body: list.length ? html`${list.map(playerCard)}` : empty('No players match', 'Try a different name, team or position.') };
}

export function playersView({ res }, state = { q: '', team: '', pos: '' }) {
  if (!res?.ok) return html`${playersHead()}${errorState(res, 'The player index')}`;
  const all = res.data.players;
  const teams = [...new Map(all.map((p) => [p.team?.team_id, p.team])).values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const cov = res.data.photo_coverage;
  const grid = playerGrid(all, state);
  return html`
    ${pageHead({ eyebrow: 'Player intelligence', title: 'Players', sub: `${all.length} players on the ${res.data.teams} current WNBA rosters. Identity comes from ESPN athlete IDs; photos appear only where the image license and the person are both verified.` })}
    <div class="controls">
      <label class="search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search players" value="${state.q}" data-q aria-label="Search players" /></label>
      <select class="select" data-team aria-label="Team"><option value="">All teams</option>${teams.map((t) => html`<option value="${t.team_id}">${t.name}</option>`)}</select>
      <select class="select" data-pos aria-label="Position"><option value="">All positions</option><option value="G">Guards</option><option value="F">Forwards</option><option value="C">Centers</option></select>
    </div>
    <div class="note" style="margin-bottom:12px" data-count>${grid.list.length} player${grid.list.length === 1 ? '' : 's'}</div>
    <div class="pgrid" data-grid>${grid.body}</div>
    <div style="margin-top:18px">${sourceLine(res.meta, { label: `Photos verified: ${cov?.approved ?? 0} of ${all.length}` })}</div>
  `;
}

// ------------------------------------------------------------ stats

export const PCOLS = [['avgPoints', 'PPG'], ['avgRebounds', 'RPG'], ['avgAssists', 'APG'], ['avgThreePointFieldGoalsMade', '3PM'], ['fieldGoalPct', 'FG%'], ['threePointFieldGoalPct', '3P%'], ['freeThrowPct', 'FT%'], ['avgSteals', 'STL'], ['avgBlocks', 'BLK'], ['avgMinutes', 'MIN'], ['gamesPlayed', 'GP']];
export const TCOLS = [['avgPoints', 'PTS'], ['opp_avgPoints', 'OPP'], ['possessions_per_game', 'PACE*'], ['fieldGoalPct', 'FG%'], ['threePointFieldGoalPct', '3P%'], ['avgThreePointFieldGoalsAttempted', '3PA'], ['avgRebounds', 'REB'], ['avgAssists', 'AST'], ['avgTurnovers', 'TOV']];

export const statsHead = () => pageHead({ eyebrow: 'Season stats', title: 'Stats' });
export const loadStats = async (api) => { const [winba, pl, tm, teams] = await Promise.all([api.statsWinba(), api.statsPlayers(), api.statsTeams(), api.teams()]); return { winba, pl, tm, teams }; };

const th = (cols, active) => cols.map(([k, l]) => html`<th><button type="button" data-sort="${k}" ${active === k ? html`aria-sort="descending"` : ''}>${l}</button></th>`);

export function statsBody({ winba, pl, tm, teams }, state) {
  const tIdx = teamIndex(teams);
  if (state.tab === 'winba') {
    if (!winba?.ok) return errorState(winba, 'WinBA Score');
    const rows = winba.data.rows || [];
    if (!rows.length) return empty('WinBA is building', 'The season archive has not produced a WinBA snapshot yet. No substitute ranking is shown.');
    const qualified = rows.filter((r) => r.qualified);
    const provisional = rows.filter((r) => !r.qualified);
    const top = qualified.slice(0, 3);
    return html`
      <section class="winba-intro">
        <div class="winba-intro-copy">
          <span class="eyebrow">PropBetEdge original metric</span>
          <h2>WinBA Score</h2>
          <p class="winba-thesis">Who is producing, who is actually on the floor, and how much of that production is showing up in winning basketball?</p>
          <p class="winba-lead">WinBA turns those three ideas into one transparent 0–100 season index. It combines a player's box production relative to the league, the team's results in games that player actually appeared in, the share of the player's production recorded in wins, and how much of a 40-minute game the player typically carries.</p>
          <div class="winba-purpose">
            <div>
              <span>WHY IT EXISTS</span>
              <b>Counting stats tell only part of the story.</b>
              <p>Points, rebounds and assists show production. Team record shows results. Minutes show responsibility. WinBA brings all three into one comparable number without hiding the ingredients.</p>
            </div>
            <div>
              <span>HOW TO READ IT</span>
              <b>Higher means a stronger production + role + winning profile.</b>
              <p>A WinBA score is an index, not a probability. An 82 does not mean an 82% chance to win. Use the score, league rank and four components together.</p>
            </div>
          </div>
        </div>
        <div class="winba-formula" aria-label="WinBA Score formula">
          <span><b>45%</b><strong>Production</strong><small>Box Impact per 36, ranked against qualified WNBA players</small></span>
          <span><b>25%</b><strong>Win rate</strong><small>Team win percentage only in games the player appeared in</small></span>
          <span><b>20%</b><strong>Winning output</strong><small>Share of the player's total Box Impact that was produced in wins</small></span>
          <span><b>10%</b><strong>Court share</strong><small>Average minutes divided by a 40-minute regulation game</small></span>
        </div>
      </section>

      ${top[0] ? html`<section class="winba-proof" aria-label="How the current WinBA leader earns the top score">
        <div class="winba-proof-score">
          <span>LIVE EXAMPLE · CURRENT #1</span>
          <strong>${num(top[0].score)}</strong>
          <em>WINBA</em>
        </div>
        <div class="winba-proof-copy">
          <h3>Why ${top[0].name} is leading right now</h3>
          <p>The score is inspectable: <b>${num(top[0].components.production_percentile)}%</b> production percentile, <b>${num(top[0].components.win_rate)}%</b> win rate in appearances, <b>${num(top[0].components.winning_output_share)}%</b> of Box Impact produced in wins, and <b>${num(top[0].components.court_share)}%</b> court share.</p>
          <small>${top[0].sample.games} qualifying appearances · ${num(top[0].averages.min)} minutes per game · ${top[0].sample.wins}-${top[0].sample.losses} in games played</small>
        </div>
      </section>` : ''}

      <section class="winba-reading-grid" aria-label="What WinBA measures and what it does not">
        <div>
          <span>WHAT IT REWARDS</span>
          <h3>Production that survives context.</h3>
          <p>WinBA gives the largest weight to individual production, then adds whether that production is occurring in wins and whether the player is carrying meaningful floor time.</p>
        </div>
        <div>
          <span>WHAT MAKES IT DIFFERENT</span>
          <h3>It is appearance-aware.</h3>
          <p>A player is judged only from games she actually played. DNPs and zero-minute rows do not become fake losses or fake production, and small samples stay Provisional.</p>
        </div>
        <div>
          <span>WHAT IT IS NOT</span>
          <h3>Not a prediction. Not causal wins added.</h3>
          <p>WinBA does not use sportsbook odds, injury labels or subjective grades. It describes the relationship between real box production, playing time and team wins in completed regular-season games.</p>
        </div>
      </section>

      <div class="winba-equation">
        <span>BOX IMPACT</span>
        <b>PTS + 1.2 × REB + 1.5 × AST</b>
        <p>That production is normalized per 36 minutes before the league percentile is calculated, so raw playing time alone does not decide the production component.</p>
      </div>

      <div class="winba-podium">
        ${top.map((r) => {
          const t = tIdx.get(r.team_id);
          return html`<a class="winba-podium-card rank-${r.rank}" href="/players/${r.athlete_id}" style="--tc:${safeColor(t?.color, 'var(--gold)')}">
            <span class="winba-rank">#${r.rank}</span>
            ${avatar({ name: r.name, photo: r.photo }, { teamColor: t?.color })}
            <div><strong>${r.name}</strong><small>${t?.abbr || ''} · ${r.sample.wins}-${r.sample.losses}</small></div>
            <b class="winba-score">${num(r.score)}<em>WINBA</em></b>
          </a>`;
        })}
      </div>
      <section class="card winba-table-card">
        <div class="card-head"><span class="card-title">WinBA leaderboard</span><span class="note">${qualified.length} qualified · ${provisional.length} provisional</span></div>
        <div class="tbl-wrap"><table class="tbl winba-table"><thead><tr>
          <th>Rank</th><th>Player</th><th>WinBA</th><th>Prod %ile</th><th>Win %</th><th>Winning output</th><th>Court share</th><th>W-L</th><th>MIN/G</th><th>PTS</th><th>REB</th><th>AST</th>
        </tr></thead><tbody>
          ${rows.map((r) => {
            const t = tIdx.get(r.team_id);
            return html`<tr class="${r.qualified ? '' : 'winba-provisional'}">
              <td class="mono">${r.rank ? `#${r.rank}` : 'PROV'}</td>
              <td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: t?.color })}${r.name}<span class="note">${t?.abbr || ''}</span></a></td>
              <td class="hi winba-score-cell">${num(r.score)}</td>
              <td>${num(r.components.production_percentile)}%</td>
              <td>${num(r.components.win_rate)}%</td>
              <td>${num(r.components.winning_output_share)}%</td>
              <td>${num(r.components.court_share)}%</td>
              <td>${r.sample.wins}-${r.sample.losses}</td>
              <td>${num(r.averages.min)}</td><td>${num(r.averages.pts)}</td><td>${num(r.averages.reb)}</td><td>${num(r.averages.ast)}</td>
            </tr>`;
          })}
        </tbody></table></div>
        <div class="card-body winba-method">
          <p><b>Qualification:</b> 10 appearances or 250 minutes. Players below that sample are still scored so you can inspect them, but they are labelled Provisional and do not receive an official league rank or move the qualified production benchmark.</p>
          <p><b>Update cycle:</b> WinBA is rebuilt from PropBetEdge's archived completed regular-season box scores when new final-game data enters the archive. DNP and zero-minute rows are excluded.</p>
          <p><b>Interpretation:</b> Compare the overall score with the component columns. Two players can reach similar WinBA scores in different ways — one through elite per-minute production, another through a larger role and stronger results in her appearances.</p>
          <p class="note">${winba.data.formula?.interpretation || ''} Snapshot uses ${winba.data.games_used || 0} archived regular-season finals · generated ${relTime(winba.data.generated_at)}.</p>
          ${sourceLine(winba.meta, { label: 'PropBetEdge WinBA Score · derived from archived ESPN WNBA box scores' })}
        </div>
      </section>`;
  }
  if (state.tab === 'players') {
    if (!pl?.ok) return errorState(pl, 'Player stats');
    const rows = [...pl.data.rows].sort((a, b) => ((b[state.sort] ?? -1) - (a[state.sort] ?? -1)));
    return html`<section class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th>${th(PCOLS, state.sort)}</tr></thead><tbody>
      ${rows.map((r, i) => html`<tr><td class="faint">${i + 1}</td><td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: tIdx.get(r.team_id)?.color })}${r.name}<span class="note">${r.team || ''}</span></a></td>${PCOLS.map(([k]) => html`<td class="${k === state.sort ? 'hi' : ''}">${num(r[k], k === 'gamesPlayed' ? 0 : 1)}</td>`)}</tr>`)}
    </tbody></table></div><div class="card-body"><p class="note">ESPN’s season leaders list includes qualified players only (${rows.length} this season). Players below the qualification threshold — including some recent acquisitions — appear on their player and team pages instead.</p>${sourceLine(pl.meta)}</div></section>`;
  }
  if (!tm?.ok) return errorState(tm, 'Team stats');
  const rows = [...tm.data.rows].sort((a, b) => ((b[state.tsort] ?? -1) - (a[state.tsort] ?? -1)));
  return html`<section class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Team</th>${th(TCOLS, state.tsort)}</tr></thead><tbody>
    ${rows.map((r) => html`<tr><td><a class="pname" href="/teams/${r.team_id}">${teamDot(tIdx.get(r.team_id))}${r.name}</a></td>${TCOLS.map(([k]) => html`<td class="${k === state.tsort ? 'hi' : ''}">${num(r[k])}</td>`)}</tr>`)}
  </tbody></table></div><div class="card-body"><p class="note">*PACE: ${tm.data.pace_method} OPP = points allowed per game.</p>${sourceLine(tm.meta)}</div></section>`;
}

export function statsView(data, state = { tab: 'winba', sort: 'avgPoints', tsort: 'avgPoints' }) {
  const { pl } = data;
  return html`
    ${pageHead({ eyebrow: pl?.ok && pl.data.is_current ? `${pl.data.season?.year || ''} season to date` : 'Season stats', title: 'Stats', sub: 'Source-grounded WNBA statistics plus WinBA Score, PropBetEdge’s transparent winning-impact index.' })}
    <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="winba" aria-selected="${state.tab === 'winba'}">WinBA Score</button><button type="button" role="tab" data-tab="players" aria-selected="${state.tab === 'players'}">Player leaders</button><button type="button" role="tab" data-tab="teams" aria-selected="${state.tab === 'teams'}">Team profiles</button></div>
    <div data-body>${statsBody(data, state)}</div>
  `;
}
