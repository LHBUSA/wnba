#!/usr/bin/env node
// PBE WNBA model — leakage audit over the real dataset.
//
// For a deterministic sample of eligible games it proves, against the one feature
// implementation, that the vector cannot see:
//   L1  anything on or after the target game's ET calendar date (all such rows are
//       corrupted: scores flipped, box stats scrambled, players replaced, and fake
//       extra future games injected) — vector must be byte-identical;
//   L2  the target game's own final score / box (its rows are corrupted) — identical;
//   L3  a same-ET-day game that finished before the prediction instant — identical;
//   L4  sportsbook or injury inputs — the feature module's code has no such token.
//
//   node scripts/model/leakage-audit.mjs   -> $WNBA_MODEL_DATA/derived/leakage.json

import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { buildFeatures, DEFAULT_PARAMS, etDateOf } from '../../workers/shared/pbe-wnba-features.js';

const ROOT = process.env.WNBA_MODEL_DATA || 'D:/Workers/wnba-model-data';
const OUT = path.join(ROOT, 'derived');

function corrupt(r, salt) {
  const c = structuredClone(r);
  c.pts = r.opp_pts + 40 + salt; c.opp_pts = Math.max(0, r.pts - 40); c.won = !r.won;
  for (const side of ['own', 'opp']) if (c[side]) for (const k of Object.keys(c[side])) c[side][k] = c[side][k] * 3 + 7;
  c.poss = (r.poss || 70) * 1.7;
  c.players = [{ id: `fake-${salt}`, min: 40, starter: true }];
  return c;
}

export function sameVector(a, b) {
  return a.vector.length === b.vector.length && a.vector.every((v, i) => Object.is(v, b.vector[i]));
}

async function main() {
  const rows = gunzipSync(await readFile(path.join(OUT, 'rows.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const games = JSON.parse(await readFile(path.join(OUT, 'games.json'), 'utf8')).filter((g) => !g.excluded && g.box_complete && g.season >= 2005);
  const art = JSON.parse(await readFile(new URL('../../model/pbe-wnba-model-v1/artifact.json', import.meta.url), 'utf8').catch(() => 'null'));
  const params = art?.params || DEFAULT_PARAMS;
  // Deterministic sample: every 17th game.
  const sample = games.filter((_, i) => i % 17 === 0);
  const result = { params, sampled_games: sample.length, L1_future_rows_corrupted: 0, L2_own_rows_corrupted: 0, L3_same_day_injected: 0, failures: [] };
  for (const g of sample) {
    const asOf = new Date(Date.parse(g.start_utc) - 15 * 60000).toISOString();
    const gd = etDateOf(g.start_utc);
    const pool = rows.filter((r) => r.season === g.season || r.season === g.season - 1);
    const run = (rs) => buildFeatures({ game: g, homeRows: rs.filter((r) => r.team_id === g.home_id), awayRows: rs.filter((r) => r.team_id === g.away_id), leagueRows: rs, asOf, params });
    const base = run(pool);
    if (!base.eligible) continue;

    let salt = 0;
    const l1 = pool.map((r) => (r.et_date >= gd && r.event_id !== g.event_id ? corrupt(r, ++salt) : r));
    const fakeFuture = [g.home_id, g.away_id].map((t, i) => ({ ...corrupt(pool.find((r) => r.team_id === t) || pool[0], 99 + i), team_id: t, event_id: `future-${i}`, season: g.season, season_type: 2, start_utc: new Date(Date.parse(g.start_utc) + 86400000).toISOString(), et_date: etDateOf(new Date(Date.parse(g.start_utc) + 86400000).toISOString()), box_complete: true }));
    if (!sameVector(base, run([...l1, ...fakeFuture]))) result.failures.push({ test: 'L1', event_id: g.event_id });
    else result.L1_future_rows_corrupted++;

    const l2 = pool.map((r) => (r.event_id === g.event_id ? corrupt(r, 7) : r));
    if (!sameVector(base, run(l2))) result.failures.push({ test: 'L2', event_id: g.event_id });
    else result.L2_own_rows_corrupted++;

    // A same-day game that started 3 hours before tip and is already final.
    const early = new Date(Date.parse(g.start_utc) - 3 * 3600000).toISOString();
    const sameDay = [g.home_id, g.away_id].map((t, i) => ({ ...corrupt(pool.find((r) => r.team_id === t) || pool[0], 50 + i), team_id: t, event_id: `sameday-${i}`, season: g.season, season_type: 2, start_utc: early, et_date: etDateOf(early), box_complete: true }));
    if (etDateOf(early) === gd) {
      if (!sameVector(base, run([...pool, ...sameDay]))) result.failures.push({ test: 'L3', event_id: g.event_id });
      else result.L3_same_day_injected++;
    }
  }
  const src = await readFile(new URL('../../workers/shared/pbe-wnba-features.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const banned = ['odds', 'moneyline', 'moneyLine', 'price', 'pickcenter', 'spread', 'injur', 'overUnder'];
  result.L4_banned_tokens_in_feature_code = banned.filter((t) => code.includes(t));
  if (result.L4_banned_tokens_in_feature_code.length) result.failures.push({ test: 'L4', tokens: result.L4_banned_tokens_in_feature_code });
  result.pass = result.failures.length === 0;
  result.run_at = new Date().toISOString();
  await writeFile(path.join(OUT, 'leakage.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  if (!result.pass) process.exit(1);
}

await main();
