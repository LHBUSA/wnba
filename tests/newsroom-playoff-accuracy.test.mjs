// Regressions from the 2026-09-29 newsroom production pass: accuracy defects that were live, and the playoff
// context every current story was missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventType } from '../workers/wnba-news/src/taxonomy.js';
import { benchComparison, statAvg, countOf } from '../workers/wnba-news/src/prose.js';
import { playoffContext, seriesScoreText, regularSeasonIds, seasonPhase, seasonOverTeams } from '../workers/wnba-news/src/playoff-context.js';
import { buildBriefStory, AWARD_WON } from '../workers/wnba-news/src/brief-story.js';
import { applyCorrections, CORRECTIONS } from '../workers/wnba-news/src/corrections.js';
import { reviewStory } from '../workers/wnba-news/src/legacy.js';
import { lintProse } from '../workers/wnba-news/src/reconcile.js';

// ---------------------------------------------------------------- awards vs coaching (a false story was live)

test('an award headline without "the" is an award, never a coaching change', () => {
  assert.equal(eventType('Reeve named WNBA Coach of Year after leading Lynx to best record'), 'awards');
  assert.equal(eventType('Cheryl Reeve named WNBA Coach of the Year'), 'awards');
  assert.equal(eventType('Olivia Miles received 100% of votes for 2026 WNBA Rookie of the Year award'), 'awards');
  assert.equal(eventType('Aliyah Boston named Defensive Player of Year'), 'awards');
  // real coaching changes still are
  assert.equal(eventType('Sparks fire head coach Lynne Roberts after 2 seasons'), 'coaching');
  assert.equal(eventType('Lynx name Jane Doe head coach'), 'coaching');
});

test('an award is "won" only when the headline says so; races and ladders are commentary', () => {
  assert.ok(AWARD_WON.test('Olivia Miles received 100% of votes for Rookie of the Year'));
  assert.ok(AWARD_WON.test('Caitlin Clark, Kelsey Mitchell Earn AP All-WNBA First Team Nods'));
  const v = { team: { id: '8', name: 'Minnesota Lynx', short_name: 'Lynx' }, season: { games: 41, pts: 19.5, reb: 4.8, ast: 6, min: 30.9 } };
  const player = { id: '1', name: 'Olivia Miles' };
  const base = { source: 'ESPN', sourceAt: '2026-09-28T14:00:00Z', others: [], player, v, type: 'awards' };
  assert.equal(buildBriefStory({ ...base, sourceHeadline: '2026 WNBA DPOY Power Rankings: Top 5 Award Frontrunners' }), null);
  const won = buildBriefStory({ ...base, sourceHeadline: 'Olivia Miles named WNBA Rookie of the Year' });
  assert.equal(won.headline, 'Olivia Miles named WNBA Rookie of the Year');
  assert.doesNotMatch(won.body.join(' '), /conversation/);
});

test('a coach award with no linked player never becomes "The player earns ..." or a coaching change', () => {
  const v = { team: { id: '8', name: 'Minnesota Lynx', short_name: 'Lynx' }, standing: { wins: 33, losses: 11, seed: 1, conference_name: 'Western Conference' } };
  const s = buildBriefStory({ source: 'ESPN', sourceAt: '2026-09-28T14:00:00Z', others: [], player: null, team: v.team, v, type: 'awards', sourceHeadline: 'Reeve named WNBA Coach of Year after leading Lynx to best record' });
  assert.equal(s.headline, 'Minnesota Lynx coach named WNBA Coach of the Year');
  const text = [s.headline, s.deck, ...s.body].join(' ');
  assert.doesNotMatch(text, /The player|coaching change|incoming|new coaching/i);
  // All-WNBA grammar
  const a = buildBriefStory({ source: 'X', sourceAt: '2026-09-28T14:00:00Z', others: [], player: { id: '2', name: 'Caitlin Clark' }, v: { team: { id: '5', name: 'Indiana Fever', short_name: 'Fever' } }, type: 'awards', sourceHeadline: 'Caitlin Clark earns All-WNBA First Team' });
  assert.doesNotMatch(a.body.join(' '), /named All-WNBA honors|honors honor/);
});

// ---------------------------------------------------------------- semantic comparators and counted nouns

test('bench comparison is decided by the numbers: a tie is never "outscored"', () => {
  assert.equal(benchComparison('Wings', 'Mercury', 15, 15), 'The benches were even, 15–15.');
  assert.equal(benchComparison('Aces', 'Mercury', 35, 34), 'The Aces’ bench outscored the Mercury’s, 35–34.');
  assert.equal(benchComparison('Mystics', 'Sky', 27, 28), 'The Sky’s bench outscored the Mystics’, 28–27.');
  assert.match(benchComparison('Aces', 'Sun', 10, 30), /won it with their starters: the Sun’s bench outscored theirs, 30–10/);
  for (const [a, b] of [[15, 15], [40, 36], [27, 28], [0, 0]]) assert.doesNotMatch(benchComparison('A', 'B', a, b), new RegExp(`outscored[^,]*, ${a}–${a}\\b`));
});

test('counted stat nouns agree with their numbers and zero is never "0 minutes"', () => {
  assert.equal(statAvg(1, 'assist'), '1 assist');
  assert.equal(statAvg(0, 'minute'), 'no minutes');
  assert.equal(statAvg(3.9, 'rebound'), '3.9 rebounds');
  assert.equal(countOf(1, 'game'), 'one game');
  assert.deepEqual(lintProse(`She averaged ${statAvg(6, 'point')}, ${statAvg(3.9, 'rebound')} and ${statAvg(1, 'assist')}.`), []);
});

// ---------------------------------------------------------------- playoff context

const PLAYOFFS = {
  season: 2026, phase: 'POSTSEASON',
  seeds: [{ team_id: '8', in_bracket: true }, { team_id: '9', in_bracket: true }, { team_id: '11', in_bracket: false }],
  rounds: [{ round_id: 'first-round', name: 'First Round', series: [{
    series_id: 's1', best_of: 3, wins_needed: 2, winner_team_id: null,
    higher_seed: { team_id: '8', team_name: 'Minnesota Lynx', short_name: 'Lynx', seed: 1 },
    lower_seed: { team_id: '9', team_name: 'New York Liberty', short_name: 'Liberty', seed: 8 },
    games: [
      { game_id: 'g1', game_number: 1, start_utc: '2026-09-27T18:00Z', status: 'FINAL', if_necessary: false, winner_team_id: '9', home_team: { team_id: '8' }, away_team: { team_id: '9' }, home_score: 75, away_score: 91 },
      { game_id: 'g2', game_number: 2, start_utc: '2026-09-30T00:30Z', status: 'SCHEDULED', if_necessary: false, home_team: { team_id: '9' }, away_team: { team_id: '8' } },
      { game_id: 'g3', game_number: 3, start_utc: '2026-10-01T23:00Z', status: 'SCHEDULED', if_necessary: true, home_team: { team_id: '8' }, away_team: { team_id: '9' } }
    ]
  }] }]
};

test('series state is counted from final games before tip; an unforced Game 3 is not a game yet', () => {
  const g1 = playoffContext(PLAYOFFS, 'g1');
  assert.deepEqual(g1.before, { 8: 0, 9: 0 });
  assert.deepEqual(g1.after, { 8: 0, 9: 1 });
  const g2 = playoffContext(PLAYOFFS, 'g2');
  assert.deepEqual(g2.before, { 8: 0, 9: 1 });
  assert.equal(g2.stakes['9'], 'closeout');
  assert.equal(g2.stakes['8'], 'elimination');
  assert.equal(seriesScoreText(g2, '8'), 'the Liberty lead the best-of-three series 1–0');
  assert.equal(playoffContext(PLAYOFFS, 'g3').needed, false, 'Game 3 before a 1-1 tie may never be played');
  const tied = structuredClone(PLAYOFFS);
  Object.assign(tied.rounds[0].series[0].games[1], { status: 'FINAL', winner_team_id: '8' });
  const g3 = playoffContext(tied, 'g3');
  assert.equal(g3.needed, true);
  assert.equal(g3.stakes['8'], 'decider');
});

test('eliminated teams are season-over during the postseason (no injury or trend stories)', () => {
  assert.deepEqual([...seasonOverTeams(PLAYOFFS)], ['11']);
  const done = structuredClone(PLAYOFFS);
  done.rounds[0].series[0].winner_team_id = '9';
  assert.deepEqual([...seasonOverTeams(done)].sort(), ['11', '8']);
  assert.equal(seasonOverTeams({ ...PLAYOFFS, phase: 'REGULAR' }).size, 0);
});

test('regular-season ids come from season windows when the schedule omits season.type (the live "0-0" defect)', () => {
  const types = [{ type: 1, start: '2026-04-03T07:00Z', end: '2026-05-08T06:59Z' }, { type: 2, start: '2026-05-08T07:00Z', end: '2026-09-25T06:59Z' }, { type: 3, start: '2026-09-25T07:00Z', end: '2026-11-01T06:59Z' }];
  const g = (id, start, extra = {}) => ({ game_id: id, start_utc: start, season: { year: 2026, type: null }, notes: [], ...extra });
  const ids = regularSeasonIds([g('pre', '2026-05-02T23:00Z'), g('reg', '2026-07-01T23:00Z'), g('po', '2026-09-27T18:00Z', { notes: ['First Round - Game 1'] })], types);
  assert.deepEqual([...ids], ['reg']);
  assert.equal(seasonPhase(g('x', '2026-09-26T00:00Z'), types), 'postseason');
  assert.equal(seasonPhase({ ...g('y', '2026-06-01T00:00Z'), season: { type: 2 } }, []), 'regular');
});

// ---------------------------------------------------------------- corrections

test('a registered correction retires the story, keeps its URL and clock, and cannot be re-listed by review', async () => {
  const fix = CORRECTIONS.find((c) => c.id === '467ed1ad4743');
  assert.ok(fix, 'the Lynx coaching-change brief is in the registry');
  const cards = [{ id: '467ed1ad4743', slug: 'minnesota-lynx-make-coaching-change-the-roster-the-move-inherits-467ed1', kind: 'brief', status: 'published', first_published_at: '2026-09-28T14:50:33.541Z', quality_state: 'current_quality', revisions: [] }];
  const store = new Map([['467ed1ad4743', { id: '467ed1ad4743', body: ['x'] }]]);
  const io = { at: '2026-09-29T15:00:00Z', getItem: async (id) => store.get(id), putItem: async (a) => store.set(a.id, a) };
  const out = await applyCorrections(cards, io);
  assert.equal(out.length, 1);
  assert.equal(cards[0].quality_state, 'retired_from_index');
  assert.equal(cards[0].first_published_at, '2026-09-28T14:50:33.541Z');
  assert.equal(cards[0].slug, 'minnesota-lynx-make-coaching-change-the-roster-the-move-inherits-467ed1');
  assert.equal(cards[0].revisions.at(-1).kind, 'integrity_correction');
  assert.equal((await applyCorrections(cards, io)).length, 0, 'idempotent');
  assert.equal(cards[0].revisions.length, 1);
  assert.match(store.get('467ed1ad4743').quality_review.reason, /^corrected: /);
  const review = reviewStory({ card: cards[0], item: store.get('467ed1ad4743') });
  assert.equal(review.state, 'retired_from_index');
});

// ---------------------------------------------------------------- late coverage (old events must not look new)

test('a result first published more than 48h after tip, or a transaction 72h after its log date, is late coverage', async () => {
  const { lateCoverage } = await import('../workers/wnba-news/src/legacy.js');
  const res = { kind: 'performance', entities: [{ type: 'game', id: 'g', start_utc: '2026-09-24T23:00Z' }] };
  assert.equal(lateCoverage(res, Date.parse('2026-09-25T02:00Z')), null);
  assert.match(lateCoverage(res, Date.parse('2026-09-29T13:00Z')), /^late coverage: first published 110h after tip/);
  const tx = { kind: 'transaction', published_at: '2026-09-20T07:00:00Z' };
  assert.equal(lateCoverage(tx, Date.parse('2026-09-21T07:00:00Z')), null);
  assert.match(lateCoverage(tx, Date.parse('2026-09-29T13:00:00Z')), /days after the transactions log date/);
  assert.equal(lateCoverage({ kind: 'injury', published_at: '2026-09-01T00:00Z' }, Date.parse('2026-09-29T00:00Z')), null, 'injuries have their own lifecycle');
  const review = reviewStory({ card: { ...res, id: 'x', status: 'published', first_published_at: '2026-09-29T13:01:00Z' }, item: { body: [] } });
  assert.equal(review.state, 'retired_from_index');
  assert.match(review.reason, /late coverage/);
});

// ---------------------------------------------------------------- card/item agreement after a lost update

test('an unchanged pass restores card display fields that drifted from the stored story (lost-update repair)', async () => {
  const { mergeArticles } = await import('../workers/wnba-news/src/lifecycle.js');
  const { cardOf } = await import('../workers/wnba-news/src/articles.js');
  const items = new Map();
  const story = { id: 'p1', kind: 'preview', headline: 'Lynx at Liberty, Game 2: Lynx favored by 3.5', deck: 'The Minnesota Lynx are 3.5-point favorites on the road.', body: ['x'], entities: [{ type: 'game', id: 'g2', start_utc: '2099-01-01T00:00Z' }], input_hash: 'h', evidence: [], published_at: '2026-09-29T08:00:00Z', status: 'published' };
  const io = { feed: null, getItem: async (id) => items.get(id), putItem: async (a) => items.set(a.id, a), versionOf: () => 'v', cardOf };
  const first = await mergeArticles({ index: [], articles: [structuredClone(story)], started: '2026-09-29T13:00:00Z', ...io });
  // a concurrent writer puts back an older copy of the card
  const stale = first.index.map((c) => ({ ...c, headline: 'Lynx at Liberty: injuries, recent form and the matchup' }));
  const second = await mergeArticles({ index: stale, articles: [structuredClone(story)], started: '2026-09-29T13:10:00Z', ...io });
  assert.equal(second.novelty.unchanged, 1);
  assert.equal(second.written, 0, 'a repair is not a revision');
  assert.equal(second.index[0].headline, story.headline);
  assert.equal(second.index[0].revised_at, first.index[0].revised_at, 'no fake freshness');
  assert.ok(second.repairs.some((r) => r.repair === 'card_display_drift'));
});

// ---------------------------------------------------------------- health: "why haven't we published anything new?"

test('newsroom health explains a quiet newsroom from the stored run state', async () => {
  const { newsroomHealthReport } = await import('../workers/wnba-news/src/newsroom-health.js');
  const now = Date.parse('2026-09-29T13:00:00Z');
  const lastRun = { at: '2026-09-29T12:55:00Z', version: 'wnba-articles/1.6.0', runs: { injury: 4 }, produced: 4, written: 0, held: 3, lifecycle: { novelty: { new_story: 0, revision: 0, unchanged: 1, rekeyed: 0 } }, errors: [] };
  const held = [{ kind: 'injury', headline: 'X listed out', failures: ['depth: 284 words is below the Full floor of 300'] }];
  const index = [{ id: 'a', kind: 'injury', status: 'published', quality_state: 'current_quality', first_published_at: '2026-09-27T10:00:00Z', entities: [] }];
  const status = { at: '2026-09-29T12:58:00Z', sources: [{ source_id: 's', status: 'PASS', latest_item_at: '2026-09-29T12:00:00Z' }], events: { created: 0, joined: 0, breaking: [] }, totals: { material_events: 3, events: 10 } };
  const r = newsroomHealthReport({ status, runs: [status], lastRun, index, held, now });
  assert.equal(r.status, 'OK');
  assert.match(r.why_nothing_new[0], /3 generated stories are held by the gates \(top reason: depth: N words is below the Full floor of N\)/);
  assert.equal(r.articles.new_stories.h24, 0);
  assert.equal(r.freshness.newest_injury_age_h, 51);
  const stale = newsroomHealthReport({ status: { ...status, at: '2026-09-29T11:00:00Z' }, lastRun, index, held, now });
  assert.equal(stale.status, 'DEGRADED');
  assert.match(stale.why_nothing_new.join(' '), /source ingest has not run for 120 minutes/);
});

test('a listed result carrying the old "0-0" records defect is detected for an in-place rebuild', async () => {
  const { knownDefect } = await import('../workers/wnba-news/src/articles-run.js');
  assert.equal(knownDefect({ body: ['After the result the Aces were 0-0 and the Storm 0-0 (team schedules through September 20).'] }), 'zero_records');
  assert.equal(knownDefect({ body: ['After the result the Aces were 30-12 and the Storm 20-22.'] }), null);
});

// ---------------------------------------------------------------- media identity: one subject on every surface

test('primary subject drives media: the subject or a team/brand fallback, never a teammate stand-in', async () => {
  const { primarySubjectOf, newsroomMediaFrom } = await import('../workers/wnba-news/src/media-resolve.js');
  const { cardOf } = await import('../workers/wnba-news/src/articles.js');
  const slot = { wide: [{ src: '/w.webp', w: 1280, h: 720 }], og: [{ src: '/og.jpg' }] };
  const PLAYERS = { B: { name: 'Teammate B', team_id: '5', team_abbr: 'IND', slots: slot, license: 'CC BY 4.0', source_page_url: 'x' }, C: { name: 'Star C', team_id: '5', team_abbr: 'IND', slots: slot, license: 'CC BY 4.0', source_page_url: 'x' } };
  const injury = { id: 'i1', slug: 'i1', kind: 'injury', lead_player_id: 'A', lead_team_id: '5', primary_subject: 'Player A', entities: [{ type: 'player', id: 'A', name: 'Player A' }, { type: 'player', id: 'B', name: 'Teammate B' }, { type: 'team', id: '5', name: 'Indiana Fever' }], evidence: [] };
  assert.deepEqual(primarySubjectOf(injury), { type: 'player', id: 'A', name: 'Player A', reason: 'injury' });
  const m = newsroomMediaFrom(PLAYERS, injury);
  assert.equal(m.resolved, 'team_composition', 'Player A has no approved photo: team composition, never Teammate B');
  assert.ok(!(m.subjects || []).some((s) => s.player_id === 'B'));
  const perf = { ...injury, id: 'p1', kind: 'performance', lead_player_id: 'C', entities: [...injury.entities, { type: 'player', id: 'C', name: 'Star C' }] };
  assert.equal(newsroomMediaFrom(PLAYERS, perf).subjects[0].player_id, 'C');
  const result = { ...injury, id: 'r1', kind: 'result', lead_player_id: null };
  assert.deepEqual(primarySubjectOf(result), { type: 'team', id: '5', name: 'Indiana Fever', reason: 'result' });
  const preview = { id: 'v1', kind: 'preview', lead_team_id: '5', entities: [{ type: 'game', id: 'g2', name: 'LV @ IND' }], evidence: [] };
  assert.equal(primarySubjectOf(preview).type, 'game');
  // card and article resolve the same media (homepage, /news, related cards read cards; the hero reads the article)
  for (const a of [injury, perf, result]) assert.deepEqual(newsroomMediaFrom(PLAYERS, cardOf(a)), newsroomMediaFrom(PLAYERS, a));
});

test('a withdrawal retires a true story with its own label, stickily', async () => {
  const cards = [{ id: '316e67086ede', slug: 'olivia-miles-wins', kind: 'brief', status: 'published', first_published_at: '2026-09-29T14:31:26.941Z', quality_state: 'current_quality', revisions: [] }];
  const store = new Map([['316e67086ede', { id: '316e67086ede', body: ['x'] }]]);
  await applyCorrections(cards, { at: '2026-09-29T15:00:00Z', getItem: async (id) => store.get(id), putItem: async (a) => store.set(a.id, a) });
  assert.equal(cards[0].quality_state, 'retired_from_index');
  assert.match(cards[0].quality_review.reason, /^withdrawn: /);
  assert.equal(cards[0].revisions.at(-1).kind, 'integrity_retirement');
  assert.match(reviewStory({ card: cards[0], item: store.get('316e67086ede') }).reason, /^withdrawn: /);
});
