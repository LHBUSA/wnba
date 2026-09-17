import test from 'node:test';
import assert from 'node:assert/strict';

import { gameDayPreviewItems, heroStoryItems, recapHighlightItems } from '../src/views/news-base.js';
import { storyPublishedAt } from '../src/lib/news-ranking.js';

const preview = ({ id = 'p1', gameId = 'g1', start = '2026-09-17T23:30:00Z', first = '2026-09-11T18:51:12.095Z', revised = '2026-09-17T17:05:22.252Z' } = {}) => ({
  id,
  slug: `preview-${id}`,
  kind: 'preview',
  status: 'published',
  first_published_at: first,
  revised_at: revised,
  published_at: '2026-09-17T17:00:47.617Z',
  entities: [{ type: 'game', id: gameId, name: 'CON @ ATL', start_utc: start }]
});

const story = ({ id, kind = 'injury', first, gameId = null, start = null, video = null } = {}) => ({
  id,
  slug: `story-${id}`,
  headline: `Story ${id}`,
  kind,
  status: 'published',
  first_published_at: first,
  published_at: first,
  media: { layout: 'team', teams: [], subjects: [] },
  video,
  entities: gameId ? [{ type: 'game', id: gameId, name: `Game ${gameId}`, start_utc: start }] : []
});

test('a canonical preview first published days ago appears on the current ET game-day slate', () => {
  const now = Date.parse('2026-09-17T18:00:00Z'); // 2:00 p.m. ET
  const oldPreview = preview();
  assert.deepEqual(gameDayPreviewItems([oldPreview], { now }).map((c) => c.id), ['p1']);
  assert.equal(storyPublishedAt(oldPreview), Date.parse('2026-09-11T18:51:12.095Z'));
});

test('game-day relevance never rewrites editorial freshness', () => {
  const oldPreview = preview();
  assert.equal(storyPublishedAt(oldPreview), Date.parse(oldPreview.first_published_at));
  assert.notEqual(storyPublishedAt(oldPreview), Date.parse(oldPreview.revised_at));
});

test('the game-day slate excludes games after tip and games on another ET date', () => {
  const tonight = preview();
  const tomorrow = preview({ id: 'p2', gameId: 'g2', start: '2026-09-18T23:30:00Z' });
  assert.deepEqual(gameDayPreviewItems([tonight, tomorrow], { now: Date.parse('2026-09-17T18:00:00Z') }).map((c) => c.id), ['p1']);
  assert.deepEqual(gameDayPreviewItems([tonight], { now: Date.parse('2026-09-17T23:31:00Z') }), []);
});

test('the game-day slate is one canonical card per game and sorted by tip', () => {
  const late = preview({ id: 'late', gameId: 'g2', start: '2026-09-18T02:00:00Z' }); // 10 p.m. ET Sep 17
  const early = preview({ id: 'early', gameId: 'g1', start: '2026-09-17T23:30:00Z' });
  const duplicate = preview({ id: 'duplicate', gameId: 'g1', start: '2026-09-17T23:30:00Z' });
  assert.deepEqual(gameDayPreviewItems([late, early, duplicate], { now: Date.parse('2026-09-17T18:00:00Z') }).map((c) => c.id), ['early', 'late']);
});

test('an old canonical preview earns a hero slot when its game is tonight', () => {
  const now = Date.parse('2026-09-17T18:00:00Z');
  const items = [
    preview(),
    story({ id: 'injury', kind: 'injury', first: '2026-09-17T17:50:00Z' }),
    story({ id: 'transaction', kind: 'transaction', first: '2026-09-17T17:40:00Z' }),
    story({ id: 'league', kind: 'league', first: '2026-09-17T17:30:00Z' }),
    story({ id: 'result', kind: 'result', first: '2026-09-17T17:20:00Z' })
  ];
  const hero = heroStoryItems(items, { now });
  assert.equal(hero.length, 4);
  assert.equal(hero[0].id, 'p1');
  assert(hero.some((c) => c.kind === 'preview'));
});

test('a preview leaves the hero as soon as its game tips', () => {
  const tipped = preview();
  const now = Date.parse('2026-09-17T23:31:00Z');
  assert.equal(heroStoryItems([tipped], { now }).length, 0);
});

test('the four-story hero prefers desk variety before repeating an injury burst', () => {
  const now = Date.parse('2026-09-17T20:00:00Z');
  const items = [
    story({ id: 'injury-1', kind: 'injury', first: '2026-09-17T19:50:00Z' }),
    story({ id: 'injury-2', kind: 'injury', first: '2026-09-17T19:40:00Z' }),
    story({ id: 'transaction', kind: 'transaction', first: '2026-09-17T19:30:00Z' }),
    story({ id: 'league', kind: 'league', first: '2026-09-17T19:20:00Z' }),
    story({ id: 'result', kind: 'result', first: '2026-09-17T19:10:00Z' })
  ];
  assert.deepEqual(heroStoryItems(items, { now }).map((c) => c.id), ['injury-1', 'transaction', 'league', 'result']);
});

test('the hero still fills all four slots when only one desk has current stories', () => {
  const now = Date.parse('2026-09-17T20:00:00Z');
  const items = [1, 2, 3, 4].map((n) => story({ id: `injury-${n}`, kind: 'injury', first: `2026-09-17T19:${60 - n * 5}:00Z` }));
  assert.equal(heroStoryItems(items, { now }).length, 4);
});

test('recaps and highlights are one card per recent game and prefer an attached official video', () => {
  const now = Date.parse('2026-09-18T04:00:00Z');
  const items = [
    story({ id: 'g1-result', kind: 'result', first: '2026-09-18T02:10:00Z', gameId: 'g1', start: '2026-09-18T00:00:00Z' }),
    story({ id: 'g1-performance-video', kind: 'performance', first: '2026-09-18T02:20:00Z', gameId: 'g1', start: '2026-09-18T00:00:00Z', video: { title: 'Official highlights' } }),
    story({ id: 'g2-result', kind: 'result', first: '2026-09-18T01:40:00Z', gameId: 'g2', start: '2026-09-17T23:30:00Z' }),
    story({ id: 'old-result', kind: 'result', first: '2026-09-14T01:00:00Z', gameId: 'old', start: '2026-09-14T00:00:00Z' })
  ];
  assert.deepEqual(recapHighlightItems(items, { now }).map((c) => c.id), ['g1-performance-video', 'g2-result']);
});
