#!/usr/bin/env node
// Build the FROZEN monthly WinBA boards for past periods from the deployed
// archive-complete dry run, and write them to the newsroom's monthly KV keys.
//
// The boards are built here, once, and stored. Publication then reads the stored
// board (`getMonthly`) and never recomputes from live state — which is what makes
// a published historical edition reproducible and immune to later roster moves.
//
// Read-only against production APIs; the only write is the monthly board key.
// Usage: node scripts/winba-backfill-boards.mjs <out-dir> [--periods=2026-05,...]

import fs from 'node:fs';
import crypto from 'node:crypto';
import { freezeWinbaMonthly } from '../workers/wnba-news/src/winba-index.js';

const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) || '.';
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const PERIODS = opt('periods', '2026-05,2026-06,2026-07,2026-08').split(',');
const TOKEN = fs.readFileSync('.admin-token', 'utf8').trim();
const INGEST = 'https://wnba-ingest.sales-fd3.workers.dev';
const API = 'https://wnba-api.propbetedge.ai';
const FROZEN_AT = opt('at', new Date().toISOString());
// A freeze instant in the future is not provenance, it is a placeholder, and a
// board carrying one gets retired by the identity audit the moment it is read.
if (!(Date.parse(FROZEN_AT) <= Date.now() + 60e3)) {
  console.error(`refusing --at=${FROZEN_AT}: a board cannot be frozen in the future`);
  process.exit(2);
}

const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

const dry = (await get(`${INGEST}/v1/winba/history-dryrun?top=25`, { authorization: `Bearer ${TOKEN}` })).data;
const players = (await get(`${API}/v1/players?limit=1000`)).data.players;

// Position and first-WNBA-season come from the roster; team identity comes from
// the box score, so a later trade cannot move a historical team assignment.
const playerById = new Map(players.map((p) => [String(p.athlete_id), {
  name: p.name, position: p.position ?? null, experience_years: p.experience_years ?? null
}]));
const teamById = new Map(players.filter((p) => p.team).map((p) => [String(p.team.team_id), {
  name: p.team.name, short_name: p.team.short_name
}]));

/** The dry-run period, shaped as the snapshot the freezer expects. */
const asSnapshot = (p) => ({
  version: 'winba/1.0.0',
  season: dry.season,
  generated_at: p.as_of,
  as_of: p.as_of,
  games_used: p.games_used,
  qualified_count: p.qualified_count,
  provisional_count: p.provisional_count,
  source: 'PropBetEdge final-game archive derived from ESPN box scores',
  rows: p.top.map((r) => ({
    athlete_id: String(r.athlete_id), name: r.name, team_id: r.team_id ? String(r.team_id) : null,
    score: r.score, rank: r.rank, qualified: true,
    sample: { games: r.games, wins: r.wins, losses: (r.games ?? 0) - (r.wins ?? 0), minutes: r.minutes },
    averages: { min: r.min, pts: r.pts, reb: r.reb, ast: r.ast },
    components: {
      production_percentile: r.production_percentile,
      win_rate: r.win_rate,
      winning_output_share: r.winning_output_share,
      court_share: r.court_share
    }
  }))
});

const hash = (b) => crypto.createHash('sha256')
  .update(JSON.stringify((b.rows || []).map((r) => [r.rank, r.player_id, r.score, r.team_id, r.components])))
  .digest('hex').slice(0, 16);

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const period of PERIODS) {
  const p = dry.periods.find((x) => x.period === period);
  if (!p) { console.log(`${period}: absent from the dry run`); continue; }
  const frozen = freezeWinbaMonthly(asSnapshot(p), { period, playerById, teamById, at: FROZEN_AT, top: 25 });
  if (!frozen) { console.log(`${period}: not freezable`); continue; }
  const file = `${OUT}/board-${period}.json`;
  fs.writeFileSync(file, JSON.stringify(frozen));
  report.push({ period, rows: frozen.rows.length, qualified: frozen.qualified_count, games: frozen.games_used, as_of: frozen.leaderboard_as_of, hash: hash(frozen), file });
  console.log(`${period}: ${frozen.rows.length} rows | qualified ${frozen.qualified_count} | games ${frozen.games_used} | as_of ${frozen.leaderboard_as_of} | hash ${hash(frozen)}`);
  console.log(`   top3: ${frozen.rows.slice(0, 3).map((r) => `#${r.rank} ${r.player_name} ${Math.round(r.score)} (${r.team_name})`).join(' | ')}`);
}
fs.writeFileSync(`${OUT}/boards-report.json`, JSON.stringify(report, null, 1));
console.log(`\nwrote ${report.length} board file(s) to ${OUT}`);
