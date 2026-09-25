// Playoffs rendering (src/ui/bracket.js generic + src/views/playoffs.js WNBA) and route/SEO wiring.
// Rendering is tested separately from normalization; inputs are contract snapshots built from the captures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWnbaPlayoffs } from '../workers/shared/playoffs-wnba.js';
import { LOCK_POLICY } from '../workers/shared/pbe-runtime.js';
import { playoffsView, playoffStories, pictureRows, PBE_POLICY_COPY } from '../src/views/playoffs.js';
import { bracketBoard, seriesCard, allGames } from '../src/ui/bracket.js';
import { standingsView } from '../src/views/league.js';
import { resolveRoute } from '../src/lib/routes.js';
import { routeMeta } from '../src/seo/meta.js';
import { STATIC_PATHS } from '../src/seo/feeds.js';
import { NAV, PRIMARY_NAV } from '../src/ui/shell.js';
import { renderRoute } from '../workers/wnba-web/src/render.js';
import { fx, asOf, synthEvent, synthStandings } from './fixtures/playoffs/scenarios.mjs';

const CAP = '2026-09-25T14:00:00.000Z';
const snapOf = (season, events = fx(`espn-postseason-${season}.json`).events, standings = fx(`espn-standings-league-${season}.json`)) =>
  buildWnbaPlayoffs({ season, events, standingsBody: standings, capturedAt: CAP, now: Date.parse(CAP) }).snapshot;
const res = (data, extra = {}) => ({ ok: true, data: { ...data, freshness: 'CACHED', is_current_season: true, current_season: data.season, available_seasons: [2026, 2025], ...extra }, meta: { freshness: 'CACHED', fetched_at: CAP, semantics: 'X', degraded: [] } });
const text = (h) => String(h);

test('not started (real 2026): TBD slots only, context callout, seed table, no invented matchup, no dead game links', () => {
  const out = text(playoffsView({ res: res(snapOf(2026)), arts: { ok: true, data: { items: [] } }, cov: { ok: true, data: { games: [] } } }));
  assert.match(out, /WNBA Playoffs/);
  assert.match(out, /Live bracket \+ series center/);
  assert.match(out, /has not named the matchups/);
  assert.equal((out.match(/class="brk-s brk-s--tbd"/g) || []).length, 7, '4 + 2 + 1 TBD series slots');
  assert.equal((out.match(/class="brk-col"/g) || []).length, 3);
  assert.doesNotMatch(out, /href="\/cast\/40191/, 'placeholder games do not link to WNBACast');
  assert.equal((out.match(/class="po-seed /g) || []).length, 15);
  assert.match(out, /Minnesota Lynx/);
  assert.match(out, /TBD @ TBD/);
  assert.match(out, /No playoff stories in the newsroom yet/);
  assert.match(out, /Postseason leaders[\s\S]*Not published/);
  assert.match(out, /href="\/standings"/);
});

test('callout never claims matchups are unnamed once the source has named some', () => {
  const s = snapOf(2025, asOf(fx('espn-postseason-2025.json').events, '2025-09-14T12:00:00Z'));
  const out = text(playoffsView({ res: res(s), arts: { ok: false }, cov: { ok: false } }));
  assert.equal(s.status, 'NOT_STARTED');
  assert.doesNotMatch(out, /has not named the matchups/);
  assert.match(out, /4 series are set by the source/);
});

test('complete (real 2025): champion banner + card, every series final, results link to WNBACast', () => {
  const out = text(playoffsView({ res: res(snapOf(2025), { is_current_season: false, current_season: 2026 }), arts: { ok: false }, cov: { ok: false } }, { season: '2025' }));
  assert.match(out, /2025 WNBA Playoffs/);
  assert.match(out, /Not the current postseason/);
  assert.match(out, /2025 WNBA Champion/);
  assert.match(out, /Las Vegas Aces/);
  assert.match(out, /LV wins series 4-0/);
  assert.match(out, /href="\/cast\/401820329"/);
  assert.match(out, /href="\/playoffs"/, 'link back to the current postseason');
  assert.match(out, /The newsroom did not answer/);
});

test('active series card: seeds, wins, pips, next + last game, status', () => {
  const s = snapOf(2025, asOf(fx('espn-postseason-2025.json').events, '2025-09-17T12:00:00Z'));
  const r = s.rounds[0];
  const x = r.series.find((q) => q.higher_seed.abbreviation === 'ATL');
  const out = text(seriesCard(x, r, { gameHref: (g) => `/cast/${g.game_id}` }));
  assert.match(out, /Series tied 1-1/);
  assert.match(out, /Best of 3/);
  assert.match(out, /brk-pips/);
  assert.match(out, /Next · G3/);
  assert.match(out, /Last · G2/);
  assert.match(out, /href="\/cast\/401820320"/);
});

test('mobile-safe long team names: full + abbreviation rendered, CSS clamps and swaps by container width', () => {
  const long = ['9901', 'FXL', 'Fixture Extraordinarily Long Metropolitan Basketball Club of the Greater Region'];
  const snap = buildWnbaPlayoffs({ season: 2031, events: [synthEvent({ home: long })], standingsBody: synthStandings(2031, [['9901', 'FXL', long[2], 1, 30, 10, 'x', 'Clinched Playoff Berth'], ['9902', 'FXB', 'Fixture Bravo', 2, 20, 20, 'x', 'Clinched Playoff Berth']]), capturedAt: CAP }).snapshot;
  const out = text(bracketBoard(snap));
  assert.match(out, /class="brk-full">Fixture Extraordinarily Long/);
  assert.match(out, /class="brk-abbr">FXL/);
  const css = readFileSync(new URL('../src/styles/playoffs.css', import.meta.url), 'utf8');
  assert.match(css, /\.brk-name b \{[^}]*-webkit-line-clamp: 2[^}]*overflow-wrap: anywhere/);
  assert.match(css, /@container \(max-width: 250px\)/);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.brk-cols \{ display: block; \}/, 'narrow screens stack rounds instead of squeezing columns');
  assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)/, 'no horizontal scroller (PropBetEdge no-scrollbar rule)');
});

test('PBE copy matches the runtime lock policy; coverage lists only bracket games', () => {
  assert.equal(PBE_POLICY_COPY.scoring_window_hours, LOCK_POLICY.scoring_window_hours);
  assert.equal(PBE_POLICY_COPY.lock_minutes_before_tip, LOCK_POLICY.lock_minutes_before_tip);
  const s = snapOf(2025, asOf(fx('espn-postseason-2025.json').events, '2025-09-17T12:00:00Z'));
  const out = text(playoffsView({ res: res(s), arts: { ok: true, data: { items: [] } }, cov: { ok: true, data: { games: [{ game_id: '401820320', phase: 'PRE_LOCK' }, { game_id: '401857219', phase: 'LOCKED' }] } } }));
  const pbe = out.slice(out.indexOf('id="pbe"'), out.indexOf('id="news"'));
  assert.match(pbe, /IND @ ATL/);
  assert.doesNotMatch(pbe, /401857219|Call locked/, 'a regular-season game never appears in the playoff PBE module');
});

test('playoff news filter keeps postseason stories from this season only', () => {
  const items = [
    { slug: 'a-000001', headline: 'Lynx take Game 1 of the first round', published_at: '2026-09-28T02:00:00Z' },
    { slug: 'b-000002', headline: 'Unders in 8 of the Lynx’s last 10', published_at: '2026-09-25T00:00:00Z' },
    { slug: 'c-000003', headline: 'Aces win the 2025 WNBA Finals', published_at: '2025-10-11T02:00:00Z' },
    { slug: 'd-000004', headline: 'Dream clinch a playoff berth', published_at: '2026-09-10T00:00:00Z' }
  ];
  assert.deepEqual(playoffStories(items, 2026).map((a) => a.slug), ['a-000001', 'd-000004']);
});

test('playoff picture: states come only from source marks and completed series', () => {
  const rows = pictureRows(snapOf(2025, asOf(fx('espn-postseason-2025.json').events, '2025-09-19T00:30:00Z')));
  const by = Object.fromEntries(rows.map((r) => [r.abbreviation, r.state]));
  assert.equal(by.GS, 'Out · First Round');
  assert.equal(by.MIN, 'Active');
  assert.equal(by.LA, 'Eliminated');
  assert.equal(pictureRows(snapOf(2025)).find((r) => r.abbreviation === 'LV').state, 'Champion');
  assert.equal(pictureRows(snapOf(2026)).find((r) => r.abbreviation === 'NY').state, 'Clinched');
});

test('games flatten in date order across series and placeholder slots', () => {
  const games = allGames(snapOf(2026));
  assert.equal(games.length, 29);
  assert.ok(games.every((g, i) => i === 0 || String(games[i - 1].start_utc) <= String(g.start_utc)));
});

test('route, nav, SEO, sitemap', () => {
  assert.equal(resolveRoute('/playoffs').id, 'playoffs');
  assert.ok(PRIMARY_NAV.some(([id, href]) => id === 'playoffs' && href === '/playoffs'), 'desktop primary nav');
  assert.ok(NAV.some(([id]) => id === 'playoffs'), 'drawer (mobile) nav');
  const m = routeMeta('playoffs', { path: '/playoffs' });
  assert.equal(m.title, 'WNBA Playoffs & Bracket | PropBetEdge');
  assert.match(m.description, /bracket/);
  assert.match(m.description, /series status/);
  assert.match(m.description, /schedule and results/);
  assert.match(m.description, /postseason intelligence/);
  assert.ok(STATIC_PATHS.includes('/playoffs'));
});

test('standings links to the bracket', () => {
  const out = text(standingsView({ res: { ok: true, data: { groups: [], is_current: true, label: '2026', phase: 'Postseason' }, meta: {} } }));
  assert.match(out, /href="\/playoffs"[^>]*>View playoff bracket/);
});

test('wnba-web renders /playoffs server-side (200, title, bracket markup, breadcrumbs); upstream failure is a 503 not a fake page', async () => {
  const api = { playoffs: async () => res(snapOf(2026)), articles: async () => ({ ok: true, data: { items: [] } }), pbeCoverage: async () => ({ ok: true, data: { games: [] } }) };
  const page = await renderRoute('/playoffs', api);
  assert.equal(page.status, 200);
  assert.equal(page.meta.title, 'WNBA Playoffs & Bracket | PropBetEdge');
  assert.match(page.main, /class="brk"/);
  const crumbs = page.graph['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i) => i.name), ['PropBetEdge WNBA', 'WNBA Playoffs & Bracket']);
  assert.ok(page.graph['@graph'].some((n) => n['@type'] === 'CollectionPage'));
  const down = await renderRoute('/playoffs', { ...api, playoffs: async () => ({ ok: false, status: 503, error: { code: 'playoffs_unavailable' } }) });
  assert.equal(down.status, 503);
});
