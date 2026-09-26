// WinBA deterministic-ordering RESEARCH CANDIDATE (`winba/1.0.1-research`). Not wired to any Worker,
// route, KV key or UI. Production WinBA stays `winba/1.0.0` (workers/shared/winba.js, byte-pinned) and
// keeps building in archive-index order. See docs/research/WINBA_DETERMINISTIC_ORDERING.md.
//
// The only change: games are ordered by actual tip-off (start_utc) ascending, ties by game_id ascending,
// before the unchanged winba/1.0.0 aggregation and scoring run. The frozen formula decides nothing new;
// only order-dependent outputs can differ (a traded player's team attribution = team of her latest game,
// latest_game_at, and floating-point summation order).

import { buildWinbaSnapshot, WINBA_VERSION } from './winba.js';

export const WINBA_RESEARCH_VERSION = 'winba/1.0.1-research';
export const WINBA_RESEARCH_BASE = WINBA_VERSION;

const tipMs = (doc) => { const t = Date.parse(doc?.summary?.game?.start_utc || ''); return Number.isFinite(t) ? t : Infinity; };
const gid = (doc) => String(doc?.summary?.game?.game_id ?? '');
/** Numeric game ids compare numerically; anything else falls back to string order (both stable, total). */
function cmpId(a, b) {
  const x = gid(a); const y = gid(b);
  if (/^\d+$/.test(x) && /^\d+$/.test(y) && x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Documents in deterministic tip order: start_utc ascending, then game_id ascending. Never mutates input. */
export function tipOrdered(docs = []) {
  return [...(docs || [])].filter(Boolean).sort((a, b) => (tipMs(a) - tipMs(b)) || cmpId(a, b));
}

/** The candidate board: unchanged winba/1.0.0 math over tip-ordered documents, labelled as research. */
export function buildWinbaSnapshotResearch(docs = [], { season = null, generatedAt = new Date().toISOString() } = {}) {
  const snap = buildWinbaSnapshot(tipOrdered(docs), { season, generatedAt });
  return {
    ...snap,
    version: WINBA_RESEARCH_VERSION,
    research: { base_version: WINBA_RESEARCH_BASE, ordering: 'start_utc ascending, then game_id ascending', status: 'CANDIDATE_NOT_PROMOTED' },
    rows: snap.rows.map((r) => ({ ...r, version: WINBA_RESEARCH_VERSION }))
  };
}

const IGNORED = new Set(['generated_at', 'version', 'photo']);

/**
 * Every changed field of every row between two boards, keyed by athlete_id (nested objects are
 * compared leaf by leaf: sample.games, components.win_rate …). generated_at/version/photo are ignored.
 */
export function diffBoards(production, candidate) {
  const byId = (b) => new Map((b?.rows || []).map((r) => [String(r.athlete_id), r]));
  const P = byId(production); const C = byId(candidate);
  const changes = [];
  const walk = (id, path, a, b) => {
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) if (!(path === '' && IGNORED.has(k))) walk(id, path ? `${path}.${k}` : k, a[k], b[k]);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ athlete_id: id, field: path, production: a ?? null, candidate: b ?? null });
  };
  for (const id of [...new Set([...P.keys(), ...C.keys()])].sort()) {
    if (!P.has(id) || !C.has(id)) { changes.push({ athlete_id: id, field: '(row)', production: P.has(id) ? 'present' : null, candidate: C.has(id) ? 'present' : null }); continue; }
    walk(id, '', P.get(id), C.get(id));
  }
  const byField = {};
  for (const c of changes) byField[c.field] = (byField[c.field] || 0) + 1;
  const order = (b) => (b?.rows || []).map((r) => String(r.athlete_id)).join(',');
  return {
    rows_production: P.size,
    rows_candidate: C.size,
    rows_changed: new Set(changes.map((c) => c.athlete_id)).size,
    fields_changed: changes.length,
    fields_changed_by_name: byField,
    row_order_identical: order(production) === order(candidate),
    board: {
      games_used: [production?.games_used ?? null, candidate?.games_used ?? null],
      qualified_count: [production?.qualified_count ?? null, candidate?.qualified_count ?? null],
      provisional_count: [production?.provisional_count ?? null, candidate?.provisional_count ?? null]
    },
    changes
  };
}
