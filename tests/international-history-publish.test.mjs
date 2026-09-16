import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/wnba-web/src/index-historical.js';
import { competitionById } from '../workers/wnba-international/src/registry.js';
import { INTERNATIONAL_HISTORY, internationalHistoryFor } from '../src/views/international-history.js';
import { historicalCompetitionMeta } from '../src/seo/international-history-meta.js';

const slugs = ['olympics-2024', 'eurobasket-2025', 'americup-2025', 'asia-cup-2025', 'afrobasket-2025'];

test('all five verified historical competitions are first-class historical archives', () => {
  assert.equal(Object.keys(INTERNATIONAL_HISTORY).length, 5);
  for (const slug of slugs) {
    const c = competitionById(slug);
    assert.ok(c, slug);
    assert.equal(c.coverage, 'historical', slug);
    const h = internationalHistoryFor(c.competition_id);
    assert.ok(h, slug);
    assert.ok(h.source.url.startsWith('https://www.fiba.basketball/'), slug);
    const meta = historicalCompetitionMeta(c, h);
    assert.match(meta.robots, /^index, follow/);
    assert.equal(meta.url, `https://wnba.propbetedge.ai/international/${slug}`);
    assert.match(meta.description, /Final medal-game scores/);
  }
});

test('wnba-web emits the archive in the first HTML response, not a coverage-coming placeholder', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!doctype html><html><head><!--seo:start--><!--seo:end--></head><body><div id="app"></div></body></html>', { status: 200 });
  try {
    const res = await worker.fetch(new Request('https://wnba-web.test/international/olympics-2024'), {}, { waitUntil() {} });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-pbe-render'), 'wnba-web/1.0.0 intl-history');
    assert.match(body, /United States/);
    assert.match(body, /Gold medal game/);
    assert.match(body, /67/);
    assert.match(body, /EventCompleted/);
    assert.match(body, /name="robots" content="index, follow/);
    assert.doesNotMatch(body, /coverage coming/i);
    assert.doesNotMatch(body, /Structured coverage for this competition is not available yet/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('historical sub-sections canonicalize to the single archive page', async () => {
  const res = await worker.fetch(new Request('https://wnba-web.test/international/eurobasket-2025/games'), {}, { waitUntil() {} });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://wnba.propbetedge.ai/international/eurobasket-2025');
});
