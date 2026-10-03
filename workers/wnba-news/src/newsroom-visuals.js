// Newsroom data visuals — ordinary newsroom stories on the SAME frozen visual contract as commissioned features.
//
//   FROZEN FACT PACKET -> CHART SPEC (this module) -> VALIDATION (visuals.js) -> RENDERER (src/views/visuals.js)
//
// Code decides everything about a chart: whether the facts support one, which type answers the story's question,
// exactly which values are plotted, their units, labels, provenance and the section it sits beside. Every value is
// read from `a.facts` (or the article's own game context) — the same packet the prose was written from — so a chart
// can never show a number the story could not state. The editorial model never emits a chart, a value or an axis.
//
// A chart must answer a question the story raises; a meaningless chart is worse than none, so each builder returns
// null when its data is too thin. Requirement levels: optional/supporting charts that fail validation are dropped
// (the story still publishes); an essential chart failing holds the story. No ordinary newsroom chart is essential.

import { groupedBars, divergingBars, gameStrip, statCompare, componentBars, visualFailures, VISUALS_VERSION } from './visuals.js';
import { sectionKey } from './depth.js';

export const NEWSROOM_VISUALS_VERSION = 'wnba-newsroom-visuals/1.0.0';

const n = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const TZ = 'America/New_York';
const dShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) : '');
const nickOf = (t) => t?.short_name || t?.abbr || t?.name || 'Team';
const abbrOf = (t) => t?.abbr || t?.short_name || 'TM';
const observedAt = (a) => a.provenance?.generated_at || (a.evidence || []).map((e) => e.captured_at).filter(Boolean).sort().at(-1) || a.updated_at || a.published_at || null;
const prov = (a, extra) => ({ source: extra.source, observed_at: observedAt(a), window: extra.window || null, game_id: extra.game_id || null, entity_ids: extra.entity_ids || [], fact_family: extra.fact_family || null, article_id: a.id });
const rowsWith = (rows, min = 2) => rows.filter((r) => r.values.filter((v) => v !== null).length >= min);

// ------------------------------------------------------------ results / performances

const SEPARATORS = [
  ['fg', 'Field goal %', 'fieldGoalPct', 'percent', 8, 'higher'],
  ['three', '3-point %', 'threePointFieldGoalPct', 'percent', 10, 'higher'],
  ['ft', 'Free throw %', 'freeThrowPct', 'percent', 12, 'higher'],
  ['reb', 'Rebounds', 'totalRebounds', 'count', 8, 'higher'],
  ['oreb', 'Offensive rebounds', 'offensiveRebounds', 'count', 4, 'higher'],
  ['ast', 'Assists', 'assists', 'count', 6, 'higher'],
  ['tov', 'Turnovers', 'totalTurnovers', 'count', 4, 'lower'],
  ['paint', 'Points in the paint', 'pointsInPaint', 'count', 10, 'higher'],
  ['pot', 'Points off turnovers', 'turnoverPoints', 'count', 8, 'higher'],
  ['fast', 'Fast-break points', 'fastBreakPoints', 'count', 6, 'higher']
];

function gameSides(a) {
  const g = a.context?.game;
  if (!g?.home || !g?.away) return null;
  const W = g.home.winner ? g.home : g.away;
  const L = W === g.home ? g.away : g.home;
  return { g, W, L };
}

function resultVisuals(a) {
  const f = a.facts || {};
  const s = gameSides(a);
  if (!s) return [];
  const { g, W, L } = s;
  const out = [];
  const gameNo = f.playoff?.game_number ? `Game ${f.playoff.game_number}` : dShort(g.start_utc);
  const ids = [String(W.team_id), String(L.team_id)];
  const src = `ESPN box score and linescore (game ${g.game_id})`;

  // 1. Game flow: where the game changed, quarter by quarter.
  const q = (f.quarters || []).filter((x) => n(x.w) !== null && n(x.l) !== null);
  if (q.length >= 4) {
    const swing = [...q].sort((x, y) => (y.w - y.l) - (x.w - x.l))[0];
    out.push({ section: 'flow', spec: groupedBars({
      id: 'game-flow', title: 'Scoring by quarter', subtitle: `${nickOf(W)} ${W.score}, ${nickOf(L)} ${L.score} · ${gameNo}`,
      caption: `Margin = ${nickOf(W)} points minus ${nickOf(L)} points in each period. The largest margin was the ${swing.label} (${swing.w - swing.l > 0 ? '+' : ''}${swing.w - swing.l}).`,
      unit: 'points', series: [{ key: 'w', label: nickOf(W), short_label: abbrOf(W), entity: { type: 'team', id: String(W.team_id) } }, { key: 'l', label: nickOf(L), short_label: abbrOf(L), entity: { type: 'team', id: String(L.team_id) } }],
      rows: q.map((x) => ({ key: String(x.label).toLowerCase(), label: x.label, values: [x.w, x.l], delta: x.w - x.l, highlight: x === swing })),
      provenance: prov(a, { source: src, window: 'this game', game_id: g.game_id, entity_ids: ids, fact_family: 'linescore' })
    }) });
  }

  // 2. Team separators: the 3–5 verified team stats with the largest normalised differences, never all of them.
  const tw = f.team_stats?.w || {}; const tl = f.team_stats?.l || {};
  const cand = SEPARATORS.map(([key, label, field, unit, norm, better]) => {
    const w = n(tw[field]); const l = n(tl[field]);
    return w === null || l === null ? null : { key, label, unit, values: [w, l], score: Math.abs(w - l) / norm, better };
  }).filter(Boolean);
  const bw = n(f.derived?.bench_w); const bl = n(f.derived?.bench_l);
  if (bw !== null && bl !== null) cand.push({ key: 'bench', label: 'Bench points', unit: 'count', values: [bw, bl], score: Math.abs(bw - bl) / 10, better: 'higher' });
  const picked = cand.filter((c) => c.score >= 0.5).sort((x, y) => y.score - x.score).slice(0, 5);
  if (picked.length >= 3) {
    out.push({ section: 'flow', spec: statCompare({
      id: 'team-separators', title: 'Where the game separated', subtitle: `The ${picked.length} team stats with the widest gaps`,
      caption: 'Selected by the size of each difference relative to a typical game-to-game gap for that stat. Descriptive, not a causal breakdown of the margin.',
      layout: 'mirror', columns: [{ key: 'w', label: nickOf(W), entity: { type: 'team', id: String(W.team_id) } }, { key: 'l', label: nickOf(L), entity: { type: 'team', id: String(L.team_id) } }],
      rows: picked.map(({ key, label, unit, values, better }) => ({ key, label, unit, values, better })),
      provenance: prov(a, { source: src, window: 'this game', game_id: g.game_id, entity_ids: ids, fact_family: 'team_box' })
    }) });
  }

  // 2b. Playoff series strip: every final game of this series through this one, from the bracket's own scores.
  const sg = f.playoff ? (f.series_games || []) : [];
  if (sg.length >= 2) {
    const wid = String(W.team_id);
    const items = sg.map((x) => {
      const home = x.home_team_id === wid;
      const us = home ? x.home_score : x.away_score; const them = home ? x.away_score : x.home_score;
      return { key: `g${x.game_number}`, label: `Game ${x.game_number} ${home ? 'vs' : 'at'} ${home ? x.away_abbr : x.home_abbr}`, result: x.winner_team_id === wid ? 'W' : 'L', value: us - them, meta: `${Math.max(us, them)}–${Math.min(us, them)}` };
    });
    const after = f.playoff.after || {};
    const a1 = n(after[wid]); const b1 = n(after[String(L.team_id)]);
    const state = a1 === null || b1 === null ? null : f.playoff.decided_by_this_game ? `${nickOf(W)} win the series ${a1}–${b1}` : a1 === b1 ? `Series tied ${a1}–${b1}` : `${nickOf(W)} lead the series ${a1}–${b1}`;
    out.push({ section: 'context', spec: gameStrip({
      id: 'series-strip', title: `${f.playoff.round} series`, subtitle: state || `Best of ${f.playoff.best_of}`,
      caption: `Each final game of the best-of-${f.playoff.best_of} series through this one, from the ${nickOf(W)} side; the number is the final margin.`,
      strips: [{ key: wid, label: nickOf(W), entity: { type: 'team', id: wid }, items }],
      provenance: prov(a, { source: 'PropBetEdge playoff bracket (final scores)', window: 'this series through this game', game_id: g.game_id, entity_ids: ids, fact_family: 'series' })
    }) });
  }

  // 3. The lead performer against her own entering baselines (frozen in the comparisons block).
  const c = (f.comparisons || []).find((x) => x.entering_line);
  const line = c ? [...(f.stars || []), ...(f.performers || [])].find((x) => String(x.athlete_id) === String(c.athlete_id)) : null;
  if (c && line) {
    const E = c.entering_line; const T = c.last10_line || null;
    const rows = rowsWith([
      { key: 'pts', label: 'Points', unit: 'per_game', values: [n(line.pts), r1(n(T?.pts)), r1(n(E.pts))] },
      { key: 'reb', label: 'Rebounds', unit: 'per_game', values: [n(line.reb), r1(n(T?.reb)), r1(n(E.reb))] },
      { key: 'ast', label: 'Assists', unit: 'per_game', values: [n(line.ast), r1(n(T?.ast)), r1(n(E.ast))] },
      { key: 'min', label: 'Minutes', unit: 'minutes', values: [n(line.min), r1(n(T?.min)), r1(n(E.min))] }
    ]);
    if (rows.length >= 3) {
      out.push({ section: 'performers', spec: statCompare({
        id: 'player-line', title: `${line.name}: ${gameNo} against her baselines`, subtitle: 'This game · her last 10 before it · her regular season entering it',
        caption: 'Baselines are her regular-season games before this one (ESPN game log). Playoff games are never mixed into them.',
        columns: [{ key: 'game', label: gameNo, sample: 1 }, { key: 'l10', label: 'Last 10', sample: n(T?.games) }, { key: 'season', label: 'Season', sample: n(E.games) }].map((col, i) => ({ ...col, sample: rows.some((r) => r.values[i] !== null) ? col.sample : null })),
        rows,
        provenance: prov(a, { source: `ESPN box score (game ${g.game_id}) and ESPN game log`, window: `entering ${dShort(g.start_utc)}`, game_id: g.game_id, entity_ids: [String(line.athlete_id)], fact_family: 'player_baselines' })
      }) });
    }
  }

  // 4. WinBA context, with the board's own date declared (the board is regular season; a playoff game is not in it).
  const star = (f.stars || [])[0];
  const wb = star?.winba;
  if (wb?.qualified && n(wb.score) !== null && wb.components && wb.generated_at) {
    const cp = wb.components;
    const rows = [['production_percentile', 'Production percentile', 'percentile', 45], ['win_rate', 'Win rate', 'percent', 25], ['winning_output_share', 'Winning-output share', 'percent', 20], ['court_share', 'Court share', 'percent', 10]]
      .map(([key, label, unit, weight]) => ({ key, label, unit, weight, value: n(cp[key]) })).filter((x) => x.value !== null);
    if (rows.length >= 3) {
      out.push({ section: 'performers', spec: componentBars({
        id: 'winba-context', title: `${star.name}'s WinBA Score`, subtitle: `${wb.rank ? `No. ${wb.rank} on the board of ${dShort(wb.generated_at)}` : `Board of ${dShort(wb.generated_at)}`}`,
        caption: `WinBA measures the regular season. This board is dated ${dShort(wb.generated_at)} and does not include ${f.playoff ? 'any playoff game' : 'games after that date'}.`,
        entity: { type: 'player', id: String(star.athlete_id), name: star.name }, total: n(wb.score), rows,
        provenance: prov(a, { source: `PropBetEdge WinBA Score board (${wb.version || 'winba'})`, window: `regular season through ${dShort(wb.generated_at)}`, game_id: g.game_id, entity_ids: [String(star.athlete_id)], fact_family: 'winba' })
      }), requirement: 'optional' });
    }
  }
  return out;
}

// ------------------------------------------------------------ previews

function previewVisuals(a) {
  const f = a.facts || {};
  const g = a.context?.game;
  if (!g?.home || !g?.away || !f.away || !f.home) return [];
  const A = f.away; const H = f.home;
  const out = [];
  const ids = [String(g.away.team_id), String(g.home.team_id)];
  const d = f.derived || {};
  const pair = (x, y) => [n(x), n(y)];
  const cand = [
    ['net', 'Net differential', 'signed_points', pair(A.standing?.differential, H.standing?.differential), 4, 'higher'],
    ['ppg', 'Points per game', 'team_per_game', pair(A.standing?.points_for_avg, H.standing?.points_for_avg), 4, 'higher'],
    ['oppg', 'Points allowed per game', 'team_per_game', pair(A.standing?.points_against_avg, H.standing?.points_against_avg), 4, 'lower'],
    ['ortg', 'Points per 100 possessions', 'per_100', pair(r1(n(d.away_pts_per_100)), r1(n(d.home_pts_per_100))), 4, 'higher'],
    ['pace', 'Possessions per game', 'possessions', pair(A.pace?.possessions_per_game, H.pace?.possessions_per_game), 3, null],
    ['fg', 'Field goal %', 'percent', pair(A.season_stats?.fieldGoalPct, H.season_stats?.fieldGoalPct), 2, 'higher'],
    ['oppfg', 'Opponent field goal %', 'percent', pair(A.season_stats?.opp_fieldGoalPct, H.season_stats?.opp_fieldGoalPct), 2, 'lower'],
    ['reb', 'Rebound differential', 'signed_points', pair(A.season_stats?.avgReboundsDifferential, H.season_stats?.avgReboundsDifferential), 2, 'higher'],
    ['l10', 'Average margin, last 10', 'signed_points', pair(A.form?.avg_margin_last10, H.form?.avg_margin_last10), 4, 'higher'],
    ['rest', 'Days of rest', 'days', pair(A.rest?.rest_days, H.rest?.rest_days), 1, null]
  ].filter((c) => c[3][0] !== null && c[3][1] !== null).map(([key, label, unit, values, norm, better]) => ({ key, label, unit, values: values.map((v) => r1(v)), score: Math.abs(values[0] - values[1]) / norm, better }));
  const net = cand.find((c) => c.key === 'net');
  const rest = cand.filter((c) => c.key !== 'net').sort((x, y) => y.score - x.score).slice(0, net ? 4 : 5);
  const rows = [...(net ? [net] : []), ...rest];
  if (rows.length >= 3) {
    out.push({ section: 'matchup', spec: statCompare({
      id: 'matchup-dashboard', title: `${nickOf(g.away)} vs. ${nickOf(g.home)}: the widest contrasts`, subtitle: 'Season team profile, plus recent form and rest',
      caption: 'Net differential always shown; the other rows are the largest gaps relative to a typical spread for each stat. Season rows are regular season; the last-10 margin counts the most recent games of each team, playoffs included. None is a projection.',
      layout: 'mirror', columns: [{ key: 'away', label: nickOf(g.away), entity: { type: 'team', id: ids[0] } }, { key: 'home', label: nickOf(g.home), entity: { type: 'team', id: ids[1] } }],
      rows: rows.map(({ key, label, unit, values, better }) => ({ key, label, unit, values, better })),
      provenance: prov(a, { source: 'wnba-api matchup research (ESPN standings, schedules, season team stats)', window: `season through ${dShort(observedAt(a))}`, game_id: g.game_id, entity_ids: ids, fact_family: 'matchup' })
    }) });
  }
  const strip = (T, team) => {
    const games = [...(T.form?.last10 || [])].filter((x) => n(x.pts) !== null && n(x.opp_pts) !== null).sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(-5);
    return games.length >= 3 ? { key: String(team.team_id), label: nickOf(team), entity: { type: 'team', id: String(team.team_id) }, items: games.map((x, i) => ({ key: `${i}-${x.date}`, label: `${dShort(x.date)} ${x.home_away === 'home' ? 'vs' : 'at'} ${x.opponent}`, result: x.pts > x.opp_pts ? 'W' : 'L', value: x.pts - x.opp_pts, meta: `${Math.max(x.pts, x.opp_pts)}–${Math.min(x.pts, x.opp_pts)}` })) } : null;
  };
  const strips = [strip(A, g.away), strip(H, g.home)].filter(Boolean);
  if (strips.length === 2) {
    out.push({ section: 'matchup', spec: gameStrip({
      id: 'recent-form', title: 'Last five games', subtitle: 'Oldest to newest; the number is the final margin',
      caption: 'Results from each team’s own schedule before this game.', strips,
      provenance: prov(a, { source: 'ESPN team schedules (final scores)', window: 'last five completed games', game_id: g.game_id, entity_ids: ids, fact_family: 'form' })
    }) });
  }
  return out;
}

// ------------------------------------------------------------ injuries

function injuryVisuals(a) {
  const f = a.facts || {};
  const s = f.season_log;
  const name = a.primary_subject || a.context?.player?.name || 'She';
  const pid = String(a.lead_player_id || '');
  const out = [];
  if (s?.games) {
    const L = s.last10 || null; const D = f.derived || {};
    const rows = rowsWith([
      { key: 'min', label: 'Minutes', unit: 'minutes', values: [r1(n(s.min)), r1(n(L?.min)), r1(n(D.recent_min))] },
      { key: 'pts', label: 'Points', unit: 'per_game', values: [r1(n(s.pts)), r1(n(L?.pts)), r1(n(D.recent_pts))] },
      { key: 'reb', label: 'Rebounds', unit: 'per_game', values: [r1(n(s.reb)), r1(n(L?.reb)), null] },
      { key: 'ast', label: 'Assists', unit: 'per_game', values: [r1(n(s.ast)), r1(n(L?.ast)), null] }
    ]);
    const recentN = (f.recent_games || []).length;
    if (rows.length >= 2) {
      out.push({ section: 'role', spec: statCompare({
        id: 'player-role', title: `${name}'s role`, subtitle: 'Regular season · last 10 · last logged games',
        caption: 'Per-game averages from her regular-season ESPN game log.',
        columns: [{ key: 'season', label: 'Season', sample: n(s.games) }, { key: 'l10', label: 'Last 10', sample: n(L?.games) }, { key: 'recent', label: `Last ${recentN || 5}`, sample: recentN >= 3 ? recentN : null }],
        rows,
        provenance: prov(a, { source: `ESPN game log (${s.season_name || 'regular season'})`, window: s.season_name || 'regular season', entity_ids: [pid], fact_family: 'player_season' })
      }) });
    }
  }
  const outNames = new Set([name, ...(f.other_out || []).map((x) => x.name)]);
  const rot = (f.rotation || []).filter((r) => r && r.name && !outNames.has(r.name) && n(r.min) !== null && (r.appearances ?? 0) > 0).sort((x, y) => y.min - x.min).slice(0, 6);
  if (rot.length >= 3) {
    out.push({ section: 'role', spec: groupedBars({
      id: 'rotation-minutes', title: 'Where the minutes are now', subtitle: 'Healthy players by minutes in the recent rotation window',
      caption: 'This shows current workload in the same box-score window the story uses. It is not a prediction of exact replacement minutes.',
      unit: 'minutes', series: [{ key: 'min', label: 'Minutes per game', short_label: 'MIN' }],
      rows: rot.map((r) => ({ key: String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: r.name, values: [r1(n(r.min))], meta: `${r.starts ?? 0} starts · ${r.appearances ?? 0} games` })),
      provenance: prov(a, { source: 'ESPN box scores (observed rotation window)', window: 'recent rotation window', entity_ids: [String(a.lead_team_id || '')], fact_family: 'rotation' })
    }) });
  }
  const D = f.derived || {};
  if (s && n(D.without_n) >= 3 && n(s.games) >= 3 && n(s.wins) !== null && n(D.without_w) !== null) {
    const pct = (w, l) => (w + l ? r1((100 * w) / (w + l)) : null);
    out.push({ section: 'role', spec: statCompare({
      id: 'with-without', title: `The team with and without ${name}`, subtitle: 'Regular-season record split',
      caption: 'Observed team results in the available sample; this is descriptive, not a causal estimate of the player\'s impact. The split mixes opponents, dates and every other lineup change.',
      columns: [{ key: 'with', label: 'With her', sample: n(s.games) }, { key: 'without', label: 'Without her', sample: n(D.without_n) }],
      rows: [
        { key: 'wins', label: 'Wins', unit: 'games', values: [n(s.wins), n(D.without_w)] },
        { key: 'losses', label: 'Losses', unit: 'games', values: [n(s.losses), n(D.without_l)] },
        { key: 'winpct', label: 'Win %', unit: 'percent', values: [pct(s.wins, s.losses), pct(D.without_w, D.without_l)] }
      ],
      provenance: prov(a, { source: 'ESPN game log and standings', window: s.season_name || 'regular season', entity_ids: [pid, String(a.lead_team_id || '')], fact_family: 'with_without' })
    }), requirement: 'optional' });
  }
  return out;
}

// ------------------------------------------------------------ transactions

function transactionVisuals(a) {
  const f = a.facts || {};
  const p = (f.profiles || []).find((x) => x.current?.games || x.prior?.games);
  if (!p) return [];
  const cur = p.current?.games ? p.current : null;
  const log = cur || p.prior;
  const L = log.last10 || null;
  const window = cur ? `${log.year} regular season` : `${log.year} regular season (most recent in the log)`;
  const rows = rowsWith([
    { key: 'pts', label: 'Points', unit: 'per_game', values: [r1(n(log.pts)), r1(n(L?.pts))] },
    { key: 'reb', label: 'Rebounds', unit: 'per_game', values: [r1(n(log.reb)), r1(n(L?.reb))] },
    { key: 'ast', label: 'Assists', unit: 'per_game', values: [r1(n(log.ast)), r1(n(L?.ast))] },
    { key: 'min', label: 'Minutes', unit: 'minutes', values: [r1(n(log.min)), r1(n(L?.min))] }
  ]);
  const out = [];
  if (rows.length >= 2) {
    out.push({ section: 'move', spec: statCompare({
      id: 'player-profile', title: `${p.name}'s ${cur ? 'season' : `${log.year}`} profile`, subtitle: window,
      caption: cur ? 'Per-game averages from her ESPN game log.' : `She has no current-season games in the log; these are ${log.year} numbers, not this season's.`,
      columns: [{ key: 'season', label: cur ? 'Season' : String(log.year), sample: n(log.games) }, { key: 'l10', label: 'Last 10', sample: n(L?.games) }],
      rows,
      provenance: prov(a, { source: `ESPN game log (${log.season_name || window})`, window, entity_ids: [String(p.athlete_id)], fact_family: 'player_season' })
    }) });
  }
  const rank = n(f.derived?.[`rank_${p.athlete_id}`]);
  const rot = (f.rotation || []).filter((r) => r && r.name !== p.name && n(r.min) !== null && (r.appearances ?? 0) > 0).sort((x, y) => y.min - x.min).slice(0, 7);
  if (cur && rank && rot.length >= 4 && n(cur.min) !== null) {
    const rows2 = [...rot.map((r) => ({ key: String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: r.name, values: [r1(n(r.min))], meta: 'recent rotation window' })), { key: 'incoming', label: `${p.name} (her season)`, values: [r1(n(cur.min))], meta: `season average · would rank No. ${rank}`, highlight: true }].sort((x, y) => y.values[0] - x.values[0]);
    out.push({ section: 'roster', spec: groupedBars({
      id: 'rotation-context', title: 'Where her minutes would rank', subtitle: 'Current rotation minutes, with her season average for context',
      caption: 'Two different windows: the rotation is the team\'s recent box scores; her bar is her season average. Context, not a prediction of her role.',
      unit: 'minutes', series: [{ key: 'min', label: 'Minutes per game', short_label: 'MIN' }], rows: rows2,
      provenance: prov(a, { source: 'ESPN box scores (observed rotation) and ESPN game log', window: 'recent rotation window; her season', entity_ids: [String(p.athlete_id), String(a.lead_team_id || '')], fact_family: 'rotation' })
    }), requirement: 'optional' });
  }
  return out;
}

// ------------------------------------------------------------ team trends

function trendVisuals(a) {
  const f = a.facts || {};
  const rows = [...(f.rows || [])].filter((r) => r && r.date).sort((x, y) => String(x.date).localeCompare(String(y.date)));
  if (rows.length < 5) return [];
  const total = a.market_type === 'total';
  const team = a.primary_subject || 'Team';
  const out = [];
  const label = (r) => `${dShort(r.date)} ${r.home ? 'vs' : 'at'} ${r.opp}`;
  out.push({ section: 'evidence', spec: gameStrip({
    id: 'trend-results', title: total ? 'Over or under, game by game' : 'Against the spread, game by game', subtitle: 'Oldest to newest',
    caption: 'Each game graded against the closing line the source record carries.',
    strips: [{ key: 'team', label: team, items: rows.map((r, i) => ({ key: `${i}-${r.date}`, label: label(r), result: total ? r.ou : r.ats === 'W' ? 'C' : r.ats === 'L' ? 'M' : 'P' })) }],
    provenance: prov(a, { source: 'ESPN game results with the relayed closing line', window: `last ${rows.length} games`, entity_ids: [String(a.lead_team_id || '')], fact_family: 'trend_rows' })
  }) });
  const vs = rows.map((r) => ({ r, v: total ? (n(r.total) !== null && n(r.total_line) !== null ? r.total - r.total_line : null) : (n(r.margin) !== null && n(r.spread) !== null ? r.margin + r.spread : null) })).filter((x) => x.v !== null);
  if (vs.length >= 5) {
    out.push({ section: 'evidence', spec: divergingBars({
      id: 'trend-vs-line', title: total ? 'Points against the total' : 'Result against the spread', subtitle: total ? 'Combined points minus the closing total' : 'Final margin plus the spread',
      caption: total ? 'Left of zero finished under the total; right of zero finished over.' : 'Right of zero beat the line; left of zero did not.',
      unit: 'signed_points', negativeLabel: total ? 'Under' : 'Missed', positiveLabel: total ? 'Over' : 'Covered', tone: total ? 'neutral' : 'signed',
      rows: vs.map(({ r, v }, i) => ({ key: `${i}-${r.date}`, label: label(r), value: r1(v) })),
      provenance: prov(a, { source: 'ESPN game results with the relayed closing line', window: `last ${vs.length} games`, entity_ids: [String(a.lead_team_id || '')], fact_family: 'trend_rows' })
    }) });
  }
  const d = f.derived || {}; const st = f.standing || {};
  const drv = total
    ? [['pts', 'Team points per game', n(d.avg_pts), n(st.points_for_avg)], ['opp', 'Opponent points per game', n(d.avg_opp_pts), n(st.points_against_avg)]]
    : [['margin', 'Average margin', n(d.avg_margin), n(st.differential)]];
  const drvRows = drv.filter(([, , now, season]) => now !== null && season !== null).map(([key, label, now, season]) => ({ key, label, unit: key === 'margin' ? 'signed_points' : 'team_per_game', values: [r1(now), r1(season)], shift: now - season }));
  if (drvRows.length >= (total ? 2 : 1) && drvRows.length >= 1) {
    const big = [...drvRows].sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift))[0];
    const rowsOut = drvRows.map(({ shift, ...r }) => r);
    if (rowsOut.length >= 2) {
      out.push({ section: 'evidence', spec: statCompare({
        id: 'trend-drivers', title: 'The basketball under the trend', subtitle: `This ${rows.length}-game run against the season`,
        caption: `The largest descriptive shift in this sample is ${big.label.toLowerCase()}, ${big.shift > 0 ? 'up' : 'down'} ${Math.abs(r1(big.shift))} from the season mark. A shift is not a cause.`,
        columns: [{ key: 'run', label: 'This run', sample: rows.length }, { key: 'season', label: 'Season' }],
        rows: rowsOut,
        provenance: prov(a, { source: 'ESPN game results and standings', window: `last ${rows.length} games vs season`, entity_ids: [String(a.lead_team_id || '')], fact_family: 'trend_drivers' })
      }) });
    }
  }
  return out;
}

// ------------------------------------------------------------ news briefs

function briefVisuals(a) {
  const v = a.facts?.brief?.verified || {};
  const s = v.season;
  const pl = (a.entities || []).find((e) => e?.type === 'player' && String(e.id) === String(a.lead_player_id));
  if (!s?.games || !s.last5 || !pl) return [];
  const rows = rowsWith([
    { key: 'pts', label: 'Points', unit: 'per_game', values: [r1(n(s.pts)), r1(n(s.last5.pts))] },
    { key: 'ast', label: 'Assists', unit: 'per_game', values: [r1(n(s.ast)), r1(n(s.last5.ast))] },
    { key: 'min', label: 'Minutes', unit: 'minutes', values: [r1(n(s.min)), r1(n(s.last5.min))] }
  ]);
  if (rows.length < 2) return [];
  return [{ section: 'records', spec: statCompare({
    id: 'player-season', title: `${pl.name}'s season line`, subtitle: `${s.season_name || 'Regular season'} · last five games`,
    caption: 'Per-game averages from her regular-season ESPN game log.',
    columns: [{ key: 'season', label: 'Season', sample: n(s.games) }, { key: 'l5', label: 'Last 5', sample: n(s.last5.games) }], rows,
    provenance: prov(a, { source: `ESPN game log (${s.season_name || 'regular season'})`, window: s.season_name || 'regular season', entity_ids: [String(pl.id)], fact_family: 'player_season' })
  }), requirement: 'optional' }];
}

// ------------------------------------------------------------ international (WNBA-connection games)

function internationalVisuals(a) {
  const g = a.facts?.game;
  if (!g?.winner || !g?.loser) return [];
  const out = [];
  const W = g.winner; const L = g.loser;
  const q = (g.quarters || []).filter((x) => n(x.winner) !== null && n(x.loser) !== null);
  const src = `${g.competition?.name || 'FIBA'} box score (${g.provenance?.source || 'official game record'})`;
  if (q.length >= 4) {
    const swing = [...q].sort((x, y) => y.diff - x.diff)[0];
    out.push({ section: 'flow', spec: groupedBars({
      id: 'intl-game-flow', title: 'Scoring by quarter', subtitle: `${W.name} ${W.score}, ${L.name} ${L.score}${g.round?.name ? ` · ${g.round.name}` : ''}`,
      caption: `Margin = ${W.name} points minus ${L.name} points in each period. The largest margin was Q${swing.q} (${swing.diff > 0 ? '+' : ''}${swing.diff}).`,
      unit: 'points', series: [{ key: 'w', label: W.name, short_label: W.code || W.name }, { key: 'l', label: L.name, short_label: L.code || L.name }],
      rows: q.map((x) => ({ key: `q${x.q}`, label: x.q > 4 ? `OT${x.q - 4 > 1 ? x.q - 4 : ''}` : `Q${x.q}`, values: [x.winner, x.loser], delta: x.winner - x.loser, highlight: x === swing })),
      provenance: prov(a, { source: src, window: 'this game', entity_ids: [String(W.team_id), String(L.team_id)], fact_family: 'intl_linescore' })
    }) });
  }
  // The WNBA connection: her line in this game against her EARLIER GAMES IN THIS TOURNAMENT — never her WNBA season.
  const p = (g.wnba || []).find((x) => x.prior?.games >= 2 && n(x.pts) !== null);
  if (p) {
    const rows = rowsWith([
      { key: 'pts', label: 'Points', unit: 'per_game', values: [n(p.pts), r1(n(p.prior.pts))] },
      { key: 'reb', label: 'Rebounds', unit: 'per_game', values: [n(p.reb), r1(n(p.prior.reb))] },
      { key: 'ast', label: 'Assists', unit: 'per_game', values: [n(p.ast), r1(n(p.prior.ast))] }
    ]);
    if (rows.length >= 2) {
      out.push({ section: 'wnba', spec: statCompare({
        id: 'intl-wnba-player', title: `${p.name} (${p.wnba?.team || 'WNBA'}) for ${p.team}`, subtitle: 'This game · her earlier games in this tournament',
        caption: 'The comparison is her own earlier games at this tournament, not her WNBA season.',
        columns: [{ key: 'game', label: 'This game', sample: 1 }, { key: 'prior', label: 'Earlier games', sample: n(p.prior.games) }], rows,
        provenance: prov(a, { source: src, window: 'this tournament', entity_ids: [String(p.espn_id || p.player_id)], fact_family: 'intl_player' })
      }), requirement: 'optional' });
    }
  }
  return out;
}

const BUILDERS = { international: internationalVisuals, result: resultVisuals, performance: resultVisuals, preview: previewVisuals, injury: injuryVisuals, transaction: transactionVisuals, trend: trendVisuals, brief: briefVisuals };

/**
 * Build, validate and place the article's visuals. Mutates `a`: sets `a.visuals` (valid specs only), places each id on
 * the section whose key it explains (`section.visuals`), and records dropped charts in `a.visual_failures`. Returns the
 * failures of ESSENTIAL visuals (the caller holds the story on those).
 */
export function attachNewsroomVisuals(a) {
  const build = BUILDERS[a.kind];
  if (!build || !Array.isArray(a.sections) || !a.sections.length) return [];
  let built = [];
  try { built = build(a) || []; } catch (e) { a.visual_failures = [`visual builder: ${String(e?.message || e).slice(0, 160)}`]; return []; }
  const keep = [];
  const dropped = [];
  const essential = [];
  for (const { section, spec, requirement } of built) {
    if (!spec) continue;
    const s = { ...spec, requirement: requirement || spec.requirement || 'supporting' };
    const fail = visualFailures(s);
    if (fail.length) { (s.requirement === 'essential' ? essential : dropped).push(...fail); continue; }
    keep.push({ section, spec: s });
  }
  a.visuals = keep.map((x) => x.spec);
  a.visuals_version = VISUALS_VERSION;
  a.newsroom_visuals = NEWSROOM_VISUALS_VERSION;
  if (dropped.length) a.visual_failures = dropped.slice(0, 12);
  const keyed = a.sections.map((s, i) => ({ s, k: sectionKey(s, i) }));
  for (const { section, spec } of keep) {
    const home = keyed.find((x) => x.k === section)?.s || keyed.find((x) => x.s.title)?.s || a.sections[0];
    home.visuals = [...(home.visuals || []), spec.id];
  }
  return essential;
}
