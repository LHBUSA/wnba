// Player DNA views: the full profile (/players/:id/dna) and the DNA row on the player page.
// Pure string renders over the stored wnba-dna/player document; nothing is computed here.

import { esc, raw } from '../lib/dom.js';
import { num, initials, fmtDateTimeET } from '../lib/format.js';
import { photoImg } from '../ui/photo.js';
import { careerSeasonRows } from '../lib/player-career.js';
import {
  SCOPE_TABS, UNAVAILABLE_SCOPES, SCOPE_LABEL, OFFENSE, DEFENSE, renderRadar, sampleBadge, scopeUnavailable, renderSignals, renderMovementChart,
  renderGroup, renderPossessionProfile, renderCreatorMap, renderWinbaBreakdown, renderContextCards, renderPlayoffTranslation, renderMatrix,
  renderTrustDrawer, renderDnaCompact, calculatedScopes, movementLabel, winbaRow, winbaText, profileHref, bindDnaInteractions,
  comparableScopes, renderScopeCompare, renderPlayerCompare, profileUrl, isScope
} from '../ui/dna.js';

/** Exact wording required on every Player Load surface that sits beside DNA. */
export const LOAD_DISCLAIMER = 'Player Load is schedule/workload pressure, not a medical assessment and does not affect the DNA or WinBA score.';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A /v1/dna/players/:id response the UI may render. Anything else (404, 503, network, old API) is inert. */
export function dnaUsable(res) {
  return Boolean(res?.ok && res.data && res.data.schema === 'wnba-dna/player' && res.data.state !== 'UNAVAILABLE' && res.data.scopes);
}

/* ── player page: workload card + DNA row ────────────────────────────── */

const LOAD_METRICS = [
  ['last_game_minutes', 'Last game', ' min'],
  ['avg_minutes_last3', 'Avg last 3', ' min'],
  ['minutes_7d', '7-day minutes', ' min'],
  ['games_5d', 'Games in 5 days', ''],
  ['games_7d', 'Games in 7 days', ''],
  ['turnaround_hours', 'Turnaround', ' h'],
  ['overtime_games_7d', 'OT games, 7 days', '']
];

/** Workload context from the stored Player Load record. Only fields present in the payload are shown. */
export function renderWorkloadCard(loadRes) {
  const d = loadRes?.ok ? loadRes.data : null;
  const p = d?.player;
  if (!p || !isNum(p.score)) return '';
  const m = p.metrics || {};
  const cells = LOAD_METRICS.filter(([k]) => isNum(m[k])).map(([k, l, u]) => `<div><span>${esc(l)}</span><b class="num">${esc(String(m[k]))}${esc(u)}</b></div>`).join('');
  return `<section class="wl-card" aria-labelledby="wl-title">
    <div class="wl-head"><div><span class="eyebrow">WNBA Pro · Player Load</span><h2 class="wl-ttl" id="wl-title">Workload context</h2></div>
      <div class="wl-score"><b class="num">${esc(String(p.score))}</b>${p.band ? `<span class="pl-band pl-${esc(String(p.band).toLowerCase())}">${esc(p.band)}</span>` : ''}</div></div>
    ${cells ? `<div class="wl-metrics">${cells}</div>` : ''}
    ${(p.signals || []).length ? `<ul class="wl-signals">${p.signals.slice(0, 4).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${p.next_game_utc ? `<p class="note">Next tip ${esc(fmtDateTimeET(p.next_game_utc))}</p>` : ''}
    <p class="wl-disclaimer">${esc(LOAD_DISCLAIMER)}</p>
    <p class="note">${d.generated_at ? `Snapshot ${esc(fmtDateTimeET(d.generated_at))}${d.stale ? ' · STALE' : ''} · ` : ''}<a href="/player-load">Player Load board →</a></p>
  </section>`;
}

/**
 * The row inserted after the player hero: compact DNA module + (separately) the workload card.
 * Returns '' unless the DNA response is usable, so the page is unchanged while the API is not live.
 */
export function dnaRowHtml(dnaRes, loadRes = null) {
  if (!dnaUsable(dnaRes)) return '';
  const dna = renderDnaCompact(dnaRes.data);
  if (!dna) return '';
  const wl = renderWorkloadCard(loadRes);
  return `<div class="dna-row${wl ? ' dna-row--split' : ''}"><div class="dna-row__dna">${dna}</div>${wl ? `<aside class="dna-row__load">${wl}</aside>` : ''}</div>`;
}

/**
 * Mount the DNA row into the player page's [data-dna-slot]. Inert unless /v1/dna/players/:id answers with a
 * usable document: on 404, 503, network failure or an API that does not serve DNA yet, the slot stays hidden
 * and empty and nothing else is requested. Player Load (WNBA Pro) is read only for members, and only once DNA
 * is live, so no visitor triggers a 401. deps = { api, membershipFrom, isMember } (injected; testable).
 * Resolves to an unbind function, or undefined when nothing was mounted.
 */
export async function mountDnaRow(root, id, ctx, deps) {
  const slot = root?.querySelector?.('[data-dna-slot]');
  if (!slot) return undefined;
  const dna = await Promise.resolve().then(() => deps.api.dnaPlayer(id)).catch(() => null);
  if (!ctx.isCurrent() || !dnaUsable(dna)) return undefined;
  let load = null;
  const account = await Promise.resolve().then(() => deps.api.account()).catch(() => null);
  if (deps.isMember(deps.membershipFrom(account))) load = await Promise.resolve().then(() => deps.api.playerLoadPlayer(id)).catch(() => null);
  if (!ctx.isCurrent()) return undefined;
  const markup = dnaRowHtml(dna, load);
  if (!markup) return undefined;
  slot.innerHTML = markup;
  slot.hidden = false;
  return bindDnaInteractions(slot);
}

/* ── full profile ────────────────────────────────────────────────────── */

/** Athlete-first hero: approved photo pipeline, monogram when there is no approved photo. */
export function renderHero(body, photo = null) {
  const p = body?.player || {};
  const ph = photo || p.headshot || null;
  const t = body?.team;
  const s = body?.scopes?.season;
  const role = s?.calculated ? s.dimensions?.role : null;
  const w = winbaRow(body);
  const mono = `<div class="dna-hero__mono" aria-hidden="true"><span>${esc(initials(p.name || ''))}</span></div>`;
  const img = ph?.portrait ? String(photoImg(ph, 'portrait', { alt: p.name || '', attrs: 'class="dna-hero__img" width="600" height="750" decoding="async" fetchpriority="high"', fallback: raw(mono) })) : '';
  const tc = /^#[0-9a-f]{6}$/i.test(t?.color || '') ? t.color : 'var(--gold)';
  return `<header class="dna-hero" style="--tc:${tc}">
    <div class="dna-hero__media" data-photo-root>${img || mono}</div>
    <div class="dna-hero__txt">
      <p class="dna-hero__eyebrow">${t?.team_id ? `<a href="/teams/${esc(t.team_id)}">${esc(t.name || t.abbr || '')}</a>` : ''}${p.position ? ` · ${esc(p.position)}` : ''} · ${esc(String(body?.season || ''))} season</p>
      <h1 class="dna-hero__name">${esc(p.name || 'Player')}</h1>
      <p class="dna-hero__kicker">Player DNA · 17 dimensions</p>
      <div class="dna-hero__stats">
        ${w ? `<span><small>WinBA</small><b class="num">${esc(winbaText(w.value))}</b>${w.status === 'PROVISIONAL' ? '<em>PROVISIONAL</em>' : ''}</span>` : ''}
        ${role?.category ? `<span><small>Role</small><b>${esc(role.category)}</b></span>` : ''}
        ${s?.calculated ? `<span><small>Season sample</small><b class="num">${esc(String(s.sample.games))} G · ${Number(s.sample.minutes).toLocaleString('en-US')} min</b></span>` : ''}
      </div>
      <p><a class="note" href="/players/${encodeURIComponent(p.id || p.espn_athlete_id || '')}">Player page: game log, career, news →</a></p></div></header>`;
}

/** Scope tabs: calculated scopes are links; uncalculated scopes stay visible but disabled with the reason. */
export function renderScopeTabs(body, scope, { vs = '' } = {}) {
  const id = body?.player?.id || body?.player?.espn_athlete_id || '';
  const tab = ([k, l]) => {
    const on = body?.scopes?.[k]?.calculated;
    if (!on) return `<span class="dna-tab is-off${scope === k ? ' is-cur' : ''}" aria-disabled="true"${scope === k ? ' aria-current="page"' : ''} title="${esc(scopeUnavailable(body, k))}">${esc(l)}</span>`;
    return `<a class="dna-tab${scope === k ? ' is-on' : ''}" href="${profileUrl(id, { scope: k, vs })}" data-scope="${k}"${scope === k ? ' aria-current="page"' : ''}>${esc(l)}</a>`;
  };
  return `<nav class="dna-tabs" aria-label="DNA scope">${SCOPE_TABS.map(tab).join('')}${UNAVAILABLE_SCOPES.map(tab).join('')}</nav>
    <p class="note dna-tabs__na">${UNAVAILABLE_SCOPES.map(([k]) => esc(scopeUnavailable(body, k))).join(' ')}</p>`;
}

const PLAYER_ID = /^\d{1,12}$/;

/**
 * URL state (?scope=&cmp=&vs=) validated against the stored payload: an uncalculated scope falls back to
 * season; cmp must be a comparable scope (calculated; never playoffs, career or clutch); vs a numeric id
 * other than this player.
 */
export function stateFromQuery(query = {}, body = null, id = '') {
  let scope = isScope(query.scope) ? query.scope : 'season';
  if (body && !body.scopes?.[scope]?.calculated) scope = 'season';
  const cmp = body && comparableScopes(body, scope).includes(query.cmp) ? query.cmp : '';
  const vs = PLAYER_ID.test(String(query.vs || '')) && String(query.vs) !== String(id) ? String(query.vs) : '';
  return { scope, cmp, vs };
}

/**
 * Compare controls: "Compare scope" (only calculated, comparable scopes; never playoffs, career or clutch)
 * and "Compare player" (name search; the datalist is filled from /v1/dna/index on first focus).
 */
export function renderCompareControls(body, scope, { cmp = '', vs = '', vsName = '' } = {}) {
  const opts = body?.scopes?.[scope]?.calculated ? comparableScopes(body, scope) : [];
  const cmpSel = opts.length
    ? `<label>Compare scope <select data-ctl="cmp"><option value="">None</option>${opts.map((k) => `<option value="${k}"${cmp === k ? ' selected' : ''}>${esc(SCOPE_LABEL[k])}</option>`).join('')}</select></label>`
    : '';
  const vsCtl = body?.scopes?.[scope]?.calculated
    ? `<label class="dna-vs">Compare player <input type="search" data-ctl="vs" list="dna-vs-list" value="${esc(vsName)}" placeholder="Player name" autocomplete="off" enterkeyhint="go"><datalist id="dna-vs-list"></datalist></label>${vs ? '<button type="button" class="pill" data-action="vs-clear">Clear</button>' : ''}`
    : '';
  if (!cmpSel && !vsCtl) return '';
  return `<div class="dna-ctl">${cmpSel}${vsCtl}</div>`;
}

/** Career per-game trajectory from the sourced career record. No DNA or WinBA exists for past seasons. */
export function renderCareerTrajectory(career) {
  const rows = careerSeasonRows(career).filter((r) => r.season).sort((a, b) => String(a.season).localeCompare(String(b.season)));
  const metrics = [['ppg', 'Points per game'], ['rpg', 'Rebounds per game'], ['apg', 'Assists per game']].filter(([k]) => rows.some((r) => isNum(r[k])));
  if (rows.length < 2 || !metrics.length) return '';
  const dup = new Set(rows.map((r) => r.season).filter((y, i, a) => a.indexOf(y) !== i));
  const lab = (r) => (dup.has(r.season) && r.team ? `${r.season} ${String(r.team).toUpperCase()}` : String(r.season));
  const block = ([k, label]) => {
    const vals = rows.map((r) => r[k]).filter(isNum);
    const max = Math.max(...vals, 1);
    return `<div class="dna-traj__m"><h3 class="dna-h3">${esc(label)}</h3><ul class="dna-traj__bars">${rows.map((r) => `<li><span class="num">${esc(lab(r))}</span><span class="dna-traj__track">${isNum(r[k]) ? `<i style="width:${((r[k] / max) * 100).toFixed(1)}%"></i>` : ''}</span><b class="num">${isNum(r[k]) ? esc(num(r[k])) : '—'}</b></li>`).join('')}</ul></div>`;
  };
  return `<section class="dna-sec" id="dna-career"><div class="dna-sec__head"><h2 class="dna-h2">Career trajectory</h2><span class="note">per-game averages by season · sourced WNBA career record</span></div>
    <div class="dna-traj">${metrics.map(block).join('')}</div>
    <p class="note">Box-score averages only. Player DNA and WinBA are calculated for the ${esc('2026')} archive season only; no DNA or WinBA is shown for past seasons.</p></section>`;
}

export function renderFreshness(body) {
  if (!body) return '';
  return `<div class="dna-src"><p class="note">Data · <a href="https://propsports.proptechusa.ai" target="_blank" rel="noopener">PropSports</a>. As of ${esc(String(body.as_of || '').slice(0, 16).replace('T', ' '))} UTC · <span class="mono">${esc(body.versions?.player_dna || '')}</span> · <span class="mono">${esc(body.versions?.winba || '')}</span>.</p></div>`;
}

/**
 * The full report: headline + base, fingerprint + traits, movement, offense, rebounding + defensive
 * activity, WinBA, context, playoff translation, matrix, career trajectory, trust drawer.
 */
export function renderProfile(body, scope, { meta = null, career = null, cmp = '', vsBody = null } = {}) {
  const s = body?.scopes?.[scope];
  const traj = renderCareerTrajectory(career);
  if (!s?.calculated) {
    const id = body?.player?.id || body?.player?.espn_athlete_id || '';
    const alt = calculatedScopes(body).filter(([k]) => k !== scope);
    return `<div class="dna-honest dna-honest--big">${esc(scopeUnavailable(body, scope))}</div>
      ${alt.length ? `<p class="note dna-alt">Calculated for this player: ${alt.map(([k, l]) => `<a class="pill" href="${profileHref(id, k)}">${esc(l)}</a>`).join(' ')}</p>` : '<p class="note dna-alt">No scope is calculated for this player yet.</p>'}
      ${renderWinbaBreakdown(body)}${traj}${renderTrustDrawer(body, scope, meta)}${renderFreshness(body)}`;
  }
  const headline = `<div class="dna-headline">${sampleBadge(s, scope)}<p class="note">${esc(s.sample?.first_date || '')} → ${esc(s.sample?.last_date || '')} · every score is 0–100 against the qualified players of this scope</p></div>`;
  const mv = scope === 'season' ? renderMovementChart(body) : body.movement ? `<p class="note dna-mv-note">Recent movement (${esc(movementLabel(body).toLowerCase())} vs season) is shown on the Season scope.</p>` : '';
  const cmpPanel = cmp && comparableScopes(body, scope).includes(cmp)
    ? `<section class="dna-sec" id="dna-cmp"><div class="dna-sec__head"><h2 class="dna-h2">${esc(SCOPE_LABEL[scope])} vs ${esc(SCOPE_LABEL[cmp])}</h2><span class="note">dashed outline = ${esc(SCOPE_LABEL[cmp])}</span></div>${renderScopeCompare(body, scope, cmp)}</section>` : '';
  const vsPanel = vsBody
    ? `<section class="dna-sec" id="dna-vs"><div class="dna-sec__head"><h2 class="dna-h2">${esc(body.player?.name || '')} vs ${esc(vsBody.player?.name || '')}</h2><span class="note">${esc(SCOPE_LABEL[scope])} · ${esc(String(body.season || ''))}</span></div>${renderPlayerCompare(body, vsBody, scope)}</section>` : '';
  return `<div class="dna-report">
    ${headline}
    <div class="dna-top">
      <div class="dna-top__radar">${renderRadar(body, scope)}</div>
      <div class="dna-top__side">${renderSignals(body, scope)}${mv}</div>
    </div>
    ${cmpPanel}${vsPanel}
    ${renderGroup(body, scope, OFFENSE, { meta, title: 'Offensive DNA', sub: 'how this player creates offense · tap for components', extra: `<div class="dna-offx">${renderPossessionProfile(body, scope)}${renderCreatorMap(body, scope)}</div>` })}
    ${renderGroup(body, scope, DEFENSE, { meta, title: 'Rebounding & defensive activity', sub: 'rebound shares and box-score defensive events', note: '<b>DEFENSIVE ACTIVITY · PROXY.</b> Box-score activity only (steals, blocks, fouls). No individual matchup, on/off or tracking data — a high score is not a complete defensive rating.' })}
    ${scope === 'season' ? renderWinbaBreakdown(body) : ''}
    ${renderContextCards(body, scope, meta)}
    ${scope === 'season' ? renderPlayoffTranslation(body, meta) : ''}
    ${renderMatrix(body, scope, meta)}
    ${traj}
    ${renderTrustDrawer(body, scope, meta)}
  </div>${renderFreshness(body)}`;
}

export { SCOPE_LABEL };
