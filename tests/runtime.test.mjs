// Runtime truth tests: normalizers + derivations against a real WNBA game
// (ESPN event 401857189, CON @ DAL, 2026-08-30 — trimmed fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSummary, normalizeCoordinate, elapsedSeconds, parseClock, WNBA_RULES, mergeCorePlays, livePbpIntegrity, betterLivePbp } from '../workers/shared/espn.js';
import { leadTracker, foulContext, shotChart, scoringRuns, shotZone, possessions } from '../workers/shared/derive.js';
import { courtSvg, fullCourtPoint } from '../src/ui/court.js';
import { marginChart } from '../src/ui/charts.js';
import { approvedPlayerPhoto, approvedPlayerPhotoCount } from '../src/data/player-photo-map.js';
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


test('WNBACast client photo allowlist stays identical to the approved photo ledger', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/player-photos.json', import.meta.url), 'utf8'));
  const approved = (manifest.players || []).filter((p) => p.status === 'approved' && p.image && p.espn_athlete_id);
  assert.equal(approvedPlayerPhotoCount, approved.length);
  for (const p of approved) {
    assert.equal(approvedPlayerPhoto(p.espn_athlete_id)?.square, `/media/players/${p.espn_athlete_id}/square.webp`);
  }
  const rejected = (manifest.players || []).find((p) => p.espn_athlete_id && p.status !== 'approved');
  if (rejected) assert.equal(approvedPlayerPhoto(rejected.espn_athlete_id), null);
});

test('WNBACast vertical full court preserves basket-relative ESPN shot geometry on opposite ends', () => {
  const homeShot = { x: 25, y: 0.25, team_id: s.game.home.team_id };
  const awayShot = { x: 25, y: 0.25, team_id: s.game.away.team_id };
  const h = fullCourtPoint(homeShot, { home: s.game.home, away: s.game.away });
  const a = fullCourtPoint(awayShot, { home: s.game.home, away: s.game.away });
  assert.ok(Math.abs(h.x - 25) < 1e-9);
  assert.ok(Math.abs(a.x - 25) < 1e-9);
  assert.ok(Math.abs(h.y - 88.75) < 1e-9);
  assert.ok(Math.abs(a.y - 5.25) < 1e-9);
  assert.equal(h.side, 'h');
  assert.equal(a.side, 'a');

  const svg = courtSvg([
    { ...homeShot, seq: 1, made: true, points_attempted: 2, period: 1, clock: '9:00', text: 'Home makes', player: 'Home Player' },
    { ...awayShot, seq: 2, made: false, points_attempted: 2, period: 1, clock: '8:30', text: 'Away misses', player: 'Away Player' }
  ], { home: s.game.home, away: s.game.away });
  assert.match(svg, /viewBox="-1 -1 52 96"/);
  assert.match(svg, /class="c-team-label home"/);
  assert.match(svg, /class="c-team-label away"/);
  assert.match(svg, /cx="25" cy="88.75"/);
  assert.match(svg, /x1="24.4" y1="4.65"/);
});

test('PBECast Control is deterministic elapsed lead time from published score states', () => {
  const plays = [
    { seq: 1, elapsed_s: 60, home_score: 2, away_score: 0, period_label: 'Q1', clock: '9:00' },
    { seq: 2, elapsed_s: 180, home_score: 2, away_score: 0, period_label: 'Q1', clock: '7:00' },
    { seq: 3, elapsed_s: 240, home_score: 2, away_score: 2, period_label: 'Q1', clock: '6:00' },
    { seq: 4, elapsed_s: 300, home_score: 2, away_score: 4, period_label: 'Q1', clock: '5:00' },
    { seq: 5, elapsed_s: 360, home_score: 2, away_score: 4, period_label: 'Q1', clock: '4:00' }
  ];
  const lead = leadTracker(plays);
  assert.equal(lead.current_margin, -2);
  assert.equal(lead.pbe_control.elapsed_s, 360);
  assert.deepEqual(lead.pbe_control.seconds, { away: 60, tied: 120, home: 180 });
  assert.ok(Math.abs(lead.pbe_control.pct.away - 16.6666666667) < 1e-6);
  assert.ok(Math.abs(lead.pbe_control.pct.tied - 33.3333333333) < 1e-6);
  assert.ok(Math.abs(lead.pbe_control.pct.home - 50) < 1e-9);
  assert.equal(lead.pbe_control.current, 'away');
  assert.ok(Math.abs(
    lead.pbe_control.pct.away + lead.pbe_control.pct.tied + lead.pbe_control.pct.home - 100
  ) < 1e-9);
  assert.match(lead.pbe_control.method, /no projection, odds or possession estimate/i);
});

test('WNBACast interactive court carries real play metadata and an accessible latest-shot target', () => {
  const chart = shotChart(s.plays);
  const made = chart.shots.find((x) => x.made && x.player && Number.isFinite(x.home_score) && Number.isFinite(x.away_score));
  assert.ok(made, 'fixture has a made shot with player and score metadata');
  assert.ok(made.type, 'shot payload carries the source shot type');
  assert.ok(made.text, 'shot payload carries the canonical play text');

  const svg = courtSvg([made], {
    home: s.game.home,
    away: s.game.away,
    highlightSeq: made.seq,
    animateSeq: made.seq
  });
  assert.match(svg, /data-shot-point/);
  assert.match(svg, /role="button" tabindex="0"/);
  assert.match(svg, /class="shot-point is-latest entering"/);
  assert.match(svg, new RegExp(`data-shot-seq="${made.seq}"`));
  assert.match(svg, /data-shot-player="[^"]+"/);
  assert.match(svg, new RegExp(`data-shot-player-href="/players/${made.athlete_id}"`));
  assert.match(svg, /data-shot-text="[^"]+"/);
  assert.match(svg, /data-shot-score="\d+–\d+"/);
  assert.match(svg, /Interactive vertical full-court shot chart/);
  assert.match(svg, /Away attacks the top basket; home attacks the bottom/);

  const photoPath = `/media/players/${made.athlete_id}/square.webp`;
  const photoSvg = courtSvg([{ ...made, photo: { square: photoPath } }], {
    home: s.game.home,
    away: s.game.away,
    highlightSeq: made.seq,
    photoMode: true
  });
  assert.match(photoSvg, /<a href="\/players\/[^"]+" class="shot-point has-photo is-latest"/);
  assert.match(photoSvg, /data-shot-link/);
  assert.match(photoSvg, /class="shot-photo-marker made/);
  assert.match(photoSvg, /<image href="\/media\/players\/[^"]+\/square\.webp"/);
  assert.match(photoSvg, /class="shot-photo-ring"/);

  const classicSvg = courtSvg([{ ...made, photo: { square: photoPath } }], {
    home: s.game.home,
    away: s.game.away,
    photoMode: false
  });
  assert.doesNotMatch(classicSvg, /<image href=/, 'classic mode never renders player photos');
});


test('WNBACast integrity gate rejects a zeroed live PBP and prefers a healthier Core overlay', () => {
  const brokenRaw = {
    ...raw,
    header: {
      ...raw.header,
      competitions: raw.header.competitions.map((comp) => ({
        ...comp,
        status: { ...comp.status, type: { ...comp.status.type, state: 'in', completed: false, name: 'STATUS_IN_PROGRESS', description: 'In Progress' } }
      }))
    },
    plays: raw.plays.map((p) => ({
      ...p,
      homeScore: 0,
      awayScore: 0,
      scoringPlay: false,
      text: p.shootingPlay ? String(p.text || '').replace(/\bmakes\b/i, 'misses') : p.text,
      shortDescription: p.shootingPlay ? String(p.shortDescription || '').replace(/^\+\d+ Points?$/i, 'Missed FG') : p.shortDescription
    }))
  };

  const broken = normalizeSummary(brokenRaw);
  const brokenIntegrity = livePbpIntegrity(broken);
  assert.equal(brokenIntegrity.healthy, false);
  assert.ok(['PLAY_SCORE_STUCK_ZERO', 'MADE_FIELD_GOALS_MISSING', 'PLAY_SCORE_LAGS_GAME'].includes(brokenIntegrity.reason));
  assert.ok(brokenIntegrity.deficits.field_goals > 0);

  // Core uses the same play ids/sequence numbers but commonly represents team/athlete identity as $ref links.
  const coreItems = raw.plays.map((p) => ({
    ...p,
    team: p.team?.id ? { $ref: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/teams/${p.team.id}` } : p.team,
    participants: (p.participants || []).map((x) => ({
      ...x,
      athlete: x.athlete?.id ? { $ref: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/athletes/${x.athlete.id}` } : x.athlete
    }))
  }));

  const mergedRaw = { ...brokenRaw, plays: mergeCorePlays(brokenRaw.plays, coreItems) };
  const recovered = normalizeSummary(mergedRaw);
  const recoveredIntegrity = livePbpIntegrity(recovered);
  assert.equal(recoveredIntegrity.healthy, true);
  assert.equal(recoveredIntegrity.made_field_goals, livePbpIntegrity(s).made_field_goals);
  assert.equal(recoveredIntegrity.play_score.total, 168);

  const decision = betterLivePbp(recovered, broken);
  assert.equal(decision.use_candidate, true);
  assert.ok(decision.candidate.deficits.field_goals < decision.baseline.deficits.field_goals);
});

test('lead changes and largest leads reproduce ESPN box totals', () => {
  const lead = leadTracker(s.plays);
  assert.equal(lead.lead_changes, Number(boxTeam('DAL', 'leadChanges')));
  assert.equal(lead.largest_lead.home.margin, Number(boxTeam('DAL', 'largestLead')));
  assert.equal(lead.largest_lead.away.margin, Number(boxTeam('CON', 'largestLead')));
  const point = lead.margin_timeline.find((p) => p[2]?.text && Number.isFinite(p[2]?.home_score));
  assert.ok(point, 'margin timeline keeps source play facts');
  assert.ok(point[2].period_label);
  assert.ok(point[2].clock);
  assert.ok(['lead_change', 'tie', 'score_change'].includes(point[2].transition));
});

test('PBECast margin chart exposes interactive source-backed hover points', () => {
  const points = [
    [42, 2, { seq: 10, period: 1, period_label: 'Q1', clock: '9:18', home_score: 2, away_score: 0, text: 'Home Player makes layup.', transition: 'score_change' }],
    [85, 0, { seq: 11, period: 1, period_label: 'Q1', clock: '8:35', home_score: 2, away_score: 2, text: 'Away Player makes jumper.', transition: 'tie' }],
    [121, -3, { seq: 12, period: 1, period_label: 'Q1', clock: '7:59', home_score: 2, away_score: 5, text: 'Away Player makes 3-point jumper.', transition: 'lead_change' }]
  ];
  const svg = marginChart(points, {
    home: { abbr: 'DAL' },
    away: { abbr: 'CON' },
    periods: 4,
    height: 246
  });
  assert.match(svg, /data-flow-point/);
  assert.match(svg, /data-flow-seq="12"/);
  assert.match(svg, /data-flow-score="CON 5 · DAL 2"/);
  assert.match(svg, /data-flow-leader="CON \+3"/);
  assert.match(svg, /data-flow-transition="lead_change"/);
  assert.match(svg, /data-flow-text="Away Player makes 3-point jumper\."/);
  assert.match(svg, /class="ch-event-dot lead-change"/);
  assert.match(svg, /class="ch-event-dot tie"/);
  assert.match(svg, /Interactive score margin over game time/);
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
