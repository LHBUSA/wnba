import test from 'node:test';
import assert from 'node:assert/strict';

import {
  headlineConsensusPlayer,
  consensusEventType,
  teamForPlayer,
  articleIdentityFailures,
  auditStoredIdentity,
  IDENTITY_VERSION
} from '../workers/wnba-news/src/identity.js';
import { verifyRecordClaim } from '../workers/wnba-news/src/briefs.js';

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
