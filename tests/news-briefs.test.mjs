import test from 'node:test';
import assert from 'node:assert/strict';

import { briefArticles, BRIEF_MAX_AGE_MS } from '../workers/wnba-news/src/briefs.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60e3).toISOString();

const item = (overrides = {}) => ({
  item_id: 'item-a',
  cluster_id: 'c_item-a',
  source_id: 'wnba_com',
  source_name: 'WNBA.com',
  priority: 1,
  canonical_url: 'https://www.wnba.com/news/league-update',
  headline: 'WNBA announces a new league operations update',
  published_at: iso(5),
  source_updated_at: null,
  story_type: 'league',
  relevance: 5,
  entities: [],
  ...overrides
});

test('a fresh material source cluster becomes a publishable PBE News Brief', async () => {
  const out = await briefArticles({ externalItems: [item()], structured: [], now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'brief');
  assert.equal(out[0].category, 'News Briefs');
  assert.equal(out[0].status, 'published');
  assert.equal(out[0].gate.ok, true, out[0].gate.failures?.join('\n'));
  assert.match(out[0].headline, /^WNBA\.com:/);
  assert.equal(out[0].published_at, iso(5));
});

test('corroboration revises one stable brief instead of creating a duplicate story', async () => {
  const first = await briefArticles({ externalItems: [item()], structured: [], now: NOW });
  const secondSource = item({
    item_id: 'item-b',
    source_id: 'espn_wnba',
    source_name: 'ESPN',
    priority: 2,
    canonical_url: 'https://www.espn.com/wnba/story/update',
    headline: 'WNBA league operations update draws new details',
    published_at: iso(2)
  });
  const revised = await briefArticles({ externalItems: [item(), secondSource], structured: [], now: NOW });

  assert.equal(first.length, 1);
  assert.equal(revised.length, 1);
  assert.equal(revised[0].id, first[0].id);
  assert.notEqual(revised[0].input_hash, first[0].input_hash);
});

test('a different material cluster creates a genuinely new article id', async () => {
  const other = item({
    item_id: 'item-c',
    cluster_id: 'c_item-c',
    canonical_url: 'https://www.wnba.com/news/second-event',
    headline: 'WNBA announces a separate expansion update',
    published_at: iso(1)
  });
  const out = await briefArticles({ externalItems: [item(), other], structured: [], now: NOW });

  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id);
});

test('external injury coverage does not duplicate an already-published structured injury story', async () => {
  const injury = item({
    story_type: 'injury',
    headline: 'Alyssa Example ruled out with an ankle injury',
    entities: [{ type: 'player', id: '42', name: 'Alyssa Example', team_id: '7' }, { type: 'team', id: '7', name: 'Example Team' }]
  });
  const structured = [{ id: 'inj-42', kind: 'injury', status: 'published', lead_player_id: '42', lead_team_id: '7' }];
  const out = await briefArticles({ externalItems: [injury], structured, now: NOW });

  assert.equal(out.length, 0);
});

test('a different named player transaction on the same team is not suppressed', async () => {
  const tx = item({
    story_type: 'transaction',
    headline: 'Example Team signs Alyssa Example to a contract',
    entities: [{ type: 'player', id: '42', name: 'Alyssa Example', team_id: '7' }, { type: 'team', id: '7', name: 'Example Team' }]
  });
  const structured = [{ id: 'tx-other', kind: 'transaction', status: 'published', lead_player_id: '99', lead_team_id: '7' }];
  const out = await briefArticles({ externalItems: [tx], structured, now: NOW });

  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'brief');
});

test('old source-wire events do not get promoted into new briefs', async () => {
  const old = item({ published_at: new Date(NOW - BRIEF_MAX_AGE_MS - 60e3).toISOString() });
  const out = await briefArticles({ externalItems: [old], structured: [], now: NOW });
  assert.equal(out.length, 0);
});
