// The shared editorial-visual contract.
//
// A chart in a PropBetEdge feature is a frozen data payload plus a hash of the
// values it plots. The newsroom writes the payload (workers/wnba-news/src/visuals.js
// builds and validates it); the renderer (src/views/visuals.js) draws it and
// nothing else. This module is what both sides agree on, so a value cannot be
// changed on one side of the wire without the other noticing.

export const VISUALS_VERSION = 'wnba-visuals/1.0.0';
export const VISUAL_RENDERER = 'pbe-visual/1.0.0';

/** Visual types the renderer implements. An unknown type never publishes and never draws. */
export const VISUAL_TYPES = Object.freeze(['line_series', 'component_bars', 'rank_cards', 'resume_card']);

/** Declared unit spaces. A plotted number must say what it measures. */
export const VISUAL_UNITS = Object.freeze({
  winba_score: { label: 'WinBA Score', scale: [0, 100], decimals: 1 },
  percentile: { label: 'percentile', scale: [0, 100], decimals: 1 },
  percent: { label: '%', scale: [0, 100], decimals: 1 },
  per_game: { label: 'per game', scale: [0, 60], decimals: 1 },
  count: { label: 'total', scale: [0, 1000], decimals: 0 }
});

/**
 * `Number(null)` is 0 and 0 is finite, so the raw value is rejected before any
 * coercion: a missing datum must never plot, print or hash as a real zero.
 */
export const isVisualNum = (v) => {
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
};
export const visualNum = (v) => (isVisualNum(v) ? Number(v) : null);

/** The values a reader can see, canonically ordered. Titles and captions are excluded: prose may be corrected, data may not. */
export function plottedValues(spec) {
  const t = spec?.type;
  const n = visualNum;
  if (t === 'line_series') return ['line_series', (spec.series || []).map((p) => [String(p.key), n(p.value), p.rank ?? null])];
  if (t === 'component_bars') return ['component_bars', (spec.rows || []).map((r) => [String(r.key), n(r.value)])];
  if (t === 'rank_cards') return ['rank_cards', (spec.cards || []).map((c) => [String(c.entity?.id), n(c.value), c.rank ?? null])];
  if (t === 'resume_card') {
    return ['resume_card',
      (spec.honours || []).map((h) => [String(h.key), n(h.count)]),
      (spec.lines || []).map((l) => [String(l.key), (l.stats || []).map((s) => [String(s.key), n(s.value)])])];
  }
  return [String(t)];
}

/**
 * Deterministic hash over the plotted values only (FNV-1a derived, 64-bit hex).
 *
 * Synchronous on purpose: the renderer verifies it while building markup, where
 * an async digest is not available. It detects a payload edited after
 * publication. Cryptographic provenance is the per-point `source_hash` — the
 * SHA-256 of the frozen board the value was read from.
 */
export function valuesHash(spec) {
  const canon = JSON.stringify(plottedValues(spec));
  let hi = 0x811c9dc5;
  let lo = 0x811c9dc5;
  for (let i = 0; i < canon.length; i += 1) {
    const c = canon.charCodeAt(i);
    hi = Math.imul(hi ^ c, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ ((c << 5) | (c >>> 3)), 0x85ebca6b) >>> 0;
  }
  return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

/** True when every plotted value still matches its declared hash. The renderer checks this before drawing. */
export function visualIntact(spec) {
  return Boolean(spec) && typeof spec === 'object' && spec.values_hash === valuesHash(spec);
}

/** The visuals of an article, addressable by id. */
export function visualById(article, id) {
  return (article?.visuals || []).find((v) => v && v.id === id) || null;
}
