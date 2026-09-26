// WNBA Player DNA UI (compact module on /players/:id, full profile /players/:id/dna).
// Rendered against REAL /v1/dna/* responses (tests/fixtures/dna: the dna task + wnba-api run offline over the
// pulled 2026 archive): Olivia Miles (star), Teja Oblak (mid rotation), Brionna Jones (season INSUFFICIENT_SAMPLE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as U from '../src/ui/dna.js';
import * as V from '../src/views/player-dna.js';
import { resolveRoute } from '../src/lib/routes.js';
import { routeMeta } from '../src/seo/meta.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/dna/${n}.json`, import.meta.url), 'utf8'));
const MILES = fx('4433791');
const OBLAK = fx('5346554');
const JONES = fx('3058895');
const META = fx('meta').data;
const M = MILES.data;
const O = OBLAK.data;
const J = JONES.data;

const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const mxRow = (h, k) => h.split(new RegExp(`<li class="dna-mx__row(?: is-na)?" data-dim="${k}">`))[1].split('<li class="dna-mx__row')[0];
const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const LOAD = { ok: true, status: 200, data: { access: 'granted', generated_at: '2026-09-25T12:00:00.000Z', stale: false, player: { athlete_id: '4433791', score: 71, band: 'HEAVY', next_game_utc: null, metrics: { last_game_minutes: 36, avg_minutes_last3: 34.3, minutes_7d: 103, games_5d: 3, games_7d: 3, turnaround_hours: 46, overtime_games_7d: 0 }, signals: ['3 games in 5 days'] } } };

test('fixtures are real wnba-dna/player documents', () => {
  for (const r of [MILES, OBLAK, JONES]) { assert.equal(r.ok, true); assert.equal(r.data.schema, 'wnba-dna/player'); assert.equal(r.data.versions.player_dna, 'wnba-player-dna/1.0.0'); }
  assert.equal(M.player.name, 'Olivia Miles');
  assert.equal(J.scopes.season.reason, 'INSUFFICIENT_SAMPLE');
});

/* ── compact module ──────────────────────────────────────────────────── */

test('compact (Miles): measurement base, top 3 traits, 2 to watch, movement, WinBA and CTA — exact payload numbers', () => {
  const h = U.renderDnaCompact(M);
  const s = M.scopes.season;
  assert.ok(h.includes('SEASON <i>·</i> 40 G <i>·</i> 1,241 MIN <i>·</i> 166 QUALIFIED PLAYERS'));
  const sig = h.split('dna-compact__sig')[1].split('dna-compact__mv')[0];
  for (const k of s.traits.strongest) assert.match(sig, new RegExp(`data-dim="${k}"[\\s\\S]*?>${s.dimensions[k].score}</b>`), k);
  assert.equal((sig.match(/class="dna-sig"/g) || []).length, 3);
  const watch = h.split('dna-compact__watch')[1].split('</p>')[0];
  assert.deepEqual(U.watchKeys(s), ['ball_security', 'rebounding']);
  assert.match(text(watch), /Watch Ball security 37 · Rebounding 42/);
  assert.match(h, /class="dna-compact__winba" href="\/players\/4433791\/dna" data-dim="winba"><span class="note">WinBA<\/span><b class="num">87<\/b>/);
  assert.match(h, /href="\/players\/4433791\/dna">Full DNA profile →/);
  assert.match(h, /Last 10 vs season/);
  assert.equal((h.match(/class="dna-axis/g) || []).length, U.radarRows(M, 'season', U.COMPACT_AXES).length);
});

test('WinBA shown is the payload value (canonical board number), never re-rounded or recomputed', () => {
  const w = O.scopes.season.dimensions.winba;
  assert.equal(w.value, 55.4);
  assert.match(U.renderDnaCompact(O), /<b class="num">55\.4<\/b>/);
  assert.match(V.renderHero(O), /<small>WinBA<\/small><b class="num">55\.4<\/b>/);
  assert.match(U.renderWinbaBreakdown(O), /dna-winba__score num">55\.4</);
  assert.match(mxRow(U.renderMatrix(O, 'season', META), 'winba'), /dna-mx__score num">55\.4</);
  assert.match(U.renderRadar(O, 'season'), /WINBA<tspan class="dna-ax__v" dx="5">55\.4</);
  assert.equal(O.winba.score, 55.4, 'player-level canonical row agrees');
});

test('WinBA breakdown: stored component values + published weights; per-component points are NOT invented', () => {
  const h = U.renderWinbaBreakdown(M);
  const c = M.winba.components;
  for (const [k, v] of Object.entries(c)) assert.match(h, new RegExp(`data-part="${k}"[\\s\\S]*?<td class="num">${String(v).replace('.', '\\.')}</td>`), k);
  for (const pct of ['45%', '25%', '20%', '10%']) assert.ok(h.includes(`>${pct}</td>`), pct);
  assert.equal((h.match(/>not stored</g) || []).length, 4);
  // 0.45 × 97.4 = 43.8, 0.25 × 78 = 19.5 … none of these products may appear
  for (const p of ['43.8', '43.83', '19.5', '15.96', '16.0', '7.71', '7.7']) assert.ok(!text(h).includes(p), `computed point ${p}`);
  assert.match(text(h), /does not store per-component points or the raw inputs/);
  assert.match(text(h), /401857320/, 'the All-Star note travels with WinBA');
  assert.match(text(h), /WinBA sample: 41 games \(32-9\) · 1,265 min/);
});

test('insufficient season sample (Jones): honest message, calculated scopes linked, canonical WinBA labelled PROVISIONAL', () => {
  const h = U.renderDnaCompact(J);
  assert.match(text(h), /Not enough sample for Season: 9 games \/ 152 min \(needs 10 games and 200 min\)\./);
  assert.match(h, /href="\/players\/3058895\/dna\?scope=last5">Last 5</);
  assert.ok(!h.includes('scope=last10'), 'uncalculated scopes are not linked');
  assert.match(h, /WinBA<\/span><b class="num">81\.2<\/b><span class="dna-conf dna-conf--low">PROVISIONAL<\/span>/);
  assert.ok(!h.includes('class="dna-radar'), 'no fingerprint drawn without a calculated season');
  const p = V.renderProfile(J, 'season', { meta: META });
  assert.match(text(p), /Not enough sample for Season/);
  assert.match(text(p), /PROVISIONAL · unranked/);
  assert.match(p, /\?scope=last5/);
});

/* ── full profile ────────────────────────────────────────────────────── */

test('matrix: every dimension of the payload, scores as stored (integers), L10 column = payload movement', () => {
  const h = U.renderMatrix(M, 'season', META);
  const s = M.scopes.season;
  assert.equal((h.match(/class="dna-mx__row/g) || []).length, M.dimension_order.length);
  assert.equal(M.dimension_order.length, 17);
  for (const k of M.dimension_order) {
    const d = s.dimensions[k];
    const row = mxRow(h, k);
    if (typeof d.score === 'number' && k !== 'winba') assert.match(row, new RegExp(`dna-mx__score num">${d.score}</b>`), k);
    if (typeof d.score !== 'number') assert.match(row, /dna-mx__score num">—</, k);
  }
  assert.match(h, /<span>L10<\/span>/);
  for (const [k, v] of Object.entries(M.movement.deltas)) assert.ok(mxRow(h, k).split('dna-mx__l15">')[1].split('</span>')[0].includes(`>${signed(v)}</b>`), k);
  assert.ok(!/dna-mx__score num">\d+\.\d/.test(h.replace(mxRow(h, 'winba'), '')), 'no fake precision on DNA scores');
  assert.ok(!/\d+\.\d+(st|nd|rd|th) percentile/.test(V.renderProfile(M, 'season', { meta: META })));
});

test('component disclosure: every component value and percentile appears, formatted in its stored unit', () => {
  const h = U.renderMatrix(M, 'season', META);
  for (const d of U.dimRows(M, 'season').filter((x) => typeof x.score === 'number' && x.key !== 'winba')) {
    const row = h.split(`<li class="dna-mx__row" data-dim="${d.key}">`)[1].split('</details></li>')[0];
    for (const c of d.components) {
      assert.ok(row.includes(`>${U.fmtComponent(c.key, c.value)}</b>`), `${d.key}.${c.key}`);
      if (typeof c.percentile === 'number') assert.ok(row.includes(`${U.ordinal(c.percentile)} percentile`), `${d.key}.${c.key} pct`);
    }
  }
  assert.equal(U.fmtComponent('ts_pct', 0.606), '60.6%');
  assert.equal(U.fmtComponent('usage_pct', 27.2), '27.2%');
  assert.equal(U.fmtComponent('tov_pct', 15.9), '15.9%');
  assert.equal(U.fmtComponent('ft_rate', 0.34), '0.34');
});

test('proxy labels never regress: radar axes dashed, matrix status PROXY, tooltip reason; FT pressure is never "rim pressure"', () => {
  const radar = U.renderRadar(M, 'season');
  const matrix = U.renderMatrix(M, 'season', META);
  const proxies = U.dimRows(M, 'season').filter((x) => x.proxy && typeof x.score === 'number');
  assert.deepEqual(proxies.map((d) => d.key).sort(), ['creation', 'defensive_activity', 'ft_pressure', 'matchup_adaptability', 'shooting_profile']);
  for (const d of proxies) {
    assert.match(radar, new RegExp(`class="dna-axis is-proxy" data-dim="${d.key}"`), d.key);
    assert.match(mxRow(matrix, d.key), /dna-st--proxy">PROXY/, d.key);
    assert.match(mxRow(matrix, d.key), /Proxy: /, d.key);
  }
  const page = text(V.renderProfile(M, 'season', { meta: META }));
  assert.match(page, /Free-throw pressure/);
  assert.ok(!/Rim pressure/.test(page), 'no NBA rim-pressure label');
  assert.match(page, /DEFENSIVE ACTIVITY · PROXY\. Box-score activity only/);
  assert.match(page, /No individual matchup, on\/off or tracking data/);
});

test('movement: one diverging bar per non-zero, non-descriptive payload delta; sign printed; values never recomputed', () => {
  const h = U.renderMovementChart(M);
  const want = Object.entries(M.movement.deltas).filter(([k, v]) => v !== 0 && !['role', 'volatility', 'form'].includes(k));
  assert.equal(want.length, 8);
  assert.equal((h.match(/class="dna-mv__row"/g) || []).length, want.length);
  for (const [k, v] of want) assert.ok(h.split(`data-dim="${k}"`)[1].split('</li>')[0].includes(`>${signed(v)}</b>`), k);
  for (const k of ['role', 'volatility', 'ball_security']) assert.ok(!h.includes(`data-dim="${k}"`), k);
  // a tampered payload renders exactly as given: the UI does not derive deltas from the two scopes
  const t = U.renderMovementChart({ ...M, movement: { vs: 'last10', deltas: { scoring: 50, efficiency: -8 } } });
  assert.match(t, /left:50%;width:50\.0%/);
  assert.match(t, /left:42\.0%;width:8\.0%/);
  assert.equal(U.renderMovementChart({ ...M, movement: null }), '');
});

test('no recompute: an inconsistent stored score is rendered as stored', () => {
  const s = structuredClone(M);
  s.scopes.season.dimensions.scoring.score = 11; // components are 94th/95th percentile
  assert.match(mxRow(U.renderMatrix(s, 'season', META), 'scoring'), /dna-mx__score num">11</);
  assert.match(U.renderRadar(s, 'season'), /SCORING<tspan class="dna-ax__v" dx="5">11</);
});

test('confidence drivers: payload confidence as given; reference minutes and proxy factor from /v1/dna/meta', () => {
  const t = text(U.confDetail(M, 'season', 'scoring', META));
  assert.ok(t.includes('1.00'));
  assert.match(t, /Minutes 1,241 of 1,000 reference minutes for Season/);
  assert.match(t, /2 \/ 2 components measured/);
  assert.match(t, /166-player peer group/);
  assert.match(t, /Proxy penalty: none/);
  assert.match(text(U.confDetail(M, 'season', 'creation', META)), /×0\.75 \(proxy dimension\)/);
  assert.match(text(U.confDetail(M, 'last5', 'scoring', META)), /of 125 reference minutes for Last 5/);
});

test('no career DNA and no clutch numbers: shown as unavailable with the reason, never as a tab or a score', () => {
  const tabs = V.renderScopeTabs(M, 'season');
  assert.ok(!tabs.includes('data-scope="career"') && !tabs.includes('data-scope="clutch"'));
  assert.match(tabs, /<span class="dna-tab is-off" aria-disabled="true" title="Career DNA is not calculated: the archive holds the 2026 season only\.">Career<\/span>/);
  assert.match(text(tabs), /Clutch is not measured: play-by-play is archived, but per-player clutch attribution is not built in V1\./);
  assert.equal(U.isScope('career'), false);
  assert.equal(U.isScope('clutch'), false);
  const page = V.renderProfile(M, 'season', { meta: META });
  assert.match(mxRow(U.renderMatrix(M, 'season', META), 'pressure_clutch'), /Unavailable — per-player clutch attribution is not built in V1/);
  assert.ok(!/data-scope="career"/.test(page));
  // requesting the career scope renders the reason only
  assert.match(text(V.renderProfile(M, 'career', { meta: META })), /^Career DNA is not calculated/);
});

test('career trajectory: per-game seasons from the career record; no DNA or WinBA for past seasons', () => {
  const career = { categories: [{ names: ['gamesPlayed', 'points', 'rebounds', 'assists'], seasons: [
    { season: 2024, team: 'min', team_id: '8', stats: ['40', '560', '160', '200'] },
    { season: 2025, team: 'min', team_id: '8', stats: ['40', '700', '176', '236'] },
    { season: 2026, team: 'min', team_id: '8', stats: ['41', '800', '197', '246'] }
  ] }] };
  const h = V.renderCareerTrajectory(career);
  assert.ok(h, 'renders with 3 seasons');
  // same per-game values the player page's career table shows (careerSeasonRows), in season order
  assert.match(h, /Points per game[\s\S]*?2024<\/span>[\s\S]*?<b class="num">14\.0<\/b>[\s\S]*?2025<\/span>[\s\S]*?<b class="num">17\.5<\/b>[\s\S]*?2026<\/span>[\s\S]*?<b class="num">19\.5<\/b>/);
  assert.match(text(h), /2024/);
  assert.match(text(h), /no DNA or WinBA is shown for past seasons/);
  assert.ok(!/WinBA<\/small>|dna-mx|dna-radar/.test(h));
  assert.equal(V.renderCareerTrajectory(null), '');
});

test('trust drawer: source, as-of, versions, decisions incl. the All-Star WinBA note, franchise-only filter, unavailable, qualification', () => {
  const t = text(U.renderTrustDrawer(M, 'season', META));
  for (const re of [/PropBetEdge archive of final WNBA box scores/, /2026-09-25 02:00 UTC/, /wnba-player-dna\/1\.0\.0/, /winba\/1\.0\.0/,
    /canonical published WinBA board value, attached unchanged/, /401857320/, /Commissioner’s Cup final \(401857321\): kept/,
    /Franchise games only \(15 WNBA franchises\)/, /331 games used/, /per-player clutch attribution is not built/, /Ref\. min/, /Player Load and injury status never affect DNA or WinBA/]) assert.match(t, re);
  assert.match(U.renderTrustDrawer(M, 'season', META), /<div class="tbl-scroll"><table class="tbl dna-qual">/);
});

/* ── Player Load separation and inertness ────────────────────────────── */

test('workload card: exact disclaimer, only fields present in the load payload', () => {
  const h = V.renderWorkloadCard(LOAD);
  assert.ok(h.includes('Player Load is schedule/workload pressure, not a medical assessment and does not affect the DNA or WinBA score.'));
  assert.equal(V.LOAD_DISCLAIMER, 'Player Load is schedule/workload pressure, not a medical assessment and does not affect the DNA or WinBA score.');
  assert.match(h, /<b class="num">71<\/b><span class="pl-band pl-heavy">HEAVY<\/span>/);
  assert.match(text(h), /7-day minutes 103 min/);
  const sparse = { ok: true, data: { player: { score: 40, band: 'NORMAL', metrics: { minutes_7d: 60 } } } };
  const hs = V.renderWorkloadCard(sparse);
  assert.ok(!/Turnaround|Last game|Next tip/.test(hs), 'absent fields are not shown');
  for (const r of [null, { ok: false, status: 401 }, { ok: true, data: { player: null } }]) assert.equal(V.renderWorkloadCard(r), '');
});

test('Player Load is never inside the DNA markup: separate aside; DNA output is identical with or without load', () => {
  const row = V.dnaRowHtml(MILES, LOAD);
  const dnaPart = row.split('<aside class="dna-row__load">')[0];
  assert.ok(row.includes('<aside class="dna-row__load">'));
  assert.ok(!/Workload|Player Load|HEAVY|pl-band/.test(dnaPart));
  const compact = U.renderDnaCompact(M);
  assert.ok(dnaPart.includes(`<div class="dna-row__dna">${compact}</div>`), 'DNA markup with load === DNA markup alone');
  assert.equal(V.dnaRowHtml(MILES, null), `<div class="dna-row"><div class="dna-row__dna">${compact}</div></div>`);
});

test('inert: 404, 503, network error, unpublished API or wrong schema render nothing', () => {
  const miss = { ok: false, error: { code: 'no_snapshot' }, data: { schema: 'wnba-dna/player', state: 'UNAVAILABLE', reason: 'no_snapshot' } };
  const down = { ok: false, error: { code: 'not_derived' }, data: { schema: 'wnba-dna/player', state: 'UNAVAILABLE', reason: 'not_derived' } };
  const oldApi = { ok: false, error: { code: 'not_found', message: 'No route /v1/dna/players/1' }, routes: [] };
  for (const r of [miss, down, oldApi, { ok: false, error: { code: 'network' } }, { ok: false, error: { code: 'dna_api_unavailable' } }, null, { ok: true, data: { schema: 'something/else', scopes: {} } }]) {
    assert.equal(V.dnaUsable(r), false);
    assert.equal(V.dnaRowHtml(r, LOAD), '', JSON.stringify(r).slice(0, 60));
  }
});

function fakeSlotRoot() {
  const slot = { hidden: true, innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] };
  return { slot, root: { querySelector: (sel) => (sel === '[data-dna-slot]' ? slot : null) } };
}
const ctx = { isCurrent: () => true };

test('mountDnaRow: API not live -> slot stays hidden and empty; account and Player Load are never requested', async () => {
  for (const res of [{ ok: false, error: { code: 'dna_api_unavailable' } }, { ok: false, status: 404 }, { ok: false, status: 503 }]) {
    const { slot, root } = fakeSlotRoot();
    const calls = [];
    const api = { dnaPlayer: async () => { calls.push('dna'); return res; }, account: async () => { calls.push('account'); return null; }, playerLoadPlayer: async () => { calls.push('load'); return LOAD; } };
    const u = await V.mountDnaRow(root, '4433791', ctx, { api, membershipFrom: () => ({}), isMember: () => true });
    assert.equal(u, undefined);
    assert.equal(slot.hidden, true);
    assert.equal(slot.innerHTML, '');
    assert.deepEqual(calls, ['dna']);
  }
  // a throwing adapter is inert too
  const { slot, root } = fakeSlotRoot();
  await V.mountDnaRow(root, '1', ctx, { api: { dnaPlayer: () => { throw new Error('boom'); } }, membershipFrom: () => ({}), isMember: () => false });
  assert.equal(slot.hidden, true);
});

test('mountDnaRow: DNA live -> row mounted; Player Load read only for members', async () => {
  const run = async (member) => {
    const { slot, root } = fakeSlotRoot();
    const calls = [];
    const api = { dnaPlayer: async () => MILES, account: async () => ({ ok: true }), playerLoadPlayer: async () => { calls.push('load'); return LOAD; } };
    const u = await V.mountDnaRow(root, '4433791', ctx, { api, membershipFrom: (x) => x, isMember: () => member });
    assert.equal(typeof u, 'function');
    assert.equal(slot.hidden, false);
    return { slot, calls };
  };
  const pro = await run(true);
  assert.deepEqual(pro.calls, ['load']);
  assert.match(pro.slot.innerHTML, /Workload context/);
  const free = await run(false);
  assert.deepEqual(free.calls, []);
  assert.ok(!/Workload context/.test(free.slot.innerHTML));
  assert.match(free.slot.innerHTML, /Player DNA/);
});

test('api adapter gates every DNA call on /health listing the route (no request to a route that does not exist)', () => {
  const src = readFileSync(new URL('../src/data/api.js', import.meta.url), 'utf8');
  assert.match(src, /export const DNA_ROUTE = '\/v1\/dna\/players\/:id';/);
  assert.match(src, /r\.routes\.includes\(DNA_ROUTE\)/);
  assert.match(src, /dnaPlayer: async \(id\) => \(\(await dnaAvailable\(\)\) \? getJson\(/);
  assert.match(src, /dnaMeta: async \(\) => \(\(await dnaAvailable\(\)\) \? getJson\(/);
  // the player page never awaits DNA before painting, and uses the injected, inert-by-default row
  const page = readFileSync(new URL('../src/pages/player.js', import.meta.url), 'utf8');
  assert.match(page, /render\(root, playerView\(data\)\);[\s\S]*mountDnaRow\(root, id, ctx, \{ api, membershipFrom, isMember \}\)\.then\(/);
  const view = readFileSync(new URL('../src/views/player.js', import.meta.url), 'utf8');
  assert.match(view, /<div class="dna-slot" data-dna-slot hidden><\/div>/);
});

/* ── routing, hero, mobile structure ─────────────────────────────────── */

test('route /players/:id/dna resolves, is noindex, and the SSR worker answers it', async () => {
  assert.deepEqual(resolveRoute('/players/4433791/dna'), { id: 'player-dna', params: { playerId: '4433791' }, path: '/players/4433791/dna' });
  assert.equal(resolveRoute('/players/4433791').id, 'player');
  assert.match(routeMeta('player-dna', { path: '/players/4433791/dna', data: M }).robots, /noindex/);
  assert.match(routeMeta('player-dna', { path: '/players/4433791/dna', data: M }).title, /^Olivia Miles Player DNA/);
  const { renderRoute } = await import('../workers/wnba-web/src/render.js');
  const r = await renderRoute('/players/4433791/dna', {});
  assert.equal(r.status, 200);
  assert.equal(r.route, 'player-dna');
  const router = readFileSync(new URL('../src/lib/router.js', import.meta.url), 'utf8');
  assert.match(router, /'player-dna': \(\) => import\('\.\.\/pages\/player-dna\.js'\)/);
});

test('hero: approved photo chain when present, monogram otherwise (never another host)', () => {
  const withPhoto = V.renderHero(O);
  assert.match(withPhoto, /<img src="\/media\/players\/5346554\/portrait\.webp"|<img src="https:\/\/(a\.espncdn\.com|cdn\.wnba\.com)\//);
  assert.match(withPhoto, /<template data-photo-fallback><div class="dna-hero__mono"/);
  const none = V.renderHero({ ...O, player: { ...O.player, headshot: null } });
  assert.ok(!/<img/.test(none));
  assert.match(none, /<div class="dna-hero__mono" aria-hidden="true"><span>TO<\/span><\/div>/);
  const hosts = [...withPhoto.matchAll(/(?:src|data-photo-next)="([^"]*)"/g)].flatMap((m) => m[1].split(' ')).filter(Boolean).map((u) => (u.startsWith('/') ? 'self' : new URL(u).host));
  for (const h of hosts) assert.ok(['self', 'a.espncdn.com', 'cdn.wnba.com'].includes(h), h);
});

test('mobile structure: short radar labels behind a container query, tables scroll in .tbl-scroll, keyboard axes and rows, text >= 10px', () => {
  const css = readFileSync(new URL('../src/styles/player-dna.css', import.meta.url), 'utf8');
  assert.match(css, /@container \(max-width: 400px\) \{ \.dna-ax--long \{ display: none; \} \.dna-ax--short \{ display: inline; \} \}/);
  assert.match(css, /container-type: inline-size/);
  assert.match(css, /\.dna-cmp > \.dna-radar, \.dna-pc > \.dna-radar \{ width: 100%; \}/, 'compare radars stretch (size containment has no intrinsic width)');
  for (const m of css.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 10, `font ${m[0]}`);
  // SVG labels: long 14 units shown only when the radar is > 400px wide (>= 11.7px); short 23 units at a 256px mini radar (>= 12.2px)
  assert.match(css, /\.dna-ax \{[^}]*font: 700 14px/);
  assert.match(css, /\.dna-ax--short \{ display: none; font-size: 23px; \}/);
  const page = V.renderProfile(M, 'season', { meta: META });
  for (const cls of ['dna-wb__tbl', 'dna-qual']) assert.match(page, new RegExp(`<div class="tbl-scroll"><table class="tbl ${cls}`));
  assert.ok((page.match(/<summary/g) || []).length >= 15);
  assert.match(U.renderRadar(M, 'season'), /tabindex="0" role="button" aria-label="/);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /import '\.\/styles\/player-dna\.css';/);
});

test('areas to watch never repeat a strength', () => {
  const s = { ...M.scopes.season, traits: { strongest: ['scoring', 'creation', 'playmaking'], weakest: ['rebounding', 'playmaking'], basis: '' } };
  assert.deepEqual(U.watchKeys(s), ['rebounding']);
  const h = U.renderSignals({ ...M, scopes: { ...M.scopes, season: s } }, 'season');
  assert.equal(h.split('dna-sigs--watch')[1].includes('data-dim="playmaking"'), false);
});

/* ── compare (ported from NBA dna-ui: scope compare, player compare, URL state) ── */

test('comparable scopes: calculated only, never playoffs, career or clutch, never itself', () => {
  assert.deepEqual(U.comparableScopes(M, 'season'), ['last5', 'last10', 'last15', 'home', 'away']);
  assert.ok(!U.comparableScopes(M, 'last10').includes('last10'));
  for (const b of [M, O, J]) for (const [s] of U.SCOPE_TABS) for (const k of U.comparableScopes(b, s)) {
    assert.ok(!['playoffs', 'career', 'clutch'].includes(k));
    assert.equal(b.scopes[k].calculated, true);
  }
  assert.deepEqual(U.comparableScopes(J, 'last5'), [], 'Jones: nothing else calculated');
  assert.equal(V.renderCompareControls(J, 'season'), '', 'no compare controls on an uncalculated scope');
  const ctl = V.renderCompareControls(M, 'season', { cmp: 'last10' });
  assert.match(ctl, /<select data-ctl="cmp"><option value="">None<\/option>/);
  assert.match(ctl, /<option value="last10" selected>Last 10<\/option>/);
  assert.ok(!/value="(playoffs|career|clutch)"/.test(ctl));
  assert.match(ctl, /<input type="search" data-ctl="vs" list="dna-vs-list"/);
});

test('scope compare, season vs last 10: the stored movement, labelled "Change (stored)"', () => {
  const h = U.renderScopeCompare(M, 'season', 'last10');
  assert.match(h, /<th class="num">Change \(stored\)<\/th>/);
  // last 10 does not measure the season-only axes (availability, adaptability, WinBA): overlay drawn as points, never at 0
  assert.ok(!/dna-shape dna-shape--b/.test(h));
  assert.equal((h.match(/class="dna-pt dna-pt--b"/g) || []).length, U.radarRows(M, 'season').filter((d) => typeof M.scopes.last10.dimensions[d.key]?.score === 'number').length);
  assert.match(h, /<span class="dna-key dna-key--b"><\/span>Last 10/);
  for (const [k, v] of Object.entries(M.movement.deltas)) {
    const row = h.split(`<tr data-dim="${k}">`)[1]?.split('</tr>')[0];
    assert.ok(row, k);
    assert.ok(row.endsWith(`<td class="num">${signed(-v)}</td>`), `${k} season−last10 = −(stored last10−season)`);
  }
  const rev = U.renderScopeCompare(M, 'last10', 'season');
  for (const [k, v] of Object.entries(M.movement.deltas)) assert.ok(rev.split(`<tr data-dim="${k}">`)[1].split('</tr>')[0].endsWith(`<td class="num">${signed(v)}</td>`), k);
  assert.match(text(h), /Change = Season − Last 10, read from the stored last 10 − season movement \(not recomputed\)/);
  assert.match(text(rev), /Change = Last 10 − Season/);
});

test('scope compare, other pairs: labelled "Difference" of the stored scores, each scope ranked in its own population', () => {
  const h = U.renderScopeCompare(M, 'season', 'home');
  assert.match(h, /<th class="num">Difference<\/th>/);
  const a = M.scopes.season.dimensions.scoring.score; const b = M.scopes.home.dimensions.scoring.score;
  assert.ok(h.split('<tr data-dim="scoring">')[1].split('</tr>')[0].endsWith(`<td class="num">${signed(a - b)}</td>`));
  assert.match(text(h), /Each scope is ranked against its own qualified population/);
  assert.ok(!/<tr data-dim="pressure_clutch">/.test(h));
  assert.match(U.renderScopeCompare(J, 'last5', 'season'), /Not enough sample for Season/);
});

test('player compare: two stored payloads, overlay radar with both names, expandable components, no winner', () => {
  const h = U.renderPlayerCompare(M, O, 'season');
  assert.match(h, /dna-shape dna-shape--b/);
  assert.match(h, /dna-key--a"><\/span>Olivia Miles <span class="dna-key dna-key--b"><\/span>Teja Oblak/);
  assert.match(text(h), /no winner is declared/);
  const row = h.split('<li class="dna-pc__row" data-dim="scoring">')[1].split('</li>\n')[0];
  assert.ok(row.includes(`<b class="num">${M.scopes.season.dimensions.scoring.score}</b>`) && row.includes(`<b class="num">${O.scopes.season.dimensions.scoring.score}</b>`));
  assert.match(row, /<details><summary>/);
  assert.ok(row.includes(U.fmtComponent('pts_per36', O.scopes.season.dimensions.scoring.components[0].value)));
  assert.match(h.split('data-dim="winba">')[1], /<b class="num">87<\/b>[\s\S]*?<b class="num">55\.4<\/b>/, 'WinBA as the stored canonical values');
  assert.match(text(U.renderPlayerCompare(M, J, 'season')), /Brionna Jones: Not enough sample for Season/);
});

test('profile renders the compare panels only for valid state', () => {
  const p = V.renderProfile(M, 'season', { meta: META, cmp: 'last10', vsBody: O });
  assert.match(p, /id="dna-cmp"[\s\S]*Season vs Last 10/);
  assert.match(p, /id="dna-vs"[\s\S]*Olivia Miles vs Teja Oblak/);
  assert.ok(!/id="dna-cmp"/.test(V.renderProfile(M, 'season', { meta: META, cmp: 'playoffs' })));
  assert.ok(!/id="dna-cmp"/.test(V.renderProfile(M, 'season', { meta: META, cmp: 'season' })));
});

test('URL state: ?scope=&cmp=&vs= is shareable, validated, and scope tabs keep the compared player', () => {
  assert.equal(U.profileUrl('4433791', { scope: 'last10', cmp: 'season', vs: '5346554' }), '/players/4433791/dna?scope=last10&cmp=season&vs=5346554');
  assert.equal(U.profileUrl('4433791', { scope: 'season' }), '/players/4433791/dna');
  assert.deepEqual(V.stateFromQuery({ scope: 'last10', cmp: 'season', vs: '5346554' }, M, '4433791'), { scope: 'last10', cmp: 'season', vs: '5346554' });
  for (const cmp of ['playoffs', 'career', 'clutch', 'last10', 'nope']) assert.equal(V.stateFromQuery({ scope: 'last10', cmp }, M, '4433791').cmp, '', cmp);
  assert.equal(V.stateFromQuery({ scope: 'career' }, M, '4433791').scope, 'season');
  assert.equal(V.stateFromQuery({ scope: 'last10' }, J, '3058895').scope, 'season', 'uncalculated scope falls back');
  assert.equal(V.stateFromQuery({ vs: '4433791' }, M, '4433791').vs, '', 'never compare a player with herself');
  assert.equal(V.stateFromQuery({ vs: 'x<script>' }, M, '4433791').vs, '');
  assert.match(V.renderScopeTabs(M, 'season', { vs: '5346554' }), /href="\/players\/4433791\/dna\?scope=last10&vs=5346554" data-scope="last10"/);
  const page = readFileSync(new URL('../src/pages/player-dna.js', import.meta.url), 'utf8');
  assert.match(page, /history\.replaceState\(\{\}, '', profileUrl\(id, state\)\)/);
  assert.match(page, /stateFromQuery\(ctx\.query, body, id\)/, 'a reload restores state from the URL');
  assert.match(page, /api\.dnaIndex\(\)/);
  assert.match(page, /addEventListener\('focusin', onFocus\)/, 'the index is loaded on focus only');
});

test('playoff translation: no section at all when the archive has no playoff data (matrix row keeps the reason)', () => {
  const body = fx('4433791').data ?? fx('4433791');
  assert.equal(body.scopes.season.dimensions.playoff_translation.score ?? null, null);
  assert.equal(U.renderPlayoffTranslation(body), '');
  const scored = { ...body, scopes: { ...body.scopes, season: { ...body.scopes.season, dimensions: { ...body.scopes.season.dimensions, playoff_translation: { score: 60, status: 'LIVE', components: [{ key: 'playoff_gmsc36_delta', value: 1.2, percentile: 70 }] } } } } };
  assert.match(U.renderPlayoffTranslation(scored), /Playoff translation/);
});
