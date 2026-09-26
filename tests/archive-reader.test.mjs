// Bounded, season-aware archive reads (workers/shared/archive-reader.js) that replace ids.slice(-500)
// in the WinBA task, the WinBA history dry-run and Player Load. Fixture: two seasons, 630 archived
// games (> 500), with the latest season FIRST in the index so the old slice(-500) would have dropped it.
import test from 'node:test';
import assert from 'node:assert/strict';

import ingest from '../workers/wnba-ingest/src/index.js';
import { readArchive, readWindowGames, resolveCatalog, readIndex, latestRegularSeason, ArchiveReadError, CATALOG_KEY } from '../workers/shared/archive-reader.js';
import { buildWinbaSnapshot } from '../workers/shared/winba.js';
import { league } from './fixtures/player-dna-league.mjs';

const S26 = league({ season: 2026, rounds: 155, start: Date.UTC(2026, 0, 2, 23), idBase: 100000 }); // 310 regular
const S25 = league({ season: 2025, rounds: 155, start: Date.UTC(2025, 0, 2, 23), idBase: 200000 }); // 310 regular
const P26 = league({ season: 2026, rounds: 5, start: Date.UTC(2026, 11, 20, 23), type: 3, idBase: 300000 }); // 10 postseason
const ALL = [...S26, ...S25, ...P26];
const idOf = (d) => d.summary.game.game_id;
const INDEX = ALL.map(idOf);

function memKV(docs = ALL, index = INDEX, extra = {}) {
  const map = new Map([['archive:v1:index', JSON.stringify(index)], ...Object.entries(extra).map(([k, v]) => [k, JSON.stringify(v)])]);
  for (const d of docs) map.set(`game:v1:final:${idOf(d)}`, JSON.stringify(d));
  const gets = [];
  const puts = [];
  return {
    map, gets, puts,
    async get(k, t) { gets.push(k); const v = map.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { puts.push(k); map.set(k, String(v)); }
  };
}
const gameGets = (kv) => kv.gets.filter((k) => k.startsWith('game:v1:final:')).map((k) => k.slice('game:v1:final:'.length));
const ctx = { waitUntil() {} };
const run = async (path, kv, method = 'POST') => (await ingest.fetch(new Request(`https://x${path}`, { method, headers: { authorization: 'Bearer t' } }), { WNBA_KV: kv, ADMIN_TOKEN: 't' }, ctx)).json();
const shuffle = (a, seed = 7) => { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i -= 1) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const noGen = (b) => JSON.stringify({ ...b, generated_at: null, rows: b.rows.map((r) => ({ ...r, generated_at: null })) });

test('fixture: 630 archived games, the latest season first in the index (old slice(-500) would drop 130 of them)', () => {
  assert.equal(INDEX.length, 630);
  const lastFive = new Set(INDEX.slice(-500));
  assert.equal(S26.filter((d) => !lastFive.has(idOf(d))).length, 130);
});

test('WinBA task: every regular-season game of the latest season, none of another season or the postseason', async () => {
  const kv = memKV();
  const r = await run('/run/winba', kv);
  assert.equal(r.result.winba.ok, true, r.result.winba.error);
  const board = JSON.parse(kv.map.get('winba:v1:latest'));
  assert.equal(board.season, 2026);
  assert.equal(board.games_used, 310);
  assert.equal(r.result.winba.season_games_read, 310);
  assert.equal(noGen(board), noGen({ ...buildWinbaSnapshot(S26, { season: 2026 }), archive_index_count: 630, archive_signature: `630:${INDEX.at(-1)}` }));
});

function memKVWithCatalog(prev) {
  const kv = memKV(ALL, INDEX, { [CATALOG_KEY]: JSON.parse(prev.map.get(CATALOG_KEY)) });
  return kv;
}

test('WinBA with a warm catalog reads only the required season keys (bounded; no irrelevant history)', async () => {
  const cold = memKV();
  await run('/run/winba', cold);
  assert.equal(new Set(gameGets(cold)).size, 630, 'cold catalog: each indexed game read once to classify it');
  assert.ok(cold.puts.includes(CATALOG_KEY), 'wnba-ingest persists the catalog');
  const warm = memKVWithCatalog(cold);
  const r = await run('/run/winba', warm);
  assert.equal(r.result.winba.ok, true);
  const got = gameGets(warm);
  assert.equal(got.length, 310);
  assert.deepEqual(new Set(got), new Set(S26.map(idOf)));
  assert.equal(r.result.winba.docs_read, 310);
  assert.equal(r.result.winba.catalog_resolved, 0);
});

test('WinBA board is independent of index order when no player changes team (fixture); ordering stays index order', async () => {
  const a = memKV();
  const b = memKV(ALL, shuffle(INDEX));
  await run('/run/winba', a);
  await run('/run/winba', b);
  const A = JSON.parse(a.map.get('winba:v1:latest'));
  const B = JSON.parse(b.map.get('winba:v1:latest'));
  assert.deepEqual(B.rows.map((r) => [r.athlete_id, r.score, r.rank, r.team_id, r.components]), A.rows.map((r) => [r.athlete_id, r.score, r.rank, r.team_id, r.components]));
  // the reader itself: 'index' keeps index order; 'tip' is identical under any index order
  const c1 = memKV(); const c2 = memKV(ALL, shuffle(INDEX, 99));
  const t1 = await readArchive(c1, { select: (e) => e.s === 2026 && e.t === 2, order: 'tip' });
  const t2 = await readArchive(c2, { select: (e) => e.s === 2026 && e.t === 2, order: 'tip' });
  assert.deepEqual(t1.ids, t2.ids);
  const i2 = await readArchive(memKV(ALL, shuffle(INDEX, 99)), { select: (e) => e.s === 2026 && e.t === 2, order: 'index' });
  assert.deepEqual(i2.ids, shuffle(INDEX, 99).filter((id) => S26.some((d) => idOf(d) === id)));
});

test('WinBA fails closed on an unreadable season game and keeps the previous board; an unneeded unreadable game is not read', async () => {
  const kv = memKV();
  await run('/run/winba', kv);
  const before = kv.map.get('winba:v1:latest');
  const warm = memKVWithCatalog(kv);
  warm.map.delete(`game:v1:final:${idOf(S26[5])}`);
  warm.map.set('winba:v1:latest', JSON.stringify({ ...JSON.parse(before), archive_signature: 'stale' }));
  const r = await run('/run/winba', warm);
  assert.equal(r.result.winba.ok, false);
  assert.match(r.result.winba.error, /required game\(s\) unreadable.*refusing a partial read/);
  assert.equal(JSON.parse(warm.map.get('winba:v1:latest')).archive_signature, 'stale', 'no partial board written');
  // a 2025 document going missing does not matter to the 2026 board once catalogued
  const other = memKVWithCatalog(kv);
  other.map.delete(`game:v1:final:${idOf(S25[3])}`);
  const r2 = await run('/run/winba', other);
  assert.equal(r2.result.winba.ok, true);
  assert.equal(JSON.parse(other.map.get('winba:v1:latest')).games_used, 310);
  // cold catalog + an unreadable indexed game: cannot classify it, so refuse rather than guess
  const cold = memKV();
  cold.map.delete(`game:v1:final:${idOf(S25[3])}`);
  await assert.rejects(resolveCatalog(cold, INDEX), ArchiveReadError);
});

test('history dry-run reads only the season and never writes (not even the catalog)', async () => {
  const kv = memKV();
  const r = await run('/v1/winba/history-dryrun', kv, 'GET');
  assert.equal(r.ok, true);
  assert.equal(r.data.season, 2026);
  assert.equal(r.data.docs_loaded, 310);
  assert.equal(r.data.regular_season_finals, 310);
  assert.equal(kv.puts.length, 0);
});

test('Player Load window: exactly the games tipped inside the lookback window, tip ordered, bounded reads', async () => {
  const now = Date.parse(S26[200].summary.game.start_utc) + 3600e3;
  const cutoff = now - 28 * 86400e3;
  const want = ALL.filter((d) => { const t = Date.parse(d.summary.game.start_utc); return t >= cutoff && t <= now; }).map(idOf);
  assert.ok(want.length >= 20 && want.length < 40);
  const seeded = memKV();
  await resolveCatalog(seeded, INDEX, { writeCatalog: true });
  const kv = memKV(ALL, INDEX, { [CATALOG_KEY]: JSON.parse(seeded.map.get(CATALOG_KEY)) });
  const w = await readWindowGames(kv, { now, windowDays: 28 });
  assert.deepEqual(w.games.map((g) => g.game_id).sort(), [...want].sort());
  assert.deepEqual(new Set(gameGets(kv)), new Set(want), 'only window documents are fetched');
  assert.equal(w.read, want.length);
  assert.equal(w.scanned, 630);
  const tips = w.games.map((g) => Date.parse(g.start_utc));
  assert.deepEqual(tips, [...tips].sort((a, b) => a - b));
  assert.ok(w.games.every((g) => g.season.year === 2026), 'window excludes the other season');
  assert.equal(kv.puts.length, 0, 'Player Load never writes the catalog');
  // identical under a shuffled index
  const k2 = memKV(ALL, shuffle(INDEX, 3), { [CATALOG_KEY]: JSON.parse(seeded.map.get(CATALOG_KEY)) });
  assert.equal(JSON.stringify((await readWindowGames(k2, { now, windowDays: 28 })).games), JSON.stringify(w.games));
  // an unreadable window game fails closed
  kv.map.delete(`game:v1:final:${want[0]}`);
  await assert.rejects(readWindowGames(kv, { now, windowDays: 28 }), /required game\(s\) unreadable/);
});

test('catalog: latest regular season, dedup index, pruned to indexed ids', async () => {
  const kv = memKV(ALL, [...INDEX, INDEX[0]]);
  assert.equal((await readIndex(kv)).length, 630);
  const cat = await resolveCatalog(kv, await readIndex(kv), { writeCatalog: true });
  assert.equal(latestRegularSeason(cat.entries), 2026);
  assert.equal(Object.keys(cat.entries).length, 630);
  const e = cat.entries[idOf(P26[0])];
  assert.deepEqual([e.s, e.t, e.c], [2026, 3, true]);
  const again = await resolveCatalog(memKV(ALL, INDEX.slice(10), { [CATALOG_KEY]: JSON.parse(kv.map.get(CATALOG_KEY)) }), INDEX.slice(10));
  assert.equal(Object.keys(again.entries).length, 620);
  assert.equal(again.resolved, 0);
});

test('no slice(-500) remains in the three readers', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../workers/wnba-ingest/src/index.js', '../workers/wnba-player-load/src/index.js']) {
    assert.ok(!/ids\.slice\(-500\)/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
  }
});
