#!/usr/bin/env node
// PBE WNBA model — dataset builder. Uses workers/shared/pbe-wnba-features.js ONLY.
//
//   node scripts/model/build-dataset.mjs rows                 # summaries -> team-game rows + audit
//   node scripts/model/build-dataset.mjs features [k] [r]     # rows -> feature dataset (CSV)
//   node scripts/model/build-dataset.mjs grid                 # every (k, r) in the selection grid
//
// Output (outside Git): $WNBA_MODEL_DATA/derived/
//   rows.jsonl.gz                team-game rows (two per usable game)
//   games.json                   game index incl. exclusion reasons
//   markets-eval-only.jsonl      ESPN pickcenter moneylines, EVALUATION ONLY — never read by features
//   audit.json                   completeness / era / trap counts
//   dataset_k{k}_r{r}.csv        one row per eligible-or-not game, home-oriented

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { teamGameRowFromSummary, buildFeatures, CANDIDATE_NAMES, DEFAULT_PARAMS } from '../../workers/shared/pbe-wnba-features.js';

const ROOT = process.env.WNBA_MODEL_DATA || 'D:/Workers/wnba-model-data';
const RAW = path.join(ROOT, 'raw');
const OUT = path.join(ROOT, 'derived');
export const GRID = { prior_games: [4, 8, 12, 20], carryover: [0.4, 0.6, 0.8] };
export const FIRST_SEASON = 2002;
// Prediction instant used for the historical dataset: 15 minutes before scheduled tip.
export const AS_OF_OFFSET_MIN = 15;

const readGz = async (p) => JSON.parse(gunzipSync(await readFile(p)).toString('utf8'));

async function rows() {
  await mkdir(OUT, { recursive: true });
  const sbFiles = (await readdir(path.join(RAW, 'scoreboard'))).filter((f) => /^\d{4}\.json\.gz$/.test(f)).sort();
  const events = new Map();
  for (const f of sbFiles) for (const e of (await readGz(path.join(RAW, 'scoreboard', f))).payload.events || []) events.set(e.id, e);

  // Franchise set per season: team ids with >= 10 regular-season finals (drops All-Star / exhibition teams).
  const franchiseCount = new Map();
  for (const e of events.values()) {
    if (e.season?.type !== 2 || e.status?.type?.name !== 'STATUS_FINAL') continue;
    for (const c of e.competitions?.[0]?.competitors || []) {
      const k = `${e.season.year}:${c.id}`;
      franchiseCount.set(k, (franchiseCount.get(k) || 0) + 1);
    }
  }
  const isFranchise = (season, id) => (franchiseCount.get(`${season}:${id}`) || 0) >= 10;

  const audit = { seasons: {}, excluded: {}, notes: [] };
  const bump = (season, key, n = 1) => {
    audit.seasons[season] ||= {};
    audit.seasons[season][key] = (audit.seasons[season][key] || 0) + n;
  };
  const games = [];
  const outRows = [];
  const markets = [];
  const sumDir = path.join(RAW, 'summary');
  const have = new Set((await readdir(sumDir)).map((f) => f.replace('.json.gz', '')));

  for (const e of [...events.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    const season = e.season?.year; const type = e.season?.type; const status = e.status?.type?.name;
    if (season < FIRST_SEASON) continue;
    bump(season, `events_type${type}_${status}`);
    if (type !== 2 && type !== 3) continue;
    if (status !== 'STATUS_FINAL') continue;
    const comp = e.competitions?.[0];
    const ids = (comp?.competitors || []).map((c) => c.id);
    const g = { event_id: e.id, season, season_type: type, start_utc: new Date(e.date).toISOString(), neutral: Boolean(comp?.neutralSite), notes: (comp?.notes || []).map((n) => n.headline).filter(Boolean) };
    const exclude = (reason) => { g.excluded = reason; audit.excluded[reason] = (audit.excluded[reason] || 0) + 1; bump(season, `excluded_${reason}`); games.push(g); };
    if (ids.length !== 2 || !ids.every((id) => isFranchise(season, id))) { exclude('non_franchise_team'); continue; }
    if (!have.has(e.id)) { exclude('summary_missing'); continue; }
    const env = await readGz(path.join(sumDir, `${e.id}.json.gz`));
    if (env.status !== 200) { exclude(`summary_http_${env.status}`); continue; }
    let pair;
    try { pair = teamGameRowFromSummary(env.payload, { season, season_type: type }); }
    catch (err) { exclude(`row_error:${err.message}`); continue; }
    const [a, h] = pair;
    g.home_id = h.team_id; g.away_id = a.team_id; g.home_won = h.won; g.neutral = h.neutral;
    g.box_complete = h.box_complete; g.players_complete = h.players_complete && a.players_complete;
    if (g.neutral) bump(season, 'neutral_site');
    if (g.notes.length) bump(season, 'with_notes');
    bump(season, 'usable_finals');
    if (h.box_complete) bump(season, 'box_complete'); else bump(season, 'box_incomplete');
    if (g.players_complete) bump(season, 'players_complete');
    games.push(g);
    outRows.push(a, h);

    const pc = env.payload.pickcenter || [];
    const ml = pc.find((p) => Number.isFinite(Number(p?.homeTeamOdds?.moneyLine)) && Number.isFinite(Number(p?.awayTeamOdds?.moneyLine)));
    if (ml) {
      bump(season, 'market_moneyline_eval_only');
      markets.push({ event_id: e.id, provider: ml.provider?.name || null, home_ml: Number(ml.homeTeamOdds.moneyLine), away_ml: Number(ml.awayTeamOdds.moneyLine), source_url: env.source_url, captured_at: env.captured_at, timing: 'unknown (ESPN pickcenter, not timestamped; treat as near-close)' });
    }
  }
  const rowsBody = outRows.map((r) => JSON.stringify(r)).join('\n');
  await writeFile(path.join(OUT, 'rows.jsonl.gz'), gzipSync(rowsBody));
  await writeFile(path.join(OUT, 'games.json'), JSON.stringify(games));
  await writeFile(path.join(OUT, 'markets-eval-only.jsonl'), markets.map((m) => JSON.stringify(m)).join('\n'));
  audit.rows = outRows.length;
  audit.rows_sha256 = createHash('sha256').update(rowsBody).digest('hex');
  audit.games_usable = games.filter((g) => !g.excluded).length;
  await writeFile(path.join(OUT, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log(`rows ${outRows.length}, usable games ${audit.games_usable}, excluded`, audit.excluded);
}

async function loadRows() {
  const body = gunzipSync(await readFile(path.join(OUT, 'rows.jsonl.gz'))).toString('utf8');
  return body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export async function features(k = DEFAULT_PARAMS.prior_games, r = DEFAULT_PARAMS.carryover, { allRows = null, games = null } = {}) {
  allRows ||= await loadRows();
  games ||= JSON.parse(await readFile(path.join(OUT, 'games.json'), 'utf8'));
  const params = { ...DEFAULT_PARAMS, prior_games: k, carryover: r };
  const byTeam = new Map();
  for (const row of allRows) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id).push(row);
  }
  // League rows limited to the two seasons a game can read keeps sos O(season).
  const bySeason = new Map();
  for (const row of allRows) {
    if (!bySeason.has(row.season)) bySeason.set(row.season, []);
    bySeason.get(row.season).push(row);
  }
  const header = ['event_id', 'season', 'season_type', 'start_utc', 'home_id', 'away_id', 'neutral', 'home_won', 'eligible', 'home_n_current', 'away_n_current', 'home_carryover', 'away_carryover', ...CANDIDATE_NAMES];
  const lines = [header.join(',')];
  for (const g of games) {
    if (g.excluded || !g.box_complete) continue;
    const asOf = new Date(Date.parse(g.start_utc) - 15 * 60000).toISOString();
    const leagueRows = [...(bySeason.get(g.season) || []), ...(bySeason.get(g.season - 1) || [])];
    const f = buildFeatures({ game: g, homeRows: byTeam.get(g.home_id), awayRows: byTeam.get(g.away_id), leagueRows, asOf, params });
    lines.push([g.event_id, g.season, g.season_type, g.start_utc, g.home_id, g.away_id, g.neutral ? 1 : 0, g.home_won ? 1 : 0, f.eligible ? 1 : 0,
      f.teams.home.n_current, f.teams.away.n_current, f.teams.home.carryover ? 1 : 0, f.teams.away.carryover ? 1 : 0,
      ...f.vector.map((v) => v.toPrecision(17))].join(','));
  }
  const file = path.join(OUT, `dataset_k${k}_r${r}.csv`);
  const body = lines.join('\n') + '\n';
  await writeFile(file, body);
  console.log(`${file}: ${lines.length - 1} games, sha256 ${createHash('sha256').update(body).digest('hex')}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'model', 'build-dataset.mjs'));
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'rows') await rows();
  else if (cmd === 'features') await features(Number(a ?? DEFAULT_PARAMS.prior_games), Number(b ?? DEFAULT_PARAMS.carryover));
  else if (cmd === 'grid') {
    const allRows = await loadRows();
    const games = JSON.parse(await readFile(path.join(OUT, 'games.json'), 'utf8'));
    for (const k of GRID.prior_games) for (const r of GRID.carryover) await features(k, r, { allRows, games });
  } else { console.error('usage: build-dataset.mjs rows|features [k r]|grid'); process.exit(2); }
}
