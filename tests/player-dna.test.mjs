// WNBA Player DNA V1 (wnba-player-dna/1.0.0) — docs/WNBA_PLAYER_DNA_V1.md.
// Hand-computed formulas, gates, leakage/truncation, WinBA integrity, Player Load /
// injury separation, All-Star exclusion, determinism and provenance.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  PLAYER_DNA_VERSION,
  PLAYER_DNA_CONTRACT,
  DIMENSIONS,
  DESCRIPTIVE_DIMENSIONS,
  SCOPES,
  percentile,
  gameScore,
  teamMinutes,
  teamLineFromStats,
  selectDnaGames,
  aggregatePlayers,
  metrics,
  mergeTotals,
  traits,
  buildPlayerDna,
  playerDnaFor,
  canonicalWinbaBoardAsOf
} from '../workers/shared/player-dna.js';
import {
  WINBA_VERSION,
  WINBA_WEIGHTS,
  buildWinbaSnapshot,
  buildWinbaSnapshotAsOf,
  winbaForPlayer
} from '../workers/shared/winba.js';
import { FRANCHISES, makeDoc, playerLine, league, ALL_STAR } from './fixtures/player-dna-league.mjs';

// ------------------------------------------------------------------ fixtures

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const DOCS = league();
const LAST_TIP = Math.max(...DOCS.map((d) => Date.parse(d.summary.game.start_utc)));
const AS_OF = new Date(LAST_TIP + 1000).toISOString();
const MID = new Date(Date.parse(DOCS[29].summary.game.start_utc)).toISOString(); // exclusive: games 0..28 (+ same-tip none)
const OPTS = { franchiseTeamIds: FRANCHISES };

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

// ------------------------------------------------------------------ formulas

test('every box formula matches a hand computation (one overtime game)', () => {
  const row = { athlete_id: 'p', team_id: '1', starter: true, dnp: false, min: 30, pts: 20, fgm: 7, fga: 15, fg3m: 2, fg3a: 5, ftm: 4, fta: 5, oreb: 2, dreb: 6, ast: 5, stl: 2, blk: 1, tov: 3, pf: 2 };
  const stats = [
    { team_id: '1', stats: { 'fieldGoalsMade-fieldGoalsAttempted': '30-70', 'freeThrowsMade-freeThrowsAttempted': '15-20', totalTurnovers: '12', turnovers: '11', offensiveRebounds: '10', defensiveRebounds: '25' } },
    { team_id: '2', stats: { 'fieldGoalsMade-fieldGoalsAttempted': '28-72', 'freeThrowsMade-freeThrowsAttempted': '10-14', totalTurnovers: '14', offensiveRebounds: '8', defensiveRebounds: '28' } }
  ];
  const doc = makeDoc({ id: 'g1', tip: '2026-06-01T23:00:00Z', home: '1', away: '2', rows: [row], periods: 5, stats });
  const { games } = selectDnaGames([doc], { asOf: '2026-06-02T00:00:00Z', franchiseTeamIds: ['1', '2'] });
  assert.equal(games[0].team_minutes, 225, '200 + 25 per overtime period');
  const t = aggregatePlayers(games).get('p').seasons.get(2026).regular;
  const m = metrics(t);
  close(m.pts_per36, 24);
  close(m.pts_per_game, 20);
  close(m.ts_pct, 20 / (2 * (15 + 0.44 * 5)));
  close(m.efg_pct, (7 + 0.5 * 2) / 15);
  close(m.usage_pct, (100 * (15 + 0.44 * 5 + 3) * 45) / (30 * (70 + 0.44 * 20 + 12)), 1e-9);
  close(m.ast_pct, (100 * 5) / ((30 / 45) * 30 - 7));
  close(m.orb_pct, (100 * 2 * 45) / (30 * (10 + 28)));
  close(m.drb_pct, (100 * 6 * 45) / (30 * (25 + 8)));
  close(m.tov_pct, (100 * 3) / (15 + 0.44 * 5 + 3));
  close(m.fta_per36, 6);
  close(m.fg2a_per36, 12);
  close(m.fg3a_per36, 6);
  close(m.stl_per36, 2.4);
  close(m.blk_per36, 1.2);
  close(m.pf_per36, 2.4);
  close(m.mpg, 30);
  close(m.start_rate, 1);
  close(gameScore(row), 17.5);
  close(t.gmsc, 17.5);
  // gated metrics are null, never 0
  assert.equal(m.fg3_pct, null, '5 3PA < 20');
  assert.equal(m.ft_pct, null, '5 FTA < 15');
  assert.equal(m.ft_rate, null, '15 FGA < 40');
  assert.equal(m.gmsc_sd, null, '1 game < 10');
  assert.equal(m.vs_winning_gmsc36_delta, null);
  close(m.availability, 1);
});

test('team lines parse the archived display strings; totalTurnovers wins over turnovers', () => {
  assert.deepEqual(teamLineFromStats({ 'fieldGoalsMade-fieldGoalsAttempted': '24-73', 'freeThrowsMade-freeThrowsAttempted': '16-22', totalTurnovers: '7', turnovers: '6', offensiveRebounds: '12', defensiveRebounds: '17' }),
    { fgm: 24, fga: 73, ftm: 16, fta: 22, tov: 7, oreb: 12, dreb: 17 });
  assert.deepEqual(teamLineFromStats({}), { fgm: null, fga: null, ftm: null, fta: null, tov: null, oreb: null, dreb: null });
  assert.equal(teamMinutes(4), 200);
  assert.equal(teamMinutes(6), 250);
  assert.equal(teamMinutes(undefined), 200);
});

test('percentiles use mid-rank for ties', () => {
  const xs = [1, 2, 2, 3];
  assert.equal(percentile(1, xs), 0);
  assert.equal(percentile(2, xs), 0.5); // (1 less + (2-1)/2) / 3
  assert.equal(percentile(3, xs), 1);
  assert.equal(percentile(5, [5]), 1);
  assert.equal(percentile(null, xs), null);
  assert.equal(percentile(2, []), null);
  assert.equal(percentile(4, [4, 4, 4, 4, 4]), 0.5);
});

test('availability, volatility, form and opponent strength match hand computations', () => {
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  // P4526 was DNP in rounds 0,3,6,...,21 (8 of 24 team games); first appearance round 1, last round 23
  const p = players(AS_OF).get('4526');
  const t = p.seasons.get(2026).regular;
  assert.equal(t.games, 16);
  assert.equal(t.tenure_team_games, 23, 'team games between first (round 1) and last (round 23) appearance');
  const dur = out.players['4526'].scopes.season.dimensions.durability;
  assert.equal(dur.components[0].value, Math.round((16 / 23) * 1000) / 1000);
  // volatility = population SD of per-game Game Score over games with >= 10 min
  const recs = p.records.filter((r) => r.totals.min >= 10);
  const gs = recs.map((r) => r.totals.gmsc);
  const mean = gs.reduce((a, b) => a + b, 0) / gs.length;
  const sd = Math.sqrt(gs.reduce((a, b) => a + b * b, 0) / gs.length - mean * mean);
  const m = metrics(t);
  close(m.gmsc_sd, sd, 1e-9);
  // form = GS/36 over last 10 regular games minus whole season
  const last = mergeTotals(...p.records.slice(-10).map((r) => r.totals));
  const expectForm = (last.gmsc / last.min) * 36 - (t.gmsc / t.min) * 36;
  const star = out.players['1026'].scopes.season.dimensions.form;
  const p1 = players(AS_OF).get('1026');
  const t1 = p1.seasons.get(2026).regular;
  const l1 = mergeTotals(...p1.records.slice(-10).map((r) => r.totals));
  close(star.components[0].value, Math.round(((l1.gmsc / l1.min) * 36 - (t1.gmsc / t1.min) * 36) * 10) / 10, 1e-9);
  assert.ok(Number.isFinite(expectForm));
});

function players(asOf, docs = DOCS) {
  return aggregatePlayers(selectDnaGames(docs, { asOf, ...OPTS }).games);
}

test('opponent strength reads only games before the tip (>= 10 prior games)', () => {
  const ps = players(AS_OF);
  // each team has played r games before round r; the first 10 rounds can never count as vs-winning games
  for (const p of ps.values()) {
    for (const rec of p.records) {
      const round = Math.floor((Number(rec.game_id) - 1000) / 2);
      if (round < 10) assert.equal(rec.totals.vw_games, 0, `game ${rec.game_id} has < 10 prior opponent games`);
    }
  }
  // truncating the future does not change any past game's opponent-strength flag
  const early = players(MID);
  for (const [id, p] of early) {
    const full = ps.get(id).records;
    for (const rec of p.records) assert.equal(rec.totals.vw_games, full.find((r) => r.game_id === rec.game_id).totals.vw_games);
  }
});

// ------------------------------------------------------------------ gates and nulls

test('qualification gates: < 10 games or < 200 minutes -> scope not calculated', () => {
  const nine = buildPlayerDna(DOCS.slice(0, 18), { asOf: AS_OF, ...OPTS }); // 9 games per team
  for (const p of Object.values(nine.players)) {
    assert.equal(p.scopes.season.calculated, false);
    assert.equal(p.scopes.season.reason, 'INSUFFICIENT_SAMPLE');
    assert.deepEqual(p.scopes.season.qualification, { games: 10, minutes: 200 });
  }
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  // k=6 bench players average ~6 min: 24 games but < 200 minutes
  const bench = out.players['1626'];
  assert.ok(bench.scopes.season.sample.games >= 10 && bench.scopes.season.sample.minutes < 200);
  assert.equal(bench.scopes.season.calculated, false);
  const star = out.players['1026'].scopes.season;
  assert.equal(star.calculated, true);
  assert.equal(star.population.n, Object.values(out.players).filter((p) => p.scopes.season.calculated).length);
  assert.ok(star.population.n >= 20);
  assert.deepEqual(star.flags, []);
});

test('low population (< 20 qualified) is flagged and caps confidence at 0.45', () => {
  // three franchises only: every game involving team 4 becomes a non-franchise fixture
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, franchiseTeamIds: ['1', '2', '3'] });
  const sc = out.players['1026'].scopes.season;
  assert.ok(sc.population.n < 20);
  assert.deepEqual(sc.flags, ['LOW_POPULATION']);
  for (const d of Object.values(sc.dimensions)) if (d.confidence != null) { assert.ok(d.confidence <= 0.45); assert.equal(d.confidence_label, 'LOW'); }
});

test('missing inputs become null, never 0: no team line -> share metrics null; null minutes -> excluded', () => {
  const rows = [
    { athlete_id: 'x', team_id: '1', starter: true, dnp: false, min: 20, pts: 10, fgm: 4, fga: 8, fg3m: 0, fg3a: 1, ftm: 2, fta: 2, oreb: 1, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, pf: 1 },
    { athlete_id: 'y', team_id: '1', starter: false, dnp: false, min: null, pts: 4 },
    { athlete_id: 'w', team_id: '2', starter: false, dnp: false, min: 0, pts: 0 }
  ];
  const doc = makeDoc({ id: 'g', tip: '2026-06-01T23:00:00Z', home: '1', away: '2', rows, stats: [] });
  const ps = aggregatePlayers(selectDnaGames([doc], { asOf: '2026-06-02T00:00:00Z', franchiseTeamIds: ['1', '2'] }).games);
  const m = metrics(ps.get('x').seasons.get(2026).regular);
  assert.equal(m.usage_pct, null);
  assert.equal(m.ast_pct, null);
  assert.equal(m.orb_pct, null);
  assert.equal(m.drb_pct, null);
  assert.equal(m.tov_pct, null, 'gated on usage, which is unknown');
  close(m.pts_per36, 18);
  const y = ps.get('y').seasons.get(2026).regular;
  assert.equal(y.games, 0);
  assert.equal(y.excluded_no_minutes, 1);
  assert.equal(y.pts, 0, 'an excluded line contributes nothing');
  assert.equal(ps.has('w'), false, 'zero minutes is not an appearance');
});

test('a dimension with some gated components scores on the rest and scales confidence', () => {
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  let seen = false;
  for (const p of Object.values(out.players)) {
    const d = p.scopes.season.calculated ? p.scopes.season.dimensions.shooting_profile : null;
    if (!d || d.score == null) continue;
    const present = d.components.filter((c) => c.percentile != null);
    assert.equal(d.score, Math.round(present.reduce((s, c) => s + c.percentile, 0) / present.length));
    for (const c of d.components) if (c.percentile == null) { assert.equal(c.value, null); seen = true; }
  }
  assert.ok(seen, 'fixture exercises a gated (null) 3P% or FT% component');
});

// ------------------------------------------------------------------ time: as-of and leakage

const stripRun = (o) => ({ ...o, provenance: { ...o.provenance, docs_considered: null, excluded: { ...o.provenance.excluded, after_as_of: null } } });

test('L1 truncation invariance: as_of D == running on data truncated to tip < D', () => {
  const full = buildPlayerDna(DOCS, { asOf: MID, ...OPTS });
  const truncated = buildPlayerDna(DOCS.filter((d) => Date.parse(d.summary.game.start_utc) < Date.parse(MID)), { asOf: MID, ...OPTS });
  assert.equal(JSON.stringify(stripRun(full)), JSON.stringify(stripRun(truncated)));
  assert.equal(full.provenance.excluded.after_as_of, DOCS.length - 29);
});

test('L2 future games and future revisions never change a historical snapshot', () => {
  const before = JSON.stringify(stripRun(buildPlayerDna(DOCS, { asOf: MID, ...OPTS })));
  const revised = structuredClone(DOCS);
  for (const d of revised.slice(29)) for (const r of d.summary.box.players) if (!r.dnp) { r.pts += 30; r.min += 5; }
  const more = league({ rounds: 6, start: LAST_TIP + 86400e3, idBase: 5000 });
  const after = JSON.stringify(stripRun(buildPlayerDna([...revised, ...more], { asOf: MID, ...OPTS })));
  assert.equal(after, before);
});

test('a game tipping exactly at as_of is excluded (exclusive cutoff)', () => {
  const tip = DOCS[10].summary.game.start_utc;
  const sel = selectDnaGames(DOCS, { asOf: tip, ...OPTS });
  assert.ok(sel.games.every((g) => g.tip_ms < Date.parse(tip)));
  assert.equal(sel.games.length, 10);
});

test('historical WinBA: the as-of canonical board is attached; a later board is refused', () => {
  const pastBoard = canonicalWinbaBoardAsOf(DOCS, { season: 2026, asOf: MID });
  const nowBoard = canonicalWinbaBoardAsOf(DOCS, { season: 2026, asOf: AS_OF });
  const past = buildPlayerDna(DOCS, { asOf: MID, ...OPTS, winbaBoard: pastBoard });
  let n = 0;
  let differs = false;
  for (const [id, p] of Object.entries(past.players)) {
    const w = p.scopes.season.calculated ? p.scopes.season.dimensions.winba : null;
    if (!w || w.score == null) continue;
    assert.equal(w.value, winbaForPlayer(pastBoard, id).score);
    if (winbaForPlayer(nowBoard, id).score !== w.value) differs = true;
    n += 1;
  }
  assert.ok(n > 0 && differs, 'the fixture has WinBA movement between the two dates');
  // today's board on a past snapshot: refused by the archive-state check, never attached
  const wrong = buildPlayerDna(DOCS, { asOf: MID, ...OPTS, winbaBoard: nowBoard });
  assert.equal(wrong.winba.reason, 'CANONICAL_BOARD_OTHER_ARCHIVE_STATE');
  assert.equal(wrong.winba.expected_games_used, 29);
  for (const p of Object.values(wrong.players)) if (p.scopes.season.calculated) {
    assert.equal(p.scopes.season.dimensions.winba.score, null);
    assert.equal(p.scopes.season.dimensions.winba.reason, 'CANONICAL_BOARD_OTHER_ARCHIVE_STATE');
  }
  // a board of another season is refused too
  const other = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS, winbaBoard: { ...nowBoard, season: 2025 } });
  assert.equal(other.winba.reason, 'CANONICAL_BOARD_OTHER_SEASON');
  // no board: winba is INSUFFICIENT_DATA, the rest of the vector is unaffected
  const none = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  assert.equal(none.players['1026'].scopes.season.dimensions.winba.reason, 'NO_CANONICAL_BOARD');
  const withB = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS, winbaBoard: nowBoard });
  for (const k of Object.keys(none.players['1026'].scopes.season.dimensions)) {
    if (k !== 'winba') assert.deepEqual(withB.players['1026'].scopes.season.dimensions[k], none.players['1026'].scopes.season.dimensions[k]);
  }
});

test('last-N windows stop at as_of and cross season types in tip order', () => {
  const out = buildPlayerDna(DOCS, { asOf: MID, ...OPTS });
  const s = out.players['1026'].scopes.last5;
  assert.equal(s.calculated, true);
  assert.equal(s.sample.games, 5);
  assert.ok(Date.parse(s.sample.last_date) < Date.parse(MID));
});

// ------------------------------------------------------------------ WinBA integrity

test('WinBA v1 is untouched: constants, and winba.js source is byte-pinned', () => {
  assert.equal(WINBA_VERSION, 'winba/1.0.0');
  assert.deepEqual(WINBA_WEIGHTS, { production: 0.45, win_rate: 0.25, winning_output: 0.20, court_share: 0.10 });
  const src = readFileSync(new URL('../workers/shared/winba.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(src).digest('hex'), 'd90539e82f8cbd043095070d05fc13cf8aa7273266bf986e6dc0123b0a77ec35',
    'workers/shared/winba.js changed. WinBA v1 is frozen; DNA consumes it unchanged.');
});

test('DNA winba === the canonical board value for that player (stored-board shape, All-Star included)', () => {
  // The stored board is what the winba lane writes: buildWinbaSnapshot over the raw archive + signature fields.
  const raw = [...DOCS, ALL_STAR];
  const board = { ...buildWinbaSnapshot(raw, { season: 2026, generatedAt: '2026-09-25T04:26:27.869Z' }), archive_index_count: raw.length, archive_signature: `${raw.length}:x` };
  const out = buildPlayerDna(raw, { asOf: AS_OF, ...OPTS, winbaBoard: board });
  let n = 0;
  for (const [id, p] of Object.entries(out.players)) {
    if (!p.scopes.season.calculated) continue;
    const w = p.scopes.season.dimensions.winba;
    const row = winbaForPlayer(board, id);
    assert.equal(w.value, row.score);
    assert.equal(w.score, Math.round(row.score));
    assert.equal(w.rank, row.rank);
    assert.equal(w.winba_status, row.status);
    assert.equal(w.version, 'winba/1.0.0');
    assert.equal(w.source, 'canonical_board');
    assert.deepEqual(Object.fromEntries(w.components.map((c) => [c.key, c.value])), row.components);
    assert.deepEqual(w.sample, row.sample);
    assert.match(w.note, /401857320/);
    n += 1;
  }
  assert.ok(n > 10);
  // the board counts the All-Star Game (open owner finding) and DNA says so
  assert.equal(out.winba.games_used, DOCS.length + 1);
  assert.deepEqual(out.winba.includes_dna_excluded_games, ['401857320']);
  assert.equal(out.winba.archive_signature, `${raw.length}:x`);
  // an All-Star player's canonical sample includes that game; DNA's own season sample does not
  const star = out.players['1026'];
  assert.equal(star.scopes.season.dimensions.winba.sample.games, star.scopes.season.sample.games + 1);
  // without a non-team fixture there is no note
  const clean = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS, winbaBoard: canonicalWinbaBoardAsOf(DOCS, { season: 2026, asOf: AS_OF }) });
  assert.equal(clean.players['1026'].scopes.season.dimensions.winba.note, undefined);
  assert.equal(clean.winba.note, null);
});

test('the canonical as-of board reproduces the stored board exactly and is independent of input order', () => {
  const stored = buildWinbaSnapshot(DOCS, { season: 2026, generatedAt: 'g' });
  const asOf = canonicalWinbaBoardAsOf([...DOCS].reverse(), { season: 2026, asOf: AS_OF });
  assert.equal(JSON.stringify(asOf.rows.map((r) => [r.athlete_id, r.score, r.rank, r.components])), JSON.stringify(stored.rows.map((r) => [r.athlete_id, r.score, r.rank, r.components])));
});

test('running DNA never writes WinBA: docs and board are deep-frozen and WinBA output is byte-identical', () => {
  const docs = deepFreeze(structuredClone([...DOCS, ALL_STAR]));
  const board = deepFreeze(buildWinbaSnapshot(docs, { season: 2026, generatedAt: 'fixed' }));
  const before = JSON.stringify(buildWinbaSnapshot(docs, { season: 2026, generatedAt: 'fixed' }));
  const boardBefore = JSON.stringify(board);
  buildPlayerDna(docs, { asOf: AS_OF, ...OPTS, winbaBoard: board }); // throws on a frozen object if it wrote
  assert.equal(JSON.stringify(buildWinbaSnapshot(docs, { season: 2026, generatedAt: 'fixed' })), before);
  assert.equal(JSON.stringify(board), boardBefore);
});

test('WinBA appears in the season scope only; never inside another dimension', () => {
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS, winbaBoard: canonicalWinbaBoardAsOf(DOCS, { season: 2026, asOf: AS_OF }) });
  const p = out.players['1026'];
  assert.equal(p.scopes.season.dimensions.winba.status, 'LIVE');
  for (const s of ['last5', 'last10', 'last15', 'home', 'away']) assert.equal(p.scopes[s].dimensions.winba.status, 'NOT_IN_SCOPE');
  for (const d of DIMENSIONS) if (d.key !== 'winba') assert.ok(!d.components.some(([k]) => /winba/i.test(k)));
});

// ------------------------------------------------------------------ separation: Player Load, injuries

test('Player Load is not an input: load payloads and load-shaped options change nothing', () => {
  const base = JSON.stringify(buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS }));
  const withLoad = JSON.stringify(buildPlayerDna(DOCS, {
    asOf: AS_OF, ...OPTS,
    playerLoad: { rows: [{ athlete_id: '1026', score: 99, band: 'EXTREME' }] },
    upcomingGames: [{ start_utc: '2026-09-30T00:00:00Z', home: { team_id: '1' }, away: { team_id: '2' } }]
  }));
  assert.equal(withLoad, base);
  const src = readFileSync(new URL('../workers/shared/player-dna.js', import.meta.url), 'utf8');
  const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l));
  assert.deepEqual(imports, ["import { buildWinbaSnapshotAsOf, winbaForPlayer, WINBA_VERSION } from './winba.js';"]);
});

test('injuries are not an input: injury records, availability feeds and DNP reasons change nothing', () => {
  const base = JSON.stringify(buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS }));
  const docs = structuredClone(DOCS);
  for (const d of docs) {
    d.summary.injuries = [{ athlete_id: '1026', status: 'Out', detail: 'Knee' }, { athlete_id: '2126', status: 'Day-To-Day' }];
    for (const r of d.summary.box.players) { if (r.dnp) r.dnp_reason = 'INJURY/ILLNESS - KNEE'; r.active = !r.active; }
  }
  const out = JSON.stringify(buildPlayerDna(docs, { asOf: AS_OF, ...OPTS, availability: { items: { a: { athlete_id: '1026', status: 'Out' } } }, injuries: [{ athlete_id: '1026' }] }));
  assert.equal(out, base);
});

// ------------------------------------------------------------------ non-team fixtures

test('All-Star-like fixture (tagged regular season, non-franchise team ids) is excluded deterministically', () => {
  const base = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  const withAs = buildPlayerDna([...DOCS, ALL_STAR], { asOf: AS_OF, ...OPTS });
  assert.equal(withAs.provenance.excluded.non_franchise, 1);
  assert.deepEqual(withAs.provenance.excluded_games.non_franchise, ['401857320']);
  assert.equal(JSON.stringify(withAs.players), JSON.stringify(base.players), 'every non-WinBA dimension ignores the fixture');
  // the canonical board (raw archive) DOES count it: documented open finding, carried as a note on winba
  assert.equal(buildWinbaSnapshot([...DOCS, ALL_STAR], { season: 2026, generatedAt: 'x' }).games_used, DOCS.length + 1);
});

test('a franchise list is required (fail closed); preseason, unfinished and explicitly excluded games are dropped', () => {
  assert.throws(() => buildPlayerDna(DOCS, { asOf: AS_OF }), /franchiseTeamIds/);
  assert.throws(() => buildPlayerDna(DOCS, { asOf: 'not-a-date', ...OPTS }), /asOf/);
  const pre = league({ rounds: 3, start: Date.UTC(2026, 4, 1, 23), type: 1, idBase: 7000 });
  const live = makeDoc({ id: '8000', tip: '2026-06-01T23:00:00Z', home: '1', away: '2', rows: [playerLine('1026', '1', 1, 0)], completed: false });
  const out = buildPlayerDna([...DOCS, ...pre, live], { asOf: AS_OF, ...OPTS, excludeGameIds: ['1003'] });
  assert.equal(out.provenance.excluded.preseason_or_other, pre.length);
  assert.equal(out.provenance.excluded.not_completed, 1);
  assert.deepEqual(out.provenance.excluded_games.excluded_by_id, ['1003']);
  assert.equal(out.provenance.games_used, DOCS.length - 1);
});

// ------------------------------------------------------------------ scopes, traits, movement

test('scopes: clutch unavailable, career needs prior coverage, playoffs from postseason docs', () => {
  const one = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  const p = one.players['1026'];
  assert.deepEqual(Object.keys(p.scopes), SCOPES);
  assert.deepEqual(p.scopes.clutch, { calculated: false, scope: 'clutch', reason: 'CLUTCH_NOT_BUILT' });
  assert.equal(p.scopes.career.reason, 'NO_PRIOR_SEASON_COVERAGE');
  assert.equal(p.scopes.playoffs.calculated, false);
  assert.equal(p.scopes.season.dimensions.pressure_clutch.status, 'UNAVAILABLE');
  assert.equal(p.scopes.season.dimensions.playoff_translation.status, 'INSUFFICIENT_DATA');

  // prior season (same player ids by suffix change are different players; reuse ids by aliasing)
  const prior = league({ season: 2025, start: Date.UTC(2025, 4, 10, 23), idBase: 3000 }).map((d) => {
    for (const r of d.summary.box.players) r.athlete_id = r.athlete_id.replace(/25$/, '26');
    return d;
  });
  const post = league({ season: 2026, rounds: 6, start: LAST_TIP + 5 * 86400e3, type: 3, idBase: 6000 });
  const asOf = new Date(LAST_TIP + 40 * 86400e3).toISOString();
  const two = buildPlayerDna([...prior, ...DOCS, ...post], { asOf, ...OPTS });
  const q = two.players['1026'];
  assert.equal(q.scopes.career.calculated, true);
  assert.equal(q.scopes.career.sample.games, 48);
  assert.equal(q.scopes.season.sample.games, 24, 'season = regular season only');
  assert.equal(q.scopes.playoffs.calculated, true);
  assert.equal(q.scopes.playoffs.sample.games, 6);
  assert.equal(q.scopes.season.dimensions.playoff_translation.status, 'LIVE');
  assert.deepEqual(two.coverage.seasons, [2025, 2026]);
  assert.equal(two.coverage.postseason_games, 12);
  // WinBA stays regular-season only (canonical rule) even with postseason docs present
  const all3 = [...prior, ...DOCS, ...post];
  const two2 = buildPlayerDna(all3, { asOf, ...OPTS, winbaBoard: canonicalWinbaBoardAsOf(all3, { season: 2026, asOf }) });
  assert.equal(two2.winba.games_used, 48);
  assert.equal(two2.players['1026'].scopes.season.dimensions.winba.status, 'LIVE');
  // last-5 now crosses into the postseason
  assert.ok(q.scopes.last5.sample.first_date > new Date(LAST_TIP).toISOString().slice(0, 10));
});

test('home/away split the regular season by the archived home/away team', () => {
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  const p = out.players['1026'];
  assert.equal(p.scopes.home.sample.games + p.scopes.away.sample.games, p.scopes.season.sample.games);
});

test('descriptive dimensions (role, volatility, form) are never strengths or weaknesses', () => {
  assert.deepEqual([...DESCRIPTIVE_DIMENSIONS].sort(), ['form', 'role', 'volatility']);
  const dims = {
    role: { score: 100, status: 'LIVE', confidence: 1 },
    volatility: { score: 99, status: 'LIVE', confidence: 1 },
    form: { score: 98, status: 'LIVE', confidence: 1 },
    scoring: { score: 80, status: 'LIVE', confidence: 0.9 },
    efficiency: { score: 70, status: 'LIVE', confidence: 0.9 },
    rebounding: { score: 20, status: 'LIVE', confidence: 0.9 },
    creation: { score: 10, status: 'PROXY', confidence: 0.6 },
    defensive_activity: { score: 5, status: 'PROXY', confidence: 0.5 },
    pressure_clutch: { score: null, status: 'UNAVAILABLE' }
  };
  const t = traits(dims);
  assert.deepEqual(t.strongest, ['scoring', 'efficiency', 'rebounding']);
  assert.deepEqual(t.weakest, ['creation'], 'weakest never repeats a strongest trait');
  const five = traits({ ...dims, playmaking: { score: 15, status: 'LIVE', confidence: 0.9 } });
  assert.deepEqual(five.weakest, ['creation', 'playmaking']);
  for (const k of five.weakest) assert.ok(!five.strongest.includes(k));
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  for (const p of Object.values(out.players)) for (const s of Object.values(p.scopes)) if (s.calculated) {
    for (const k of [...s.traits.strongest, ...s.traits.weakest]) assert.ok(!DESCRIPTIVE_DIMENSIONS.includes(k));
  }
});

test('movement is last10 minus season, on dimensions calculated in both', () => {
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  const p = out.players['1026'];
  assert.equal(p.movement.vs, 'last10');
  for (const [k, v] of Object.entries(p.movement.deltas)) assert.equal(v, p.scopes.last10.dimensions[k].score - p.scopes.season.dimensions[k].score);
  assert.ok(!('winba' in p.movement.deltas), 'WinBA is season-scoped');
});

test('proxy dimensions are labelled with reasons; FT pressure is not called rim pressure', () => {
  const out = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  const d = out.players['1026'].scopes.season.dimensions;
  for (const k of ['creation', 'shooting_profile', 'ft_pressure', 'defensive_activity', 'matchup_adaptability']) {
    if (d[k].score == null) continue;
    assert.equal(d[k].proxy, true);
    assert.ok(d[k].proxy_reason.length > 20);
  }
  assert.match(d.ft_pressure.proxy_reason, /NOT rim pressure/);
  assert.equal(d.ft_pressure.label, 'Free-throw pressure');
  assert.equal(out.dimension_definitions.find((x) => x.key === 'ft_pressure').nba_key, 'rim_pressure');
  assert.equal(out.dimension_definitions.find((x) => x.key === 'defensive_activity').nba_key, 'defensive_impact');
});

// ------------------------------------------------------------------ determinism and provenance

test('deterministic: byte-identical reruns and input-order independence', () => {
  const a = JSON.stringify(buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS }));
  const b = JSON.stringify(buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS }));
  const shuffled = [...DOCS].reverse().map((d, i, arr) => arr[(i * 7) % arr.length]);
  assert.equal(new Set(shuffled.map((d) => d.summary.game.game_id)).size, DOCS.length);
  const c = JSON.stringify(buildPlayerDna(shuffled, { asOf: AS_OF, franchiseTeamIds: [...FRANCHISES].reverse() }));
  assert.equal(a, b);
  assert.equal(c, a);
  const src = readFileSync(new URL('../workers/shared/player-dna.js', import.meta.url), 'utf8');
  assert.ok(!/Date\.now|new Date\(\)|Math\.random|fetch\(/.test(src), 'no clock, randomness or I/O');
});

test('duplicate archive docs for one game count once', () => {
  const out = buildPlayerDna([...DOCS, structuredClone(DOCS[3])], { asOf: AS_OF, ...OPTS });
  assert.equal(out.provenance.excluded.duplicate, 1);
  assert.equal(JSON.stringify(out.players), JSON.stringify(buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS }).players));
});

test('contract, versions and provenance fields are present', () => {
  const out = buildPlayerDna([...DOCS, ALL_STAR], { asOf: AS_OF, ...OPTS });
  assert.equal(out.contract, PLAYER_DNA_CONTRACT);
  assert.equal(out.version, 'wnba-player-dna/1.0.0');
  assert.equal(PLAYER_DNA_VERSION, 'wnba-player-dna/1.0.0');
  assert.deepEqual(out.versions, { player_dna: 'wnba-player-dna/1.0.0', winba: 'winba/1.0.0' });
  assert.equal(out.as_of, AS_OF);
  assert.equal(out.season, 2026);
  assert.match(out.provenance.source, /game:v1:final/);
  assert.match(out.provenance.lines_hash, /^[0-9a-f]{8}$/);
  assert.deepEqual(out.provenance.franchise_team_ids, ['1', '2', '3', '4']);
  for (const k of ['player_load', 'injuries', 'availability_feed', 'dnp_reason']) assert.ok(out.provenance.not_inputs.includes(k));
  assert.match(out.provenance.winba_source, /canonical WinBA board/);
  const p = playerDnaFor(out, '1026');
  assert.equal(p.athlete_id, '1026');
  assert.equal(p.team_id, '1');
  assert.equal(p.as_of, AS_OF);
  const sc = p.scopes.season;
  for (const [k, d] of Object.entries(sc.dimensions)) {
    assert.ok(['LIVE', 'PROXY', 'UNAVAILABLE', 'NOT_IN_SCOPE', 'INSUFFICIENT_DATA'].includes(d.status), k);
    if (d.score != null) {
      assert.ok(d.score >= 0 && d.score <= 100);
      assert.ok(d.confidence >= 0 && d.confidence <= 1);
      assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(d.confidence_label));
      if (k !== 'winba') for (const c of d.components) assert.deepEqual(Object.keys(c).slice(0, 3), ['key', 'value', 'percentile']);
    }
  }
  assert.equal(DIMENSIONS.length, 17);
});

test('empty archive or no games before as_of returns an empty, well-formed result', () => {
  const out = buildPlayerDna(DOCS, { asOf: '2026-01-01T00:00:00Z', ...OPTS });
  assert.equal(out.season, null);
  assert.deepEqual(out.players, {});
  assert.equal(out.provenance.games_used, 0);
});
