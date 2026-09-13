import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseLead, topStories, storyPublishedAt } from '../src/lib/news-ranking.js';
import { articleFirstPublishedAt, injuryIdentity, injuryPredecessors } from '../workers/wnba-news/src/articles-run.js';

const NOW = Date.parse('2026-09-13T13:00:00.000Z');
const ago = (minutes) => new Date(NOW - minutes * 60e3).toISOString();

test('a revision cannot make an old canonical story new enough to reclaim the headline', () => {
  const oldInjury = {
    id: 'satou',
    kind: 'injury',
    first_published_at: ago(6 * 60),
    published_at: ago(5), // source/feed revision just happened
    media: { layout: 'single' }
  };
  const newBrief = {
    id: 'brief',
    kind: 'brief',
    first_published_at: ago(120),
    published_at: ago(120)
  };

  assert.equal(chooseLead([oldInjury, newBrief]).id, 'brief');
  assert.equal(storyPublishedAt(oldInjury), Date.parse(oldInjury.first_published_at));
});

test('a revised old story cannot re-enter Top Stories through a fresh source timestamp', () => {
  const lead = { id: 'lead', kind: 'brief', first_published_at: ago(15), published_at: ago(15) };
  const oldRevised = {
    id: 'old',
    kind: 'injury',
    first_published_at: ago(4 * 24 * 60),
    published_at: ago(2),
    media: { layout: 'single' }
  };
  const freshPreview = { id: 'preview', kind: 'preview', first_published_at: ago(90), published_at: ago(90) };

  assert.deepEqual(topStories([lead, oldRevised, freshPreview], lead, { now: NOW }).map((x) => x.id), ['preview']);
});

test('legacy cards fall back to their old publication time instead of migration time', () => {
  const legacy = { published_at: ago(600) };
  assert.equal(articleFirstPublishedAt(legacy), legacy.published_at);
});

test('one ESPN injury record keeps one canonical PBE story across feed updates', () => {
  const article = {
    kind: 'injury',
    lead_player_id: '42',
    facts: { injury: { injury_id: 'espn-injury-7', status: 'Out' } }
  };
  const legacy = { id: 'legacy-id', kind: 'injury', episode: '42|out', published_at: ago(500) };

  assert.equal(injuryIdentity(article), 'espn-injury-7');
  assert.deepEqual(injuryPredecessors(article, [legacy]).map((x) => x.id), ['legacy-id']);

  const migrated = { ...legacy, injury_key: 'espn-injury-7' };
  const revised = {
    ...article,
    facts: { injury: { injury_id: 'espn-injury-7', status: 'Out', source_updated_at: ago(1) } }
  };
  assert.deepEqual(injuryPredecessors(revised, [migrated]).map((x) => x.id), ['legacy-id']);

  // A genuinely different ESPN injury id must not collapse into the already-migrated event.
  const futureEpisode = { ...article, facts: { injury: { injury_id: 'espn-injury-8', status: 'Out' } } };
  assert.deepEqual(injuryPredecessors(futureEpisode, [migrated]), []);
});
