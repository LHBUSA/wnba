// Pure analysis for the owner lock-policy review (owner decision 2026-09-15). No I/O.
//
// Input: checkpoint documents written by the PBE runner (pbe-availability-checkpoints/2) and, per game, whether
// the game is complete. Output: one row per game and a summary. A game counts toward the review only when it is
// COMPLETE and its checkpoint evidence is COMPLETE:
//   - all four checkpoints (T-60, T-30, T-15, T-0) recorded
//   - each recorded no more than LATE_MAX_MIN minutes after its target time
//   - the injury-feed snapshot it read was no older than FEED_MAX_AGE_S
//   - a prediction was present at T-60, T-30 and T-15
// "Material" availability change = a player added to / removed from the feed or a status change. A source
// timestamp refresh with the same status is reported but not material.

import { diffAvailability } from '../../workers/wnba-ingest/src/pbe-runner.js';

export const LATE_MAX_MIN = 3;
export const FEED_MAX_AGE_S = 300;
export const WINDOWS = [['60', '30'], ['30', '15'], ['15', '0']];
const label = ([a, b]) => `T-${a}→T-${b}`;

export function analyzeGame(doc, { completed }) {
  const c = doc.checkpoints || {};
  const problems = [];
  for (const k of ['60', '30', '15', '0']) {
    const cp = c[k];
    if (!cp) { problems.push(`missing T-${k}`); continue; }
    const lateMin = Number(k) - cp.minutes_before_tip;
    if (lateMin > LATE_MAX_MIN) problems.push(`T-${k} recorded ${lateMin} min late`);
    if (cp.feed_age_s === null || cp.feed_age_s === undefined || cp.feed_age_s > FEED_MAX_AGE_S) problems.push(`T-${k} feed age ${cp.feed_age_s ?? 'unknown'}s`);
    if (k !== '0' && !cp.prediction) problems.push(`T-${k} no prediction`);
  }
  const windows = {};
  for (const w of WINDOWS) {
    const [a, b] = w;
    if (!c[a] || !c[b]) { windows[label(w)] = null; continue; }
    const changes = diffAvailability(c[a].players, c[b].players);
    const material = changes.filter((x) => x.kind !== 'source_updated');
    const pa = c[a].prediction; const pb = c[b].prediction;
    const both = pa && pb;
    windows[label(w)] = {
      material_change: material.length > 0,
      material_changes: material,
      source_updates: changes.length - material.length,
      prediction_flip: both ? (pa.call !== pb.call || pa.pick_team_id !== pb.pick_team_id) : null,
      probability_delta_pts: both ? Math.round(Math.abs(pb.p_home - pa.p_home) * 1000) / 10 : null,
      edge_delta_pts: both && Number.isFinite(pa.pbe_edge) && Number.isFinite(pb.pbe_edge) ? Math.round(Math.abs(pb.pbe_edge - pa.pbe_edge) * 1000) / 10 : null,
      feed_captured: [c[a].feed_captured_at, c[b].feed_captured_at],
      prediction_generated: both ? [pa.generated_at, pb.generated_at] : null
    };
  }
  const afterCheckpoint = (from) => { // any material change from checkpoint `from` through T-0
    const seq = ['60', '30', '15', '0'];
    const i = seq.indexOf(from);
    if (seq.slice(i).some((k) => !c[k])) return null;
    return diffAvailability(c[from].players, c['0'].players).some((x) => x.kind !== 'source_updated');
  };
  return {
    game_id: doc.game.game_id,
    tip: doc.game.scheduled_tip_utc,
    completed,
    evidence_complete: problems.length === 0,
    problems,
    checkpoints: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { recorded_at: v.recorded_at, minutes_before_tip: v.minutes_before_tip, feed_captured_at: v.feed_captured_at, feed_age_s: v.feed_age_s, players: v.players, prediction: v.prediction }])),
    windows,
    material_change_after: { 'T-60': afterCheckpoint('60'), 'T-30': afterCheckpoint('30'), 'T-15': afterCheckpoint('15') },
    flags: c['15']?.prediction?.flags || []
  };
}

export function summarize(rows) {
  const reviewed = rows.filter((r) => r.completed && r.evidence_complete);
  const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
  const out = {
    completed_games: rows.filter((r) => r.completed).length,
    reviewed_games: reviewed.length,
    operational_completeness_pct: pct(reviewed.length, rows.filter((r) => r.completed).length),
    incomplete_evidence: rows.filter((r) => r.completed && !r.evidence_complete).map((r) => ({ game_id: r.game_id, problems: r.problems })),
    material_change_after_pct: {},
    windows: {}
  };
  for (const k of ['T-60', 'T-30', 'T-15']) out.material_change_after_pct[k] = pct(reviewed.filter((r) => r.material_change_after[k]).length, reviewed.length);
  for (const w of WINDOWS.map(label)) {
    const ws = reviewed.map((r) => r.windows[w]).filter(Boolean);
    const probs = ws.map((x) => x.probability_delta_pts).filter(Number.isFinite);
    const edges = ws.map((x) => x.edge_delta_pts).filter(Number.isFinite);
    out.windows[w] = {
      games: ws.length,
      material_change_pct: pct(ws.filter((x) => x.material_change).length, ws.length),
      prediction_flip_rate_pct: pct(ws.filter((x) => x.prediction_flip).length, ws.filter((x) => x.prediction_flip !== null).length),
      probability_delta_pts: probs.length ? { mean: Math.round((probs.reduce((s, x) => s + x, 0) / probs.length) * 10) / 10, max: Math.max(...probs) } : null,
      edge_delta_pts: edges.length ? { mean: Math.round((edges.reduce((s, x) => s + x, 0) / edges.length) * 10) / 10, max: Math.max(...edges), games_with_market: edges.length } : null
    };
  }
  out.review_ready = reviewed.length >= 10;
  out.confirmation_ready = reviewed.length >= 20;
  out.note = 'The T-15→T-0 prediction is the shadow lock itself, so its prediction delta is 0 by construction; the availability columns are the evidence for that window.';
  return out;
}
