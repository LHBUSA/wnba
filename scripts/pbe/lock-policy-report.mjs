#!/usr/bin/env node
// Lock-policy evidence report (owner decision 2026-09-15): first review after 10 completed shadow games with
// complete checkpoint evidence, confirmation at 20. Read-only against production KV.
//
//   node scripts/pbe/lock-policy-report.mjs [--json docs/evidence/pbe/lock-policy-<date>.json]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeGame, summarize } from './lock-policy-analysis.mjs';

const NS = 'c3249a8e3552438da38c6cad0d54e172';
const wr = (args) => {
  const r = spawnSync('npx', ['wrangler', 'kv', ...args, '--namespace-id', NS, '--remote'], { encoding: 'utf8', shell: true, cwd: 'workers/wnba-ingest', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).slice(0, 300));
  return r.stdout;
};
const keys = JSON.parse(wr(['key', 'list', '--prefix', 'pbe:v1:shadow:availchk:'])).map((k) => k.name);
const now = Date.now();
const rows = keys.map((k) => {
  const doc = JSON.parse(wr(['key', 'get', k]));
  // Complete = at least 3 hours past scheduled tip (a WNBA game is final well inside that).
  return analyzeGame(doc, { completed: Date.parse(doc.game.scheduled_tip_utc) + 3 * 3600e3 < now });
}).sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip));
const summary = summarize(rows);
const report = { generated_at: new Date(now).toISOString(), lock_policy_status: 'T-15m EXPERIMENTAL SHADOW', summary, games: rows };
console.log(JSON.stringify({ summary }, null, 2));
const i = process.argv.indexOf('--json');
if (i > 0) { fs.mkdirSync(path.dirname(process.argv[i + 1]), { recursive: true }); fs.writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2)); }
