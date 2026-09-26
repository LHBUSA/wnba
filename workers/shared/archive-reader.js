// Bounded, season-aware reads of the persisted final-game archive (KV game:v1:final:<id>).
//
// Replaces `ids.slice(-500)`, which silently dropped the oldest games once the archive passed 500.
// Readers select exactly the documents a feature needs from a small catalog of per-game metadata
// (archive:v1:catalog: season, season type, tip, completed), then read only those documents.
//
// - Catalog entries missing for indexed ids are resolved by reading those documents once (a cold
//   catalog reads everything once; after that only new ids are read). A reader with
//   `writeCatalog: true` (wnba-ingest) persists the resolved catalog; other readers only read it.
// - Fail closed: an indexed document that cannot be read (for the catalog) or a selected document
//   that cannot be read throws ArchiveReadError. Nothing is dropped silently.
// - Order: 'index' keeps archive:v1:index order (the order every published WinBA board was built in);
//   'tip' sorts by tip time then game id (independent of index order).

export const CATALOG_KEY = 'archive:v1:catalog';
export const CATALOG_VERSION = 1;
const READ_BATCH = 50;

export class ArchiveReadError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = 'ArchiveReadError';
    this.missing = missing;
  }
}

const docKey = (id) => `game:v1:final:${id}`;

/** Catalog entry for one archived document (the only fields readers select on). */
export function catalogEntry(doc) {
  const g = doc?.summary?.game;
  if (!g) return null;
  const s = Number(g.season?.year);
  return {
    s: Number.isFinite(s) ? s : null,
    t: Number.isFinite(Number(g.season?.type)) ? Number(g.season?.type) : null,
    u: g.start_utc || null,
    c: Boolean(g.status?.completed)
  };
}

/** De-duplicated archive index ids, in index order. */
export async function readIndex(kv) {
  const raw = await kv.get('archive:v1:index', 'json');
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(raw) ? raw : []) {
    const k = String(id ?? '');
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

async function readDocs(kv, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += READ_BATCH) {
    const chunk = ids.slice(i, i + READ_BATCH);
    const got = await Promise.all(chunk.map((id) => kv.get(docKey(id), 'json')));
    got.forEach((doc, j) => { if (doc?.summary?.game) out.set(chunk[j], doc); });
  }
  return out;
}

/**
 * Catalog for every indexed id. Missing entries are resolved by reading those documents; the
 * documents read here are returned too, so a reader never fetches the same key twice.
 */
export async function resolveCatalog(kv, ids, { writeCatalog = false } = {}) {
  const stored = await kv.get(CATALOG_KEY, 'json');
  const entries = stored?.v === CATALOG_VERSION && stored.entries && typeof stored.entries === 'object' ? { ...stored.entries } : {};
  const need = ids.filter((id) => !entries[id]);
  const fetched = need.length ? await readDocs(kv, need) : new Map();
  const missing = need.filter((id) => !fetched.has(id));
  if (missing.length) throw new ArchiveReadError(`archive: ${missing.length} indexed game(s) unreadable (${missing.slice(0, 5).join(',')}); refusing a partial read`, missing);
  for (const [id, doc] of fetched) entries[id] = catalogEntry(doc);
  const known = new Set(ids);
  const pruned = Object.fromEntries(Object.entries(entries).filter(([id]) => known.has(id)));
  if (writeCatalog && (need.length || Object.keys(pruned).length !== Object.keys(entries).length)) {
    await kv.put(CATALOG_KEY, JSON.stringify({ v: CATALOG_VERSION, entries: pruned }));
  }
  return { entries: pruned, fetched, resolved: need.length };
}

const tipMs = (e) => { const t = Date.parse(e?.u || ''); return Number.isFinite(t) ? t : Infinity; };

/**
 * Read exactly the archived documents a feature needs.
 * @param select   (entry, id) => boolean, over catalog entries
 * @param order    'index' | 'tip'
 * @returns { docs, ids, index_total, catalog_resolved, docs_read }
 */
export async function readArchive(kv, { select, order = 'index', writeCatalog = false, ids = null, catalog = null } = {}) {
  const index = ids || await readIndex(kv);
  const cat = catalog || await resolveCatalog(kv, index, { writeCatalog });
  let chosen = index.filter((id) => cat.entries[id] && select(cat.entries[id], id));
  if (order === 'tip') chosen = [...chosen].sort((a, b) => (tipMs(cat.entries[a]) - tipMs(cat.entries[b])) || a.localeCompare(b));
  const toRead = chosen.filter((id) => !cat.fetched.has(id));
  const read = toRead.length ? await readDocs(kv, toRead) : new Map();
  const missing = toRead.filter((id) => !read.has(id));
  if (missing.length) throw new ArchiveReadError(`archive: ${missing.length} required game(s) unreadable (${missing.slice(0, 5).join(',')}); refusing a partial read`, missing);
  const docs = chosen.map((id) => cat.fetched.get(id) || read.get(id));
  return { docs, ids: chosen, index_total: index.length, catalog_resolved: cat.resolved, docs_read: cat.fetched.size + read.size };
}

/** Latest season with a regular-season (type 2) archived game, from the catalog. */
export function latestRegularSeason(entries) {
  let best = null;
  for (const e of Object.values(entries || {})) if (e?.t === 2 && Number.isFinite(e.s) && (best === null || e.s > best)) best = e.s;
  return best;
}

/**
 * Player Load lookback: the archived finals tipped inside [now − windowDays, now], as game objects with
 * their box players, in tip order. `scanned` = index entries considered (the snapshot's
 * coverage.archives_scanned, unchanged meaning for the 2026 archive); `read` = documents fetched.
 */
export async function readWindowGames(kv, { now, windowDays }) {
  const ids = await readIndex(kv);
  if (!ids.length) return { games: [], indexTotal: 0, scanned: 0, read: 0 };
  const cutoff = now - windowDays * 86400e3;
  const inWindow = (e) => { const t = Date.parse(e?.u || ''); return Number.isFinite(t) && t >= cutoff && t <= now; };
  const { docs, docs_read: read } = await readArchive(kv, { ids, select: inWindow, order: 'tip' });
  const games = docs
    .filter((a) => a?.summary?.game && Array.isArray(a.summary?.box?.players))
    .map((a) => ({ ...a.summary.game, players: a.summary.box.players }))
    .filter((g) => Number.isFinite(Date.parse(g.start_utc)) && Date.parse(g.start_utc) >= cutoff && Date.parse(g.start_utc) <= now)
    .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  return { games, indexTotal: ids.length, scanned: ids.length, read };
}
