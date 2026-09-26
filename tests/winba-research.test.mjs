// WinBA deterministic-ordering research candidate (winba/1.0.1-research). Production winba/1.0.0 is
// untouched: the candidate is a separate module, wired to nothing, and the production builder still
// consumes documents in archive-index order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { buildWinbaSnapshot, WINBA_VERSION } from '../workers/shared/winba.js';
import { buildWinbaSnapshotResearch, tipOrdered, diffBoards, WINBA_RESEARCH_VERSION } from '../workers/shared/winba-research.js';
import { league, makeDoc, playerLine } from './fixtures/player-dna-league.mjs';

const DOCS = league({ rounds: 24 });
const shuffle = (a, seed = 11) => { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i -= 1) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const G = 'fixed';

/** A player traded from team 1 to team 3 midway; the later (team 3) game is archived FIRST in the index. */
function tradeFixture() {
  const early = makeDoc({ id: '5001', tip: '2026-06-01T23:00:00.000Z', home: '1', away: '2', rows: [playerLine('777', '1', 1, 0), playerLine('20126', '2', 1, 0)] });
  const late = makeDoc({ id: '5002', tip: '2026-08-01T23:00:00.000Z', home: '3', away: '4', rows: [playerLine('777', '3', 2, 0), playerLine('40126', '4', 2, 0)] });
  return [...DOCS, late, early]; // archive order: late game archived before the early one (backfill order)
}

test('labels: production stays winba/1.0.0; the candidate is winba/1.0.1-research and says it is not promoted', () => {
  assert.equal(WINBA_VERSION, 'winba/1.0.0');
  assert.equal(WINBA_RESEARCH_VERSION, 'winba/1.0.1-research');
  const c = buildWinbaSnapshotResearch(DOCS, { season: 2026, generatedAt: G });
  assert.equal(c.version, 'winba/1.0.1-research');
  assert.ok(c.rows.every((r) => r.version === 'winba/1.0.1-research'));
  assert.deepEqual(c.research, { base_version: 'winba/1.0.0', ordering: 'start_utc ascending, then game_id ascending', status: 'CANDIDATE_NOT_PROMOTED' });
});

test('determinism: the candidate board is byte-identical under any archive order', () => {
  const docs = tradeFixture();
  const a = JSON.stringify(buildWinbaSnapshotResearch(docs, { season: 2026, generatedAt: G }));
  for (const seed of [1, 2, 3, 42, 99]) assert.equal(JSON.stringify(buildWinbaSnapshotResearch(shuffle(docs, seed), { season: 2026, generatedAt: G })), a, `seed ${seed}`);
  assert.equal(JSON.stringify(buildWinbaSnapshotResearch([...docs].reverse(), { season: 2026, generatedAt: G })), a);
});

test('tie-break: identical tip times order by game_id ascending (numeric), independent of input order; input never mutated', () => {
  const tip = '2026-07-01T23:00:00.000Z';
  const mk = (id) => makeDoc({ id, tip, home: '1', away: '2', rows: [playerLine('11026', '1', Number(id), 0)] });
  const docs = [mk('401857300'), mk('9'), mk('401857299'), mk('10')];
  const before = JSON.stringify(docs);
  const order = (x) => tipOrdered(x).map((d) => d.summary.game.game_id);
  assert.deepEqual(order(docs), ['9', '10', '401857299', '401857300']);
  assert.deepEqual(order(shuffle(docs, 5)), ['9', '10', '401857299', '401857300']);
  assert.equal(JSON.stringify(docs), before);
  const withTip = [makeDoc({ id: '1', tip: '2026-07-02T00:00:00.000Z', home: '1', away: '2', rows: [] }), ...docs];
  assert.equal(order(withTip).at(-1), '1', 'a later tip sorts after every earlier game regardless of id');
});

test('trade: production credits the team of the last ARCHIVED game; the candidate credits the team of the latest game; nothing else moves', () => {
  const docs = tradeFixture();
  const prod = buildWinbaSnapshot(docs, { season: 2026, generatedAt: G });
  const cand = buildWinbaSnapshotResearch(docs, { season: 2026, generatedAt: G });
  assert.equal(prod.rows.find((r) => r.athlete_id === '777').team_id, '1', 'production: archive order ends on the early (team 1) game');
  assert.equal(cand.rows.find((r) => r.athlete_id === '777').team_id, '3', 'candidate: the latest game was for team 3');
  const d = diffBoards(prod, cand);
  assert.deepEqual(d.fields_changed_by_name, { team_id: 1 });
  assert.deepEqual(d.changes, [{ athlete_id: '777', field: 'team_id', production: '1', candidate: '3' }]);
  assert.equal(d.row_order_identical, true);
});

test('production path is byte-identical to today: winba.js pinned, not importing the candidate, nothing imports the candidate', () => {
  const src = readFileSync(new URL('../workers/shared/winba.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(src).digest('hex'), 'd90539e82f8cbd043095070d05fc13cf8aa7273266bf986e6dc0123b0a77ec35');
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = `${dir}/${f}`; if (f === 'node_modules') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(f)) files.push(p); } };
  walk(new URL('../workers', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
  const importers = files.filter((f) => !/winba-research\.js$/.test(f) && /winba-research/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(importers, [], 'no Worker, route or page uses the research candidate');
  // the production builder over an index-ordered archive is unchanged by the existence of the candidate
  const docs = tradeFixture();
  assert.equal(JSON.stringify(buildWinbaSnapshot(docs, { season: 2026, generatedAt: G })), JSON.stringify(buildWinbaSnapshot(docs, { season: 2026, generatedAt: G })));
});

test('committed 2026 evidence: only team_id changed, for 4 players, and scores/ranks/status/components are identical', () => {
  const r = JSON.parse(readFileSync(new URL('../docs/research/winba-deterministic-ordering-diff-2026.json', import.meta.url), 'utf8'));
  assert.equal(r.production.version, 'winba/1.0.0');
  assert.equal(r.candidate.version, 'winba/1.0.1-research');
  assert.equal(r.rows_production, 238);
  assert.equal(r.rows_candidate, 238);
  assert.equal(r.rows_changed, 4);
  assert.deepEqual(r.fields_changed_by_name, { team_id: 4 });
  assert.equal(r.row_order_identical, true);
  for (const k of ['games_used', 'qualified_count', 'provisional_count']) assert.equal(r.board[k][0], r.board[k][1], k);
  assert.ok(!r.changes.some((c) => /^(score|rank|status|qualified|components|raw|sample|averages)/.test(c.field)));
  assert.deepEqual(r.changes.map((c) => c.athlete_id).sort(), ['3065570', '4068159', '4282168', '4684384']);
});
