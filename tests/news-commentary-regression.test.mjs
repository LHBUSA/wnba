import test from 'node:test';
import assert from 'node:assert/strict';

import { BRIEF_VERSION } from '../workers/wnba-news/src/briefs.js';
import { classify } from '../workers/wnba-news/src/taxonomy.js';

const PLAYER = { type: 'player', id: 'test-player', name: 'Test Player' };
const SOURCE = { priority: 2 };
const classifyHeadline = (headline) => classify(
  { headline, summary: '', tags: [] },
  { entities: [PLAYER], source: SOURCE, timestampQuality: 'publisher' }
);

test('brief generator version advances for subject/event integrity hardening', () => {
  assert.equal(BRIEF_VERSION, 'wnba-briefs/2.2.0');
});

test('current duplicate-producing commentary headlines cannot become material newsroom events', () => {
  const headlines = [
    'No. 1 overall pick Azzi Fudd ready to hype playoff-bound Wings after season-ending knee surgery',
    'This was the right decision: Azzi Fudd speaks on unexpected end to rookie season',
    'Azzi Fudd ready to hype playoff-bound Wings amid recovery',
    "Sophie Cunningham has faith in Adam Silver's next WNBA commissioner pick",
    'Sophie Cunningham expresses thoughts on next WNBA commissioner, has discussed them with Adam Silver'
  ];

  for (const headline of headlines) {
    const result = classifyHeadline(headline);
    assert.equal(result.materiality.material, false, headline);
    assert.ok(result.materiality.flags.includes('opinion'), `${headline} should be marked opinion/coverage`);
  }
});
