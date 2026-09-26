// Stale build after a deploy (ported from NBA main.js, 2026-09-26).
//
// A tab opened before a deployment keeps the old index, whose hashed page chunks no longer exist on the new
// deployment (they 404). The router's dynamic import then fails and the page would show "Page failed to load".
// Recovery: reload ONCE per URL to pick up the new build. Guarded in sessionStorage, so it can never loop; if the
// reload does not help, the normal error panel shows.
//
// Only module/chunk load failures qualify (the browser's own dynamic-import / module-script errors). API errors
// (fetch/JSON failures) and missing content images never reach this path and never match these messages.

const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Expected a JavaScript-or-Wasm module script/i;

/** True only for a failed load of an application module/chunk. */
export function isStaleChunkError(e) {
  return STALE_CHUNK.test(String(e?.message || e || ''));
}

/**
 * Reload once for a stale-chunk error. Returns true when a reload was started (the caller should stop rendering),
 * false otherwise (not a chunk error, already reloaded for this URL, or storage unavailable = never risk a loop).
 */
export function reloadOnceForStaleChunk(e, { storage = globalThis.sessionStorage, loc = globalThis.location } = {}) {
  if (!isStaleChunkError(e) || !loc) return false;
  const key = `pbe-chunk-reload:${loc.pathname}${loc.search}`;
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, '1');
  } catch {
    return false;
  }
  loc.reload();
  return true;
}

/** Vite's preload failures (CSS/JS preloads of a lazy chunk) take the same once-only path. */
export function installStaleBuildRecovery(target = globalThis) {
  target?.addEventListener?.('vite:preloadError', (ev) => {
    if (reloadOnceForStaleChunk(ev?.payload || ev)) ev.preventDefault?.();
  });
}
