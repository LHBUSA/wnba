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
  for (const p of rows) {
    const margin = p.home_score - p.away_score;
    const sign = Math.sign(margin);
    if (sign !== 0 && leader !== 0 && sign !== leader) leadChanges += 1;
    if (sign === 0 && prevMargin !== 0) ties += 1;
    if (sign !== 0) leader = sign;
    if (margin > maxHome.margin) maxHome = { margin, seq: p.seq, at: `${p.period_label} ${p.clock}` };
    if (-margin > maxAway.margin) maxAway = { margin: -margin, seq: p.seq, at: `${p.period_label} ${p.clock}` };
    if (margin !== prevMargin && p.elapsed_s !== null) timeline.push([p.elapsed_s, margin]);
    prevMargin = margin;
  }
  return {
    method: 'Score margin after every play carrying a score in the ESPN event stream. Margin = home − away.',
    lead_changes: leadChanges,
    ties,
    largest_lead: { home: maxHome, away: maxAway },
    margin_timeline: timeline
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
    method: 'Only field-goal attempts where ESPN published an on-court coordinate are plotted. Coordinates are ESPN feet (x 0–50 across, y from the baseline, rim ≈ (25, 0.25)); both teams are drawn toward the same basket, exactly as published. Missing coordinates are counted, never placed.',
    coordinate_system: { x: [0, 50], rim: [COORD.RIM_X, COORD.RIM_Y], units: 'feet', resolution: '1 ft (integers as published)' },
    total_fga: shots.length,
    plotted: plotted.length,
    unplotted: shots.length - plotted.length,
    shots: plotted.map((s) => ({
      seq: s.seq,
      team_id: s.team_id,
      athlete_id: s.athlete_ids[0] || null,
      made: s.made,
      value: s.points_attempted,
      x: s.coordinate.x,
      y: s.coordinate.y,
      zone: shotZone(s.coordinate, s.points_attempted),
      period: s.period,
      clock: s.clock,
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
