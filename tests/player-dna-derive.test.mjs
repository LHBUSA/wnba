// WNBA Player DNA V1 — wnba-ingest `dna` task (derive) and wnba-api /v1/dna/* (prepared reads).
// Drives the real task and the real Worker entrypoint against an in-memory KV.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dnaTask, slimArchiveDoc, currentAsOf, archiveSignature, DNA_EXCLUDE_GAME_IDS } from '../workers/wnba-ingest/src/dna-task.js';
import api from '../workers/wnba-api/src/index-premium.js';
import { DNA_KV, dnaPlayerView } from '../workers/shared/player-dna-views.js';
import { buildPlayerDna, QUALIFICATION, PLAYER_DNA_VERSION } from '../workers/shared/player-dna.js';
import { buildWinbaSnapshot } from '../workers/shared/winba.js';
import { FRANCHISES, league, ALL_STAR, makeDoc, playerLine } from './fixtures/player-dna-league.mjs';

const DOCS = [...league(), ALL_STAR];
const IDS = DOCS.map((d) => d.summary.game.game_id);
const SIG = archiveSignature(IDS);
const REF = { captured_at: 'x', athletes: [], teams: FRANCHISES.map((id) => ({ team_id: id, abbr: `T${id}`, name: `Team ${id}`, short_name: `T${id}`, color: '#000000' })) };
const BOARD = { ...buildWinbaSnapshot(DOCS, { season: 2026, generatedAt: '2026-09-25T04:26:27.869Z' }), archive_index_count: IDS.length, archive_signature: SIG };

function memKV(entries = {}) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const log = { gets: [], puts: [] };
  return {
    map, log,
    async get(k, t) { log.gets.push(k); const v = map.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { log.puts.push(k); map.set(k, String(v)); }
  };
}

function archiveKV({ docs = DOCS, board = BOARD, ref = REF, extra = {} } = {}) {
  const entries = { 'archive:v1:index': docs.map((d) => d.summary.game.game_id), 'winba:v1:latest': board, 'ref:v1:athletes': ref, ...extra };
  for (const d of docs) entries[`game:v1:final:${d.summary.game.game_id}`] = d;
  if (board === null) delete entries['winba:v1:latest'];
  if (ref === null) delete entries['ref:v1:athletes'];
  return memKV(entries);
}

const CAPTURED = '2026-09-26T12:00:00.000Z';
const ctx = { waitUntil() {} };
const call = async (path, env) => {
  const res = await api.fetch(new Request(`https://wnba-api.test${path}`), env, ctx);
  return { status: res.status, headers: res.headers, body: await res.json() };
};

// ------------------------------------------------------------------ derive

test('derive writes every player doc, then the index, then meta last; never touches WinBA or the archive', async () => {
  const kv = archiveKV();
  const r = await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  assert.equal(r.season, 2026);
  assert.equal(r.signature, SIG);
  assert.ok(r.players > 20);
  const puts = kv.log.puts;
  const playerPuts = puts.filter((k) => k.startsWith('dna:v1:player:'));
  assert.equal(playerPuts.length, r.players);
  assert.ok(puts.indexOf(DNA_KV.index) > puts.lastIndexOf(playerPuts.at(-1)));
  assert.ok(puts.indexOf(DNA_KV.meta) > puts.indexOf(DNA_KV.index), 'meta is the commit marker');
  assert.ok(puts.every((k) => k.startsWith('dna:v1:')), `only dna:v1:* keys are written: ${puts.filter((k) => !k.startsWith('dna:v1:'))}`);
  assert.equal(kv.map.get('winba:v1:latest'), JSON.stringify(BOARD), 'the canonical board is byte-identical after derive');
});

test('derived player doc === the pure model on the same inputs (as_of = last tip + 1s), WinBA = canonical board', async () => {
  const kv = archiveKV();
  await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  const asOf = currentAsOf(DOCS);
  assert.equal(asOf, new Date(Math.max(...DOCS.map((d) => Date.parse(d.summary.game.start_utc))) + 1000).toISOString());
  const slim = DOCS.map(slimArchiveDoc);
  const result = buildPlayerDna(slim, { asOf, franchiseTeamIds: FRANCHISES, excludeGameIds: DNA_EXCLUDE_GAME_IDS, winbaBoard: BOARD });
  const stored = JSON.parse(kv.map.get(DNA_KV.player('1026')));
  const expected = dnaPlayerView(result, '1026', { teams: JSON.parse(kv.map.get(DNA_KV.index)).teams, capturedAt: CAPTURED, archiveSignature: SIG });
  assert.equal(JSON.stringify(stored), JSON.stringify(expected));
  assert.equal(stored.as_of, asOf);
  const w = stored.scopes.season.dimensions.winba;
  assert.equal(w.value, BOARD.rows.find((x) => x.athlete_id === '1026').score);
  assert.match(w.note, /401857320/);
  assert.deepEqual(stored.provenance.excluded_games.non_franchise, ['401857320']);
});

test('slimming drops play-by-play, injuries and odds but leaves the model output unchanged', () => {
  const rich = DOCS.map((d) => ({ ...d, summary: { ...d.summary, plays: [{ id: 1 }], injuries: [{ athlete_id: '1026', status: 'Out' }], pickcenter: [{ spread: -3 }] } }));
  const slim = rich.map(slimArchiveDoc);
  assert.ok(slim.every((d) => !('plays' in d.summary) && !('injuries' in d.summary) && !('pickcenter' in d.summary)));
  const asOf = currentAsOf(DOCS);
  const a = buildPlayerDna(rich, { asOf, franchiseTeamIds: FRANCHISES, winbaBoard: BOARD });
  const b = buildPlayerDna(slim, { asOf, franchiseTeamIds: FRANCHISES, winbaBoard: BOARD });
  assert.equal(JSON.stringify(b.players), JSON.stringify(a.players));
});

test('reads ALL archive ids (no slice(-500)); a steady-state rerun reads only new games from the slim cache', async () => {
  // 600 indexed games: the WinBA/Load readers would silently drop 100 of them
  const big = league({ rounds: 300, start: Date.UTC(2026, 4, 1, 12) }).map((d, i) => {
    d.summary.game.start_utc = new Date(Date.UTC(2026, 4, 1, 12) + i * 3600e3).toISOString();
    return d;
  });
  assert.equal(big.length, 600);
  const board = { ...buildWinbaSnapshot(big, { season: 2026, generatedAt: 'g' }), archive_signature: archiveSignature(big.map((d) => d.summary.game.game_id)) };
  const kv = archiveKV({ docs: big, board });
  const r = await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  assert.equal(r.games_used, 600);
  assert.equal(r.fetched_docs, 600);
  assert.equal(new Set(kv.log.gets.filter((k) => k.startsWith('game:v1:final:'))).size, 600);

  // one more archived final: only that document is read
  const next = makeDoc({ id: '9999', tip: new Date(Date.UTC(2026, 4, 1, 12) + 600 * 3600e3).toISOString(), home: '1', away: '2', rows: [playerLine('1026', '1', 700, 0), playerLine('2026', '2', 700, 0)] });
  const docs2 = [...big, next];
  const ids2 = docs2.map((d) => d.summary.game.game_id);
  kv.map.set('archive:v1:index', JSON.stringify(ids2));
  kv.map.set('game:v1:final:9999', JSON.stringify(next));
  kv.map.set('winba:v1:latest', JSON.stringify({ ...buildWinbaSnapshot(docs2, { season: 2026, generatedAt: 'g2' }), archive_signature: archiveSignature(ids2) }));
  kv.log.gets.length = 0;
  const r2 = await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  assert.equal(r2.fetched_docs, 1);
  assert.equal(r2.cache_hit_docs, 600);
  assert.equal(r2.games_used, 601);
  assert.deepEqual(kv.log.gets.filter((k) => k.startsWith('game:v1:final:')), ['game:v1:final:9999']);
});

test('the cache path and a forced full re-read produce byte-identical documents', async () => {
  const kv = archiveKV();
  await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  const first = kv.map.get(DNA_KV.player('1026'));
  await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED, force: true });
  assert.equal(kv.map.get(DNA_KV.player('1026')), first);
});

test('skips: unchanged archive, deferred after a WinBA rebuild, stale or missing board', async () => {
  const kv = archiveKV();
  await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  kv.log.puts.length = 0;
  assert.equal((await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED })).skipped, 'unchanged_archive');
  assert.equal(kv.log.puts.length, 0);

  const fresh = archiveKV();
  assert.equal((await dnaTask({ WNBA_KV: fresh }, { results: { winba: { ok: true, season: 2026 } } })).skipped, 'deferred_after_winba_rebuild');
  assert.equal((await dnaTask({ WNBA_KV: fresh }, { results: { winba: { ok: true, skipped: 'unchanged_archive' } }, capturedAt: CAPTURED })).season, 2026);

  const stale = archiveKV({ board: { ...BOARD, archive_signature: '10:1009' } });
  const s = await dnaTask({ WNBA_KV: stale });
  assert.equal(s.skipped, 'winba_board_stale');
  assert.equal(stale.log.puts.length, 0);
  assert.equal((await dnaTask({ WNBA_KV: archiveKV({ board: null }) })).skipped, 'no_winba_board');
  assert.equal((await dnaTask({ WNBA_KV: memKV() })).skipped, 'no_archives');
});

test('fails closed: no franchise list, an unreadable archived game, or a board for another archive state', async () => {
  await assert.rejects(dnaTask({ WNBA_KV: archiveKV({ ref: null }) }), /franchise list missing/);
  const holey = archiveKV();
  holey.map.delete('game:v1:final:1005');
  await assert.rejects(dnaTask({ WNBA_KV: holey }), /unreadable.*refusing a partial derive/);
  assert.ok(!holey.log.puts.some((k) => k.startsWith('dna:v1:')));
  // signature matches but the board content is for fewer games: refused, nothing published
  const shortBoard = { ...buildWinbaSnapshot(DOCS.slice(0, 20), { season: 2026, generatedAt: 'g' }), archive_signature: SIG };
  const bad = archiveKV({ board: shortBoard });
  await assert.rejects(dnaTask({ WNBA_KV: bad }), /CANONICAL_BOARD_OTHER_ARCHIVE_STATE/);
  assert.ok(!bad.log.puts.some((k) => k.startsWith('dna:v1:')));
});

// ------------------------------------------------------------------ API

async function derivedEnv() {
  const kv = archiveKV();
  await dnaTask({ WNBA_KV: kv }, { capturedAt: CAPTURED });
  return { WNBA_KV: kv };
}

test('/health lists the three DNA routes; API version 1.3.0', async () => {
  const r = await call('/health', { WNBA_KV: memKV() });
  for (const p of ['/v1/dna/meta', '/v1/dna/index', '/v1/dna/players/:id']) assert.ok(r.body.routes.includes(p), p);
  assert.equal(r.body.version, '1.3.0');
});

test('GET /v1/dna/meta: NBA-shaped methodology with per-scope qualification and reference minutes', async () => {
  const r = await call('/v1/dna/meta', await derivedEnv());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const d = r.body.data;
  assert.equal(d.schema, 'wnba-dna/meta');
  assert.equal(d.version, PLAYER_DNA_VERSION);
  assert.deepEqual(d.versions, { player_dna: 'wnba-player-dna/1.0.0', winba: 'winba/1.0.1' });
  assert.deepEqual(d.qualification, JSON.parse(JSON.stringify(QUALIFICATION)));
  assert.equal(d.qualification.season.reference_minutes, 1000);
  assert.equal(d.dimension_order.length, 17);
  assert.equal(d.dimensions.length, 17);
  assert.deepEqual(d.scopes, ['season', 'career', 'playoffs', 'last5', 'last10', 'last15', 'home', 'away', 'clutch']);
  assert.equal(d.decisions.winba_source, 'canonical_board');
  assert.equal(d.decisions.access, 'public');
  assert.equal(d.winba.source, 'canonical_board');
  assert.ok(Array.isArray(d.unavailable) && d.unavailable.some((u) => /All-Star/.test(u)));
  assert.equal(d.archive_signature, SIG);
  assert.equal(d.captured_at, CAPTURED);
  assert.equal(r.body.meta.cache, 'kv');
  assert.match(r.headers.get('cache-control'), /max-age=300/);
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'public, not credentialed');
});

test('GET /v1/dna/index: players sorted by canonical WinBA with headshot and team map', async () => {
  const r = await call('/v1/dna/index', await derivedEnv());
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.schema, 'wnba-dna/index');
  const vals = d.players.map((p) => p.winba_value ?? -1);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
  assert.ok(d.players.every((p) => 'headshot' in p && 'scopes' in p));
  assert.equal(d.teams['1'].abbr, 'T1');
  assert.ok(!d.players.some((p) => p.scopes.includes('career')), 'career is never calculated on a single-season archive');
});

test('GET /v1/dna/players/:id: prepared doc verbatim + headshot; shape mirrors NBA', async () => {
  const env = await derivedEnv();
  const r = await call('/v1/dna/players/1026', env);
  assert.equal(r.status, 200);
  const d = r.body.data;
  for (const k of ['schema', 'version', 'source', 'as_of', 'captured_at', 'unavailable', 'versions', 'dimension_order', 'scopes', 'movement', 'provenance', 'player', 'team', 'team_id', 'season', 'content_hash']) assert.ok(k in d, k);
  assert.equal(d.schema, 'wnba-dna/player');
  assert.deepEqual(Object.keys(d.player), ['id', 'espn_athlete_id', 'name', 'position', 'headshot']);
  assert.equal(d.team.abbr, 'T1');
  const stored = JSON.parse(env.WNBA_KV.map.get(DNA_KV.player('1026')));
  assert.equal(JSON.stringify({ ...d, player: { ...d.player, headshot: null } }), JSON.stringify(stored), 'nothing computed per request');
  assert.equal(d.winba.score, BOARD.rows.find((x) => x.athlete_id === '1026').score);
  assert.equal(d.winba.source, 'canonical_board');
  assert.equal(d.scopes.career.reason, 'NO_PRIOR_SEASON_COVERAGE');
  assert.equal(d.scopes.clutch.reason, 'CLUTCH_NOT_BUILT');
});

test('a player below the DNA season gate still carries the canonical WinBA row (its own qualification)', async () => {
  const env = await derivedEnv();
  const bench = (await call('/v1/dna/players/1626', env)).body.data;
  assert.equal(bench.scopes.season.calculated, false);
  const row = BOARD.rows.find((x) => x.athlete_id === '1626');
  assert.ok(row, 'fixture: bench player is on the canonical board');
  assert.equal(bench.winba.score, row.score);
  assert.equal(bench.winba.status, row.status);
});

test('/v1/dna/players: 404 no_snapshot, 400 on a non-numeric id, 503 before the first derive', async () => {
  const env = await derivedEnv();
  const miss = await call('/v1/dna/players/123456', env);
  assert.equal(miss.status, 404);
  assert.equal(miss.body.data.state, 'UNAVAILABLE');
  assert.equal(miss.body.data.reason, 'no_snapshot');
  const bad = await call('/v1/dna/players/abc', env);
  assert.equal(bad.status, 400);
  for (const p of ['/v1/dna/meta', '/v1/dna/index']) {
    const r = await call(p, { WNBA_KV: memKV() });
    assert.equal(r.status, 503);
    assert.equal(r.body.data.reason, 'not_derived');
  }
});

test('API reads are GET-only and write nothing', async () => {
  const env = await derivedEnv();
  env.WNBA_KV.log.puts.length = 0;
  for (const p of ['/v1/dna/meta', '/v1/dna/index', '/v1/dna/players/1026', '/v1/dna/players/999']) await call(p, env);
  assert.equal(env.WNBA_KV.log.puts.length, 0);
  const post = await api.fetch(new Request('https://wnba-api.test/v1/dna/meta', { method: 'POST' }), env, ctx);
  assert.equal(post.status, 405);
});
