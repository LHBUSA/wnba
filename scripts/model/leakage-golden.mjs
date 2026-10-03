#!/usr/bin/env node
// PBE WNBA leakage-guard golden (owner 2026-10-03): every committed 2026 fixture game predicted 15 minutes
// before tip with the frozen model. Written once from the pre-guard code; tests/pbe-leakage-guard.test.mjs
// proves the guarded code reproduces it byte for byte (the guard must be behaviour-neutral).
//
//   node scripts/model/leakage-golden.mjs            -> prints the golden
//   node scripts/model/leakage-golden.mjs --write    -> tests/fixtures/pbe-wnba-model/leakage-golden.json
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { predictFromRows } from '../../workers/shared/pbe-wnba-model.js';

const FX = new URL('../../tests/fixtures/pbe-wnba-model/', import.meta.url);

export function computeGolden() {
  const rows = zlib.gunzipSync(fs.readFileSync(new URL('rows-2025-2026.jsonl.gz', FX))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const games = JSON.parse(fs.readFileSync(new URL('games-2026.json', FX), 'utf8'));
  const out = [];
  for (const g of games) {
    const asOf = new Date(Date.parse(g.start_utc) - 15 * 60000).toISOString();
    const p = predictFromRows({ game: g, leagueRows: rows, asOf });
    out.push({ event_id: g.event_id, sha256: createHash('sha256').update(JSON.stringify(p)).digest('hex'), p_home: p.p_home, call: p.call });
  }
  const all = createHash('sha256').update(JSON.stringify(out)).digest('hex');
  return { schema: 'pbe-wnba-leakage-golden/1', games: out.length, sha256: all, predictions: out };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const g = computeGolden();
  if (process.argv.includes('--write')) fs.writeFileSync(new URL('leakage-golden.json', FX), JSON.stringify(g, null, 1) + '\n');
  console.log(JSON.stringify({ games: g.games, sha256: g.sha256 }));
}
