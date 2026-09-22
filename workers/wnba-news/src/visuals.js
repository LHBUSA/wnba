// EDITORIAL VISUALS — the structured chart contract for PropBetEdge features.
//
// A visual is DATA, not markup. The generator emits a spec: frozen values, the
// snapshot each value came from, units, entity ids and a provenance block. The
// renderer (src/views/visuals.js) owns every pixel of markup. Nothing in the
// newsroom emits SVG, and nothing in the renderer reads live state.
//
// Three properties make a published chart trustworthy:
//
//   1. FROZEN. Every plotted number is copied from a frozen snapshot at
//      publication, with that snapshot's own hash travelling beside it. A later
//      roster move, re-ranking or ingest cannot change a published chart.
//   2. SELF-VERIFYING. `values_hash` is computed over the plotted values only.
//      The renderer recomputes it; a mismatch means the payload was edited
//      after publication and the figure refuses to draw.
//   3. HONESTLY SCALED. The axis rules below are part of validation, not of
//      taste: a score axis may not be truncated to dramatise small movement,
//      and it must contain every plotted value.
//
// Validation is FAIL-CLOSED. A feature whose central premise is a chart does
// not publish with the chart missing — `commission.js` refuses the whole
// article instead.

import {
  VISUALS_VERSION,
  VISUAL_RENDERER,
  VISUAL_TYPES,
  VISUAL_UNITS,
  valuesHash,
  isVisualNum,
  visualNum
} from '../../../src/lib/visuals.js';

export {
  VISUALS_VERSION,
  VISUAL_RENDERER,
  VISUAL_TYPES,
  VISUAL_UNITS,
  plottedValues,
  valuesHash,
  visualIntact
} from '../../../src/lib/visuals.js';

const isNum = isVisualNum;
const num = visualNum;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
// Markup in a spec field would mean the writer tried to own the rendering.
const hasMarkup = (v) => typeof v === 'string' && /[<>]/.test(v);

// ----------------------------------------------------------------- builders

/**
 * A frozen monthly trajectory: one point per period, each carrying the hash of
 * the board it was read from.
 *
 * `axis` is computed, not chosen. `paddedAxis` applies the anti-truncation rule
 * so a two-point move across a 0–100 score cannot be drawn as a cliff.
 */
export function lineSeries({ id, title, subtitle = null, caption = null, entity, unit = 'winba_score', points = [], provenance = {}, footnote = null }) {
  const series = points.map((p) => ({
    key: String(p.period || p.key),
    label: String(p.label),
    short_label: String(p.short_label || p.label),
    value: num(p.value),
    rank: p.rank ?? null,
    annotation: p.rank ? `No. ${p.rank}` : null,
    source: {
      kind: 'winba_monthly_snapshot',
      period: String(p.period || p.key),
      snapshot_at: p.snapshot_at || null,
      source_hash: p.source_hash || null,
      article_slug: p.article_slug || null
    }
  }));
  const spec = {
    id, type: 'line_series', title, subtitle, caption, footnote,
    entity, unit, units: { value: unit, ...VISUAL_UNITS[unit] },
    series,
    axis: paddedAxis(series.map((p) => p.value), unit),
    provenance: { renderer: VISUAL_RENDERER, ...provenance },
    version: VISUALS_VERSION
  };
  return { ...spec, values_hash: valuesHash(spec) };
}

/**
 * The anti-truncation rule, as arithmetic.
 *
 * A score axis gets at least MIN_SPAN units and enough padding that the plotted
 * range occupies no more than MAX_FILL of the frame. Small real movement then
 * looks small, which is the honest reading when a player has barely moved.
 */
export function paddedAxis(values, unit = 'winba_score', { minSpan = 8, maxFill = 0.5 } = {}) {
  const vals = values.filter((v) => v !== null);
  if (!vals.length) return null;
  const scale = VISUAL_UNITS[unit]?.scale || [0, 100];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = hi - lo;
  // Wide enough for both the floor and the fill ceiling, and a multiple of four
  // so the four gridlines land on whole numbers a reader can actually read.
  const need = Math.max(minSpan, range / maxFill);
  const span = Math.ceil(need / 4) * 4;
  const mid = (lo + hi) / 2;
  let min = Math.round(mid - span / 2);
  let max = min + span;
  // Never leave the unit's own domain, and never clip a value.
  if (min > Math.floor(lo)) min = Math.floor(lo);
  if (max < Math.ceil(hi)) max = Math.ceil(hi);
  if (min < scale[0]) min = scale[0];
  if (max > scale[1]) { max = scale[1]; min = Math.max(scale[0], max - span); }
  const step = (max - min) / 4;
  return { min, max, ticks: [0, 1, 2, 3, 4].map((i) => Math.round((min + i * step) * 100) / 100), scale };
}

/** Component bars from one frozen board row. Each bar declares its own unit. */
export function componentBars({ id, title, subtitle = null, caption = null, entity, rows = [], total = null, provenance = {}, footnote = null }) {
  const spec = {
    id, type: 'component_bars', title, subtitle, caption, footnote,
    entity, total: num(total),
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      value: num(r.value),
      unit: r.unit || 'percentile',
      units: { value: r.unit || 'percentile', ...VISUAL_UNITS[r.unit || 'percentile'] },
      weight: num(r.weight),
      note: r.note ? String(r.note) : null
    })),
    provenance: { renderer: VISUAL_RENDERER, ...provenance },
    version: VISUALS_VERSION
  };
  return { ...spec, values_hash: valuesHash(spec) };
}

/** A compact context strip: a few ranked entities, each linked to its profile. */
export function rankCards({ id, title, subtitle = null, caption = null, unit = 'winba_score', cards = [], provenance = {}, footnote = null }) {
  const spec = {
    id, type: 'rank_cards', title, subtitle, caption, footnote,
    unit, units: { value: unit, ...VISUAL_UNITS[unit] },
    cards: cards.map((c) => ({
      rank: c.rank ?? null,
      value: num(c.value),
      entity: { type: 'player', id: String(c.entity.id), name: String(c.entity.name), team_id: c.entity.team_id ? String(c.entity.team_id) : null, team_name: c.entity.team_name || null },
      href: `/players/${c.entity.id}`,
      team_href: c.entity.team_id ? `/teams/${c.entity.team_id}` : null,
      photo: c.photo || null,
      highlight: Boolean(c.highlight)
    })),
    provenance: { renderer: VISUAL_RENDERER, ...provenance },
    version: VISUALS_VERSION
  };
  return { ...spec, values_hash: valuesHash(spec) };
}

/**
 * An editorial résumé card: counted honours and stat lines.
 *
 * Every stat line declares its own window and its own source, because a career
 * line and a season line do not come from the same place and a reader is
 * entitled to know which is which.
 */
export function resumeCard({ id, title, subtitle = null, caption = null, entity, honours = [], lines = [], provenance = {}, footnote = null }) {
  const spec = {
    id, type: 'resume_card', title, subtitle, caption, footnote,
    entity,
    honours: honours.map((h) => ({ key: String(h.key), count: num(h.count), label: String(h.label), detail: h.detail ? String(h.detail) : null })),
    lines: lines.map((l) => ({
      key: String(l.key),
      label: String(l.label),
      window: String(l.window),
      source: String(l.source),
      stats: (l.stats || []).map((s) => ({ key: String(s.key), label: String(s.label), value: num(s.value), unit: s.unit || 'per_game' }))
    })),
    provenance: { renderer: VISUAL_RENDERER, ...provenance },
    version: VISUALS_VERSION
  };
  return { ...spec, values_hash: valuesHash(spec) };
}

// --------------------------------------------------------------- validation

/**
 * Everything wrong with one spec. Empty means publishable.
 *
 * The checks are deliberately blunt: a chart is either fully specified, fully
 * sourced and honestly scaled, or it does not run.
 */
export function visualFailures(spec, { id = spec?.id } = {}) {
  const out = [];
  const at = (m) => out.push(`visual ${id || '?'}: ${m}`);
  if (!spec || typeof spec !== 'object') return [`visual ${id || '?'}: not an object`];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(str(spec.id))) at('id must be kebab-case');
  if (!VISUAL_TYPES.includes(spec.type)) at(`unknown type ${JSON.stringify(spec.type)}`);
  if (!str(spec.title)) at('no title');
  for (const [k, v] of Object.entries(spec)) if (hasMarkup(v)) at(`field ${k} contains markup; the renderer owns markup`);
  if (spec.provenance?.renderer !== VISUAL_RENDERER) at('provenance.renderer is not this renderer');
  if (!str(spec.provenance?.source)) at('no provenance.source');
  if (!Number.isFinite(Date.parse(spec.provenance?.observed_at || ''))) at('provenance.observed_at is not a timestamp');
  if (spec.values_hash !== valuesHash(spec)) at(`values_hash ${spec.values_hash} does not match the plotted values (${valuesHash(spec)})`);

  if (spec.type === 'line_series') {
    const pts = spec.series || [];
    if (pts.length < 2) at('a trend needs at least two frozen points');
    for (const p of pts) {
      if (p.value === null) at(`point ${p.key} has no value (a missing value must not plot as zero)`);
      if (!str(p.label)) at(`point ${p.key} has no label`);
      if (!str(p.source?.source_hash)) at(`point ${p.key} has no source_hash: every plotted value must name the frozen snapshot it came from`);
      if (!Number.isFinite(Date.parse(p.source?.snapshot_at || ''))) at(`point ${p.key} has no snapshot timestamp`);
    }
    const keys = pts.map((p) => String(p.key));
    if (new Set(keys).size !== keys.length) at('duplicate periods');
    if ([...keys].sort().join() !== keys.join()) at('periods are not in chronological order');
    const a = spec.axis;
    const vals = pts.map((p) => p.value).filter((v) => v !== null);
    if (!a || !isNum(a.min) || !isNum(a.max)) at('no axis domain');
    else {
      if (vals.some((v) => v < a.min || v > a.max)) at('axis does not contain every plotted value');
      if (a.max - a.min < 8) at(`axis span ${a.max - a.min} is too tight: small movement must not be drawn as a cliff`);
      const fill = vals.length ? (Math.max(...vals) - Math.min(...vals)) / (a.max - a.min) : 0;
      if (fill > 0.5) at(`the plotted range fills ${Math.round(fill * 100)}% of the axis, which exaggerates the movement`);
      const scale = VISUAL_UNITS[spec.unit]?.scale;
      if (scale && (a.min < scale[0] || a.max > scale[1])) at('axis leaves the unit domain');
    }
    if (!VISUAL_UNITS[spec.unit]) at(`undeclared unit ${JSON.stringify(spec.unit)}`);
    if (!spec.entity?.id) at('no subject entity id');
  }

  if (spec.type === 'component_bars') {
    const rows = spec.rows || [];
    if (rows.length < 2 || rows.length > 8) at(`component count ${rows.length} is outside 2–8`);
    for (const r of rows) {
      if (r.value === null) at(`component ${r.key} has no value`);
      else {
        const scale = VISUAL_UNITS[r.unit]?.scale;
        if (!scale) at(`component ${r.key} has an undeclared unit`);
        else if (r.value < scale[0] || r.value > scale[1]) at(`component ${r.key} value ${r.value} is outside its unit domain`);
      }
      if (!str(r.label)) at(`component ${r.key} has no label`);
    }
    const keys = rows.map((r) => String(r.key));
    if (new Set(keys).size !== keys.length) at('duplicate component keys');
    if (!spec.entity?.id) at('no subject entity id');
    if (spec.total === null) at('no headline total to interpret the components against');
  }

  if (spec.type === 'rank_cards') {
    const cards = spec.cards || [];
    if (cards.length < 2 || cards.length > 5) at(`card count ${cards.length} is outside 2–5`);
    for (const c of cards) {
      if (c.value === null) at(`card ${c.entity?.id} has no value`);
      if (!c.entity?.id || !str(c.entity?.name)) at('a card is missing its entity');
      if (c.href !== `/players/${c.entity?.id}`) at(`card ${c.entity?.id} does not link to its canonical profile`);
    }
    const ids = cards.map((c) => String(c.entity?.id));
    if (new Set(ids).size !== ids.length) at('the same player appears twice');
  }

  if (spec.type === 'resume_card') {
    if (!(spec.honours || []).length && !(spec.lines || []).length) at('an empty résumé card');
    for (const h of spec.honours || []) {
      if (h.count === null || h.count < 1) at(`honour ${h.key} has no count`);
      if (!str(h.label)) at(`honour ${h.key} has no label`);
    }
    for (const l of spec.lines || []) {
      if (!str(l.window)) at(`line ${l.key} does not declare its window`);
      if (!str(l.source)) at(`line ${l.key} does not declare its source`);
      if (!(l.stats || []).length) at(`line ${l.key} has no stats`);
      for (const s of l.stats || []) if (s.value === null) at(`line ${l.key} stat ${s.key} has no value`);
    }
    if (!spec.entity?.id) at('no subject entity id');
  }
  return out;
}

/** Validate a whole payload. Duplicate ids are a failure: a section addresses a visual by id. */
export function visualsFailures(visuals) {
  if (visuals === null || visuals === undefined) return [];
  if (!Array.isArray(visuals)) return ['visuals: not an array'];
  const out = visuals.flatMap((v) => visualFailures(v));
  const ids = visuals.map((v) => String(v?.id));
  if (new Set(ids).size !== ids.length) out.push('visuals: duplicate ids');
  return out;
}

