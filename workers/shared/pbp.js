// Play-by-play semantics — pbe-pbp/1.0.0.
//
// One canonical basketball play for every PropBetEdge surface (WNBA via wnba-api, international via
// wnba-international, WNBACast, the newsroom). Built from the provider's STRUCTURED fields first — type, scoringPlay,
// shootingPlay, scoreValue, pointsAttempted, shortDescription, participants, sequenceNumber — and the provider's own
// text only where that text carries information. Nothing is inferred from score movement, timestamps or neighbouring
// events: a shot type, distance, free-throw number, assist, steal or block is stated only when the source states it.
//
// Why: ESPN's FIBA feed publishes text such as "Caitlin Clark makes" while its structured fields say a made free throw
// (type MadeFreeThrow, pointsAttempted 1, "+1 Point"). The old normalizers kept only the text.

export const PBP_VERSION = 'pbe-pbp/1.0.2';

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const str = (v) => (v === null || v === undefined ? null : String(v));
export const providerBool = (v) => {
  if (v === true || v === false) return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
};
const clean = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\s+'s\b/g, '’s').replace(/\s+/g, ' ').trim();
const sentence = (s) => { const t = clean(s).replace(/^Jump Ball\b/, 'Jump ball'); if (!t) return t; const c = t.charAt(0).toUpperCase() + t.slice(1); return /[.!?)]$/.test(c) && !/\)$/.test(c) ? c : /\)$/.test(c) ? `${c}.` : `${c}.`; };

// A made/missed play description with nothing but the player (and at most an assist credit): not a description.
export const GENERIC_SHOT_TEXT = /^\s*[^()]*?\b(makes|misses)\s*(\([^)]*\))?\s*\.?\s*$/i;
const DESCRIPTIVE = /\b(\d+-foot|jumper|jump ?shot|jumpshot|layup|lay-up|dunk|hook|tip|fade ?away|floater|floating|free throw|three point|two point|rebound|turnover|foul|steals?|blocks?|enters the game|timeout|jump ball|violation|end of|review|challenge|ejected|delay)\b/i;

/** Shot subtype words from the provider type ("Pullup Jump Shot", "JumpShot", "LayUpShot", "Driving Layup Shot"). */
export function shotSubtype(typeText) {
  let t = String(typeText || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return null;
  t = t.replace(/\blay ?up\b/g, 'layup').replace(/\bpull ?up\b/g, 'pull-up').replace(/\bfade away\b/g, 'fadeaway').replace(/\bstep back\b/g, 'step-back').replace(/\bfinger roll\b/g, 'finger-roll').replace(/\balley oop\b/g, 'alley-oop');
  t = t.replace(/\blayup shot\b/, 'layup').replace(/\bdunk shot\b/, 'dunk').replace(/\btip shot\b/, 'tip-in').replace(/\bhook shot\b/, 'hook shot');
  if (/free throw/.test(t)) return null;
  return t;
}

const FOUL_TYPE = (t) => { const m = String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/^(.*?)\s*foul\b/); const k = m ? m[1].trim() : ''; return k || null; };
const TURNOVER_TYPE = (t) => { const k = String(t || '').replace(/\n/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\bturnover\b/, '').replace(/\s+/g, ' ').trim(); return k && k !== 'turnover' ? k : null; };

function familyOf({ typeText, short, text, shooting, scoring, scoreValue, pointsAttempted, typeId }) {
  const t = `${typeText || ''} ${short || ''} ${text || ''}`;
  const shotLike = /\b(makes|misses|made|missed)\b/i.test(t) || /\b(field ?goal|fg|2pt|3pt|jump ?shot|jumper|jumpshot|layup|lay-up|dunk|hook|tip(?:-in)?|fade ?away|floater|floating|finger[- ]?roll|alley[- ]?oop|two point shot|three point shot|three pointer)\b/i.test(t);
  const scoringValue = pointsAttempted === 1 || pointsAttempted === 2 || pointsAttempted === 3
    ? pointsAttempted
    : scoreValue === 1 || scoreValue === 2 || scoreValue === 3
      ? scoreValue
      : null;
  if (typeId === '412' || typeId === '402' || /^end (period|game)|^end of|halftime/i.test(short || '') || /^end (period|game)$/i.test(typeText || '')) return 'period';
  if (/jump ?ball/i.test(t)) return 'jumpball';
  if (/timeout/i.test(t)) return 'timeout';
  if (/substitution/i.test(t)) return 'substitution';
  if (/review|challenge/i.test(t)) return 'review';
  if (/free ?throw/i.test(t) || (shooting === true && pointsAttempted === 1) || (scoring === true && scoringValue === 1)) return 'free_throw';
  if (shooting === true || shotLike || (scoring === true && (scoringValue === 2 || scoringValue === 3))) return 'shot';
  if (/turnover/i.test(t) || /^traveling$/i.test(typeText || '')) return 'turnover';
  if (/rebound/i.test(t)) return 'rebound';
  if (/^steal\b/i.test(typeText || '') || /^steal$/i.test(short || '')) return 'steal';
  if (/block/i.test(typeText || '') || /blocked shot/i.test(short || '')) return 'block';
  if (/foul/i.test(t)) return 'foul';
  if (/violation/i.test(t)) return 'violation';
  return 'other';
}

const threeWord = { 1: 'one-point', 2: 'two-point', 3: 'three-point' };

/**
 * The canonical play. `raw` is an ESPN play (site API summary). `athleteName(id)` and `teamName(espnTeamId)` resolve
 * display names from the same payload's box score/header. `prev` is the previous play in source order (score before).
 */
export function semanticPlay(raw, { athleteName = () => null, teamName = () => null, prev = null, order = 0 } = {}) {
  const typeText = str(raw.type?.text)?.replace(/\s+/g, ' ') ?? null;
  const typeId = str(raw.type?.id);
  const short = str(raw.shortDescription);
  const text = clean(raw.text);
  const shootingFlag = providerBool(raw.shootingPlay);
  const scoringFlag = providerBool(raw.scoringPlay);
  const pointsAttempted = int(raw.pointsAttempted);
  const scoreValue = int(raw.scoreValue);
  const parts = (raw.participants || []).map((x) => str(x.athlete?.id)).filter(Boolean);
  const family = familyOf({ typeText, short, text, shooting: shootingFlag, scoring: scoringFlag, scoreValue, pointsAttempted, typeId });
  const person = (id, fallbackName = null) => (id || fallbackName ? { id: id || null, name: (id && athleteName(id)) || fallbackName || null } : null);
  const teamId = str(raw.team?.id);
  const team = teamId ? { id: teamId, name: teamName(teamId) || null } : null;

  // Secondary actors: only from the provider's own credit text and participant list.
  const assistName = text.match(/\(([^()]+?) assists?\)/i)?.[1] || null;
  const stealName = text.match(/\(([^()]+?) steals?\)/i)?.[1] || null;
  const blockMatch = text.match(/^(.+?) blocks (.+?)(?:’s|'s)\b/i);
  let primary = person(parts[0]);
  let assist = assistName ? person(parts[1], assistName) : null;
  let stolenBy = stealName ? person(parts[1], stealName) : null;
  let blockedBy = null;
  if (blockMatch) {
    const [blocker, shooter] = [clean(blockMatch[1]), clean(blockMatch[2])];
    const idFor = (name) => parts.find((id) => athleteName(id) === name) || null;
    blockedBy = person(idFor(blocker), blocker);
    primary = person(idFor(shooter) || parts.find((id) => id !== blockedBy.id) || null, shooter);
  }
  if (primary && !primary.name) {
    // Name from the provider text when the box score has no entry: the leading words before the verb.
    const lead = text.match(/^(.+?)\s+(makes|misses|defensive|offensive|steal|block|lost|bad|traveling|turnover|personal|shooting|loose|technical|enters)\b/i)?.[1] || (family === 'turnover' && text && !/\s(turnover|ball)\b/i.test(text) ? text : null);
    const fromFoul = text.match(/^(?:\w+\s)?foul on (.+?)\.?$/i)?.[1];
    primary.name = clean(fromFoul || lead || '') || null;
  }

  const shooting = family === 'shot' || family === 'free_throw';
  const outcomeWord = text.match(/\b(makes|misses|made|missed)\b/i)?.[1]?.toLowerCase()
    || String(short || '').match(/\b(made|missed)\b/i)?.[1]?.toLowerCase()
    || null;
  const textOutcome = outcomeWord === 'makes' || outcomeWord === 'made'
    ? true
    : outcomeWord === 'misses' || outcomeWord === 'missed'
      ? false
      : null;
  // During live games ESPN can transiently omit or lag the scoring/shooting flags while its own event text
  // already says "makes" or "misses". Outcome text is direct provider evidence, so use it to reconcile the
  // event instead of turning a made basket into a miss until the structured flag catches up.
  const made = shooting ? (textOutcome ?? scoringFlag) : null;
  const scoring = shooting ? made === true : scoringFlag === true;
  const shotValue = family === 'shot' ? (pointsAttempted === 2 || pointsAttempted === 3 ? pointsAttempted : scoreValue === 2 || scoreValue === 3 ? scoreValue : null) : family === 'free_throw' ? 1 : null;
  const ftSeq = (typeText || text).match(/free throw\s*-?\s*(\d)\s*of\s*(\d)/i);
  const distance = text.match(/\b(\d{1,2})-foot\b/)?.[1];
  const homeScore = int(raw.homeScore);
  const awayScore = int(raw.awayScore);
  const p = {
    pbp_version: PBP_VERSION,
    source_id: str(raw.id),
    seq: int(raw.sequenceNumber),
    order,
    period: int(raw.period?.number),
    clock: str(raw.clock?.displayValue),
    family,
    subtype: family === 'shot' ? shotSubtype(typeText) : null,
    type_id: typeId,
    type_raw: typeText,
    short_raw: short,
    text_raw: str(raw.text),
    team,
    primary,
    assist,
    stolen_by: stolenBy,
    blocked_by: blockedBy,
    made,
    scoring,
    shooting,
    points: scoring ? (scoreValue ?? (family === 'free_throw' ? 1 : pointsAttempted ?? 0)) : 0,
    shot_value: shotValue,
    distance_ft: distance ? Number(distance) : null,
    free_throw: family === 'free_throw' && ftSeq ? { n: Number(ftSeq[1]), of: Number(ftSeq[2]) } : null,
    rebound: family === 'rebound' ? { kind: /offensive/i.test(typeText || text) ? 'offensive' : /defensive/i.test(typeText || text) ? 'defensive' : /dead ?ball/i.test(typeText || text) ? 'dead-ball' : null, team_rebound: parts.length === 0 } : null,
    turnover_type: family === 'turnover' ? TURNOVER_TYPE(typeText) : null,
    foul_type: family === 'foul' ? FOUL_TYPE(typeText) : null,
    home_score: homeScore,
    away_score: awayScore,
    score_before: prev ? { home: prev.home_score, away: prev.away_score } : { home: 0, away: 0 }
  };
  const d = describePlay(p, text);
  p.description = d.text;
  p.description_source = d.source;
  return p;
}

/**
 * Formatter hierarchy:
 *   1. the provider's text when it is itself a complete description (not "X makes", not "Foul on X.");
 *   2. a deterministic sentence from structured fields;
 *   3. a truthful fallback that names what is known ("scores 2 points", "misses a 2-point attempt").
 * "X makes" / "X misses" alone can never be returned.
 */
export function describePlay(p, sourceText = p.text_raw) {
  const text = clean(sourceText);
  const P = p.primary?.name || null;
  const T = p.team?.name || null;
  const who = P || T || 'Team';
  // Provider text that only says "two point shot" is less specific than its own shot type: build from structure.
  const vagueShot = p.family === 'shot' && p.subtype && /\b(two|three) point shot\b/i.test(text);
  if (text && !vagueShot && !GENERIC_SHOT_TEXT.test(text) && DESCRIPTIVE.test(text) && !/^(\w+\s)?foul on /i.test(text) && !/^[A-Z][^.]+ (Steal|Block|Offensive Rebound|Defensive Rebound|Deadball Team Rebound)\.$/.test(text) && !/ Timeout$/.test(text) && !(p.family === 'turnover' && P && text === P)) {
    return { text: sentence(text), source: 'source_text' };
  }
  const assist = p.assist?.name ? ` (${p.assist.name} assists)` : '';
  switch (p.family) {
    case 'shot': {
      if (!P) break;
      const verb = p.made ? 'makes' : 'misses';
      const block = p.blocked_by?.name ? ` — blocked by ${p.blocked_by.name}` : '';
      if (p.subtype) {
        const dist = p.distance_ft ? `${p.distance_ft}-foot ` : '';
        const shot = /layup|dunk|tip-in|finger-roll|alley-oop/.test(p.subtype) ? p.subtype : p.shot_value ? `${threeWord[p.shot_value]} ${p.subtype}` : p.subtype;
        const phrase = `${dist}${shot}`;
        const art = /^(8|11|18)\b|^[aeiou]/i.test(phrase) ? 'an' : 'a';
        return { text: `${P} ${verb} ${art} ${phrase}${assist}${block}.`, source: 'structured' };
      }
      if (p.made && p.points) return { text: `${P} scores ${p.points} ${p.points === 1 ? 'point' : 'points'}${assist}.`, source: 'fallback' };
      if (!p.made && p.shot_value) return { text: `${P} misses a ${p.shot_value}-point attempt${block}.`, source: 'fallback' };
      return { text: `${P} ${p.made ? 'makes' : 'misses'} a field-goal attempt${block}.`, source: 'fallback' };
    }
    case 'free_throw':
      if (!P) break;
      return { text: `${P} ${p.made ? 'makes' : 'misses'} ${p.free_throw ? `free throw ${p.free_throw.n} of ${p.free_throw.of}` : 'a free throw'}.`, source: 'structured' };
    case 'rebound': {
      const kind = p.rebound?.kind ? `${p.rebound.kind} ` : '';
      if (p.rebound?.team_rebound || !P) return { text: `${T || 'Team'} team ${kind}rebound.`, source: 'structured' };
      return { text: `${P} ${kind}rebound.`, source: 'structured' };
    }
    case 'turnover': {
      const detail = [p.turnover_type, p.stolen_by?.name ? `${p.stolen_by.name} steal` : null].filter(Boolean).join('; ');
      return { text: `${who} turnover${detail ? ` (${detail})` : ''}.`, source: 'structured' };
    }
    case 'steal': return { text: `${who} steal.`, source: 'structured' };
    case 'block': return { text: `${who} block.`, source: 'structured' };
    case 'foul': return { text: `${who} ${p.foul_type ? `${p.foul_type} ` : ''}foul.`, source: 'structured' };
    case 'timeout': return { text: `${T ? `${T} timeout` : 'Timeout'}.`, source: 'structured' };
    default: break;
  }
  if (text && !GENERIC_SHOT_TEXT.test(text) && !(P && text === P)) return { text: sentence(text), source: 'source_text' };
  if (p.type_raw) return { text: `${who} — ${shotSubtype(p.type_raw) || p.type_raw}.`, source: 'fallback' };
  return { text: `${who}.`, source: 'fallback' };
}

/** Canonical plays for a whole summary, in source sequence order (never reordered by clock text). */
export function semanticPlays(rawPlays, { athleteName, teamName } = {}) {
  const ordered = (rawPlays || []).map((raw, i) => ({ raw, i })).sort((a, b) => (int(a.raw.sequenceNumber) ?? a.i) - (int(b.raw.sequenceNumber) ?? b.i) || a.i - b.i);
  const out = [];
  for (const [order, { raw }] of ordered.entries()) out.push(semanticPlay(raw, { athleteName, teamName, prev: out.at(-1) || null, order }));
  return out;
}

/** Name resolvers from an ESPN summary body (box-score athletes, header competitors). Unicode is kept as published. */
export function resolversFromSummary(body) {
  const names = new Map();
  for (const t of body?.boxscore?.players || []) for (const s of t.statistics || []) for (const a of s.athletes || []) if (a.athlete?.id) names.set(String(a.athlete.id), a.athlete.displayName || null);
  const teams = new Map();
  for (const c of body?.header?.competitions?.[0]?.competitors || []) if (c.team?.id) teams.set(String(c.team.id), c.team.displayName || c.team.name || c.team.location || null);
  return { athleteName: (id) => names.get(String(id)) || null, teamName: (id) => teams.get(String(id)) || null };
}

/**
 * PBP quality audit and score consistency. `generic` counts descriptions matching "X makes/misses" alone (must be 0);
 * `score_inconsistencies` lists scoring plays whose score change does not equal their points for their team.
 */
export function pbpQuality(plays, { homeTeamId = null } = {}) {
  const scoring = plays.filter((p) => p.scoring);
  const rich = (p) => p.description_source !== 'fallback' && !GENERIC_SHOT_TEXT.test(p.description);
  const inconsistent = [];
  for (const p of scoring) {
    if (p.home_score === null || p.away_score === null || !p.score_before) continue;
    const dh = p.home_score - (p.score_before.home ?? 0);
    const da = p.away_score - (p.score_before.away ?? 0);
    const delta = dh + da;
    const sideOk = !homeTeamId || !p.team?.id ? true : (p.team.id === String(homeTeamId) ? dh === p.points && da === 0 : da === p.points && dh === 0);
    if (delta !== p.points || !sideOk) inconsistent.push({ seq: p.seq, period: p.period, clock: p.clock, points: p.points, delta_home: dh, delta_away: da });
  }
  const unresolved = plays.filter((p) => p.primary && !p.primary.name).length;
  const outOfOrder = plays.filter((p, i) => i > 0 && p.seq !== null && plays[i - 1].seq !== null && p.seq < plays[i - 1].seq).length;
  return {
    version: PBP_VERSION,
    total: plays.length,
    scoring: scoring.length,
    scoring_rich: scoring.filter(rich).length,
    scoring_rich_pct: scoring.length ? Math.round((1000 * scoring.filter(rich).length) / scoring.length) / 10 : null,
    by_source: { source_text: plays.filter((p) => p.description_source === 'source_text').length, structured: plays.filter((p) => p.description_source === 'structured').length, fallback: plays.filter((p) => p.description_source === 'fallback').length },
    generic: plays.filter((p) => GENERIC_SHOT_TEXT.test(p.description)).length,
    unresolved_identities: unresolved,
    out_of_order: outOfOrder,
    score_inconsistencies: inconsistent
  };
}

/**
 * Upgrade plays that were normalized before pbe-pbp/1.0.0 (stored archives). The normalized play kept the provider's
 * structured fields (type, short description, shooting/scoring flags, points, points attempted, participants, sequence,
 * scores), so the same semantics are rebuilt from them — nothing is re-fetched and nothing is invented.
 * `names` maps athlete id → display name (from the archived box score); `teams` maps team id → name.
 */
export function upgradeNormalizedPlays(plays, { names = new Map(), teams = new Map() } = {}) {
  if (!Array.isArray(plays) || !plays.length) return plays;
  if (plays.every((p) => p.pbp_version === PBP_VERSION)) return plays;
  const raw = plays.map((p) => ({ id: p.id ?? p.play_id, sequenceNumber: p.seq, type: { id: p.type_id ?? null, text: p.type ?? null }, text: p.text_raw ?? p.text, shortDescription: p.short ?? null, scoringPlay: p.scoring, shootingPlay: p.shooting, scoreValue: p.points, pointsAttempted: p.points_attempted, participants: (p.athlete_ids || []).map((id) => ({ athlete: { id } })), team: { id: p.team_id }, homeScore: p.home_score, awayScore: p.away_score, period: { number: p.period }, clock: { displayValue: p.clock } }));
  const sem = new Map(semanticPlays(raw, { athleteName: (id) => names.get(String(id)) || null, teamName: (id) => teams.get(String(id)) || null }).map((s) => [String(s.source_id), s]));
  return plays.map((p) => {
    const s = sem.get(String(p.id ?? p.play_id));
    if (!s) return p;
    return { ...p, pbp_version: s.pbp_version, text: s.description, text_raw: p.text_raw ?? p.text, description_source: s.description_source, family: s.family, subtype: s.subtype, shot_value: s.shot_value, free_throw: s.free_throw, assist: s.assist, stolen_by: s.stolen_by, blocked_by: s.blocked_by, rebound: s.rebound, turnover_type: s.turnover_type, foul_type: s.foul_type, score_before: s.score_before, primary: s.primary, made: s.made, scoring: s.scoring, shooting: s.shooting };
  });
}
