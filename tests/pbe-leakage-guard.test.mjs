// Prediction-market leakage guard (owner 2026-10-03): Kalshi / Polymarket prices never enter a PBE WNBA model
// input or output. The guard is throw-only and behaviour-neutral (golden over every committed 2026 game).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { assertMarketFree, assertModelSource, findMarketKeys, MarketLeakageError } from '../workers/shared/pbe-leakage-guard.js';
import { predictFromRows, predictGame, MANIFEST } from '../workers/shared/pbe-wnba-model.js';
import { buildFeatures } from '../workers/shared/pbe-wnba-features.js';
import { pbeTask, ROWS_KEY } from '../workers/wnba-ingest/src/pbe-runner.js';
import { computeGolden } from '../scripts/model/leakage-golden.mjs';

const FX = new URL('./fixtures/pbe-wnba-model/', import.meta.url);
const ROWS = zlib.gunzipSync(fs.readFileSync(new URL('rows-2025-2026.jsonl.gz', FX))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const GAMES = JSON.parse(fs.readFileSync(new URL('games-2026.json', FX), 'utf8'));
const asOfFor = (g) => new Date(Date.parse(g.start_utc) - 15 * 60000).toISOString();

test('guard rejects every venue-derived key at any depth; accepts real basketball keys', () => {
  for (const k of ['kalshi_mid', 'polymarket_price', 'best_bid', 'best_ask', 'yes_bid_bp', 'yes_ask_bp', 'midpoint', 'mid', 'mid_bp', 'comparable_mid_bp',
    'spread_bp', 'order_book_depth', 'book_depth', 'last_trade_bp', 'last_price', 'venue_gap_pts', 'consensus_prob', 'market_volume', 'liquidity',
    'token_id', 'condition_id', 'clob_price', 'gamma_event', 'bid', 'ask', 'open_interest', 'prediction_market_prob']) {
    assert.throws(() => assertMarketFree({ features: { nested: [{ [k]: 1 }] } }), MarketLeakageError, k);
  }
  assert.doesNotThrow(() => assertMarketFree({ net_rating: 4.1, rest: 1, availability: 0.9, own: { fgm: 30, fga: 70 }, players: [{ id: '1', min: 30, starter: true }] }));
  assert.deepEqual(findMarketKeys({ a: { venue_mid_bp: 1 } }), ['$.a.venue_mid_bp']);
});

test('no false positive: every committed team-game row, game and feature object passes the guard', () => {
  assert.doesNotThrow(() => assertMarketFree(ROWS));
  assert.doesNotThrow(() => assertMarketFree(GAMES));
  for (const g of GAMES.slice(0, 40)) {
    const f = buildFeatures({ game: g, homeRows: ROWS.filter((r) => r.team_id === g.home_id), awayRows: ROWS.filter((r) => r.team_id === g.away_id), leagueRows: ROWS, asOf: asOfFor(g) });
    assert.doesNotThrow(() => assertMarketFree(f), g.event_id);
  }
});

test('enforced at the model boundary: a venue field on a row, the game or the feature object is refused', () => {
  const g = GAMES[150];
  const poisonedRows = ROWS.map((r, i) => (i === 7 ? { ...r, kalshi_yes_bid_bp: 6100 } : r));
  assert.throws(() => predictFromRows({ game: g, leagueRows: poisonedRows, asOf: asOfFor(g) }), MarketLeakageError);
  assert.throws(() => predictFromRows({ game: { ...g, polymarket: { best_ask_bp: 5200 } }, leagueRows: ROWS, asOf: asOfFor(g) }), MarketLeakageError);
  const f = buildFeatures({ game: g, homeRows: ROWS.filter((r) => r.team_id === g.home_id), awayRows: ROWS.filter((r) => r.team_id === g.away_id), leagueRows: ROWS, asOf: asOfFor(g) });
  assert.throws(() => predictGame({ ...f, all: { ...f.all, consensus_mid: 0.6 } }), MarketLeakageError);
  assert.throws(() => assertModelSource('market_venue_observations?select=*'), MarketLeakageError);
  assert.throws(() => assertModelSource('market_intel_snapshots?select=*'), MarketLeakageError);
  assert.throws(() => assertModelSource('https://propsports-markets.example.workers.dev/admin/kalshi'), MarketLeakageError);
  assert.throws(() => assertModelSource('kalshi:v1:latest'), MarketLeakageError);
  assert.doesNotThrow(() => assertModelSource(ROWS_KEY(2026)));
});

test('golden: guarded model reproduces the pre-guard predictions for all 301 fixture games byte for byte', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('leakage-golden.json', FX), 'utf8'));
  const now = computeGolden();
  assert.equal(now.games, 301);
  assert.equal(now.sha256, golden.sha256);
  assert.deepEqual(now, golden);
  // Frozen identities untouched.
  assert.equal(MANIFEST.files['artifact.json'].slice(0, 8), '180dfcf5');
  assert.equal(MANIFEST.files['feature_spec.json'].slice(0, 8), '83c36ef3');
});

// ---- REGRESSION: radically change BOTH venues' prices everywhere the runner could read them.
function kvStore() {
  const m = new Map();
  return { map: m, async get(k, t) { const v = m.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); } };
}
function eventsFromRows(season) {
  const by = new Map();
  for (const r of ROWS.filter((x) => x.season === season)) {
    if (!by.has(r.event_id)) by.set(r.event_id, { id: r.event_id, date: r.start_utc, season: { year: season, type: r.season_type }, status: { type: { name: 'STATUS_FINAL' } }, competitions: [{ neutralSite: r.neutral, competitors: [] }] });
    by.get(r.event_id).competitions[0].competitors.push({ id: r.team_id, homeAway: r.home_away, score: String(r.pts), team: { abbreviation: r.team_id } });
  }
  return [...by.values()];
}
function scheduled(id, tipIso, home, away) {
  return { id, date: tipIso, season: { year: 2026, type: 2 }, status: { type: { name: 'STATUS_SCHEDULED' } }, competitions: [{ neutralSite: false, competitors: [{ id: home, homeAway: 'home', team: { abbreviation: 'H' } }, { id: away, homeAway: 'away', team: { abbreviation: 'A' } }] }] };
}
const LAST_FINAL = Math.max(...ROWS.filter((r) => r.season === 2026).map((r) => Date.parse(r.start_utc)));
const NOW = LAST_FINAL + 2 * 86400e3;

async function runWith(venue) {
  const kv = kvStore();
  for (const season of [2025, 2026]) {
    const rows = ROWS.filter((r) => r.season === season);
    await kv.put(ROWS_KEY(season), JSON.stringify({ season, rows, event_ids: [...new Set(rows.map((r) => r.event_id))] }));
  }
  const tipLock = new Date(NOW + 14 * 60e3).toISOString();
  const events = { 2025: eventsFromRows(2025), 2026: [...eventsFromRows(2026), scheduled('G_LOCK', tipLock, '20', '18'), scheduled('G_LATER', new Date(NOW + 5 * 3600e3).toISOString(), '9', '17')] };
  // Sportsbook snapshot is held constant; both prediction-market venues ride along on it and in their own stores.
  const latest = { captured_at: new Date(NOW - 3600e3).toISOString(), events: [{ game_id: 'G_LOCK', home_team_id: '20', away_team_id: '18', commence_time: tipLock,
    moneyline: { books: [{ book: 'a', home: -500, away: 380 }, { book: 'b', home: -450, away: 350 }] },
    kalshi: { yes_bid_bp: venue.k[0], yes_ask_bp: venue.k[1], last_price_bp: venue.k[1] }, polymarket: { best_bid_bp: venue.p[0], best_ask_bp: venue.p[1], token_id: 't-20' } }] };
  await kv.put('odds:v1:latest', JSON.stringify(latest));
  await kv.put('kalshi:v1:latest', JSON.stringify({ G_LOCK: { yes_bid_bp: venue.k[0], yes_ask_bp: venue.k[1] } }));
  await kv.put('polymarket:v1:latest', JSON.stringify({ G_LOCK: { best_bid_bp: venue.p[0], best_ask_bp: venue.p[1] } }));
  await kv.put('market_venue_observations', JSON.stringify([{ outcome_id: 'g_lock-20', mid_bp: (venue.p[0] + venue.p[1]) / 2 }]));
  const reads = [];
  const get = kv.get.bind(kv);
  kv.get = async (k, t) => { reads.push(k); return get(k, t); };
  const env = { WNBA_KV: kv, PBE_MODE: 'dry_run' };
  const noSummaries = async (id) => { throw new Error(`summary fetch not expected (${id})`); };
  const summary = await pbeTask(env, { now: NOW, minute: 0, eventsFor: async (y) => events[y] || [], fetchSummary: noSummaries });
  const out = Object.fromEntries([...kv.map.entries()].filter(([k]) => k.startsWith('pbe:v1:')).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { summary, out, reads };
}

test('regression: radical Kalshi + Polymarket price changes leave PBE model inputs and outputs byte-identical', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { throw new Error(`network call in test: ${u}`); };
  t.after(() => { globalThis.fetch = realFetch; });
  const a = await runWith({ k: [100, 300], p: [200, 400] });     // venues say the home side is a 2-4% shot
  const b = await runWith({ k: [9600, 9800], p: [9700, 9900] }); // venues flip to 97-99%
  assert.equal(a.summary.scored, 2);
  assert.equal(a.summary.locks, 1);
  assert.deepEqual(a.summary, b.summary);
  assert.deepEqual(a.reads, b.reads, 'identical store reads');
  assert.ok(!a.reads.some((k) => /kalshi|polymarket|market_venue/.test(k)), 'the runner never reads a venue store');
  const pred = (x) => JSON.parse(x.out['pbe:v1:shadow:pred:G_LOCK']);
  assert.deepEqual(pred(a).feature_vector, pred(b).feature_vector, 'model inputs identical');
  assert.equal(pred(a).feature_hash, pred(b).feature_hash);
  assert.equal(pred(a).p_home, pred(b).p_home);
  assert.equal(JSON.stringify(a.out), JSON.stringify(b.out), 'every PBE document (pred, observation, lock) byte-identical');
});
