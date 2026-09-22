// PropBetEdge WNBA Newsroom — synthesis generators (wnba-articles/1.2.0).
//
// Same records, same publication gate (gate.js, unchanged), plus the reconcile checks (reconcile.js) — but each
// story is written as an argument: a read, the evidence for it, the evidence against it, and what is unknown.
// ONE deterministic structure per story class; no prose variation.
//
// Rules kept by construction:
//   * every number is in a cited record or is arithmetic over cited records, written to facts.derived;
//   * player stats carry facts.provenance {season_name, year, team, games}; "this season" only for the
//     current WNBA regular season; a prior season is named with its year and team; postseason never mixes in;
//   * absence effects are observed (box scores of games actually missed), never assumed; an absence the team
//     has already played through is described as such, never as minutes that "have to be absorbed";
//   * a team's injury situation is described from the FULL current ESPN feed, every listing named;
//   * ESPN return dates appear only as "ESPN’s estimated return date", with the feed-update date, never as a
//     statement that a player will play; ESPN injury-comment text is never used;
//   * rest is the source's rest_days (whole days between tips), never a derived calendar count;
//   * market numbers are "market consensus" or a named sportsbook, never a PropBetEdge projection, and each
//     story's bettor analysis leads with the market it is about (market_type).

import { finalize, marketText, standingText, nextGame, gameEntity, hashId } from './articles.js';
import { dShort, dLong, dMonth, etDate, tET, f1, sgn, am, listJoin, nick, full, poss, cap, wordN, countOf, statAvg, avg, etDays, aan, sc, clockOf, periodOf, QUARTER } from './prose.js';
import { coLeaders, CO_LEADER_RULE } from './reconcile.js';

// The synthesis generators ship as part of the article engine; ARTICLE_VERSION in articles.js is the
// single version stamp (wnba-articles/1.2.0: deeper evidence synthesis, reconciliation, temporal
// safeguards, sectioned structure).
export { ARTICLE_VERSION as DEEP_VERSION } from './articles.js';

const BOOKS = { draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', betrivers: 'BetRivers', fanatics: 'Fanatics', bovada: 'Bovada', williamhill_us: 'Caesars', lowvig: 'LowVig', betonlineag: 'BetOnline', espnbet: 'ESPN BET' };
const book = (k) => BOOKS[k] || k;
const recWL = (w, l) => `${w}-${l}`;
const pctOf = (a, b) => (b ? (100 * a) / b : null);
const stripNotes = (x) => { if (!x) return x; const { short_comment, long_comment, photo, authority_note, ...r } = x; return r; };
const nameByAbbr = (teams) => { const m = new Map(); for (const t of teams || []) if (t?.abbr) m.set(t.abbr, t.short_name || t.name); return (ab) => (m.has(ab) ? `the ${m.get(ab)}` : ab); };
const meterOf = (ctx) => (ctx.meter ? ctx.meter : () => ({ issued: 0, fetched: 0 }));
const meterDelta = (m, t0) => { const t1 = m(); return { issued: t1.issued - t0.issued, fetched: t1.fetched - t0.fetched }; };
const feedFor = (injuries, teamId) => (injuries || []).filter((x) => String(x.team_id) === String(teamId));

function assemble(sections) {
  const body = [];
  const map = [];
  for (const [title, paras] of sections) {
    const ps = (paras || []).filter(Boolean);
    if (!ps.length) continue;
    map.push({ title, first: body.length, count: ps.length });
    body.push(...ps);
  }
  return { body, sections: map };
}

// ------------------------------------------------------------ availability: what the feed's own dates say

/** Split a team's feed listings by what ESPN's own dates say about THIS game. */
export function classifyAvailability(list, gameStartUtc) {
  const gameDay = gameStartUtc ? etDate(gameStartUtc) : null;
  const out = { long: [], gameDay: [], before: [], later: [], undated: [] };
  for (const x of list || []) {
    const ofs = /OFS/i.test(x.fantasy_status || '');
    const rd = x.source_return_date || null;
    const farOut = rd && gameStartUtc && Date.parse(rd) - Date.parse(gameStartUtc) > 30 * 86400e3;
    if (ofs || farOut) out.long.push(x);
    else if (!rd || !gameDay) out.undated.push(x);
    else if (rd === gameDay) out.gameDay.push(x);
    else if (rd < gameDay) out.before.push(x);
    else out.later.push(x);
  }
  return out;
}
const yearOf = (d) => d.slice(0, 4);
const rdText = (x, refYear) => `${dMonth(`${x.source_return_date}T16:00:00Z`)}${yearOf(x.source_return_date) !== String(refYear) ? `, ${yearOf(x.source_return_date)}` : ''}`;
/** "out for the season" or "ESPN’s estimated return date May 1, 2027" — always with the feed-update date. */
export function listingPhrase(x, refYear) {
  const upd = `feed updated ${dShort(x.source_updated_at)}`;
  if (/OFS/i.test(x.fantasy_status || '')) return `${x.name} (${x.status}, out for the season; ${upd})`;
  if (x.source_return_date) return `${x.name} (${x.status}; ESPN’s estimated return date ${rdText(x, refYear)}; ${upd})`;
  return `${x.name} (${x.status}; no return date on the feed; ${upd})`;
}

/**
 * Box-score observation for games in the rotation window that a player missed. Only a single missed game is
 * read as "who replaced her"; several missed games pile up other lineup changes, so the text then says only
 * that the window already reflects the absence. Observation, not a published lineup.
 */
async function observedAbsence(api, rot, teamId, athleteId) {
  const row = rot?.rows?.find((r) => r.athlete_id === athleteId);
  const ids = rot?.games || [];
  if (!row || !ids.length || row.appearances === 0 || row.appearances >= ids.length) return null;
  const boxes = [];
  for (const gid of ids) {
    const live = await api(`/v1/games/${gid}/live`);
    if (live?.box?.players) boxes.push({ gid, date: live.game?.start_utc, opp: live.game?.home?.team_id === teamId ? live.game.away : live.game?.home, players: live.box.players.filter((p) => p.team_id === teamId) });
  }
  const played = (b, id) => b.players.some((p) => p.athlete_id === id && !p.dnp && p.min);
  const missed = boxes.filter((b) => !played(b, athleteId));
  if (!missed.length) return null;
  const others = boxes.filter((b) => played(b, athleteId));
  const usual = new Set((rot.rows || []).filter((r) => r.starts >= Math.ceil(ids.length / 2)).map((r) => r.athlete_id));
  const avgMin = (id, set) => avg(set.map((b) => b.players.find((p) => p.athlete_id === id && !p.dnp)?.min).filter((v) => Number.isFinite(v)));
  const games = missed.map((b) => {
    const fill = b.players.filter((p) => p.starter && !usual.has(p.athlete_id) && p.athlete_id !== athleteId);
    const gains = b.players.filter((p) => !p.dnp && p.min && p.athlete_id !== athleteId).map((p) => ({ name: p.name, athlete_id: p.athlete_id, min: p.min, base: avgMin(p.athlete_id, others) })).filter((x) => Number.isFinite(x.base)).map((x) => ({ ...x, gain: x.min - x.base })).sort((a, b) => b.gain - a.gain);
    return { game_id: b.gid, date: b.date, opp: b.opp, fill_starters: fill.map((p) => ({ name: p.name, athlete_id: p.athlete_id, min: p.min, base: avgMin(p.athlete_id, others) })), top_gain: gains[0] || null };
  });
  return { player: row.name, athlete_id: athleteId, window: ids.length, missed: missed.length, was_usual_starter: usual.has(athleteId), row_min: row.min, games };
}

function absenceSentence(obs, teamNick, D, key) {
  if (!obs) return null;
  const g = obs.games;
  const first = g[0];
  if (!obs.was_usual_starter && Number.isFinite(obs.row_min) && obs.row_min < 10) return null;
  if (g.length > 1) return `${obs.player} appeared in ${wordN(obs.window - obs.missed)} of the ${poss(teamNick)} last ${wordN(obs.window)} games, so the rotation in that window already reflects her absence.`;
  let s = `The ${teamNick} have already played one game of their last ${wordN(obs.window)} without ${obs.player} (${dMonth(first.date)} against the ${nick(first.opp)}).`;
  const fills = first.fill_starters.filter((f) => Number.isFinite(f.base));
  if (obs.was_usual_starter && fills.length) {
    const f = fills[0];
    D[`${key}_fill_min`] = f.min; D[`${key}_fill_base`] = f.base;
    s += ` ${f.name}, who does not usually start, started that game and played ${f.min} minutes, against ${f1(f.base)} a game in the other ${wordN(obs.window - obs.missed)} games of the window.`;
  } else if (first.top_gain && first.top_gain.gain >= 4) {
    const t = first.top_gain;
    D[`${key}_gain_min`] = t.min; D[`${key}_gain_base`] = t.base;
    s += ` The largest minutes increase in that game was ${poss(t.name)}: ${t.min}, against ${f1(t.base)} a game in the other ${wordN(obs.window - obs.missed)}.`;
  } else return null;
  return `${s} That is box-score observation, not a published lineup.`;
}

/** Games a team finished after a date, and its record in them (team schedule, regular season only). */
function teamSince(schedule, teamId, sinceIso, year, regIds = null) {
  const gs = (schedule || []).filter((g) => g.status?.state === 'post' && g.status?.completed && (!year || g.season?.year === year) && (!regIds || regIds.has(String(g.game_id))) && Date.parse(g.start_utc) > Date.parse(sinceIso) + 3600e3);
  let w = 0;
  let l = 0;
  for (const g of gs) { const us = g.home.team_id === teamId ? g.home : g.away; if (us.winner) w += 1; else l += 1; }
  return { n: gs.length, w, l };
}

/**
 * A team's record and scoring from its schedule, through (or before) a moment. Regular season only: a team
 * schedule carries preseason games with the same season.year, so the regular-season game ids are passed in
 * (built from the league schedule, where season.type === 2).
 */
function teamAsOf(schedule, teamId, iso, { inclusive = true, regIds = null } = {}) {
  const t = Date.parse(iso);
  const gs = (schedule || []).filter((g) => g.status?.state === 'post' && g.status?.completed && (!regIds || regIds.has(String(g.game_id))) && (inclusive ? Date.parse(g.start_utc) <= t : Date.parse(g.start_utc) < t) && g.season?.year === new Date(iso).getUTCFullYear());
  let w = 0; let l = 0; let pf = 0; let pa = 0;
  for (const g of gs) { const us = g.home.team_id === teamId ? g.home : g.away; const them = us === g.home ? g.away : g.home; if (us.winner) w += 1; else l += 1; pf += us.score || 0; pa += them.score || 0; }
  return { games: gs.length, w, l, ppg: gs.length ? pf / gs.length : null, papg: gs.length ? pa / gs.length : null };
}

/**
 * A player's regular-season game log for the current season (optionally only games before a moment), else
 * the most recent regular season with its year and team. Season identity comes from the game log's own season
 * name ("2026 Regular Season") and dates — wnba-api's recent.season has no year and is never used for prose.
 */
export function seasonLog(pRes, year, teamById, { before = null } = {}) {
  const seasons = pRes?.gamelog?.seasons || [];
  const reg = (s) => /Regular Season$/.test(s?.name || '');
  const cur = seasons.find((s) => s.name === `${year} Regular Season`) || null;
  const latestPrior = seasons.filter((s) => reg(s) && Number(s.name.slice(0, 4)) < year).sort((a, b) => b.name.localeCompare(a.name))[0] || null;
  const summarize = (s, cut) => {
    if (!s?.games?.length) return null;
    const gs = s.games.filter((x) => x.min && (!cut || Date.parse(x.date) < Date.parse(cut)));
    if (!gs.length) return null;
    const y = Number(s.name.slice(0, 4));
    const datesOk = gs.every((x) => { const gy = Number(etDate(x.date).slice(0, 4)); return gy === y; });
    const teamId = gs[0]?.team_id || null;
    const last10 = gs.slice(0, 10);
    return {
      season_name: s.name, year: y, dates_match_year: datesOk, games: gs.length,
      min: avg(gs.map((x) => x.min)), pts: avg(gs.map((x) => x.pts)), reb: avg(gs.map((x) => x.reb)), ast: avg(gs.map((x) => x.ast)),
      last10: gs.length > 10 ? { games: last10.length, min: avg(last10.map((x) => x.min)), pts: avg(last10.map((x) => x.pts)), reb: avg(last10.map((x) => x.reb)), ast: avg(last10.map((x) => x.ast)) } : null,
      last_date: gs[0]?.date || null, team_id: teamId, team_name: teamById?.get(String(teamId))?.name || null,
      wins: gs.filter((x) => x.result === 'W').length, losses: gs.filter((x) => x.result === 'L').length
    };
  };
  return { current: summarize(cur, before), prior: summarize(latestPrior, null) };
}
const prov = (name, s, stat) => (s ? { name, stat, season_name: s.season_name, year: s.year, team: s.team_name, games: s.games, pts: s.pts, min: s.min, reb: s.reb } : null);

// ------------------------------------------------------------ 1. previews

export async function previewDeep(ctx) {
  const { api, upcoming, injuries, now } = ctx;
  const deepResearch = ctx.deepResearch !== false;
  const historical = Boolean(ctx.historical);
  const meter = meterOf(ctx);
  const out = [];
  const tn = nameByAbbr(ctx.teams);
  for (const g0 of upcoming) {
    const t0 = meter();
    const m = await api(`/v1/matchups/${g0.game_id}`);
    if (!m) continue;
    const g = m.game;
    const year = g.season?.year;
    const [A, H] = m.teams;
    const mk = m.market_summary;
    const D = {};
    const a = A.team.short_name;
    const h = H.team.short_name;
    const venue = g.venue?.name ? ` at ${g.venue.name}` : '';
    const hasLine = mk?.spread?.home_line !== null && mk?.spread?.home_line !== undefined;
    const fav = hasLine ? (mk.spread.home_line < 0 ? H : mk.spread.home_line > 0 ? A : null) : null;
    const dog = fav ? (fav === H ? A : H) : null;
    const line = fav ? Math.abs(mk.spread.home_line) : null;
    // No standings archive exists: a historical run has no standings for that date and says less.
    const standingOf = (t) => (historical ? null : t.standing || null);
    const diffOf = (t) => standingOf(t)?.differential ?? null;
    const recentOf = (t) => t.form?.avg_margin_last10 ?? null;
    const seasonGap = fav && diffOf(fav) !== null && diffOf(dog) !== null ? (D.season_diff_gap = diffOf(fav) - diffOf(dog)) : null;
    const recentGap = fav && recentOf(fav) !== null && recentOf(dog) !== null ? (D.recent_margin_gap = recentOf(fav) - recentOf(dog)) : null;
    const ortg = (t) => (t.pace?.possessions_per_game ? 100 * t.pace.points_per_game / t.pace.possessions_per_game : null);
    D.away_pts_per_100 = ortg(A); D.home_pts_per_100 = ortg(H);
    const formTotals = (t) => (t.form?.last10 || []).map((x) => x.pts + x.opp_pts);
    D.away_last10_avg_game_total = avg(formTotals(A)); D.home_last10_avg_game_total = avg(formTotals(H));
    if (standingOf(A) && standingOf(H)) { D.combined_season_ppg = standingOf(A).points_for_avg + standingOf(H).points_for_avg; }
    const threshold = line !== null ? (D.cover_threshold = Math.floor(line) + 1) : null;
    const favBigWins = fav ? (fav.form?.last10 || []).filter((x) => x.pts - x.opp_pts >= threshold) : [];
    const dogBigLosses = dog ? (dog.form?.last10 || []).filter((x) => x.opp_pts - x.pts >= threshold) : [];
    D.fav_big_wins = favBigWins.length; D.dog_big_losses = dogBigLosses.length;
    const worst = (t) => [...(t.form?.last10 || [])].sort((x, y) => (x.pts - x.opp_pts) - (y.pts - y.opp_pts))[0];
    const favWorst = fav ? worst(fav) : null;
    if (favWorst) D.fav_worst_margin = favWorst.opp_pts - favWorst.pts;

    // --- availability, from the FULL current feed (not the matchup payload's copy)
    const feedUnknown = historical || !injuries;
    const feeds = { a: feedUnknown ? [] : feedFor(injuries, A.team.team_id), h: feedUnknown ? [] : feedFor(injuries, H.team.team_id) };
    const av = { a: classifyAvailability(feeds.a, g.start_utc), h: classifyAvailability(feeds.h, g.start_utc) };
    const rowOf = (t, id) => t.rotation?.rows?.find((r) => r.athlete_id === id);
    const lostLong = (t, c) => c.long.map((x) => rowOf(t, x.athlete_id)).filter((r) => r && r.appearances > 0);
    const lostLongA = lostLong(A, av.a); const lostLongH = lostLong(H, av.h);
    const availParas = [];
    if (feedUnknown) {
      availParas.push(`ESPN’s injury feed is not archived for ${dMonth(ctx.asOf || new Date(now).toISOString())}, so this preview does not describe availability for either team.`);
    } else {
      for (const [t, c, lost, key, feed] of [[A, av.a, lostLongA, 'away', feeds.a], [H, av.h, lostLongH, 'home', feeds.h]]) {
        const n = nick(t.team);
        if (!feed.length) { availParas.push(`The ${n} have no one on ESPN’s injury feed.`); continue; }
        const segs = [];
        if (c.long.length) segs.push(`Out long-term: ${listJoin(c.long.map((x) => listingPhrase(x, year)))}.`);
        if (c.gameDay.length) segs.push(`Listed with ESPN’s estimated return date of ${dMonth(g.start_utc)}, the day of this game: ${listJoin(c.gameDay.map((x) => `${x.name} (${x.status}; feed updated ${dShort(x.source_updated_at)})`))} — ESPN’s estimates, not confirmations.`);
        if (c.before.length) segs.push(`Listed with an ESPN estimated return date before this game: ${listJoin(c.before.map((x) => listingPhrase(x, year)))}.`);
        if (c.later.length) segs.push(`Listed with an ESPN estimated return date after this game: ${listJoin(c.later.map((x) => listingPhrase(x, year)))}.`);
        if (c.undated.length) segs.push(`Listed without a return date: ${listJoin(c.undated.map((x) => `${x.name} (${x.status}; feed updated ${dShort(x.source_updated_at)})`))}.`);
        let p = `ESPN’s injury feed lists ${countOf(feed.length, `${n} player`, `${n} players`)}. ${segs.join(' ')}`;
        const unabsorbed = lost.filter((r) => r.appearances === t.rotation.games.length);
        if (unabsorbed.length) {
          D[`${key}_unabsorbed_min`] = unabsorbed.reduce((s, r) => s + r.min, 0);
          const starters = unabsorbed.filter((r) => r.starts === t.rotation.games.length);
          p += ` ${listJoin(unabsorbed.map((r) => `${r.name} (${f1(r.min)} minutes, ${r.starts ? countOf(r.starts, 'start') : 'no starts'})`))} played every game of the ${poss(n)} last ${wordN(t.rotation.games.length)}, so no box score yet shows who absorbs ${unabsorbed.length === 1 ? 'those' : `those ${f1(D[`${key}_unabsorbed_min`])}`} minutes${starters.length ? ` or fills ${starters.length === 1 ? 'the starting spot' : 'the starting spots'}` : ''}.`;
          const posGroup = new Set(unabsorbed.map((r) => (/G/.test(r.position || '') ? 'G' : 'FC')));
          const outIds = new Set(feed.map((x) => x.athlete_id));
          const healthy = t.rotation.rows.filter((r) => !outIds.has(r.athlete_id) && r.appearances > 0 && [...posGroup].some((pg) => (pg === 'G' ? /G/.test(r.position || '') : /[FC]/.test(r.position || ''))));
          if (healthy.length) p += ` The healthy ${[...posGroup].map((pg) => (pg === 'G' ? 'guards' : 'forwards and centers')).join(' and ')} who played in that window: ${listJoin(healthy.slice(0, 5).map((r) => `${r.name} (${f1(r.min)} min)`))}; how the minutes divide among them is not yet observed.`;
        }
        availParas.push(p);
        if (deepResearch) {
          for (const x of [...c.long, ...c.gameDay, ...c.before, ...c.later, ...c.undated]) {
            const obs = await observedAbsence(api, t.rotation, t.team.team_id, x.athlete_id);
            const s = absenceSentence(obs, n, D, `${key}_${x.athlete_id}`);
            if (s) availParas.push(s);
          }
        }
      }
    }
    const gd = [...av.a.gameDay, ...av.h.gameDay];

    // --- the matchup, compared
    const sa = A.season_stats || null;
    const sh = H.season_stats || null;
    const cmp = [];
    if (standingOf(A) && standingOf(H)) { const sA = standingOf(A); const sH = standingOf(H); cmp.push(`Over the full season the ${a} (${sA.wins}-${sA.losses}) score ${f1(sA.points_for_avg)} points a game and allow ${f1(sA.points_against_avg)}, a ${sgn(sA.differential)} differential; the ${h} (${sH.wins}-${sH.losses}) score ${f1(sH.points_for_avg)} and allow ${f1(sH.points_against_avg)}, ${sgn(sH.differential)}.${sA.road && sH.home ? ` The ${a} are ${sA.road} on the road; the ${h} are ${sH.home} at home.` : ''}`); }
    if (A.pace && H.pace && D.away_pts_per_100 && D.home_pts_per_100) {
      const faster = A.pace.possessions_per_game >= H.pace.possessions_per_game ? A : H;
      const slower = faster === A ? H : A;
      const close = Math.abs(A.pace.possessions_per_game - H.pace.possessions_per_game) <= 3;
      cmp.push(`${close ? 'Pace is close' : 'The pace differs'} — an estimated ${f1(faster.pace.possessions_per_game)} possessions a game for the ${nick(faster.team)}, ${f1(slower.pace.possessions_per_game)} for the ${nick(slower.team)}${close ? ' — so the scoring gap is efficiency, not pace' : ''}: the ${a} score about ${f1(D.away_pts_per_100)} points per 100 possessions, the ${h} ${f1(D.home_pts_per_100)} (points per game divided by estimated possessions).`);
    }
    if (sa && sh && Number.isFinite(sa.fieldGoalPct) && Number.isFinite(sh.fieldGoalPct) && Number.isFinite(sa.opp_fieldGoalPct) && Number.isFinite(sh.opp_fieldGoalPct)) {
      const rebA = sa.avgReboundsDifferential; const rebH = sh.avgReboundsDifferential;
      const dsS = dog === H ? sh : sa; const fvS = dog === H ? sa : sh;
      const dogDefEdge = dog && dsS.opp_fieldGoalPct < fvS.opp_fieldGoalPct;
      const reb = (v) => (Math.abs(v) < 0.05 ? 'even' : `${sgn(v)} a game`);
      cmp.push(`The ${a} shoot ${f1(sa.fieldGoalPct)}% and hold opponents to ${f1(sa.opp_fieldGoalPct)}%; the ${h} shoot ${f1(sh.fieldGoalPct)}% and allow ${f1(sh.opp_fieldGoalPct)}%.${Number.isFinite(rebA) && Number.isFinite(rebH) ? ` On the glass the ${a} are ${reb(rebA)} and the ${h} ${reb(rebH)} (ESPN season team stats).` : ''}${dogDefEdge ? ` The ${poss(nick(dog.team))} defense is the one place the season numbers favor them: opponents shoot ${f1(dsS.opp_fieldGoalPct)}% against them, lower than the ${f1(fvS.opp_fieldGoalPct)}% the ${nick(fav.team)} allow.` : ''}`);
    }
    if (recentOf(A) !== null && recentOf(H) !== null) {
      const wA = worst(A); const wH = worst(H);
      const verb = recentGap !== null && seasonGap !== null ? (Math.abs(recentGap) < Math.abs(seasonGap) ? 'narrows' : 'widens') : 'adds to';
      cmp.push(`Recent form ${verb} that picture: the ${a} are ${A.form.record_last10} over their last ${A.form.sample} with a ${sgn(recentOf(A))} average margin, the ${h} ${H.form.record_last10} at ${sgn(recentOf(H))}.${wA && wA.opp_pts > wA.pts ? ` The ${poss(a)} worst result in that stretch was ${aan(wA.opp_pts)} ${sc(wA.opp_pts, wA.pts)} loss ${wA.home_away === 'home' ? 'at home to' : 'at'} ${tn(wA.opponent)} on ${dMonth(wA.date)}.` : ''}${wH && wH.opp_pts > wH.pts ? ` The ${poss(h)} was ${sc(wH.opp_pts, wH.pts)} ${wH.home_away === 'home' ? 'at home to' : 'at'} ${tn(wH.opponent)} on ${dMonth(wH.date)}.` : ''}`);
    }
    const rest = [A, H].map((t) => t.schedule_context);
    D.rest_note = 'rest_days = whole days between the previous tip and this tip (wnba-api schedule_context)';
    if (Number.isFinite(rest[0]?.rest_days) && Number.isFinite(rest[1]?.rest_days) && rest[0].previous_game && rest[1].previous_game) {
      const same = Math.abs(rest[0].rest_days - rest[1].rest_days) <= 1;
      cmp.push(`${same ? 'Rest does not separate them' : `Rest favors the ${rest[0].rest_days > rest[1].rest_days ? a : h}`}: the ${a} come in on ${rest[0].rest_days} days of rest after their last game on ${dMonth(rest[0].previous_game.date)}, the ${h} on ${rest[1].rest_days} days after ${dMonth(rest[1].previous_game.date)} (ESPN schedule, whole days between tips).${same && rest[0].rest_days >= 7 ? ' The records do not measure what a layoff that long does to either team.' : ''}`);
    }
    let series = [];
    if (m.season_series?.[0]?.summary && deepResearch) {
      const hs = await api(`/v1/teams/${H.team.team_id}`);
      series = (hs?.schedule || []).filter((x) => x.status?.state === 'post' && x.season?.year === year && [x.home.team_id, x.away.team_id].includes(A.team.team_id) && Date.parse(x.start_utc) < Date.parse(g.start_utc)).sort((x, y) => y.start_utc.localeCompare(x.start_utc));
    }
    if (m.season_series?.[0]?.summary) {
      cmp.push(series.length
        ? `Season series: ${series.length === 1 ? 'one meeting so far — ' : `${m.season_series[0].summary}: `}${series.slice(0, 3).map((x) => { const w = x.home.winner ? x.home : x.away; const l = w === x.home ? x.away : x.home; return `the ${w.short_name || w.abbr} won ${sc(w.score, l.score)} ${w === x.home ? 'at home' : `in ${x.home.location || x.home.abbr}`} on ${dMonth(x.start_utc)}`; }).join('; ')}.`
        : `Season series: ${m.season_series[0].summary}.`);
    }

    // --- the market: FACTS only (price, consensus, dispersion, stored movement, freshness). What the records say about
    // that price is PropBetEdge Intelligence's job (bettor copy below), never repeated here.
    const mkt = [];
    const counter = [];
    const intel = [];
    const hist = mk?.odds_event_id && !historical && deepResearch ? ((await api(`/v1/odds?event=${mk.odds_event_id}`))?.history || []) : [];
    const updatesAfter = mk && !feedUnknown ? [...feeds.a, ...feeds.h].filter((x) => Date.parse(x.source_updated_at) > Date.parse(mk.captured_at)) : [];
    if (mk && fav) {
      D.home_no_vig_pct = Number.isFinite(mk.moneyline?.home_no_vig) ? mk.moneyline.home_no_vig * 100 : null;
      D.away_no_vig_pct = Number.isFinite(mk.moneyline?.away_no_vig) ? mk.moneyline.away_no_vig * 100 : null;
      const favPct = fav === H ? D.home_no_vig_pct : D.away_no_vig_pct;
      const sb = mk.spread || {};
      const prices = sb.home_best?.price !== undefined && sb.away_best?.price !== undefined ? ` The best spread prices in that capture are ${nick(H.team)} ${am(sb.home_best.price)} at ${book(sb.home_best.book)} and ${nick(A.team)} ${am(sb.away_best.price)} at ${book(sb.away_best.book)}.` : '';
      mkt.push(`PropBetEdge’s latest capture (${dShort(mk.captured_at)} at ${tET(mk.captured_at)}, ${mk.books} books, The Odds API) has the ${nick(fav.team)} as ${line}-point favorites and the total at ${mk.total?.line}.${prices}${favPct !== null ? ` With the bookmaker margin removed, the moneylines imply ${aan(f1(favPct))} ${f1(favPct)}% chance for the ${nick(fav.team)}${mk.moneyline?.consensus_books ? ` (${mk.moneyline.consensus_books}-book consensus)` : ''}.` : ''} These are market numbers, not a PropBetEdge projection; no WNBA model is published.`);
      if (hist.length >= 2) {
        const h0 = hist[0]; const h1 = hist.at(-1);
        const moved = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x !== y;
        mkt.push(`Across ${countOf(hist.length, 'stored capture')} since ${dShort(h0.at)}, the consensus home spread ${moved(h0.spread, h1.spread) ? `moved from ${sgn(h0.spread)} to ${sgn(h1.spread)}` : `has held at ${sgn(h1.spread)}`} and the total ${moved(h0.total, h1.total) ? `moved from ${h0.total} to ${h1.total}` : `has held at ${h1.total}`}.`);
      }
      if (updatesAfter.length) mkt.push(`Freshness: the capture predates ESPN’s latest feed update on ${listJoin(updatesAfter.map((x) => `${x.name} (${dShort(x.source_updated_at)}, ${tET(x.source_updated_at)})`))}, so it cannot reflect that change.`);
      // PropBetEdge Intelligence: how the records compare with what is priced.
      if (seasonGap !== null && recentGap !== null) {
        const hi = Math.max(seasonGap, recentGap); const lo = Math.min(seasonGap, recentGap);
        const where = line > hi ? 'above both' : line < lo ? 'below both' : `between them, closer to the ${Math.abs(line - seasonGap) <= Math.abs(line - recentGap) ? 'season' : 'recent'} figure`;
        intel.push(`Where the price sits: the ${line}-point spread is ${where} of two record-based gaps between these teams — ${f1(Math.abs(seasonGap))} points in season differential and ${f1(Math.abs(recentGap))} in average margin over the last 10${seasonGap < 0 || recentGap < 0 ? ' (in the underdog’s favor on at least one)' : ''}. Neither gap adjusts for home court or schedule strength.`);
      }
      if (threshold !== null) intel.push(`The strongest record support for the price: the ${nick(fav.team)} won by ${threshold} or more in ${wordN(favBigWins.length)} of their last ${fav.form.sample}${favBigWins.length ? ` (${favBigWins.slice(0, 4).map((x) => `${sc(x.pts, x.opp_pts)} ${x.home_away === 'home' ? 'against' : 'at'} ${tn(x.opponent)}`).join(', ')})` : ''}, and the ${nick(dog.team)} lost by ${threshold} or more in ${wordN(dogBigLosses.length)} of theirs.`);
      const tot = mk.total?.line;
      if (Number.isFinite(tot) && Number.isFinite(D.combined_season_ppg)) {
        D.total_minus_season_ppg = tot - D.combined_season_ppg;
        intel.push(`On the total, ${tot} ${Math.abs(D.total_minus_season_ppg) < 0.05 ? 'equals' : D.total_minus_season_ppg > 0 ? `is ${f1(D.total_minus_season_ppg)} above` : `is ${f1(-D.total_minus_season_ppg)} below`} the two teams’ combined season scoring of ${f1(D.combined_season_ppg)}; their last-10 games averaged ${f1(D.away_last10_avg_game_total)} total points for the ${a} and ${f1(D.home_last10_avg_game_total)} for the ${h}.`);
      }
      if (favWorst && favWorst.opp_pts > favWorst.pts && D.fav_worst_margin >= threshold) counter.push(`the ${nick(fav.team)} also lost by ${D.fav_worst_margin} inside their last 10, ${sc(favWorst.opp_pts, favWorst.pts)} ${favWorst.home_away === 'home' ? 'at home to' : 'at'} ${tn(favWorst.opponent)} on ${dMonth(favWorst.date)}`);
      if (recentOf(fav) !== null && diffOf(fav) !== null && Math.abs(recentOf(fav) - diffOf(fav)) >= 3) { D.fav_recent_vs_season = recentOf(fav) - diffOf(fav); counter.push(`their ${sgn(recentOf(fav))} average margin over those 10 games is ${f1(Math.abs(D.fav_recent_vs_season))} points ${D.fav_recent_vs_season < 0 ? 'worse' : 'better'} than their season differential`); }
      const dogAv = dog === H ? av.h : av.a;
      if (dogAv.gameDay.length) counter.push(`ESPN’s feed gives ${countOf(dogAv.gameDay.length, `${nick(dog.team)} player`, `${nick(dog.team)} players`)} an estimated return date of game day (feed updated ${listJoin([...new Set(dogAv.gameDay.map((x) => dShort(x.source_updated_at)))])}), and the capture could not know whether they play`);
    } else if (mk) {
      mkt.push(`The market consensus in PropBetEdge’s capture of ${dShort(mk.captured_at)} (${mk.books} books, The Odds API) has no favorite on the spread${mk.total?.line ? ` and a total of ${mk.total.line}` : ''}. That is the market’s number, not a PropBetEdge projection.`);
    } else {
      mkt.push(historical ? 'No PropBetEdge market capture exists for this game; PropBetEdge began storing captures on September 11, 2026.' : 'No market snapshot exists for this game yet. Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.');
    }
    const counterCase = counter.length ? `The case against the ${line}-point spread: ${counter.join('; ')}.` : null;

    // --- what matters next
    const next = [];
    if (gd.length) next.push(`ESPN’s estimated return date for ${listJoin(gd.map((x) => x.name))} is game day (feed updated ${listJoin([...new Set(gd.map((x) => dShort(x.source_updated_at)))])}); none is a confirmation, and each confirmed return or scratch changes the rotation described above.`);
    const openStarts = [...lostLongA, ...lostLongH].filter((r) => r.starts >= Math.ceil((r.games || 5) / 2) && r.appearances === r.games);
    if (openStarts.length) next.push(`Who starts in place of ${listJoin(openStarts.map((r) => r.name))}; the first box score without ${openStarts.length === 1 ? 'her' : 'them'} is the first real evidence of the redistribution.`);
    if (!historical) next.push(mk?.props?.available ? `Player props are captured for this game (${mk.props.players} players); they are where a minutes change shows first.` : 'Player props, which PropBetEdge captures only inside 36 hours of tip; they are where a minutes change shows first.');
    if (mk) next.push(`Movement against this capture (${fav ? `${nick(fav.team)} −${line}, ` : ''}total ${mk.total?.line}) in the 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET captures before tip.`);

    // --- the read
    let thesis;
    if (fav && seasonGap !== null && recentGap !== null) {
      const sOk = seasonGap >= line; const rOk = recentGap >= line;
      const read = sOk && rOk ? 'Both the season record and recent form support that spread' : sOk ? 'The season record supports that spread more comfortably than recent form does' : rOk ? 'Recent form supports that spread more comfortably than the season record does' : 'Neither the season record nor recent form reaches that spread on its own';
      const qs = [];
      if (Math.abs((recentOf(fav) ?? 0) - (diffOf(fav) ?? 0)) >= 3) qs.push(`whether the ${nick(fav.team)} of the last 10 games (${sgn(recentOf(fav))} a game) or of the full season (${sgn(diffOf(fav))}) is the better guide`);
      if (gd.length) qs.push(`who is actually available — ESPN’s feed gives ${countOf(gd.length, 'player')} across the two teams an estimated return date of game day (feed updated ${listJoin([...new Set(gd.map((x) => dShort(x.source_updated_at)))])})`);
      const dogAv = dog === H ? av.h : av.a; const favAv = fav === H ? av.h : av.a;
      if (!qs.length && (dogAv.long.length || favAv.long.length)) qs.push(`how the ${nick((dogAv.long.length ? dog : fav).team)} replace the minutes ESPN’s feed has ruled out long-term`);
      thesis = `The market consensus makes the ${full(fav.team)} ${line}-point favorites ${fav === A ? 'on the road' : 'at home'} against the ${full(dog.team)} on ${dLong(g.start_utc)}${venue}. ${read}.${qs.length ? ` What could make the price wrong comes down to ${qs.length === 1 ? 'one question' : 'two questions'} the records cannot settle yet: ${qs.join('; and ')}.` : ''}`;
    } else {
      thesis = `The ${full(H.team)} host the ${full(A.team)} on ${dLong(g.start_utc)}${venue}. ${mk ? '' : historical ? 'No PropBetEdge market capture is stored for this date, ' : 'No market capture exists yet, '}so this preview compares the two teams on the records alone: form, scoring, rest and the season series side by side.`.replace('. so this', '. So this');
    }

    const { body, sections } = assemble([['Game outlook', [thesis]], ['Availability', availParas], ['How they match up', cmp], ['The line', mkt], ['Before tip', next.length ? [next.join(' ')] : []]]);
    const favN = fav ? nick(fav.team) : null;
    const headline = fav && seasonGap !== null && recentGap !== null
      ? (seasonGap >= line && recentGap >= line ? `${a} at ${h}: the ${favN} lay ${line}, and the season and the last 10 both back it`
        : seasonGap >= line ? `${a} at ${h}: the ${favN} lay ${line} on their season, not their last 10`
          : recentGap >= line ? `${a} at ${h}: the ${favN} lay ${line} on recent form more than on their season`
            : `${a} at ${h}: the ${favN} lay ${line}, more than the season or the last 10 alone shows`)
      : fav ? `${a} at ${h}: the ${favN} lay ${line}` : `${a} at ${h}: form, scoring and rest, side by side`;
    const deck = fav && seasonGap !== null && recentGap !== null
      ? `The ${full(fav.team)} are ${line}-point favorites ${fav === A ? 'on the road' : 'at home'}: ${seasonGap >= line && recentGap >= line ? 'the season record and recent form both support the price' : seasonGap >= line ? 'the season record supports the price more than recent form' : recentGap >= line ? 'recent form supports the price more than the season record' : 'neither the season nor the last 10 reaches it alone'}${gd.length ? `, and ESPN’s feed gives ${countOf(gd.length, 'player')} an estimated return date of game day (feed updated ${listJoin([...new Set(gd.map((x) => dShort(x.source_updated_at)))])})` : ''}. ${dLong(g.start_utc)}${venue}.`
      : `The ${full(H.team)} host the ${full(A.team)} on ${dLong(g.start_utc)}${venue}.`;
    const summary = intel[0] || 'With no stored market for this game, the comparison is the story: form, scoring and rest side by side.';
    const supporting = intel.slice(1);
    const against = [];
    if (counterCase) against.push(counterCase);
    if (fav && D.fav_recent_vs_season !== undefined && D.fav_recent_vs_season < 0) against.push(`The ${poss(nick(fav.team))} last 10 (${fav.form.record_last10}, ${sgn(recentOf(fav))} a game) are flatter than their season (${sgn(diffOf(fav))}).`);
    if (gd.length) against.push(`ESPN’s feed gives ${listJoin(gd.map((x) => x.name))} an estimated return date of game day (feed updated ${listJoin([...new Set(gd.map((x) => dShort(x.source_updated_at)))])}); the capture predates any confirmation.`);
    if (fav && favWorst && D.fav_worst_margin >= threshold) against.push(`The ${nick(fav.team)} lost by ${D.fav_worst_margin} to ${tn(favWorst.opponent)} on ${dMonth(favWorst.date)} — the favorite’s recent range includes blowout losses.`);
    against.push('Every comparison here describes the past; none is a projection, and none adjusts for opponent strength.');
    const unknown = [];
    if (gd.length) unknown.push(`Whether ${listJoin(gd.map((x) => x.name))} ${gd.length === 1 ? 'plays' : 'play'}.`);
    if (openStarts.length) unknown.push(`Who starts for ${listJoin(openStarts.map((r) => r.name))}.`);
    if (feedUnknown) unknown.push('Availability — the injury feed for this date is not archived.');
    unknown.push('Player-prop lines until the capture window opens.');

    const mt = mk ? marketText(mk, g, null) : null;
    const id = await hashId(['preview', g.game_id]);
    const clean = (t) => ({ form: t.form, rest: t.schedule_context, pace: t.pace, standing: standingOf(t), season_stats: t.season_stats ? { fieldGoalPct: t.season_stats.fieldGoalPct, opp_fieldGoalPct: t.season_stats.opp_fieldGoalPct, avgReboundsDifferential: t.season_stats.avgReboundsDifferential } : null, rotation: { games: t.rotation.games, rows: t.rotation.rows.map((r) => ({ name: r.name, position: r.position, starts: r.starts, appearances: r.appearances, games: r.games, min: r.min, pts: r.pts, reb: r.reb, ast: r.ast })) } });
    const a0 = finalize({
      id, kind: 'preview', category: 'Previews', structure: 0, headline, deck, body, sections, market_type: fav ? 'spread' : null,
      bettor: [summary, ...supporting], against, unknown,
      // The body's "The market" section carries the capture; the market module attaches it without restating it.
      market_angle: mt ? { text: [], market: mk, game_id: g.game_id } : { text: [], market: null, game_id: g.game_id },
      lead_team_id: H.team.team_id, lead_player_id: null, primary_subject: H.team.short_name, published_at: mk?.captured_at || new Date(now).toISOString(),
      context: { game: { game_id: g.game_id, start_utc: g.start_utc, home: g.home, away: g.away, venue: g.venue } },
      entities: [gameEntity(g), { type: 'team', id: A.team.team_id, name: A.team.name }, { type: 'team', id: H.team.team_id, name: H.team.name }, ...[A, H].flatMap((t) => t.rotation.rows.filter((x) => x.appearances > 0).slice(0, 2).map((x) => ({ type: 'player', id: x.athlete_id, name: x.name })))],
      facts: { away: clean(A), home: clean(H), injury_feed: { away: feeds.a.map(stripNotes), home: feeds.h.map(stripNotes) }, injury_scope: feedUnknown ? [] : [A.team.team_id, H.team.team_id], injury_feed_unavailable: feedUnknown, rest_days: [rest[0]?.rest_days, rest[1]?.rest_days].filter((v) => Number.isFinite(v)), series: m.season_series, series_games: series.map((x) => ({ date: x.start_utc, home: x.home.abbr, home_score: x.home.score, away: x.away.abbr, away_score: x.away.score })), market: mt?.facts || null, market_history: hist, props: mk?.props || null, historical, derived: D },
      evidence: [
        { kind: 'record', source: 'wnba-api matchup research (ESPN standings, schedules, box scores, season team stats)', url: `https://wnba.propbetedge.ai/matchups/${g.game_id}`, record: { game_id: g.game_id } },
        ...(feedUnknown ? [] : [{ kind: 'record', source: 'ESPN WNBA injury feed (full current feed)', url: 'https://www.espn.com/wnba/injuries', record: { away: feeds.a.length, home: feeds.h.length } }]),
        ...(mk ? [{ kind: 'market', source: 'The Odds API (stored PropBetEdge snapshot)', captured_at: mk.captured_at, record: { books: mk.books, spread_home: mk.spread.home_line, total: mk.total.line } }] : [])
      ],
      input_hash: `${mk?.captured_at || 'nomkt'}|${feeds.a.length + feeds.h.length}`
    });
    a0.meter = meterDelta(meter, t0);
    out.push(a0);
  }
  return out;
}

// ------------------------------------------------------------ 2. injuries

export async function injuryDeep(ctx) {
  const { api, injuries, externalByPlayer, standingsById, now, dict } = ctx;
  if (ctx.historical) return [];
  const meter = meterOf(ctx);
  const out = [];
  const serious = (i) => /out/i.test(i.status || '') || /day/i.test(i.status || '');
  // ctx.injurySubjects (tests only) limits which listings become stories; the FULL feed is still used for
  // every team's context, so an injury story always names a team's complete injury situation.
  const subject = ctx.injurySubjects ? (i) => ctx.injurySubjects.has(String(i.athlete_id)) : () => true;
  const recent = (injuries || []).filter((i) => i.athlete_id && serious(i) && subject(i) && Date.parse(i.source_updated_at) > now - 14 * 86400e3)
    .sort((a, b) => String(b.source_updated_at).localeCompare(String(a.source_updated_at))).slice(0, 12);
  for (const inj of recent) {
    const t0 = meter();
    const [pRes, tRes] = await Promise.all([api(`/v1/players/${inj.athlete_id}`), api(`/v1/teams/${inj.team_id}`)]);
    if (!pRes || !tRes) continue;
    const p = pRes.player;
    const team = tRes.team;
    const rot = tRes.rotation;
    const me = rot?.rows?.find((r) => r.athlete_id === inj.athlete_id) || null;
    const year = tRes.season?.year;
    const log = seasonLog(pRes, year, dict?.teamById);
    const cur = log.current;
    if (!cur || cur.games < 3) continue; // no current-season production to frame
    const D = {};
    const n = nick(team);
    const st = standingsById.get(team.team_id) || tRes.standing;
    const ng = nextGame(tRes.schedule, team.team_id);
    const opp = ng ? (ng.home.team_id === team.team_id ? ng.away : ng.home) : null;
    const ofs = /OFS/i.test(inj.fantasy_status || '') || /season/i.test(inj.status || '');
    const dtd = !ofs && /day/i.test(inj.status);
    const nir = /not injury related/i.test(inj.body_part || '');
    const part = nir ? '' : [inj.side, inj.body_part].filter(Boolean).join(' ').toLowerCase();
    const reports = (externalByPlayer.get(inj.athlete_id) || []).filter((r) => r.story_type === 'injury').slice(0, 3);
    const since = teamSince(tRes.schedule, team.team_id, cur.last_date, year, ctx.regIds);
    D.games_since = since.n; D.since_w = since.w; D.since_l = since.l;
    if (st) { D.without_w = st.wins - cur.wins; D.without_l = st.losses - cur.losses; D.without_n = D.without_w + D.without_l; }
    const obs = await observedAbsence(api, rot, team.team_id, inj.athlete_id);
    const minutes = cur.min;
    // Her most recent logged games (current regular season), and the next opponent's record — the fact block a Full
    // injury story develops. Every figure is a record value or arithmetic written to D.
    const recent5 = (pRes.gamelog?.seasons?.find((x) => x.name === cur.season_name)?.games || []).filter((x) => x.min).slice(0, 5).map((x) => ({ date: x.date, min: x.min, pts: x.pts, result: x.result, opponent: x.opponent?.name || null }));
    if (recent5.length >= 3) { D.recent_min = avg(recent5.map((x) => x.min)); D.recent_pts = avg(recent5.map((x) => x.pts)); }
    const oppSt = opp ? standingsById.get(opp.team_id) || null : null;
    // new vs long-running absence, from games actually missed (last logged game vs team games since)
    const mode = since.n >= 3 ? 'long' : obs && obs.missed >= 2 ? 'intermittent' : me && me.appearances === rot?.sample ? 'fresh' : 'partial';
    let missedRec = null;
    if (mode === 'intermittent') {
      const res = obs.games.map((gm) => (tRes.schedule || []).find((x) => x.game_id === gm.game_id)).filter(Boolean).map((x) => (x.home.team_id === team.team_id ? x.home : x.away).winner);
      missedRec = { w: res.filter(Boolean).length, l: res.filter((x) => !x).length };
      D.missed_w = missedRec.w; D.missed_l = missedRec.l;
    }
    const splitTxt = st && Number.isFinite(D.without_w) ? `the ${n} are ${recWL(cur.wins, cur.losses)} in the ${cur.games} games she has played and ${recWL(D.without_w, D.without_l)} in the ${D.without_n} she has not` : null;
    const status = `${inj.status}${nir ? ' (not injury related)' : part ? ` (${part})` : ''}`;

    let thesis;
    if (mode === 'long') thesis = `${p.name} has not played since ${dMonth(cur.last_date)}, and the ${n} have gone ${recWL(since.w, since.l)} over ${since.n} games without her. ESPN now lists her as ${status}${ofs ? ' for the rest of the season' : ''}, so this is confirmation that the absence continues rather than a brand-new rotation problem.`;
    else if (mode === 'intermittent') thesis = `${p.name} has already been in and out of the ${n} lineup, playing ${wordN(obs.window - obs.missed)} of their last ${wordN(obs.window)} games. The ${n} went ${recWL(missedRec.w, missedRec.l)} in the ${wordN(obs.missed)} she missed, and ESPN now lists her as ${status}${ofs ? ' for the rest of the season' : ''}.${splitTxt ? ` For the full season, ${splitTxt}; that split is context, not a clean measure of her individual impact.` : ''}`;
    else if (mode === 'fresh') thesis = `${p.name} played every one of the ${poss(n)} last ${wordN(rot.sample)} games, averaging ${f1(me.min)} minutes with ${me.starts ? countOf(me.starts, 'start') : 'no starts'}. ESPN now lists her as ${status}, leaving the ${n} to cover a role this recent rotation has not had to replace. The immediate question is where those minutes go.`;
    else thesis = `ESPN lists ${p.name} as ${status}. She has averaged ${f1(minutes)} minutes across ${cur.games} games this season, and the ${n} have one recent game without her to use as a clue for how the rotation may shift.`;

    const statusParas = [`ESPN’s WNBA injury feed lists ${p.name} as ${inj.status}${nir ? ' (not injury related)' : part ? ` with a ${part} injury` : ''}, updated ${dShort(inj.source_updated_at)} at ${tET(inj.source_updated_at)}${ofs ? ', and marks her out for the rest of the season' : inj.source_return_date ? `, with an estimated return date of ${rdText(inj, year)}` : ''}. The league’s official game-day report is separate.${reports.length ? ` The injury has also been covered by ${listJoin([...new Set(reports.slice(0, 2).map((r) => r.source_name))])}.` : ''}`];
    if (mode === 'long') statusParas.push(`The available data does not say why she had already been out since ${dMonth(cur.last_date)} or when the injury began.`);

    const role = [];
    role.push(`${p.name} has played ${cur.games} games this season, averaging ${f1(cur.pts)} points, ${f1(cur.reb)} rebounds and ${f1(cur.ast)} assists in ${f1(cur.min)} minutes.${cur.last10 ? ` Over her last ${cur.last10.games}, she averaged ${f1(cur.last10.pts)} points in ${f1(cur.last10.min)} minutes.` : ''}${mode === 'intermittent' ? ` Her last appearance was ${dMonth(cur.last_date)}${me?.appearances ? ` (${me.min} minutes)` : ''}.` : ''}`);
    if (splitTxt && mode !== 'intermittent') role.push(`${cap(splitTxt)}${mode === 'long' ? `, including ${recWL(since.w, since.l)} since ${dMonth(cur.last_date)}` : ''}. A split like that mixes opponents, dates and every other lineup change, so it describes the season rather than measuring her.`);
    const pos = /G/.test(p.position || me?.position || '') ? 'G' : 'FC';
    const feedTeam = feedFor(injuries, team.team_id);
    const samePos = (rot?.rows || []).filter((r) => r.athlete_id !== inj.athlete_id && r.appearances > 0 && !feedTeam.some((x) => x.athlete_id === r.athlete_id) && (pos === 'G' ? /G/.test(r.position || '') : /[FC]/.test(r.position || ''))).slice(0, 4);
    if ((mode === 'long' || mode === 'intermittent') && rot?.rows?.length) {
      role.push(`${mode === 'long' ? `The ${poss(n)} last ${wordN(rot.sample)} games — the recent rotation — were all played without her` : `She played in only ${wordN(obs.window - obs.missed)} of the last ${wordN(obs.window)}`}, so the current rotation already reflects her absence.${samePos.length ? ` Its healthy ${pos === 'G' ? 'guards' : 'forwards and centers'} by minutes: ${listJoin(samePos.map((r) => `${r.name} (${f1(r.min)} min, ${f1(r.pts)} pts)`))}.` : ''}`);
    } else if (obs) {
      const s1 = absenceSentence(obs, n, D, 'self');
      role.push(s1 || 'There is not enough recent game evidence to say exactly how the rotation changes.');
    } else if (me && rot?.sample) {
      const outIds = new Set(feedTeam.map((x) => x.athlete_id));
      const heirs = rot.rows.filter((r) => r.athlete_id !== inj.athlete_id && !outIds.has(r.athlete_id) && r.appearances > 0).slice(0, 3);
      role.push(`In the ${poss(n)} last ${wordN(rot.sample)} games she started ${me.starts ? wordN(me.starts) : 'none'} and played ${f1(me.min)} minutes a night. The healthy players with the heaviest minutes in that window are ${listJoin(heirs.map((h) => `${h.name} (${f1(h.min)} min)`))}; how her minutes divide among them is not yet established.`);
    }
    const otherOut = feedTeam.filter((x) => x.athlete_id !== inj.athlete_id);
    if (otherOut.length) role.push(`She is not the team’s only listing: ESPN’s feed also carries ${listJoin(otherOut.map((x) => `${x.name} (${x.status})`))}.`);
    if (recent5.length >= 3 && mode !== 'long') role.push(`Her last ${wordN(recent5.length)} logged games, the most recent on ${dMonth(recent5[0].date)}: ${listJoin(recent5.map((x) => `${x.min}`))} minutes, ${f1(D.recent_min)} a game, with ${f1(D.recent_pts)} points a game${Math.abs(D.recent_min - cur.min) >= 2 ? ` — ${D.recent_min > cur.min ? 'more' : 'less'} than her ${f1(cur.min)}-minute season average, so the recent role was ${D.recent_min > cur.min ? 'larger' : 'smaller'} than the season line suggests` : ''}.`);

    const teamParas = [];
    if (st) teamParas.push(`The ${full(team)} are ${standingText(st, st.conference_name)}, ${st.last_ten} over their last 10, scoring ${f1(st.points_for_avg)} a game and allowing ${f1(st.points_against_avg)}.`);
    if (ng && oppSt) teamParas.push(`Their next game is ${ng.home.team_id === team.team_id ? `at home against the ${full(opp)}` : `on the road against the ${full(opp)}`} on ${dLong(ng.start_utc)}. The ${nick(opp)} are ${recWL(oppSt.wins, oppSt.losses)}, ${oppSt.last_ten} over their last 10, and allow ${f1(oppSt.points_against_avg)} points a game.`);

    const mkt = [];
    const mt = ng?.market ? marketText(ng.market, ng, team.team_id) : null;
    if (mt) {
      const cap0 = ng.market.captured_at;
      const earliestReport = reports.map((r) => r.published_at).sort()[0] || null;
      mkt.push(`The next price: ${mt.sentences[0].replace(/^In the most recent PropBetEdge market capture for /, 'in PropBetEdge’s latest capture for ')} ${mt.sentences[3] || ''}`.trim());
      const capTxt = `That capture (${dShort(cap0)}, ${tET(cap0)}, ${ng.market.books} books)`;
      if (Date.parse(inj.source_updated_at) < Date.parse(cap0)) { D.capture_days_after_update = etDays(inj.source_updated_at, cap0); mkt.push(`${capTxt} was taken ${D.capture_days_after_update === 0 ? 'later the same day as' : `${countOf(D.capture_days_after_update, 'day')} after`} the feed’s update, so the listing was public when the price was set.`); }
      else if (earliestReport && Date.parse(earliestReport) < Date.parse(cap0)) { D.capture_days_after_report = etDays(earliestReport, cap0); mkt.push(`${capTxt} predates the feed’s latest update, but publisher coverage of the injury ran ${D.capture_days_after_report === 0 ? 'earlier the same day' : `${countOf(D.capture_days_after_report, 'day')} before it`}, so the injury was public when the price was set.`); }
      else mkt.push(`${capTxt} predates the feed’s update, so it may not reflect this listing; the next captures are the next read.`);
      if (mode === 'long') mkt.push(`Because the ${n} have played ${since.n} games without her, a spread or total move tied to this listing would be hard to justify from the records; if one appears, the availability desk is where to look for another cause.`);
      if (mode === 'intermittent') mkt.push(`Because she missed ${wordN(obs.missed)} of the last ${wordN(obs.window)} games, recent prices were already set on a rotation mostly without her; the season-long listing changes the long view more than the next line.`);
    } else mkt.push(ng ? `No market snapshot exists yet for the ${poss(n)} next game (${dShort(ng.start_utc)}). Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.` : 'No upcoming game is on the published schedule.');

    const withBetter = Number.isFinite(D.without_w) && cur.wins / Math.max(1, cur.games) > D.without_w / Math.max(1, D.without_n);
    const counterPara = (mode === 'long' || mode === 'intermittent') && withBetter ? `One reason not to shrug off the absence: the ${n} have won a higher share of games with her (${recWL(cur.wins, cur.losses)}) than without (${recWL(D.without_w, D.without_l)}). The absence may be familiar, but it still matters.` : null;
    const next = `${ng ? `Next up is ${ng.away.abbr} at ${ng.home.abbr} on ${dLong(ng.start_utc)}. ` : ''}${mode === 'long' || mode === 'intermittent' ? 'The starting lineup should show whether the existing rotation stays intact.' : 'The first box score without her will show who actually gets the minutes.'} Player props enter the PropBetEdge capture window inside 36 hours of tip.`;

    const { body, sections } = assemble([['The latest', [thesis, ...statusParas]], ['Who picks up the minutes', role], ['Team context', teamParas], ['The line', mkt], ['Next up', [counterPara, next]]]);
    const headline = mode === 'long' ? `${p.name} remains out as the ${n} keep rolling without her`
      : mode === 'intermittent' ? `${p.name} listed ${ofs ? 'out for the season' : inj.status.toLowerCase()} after an uneven recent stretch`
        : ofs ? `${p.name} out for the season; the ${n} turn to the rotation behind her`
          : dtd ? `${p.name} day-to-day as the ${n} prepare to cover ${f1(minutes)} minutes` : `${p.name} listed out; the ${n} have ${f1(minutes)} minutes to replace`;
    const deck = mode === 'long' ? `${p.name} has not played since ${dMonth(cur.last_date)}. The ${full(team)} are ${recWL(since.w, since.l)} over ${since.n} games since.`
      : mode === 'intermittent' ? `She has been in and out lately, but her ${f1(cur.pts)} points in ${f1(cur.min)} minutes per game still leave a real role to cover.`
        : `${p.name} is averaging ${f1(cur.pts)} points in ${f1(cur.min)} minutes this season. Those minutes now have to go somewhere else in the ${n} rotation.`;
    const bettor = mode === 'long' ? [`The listing formalizes an absence the ${n} have played ${since.n} games through (${recWL(since.w, since.l)}); it settles her season more than it moves the next spread or total.`, 'Player-prop lines for the next game are captured only inside 36 hours of tip.']
      : mode === 'intermittent' ? [`The ${n} have mostly played without ${p.name} already (${wordN(obs.missed)} of the last ${wordN(obs.window)}); the listing turns a recurring absence into a certain one, which matters more for the season-long picture than for the next line.`, 'Player-prop lines for the next game are captured only inside 36 hours of tip.']
        : [`${poss(p.name)} ${f1(minutes)} minutes a night now go to someone else, and ${obs ? 'the one box score without her is the only evidence of where' : 'no box score yet shows where'}.`, 'Player-prop lines for the next game are captured only inside 36 hours of tip; that is where a minutes shift shows up first.'];
    const against = mode === 'long' || mode === 'intermittent' ? [...(withBetter ? [`The ${n} won a higher share of games with her (${recWL(cur.wins, cur.losses)}) than without (${recWL(D.without_w, D.without_l)}), so her absence is not nothing — it is simply not new.`] : []), 'ESPN’s feed is a provider status, not the league’s official report.']
      : ['ESPN’s feed is a provider status, not the league’s official injury report, and it can change before tip.', 'Minutes redistribution is read from box scores, not from a published lineup.'];
    const unknown = mode === 'long' ? ['Why she had not played since her last logged game, and when the injury occurred — neither is in the structured records.', 'The postseason rotation.'] : ['The official game-day status and the starting lineup.', 'How the next posted player-prop lines treat the absence.'];

    const id = await hashId(['injury', inj.athlete_id, inj.status, inj.source_updated_at]);
    const a0 = finalize({
      id, kind: 'injury', category: 'Injuries', structure: 0, headline, deck, body, sections, market_type: null, bettor, against, unknown,
      market_angle: mt ? { text: [...mt.sentences], market: ng.market, game_id: ng.game_id } : { text: [ng ? 'No market snapshot exists yet for that game. Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.' : 'No upcoming game is on the published schedule.'], market: null, game_id: ng?.game_id || null },
      lead_team_id: team.team_id, lead_player_id: p.athlete_id, primary_subject: p.name, published_at: inj.source_updated_at,
      context: { player: { athlete_id: p.athlete_id, name: p.name, position: p.position_name, photo: pRes.photo }, team: { team_id: team.team_id, name: team.name, standing: st }, next_game: ng ? { game_id: ng.game_id, start_utc: ng.start_utc, home: ng.home, away: ng.away } : null },
      entities: [{ type: 'player', id: p.athlete_id, name: p.name }, { type: 'team', id: team.team_id, name: team.name }, ...(opp ? [{ type: 'team', id: opp.team_id, name: opp.name }] : []), ...(ng ? [gameEntity(ng)] : [])],
      facts: { injury: stripNotes(inj), season_log: cur, provenance: [prov(p.name, cur, 'season')], absence: { mode, last_game: cur.last_date, games_since: since.n, window_missed: obs?.missed ?? 0 }, rotation_me: me ? { name: me.name, min: me.min, starts: me.starts, appearances: me.appearances } : null, rotation: rot?.rows?.map((r) => ({ name: r.name, position: r.position, min: r.min, pts: r.pts, starts: r.starts, appearances: r.appearances })), since, standing: st, next_game: ng ? { start_utc: ng.start_utc } : null, market: mt?.facts || null, other_out: otherOut.map((x) => ({ name: x.name, status: x.status })), injury_scope: [team.team_id], observed: obs, recent_games: recent5, next_opponent: oppSt ? { name: opp.name, wins: oppSt.wins, losses: oppSt.losses, last_ten: oppSt.last_ten, points_against_avg: oppSt.points_against_avg } : null, derived: D },
      evidence: [
        { kind: 'record', source: 'ESPN WNBA injury feed', url: 'https://www.espn.com/wnba/injuries', captured_at: new Date(now).toISOString(), record: { athlete_id: inj.athlete_id, status: inj.status, body_part: inj.body_part, fantasy_status: inj.fantasy_status, source_return_date: inj.source_return_date, source_updated_at: inj.source_updated_at } },
        ...reports.map((r) => ({ kind: 'publisher_report', source: r.source_name, publisher: r.source_name, headline: r.headline, url: r.canonical_url, published_at: r.published_at, captured_at: r.first_captured_at })),
        { kind: 'record', source: `ESPN game log (${cur.season_name})`, url: `https://www.espn.com/wnba/player/gamelog/_/id/${p.athlete_id}`, record: { games: cur.games, last_game: cur.last_date } },
        { kind: 'record', source: `ESPN team schedule — ${full(team)} (results since her last game)`, url: `https://www.espn.com/wnba/team/schedule/_/id/${team.team_id}`, record: since },
        ...(rot?.games?.length ? [{ kind: 'record', source: `ESPN box scores, last ${rot.sample} ${n} games (observed rotation)`, url: `https://www.espn.com/wnba/team/schedule/_/id/${team.team_id}`, record: { games: rot.games } }] : []),
        ...(st ? [{ kind: 'record', source: 'ESPN standings', url: 'https://www.espn.com/wnba/standings', captured_at: new Date(now).toISOString(), record: { team: stripNotes(st), next_opponent: oppSt || null } }] : []),
        ...(ng?.market ? [{ kind: 'market', source: 'The Odds API (stored PropBetEdge snapshot)', captured_at: ng.market.captured_at, record: { books: ng.market.books, spread: ng.market.spread.home_line, total: ng.market.total.line } }] : [])
      ]
    });
    a0.meter = meterDelta(meter, t0);
    out.push(a0);
  }
  return out;
}

// ------------------------------------------------------------ 3. transactions

const VERB = [[/^Signed\b/, 'sign'], [/^Re-signed\b/, 're-sign'], [/^Waived\b/, 'waive'], [/^Released\b/, 'release'], [/^Acquired\b/, 'acquire'], [/^Activated\b/, 'activate'], [/^Placed\b/, 'place'], [/^Traded\b/, 'trade'], [/^Claimed\b/, 'claim'], [/^Suspended\b/, 'suspend'], [/^Exercised\b/, 'exercise'], [/^Extended\b/, 'extend']];
function presentTense(sentence) {
  const s = sentence.trim().replace(/\.$/, '');
  for (const [re, v] of VERB) if (re.test(s)) return s.replace(re, v);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export async function transactionDeep(ctx) {
  const { api, transactions, dict, injuries, now } = ctx;
  const standingsById = ctx.standingsById || new Map();
  const historical = Boolean(ctx.historical);
  const meter = meterOf(ctx);
  const byTeamDay = new Map();
  for (const t of transactions || []) {
    if (!t.team?.team_id || !t.date || Date.parse(t.date) < now - (ctx.windowDays || 14) * 86400e3 || Date.parse(t.date) > now) continue;
    const k = `${t.team.team_id}|${t.date.slice(0, 10)}`;
    if (!byTeamDay.has(k)) byTeamDay.set(k, { team: t.team, date: t.date, moves: [] });
    byTeamDay.get(k).moves.push(t.description);
  }
  const out = [];
  for (const g of byTeamDay.values()) {
    const t0 = meter();
    const clauses = g.moves.flatMap((m) => m.split(/(?<=\.)\s+/)).map((x) => x.trim()).filter(Boolean);
    const tRes = await api(`/v1/teams/${g.team.team_id}`);
    const team = tRes?.team || g.team;
    const n = nick(team);
    const year = tRes?.season?.year || ctx.season;
    const D = {};
    const named = [];
    for (const [nm, p] of dict.playerByName) if (clauses.some((c) => c.toLowerCase().includes(nm))) named.push(p);
    const onRoster = named.filter((p) => (tRes?.roster || []).some((r) => r.athlete_id === p.athlete_id));
    const moveText = listJoin(clauses.slice(0, 2).map(presentTense));
    const signing = clauses.some((c) => /^(Signed|Re-signed|Claimed|Acquired|Activated)\b/.test(c));
    const activation = clauses.some((c) => /^(Activated|Reinstated)\b|\bas active\b/i.test(c));

    const profiles = [];
    const sProfiles = [];
    const provs = [];
    for (const p of onRoster.slice(0, 2)) {
      const pr = await api(`/v1/players/${p.athlete_id}`);
      const log = seasonLog(pr, year, dict.teamById, { before: historical ? new Date(now).toISOString() : null });
      const bio = pr?.player || {};
      profiles.push({ athlete_id: p.athlete_id, name: p.name, position: bio.position, height: bio.height, current: log.current, prior: log.prior });
      const size = [bio.height, bio.position_name?.toLowerCase()].filter(Boolean).join(' ');
      if (log.current?.games) {
        provs.push(prov(p.name, log.current, 'season'));
        const l10 = log.current.last10;
        sProfiles.push(`${p.name}${size ? `, a ${size},` : ''} has played ${countOf(log.current.games, 'game')} in the ${year} regular season, per the ESPN game log, averaging ${statAvg(log.current.pts, 'point')} and ${statAvg(log.current.reb, 'rebound')} in ${statAvg(log.current.min, 'minute')}.${l10 ? ` Over her last ${l10.games} of those games she averaged ${f1(l10.pts)} points in ${f1(l10.min)} minutes.` : ''} Her most recent game in the log was ${dMonth(log.current.last_date)}.`);
      }
      else if (log.prior?.games) { provs.push(prov(p.name, log.prior, 'prior_season')); sProfiles.push(`${p.name}${size ? `, a ${size},` : ''} has no ${year} regular-season games in the ESPN game log. Her most recent regular season there is ${log.prior.year}${log.prior.team_name ? ` with the ${log.prior.team_name}` : ''}: ${countOf(log.prior.games, 'game')}, ${statAvg(log.prior.pts, 'point')} and ${statAvg(log.prior.reb, 'rebound')} in ${statAvg(log.prior.min, 'minute')} — ${log.prior.year} numbers, not ${year}.`); }
      else sProfiles.push(`${p.name} is on the current ${n} roster; the ESPN game log shows no regular-season minutes for her.`);
    }

    const feed = historical ? null : feedFor(injuries, team.team_id);
    const ctxParas = [];
    const rot = tRes?.rotation;
    // The moved player's own feed listing, and where her season minutes would rank in the current observed rotation.
    for (const p of profiles) {
      const listing = (feed || []).find((x) => String(x.athlete_id) === String(p.athlete_id));
      if (listing && activation) sProfiles.push(`ESPN’s injury feed still lists ${p.name} as ${listing.status}, last updated ${dShort(listing.source_updated_at)} — so as of this story the feed and the transactions log do not yet agree on her availability.`);
      else if (listing) sProfiles.push(`ESPN’s injury feed lists ${p.name} as ${listing.status}, last updated ${dShort(listing.source_updated_at)}.`);
      const played = (rot?.rows || []).filter((r) => r.appearances > 0 && String(r.athlete_id) !== String(p.athlete_id));
      if (p.current?.games && Number.isFinite(p.current.min) && played.length >= 5) {
        const rank = played.filter((r) => r.min > p.current.min).length + 1;
        D[`rank_${p.athlete_id}`] = rank;
        sProfiles.push(`Her ${f1(p.current.min)} minutes a game would rank ${['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][rank] || `No. ${rank}`} among the ${countOf(played.length, 'player')} who played in the ${poss(n)} last ${wordN(rot.sample)} games — ${p.current.min >= 15 ? 'a rotation-level workload, not end-of-bench minutes' : 'minutes at the end of the bench'}.`);
      }
    }
    const teamMoves = (ctx.transactions || transactions || []).filter((t) => String(t.team?.team_id) === String(team.team_id) && t.date.slice(0, 10) !== g.date.slice(0, 10) && Date.parse(t.date) < Date.parse(g.date) && Date.parse(g.date) - Date.parse(t.date) <= 30 * 86400e3).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 4);
    let recentLong = [];
    if (feed) {
      const longOuts = feed.filter((x) => /OFS/i.test(x.fantasy_status || '') || (x.source_return_date && Date.parse(x.source_return_date) - Date.parse(g.date) > 60 * 86400e3));
      recentLong = longOuts.filter((x) => Date.parse(x.source_updated_at) <= Date.parse(g.date) + 86400e3 && etDays(x.source_updated_at, g.date) <= 7);
    }
    if (recentLong.length && signing) {
      const x = recentLong[0];
      const row = rot?.rows?.find((r) => r.athlete_id === x.athlete_id);
      D.days_after_listing = Math.max(0, etDays(x.source_updated_at, g.date));
      ctxParas.push(`The move is dated ${D.days_after_listing === 0 ? 'the same day as' : `${countOf(D.days_after_listing, 'day')} after`} an ESPN injury-feed update (${dShort(x.source_updated_at)}) that lists ${listingPhrase(x, year)}${row?.appearances ? ` — a player who started ${wordN(row.starts)} of the ${poss(n)} last ${wordN(rot.sample)} games and averaged ${f1(row.min)} minutes and ${f1(row.reb)} rebounds` : ''}. The transactions log does not give a reason for the signing, so the link is timing, not a stated cause.`);
      const obs = await observedAbsence(api, rot, team.team_id, x.athlete_id);
      const s = absenceSentence(obs, n, D, 'listed');
      if (s) ctxParas.push(s);
    }
    const incomingBig = profiles.some((p) => /[FC]/.test(p.position || ''));
    if (rot?.rows?.length) {
      const outIds = new Set((feed || []).map((x) => x.athlete_id));
      const moved = new Set(profiles.map((p) => String(p.athlete_id)));
      const group = rot.rows.filter((r) => !outIds.has(r.athlete_id) && !moved.has(String(r.athlete_id)) && r.appearances > 0 && (incomingBig ? /[FC]/.test(r.position || '') : true)).slice(0, 5);
      const tail = rot.rows.filter((r) => r.appearances > 0).slice(-3);
      if (group.length) ctxParas.push(`Where the minutes are: the ${feed ? 'healthy ' : ''}${incomingBig ? 'forwards and centers' : 'players'} who played in the ${poss(n)} last ${wordN(rot.sample)} games were ${listJoin(group.map((r) => `${r.name} (${f1(r.min)} min)`))}.${tail.length === 3 ? ` The three lightest-used players in that window averaged ${listJoin(tail.map((r) => f1(r.min)))} minutes.` : ''}`);
    }
    if (feed?.length) ctxParas.push(`ESPN’s injury feed currently lists ${listJoin(feed.map((x) => `${x.name} (${x.status})`))} for the ${n}.`);
    else if (feed) ctxParas.push(`ESPN’s injury feed lists no ${n} players.`);
    else ctxParas.push(`ESPN’s injury feed is not archived for ${dMonth(ctx.asOf || new Date(now).toISOString())}, so this story does not describe the ${poss(n)} availability at the time.`);
    const st = historical ? null : tRes?.standing;
    if (st) ctxParas.push(`The ${full(team)} are ${standingText(st, st.conference_name)}, ${st.last_ten} over their last 10.`);

    const ng = nextGame(tRes?.schedule, team.team_id);
    const mt = ng?.market ? marketText(ng.market, ng, team.team_id) : null;
    const mkt = [];
    if (mt) mkt.push(`The next price already sits after the move: PropBetEdge’s capture of ${dShort(ng.market.captured_at)} (${ng.market.books} books) has ${ng.away.abbr} at ${ng.home.abbr} on ${dShort(ng.start_utc)} at ${ng.market.spread.home_line === null ? 'no spread' : `${ng.home.abbr} ${ng.market.spread.home_line > 0 ? '+' : ''}${ng.market.spread.home_line}`}${ng.market.total.line !== null ? `, total ${ng.market.total.line}` : ''} — market consensus, not a PropBetEdge projection. ${activation ? 'A roster activation' : signing ? 'A depth signing' : 'A roster move'} dated ${dShort(g.date)} is not new information for it.`);
    const lastMin = profiles.map((p) => p.current?.min ?? p.prior?.min).filter((v) => Number.isFinite(v));
    const lastLbl = profiles.map((p) => (p.current?.games ? `this regular season` : p.prior ? `her ${p.prior.year} regular season` : null)).filter(Boolean)[0];
    const curMover = profiles.find((p) => p.current?.games && Number.isFinite(p.current.min));
    const readTail = signing && recentLong.length
      ? `It lands ${countOf(D.days_after_listing ?? 0, 'day')} after a long-term frontcourt listing, but nothing in the records points to a top-of-rotation role for the newcomer${lastMin.length && lastLbl ? ` — ${lastLbl} averaged ${f1(lastMin[0])} minutes` : ''} — so its betting relevance runs through the end of the bench and player-prop eligibility, not the game line.`
      : curMover && curMover.current.min >= 15
        ? `${curMover.name} has averaged ${f1(curMover.current.min)} minutes across ${countOf(curMover.current.games, 'game')} this season, a rotation role, so the move changes who is available for real minutes rather than the end of the bench.`
        : curMover
          ? `${curMover.name} has averaged ${f1(curMover.current.min)} minutes this season, so the move touches the end of the bench rather than the rotation’s core.`
          : 'Nothing in the records points to a top-of-rotation role; its betting relevance runs through the end of the bench.';
    const thesis = `Per ESPN’s WNBA transactions log, the ${full(team)} ${moveText} (${dShort(g.date)}). ${readTail}`;
    const oppNext = ng ? (ng.home.team_id === team.team_id ? ng.away : ng.home) : null;
    const oppSt = oppNext && !historical ? ctx.standingsById?.get(oppNext.team_id) || null : null;
    const movesParas = teamMoves.length ? [`It is not the ${poss(n)} only recent roster change. Earlier moves in the transactions log over the previous 30 days: ${teamMoves.map((t) => `${dShort(t.date)} — ${String(t.description).replace(/\.$/, '')}`).join('; ')}.`] : [];
    const nextParas = ng ? [`The ${n} next play ${ng.home.team_id === team.team_id ? `the ${full(oppNext)} at home` : `at the ${full(oppNext)}`} on ${dLong(ng.start_utc)}${oppSt ? `; the ${nick(oppNext)} are ${recWL(oppSt.wins, oppSt.losses)} and ${oppSt.last_ten} over their last 10` : ''}. The first box score after the move is the first record of how the minutes are actually used.`] : [];
    const { body, sections } = assemble([['What happened', [thesis]], ['The players involved', sProfiles], ['How it fits', ctxParas], ['Recent moves', movesParas], ['The line', mkt], ['Next up', nextParas]]);
    const headline = `Roster move: the ${n} ${moveText}`.replace(/\s+/g, ' ');
    const deck = recentLong.length && signing
      ? `Dated ${dShort(g.date)}, ${D.days_after_listing === 0 ? 'the same day as' : `${countOf(D.days_after_listing, 'day')} after`} an ESPN injury-feed update that lists ${listingPhrase(recentLong[0], year)}. Per ESPN’s transactions log.`
      : curMover
        ? `${curMover.name} brings ${f1(curMover.current.pts)} points in ${f1(curMover.current.min)} minutes a game across ${curMover.current.games} games this season${st ? ` to a ${full(team)} team at ${recWL(st.wins, st.losses)}` : ''}${ng ? `, before the ${nick(oppNext)} on ${dShort(ng.start_utc)}` : ''}. Per ESPN’s transactions log, dated ${dShort(g.date)}.`
        : `A roster move dated ${dShort(g.date)} from ESPN’s WNBA transactions log.`;
    const bettor = [curMover && curMover.current.min >= 15 ? `${poss(curMover.name)} ${f1(curMover.current.min)} minutes a game are rotation minutes: the move is relevant to player-prop eligibility and minutes for the ${poss(n)} regulars, not only the end of the bench.` : `A depth move: it changes who fills the last minutes of the ${poss(n)} rotation, which touches player-prop eligibility rather than game lines.`, ng ? `Next up: ${ng.away.abbr} at ${ng.home.abbr} on ${dLong(ng.start_utc)}.` : 'No upcoming game is on the published schedule.'];
    const against = [...(profiles.some((p) => !p.current?.games && p.prior?.games) ? [`The incoming player has no ${year} games in the source log; her last regular season is the only baseline, and it was with a different team.`] : []), 'Depth moves rarely move a game line on their own.'];
    const unknown = ['How many minutes the incoming player receives — there is no box score for the new role yet.'];
    const id = await hashId(['transaction', team.team_id, g.date.slice(0, 10), g.moves.join('|')]);
    const a0 = finalize({
      id, kind: 'transaction', category: 'Transactions', structure: 0, headline, deck, body, sections, market_type: null, bettor, against, unknown,
      market_angle: mt ? { text: mt.sentences, market: ng.market, game_id: ng.game_id } : { text: [ng ? 'No market snapshot exists yet for that game. Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.' : ''].filter(Boolean), market: null, game_id: ng?.game_id || null },
      lead_team_id: team.team_id, lead_player_id: onRoster[0]?.athlete_id || null, primary_subject: n, published_at: g.date,
      context: { team: { team_id: team.team_id, name: team.name, standing: st }, players: profiles, next_game: ng ? { game_id: ng.game_id, start_utc: ng.start_utc, home: ng.home, away: ng.away } : null },
      entities: [{ type: 'team', id: team.team_id, name: team.name }, ...onRoster.map((p) => ({ type: 'player', id: p.athlete_id, name: p.name })), ...(ng ? [gameEntity(ng)] : [])],
      facts: { moves: g.moves, profiles, provenance: provs, out: (feed || []).map(stripNotes), injury_scope: feed ? [team.team_id] : [], injury_feed_unavailable: !feed, standing: st, market: mt?.facts || null, rotation: rot?.rows?.map((r) => ({ name: r.name, position: r.position, min: r.min, reb: r.reb, starts: r.starts, appearances: r.appearances })), rotation_sample: rot?.sample, team_moves: teamMoves.map((t) => ({ date: t.date, description: t.description })), next_opponent: oppSt ? { name: oppNext.name, wins: oppSt.wins, losses: oppSt.losses, last_ten: oppSt.last_ten } : null, historical, derived: D },
      evidence: [{ kind: 'record', source: 'ESPN WNBA transactions log', url: 'https://www.espn.com/wnba/transactions', captured_at: new Date(now).toISOString(), record: { team: team.abbr, date: g.date, moves: g.moves } }, ...profiles.map((p) => ({ kind: 'record', source: `ESPN game log — ${p.name} (${p.current?.games ? p.current.season_name : p.prior ? p.prior.season_name : 'no games'})`, url: `https://www.espn.com/wnba/player/gamelog/_/id/${p.athlete_id}`, record: p.current || p.prior })), ...(recentLong.length ? [{ kind: 'record', source: 'ESPN WNBA injury feed', url: 'https://www.espn.com/wnba/injuries', record: stripNotes(recentLong[0]) }] : []), ...(rot?.games?.length ? [{ kind: 'record', source: `ESPN box scores, last ${rot.sample} ${n} games (observed rotation)`, url: `https://www.espn.com/wnba/team/schedule/_/id/${team.team_id}`, record: { games: rot.games } }] : []), ...(st ? [{ kind: 'record', source: 'ESPN standings', url: 'https://www.espn.com/wnba/standings', record: { team: stripNotes(st), next_opponent: oppSt || null } }] : []), ...(teamMoves.length ? [{ kind: 'record', source: 'ESPN WNBA transactions log (previous 30 days)', url: 'https://www.espn.com/wnba/transactions', record: { moves: teamMoves.map((t) => ({ date: t.date, description: t.description })) } }] : [])]
    });
    a0.meter = meterDelta(meter, t0);
    out.push(a0);
  }
  return out;
}

// ------------------------------------------------------------ 4. results / performances

const isTD = (r) => (r.pts ?? 0) >= 10 && (r.reb ?? 0) >= 10 && (r.ast ?? 0) >= 10;
const notable = (r) => (r.pts ?? 0) >= 28 || (r.reb ?? 0) >= 15 || (r.ast ?? 0) >= 12 || isTD(r);
const keyOf = (r) => (isTD(r) ? 'td' : (r.pts ?? 0) >= 28 ? 'pts' : (r.reb ?? 0) >= 15 ? 'reb' : 'ast');
const keyLabel = (r) => (isTD(r) ? `triple-double (${r.pts}, ${r.reb}, ${r.ast})` : (r.pts ?? 0) >= 28 ? `${r.pts} points` : (r.reb ?? 0) >= 15 ? `${r.pts} points and ${r.reb} rebounds` : `${r.ast} assists`);
const ZONE = { restricted_area: 'at the rim', paint: 'in the paint outside the restricted area', midrange: 'from midrange', corner_three: 'from the corners', above_break_three: 'from above the break' };
function shotProfile(live, athleteId) {
  const xs = (live.shots?.shots || []).filter((x) => String(x.athlete_id) === String(athleteId));
  if (xs.length < 8) return null;
  const by = {};
  for (const x of xs) { const k = x.zone || 'other'; by[k] = by[k] || { made: 0, att: 0 }; by[k].att += 1; if (x.made) by[k].made += 1; }
  return { att: xs.length, zones: Object.entries(by).filter(([k]) => ZONE[k]).map(([k, v]) => ({ zone: k, ...v })).sort((a, b) => b.att - a.att) };
}
const ordinalN = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const MOSTS = ['', 'most', 'second-most', 'third-most'];

export async function resultDeep(ctx) {
  const { api, finals, schedule, now, dict } = ctx;
  const historical = Boolean(ctx.historical);
  const meter = meterOf(ctx);
  const out = [];
  // Records and scoring come from each team's own schedule (arithmetic over final scores, correct as of the
  // game). The standings TABLE is present-day, so a historical run does not use it at all.
  const standingsById = historical ? new Map() : ctx.standingsById;
  const allStandings = [...standingsById.values()];
  const asOfLabel = `standings as of ${dShort(ctx.asOf || new Date(now).toISOString())}`;
  for (const g0 of finals) {
    const t0 = meter();
    const live = await api(`/v1/games/${g0.game_id}/live`);
    const gm = await api(`/v1/games/${g0.game_id}`);
    if (!live || !gm) continue;
    const g = live.game;
    if (g.status?.state !== 'post' || !g.status.completed) continue;
    const year = g.season?.year;
    const D = {};
    const box = live.box.players.filter((r) => !r.dnp && r.min);
    const boxLines = box.map((r) => ({ name: r.name, team_id: r.team_id, pts: r.pts ?? 0, reb: r.reb ?? 0, ast: r.ast ?? 0 }));
    const stars = box.filter(notable).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
    const winner = g.home.winner ? g.home : g.away;
    const loser = g.home.winner ? g.away : g.home;
    const W = nick(winner); const L = nick(loser);
    const margin = D.margin = winner.score - loser.score;
    const lead = live.derived?.lead;
    const loserSide = loser === g.home ? 'home' : 'away';
    const comeback = (lead?.largest_lead?.[loserSide]?.margin ?? 0) >= 12;
    const pc = gm.pickcenter?.[0] || null;
    const ot = (live.linescore || []).length > 4;
    if (!stars.length && !ot && !comeback && !pc) continue;
    const kind = stars.length ? 'performance' : 'result';
    const score = sc(winner.score, loser.score);
    const ls = live.linescore || [];
    const side = (t) => (t === g.home ? 'home' : 'away');
    const q = ls.map((x) => ({ label: x.label, w: x[side(winner)], l: x[side(loser)] }));
    const q1 = q[0];
    const half = q.length >= 2 ? { w: q[0].w + q[1].w, l: q[0].l + q[1].l } : null;
    if (half) { D.half_w = half.w; D.half_l = half.l; }
    const best = [...q].map((x, i) => ({ ...x, i, diff: x.w - x.l })).sort((a, b) => b.diff - a.diff)[0];
    const ts = (t) => live.box.teams.find((x) => x.team_id === t.team_id)?.stats || {};
    const tw = ts(winner); const tl = ts(loser);
    const run = live.derived?.runs?.largest ? Object.values(live.derived.runs.largest).sort((a, b) => b.points - a.points)[0] : null;
    // standings AFTER this game and scoring ENTERING it, from each team's own schedule (not today's table)
    const [tW, tL] = await Promise.all([api(`/v1/teams/${winner.team_id}`), api(`/v1/teams/${loser.team_id}`)]);
    const afterW = tW ? teamAsOf(tW.schedule, winner.team_id, g.start_utc, { inclusive: true, regIds: ctx.regIds }) : null;
    const afterL = tL ? teamAsOf(tL.schedule, loser.team_id, g.start_utc, { inclusive: true, regIds: ctx.regIds }) : null;
    const enterW = tW ? teamAsOf(tW.schedule, winner.team_id, g.start_utc, { inclusive: false, regIds: ctx.regIds }) : null;
    if (afterW) { D.after_w = [afterW.w, afterW.l]; }
    if (afterL) { D.after_l = [afterL.w, afterL.l]; }
    if (enterW?.ppg) { D.w_ppg_entering = enterW.ppg; D.w_scored_vs_entering = winner.score - enterW.ppg; }

    let ats = null;
    if (pc && pc.spread !== null) {
      const homeMargin = g.home.score - g.away.score;
      const c = homeMargin + pc.spread;
      ats = { provider: pc.provider, home_spread: pc.spread, over_under: pc.over_under, result: c > 0 ? 'home_cover' : c < 0 ? 'away_cover' : 'push', total_points: g.home.score + g.away.score };
      ats.total_result = pc.over_under === null ? null : ats.total_points > pc.over_under ? 'over' : ats.total_points < pc.over_under ? 'under' : 'push';
      D.total_points = ats.total_points; D.cover_by = Math.abs(c); D.total_by = pc.over_under !== null ? Math.abs(ats.total_points - pc.over_under) : null;
    }
    const favTeam = ats ? (ats.home_spread < 0 ? g.home : g.away) : null;
    const coverTeam = ats ? (ats.result === 'home_cover' ? g.home : ats.result === 'away_cover' ? g.away : null) : null;

    // stars against their own baselines ENTERING the game (current regular season, games before this one)
    const statLine = (r) => `${listJoin([`${r.pts} points`, ...((r.reb ?? 0) >= 8 ? [`${r.reb} rebounds`] : []), ...((r.ast ?? 0) >= 6 ? [`${r.ast} assists`] : [])])} on ${r.fgm}-of-${r.fga} shooting${r.fg3a ? ` (${r.fg3m}-of-${r.fg3a} from three)` : ''}${r.fta ? `, ${r.ftm}-of-${r.fta} at the line` : ''} in ${r.min} minutes`;
    const comparisons = [];
    const starParas = [];
    const provs = [];
    for (const r of stars.slice(0, 3)) {
      const pr = await api(`/v1/players/${r.athlete_id}`);
      const log = seasonLog(pr, year, dict?.teamById, { before: g.start_utc });
      const ent = log.current;
      const key = (r.pts ?? 0) >= 28 ? 'pts' : (r.reb ?? 0) >= 15 ? 'reb' : 'ast';
      const label = { pts: 'points', reb: 'rebounds', ast: 'assists' }[key];
      const c = { athlete_id: r.athlete_id, name: r.name, stat: key, value: r[key], entering: ent ? { games: ent.games, avg: ent[key], last10: ent.last10?.[key] ?? null, last10_games: ent.last10?.games ?? null } : null };
      if (ent) provs.push(prov(r.name, ent, 'entering_game'));
      const sp = shotProfile(live, r.athlete_id);
      const spText = sp && sp.zones.length >= 2 ? ` By ESPN’s shot locations, ${listJoin(sp.zones.slice(0, 3).map((z) => `${z.made}-of-${z.att} ${ZONE[z.zone]}`))}.` : '';
      let base = '';
      if (ent && Number.isFinite(ent[key]) && ent.games >= 3) {
        c.above = r[key] - ent[key];
        base = ` She came into the game averaging ${f1(ent[key])} ${label} over ${ent.games} games of the ${year} regular season, so this was ${f1(Math.abs(c.above))} ${c.above >= 0 ? 'above' : 'below'} it`;
        if (ent.last10 && ent.last10.games >= 5) {
          c.above_l10 = r[key] - ent.last10[key];
          const rising = ent.last10[key] - ent[key] >= 2;
          if (rising) c.l10_minus_season = ent.last10[key] - ent[key];
          base += ` and ${f1(Math.abs(c.above_l10))} ${c.above_l10 >= 0 ? 'above' : 'below'} her ${f1(ent.last10[key])} over the previous ${ent.last10.games}${rising ? ` — her recent baseline was already running ${f1(c.l10_minus_season)} above her season, so this is less of an outlier than the season number makes it look` : ''}`;
        }
        base += '.';
      }
      comparisons.push(c);
      starParas.push(`${r.name}: ${statLine(r)}${Number.isFinite(r.plus_minus) ? `, a ${sgn(r.plus_minus)} in her minutes` : ''}.${spText}${base}`);
    }

    // Every result names its performers. Without a notable line, the leading scorers on both sides carry the section,
    // with the top winner measured against her own entering baseline.
    const performerRows = [];
    if (!stars.length) {
      const leaders = (tid, k) => box.filter((x) => x.team_id === tid).sort((x, y) => (y.pts ?? 0) - (x.pts ?? 0)).slice(0, k);
      const wl = leaders(winner.team_id, 2);
      const ll = leaders(loser.team_id, 1);
      for (const [i, r] of [...wl, ...ll].entries()) {
        let base = '';
        if (i === 0) {
          const pr = await api(`/v1/players/${r.athlete_id}`);
          const ent = seasonLog(pr, year, dict?.teamById, { before: g.start_utc }).current;
          if (ent && ent.games >= 3 && Number.isFinite(ent.pts)) {
            provs.push(prov(r.name, ent, 'entering_game'));
            comparisons.push({ athlete_id: r.athlete_id, name: r.name, stat: 'pts', value: r.pts, entering: { games: ent.games, avg: ent.pts, last10: ent.last10?.pts ?? null, last10_games: ent.last10?.games ?? null }, above: (r.pts ?? 0) - ent.pts });
            base = ` She came in averaging ${f1(ent.pts)} points over ${ent.games} games of the ${year} regular season.`;
          }
        }
        const t = r.team_id === winner.team_id ? winner : loser;
        performerRows.push(r);
        starParas.push(`${r.name} (${nick(t)}): ${statLine(r)}${Number.isFinite(r.plus_minus) ? `, a ${sgn(r.plus_minus)} in her minutes` : ''}.${base}`);
      }
    }

    // co-leaders: the headline never implies one player did what two did (rule: reconcile.js CO_LEADER_RULE)
    const top = stars[0] || null;
    const headStat = top ? (keyOf(top) === 'pts' ? 'pts' : keyOf(top)) : null;
    const co = top ? coLeaders(boxLines, headStat).filter((x) => x.name) : [];
    const coNames = co.length > 1 ? co.map((x) => x.name) : top ? [top.name] : [];
    const coSameTeam = co.length > 1 && co.every((x) => x.team_id === co[0].team_id);
    const topTeam = top ? (top.team_id === winner.team_id ? winner : loser) : null;

    let thesis;
    if (co.length > 1 && headStat === 'pts') {
      const pts = co.map((x) => x.pts);
      const same = pts.every((v) => v === pts[0]);
      if (coSameTeam) { D.pair_pts = pts.reduce((s2, v) => s2 + v, 0); D.pair_share = pctOf(D.pair_pts, co[0].team_id === winner.team_id ? winner.score : loser.score); }
      thesis = `${listJoin(coNames)} ${same ? `scored ${pts[0]} apiece` : `scored ${listJoin(pts.map(String))}`} as the ${full(winner)} beat the ${full(loser)} ${score} on ${dLong(g.start_utc)}${coSameTeam ? ` — ${D.pair_pts} of the ${poss(nick(co[0].team_id === winner.team_id ? winner : loser))} ${co[0].team_id === winner.team_id ? winner.score : loser.score} points, ${f1(D.pair_share)}% of the team’s scoring` : ''}.`;
    } else if (top) thesis = `${top.name} ${topTeam === winner ? 'led' : 'could not save'} the ${nick(topTeam)} with ${statLine(top)} as the ${full(winner)} beat the ${full(loser)} ${score} on ${dLong(g.start_utc)}.`;
    else thesis = `The ${full(winner)} beat the ${full(loser)} ${score}${ot ? ` in ${ls.length - 4 === 1 ? 'overtime' : `${ls.length - 4} overtimes`}` : ''} on ${dLong(g.start_utc)}.`;
    if (ats && pc.over_under !== null) thesis += ` Against ${poss(pc.provider)} line, relayed by ESPN, the ${nick(favTeam)} were favored by ${Math.abs(ats.home_spread)}; ${coverTeam ? `${coverTeam === favTeam ? 'they' : `the ${nick(coverTeam)}`} covered by ${f1(D.cover_by)}` : 'the spread pushed'}, and the game went ${ats.total_result} the ${pc.over_under} total by ${f1(D.total_by)}. The question for the next slate is how much of that ${stars.length ? 'scoring' : 'margin'} repeats.`;

    const how = [];
    if (q1 && half && best) {
      const trailedQ1 = q1.w < q1.l;
      const runTxt = run && run.points >= 10 && run.team_id === winner.team_id && periodOf(run.from) === best.i + 1 && periodOf(run.to) === best.i + 1 ? `, with ${aan(run.points)} ${run.points}-0 run from ${clockOf(run.from)} to ${clockOf(run.to)} of that quarter` : '';
      how.push(`${trailedQ1 ? `It did not start that way: the ${L} led ${sc(q1.l, q1.w)} after one quarter${lead?.largest_lead?.[loserSide]?.margin ? ` and by as many as ${lead.largest_lead[loserSide].margin}` : ''}. ` : ''}The ${QUARTER[best.i + 1] ? `${QUARTER[best.i + 1]} quarter` : 'overtime'} was the swing — the ${W} won it ${sc(best.w, best.l)}${runTxt} — and ${half.w >= half.l ? 'they' : `the ${L}`} led ${sc(Math.max(half.w, half.l), Math.min(half.w, half.l))} at halftime.${lead ? ` The game had ${countOf(lead.lead_changes, 'lead change')}; the ${poss(W)} largest lead was ${lead.largest_lead[side(winner)].margin}.` : ''}`);
    }
    const shoot = (x) => x['fieldGoalsMade-fieldGoalsAttempted'];
    if (shoot(tw) && shoot(tl)) {
      const bench = (t) => live.box.players.filter((x) => x.team_id === t.team_id && !x.starter && !x.dnp).reduce((a2, x) => a2 + (x.pts || 0), 0);
      D.bench_w = bench(winner); D.bench_l = bench(loser);
      const lTop = live.box.players.filter((x) => x.team_id === loser.team_id && !x.dnp).sort((x, y) => (y.pts || 0) - (x.pts || 0)).slice(0, 2);
      how.push(`${D.bench_w < D.bench_l ? `The ${W} did it with their starters: their bench scored ${D.bench_w} to the ${poss(L)} ${D.bench_l}.` : `The ${poss(W)} bench outscored the ${poss(L)}, ${sc(D.bench_w, D.bench_l)}.`}${lTop.length === 2 && topTeam === winner ? ` For the ${L}, ${lTop[0].name} scored ${lTop[0].pts} (${lTop[0].fgm}-of-${lTop[0].fga}) and ${lTop[1].name} ${lTop[1].pts} (${lTop[1].fgm}-of-${lTop[1].fga}).` : ''}`);
      how.push(`The ${W} made ${shoot(tw)} from the field (${tw.fieldGoalPct}%) and ${tw['threePointFieldGoalsMade-threePointFieldGoalsAttempted']} from three; the ${L} ${shoot(tl)} (${tl.fieldGoalPct}%).${tl.turnoverPoints && tw.turnoverPoints ? ` Turnovers ran ${sc(tw.totalTurnovers ?? tw.turnovers, tl.totalTurnovers ?? tl.turnovers)}, and points off turnovers ${sc(tw.turnoverPoints, tl.turnoverPoints)}${Number(tl.turnoverPoints) > Number(tw.turnoverPoints) ? ` in the ${poss(L)} favor — the margin came from shooting, not possession control` : ''}.` : ''} Rebounds went ${sc(tw.totalRebounds, tl.totalRebounds)}, points in the paint ${sc(tw.pointsInPaint, tl.pointsInPaint)}.`);
    }

    const ctxParas = [];
    if (afterW && afterL) ctxParas.push(`After the result the ${W} were ${recWL(afterW.w, afterW.l)} and the ${L} ${recWL(afterL.w, afterL.l)} (team schedules through ${dMonth(g.start_utc)}).${Number.isFinite(D.w_scored_vs_entering) ? ` The ${poss(W)} ${winner.score} was ${f1(Math.abs(D.w_scored_vs_entering))} ${D.w_scored_vs_entering >= 0 ? 'above' : 'below'} the ${f1(enterW.ppg)} a game they averaged entering it.` : ''}`);
    const sl = standingsById.get(loser.team_id);
    if (sl && topTeam === winner && stars.length) {
      const rankAllowed = [...allStandings].sort((x, y) => y.points_against_avg - x.points_against_avg).findIndex((e) => e.team_id === loser.team_id) + 1;
      D.loser_allowed_rank = rankAllowed; D.league_teams = allStandings.length; D.loser_allowed = sl.points_against_avg;
      const rk = rankAllowed <= 3 ? `the ${MOSTS[rankAllowed]} of ${D.league_teams} teams` : `${ordinalN(rankAllowed)}-most of ${D.league_teams}`;
      ctxParas.push(rankAllowed <= 4 ? `Context cuts against reading too much into it: the ${L} allow ${f1(sl.points_against_avg)} points a game on the season (${asOfLabel}), ${rk}.` : `The opponent does not explain it away: the ${L} allow ${f1(sl.points_against_avg)} points a game on the season (${asOfLabel}), ${rk} — a middle-of-the-table defense.`);
    }
    const ngW = ctx.historical ? null : nextGame(schedule, winner.team_id);
    const ngL = ctx.historical ? null : nextGame(schedule, loser.team_id);
    const nextBits = [];
    for (const [t, ng] of [[winner, ngW], [loser, ngL]]) {
      if (!ng) continue;
      const mk = ng.market;
      const line = mk?.spread?.home_line;
      const fav = line !== null && line !== undefined ? (line < 0 ? ng.home : ng.away) : null;
      nextBits.push(`${ng.away.abbr} at ${ng.home.abbr} on ${dShort(ng.start_utc)}${fav ? `, where the market consensus has the ${nick(fav)} ${fav.team_id === t.team_id ? 'favored' : `favored over the ${nick(t)}`} by ${Math.abs(line)}${mk.total?.line ? ` with a total of ${mk.total.line}` : ''} (PropBetEdge capture, ${dShort(mk.captured_at)}, ${mk.books} books)` : mk ? '' : ' (no market capture yet)'}`);
    }
    if (ngW && nextBits.length) {
      const nOpp = ngW.home.team_id === winner.team_id ? ngW.away : ngW.home;
      const so = standingsById.get(nOpp.team_id);
      if (so) {
        const r2 = [...allStandings].sort((x, y) => y.points_against_avg - x.points_against_avg).findIndex((e) => e.team_id === nOpp.team_id) + 1;
        D.next_opp_allowed_rank = r2; D.next_opp_allowed = so.points_against_avg;
        nextBits[0] += ` — and the ${nick(nOpp)} allow ${f1(so.points_against_avg)} a game, ${r2 <= 3 ? `the ${MOSTS[r2]} in the league` : `${ordinalN(r2)}-most of ${allStandings.length}`}`;
      }
    }
    if (nextBits.length) ctxParas.push(`Next: ${nextBits.join('; ')}. Prop lines for ${stars.length ? listJoin(stars.slice(0, 2).map((r) => r.name)) : 'either team'} are captured only inside 36 hours of tip, and they are the market that has to digest ${stars.length ? 'these performances' : 'this result'}.`);

    const counter = [];
    const risers = comparisons.filter((c) => Number.isFinite(c.l10_minus_season));
    if (risers.length) counter.push(`${listJoin(risers.map((c) => `${poss(c.name)} previous-${c.entering.last10_games} average (${f1(c.entering.last10)}) already sat ${f1(c.l10_minus_season)} above her season mark`))}, so against recent form ${risers.length === 1 ? 'the game is a smaller outlier' : 'these are smaller outliers'} than the season averages make ${risers.length === 1 ? 'it' : 'them'} look`);
    if (sl && topTeam === winner && D.loser_allowed_rank <= 4) counter.push(`the ${L} allow ${f1(sl.points_against_avg)} a game, so part of the scoring is the opponent`);
    if (tl.turnoverPoints && tw.turnoverPoints && Number(tl.turnoverPoints) > Number(tw.turnoverPoints)) counter.push(`the ${W} gave up more points off turnovers than they scored, ${sc(tl.turnoverPoints, tw.turnoverPoints)}`);
    const counterPara = counter.length ? `The case against reading it forward: ${counter.join('; ')}. One game is a sample of one.` : null;

    const { body, sections } = assemble([['Game story', [thesis]], ['Who stood out', starParas], ['How it happened', how], ['What it means', [...(counterPara ? [counterPara] : []), ...ctxParas]]]);
    const headline = co.length > 1 && headStat === 'pts'
      ? (co.length <= 3 ? `${listJoin(coNames)} score ${co.every((x) => x.pts === co[0].pts) ? `${co[0].pts} apiece` : listJoin(co.map((x) => String(x.pts)))} as the ${W} beat the ${L}, ${score}` : `The ${W} beat the ${L}, ${score}, with the scoring lead shared`)
      : top ? (topTeam === winner ? `${poss(top.name)} ${keyLabel(top)} lead the ${W} past the ${L}, ${score}` : `The ${W} beat the ${L} ${score} despite ${poss(top.name)} ${keyLabel(top)}`)
        : `The ${full(winner)} beat the ${full(loser)}, ${score}`;
    const deck = `${ats && coverTeam ? `The ${nick(coverTeam)} covered ${poss(pc.provider)} ${Math.abs(ats.home_spread)}-point line` : `Final from ${dLong(g.start_utc)}`}${ats?.total_result && ats.total_result !== 'push' ? ` and the game ${ats.total_result === 'over' ? 'cleared' : 'stayed under'} ${pc.over_under} by ${f1(D.total_by)}` : ''}.${q1 && q1.w < q1.l ? ` The ${W} trailed ${sc(q1.l, q1.w)} after one quarter.` : ''}`;
    const bettor = [];
    if (ats) bettor.push(`On the spread: ${poss(pc.provider)} line, relayed by ESPN, had the ${nick(favTeam)} favored by ${Math.abs(ats.home_spread)}; the ${margin}-point margin put ${coverTeam ? `the ${nick(coverTeam)} on the right side of the spread` : 'the spread at a push'}. The ${ats.total_points} combined points went ${ats.total_result} the ${ats.over_under} total.`);
    else bettor.push('No closing line is available in the source record for this game, so this result carries no market grade.');
    const cs = comparisons.filter((c) => c.entering && Number.isFinite(c.entering.avg));
    if (cs.length) bettor.push(`${listJoin(cs.slice(0, 2).map((c) => `${c.name} (${c.value} ${{ pts: 'points', reb: 'rebounds', ast: 'assists' }[c.stat]} against ${f1(c.entering.avg)} entering the game${Number.isFinite(c.entering.last10) && c.entering.last10_games >= 5 ? ` and ${f1(c.entering.last10)} over her previous ${c.entering.last10_games}` : ''})`))} ${cs.length === 1 ? 'is' : 'are'} the ${cs.length === 1 ? 'line' : 'lines'} the next prop market has to price.`);
    const against = ['One game is a sample of one; the season average is the steadier baseline.', ...counter.map((x) => `${cap(x)}.`)];
    const unknown = ['How the market prices both teams on the next slate beyond the stored captures.', 'Whether the next posted prop lines adjust to these performances.'];

    const id = await hashId(['result', g.game_id]);
    const a0 = finalize({
      id, kind, category: stars.length ? 'Performances' : 'Results', structure: 0, headline, deck, body, sections, market_type: ats ? 'spread' : null, bettor, against, unknown,
      market_angle: { text: ats ? [`Market reference: ${pc.provider} via ESPN (a single sportsbook). PropBetEdge ${gm.market ? `also holds a pre-tip capture from ${dShort(gm.market.captured_at)}` : 'began storing its own market captures on September 11, 2026, so no PropBetEdge capture exists for this game'}.`] : [], market: gm.market || null, game_id: g.game_id, line: pc },
      lead_team_id: winner.team_id, lead_player_id: top?.athlete_id || null, primary_subject: W, published_at: g.last_play_wallclock || g.start_utc,
      context: { game: { game_id: g.game_id, start_utc: g.start_utc, home: g.home, away: g.away, venue: g.venue }, stars: stars.slice(0, 3) },
      entities: [gameEntity(g), { type: 'team', id: winner.team_id, name: winner.name }, { type: 'team', id: loser.team_id, name: loser.name }, ...stars.slice(0, 3).map((r) => ({ type: 'player', id: r.athlete_id, name: r.name }))],
      facts: { scores: { w: winner.score, l: loser.score, margin }, stars, performers: performerRows, box_lines: boxLines, headline_stat: headStat, co_leader_rule: CO_LEADER_RULE, lead, run, ats, after: { w: afterW, l: afterL }, entering: { w: enterW }, standings_now: { l: sl }, quarters: q, team_stats: { w: tw, l: tl }, comparisons, provenance: provs, next: [ngW, ngL].filter(Boolean).map((ng) => ({ start_utc: ng.start_utc, home: ng.home.abbr, away: ng.away.abbr, market: ng.market ? { spread: ng.market.spread.home_line, total: ng.market.total.line, books: ng.market.books, captured_at: ng.market.captured_at } : null })), derived: D },
      evidence: [{ kind: 'record', source: 'ESPN box score + play-by-play + shot locations', url: `https://www.espn.com/wnba/game/_/gameId/${g.game_id}`, record: { final: `${g.away.abbr} ${g.away.score} - ${g.home.abbr} ${g.home.score}`, events: live.events_total } }, { kind: 'record', source: 'ESPN team schedules (records after the game, scoring entering it)', url: 'https://www.espn.com/wnba/schedule', record: { after_w: afterW, after_l: afterL, entering_w: enterW } }, { kind: 'record', source: `ESPN standings (${asOfLabel})`, url: 'https://www.espn.com/wnba/standings', record: { l: sl } }, ...(pc ? [{ kind: 'market', source: `${pc.provider} line relayed by ESPN`, record: { spread_home: pc.spread, total: pc.over_under, home_ml: pc.home_moneyline, away_ml: pc.away_moneyline } }] : [])]
    });
    a0.meter = meterDelta(meter, t0);
    out.push(a0);
  }
  return out;
}

// ------------------------------------------------------------ 5. team market trends

/**
 * Is a run against one sportsbook's lines material enough for a standalone story? A lopsided record alone is not:
 * the misses must be large (average ≥ 3 points against the line) and repeated (≥ 2 by 10 or more). Returns
 * { material, reason, ...measures }. Exported for the tests and the run's trend decisions.
 */
export function trendMateriality(rows, { market }) {
  const n = rows.length;
  if (n < 8) return { material: false, reason: `only ${n} games with a line in the source record` };
  if (market === 'total') {
    const ov = rows.filter((r) => r.ou === 'O').length;
    const un = rows.filter((r) => r.ou === 'U').length;
    const unders = un >= ov;
    const misses = rows.map((r) => (unders ? r.total_line - r.total : r.total - r.total_line));
    const avgMiss = avg(misses);
    const big = misses.filter((x) => x >= 10).length;
    if (Math.max(ov, un) < 8) return { material: false, reason: `${Math.max(ov, un)} of ${n} is not a run` };
    if (avgMiss < 3) return { material: false, reason: `${Math.max(ov, un)} of ${n} ${unders ? 'unders' : 'overs'}, but by only ${f1(avgMiss)} points a game on average` };
    if (big < 2) return { material: false, reason: `only ${big} of the ${n} games missed the total by 10 or more` };
    return { material: true, reason: `${Math.max(ov, un)} of ${n} ${unders ? 'unders' : 'overs'}, ${f1(avgMiss)} points a game, ${big} by 10 or more`, avg_miss: avgMiss, big };
  }
  const atsW = rows.filter((r) => r.ats === 'W').length;
  const atsL = rows.filter((r) => r.ats === 'L').length;
  const covers = atsW >= atsL;
  const edges = rows.map((r) => (covers ? 1 : -1) * (r.margin + r.spread));
  const avgEdge = avg(edges);
  const big = edges.filter((x) => x >= 10).length;
  if (Math.max(atsW, atsL) < 7) return { material: false, reason: `${atsW}-${atsL} against the spread is not a run` };
  if (avgEdge < 3) return { material: false, reason: `${atsW}-${atsL} against the spread, but by only ${f1(avgEdge)} points a game on average` };
  if (big < 2) return { material: false, reason: `only ${big} of the ${n} results beat the spread by 10 or more` };
  return { material: true, reason: `${atsW}-${atsL} against the spread, ${f1(avgEdge)} points a game, ${big} by 10 or more`, avg_edge: avgEdge, big };
}

export async function trendDeep(ctx) {
  const { api, finalsByTeam, teams, schedule, now } = ctx;
  const historical = Boolean(ctx.historical);
  const standingsById = historical ? new Map() : ctx.standingsById;
  const meter = meterOf(ctx);
  const tn = nameByAbbr(teams);
  const out = [];
  out.decisions = [];
  for (const t of teams) {
    const t0 = meter();
    const games = (finalsByTeam.get(t.team_id) || []).slice(0, 10);
    if (games.length < 8) continue;
    const rows = [];
    for (const g of games) {
      const gm = await api(`/v1/games/${g.game_id}`);
      const pc = gm?.pickcenter?.[0];
      if (!pc || pc.spread === null || pc.over_under === null) continue;
      const home = g.home.team_id === t.team_id;
      const us = home ? g.home : g.away;
      const them = home ? g.away : g.home;
      const teamSpread = home ? pc.spread : -pc.spread;
      const m = us.score - them.score;
      const c = m + teamSpread;
      const tot = us.score + them.score;
      rows.push({ game_id: g.game_id, date: g.start_utc, opp: them.abbr, home, pts: us.score, opp_pts: them.score, spread: teamSpread, margin: m, ats: c > 0 ? 'W' : c < 0 ? 'L' : 'P', total_line: pc.over_under, total: tot, ou: tot > pc.over_under ? 'O' : tot < pc.over_under ? 'U' : 'P', provider: pc.provider });
    }
    if (rows.length < 8) continue;
    const n = rows.length;
    const atsW = rows.filter((r) => r.ats === 'W').length;
    const atsL = rows.filter((r) => r.ats === 'L').length;
    const ov = rows.filter((r) => r.ou === 'O').length;
    const un = rows.filter((r) => r.ou === 'U').length;
    const extremeAts = atsW >= 7 || atsL >= 7;
    const extremeOu = ov >= 8 || un >= 8;
    if (!extremeAts && !extremeOu) continue;
    const marketType = extremeOu && !extremeAts ? 'total' : 'spread';
    const mat = trendMateriality(rows, { market: marketType });
    if (!mat.material) { out.decisions.push({ team: t.short_name, market: marketType, decision: 'withheld', reason: mat.reason }); continue; }
    out.decisions.push({ team: t.short_name, market: marketType, decision: 'standalone', reason: mat.reason });
    const D = {};
    const provider = rows[0].provider;
    const T = t.short_name;
    const st = standingsById.get(t.team_id);
    const ng = ctx.historical ? null : nextGame(schedule, t.team_id);
    const nm = ng?.market || null;
    const nOpp = ng ? (ng.home.team_id === t.team_id ? ng.away : ng.home) : null;
    const so = nOpp ? standingsById.get(nOpp.team_id) || null : null;
    const hist = nm?.odds_event_id && !historical ? ((await api(`/v1/odds?event=${nm.odds_event_id}`))?.history || []) : [];
    const older = rows.slice(Math.ceil(n / 2));
    const newer = rows.slice(0, Math.ceil(n / 2));
    const push = n - atsW - atsL;
    const rec = `${atsW}-${atsL}${push ? `-${push}` : ''}`;
    const evidence = [];
    const marketNow = [];
    const teamCtx = [];
    let headline; let deck; let thesis; let bettor; let against; let unknown; let counterPara = null;
    if (st) teamCtx.push(`The ${full(t)} are ${recWL(st.wins, st.losses)}${st.last_ten ? `, ${st.last_ten} over their last 10` : ''}, scoring ${f1(st.points_for_avg)} points a game and allowing ${f1(st.points_against_avg)} on the season.`);
    if (ng && so) teamCtx.push(`Next up is ${ng.home.team_id === t.team_id ? `a home game against the ${full(nOpp)}` : `a road game against the ${full(nOpp)}`} on ${dLong(ng.start_utc)}; the ${nick(nOpp)} are ${recWL(so.wins, so.losses)} and score ${f1(so.points_for_avg)} while allowing ${f1(so.points_against_avg)}.`);
    const moved = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x !== y;
    if (marketType === 'total') {
      const unders = un >= ov;
      const dir = unders ? 'under' : 'over';
      D.avg_line = avg(rows.map((r) => r.total_line)); D.avg_total = avg(rows.map((r) => r.total)); D.avg_miss = D.avg_total - D.avg_line;
      D.avg_pts = avg(rows.map((r) => r.pts)); D.avg_opp_pts = avg(rows.map((r) => r.opp_pts));
      const bigMiss = rows.filter((r) => (unders ? r.total_line - r.total : r.total - r.total_line) >= 10);
      D.big_miss = bigMiss.length;
      D.older_avg_line = avg(older.map((r) => r.total_line)); D.newer_avg_line = avg(newer.map((r) => r.total_line));
      D.older_miss = avg(older.map((r) => r.total - r.total_line)); D.newer_miss = avg(newer.map((r) => r.total - r.total_line));
      D.newer_hits = newer.filter((r) => r.ou === (unders ? 'U' : 'O')).length; D.older_hits = older.filter((r) => r.ou === (unders ? 'U' : 'O')).length;
      if (st) { D.pts_vs_season = D.avg_pts - st.points_for_avg; D.opp_vs_season = D.avg_opp_pts - st.points_against_avg; }
      const driver = st ? (Math.abs(D.pts_vs_season) >= Math.abs(D.opp_vs_season) ? 'own' : 'opp') : null;
      const ptWord = (v) => (Math.abs(Math.abs(v) - 1) < 0.05 ? 'point' : 'points');
      headline = `${unders ? 'Unders' : 'Overs'} in ${Math.max(ov, un)} of the ${poss(T)} last ${n}: ${driver === 'own' ? `the ${poss(T)} own scoring is the bigger part` : driver === 'opp' ? 'their opponents’ scoring is the bigger part' : 'a pricing run, measured'}`;
      deck = `The ${poss(T)} last ${n} games averaged ${f1(D.avg_total)} points against an average ${provider} total of ${f1(D.avg_line)} — ${f1(Math.abs(D.avg_miss))} ${dir} per game, ${wordN(bigMiss.length)} of them by 10 or more.${nm?.total?.line ? ` The next consensus total is ${nm.total.line}.` : ''}`;
      thesis = `The ${poss(full(t))} last ${n} completed games with a line in the source record went ${dir} the total ${Math.max(ov, un)} times. The misses were not marginal: the games averaged ${f1(D.avg_total)} points against an average total of ${f1(D.avg_line)}, and ${wordN(bigMiss.length)} of them landed 10 or more points ${dir}.${st ? ` The source of the gap matters for whether it lasts: the ${T} averaged ${f1(D.avg_pts)} points in those games, ${f1(Math.abs(D.pts_vs_season))} ${ptWord(D.pts_vs_season)} ${D.pts_vs_season < 0 ? 'below' : 'above'} their season average of ${f1(st.points_for_avg)}, while their opponents averaged ${f1(D.avg_opp_pts)}, ${f1(Math.abs(D.opp_vs_season))} ${ptWord(D.opp_vs_season)} ${D.opp_vs_season < 0 ? 'below' : 'above'} the ${f1(st.points_against_avg)} they allow on the season. ${driver === 'own' ? `Most of the ${dir} run is the ${poss(T)} own offense ${D.pts_vs_season < 0 ? 'falling short' : 'running hot'}.` : `More of it is the opponents’ scoring than the ${poss(T)} own.`}` : ''}`;
      evidence.push(`Does it persist across the window? The ${wordN(older.length)} older games went ${dir} ${wordN(D.older_hits)} times and the ${wordN(newer.length)} most recent ${wordN(D.newer_hits)} times; the average total was ${f1(D.older_avg_line)} on the older games and ${f1(D.newer_avg_line)} on the recent ones.`);
      const exceptions = rows.filter((r) => r.ou === (unders ? 'O' : 'U'));
      if (exceptions.length) D.max_exception = Math.max(...exceptions.map((r) => Math.abs(r.total - r.total_line)));
      if (exceptions.length) evidence.push(`The exceptions: ${exceptions.map((r) => `${dMonth(r.date)} ${r.home ? 'against' : 'at'} ${tn(r.opp)}, ${r.total} points against a total of ${r.total_line}`).join('; ')}.`);
      evidence.push(`Game by game: ${rows.map((r) => `${dShort(r.date)} ${r.home ? 'vs' : 'at'} ${r.opp} ${sc(r.pts, r.opp_pts)} (${r.total} points, total ${r.total_line})`).join('; ')}.`);
      evidence.push(`For the record, the same games went ${rec} against the spread.`);
      if (ng && nm?.total?.line) {
        D.next_total = nm.total.line; D.next_vs_window = nm.total.line - D.avg_line;
        const ob = nm.total.over_best; const ub = nm.total.under_best;
        marketNow.push(`The market now: PropBetEdge’s capture of ${dShort(nm.captured_at)} (${nm.books} books, The Odds API) has the total for ${ng.away.abbr} at ${ng.home.abbr} on ${dShort(ng.start_utc)} at ${nm.total.line}, ${f1(Math.abs(D.next_vs_window))} ${D.next_vs_window < 0 ? 'below' : 'above'} the run’s average total.${ob && ub && Number.isFinite(ob.point) && Number.isFinite(ub.point) ? ` Best prices: over ${ob.point} at ${am(ob.price)} (${book(ob.book)}), under ${ub.point} at ${am(ub.price)} (${book(ub.book)}).` : ''}`);
        if (hist.length >= 2) marketNow.push(`Across ${countOf(hist.length, 'stored capture')} since ${dShort(hist[0].at)}, that total ${moved(hist[0].total, hist.at(-1).total) ? `moved from ${hist[0].total} to ${hist.at(-1).total}` : `has held at ${hist.at(-1).total}`}.`);
        const mu = await api(`/v1/matchups/${ng.game_id}`);
        const ot = mu?.teams?.find((x) => x.team?.team_id === nOpp.team_id);
        const oTot = ot?.form?.last10?.length ? avg(ot.form.last10.map((x) => x.pts + x.opp_pts)) : null;
        if (Number.isFinite(oTot)) {
          D.next_opp_last10_total = oTot;
          const pulls = unders ? oTot < D.avg_line - 3 : oTot > D.avg_line + 3;
          teamCtx.push(pulls ? `The opponent pulls the same way: the ${poss(nick(nOpp))} last 10 games averaged ${f1(oTot)} total points, so a low number for that game is not only an adjustment to the ${T}.` : `The opponent does not explain it: the ${poss(nick(nOpp))} last 10 games averaged ${f1(oTot)} total points.`);
        }
      }
      counterPara = `The case against the run: ${n} games against one sportsbook’s totals is a small sample${exceptions.length ? `, and ${wordN(exceptions.length)} of them went ${unders ? 'over' : 'under'}, one by ${f1(D.max_exception)}` : ''}. Totals are set against both teams, so the next opponent changes the baseline, and the run describes past pricing rather than forecasting the next game.`;
      bettor = [`The ${dir} run is ${f1(Math.abs(D.avg_miss))} points a game against ${poss(provider)} totals over ${n} games; ${driver === 'own' ? `it tracks the ${poss(T)} own scoring, which is the part to watch` : 'it tracks opponents’ scoring as much as the team’s own'}.`];
      if (Number.isFinite(D.next_vs_window) && Number.isFinite(D.newer_avg_line)) bettor.push(`Whether the market has caught up: the recent average total was ${f1(D.newer_avg_line)}, and the next consensus total sits ${f1(Math.abs(D.next_vs_recent = nm.total.line - D.newer_avg_line))} ${nm.total.line < D.newer_avg_line ? 'below' : 'above'} it${(D.newer_avg_line < D.older_avg_line) === unders ? ', so the price has moved in the direction of the run' : ', so the price has not followed the run'}.`);
      against = [`A ${n}-game run against one sportsbook’s totals is fragile${exceptions.length ? `, and ${wordN(exceptions.length)} of the games went the other way, one by ${f1(D.max_exception)}` : ''}.`, 'Totals are set against both teams; the next opponent’s scoring changes the baseline.'];
      unknown = ['Whether the total has fully adjusted beyond the stored captures.'];
    } else {
      const covers = atsW >= 7;
      D.avg_margin = avg(rows.map((r) => r.margin)); D.avg_spread = avg(rows.map((r) => r.spread)); D.edge = D.avg_margin + D.avg_spread;
      D.big_cover = rows.map((r) => r.margin + r.spread).filter((x) => (covers ? x : -x) >= 10).length;
      D.older_avg_spread = avg(older.map((r) => r.spread)); D.newer_avg_spread = avg(newer.map((r) => r.spread));
      D.newer_hits = newer.filter((r) => r.ats === (covers ? 'W' : 'L')).length; D.older_hits = older.filter((r) => r.ats === (covers ? 'W' : 'L')).length;
      headline = `The ${T} are ${rec} against the spread in their last ${n}: ${covers ? 'the lines have undersold them' : 'the lines have oversold them'} by ${f1(Math.abs(D.edge))} a game`;
      deck = `Against ${poss(provider)} spreads relayed by ESPN: an average spread of ${sgn(D.avg_spread)} against an average margin of ${sgn(D.avg_margin)}, ${wordN(D.big_cover)} of the ${n} results beating the line by 10 or more.`;
      thesis = `Over their last ${n} completed games with a line in the source record, the ${full(t)} went ${rec} against the spread. On average they were ${D.avg_spread > 0 ? `${f1(D.avg_spread)}-point underdogs` : `${f1(-D.avg_spread)}-point favorites`} and finished at ${sgn(D.avg_margin)} — ${f1(Math.abs(D.edge))} points a game ${covers ? 'better' : 'worse'} than the spread. ${cap(wordN(D.big_cover))} of the ${n} ${covers ? 'covers' : 'misses'} came by 10 or more.`;
      evidence.push(`Does it persist across the window? The ${wordN(older.length)} older games produced ${wordN(D.older_hits)} ${covers ? 'covers' : 'misses'} and the ${wordN(newer.length)} most recent ${wordN(D.newer_hits)}; the average spread was ${sgn(D.older_avg_spread)} on the older games and ${sgn(D.newer_avg_spread)} on the recent ones.`);
      evidence.push(`Game by game: ${rows.map((r) => `${dShort(r.date)} ${r.home ? 'vs' : 'at'} ${r.opp} ${sc(r.pts, r.opp_pts)} (${sgn(r.spread)}, ${r.ats === 'W' ? 'covered' : r.ats === 'L' ? 'failed to cover' : 'push'})`).join('; ')}.`);
      evidence.push(`For the record, totals in the same games went ${ov}-${un}.`);
      if (nm?.spread?.home_line !== null && nm?.spread?.home_line !== undefined) {
        D.next_spread = ng.home.team_id === t.team_id ? nm.spread.home_line : -nm.spread.home_line;
        marketNow.push(`The market now: PropBetEdge’s capture of ${dShort(nm.captured_at)} (${nm.books} books, The Odds API) has the ${T} at ${sgn(D.next_spread)} for ${ng.away.abbr} at ${ng.home.abbr} on ${dShort(ng.start_utc)}.`);
        if (hist.length >= 2) marketNow.push(`Across ${countOf(hist.length, 'stored capture')} since ${dShort(hist[0].at)}, the consensus home spread ${moved(hist[0].spread, hist.at(-1).spread) ? `moved from ${sgn(hist[0].spread)} to ${sgn(hist.at(-1).spread)}` : `has held at ${sgn(hist.at(-1).spread)}`}.`);
      }
      counterPara = `The case against the run: ${n} games against one sportsbook’s spreads is a small sample, and a market that has already adjusted leaves nothing of the run in the next spread.`;
      bettor = [`Read against the pricing: over these ${n} games the spreads ${covers ? 'undersold' : 'oversold'} the ${T} by ${f1(Math.abs(D.edge))} points a game.`];
      if (Number.isFinite(D.next_spread)) bettor.push(`The recent average spread was ${sgn(D.newer_avg_spread)} against ${sgn(D.older_avg_spread)} earlier in the window; the next consensus spread of ${sgn(D.next_spread)} is the market’s current answer.`);
      against = [`Sample size is ${n}, against one sportsbook’s spreads.`, 'A market that has already adjusted leaves nothing of the run in the next spread.'];
      unknown = ['Whether the next spread has fully adjusted.'];
    }
    const nextParas = ng ? [`What comes next: ${ng.away.abbr} at ${ng.home.abbr} on ${dLong(ng.start_utc)}, the first game that tests whether the run continues against a multi-book price.`] : [];
    const { body, sections } = assemble([['The run', [thesis]], ['The numbers', evidence], ['The next line', marketNow], ['Next matchup', teamCtx], ['What could break the trend', [counterPara]], ['Next up', nextParas]]);
    const id = await hashId(['trend', t.team_id, new Date(now).toISOString().slice(0, 10)]);
    const a0 = finalize({
      id, kind: 'trend', category: 'Team trends', structure: 0, headline, deck, body, sections, market_type: marketType, bettor, against, unknown,
      market_angle: { text: [], market: null, game_id: null },
      lead_team_id: t.team_id, lead_player_id: null, primary_subject: T, published_at: rows[0].date,
      context: { team: { team_id: t.team_id, name: t.name }, rows },
      entities: [{ type: 'team', id: t.team_id, name: t.name }, ...(ng ? [gameEntity(ng)] : [])],
      facts: { rows, atsW, atsL, ov, un, n, materiality: mat, standing: st, next: ng ? { start_utc: ng.start_utc, opponent: nOpp?.name, opponent_standing: so, market: nm ? { spread: nm.spread?.home_line, total: nm.total?.line, books: nm.books, captured_at: nm.captured_at, over_best: nm.total?.over_best || null, under_best: nm.total?.under_best || null } : null } : null, market_history: hist, derived: D },
      evidence: [...rows.map((r) => ({ kind: 'market', source: `${r.provider} line relayed by ESPN`, url: `https://www.espn.com/wnba/game/_/gameId/${r.game_id}`, record: r })), ...(st ? [{ kind: 'record', source: 'ESPN standings', url: 'https://www.espn.com/wnba/standings', record: { team: st, next_opponent: so } }] : []), ...(nm ? [{ kind: 'market', source: 'The Odds API (stored PropBetEdge snapshot)', captured_at: nm.captured_at, record: { books: nm.books, spread_home: nm.spread?.home_line, total: nm.total?.line } }] : []), ...(hist.length ? [{ kind: 'market', source: 'The Odds API (stored PropBetEdge capture history)', record: { captures: hist.length } }] : [])],
      input_hash: rows.map((r) => r.game_id).join(',')
    });
    a0.meter = meterDelta(meter, t0);
    out.push(a0);
  }
  return out;
}
