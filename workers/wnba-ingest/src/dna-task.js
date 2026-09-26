// wnba-ingest `dna` task — WNBA Player DNA V1 derive (docs/WNBA_PLAYER_DNA_V1.md §12).
//
// Reads (KV, WNBA_KV): archive:v1:index, game:v1:final:<id> (ALL ids, never slice(-500)),
//   winba:v1:latest (the canonical WinBA board, attached unchanged), ref:v1:athletes (franchise list).
// Writes (KV): dna:v1:player:<id> for every player, then dna:v1:index, then dna:v1:meta last
//   (meta is the commit marker the API and the skip check read), plus dna:v1:slim (a cache of the
//   box-score fields DNA needs, so a steady-state run reads only newly archived games).
// Never writes: winba:*, archive:*, game:*, ref:*, anything Supabase.
//
// Runs only when the archive signature changes (same signature rule as the winba task), and only
// after the canonical board describes that same archive state; a daily forced run re-reads every
// archived document (ignoring the cache) and rewrites everything.

import { buildPlayerDna, PLAYER_DNA_VERSION } from '../../shared/player-dna.js';
import { DNA_KV, teamsMap, dnaPlayerView, dnaIndexView, dnaMetaView, dnaCounts } from '../../shared/player-dna-views.js';

// Owner decision 2026-09-26: keep the Commissioner's Cup final (401857321). Explicit exclusions go here.
export const DNA_EXCLUDE_GAME_IDS = Object.freeze([]);
export const DNA_FORCE_HOUR_ET = 6;
export const DNA_FORCE_MINUTE = 7;
const READ_BATCH = 25;
const WRITE_BATCH = 20;
const SLIM_VERSION = 1;

const ROW_KEYS = ['athlete_id', 'name', 'position', 'team_id', 'starter', 'dnp', 'min', 'pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf'];
const TEAM_STAT_KEYS = ['fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'offensiveRebounds', 'defensiveRebounds', 'turnovers', 'totalTurnovers'];

export const archiveSignature = (ids) => `${ids.length}:${ids.at(-1) || ''}`;

const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o?.[k] !== undefined) out[k] = o[k];
  return out;
};
const teamSlim = (t) => (t ? { team_id: t.team_id, abbr: t.abbr ?? null, name: t.name ?? null, score: t.score ?? null, linescores: t.linescores || [] } : null);

/**
 * Keep only what DNA and the canonical-count check read. Play-by-play, injuries, odds and every other
 * field are dropped here, so they cannot reach the model even by accident.
 */
export function slimArchiveDoc(doc) {
  const s = doc?.summary;
  const g = s?.game;
  if (!g) return null;
  return {
    archived_at: doc.archived_at ?? null,
    checksum: doc.checksum ?? null,
    summary: {
      game: {
        game_id: g.game_id,
        season: g.season ? { year: g.season.year, type: g.season.type } : null,
        start_utc: g.start_utc,
        status: { completed: Boolean(g.status?.completed) },
        home: teamSlim(g.home),
        away: teamSlim(g.away)
      },
      box: {
        teams: (s.box?.teams || []).map((t) => ({ team_id: t.team_id, stats: pick(t.stats || {}, TEAM_STAT_KEYS) })),
        players: (s.box?.players || []).map((r) => pick(r, ROW_KEYS))
      }
    }
  };
}

/** Last completed archived tip + 1 s: deterministic, never the wall clock. */
export function currentAsOf(docs) {
  let last = -Infinity;
  for (const d of docs) {
    const g = d?.summary?.game;
    const t = Date.parse(g?.start_utc || '');
    if (g?.status?.completed && Number.isFinite(t) && t > last) last = t;
  }
  return Number.isFinite(last) ? new Date(last + 1000).toISOString() : null;
}

async function loadSlimDocs(kv, ids, { useCache }) {
  const cache = useCache ? await kv.get(DNA_KV.slim, 'json') : null;
  const docs = cache?.v === SLIM_VERSION && cache.docs ? { ...cache.docs } : {};
  const need = ids.filter((id) => !docs[id]);
  const missing = [];
  for (let i = 0; i < need.length; i += READ_BATCH) {
    const chunk = need.slice(i, i + READ_BATCH);
    const got = await Promise.all(chunk.map((id) => kv.get(`game:v1:final:${id}`, 'json')));
    got.forEach((doc, j) => {
      const slim = slimArchiveDoc(doc);
      if (slim) docs[chunk[j]] = slim;
      else missing.push(chunk[j]);
    });
  }
  // keep only indexed ids (the index is the source of truth)
  const keep = {};
  for (const id of ids) if (docs[id]) keep[id] = docs[id];
  return { docs: keep, fetched: need.length, missing, cache_hit: ids.length - need.length };
}

/**
 * @param env      { WNBA_KV }
 * @param force    re-read every archived doc and rewrite even when unchanged
 * @param results  results of earlier tasks in the same invocation (defer after a WinBA rebuild)
 * @param capturedAt ISO string for captured_at (the task is the only place a clock is read)
 */
export async function dnaTask(env, { force = false, results = null, capturedAt = new Date().toISOString() } = {}) {
  const kv = env.WNBA_KV;
  if (!kv) return { skipped: 'no_kv' };
  const ids = (await kv.get('archive:v1:index', 'json')) || [];
  if (!Array.isArray(ids) || !ids.length) return { skipped: 'no_archives' };
  const signature = archiveSignature(ids);

  const meta = await kv.get(DNA_KV.meta, 'json');
  if (!force && meta?.archive_signature === signature && meta?.version === PLAYER_DNA_VERSION) {
    return { skipped: 'unchanged_archive', as_of: meta.as_of, players: meta.counts?.players ?? null };
  }
  // One heavy archive pass per invocation: if WinBA rebuilt in this tick, derive on the next one.
  if (results?.winba?.ok && !results.winba.skipped) return { skipped: 'deferred_after_winba_rebuild', signature };

  const board = await kv.get('winba:v1:latest', 'json');
  if (!board?.rows) return { skipped: 'no_winba_board', signature };
  if (board.archive_signature !== signature) return { skipped: 'winba_board_stale', signature, board_signature: board.archive_signature ?? null };

  const ref = await kv.get('ref:v1:athletes', 'json');
  const franchiseTeamIds = (ref?.teams || []).map((t) => t?.team_id).filter(Boolean).map(String);
  if (!franchiseTeamIds.length) throw new Error('dna: franchise list missing (ref:v1:athletes.teams); refusing to derive');

  const loaded = await loadSlimDocs(kv, ids, { useCache: !force });
  if (loaded.missing.length) throw new Error(`dna: ${loaded.missing.length} archived game(s) unreadable (${loaded.missing.slice(0, 5).join(',')}); refusing a partial derive`);
  const docs = ids.map((id) => loaded.docs[id]);
  const asOf = currentAsOf(docs);
  if (!asOf) return { skipped: 'no_completed_games', signature };

  const result = buildPlayerDna(docs, { asOf, franchiseTeamIds, excludeGameIds: DNA_EXCLUDE_GAME_IDS, winbaBoard: board });
  if (!result.season) return { skipped: 'no_season', signature };
  if (result.winba?.source !== 'canonical_board') throw new Error(`dna: canonical WinBA board not attachable (${result.winba?.reason}); refusing to publish a DNA without WinBA`);

  const teams = teamsMap(ref.teams);
  const opts = { teams, capturedAt, archiveSignature: signature };
  const playerIds = Object.keys(result.players);
  for (let i = 0; i < playerIds.length; i += WRITE_BATCH) {
    await Promise.all(playerIds.slice(i, i + WRITE_BATCH).map((id) => kv.put(DNA_KV.player(id), JSON.stringify(dnaPlayerView(result, id, opts)))));
  }
  await kv.put(DNA_KV.index, JSON.stringify(dnaIndexView(result, opts)));
  const run = { trigger: force ? 'forced' : 'archive_changed', fetched_docs: loaded.fetched, cache_hit_docs: loaded.cache_hit, player_docs_written: playerIds.length };
  await kv.put(DNA_KV.meta, JSON.stringify(dnaMetaView(result, { capturedAt, archiveSignature: signature, run })));
  await kv.put(DNA_KV.slim, JSON.stringify({ v: SLIM_VERSION, signature, docs: loaded.docs }));

  return {
    season: result.season,
    as_of: result.as_of,
    signature,
    ...dnaCounts(result),
    excluded: result.provenance.excluded,
    winba_games_used: result.winba.games_used,
    ...run
  };
}
