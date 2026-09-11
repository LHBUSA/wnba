// Runtime truth tests: normalizers + derivations against a real WNBA game
// (ESPN event 401857189, CON @ DAL, 2026-08-30 — trimmed fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSummary, normalizeCoordinate, elapsedSeconds, parseClock, WNBA_RULES } from '../workers/shared/espn.js';
import { leadTracker, foulContext, shotChart, scoringRuns, shotZone, possessions } from '../workers/shared/derive.js';
import { americanToDecimal, probToAmerican, normalizeOddsEvent, normalizeProps, teamIndex, normalizeName, PBE_MODEL } from '../workers/shared/market.js';
import { etCompact, addDays } from '../workers/shared/time.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/espn-summary-401857189.json', import.meta.url), 'utf8'));
const s = normalizeSummary(raw);
const boxTeam = (abbr, key) => raw.boxscore.teams.find((t) => t.team.abbreviation === abbr).statistics.find((x) => x.name === key).displayValue;

test('WNBA clock: 10-minute quarters, 5-minute overtime', () => {
  assert.equal(WNBA_RULES.QUARTER_S, 600);
  assert.equal(elapsedSeconds(1, 600), 0);
  assert.equal(elapsedSeconds(2, 0), 1200);
  assert.equal(elapsedSeconds(5, 300), 2400);
  assert.equal(parseClock('9:41'), 581);
  assert.equal(parseClock('47.2'), 47.2);
});

test('summary normalizes the real final', () => {
  assert.equal(s.game.game_id, '401857189');
  assert.equal(s.game.status.state, 'post');
  assert.equal(s.game.home.abbr, 'DAL');
  assert.equal(s.game.home.score, 97);
  assert.equal(s.game.away.score, 71);
  assert.deepEqual(s.game.home.linescores, [32, 28, 23, 14]);
  assert.ok(s.plays.length > 400);
});

test('ESPN location sentinel never becomes a coordinate', () => {
  assert.equal(normalizeCoordinate({ x: -214748340, y: -214748365 }), null);
  const ft = s.plays.filter((p) => /free throw/i.test(p.type || ''));
  assert.ok(ft.length > 0);
  assert.ok(ft.every((p) => p.coordinate === null));
});

test('shot chart plots exactly the published field-goal attempts (FGA reconciles with box)', () => {
  const chart = shotChart(s.plays);
  const fga = ['CON', 'DAL'].reduce((a, t) => a + Number(boxTeam(t, 'fieldGoalsMade-fieldGoalsAttempted').split('-')[1]), 0);
  assert.equal(chart.total_fga, fga);
  assert.equal(chart.plotted + chart.unplotted, chart.total_fga);
  assert.ok(chart.shots.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y)));
});

test('lead changes and largest leads reproduce ESPN box totals', () => {
  const lead = leadTracker(s.plays);
  assert.equal(lead.lead_changes, Number(boxTeam('DAL', 'leadChanges')));
  assert.equal(lead.largest_lead.home.margin, Number(boxTeam('DAL', 'largestLead')));
  assert.equal(lead.largest_lead.away.margin, Number(boxTeam('CON', 'largestLead')));
});

test('team fouls reconcile with box fouls (offensive fouls counted separately)', () => {
  const f = foulContext(s.plays, s.box);
  for (const [abbr, id] of [['DAL', s.game.home.team_id], ['CON', s.game.away.team_id]]) {
    const def = Object.entries(f.team_fouls_by_period).filter(([k]) => k.startsWith(`${id}:`)).reduce((a, [, v]) => a + v, 0);
    const off = Object.entries(f.offensive_fouls_by_period).filter(([k]) => k.startsWith(`${id}:`)).reduce((a, [, v]) => a + v, 0);
    assert.equal(def + off, Number(boxTeam(abbr, 'fouls')), abbr);
  }
});

test('runs are consecutive unanswered scoring by one team', () => {
  const plays = [
    { seq: 1, team_id: 'A', scoring: true, points: 2, period: 1, period_label: 'Q1', clock: '9:00' },
    { seq: 2, team_id: 'A', scoring: true, points: 3, period: 1, period_label: 'Q1', clock: '8:30' },
    { seq: 3, team_id: 'B', scoring: true, points: 2, period: 1, period_label: 'Q1', clock: '8:00' },
    { seq: 4, team_id: 'A', scoring: true, points: 2, period: 1, period_label: 'Q1', clock: '7:00' }
  ];
  const r = scoringRuns(plays);
  assert.equal(r.largest.A.points, 5);
  assert.equal(r.current.points, 2);
});

test('shot zone uses the source 2/3 decision', () => {
  assert.equal(shotZone({ x: 46, y: 7 }, 3), 'above_break_three');
  assert.equal(shotZone({ x: 3, y: -1 }, 3), 'corner_three');
  assert.equal(shotZone({ x: 25, y: 2 }, 2), 'restricted_area');
  assert.equal(possessions({ fga: 70, oreb: 10, tov: 12, fta: 20 }), 70 - 10 + 12 + 8.8);
  assert.equal(possessions({ fga: null, oreb: 1, tov: 1, fta: 1 }), null);
});

test('market math: consensus is a benchmark, PBE model is not published', () => {
  assert.equal(americanToDecimal(100), 2);
  assert.ok(Math.abs(americanToDecimal(-110) - 1.9091) < 1e-3);
  assert.equal(probToAmerican(0.5), -100);
  const teams = [{ team_id: '20', name: 'Atlanta Dream' }, { team_id: '18', name: 'Connecticut Sun' }];
  const ev = {
    id: 'x', commence_time: '2026-09-17T23:30:00Z', home_team: 'Atlanta Dream', away_team: 'Connecticut Sun',
    bookmakers: [
      { key: 'a', title: 'A', last_update: 't', markets: [{ key: 'h2h', last_update: 't', outcomes: [{ name: 'Atlanta Dream', price: -200 }, { name: 'Connecticut Sun', price: 170 }] }] },
      { key: 'b', title: 'B', last_update: 't', markets: [{ key: 'h2h', last_update: 't', outcomes: [{ name: 'Atlanta Dream', price: -180 }, { name: 'Connecticut Sun', price: 160 }] }] }
    ]
  };
  const n = normalizeOddsEvent(ev, teamIndex(teams));
  assert.equal(n.home_team_id, '20');
  assert.equal(n.moneyline.best.home.price, -180);
  assert.equal(n.moneyline.best.away.price, 170);
  assert.equal(n.moneyline.consensus.books, 2);
  assert.equal(n.pbe_model.status, 'NOT_PUBLISHED');
  assert.equal(PBE_MODEL.status, 'NOT_PUBLISHED');
});

test('props join players by exact roster name only', () => {
  const idx = new Map([[normalizeName('Allisha Gray'), { athlete_id: '3058901', team_id: '20' }]]);
  const out = normalizeProps({ bookmakers: [{ key: 'fanduel', title: 'FanDuel', markets: [{ key: 'player_points', last_update: 't', outcomes: [
    { name: 'Over', description: 'Allisha Gray', price: -110, point: 18.5 }, { name: 'Under', description: 'Allisha Gray', price: -110, point: 18.5 },
    { name: 'Over', description: 'A. Gray', price: -110, point: 18.5 }
  ] }] }] }, idx);
  const hit = out.find((p) => p.player === 'Allisha Gray');
  const miss = out.find((p) => p.player === 'A. Gray');
  assert.equal(hit.athlete_id, '3058901');
  assert.equal(miss.athlete_id, null);
  assert.equal(miss.identity, 'UNMATCHED');
  assert.equal(hit.consensus, null); // one book is not a consensus
});

test('ET calendar helpers', () => {
  assert.equal(etCompact(new Date('2026-09-12T03:30:00Z')), '20260911');
  assert.equal(addDays('20260831', 1), '20260901');
});
