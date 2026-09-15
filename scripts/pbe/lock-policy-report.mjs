#!/usr/bin/env node
// Lock-policy evidence report (owner decision 5). Reads the injury-feed checkpoints the PBE runner records around
// every covered tip (KV pbe:v1:shadow:availchk:<game>) and reports how often availability changes after T-60, T-30
// and T-15. Read-only. T-15m stays experimental until this evidence is reviewed.
//
//   node scripts/pbe/lock-policy-report.mjs [--json out.json]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { diffAvailability } from '../../workers/wnba-ingest/src/pbe-runner.js';

const NS = 'c3249a8e3552438da38c6cad0d54e172';
const wr = (args) => {
  const r = spawnSync('npx', ['wrangler', 'kv', ...args, '--namespace-id', NS, '--remote'], { encoding: 'utf8', shell: true, cwd: 'workers/wnba-ingest', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).slice(0, 300));
  return r.stdout;
};
const keys = JSON.parse(wr(['key', 'list', '--prefix', 'pbe:v1:shadow:availchk:'])).map((k) => k.name);
const games = keys.map((k) => JSON.parse(wr(['key', 'get', k])));

const WINDOWS = [['60', '30', 'T-60 → T-30'], ['30', '15', 'T-30 → T-15'], ['15', '0', 'T-15 → T-0']];
const rows = games.map((d) => {
  const c = d.checkpoints || {};
  const out = { game_id: d.game.game_id, tip: d.game.scheduled_tip_utc, recorded: Object.keys(c).sort(), windows: {} };
  for (const [a, b, label] of WINDOWS) {
    if (!c[a] || !c[b]) { out.windows[label] = null; continue; }
    const changes = diffAvailability(c[a].players, c[b].players);
    out.windows[label] = { status_changes: changes.filter((x) => x.kind !== 'source_updated').length, source_updates: changes.filter((x) => x.kind === 'source_updated').length, changes };
  }
  // Late first sighting (e.g. the runner first saw the game at T-14) means earlier checkpoints were recorded late.
  out.late_checkpoints = Object.entries(c).filter(([k, v]) => v.minutes_before_tip < Number(k) - 3).map(([k]) => k);
  return out;
});
const summary = Object.fromEntries(WINDOWS.map(([, , label]) => {
  const w = rows.map((r) => r.windows[label]).filter(Boolean);
  return [label, { games_measured: w.length, games_with_status_change: w.filter((x) => x.status_changes > 0).length, status_changes: w.reduce((s, x) => s + x.status_changes, 0) }];
}));
const report = { generated_at: new Date().toISOString(), games: rows.length, summary, feed_note: 'ESPN injury feed, polled every 2 minutes within 75 minutes of a covered tip (every 10 minutes otherwise). A checkpoint reflects the latest poll, whose capture time is recorded.', rows };
console.log(JSON.stringify({ games: report.games, summary }, null, 2));
const i = process.argv.indexOf('--json');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2));
