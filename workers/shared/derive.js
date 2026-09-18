// Context derived ONLY from real, source-published play-by-play.
// Every derived block carries a `method` string. If the inputs are missing the
// block is null — nothing is estimated, interpolated or simulated.

import { WNBA_RULES, COORD, periodLabel } from './espn.js';

// WNBA three-point line: 22 ft 1.75 in at the top, 22 ft in the corners.
export const WNBA_THREE = Object.freeze({ ARC_FT: 22.146, CORNER_FT: 22.0, CORNER_X_IN: 3.0 });

const byOrder = (a, b) => (a.seq ?? 0) - (b.seq ?? 0);

export function scoringRuns(plays, { minPoints = 6 } = {}) {
  const scoring = (plays || []).filter((p) => p.scoring && p.points > 0 && p.team_id).sort(byOrder);
  if (!scoring.length) return null;
  const runs = [];
  let cur = null;
  for (const p of scoring) {
    if (cur && cur.team_id === p.team_id) {
      cur.points += p.points;
      cur.end = p;
    } else {
      if (cur) runs.push(cur);
      cur = { team_id: p.team_id, points: p.points, start: p, end: p };
    }
  }
  if (cur) runs.push(cur);
  const shape = (r) => r && {
    team_id: r.team_id,
    points: r.points,
    from: `${r.start.period_label} ${r.start.clock}`,
    to: `${r.end.period_label} ${r.end.clock}`,
    from_seq: r.start.seq,
    to_seq: r.end.seq
  };
  const largestBy = {};
  for (const r of runs) if (!largestBy[r.team_id] || r.points > largestBy[r.team_id].points) largestBy[r.team_id] = r;
  return {
    method: 'Consecutive scoring plays by one team with no opponent points in between (from ESPN play-by-play).',
    current: shape(runs.at(-1)),
    largest: Object.fromEntries(Object.entries(largestBy).map(([k, v]) => [k, shape(v)])),
    notable: runs.filter((r) => r.points >= minPoints).map(shape)
  };
}

export function leadTracker(plays) {
  const rows = (plays || []).filter((p) => p.home_score !== null && p.away_score !== null).sort(byOrder);
  if (!rows.length) return null;
  let leader = 0;
  let leadChanges = 0;
  let ties = 0;
  let maxHome = { margin: 0, seq: null, at: null };
  let maxAway = { margin: 0, seq: null, at: null };
  let prevMargin = 0;
  const timeline = [];

  // PBECast Control: elapsed game time spent in each scoreboard state.
  // At t=0 the game is tied. The score published on a play becomes the state
  // for the interval after that timestamp until the next timestamp.
  let stateMargin = 0;
  let stateAt = 0;
  const controlSeconds = { away: 0, tied: 0, home: 0 };
  const timedRows = rows.filter((p) => Number.isFinite(Number(p.elapsed_s)));
  const addControl = (seconds, margin) => {
    if (!(seconds > 0)) return;
    if (margin > 0) controlSeconds.home += seconds;
    else if (margin < 0) controlSeconds.away += seconds;
    else controlSeconds.tied += seconds;
  };

  for (const p of rows) {
    const margin = p.home_score - p.away_score;
    const sign = Math.sign(margin);
    const isLeadChange = sign !== 0 && leader !== 0 && sign !== leader;
    const isTie = sign === 0 && prevMargin !== 0;
    if (Number.isFinite(Number(p.elapsed_s))) {
      const t = Math.max(stateAt, Number(p.elapsed_s));
      addControl(t - stateAt, stateMargin);
      stateAt = t;
      stateMargin = margin;
    }
    if (isLeadChange) leadChanges += 1;
    if (isTie) ties += 1;
    if (sign !== 0) leader = sign;
    if (margin > maxHome.margin) maxHome = { margin, seq: p.seq, at: `${p.period_label} ${p.clock}` };
    if (-margin > maxAway.margin) maxAway = { margin: -margin, seq: p.seq, at: `${p.period_label} ${p.clock}` };
    if (margin !== prevMargin && p.elapsed_s !== null) {
      timeline.push([p.elapsed_s, margin, {
        seq: p.seq,
        period: p.period,
        period_label: p.period_label,
        clock: p.clock,
        home_score: p.home_score,
        away_score: p.away_score,
        text: p.text || '',
        team_id: p.team_id || null,
        scoring: Boolean(p.scoring),
        lead_state: margin > 0 ? 'home' : margin < 0 ? 'away' : 'tied',
        transition: isLeadChange ? 'lead_change' : isTie ? 'tie' : 'score_change'
      }]);
    }
    prevMargin = margin;
  }

  const elapsedS = timedRows.length ? Math.max(0, ...timedRows.map((p) => Number(p.elapsed_s))) : 0;
  addControl(elapsedS - stateAt, stateMargin);
  const pct = (v) => elapsedS > 0 ? (v / elapsedS) * 100 : 0;
  const currentMargin = rows.at(-1).home_score - rows.at(-1).away_score;

  return {
    method: 'Score margin after every play carrying a score in the ESPN event stream. Margin = home − away. Timeline points retain the source score, period, clock and play text for interactive inspection.',
    lead_changes: leadChanges,
    ties,
    current_margin: currentMargin,
    largest_lead: { home: maxHome, away: maxAway },
    margin_timeline: timeline,
    pbe_control: {
      method: 'PBECast Control = share of elapsed game time spent leading, derived from the published score state between ESPN play timestamps. Tied time remains tied; no projection, odds or possession estimate is used.',
      elapsed_s: elapsedS,
      seconds: controlSeconds,
      pct: {
        away: pct(controlSeconds.away),
        tied: pct(controlSeconds.tied),
        home: pct(controlSeconds.home)
      },
      current: currentMargin > 0 ? 'home' : currentMargin < 0 ? 'away' : 'tied'
    }
  };
}

const TEAM_FOUL_TYPES = /^(personal|shooting|loose ball|personal take|take|transition take|away from play|flagrant|clear path|inbound)/i;

export function foulContext(plays, box) {
  const fouls = (plays || []).filter((p) => /foul/i.test(p.type || '') && !/turnover/i.test(p.type || ''));
  if (!fouls.length && !box?.players?.length) return null;
  const perPeriod = {};
  const offensive = {};
  for (const p of fouls) {
    if (!p.team_id || !p.period) continue;
    const key = `${p.team_id}:${p.period}`;
    if (/offensive|charge/i.test(p.type)) offensive[key] = (offensive[key] || 0) + 1;
    else if (TEAM_FOUL_TYPES.test(p.type)) perPeriod[key] = (perPeriod[key] || 0) + 1;
  }
  const trouble = (box?.players || [])
    .filter((r) => r.pf !== null && r.pf !== undefined && r.pf >= WNBA_RULES.PERSONAL_FOUL_LIMIT - 2)
    .map((r) => ({ athlete_id: r.athlete_id, name: r.name, team_id: r.team_id, pf: r.pf, fouled_out: r.pf >= WNBA_RULES.PERSONAL_FOUL_LIMIT }));
  return {
    method: 'Defensive/common fouls (personal, shooting, loose-ball, take, flagrant) counted per team per period from ESPN play-by-play; offensive fouls listed separately. Player fouls from the box score; WNBA disqualification at 6 personal fouls. Penalty/bonus state is NOT derived.',
    team_fouls_by_period: perPeriod,
    offensive_fouls_by_period: offensive,
    foul_trouble: trouble
  };
}

/** Cumulative points / rebounds / assists per player across game time. */
export function playerProgression(plays) {
  const rows = (plays || []).filter((p) => p.elapsed_s !== null).sort(byOrder);
  if (!rows.length) return null;
  const series = {};
  const bump = (id, stat, t, by) => {
    if (!id) return;
    const s = (series[id] ||= { pts: [[0, 0]], reb: [[0, 0]], ast: [[0, 0]] });
    const arr = s[stat];
    arr.push([t, arr.at(-1)[1] + by]);
  };
  for (const p of rows) {
    if (p.scoring && p.points > 0) {
      bump(p.athlete_ids[0], 'pts', p.elapsed_s, p.points);
      if (p.athlete_ids[1] && /assist/i.test(p.text || '')) bump(p.athlete_ids[1], 'ast', p.elapsed_s, 1);
    }
    if (/rebound/i.test(p.type || '') && p.athlete_ids[0]) bump(p.athlete_ids[0], 'reb', p.elapsed_s, 1);
  }
  return {
    method: 'Scorer = first participant of a scoring play; assist = second participant when the play text credits an assist; rebounder = first participant of a rebound play. The box score remains authoritative for totals.',
    series
  };
}

/**
 * Zone from the published coordinate, with the 2-vs-3 decision taken from the
 * source's own pointsAttempted (coordinates are whole feet, so geometry alone
 * misclassifies attempts that sit on the arc).
 * Geometry (WNBA): rim ≈ (25, 0.25); baseline ≈ y −5; lane 16 ft wide; FT line
 * 15 ft from the backboard (y ≈ 14); corner threes where the straight 22-ft
 * lines meet the 22 ft 1.75 in arc (≈ 2.8 ft above the rim line).
 */
export function shotZone(c, value = null) {
  if (!c) return null;
  const d = Math.hypot(c.x - COORD.RIM_X, c.y - COORD.RIM_Y);
  const isThree = value === 3 || (value === null && d >= WNBA_THREE.ARC_FT);
  if (isThree) return (c.x <= 4 || c.x >= 46) && c.y <= 4 ? 'corner_three' : 'above_break_three';
  if (d <= 4.5) return 'restricted_area';
  if (c.x >= 17 && c.x <= 33 && c.y <= 14) return 'paint';
  return 'midrange';
}

export function shotChart(plays) {
  const shots = (plays || []).filter((p) => p.shooting && p.points_attempted !== 1 && !/free throw/i.test(p.type || ''));
  const plotted = shots.filter((p) => p.coordinate);
  const zones = {};
  for (const s of plotted) {
    const z = shotZone(s.coordinate, s.points_attempted);
    const k = `${s.team_id}:${z}`;
    zones[k] ||= { team_id: s.team_id, zone: z, made: 0, att: 0 };
    zones[k].att += 1;
    if (s.made) zones[k].made += 1;
  }
  return {
    method: 'Only field-goal attempts where ESPN published an on-court coordinate are plotted. Coordinates are ESPN basket-relative feet (x 0–50 across, y from the baseline, rim ≈ (25, 0.25)). WNBACast preserves those coordinates within each attacking half and may rotate one team onto the opposite basket for display. Missing coordinates are counted, never placed.',
    coordinate_system: { x: [0, 50], rim: [COORD.RIM_X, COORD.RIM_Y], units: 'feet', resolution: '1 ft (integers as published)' },
    total_fga: shots.length,
    plotted: plotted.length,
    unplotted: shots.length - plotted.length,
    shots: plotted.map((s) => ({
      seq: s.seq,
      team_id: s.team_id,
      athlete_id: s.athlete_ids[0] || null,
      player: s.primary?.name || s.primary_athlete?.name || null,
      made: s.made,
      value: s.points_attempted,
      points: s.points,
      type: s.type || null,
      x: s.coordinate.x,
      y: s.coordinate.y,
      zone: shotZone(s.coordinate, s.points_attempted),
      period: s.period,
      clock: s.clock,
      home_score: s.home_score,
      away_score: s.away_score,
      text: s.text
    })),
    zones: Object.values(zones)
  };
}

/** Basketball possessions estimate (standard formula) from real team box totals. */
export function possessions({ fga, oreb, tov, fta }) {
  if ([fga, oreb, tov, fta].some((v) => v === null || v === undefined || Number.isNaN(v))) return null;
  return fga - oreb + tov + 0.44 * fta;
}

export function linescoreSummary(game) {
  const h = game?.home?.linescores || [];
  const a = game?.away?.linescores || [];
  const n = Math.max(h.length, a.length);
  return Array.from({ length: n }, (_, i) => ({ period: i + 1, label: periodLabel(i + 1), home: h[i] ?? null, away: a[i] ?? null }));
}

export function deriveGame(summary) {
  return {
    runs: scoringRuns(summary.plays),
    lead: leadTracker(summary.plays),
    fouls: foulContext(summary.plays, summary.box),
    progression: playerProgression(summary.plays),
    linescore: linescoreSummary(summary.game)
  };
}
