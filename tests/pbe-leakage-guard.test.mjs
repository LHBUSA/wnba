// Prediction-market leakage guard (owner 2026-10-03): Kalshi / Polymarket prices never enter a PBE WNBA model
// input or output. The guard is throw-only and behaviour-neutral (golden over every committed 2026 game).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { assertMarketFree, assertModelSource, findMarketKeys, MarketLeakageError } from '../workers/shared/pbe-leakage-guard.js';
import { predictFromRows, predictGame, MANIFEST, ARTIFACT } from '../workers/shared/pbe-wnba-model.js';
import { buildFeatures } from '../workers/shared/pbe-wnba-features.js';
import { pbeTask, ROWS_KEY } from '../workers/wnba-ingest/src/pbe-runner.js';
import { computeGolden } from '../scripts/model/leakage-golden.mjs';
import { createHash } from 'node:crypto';

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

// Seeded PRNG (mulberry32) so the "random" perturbation is reproducible.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// A venue perturbation: every Kalshi / Polymarket price field set by `price()` (basis points, 0..10000).
function venueBlock(price) {
  const k = { yes_bid_bp: price(), yes_ask_bp: price(), no_bid_bp: price(), no_ask_bp: price(), last_price_bp: price(), mid_bp: price(), spread_bp: price(), volume: price(), open_interest: price(), liquidity: price() };
  const p = { best_bid_bp: price(), best_ask_bp: price(), midpoint_bp: price(), last_trade_bp: price(), spread_bp: price(), volume: price(), liquidity: price(), token_id: 't-20', condition_id: 'c-1', order_book: { bids: [[price(), price()]], asks: [[price(), price()]] } };
  return { kalshi: k, polymarket: p, consensus: { mid_bp: price() } };
}
const PERTURB = {
  zero: () => venueBlock(() => 0),          // every price 0c
  ninetynine: () => venueBlock(() => 9900), // every price 99c
  random: () => { const r = rng(20261003); return venueBlock(() => Math.floor(r() * 10001)); }
};

async function runWith(venue) {
  const kv = kvStore();
  for (const season of [2025, 2026]) {
    const rows = ROWS.filter((r) => r.season === season);
    await kv.put(ROWS_KEY(season), JSON.stringify({ season, rows, event_ids: [...new Set(rows.map((r) => r.event_id))] }));
  }
  const tipLock = new Date(NOW + 14 * 60e3).toISOString();
  const events = { 2025: eventsFromRows(2025), 2026: [...eventsFromRows(2026), scheduled('G_LOCK', tipLock, '20', '18'), scheduled('G_LATER', new Date(NOW + 5 * 3600e3).toISOString(), '9', '17')] };
  // Sportsbook snapshot is held constant. When perturbed, both prediction-market venues ride along on the
  // market rows (extra venue fields), in their own KV stores, and behind a fake venue service binding.
  const ev = { game_id: 'G_LOCK', home_team_id: '20', away_team_id: '18', commence_time: tipLock, moneyline: { books: [{ book: 'a', home: -500, away: 380 }, { book: 'b', home: -450, away: 350 }] } };
  const latest = { captured_at: new Date(NOW - 3600e3).toISOString(), events: [venue ? { ...ev, ...venue } : ev] };
  await kv.put('odds:v1:latest', JSON.stringify(latest));
  const venueCalls = [];
  const env = { WNBA_KV: kv, PBE_MODE: 'dry_run' };
  if (venue) {
    await kv.put('kalshi:v1:latest', JSON.stringify({ G_LOCK: venue.kalshi }));
    await kv.put('polymarket:v1:latest', JSON.stringify({ G_LOCK: venue.polymarket }));
    await kv.put('market_venue_observations', JSON.stringify([{ outcome_id: 'g_lock-20', ...venue.polymarket }]));
    await kv.put('market_intel_snapshots', JSON.stringify([{ event: 'G_LOCK', ...venue.kalshi }]));
    const svc = (name) => ({ fetch: async (u) => { venueCalls.push(`${name} ${u?.url || u}`); return new Response(JSON.stringify(venue), { headers: { 'content-type': 'application/json' } }); } });
    env.MARKETS = svc('MARKETS');       // propsports-markets (/kalshi/*, /polymarket/*, /admin/kalshi)
    env.PROPSPORTS_MARKETS = svc('PROPSPORTS_MARKETS');
    env.POLYMARKET = svc('POLYMARKET');
    env.KALSHI = svc('KALSHI');
  }
  const reads = [];
  const get = kv.get.bind(kv);
  kv.get = async (k, t) => { reads.push(k); return get(k, t); };
  const noSummaries = async (id) => { throw new Error(`summary fetch not expected (${id})`); };
  const summary = await pbeTask(env, { now: NOW, minute: 0, eventsFor: async (y) => events[y] || [], fetchSummary: noSummaries });
  const out = Object.fromEntries([...kv.map.entries()].filter(([k]) => k.startsWith('pbe:v1:')).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { summary, out, reads, venueCalls };
}

const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const MODEL_OUT = ['model', 'call', 'no_call_reason', 'no_call_detail', 'p_home', 'p_away', 'pick_team_id', 'pick_probability', 'confidence', 'eligibility', 'flags', 'contributions', 'reasoning', 'teams_state', 'feature_hash'];

test('INVARIANT: Kalshi + Polymarket at 0c, 99c and seeded random leave every PBE feature and forecast byte-identical to the unperturbed run', async (t) => {
  const realFetch = globalThis.fetch;
  const netCalls = [];
  globalThis.fetch = async (u) => { netCalls.push(String(u?.url || u)); throw new Error(`network call in test: ${u}`); };
  t.after(() => { globalThis.fetch = realFetch; });
  const base = await runWith(null);
  assert.equal(base.summary.scored, 2);
  assert.equal(base.summary.locks, 1);
  for (const game of ['G_LOCK', 'G_LATER']) {
    const doc = JSON.parse(base.out[`pbe:v1:shadow:pred:${game}`]);
    assert.equal(doc.feature_vector.length, ARTIFACT.feature_order.length, game);
  }
  for (const [name, make] of Object.entries(PERTURB)) {
    const run = await runWith(make());
    assert.deepEqual(run.venueCalls, [], `${name}: nothing called the fake venue services`);
    assert.ok(!run.reads.some((k) => /kalshi|polymarket|market_venue|market_intel/.test(k)), `${name}: no venue store read`);
    assert.deepEqual(run.reads, base.reads, `${name}: identical store reads`);
    assert.deepEqual(run.summary, base.summary, name);
    for (const game of ['G_LOCK', 'G_LATER']) {
      const a = JSON.parse(base.out[`pbe:v1:shadow:pred:${game}`]);
      const b = JSON.parse(run.out[`pbe:v1:shadow:pred:${game}`]);
      assert.equal(sha(b.feature_vector), sha(a.feature_vector), `${name} ${game}: feature vector sha256`);
      assert.equal(JSON.stringify(b.feature_vector), JSON.stringify(a.feature_vector));
      const outA = Object.fromEntries(MODEL_OUT.map((k) => [k, a[k]]));
      const outB = Object.fromEntries(MODEL_OUT.map((k) => [k, b[k]]));
      assert.equal(sha(outB), sha(outA), `${name} ${game}: model output sha256`);
    }
    // Every PBE document written (prediction, observation, lock) is byte-identical too.
    assert.equal(sha(run.out), sha(base.out), `${name}: all PBE documents`);
  }
  assert.deepEqual(netCalls, []);
});
