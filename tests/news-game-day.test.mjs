import test from 'node:test';
import assert from 'node:assert/strict';

import { gameDayPreviewItems } from '../src/views/news-base.js';
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
