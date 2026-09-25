// wnba-ingest playoffs task: capture -> validate -> persist only valid, last-good kept, frozen never downgraded.
// The fake provider answers from the real trimmed captures in tests/fixtures/playoffs/ by URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playoffsTask, playoffsDue, PLAYOFFS_KEYS } from '../workers/wnba-ingest/src/playoffs-task.js';
import { fx, clone } from './fixtures/playoffs/scenarios.mjs';

function memKV() {
  const map = new Map();
  return {
    map,
    async get(k, type) { const v = map.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); }
  };
}

const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)).replaceAll('-', '');

/** Serves standings / calendar / per-day scoreboards / core ids for one season from the captures. */
function provider(season, { events = fx(`espn-postseason-${season}.json`).events, coreIds = null, failDay = null } = {}) {
  const calls = [];
  const standings = fx(`espn-standings-league-${season}.json`);
  const calendar = fx(`espn-calendar-${season}.json`);
  const fetchJson = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/standings')) return clone(standings);
    if (u.pathname.endsWith('/scoreboard')) {
      const day = u.searchParams.get('dates');
      if (day === failDay) throw new Error('upstream_400');
      return { leagues: calendar.leagues, events: clone(events.filter((e) => etDay(e.date) === day)) };
    }
    if (/\/types\/3\/events$/.test(u.pathname)) {
      return { items: (coreIds || events.map((e) => e.id)).map((id) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/events/${id}?lang=en` })) };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchJson, calls };
}

const NOW26 = Date.parse('2026-09-25T14:00:00Z');

test('current season: persists a validated snapshot, current pointer, season list, verification stamp', async () => {
  const kv = memKV();
  const p = provider(2026);
  const r = await playoffsTask({ WNBA_KV: kv }, { now: NOW26, fetchJson: p.fetchJson });
  assert.equal(r.season, 2026);
  assert.equal(r.status, 'NOT_STARTED');
  assert.equal(r.changed, true);
  assert.equal(r.games, 29);
  assert.equal(r.days, 17);
  assert.equal(r.missing_events, 0);
  const snap = JSON.parse(kv.map.get(PLAYOFFS_KEYS.snapshot(2026)));
  assert.equal(snap.provenance.core_event_count, 29);
  assert.equal(snap.provenance.calendar_days_scanned, 17);
  assert.match(snap.seeds[0].logo, /^https:\/\/wnba\.propbetedge\.ai\/media\/teams\/8\/128\.webp$/, 'self-hosted logo, no provider host');
  assert.deepEqual(JSON.parse(kv.map.get(PLAYOFFS_KEYS.current)).season, 2026);
  assert.deepEqual(JSON.parse(kv.map.get(PLAYOFFS_KEYS.seasons)), [2026]);
  assert.ok(JSON.parse(kv.map.get(PLAYOFFS_KEYS.checked(2026))).checked_at);
  assert.ok(p.calls.every((u) => !/dates=\d{8}-\d{8}/.test(u)), 'never a date-range scoreboard (400 from Cloudflare egress)');
});

test('unchanged truth is verified but not rewritten', async () => {
  const kv = memKV();
  const p = provider(2026);
  await playoffsTask({ WNBA_KV: kv }, { now: NOW26, fetchJson: p.fetchJson });
  const before = kv.map.get(PLAYOFFS_KEYS.snapshot(2026));
  const r = await playoffsTask({ WNBA_KV: kv }, { now: NOW26 + 600e3, fetchJson: p.fetchJson });
  assert.equal(r.changed, false);
  assert.equal(kv.map.get(PLAYOFFS_KEYS.snapshot(2026)), before);
  assert.equal(JSON.parse(kv.map.get(PLAYOFFS_KEYS.checked(2026))).checked_at, new Date(NOW26 + 600e3).toISOString());
});

test('backfill 2025: complete bracket frozen, prior season does not move the current pointer, settled days memoized', async () => {
  const kv = memKV();
  await playoffsTask({ WNBA_KV: kv }, { now: NOW26, fetchJson: provider(2026).fetchJson });
  const p = provider(2025);
  const r = await playoffsTask({ WNBA_KV: kv }, { season: 2025, now: NOW26, fetchJson: p.fetchJson });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(r.series, 7);
  const snap = JSON.parse(kv.map.get(PLAYOFFS_KEYS.snapshot(2025)));
  assert.equal(snap.frozen, true);
  assert.equal(snap.champion.abbreviation, 'LV');
  assert.equal(JSON.parse(kv.map.get(PLAYOFFS_KEYS.current)).season, 2026, 'pointer stays on the current season');
  assert.deepEqual(JSON.parse(kv.map.get(PLAYOFFS_KEYS.seasons)), [2026, 2025]);
  assert.ok([...kv.map.keys()].some((k) => k.startsWith('playoffs:v1:day:2025')), 'settled past days memoized');

  // A frozen bracket is not refetched on the next pass unless forced.
  const p2 = provider(2025);
  const again = await playoffsTask({ WNBA_KV: kv }, { season: 2025, now: NOW26 + 60e3, fetchJson: p2.fetchJson });
  assert.equal(again.frozen, true);
  assert.equal(p2.calls.length, 1, 'only the standings read that resolves the season');
});

test('validation failure: nothing persisted over the last good snapshot, failure recorded, task throws', async () => {
  const kv = memKV();
  await playoffsTask({ WNBA_KV: kv }, { now: NOW26, fetchJson: provider(2026).fetchJson });
  const good = kv.map.get(PLAYOFFS_KEYS.snapshot(2026));
  const bad = clone(fx('espn-postseason-2026.json').events);
  bad[0].competitions[0].notes = [{ type: 'event', headline: 'Play-In Tournament - Game 1' }];
  await assert.rejects(playoffsTask({ WNBA_KV: kv }, { now: NOW26 + 60e3, fetchJson: provider(2026, { events: bad }).fetchJson }), /playoffs_validation_failed:unsupported_round_label/);
  assert.equal(kv.map.get(PLAYOFFS_KEYS.snapshot(2026)), good, 'last good snapshot untouched');
  const status = JSON.parse(kv.map.get(PLAYOFFS_KEYS.status));
  assert.equal(status.ok, false);
  assert.ok(status.kept);
});

test('source unavailable: a failed day scoreboard aborts the run without touching the snapshot', async () => {
  const kv = memKV();
  await playoffsTask({ WNBA_KV: kv }, { now: NOW26, fetchJson: provider(2026).fetchJson });
  const good = kv.map.get(PLAYOFFS_KEYS.snapshot(2026));
  await assert.rejects(playoffsTask({ WNBA_KV: kv }, { now: NOW26 + 60e3, fetchJson: provider(2026, { failDay: '20260929' }).fetchJson }), /upstream_400/);
  assert.equal(kv.map.get(PLAYOFFS_KEYS.snapshot(2026)), good);
});

test('events the core list knows but the scoreboard scan missed are reported, not invented', async () => {
  const kv = memKV();
  const ids = fx('espn-postseason-2026.json').events.map((e) => e.id);
  const r = await playoffsTask({ WNBA_KV: kv }, { now: NOW26, fetchJson: provider(2026, { coreIds: [...ids, '401999999'] }).fetchJson });
  assert.equal(r.missing_events, 1);
  const snap = JSON.parse(kv.map.get(PLAYOFFS_KEYS.snapshot(2026)));
  assert.deepEqual(snap.provenance.missing_event_ids, ['401999999']);
  assert.equal(snap.provenance.postseason_game_count, 29);
});

test('a complete snapshot is never replaced by a less complete provider view', async () => {
  const kv = memKV();
  await playoffsTask({ WNBA_KV: kv }, { season: 2025, now: NOW26, fetchJson: provider(2025).fetchJson });
  const frozen = kv.map.get(PLAYOFFS_KEYS.snapshot(2025));
  const partial = fx('espn-postseason-2025.json').events.filter((e) => !/finals/i.test(e.competitions[0].notes[0].headline) || /semi/i.test(e.competitions[0].notes[0].headline));
  const r = await playoffsTask({ WNBA_KV: kv }, { season: 2025, force: true, now: NOW26 + 60e3, fetchJson: provider(2025, { events: partial }).fetchJson });
  assert.equal(r.kept_frozen, true);
  assert.equal(kv.map.get(PLAYOFFS_KEYS.snapshot(2025)), frozen);
});

test('cron cadence: every 10 minutes, every 2 while hot', async () => {
  const kv = memKV();
  assert.equal(await playoffsDue({ WNBA_KV: kv }, 3), true);
  assert.equal(await playoffsDue({ WNBA_KV: kv }, 13), true);
  assert.equal(await playoffsDue({ WNBA_KV: kv }, 5), false);
  await kv.put(PLAYOFFS_KEYS.hot, new Date(Date.now() + 5 * 60e3).toISOString());
  assert.equal(await playoffsDue({ WNBA_KV: kv }, 5), true);
  assert.equal(await playoffsDue({ WNBA_KV: kv }, 6), false);
});
