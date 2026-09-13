import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseLead, topStories, NEWS_RANKING } from '../src/lib/news-ranking.js';
import { ARTICLE_RUN_MIN_GAP_MS } from '../workers/wnba-news/src/articles-run.js';

const at = (base, minutesAgo) => new Date(base - minutesAgo * 60e3).toISOString();
const story = (id, kind, published_at, extra = {}) => ({ id, kind, published_at, ...extra });

test('lead selection is freshness-first outside the one-hour tie window', () => {
  const now = Date.parse('2026-09-13T11:00:00.000Z');
  const newerPerformance = story('perf-new', 'result', at(now, 5));
  const olderInjury = story('inj-old', 'injury', at(now, 95), { media: { layout: 'single' } });
  const preview = story('preview', 'preview', at(now, 30));

  assert.equal(chooseLead([olderInjury, preview, newerPerformance]).id, 'perf-new');
});

test('a newly published material News Brief immediately becomes the lead', () => {
  const now = Date.parse('2026-09-13T11:00:00.000Z');
  const brief = story('brief-new', 'brief', at(now, 2));
  const injury = story('inj', 'injury', at(now, 10), { media: { layout: 'single' } });
  const performance = story('perf', 'result', at(now, 4));

  assert.equal(chooseLead([injury, performance, brief]).id, 'brief-new');
});

test('editorial priority may break a near-tie without promoting stale coverage', () => {
  const now = Date.parse('2026-09-13T11:00:00.000Z');
  const performance = story('perf', 'result', at(now, 4));
  const injury = story('inj', 'injury', at(now, 20));

  assert.equal(chooseLead([performance, injury]).id, 'inj');
  assert.equal(NEWS_RANKING.lead_tie_window_ms, 60 * 60e3);
});

test('top stories never includes coverage older than 72 hours', () => {
  const now = Date.parse('2026-09-13T11:00:00.000Z');
  const lead = story('lead', 'injury', at(now, 10));
  const freshPreview = story('preview', 'preview', at(now, 60));
  const freshResult = story('result', 'result', at(now, 120));
  const staleTransaction = story('stale', 'transaction', at(now, 13 * 24 * 60));

  const out = topStories([lead, staleTransaction, freshResult, freshPreview], lead, { now, limit: 3 });
  assert.deepEqual(out.map((x) => x.id), ['preview', 'result']);
  assert.equal(NEWS_RANKING.top_story_max_age_ms, 72 * 60 * 60e3);
});

test('article run guard permits every normal ten-minute cron cycle', () => {
  assert.ok(ARTICLE_RUN_MIN_GAP_MS < 10 * 60e3);
  assert.ok(ARTICLE_RUN_MIN_GAP_MS >= 8 * 60e3);
});
