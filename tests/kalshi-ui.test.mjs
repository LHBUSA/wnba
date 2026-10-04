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
  // The real entry is 'delayed': since ad6187a the subtitle says "Live prediction market" only for a live-fresh quote.
  assert.match(t, /^Market Pulse Prediction market · Kalshi Delayed/);
  assert.match(text(kalshiCard({ ...ENTRY, kalshi: { ...ENTRY.kalshi, freshness: 'live', age_seconds: 30 } }, { placement: 'matchup-page' })), /^Market Pulse Live prediction market · Kalshi/);
  assert.match(text(kalshiCard({ ...ENTRY, kalshi: { ...ENTRY.kalshi, freshness: 'stale', age_seconds: 900 } }, { placement: 'matchup-page' })), /^Market Pulse Prediction market · quote not current · Kalshi Stale/);
  assert.match(t, /Live prediction-market pricing — no sportsbook line required\. Traded contract prices on Kalshi/);
  assert.match(text(kalshiStrip(ENTRY, { placement: 'wnbacast-strip' })), /^Market Pulse [\s\S]*Live prediction-market expectations — no sportsbook line required · Kalshi/);
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
    // line-ending-insensitive: a Windows checkout of the canonical repo may be CRLF; byte identity is pinned below
    const lf = (s) => s.replace(/\r\n/g, '\n');
    assert.equal(lf(read(`src/vendor/kalshi/${f}`)), lf(fs.readFileSync(path.join(dir, f), 'utf8')), f);
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

test('CSP connect-src allows the owned markets Worker and no Kalshi host (Vercel + publishing Worker identical)', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers.flatMap((g) => g.headers || []).find((h) => h.key === 'Content-Security-Policy').value;
  const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
  assert.ok(connect.split(' ').includes('https://propsports-markets.sales-fd3.workers.dev'));
  assert.doesNotMatch(csp, /kalshi/i);
  for (const f of ['workers/wnba-web/src/index.js', 'workers/wnba-web/src/index-historical.js']) {
    assert.equal(read(f).match(/'content-security-policy': "([^"]+)"/)?.[1], csp, f);
  }
});

// ------------------------------------------------------------ market history ("How the market closed")
// SETTLED fixture: the real settled payload from GET /v1/market-intelligence/event (tennis, 2026-10-03), reshaped only
// in sport / ids / names / tickers to this WNBA game.
const SETTLED = JSON.parse(read('tests/fixtures/kalshi/market-history-settled.json')).event;
const CLOSED = (() => {
  const e = structuredClone(SETTLED);
  e.market.lifecycle = 'CLOSED';
  e.market.close.lifecycle = 'CLOSED';
  for (const o of e.market.close.outcomes) o.result = null;
  e.market_history.lifecycle = 'CLOSED';
  e.market_history.status_label = 'Market closed';
  e.market_history.markers.settlement = null;
  for (const o of e.market_history.outcomes) o.settlement = null;
  return e;
})();

test('history: SETTLED renders "How the market closed" with stored values and the venue settlement', async () => {
  const { matchupKalshiSlot } = await import('../src/data/kalshi.js');
  const h = String(matchupKalshiSlot(SETTLED, FINAL));
  assert.match(h, /data-kx-history/);
  const t = text(h);
  assert.match(t, /^How the market closed Market history · Kalshi Market settled/);
  assert.match(t, /NY New York wins First observed 94\.5¢ Final trade 1¢ Settled NO/);
  assert.match(t, /ATL Atlanta wins First observed 5\.5¢ Final trade 99¢ Settled YES/);
  assert.match(t, /Kalshi settlement: ATL — YES/);
  assert.match(t, /“First observed” is our first record, not the opening price/);
  assert.match(t, /not sportsbook odds and not a PropBetEdge model/);
  assert.doesNotMatch(t, /\bopen(?:ing)? price\b(?! ?\.)|Kalshi intelligence|more accurate|earlier than|stale sportsbook/i);
  assert.match(h, /<svg [^>]*role="img"/);
  assert.doesNotMatch(h, /style="/); // strict CSP: no inline styles
});

test('history: CLOSED shows "awaiting settlement", never a settlement', async () => {
  const { matchupKalshiSlot } = await import('../src/data/kalshi.js');
  const t = text(matchupKalshiSlot(CLOSED, FINAL));
  assert.match(t, /Market closed · awaiting settlement/);
  assert.match(t, /Awaiting settlement/);
  assert.doesNotMatch(t, /Settled (YES|NO)|settlement: /);
});

test('history: no entry or no history -> nothing (no placeholder box)', async () => {
  const { matchupKalshiSlot, kalshiLineFor } = await import('../src/data/kalshi.js');
  assert.equal(String(matchupKalshiSlot(null, FINAL)), '<div class="kx-slot kx-slot--matchup" data-kx-slot></div>');
  assert.equal(kalshiLineFor({ ...FINAL, game_id: '999' }), '');
  // CLOSED lifecycle without market_history falls back to the (live) card path, which renders nothing without prices.
  const { marketHistoryCard } = await import('../src/vendor/kalshi/kalshi-market-ui.js');
  assert.equal(marketHistoryCard({ ...SETTLED, market_history: null }), '');
  assert.match(read('src/styles/kalshi.css'), /\.kx-slot:empty \{ display: none; \}/);
});

test('history: every link is the verified Kalshi market with rel sponsored', async () => {
  const { matchupKalshiSlot } = await import('../src/data/kalshi.js');
  const h = String(matchupKalshiSlot(SETTLED, FINAL));
  const anchors = h.match(/<a [^>]*>/g) || [];
  assert.ok(anchors.length >= 1);
  for (const a of anchors) {
    assert.ok(a.includes(`href="${URL_}"`), a);
    assert.match(a, /rel="noopener noreferrer sponsored"/);
  }
});

test('history: FINAL result cards carry the restrained market-close line from the board, only when recorded', async () => {
  const realFetch = globalThis.fetch;
  const boardEntry = { ...SETTLED, market_history: undefined };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ contract: 'market-intel/1', sport: 'wnba', enabled: true, events: [boardEntry] }) });
  try {
    const { kalshi } = await import('../src/data/kalshi.js');
    await kalshi.loadBoard({ force: true });
    const card = String(gameCard(FINAL));
    assert.match(card, /<div class="gc2-kx"><span class="kx-line kx-line--closed mono"/);
    assert.match(text(card), /MARKET ATL first 5\.5¢ · settled YES/);
    assert.doesNotMatch(text(card), /open(?:ing)? price/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('history: poll policy — live 20 s, pregame 45 s, CLOSED 5 min until SETTLED, SETTLED never', async () => {
  const { marketPollMs } = await import('../src/data/kalshi.js');
  assert.equal(marketPollMs({ status: { state: 'in' } }, ENTRY), 20000);
  assert.equal(marketPollMs(GAME, ENTRY), 45000);
  assert.equal(marketPollMs(FINAL, CLOSED), 300000);
  assert.equal(marketPollMs(FINAL, SETTLED), 0);
  assert.equal(marketPollMs(FINAL, null), 0);
  assert.equal(marketPollMs(FINAL, { ...ENTRY, market: { lifecycle: 'ACTIVE' } }), 300000);
});

test('history: the event page mounts the market module for FINAL games; WNBACast replay shows it under the controls', () => {
  const mu = read('src/pages/matchups.js');
  assert.match(mu, /matchupKalshiSlot\(kxFirst \?\? null, g\)/);
  assert.doesNotMatch(mu, /state === 'idle'\) return/); // finals are no longer skipped
  assert.match(mu, /within\(kxLoad, 800\)/);
  const cast = read('src/pages/cast.js').split('\r\n').join('\n');
  // MLB PBEcast standard: ONE slot directly under the scoreboard (live, pre-game and replay alike).
  // Algo vs Market (its own slot) sits directly under Market Pulse, still above the share row.
  assert.match(cast, /<\/section>\n      \$\{kalshiSlot\(g\)\}\n      \$\{avmSlot\(g\)\}\n      <div class="share-row">/);
  assert.equal((cast.match(/kalshiSlot\(/g) || []).length, 2, 'declared once, mounted once');
  assert.match(read('src/data/kalshi.js'), /isMarketDone\(entry\) && entry\.market_history \? marketHistoryCard\(entry, \{ placement: 'wnbacast-history' \}\)/);
  assert.match(read('src/data/kalshi.js'), /marketModule\(entry, \{ placement: 'matchup-page'/);
});

test('vendored client bytes are pinned (sha256 @ propbetedge-workers 64ca257)', async () => {
  const { createHash } = await import('node:crypto');
  const pins = {
    'kalshi-market-client.js': 'bbab54f78382f336a149b18f332bc54abe0b9c471ada3dd8ef0d67e5e5706301',
    'kalshi-market-ui.css': 'df81df5650cc66d0bcea37c2808eaf783522ad9f921449e954f590d4ad9a2c60',
    'kalshi-market-ui.js': '639f834c27bffed519d37eea4066d3b31e5699f7215d6ea5c07e23c2591ccc48'
  };
  for (const [f, sha] of Object.entries(pins)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/vendor/kalshi', f))).digest('hex'), sha, f);
});

// ------------------------------------------------------------ permanent regression (mirrors propbetedge-workers a229028)
// A completed matched game with NO current quote (kalshi: null), observations present and a CLOSED/SETTLED lifecycle
// must survive this product's board and event loaders and render as market history — never as a live card.
test('regression: completed entry with kalshi:null survives the WNBA loaders and renders history', async () => {
  const { kalshi, kalshiLineFor, matchupKalshiSlot, isMarketDone } = await import('../src/data/kalshi.js');
  const { kalshiCard: liveCard, kalshiStrip: liveStrip } = await import('../src/vendor/kalshi/kalshi-market-ui.js');
  const realFetch = globalThis.fetch;
  for (const done of [SETTLED, CLOSED]) {
    const entry = { ...structuredClone(done), kalshi: null };
    const boardEntry = { ...entry, market_history: undefined };
    globalThis.fetch = async (url) => ({ ok: true, json: async () => (/\/event\//.test(String(url))
      ? { contract: 'market-intel/1', sport: 'wnba', enabled: true, event: entry }
      : { contract: 'market-intel/1', sport: 'wnba', enabled: true, events: [boardEntry] }) });
    try {
      await kalshi.loadBoard({ force: true });
      assert.ok(kalshi.forEvent('401918295'), 'board dropped the completed entry');
      const got = await kalshi.loadEvent('401918295', { force: true });
      assert.ok(got, 'event read nulled the completed entry');
      assert.ok(isMarketDone(got));
      const h = String(matchupKalshiSlot(got, FINAL));
      assert.match(h, /How the market closed/);
      assert.equal((h.match(/class="kx-h__row[" ]/g) || []).length, 2);
      assert.equal(liveCard(got, { placement: 'x' }), '');
      assert.equal(liveStrip(got, { placement: 'x' }), '');
      if (done === CLOSED) { assert.match(h, /awaiting settlement/i); assert.doesNotMatch(h, /Settled (YES|NO)/); }
      else assert.match(text(h), /Kalshi settlement: ATL — YES/);
      // Result card: compact close line, never the live "KALSHI" line — even if the game clock were not final.
      for (const g of [FINAL, GAME]) {
        const line = kalshiLineFor(g);
        assert.match(line, /kx-line--closed/);
        assert.doesNotMatch(text(line), /^KALSHI|\bLIVE\b/);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

test('regression: WNBACast renders a closed/settled market as history (never a live card or strip)', async () => {
  const { castMarketMarkup } = await import('../src/data/kalshi.js');
  for (const done of [SETTLED, CLOSED]) {
    const h = castMarketMarkup({ ...structuredClone(done), kalshi: null }, FINAL);
    assert.match(h, /How the market closed/);
    assert.doesNotMatch(h, /Market Pulse|<details/);
  }
});

test('WNBACast market module: lifecycle labels over the full compact card; stale never LIVE; history once closed', async () => {
  const { castMarketMarkup, castMarketPhase } = await import('../src/data/kalshi.js');
  const g = (state) => ({ ...GAME, status: { ...(GAME.status || {}), state } });
  assert.equal(castMarketPhase(null, g('pre')), null);
  assert.deepEqual(castMarketPhase(ENTRY, g('pre')), ['pre', 'MARKET OPEN · PRE-MATCH']);
  assert.deepEqual(castMarketPhase(ENTRY, g('in')), ['live', 'LIVE MARKET']);
  assert.deepEqual(castMarketPhase({ ...ENTRY, kalshi: { ...ENTRY.kalshi, freshness: 'stale' } }, g('in')), ['stale', 'MARKET OPEN · QUOTE STALE']);
  assert.deepEqual(castMarketPhase({ ...ENTRY, market: { ...(ENTRY.market || {}), lifecycle: 'ACTIVE' } }, g('post')), ['final-open', 'GAME FINAL · MARKET STILL TRADING']);
  assert.deepEqual(castMarketPhase(CLOSED, FINAL), ['closed', 'MARKET CLOSED · AWAITING SETTLEMENT']);
  assert.deepEqual(castMarketPhase(SETTLED, FINAL), ['settled', 'MARKET SETTLED']);
  const live = castMarketMarkup(ENTRY, g('in'));
  assert.match(text(live), /^LIVE MARKET Market Pulse/);
  assert.match(live, /class="ic kx kx--compact"[^>]*data-kx-placement="wnbacast"/);
  assert.match(text(live), /Mid-market/);
  assert.match(live, /rel="noopener noreferrer sponsored"/);
  assert.doesNotMatch(live, /<details/);
  assert.match(text(castMarketMarkup(SETTLED, FINAL)), /^MARKET SETTLED How the market closed/);
  assert.equal(castMarketMarkup({ ...ENTRY, event: { ...ENTRY.event, canonical_event_id: '1' } }, g('in')), '', 'another game');
});

test('Today ticker: market segment only for exact, displayable, fresh two-sided markets; patched in place', async () => {
  const { tickerMarketText, patchTickerMarket } = await import('../src/data/kalshi.js');
  const g = (state, ids = [GAME.away.team_id, GAME.home.team_id]) => ({ ...GAME, status: { ...(GAME.status || {}), state }, away: { ...GAME.away, team_id: ids[0] }, home: { ...GAME.home, team_id: ids[1] } });
  const t = tickerMarketText(ENTRY, g('pre'));
  assert.match(t, /^[A-Z]{2,4} \d+\.\d¢ · [A-Z]{2,4} \d+\.\d¢$/);
  assert.equal(tickerMarketText(ENTRY, g('in')), t);
  assert.equal(tickerMarketText(ENTRY, g('post')), '', 'final: no segment');
  assert.equal(tickerMarketText(ENTRY, g('pre', [GAME.home.team_id, GAME.away.team_id])), '', 'team ids must match away / home');
  assert.equal(tickerMarketText({ ...ENTRY, kalshi: { ...ENTRY.kalshi, freshness: 'stale' } }, g('in')), '', 'stale');
  assert.equal(tickerMarketText(SETTLED, g('in')), '', 'closed / settled never as a live price');
  let inserted = '';
  patchTickerMarket({ querySelector: () => null, insertAdjacentHTML: (_, h) => { inserted = h; } }, 'NY 40.5¢ · ATL 59.5¢');
  assert.match(inserted, /^<span class="tk-mkt"[^>]*><b>MKT<\/b>NY 40\.5¢ · ATL 59\.5¢<\/span>$/);
  const el = { textContent: 'MKTNY 40.5¢ · ATL 59.5¢', innerHTML: '', remove() { this.removed = true; } };
  patchTickerMarket({ querySelector: () => el }, 'NY 41.0¢ · ATL 59.0¢');
  assert.equal(el.innerHTML, '<b>MKT</b>NY 41.0¢ · ATL 59.0¢');
  patchTickerMarket({ querySelector: () => el }, '');
  assert.ok(el.removed);
  assert.match(read('src/pages/today.js'), /const \[data\] = await Promise\.all\(\[loadToday\(api\), kalshi\.loadBoard\(\)\]\);[\s\S]*applyTickerMarkets\(root,/);
});
