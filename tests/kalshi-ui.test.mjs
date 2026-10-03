// Kalshi Market Intelligence on WNBA: shared component vendored unchanged; no entry -> nothing; every price links to
// Kalshi (rel sponsored); both teams of a WNBA game render; the browser talks only to the owned markets Worker;
// server-rendered routes are unchanged by the client-only card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRoute, composeDocument } from '../workers/wnba-web/src/render.js';
import { matchupView } from '../src/views/matchups.js';
import { gameCard } from '../src/ui/components.js';
import { kalshiCard, kalshiStrip, kalshiLine } from '../src/vendor/kalshi/kalshi-market-ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// A real board entry shape from GET /v1/market-intelligence/sport/wnba (2026-10-03, Finals game 1, NY @ ATL).
const URL_ = 'https://kalshi.com/markets/kxwnbagame/women-s-pro-basketball-game/kxwnbagame-26oct04nyatl';
const ENTRY = {
  event: { sport: 'wnba', competition: 'wnba', canonical_event_id: '401918295', start_at: '2026-10-04T18:00:00+00:00', state: 'pre' },
  kalshi: {
    source: 'kalshi', source_type: 'prediction_market', label: 'Kalshi', market_url: URL_, event_ticker: 'KXWNBAGAME-26OCT04NYATL',
    proposition: 'team_wins_game', state: 'open', freshness: 'delayed', age_seconds: 252,
    outcomes: [
      { role: 'away', team_id: '9', abbr: 'NY', kalshi_name: 'New York', contract: 'New York wins', market_ticker: 'KXWNBAGAME-26OCT04NYATL-NY', state: 'open', result: null, best_yes_bid_bp: 4000, best_yes_ask_bp: 4100, last_price_bp: 4100, mid_bp: 4050, volume: 2007.54, open_interest: 2007.54, spread_bp: 100, displayable: true },
      { role: 'home', team_id: '20', abbr: 'ATL', kalshi_name: 'Atlanta', contract: 'Atlanta wins', market_ticker: 'KXWNBAGAME-26OCT04NYATL-ATL', state: 'open', result: null, best_yes_bid_bp: 5900, best_yes_ask_bp: 6000, last_price_bp: 6000, mid_bp: 5950, volume: 1044.94, open_interest: 1044.94, spread_bp: 100, displayable: true }
    ]
  },
  sportsbooks: null, pbe: null, comparisons: []
};
const GAME = { game_id: '401918295', start_utc: '2026-10-04T18:00Z', status: { state: 'pre', name: 'STATUS_SCHEDULED' }, home: { team_id: '20', abbr: 'ATL', name: 'Atlanta Dream', short_name: 'Dream', score: null }, away: { team_id: '9', abbr: 'NY', name: 'New York Liberty', short_name: 'Liberty', score: null }, venue: { name: 'State Farm Arena', city: 'Atlanta' }, market: null };
const FINAL = { ...GAME, status: { state: 'post', name: 'STATUS_FINAL' }, home: { ...GAME.home, score: 80 }, away: { ...GAME.away, score: 77 } };

// Minimal SSR api for the matchup + sources routes.
const FETCHED = new Date().toISOString();
const ok = (data) => ({ ok: true, status: 200, data, meta: { fetched_at: FETCHED } });
const side = (t) => ({ team: t, standing: null, form: { last10: [], record_last10: '5-5', avg_margin_last10: 1, sample: 10 }, schedule_context: { rest_days: 2, back_to_back: false, games_last_7_days: 1, method: 'm' }, pace: null, season_stats: {}, availability: [], rotation: { rows: [], sample: 5, method: 'm' } });
const matchup = { game: GAME, teams: [side(GAME.away), side(GAME.home)], market_summary: null, market_history: [] };
const ssrApi = {
  matchup: async () => ok(matchup),
  articles: async () => ok({ items: [], total: 0 }),
  statsWinba: async () => ok({ rows: [] }),
  schedule: async () => ok({ games: [GAME] }),
  today: async () => ok({ slate: { kind: 'NEXT', date: '20261004', games: [GAME], summary: { live: 0 } } }),
  newsSources: async () => ({ ok: false })
};

// ------------------------------------------------------------ SSR first (before the client module installs anything)

test('SSR: the publishing Worker matchup route renders with no Kalshi markup and is identical to the plain view', async () => {
  const p = await renderRoute('/matchups/401918295', ssrApi);
  assert.equal(p.status, 200);
  const doc = composeDocument(read('index.html'), p);
  assert.doesNotMatch(doc, /kx-slot|data-kx-|kalshi/i);
  // The optional client slot is additive: omitted -> byte-identical to the pre-Kalshi view call.
  const plain = String(matchupView({ res: ok(matchup), arts: ok({ items: [] }), winba: ok({ rows: [] }) }));
  const withEmpty = String(matchupView({ res: ok(matchup), arts: ok({ items: [] }), winba: ok({ rows: [] }), kalshi: '' }));
  assert.equal(withEmpty, plain);
  const list = await renderRoute('/matchups', ssrApi);
  assert.doesNotMatch(String(list.body ?? composeDocument(read('index.html'), list)), /gc2-kx|kx-line/);
});

test('SSR: /sources carries the Kalshi registry row with prediction-market labelling', async () => {
  const p = await renderRoute('/sources', ssrApi);
  const t = text(composeDocument(read('index.html'), p));
  assert.match(t, /Kalshi prediction market/);
  assert.match(t, /not sportsbook odds and not a PropBetEdge model/);
  assert.match(t, /every price links to that market on Kalshi/);
  assert.match(t, /Mid-market is the midpoint of the best YES bid and the best YES ask/);
  assert.match(t, /only snapshots PropBetEdge actually observed/);
});

test('the publishing Worker never imports the client Kalshi module', () => {
  for (const dir of ['src/views', 'src/ui', 'src/lib', 'src/seo', 'workers']) {
    const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${d}/${e.name}`)) : e.name.endsWith('.js') ? [`${d}/${e.name}`] : []));
    for (const f of walk(dir)) assert.doesNotMatch(read(f), /(?:from|import\()\s*['"][^'"]*(?:data\/kalshi\.js|vendor\/kalshi\/)/, f);
  }
});

// ------------------------------------------------------------ component

test('no entry -> nothing (card, strip, line, game card)', () => {
  assert.equal(kalshiCard(null, { placement: 'x' }), '');
  assert.equal(kalshiStrip(null), '');
  assert.equal(kalshiLine(null), '');
  assert.equal(kalshiCard({ ...ENTRY, kalshi: { ...ENTRY.kalshi, market_url: '' } }, { placement: 'x' }), '');
  assert.doesNotMatch(String(gameCard(GAME)), /gc2-kx|kx-line/);
});

test('WNBA entry renders both teams with Mid-market, bid, ask and prediction-market labelling', () => {
  const t = text(kalshiCard(ENTRY, { placement: 'matchup-page' }));
  assert.match(t, /NY New York wins · YES 40\.5¢ Mid-market/);
  assert.match(t, /ATL Atlanta wins · YES 59\.5¢ Mid-market/);
  assert.match(t, /Bid 40¢ Ask 41¢ Last 41¢/);
  assert.match(t, /Delayed · Updated 4 min ago/);
  assert.match(t, /not sportsbook odds and not a PropBetEdge model/);
  assert.doesNotMatch(t, /win probability|chance to win|PBE prediction/i);
});

test('every Kalshi link opens the verified market in a new tab with rel sponsored', () => {
  for (const h of [kalshiCard(ENTRY, { placement: 'matchup-page' }), kalshiStrip(ENTRY, { placement: 'wnbacast-strip' })]) {
    const anchors = h.match(/<a [^>]*>/g) || [];
    assert.ok(anchors.length >= 3);
    for (const a of anchors) {
      assert.ok(a.includes(`href="${URL_}"`), a);
      assert.match(a, /target="_blank"/);
      assert.match(a, /rel="noopener noreferrer sponsored"/);
    }
  }
});

test('vendored files are byte-identical to the shared client when the canonical checkout is present', () => {
  const canon = path.resolve(ROOT, '..', '..', 'propbetedge-workers', 'workers', 'propsports-markets', 'client');
  const alt = 'D:/Workers/propbetedge-workers/workers/propsports-markets/client';
  const dir = fs.existsSync(canon) ? canon : fs.existsSync(alt) ? alt : null;
  if (!dir) return; // CI has no sibling checkout; the vendor header names the canonical source.
  for (const f of ['kalshi-market-ui.js', 'kalshi-market-ui.css', 'kalshi-market-client.js']) {
    assert.equal(read(`src/vendor/kalshi/${f}`), fs.readFileSync(path.join(dir, f), 'utf8'), f);
  }
});

// ------------------------------------------------------------ client data module

test('client: board -> restrained line on not-final game cards only; nothing for a final or an unmatched game', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ contract: 'market-intel/1', sport: 'wnba', enabled: true, events: [ENTRY] }) }; };
  try {
    const { kalshi, MARKETS_BASE, kalshiLineFor } = await import('../src/data/kalshi.js');
    assert.equal(MARKETS_BASE, 'https://propsports-markets.sales-fd3.workers.dev');
    await kalshi.loadBoard({ force: true });
    assert.deepEqual(calls, ['https://propsports-markets.sales-fd3.workers.dev/v1/market-intelligence/sport/wnba']);
    const card = String(gameCard(GAME));
    assert.match(card, /<div class="gc2-kx"><span class="kx-line mono"/);
    assert.match(text(card), /KALSHI NY 40\.5¢ · ATL 59\.5¢/);
    assert.doesNotMatch(String(gameCard(FINAL)), /gc2-kx/);
    assert.equal(kalshiLineFor({ ...GAME, game_id: '999' }), '');
    assert.equal(kalshi.pollMsFor('live'), 20000);
    assert.equal(kalshi.pollMsFor('pregame'), 45000);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('matchup page slot: full card when an entry exists, empty (zero-height) slot otherwise', async () => {
  const { matchupKalshiSlot } = await import('../src/data/kalshi.js');
  assert.match(String(matchupKalshiSlot(ENTRY, GAME)), /^<div class="kx-slot kx-slot--matchup" data-kx-slot><section class="ic kx"/);
  assert.equal(String(matchupKalshiSlot(null, GAME)), '<div class="kx-slot kx-slot--matchup" data-kx-slot></div>');
  const view = String(matchupView({ res: ok(matchup), arts: ok({ items: [] }), winba: ok({ rows: [] }), kalshi: matchupKalshiSlot(ENTRY, GAME) }));
  // Its own block, directly after the sportsbook Line context section (which is unchanged).
  assert.match(view, /Line context[\s\S]*?<\/section><div class="kx-slot kx-slot--matchup"/);
});

// ------------------------------------------------------------ doctrine

test('browser code never names a Kalshi API host; guard-truth blocks them', () => {
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(js|html|css)$/.test(e.name) ? [`${d}/${e.name}`] : []));
  for (const f of [...walk('src'), 'index.html']) {
    const t = read(f);
    assert.doesNotMatch(t, /https?:\/\/(?:[a-z0-9-]+\.)*kalshi\.com\/(?:trade-api|v\d)|(?:api\.elections|trading-api|demo-api|external-api)\.kalshi\.com/i, f);
  }
  const guard = read('scripts/guard-truth.mjs');
  assert.match(guard, /kalshi/);
});
