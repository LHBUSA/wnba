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
  visualNum,
  ACCEPTED_RENDERERS,
  VISUAL_REQUIREMENTS,
  STRIP_RESULTS
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


/** Side-by-side comparison rows: model probability vs market, with signed delta. */
export function comparisonBars({ id, title, subtitle = null, caption = null, rows = [], primaryLabel = 'Model', secondaryLabel = 'Market', provenance = {}, footnote = null }) {
  const spec = {
    id, type: 'comparison_bars', title, subtitle, caption, footnote,
    primary_label: String(primaryLabel),
    secondary_label: String(secondaryLabel),
    unit: 'percent',
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      primary: num(r.primary),
      secondary: num(r.secondary),
      delta: num(r.delta),
      href: r.href ? String(r.href) : null
    })),
    provenance: { renderer: VISUAL_RENDERER, ...provenance },
    version: VISUALS_VERSION
  };
  return { ...spec, values_hash: valuesHash(spec) };
}

/** Signed driver bars for model explanation packets. */
export function impactBars({ id, title, subtitle = null, caption = null, rows = [], provenance = {}, footnote = null }) {
  const spec = {
    id, type: 'impact_bars', title, subtitle, caption, footnote,
    unit: 'impact_points',
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      value: num(r.value),
      family: r.family ? String(r.family) : null
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
  if (!ACCEPTED_RENDERERS.includes(spec.provenance?.renderer)) at('provenance.renderer is not this renderer (or an accepted earlier version)');
  if (spec.requirement !== undefined && !VISUAL_REQUIREMENTS.includes(spec.requirement)) at(`requirement ${JSON.stringify(spec.requirement)} is not optional/supporting/essential`);
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

  if (spec.type === 'comparison_bars') {
    const rows = spec.rows || [];
    if (rows.length < 2 || rows.length > 8) at(`row count ${rows.length} is outside 2–8`);
    for (const r of rows) {
      if (r.primary === null || r.secondary === null || r.delta === null) at(`row ${r.key} is missing a plotted value`);
      if (!str(r.label)) at(`row ${r.key} has no label`);
      if (r.primary !== null && (r.primary < 0 || r.primary > 100)) at(`row ${r.key} primary is outside 0–100`);
      if (r.secondary !== null && (r.secondary < 0 || r.secondary > 100)) at(`row ${r.key} secondary is outside 0–100`);
    }
    const keys = rows.map((r) => String(r.key));
    if (new Set(keys).size !== keys.length) at('duplicate comparison row keys');
  }

  if (spec.type === 'impact_bars') {
    const rows = spec.rows || [];
    if (rows.length < 2 || rows.length > 8) at(`row count ${rows.length} is outside 2–8`);
    for (const r of rows) {
      if (r.value === null) at(`row ${r.key} has no value`);
      if (!str(r.label)) at(`row ${r.key} has no label`);
      if (r.value !== null && (r.value < -25 || r.value > 25)) at(`row ${r.key} value ${r.value} is outside -25–25`);
    }
    const keys = rows.map((r) => String(r.key));
    if (new Set(keys).size !== keys.length) at('duplicate impact row keys');
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

  const inUnit = (unit, v) => { const sc = VISUAL_UNITS[unit]?.scale; return Boolean(sc) && v >= sc[0] && v <= sc[1]; };

  if (spec.type === 'grouped_bars') {
    const series = spec.series || [];
    const rows = spec.rows || [];
    if (series.length < 1 || series.length > 3) at(`series count ${series.length} is outside 1–3`);
    if (rows.length < 2 || rows.length > 12) at(`row count ${rows.length} is outside 2–12`);
    if (!VISUAL_UNITS[spec.unit]) at(`undeclared unit ${JSON.stringify(spec.unit)}`);
    for (const r of rows) {
      if (!str(r.label)) at(`row ${r.key} has no label`);
      if ((r.values || []).length !== series.length) at(`row ${r.key} has ${(r.values || []).length} values for ${series.length} series`);
      for (const v of r.values || []) {
        if (v === null) at(`row ${r.key} has a missing value (a missing value must not plot as zero)`);
        else if (!inUnit(spec.unit, v)) at(`row ${r.key} value ${v} is outside the ${spec.unit} domain`);
      }
      // A derived margin must be the arithmetic of the plotted values, never a free number.
      if (r.delta !== null && r.delta !== undefined && series.length === 2 && (r.values || []).every((v) => v !== null) && Math.abs(r.delta - (r.values[0] - r.values[1])) > 0.05) at(`row ${r.key} delta ${r.delta} is not ${r.values[0]} − ${r.values[1]}`);
    }
    const keys = rows.map((r) => String(r.key));
    if (new Set(keys).size !== keys.length) at('duplicate row keys');
  }

  if (spec.type === 'diverging_bars') {
    const rows = spec.rows || [];
    if (rows.length < 2 || rows.length > 12) at(`row count ${rows.length} is outside 2–12`);
    if (!VISUAL_UNITS[spec.unit]) at(`undeclared unit ${JSON.stringify(spec.unit)}`);
    for (const r of rows) {
      if (!str(r.label)) at(`row ${r.key} has no label`);
      if (r.value === null) at(`row ${r.key} has no value`);
      else if (!inUnit(spec.unit, r.value)) at(`row ${r.key} value ${r.value} is outside the ${spec.unit} domain`);
    }
    const keys = rows.map((r) => String(r.key));
    if (new Set(keys).size !== keys.length) at('duplicate row keys');
  }

  if (spec.type === 'game_strip') {
    const strips = spec.strips || [];
    if (strips.length < 1 || strips.length > 2) at(`strip count ${strips.length} is outside 1–2`);
    for (const s of strips) {
      const items = s.items || [];
      if (!str(s.label)) at(`strip ${s.key} has no label`);
      if (items.length < 2 || items.length > 12) at(`strip ${s.key} has ${items.length} games (2–12)`);
      for (const i of items) {
        if (!STRIP_RESULTS[i.result]) at(`strip ${s.key} game ${i.key} has an unknown result ${JSON.stringify(i.result)}`);
        if (!str(i.label)) at(`strip ${s.key} game ${i.key} has no label`);
      }
      const keys = items.map((i) => String(i.key));
      if (new Set(keys).size !== keys.length) at(`strip ${s.key} repeats a game`);
    }
  }

  if (spec.type === 'stat_compare') {
    const cols = spec.columns || [];
    const rows = spec.rows || [];
    if (cols.length < 2 || cols.length > 4) at(`column count ${cols.length} is outside 2–4`);
    if (rows.length < 2 || rows.length > 8) at(`row count ${rows.length} is outside 2–8`);
    for (const c of cols) {
      if (!str(c.label)) at(`column ${c.key} has no label`);
      if (c.sample !== null && c.sample !== undefined && !(c.sample >= 1)) at(`column ${c.key} sample ${c.sample} is not a real sample size`);
    }
    for (const r of rows) {
      if (!str(r.label)) at(`row ${r.key} has no label`);
      if (!VISUAL_UNITS[r.unit]) at(`row ${r.key} has an undeclared unit`);
      if ((r.values || []).length !== cols.length) at(`row ${r.key} has ${(r.values || []).length} values for ${cols.length} columns`);
      // A comparison needs at least two real values in a row; missing cells render as — and never as zero.
      if ((r.values || []).filter((v) => v !== null).length < 2) at(`row ${r.key} compares fewer than two values`);
      for (const v of r.values || []) if (v !== null && !inUnit(r.unit, v)) at(`row ${r.key} value ${v} is outside the ${r.unit} domain`);
    }
    const keys = rows.map((r) => String(r.key));
    if (new Set(keys).size !== keys.length) at('duplicate row keys');
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

// ------------------------------------------------------ basketball newsroom types (1.2.0)

const base = (type, { id, title, subtitle = null, caption = null, footnote = null, requirement = 'supporting', provenance = {} }) => ({
  id, type, title, subtitle, caption, footnote, requirement,
  provenance: { renderer: VISUAL_RENDERER, ...provenance },
  version: VISUALS_VERSION
});
const seal = (spec) => ({ ...spec, values_hash: valuesHash(spec) });

/** Grouped bars: rows (quarters, players, metrics) × up to three series (teams, windows). `delta` = series[0] − series[1]. */
export function groupedBars({ unit, series = [], rows = [], ...rest }) {
  return seal({
    ...base('grouped_bars', rest),
    unit, units: { value: unit, ...VISUAL_UNITS[unit] },
    series: series.map((s) => ({ key: String(s.key), label: String(s.label), short_label: String(s.short_label || s.label), entity: s.entity || null })),
    rows: rows.map((r) => ({ key: String(r.key), label: String(r.label), values: (r.values || []).map(num), delta: r.delta === undefined ? null : num(r.delta), meta: r.meta ? String(r.meta) : null, highlight: Boolean(r.highlight), href: r.href ? String(r.href) : null }))
  });
}

/** Diverging bars around zero: signed per-row values (a margin against a line, a quarter margin, a change). */
export function divergingBars({ unit = 'signed_points', rows = [], negativeLabel = null, positiveLabel = null, tone = 'signed', ...rest }) {
  return seal({
    ...base('diverging_bars', rest),
    tone,
    unit, units: { value: unit, ...VISUAL_UNITS[unit] },
    negative_label: negativeLabel, positive_label: positiveLabel,
    rows: rows.map((r) => ({ key: String(r.key), label: String(r.label), value: num(r.value), meta: r.meta ? String(r.meta) : null, result: r.result || null }))
  });
}

/** Game strip: results in order (W/L, covered/missed, over/under/push), one strip per team. */
export function gameStrip({ strips = [], ...rest }) {
  return seal({
    ...base('game_strip', rest),
    strips: strips.map((s) => ({ key: String(s.key), label: String(s.label), entity: s.entity || null, items: (s.items || []).map((i) => ({ key: String(i.key), label: String(i.label), result: String(i.result), value: i.value === undefined ? null : num(i.value), meta: i.meta ? String(i.meta) : null })) }))
  });
}

/** Stat comparison: metrics (rows) across 2–4 columns (windows, teams, with/without). Each column may declare its sample. */
export function statCompare({ columns = [], rows = [], layout = 'table', ...rest }) {
  return seal({
    ...base('stat_compare', rest),
    layout,
    columns: columns.map((c) => ({ key: String(c.key), label: String(c.label), sample: c.sample === undefined ? null : num(c.sample), sample_label: c.sample_label ? String(c.sample_label) : null, entity: c.entity || null })),
    rows: rows.map((r) => ({ key: String(r.key), label: String(r.label), unit: r.unit, values: (r.values || []).map(num), better: r.better || null }))
  });
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

