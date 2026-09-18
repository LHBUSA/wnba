import { semanticPlays, resolversFromSummary, providerBool } from './pbp.js';
// ESPN -> PropBetEdge WNBA normalization.
//
// Every shape here was observed in a real WNBA canary (docs/WNBA_SOURCE_MATRIX.md).
// Nothing is inferred from NBA. Missing source fields become null, never a guess.

export const ESPN = Object.freeze({
  // site.api.espn.com returned 403 to our canary host on 2026-09-11 while
  // site.web.api.espn.com served identical payloads; use the latter.
  site: 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba',
  v2: 'https://site.web.api.espn.com/apis/v2/sports/basketball/wnba',
  common: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba',
  core: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba'
});

// WNBA game structure (league rule, not NBA): four 10-minute quarters, 5-minute OT.
export const WNBA_RULES = Object.freeze({
  QUARTER_S: 600,
  OT_S: 300,
  REG_PERIODS: 4,
  PERSONAL_FOUL_LIMIT: 6
});

// ESPN publishes a sentinel (-214748340, -214748365) for plays without a
// location (free throws, rebounds, fouls). Observed range for real shots in
// the 401857189 canary: x 1..48, y -3..29 (feet; rim at ~(25, 0.25)).
export const COORD = Object.freeze({ X_MIN: -2, X_MAX: 52, Y_MIN: -6, Y_MAX: 94, RIM_X: 25, RIM_Y: 0.25 });

const toInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const toNum = (v) => {
  if (v === null || v === undefined || v === '' || v === '-' || v === '--') return null;
  const n = Number(String(v).replace(/[+,%]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));

export function seasonLabel(season) {
  if (!season) return null;
  const year = toInt(season.year);
  const type = toInt(season.type ?? season.type?.type);
  const name = { 1: 'Preseason', 2: 'Regular Season', 3: 'Postseason', 4: 'Offseason' }[type] || null;
  return year ? { year, type, label: name ? `${year} ${name}` : String(year) } : null;
}

export function normalizeTeamRef(t) {
  if (!t) return null;
  return {
    team_id: str(t.id),
    abbr: str(t.abbreviation),
    name: str(t.displayName),
    short_name: str(t.shortDisplayName || t.name),
    location: str(t.location),
    color: t.color ? `#${t.color}` : null,
    alt_color: t.alternateColor ? `#${t.alternateColor}` : null
  };
}

function statusOf(s) {
  if (!s) return null;
  const type = s.type || {};
  return {
    state: str(type.state), // pre | in | post
    name: str(type.name), // STATUS_SCHEDULED | STATUS_IN_PROGRESS | STATUS_HALFTIME | STATUS_END_PERIOD | STATUS_FINAL | STATUS_POSTPONED ...
    completed: Boolean(type.completed),
    detail: str(type.detail),
    short_detail: str(type.shortDetail),
    period: toInt(s.period),
    clock: str(s.displayClock),
    clock_s: toNum(s.clock)
  };
}

/** Seconds of game time elapsed at (period, remaining clock seconds). */
export function elapsedSeconds(period, clockRemainingS) {
  if (!period || clockRemainingS === null || clockRemainingS === undefined) return null;
  const p = Number(period);
  if (p <= WNBA_RULES.REG_PERIODS) return (p - 1) * WNBA_RULES.QUARTER_S + (WNBA_RULES.QUARTER_S - clockRemainingS);
  return WNBA_RULES.REG_PERIODS * WNBA_RULES.QUARTER_S + (p - WNBA_RULES.REG_PERIODS - 1) * WNBA_RULES.OT_S + (WNBA_RULES.OT_S - clockRemainingS);
}

export function parseClock(display) {
  if (display === null || display === undefined) return null;
  const s = String(display).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(\d+):(\d{1,2})(\.\d+)?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) : 0);
}

export function periodLabel(n) {
  const p = Number(n);
  if (!p) return null;
  if (p <= 4) return `Q${p}`;
  return p === 5 ? 'OT' : `${p - 4}OT`;
}

function competitorOf(c) {
  if (!c) return null;
  const team = normalizeTeamRef(c.team);
  const records = c.records || c.record || [];
  const total = records.find((r) => r.type === 'total' || r.name === 'overall') || records[0] || null;
  return {
    ...team,
    home_away: str(c.homeAway),
    // Scoreboard publishes score as a string; team schedules as {value, displayValue}.
    score: toInt(typeof c.score === 'object' && c.score !== null ? c.score.value ?? c.score.displayValue : c.score),
    winner: c.winner === undefined ? null : Boolean(c.winner),
    record: total ? str(total.summary || total.displayValue) : null,
    linescores: Array.isArray(c.linescores) ? c.linescores.map((l) => toInt(l.displayValue ?? l.value)) : [],
    // ESPN exposes a possession flag on some live payloads. We surface it
    // verbatim and never infer possession ourselves.
    possession: c.possession === undefined ? null : Boolean(c.possession)
  };
}

function oddsSummary(odds) {
  const o = Array.isArray(odds) ? odds[0] : null;
  if (!o) return null;
  return {
    provider: str(o.provider?.displayName || o.provider?.name),
    details: str(o.details),
    spread: toNum(o.spread),
    over_under: toNum(o.overUnder),
    note: 'Single-sportsbook line as relayed by ESPN. Not a PropBetEdge price or model.'
  };
}

export function normalizeScoreboardEvent(e) {
  const c = e?.competitions?.[0] || {};
  const comps = (c.competitors || []).map(competitorOf);
  const home = comps.find((t) => t.home_away === 'home') || null;
  const away = comps.find((t) => t.home_away === 'away') || null;
  return {
    game_id: str(e.id),
    source: 'espn',
    season: seasonLabel(e.season),
    name: str(e.name),
    short_name: str(e.shortName),
    start_utc: str(e.date),
    status: statusOf(c.status || e.status),
    home,
    away,
    venue: c.venue ? { name: str(c.venue.fullName), city: str(c.venue.address?.city), state: str(c.venue.address?.state) } : null,
    neutral_site: c.neutralSite === undefined ? null : Boolean(c.neutralSite),
    broadcasts: (c.broadcasts || []).flatMap((b) => b.names || []).filter(Boolean),
    notes: (c.notes || []).map((n) => str(n.headline)).filter(Boolean),
    series: c.series ? { summary: str(c.series.summary), title: str(c.series.title) } : null,
    odds_espn: oddsSummary(c.odds)
  };
}

export function normalizeScoreboard(body) {
  const league = body?.leagues?.[0] || {};
  return {
    day: str(body?.day?.date),
    season: seasonLabel(body?.season),
    calendar: {
      start: str(league.calendarStartDate),
      end: str(league.calendarEndDate)
    },
    games: (body?.events || []).map(normalizeScoreboardEvent)
  };
}

const SENTINEL = (v) => typeof v === 'number' && Math.abs(v) > 100000;

export function normalizeCoordinate(c) {
  if (!c || c.x === undefined || c.y === undefined) return null;
  const x = Number(c.x);
  const y = Number(c.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || SENTINEL(x) || SENTINEL(y)) return null;
  if (x < COORD.X_MIN || x > COORD.X_MAX || y < COORD.Y_MIN || y > COORD.Y_MAX) return null;
  return { x, y };
}

function withSemantics(play, s) {
  if (!s) return play;
  return {
    ...play,
    pbp_version: s.pbp_version,
    text: s.description,
    text_raw: play.text,
    description_source: s.description_source,
    family: s.family,
    subtype: s.subtype,
    shot_value: s.shot_value,
    free_throw: s.free_throw,
    assist: s.assist,
    stolen_by: s.stolen_by,
    blocked_by: s.blocked_by,
    rebound: s.rebound,
    turnover_type: s.turnover_type,
    foul_type: s.foul_type,
    score_before: s.score_before,
    primary: s.primary,
    made: s.made,
    scoring: s.scoring,
    shooting: s.shooting,
    points: s.points
  };
}

export function normalizePlay(p, athletes = {}) {
  const period = toInt(p.period?.number);
  const clock = str(p.clock?.displayValue);
  const clockS = parseClock(clock);
  const participants = (p.participants || []).map((x) => str(x.athlete?.id)).filter(Boolean);
  const shootingFlag = providerBool(p.shootingPlay);
  const scoringFlag = providerBool(p.scoringPlay);
  const eventText = `${p.type?.text || ''} ${p.shortDescription || ''} ${p.text || ''}`;
  const shotEvidence = /\b(makes|misses|made|missed)\b/i.test(eventText)
    || /\b(field ?goal|fg|2pt|3pt|jump ?shot|jumper|jumpshot|layup|lay-up|dunk|hook|tip(?:-in)?|fade ?away|floater|floating|finger[- ]?roll|alley[- ]?oop|two point shot|three point shot|three pointer|free ?throw)\b/i.test(eventText)
    || (scoringFlag === true && [1, 2, 3].includes(toInt(p.scoreValue) ?? toInt(p.pointsAttempted)));
  const coordinate = (shootingFlag === true || shotEvidence) ? normalizeCoordinate(p.coordinate) : null;
  return {
    id: str(p.id),
    seq: toInt(p.sequenceNumber),
    period,
    period_label: periodLabel(period),
    clock,
    elapsed_s: elapsedSeconds(period, clockS),
    wallclock: str(p.wallclock),
    type_id: str(p.type?.id),
    type: str(p.type?.text)?.replace(/\s+/g, ' ') ?? null,
    text: str(p.text),
    short: str(p.shortDescription),
    team_id: str(p.team?.id),
    athlete_ids: participants,
    primary_athlete: participants[0] ? athletes[participants[0]] || { id: participants[0], name: null } : null,
    home_score: toInt(p.homeScore),
    away_score: toInt(p.awayScore),
    scoring: scoringFlag === true,
    points: scoringFlag === true ? (toInt(p.scoreValue) ?? 0) : 0,
    shooting: shootingFlag === true,
    points_attempted: toInt(p.pointsAttempted),
    made: shootingFlag === true ? scoringFlag === true : null,
    coordinate
  };
}

function athleteIndexFromBox(box) {
  const idx = {};
  for (const t of box?.players || []) {
    for (const s of t.statistics || []) {
      for (const a of s.athletes || []) {
        const id = str(a.athlete?.id);
        if (id) idx[id] = { id, name: str(a.athlete.displayName), short: str(a.athlete.shortName), jersey: str(a.athlete.jersey), team_id: str(t.team?.id) };
      }
    }
  }
  return idx;
}

const BOX_KEYS = {
  MIN: 'min', PTS: 'pts', FG: 'fg', '3PT': 'fg3', FT: 'ft', REB: 'reb', AST: 'ast', TO: 'tov',
  STL: 'stl', BLK: 'blk', OREB: 'oreb', DREB: 'dreb', PF: 'pf', '+/-': 'plus_minus'
};

function splitMadeAtt(v) {
  const m = String(v ?? '').match(/^(\d+)-(\d+)$/);
  return m ? { made: Number(m[1]), att: Number(m[2]) } : { made: null, att: null };
}

export function normalizeBoxscore(box) {
  const teams = (box?.teams || []).map((t) => {
    const stats = {};
    for (const s of t.statistics || []) stats[s.name] = s.displayValue;
    return { ...normalizeTeamRef(t.team), home_away: str(t.homeAway), stats };
  });
  const players = [];
  for (const t of box?.players || []) {
    for (const s of t.statistics || []) {
      const labels = s.labels || [];
      for (const a of s.athletes || []) {
        const row = { athlete_id: str(a.athlete?.id), name: str(a.athlete?.displayName), short: str(a.athlete?.shortName), jersey: str(a.athlete?.jersey), position: str(a.athlete?.position?.abbreviation), team_id: str(t.team?.id), starter: Boolean(a.starter), dnp: Boolean(a.didNotPlay), dnp_reason: a.didNotPlay ? str(a.reason) : null, ejected: Boolean(a.ejected), active: a.active === undefined ? null : Boolean(a.active) };
        (a.stats || []).forEach((v, i) => {
          const k = BOX_KEYS[labels[i]];
          if (!k) return;
          if (k === 'fg' || k === 'fg3' || k === 'ft') {
            const { made, att } = splitMadeAtt(v);
            row[`${k}m`] = made;
            row[`${k}a`] = att;
          } else if (k === 'plus_minus') row[k] = toNum(v);
          else row[k] = toNum(v);
        });
        players.push(row);
      }
    }
  }
  return { teams, players };
}

export function normalizeSummary(body) {
  const header = body?.header || {};
  const comp = header.competitions?.[0] || {};
  const comps = (comp.competitors || []).map(competitorOf);
  const athletes = athleteIndexFromBox(body?.boxscore);
  // pbe-pbp/1.0.0: structured semantics and the deterministic description ride on every play (source order kept).
  const sem = new Map(semanticPlays(body?.plays || [], resolversFromSummary(body)).map((p) => [p.source_id, p]));
  const plays = (body?.plays || []).map((p) => withSemantics(normalizePlay(p, athletes), sem.get(String(p.id))));
  const game = {
    game_id: str(header.id),
    source: 'espn',
    season: seasonLabel(header.season),
    start_utc: str(comp.date),
    status: statusOf(comp.status),
    home: comps.find((t) => t.home_away === 'home') || null,
    away: comps.find((t) => t.home_away === 'away') || null,
    venue: body?.gameInfo?.venue ? { name: str(body.gameInfo.venue.fullName), city: str(body.gameInfo.venue.address?.city), state: str(body.gameInfo.venue.address?.state) } : null,
    attendance: toInt(body?.gameInfo?.attendance),
    officials: (body?.gameInfo?.officials || []).map((o) => str(o.displayName)).filter(Boolean),
    broadcasts: (comp.broadcasts || []).map((b) => str(b.media?.shortName)).filter(Boolean),
    capabilities: {
      play_by_play: comp.playByPlaySource ? str(comp.playByPlaySource) : null,
      shot_chart: comp.shotChartAvailable === undefined ? null : Boolean(comp.shotChartAvailable),
      possession_arrow: comp.possessionArrowAvailable === undefined ? null : Boolean(comp.possessionArrowAvailable),
      wallclock: body?.wallclockAvailable === undefined ? null : Boolean(body.wallclockAvailable)
    },
    source_updated_at: str(body?.meta?.lastUpdatedAt),
    first_play_wallclock: str(body?.meta?.firstPlayWallClock),
    last_play_wallclock: str(body?.meta?.lastPlayWallClock)
  };
  return {
    game,
    plays,
    box: normalizeBoxscore(body?.boxscore),
    athletes,
    injuries: normalizeGameInjuries(body?.injuries),
    pickcenter: normalizePickcenter(body?.pickcenter),
    season_series: (body?.seasonseries || []).map((s) => ({ summary: str(s.summary), title: str(s.title), completed: s.seriesCompleted ?? null })),
    leaders: (body?.leaders || []).map((t) => ({
      team_id: str(t.team?.id),
      categories: (t.leaders || []).map((c) => ({
        name: str(c.name),
        label: str(c.displayName),
        leader: c.leaders?.[0] ? { athlete_id: str(c.leaders[0].athlete?.id), name: str(c.leaders[0].athlete?.displayName), value: str(c.leaders[0].displayValue) } : null
      }))
    }))
  };
}

function normalizePickcenter(list) {
  return (list || []).map((o) => ({
    provider: str(o.provider?.name),
    details: str(o.details),
    spread: toNum(o.spread),
    over_under: toNum(o.overUnder),
    over_odds: toNum(o.overOdds),
    under_odds: toNum(o.underOdds),
    home_moneyline: toNum(o.homeTeamOdds?.moneyLine),
    away_moneyline: toNum(o.awayTeamOdds?.moneyLine),
    home_spread_odds: toNum(o.homeTeamOdds?.spreadOdds),
    away_spread_odds: toNum(o.awayTeamOdds?.spreadOdds),
    note: 'Relayed by ESPN from one sportsbook. Not a PropBetEdge model.'
  }));
}

function normalizeGameInjuries(list) {
  return (list || []).map((t) => ({
    team_id: str(t.team?.id),
    items: (t.injuries || []).map((i) => ({
      athlete_id: str(i.athlete?.id),
      name: str(i.athlete?.displayName),
      status: str(i.status),
      type: str(i.details?.type),
      detail: str(i.details?.detail),
      side: str(i.details?.side),
      reported_at: str(i.date)
    }))
  }));
}

/** Injuries feed. ESPN status + notes; notes frequently cite a reporter. */
export function normalizeInjuries(body) {
  const out = [];
  for (const t of body?.injuries || []) {
    for (const i of t.injuries || []) {
      const athleteId = str(i.athlete?.id) || (i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ?? null);
      out.push({
        injury_id: str(i.id),
        team_id: str(t.id),
        team_name: str(t.displayName),
        athlete_id: athleteId,
        name: str(i.athlete?.displayName),
        position: str(i.athlete?.position?.abbreviation),
        status: str(i.status),
        status_code: str(i.type?.abbreviation),
        body_part: str(i.details?.type),
        detail: str(i.details?.detail),
        side: str(i.details?.side),
        // ESPN field; displayed only as "source-reported expected return", never
        // as a PropBetEdge estimate.
        source_return_date: str(i.details?.returnDate),
        fantasy_status: str(i.details?.fantasyStatus?.description),
        short_comment: str(i.shortComment),
        long_comment: str(i.longComment),
        source_updated_at: str(i.date),
        authority: 'PROVIDER_FEED',
        authority_note: 'ESPN injury feed. Status is ESPN’s; comment text often cites a named reporter. Not the league’s official injury report.'
      });
    }
  }
  return out;
}

export function normalizeStandings(body) {
  const groups = [];
  for (const child of body?.children || []) {
    const entries = (child.standings?.entries || []).map((e) => {
      const s = {};
      for (const x of e.stats || []) s[x.name || x.type] = x.displayValue ?? x.value;
      return {
        ...normalizeTeamRef(e.team),
        wins: toInt(s.wins),
        losses: toInt(s.losses),
        win_pct: toNum(s.winPercent),
        games_behind: str(s.gamesBehind),
        seed: toInt(s.playoffSeed),
        clincher: str(s.clincher),
        streak: str(s.streak),
        home: str(s.Home),
        road: str(s.Road),
        conference: str(s['vs. Conf.']),
        last_ten: str(s['Last Ten Games']),
        points_for_avg: toNum(s.avgPointsFor),
        points_against_avg: toNum(s.avgPointsAgainst),
        differential: toNum(s.differential)
      };
    });
    entries.sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
    groups.push({ name: str(child.name), abbr: str(child.abbreviation), entries });
  }
  const season = body?.children?.[0]?.standings || {};
  return {
    season: { year: toInt(season.season), type: toInt(season.seasonType), label: seasonLabel({ year: season.season, type: season.seasonType })?.label || null },
    season_types: (body?.seasons?.[0]?.types || []).map((t) => ({ type: toInt(t.id), name: str(t.name), start: str(t.startDate), end: str(t.endDate) })),
    groups
  };
}

export function normalizeTeams(body) {
  return (body?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => normalizeTeamRef(x.team));
}

export function normalizeRosterAthlete(a, teamId) {
  return {
    athlete_id: str(a.id),
    name: str(a.displayName || a.fullName),
    first_name: str(a.firstName),
    last_name: str(a.lastName),
    short_name: str(a.shortName),
    jersey: str(a.jersey),
    position: str(a.position?.abbreviation),
    position_name: str(a.position?.displayName),
    height: str(a.displayHeight),
    age: toInt(a.age),
    dob: a.dateOfBirth ? String(a.dateOfBirth).slice(0, 10) : null,
    birthplace: a.birthPlace ? [a.birthPlace.city, a.birthPlace.state, a.birthPlace.country].filter(Boolean).join(', ') : null,
    college: str(a.college?.name),
    experience_years: toInt(a.experience?.years),
    status: str(a.status?.type || a.status?.name),
    team_id: str(teamId),
    injuries: (a.injuries || []).map((i) => ({ status: str(i.status), date: str(i.date) }))
  };
}

export function normalizeRoster(body) {
  const teamId = str(body?.team?.id);
  return {
    team: normalizeTeamRef(body?.team),
    season: seasonLabel(body?.season),
    coach: (body?.coach || []).map((c) => [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean),
    athletes: (body?.athletes || []).map((a) => normalizeRosterAthlete(a, teamId)),
    source_timestamp: str(body?.timestamp)
  };
}

export function normalizeAthleteOverview(body) {
  const a = body?.athlete || {};
  return {
    athlete_id: str(a.id),
    name: str(a.displayName),
    first_name: str(a.firstName),
    last_name: str(a.lastName),
    jersey: str(a.jersey),
    position: str(a.position?.abbreviation),
    position_name: str(a.position?.displayName),
    height: str(a.displayHeight),
    weight: str(a.displayWeight),
    age: toInt(a.age),
    dob: a.dateOfBirth ? String(a.dateOfBirth).slice(0, 10) : null,
    college: str(a.college?.name),
    experience_years: toInt(a.experience?.years),
    draft: a.draft ? str(a.draft.displayText) : null,
    status: str(a.status?.type),
    team: a.team ? normalizeTeamRef(a.team) : null,
    conference: str(a.team?.groups?.name)
  };
}

const GAMELOG_KEYS = {
  minutes: 'min', points: 'pts', totalRebounds: 'reb', assists: 'ast', steals: 'stl', blocks: 'blk', turnovers: 'tov',
  'fieldGoalsMade-fieldGoalsAttempted': 'fg', fieldGoalPct: 'fg_pct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted': 'fg3',
  threePointPct: 'fg3_pct', 'freeThrowsMade-freeThrowsAttempted': 'ft', freeThrowPct: 'ft_pct', fouls: 'pf'
};

export function normalizeGamelog(body) {
  const names = body?.names || [];
  const events = body?.events || {};
  const seasons = [];
  for (const st of body?.seasonTypes || []) {
    const rows = [];
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const meta = events[ev.eventId] || {};
        const row = {
          game_id: str(ev.eventId),
          date: str(meta.gameDate),
          opponent: meta.opponent ? { team_id: str(meta.opponent.id), abbr: str(meta.opponent.abbreviation), name: str(meta.opponent.displayName) } : null,
          at_vs: str(meta.atVs),
          result: str(meta.gameResult),
          score: str(meta.score),
          team_id: str(meta.team?.id)
        };
        (ev.stats || []).forEach((v, i) => {
          const k = GAMELOG_KEYS[names[i]];
          if (!k) return;
          if (k === 'fg' || k === 'fg3' || k === 'ft') {
            const { made, att } = splitMadeAtt(v);
            row[`${k}m`] = made;
            row[`${k}a`] = att;
          } else row[k] = toNum(v);
        });
        rows.push(row);
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    seasons.push({ name: str(st.displayName), games: rows });
  }
  return { seasons };
}

export function normalizeAthleteStats(body) {
  // common/v3 athletes/{id}/stats: categories[] with labels + statistics[] per season.
  const cats = [];
  for (const c of body?.categories || []) {
    cats.push({
      name: str(c.name),
      label: str(c.displayName),
      labels: c.labels || [],
      names: c.names || [],
      seasons: (c.statistics || []).map((s) => ({
        season: toInt(s.season?.year),
        season_label: str(s.season?.displayName),
        team_id: str(s.teamId),
        team: str(s.teamSlug),
        stats: s.stats || []
      })),
      totals: c.totals || null
    });
  }
  return { categories: cats };
}

export function normalizeLeaders(body) {
  // common/v3 statistics/byathlete: categories define names; athletes[] carry totals per category.
  const catNames = {};
  for (const c of body?.categories || []) catNames[c.name] = c.names || [];
  const rows = (body?.athletes || []).map((a) => {
    const row = {
      athlete_id: str(a.athlete?.id),
      name: str(a.athlete?.displayName),
      team_id: str(a.athlete?.teamId),
      team: str(a.athlete?.teamShortName),
      position: str(a.athlete?.position?.abbreviation)
    };
    for (const c of a.categories || []) {
      (catNames[c.name] || []).forEach((n, i) => {
        row[n] = toNum(c.totals?.[i]);
      });
    }
    return row;
  });
  return { season: seasonLabel(body?.requestedSeason || body?.currentSeason), rows };
}

export function normalizeTeamStats(body) {
  const out = {};
  for (const c of body?.results?.stats?.categories || body?.statistics?.splits?.categories || []) {
    for (const s of c.stats || []) out[s.name] = toNum(s.value ?? s.displayValue);
  }
  return out;
}

export function normalizeTransactions(body) {
  return (body?.transactions || []).map((t) => ({
    date: str(t.date),
    description: str(t.description),
    team: t.team ? normalizeTeamRef(t.team) : null
  }));
}

export function normalizeEspnNews(body) {
  return (body?.articles || []).map((a) => ({
    source_item_id: str(a.id ?? a.dataSourceIdentifier),
    type: str(a.type),
    headline: str(a.headline),
    description: str(a.description),
    published_at: str(a.published),
    updated_at: str(a.lastModified),
    url: str(a.links?.web?.href),
    byline: str(a.byline),
    premium: Boolean(a.premium),
    categories: (a.categories || []).map((c) => ({
      type: str(c.type),
      label: str(c.description),
      athlete_id: str(c.athleteId ?? c.athlete?.id),
      team_id: str(c.teamId ?? c.team?.id),
      league: str(c.leagueId ?? c.league?.abbreviation)
    }))
  }));
}
