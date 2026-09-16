// Deterministic WNBA Player Load Intelligence.
//
// This is a workload / schedule-density / rotation-pressure metric. It is NOT a
// medical, physiological or injury-risk assessment. Availability is displayed
// as context only and never changes the score.

export const PLAYER_LOAD_VERSION = 'pbe-player-load/1.0.0';
export const PLAYER_LOAD_DISCLAIMER = 'Player Load measures workload, schedule density and rotation pressure from completed game minutes and the upcoming schedule. It is not a medical or physiological fatigue assessment.';

const DAY = 86400e3;
const HOUR = 3600e3;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const round = (n, d = 1) => Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null;
const teamId = (g, side) => String(g?.[side]?.team_id ?? g?.[`${side}_team_id`] ?? '');

export function playerLoadBand(score) {
  const n = Number(score) || 0;
  if (n >= 85) return 'EXTREME';
  if (n >= 70) return 'HEAVY';
  if (n >= 55) return 'ELEVATED';
  if (n >= 35) return 'NORMAL';
  return 'LIGHT';
}

function teamMap(teams = []) {
  return new Map(teams.map((t) => [String(t.team_id ?? t.id), {
    team_id: String(t.team_id ?? t.id),
    name: t.name ?? t.display_name ?? t.displayName ?? null,
    short_name: t.short_name ?? t.shortDisplayName ?? null,
    abbr: t.abbr ?? t.abbreviation ?? null,
    color: t.color ?? null
  }]));
}

function availabilityMap(snapshot) {
  const items = snapshot?.items && typeof snapshot.items === 'object' ? Object.values(snapshot.items) : [];
  return new Map(items.filter((x) => x?.athlete_id).map((x) => [String(x.athlete_id), {
    status: x.status ?? null,
    detail: x.detail ?? x.description ?? null,
    source_updated_at: x.source_updated_at ?? null
  }]));
}

function nextTeamGame(upcoming, id, now) {
  return upcoming
    .filter((g) => Date.parse(g.start_utc) > now && (teamId(g, 'home') === id || teamId(g, 'away') === id))
    .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc))[0] || null;
}

function recentRotationDepth(game, id) {
  return (game?.players || []).filter((p) => String(p.team_id) === id && Number(p.min) >= 12 && !p.dnp).length;
}

export function buildPlayerLoadSnapshot({ now = Date.now(), games = [], upcomingGames = [], athletes = [], teams = [], availability = null } = {}) {
  const athleteRef = new Map(athletes.filter((a) => a?.athlete_id).map((a) => [String(a.athlete_id), a]));
  const tmap = teamMap(teams);
  const amap = availabilityMap(availability);
  const cutoff = now - 28 * DAY;
  const appearances = new Map();

  for (const game of games) {
    const tip = Date.parse(game?.start_utc);
    if (!Number.isFinite(tip) || tip > now || tip < cutoff) continue;
    for (const p of game.players || []) {
      const minutes = Number(p.min);
      if (!p?.athlete_id || p.dnp || !Number.isFinite(minutes) || minutes <= 0) continue;
      const id = String(p.athlete_id);
      const rows = appearances.get(id) || [];
      rows.push({
        game_id: String(game.game_id || ''),
        start_utc: game.start_utc,
        tip,
        period: Number(game?.status?.period ?? game?.period ?? 4),
        athlete_id: id,
        team_id: String(p.team_id || ''),
        name: p.name ?? null,
        position: p.position ?? null,
        starter: Boolean(p.starter),
        min: minutes,
        game
      });
      appearances.set(id, rows);
    }
  }

  const players = [];
  for (const [id, rows0] of appearances) {
    const rows = rows0.sort((a, b) => b.tip - a.tip);
    const last = rows[0];
    const currentTeam = last.team_id;
    if (!currentTeam) continue;
    const within = (days) => rows.filter((r) => r.tip >= now - days * DAY);
    const last3 = rows.slice(0, 3);
    const last5 = rows.slice(0, 5);
    const baselineRows = rows.slice(0, 10);
    const g3 = within(3);
    const g5 = within(5);
    const g7 = within(7);
    const minutes3d = g3.reduce((s, r) => s + r.min, 0);
    const minutes5d = g5.reduce((s, r) => s + r.min, 0);
    const minutes7d = g7.reduce((s, r) => s + r.min, 0);
    const avgLast3 = avg(last3.map((r) => r.min));
    const baseline = avg(baselineRows.map((r) => r.min));
    const overtime7d = g7.filter((r) => r.period > 4).length;
    const startsLast5 = last5.filter((r) => r.starter).length;
    const next = nextTeamGame(upcomingGames, currentTeam, now);
    const restHours = next ? (Date.parse(next.start_utc) - last.tip) / HOUR : null;
    const rotationDepth = recentRotationDepth(last.game, currentTeam);

    const component = {
      seven_day_volume: 30 * clamp(minutes7d / 180),
      schedule_density: 20 * clamp(g7.length / 5),
      recent_minutes: 20 * clamp(avgLast3 / 40),
      minutes_spike: 10 * clamp((avgLast3 - baseline) / 10),
      turnaround: restHours === null ? 0 : restHours < 30 ? 15 : restHours < 54 ? 10 : restHours < 78 ? 5 : 0,
      overtime: 5 * clamp(overtime7d)
    };
    const score = Math.round(Object.values(component).reduce((a, b) => a + b, 0));
    const signals = [];
    if (g5.length >= 3) signals.push(`${g5.length} games in 5 days`);
    if (restHours !== null && restHours < 30) signals.push(`Back-to-back turnaround · ${Math.round(restHours)}h between tips`);
    else if (restHours !== null && restHours < 54) signals.push(`Short turnaround · ${Math.round(restHours)}h between tips`);
    const spike = avgLast3 - baseline;
    if (spike >= 2) signals.push(`+${round(spike)} min vs 10-game baseline`);
    if (overtime7d) signals.push(`${overtime7d} overtime ${overtime7d === 1 ? 'game' : 'games'} in last 7 days`);
    if (last5.length >= 3 && startsLast5 === last5.length) signals.push(`Started ${startsLast5}/${last5.length} recent games`);
    if (rotationDepth > 0 && rotationDepth <= 7) signals.push(`Tight recent rotation · ${rotationDepth} players at 12+ min`);

    const ref = athleteRef.get(id) || {};
    const avail = amap.get(id) || null;
    players.push({
      athlete_id: id,
      name: ref.name ?? last.name ?? null,
      position: ref.position ?? last.position ?? null,
      team: tmap.get(currentTeam) || { team_id: currentTeam, name: null, short_name: null, abbr: null, color: null },
      score,
      band: playerLoadBand(score),
      last_game_utc: last.start_utc,
      next_game_utc: next?.start_utc || null,
      metrics: {
        last_game_minutes: round(last.min),
        avg_minutes_last3: round(avgLast3),
        baseline_minutes_last10: round(baseline),
        minutes_3d: round(minutes3d),
        minutes_5d: round(minutes5d),
        minutes_7d: round(minutes7d),
        games_3d: g3.length,
        games_5d: g5.length,
        games_7d: g7.length,
        overtime_games_7d: overtime7d,
        starts_last5: startsLast5,
        recent_rotation_depth_12plus: rotationDepth || null,
        turnaround_hours: restHours === null ? null : round(restHours)
      },
      components: Object.fromEntries(Object.entries(component).map(([k, v]) => [k, round(v)])),
      signals,
      availability: avail,
      availability_affects_score: false
    });
  }

  players.sort((a, b) => b.score - a.score || String(a.name || '').localeCompare(String(b.name || '')));
  const counts = { LIGHT: 0, NORMAL: 0, ELEVATED: 0, HEAVY: 0, EXTREME: 0 };
  for (const p of players) counts[p.band] += 1;
  return {
    schema: PLAYER_LOAD_VERSION,
    generated_at: new Date(now).toISOString(),
    disclaimer: PLAYER_LOAD_DISCLAIMER,
    methodology: {
      score_range: '0-100',
      score_inputs: ['minutes_7d', 'games_7d', 'avg_minutes_last3', 'minutes_vs_10_game_baseline', 'tip_to_tip_turnaround', 'overtime_games_7d'],
      availability_in_score: false,
      bands: { LIGHT: '0-34', NORMAL: '35-54', ELEVATED: '55-69', HEAVY: '70-84', EXTREME: '85-100' }
    },
    summary: { players: players.length, bands: counts, heavy_or_extreme: counts.HEAVY + counts.EXTREME },
    players
  };
}
