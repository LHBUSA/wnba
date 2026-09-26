// Player DNA — pure render helpers for the compact module on /players/:id and the full profile at
// /players/:id/dna. Visual vocabulary mirrors NBA Player DNA (nba-propbetedge src/ui/dna-ui.js,
// 0d288b9), adapted to the WNBA contract (wnba-dna/player, docs/WNBA_PLAYER_DNA_V1.md).
//
// Contract: this module never computes a score, percentile, confidence, trait, movement or WinBA
// point. It renders what the payload (and /v1/dna/meta) says; null renders as unavailable, never 0.
// Every function returns a trusted HTML string; every interpolated value goes through esc().

import { esc } from '../lib/dom.js';
import { WINBA_WEIGHTS } from '../../workers/shared/winba.js';

/** Scopes the WNBA contract calculates, in tab order. Career and clutch are listed separately as unavailable. */
export const SCOPE_TABS = Object.freeze([['season', 'Season'], ['last5', 'Last 5'], ['last10', 'Last 10'], ['last15', 'Last 15'], ['home', 'Home'], ['away', 'Away'], ['playoffs', 'Playoffs']]);
export const UNAVAILABLE_SCOPES = Object.freeze([['career', 'Career'], ['clutch', 'Clutch']]);
export const SCOPE_LABEL = Object.freeze(Object.fromEntries([...SCOPE_TABS, ...UNAVAILABLE_SCOPES]));
export const isScope = (s) => SCOPE_TABS.some(([k]) => k === s);

/** Radar axis labels: long (wide containers) and short (phones). */
const AXIS = Object.freeze({
  scoring: ['SCORING', 'SCR'], creation: ['CREATION', 'CRE'], efficiency: ['EFFICIENCY', 'EFF'], shooting_profile: ['SHOOTING', 'SHT'], ft_pressure: ['FT PRESSURE', 'FTP'],
  playmaking: ['PLAYMAKING', 'PLY'], ball_security: ['SECURITY', 'SEC'], rebounding: ['REBOUNDING', 'REB'], defensive_activity: ['DEF ACTIVITY', 'DEF'], pressure_clutch: ['CLUTCH', 'CLT'],
  playoff_translation: ['PLAYOFF', 'PO'], role: ['ROLE', 'ROLE'], durability: ['AVAILABILITY', 'AVL'], form: ['FORM', 'FORM'], matchup_adaptability: ['ADAPTABILITY', 'ADPT'], volatility: ['VOLATILITY', 'VOL'], winba: ['WINBA', 'WinBA']
});
const ABBR = Object.freeze({ scoring: 'SCR', creation: 'CRE', efficiency: 'EFF', shooting_profile: 'SHT', ft_pressure: 'FTP', playmaking: 'PLY', ball_security: 'SEC', rebounding: 'REB', defensive_activity: 'DEF', playoff_translation: 'PO', durability: 'AVL', matchup_adaptability: 'ADPT', winba: 'WinBA' });

/** What a higher score means (docs §5). */
export const HIGHER = Object.freeze({
  scoring: 'Higher = more scoring volume.',
  creation: 'Higher = a bigger on-ball load (usage and assists).',
  efficiency: 'Higher = more points per shooting possession.',
  shooting_profile: 'Higher = more 3-point volume and better shooting percentages.',
  ft_pressure: 'Higher = more free throws and 2-point volume. Not rim pressure: no shot-location data.',
  playmaking: 'Higher = more of teammates’ baskets assisted.',
  ball_security: 'Higher = fewer turnovers per possession used.',
  rebounding: 'Higher = a larger share of available rebounds.',
  defensive_activity: 'Higher = more steals and blocks, fewer fouls. Activity only, not total defense.',
  pressure_clutch: 'Not measured.',
  playoff_translation: 'Higher = production and efficiency hold up better in the playoffs.',
  role: 'Higher = more minutes. A bigger role, not a better player.',
  durability: 'Higher = played a larger share of her team’s games (missed games for any reason count). Not a medical measure.',
  form: 'Higher = the last 10 games ran above the scope baseline. Observed, not a prediction.',
  matchup_adaptability: 'Higher = production holds up better against .500+ teams.',
  volatility: 'Higher = more game-to-game variation. Neither good nor bad.',
  winba: 'Higher = a stronger association with winning. Not causal wins added.'
});

export const DESCRIPTIVE = new Set(['role', 'volatility', 'form']);
export const OFFENSE = Object.freeze(['scoring', 'creation', 'efficiency', 'shooting_profile', 'ft_pressure', 'playmaking', 'ball_security']);
export const DEFENSE = Object.freeze(['rebounding', 'defensive_activity']);
/** Compact radar: the skill axes (descriptive and context dimensions stay in their own cards). */
export const COMPACT_AXES = Object.freeze(['scoring', 'creation', 'efficiency', 'shooting_profile', 'ft_pressure', 'playmaking', 'ball_security', 'rebounding', 'defensive_activity', 'playoff_translation', 'matchup_adaptability', 'winba']);

export const COMPONENT_LABEL = Object.freeze({
  pts_per36: 'Points per 36', pts_per_game: 'Points per game', usage_pct: 'Usage %', ast_per36: 'Assists per 36', ts_pct: 'True shooting %', efg_pct: 'Effective FG %',
  fg3a_per36: '3PA per 36', fg3_pct: '3P %', ft_pct: 'FT %', fta_per36: 'FTA per 36', ft_rate: 'FT rate (FTA/FGA)', fg2a_per36: '2PA per 36', ast_pct: 'Assist %',
  tov_pct: 'Turnover %', orb_pct: 'Offensive rebound %', drb_pct: 'Defensive rebound %', stl_per36: 'Steals per 36', blk_per36: 'Blocks per 36', pf_per36: 'Fouls per 36',
  playoff_gmsc36_delta: 'Playoff − regular Game Score/36', playoff_ts_delta: 'Playoff − regular TS%', mpg: 'Minutes per game', availability: 'Games played / team games (first to last appearance)',
  form_gmsc36_delta: 'Last 10 − scope Game Score/36', vs_winning_gmsc36_delta: 'vs .500+ teams − overall Game Score/36', gmsc_sd: 'Game Score SD'
});
/** Stored as fractions in [0, 1]: shown as percentages. */
const FRACTION_KEYS = new Set(['ts_pct', 'efg_pct', 'fg3_pct', 'ft_pct', 'availability']);
/** Stored already in percentage units (27.2 = 27.2%). */
const PERCENT_KEYS = new Set(['usage_pct', 'ast_pct', 'tov_pct', 'orb_pct', 'drb_pct']);

/** WinBA v1 components (winba:v1 board row): all on a 0–100 scale. Weights are the frozen winba/1.0.0 weights. */
const WINBA_PARTS = Object.freeze([
  ['production_percentile', 'production', 'Production', 'Box Impact per 36, percentile vs the qualification-eligible league'],
  ['win_rate', 'win_rate', 'Win rate', 'team win rate in the games she played'],
  ['winning_output_share', 'winning_output', 'Winning output', 'share of her Box Impact produced in wins'],
  ['court_share', 'court_share', 'Court share', 'minutes per game / 40']
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const n0 = (v) => (isNum(v) ? Math.round(v).toLocaleString('en-US') : '—');
const sign = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const clamp = (v) => Math.max(0, Math.min(100, v));
const dirCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n) {
  const v = Math.abs(Math.trunc(n)) % 100;
  const s = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th');
  return `${Math.trunc(n)}${s}`;
}

/** A component value exactly as stored, in its display unit (no extra precision). */
export function fmtComponent(key, v) {
  if (!isNum(v)) return '—';
  if (FRACTION_KEYS.has(key)) return `${(v * 100).toFixed(1)}%`;
  if (PERCENT_KEYS.has(key)) return `${v.toFixed(1)}%`;
  if (key === 'playoff_ts_delta') return `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`;
  if (key.endsWith('_delta')) return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (key === 'ft_rate') return String(v);
  return v.toFixed(1);
}

/** The canonical WinBA number as published (1 decimal, the same number the WinBA page shows). */
export const winbaText = (v) => (isNum(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '—');

const defOf = (meta, key) => (meta?.dimensions || []).find((d) => d.key === key) || {};
const methodOf = (meta) => meta?.method || {};

/** Dimensions of one scope, in the payload's order, as render rows. */
export function dimRows(body, scope) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated) return [];
  const order = Array.isArray(body.dimension_order) && body.dimension_order.length ? body.dimension_order : Object.keys(s.dimensions || {});
  return order.filter((k) => s.dimensions?.[k]).map((k) => ({ key: k, ...s.dimensions[k] }));
}
const dimOf = (body, scope, key) => { const d = body?.scopes?.[scope]?.dimensions?.[key]; return d ? { key, ...d } : null; };
const labelOf = (d, key) => d?.label || key;
const movementScope = (body) => body?.movement?.vs || 'last10';
export const movementLabel = (body) => SCOPE_LABEL[movementScope(body)] || movementScope(body);

/* ── chips ───────────────────────────────────────────────────────────── */

export function confChip(d) {
  if (!d?.confidence_label) return '';
  return `<span class="dna-conf dna-conf--${esc(d.confidence_label.toLowerCase())}" title="Confidence ${esc(String(d.confidence))} (sample, population and data coverage)">${esc(d.confidence_label)}</span>`;
}
export function proxyTag(d) {
  return d?.proxy ? `<span class="dna-proxy" title="${esc(d.proxy_reason || 'Proxy dimension')}">PROXY</span>` : '';
}
function statusChip(d) {
  if (!d) return '';
  const st = d.status === 'NOT_IN_SCOPE' ? 'NOT IN SCOPE' : d.status === 'INSUFFICIENT_DATA' ? 'NO DATA' : d.status;
  const cls = d.status === 'LIVE' ? 'live' : d.status === 'PROXY' ? 'proxy' : 'na';
  return `<span class="dna-st dna-st--${cls}">${esc(st || '')}</span>${DESCRIPTIVE.has(d.key) ? '<span class="dna-st dna-st--desc">DESCRIPTIVE</span>' : ''}`;
}
function naReason(d) {
  if (d?.reason === 'CLUTCH_NOT_BUILT') return 'Unavailable — per-player clutch attribution is not built in V1';
  if (d?.status === 'UNAVAILABLE') return 'Unavailable';
  if (d?.status === 'NOT_IN_SCOPE') return 'Not measured in this scope';
  if (d?.status === 'INSUFFICIENT_DATA') return d?.key === 'winba' ? 'Not on the canonical WinBA board' : 'Not enough data for this dimension';
  return '—';
}

/* ── percentile track ────────────────────────────────────────────────── */

/** Position of a 0–100 value on a 0–100 track with quartile ticks. Neutral styling for descriptive dimensions. */
export function pctTrack(v, { n = null, kind = 'pct', neutral = false, label = '' } = {}) {
  if (!isNum(v)) return '<span class="dna-track dna-track--na" aria-hidden="true"></span>';
  const what = kind === 'pct' ? `${ordinal(v)} percentile` : `score ${v} of 100`;
  const aria = `${label ? `${label}: ` : ''}${what}${n ? ` among ${n} qualified players` : ''}`;
  return `<span class="dna-track${neutral ? ' dna-track--neutral' : ''}" role="img" aria-label="${esc(aria)}"><i class="dna-track__fill" style="width:${clamp(v)}%"></i><b class="dna-track__dot" style="left:${clamp(v)}%"></b></span>`;
}

/* ── tooltip / explanation standard ──────────────────────────────────── */

/** What it is, what produced it, what higher means, proxy, sample, peers. */
export function dimTip(body, scope, key, meta = null) {
  const s = body?.scopes?.[scope];
  const d = dimOf(body, scope, key);
  const def = defOf(meta, key);
  const shown = key === 'winba' ? winbaText(d?.value ?? d?.score) : d?.score;
  const head = `<p class="dna-tip__h"><b>${esc(labelOf(d, key))}</b>${isNum(d?.score) ? ` <span class="num">${esc(shown)}</span>` : ''}</p>`;
  if (!d || !isNum(d.score)) return `<div class="dna-tip">${head}<p>${esc(naReason(d))}.</p>${def.desc ? `<p class="note">${esc(def.desc)}.</p>` : ''}</div>`;
  const comps = key === 'winba' ? '' : (d.components || []).filter((c) => isNum(c.percentile)).map((c) => `${esc(COMPONENT_LABEL[c.key] || c.key)} ${esc(fmtComponent(c.key, c.value))} (${ordinal(c.percentile)} pct.)`).join(' · ');
  return `<div class="dna-tip">${head}
    <p class="dna-tip__chips">${d.proxy ? '<span class="dna-proxy">PROXY</span> ' : ''}${d.confidence_label ? `${esc(d.confidence_label)} CONFIDENCE` : ''}</p>
    <p>${def.desc ? `${esc(def.desc)}.` : ''}${key === 'winba' ? ' The canonical WinBA board value, attached unchanged.' : ' Score = average of its component percentiles.'}</p>
    ${comps ? `<p class="note">${comps}</p>` : ''}
    <p>${esc(HIGHER[key] || '')}</p>
    ${d.proxy ? `<p class="note">Proxy: ${esc(d.proxy_reason || def.proxy_reason || '')}.</p>` : ''}
    <p class="note">${esc(SCOPE_LABEL[scope] || scope)} sample ${n0(s?.sample?.games)} games · ${n0(s?.sample?.minutes)} min · peers: ${n0(s?.population?.n)} qualified players (${s?.population?.qualification ? `≥ ${s.population.qualification.games} games and ${s.population.qualification.minutes} min` : 'same scope'}).</p></div>`;
}

/**
 * Confidence drivers: payload values plus the backend's published constants from /v1/dna/meta
 * (reference minutes, proxy factor, population floor). Nothing here recomputes confidence.
 */
export function confDetail(body, scope, key, meta = null) {
  const s = body?.scopes?.[scope];
  const d = dimOf(body, scope, key);
  if (!d || !isNum(d.confidence)) return '';
  const q = meta?.qualification?.[scope] || null;
  const def = defOf(meta, key);
  const m = methodOf(meta);
  const defined = (def.components || []).length;
  const present = (d.components || []).filter((c) => isNum(c.percentile)).length;
  const low = (s?.flags || []).includes('LOW_POPULATION');
  const floor = m.low_population?.below;
  const bits = [
    `<li>Minutes ${n0(s?.sample?.minutes)}${q?.reference_minutes ? ` of ${n0(q.reference_minutes)} reference minutes` : ''} for ${esc(SCOPE_LABEL[scope] || scope)}</li>`,
    key === 'winba' || !defined ? '' : `<li>${present} / ${defined} components measured</li>`,
    `<li>${n0(s?.population?.n)}-player peer group${low ? ` (under ${n0(floor)}: capped)` : ''}</li>`,
    `<li>Proxy penalty: ${d.proxy ? `×${isNum(m.proxy_confidence_factor) ? m.proxy_confidence_factor : '0.75'} (proxy dimension)` : 'none'}</li>`
  ].filter(Boolean).join('');
  return `<div class="dna-confd"><p><span class="dna-conf dna-conf--${esc(String(d.confidence_label).toLowerCase())}">${esc(d.confidence_label)}</span> <b class="num">${d.confidence.toFixed(2)}</b> <span class="note">confidence, driven by</span></p><ul>${bits}</ul></div>`;
}

/* ── radar (DNA fingerprint) ─────────────────────────────────────────── */

const RADAR_EXCLUDE = new Set(['role', 'volatility', 'form']);

/** Axes of a radar: scored, non-descriptive dimensions (optionally a fixed subset, in that order). */
export function radarRows(body, scope, keys = null) {
  const rows = dimRows(body, scope).filter((d) => isNum(d.score) && !RADAR_EXCLUDE.has(d.key));
  if (!keys) return rows;
  const by = new Map(rows.map((d) => [d.key, d]));
  return keys.map((k) => by.get(k)).filter(Boolean);
}

/**
 * Pure SVG radar of the scored dimensions (null dimensions are left out, never drawn at 0).
 * Proxy axes are dashed and italic. Axes are keyboard-focusable buttons.
 */
export function renderRadar(body, scope, { keys = null, mini = false, caption = true, overlay = null, overlayLabel = '', primaryLabel = '' } = {}) {
  const rows = radarRows(body, scope, keys);
  if (rows.length < 3) return '';
  const N = rows.length; const R = 128; const CX = 240; const CY = 200;
  const pt = (i, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / N; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
  const f1 = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const ring = (f) => rows.map((_, i) => f1(pt(i, R * f))).join(' ');
  const poly = rows.map((d, i) => f1(pt(i, (R * d.score) / 100))).join(' ');
  // overlay = another stored scope ({ dimensions }) drawn as a muted outline; axes it does not measure get no point
  let over = '';
  if (overlay?.dimensions) {
    const ov = rows.map((d, i) => { const v = overlay.dimensions[d.key]?.score; return isNum(v) ? pt(i, (R * v) / 100) : null; });
    over = ov.every(Boolean)
      ? `<polygon class="dna-shape dna-shape--b" points="${ov.map(f1).join(' ')}"/>`
      : ov.filter(Boolean).map(([x, y]) => `<circle class="dna-pt dna-pt--b" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`).join('');
  }
  const axes = rows.map((d, i) => { const [x, y] = pt(i, R); return `<line class="${d.proxy ? 'is-proxy' : ''}" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  const axisGroups = rows.map((d, i) => {
    const [x, y] = pt(i, R + 30);
    const [px, py] = pt(i, (R * d.score) / 100);
    const dx = x - CX;
    const anchor = Math.abs(dx) < 12 ? 'middle' : dx > 0 ? 'start' : 'end';
    const [long, short] = AXIS[d.key] || [d.key, d.key];
    const shown = d.key === 'winba' ? winbaText(d.value ?? d.score) : String(d.score);
    const aria = `${labelOf(d, d.key)} ${shown} of 100${d.proxy ? ', proxy' : ''}${d.confidence_label ? `, ${d.confidence_label.toLowerCase()} confidence` : ''}`;
    return `<g class="dna-axis${d.proxy ? ' is-proxy' : ''}" data-dim="${esc(d.key)}" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title>
      <circle class="dna-pt" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${mini ? 4 : 4.5}"/>
      <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="dna-ax dna-ax--long${d.proxy ? ' dna-ax--proxy' : ''}">${esc(long)}<tspan class="dna-ax__v" dx="5">${esc(shown)}</tspan></text>
      <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="dna-ax dna-ax--short${d.proxy ? ' dna-ax--proxy' : ''}">${esc(short)}</text></g>`;
  }).join('');
  return `<figure class="dna-radar${mini ? ' dna-radar--mini' : ''}"><svg viewBox="0 0 480 400" role="group" aria-label="DNA fingerprint: ${rows.map((d) => `${esc(labelOf(d, d.key))} ${d.key === 'winba' ? esc(winbaText(d.value ?? d.score)) : d.score}`).join(', ')}">
    <g class="dna-web">${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}"/>`).join('')}${axes}</g>
    ${over}<polygon class="dna-shape" points="${poly}"/>${axisGroups}</svg>
    ${overlay ? `<p class="dna-legend"><span class="dna-key dna-key--a"></span>${esc(primaryLabel || SCOPE_LABEL[scope] || scope)} <span class="dna-key dna-key--b"></span>${esc(overlayLabel)}</p>` : ''}
    ${caption ? '<figcaption class="note">0–100 score vs qualified WNBA players in this scope. Dashed, italic axes are proxies. Role, form and volatility are descriptive and shown separately.</figcaption>' : ''}</figure>`;
}

/* ── headline sample ─────────────────────────────────────────────────── */

/** "SEASON · 40 G · 1,241 MIN · 166 QUALIFIED PLAYERS" — the measurement base, always near the headline. */
export function sampleBadge(s, scope) {
  if (!s?.calculated) return '';
  const bits = [String(SCOPE_LABEL[scope] || scope).toUpperCase(), `${n0(s.sample?.games)} G`, `${n0(s.sample?.minutes)} MIN`, `${n0(s.population?.n)} QUALIFIED PLAYERS`];
  return `<p class="dna-base">${bits.map(esc).join(' <i>·</i> ')}${s.flags?.includes('LOW_POPULATION') ? ' <span class="dna-conf dna-conf--low">SMALL PEER GROUP</span>' : ''}</p>`;
}

export function scopeUnavailable(body, scope) {
  const s = body?.scopes?.[scope];
  if (scope === 'clutch' || s?.reason === 'CLUTCH_NOT_BUILT') return 'Clutch is not measured: play-by-play is archived, but per-player clutch attribution is not built in V1.';
  if (scope === 'career' || s?.reason === 'NO_PRIOR_SEASON_COVERAGE') return 'Career DNA is not calculated: the archive holds the 2026 season only.';
  if (!s) return 'Not available for this player.';
  if (s.reason === 'INSUFFICIENT_SAMPLE') {
    const q = s.qualification || {};
    return `Not enough sample for ${SCOPE_LABEL[scope] || scope}: ${s.sample?.games ?? 0} games / ${s.sample?.minutes ?? 0} min (needs ${q.games} games and ${q.minutes} min).`;
  }
  return 'Not available.';
}

/** Scopes this player has calculated, in tab order. */
export const calculatedScopes = (body) => SCOPE_TABS.filter(([k]) => body?.scopes?.[k]?.calculated);

/* ── traits ──────────────────────────────────────────────────────────── */

/** Areas to watch = payload traits.weakest minus anything already listed as a strength (never shown twice). */
export function watchKeys(s) {
  const strong = new Set(s?.traits?.strongest || []);
  return (s?.traits?.weakest || []).filter((k) => !strong.has(k) && isNum(s.dimensions?.[k]?.score));
}

function signalRow(s, k) {
  const d = s.dimensions?.[k];
  if (!d || !isNum(d.score)) return '';
  return `<li class="dna-sig" data-dim="${esc(k)}" tabindex="0"><span class="dna-sig__lbl">${esc(labelOf(d, k))}${d.proxy ? ' <span class="dna-proxy">PROXY</span>' : ''}</span>
    <b class="dna-sig__v num">${d.score}</b>${pctTrack(d.score, { n: s.population?.n, kind: 'score', label: labelOf(d, k) })}</li>`;
}

/** Elite traits (payload traits.strongest) and areas to watch (traits.weakest). The rule is the backend's. */
export function renderSignals(body, scope, { compact = false, watch = true } = {}) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated || !s.traits) return '';
  const strong = (s.traits.strongest || []).map((k) => signalRow(s, k)).join('');
  const weak = watch ? watchKeys(s).map((k) => signalRow(s, k)).join('') : '';
  if (!strong) return '';
  return `<div class="dna-signals${compact ? ' dna-signals--compact' : ''}">
    <div><h3 class="dna-h3">Elite traits</h3><ol class="dna-sigs">${strong}</ol></div>
    ${weak ? `<div><h3 class="dna-h3 dna-h3--watch">Areas to watch</h3><ol class="dna-sigs dna-sigs--watch">${weak}</ol></div>` : ''}
    ${compact ? '' : `<p class="note dna-sig-basis">Trait rule (backend): ${esc(s.traits.basis || '')}. Scores are 0–100 vs ${n0(s.population?.n)} qualified players.</p>`}</div>`;
}

/* ── movement (server-computed last 10 − season) ─────────────────────── */

/** Non-zero, non-descriptive movement deltas from the payload, largest |Δ| first. */
export function movementRows(body) {
  const d = body?.movement?.deltas;
  if (!d) return [];
  return Object.entries(d).filter(([k, v]) => isNum(v) && v !== 0 && !DESCRIPTIVE.has(k)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]));
}

/** Diverging chart of the payload's movement deltas. The sign is always printed. Values are never recomputed. */
export function renderMovementChart(body, { limit = 0, abbr = false, title = true } = {}) {
  const m = body?.movement;
  if (!m?.deltas) return '';
  const all = movementRows(body);
  const rows = limit ? all.slice(0, limit) : all;
  const lbl = movementLabel(body);
  const head = title ? `<div class="dna-mv__head"><h3 class="dna-h3">${esc(lbl)} vs season</h3><span class="note">DNA score change · ${esc(lbl.toLowerCase())} games minus season (stored)</span></div>` : '';
  if (!rows.length) return `<div class="dna-mv">${head}<p class="note">No movement against the season profile.</p></div>`;
  const max = Math.max(10, Math.ceil(Math.max(...rows.map(([, v]) => Math.abs(v))) / 10) * 10);
  const s = body.scopes?.season;
  const li = rows.map(([k, v]) => {
    const w = (Math.abs(v) / max) * 50;
    const full = labelOf(s?.dimensions?.[k], k);
    return `<li class="dna-mv__row" data-dim="${esc(k)}"><span class="dna-mv__lbl"${abbr ? ` title="${esc(full)}"` : ''}>${esc(abbr ? (ABBR[k] || k) : full)}</span>
      <span class="dna-mv__bar" role="img" aria-label="${esc(full)} ${v > 0 ? 'up' : 'down'} ${Math.abs(v)}"><i class="${dirCls(v)}" style="left:${v > 0 ? 50 : (50 - w).toFixed(1)}%;width:${w.toFixed(1)}%"></i></span>
      <b class="dna-mv__v num ${dirCls(v)}">${sign(v)}</b></li>`;
  }).join('');
  const more = limit && all.length > limit ? `<p class="note">${all.length - limit} more on the full profile.</p>` : '';
  return `<div class="dna-mv">${head}<ul class="dna-mv__list">${li}</ul><p class="dna-mv__axis note num"><span>−${max}</span><span>0</span><span>+${max}</span></p>${more}</div>`;
}

/* ── grouped dimensions (offense / rebounding + defensive activity) ──── */

function compCards(d, s) {
  const comps = d.components || [];
  if (!comps.length) return '';
  return `<ul class="dna-comps">${comps.map((c) => `<li class="dna-compc">
    <span class="dna-compc__lbl">${esc(COMPONENT_LABEL[c.key] || c.key)}${c.inverted ? ' <small>(lower is better; percentile inverted)</small>' : ''}</span>
    <b class="dna-compc__v num">${esc(fmtComponent(c.key, c.value))}</b>
    <span class="dna-compc__p num">${isNum(c.percentile) ? `${ordinal(c.percentile)} percentile` : 'not measured (below its gate)'}</span>
    ${pctTrack(c.percentile, { n: s?.population?.n, kind: 'pct', label: COMPONENT_LABEL[c.key] || c.key })}</li>`).join('')}</ul>`;
}

function groupRow(body, scope, key, meta) {
  const s = body.scopes[scope];
  const d = dimOf(body, scope, key);
  if (!d) return '';
  const has = isNum(d.score);
  const head = `<span class="dna-g__lbl">${esc(labelOf(d, key))}${proxyTag(d)}</span>
    ${has ? `${pctTrack(d.score, { n: s.population?.n, kind: 'score', label: labelOf(d, key) })}<b class="dna-g__v num">${d.score}</b>${confChip(d)}` : `<span class="dna-na">${esc(naReason(d))}</span>`}`;
  if (!has) return `<li class="dna-g dna-g--na" data-dim="${esc(key)}"><div class="dna-g__sum">${head}</div></li>`;
  return `<li class="dna-g" data-dim="${esc(key)}"><details data-dim="${esc(key)}"><summary class="dna-g__sum">${head}</summary>
    <div class="dna-g__detail">${dimTip(body, scope, key, meta)}${compCards(d, s)}${confDetail(body, scope, key, meta)}</div></details></li>`;
}

export function renderGroup(body, scope, keys, { title, sub = '', note = '', extra = '', meta = null } = {}) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated) return '';
  const rows = keys.map((k) => groupRow(body, scope, k, meta)).join('');
  if (!rows) return '';
  return `<section class="dna-sec"><div class="dna-sec__head"><h2 class="dna-h2">${esc(title)}</h2>${sub ? `<span class="note">${esc(sub)}</span>` : ''}</div>
    ${note ? `<p class="dna-callout">${note}</p>` : ''}<ul class="dna-gs">${rows}</ul>${extra}</section>`;
}

/** Possession / scoring profile: the box-derived rates the offense dimensions are built from. */
export function renderPossessionProfile(body, scope) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated) return '';
  const want = [['scoring', 'pts_per36'], ['creation', 'usage_pct'], ['efficiency', 'ts_pct'], ['efficiency', 'efg_pct'], ['shooting_profile', 'fg3a_per36'], ['shooting_profile', 'fg3_pct'], ['ft_pressure', 'fta_per36'], ['ft_pressure', 'ft_rate'], ['ft_pressure', 'fg2a_per36'], ['playmaking', 'ast_per36'], ['playmaking', 'ast_pct'], ['ball_security', 'tov_pct']];
  const cells = want.map(([dk, ck]) => {
    const c = (s.dimensions?.[dk]?.components || []).find((x) => x.key === ck);
    if (!c) return '';
    return `<li data-dim="${esc(dk)}"><span class="note">${esc(COMPONENT_LABEL[ck] || ck)}</span><b class="num">${esc(fmtComponent(ck, c.value))}</b><small class="num">${isNum(c.percentile) ? `${ordinal(c.percentile)} pct.` : '—'}</small></li>`;
  }).join('');
  if (!cells) return '';
  return `<div class="dna-poss"><h3 class="dna-h3">Possession &amp; scoring profile</h3><ul class="dna-poss__grid">${cells}</ul>
    <p class="note">Box-score rates only. No shot-location or tracking data: Shooting profile and Free-throw pressure stay labelled PROXY.</p></div>`;
}

/** Creator map as the player's own percentile tracks (no peer scatter: the API returns no peer rows). */
export function renderCreatorMap(body, scope) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated) return '';
  const comp = (dk, ck) => (s.dimensions?.[dk]?.components || []).find((x) => x.key === ck);
  const rows = [['usage_pct', 'creation', 'Usage %'], ['ts_pct', 'efficiency', 'True shooting %'], ['ast_pct', 'playmaking', 'Assist %'], ['tov_pct', 'ball_security', 'Turnover % (inverted)']]
    .map(([ck, dk, l]) => [l, comp(dk, ck), dk]).filter(([, c]) => c && isNum(c.percentile));
  if (rows.length < 2) return '';
  return `<div class="dna-creator"><h3 class="dna-h3">Creator map</h3><p class="note">Load vs efficiency vs care: each track is this player’s own percentile vs ${n0(s.population?.n)} qualified players. No league scatter is drawn: the API returns no peer rows.</p>
    <ul class="dna-creator__list">${rows.map(([l, c, dk]) => `<li data-dim="${esc(dk)}"><span>${esc(l)}</span>${pctTrack(c.percentile, { n: s.population?.n, label: l })}<b class="num">${ordinal(c.percentile)}</b></li>`).join('')}</ul></div>`;
}

/* ── WinBA breakdown ─────────────────────────────────────────────────── */

/** The canonical WinBA row for a player: the season dimension when DNA qualifies, else the player-level row. */
export function winbaRow(body) {
  const d = body?.scopes?.season?.calculated ? body.scopes.season.dimensions?.winba : null;
  if (d && isNum(d.score)) {
    return { value: d.value ?? d.score, rank: d.rank ?? null, status: d.winba_status || null, sample: d.sample || null, note: d.note || null, version: d.version, components: Object.fromEntries((d.components || []).map((c) => [c.key, c.value])), confidence: d, fromDimension: true };
  }
  const w = body?.winba;
  if (w && isNum(w.score)) return { value: w.score, rank: w.rank ?? null, status: w.status || null, sample: w.sample || null, note: w.note || null, version: w.version, components: w.components || {}, confidence: null, fromDimension: false };
  return null;
}

/**
 * WinBA contribution breakdown, from the stored WinBA row only: component value (0–100), published
 * weight. The stored row carries no per-component points and no raw inputs, so none are shown.
 */
export function renderWinbaBreakdown(body) {
  const w = winbaRow(body);
  if (!w) return '';
  const parts = WINBA_PARTS.filter(([k]) => isNum(w.components?.[k]));
  const rows = parts.map(([k, wk, label, note]) => `<tr data-part="${esc(k)}"><td>${esc(label)}<small class="note"> · ${esc(note)}</small></td>
    <td class="num">${esc(winbaText(w.components[k]))}</td><td class="num">${isNum(WINBA_WEIGHTS[wk]) ? `${Math.round(WINBA_WEIGHTS[wk] * 100)}%` : '—'}</td><td class="num note">not stored</td></tr>`).join('');
  const tracks = parts.map(([k, , label]) => `<li><span>${esc(label)}</span>${pctTrack(w.components[k], { kind: 'score', label })}<b class="num">${esc(winbaText(w.components[k]))}</b></li>`).join('');
  const status = w.status === 'PROVISIONAL' ? 'PROVISIONAL · unranked (below the WinBA qualification of 10 games or 250 min)' : w.rank ? `No. ${w.rank} · ${w.status || ''}` : (w.status || '');
  return `<section class="dna-sec dna-winba" data-dim="winba"><div class="dna-sec__head"><h2 class="dna-h2">WinBA</h2><span class="note">${esc(w.version || body.versions?.winba || '')} · canonical board, unchanged</span></div>
    <div class="dna-winba__top"><b class="dna-winba__score num">${esc(winbaText(w.value))}</b><span>${w.confidence ? confChip(w.confidence) : ''}<span class="note"> ${esc(status)}</span></span></div>
    ${w.sample ? `<p class="note">WinBA sample: ${n0(w.sample.games)} games (${n0(w.sample.wins)}-${n0(w.sample.losses)}) · ${n0(w.sample.minutes)} min.</p>` : ''}
    ${tracks ? `<ul class="dna-wbc">${tracks}</ul>` : ''}
    ${rows ? `<div class="tbl-scroll"><table class="tbl dna-wb__tbl"><thead><tr><th>Component</th><th class="num">Value (0–100)</th><th class="num">Weight</th><th class="num">Points</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <p class="note">Values and weights are the stored winba/1.0.0 row. The row does not store per-component points or the raw inputs (Box Impact per 36, minutes), so they are not shown here and nothing is re-weighted in the browser; the raw inputs are on the <a href="/winba-score">WinBA board</a>. Winning association, not a causal wins-added estimate.</p>
    ${w.note ? `<p class="dna-callout"><b>WINBA NOTE.</b> ${esc(w.note)}</p>` : ''}</section>`;
}

/* ── context cards: role, availability, form, volatility ─────────────── */

const comp0 = (d) => (d?.components || [])[0] || null;

export function renderContextCards(body, scope, meta = null) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated) return '';
  const g = methodOf(meta).gates || {};
  const role = dimOf(body, scope, 'role'); const dur = dimOf(body, scope, 'durability'); const form = dimOf(body, scope, 'form'); const vol = dimOf(body, scope, 'volatility');
  const cards = [];
  if (role && isNum(role.score)) {
    const mpg = comp0(role);
    const r = g.role;
    cards.push(`<article class="dna-card" data-dim="role"><h3 class="dna-h3">Role</h3><p class="dna-card__big">${esc(role.category || '—')}</p>
      <p class="num">${esc(fmtComponent('mpg', mpg?.value))} MPG${isNum(role.start_rate) ? ` · start rate ${(role.start_rate * 100).toFixed(0)}%` : ''}</p>
      ${pctTrack(role.score, { n: s.population?.n, kind: 'score', neutral: true, label: 'Role (minutes)' })}
      <p class="note">Role measures playing-time responsibility, not quality.${r ? ` Starter = starts ≥ ${Math.round(r.starter_rate * 100)}% of games; rotation ≥ ${r.rotation_mpg} MPG; bench ≥ ${r.bench_mpg} MPG.` : ''}</p></article>`);
  }
  if (dur) {
    const a = comp0(dur);
    cards.push(`<article class="dna-card" data-dim="durability"><h3 class="dna-h3">Availability</h3>${isNum(dur.score)
      ? `<p class="dna-card__big num">${esc(fmtComponent('availability', a?.value))}</p><p class="note">of her team’s games between her first and last appearance</p>${pctTrack(dur.score, { n: s.population?.n, kind: 'score', label: 'Availability' })}<p class="note">Score ${dur.score}. Game availability only — not a medical or injury assessment.</p>`
      : `<p class="note">${esc(naReason(dur))}. Measured in the season scope only.</p>`}</article>`);
  }
  if (form) {
    const f = comp0(form);
    cards.push(`<article class="dna-card" data-dim="form"><h3 class="dna-h3">Current form</h3>${isNum(form.score)
      ? `<p class="dna-card__big num ${dirCls(f?.value)}">${esc(fmtComponent('form_gmsc36_delta', f?.value))}</p><p class="note">Game Score per 36, last 10 games of the scope vs the whole scope</p>${pctTrack(form.score, { n: s.population?.n, kind: 'score', neutral: true, label: 'Form' })}<p class="note">Form is observed recent production against the baseline, not a prediction.</p>`
      : `<p class="note">${esc(naReason(form))}.${g.form ? ` Needs ${g.form.scope_games}+ games in the scope.` : ''}</p>`}</article>`);
  }
  if (vol) {
    const v = comp0(vol);
    cards.push(`<article class="dna-card" data-dim="volatility"><h3 class="dna-h3">Performance volatility</h3>${isNum(vol.score)
      ? `<p class="dna-card__big num">${esc(fmtComponent('gmsc_sd', v?.value))}<small> Game Score SD</small></p>
        <div class="dna-cont" role="img" aria-label="Volatility score ${vol.score} of 100: ${vol.score < 34 ? 'more consistent' : vol.score > 66 ? 'more volatile' : 'middle of the range'}"><span>CONSISTENT</span><span class="dna-cont__line"><b style="left:${clamp(vol.score)}%"></b></span><span>VOLATILE</span></div>
        <p class="note">Score ${vol.score}. Higher = more game-to-game variation${g.volatility ? ` (games of ${g.volatility.game_min_minutes}+ min)` : ''}. Not good or bad.</p>`
      : `<p class="note">${esc(naReason(vol))}.</p>`}</article>`);
  }
  if (!cards.length) return '';
  return `<section class="dna-sec"><div class="dna-sec__head"><h2 class="dna-h2">Role, availability, form &amp; volatility</h2><span class="note">descriptive context · ${esc(SCOPE_LABEL[scope] || scope)}</span></div><div class="dna-cards">${cards.join('')}</div></section>`;
}

/* ── playoff translation ─────────────────────────────────────────────── */

export function renderPlayoffTranslation(body, meta = null) {
  const season = body?.scopes?.season;
  const d = season?.calculated ? season.dimensions?.playoff_translation : null;
  const gate = methodOf(meta).gates?.playoff_translation;
  const po = body?.scopes?.playoffs;
  const sample = po?.sample ? `${n0(po.sample.games)} playoff games · ${n0(po.sample.minutes)} min stored` : '';
  // No playoff data -> no section (the matrix row carries the reason). Never a placeholder playoff card.
  if (!d || !isNum(d.score)) return '';
  const gms = (d.components || []).find((c) => c.key === 'playoff_gmsc36_delta');
  const ts = (d.components || []).find((c) => c.key === 'playoff_ts_delta');
  return `<section class="dna-sec" data-dim="playoff_translation"><div class="dna-sec__head"><h2 class="dna-h2">Playoff translation</h2><span class="note">archived postseason minus regular season</span></div>
    <div class="dna-po">
      <div class="dna-po__score"><span class="note">DNA score</span><b class="num">${d.score}</b>${confChip(d)}</div>
      <div class="dna-po__cell"><h3 class="dna-h3">Game Score / 36</h3><p class="dna-card__big num ${dirCls(gms?.value)}">${esc(fmtComponent('playoff_gmsc36_delta', gms?.value))}</p><p class="note">playoffs − regular season${isNum(gms?.percentile) ? ` · ${ordinal(gms.percentile)} percentile` : ''}</p></div>
      <div class="dna-po__cell"><h3 class="dna-h3">True shooting</h3><p class="dna-card__big num ${dirCls(ts?.value)}">${esc(fmtComponent('playoff_ts_delta', ts?.value))}</p><p class="note">${isNum(ts?.percentile) ? `${ordinal(ts.percentile)} percentile` : ''}</p></div>
    </div><p class="note">${esc(sample)}. Playoff samples are small: read the change, not a verdict.</p></section>`;
}

/* ── dimension matrix ────────────────────────────────────────────────── */

export function renderMatrix(body, scope, meta = null) {
  const s = body?.scopes?.[scope];
  if (!s?.calculated) return '';
  const mv = scope === 'season' ? body.movement?.deltas || {} : null;
  const mvHead = mv ? `L${String(movementScope(body)).replace(/\D/g, '')}` : '';
  const rows = dimRows(body, scope).map((d) => {
    const has = isNum(d.score);
    const shown = d.key === 'winba' ? winbaText(d.value ?? d.score) : d.score;
    const delta = mv && isNum(mv[d.key]) ? `<b class="num ${dirCls(mv[d.key])}">${sign(mv[d.key])}</b>` : '<span class="note">—</span>';
    const sum = `<span class="dna-mx__dim">${esc(labelOf(d, d.key))}</span>
      <b class="dna-mx__score num">${has ? esc(shown) : '—'}</b>
      <span class="dna-mx__pos">${has ? pctTrack(d.score, { n: s.population?.n, kind: 'score', neutral: DESCRIPTIVE.has(d.key), label: labelOf(d, d.key) }) : `<span class="dna-na">${esc(naReason(d))}</span>`}</span>
      <span class="dna-mx__conf">${has ? confChip(d) : ''}</span>
      <span class="dna-mx__st">${statusChip(d)}</span>
      <span class="dna-mx__l15">${mv ? delta : ''}</span>`;
    if (!has) return `<li class="dna-mx__row is-na" data-dim="${esc(d.key)}"><div class="dna-mx__sum">${sum}</div></li>`;
    return `<li class="dna-mx__row" data-dim="${esc(d.key)}"><details data-dim="${esc(d.key)}"><summary class="dna-mx__sum">${sum}</summary>
      <div class="dna-mx__detail">${dimTip(body, scope, d.key, meta)}${d.key === 'winba' ? '<p class="note">WinBA components are in the WinBA section.</p>' : compCards(d, s)}${confDetail(body, scope, d.key, meta)}</div></details></li>`;
  }).join('');
  return `<section class="dna-sec" id="dna-matrix"><div class="dna-sec__head"><h2 class="dna-h2">Full dimension matrix</h2><span class="note">${dimRows(body, scope).length} dimensions · tap a row for components, percentiles and confidence drivers</span></div>
    <div class="dna-mx"><div class="dna-mx__hdr" aria-hidden="true"><span>Dimension</span><span>Score</span><span>League context</span><span>Conf.</span><span>Status</span><span>${esc(mvHead)}</span></div>
    <ul class="dna-mx__list">${rows}</ul></div></section>`;
}

/* ── comparison ──────────────────────────────────────────────────────── */

export function sampleLine(s) {
  if (!s?.sample) return '';
  const x = s.sample;
  const bits = [`${x.games} games`, `${n0(x.minutes)} min`];
  if (x.first_date && x.last_date) bits.push(`${x.first_date} → ${x.last_date}`);
  if (s.population?.n) bits.push(`vs ${s.population.n} qualified players`);
  if (s.flags?.includes('LOW_POPULATION')) bits.push('small peer group: low confidence');
  return bits.join(' · ');
}

/** Scopes this player's `scope` can be compared with: calculated, never playoffs/career/clutch, never itself. */
const NEVER_COMPARE = new Set(['playoffs', 'career', 'clutch']);
export function comparableScopes(body, scope) {
  return SCOPE_TABS.map(([k]) => k).filter((k) => k !== scope && !NEVER_COMPARE.has(k) && body?.scopes?.[k]?.calculated);
}
const shownScore = (key, d) => (isNum(d?.score) ? (key === 'winba' ? winbaText(d.value ?? d.score) : String(d.score)) : null);

/**
 * Two calculated scopes of one player: radar overlay + side-by-side scores. For season vs the stored
 * movement window (last 10) the change column is the payload's own movement ("Change (stored)");
 * otherwise it is the plain difference of the two stored scores, labelled "Difference".
 */
export function renderScopeCompare(body, scopeA, scopeB) {
  const a = body?.scopes?.[scopeA]; const b = body?.scopes?.[scopeB];
  if (!a?.calculated || !b?.calculated) return `<p class="note">${esc(scopeUnavailable(body, a?.calculated ? scopeB : scopeA))}</p>`;
  const mvs = movementScope(body);
  const server = Boolean(body.movement?.deltas) && ((scopeA === mvs && scopeB === 'season') || (scopeA === 'season' && scopeB === mvs));
  const dsign = scopeA === mvs ? 1 : -1;
  const rows = dimRows(body, scopeA).filter((d) => d.key !== 'pressure_clutch').map((d) => {
    const va = d.score; const vb = b.dimensions?.[d.key]?.score;
    let diff = '—';
    if (server) { const m = body.movement.deltas[d.key]; if (isNum(m)) diff = sign(dsign * m); } else if (isNum(va) && isNum(vb) && d.key !== 'winba') diff = sign(va - vb);
    return `<tr data-dim="${esc(d.key)}"><td>${esc(labelOf(d, d.key))}${d.proxy ? ' <span class="dna-proxy">PROXY</span>' : ''}</td><td class="num">${esc(shownScore(d.key, d) ?? '—')}</td><td class="num">${esc(shownScore(d.key, b.dimensions?.[d.key]) ?? '—')}</td><td class="num">${diff}</td></tr>`;
  }).join('');
  return `<div class="dna-cmp">
    ${renderRadar(body, scopeA, { overlay: b, overlayLabel: SCOPE_LABEL[scopeB], caption: false })}
    <div class="tbl-scroll"><table class="tbl dna-cmp__tbl"><thead><tr><th>Dimension</th><th class="num">${esc(SCOPE_LABEL[scopeA])}</th><th class="num">${esc(SCOPE_LABEL[scopeB])}</th><th class="num">${server ? 'Change (stored)' : 'Difference'}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">${esc(SCOPE_LABEL[scopeA])}: ${esc(sampleLine(a))}. ${esc(SCOPE_LABEL[scopeB])}: ${esc(sampleLine(b))}. Each scope is ranked against its own qualified population, so a difference is a change in league standing, not in raw production.${server ? ` Change = ${esc(SCOPE_LABEL[scopeA])} − ${esc(SCOPE_LABEL[scopeB])}, read from the stored ${esc(movementLabel(body).toLowerCase())} − season movement (not recomputed).` : ''}</p></div>`;
}

/** Two stored player payloads, same scope: overlay radar + per-dimension rows with expandable components. No winner. */
export function renderPlayerCompare(a, b, scope) {
  const sa = a?.scopes?.[scope]; const sb = b?.scopes?.[scope];
  const na = a?.player?.name || 'Player A'; const nb = b?.player?.name || 'Player B';
  if (!sa?.calculated || !sb?.calculated) return `<p class="note">${esc(!sa?.calculated ? na : nb)}: ${esc(scopeUnavailable(!sa?.calculated ? a : b, scope))}</p>`;
  const cell = (key, x) => (isNum(x?.score) ? `<b class="num">${esc(shownScore(key, x))}</b>${x.confidence_label ? ` <small class="note">${esc(x.confidence_label)}</small>` : ''}` : '<span class="note">—</span>');
  const rows = dimRows(a, scope).filter((d) => d.key !== 'pressure_clutch').map((d) => {
    const db = sb.dimensions?.[d.key];
    const comps = d.key === 'winba' ? '' : (d.components || []).map((c) => {
      const cb = (db?.components || []).find((x) => x.key === c.key);
      return `<li><span>${esc(COMPONENT_LABEL[c.key] || c.key)}</span><span class="num">${esc(fmtComponent(c.key, c.value))}${isNum(c.percentile) ? ` <small>${ordinal(c.percentile)}</small>` : ''}</span><span class="num">${esc(fmtComponent(c.key, cb?.value))}${isNum(cb?.percentile) ? ` <small>${ordinal(cb.percentile)}</small>` : ''}</span></li>`;
    }).join('');
    const sum = `<span>${esc(labelOf(d, d.key))}${d.proxy ? ' <span class="dna-proxy">PROXY</span>' : ''}</span><span>${cell(d.key, d)}</span><span>${cell(d.key, db)}</span>`;
    return `<li class="dna-pc__row" data-dim="${esc(d.key)}">${comps ? `<details><summary>${sum}</summary><ul class="dna-pc__comps">${comps}</ul></details>` : `<div class="dna-pc__sum">${sum}</div>`}</li>`;
  }).join('');
  return `<div class="dna-pc">
    ${renderRadar(a, scope, { overlay: sb, primaryLabel: na, overlayLabel: nb, caption: false })}
    <div class="dna-pc__tbl"><div class="dna-pc__hdr"><span>Dimension</span><span>${esc(na)}</span><span>${esc(nb)}</span></div><ul>${rows}</ul></div>
    <p class="note">${esc(na)}: ${esc(sampleLine(sa))}. ${esc(nb)}: ${esc(sampleLine(sb))}. Both are ranked against the same scope population. A descriptive comparison of two stored profiles — no winner is declared.</p></div>`;
}

/** Shareable profile URL: /players/:id/dna?scope=&cmp=&vs= (defaults omitted). */
export function profileUrl(id, { scope = 'season', cmp = '', vs = '' } = {}) {
  const q = new URLSearchParams();
  if (scope && scope !== 'season') q.set('scope', scope);
  if (cmp) q.set('cmp', cmp);
  if (vs) q.set('vs', vs);
  const qs = q.toString();
  return `/players/${encodeURIComponent(id)}/dna${qs ? `?${qs}` : ''}`;
}

/* ── trust drawer ────────────────────────────────────────────────────── */

export function renderTrustDrawer(body, scope, meta = null) {
  if (!body) return '';
  const s = body.scopes?.[scope];
  const prov = body.provenance || {};
  const proxies = dimRows(body, 'season').concat(dimRows(body, scope)).filter((d, i, a) => d.proxy && a.findIndex((x) => x.key === d.key) === i)
    .map((d) => `<li><b>${esc(d.label || d.key)}</b> — ${esc(d.proxy_reason || '')}</li>`).join('');
  const quals = Object.entries(meta?.qualification || {}).map(([k, q]) => `<tr><td>${esc(SCOPE_LABEL[k] || k)}</td><td class="num">${q.games}</td><td class="num">${q.minutes}</td><td class="num">${n0(q.reference_minutes)}</td></tr>`).join('');
  const dec = meta?.decisions || {};
  const w = winbaRow(body);
  const nf = prov.excluded_games?.non_franchise || [];
  return `<details class="dna-trust" id="dna-trust"><summary><h2 class="dna-h2">How this profile is built</h2><span class="note">source · as-of · versions · decisions · limits</span></summary>
    <div class="dna-trust__body">
      <dl class="dna-dl">
        <dt>Source</dt><dd>${esc(body.source || '')}</dd>
        <dt>As of</dt><dd class="num">${esc(String(body.as_of || '').slice(0, 16).replace('T', ' '))} UTC (last completed archived tip + 1 s)</dd>
        <dt>DNA version</dt><dd class="mono">${esc(body.versions?.player_dna || '')}</dd>
        <dt>WinBA version</dt><dd class="mono">${esc(body.versions?.winba || '')}</dd>
        <dt>Coverage</dt><dd>${esc((body.coverage?.seasons || []).join(', ') || String(body.season || ''))} archive · ${n0(body.coverage?.regular_games)} regular-season and ${n0(body.coverage?.postseason_games)} postseason games. Career DNA is not calculated.</dd>
        <dt>Game filter</dt><dd>Franchise games only (${n0((prov.franchise_team_ids || []).length)} WNBA franchises)${nf.length ? `; excluded non-team fixtures: ${esc(nf.join(', '))}` : ''}. ${n0(prov.games_used)} games used.</dd>
        <dt>Population</dt><dd>${s?.calculated ? `${n0(s.population?.n)} qualified players in ${esc(SCOPE_LABEL[scope] || scope)} at this as-of` : 'Per scope: qualified players of that scope at the same as-of'}. Ties rank mid-rank.</dd>
        <dt>Snapshot</dt><dd class="mono">${esc(body.content_hash || '')}${body.archive_signature ? ` · archive ${esc(body.archive_signature)}` : ''}</dd>
      </dl>
      <h3 class="dna-h3">Decisions for this build</h3><ul class="note">
        <li>WinBA: ${esc(dec.winba_source === 'canonical_board' ? 'the canonical published WinBA board value, attached unchanged' : (dec.winba_source || 'canonical WinBA board'))}.${w?.note ? ` ${esc(w.note)}` : ''}</li>
        ${dec.commissioners_cup_final_401857321 ? `<li>Commissioner’s Cup final (401857321): ${esc(dec.commissioners_cup_final_401857321)}.</li>` : ''}
        ${dec.history_seasons ? `<li>History: ${esc(dec.history_seasons)}.</li>` : ''}
      </ul>
      <h3 class="dna-h3">Unavailable measurements</h3><ul>${(body.unavailable || []).map((u) => `<li class="note">${esc(u)}</li>`).join('')}</ul>
      ${proxies ? `<h3 class="dna-h3">Proxy dimensions</h3><ul class="note">${proxies}</ul>` : ''}
      ${quals ? `<h3 class="dna-h3">Qualification rules</h3><div class="tbl-scroll"><table class="tbl dna-qual"><thead><tr><th>Scope</th><th class="num">Games</th><th class="num">Minutes</th><th class="num">Ref. min (confidence)</th></tr></thead><tbody>${quals}</tbody></table></div>` : ''}
      <h3 class="dna-h3">Not inputs</h3><p class="note">${esc((prov.not_inputs || []).join(', ').replace(/_/g, ' '))}. Player Load and injury status never affect DNA or WinBA.</p>
    </div></details>`;
}

/* ── compact module on /players/:id ──────────────────────────────────── */

export const profileHref = (id, scope = '') => `/players/${encodeURIComponent(id)}/dna${scope && scope !== 'season' ? `?scope=${encodeURIComponent(scope)}` : ''}`;

/** Canonical WinBA line for a player whose DNA season does not qualify (PROVISIONAL is labelled). */
function winbaChip(body, link) {
  const w = winbaRow(body);
  if (!w) return '';
  return `<a class="dna-compact__winba" href="${link}" data-dim="winba"><span class="note">WinBA</span><b class="num">${esc(winbaText(w.value))}</b>${w.status === 'PROVISIONAL' ? '<span class="dna-conf dna-conf--low">PROVISIONAL</span>' : w.rank ? `<span class="note">No. ${w.rank}</span>` : ''}${w.confidence ? confChip(w.confidence) : ''}</a>`;
}

/** Compact DNA module: mini fingerprint, top traits, watch, movement, WinBA, measurement base, CTA. */
export function renderDnaCompact(body) {
  if (!body?.scopes) return '';
  const id = body.player?.id || body.player?.espn_athlete_id || '';
  const s = body.scopes.season;
  const link = profileHref(id);
  if (!s?.calculated) {
    const alt = calculatedScopes(body);
    return `<div class="dna-compact dna-compact--thin"><div class="dna-compact__head"><h2 class="dna-compact__ttl">Player DNA</h2></div>
      <p class="dna-honest">${esc(scopeUnavailable(body, 'season'))}</p>
      ${alt.length ? `<p class="note dna-alt">Calculated for this player: ${alt.map(([k, l]) => `<a class="pill" href="${profileHref(id, k)}">${esc(l)}</a>`).join(' ')}</p>` : ''}
      <div class="dna-compact__foot">${winbaChip(body, link)}<a class="btn dna-compact__cta" href="${link}">Full DNA profile →</a></div></div>`;
  }
  const weak = watchKeys(s);
  const mv = renderMovementChart(body, { limit: 5, abbr: true, title: false });
  return `<div class="dna-compact"><div class="dna-compact__head"><h2 class="dna-compact__ttl">Player DNA</h2>${sampleBadge(s, 'season')}</div>
    <div class="dna-compact__grid">
      <div class="dna-compact__radar">${renderRadar(body, 'season', { keys: COMPACT_AXES, mini: true, caption: false })}</div>
      <div class="dna-compact__sig">${renderSignals(body, 'season', { compact: true, watch: false })}</div>
      <div class="dna-compact__mv">${mv ? `<h3 class="dna-h3">${esc(movementLabel(body))} vs season</h3>${mv}` : ''}</div>
    </div>
    <div class="dna-compact__foot">
      ${winbaChip(body, link)}
      ${weak.length ? `<p class="dna-compact__watch"><b>Watch</b> ${weak.map((k) => `<span data-dim="${esc(k)}">${esc(labelOf(s.dimensions[k], k))} <b class="num">${s.dimensions[k].score}</b>${s.dimensions[k].proxy ? ' <span class="dna-proxy">PROXY</span>' : ''}</span>`).join(' · ')}</p>` : ''}
      <a class="btn dna-compact__cta" href="${link}">Full DNA profile →</a>
    </div>
    <p class="note dna-compact__src">0–100 scores vs qualified WNBA players (season). Dashed axes are proxies. <span class="mono">${esc(body.versions?.player_dna || '')}</span> · as of ${esc(String(body.as_of || '').slice(0, 10))}</p></div>`;
}

/* ── interaction (the only DOM code here) ─────────────────────────────── */

/** Hover/focus on anything with data-dim highlights that dimension everywhere; a radar axis opens its row. */
export function bindDnaInteractions(root) {
  if (!root?.addEventListener) return () => {};
  let cur = '';
  const q = (k) => `[data-dim="${String(k).replace(/[^a-z_]/g, '')}"]`;
  const set = (key) => {
    if (key === cur) return;
    cur = key;
    root.querySelectorAll('.is-hl').forEach((el) => el.classList.remove('is-hl'));
    if (key) root.querySelectorAll(q(key)).forEach((el) => el.classList.add('is-hl'));
  };
  const over = (e) => { const el = e.target.closest?.('[data-dim]'); set(el && root.contains(el) ? el.dataset.dim : ''); };
  const leave = () => set('');
  const open = (e) => {
    const ax = e.target.closest?.('.dna-axis');
    if (!ax || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.type === 'keydown') e.preventDefault();
    const det = root.querySelector(`details${q(ax.dataset.dim)}`);
    if (det) { det.open = true; det.scrollIntoView({ block: 'center', behavior: 'auto' }); det.querySelector('summary')?.focus({ preventScroll: true }); }
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('focusin', over);
  root.addEventListener('pointerleave', leave);
  root.addEventListener('click', open);
  root.addEventListener('keydown', open);
  return () => { root.removeEventListener('pointerover', over); root.removeEventListener('focusin', over); root.removeEventListener('pointerleave', leave); root.removeEventListener('click', open); root.removeEventListener('keydown', open); };
}
