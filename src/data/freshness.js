// Freshness semantics (same five states as the NBA/NHL products, plus
// NOT_CONFIGURED for capabilities whose runtime binding is absent).

export const STATE = Object.freeze({
  CURRENT: 'CURRENT',
  CACHED: 'CACHED',
  STALE: 'STALE',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR',
  NOT_CONFIGURED: 'NOT_CONFIGURED'
});

export function ageMs(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

export function formatAge(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Re-classify a meta block at render time (data ages while it sits on screen). */
export function currentState(meta, now = Date.now()) {
  if (!meta) return STATE.UNAVAILABLE;
  const base = meta.freshness || STATE.UNAVAILABLE;
  if (base !== STATE.CURRENT && base !== STATE.CACHED) return base;
  if (meta.stale_after_s && meta.fetched_at) {
    const age = ageMs(meta.fetched_at, now);
    if (age !== null && age > meta.stale_after_s * 1000) return STATE.STALE;
  }
  return base;
}

export const STATE_LABEL = {
  CURRENT: 'Current',
  CACHED: 'Current (edge cache)',
  STALE: 'Stale — last good copy',
  UNAVAILABLE: 'Unavailable',
  ERROR: 'Source error',
  NOT_CONFIGURED: 'Not configured'
};
