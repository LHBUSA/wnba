import test from 'node:test';
import assert from 'node:assert/strict';

import {
  headlineConsensusPlayer,
  consensusEventType,
  teamForPlayer,
  articleIdentityFailures,
  auditStoredIdentity,
  subjectNamesStoryTeam,
  IDENTITY_VERSION
} from '../workers/wnba-news/src/identity.js';
import { verifyRecordClaim } from '../workers/wnba-news/src/briefs.js';
import { milesRecordStaticArticle, MILES_RECORD_SLUG, correctArticleListResponse } from '../src/lib/news-corrections.js';

const CLARK = { type: 'player', id: '4433403', name: 'Caitlin Clark', team_id: '5' };
const MILES = { type: 'player', id: '4433791', name: 'Olivia Miles', team_id: '8' };
const MITCHELL = { type: 'player', id: '2998928', name: 'Kelsey Mitchell', team_id: '5' };
const WILSON = { type: 'player', id: '3149391', name: "A'ja Wilson", team_id: '17' };
const LYNX = { type: 'team', id: '8', name: 'Minnesota Lynx' };
const entities = [CLARK, MILES, MITCHELL, WILSON, LYNX];

const reports = [
  {
    source_id: 'nbc', source_name: 'NBC Sports', published_at: '2026-09-20T19:20:00Z',
    headline: 'Olivia Miles breaks Caitlin Clark’s WNBA rookie points record by scoring 770th point',
    event_type: 'record', materiality: { score: 4, flags: [] }
  },
  {
    source_id: 'espn', source_name: 'ESPN', published_at: '2026-09-20T20:35:00Z',
    headline: "Olivia Miles breaks Caitlin Clark's WNBA rookie points record",
    event_type: 'record', materiality: { score: 4, flags: [] }
  },
  {
    source_id: 'cbs', source_name: 'CBS Sports', published_at: '2026-09-20T22:26:00Z',
    headline: "Lynx guard Olivia Miles breaks Caitlin Clark's WNBA rookie scoring record, continuing historic campaign",
    event_type: 'record', materiality: { score: 4, flags: [] }
  },
  {
    source_id: 'jws', source_name: "Just Women’s Sports", published_at: '2026-09-21T15:11:00Z',
    headline: 'Olivia Miles Breaks Caitlin Clark’s Rookie Scoring Record as WNBA Awards Loom',
    event_type: 'awards', materiality: { score: 4.5, flags: [] }
  }
];

test('Miles/Clark incident: headline consensus selects Olivia even when Caitlin is the first entity', () => {
  const subject = headlineConsensusPlayer(reports, entities, { canonicalHeadline: reports[0].headline });
  assert.equal(subject.player.id, MILES.id);
  assert.equal(subject.support, 4);
  const team = teamForPlayer(subject.player, entities, { teamById: new Map([['8', { team_id: '8', name: 'Minnesota Lynx' }]]) });
  assert.equal(team.id, '8');
  assert.equal(team.name, 'Minnesota Lynx');
});

test('Miles/Clark incident: three record reports beat one higher-scored awards follow-up', () => {
  const event = consensusEventType(reports);
  assert.equal(event.type, 'record');
  assert.equal(event.publishers, 3);
  assert.equal(event.alternatives.find((x) => x.type === 'awards').publishers, 1);
});

test('identity gate rejects the exact poisoned Caitlin + Lynx + awards combination', () => {
  const bad = {
    id: '6ff81a', kind: 'brief', headline: 'Caitlin Clark honored for the Minnesota Lynx: the season behind it',
    lead_player_id: CLARK.id, lead_team_id: LYNX.id, primary_subject: CLARK.name,
    entities,
    evidence: reports.map((r) => ({ kind: 'publisher_report', publisher: r.source_name, headline: r.headline, published_at: r.published_at })),
    facts: { brief: { event_type: 'awards', linked_entities: entities } },
    context: { brief: { event_type: 'awards' } }
  };
  const failures = articleIdentityFailures(bad);
  assert.ok(failures.some((x) => /publisher-headline consensus names Olivia Miles/.test(x)), failures.join('\n'));
  assert.ok(failures.some((x) => /linked to team 5.*not lead team 8/.test(x)), failures.join('\n'));
  assert.ok(failures.some((x) => /consensus is event "record".*not stored "awards"/.test(x)), failures.join('\n'));
});

test('corrected Miles + Lynx + record identity passes the same gate', () => {
  const good = {
    id: '6ff81a', kind: 'brief', headline: 'Olivia Miles breaks Caitlin Clark’s WNBA rookie scoring record',
    lead_player_id: MILES.id, lead_team_id: LYNX.id, primary_subject: MILES.name,
    entities,
    evidence: reports.map((r) => ({ kind: 'publisher_report', publisher: r.source_name, headline: r.headline, published_at: r.published_at })),
    facts: { brief: { event_type: 'record', linked_entities: entities } },
    context: { brief: { event_type: 'record' } }
  };
  assert.deepEqual(articleIdentityFailures(good), []);
});

test('770th-point record claim is verifiable from the season game log without inventing league history', () => {
  const earlier = Array.from({ length: 39 }, (_, i) => ({
    game_id: `g${i}`,
    date: new Date(Date.UTC(2026, 4, 1 + i * 3)).toISOString(),
    min: 30, pts: 19, reb: 4, ast: 6, result: i % 2 ? 'W' : 'L', score: '80-75',
    opponent: { name: 'Opponent' }, at_vs: 'vs'
  }));
  const crossing = {
    game_id: 'g-cross', date: '2026-09-20T18:00:00Z', min: 32, pts: 29, reb: 5, ast: 7,
    result: 'W', score: '90-82', opponent: { name: 'Opponent' }, at_vs: 'vs'
  };
  const pRes = { gamelog: { seasons: [{ name: '2026 Regular Season', games: [crossing, ...earlier].sort((a,b) => String(b.date).localeCompare(String(a.date))) }] } };
  const r = verifyRecordClaim(pRes, 'Olivia Miles breaks Caitlin Clark’s WNBA rookie points record by scoring 770th point', '2026-09-20T19:20:00Z', 2026);
  assert.equal(r.kind, 'season-points');
  assert.equal(r.claimed, 770);
  assert.equal(r.previous_total, 741);
  assert.equal(r.season_total_at_report, 770);
  assert.equal(r.verified, true, r.reason);
});

test('full-catalog audit retires an identity-poisoned historical story but keeps its record', async () => {
  const item = {
    id: 'bad6ff81a', slug: 'bad', kind: 'brief', status: 'published',
    lead_player_id: CLARK.id, lead_team_id: LYNX.id, primary_subject: CLARK.name, entities,
    first_published_at: '2026-09-20T19:20:00Z',
    evidence: reports.map((r) => ({ kind: 'publisher_report', publisher: r.source_name, headline: r.headline, published_at: r.published_at })),
    facts: { brief: { event_type: 'awards', linked_entities: entities } },
    context: { brief: { event_type: 'awards' } },
    revisions: []
  };
  const card = { ...item };
  const puts = [];
  const audit = await auditStoredIdentity([card], {
    at: '2026-09-21T17:00:00Z',
    getItem: async () => item,
    putItem: async (x) => puts.push(x)
  });
  assert.equal(audit.version, IDENTITY_VERSION);
  assert.equal(audit.retired, 1);
  assert.equal(card.quality_state, 'retired_from_index');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].revisions.at(-1).kind, 'integrity_retirement');
});


test('public correction is a focused Olivia Miles record story with the verified Sep. 20 game', () => {
  const a = milesRecordStaticArticle();
  assert.equal(a.slug, MILES_RECORD_SLUG);
  assert.equal(a.lead_player_id, MILES.id);
  assert.equal(a.lead_team_id, LYNX.id);
  assert.equal(a.primary_subject, MILES.name);
  assert.equal(a.event_type, 'record');
  assert.match(a.headline, /^Olivia Miles breaks Caitlin Clark/);
  assert.match(a.deck, /770th point/);
  assert.match(a.deck, /21 in Minnesota’s 101–89 win at Connecticut/);
  assert.match(a.body.join(' '), /21 points on 7-of-10 shooting, added 3 rebounds and 6 assists, and played 30 minutes/);
  assert.doesNotMatch(a.body.join(' '), /Caitlin Clark has averaged|Clark.*Minnesota Lynx/);
  assert.ok(a.media?.subjects?.some((x) => String(x.player_id) === MILES.id));
  assert.ok(a.entities.some((e) => e.type === 'game' && e.id === '401857201'));
  assert.deepEqual(articleIdentityFailures(a), []);
});


test('legacy source briefs are quarantined from live collections but preserved in archive', () => {
  const legacy = { id: 'legacy-brief', slug: 'old-brief-a1b2c3', kind: 'brief', input_hash: 'wnba-briefs/2.2.0|x' };
  const current = { id: 'current-brief', slug: 'new-brief-d4e5f6', kind: 'brief', input_hash: 'wnba-briefs/3.0.0|x' };
  const structured = { id: 'injury-1', slug: 'injury-story-abcdef', kind: 'injury' };
  const live = correctArticleListResponse({ ok: true, data: { items: [legacy, current, structured] } });
  assert.deepEqual(live.data.items.map((x) => x.id), ['current-brief', 'injury-1']);
  const archive = correctArticleListResponse({ ok: true, data: { items: [legacy, current, structured] } }, { archive: true });
  assert.deepEqual(archive.data.items.map((x) => x.id), ['legacy-brief', 'current-brief', 'injury-1']);
});


// A team subject with a player lead is how game, performance and transaction
// stories are modelled. Treating it as an identity contradiction flagged 16
// correct live articles (Aces/Wilson, Wings/Thomas, Fire/Reese, ...) while
// catching nothing true: the Clark record was caught by the roster and
// headline-consensus checks, which own that question.
test('team primary_subject with a player lead is coherent, not an identity failure', () => {
  const YOUNG = { type: 'player', id: '4065870', name: 'Jackie Young', team_id: '17' };
  const ACES = { type: 'team', id: '17', name: 'Las Vegas Aces' };
  const STORM = { type: 'team', id: '14', name: 'Seattle Storm' };
  const recap = {
    kind: 'performance',
    headline: 'Jackie Young’s 35 points lead the Aces past the Storm, 114–77',
    primary_subject: 'Aces',
    lead_player_id: '4065870',
    lead_team_id: '17',
    entities: [YOUNG, ACES, STORM, { type: 'game', id: '401857301', name: 'Seattle Storm at Las Vegas Aces' }]
  };
  assert.deepEqual(articleIdentityFailures(recap), []);

  // The losing team's standout as lead is equally legitimate.
  const REESE = { type: 'player', id: '4433402', name: 'Angel Reese', team_id: '20' };
  const DREAM = { type: 'team', id: '20', name: 'Atlanta Dream' };
  const FIRE = { type: 'team', id: '132052', name: 'Portland Fire' };
  assert.deepEqual(articleIdentityFailures({
    kind: 'performance',
    headline: 'Angel Reese’s 16 points and 16 rebounds not enough as the Fire beat the Dream',
    primary_subject: 'Fire',
    lead_player_id: '4433402',
    lead_team_id: '132052',
    entities: [REESE, DREAM, FIRE, { type: 'game', id: '401857300', name: 'Atlanta Dream at Portland Fire' }]
  }), []);
});

test('a subject naming neither the lead player nor a story team still fails', () => {
  const YOUNG = { type: 'player', id: '4065870', name: 'Jackie Young', team_id: '17' };
  const ACES = { type: 'team', id: '17', name: 'Las Vegas Aces' };
  const failures = articleIdentityFailures({
    kind: 'performance',
    primary_subject: 'Kelsey Mitchell',
    lead_player_id: '4065870',
    lead_team_id: '17',
    entities: [YOUNG, ACES, MITCHELL]
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /primary subject "Kelsey Mitchell" disagrees with lead player "Jackie Young"/);
});

test('the Clark/Lynx record still fails on roster and headline consensus', () => {
  const failures = articleIdentityFailures({
    kind: 'brief',
    headline: 'Caitlin Clark honored for the Minnesota Lynx: the season behind it',
    primary_subject: 'Caitlin Clark',
    lead_player_id: CLARK.id,
    lead_team_id: '8',
    entities,
    facts: { brief: { event_type: 'awards' } },
    evidence: reports.map((r) => ({ kind: 'publisher_report', publisher: r.source_name, headline: r.headline, published_at: r.published_at }))
  });
  assert.ok(failures.some((f) => /was linked to team 5 in this event, not lead team 8/.test(f)));
  assert.ok(failures.some((f) => /consensus names Olivia Miles/.test(f)));
  // The subject check must not be what saves or condemns it.
  assert.ok(!failures.some((f) => /primary subject/.test(f)));
});

test('short-name subject resolution uses the team suffix, not a loose substring', () => {
  const teams = [{ type: 'team', id: '132052', name: 'Portland Fire' }];
  assert.equal(subjectNamesStoryTeam('Fire', teams), true);
  assert.equal(subjectNamesStoryTeam('Portland Fire', teams), true);
  assert.equal(subjectNamesStoryTeam('Portland', teams), false);
  assert.equal(subjectNamesStoryTeam('Sparks', teams), false);
  // The lead team is resolvable from the dictionary when it is not an entity.
  assert.equal(subjectNamesStoryTeam('Tempo', [], {
    leadTeamId: '131935',
    dict: { teamById: new Map([['131935', { name: 'Toronto Tempo', short_name: 'Tempo' }]]) }
  }), true);
});


// The licence to diverge is structural, not a blanket exemption: a story that
// is not about a specific game, or that never links the player's own team,
// cannot attribute her to a team she does not play for.
test('a game story may lead with the other team; a non-game story may not', () => {
  const REESE = { type: 'player', id: '4433402', name: 'Angel Reese', team_id: '20' };
  const DREAM = { type: 'team', id: '20', name: 'Atlanta Dream' };
  const FIRE = { type: 'team', id: '132052', name: 'Portland Fire' };
  const GAME = { type: 'game', id: '401857300', name: 'Atlanta Dream at Portland Fire' };

  // Same teams, same lead, but no game entity: the divergence is unexplained.
  const noGame = articleIdentityFailures({
    kind: 'injury', primary_subject: 'Angel Reese',
    lead_player_id: '4433402', lead_team_id: '132052', entities: [REESE, DREAM, FIRE]
  });
  assert.ok(noGame.some((f) => /was linked to team 20 in this event, not lead team 132052/.test(f)));

  // Game present, but the player's own team is never linked (the Clark shape).
  const noRosterTeam = articleIdentityFailures({
    kind: 'performance', primary_subject: 'Angel Reese',
    lead_player_id: '4433402', lead_team_id: '132052', entities: [REESE, FIRE, GAME]
  });
  assert.ok(noRosterTeam.some((f) => /not lead team 132052/.test(f)));

  // Both present: legitimate.
  assert.deepEqual(articleIdentityFailures({
    kind: 'performance', primary_subject: 'Fire',
    lead_player_id: '4433402', lead_team_id: '132052', entities: [REESE, DREAM, FIRE, GAME]
  }), []);
});

test('the Fudd/Liberty wrong-team injury story still fails', () => {
  const FUDD = { type: 'player', id: '4433635', name: 'Azzi Fudd', team_id: '3' };
  const LIBERTY = { type: 'team', id: '9', name: 'New York Liberty' };
  const WINGS = { type: 'team', id: '3', name: 'Dallas Wings' };
  const failures = articleIdentityFailures({
    kind: 'injury',
    headline: 'Azzi Fudd injury update for the New York Liberty',
    primary_subject: 'Azzi Fudd',
    lead_player_id: '4433635', lead_team_id: '9',
    entities: [FUDD, LIBERTY, WINGS]
  });
  assert.ok(failures.some((f) => /Azzi Fudd was linked to team 3 in this event, not lead team 9/.test(f)));
});
