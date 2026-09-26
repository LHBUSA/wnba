// WNBA Player DNA V1 — prepared read views (docs/WNBA_PLAYER_DNA_V1.md §8, §12).
//
// Pure: turns one buildPlayerDna() result into the three documents the wnba-ingest `dna` task
// stores and wnba-api serves verbatim (dna:v1:meta, dna:v1:index, dna:v1:player:<id>).
// Shape mirrors NBA nba-intel /v1/dna/* (schema, version, source, as_of, captured_at, partial,
// unavailable[], versions, dimension_order, scopes, movement, provenance, player, team) so one
// UI vocabulary renders both leagues. `capturedAt` is passed in; nothing here reads a clock.

import {
  PLAYER_DNA_VERSION,
  PLAYER_DNA_SOURCE,
  SCOPES,
  QUALIFICATION,
  DIMENSION_DEFINITIONS,
  LAST_N,
  MOVEMENT_WINDOW,
  LOW_POPULATION,
  LOW_POPULATION_CONFIDENCE_CAP,
  PROXY_CONFIDENCE_FACTOR,
  CONFIDENCE_LABELS,
  PLAYOFF_TRANSLATION_GATE,
  FORM_GATE,
  MATCHUP_GATE,
  VOLATILITY_GATE,
  ROLE_THRESHOLDS,
  DESCRIPTIVE_DIMENSIONS
} from './player-dna.js';
import { WINBA_VERSION } from './winba.js';

export const DNA_COMPETITION = 'WNBA';
export const DNA_KV = Object.freeze({
  meta: 'dna:v1:meta',
  index: 'dna:v1:index',
  player: (id) => `dna:v1:player:${id}`,
  slim: 'dna:v1:slim'
});
export const DNA_SCHEMAS = Object.freeze({ meta: 'wnba-dna/meta', index: 'wnba-dna/index', player: 'wnba-dna/player' });

// Owner decisions for this build (docs §13). Carried in /v1/dna/meta so the UI and canaries can read them.
export const DNA_DECISIONS = Object.freeze({
  winba_source: 'canonical_board',
  commissioners_cup_final_401857321: 'kept',
  access: 'public',
  history_seasons: 'none (2026 archive only); career DNA is never rendered'
});

export const DNA_UNAVAILABLE = Object.freeze([
  'pressure_clutch: play-by-play is archived but per-player clutch attribution is not built in V1',
  'career: the archive holds the 2026 season only; career DNA is not calculated or rendered',
  'shot location, tracking, defensive matchup and on/off data are not stored; creation, shooting profile, free-throw pressure, defensive activity and matchup adaptability are labelled proxies',
  'winba: the canonical WinBA board is attached unchanged; it currently counts the 2026 All-Star Game (ESPN 401857320), which every other DNA dimension excludes (open owner finding)',
  'injury status and Player Load are not inputs'
]);

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function dnaEnvelope(kind, body, { asOf, capturedAt, partial = false }) {
  return {
    schema: DNA_SCHEMAS[kind],
    version: PLAYER_DNA_VERSION,
    source: PLAYER_DNA_SOURCE,
    as_of: asOf,
    captured_at: capturedAt ?? null,
    partial,
    unavailable: [...DNA_UNAVAILABLE],
    ...body
  };
}

export function teamsMap(refTeams = []) {
  const out = {};
  for (const t of [...refTeams].filter((x) => x?.team_id != null).sort((a, b) => String(a.team_id).localeCompare(String(b.team_id)))) {
    out[String(t.team_id)] = { team_id: String(t.team_id), abbr: t.abbr ?? null, name: t.name ?? null, short_name: t.short_name ?? null, color: t.color ?? null, alt_color: t.alt_color ?? null };
  }
  return out;
}

const provenanceOf = (result) => ({
  ...result.provenance,
  winba: result.winba
});

/** One player's prepared document (every scope). */
export function dnaPlayerView(result, athleteId, { teams = {}, capturedAt = null, archiveSignature = null } = {}) {
  const p = result.players[String(athleteId)];
  if (!p) return null;
  const core = { scopes: p.scopes, movement: p.movement, winba: p.winba };
  return dnaEnvelope('player', {
    competition: DNA_COMPETITION,
    season: p.season,
    player: { id: p.athlete_id, espn_athlete_id: p.athlete_id, name: p.name, position: p.position, headshot: null },
    team_id: p.team_id,
    team: teams[p.team_id] ?? null,
    coverage_from: result.coverage.coverage_from,
    coverage: result.coverage,
    versions: { ...result.versions },
    dimension_order: DIMENSION_DEFINITIONS.map((d) => d.key),
    scopes: p.scopes,
    movement: p.movement,
    winba: p.winba,
    content_hash: fnv1a(JSON.stringify(core)),
    archive_signature: archiveSignature,
    provenance: provenanceOf(result)
  }, { asOf: result.as_of, capturedAt });
}

/** The league index: season-scope headline per player, sorted by canonical WinBA, then minutes, then name. */
export function dnaIndexView(result, { teams = {}, capturedAt = null, archiveSignature = null } = {}) {
  const players = Object.values(result.players).map((p) => {
    const s = p.scopes.season;
    const w = s?.calculated ? s.dimensions.winba : null;
    return {
      id: p.athlete_id,
      espn_athlete_id: p.athlete_id,
      name: p.name,
      position: p.position,
      team_id: p.team_id,
      games: s?.sample?.games ?? 0,
      minutes: s?.sample?.minutes ?? 0,
      season_calculated: !!s?.calculated,
      role: s?.calculated ? s.dimensions.role?.category ?? null : null,
      winba: w?.score ?? null,
      winba_value: w?.value ?? null,
      winba_canonical: p.winba ? { score: p.winba.score, rank: p.winba.rank, status: p.winba.status } : null,
      traits: s?.calculated ? s.traits : null,
      scopes: SCOPES.filter((k) => p.scopes[k]?.calculated)
    };
  }).sort((a, b) => (b.winba_value ?? -1) - (a.winba_value ?? -1) || b.minutes - a.minutes || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  return dnaEnvelope('index', {
    competition: DNA_COMPETITION,
    season: result.season,
    versions: { ...result.versions },
    players,
    teams,
    counts: dnaCounts(result),
    archive_signature: archiveSignature
  }, { asOf: result.as_of, capturedAt });
}

export function dnaCounts(result) {
  const ps = Object.values(result.players);
  return {
    players: ps.length,
    calculated: Object.fromEntries(SCOPES.map((k) => [k, ps.filter((p) => p.scopes[k]?.calculated).length])),
    games_used: result.provenance.games_used
  };
}

/** Methodology + run metadata (per-scope qualification and reference minutes, like NBA). */
export function dnaMetaView(result, { capturedAt = null, archiveSignature = null, run = null } = {}) {
  return dnaEnvelope('meta', {
    competition: DNA_COMPETITION,
    season: result.season,
    latest_season: result.season,
    versions: { ...result.versions },
    winba_version: WINBA_VERSION,
    coverage_from: result.coverage.coverage_from,
    coverage: result.coverage,
    scopes: [...SCOPES],
    qualification: QUALIFICATION,
    dimension_order: DIMENSION_DEFINITIONS.map((d) => d.key),
    dimensions: DIMENSION_DEFINITIONS,
    descriptive_dimensions: [...DESCRIPTIVE_DIMENSIONS],
    method: {
      percentile: 'mid-rank within the qualified players of the same scope and as_of',
      per: 36,
      last_n: [...LAST_N],
      movement: `${MOVEMENT_WINDOW} score minus season score`,
      low_population: { below: LOW_POPULATION, confidence_cap: LOW_POPULATION_CONFIDENCE_CAP },
      proxy_confidence_factor: PROXY_CONFIDENCE_FACTOR,
      confidence_labels: CONFIDENCE_LABELS,
      gates: { playoff_translation: PLAYOFF_TRANSLATION_GATE, form: FORM_GATE, matchup: MATCHUP_GATE, volatility: VOLATILITY_GATE, role: ROLE_THRESHOLDS }
    },
    decisions: DNA_DECISIONS,
    winba: result.winba,
    counts: dnaCounts(result),
    archive_signature: archiveSignature,
    lines_hash: result.provenance.lines_hash,
    run
  }, { asOf: result.as_of, capturedAt });
}
