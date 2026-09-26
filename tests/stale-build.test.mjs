// Stale-build recovery (ported from NBA, 2026-09-26): a tab spanning a deployment reloads ONCE when a hashed
// application chunk is gone; never loops, never reacts to API errors or missing content images.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isStaleChunkError, reloadOnceForStaleChunk, installStaleBuildRecovery } from '../src/lib/stale-build.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const fakeLoc = (path = '/players/4433791/dna', search = '') => { const l = { pathname: path, search, reloads: 0, reload() { l.reloads++; } }; return l; };

test('only module/chunk load failures count as a stale build', () => {
  for (const msg of [
    'Failed to fetch dynamically imported module: https://wnba.propbetedge.ai/assets/player-dna-OLD.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://wnba.propbetedge.ai/assets/cast-OLD.js',
    "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/plain\"",
  ]) assert.equal(isStaleChunkError(new TypeError(msg)), true, msg);
  for (const msg of [
    'Failed to fetch',                                   // API/network error (fetch)
    'HTTP 503',                                          // API status
    'Unexpected token < in JSON at position 0',          // API returned HTML
    'Failed to load resource: the server responded with a status of 404 ()', // missing image/content
    'photo load error',
  ]) assert.equal(isStaleChunkError(new Error(msg)), false, msg);
});

test('reloads exactly once per URL; the second failure shows the normal error (no loop)', () => {
  const storage = memStorage(), loc = fakeLoc();
  const e = new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-OLD.js');
  assert.equal(reloadOnceForStaleChunk(e, { storage, loc }), true);
  assert.equal(loc.reloads, 1);
  assert.equal(reloadOnceForStaleChunk(e, { storage, loc }), false, 'already reloaded for this URL');
  assert.equal(loc.reloads, 1);
  const other = fakeLoc('/players/3149391');
  assert.equal(reloadOnceForStaleChunk(e, { storage, loc: other }), true, 'another URL gets its own single reload');
});

test('never reloads for API errors or image errors, and never when storage is unavailable (loop-proof)', () => {
  const storage = memStorage(), loc = fakeLoc();
  assert.equal(reloadOnceForStaleChunk(new Error('HTTP 500 from /v1/dna/players/1'), { storage, loc }), false);
  assert.equal(reloadOnceForStaleChunk(new Error('Failed to load resource: 404 image'), { storage, loc }), false);
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(reloadOnceForStaleChunk(new TypeError('Importing a module script failed.'), { storage: broken, loc }), false);
  assert.equal(loc.reloads, 0);
});

test('vite:preloadError takes the same once-only path and suppresses the default error', () => {
  const listeners = {};
  const target = { addEventListener: (t, fn) => { listeners[t] = fn; } };
  installStaleBuildRecovery(target);
  assert.equal(typeof listeners['vite:preloadError'], 'function');
  let prevented = 0;
  const orig = { s: globalThis.sessionStorage, l: globalThis.location };
  const storage = memStorage(), loc = fakeLoc('/today');
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: loc, configurable: true });
  try {
    listeners['vite:preloadError']({ payload: new Error('Unable to preload CSS: Failed to fetch dynamically imported module'), preventDefault() { prevented++; } });
    listeners['vite:preloadError']({ payload: new Error('Failed to fetch dynamically imported module'), preventDefault() { prevented++; } });
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { value: orig.s, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: orig.l, configurable: true });
  }
  assert.equal(loc.reloads, 1);
  assert.equal(prevented, 1);
});

test('router wiring: failed page import reloads once before showing the error panel; listener installed once', () => {
  const src = readFileSync(new URL('../src/lib/router.js', import.meta.url), 'utf8');
  assert.match(src, /mod = await route\.load\(\);\s*\} catch \(e\) \{\s*if \(reloadOnceForStaleChunk\(e\)\) return;/);
  assert.match(src, /Page failed to load/, 'the normal error panel still exists for genuine failures');
  assert.match(src, /export function createRouter\(\{ outlet, onRoute, onMounted \}\) \{\n  if \(typeof window !== 'undefined'\) installStaleBuildRecovery\(window\);/);
});
