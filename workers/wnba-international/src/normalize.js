// ESPN (league `fiba`) → canonical international entities. Pure functions: no network, no clock except where
// passed in. The frontend depends only on these shapes, never on provider responses.

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const slugify = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Readable national-team slugs ("france", "belgium"); the United States uses its common short form.
const SLUG_ALIASES = { 'united-states': 'usa', 'united-states-of-america': 'usa' };
export const teamSlug = (t) => { const s = slugify(t?.location || t?.displayName || t?.name); return SLUG_ALIASES[s] || s; };
export const playerSlug = (name) => slugify(name);

/** "FIBA Women’s World Cup – Semifinals" → { phase, round, round_name, group } */
export function parseStage(headline) {
  const h = String(headline || '');
  const g = h.match(/Group\s+([A-Z])\b/);
  if (g) return { phase: 'group', round: 'GROUP', round_name: `Group ${g[1]}`, group: g[1], order: 1 };
  if (/Qualification to Quarter/i.test(h)) return { phase: 'knockout', round: 'QQF', round_name: 'Qualification to Quarter-Finals', group: null, order: 2 };
  if (/Quarter/i.test(h)) return { phase: 'knockout', round: 'QF', round_name: 'Quarter-Finals', group: null, order: 3 };
  if (/Semi/i.test(h)) return { phase: 'knockout', round: 'SF', round_name: 'Semi-Finals', group: null, order: 4 };
  if (/3rd|Third|Bronze/i.test(h)) return { phase: 'knockout', round: 'BRONZE', round_name: 'Bronze Medal Game', group: null, order: 5 };
  if (/Final/i.test(h)) return { phase: 'knockout', round: 'FINAL', round_name: 'Final · Gold Medal Game', group: null, order: 6 };
  return { phase: 'unknown', round: 'UNKNOWN', round_name: h || 'Game', group: null, order: 0 };
}

export function normalizeTeam(t) {
  if (!t) return null;
  const code = String(t.abbreviation || '').toUpperCase() || null;
  return {
    team_id: `nt-${teamSlug(t)}`,
    slug: teamSlug(t),
    provider_ids: { espn: String(t.id) },
    country_code: code,
    name: t.displayName || t.location || t.name,
    short_name: t.shortDisplayName || t.location || t.name,
    color: /^[0-9a-f]{6}$/i.test(t.color || '') ? `#${t.color}` : null,
    flag: code ? `/media/flags/${code.toLowerCase()}.svg` : null
  };
}

/** ESPN status → canonical game state. Never claims live for a completed or scheduled game. */
export function normalizeStatus(st) {
  const type = st?.type || {};
  const state = type.state === 'in' ? 'live' : type.state === 'post' ? 'final' : /POSTPONED|CANCEL|SUSPEND|DELAY/.test(type.name || '') ? 'postponed' : 'scheduled';
  const period = num(st?.period) || null;
  return {
    status: state,
    status_detail: type.shortDetail || type.detail || null,
    period: state === 'scheduled' ? null : period,
    period_label: period ? (period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `${period - 4}OT`) : null,
    clock: state === 'live' ? st?.displayClock || null : null,
    halftime: /HALFTIME/.test(type.name || ''),
    end_of_period: /END_PERIOD/.test(type.name || '')
  };
}

/** One scoreboard event or summary header competition → canonical game. */
export function normalizeGame(event, { competitionId, fetchedAt = null } = {}) {
  const c = event.competitions?.[0] || event;
  const stage = parseStage((c.notes || event.notes || []).map((n) => n.headline).join(' '));
  const side = (homeAway) => c.competitors?.find((x) => x.homeAway === homeAway) || null;
  const H = side('home');
  const A = side('away');
  const st = normalizeStatus(c.status || event.status);
  const score = (x) => (st.status === 'scheduled' ? null : num(x?.score));
  const home = normalizeTeam(H?.team);
  const away = normalizeTeam(A?.team);
  const hs = score(H);
  const as = score(A);
  const winner = st.status === 'final' && hs !== null && as !== null && hs !== as ? (hs > as ? home?.team_id : away?.team_id) : null;
  const venue = c.venue || event.gameInfo?.venue || null;
  return {
    game_id: `g-${event.id}`,
    provider_ids: { espn: String(event.id) },
    competition_id: competitionId,
    ...stage,
    scheduled_at: event.date || c.date || null,
    venue: venue ? { name: venue.fullName || null, city: venue.address?.city || null, country: venue.address?.state || venue.address?.country || null } : null,
    home_team: home,
    away_team: away,
    home_team_id: home?.team_id || null,
    away_team_id: away?.team_id || null,
    home_score: hs,
    away_score: as,
    linescores: {
      home: (H?.linescores || []).map((l) => num(l.value ?? l.displayValue)),
      away: (A?.linescores || []).map((l) => num(l.value ?? l.displayValue))
    },
    ...st,
    winner,
    source: 'espn',
    fetched_at: fetchedAt
  };
}

const PLAYER_KEYS = { minutes: 'min', points: 'pts', rebounds: 'reb', assists: 'ast', turnovers: 'tov', steals: 'stl', blocks: 'blk', offensiveRebounds: 'oreb', defensiveRebounds: 'dreb', fouls: 'pf', plusMinus: 'pm' };
const splitMade = (v) => { const m = String(v || '').match(/^(\d+)-(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : [null, null]; };

/** summary.boxscore → { teams: [{team, totals, players:[...]}] } with player stat lines as numbers. */
export function normalizeBoxscore(summary) {
  const bx = summary?.boxscore;
  if (!bx?.players?.length) return null;
  const teamStats = new Map((bx.teams || []).map((t) => [String(t.team?.id), Object.fromEntries((t.statistics || []).map((s) => [s.name, s.displayValue]))]));
  return {
    teams: bx.players.map((tp) => {
      const block = tp.statistics?.[0] || {};
      const keys = block.keys || block.names || [];
      const players = (block.athletes || []).map((a) => {
        const row = { player_id: `p-${a.athlete?.id}`, provider_ids: { espn: String(a.athlete?.id) }, name: a.athlete?.displayName, jersey: a.athlete?.jersey || null, starter: Boolean(a.starter), did_not_play: Boolean(a.didNotPlay) };
        keys.forEach((k, i) => {
          const v = a.stats?.[i];
          if (k === 'fieldGoalsMade-fieldGoalsAttempted') [row.fgm, row.fga] = splitMade(v);
          else if (k === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted') [row.fg3m, row.fg3a] = splitMade(v);
          else if (k === 'freeThrowsMade-freeThrowsAttempted') [row.ftm, row.fta] = splitMade(v);
          else if (PLAYER_KEYS[k]) row[PLAYER_KEYS[k]] = num(String(v ?? '').replace(/^\+/, ''));
        });
        return row;
      });
      const ts = teamStats.get(String(tp.team?.id)) || {};
      const [fgm, fga] = splitMade(ts['fieldGoalsMade-fieldGoalsAttempted']);
      const [fg3m, fg3a] = splitMade(ts['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
      const [ftm, fta] = splitMade(ts['freeThrowsMade-freeThrowsAttempted']);
      return {
        team: normalizeTeam(tp.team),
        totals: { pts: players.reduce((s, p) => s + (p.pts || 0), 0), fgm, fga, fg3m, fg3a, ftm, fta, reb: num(ts.totalRebounds), oreb: num(ts.offensiveRebounds), dreb: num(ts.defensiveRebounds), ast: num(ts.assists), stl: num(ts.steals), blk: num(ts.blocks), tov: num(ts.totalTurnovers ?? ts.turnovers), pf: num(ts.fouls) },
        players
      };
    })
  };
}

export function normalizePlays(summary, teamsByEspnId = new Map()) {
  return (summary?.plays || []).map((p) => ({
    play_id: String(p.id),
    period: num(p.period?.number),
    clock: p.clock?.displayValue || null,
    text: p.text || '',
    type: p.type?.text || null,
    scoring: Boolean(p.scoringPlay),
    points: num(p.scoreValue) || 0,
    home_score: num(p.homeScore),
    away_score: num(p.awayScore),
    team_id: p.team?.id ? teamsByEspnId.get(String(p.team.id)) || null : null,
    player_ids: (p.participants || []).map((x) => `p-${x.athlete?.id}`).filter((x) => x !== 'p-undefined'),
    // Coordinates are passed through only as published by the provider; never derived.
    coordinate: p.coordinate && Number.isFinite(p.coordinate.x) && Number.isFinite(p.coordinate.y) ? { x: p.coordinate.x, y: p.coordinate.y } : null,
    wallclock: p.wallclock || null
  }));
}

/** Full game detail from a summary: game (header) + box score + plays. */
export function normalizeSummary(summary, { competitionId, eventId, fetchedAt = null } = {}) {
  const header = summary?.header;
  const comp = header?.competitions?.[0];
  if (!comp) return null;
  const game = normalizeGame({ id: eventId || header.id, date: comp.date, competitions: [{ ...comp, venue: summary.gameInfo?.venue || comp.venue, notes: comp.notes || header.notes || [] }] }, { competitionId, fetchedAt });
  const byEspn = new Map([game.home_team, game.away_team].filter(Boolean).map((t) => [t.provider_ids.espn, t.team_id]));
  return { game, boxscore: normalizeBoxscore(summary), plays: normalizePlays(summary, byEspn) };
}
