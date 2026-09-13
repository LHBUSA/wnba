import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeName, normalizeDob, birthCountryCode, wnbaCrosswalk } from '../workers/wnba-international/src/crosswalk.js';

const WNBA = [
  { athlete_id: '3142328', name: 'Gabby Williams', dob: '1996-09-09', birthplace: 'Sparks, NV', team: { team_id: '14', abbr: 'SEA', name: 'Seattle Storm' } },
  { athlete_id: '4001679', name: 'Julie Allemand', dob: '1996-07-07', birthplace: 'Brussels, Belgium', team: { team_id: '131935', abbr: 'TOR', name: 'Toronto Tempo' } },
  { athlete_id: '5208982', name: 'Carla Leite', dob: '2004-05-09', birthplace: 'Perpignan, France', team: { team_id: '132052', abbr: 'POR', name: 'Portland Fire' } },
  { athlete_id: '1', name: 'Jordan Smith', dob: '1999-01-01', birthplace: 'Austin, TX', team: null },
  { athlete_id: '2', name: 'Jordan Smith', dob: '2000-02-02', birthplace: 'Toronto, Canada', team: null }
];
const link = wnbaCrosswalk(WNBA, { capturedAt: '2026-09-13T15:00:00Z' });

test('names normalize deterministically (accents, punctuation, suffixes) — no fuzzy equivalence', () => {
  assert.equal(normalizeName('Iliana  Rupért'), 'iliana rupert');
  assert.equal(normalizeName("A'ja Wilson Jr."), 'aja wilson');
  assert.equal(normalizeName('Marine Johannès'), 'marine johannes');
  assert.notEqual(normalizeName('Gabby Williams'), normalizeName('Gabrielle Williams'));
  assert.equal(normalizeDob('1996-09-09T00:00:00Z'), '1996-09-09');
  assert.equal(normalizeDob('09/09/1996'), null);
});

test('exact name + DOB links with high confidence, across a different national team than birthplace', () => {
  const m = link({ name: 'Gabby Williams', dob: '1996-09-09', team_code: 'FRA' });
  assert.equal(m.wnba_player_id, '3142328');
  assert.equal(m.mapping_method, 'exact_name_dob');
  assert.equal(m.mapping_confidence, 'high');
  assert.equal(m.wnba_team.abbr, 'SEA');
  assert.equal(m.mapping_provenance.dob, '1996-09-09');
});

test('a DOB mismatch never links, even with an identical name', () => {
  assert.equal(link({ name: 'Gabby Williams', dob: '1997-09-09', team_code: 'FRA' }), null);
});

test('name-only fallback requires a unique name and a matching birthplace country', () => {
  const m = link({ name: 'Julie Allemand', dob: null, team_code: 'BEL' });
  assert.equal(m.mapping_method, 'exact_name_team_unique');
  assert.equal(m.mapping_confidence, 'medium');
  assert.equal(link({ name: 'Julie Allemand', dob: null, team_code: 'FRA' }), null, 'birth country differs');
  assert.equal(link({ name: 'Jordan Smith', dob: null, team_code: 'USA' }), null, 'ambiguous name is never guessed');
  assert.equal(link({ name: 'Jordan Smith', dob: '2000-02-02', team_code: 'CAN' }).wnba_player_id, '2', 'DOB disambiguates');
  assert.equal(link({ name: 'Unknown Player', dob: '2000-01-01', team_code: 'USA' }), null);
});

test('birthplace country codes: US state abbreviations and named countries', () => {
  assert.equal(birthCountryCode('Sparks, NV'), 'USA');
  assert.equal(birthCountryCode('Brussels, Belgium'), 'BEL');
  assert.equal(birthCountryCode(''), null);
});
