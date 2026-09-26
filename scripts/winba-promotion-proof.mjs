#!/usr/bin/env node
// winba/1.0.0 -> winba/1.0.1 promotion proof (READ-ONLY: GETs the public API only, never KV, never /run).
//
// prove   (pre-deploy): given a read-only pull of the archive (docs + archive:v1:index) at the SAME
//         archive signature as the live board,
//           1. winba-1.0.0.js over the docs in index order must reproduce the live board rows exactly
//              (proves the pull is production's archive state),
//           2. winba.js (1.0.1) over the same docs is diffed against the live board field by field.
//         Writes docs/research/winba-1.0.1-promotion-proof-2026.json (diff) and
//         docs/research/winba-1.0.1-expected-board-2026.json (the board 1.0.1 must serve).
//   node scripts/winba-promotion-proof.mjs prove --docs <docs.json> --index <index.json>
//
// verify  (post-deploy, after wnba-ingest 1.4.0 + POST /run/winba): the live board must be
//         winba/1.0.1, on the proof's archive signature, and equal the expected board on every
//         row and field (generated_at / version / photo ignored).
//   node scripts/winba-promotion-proof.mjs verify
//
// Exit 1 on any failure.

import fs from 'node:fs';
import { buildWinbaSnapshot as build100, WINBA_VERSION as V100 } from '../workers/shared/winba-1.0.0.js';
import { buildWinbaSnapshot as build101, WINBA_VERSION as V101 } from '../workers/shared/winba.js';

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : d; };
const API = opt('api', 'https://wnba-api.sales-fd3.workers.dev');
const PROOF = 'docs/research/winba-1.0.1-promotion-proof-2026.json';
const EXPECTED = 'docs/research/winba-1.0.1-expected-board-2026.json';
const EXPECTED_TEAM_CHANGES = { 3065570: 'Kelsey Plum', 4068159: 'Sug Sutton', 4282168: 'Kiana Williams', 4684384: 'Aneesah Morrow' };
const IGNORED = new Set(['generated_at', 'version', 'photo']);

const strip = (rows) => rows.map(({ photo, generated_at, version, ...r }) => r);

/** Every changed leaf of every row, keyed by athlete_id. */
export function diffRows(a, b) {
  const A = new Map(a.map((r) => [String(r.athlete_id), r]));
  const B = new Map(b.map((r) => [String(r.athlete_id), r]));
  const changes = [];
  const walk = (id, p, x, y) => {
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) if (!(p === '' && IGNORED.has(k))) walk(id, p ? `${p}.${k}` : k, x[k], y[k]);
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ athlete_id: id, field: p, before: x ?? null, after: y ?? null });
  };
  for (const id of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    if (!A.has(id) || !B.has(id)) changes.push({ athlete_id: id, field: '(row)', before: A.has(id) ? 'present' : null, after: B.has(id) ? 'present' : null });
    else walk(id, '', A.get(id), B.get(id));
  }
  return changes;
}

const group = (changes, re) => changes.filter((c) => re.test(c.field)).length;
function summarize(changes, before, after) {
  return {
    rows_before: before.length, rows_after: after.length,
    rows_changed: new Set(changes.map((c) => c.athlete_id)).size,
    fields_changed: changes.length,
    score_changes: group(changes, /^score$/), rank_changes: group(changes, /^rank$/), status_changes: group(changes, /^(status|qualified)$/),
    component_changes: group(changes, /^components\./), raw_changes: group(changes, /^raw\./), sample_changes: group(changes, /^sample\./), average_changes: group(changes, /^averages\./),
    team_id_changes: group(changes, /^team_id$/),
    unexpected_changes: changes.filter((c) => !(c.field === 'team_id' && EXPECTED_TEAM_CHANGES[c.athlete_id])).length,
    row_order_identical: before.map((r) => r.athlete_id).join() === after.map((r) => r.athlete_id).join()
  };
}

async function liveBoard() {
  const r = await fetch(`${API}/v1/stats/winba`, { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  if (!j.ok) throw new Error(`live board unavailable: ${JSON.stringify(j.error)}`);
  return j.data;
}

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };

if (mode === 'prove') {
  const live = await liveBoard();
  const docs = JSON.parse(fs.readFileSync(opt('docs'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(opt('index'), 'utf8')).map(String);
  const byId = new Map(docs.map((d) => [String(d.summary.game.game_id), d]));
  const sig = `${index.length}:${index.at(-1)}`;
  check(live.version === V100, `live board is ${V100} (got ${live.version})`);
  check(live.archive_signature === sig, `archive pull signature ${sig} == live ${live.archive_signature}`);
  const season = live.season;
  const inIndexOrder = index.map((id) => byId.get(id)).filter(Boolean);
  const rebuilt = build100(inIndexOrder, { season, generatedAt: live.generated_at });
  const liveRows = strip(live.rows);
  check(JSON.stringify(strip(rebuilt.rows)) === JSON.stringify(liveRows), `${V100} over the pull in index order reproduces all ${liveRows.length} live rows exactly`);
  const next = build101(docs, { season, generatedAt: live.generated_at });
  const shuffled = build101([...docs].reverse(), { season, generatedAt: live.generated_at });
  check(JSON.stringify(next) === JSON.stringify(shuffled), `${V101} is identical under reversed archive order`);
  const nextRows = strip(next.rows);
  const changes = diffRows(liveRows, nextRows);
  const s = summarize(changes, liveRows, nextRows);
  for (const k of ['score_changes', 'rank_changes', 'status_changes', 'component_changes', 'raw_changes', 'sample_changes', 'average_changes', 'unexpected_changes']) check(s[k] === 0, `${k} = ${s[k]}`);
  check(s.team_id_changes === 4 && changes.every((c) => EXPECTED_TEAM_CHANGES[c.athlete_id]), `team_id changes = ${s.team_id_changes} (${changes.map((c) => EXPECTED_TEAM_CHANGES[c.athlete_id] || c.athlete_id).join(', ')})`);
  check(s.row_order_identical, 'row order identical');
  for (const k of ['games_used', 'qualified_count', 'provisional_count']) check(live[k] === next[k], `${k} ${live[k]} == ${next[k]}`);
  const names = new Map(liveRows.map((r) => [String(r.athlete_id), r.name]));
  const proof = {
    generated_at: new Date().toISOString(),
    before: { source: `GET ${API}/v1/stats/winba (serves KV winba:v1:latest; photo stripped)`, version: live.version, generated_at: live.generated_at, archive_signature: live.archive_signature, games_used: live.games_used, rows: liveRows.length, reproduced_by: 'workers/shared/winba-1.0.0.js over the archive pull in archive-index order: exact' },
    after: { version: V101, ordering: 'start_utc ascending, then numeric game_id', builder: 'workers/shared/winba.js', archive: `${docs.length} archived documents, signature ${sig}`, games_used: next.games_used },
    summary: s,
    board: { games_used: [live.games_used, next.games_used], qualified_count: [live.qualified_count, next.qualified_count], provisional_count: [live.provisional_count, next.provisional_count] },
    changes: changes.map((c) => ({ ...c, name: names.get(c.athlete_id) || null }))
  };
  if (!failed) {
    fs.writeFileSync(PROOF, JSON.stringify(proof, null, 2) + '\n');
    fs.writeFileSync(EXPECTED, JSON.stringify({ version: V101, season, archive_signature: sig, games_used: next.games_used, qualified_count: next.qualified_count, provisional_count: next.provisional_count, rows: nextRows }, null, 1) + '\n');
    console.log(`wrote ${PROOF} and ${EXPECTED}`);
  }
} else if (mode === 'verify') {
  const live = await liveBoard();
  const exp = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
  check(live.version === V101, `live board version ${live.version} == ${V101}`);
  check(live.archive_signature === exp.archive_signature, `live archive signature ${live.archive_signature} == proof ${exp.archive_signature}${live.archive_signature === exp.archive_signature ? '' : ' (archive moved: re-run prove on a fresh pull)'}`);
  const changes = diffRows(exp.rows, strip(live.rows));
  check(changes.length === 0, `live rows == expected ${V101} board (${changes.length} field differences${changes.length ? `: ${changes.slice(0, 5).map((c) => `${c.athlete_id}.${c.field}`).join(', ')}` : ''})`);
  for (const k of ['games_used', 'qualified_count', 'provisional_count']) check(live[k] === exp[k], `${k} ${live[k]} == ${exp[k]}`);
  for (const [id, name] of Object.entries(EXPECTED_TEAM_CHANGES)) {
    const r = live.rows.find((x) => String(x.athlete_id) === id);
    const e = exp.rows.find((x) => String(x.athlete_id) === id);
    check(r && r.team_id === e.team_id, `${name} team_id ${r?.team_id} == ${e.team_id}`);
  }
} else {
  console.error('usage: winba-promotion-proof.mjs prove --docs <docs.json> --index <index.json> | verify');
  process.exit(2);
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
