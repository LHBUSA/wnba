// Game-story generator — wnba-game-story/1.0.0.
//
// Turns a completed basketball game's STORED records (normalized game + linescores, box score, play-by-play when the
// provider publishes it, the competition schedule and earlier box scores) into a fact block and an article that
// tells the game. Every number in the prose is a value in `facts.game`, so the publication gate's number classes
// still apply; every derived value (margins, runs, lead changes, separators) is computed deterministically here
// from those records and nothing the source does not supply is ever stated.
//
// Temporal contract: `cutoff` is the generation instant. The game record must have been observed at or before it;
// plays whose wall clock is later than the cutoff or than the detail observation are excluded; earlier games count
// only when they finished and were observed before the cutoff. A revision can never use evidence from its future.

import { dLong, listJoin, poss, sc, f1, cap, aan } from './prose.js';
import { coLeaders } from './reconcile.js';
import { assessDepth } from './depth.js';

export const GAME_STORY_VERSION = 'wnba-game-story/1.0.0';

/** Story classes and the editorial substance a rich-data story of each class must carry. */
export const DEPTH_RULES = {
  medal: { min_words: 800, target: [800, 1300], requires: ['lede', 'flow', 'decisive', 'why', 'performers', 'opponent', 'context'] },
  elimination: { min_words: 650, target: [650, 1100], requires: ['lede', 'flow', 'decisive', 'why', 'performers', 'context'] },
  recap: { min_words: 550, target: [600, 1000], requires: ['lede', 'flow', 'why', 'performers'] },
  breaking: { min_words: 60, target: [60, 300], requires: ['lede'] }
};

const ROUND = {
  FINAL: { cls: 'medal', label: 'gold-medal game', medal: ['gold', 'silver'], place: [1, 2] },
  BRONZE: { cls: 'medal', label: 'bronze-medal game', medal: ['bronze', null], place: [3, 4] },
  SF: { cls: 'elimination', label: 'semifinal', next: ['the gold-medal game', 'the bronze-medal game'] },
  QF: { cls: 'elimination', label: 'quarterfinal', next: ['the semifinals', null] },
  QQF: { cls: 'elimination', label: 'qualification round for the quarterfinals', next: ['the quarterfinals', null] },
  GROUP: { cls: 'recap', label: 'group-stage game' }
};
const ORD = ['', 'first', 'second', 'third', 'fourth'];
const PLACE = ['', 'first', 'second', 'third', 'fourth'];

// ------------------------------------------------------------ grammar

const NOUNS = {
  point: 'points', rebound: 'rebounds', assist: 'assists', steal: 'steals', block: 'blocks', turnover: 'turnovers',
  foul: 'fouls', minute: 'minutes', 'three-pointer': 'three-pointers', 'free throw': 'free throws', game: 'games',
  'lead change': 'lead changes', tie: 'ties', start: 'starts', 'offensive rebound': 'offensive rebounds', win: 'wins', loss: 'losses'
};
/** "1 assist", "2 assists", "1 three-pointer". Deterministic singular/plural for every counted stat noun. */
export const count = (n, noun) => `${n} ${n === 1 ? noun : NOUNS[noun] || `${noun}s`}`;
const pct = (m, a) => (a > 0 ? Math.round((m / a) * 1000) / 10 : null);
const num = (v) => (Number.isFinite(v) ? v : null);

// ------------------------------------------------------------ participation

/**
 * Did the player appear? ESPN's FIBA box scores often omit minutes for everyone, so "min > 0" is not a participation
 * test. A player appeared when she is not marked DNP and either has minutes, started, or registered any box-score
 * event (a shot, a rebound, a foul …). A row of all zeros with no minutes and no start is not an appearance.
 */
export function participated(p) {
  if (!p || p.did_not_play) return false;
  if (Number.isFinite(p.min)) return p.min > 0;
  if (p.starter) return true;
  return ['pts', 'fga', 'fta', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf'].some((k) => (p[k] || 0) > 0);
}

// ------------------------------------------------------------ facts

const gameScore = (p) => (p.pts || 0) + 0.4 * (p.fgm || 0) - 0.7 * (p.fga || 0) - 0.4 * ((p.fta || 0) - (p.ftm || 0)) + 0.7 * (p.oreb || 0) + 0.3 * (p.dreb || 0) + (p.stl || 0) + 0.7 * (p.ast || 0) + 0.7 * (p.blk || 0) - 0.4 * (p.pf || 0) - (p.tov || 0);
const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };

function teamTotals(t) {
  const x = t.totals || {};
  const starters = t.players.filter((p) => p.starter);
  const bench = t.players.filter((p) => !p.starter && participated(p));
  return {
    pts: x.pts, fgm: x.fgm, fga: x.fga, fg_pct: pct(x.fgm, x.fga), fg3m: x.fg3m, fg3a: x.fg3a, fg3_pct: pct(x.fg3m, x.fg3a),
    ftm: x.ftm, fta: x.fta, ft_pct: pct(x.ftm, x.fta), reb: x.reb, oreb: x.oreb, dreb: x.dreb, ast: x.ast, stl: x.stl, blk: x.blk,
    tov: x.tov, pf: x.pf, bench_pts: starters.length ? bench.reduce((s, p) => s + (p.pts || 0), 0) : null, players_used: t.players.filter(participated).length
  };
}

function playerLine(p, team) {
  return {
    player_id: p.player_id, espn_id: p.provider_ids?.espn || null, name: p.name, team: team.name, team_slug: team.slug, starter: Boolean(p.starter),
    min: num(p.min), pts: p.pts || 0, reb: p.reb || 0, oreb: p.oreb || 0, ast: p.ast || 0, stl: p.stl || 0, blk: p.blk || 0, tov: p.tov || 0, pf: p.pf || 0,
    fgm: p.fgm || 0, fga: p.fga || 0, fg3m: p.fg3m || 0, fg3a: p.fg3a || 0, ftm: p.ftm || 0, fta: p.fta || 0, fg_pct: pct(p.fgm || 0, p.fga || 0),
    game_score: Math.round(gameScore(p) * 10) / 10,
    wnba: p.wnba ? { player_id: p.wnba.wnba_player_id, team: p.wnba.wnba_team?.name || null, abbr: p.wnba.wnba_team?.abbr || null } : null
  };
}

/** Largest net stretch for the winner (maximum-subarray over scoring plays), plus lead changes, ties, largest leads. */
export const STRETCH_WINDOW_S = 600;

export function playFacts(plays, { winnerId, loserId, homeId }) {
  const scoring = plays.filter((p) => p.scoring && Number.isFinite(p.home_score) && Number.isFinite(p.away_score));
  if (!scoring.length) return null;
  const marginFor = (p) => (winnerId === homeId ? p.home_score - p.away_score : p.away_score - p.home_score);
  let leader = 0;
  let leadChanges = 0;
  let ties = 0;
  let wLead = { value: 0 };
  let lLead = { value: 0 };
  let lastTie = null;
  let lastLoserLead = null;
  let prevWinner = 0;
  let prevLoser = 0;
  const deltas = [];
  for (const [i, p] of scoring.entries()) {
    const m = marginFor(p);
    const wPts = winnerId === homeId ? p.home_score : p.away_score;
    const lPts = winnerId === homeId ? p.away_score : p.home_score;
    deltas.push({ i, play: p, w: wPts - prevWinner, l: lPts - prevLoser, wPts, lPts, margin: m });
    prevWinner = wPts;
    prevLoser = lPts;
    const now = m > 0 ? 1 : m < 0 ? -1 : 0;
    if (now === 0 && wPts + lPts > 0) { ties += 1; lastTie = p; }
    if (now !== 0 && leader !== 0 && now !== leader) leadChanges += 1;
    if (now !== 0) leader = now;
    if (m < 0) lastLoserLead = p;
    if (m > wLead.value) wLead = { value: m, period: p.period, clock: p.clock, w: wPts, l: lPts };
    if (-m > lLead.value) lLead = { value: -m, period: p.period, clock: p.clock, w: wPts, l: lPts };
  }
  // Decisive stretch: the best net scoring window for the winner that spans at most STRETCH_WINDOW_S of game time
  // (period + clock from the play-by-play). Ties go to the shorter window.
  const elapsed = (p) => { const m = String(p.clock || '').match(/^(\d+):(\d+(?:\.\d+)?)$/); const secs = m ? Number(m[1]) * 60 + Number(m[2]) : Number(p.clock) || 0; return ((p.period || 1) - 1) * 600 + (600 - secs); };
  // The separation that held starts after the last moment the winner was not ahead; search there first.
  const lastLevel = deltas.reduce((k, d, i) => (d.margin <= 0 ? i : k), -1);
  let best = { net: 0 };
  const search = (from) => { for (let a0 = from; a0 < deltas.length; a0 += 1) {
    let net = 0;
    for (let b0 = a0; b0 < deltas.length; b0 += 1) {
      if (elapsed(deltas[b0].play) - elapsed(deltas[a0].play) > STRETCH_WINDOW_S) break;
      net += deltas[b0].w - deltas[b0].l;
      if (net > best.net || (net === best.net && best.end !== undefined && b0 - a0 < best.end - best.start)) best = { net, start: a0, end: b0 };
    }
  } };
  search(lastLevel + 1);
  const held = best.net >= 8;
  if (!held) { best = { net: 0 }; search(0); }
  let stretch = null;
  if (best.net > 0) {
    const s = deltas[best.start];
    const e = deltas[best.end];
    const before = best.start > 0 ? deltas[best.start - 1] : { wPts: 0, lPts: 0 };
    const within = deltas.slice(best.start, best.end + 1);
    const wRun = within.reduce((a, d) => a + d.w, 0);
    const lRun = within.reduce((a, d) => a + d.l, 0);
    const startIdx = plays.indexOf(s.play);
    const endIdx = plays.indexOf(e.play);
    const window = plays.slice(Math.max(0, startIdx), endIdx + 1);
    const loserTov = window.filter((p) => /turnover/i.test(p.type || '') && p.team_id === loserId).length;
    const winnerStl = window.filter((p) => /steal/i.test(p.type || '') && p.team_id === winnerId).length;
    const scorers = new Map();
    for (const d of within) {
      if (!d.w || d.play.team_id !== winnerId) continue;
      const pid = d.play.player_ids?.[0];
      if (pid) scorers.set(pid, (scorers.get(pid) || 0) + d.w);
    }
    stretch = {
      held_to_the_end: held,
      winner_pts: wRun, loser_pts: lRun,
      start: { period: s.play.period, clock: s.play.clock, w: before.wPts, l: before.lPts },
      end: { period: e.play.period, clock: e.play.clock, w: e.wPts, l: e.lPts },
      loser_turnovers: loserTov, winner_steals: winnerStl,
      top_scorers: [...scorers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([player_id, pts]) => ({ player_id, pts }))
    };
  }
  const quarterTov = {};
  for (const p of plays) {
    if (!/turnover/i.test(p.type || '') || !p.period) continue;
    const k = p.team_id === winnerId ? 'winner' : p.team_id === loserId ? 'loser' : null;
    if (!k) continue;
    quarterTov[k] = quarterTov[k] || [0, 0, 0, 0, 0];
    quarterTov[k][p.period] = (quarterTov[k][p.period] || 0) + 1;
  }
  return {
    lead_changes: leadChanges, ties, largest_lead_winner: wLead.value ? wLead : null, largest_lead_loser: lLead.value ? lLead : null,
    last_loser_lead: lastLoserLead ? { period: lastLoserLead.period, clock: lastLoserLead.clock } : null,
    last_tie: lastTie ? { period: lastTie.period, clock: lastTie.clock } : null,
    stretch, turnovers_by_quarter: quarterTov, plays_used: plays.length
  };
}

const roundOf = (g) => ROUND[g.round] || ROUND.GROUP;

/**
 * The fact block. `schedule` is the competition schedule; `priorDetails` maps ESPN game id → detail for earlier games
 * of either team (optional). Returns { facts } or { error } when the evidence postdates the cutoff.
 */
export function buildGameFacts({ competition, detail, schedule = [], priorDetails = {}, cutoff, medals = null }) {
  const cutoffMs = ms(cutoff);
  const g = detail.game;
  const observedAt = detail.fetched_at || g.fetched_at || null;
  if (cutoffMs === null) return { error: 'cutoff_required' };
  if (observedAt && ms(observedAt) > cutoffMs) return { error: 'source_observed_after_cutoff', observed_at: observedAt, cutoff };
  if (g.status !== 'final' || !g.winner) return { error: 'game_not_final' };
  const home = g.winner === g.home_team_id;
  const winner = home ? g.home_team : g.away_team;
  const loser = home ? g.away_team : g.home_team;
  const boxOf = (t) => detail.boxscore?.teams?.find((x) => x.team.team_id === t.team_id) || null;
  const wBox = boxOf(winner);
  const lBox = boxOf(loser);
  const r = roundOf(g);
  const quarters = g.linescores && Array.isArray(g.linescores.home) && g.linescores.home.length >= 4 ? { winner: home ? g.linescores.home : g.linescores.away, loser: home ? g.linescores.away : g.linescores.home } : null;
  const observedMs = ms(observedAt) ?? cutoffMs;
  const plays = (detail.plays || []).filter((p) => { const w = ms(p.wallclock); return w === null || (w <= cutoffMs && w <= observedMs); });

  const facts = {
    story_class: wBox && lBox ? r.cls : 'breaking',
    competition: { name: competition.name, short_name: competition.short_name || null, host_city: competition.host?.city || null, host_country: competition.host?.country || null },
    round: { code: g.round, name: g.round_name, label: r.label },
    scheduled_at: g.scheduled_at,
    venue: g.venue || null,
    winner: { name: winner.name, slug: winner.slug, team_id: winner.team_id, code: winner.country_code, flag: winner.flag || null, color: winner.color || null, score: home ? g.home_score : g.away_score },
    loser: { name: loser.name, slug: loser.slug, team_id: loser.team_id, code: loser.country_code, flag: loser.flag || null, color: loser.color || null, score: home ? g.away_score : g.home_score },
    margin: Math.abs(g.home_score - g.away_score),
    provenance: { source_event_at: g.scheduled_at, source_observed_at: observedAt, generation_cutoff: cutoff, plays_published: (detail.plays || []).length, plays_used: plays.length }
  };
  if (!wBox || !lBox) return { facts };

  if (quarters) {
    const cum = { winner: [], loser: [] };
    quarters.winner.forEach((v, i) => { cum.winner.push((cum.winner[i - 1] || 0) + v); cum.loser.push((cum.loser[i - 1] || 0) + quarters.loser[i]); });
    facts.quarters = quarters.winner.slice(0, 4).map((w, i) => ({ q: i + 1, winner: w, loser: quarters.loser[i], diff: w - quarters.loser[i], cum_winner: cum.winner[i], cum_loser: cum.loser[i], cum_margin: cum.winner[i] - cum.loser[i] }));
    if (quarters.winner.length > 4) facts.overtime = quarters.winner.slice(4).map((w, i) => ({ period: 5 + i, winner: w, loser: quarters.loser[4 + i] }));
    facts.halftime = { winner: cum.winner[1], loser: cum.loser[1], margin: cum.winner[1] - cum.loser[1] };
    const best = [...facts.quarters].sort((a, b) => b.diff - a.diff || a.q - b.q)[0];
    const worst = [...facts.quarters].sort((a, b) => a.diff - b.diff || a.q - b.q)[0];
    facts.best_quarter = best;
    facts.loser_best_quarter = worst.diff < 0 ? worst : null;
    facts.loser_avg_first_three = Math.round(((quarters.loser[0] + quarters.loser[1] + quarters.loser[2]) / 3) * 10) / 10;
    facts.quarters_won = facts.quarters.filter((x) => x.diff > 0).length;
  }
  facts.totals = { winner: teamTotals(wBox), loser: teamTotals(lBox) };
  const T = facts.totals;
  const diff = (k) => (Number.isFinite(T.winner[k]) && Number.isFinite(T.loser[k]) ? Math.round((T.winner[k] - T.loser[k]) * 10) / 10 : null);
  // Separators: measurable differences in the winner's favour, ranked by a stated weight. Turnovers favour the side
  // with fewer, so their sign is flipped. Weights order the explanation; they are never printed as point values.
  const SEP = [
    ['turnovers', -diff('tov'), 1.0], ['offensive_rebounds', diff('oreb'), 1.0], ['rebounds', diff('reb'), 0.7], ['steals', diff('stl'), 0.9],
    ['threes_made', diff('fg3m'), 1.4], ['free_throws_made', diff('ftm'), 0.8], ['fg_pct', diff('fg_pct'), 0.6], ['assists', diff('ast'), 0.5], ['bench_points', diff('bench_pts'), 0.25]
  ];
  facts.separators = SEP.filter(([, v]) => Number.isFinite(v) && v > 0).map(([key, value, w]) => ({ key, value, weight: Math.round(value * w * 10) / 10 })).sort((a, b) => b.weight - a.weight)
    // Steals are part of the turnover count, and offensive rebounds of the rebound count: never list both halves.
    .filter((s, i, xs) => !(s.key === 'steals' && xs.some((x) => x.key === 'turnovers')) && !(s.key === 'rebounds' && xs.some((x) => x.key === 'offensive_rebounds')));
  facts.counter_separators = SEP.filter(([, v]) => Number.isFinite(v) && v < 0).map(([key, value]) => ({ key, value: -value })).sort((a, b) => b.value - a.value);

  const lines = (box, team) => box.players.filter(participated).map((p) => playerLine(p, team));
  facts.lines = { winner: lines(wBox, winner).sort((a, b) => b.game_score - a.game_score), loser: lines(lBox, loser).sort((a, b) => b.game_score - a.game_score) };
  facts.minutes_published = [...facts.lines.winner, ...facts.lines.loser].some((p) => p.min !== null);
  facts.box_lines = [...facts.lines.winner, ...facts.lines.loser].map((p) => ({ name: p.name, team: p.team, pts: p.pts, reb: p.reb, ast: p.ast }));
  facts.headline_stat = 'pts';

  if (plays.length) facts.pbp = playFacts(plays, { winnerId: winner.team_id, loserId: loser.team_id, homeId: g.home_team_id });

  // Tournament path: earlier games of each team, finished and observed before the cutoff.
  const earlier = (team) => schedule
    .filter((x) => x.game_id !== g.game_id && x.status === 'final' && [x.home_team_id, x.away_team_id].includes(team.team_id))
    .filter((x) => ms(x.scheduled_at) < ms(g.scheduled_at) && (ms(x.fetched_at) === null || ms(x.fetched_at) <= cutoffMs))
    .sort((a, b) => ms(a.scheduled_at) - ms(b.scheduled_at))
    .map((x) => {
      const isHome = x.home_team_id === team.team_id;
      const us = isHome ? x.home_score : x.away_score;
      const them = isHome ? x.away_score : x.home_score;
      return { espn_id: x.provider_ids?.espn || null, round: x.round, round_name: x.round_name, opponent: (isHome ? x.away_team : x.home_team).name, us, them, won: us > them, scheduled_at: x.scheduled_at };
    });
  const pathOf = (team) => { const games = earlier(team); return { games, wins: games.filter((x) => x.won).length, losses: games.filter((x) => !x.won).length }; };
  facts.path = { winner: pathOf(winner), loser: pathOf(loser) };
  facts.path.winner.final_wins = facts.path.winner.wins + 1;
  facts.path.loser.final_losses = facts.path.loser.losses + 1;

  // Earlier-game averages for the players this story features (from stored box scores, before this game only).
  const priorFor = (line, team) => {
    const games = facts.path[team === winner ? 'winner' : 'loser'].games;
    const apps = [];
    for (const pg of games) {
      const d = priorDetails[pg.espn_id];
      if (!d?.boxscore || (ms(d.fetched_at) !== null && ms(d.fetched_at) > cutoffMs)) continue;
      const row = d.boxscore.teams.flatMap((t) => t.players).find((p) => p.player_id === line.player_id);
      if (row && participated(row)) apps.push(row);
    }
    if (apps.length < 2) return null;
    const av = (k) => Math.round((apps.reduce((s, p) => s + (p[k] || 0), 0) / apps.length) * 10) / 10;
    return { games: apps.length, pts: av('pts'), reb: av('reb'), ast: av('ast') };
  };
  for (const side of ['winner', 'loser']) for (const line of facts.lines[side].slice(0, 4)) line.prior = priorFor(line, side === 'winner' ? winner : loser);

  facts.wnba = [...facts.lines.winner, ...facts.lines.loser].filter((p) => p.wnba);
  if (r.medal) facts.medal = { winner: r.medal[0], loser: r.medal[1], winner_place: r.place[0], loser_place: r.place[1] };
  if (medals && g.round === 'BRONZE' && medals.gold && medals.silver) {
    const finalGame = schedule.find((x) => x.round === 'FINAL' && x.status === 'final' && ms(x.fetched_at) !== null && ms(x.fetched_at) <= cutoffMs);
    if (finalGame) facts.champion = { gold: medals.gold.name, silver: medals.silver.name };
  }
  if (r.next) {
    const nextRound = g.round === 'SF' ? ['FINAL', 'BRONZE'] : g.round === 'QF' ? ['SF', null] : g.round === 'QQF' ? ['QF', null] : [];
    const opp = (code, team) => {
      if (!code) return null;
      const x = schedule.find((s) => s.round === code && [s.home_team_id, s.away_team_id].includes(team.team_id));
      if (!x) return null;
      const o = x.home_team_id === team.team_id ? x.away_team : x.home_team;
      return o && o.team_id && !/tbd/i.test(o.name || '') ? { name: o.name, scheduled_at: x.scheduled_at } : null;
    };
    facts.next = { winner: r.next[0] ? { stage: r.next[0], opponent: opp(nextRound[0], winner) } : null, loser: r.next[1] ? { stage: r.next[1], opponent: opp(nextRound[1], loser) } : null };
  }
  return { facts };
}

// ------------------------------------------------------------ prose

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const periodName = (p) => (p >= 1 && p <= 4 ? `the ${ORD[p]} quarter` : 'overtime');
/** Score state from the winner's side: "trailing 9–1", "leading 12–8", "tied at 58". */
const state = (w, l) => (w > l ? `leading ${sc(w, l)}` : w < l ? `trailing ${sc(l, w)}` : `tied at ${w}`);
const at = (pt) => (pt?.clock && pt?.period ? `with ${pt.clock} left in ${periodName(pt.period)}` : '');
/** Semicolon list for items that carry their own commas. */
const semiJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('; ')}; and ${xs.at(-1)}`);
// National-team names that take the definite article mid-sentence.
const THE = /^(United States|Netherlands|Philippines|Czech Republic|Dominican Republic|Central African Republic|Democratic Republic of the Congo|United Kingdom)$/;
export const teamRef = (name) => (THE.test(name) ? `the ${name}` : name);
/** Capitalise a sentence-initial "the" introduced by teamRef. */
const capSentences = (s) => String(s).replace(/(^|[.!?]\s+|;\s+and\s+|:\s+)the (?=[A-Z])/g, (m, pre) => (/^[.!?]|^$/.test(pre.trim()) || pre === '' ? `${pre}The ` : m));

function shooting(p) {
  const parts = [`${p.fgm} of ${p.fga} from the field`];
  if (p.fg3a) parts.push(`${p.fg3m} of ${p.fg3a} from three`);
  if (p.fta) parts.push(`${p.ftm} of ${p.fta} at the line`);
  return listJoin(parts);
}
function statLine(p, { full = true } = {}) {
  const parts = [count(p.pts, 'point')];
  if (p.reb && (full || p.reb >= 3)) parts.push(count(p.reb, 'rebound'));
  if (p.ast && (full || p.ast >= 3)) parts.push(count(p.ast, 'assist'));
  if (p.stl >= 2) parts.push(count(p.stl, 'steal'));
  if (p.blk >= 2) parts.push(count(p.blk, 'block'));
  return listJoin(parts);
}

const SEP_TEXT = {
  turnovers: (f) => `ball security (${f.winner.name} committed ${count(f.totals.winner.tov, 'turnover')} to ${poss(f.loser.name)} ${f.totals.loser.tov})`,
  offensive_rebounds: (f) => `the offensive glass (${count(f.totals.winner.oreb, 'offensive rebound')} to ${f.totals.loser.oreb})`,
  rebounds: (f) => `rebounding (${f.totals.winner.reb} to ${f.totals.loser.reb})`,
  steals: (f) => `steals (${f.totals.winner.stl} to ${f.totals.loser.stl})`,
  threes_made: (f) => `the three-point line (${count(f.totals.winner.fg3m, 'three-pointer')} to ${f.totals.loser.fg3m})`,
  free_throws_made: (f) => `the free-throw line (${f.totals.winner.ftm} makes to ${f.totals.loser.ftm})`,
  fg_pct: (f) => `field-goal accuracy (${f.totals.winner.fg_pct} percent to ${f.totals.loser.fg_pct} percent)`,
  assists: (f) => `ball movement (${count(f.totals.winner.ast, 'assist')} to ${f.totals.loser.ast})`,
  bench_points: (f) => `bench scoring (${f.totals.winner.bench_pts} points to ${f.totals.loser.bench_pts})`
};

const STAGE = (code, name) => (code === 'GROUP' ? 'group stage' : ROUND[code]?.label || name);

/**
 * The article. Sections are chosen by what the facts support; nothing is emitted for a slot the data cannot fill.
 * Returns { headline, deck, body, sections, coverage } — coverage lists the substance present, for the depth gate.
 */
export function writeGameStory(f) {
  const W = { ...f.winner, name: teamRef(f.winner.name) };
  const L = { ...f.loser, name: teamRef(f.loser.name) };
  const T = f.totals;
  const body = [];
  const sections = [];
  const coverage = new Set();
  const section = (title, key, paras) => {
    const ps = paras.filter(Boolean).map((p) => capSentences(p.replace(/\s+/g, ' ').trim()));
    if (!ps.length) return;
    sections.push({ title: title ? title.replace(/\bthe (?=[A-Z])/, (m, i) => (i === title.indexOf(m) && /^(Why|What) the/.test(title) ? 'the ' : 'the ')) : null, first: body.length, count: ps.length, key });
    body.push(...ps);
    coverage.add(key);
  };
  const medal = f.medal;
  const score = sc(W.score, L.score);
  const where = f.venue?.name ? ` at ${f.venue.name}${f.venue.city ? ` in ${f.venue.city}` : ''}` : '';
  const when = dLong(f.scheduled_at);
  const comp = f.competition.name;

  const headline = capSentences(medal
    ? `${W.name} beat ${L.name} ${score} to ${medal.winner === 'gold' ? 'win gold' : 'take bronze'} at the ${comp}`
    : f.round.code === 'GROUP' ? `${W.name} beat ${L.name} ${score} at the ${comp}` : `${W.name} beat ${L.name} ${score} in the ${f.round.label} of the ${comp}`);

  if (f.story_class === 'breaking') {
    const deck = capSentences(`${W.name} won the ${f.round.label} ${score}; the full box score has not been published yet.`);
    section(null, 'lede', [`${W.name} beat ${L.name} ${score} in the ${f.round.label} of the ${comp}${where} on ${when}.`]);
    return { headline, deck, body, sections, coverage: [...coverage] };
  }

  const wTop = f.lines.winner;
  const lTop = f.lines.loser;
  const star = [...wTop].sort((a, b) => b.pts - a.pts || b.game_score - a.game_score)[0];
  const lStar = [...lTop].sort((a, b) => b.pts - a.pts || b.game_score - a.game_score)[0];
  const sep = f.separators;
  const P = f.pbp;
  const Q = f.quarters;

  // ---- deck: every materially equivalent top scorer (co-leader rule), then the leading separator
  // The co-leader rule (reconcile R4) is applied across BOTH teams: naming one of several materially equivalent
  // scoring lines names all of them, each with her team.
  const leaders = coLeaders(f.box_lines, 'pts');
  const named = leaders.length > 1 && leaders.some((p) => p.name === star.name) ? leaders : null;
  const deckLead = named ? `${listJoin(named.map((p) => `${p.name} (${p.team === f.winner.name ? W.name : L.name}) ${p.pts}`))} led the scoring` : `${star.name} scored ${count(star.pts, 'point')}`;
  const deckSep = sep[0] ? {
    turnovers: `${W.name} committed ${T.loser.tov - T.winner.tov} fewer turnovers than ${L.name}`,
    offensive_rebounds: `${W.name} won the offensive glass ${T.winner.oreb}–${T.loser.oreb}`,
    rebounds: `${W.name} won the boards ${T.winner.reb}–${T.loser.reb}`,
    threes_made: `${W.name} made ${T.winner.fg3m} threes to ${T.loser.fg3m}`,
    steals: `${W.name} had ${T.winner.stl} steals`,
    free_throws_made: `${W.name} made ${T.winner.ftm} free throws to ${T.loser.ftm}`,
    fg_pct: `${W.name} shot ${T.winner.fg_pct} percent`,
    assists: `${W.name} had ${T.winner.ast} assists`,
    bench_points: `${poss(W.name)} bench scored ${T.winner.bench_pts}`
  }[sep[0].key] : null;
  const deck = capSentences(`${deckLead}${deckSep ? ` and ${deckSep}` : ''}${medal ? ` to ${medal.winner === 'gold' ? 'win gold' : 'take bronze'}` : f.next?.winner ? ` to reach ${f.next.winner.stage}` : ''}${f.venue?.city ? ` in ${f.venue.city}` : ''}.`);

  // ---- lede
  const ledeWhy = sep.slice(0, 2).map((s) => SEP_TEXT[s.key]({ ...f, winner: W, loser: L }));
  section(null, 'lede', [
    `${W.name} ${medal ? `won ${medal.winner === 'gold' ? 'the gold medal' : 'the bronze medal'} at the ${comp}` : `won the ${f.round.label} of the ${comp}`}${where} on ${when}, beating ${L.name} ${score}.${medal?.loser ? ` ${L.name} took silver.` : medal ? ` ${L.name} finished ${PLACE[medal.loser_place]}.` : !f.next?.loser && f.round.code !== 'GROUP' ? ` ${L.name} is eliminated.` : ''}`,
    `${star.name} led ${W.name} with ${statLine(star)}${star.fga ? ` on ${star.fgm}-of-${star.fga} shooting` : ''}.${ledeWhy.length ? ` The clearest differences were ${listJoin(ledeWhy)}.` : ''}`
  ]);

  // ---- how the game unfolded
  if (Q) {
    const flow = [];
    const [q1, q2, q3, q4] = Q;
    const half = f.halftime;
    const lead1 = q1.cum_margin > 0 ? `${W.name} led ${sc(q1.cum_winner, q1.cum_loser)} after the first quarter` : q1.cum_margin < 0 ? `${L.name} led ${sc(q1.cum_loser, q1.cum_winner)} after the first quarter` : `The teams were level at ${q1.cum_winner} after the first quarter`;
    const q2text = q2.diff < 0 ? `${L.name} won the second quarter ${sc(q2.loser, q2.winner)}` : q2.diff > 0 ? `${W.name} won the second quarter ${sc(q2.winner, q2.loser)}` : `the second quarter was even at ${q2.winner} points apiece`;
    const halfText = half.margin > 0 ? (q2.diff > 0 ? `led ${sc(half.winner, half.loser)} at halftime` : `${W.name} went into halftime ahead ${sc(half.winner, half.loser)}`) : half.margin < 0 ? `${L.name} led ${sc(half.loser, half.winner)} at halftime` : `the score was ${sc(half.winner, half.loser)} at halftime`;
    const trimmed = half.margin > 0 && q1.cum_margin > half.margin ? `, the first-quarter lead trimmed from ${q1.cum_margin} points to ${half.margin}` : '';
    flow.push(`${lead1}. ${cap(q2text)}, and ${halfText}${trimmed}.`);
    const q3text = q3.diff > 0 ? `${W.name} won the third quarter ${sc(q3.winner, q3.loser)}` : q3.diff < 0 ? `${L.name} won the third quarter ${sc(q3.loser, q3.winner)}` : `The third quarter was even at ${q3.winner} points each`;
    const q4text = q4.diff > 0 ? `${W.name} then took the fourth quarter ${sc(q4.winner, q4.loser)}` : q4.diff < 0 ? `${L.name} won the fourth quarter ${sc(q4.loser, q4.winner)}, not enough to close the gap` : `The fourth quarter finished level`;
    flow.push(`${q3text}, leaving ${q3.cum_margin === 0 ? `the game tied at ${q3.cum_winner}` : `the score at ${sc(q3.cum_winner, q3.cum_loser)}`} with a quarter to play. ${q4text}${f.overtime ? ', and the game needed overtime' : ''}.`);
    const won = Q.filter((x) => x.diff > 0).length;
    const widest = Math.max(...Q.map((x) => x.cum_margin));
    flow.push(`${W.name} won ${won === 4 ? 'all four quarters' : `${WORDS[won]} of the four quarters`}${widest === f.margin ? `, and the ${f.margin}-point final margin was the widest of the game at any quarter break` : ''}.`);
    if (P) {
      const bits = [P.lead_changes ? `the lead changed hands ${P.lead_changes === 1 ? 'once' : P.lead_changes === 2 ? 'twice' : `${P.lead_changes} times`}` : 'the lead never changed hands'];
      if (P.ties) bits.push(`the score was tied ${P.ties === 1 ? 'once' : P.ties === 2 ? 'twice' : `${P.ties} times`}`);
      const big = P.largest_lead_winner;
      const lbig = P.largest_lead_loser;
      flow.push(`According to the play-by-play, ${listJoin(bits)}.${big ? ` ${poss(W.name)} largest lead was ${big.value} points, at ${sc(big.w, big.l)} ${at(big)}.` : ''}${lbig ? ` ${poss(L.name)} biggest advantage was ${lbig.value} ${lbig.value === 1 ? 'point' : 'points'}${lbig.period ? `, in ${periodName(lbig.period)}` : ''}.` : ` ${L.name} never led.`}`);
      if (P.last_loser_lead) flow.push(`${L.name} last led ${at(P.last_loser_lead)}${P.last_tie ? `, and the last tie came ${at(P.last_tie)}` : ''}; ${W.name} did not trail after that.`);
    }
    section('How the game unfolded', 'flow', flow);
  }

  // ---- the stretch that decided it
  const decisive = [];
  if (P?.stretch && P.stretch.winner_pts - P.stretch.loser_pts >= 8) {
    const s = P.stretch;
    const who = s.top_scorers.map((x) => ({ ...x, name: wTop.find((p) => p.player_id === x.player_id)?.name })).filter((x) => x.name);
    decisive.push(`The play-by-play shows where ${W.name} ${s.held_to_the_end ? 'pulled away for good' : 'built its advantage'}: ${state(s.start.w, s.start.l)} ${at(s.start)}, ${W.name} outscored ${L.name} ${sc(s.winner_pts, s.loser_pts)} over the next stretch to lead ${sc(s.end.w, s.end.l)} ${at(s.end)}.`);
    const detail = [];
    if (s.loser_turnovers) detail.push(`${L.name} turned the ball over ${s.loser_turnovers === 1 ? 'once' : s.loser_turnovers === 2 ? 'twice' : `${s.loser_turnovers} times`} in that stretch`);
    if (s.winner_steals) detail.push(`${W.name} recorded ${count(s.winner_steals, 'steal')}`);
    if (who.length) detail.push(`${listJoin(who.map((x) => `${x.name} scored ${x.pts}`))} of the ${s.winner_pts} points in the run`);
    if (detail.length) decisive.push(`${cap(semiJoin(detail))}.`);
  } else if (Q) {
    const b = f.best_quarter;
    if (b && b.diff > 0) {
      const before = b.q > 1 ? Q[b.q - 2] : null;
      const beforeText = before ? (before.cum_margin > 0 ? ` to stretch a ${sc(before.cum_winner, before.cum_loser)} lead to ${sc(b.cum_winner, b.cum_loser)}` : before.cum_margin < 0 ? ` to turn a ${sc(before.cum_loser, before.cum_winner)} deficit into a ${sc(b.cum_winner, b.cum_loser)} lead` : ` to break a ${before.cum_winner}-all tie`) : '';
      decisive.push(`The decisive period was ${periodName(b.q)}, which ${W.name} won ${sc(b.winner, b.loser)}${beforeText}. At ${b.diff} points, it was the largest quarter margin of the game.`);
      if (b.q === 4 && Q[2].cum_margin > 0) decisive.push(`${L.name} scored ${count(b.loser, 'point')} in that final period after averaging ${f1(f.loser_avg_first_three)} over the first three quarters.`);
      const tq = P?.turnovers_by_quarter?.loser?.[b.q];
      if (tq) decisive.push(`${L.name} committed ${count(tq, 'turnover')} in that quarter.`);
    }
  }
  section('The stretch that decided it', 'decisive', decisive);

  // ---- why the winner won
  const why = [];
  const F = { ...f, winner: W, loser: L };
  if (sep.length) {
    why.push(`${poss(W.name)} margin came from measurable differences in the box score. The widest were ${listJoin(sep.slice(0, 3).map((s) => SEP_TEXT[s.key](F)))}.`);
    if (sep.some((s) => s.key === 'turnovers') && T.loser.tov - T.winner.tov >= 5) {
      why.push(`The turnover gap was the largest single difference: ${L.name} gave the ball away ${T.loser.tov} times${T.winner.stl ? `, and ${T.winner.stl} of those came on ${W.name} steals` : ''}.${T.winner.fga > T.loser.fga ? ` The extra possessions showed up in shot volume, with ${W.name} attempting ${T.winner.fga} field goals to ${poss(L.name)} ${T.loser.fga}.` : ''}`);
    }
    if (sep.some((s) => s.key === 'offensive_rebounds') && T.winner.reb > T.loser.reb && T.winner.oreb - T.loser.oreb >= 3) why.push(`${W.name} also won the overall rebounding battle ${sc(T.winner.reb, T.loser.reb)}, and the ${T.winner.oreb - T.loser.oreb}-rebound edge on the offensive glass meant second chances ${L.name} did not get.`);
  }
  why.push(`${W.name} shot ${T.winner.fgm} of ${T.winner.fga} (${T.winner.fg_pct} percent) from the field, ${T.winner.fg3m} of ${T.winner.fg3a} from three and ${T.winner.ftm} of ${T.winner.fta} at the line; ${L.name} went ${T.loser.fgm} of ${T.loser.fga} (${T.loser.fg_pct} percent), ${T.loser.fg3m} of ${T.loser.fg3a} from three and ${T.loser.ftm} of ${T.loser.fta} on free throws.`);
  if (f.counter_separators.length) {
    const c = f.counter_separators[0];
    const txt = { fg_pct: ['field-goal percentage', `${T.loser.fg_pct} percent to ${T.winner.fg_pct}`], bench_points: ['bench scoring', `${T.loser.bench_pts} points to ${T.winner.bench_pts}`], assists: ['assists', `${T.loser.ast} to ${T.winner.ast}`], rebounds: ['rebounds', `${T.loser.reb} to ${T.winner.reb}`], offensive_rebounds: ['offensive rebounds', `${T.loser.oreb} to ${T.winner.oreb}`], steals: ['steals', `${T.loser.stl} to ${T.winner.stl}`], threes_made: ['three-pointers', `${T.loser.fg3m} to ${T.winner.fg3m}`], free_throws_made: ['made free throws', `${T.loser.ftm} to ${T.winner.ftm}`], turnovers: ['ball security', `${T.loser.tov} turnovers to ${T.winner.tov}`] }[c.key];
    if (txt) why.push(`${L.name} held the edge in ${txt[0]} (${txt[1]}), which did not offset the rest.`);
  }
  section(`Why ${W.name} won`, 'why', why);

  // ---- who delivered
  const perf = [];
  const featured = wTop.slice(0, 4).filter((p) => p.pts >= 6 || p.game_score >= 8);
  const priorText = (p) => {
    if (!p.prior || !p.prior.pts) return '';
    const g = WORDS[p.prior.games] || p.prior.games;
    if (p.pts >= 2 * p.prior.pts && p.pts - p.prior.pts >= 6) return ` That was more than double the ${f1(p.prior.pts)} points she had averaged over her previous ${g} games of the tournament.`;
    if (p.pts - p.prior.pts >= 4) return ` She came in averaging ${f1(p.prior.pts)} points over ${g} earlier games of the tournament.`;
    return ` She had averaged ${f1(p.prior.pts)} points in her previous ${g} games of the tournament.`;
  };
  for (const [i, p] of featured.entries()) {
    const mins = p.min !== null ? ` in ${count(p.min, 'minute')}` : '';
    if (i === 0) perf.push(`${p.name} was ${poss(W.name)} most productive player, finishing with ${statLine(p)}${mins}. She shot ${shooting(p)}${p.tov ? `, with ${count(p.tov, 'turnover')}` : ''}.${priorText(p)}`);
    else perf.push(`${p.name}, ${p.starter ? 'a starter' : 'off the bench'}, added ${statLine(p, { full: false })}${mins} on ${shooting(p)}.${priorText(p)}`);
  }
  const glue = wTop.find((p) => !featured.includes(p) && (p.reb >= 6 || p.ast >= 5 || p.stl >= 3));
  if (glue) perf.push(`${glue.name} contributed away from scoring with ${listJoin([glue.reb ? count(glue.reb, 'rebound') : null, glue.ast ? count(glue.ast, 'assist') : null, glue.stl ? count(glue.stl, 'steal') : null].filter(Boolean))}.`);
  if (T.winner.bench_pts !== null) perf.push(`${poss(W.name)} reserves scored ${T.winner.bench_pts} of the team’s ${W.score} points; the ${f.loser.name} bench scored ${T.loser.bench_pts}.`);
  section('Who delivered', 'performers', perf);

  // ---- what the loser could not overcome
  const opp = [];
  const lFeatured = lTop.slice(0, 3).filter((p) => p.pts >= 6);
  if (lStar) opp.push(`${lStar.name} led ${L.name} with ${statLine(lStar)} on ${shooting(lStar)}${lFeatured.filter((p) => p !== lStar).length ? `; ${listJoin(lFeatured.filter((p) => p !== lStar).map((p) => `${p.name} added ${count(p.pts, 'point')}`))}` : ''}.`);
  const cold = lTop.filter((p) => p.fga >= 8 && p.fg_pct !== null && p.fg_pct < 35);
  if (cold.length) opp.push(`Shooting from key players was a problem: ${listJoin(cold.map((p) => `${p.name} made ${p.fgm} of ${p.fga} shots${p.fg3a >= 4 ? `, ${p.fg3m} of ${p.fg3a} from three` : ''}`))}.`);
  const careless = lTop.filter((p) => p.tov >= 4);
  if (careless.length) opp.push(`${listJoin(careless.map((p) => `${p.name} had ${count(p.tov, 'turnover')}`))}, part of ${aan(T.loser.tov)} ${T.loser.tov}-turnover game for ${L.name}.`);
  if (f.loser_best_quarter) opp.push(`${poss(L.name)} best period was ${periodName(f.loser_best_quarter.q)}, won ${sc(f.loser_best_quarter.loser, f.loser_best_quarter.winner)}${f.loser_best_quarter.q === 4 ? ', too late to change the result' : `, but ${W.name} won the quarters that followed`}.`.replace(/, but (.+) won the quarters that followed/, (m, n) => (Q.slice(f.loser_best_quarter.q).every((x) => x.diff > 0) ? m : '')));
  if (P && !P.largest_lead_loser) opp.push(`${L.name} never held a lead.`);
  section(`What ${L.name} couldn’t overcome`, 'opponent', opp);

  // ---- tournament context
  const ctx = [];
  // The team's route, as sentences: the group stage together, then each knockout game.
  const road = (p, name) => {
    const group = p.games.filter((x) => x.round === 'GROUP');
    const ko = p.games.filter((x) => x.round !== 'GROUP');
    const res = (x) => (x.won ? `beat ${teamRef(x.opponent)} ${sc(x.us, x.them)}` : `lost to ${teamRef(x.opponent)} ${sc(x.them, x.us)}`);
    const out = [];
    if (group.length) out.push(`In the group stage ${name} ${listJoin(group.map(res))}.`);
    if (ko.length) out.push(`${group.length ? 'It then' : name} ${listJoin(ko.map((x) => `${res(x)} in the ${STAGE(x.round, x.round_name)}`))}.`);
    return out.join(' ');
  };
  const pw = f.path.winner;
  const pl = f.path.loser;
  if (medal) {
    ctx.push(`${medal.winner === 'gold' ? 'Gold' : 'Bronze'} gives ${W.name} ${PLACE[medal.winner_place]} place at the ${comp}${f.competition.host_city ? `, played in ${f.competition.host_city}` : ''}; ${L.name} ${medal.loser ? `takes ${medal.loser}` : `finishes ${PLACE[medal.loser_place]}`}.`);
    if (f.champion && medal.winner === 'bronze') ctx.push(`The podium is complete: ${teamRef(f.champion.gold)} won gold and ${teamRef(f.champion.silver)} silver.`);
  } else if (f.next?.winner) {
    ctx.push(`The win sends ${W.name} to ${f.next.winner.stage}${f.next.winner.opponent ? ` against ${teamRef(f.next.winner.opponent.name)}` : ''}.${f.next.loser ? ` ${L.name} moves to ${f.next.loser.stage}${f.next.loser.opponent ? ` against ${teamRef(f.next.loser.opponent.name)}` : ''}.` : ''}`);
  }
  if (pw.games.length) ctx.push(`${road(pw, W.name)} That ${pw.wins}–${pw.losses} record became ${pw.final_wins}–${pw.losses} with this win.`);
  if (pl.games.length) ctx.push(`${road(pl, L.name)} ${cap(L.name)} ${medal || f.round.code !== 'GROUP' ? 'finishes the tournament' : 'is now'} ${pl.wins}–${pl.final_losses}.`);
  const rematch = pw.games.find((x) => x.opponent === f.loser.name);
  if (rematch) ctx.push(`It was a rematch of their ${STAGE(rematch.round, rematch.round_name).replace('group stage', 'group-stage')} game, which ${rematch.won ? `${W.name} won ${sc(rematch.us, rematch.them)}` : `${L.name} won ${sc(rematch.them, rematch.us)}`}${rematch.won && rematch.us - rematch.them > f.margin ? '; the margin was narrower this time' : rematch.won ? '' : `, so ${W.name} reversed that result`}.`);
  section(medal ? `What ${medal.winner} means` : f.round.code === 'GROUP' ? 'Where it leaves the group' : 'What it means', 'context', ctx);

  // ---- WNBA connection (only when a current WNBA roster player appeared)
  const wnba = [];
  if (f.wnba.length) {
    const n = f.wnba.length;
    const byTeam = [f.winner.name, f.loser.name].map((t) => ({ t, xs: f.wnba.filter((p) => p.team === t) })).filter((x) => x.xs.length);
    wnba.push(`${cap(WORDS[n] || String(n))} ${n === 1 ? 'player' : 'players'} on current WNBA rosters appeared in this game, matched to their WNBA profiles by identical ESPN athlete IDs: ${byTeam.map((x) => `${listJoin(x.xs.map((p) => `${p.name} (${p.wnba.team})`))} for ${teamRef(x.t)}`).join('; ')}.`);
    const notable = f.wnba.filter((p) => p.pts >= 8 || p.reb >= 7 || p.ast >= 5).slice(0, 4);
    if (notable.length) wnba.push(`Among them, ${semiJoin(notable.map((p) => `${p.name} finished with ${statLine(p, { full: false })}`))}.`);
    if (!f.minutes_published) wnba.push('The box score for this game does not publish minutes, so tournament workload for these players cannot be measured from this record.');
  }
  section('WNBA connection', 'wnba', wnba);

  return { headline, deck, body, sections, coverage: [...coverage] };
}

/** Words of substance in the body (headings excluded). */
export const wordCount = (body) => (body || []).join(' ').split(/\s+/).filter(Boolean).length;

/**
 * Target words for the data that actually exists — a DIAGNOSTIC reported with the depth assessment, never a publication
 * cliff (wnba-depth/1.0.0). A box score alone supports a base; each further record (quarter scores, play-by-play, the
 * tournament schedule, earlier box scores) raises the target, capped at the class minimum.
 */
export function requiredWords(facts) {
  const rule = DEPTH_RULES[facts?.story_class] || DEPTH_RULES.breaking;
  if (facts?.story_class === 'breaking') return rule.min_words;
  const base = { medal: 400, elimination: 330, recap: 280 }[facts.story_class] ?? rule.min_words;
  const extra = (facts.quarters ? 100 : 0) + (facts.pbp ? 90 : 0) + (facts.path?.winner?.games?.length ? 90 : 0) + ([...(facts.lines?.winner || []), ...(facts.lines?.loser || [])].some((p) => p.prior) ? 120 : 0);
  return Math.min(rule.min_words, base + extra);
}

/**
 * The depth gate for a game story: the newsroom depth ladder (depth.js) applied to the game facts. Substance decides
 * publication — result and star in the lede, game flow, statistical explanation, several performances, tournament
 * context, a correct WNBA-connection decision, developed sections — plus the hard checks (shallowness floor,
 * repetition, play-by-play language without play-by-play). Word count is reported only as a diagnostic.
 */
export function depthAssessmentOf({ facts, body, sections, evidence, now }) {
  return assessDepth({ kind: 'international', facts: { game: facts }, body, sections, evidence }, { now: now ?? (Date.parse(facts?.provenance?.generated_at || '') || Date.now()) });
}
export function depthFailures(input) {
  return depthAssessmentOf(input).failures;
}
