// Change-only writes for the whole-store newsroom blobs (news:v1:items, intl-items, clusters, events, http,
// source-health). Each pass reads every blob, rebuilds it and used to rewrite all six on every five-minute tick
// whether or not anything changed. A blob is now rewritten only when its serialized value differs from the exact
// text this pass read (string equality on the full value, no timestamp heuristics). None of these keys carries a
// TTL, so a skipped write can never let a key expire. Forced reconcile: `force` rewrites every blob (manual /run
// passes, and the first tick of every UTC hour).

export const BLOB_KEYS = Object.freeze(['news:v1:intl-items', 'news:v1:items', 'news:v1:clusters', 'news:v1:events', 'news:v1:http', 'news:v1:source-health']);

/** Read a blob as text, remember the exact stored text, return the parsed value (null when absent). */
export async function readBlob(kv, key, seen) {
  const text = await kv.get(key);
  seen.set(key, text ?? null);
  return text === null || text === undefined ? null : JSON.parse(text);
}

/** Full-write cadence: manual passes always, cron passes on the first tick of each UTC hour. */
export function blobForceDue(trigger, now, cronMinutes = 5) {
  if (trigger !== 'cron') return true;
  return new Date(now).getUTCMinutes() < cronMinutes;
}

/**
 * entries: [[key, value], ...]. Returns { written: [...keys], unchanged: [...keys] }.
 * The stored value for a written key is exactly JSON.stringify(value), as before.
 */
export async function putBlobsIfChanged(kv, entries, seen, { force = false } = {}) {
  const written = [];
  const unchanged = [];
  await Promise.all(entries.map(async ([key, value]) => {
    const text = JSON.stringify(value);
    if (!force && seen.has(key) && seen.get(key) === text) { unchanged.push(key); return; }
    await kv.put(key, text);
    written.push(key);
  }));
  return { written: written.sort(), unchanged: unchanged.sort() };
}
