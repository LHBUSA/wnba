// wnba-api GET /v1/playoffs: envelope, freshness semantics, prior-season labelling, degraded states.
// Drives the real Worker entrypoint against an in-memory KV; snapshots are built from the real captures.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/wnba-api/src/index-premium.js';
import { buildWnbaPlayoffs } from '../workers/shared/playoffs-wnba.js';
import { fx } from './fixtures/playoffs/scenarios.mjs';

function memKV(entries = {}) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return { map, async get(k, t) { const v = map.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { map.set(k, String(v)); } };
}
const ctx = { waitUntil() {} };
const call = async (path, env) => {
  const res = await worker.fetch(new Request(`https://wnba-api.test${path}`), env, ctx);
  return { status: res.status, headers: res.headers, body: await res.json() };
};

const snap = (season, capturedAt) => buildWnbaPlayoffs({ season, events: fx(`espn-postseason-${season}.json`).events, standingsBody: fx(`espn-standings-league-${season}.json`), capturedAt, now: Date.parse(capturedAt) }).snapshot;
const recent = () => new Date(Date.now() - 60e3).toISOString();

function envWith({ s26 = snap(2026, recent()), s25 = snap(2025, recent()), checked26 = { checked_at: recent() }, status = { ok: true, season: 2026 } } = {}) {
  return {
    WNBA_KV: memKV({
      'playoffs:v1:current': { season: 2026 },
      'playoffs:v1:seasons': [2026, 2025],
      'playoffs:v1:2026': s26,
      'playoffs:v1:checked:2026': checked26,
      'playoffs:v1:2025': s25,
      'playoffs:v1:status': status
    })
  };
}

test('/health lists /v1/playoffs', async () => {
  const r = await call('/health', { WNBA_KV: memKV() });
  assert.ok(r.body.routes.includes('/v1/playoffs'));
  assert.equal(r.body.version, '1.2.0');
});

test('current postseason not started: envelope, CACHED, POSTSEASON_NOT_STARTED, season 2026, CORS open', async () => {
  const r = await call('/v1/playoffs', envWith());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.meta.semantics, 'POSTSEASON_NOT_STARTED');
  assert.equal(r.body.meta.freshness, 'CACHED');
  assert.equal(r.body.data.freshness, 'CACHED');
  assert.deepEqual(r.body.meta.season, { year: 2026, type: 3, label: '2026 Postseason' });
  assert.equal(r.body.data.is_current_season, true);
  assert.deepEqual(r.body.data.available_seasons, [2026, 2025]);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.body.meta.source.id, 'espn');
  for (const k of ['season', 'phase', 'status', 'updated_at', 'seeds', 'rounds', 'champion', 'source', 'source_updated_at', 'freshness']) assert.ok(k in r.body.data, k);
});

test('no provider URL or secret reaches the browser', async () => {
  const r = await call('/v1/playoffs', envWith());
  const text = JSON.stringify(r.body);
  assert.doesNotMatch(text, /espn\.com|espncdn|\.pvt|apikey|service_role|ADMIN_TOKEN/i);
});

test('stale current snapshot: STALE + POSTSEASON_SNAPSHOT, never re-labelled current', async () => {
  const old = new Date(Date.now() - 5 * 3600e3).toISOString();
  const r = await call('/v1/playoffs', envWith({ checked26: { checked_at: old } }));
  assert.equal(r.body.meta.freshness, 'STALE');
  assert.equal(r.body.meta.semantics, 'POSTSEASON_SNAPSHOT');
  assert.equal(r.body.data.updated_at, old);
});

test('prior season is always PRIOR_SEASON_FINAL and frozen brackets never go stale', async () => {
  const r = await call('/v1/playoffs?season=2025', envWith({ s25: snap(2025, '2025-10-12T00:00:00.000Z') }));
  assert.equal(r.body.meta.semantics, 'PRIOR_SEASON_FINAL');
  assert.equal(r.body.meta.freshness, 'CACHED');
  assert.equal(r.body.meta.stale_after_s, null);
  assert.equal(r.body.data.is_current_season, false);
  assert.equal(r.body.data.champion.abbreviation, 'LV');
});

test('last capture rejected: last-good served with the rejection in degraded[]', async () => {
  const r = await call('/v1/playoffs', envWith({ status: { ok: false, season: 2026, errors: ['duplicate_game_conflict:1'] } }));
  assert.equal(r.body.ok, true);
  assert.ok(r.body.meta.degraded.includes('last_capture_rejected:duplicate_game_conflict:1'));
});

test('unavailable states are explicit', async () => {
  const none = await call('/v1/playoffs', { WNBA_KV: memKV() });
  assert.equal(none.status, 503);
  assert.equal(none.body.ok, false);
  assert.equal(none.body.meta.freshness, 'UNAVAILABLE');
  const nokv = await call('/v1/playoffs', {});
  assert.equal(nokv.status, 503);
  assert.equal(nokv.body.meta.freshness, 'NOT_CONFIGURED');
  const missing = await call('/v1/playoffs?season=2019', envWith());
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'season_not_captured');
  const bad = await call('/v1/playoffs?season=20x5', envWith());
  assert.equal(bad.status, 400);
});
