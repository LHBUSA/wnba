// winba/1.0.1 promotion: tip-off game order (start_utc, then numeric game_id). The formula is the
// winba/1.0.0 formula; 1.0.0 stays reproducible from workers/shared/winba-1.0.0.js (byte-pinned).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import * as v101 from '../workers/shared/winba.js';
import * as v100 from '../workers/shared/winba-1.0.0.js';
import { league, makeDoc, playerLine } from './fixtures/player-dna-league.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sha = (p) => createHash('sha256').update(read(p)).digest('hex');
const DOCS = league({ rounds: 24 });
const G = 'fixed';
const shuffle = (a, seed = 11) => { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i -= 1) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };

/** Player 777 traded from team 1 to team 3; the later (team 3) game sits EARLIER in the archive index. */
function tradeFixture() {
  const early = makeDoc({ id: '5001', tip: '2026-06-01T23:00:00.000Z', home: '1', away: '2', rows: [playerLine('777', '1', 1, 0), playerLine('20126', '2', 1, 0)] });
  const late = makeDoc({ id: '5002', tip: '2026-08-01T23:00:00.000Z', home: '3', away: '4', rows: [playerLine('777', '3', 2, 0), playerLine('40126', '4', 2, 0)] });
  return [...DOCS, late, early];
}

test('versions: production winba/1.0.1 pinned; winba/1.0.0 preserved byte-for-byte and still labelled 1.0.0', () => {
  assert.equal(v101.WINBA_VERSION, 'winba/1.0.1');
  assert.equal(v100.WINBA_VERSION, 'winba/1.0.0');
  assert.equal(sha('workers/shared/winba.js'), '699387a08855b602e5cae8b4c3d5ec3e5d3b82c0409e820ae3da61f69f110e30');
  assert.equal(sha('workers/shared/winba-1.0.0.js'), 'd90539e82f8cbd043095070d05fc13cf8aa7273266bf986e6dc0123b0a77ec35', 'the published winba/1.0.0 source');
  assert.equal(v101.WINBA_GAME_ORDER, 'start_utc ascending, then game_id ascending (numeric)');
});

test('formula untouched: weights, qualification, box impact and contract identical to 1.0.0', () => {
  assert.deepEqual(v101.WINBA_WEIGHTS, v100.WINBA_WEIGHTS);
  assert.deepEqual(v101.WINBA_QUALIFICATION, v100.WINBA_QUALIFICATION);
  assert.equal(v101.winbaBoxImpact({ pts: 20, reb: 10, ast: 5 }), v100.winbaBoxImpact({ pts: 20, reb: 10, ast: 5 }));
  assert.deepEqual({ ...v101.WINBA_LAYER_CONTRACT.context }, { ...v100.WINBA_LAYER_CONTRACT.context });
  // same inputs in tip order -> identical rows apart from the version label
  const tip = v101.winbaGameOrder(DOCS);
  const a = v100.buildWinbaSnapshot(tip, { season: 2026, generatedAt: G });
  const b = v101.buildWinbaSnapshot(DOCS, { season: 2026, generatedAt: G });
  const unlabel = (s) => JSON.stringify(s).replace(/winba\/1\.0\.[01]/g, 'winba/LABEL');
  assert.equal(unlabel(b), unlabel(a));
  assert.equal(b.version, 'winba/1.0.1');
});

test('deterministic: the 1.0.1 board is byte-identical under any archive order', () => {
  const docs = tradeFixture();
  const ref = JSON.stringify(v101.buildWinbaSnapshot(docs, { season: 2026, generatedAt: G }));
  for (const seed of [1, 2, 3, 42, 99]) assert.equal(JSON.stringify(v101.buildWinbaSnapshot(shuffle(docs, seed), { season: 2026, generatedAt: G })), ref, `seed ${seed}`);
  assert.equal(JSON.stringify(v101.buildWinbaSnapshot([...docs].reverse(), { season: 2026, generatedAt: G })), ref);
  const asOf = (d) => JSON.stringify(v101.buildWinbaSnapshotAsOf(d, { season: 2026, asOf: '2026-09-01T04:00:00Z', generatedAt: G }));
  assert.equal(asOf(shuffle(docs, 7)), asOf(docs), 'as-of boards too');
});

test('tie-break: same tip time orders by numeric game_id; input never mutated', () => {
  const tip = '2026-07-01T23:00:00.000Z';
  const mk = (id) => makeDoc({ id, tip, home: '1', away: '2', rows: [playerLine('11026', '1', Number(id) % 1000, 0)] });
  const docs = [mk('401857300'), mk('9'), mk('401857299'), mk('10')];
  const before = JSON.stringify(docs);
  assert.deepEqual(v101.winbaGameOrder(docs).map((d) => d.summary.game.game_id), ['9', '10', '401857299', '401857300']);
  assert.deepEqual(v101.winbaGameOrder(shuffle(docs, 5)).map((d) => d.summary.game.game_id), ['9', '10', '401857299', '401857300']);
  assert.equal(JSON.stringify(docs), before);
});

test('trade: 1.0.1 credits the team of the latest game; 1.0.0 (index order) the last archived; nothing else moves', () => {
  const docs = tradeFixture();
  const old = v100.buildWinbaSnapshot(docs, { season: 2026, generatedAt: G });
  const neu = v101.buildWinbaSnapshot(docs, { season: 2026, generatedAt: G });
  assert.equal(old.rows.find((r) => r.athlete_id === '777').team_id, '1');
  assert.equal(neu.rows.find((r) => r.athlete_id === '777').team_id, '3');
  const strip = (r) => ({ ...r, team_id: null, version: null });
  assert.deepEqual(neu.rows.map(strip), old.rows.map(strip));
});

test('ingest: winba task reads in tip order, rebuilds a board of another version, accepts ?force=1; VERSION bumped', () => {
  const src = read('workers/wnba-ingest/src/index.js');
  assert.match(src, /select: \(e\) => e\.s === season && e\.t === 2, order: 'tip' \}\);\n  const snapshot = buildWinbaSnapshot\(docs, \{ season \}\);/);
  assert.doesNotMatch(src, /order: 'index'/);
  assert.match(src, /if \(!force && existing\?\.archive_signature === signature && existing\?\.version === WINBA_VERSION\)/);
  assert.match(src, /m\[1\] === 'dna' \|\| m\[1\] === 'winba' \? \{ force: url\.searchParams\.get\('force'\) === '1' \}/);
  assert.match(src, /winba: \(env, ctx, opts\) => winba\(env, \{ force: Boolean\(opts\?\.force\) \}\)/);
  assert.match(src, /const VERSION = '1\.4\.0';/);
});

test('real 2026 archive proof: vs the live 1.0.0 board only the 4 traded players\' team_id change', () => {
  const p = JSON.parse(read('docs/research/winba-1.0.1-promotion-proof-2026.json'));
  assert.equal(p.before.version, 'winba/1.0.0');
  assert.equal(p.after.version, 'winba/1.0.1');
  assert.equal(p.before.archive_signature, '350:401857218');
  const s = p.summary;
  for (const k of ['score_changes', 'rank_changes', 'status_changes', 'component_changes', 'raw_changes', 'sample_changes', 'average_changes', 'unexpected_changes']) assert.equal(s[k], 0, k);
  assert.equal(s.team_id_changes, 4);
  assert.equal(s.rows_changed, 4);
  assert.equal(s.row_order_identical, true);
  assert.deepEqual(p.changes.map((c) => [c.athlete_id, c.name, c.field]).sort(), [
    ['3065570', 'Kelsey Plum', 'team_id'], ['4068159', 'Sug Sutton', 'team_id'], ['4282168', 'Kiana Williams', 'team_id'], ['4684384', 'Aneesah Morrow', 'team_id']
  ]);
  const e = JSON.parse(read('docs/research/winba-1.0.1-expected-board-2026.json'));
  assert.equal(e.version, 'winba/1.0.1');
  assert.equal(e.rows.length, p.before.rows);
  assert.equal(e.rows.find((r) => r.athlete_id === '3065570').team_id, '11', 'Plum -> Phoenix, her latest team');
});
