// EDITORIAL VISUAL RENDERER — the only place a PropBetEdge chart becomes markup.
//
// Input is a frozen spec from the newsroom (workers/wnba-news/src/visuals.js).
// This module draws it and does nothing else: it never fetches, never computes a
// statistic, and never falls back to live data. Two consequences matter:
//
//   * A figure is server-rendered. It is in the first HTTP response, it needs no
//     JavaScript, and it is in the page for a crawler and for a reader whose
//     scripts never arrive.
//   * A figure verifies its own payload first. If `values_hash` does not match
//     the values present, the chart is NOT drawn — a tampered or truncated
//     payload shows a plain statement that the figure could not be verified,
//     which is the honest failure and never a wrong picture.
//
// Every figure also carries its own provenance line and a real data table, so
// the numbers in the picture can be read by a screen reader, copied, and
// checked against the snapshot they came from.

import { html } from '../lib/dom.js';
import { avatar } from '../ui/components.js';
import { visualIntact, VISUAL_UNITS } from '../lib/visuals.js';
import { fmtDateET } from '../lib/format.js';

const f1 = (v) => (v === null || v === undefined ? '' : (Math.round(Number(v) * 10) / 10).toFixed(1));
const unitSuffix = (unit) => (unit === 'percent' ? '%' : '');
const fmtVal = (v, unit) => `${f1(v)}${unitSuffix(unit)}`;

/** Provenance, shown on every figure: where the values came from and when they were true. */
function provenanceLine(spec) {
  const p = spec.provenance || {};
  const observed = p.observed_at ? fmtDateET(p.observed_at, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return html`<p class="pv-prov">
    <span>${p.source || 'PropBetEdge'}</span>
    ${observed ? html`<span>values as of ${observed}</span>` : ''}
    ${p.metric ? html`<span>metric ${p.metric}</span>` : ''}
    <span class="pv-hash" title="Hash of the values plotted in this figure">payload ${spec.values_hash}</span>
  </p>`;
}

/** The figure's own data, as a table. Not a fallback — the accessible form of the same frozen values. */
function dataTable(spec) {
  if (spec.type === 'line_series') {
    return html`<table class="pv-table">
      <caption>Frozen values plotted in this figure</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">${VISUAL_UNITS[spec.unit]?.label || 'Value'}</th><th scope="col">Rank</th><th scope="col">Snapshot</th></tr></thead>
      <tbody>${(spec.series || []).map((p) => html`<tr>
        <th scope="row">${p.label}</th>
        <td>${f1(p.value)}</td>
        <td>${p.rank === null || p.rank === undefined ? '—' : `No. ${p.rank}`}</td>
        <td><code>${p.source?.source_hash || '—'}</code></td>
      </tr>`)}</tbody>
    </table>`;
  }
  if (spec.type === 'component_bars') {
    return html`<table class="pv-table">
      <caption>Frozen component values plotted in this figure</caption>
      <thead><tr><th scope="col">Component</th><th scope="col">Value</th><th scope="col">Weight</th></tr></thead>
      <tbody>${(spec.rows || []).map((r) => html`<tr>
        <th scope="row">${r.label}</th>
        <td>${fmtVal(r.value, r.unit)}</td>
        <td>${r.weight === null ? '—' : `${r.weight}%`}</td>
      </tr>`)}</tbody>
    </table>`;
  }
  if (spec.type === 'rank_cards') {
    return html`<table class="pv-table">
      <caption>Frozen values shown in this figure</caption>
      <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">${VISUAL_UNITS[spec.unit]?.label || 'Value'}</th></tr></thead>
      <tbody>${(spec.cards || []).map((c) => html`<tr><th scope="row">No. ${c.rank}</th><td>${c.entity.name}</td><td>${f1(c.value)}</td></tr>`)}</tbody>
    </table>`;
  }
  return html`<table class="pv-table">
    <caption>Values shown in this figure</caption>
    <tbody>
      ${(spec.honours || []).map((h) => html`<tr><th scope="row">${h.label}</th><td>${h.count}</td></tr>`)}
      ${(spec.lines || []).map((l) => (l.stats || []).map((s) => html`<tr><th scope="row">${l.label} ${s.label}</th><td>${f1(s.value)}</td></tr>`))}
    </tbody>
  </table>`;
}

/** A one-sentence read-out of the whole figure, for assistive technology. */
function ariaSummary(spec) {
  if (spec.type === 'line_series') {
    return `${spec.title}. ${(spec.series || []).map((p) => `${p.label}: ${f1(p.value)}${p.rank ? `, ranked number ${p.rank}` : ''}`).join('. ')}.`;
  }
  if (spec.type === 'component_bars') {
    return `${spec.title}. ${(spec.rows || []).map((r) => `${r.label}: ${fmtVal(r.value, r.unit)}`).join('. ')}.`;
  }
  if (spec.type === 'rank_cards') {
    return `${spec.title}. ${(spec.cards || []).map((c) => `Number ${c.rank}, ${c.entity.name}, ${f1(c.value)}`).join('. ')}.`;
  }
  return `${spec.title}. ${(spec.honours || []).map((h) => `${h.count} ${h.label}`).join('. ')}.`;
}

// ------------------------------------------------------------- line series

const CHART = { w: 680, h: 420, padL: 54, padR: 30, padT: 66, padB: 62 };

/**
 * A frozen monthly trend.
 *
 * The axis comes from the spec, where it was computed under the
 * anti-truncation rule and validated. The renderer does not get to rescale it,
 * which is the point: the picture's honesty is decided before publication.
 */
function lineSeriesFigure(spec) {
  const { w, h, padL, padR, padT, padB } = CHART;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const a = spec.axis;
  const pts = (spec.series || []).filter((p) => p.value !== null);
  const n = pts.length;
  const x = (i) => (n === 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1));
  const y = (v) => padT + (1 - (v - a.min) / (a.max - a.min)) * plotH;

  // The outermost columns sit on the frame edge, so their labels are anchored
  // inwards rather than centred: a centred label on the last point runs off the
  // card, and a centred label on the first one lands on the axis ticks.
  const anchor = (i) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
  const coords = pts.map((p, i) => ({ ...p, cx: x(i), cy: y(p.value), anchor: anchor(i) }));
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx.toFixed(1)} ${c.cy.toFixed(1)}`).join(' ');
  const area = `${line} L${coords.at(-1).cx.toFixed(1)} ${(padT + plotH).toFixed(1)} L${coords[0].cx.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
  const gid = `pvg-${spec.id}`;

  return html`<svg class="pv-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${ariaSummary(spec)}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--pv-accent)" stop-opacity="0.26"/>
        <stop offset="100%" stop-color="var(--pv-accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${(a.ticks || []).map((t) => {
      const ty = y(t);
      return html`<g class="pv-grid">
        <line x1="${padL}" y1="${ty.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${ty.toFixed(1)}"/>
        <text class="pv-tick" x="${padL - 12}" y="${(ty + 7).toFixed(1)}" text-anchor="end">${Math.round(t)}</text>
      </g>`;
    })}
    <path class="pv-area" d="${area}" fill="url(#${gid})"/>
    <path class="pv-line" d="${line}"/>
    ${coords.map((c, i) => {
      // Value above the point, rank below it. The offsets are sized for the
      // larger type the stylesheet uses at phone width, so one geometry reads
      // at both widths; the anti-truncation rule keeps every point in the
      // middle band of the frame, well clear of the axis labels.
      const low = (c.cy - padT) / plotH > 0.78;
      const valueY = low ? c.cy + 44 : c.cy - 32;
      const rankY = low ? c.cy - 30 : c.cy + 50;
      const last = i === coords.length - 1;
      return html`<g class="pv-pt ${last ? 'is-last' : ''}">
        <line class="pv-stem" x1="${c.cx.toFixed(1)}" y1="${c.cy.toFixed(1)}" x2="${c.cx.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}"/>
        <circle class="pv-dot-halo" cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${last ? 13 : 0}"/>
        <circle class="pv-dot" cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${last ? 8 : 6}"/>
        <text class="pv-value" x="${c.cx.toFixed(1)}" y="${valueY.toFixed(1)}" text-anchor="${c.anchor}">${f1(c.value)}</text>
        ${c.annotation ? html`<text class="pv-rank" x="${c.cx.toFixed(1)}" y="${rankY.toFixed(1)}" text-anchor="${c.anchor}">${c.annotation}</text>` : ''}
        <text class="pv-xlabel" x="${c.cx.toFixed(1)}" y="${(padT + plotH + 34).toFixed(1)}" text-anchor="${c.anchor}">${c.short_label}</text>
      </g>`;
    })}
    <text class="pv-unit" x="${padL}" y="${padT - 28}" text-anchor="start">${VISUAL_UNITS[spec.unit]?.label || ''}</text>
  </svg>`;
}

// ----------------------------------------------------------- component bars

function componentBarsFigure(spec) {
  return html`<div class="pv-bars-wrap">
    ${spec.total === null ? '' : html`<div class="pv-total"><b>${f1(spec.total)}</b><span>${VISUAL_UNITS.winba_score.label}</span></div>`}
    <div class="pv-bars">
      ${(spec.rows || []).map((r) => {
        const scale = VISUAL_UNITS[r.unit]?.scale || [0, 100];
        const wpc = Math.max(0, Math.min(100, ((r.value - scale[0]) / (scale[1] - scale[0])) * 100));
        return html`<div class="pv-bar">
          <div class="pv-bar-head">
            <span class="pv-bar-label">${r.label}</span>
            <span class="pv-bar-value">${fmtVal(r.value, r.unit)}</span>
          </div>
          <div class="pv-track"><span class="pv-fill" style="width:${wpc.toFixed(1)}%"></span></div>
          <p class="pv-bar-note">${r.note || ''}${r.weight === null ? '' : html`<span class="pv-weight">${r.weight}% of the score</span>`}</p>
        </div>`;
      })}
    </div>
  </div>`;
}

// --------------------------------------------------------------- rank cards

function rankCardsFigure(spec) {
  return html`<ol class="pv-rankcards">
    ${(spec.cards || []).map((c) => html`<li class="pv-rankcard ${c.highlight ? 'is-subject' : ''}">
      <a href="${c.href}">
        <span class="pv-rc-rank">No. ${c.rank}</span>
        <span class="pv-rc-face">${avatar({ name: c.entity.name, photo: c.photo ? { square: c.photo.square } : null, size: 64 })}</span>
        <span class="pv-rc-name">${c.entity.name}</span>
        <span class="pv-rc-score">${f1(c.value)}</span>
      </a>
      ${c.team_href ? html`<a class="pv-rc-team" href="${c.team_href}">${c.entity.team_name || 'Team'}</a>` : html`<span class="pv-rc-team">${c.entity.team_name || ''}</span>`}
    </li>`)}
  </ol>`;
}

// -------------------------------------------------------------- resume card

function resumeCardFigure(spec) {
  return html`<div class="pv-resume">
    ${(spec.honours || []).length ? html`<ul class="pv-honours">
      ${spec.honours.map((h) => html`<li><b>${h.count}</b><span>${h.label}</span></li>`)}
    </ul>` : ''}
    ${(spec.lines || []).length ? html`<div class="pv-lines">
      ${spec.lines.map((l) => html`<div class="pv-line-row">
        <div class="pv-line-head"><b>${l.label}</b><span>${l.window}</span></div>
        <dl class="pv-line-stats">
          ${(l.stats || []).map((s) => html`<div><dt>${s.label}</dt><dd>${f1(s.value)}</dd></div>`)}
        </dl>
        <p class="pv-line-source">Source: ${l.source}</p>
      </div>`)}
    </div>` : ''}
  </div>`;
}

const FIGURE = {
  line_series: lineSeriesFigure,
  component_bars: componentBarsFigure,
  rank_cards: rankCardsFigure,
  resume_card: resumeCardFigure
};

/**
 * Render one frozen visual.
 *
 * Refuses to draw an unverifiable payload. Returns '' for an unknown type, so a
 * future visual type shipped by the newsroom before the renderer knows it
 * degrades to the article's own prose rather than to a broken figure.
 */
export function editorialVisual(spec) {
  if (!spec || !FIGURE[spec.type]) return '';
  if (!visualIntact(spec)) {
    return html`<figure class="pv-figure pv-figure--unverified" data-visual="${spec.id}">
      <figcaption><b>This figure could not be verified.</b> Its stored values no longer match the payload hash published with the article, so PropBetEdge has not drawn it. The findings in the surrounding text are unaffected: they are stated in full there.</figcaption>
    </figure>`;
  }
  const body = FIGURE[spec.type](spec);
  const headingId = `pv-h-${spec.id}`;
  return html`<figure class="pv-figure pv-figure--${spec.type}" data-visual="${spec.id}" aria-labelledby="${headingId}">
    <div class="pv-head">
      <h3 class="pv-title" id="${headingId}">${spec.title}</h3>
      ${spec.subtitle ? html`<p class="pv-sub">${spec.subtitle}</p>` : ''}
    </div>
    <div class="pv-body">${body}</div>
    <figcaption>
      ${spec.caption ? html`<p class="pv-caption">${spec.caption}</p>` : ''}
      ${spec.footnote ? html`<p class="pv-foot">${spec.footnote}</p>` : ''}
      ${provenanceLine(spec)}
      <details class="pv-data"><summary>Show the numbers in this figure</summary>${dataTable(spec)}</details>
    </figcaption>
  </figure>`;
}

/** The visual a section addresses, if the article carries it. */
export function sectionVisual(article, section) {
  if (!section?.visual) return '';
  const spec = (article?.visuals || []).find((v) => v && v.id === section.visual);
  return spec ? editorialVisual(spec) : '';
}
