// International women's basketball views — shared by the SPA pages and the wnba-web publishing Worker.
// Data comes only from the normalized wnba-international contract (never provider shapes).
import { html } from '../lib/dom.js';
import { pageHead, errorState, empty, avatar } from '../ui/components.js';
import { fmtDateET, fmtTimeET, relTime, num } from '../lib/format.js';

// ------------------------------------------------------------ loaders

export const loadIntlHome = async (api) => ({ home: await api.intl() });
export const loadCompetition = async (api, slug, section = null) => {
  const [ov, schedule, sectionRes, news] = await Promise.all([
    api.intlCompetition(slug),
    section === 'games' ? api.intlCompetition(slug, 'schedule') : Promise.resolve(null),
    section === 'teams' || section === 'players' || section === 'leaders' ? api.intlCompetition(slug, section) : Promise.resolve(null),
    section ? Promise.resolve(null) : api.news({ limit: 8, lane: 'international' })
  ]);
  return { slug, section, ov, schedule, sectionRes, news };
};
export const loadIntlGame = async (api, id) => ({ res: await api.intlGame(id) });
export const loadNationalTeam = async (api, slug) => ({ res: await api.intlTeam(slug) });
export const loadIntlPlayer = async (api, id) => {
  const res = await api.intlPlayer(id);
  const wnbaId = res?.ok ? res.data.player.wnba?.wnba_player_id : null;
  const wnba = wnbaId ? await api.player(wnbaId) : null;
  return { res, wnba };
};

// ------------------------------------------------------------ kit

export const flag = (team, size = 28) => (team?.flag
  ? html`<img class="flag" src="${team.flag}" alt="${team.name} flag" width="${Math.round(size * 1.5)}" height="${size}" loading="lazy" decoding="async" />`
  : html`<span class="flag flag--code" style="width:${Math.round(size * 1.5)}px;height:${size}px">${team?.country_code || ''}</span>`);

export const teamHref = (t) => `/international/teams/${t.slug}`;
export const playerSlug = (name) => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const playerHref = (p) => `/international/players/${String(p.player_id || '').replace(/^p-/, '')}-${playerSlug(p.name)}`;
export const gameHref = (g) => `/international/games/${g.provider_ids?.espn || String(g.game_id).replace(/^g-/, '')}`;
const compHref = (c, section = '') => `/international/${c.slug}${section ? `/${section}` : ''}`;
const dayET = (iso) => fmtDateET(iso, { weekday: 'short', month: 'short', day: 'numeric' });

export function stateBadge(g) {
  if (g.status === 'live') return html`<span class="istate istate--live"><i aria-hidden="true"></i>Live · ${g.halftime ? 'Halftime' : `${g.period_label || ''} ${g.clock || ''}`.trim()}</span>`;
  if (g.status === 'final') return html`<span class="istate istate--final">Final${g.period > 4 ? `/${g.period_label}` : ''}</span>`;
  if (g.status === 'postponed') return html`<span class="istate">${g.status_detail || 'Postponed'}</span>`;
  return html`<span class="istate">${dayET(g.scheduled_at)} · ${fmtTimeET(g.scheduled_at)}</span>`;
}

function scoreRow(t, score, won, final) {
  return html`<div class="igame-row ${final && !won ? 'lost' : ''}">
    ${flag(t, 22)}<a class="igame-team" href="${teamHref(t)}">${t.name}</a><span class="igame-score">${score ?? ''}</span>
  </div>`;
}

export function gameTile(g, { showRound = true } = {}) {
  const final = g.status === 'final';
  return html`<article class="igame ${g.status === 'live' ? 'igame--live' : ''}">
    <div class="igame-top">${stateBadge(g)}${showRound ? html`<span class="igame-round">${g.round_name}</span>` : ''}</div>
    ${scoreRow(g.away_team, g.away_score, g.winner === g.away_team_id, final)}
    ${scoreRow(g.home_team, g.home_score, g.winner === g.home_team_id, final)}
    <a class="igame-link" href="${gameHref(g)}">${g.status === 'live' ? 'Game center · live' : final ? 'Box score & play-by-play' : 'Game center'} →</a>
  </article>`;
}

export function freshnessLine(meta) {
  if (!meta) return '';
  const stale = meta.stale || meta.freshness === 'STALE' || meta.freshness === 'ERROR';
  return html`<p class="ifresh ${stale ? 'ifresh--stale' : ''}" data-fresh="${meta.fetched_at || ''}">Data: ${meta.source?.name || 'ESPN'} public data (not an official FIBA feed) · ${meta.fetched_at ? `updated ${relTime(meta.fetched_at)}` : 'update time unknown'}${stale ? ' · STALE — the provider has not refreshed recently' : ''}</p>`;
}

const intlNav = (c, here) => html`<nav class="desk-nav" aria-label="${c.short_name} sections">
  ${[['', 'Overview'], ['games', 'Games'], ['bracket', 'Bracket'], ['standings', 'Standings'], ['leaders', 'Leaders'], ['teams', 'Teams'], ['players', 'Players']].map(([s, label]) => html`<a class="${(here || '') === s ? 'on' : ''}" href="${compHref(c, s)}" ${(here || '') === s ? html`aria-current="page"` : ''}>${label}</a>`)}
</nav>`;

// ------------------------------------------------------------ modules

export function bracketView(b) {
  if (!b?.rounds?.length) return empty('Bracket not set', 'The knockout bracket appears once the group phase is complete.');
  return html`<div class="ibracket-wrap"><div class="ibracket" style="--cols:${b.rounds.length}">
    ${b.rounds.map((r) => html`<section class="ibracket-col"><h3 class="ibracket-h">${r.round_name}</h3>${r.games.map((g) => html`<a class="ibracket-game ${g.status}" href="${gameHref(g)}">
      ${[g.away_team, g.home_team].map((t, i) => html`<span class="ibracket-team ${g.winner && g.winner !== t.team_id ? 'lost' : ''} ${g.winner === t.team_id ? 'won' : ''}">${flag(t, 16)}<b>${t.country_code}</b><em>${i === 0 ? g.away_score ?? '' : g.home_score ?? ''}</em></span>`)}
      <small>${g.status === 'live' ? `Live · ${g.period_label} ${g.clock || ''}` : g.status === 'final' ? 'Final' : `${dayET(g.scheduled_at)} ${fmtTimeET(g.scheduled_at)}`}</small>
    </a>`)}</section>`)}
  </div></div>
  ${b.bronze_game ? html`<div class="ibronze"><span class="eyebrow">Bronze medal game</span>${gameTile(b.bronze_game, { showRound: false })}</div>` : ''}
  ${b.medals ? html`<div class="imedals">${[['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze']].filter(([k]) => b.medals[k]).map(([k, label]) => html`<a class="imedal imedal--${k}" href="${teamHref(b.medals[k])}">${flag(b.medals[k], 22)}<span><small>${label}</small><b>${b.medals[k].name}</b></span></a>`)}</div>` : ''}`;
}

export function standingsTables(standings) {
  if (!standings?.length) return empty('No standings', 'Group standings appear once group games are played.');
  return html`<div class="grid g2">${standings.map((s) => html`<section class="card">
    <div class="card-head"><span class="card-title">Group ${s.group}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Team</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>+/-</th><th>PTS</th></tr></thead><tbody>
      ${s.entries.map((e) => html`<tr><td><a class="pname" href="${teamHref(e.team)}"><span class="mono faint" style="width:16px">${e.rank}</span>${flag(e.team, 16)}${e.team.name}</a></td><td>${e.wins}</td><td>${e.losses}</td><td>${e.points_for}</td><td>${e.points_against}</td><td>${e.diff > 0 ? '+' : ''}${e.diff}</td><td class="hi">${e.class_points}</td></tr>`)}
    </tbody></table></div>
  </section>`)}</div>
  <p class="note" style="margin-top:10px">${standings[0].method}</p>`;
}

export function leadersView(leaders, { compact = false } = {}) {
  if (!leaders?.length) return empty('No leaders yet', 'Leaders appear after completed games.');
  return html`<div class="grid ${compact ? 'g3' : 'g2'}">${leaders.map((l) => html`<section class="card">
    <div class="card-head"><span class="card-title">${l.label}</span><span class="note">per game · min ${l.min_games} games</span></div>
    <div class="card-body">${l.rows.map((r) => html`<a class="change-row" href="${playerHref(r)}" style="grid-template-columns:auto auto minmax(0,1fr) auto"><span class="mono faint">${r.rank}</span>${flag(r.team, 14)}<span><b>${r.name}</b><small class="note"> ${r.team.country_code} · ${r.games} g</small></span><span class="mono hi">${num(r.value)}</span></a>`)}</div>
  </section>`)}</div>
  ${!compact ? html`<p class="note" style="margin-top:10px">${leaders.find((l) => l.stat === 'eff')?.method || ''}</p>` : ''}`;
}

export function wnbaModule(players, { title = 'WNBA at the World Cup' } = {}) {
  if (!players?.length) return '';
  return html`<section class="section iwnba">
    <div class="sec-head"><div><h2 class="sec-title bc">${title}</h2><p class="desk-sub">${players.length} tournament players are on current WNBA rosters — matched by identical ESPN athlete ID, never by guesswork.</p></div></div>
    <div class="iwnba-grid">${[...players].sort((a, b) => (b.averages?.pts || 0) - (a.averages?.pts || 0)).map((p) => html`<article class="iwnba-card">
      <a class="iwnba-who" href="${playerHref(p)}">${avatar({ name: p.name, photo: p.wnba.photo ? { square: p.wnba.photo.square } : null })}<span><b>${p.name}</b><small>${flag(p.team, 12)} ${p.team.name}</small></span></a>
      <div class="iwnba-stats"><span><b>${num(p.averages?.pts)}</b> PTS</span><span><b>${num(p.averages?.reb)}</b> REB</span><span><b>${num(p.averages?.ast)}</b> AST</span><span class="note">${p.games} g</span></div>
      <a class="iwnba-link" href="/players/${p.wnba.wnba_player_id}">${p.wnba.wnba_team ? `${p.wnba.wnba_team.name} · ` : ''}WNBA profile →</a>
    </article>`)}</div>
  </section>`;
}

function newsModule(news) {
  const items = news?.ok ? news.data.items : [];
  return html`<section class="section">
    <div class="sec-head"><div><h2 class="sec-title bc">Latest World Cup news</h2><p class="desk-sub">External publishers, attributed — headline and link only. The reporting is theirs.</p></div></div>
    ${items.length ? html`<ol class="wire">${items.slice(0, 8).map((i) => html`<li><div class="nmeta"><span class="badge ext">${i.source?.name}</span><span>${relTime(i.published_at)}</span></div><a href="${i.url}" rel="noopener" target="_blank">${i.headline}&nbsp;<span class="note" aria-hidden="true">↗</span></a></li>`)}</ol>` : html`<p class="note">No attributed World Cup stories in the source wire right now.</p>`}
  </section>`;
}

// ------------------------------------------------------------ pages

export function intlHomeView({ home }) {
  if (!home?.ok) return html`${pageHead({ eyebrow: 'International', title: 'International women’s basketball' })}${errorState(home, 'International data')}`;
  const d = home.data;
  const byStatus = (s) => d.competitions.filter((c) => c.status === s);
  const compCard = (c) => html`<a class="card card-pad icomp" href="/international/${c.slug}">
    <span class="eyebrow">${c.governing_body} · ${c.region}${c.host ? ` · ${c.host.city}` : ''}</span>
    <b class="icomp-name">${c.name}</b>
    <span class="note">${c.start_date ? `${fmtDateET(`${c.start_date}T12:00:00Z`, { month: 'short', day: 'numeric' })} – ${fmtDateET(`${c.end_date}T12:00:00Z`, { month: 'short', day: 'numeric', year: 'numeric' })}` : c.season} · ${c.status}${c.coverage !== 'full' ? ' · coverage coming' : ''}</span>
  </a>`;
  return html`
    ${pageHead({ eyebrow: 'PropBetEdge · International', title: 'International women’s basketball', sub: 'National-team competitions — World Cup, Olympics, qualifiers and continental championships — connected to the WNBA players you already follow.' })}
    ${d.live.length ? html`<section class="section"><div class="sec-head"><h2 class="sec-title bc"><span class="istate istate--live"><i aria-hidden="true"></i>Live now</span></h2></div><div class="islate">${d.live.map((g) => gameTile(g))}</div></section>` : ''}
    <section class="section"><div class="sec-head"><h2 class="sec-title bc">Competitions</h2></div>
      ${['active', 'upcoming', 'recent', 'historical'].map((s) => byStatus(s).length ? html`<h3 class="note" style="text-transform:uppercase;letter-spacing:.14em;margin:10px 0">${s}</h3><div class="grid g3">${byStatus(s).map(compCard)}</div>` : '')}
    </section>
    ${d.competitions.flatMap((c) => c.next_games || []).length ? html`<section class="section"><div class="sec-head"><h2 class="sec-title bc">Up next</h2></div><div class="islate">${d.competitions.flatMap((c) => c.next_games || []).map((g) => gameTile(g))}</div></section>` : ''}
    ${d.recent.length ? html`<section class="section"><div class="sec-head"><h2 class="sec-title bc">Recent results</h2></div><div class="islate">${d.recent.map((g) => gameTile(g))}</div></section>` : ''}
    ${wnbaModule(d.wnba_players, { title: 'WNBA players internationally' })}
    ${freshnessLine(home.meta)}
  `;
}

export function competitionView({ slug, section, ov, schedule, sectionRes, news }) {
  if (!ov?.ok) return html`${pageHead({ eyebrow: 'International', title: 'Competition' })}${errorState(ov, 'This competition')}`;
  const d = ov.data;
  const c = d.competition;
  if (!d.scoreboard) return html`${pageHead({ eyebrow: 'International', title: c.name, sub: 'Structured coverage for this competition is not available yet.' })}`;
  const sb = d.scoreboard;
  const when = `${fmtDateET(`${c.start_date}T12:00:00Z`, { month: 'long', day: 'numeric' })}–${fmtDateET(`${c.end_date}T12:00:00Z`, { day: 'numeric' })}`;
  const hero = html`<section class="ihero">
    <div class="ihero-in">
      <span class="eyebrow">${c.governing_body} · ${c.host ? `${c.host.city.toUpperCase()} · ` : ''}${when.toUpperCase()}</span>
      <h1 class="ihero-title">${c.name}</h1>
      <p class="ihero-sub">${sb.live.length ? html`<span class="istate istate--live"><i aria-hidden="true"></i>${sb.live.length} game${sb.live.length === 1 ? '' : 's'} live</span>` : c.status === 'active' ? 'In progress' : c.status}${d.counts ? ` · ${d.counts.finals} of ${d.counts.games} games played · ${d.counts.teams} teams · ${d.counts.wnba_mapped} WNBA players` : ''}</p>
    </div>
    ${intlNav(c, section)}
  </section>`;

  if (!section) {
    const board = sb.live.length ? sb.live : sb.today.length ? sb.today : [...sb.next, ...sb.recent];
    return html`${hero}
      <section class="section"><div class="sec-head"><h2 class="sec-title bc">${sb.live.length ? 'Live' : sb.today.length ? 'Today in Berlin' : 'Scoreboard'}</h2><a class="sec-link" href="${compHref(c, 'games')}">All games →</a></div>
        <div class="islate">${board.map((g) => gameTile(g))}</div>
        ${sb.today.length && sb.live.length ? html`<div class="islate" style="margin-top:12px">${sb.today.filter((g) => g.status !== 'live').map((g) => gameTile(g))}</div>` : ''}
      </section>
      <section class="section"><div class="sec-head"><h2 class="sec-title bc">Bracket</h2><a class="sec-link" href="${compHref(c, 'bracket')}">Full bracket →</a></div>${bracketView(d.bracket)}</section>
      ${wnbaModule(d.wnba_players)}
      <section class="section"><div class="sec-head"><h2 class="sec-title bc">Tournament leaders</h2><a class="sec-link" href="${compHref(c, 'leaders')}">All leaders →</a></div>${leadersView(d.leaders, { compact: true })}</section>
      <section class="section"><div class="sec-head"><h2 class="sec-title bc">Group standings</h2><a class="sec-link" href="${compHref(c, 'standings')}">Standings →</a></div>${standingsTables(d.standings)}</section>
      ${newsModule(news)}
      ${freshnessLine(ov.meta)}`;
  }
  if (section === 'games') {
    const games = schedule?.ok ? schedule.data.games : [];
    const rounds = [...new Map(games.map((g) => [`${g.order}|${g.round_name}`, g.round_name])).entries()].sort(([a], [b]) => a.localeCompare(b));
    return html`${hero}${rounds.map(([key, name]) => html`<section class="section"><div class="sec-head"><h2 class="sec-title bc">${name}</h2></div><div class="islate">${games.filter((g) => `${g.order}|${g.round_name}` === key).map((g) => gameTile(g, { showRound: false }))}</div></section>`)}${freshnessLine(schedule?.meta || ov.meta)}`;
  }
  if (section === 'bracket') return html`${hero}<section class="section">${bracketView(d.bracket)}</section>${freshnessLine(ov.meta)}`;
  if (section === 'standings') return html`${hero}<section class="section">${standingsTables(d.standings)}</section>${freshnessLine(ov.meta)}`;
  if (section === 'leaders') return html`${hero}<section class="section">${leadersView(sectionRes?.ok ? sectionRes.data.leaders : d.leaders)}</section>${freshnessLine(ov.meta)}`;
  if (section === 'teams') {
    const teams = sectionRes?.ok ? sectionRes.data.teams : [];
    return html`${hero}<section class="section"><div class="grid g3">${[...teams].sort((a, b) => a.team.name.localeCompare(b.team.name)).map((t) => html`<a class="card card-pad iteam-card" href="${teamHref(t.team)}">${flag(t.team, 36)}<span><b>${t.team.name}</b><small class="note">${t.record.wins}-${t.record.losses} · ${num(t.averages.pts)} PPG · ${t.roster_size} players${t.wnba_players ? ` · ${t.wnba_players} WNBA` : ''}</small></span></a>`)}</div></section>${freshnessLine(ov.meta)}`;
  }
  if (section === 'players') {
    const players = sectionRes?.ok ? sectionRes.data.players : [];
    return html`${hero}<section class="section card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Team</th><th>GP</th><th>PTS</th><th>REB</th><th>AST</th><th>EFF</th><th>WNBA</th></tr></thead><tbody>
      ${players.map((p) => html`<tr><td><a class="pname" href="${playerHref(p)}">${p.name}</a></td><td class="l">${flag(p.team, 14)} ${p.team.country_code}</td><td>${p.games}</td><td class="hi">${num(p.averages.pts)}</td><td>${num(p.averages.reb)}</td><td>${num(p.averages.ast)}</td><td>${num(p.averages.eff)}</td><td class="l">${p.wnba ? html`<a href="/players/${p.wnba.wnba_player_id}">${p.wnba.wnba_team?.abbr || 'Profile'}</a>` : ''}</td></tr>`)}
    </tbody></table></div></section>${freshnessLine(sectionRes?.meta || ov.meta)}`;
  }
  return errorState({ error: { code: 'not_found' } }, 'This section');
}

const BOX_COLS = [['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO'], ['pf', 'PF']];
const made = (m, a) => (m === null || m === undefined ? '—' : `${m}-${a}`);

export function intlGameView({ res }) {
  if (!res?.ok) return errorState(res, 'This game');
  const d = res.data;
  const g = d.game;
  const c = d.competition;
  const final = g.status === 'final';
  const side = (t, score, rec) => html`<div class="icenter-team ${final && g.winner && g.winner !== t.team_id ? 'lost' : ''}">
    ${flag(t, 54)}<a href="${teamHref(t)}"><b>${t.name}</b></a><small>${rec ? `${rec.wins}-${rec.losses} in tournament` : ''}</small><span class="icenter-score" data-live-score>${score ?? '—'}</span>
  </div>`;
  const ls = g.linescores || { home: [], away: [] };
  const periods = Math.max(ls.home.length, ls.away.length, 4);
  return html`
    <section class="icenter" data-game-state="${g.status}">
      <span class="eyebrow"><a href="/international/${c.slug}">${c.name}</a> · ${g.round_name}${g.venue?.name ? ` · ${g.venue.name}, ${g.venue.city || ''}` : ''}</span>
      <h1 class="sr">${g.away_team.name} vs ${g.home_team.name} — ${g.round_name}, ${c.name}</h1>
      <div class="icenter-board">
        ${side(g.away_team, g.away_score, d.records?.away)}
        <div class="icenter-mid">${stateBadge(g)}<small>${final ? dayET(g.scheduled_at) : g.status === 'scheduled' ? `Tip ${fmtTimeET(g.scheduled_at)}` : ''}</small></div>
        ${side(g.home_team, g.home_score, d.records?.home)}
      </div>
      <div class="tbl-wrap"><table class="tbl icenter-lines"><thead><tr><th>Team</th>${Array.from({ length: periods }, (_, i) => html`<th>${i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`}</th>`)}<th>T</th></tr></thead><tbody>
        ${[[g.away_team, ls.away, g.away_score], [g.home_team, ls.home, g.home_score]].map(([t, l, s]) => html`<tr><td class="l">${flag(t, 14)} ${t.country_code}</td>${Array.from({ length: periods }, (_, i) => html`<td>${l[i] ?? '—'}</td>`)}<td class="hi">${s ?? '—'}</td></tr>`)}
      </tbody></table></div>
    </section>

    ${d.wnba_players?.length ? html`<section class="section"><div class="sec-head"><h2 class="sec-title bc">WNBA players in this game</h2></div><div class="iwnba-inline">${d.wnba_players.map((p) => html`<a class="chip" href="/players/${p.wnba.wnba_player_id}">${flag(p.team, 12)} ${p.name} · ${p.wnba.wnba_team?.abbr || 'WNBA'} profile</a>`)}</div></section>` : ''}

    ${d.boxscore ? html`<section class="section"><div class="sec-head"><h2 class="sec-title bc">Box score</h2><span class="note">${g.status === 'live' ? 'updating live' : final ? 'final' : ''}</span></div>
      <div class="grid g2">${d.boxscore.teams.map((t) => html`<section class="card">
        <div class="card-head"><span class="card-title">${flag(t.team, 16)} ${t.team.name}</span><span class="note">FG ${made(t.totals.fgm, t.totals.fga)} · 3P ${made(t.totals.fg3m, t.totals.fg3a)} · FT ${made(t.totals.ftm, t.totals.fta)} · REB ${t.totals.reb ?? '—'} · AST ${t.totals.ast ?? '—'} · TO ${t.totals.tov ?? '—'}</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th>${BOX_COLS.map(([, l]) => html`<th>${l}</th>`)}<th>FG</th><th>3P</th><th>FT</th></tr></thead><tbody>
          ${t.players.map((p) => html`<tr><td><a class="pname" href="${playerHref(p)}">${p.jersey ? html`<span class="mono faint">${p.jersey}</span>` : ''}${p.name}${p.starter ? html`<span class="note"> S</span>` : ''}</a>${p.wnba ? html` <a class="note gold" href="/players/${p.wnba.wnba_player_id}" title="WNBA profile">WNBA</a>` : ''}</td>${BOX_COLS.map(([k]) => html`<td class="${k === 'pts' ? 'hi' : ''}">${p[k] ?? '—'}</td>`)}<td>${made(p.fgm, p.fga)}</td><td>${made(p.fg3m, p.fg3a)}</td><td>${made(p.ftm, p.fta)}</td></tr>`)}
        </tbody></table></div>
      </section>`)}</div>
    </section>` : html`<section class="section">${empty(g.status === 'scheduled' ? 'Box score at tip-off' : 'Box score unavailable', g.status === 'scheduled' ? 'The box score fills in live once the game starts.' : 'The provider has not published a box score for this game.')}</section>`}

    <section class="section"><div class="sec-head"><h2 class="sec-title bc">Play-by-play</h2><span class="note">${d.plays?.length ? `${d.plays.length} events` : ''}</span></div>
      ${d.plays?.length ? html`<ol class="ipbp">${[...d.plays].reverse().slice(0, 120).map((p) => html`<li class="${p.scoring ? 'scoring' : ''}"><span class="mono">Q${p.period} ${p.clock || ''}</span><span>${p.text}</span><span class="mono">${p.away_score ?? ''}–${p.home_score ?? ''}</span></li>`)}</ol>` : html`<p class="note">${g.status === 'scheduled' ? 'Play-by-play starts at tip-off.' : 'The provider has not published play-by-play for this game yet; the score and box score above are current.'}</p>`}
    </section>
    ${freshnessLine(res.meta)}
  `;
}

export function nationalTeamView({ res }) {
  if (!res?.ok) return errorState(res, 'This national team');
  const d = res.data;
  const t = d.team;
  return html`
    <section class="ihero ihero--team">
      <div class="ihero-in">${flag(t, 48)}
        <span class="eyebrow">National team · women</span>
        <h1 class="ihero-title">${t.name}</h1>
        <p class="ihero-sub">${d.competitions.map((c) => `${c.competition.short_name}: ${c.record.wins}-${c.record.losses}${c.medal ? ` · ${c.medal[0].toUpperCase()}${c.medal.slice(1)} medal` : ''}`).join(' · ')}</p>
      </div>
    </section>
    ${wnbaModule(d.wnba_players.map((p) => ({ ...p, team: t })), { title: `WNBA players on ${t.name}` })}
    ${d.competitions.map((c) => html`
      <section class="section"><div class="sec-head"><h2 class="sec-title bc">${c.competition.name}</h2><a class="sec-link" href="/international/${c.competition.slug}">Competition →</a></div>
        <div class="tiles"><div class="tile"><small>Record</small><b>${c.record.wins}-${c.record.losses}</b><span>${c.standing ? `Group ${c.standing.group} · ${c.standing.rank}${['st', 'nd', 'rd'][c.standing.rank - 1] || 'th'}` : ''}</span></div>
          <div class="tile"><small>Points</small><b>${num(c.averages.pts)}</b><span>per game</span></div><div class="tile"><small>Rebounds</small><b>${num(c.averages.reb)}</b><span>per game</span></div><div class="tile"><small>Assists</small><b>${num(c.averages.ast)}</b><span>per game</span></div></div>
        <div class="islate" style="margin-top:14px">${c.games.map((g) => gameTile(g))}</div>
        <div class="card section"><div class="card-head"><span class="card-title">Roster · players who appeared</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>GP</th><th>PTS</th><th>REB</th><th>AST</th><th>WNBA</th></tr></thead><tbody>
          ${c.roster.map((p) => html`<tr><td class="faint">${p.jersey || ''}</td><td><a class="pname" href="${playerHref(p)}">${p.name}</a></td><td>${p.games ?? '—'}</td><td class="hi">${num(p.averages?.pts)}</td><td>${num(p.averages?.reb)}</td><td>${num(p.averages?.ast)}</td><td class="l">${p.wnba ? html`<a href="/players/${p.wnba.wnba_player_id}">${p.wnba.wnba_team?.name || 'WNBA profile'}</a>` : ''}</td></tr>`)}
        </tbody></table></div></div>
      </section>`)}
    ${freshnessLine(res.meta)}
  `;
}

export function intlPlayerView({ res, wnba }) {
  if (!res?.ok) return errorState(res, 'This player');
  const d = res.data;
  const p = d.player;
  const w = p.wnba;
  const wp = wnba?.ok ? wnba.data : null;
  const wSeason = wp?.gamelog?.seasons?.filter((s) => /^\d{4} Regular Season$/.test(s.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
  const wGames = (wSeason?.games || []).filter((g) => g.min);
  const wAvg = (k) => (wGames.length ? wGames.reduce((s, g) => s + (g[k] || 0), 0) / wGames.length : null);
  return html`
    <section class="ihero ihero--player">
      <div class="ihero-in">
        ${w?.photo?.portrait ? html`<img class="iplayer-photo" src="${w.photo.portrait}" alt="${p.name}" width="600" height="750" decoding="async" />` : ''}
        <span class="eyebrow">${flag(p.team, 16)} <a href="${teamHref(p.team)}">${p.team.name}</a>${p.jersey ? ` · #${p.jersey}` : ''}</span>
        <h1 class="ihero-title">${p.name}</h1>
        <p class="ihero-sub">${[p.bio?.height, p.bio?.dob ? `Born ${fmtDateET(`${p.bio.dob}T12:00:00Z`, { month: 'long', day: 'numeric', year: 'numeric' })}` : null].filter(Boolean).join(' · ')}</p>
        ${w?.photo?.attribution ? html`<p class="credit">${w.photo.attribution}</p>` : ''}
      </div>
    </section>
    ${w ? html`<section class="section iwnba-connect card card-pad">
      <span class="eyebrow">WNBA connection</span>
      <h2 class="sec-title">${p.name} plays for the ${w.wnba_team?.name || 'WNBA'}</h2>
      ${wGames.length ? html`<div class="tiles" style="margin-top:12px"><div class="tile"><small>${wSeason.name}</small><b>${num(wAvg('pts'))}</b><span>PTS · ${wGames.length} games</span></div><div class="tile"><small>Rebounds</small><b>${num(wAvg('reb'))}</b><span>per game</span></div><div class="tile"><small>Assists</small><b>${num(wAvg('ast'))}</b><span>per game</span></div><div class="tile"><small>Minutes</small><b>${num(wAvg('min'))}</b><span>per game</span></div></div>` : ''}
      <p class="pill-row" style="margin-top:12px"><a class="pill on" href="/players/${w.wnba_player_id}">WNBA profile & game log</a>${w.wnba_team ? html`<a class="pill" href="/teams/${w.wnba_team.team_id}">${w.wnba_team.name}</a>` : ''}<a class="pill" href="/injuries">WNBA Injury Desk</a><a class="pill" href="/news">WNBA News</a></p>
      <p class="note">Linked by ${w.mapping_method === 'provider_athlete_id' ? 'identical ESPN athlete ID' : w.mapping_method.replace(/_/g, ' ')} (${w.mapping_confidence} confidence).</p>
    </section>` : ''}
    ${d.competitions.map((c) => html`<section class="section">
      <div class="sec-head"><h2 class="sec-title bc">${c.competition.name}</h2><a class="sec-link" href="/international/${c.competition.slug}">Competition →</a></div>
      <div class="tiles"><div class="tile"><small>Points</small><b>${num(c.averages.pts)}</b><span>${c.games} games · high ${c.highs?.pts?.value ?? '—'}</span></div><div class="tile"><small>Rebounds</small><b>${num(c.averages.reb)}</b><span>high ${c.highs?.reb?.value ?? '—'}</span></div><div class="tile"><small>Assists</small><b>${num(c.averages.ast)}</b><span>high ${c.highs?.ast?.value ?? '—'}</span></div><div class="tile"><small>Efficiency</small><b>${num(c.averages.eff)}</b><span>FG ${c.averages.fg_pct ?? '—'}%</span></div></div>
      <div class="card section"><div class="card-head"><span class="card-title">Game log</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Round</th><th>Opp</th><th>Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th></tr></thead><tbody>
        ${c.log.map((g) => html`<tr><td>${dayET(g.scheduled_at)}</td><td class="l">${g.round_name}</td><td class="l">${flag(g.opponent, 12)} <a href="${teamHref(g.opponent)}">${g.opponent.country_code}</a></td><td class="l"><a href="/international/games/${String(g.game_id).replace(/^g-/, '')}">${g.result} ${g.team_score}–${g.opp_score}</a></td><td>${g.min ?? '—'}</td><td class="hi">${g.pts ?? '—'}</td><td>${g.reb ?? '—'}</td><td>${g.ast ?? '—'}</td><td>${made(g.fgm, g.fga)}</td><td>${made(g.fg3m, g.fg3a)}</td></tr>`)}
      </tbody></table></div></div>
    </section>`)}
    ${freshnessLine(res.meta)}
  `;
}

/** WNBA player page module: International career (reverse crosswalk). */
export function internationalCareerModule(intl) {
  const rows = intl?.ok ? intl.data.international : [];
  if (!rows.length) return '';
  return html`<section class="card section iwnba-connect card-pad">
    <span class="eyebrow">International career</span>
    ${rows.map((r) => html`<div style="margin-top:8px"><b>${flag(r.team, 14)} <a href="${teamHref(r.team)}">${r.team.name}</a> · <a href="/international/${r.competition.slug}">${r.competition.name}</a></b>
      <p class="note">${r.games} games · ${num(r.averages.pts)} PTS · ${num(r.averages.reb)} REB · ${num(r.averages.ast)} AST per game · <a class="gold" href="${playerHref(r)}">International stats & game log →</a></p></div>`)}
  </section>`;
}

