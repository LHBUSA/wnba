// Canonical helpers for the career payload returned by wnba-api player pages.
// ESPN's common/v3 athlete stats group fields by category; this module turns
// those category arrays into a small, provider-agnostic career summary for UI,
// metadata and schema without inventing values.

const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
};

const ALIASES = Object.freeze({
  games: ['gamesPlayed', 'games', 'appearances'],
  starts: ['gamesStarted', 'starts'],
  minutes: ['minutes', 'minutesPlayed', 'totalMinutes'],
  points: ['points', 'totalPoints'],
  rebounds: ['rebounds', 'totalRebounds'],
  assists: ['assists', 'totalAssists'],
  steals: ['steals', 'totalSteals'],
  blocks: ['blocks', 'totalBlocks'],
  turnovers: ['turnovers', 'totalTurnovers'],
  fgm: ['fieldGoalsMade'],
  fga: ['fieldGoalsAttempted'],
  threes: ['threePointFieldGoalsMade', 'threePointFieldGoals'],
  threesAtt: ['threePointFieldGoalsAttempted'],
  ftm: ['freeThrowsMade'],
  fta: ['freeThrowsAttempted']
});

function totalsArray(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.stats)) return v.stats;
  if (Array.isArray(v?.values)) return v.values;
  return [];
}

function valueMap(career) {
  const out = new Map();
  const years = new Set();

  for (const cat of career?.categories || []) {
    const names = cat.names || [];
    const totals = totalsArray(cat.totals);

    names.forEach((name, i) => {
      const value = n(totals[i]);
      if (name && value !== null && !out.has(name)) out.set(name, value);
    });

    // Some provider payloads omit category.totals but still expose every
    // season row. For count stats, summing those rows is a safe fallback.
    names.forEach((name, i) => {
      if (!name || out.has(name)) return;
      const values = (cat.seasons || []).map((s) => n(s.stats?.[i])).filter((v) => v !== null);
      if (values.length) out.set(name, values.reduce((a, b) => a + b, 0));
    });

    for (const s of cat.seasons || []) if (Number.isFinite(Number(s.season))) years.add(Number(s.season));
  }

  return { out, years: [...years].sort((a, b) => a - b) };
}

const pick = (map, keys) => {
  for (const k of keys) if (map.has(k)) return map.get(k);
  return null;
};

export function careerSummary(career) {
  const { out, years } = valueMap(career);
  const result = {};
  for (const [key, aliases] of Object.entries(ALIASES)) result[key] = pick(out, aliases);

  const gp = result.games;
  result.ppg = gp && result.points !== null ? result.points / gp : null;
  result.rpg = gp && result.rebounds !== null ? result.rebounds / gp : null;
  result.apg = gp && result.assists !== null ? result.assists / gp : null;
  result.spg = gp && result.steals !== null ? result.steals / gp : null;
  result.bpg = gp && result.blocks !== null ? result.blocks / gp : null;
  result.seasons = years.length;
  result.firstSeason = years[0] ?? null;
  result.lastSeason = years.at(-1) ?? null;
  result.available = Object.values(result).some((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return result;
}

const whole = (v) => Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : null;
const one = (v) => Number.isFinite(v) ? v.toFixed(1) : null;

export function careerMetaLine(career) {
  const c = careerSummary(career);
  if (!c.available) return '';
  const totals = [];
  if (c.games !== null) totals.push(`${whole(c.games)} games`);
  if (c.points !== null) totals.push(`${whole(c.points)} points`);
  if (c.rebounds !== null) totals.push(`${whole(c.rebounds)} rebounds`);
  if (c.assists !== null) totals.push(`${whole(c.assists)} assists`);
  if (!totals.length) return '';
  return ` Career totals: ${totals.join(', ')}.`;
}

export function careerRateLine(career) {
  const c = careerSummary(career);
  const rates = [
    c.ppg !== null ? `${one(c.ppg)} PPG` : null,
    c.rpg !== null ? `${one(c.rpg)} RPG` : null,
    c.apg !== null ? `${one(c.apg)} APG` : null
  ].filter(Boolean);
  return rates.join(' · ');
}
