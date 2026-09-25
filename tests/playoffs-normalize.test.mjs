// Playoff normalization + validation (workers/shared/playoffs.js + playoffs-wnba.js). Pure functions, no network.
// Real captures, derived "as of" replays of the real 2025 postseason, and clearly synthetic fault cases —
// see tests/fixtures/playoffs/scenarios.mjs for which is which.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWnbaPlayoffs, parseRoundNote, clinchStatus, postseasonDays, seasonWindow, normalizePostseasonEvent, gameStatusOf } from '../workers/shared/playoffs-wnba.js';
import { playoffsStaleAfterS, playoffsSemantics, playoffsHot, playoffsSignature, PLAYOFFS_CONTRACT } from '../workers/shared/playoffs.js';
import { fx, asOf, clone, synthEvent, synthStandings } from './fixtures/playoffs/scenarios.mjs';

const E25 = fx('espn-postseason-2025.json').events;
const E26 = fx('espn-postseason-2026.json').events;
const S25 = fx('espn-standings-league-2025.json');
const S26 = fx('espn-standings-league-2026.json');
const CAP = '2026-09-25T14:00:00.000Z';

const build = (season, events, standingsBody, now = Date.parse(CAP)) => buildWnbaPlayoffs({ season, events, standingsBody, capturedAt: CAP, now });
const series = (snap, roundId) => snap.rounds.find((r) => r.round_id === roundId).series;
const byPair = (snap, roundId, a, b) => series(snap, roundId).find((s) => [s.higher_seed?.abbreviation, s.lower_seed?.abbreviation].sort().join() === [a, b].sort().join());

// ------------------------------------------------------------------ real captures

test('real 2025: the completed postseason rebuilds exactly — seeds, every series result, champion', () => {
  const r = build(2025, E25, S25);
  assert.equal(r.ok, true, r.errors.join());
  assert.deepEqual(r.warnings, []);
  const s = r.snapshot;
  assert.equal(s.contract, PLAYOFFS_CONTRACT);
  assert.equal(s.status, 'COMPLETE');
  assert.equal(s.frozen, true);
  assert.deepEqual(s.rounds.map((x) => [x.name, x.best_of, x.series.length, x.status]), [['First Round', 3, 4, 'FINAL'], ['Semifinals', 5, 2, 'FINAL'], ['WNBA Finals', 7, 1, 'FINAL']]);
  // Every derived summary equals the source's own final series summary.
  for (const x of s.rounds.flatMap((r) => r.series)) assert.equal(x.summary, x.source_summary, x.series_id);
  const mg = byPair(s, 'first-round', 'MIN', 'GS');
  assert.deepEqual([mg.higher_seed.seed, mg.higher_seed.abbreviation, mg.higher_wins, mg.lower_seed.seed, mg.lower_wins], [1, 'MIN', 2, 8, 0]);
  assert.equal(byPair(s, 'first-round', 'ATL', 'IND').winner_team_id, '5', 'No. 6 IND upset No. 3 ATL');
  assert.equal(s.champion.abbreviation, 'LV');
  assert.equal(s.champion.seed, 2);
  assert.equal(s.champion.series_score, '4-0');
  assert.equal(s.champion.opponent.abbreviation, 'PHX');
  assert.equal(s.champion.clinched_game_id, '401820329');
  assert.equal(s.provenance.postseason_game_count, 24);
  assert.equal(s.provenance.series_count, 7);
});

test('real 2025: rounds order by date, not by event id (Finals ids sort below the semifinals)', () => {
  const s = build(2025, [...E25].reverse(), S25).snapshot;
  assert.deepEqual(s.rounds.map((r) => r.round_id), ['first-round', 'semifinals', 'finals']);
  assert.deepEqual(series(s, 'finals')[0].games.map((g) => g.game_number), [1, 2, 3, 4]);
});

test('real 2026 (captured 2026-09-25): postseason not started — schedule published, every matchup TBD, nothing fabricated', () => {
  const r = build(2026, E26, S26);
  assert.equal(r.ok, true, r.errors.join());
  const s = r.snapshot;
  assert.equal(s.status, 'NOT_STARTED');
  assert.equal(s.phase, 'POSTSEASON', 'ESPN opened the postseason window at 2026-09-25T07:00Z');
  assert.deepEqual(s.rounds.map((x) => [x.round_id, x.best_of, x.series_expected, x.unassigned_games.length]), [['first-round', 3, 4, 12], ['semifinals', 5, 2, 10], ['finals', 7, 1, 7]]);
  for (const x of s.rounds.flatMap((r) => r.series)) {
    assert.equal(x.status, 'TBD');
    assert.equal(x.higher_seed, null);
    assert.equal(x.lower_seed, null);
    assert.deepEqual(x.games, []);
  }
  for (const g of s.rounds.flatMap((r) => r.unassigned_games)) {
    assert.equal(g.home_team, null);
    assert.equal(g.away_team, null);
    assert.equal(g.home_score, null, 'placeholder 0-0 is not a score');
  }
  assert.equal(s.champion, null);
  // The placeholder series.totalCompetitions says 3 for every round; the published schedule (Game 5/7) wins.
  assert.equal(series(s, 'finals')[0].best_of, 7);
  assert.deepEqual(s.seeds.slice(0, 8).map((x) => `${x.seed}${x.abbreviation}`), ['1MIN', '2GS', '3LV', '4ATL', '5WSH', '6IND', '7DAL', '8NY']);
  assert.ok(s.seeds.slice(0, 8).every((x) => x.clinch_status.startsWith('CLINCHED')));
  assert.ok(s.seeds.slice(8).every((x) => x.clinch_status === 'ELIMINATED'));
  assert.equal(s.seeds.find((x) => x.abbreviation === 'NY').clinch_label, "Clinched Playoff Berth and Won Commissioner's Cup");
});

// ------------------------------------------------------------------ derived as-of replays of 2025

test('postseason not started: no events at all is a valid empty state', () => {
  const r = build(2026, [], S26);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.status, 'NOT_STARTED');
  assert.deepEqual(r.snapshot.rounds, []);
  assert.equal(r.snapshot.seeds.length, 15);
});

test('first round active: Game 1s final, later rounds still TBD', () => {
  const s = build(2025, asOf(E25, '2025-09-14T23:00:00Z'), S25).snapshot;
  assert.equal(s.status, 'IN_PROGRESS');
  const fr = s.rounds[0];
  assert.equal(fr.status, 'IN_PROGRESS');
  assert.equal(fr.series.filter((x) => x.status === 'IN_PROGRESS').length, 3);
  assert.equal(byPair(s, 'first-round', 'LV', 'SEA').status, 'UPCOMING', 'LV-SEA Game 1 tipped 2025-09-15T02:00Z');
  assert.equal(byPair(s, 'first-round', 'MIN', 'GS').summary, 'MIN leads series 1-0');
  assert.ok(s.rounds.slice(1).every((r) => r.series.every((x) => x.status === 'TBD')));
});

test('multiple active series + series tied', () => {
  const s = build(2025, asOf(E25, '2025-09-17T12:00:00Z'), S25).snapshot;
  const tied = byPair(s, 'first-round', 'ATL', 'IND');
  assert.equal(tied.status, 'IN_PROGRESS');
  assert.equal(tied.summary, 'Series tied 1-1');
  assert.equal(tied.higher_wins, 1);
  assert.equal(tied.lower_wins, 1);
  assert.equal(tied.next_game_id, '401820320', 'Game 3 is next');
  assert.equal(series(s, 'first-round').filter((x) => x.status === 'IN_PROGRESS').length, 4);
});

test('series final mid-round: winner, no next game, remaining series still live', () => {
  const s = build(2025, asOf(E25, '2025-09-19T00:30:00Z'), S25).snapshot;
  const mg = byPair(s, 'first-round', 'MIN', 'GS');
  assert.equal(mg.status, 'FINAL');
  assert.equal(mg.winner_team_id, '8');
  assert.equal(mg.next_game_id, null);
  assert.equal(mg.last_result.game_id, '401820319');
  assert.equal(s.rounds[0].status, 'IN_PROGRESS');
  assert.equal(s.seeds.find((x) => x.abbreviation === 'GS').in_bracket, true);
});

test('semifinal TBD opponent: a game naming only one team never creates a guessed series', () => {
  const events = asOf(E25, '2025-09-19T00:30:00Z');
  // The source knows MIN advanced but not its opponent yet: one side named, the other a placeholder.
  const semi = events.find((e) => e.id === '401820328');
  semi.competitions[0].competitors[1] = { id: '-2', homeAway: 'away', team: { id: '-2', abbreviation: 'TBD', displayName: 'TBD' } };
  semi.competitions[0].competitors[0] = { id: '8', homeAway: 'home', team: E25.find((e) => e.id === '401820328').competitions[0].competitors[0].team };
  const s = build(2025, events, S25).snapshot;
  const semis = s.rounds.find((r) => r.round_id === 'semifinals');
  assert.ok(semis.series.every((x) => x.status === 'TBD'), 'no semifinal series until both teams are named');
  const g = semis.unassigned_games.find((x) => x.game_id === '401820328');
  assert.equal(g.home_team.abbreviation, 'MIN');
  assert.equal(g.away_team, null);
});

test('Finals in progress: 2-0 lead, next game is Game 3', () => {
  const s = build(2025, asOf(E25, '2025-10-06T12:00:00Z', { setRounds: ['First Round', 'WNBA Semifinals', 'WNBA Finals', 'WNBA FINALS'] }), S25).snapshot;
  const f = series(s, 'finals')[0];
  assert.equal(f.status, 'IN_PROGRESS');
  assert.equal(f.summary, 'LV leads series 2-0');
  assert.equal(f.next_game_id, '401820326');
  assert.equal(s.champion, null);
  assert.equal(s.status, 'IN_PROGRESS');
});

test('live game: series LIVE with live_game_id; stale window shortens', () => {
  const events = asOf(E25, '2025-09-14T21:00:00Z');
  const g = events.find((e) => e.id === '401820313');
  g.status.type = { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, shortDetail: 'Q3 4:12' };
  g.competitions[0].competitors[0].score = '55';
  g.competitions[0].competitors[1].score = '51';
  const s = build(2025, events, S25).snapshot;
  const x = byPair(s, 'first-round', 'ATL', 'IND');
  assert.equal(x.status, 'LIVE');
  assert.equal(x.live_game_id, '401820313');
  assert.equal(x.games[0].home_score, 55);
  assert.equal(playoffsStaleAfterS(s), 360);
  assert.equal(playoffsHot(s, Date.parse('2025-09-14T21:00:00Z')), true);
});

// ------------------------------------------------------------------ synthetic fault + edge cases

const FS = synthStandings(2031, [['9901', 'FXA', 'Fixture Alpha', 1, 30, 10, 'x', 'Clinched Playoff Berth'], ['9902', 'FXB', 'Fixture Bravo', 2, 28, 12, 'x', 'Clinched Playoff Berth'], ['9903', 'FXC', 'Fixture Charlie', 3, 20, 20, 'e', 'Eliminated From Playoffs']]);
const synthBuild = (events) => buildWnbaPlayoffs({ season: 2031, events, standingsBody: FS, capturedAt: CAP, now: Date.parse('2031-09-25T00:00:00Z') });

test('postponed game: not counted, not the next game, labelled POSTPONED', () => {
  const r = synthBuild([
    synthEvent({ id: '1', date: '2031-09-20T23:00Z', note: 'First Round - Game 1' }),
    synthEvent({ id: '2', date: '2031-09-22T23:00Z', note: 'First Round - Game 2', status: 'STATUS_POSTPONED' }),
    synthEvent({ id: '3', date: '2031-09-24T23:00Z', note: 'First Round - Game 3 If Necessary', status: 'STATUS_SCHEDULED' })
  ]);
  assert.equal(r.ok, true, r.errors.join());
  const s = r.snapshot.rounds[0].series[0];
  assert.deepEqual(s.games.map((g) => g.status), ['FINAL', 'POSTPONED', 'SCHEDULED']);
  assert.equal(s.next_game_id, '3');
  assert.equal(s.higher_wins + s.lower_wins, 1);
  assert.equal(s.status, 'IN_PROGRESS');
});

test('canceled game: excluded from wins and from the duplicate game-number check', () => {
  const r = synthBuild([
    synthEvent({ id: '1', note: 'First Round - Game 1', status: 'STATUS_CANCELED' }),
    synthEvent({ id: '2', date: '2031-09-21T23:00Z', note: 'First Round - Game 1' }),
    synthEvent({ id: '3', date: '2031-09-23T23:00Z', note: 'First Round - Game 2' })
  ]);
  assert.equal(r.ok, true, r.errors.join());
  const s = r.snapshot.rounds[0].series[0];
  assert.equal(s.games[0].status, 'CANCELED');
  assert.equal(s.status, 'FINAL', 'Fixture Alpha won Games 1 and 2 of a best-of-3');
  assert.equal(s.winner_team_id, '9901');
});

test('remaining scheduled games after a clinch become NOT_NEEDED, never counted', () => {
  const r = synthBuild([
    synthEvent({ id: '1', note: 'First Round - Game 1' }),
    synthEvent({ id: '2', date: '2031-09-22T23:00Z', note: 'First Round - Game 2' }),
    synthEvent({ id: '3', date: '2031-09-24T23:00Z', note: 'First Round - Game 3 If Necessary', status: 'STATUS_SCHEDULED' })
  ]);
  const s = r.snapshot.rounds[0].series[0];
  assert.equal(s.games[2].status, 'NOT_NEEDED');
  assert.equal(s.next_game_id, null);
});

test('malformed series payload: impossible negative wins in the source record reject the build', () => {
  const r = synthBuild([synthEvent({ series: { type: 'playoff', completed: false, totalCompetitions: 3, competitors: [{ id: '9901', wins: -1 }, { id: '9902', wins: 0 }] } })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('impossible_series_wins')), r.errors.join());
});

test('duplicate event: identical repeats collapse; conflicting repeats reject', () => {
  const e = synthEvent({ id: '77' });
  const ok = synthBuild([e, clone(e)]);
  assert.equal(ok.ok, true);
  assert.equal(ok.snapshot.provenance.duplicates_collapsed, 1);
  const bad = clone(e);
  bad.competitions[0].competitors[0].score = '99';
  const r = synthBuild([e, bad]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('duplicate_game_conflict:77'));
});

test('validation rejects: unsupported round label, same team both sides, malformed team, team in two series, game after clinch, completed without winner', () => {
  const cases = [
    [[synthEvent({ note: 'Play-In Tournament - Game 1' })], /^unsupported_round_label/],
    [[synthEvent({ away: ['9901', 'FXA', 'Fixture Alpha'] })], /^same_team_both_sides/],
    [[synthEvent({ away: ['9902', '', 'Fixture Bravo'] })], /^malformed_team/],
    [[synthEvent({ id: '1' }), synthEvent({ id: '2', away: ['9903', 'FXC', 'Fixture Charlie'] })], /^team_in_multiple_series/],
    [[synthEvent({ id: '1' }), synthEvent({ id: '2', date: '2031-09-22T23:00Z', note: 'First Round - Game 2' }), synthEvent({ id: '3', date: '2031-09-24T23:00Z', note: 'First Round - Game 3', hs: 60, as: 70 })], /^game_after_clinch/],
    [[synthEvent({ series: { type: 'playoff', completed: true, totalCompetitions: 3, competitors: [{ id: '9901', wins: 2 }, { id: '9902', wins: 0 }] } })], /^completed_series_without_winner/],
    [[synthEvent({ hs: 70, as: 70 })], /^final_without_valid_score/],
    [[{ ...synthEvent(), season: { year: 2030, type: 3 } }], /^season_mismatch/]
  ];
  for (const [events, re] of cases) {
    const r = synthBuild(events);
    assert.equal(r.ok, false, `expected rejection ${re}`);
    assert.ok(r.errors.some((e) => re.test(e)), `${re} in ${r.errors.join()}`);
    assert.equal(r.snapshot, null, 'an invalid build never yields a snapshot');
  }
});

test('source wins that disagree with the finals are a warning, never silently adopted', () => {
  const r = synthBuild([synthEvent({ series: { type: 'playoff', completed: false, totalCompetitions: 3, competitors: [{ id: '9901', wins: 0 }, { id: '9902', wins: 1 }] } })]);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.rounds[0].series[0].higher_wins, 1, 'wins come from the final score');
  assert.ok(r.warnings.some((w) => w.startsWith('source_series_wins_differ')));
});

test('missing seeds: series still builds, seeding basis stated, no seed number claimed', () => {
  const r = buildWnbaPlayoffs({ season: 2031, events: [synthEvent({})], standingsBody: { seasons: FS.seasons, standings: { season: 2031, entries: [] } }, capturedAt: CAP });
  const s = r.snapshot.rounds[0].series[0];
  assert.equal(s.seeding_basis, 'unseeded_game1_home');
  assert.equal(s.higher_seed.seed, null);
  assert.ok(r.warnings.includes('seeds_unavailable'));
});

// ------------------------------------------------------------------ adapter details

test('round notes parse every observed headline shape', () => {
  assert.deepEqual(parseRoundNote('First Round - Game 1'), { label: 'First Round', game_number: 1, if_necessary: false });
  assert.deepEqual(parseRoundNote('Semifinals - Game 5 If Necessary'), { label: 'Semifinals', game_number: 5, if_necessary: true });
  assert.deepEqual(parseRoundNote('WNBA FINALS - Game 3'), { label: 'WNBA FINALS', game_number: 3, if_necessary: false });
  assert.deepEqual(parseRoundNote('FINALS'), { label: 'FINALS', game_number: null, if_necessary: false });
});

test('clinch vocabulary comes from the source description', () => {
  assert.equal(clinchStatus('*', 'Clinched Best League Record'), 'CLINCHED_BEST_RECORD');
  assert.equal(clinchStatus('cx', "Clinched Playoff Berth and Won Commissioner's Cup"), 'CLINCHED_PLAYOFFS');
  assert.equal(clinchStatus('e', 'Eliminated From Playoffs'), 'ELIMINATED');
  assert.equal(clinchStatus(null, null), null);
  assert.equal(clinchStatus('q', 'Something new'), 'MARKED_UNKNOWN');
});

test('game days come from the scoreboard calendar inside the postseason window', () => {
  const d26 = postseasonDays(fx('espn-calendar-2026.json'), seasonWindow(S26, 2026));
  assert.deepEqual([d26.length, d26[0], d26.at(-1)], [17, '20260927', '20261031']);
  const d25 = postseasonDays(fx('espn-calendar-2025.json'), seasonWindow(S25, 2025));
  const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)).replaceAll('-', '');
  assert.equal(d25.length, 14);
  assert.ok(E25.every((e) => d25.includes(etDay(e.date))), 'every 2025 postseason game falls on a scanned (ET) calendar day');
  assert.deepEqual(postseasonDays({}, { postseason: null }), []);
});

test('status mapping + TBD placeholders never become teams', () => {
  assert.equal(gameStatusOf({ name: 'STATUS_FINAL', state: 'post', completed: true }), 'FINAL');
  assert.equal(gameStatusOf({ name: 'STATUS_POSTPONED', state: 'pre' }), 'POSTPONED');
  assert.equal(gameStatusOf({ name: 'STATUS_CANCELED', state: 'post' }), 'CANCELED');
  assert.equal(gameStatusOf({ name: 'STATUS_HALFTIME', state: 'in' }), 'LIVE');
  const g = normalizePostseasonEvent(E26[0]);
  assert.equal(g.home, null);
  assert.equal(g.away, null);
  assert.equal(g.source_series.wins, null);
  assert.equal(g.time_tbd, true);
});

test('serve helpers: stale windows, semantics, signature ignores capture time', () => {
  const done = build(2025, E25, S25).snapshot;
  const pending = build(2026, E26, S26).snapshot;
  assert.equal(playoffsStaleAfterS(done), null, 'a completed bracket never goes stale');
  assert.equal(playoffsStaleAfterS(pending), 3 * 3600);
  assert.equal(playoffsSemantics(done, { isCurrentSeason: false, stale: false }), 'PRIOR_SEASON_FINAL');
  assert.equal(playoffsSemantics(done, { isCurrentSeason: true, stale: false }), 'POSTSEASON_COMPLETE');
  assert.equal(playoffsSemantics(pending, { isCurrentSeason: true, stale: false }), 'POSTSEASON_NOT_STARTED');
  assert.equal(playoffsSemantics(pending, { isCurrentSeason: true, stale: true }), 'POSTSEASON_SNAPSHOT');
  const later = buildWnbaPlayoffs({ season: 2026, events: E26, standingsBody: S26, capturedAt: '2026-09-25T15:00:00.000Z', now: Date.parse(CAP) }).snapshot;
  assert.equal(playoffsSignature(pending), playoffsSignature(later));
});
