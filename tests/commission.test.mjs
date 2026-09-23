// Commissioned features: a human chooses the question, the machine answers it
// from frozen records — and refuses rather than publishing a feature whose
// central figure cannot be built.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runCommission, COMMISSIONS, trajectoryOf, componentMovement, componentRowsOf, COMMISSION_MIN_WORDS } from '../workers/wnba-news/src/commission.js';
import { visualsFailures } from '../workers/wnba-news/src/visuals.js';
import { articleIdentityFailures } from '../workers/wnba-news/src/identity.js';
import { provenanceFailures } from '../workers/wnba-news/src/quality.js';
import factsDoc from '../data/commissions/verified-facts.json' with { type: 'json' };

const AT = '2026-09-23T01:00:00.000Z';

const row = (rank, id, name, teamId, teamName, score, comps, position = 'F') => ({
  rank,
  player_id: id,
  player_name: name,
  team_id: teamId,
  team_name: teamName,
  position,
  first_wnba_season: false,
  score,
  components: comps,
  production_percentile: comps.production_percentile,
  win_rate: comps.win_rate,
  games: 40,
  wins: 28,
  minutes: 1260,
  averages: { min: 31, pts: 20, reb: 9, ast: 3 }
});

// Four months shaped like the real series: Miles rises past Wilson, Reese climbs.
const MONTH = (period, [milesScore, wilsonScore, reeseScore], [milesRank, wilsonRank, reeseRank]) => ({
  period,
  period_label: period,
  period_complete: true,
  qualified_count: 193,
  snapshot_at: `${period}-20T00:00:00.000Z`,
  leaderboard_as_of: `${period}-20T00:00:00.000Z`,
  frozen_at: `${period}-20T00:00:00.000Z`,
  rows: [
    row(milesRank, '4433791', 'Olivia Miles', '8', 'Minnesota Lynx', milesScore, { production_percentile: 97.4, win_rate: 78, winning_output_share: 79.8, court_share: 77.1 }, 'G'),
    row(wilsonRank, '3149391', "A'ja Wilson", '17', 'Las Vegas Aces', wilsonScore, { production_percentile: 100, win_rate: 72.5, winning_output_share: 73.7, court_share: 78.8 }, 'C'),
    row(reeseRank, '4433402', 'Angel Reese', '20', 'Atlanta Dream', reeseScore, { production_percentile: 98.4, win_rate: 66.7, winning_output_share: 69.6, court_share: 77 }, 'F')
  ].sort((a, b) => a.rank - b.rank)
});

const EDITIONS = [
  { period: '2026-06', board: MONTH('2026-06', [86.8, 87.1, 80], [2, 1, 6]), hash: 'h06', slug: 'index-june', headline: 'June Index' },
  { period: '2026-07', board: MONTH('2026-07', [88.7, 86.6, 80.2], [1, 2, 6]), hash: 'h07', slug: 'index-july', headline: 'July Index' },
  { period: '2026-08', board: MONTH('2026-08', [87.7, 85.1, 81.6], [1, 2, 4]), hash: 'h08', slug: 'index-august', headline: 'August Index' },
  { period: '2026-09', board: MONTH('2026-09', [87, 85.7, 82.6], [1, 2, 3]), hash: 'h09', slug: 'index-september', headline: 'September Index' }
];

const SUBJECTS = {
  '4433791': { player: { athlete_id: '4433791', name: 'Olivia Miles', position_name: 'Guard', team: { team_id: '8', name: 'Minnesota Lynx', location: 'Minnesota' } } },
  '4433402': { player: { athlete_id: '4433402', name: 'Angel Reese', position_name: 'Forward', team: { team_id: '20', name: 'Atlanta Dream', location: 'Atlanta' } } },
  '3149391': { player: { athlete_id: '3149391', name: "A'ja Wilson", position_name: 'Center', team: { team_id: '17', name: 'Las Vegas Aces', location: 'Las Vegas' } } }
};
const SEASON = { season_label: '2026 season', games: 41, pts: 16.6, reb: 12.3, ast: 2.8, observed_at: AT };
const RECENT = { games: 5, pts: 19, reb: 14.6, ast: 3.6, from: '2026-08-25T00:00:00.000Z', to: '2026-09-19T23:00:00.000Z' };
const MILES_LIVE = {
  ready: true,
  observed_at: '2026-09-23T00:50:00.000Z',
  injury: {
    athlete_id: '4433791',
    status: 'Out',
    body_part: 'left calf',
    source_updated_at: '2026-09-22T23:30:00.000Z',
    authority: 'PROVIDER_FEED'
  },
  game: {
    game_id: '401999999',
    start_utc: '2026-09-23T00:00:00.000Z',
    status: { state: 'in', name: 'STATUS_HALFTIME', period: 2, clock: '0:00' },
    home: { team_id: '5', name: 'Indiana Fever', abbr: 'IND', score: 57, linescores: [29, 28] },
    away: { team_id: '8', name: 'Minnesota Lynx', abbr: 'MIN', score: 34, linescores: [18, 16] },
    subject_team: { team_id: '8', name: 'Minnesota Lynx', abbr: 'MIN', score: 34, linescores: [18, 16] },
    opponent: { team_id: '5', name: 'Indiana Fever', abbr: 'IND', score: 57, linescores: [29, 28] }
  },
  halftime: {
    subject_team_score: 34,
    opponent_score: 57,
    margin: -23,
    subject_team_id: '8',
    opponent_team_id: '5'
  },
  evidence: [
    { kind: 'availability_snapshot', source: 'PropBetEdge WNBA availability feed (ESPN provider record)', captured_at: '2026-09-22T23:30:00.000Z', detail: 'Olivia Miles: Out · left calf' },
    { kind: 'game_snapshot', source: 'PropBetEdge WNBA game feed', url: '/cast/401999999', captured_at: '2026-09-23T00:50:00.000Z', detail: 'Halftime: MIN 34 - IND 57' }
  ]
};
const DICT = {
  playerById: new Map([
    ['4433402', { athlete_id: '4433402', name: 'Angel Reese', team_id: '20' }],
    ['3149391', { athlete_id: '3149391', name: "A'ja Wilson", team_id: '17' }],
    ['4433791', { athlete_id: '4433791', name: 'Olivia Miles', team_id: '8' }]
  ])
};

function harness() {
  const articles = new Map();
  let state = null;
  return {
    articles,
    get state() { return state; },
    io: {
      getState: async () => state,
      putState: async (v) => { state = v; },
      getArticle: async (id) => articles.get(id) || null,
      putArticle: async (a) => { articles.set(a.id, a); }
    }
  };
}
const run = (key, over = {}) => {
  const h = over.h || harness();
  return runCommission({
    key,
    editions: EDITIONS,
    subjectRecord: SUBJECTS[COMMISSIONS[key].subject.id],
    seasonLine: SEASON,
    recent: RECENT,
    liveContext: COMMISSIONS[key].live_context ? MILES_LIVE : null,
    factsDoc,
    at: AT,
    ...h.io,
    ...over.opts
  }).then((res) => ({ res, h }));
};

test('all commissions compose, gate clean and publish', async () => {
  for (const key of Object.keys(COMMISSIONS)) {
    const { res } = await run(key);
    assert.equal(res.status, 'published', `${key}: ${JSON.stringify(res).slice(0, 300)}`);
    const a = res.article;
    assert.deepEqual(visualsFailures(a.visuals), []);
    assert.deepEqual(articleIdentityFailures(a, { dict: DICT }), []);
    assert.deepEqual(provenanceFailures(a, { generatedAt: a.provenance.generated_at }), []);
    assert.ok(a.words >= COMMISSION_MIN_WORDS, `${key} words ${a.words}`);
    assert.equal(a.kind, 'commissioned_feature');
    assert.equal(a.identity_mode, 'player');
    assert.equal(a.commission.autopilot, false, 'the record says a human ordered it');
    assert.ok(a.commission.note, 'and why');
    // Required figures are present and each is addressed by a section.
    for (const id of COMMISSIONS[key].required_visuals) {
      assert.ok(a.visuals.some((v) => v.id === id), `${key} missing ${id}`);
      assert.ok(a.sections.some((s) => s.visual === id), `${key} does not place ${id}`);
    }
  }
});

test('Miles feature freezes the absence and halftime stress test without claiming causation', async () => {
  const { res } = await run('miles-winba-absence-stress-test');
  assert.equal(res.status, 'published');
  const a = res.article;
  assert.equal(a.winba_reference.player_id, '4433791');
  assert.equal(a.winba_reference.rank, 1);
  assert.equal(a.winba_reference.score, 87);
  assert.equal(a.context.game.halftime.subject_team_score, 34);
  assert.equal(a.context.game.halftime.opponent_score, 57);
  assert.equal(a.context.game.halftime.margin, -23);
  assert.match(a.headline, /Down 23 at Half/);
  assert.match(a.deck, /does not prove causation/i);
  assert.match(a.body.join(' '), /cannot validate WinBA/i);
  assert.match(a.body.join(' '), /not a causal estimate/i);
  assert.ok(a.evidence.some((e) => e.kind === 'availability_snapshot'));
  assert.ok(a.evidence.some((e) => e.kind === 'game_snapshot'));
  assert.deepEqual(visualsFailures(a.visuals), []);
});

test('Miles stress test refuses to publish without frozen live context', async () => {
  const h = harness();
  const res = await runCommission({
    key: 'miles-winba-absence-stress-test',
    editions: EDITIONS,
    subjectRecord: SUBJECTS['4433791'],
    seasonLine: SEASON,
    recent: RECENT,
    factsDoc,
    at: AT,
    ...h.io
  });
  assert.equal(res.status, 'missing_live_context');
  assert.equal(h.articles.size, 0);
});

test('the two features are different arguments, not one template', async () => {
  const { res: reese } = await run('reese-winba-empty-stats');
  const { res: wilson } = await run('wilson-winba-consistency');
  const overlap = reese.article.body.filter((p) => wilson.article.body.includes(p));
  assert.deepEqual(overlap, [], 'no paragraph is shared between the two features');
  assert.notDeepEqual(reese.article.sections.map((s) => s.key), wilson.article.sections.map((s) => s.key));
  assert.match(reese.article.headline, /Empty Stats/);
  assert.match(wilson.article.headline, /Consistent/);
  // Wilson's piece deliberately omits a component-bar figure: it would repeat
  // Reese's treatment without teaching anything new.
  assert.ok(reese.article.visuals.some((v) => v.type === 'component_bars'));
  assert.ok(!wilson.article.visuals.some((v) => v.type === 'component_bars'));
  assert.ok(wilson.article.visuals.some((v) => v.type === 'resume_card'));
});

test('Reese feature explains WinBA once, names the v1 limits, and avoids duplicate methodology sections', async () => {
  const { res } = await run('reese-winba-empty-stats');
  const a = res.article;
  const keys = a.sections.map((s) => s.key);
  assert.ok(keys.includes('components'));
  assert.ok(!keys.includes('method'), 'methodology is integrated with the component section instead of repeated');
  const text = a.body.join(' ');
  assert.match(text, /shooting efficiency or turnovers/);
  assert.match(text, /does not directly measure defence/);
  assert.doesNotMatch(text, /Third is not a moral victory/);
  assert.doesNotMatch(text, /opposite of a volume story/);
  assert.doesNotMatch(a.deck, /does not end the argument/);
});

test('Wilson comparison stays about consistency rather than player equivalence', async () => {
  const { res } = await run('wilson-winba-consistency');
  const text = res.article.body.join(' ');
  assert.match(text, /sustained elite scoring/);
  assert.match(text, /not a role, style or all-around-impact equivalence/);
});

test('every plotted value comes from a frozen board, hash and all', async () => {
  const { res } = await run('reese-winba-empty-stats');
  const climb = res.article.visuals.find((v) => v.id === 'reese-climb');
  assert.deepEqual(climb.series.map((p) => [p.key, p.value, p.rank]), [
    ['2026-06', 80, 6], ['2026-07', 80.2, 6], ['2026-08', 81.6, 4], ['2026-09', 82.6, 3]
  ]);
  assert.deepEqual(climb.series.map((p) => p.source.source_hash), ['h06', 'h07', 'h08', 'h09']);
  const bars = res.article.visuals.find((v) => v.id === 'reese-components');
  const sept = EDITIONS.at(-1).board.rows.find((r) => r.player_id === '4433402');
  assert.deepEqual(bars.rows.map((r) => r.value), [
    sept.components.production_percentile, sept.components.win_rate, sept.components.winning_output_share, sept.components.court_share
  ]);
  assert.equal(bars.total, sept.score);
});

test('a published feature is idempotent and never republished at a new date', async () => {
  const { res: first, h } = await run('wilson-winba-consistency');
  const { res: again } = await run('wilson-winba-consistency', { h });
  assert.equal(again.status, 'already_published');
  assert.equal(again.published_at, first.article.published_at);
  assert.equal(again.slug, first.slug);

  const { res: forced } = await run('wilson-winba-consistency', { h, opts: { at: '2026-10-01T00:00:00.000Z', force: true } });
  assert.equal(forced.status, 'regenerated');
  assert.equal(forced.article.published_at, first.article.published_at, 'publication date never moves');
  assert.equal(forced.article.first_published_at, first.article.published_at);
  assert.equal(forced.article.revised_at, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(forced.article.revisions.map((r) => r.kind), ['editorial_upgrade']);
});

test('a missing frozen board refuses the feature and writes nothing', async () => {
  const h = harness();
  const res = await runCommission({
    key: 'reese-winba-empty-stats',
    editions: EDITIONS.slice(0, 2),
    subjectRecord: SUBJECTS['4433402'], seasonLine: SEASON, recent: RECENT, factsDoc, at: AT, ...h.io
  });
  assert.equal(res.status, 'missing_frozen_boards');
  assert.deepEqual(res.missing, ['2026-08', '2026-09']);
  assert.equal(h.articles.size, 0);
  assert.equal(h.state, null);
});

test('a subject absent from one board refuses the feature: no chart with a hole in it', async () => {
  const h = harness();
  const editions = EDITIONS.map((e, i) => (i === 1
    ? { ...e, board: { ...e.board, rows: e.board.rows.filter((r) => r.player_id !== '4433402') } }
    : e));
  const res = await runCommission({
    key: 'reese-winba-empty-stats', editions,
    subjectRecord: SUBJECTS['4433402'], seasonLine: SEASON, recent: RECENT, factsDoc, at: AT, ...h.io
  });
  assert.equal(res.status, 'subject_absent_from_a_board');
  assert.deepEqual(res.present, ['2026-06', '2026-08', '2026-09']);
  assert.equal(h.articles.size, 0);
});

test('a roster team that disagrees with the frozen board refuses the feature', async () => {
  const h = harness();
  const res = await runCommission({
    key: 'reese-winba-empty-stats', editions: EDITIONS,
    subjectRecord: { player: { ...SUBJECTS['4433402'].player, team: { team_id: '19', name: 'Chicago Sky', location: 'Chicago' } } },
    seasonLine: SEASON, recent: RECENT, factsDoc, at: AT, ...h.io
  });
  assert.equal(res.status, 'team_disagreement');
  assert.equal(res.roster_team, '19');
  assert.equal(res.board_team, '20');
  assert.equal(h.articles.size, 0, 'a trade cannot publish a wrong-team feature');
});

test('a feature whose premise is a chart does not publish without it', async () => {
  const h = harness();
  // A board row with no components at all: the component figure cannot be built.
  const editions = EDITIONS.map((e, i) => (i === 3
    ? { ...e, board: { ...e.board, rows: e.board.rows.map((r) => (r.player_id === '4433402' ? { ...r, components: {} } : r)) } }
    : e));
  const res = await runCommission({
    key: 'reese-winba-empty-stats', editions,
    subjectRecord: SUBJECTS['4433402'], seasonLine: SEASON, recent: RECENT, factsDoc, at: AT, ...h.io
  });
  assert.equal(res.status, 'held_visual_validation');
  assert.ok(res.failures.length, 'and it says which check failed');
  assert.equal(h.articles.size, 0);
});

test('the subject is the player, and the metric is linked but never the subject', async () => {
  const { res } = await run('reese-winba-empty-stats');
  const a = res.article;
  assert.equal(a.primary_subject, 'Angel Reese');
  assert.equal(a.lead_player_id, '4433402');
  assert.equal(a.lead_team_id, '20');
  const ids = a.entities.filter((e) => e.type === 'player').map((e) => e.id);
  assert.deepEqual(ids, ['4433402', '4433791', '3149391'], 'subject first, then the players it mentions');
  assert.ok(a.entities.some((e) => e.type === 'metric' && e.id === 'winba'));
  assert.ok(a.entities.some((e) => e.type === 'team' && e.id === '20'));
  assert.equal(a.links.index_series, '/news/winba-index');
});

test('external facts are cited to the page they were read from, never absorbed', async () => {
  const { res } = await run('wilson-winba-consistency');
  const cited = res.article.evidence.filter((e) => e.kind === 'publisher_report');
  assert.ok(cited.length >= 1);
  for (const e of cited) {
    assert.match(e.url, /^https:\/\//);
    assert.ok(Number.isFinite(Date.parse(e.captured_at)));
    assert.ok(e.publisher);
  }
  // Career values are printed verbatim from the cited profile.
  const resume = res.article.visuals.find((v) => v.id === 'wilson-resume');
  const career = resume.lines.find((l) => l.key === 'career');
  assert.equal(career.stats.find((s) => s.key === 'pts').value, Number(factsDoc.facts.wilson_official_profile.career_line.verbatim.pts));
  assert.match(career.source, /WNBA\.com/);
  assert.match(res.article.body.join(' '), /PropBetEdge holds no career-history or awards data of its own/);
});

test('the frozen boards are cited at the instant their window closed', async () => {
  const { res } = await run('reese-winba-empty-stats');
  const boards = res.article.evidence.filter((e) => e.kind === 'internal_snapshot');
  assert.equal(boards.length, 4);
  for (const e of boards) {
    assert.ok(Date.parse(e.captured_at) <= Date.parse(AT), 'never observed after the article was generated');
    assert.match(e.detail, /snapshot hash h\d\d/);
  }
});

test('an unknown commission is refused by name', async () => {
  const h = harness();
  const res = await runCommission({ key: 'not-a-commission', editions: EDITIONS, factsDoc, at: AT, ...h.io });
  assert.equal(res.status, 'unknown_commission');
  assert.equal(h.articles.size, 0);
});

test('helpers read only the frozen row', () => {
  const traj = trajectoryOf('3149391', EDITIONS);
  assert.deepEqual(traj.map((p) => p.rank), [1, 2, 2, 2]);
  assert.deepEqual(traj.map((p) => p.source_hash), ['h06', 'h07', 'h08', 'h09']);
  assert.equal(trajectoryOf('999999', EDITIONS).length, 0);

  const moves = componentMovement(EDITIONS[0].board.rows[0], EDITIONS[3].board.rows[0]);
  assert.ok(moves.every((m) => Number.isFinite(m.delta)));
  assert.deepEqual([...moves].sort((a, b) => b.delta - a.delta).map((m) => m.key), moves.map((m) => m.key), 'largest mover first');

  // A row missing a component contributes nothing rather than a zero.
  const rows = componentRowsOf({ components: { production_percentile: 98.4, win_rate: null, court_share: '' } });
  assert.deepEqual(rows.map((r) => r.key), ['production_percentile']);
});
