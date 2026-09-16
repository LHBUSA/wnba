import test from 'node:test';
import assert from 'node:assert/strict';
import { assignEvents, factKey } from '../workers/wnba-news/src/events.js';

const NOW = Date.parse('2026-09-16T18:30:00Z');
const item = ({ id, type, at, source, team }) => ({
  item_id: id,
  source_id: source,
  source_name: source,
  headline: type === 'availability' ? 'Azzi Fudd availability update' : 'Azzi Fudd out after knee surgery',
  published_at: at,
  first_captured_at: at,
  event_type: type,
  story_type: 'injury',
  priority: 2,
  entities: [
    { type: 'player', id: '4433790', name: 'Azzi Fudd' },
    { type: 'team', id: team, name: team === '3' ? 'Dallas Wings' : 'New York Liberty' }
  ],
  materiality: { score: 5, level: 'high', material: true }
});

test('injury and availability vocabulary share one fact key for the same player', () => {
  const a = item({ id: 'a', type: 'injury', at: '2026-09-16T16:00:00Z', source: 'nbc', team: '3' });
  const b = item({ id: 'b', type: 'availability', at: '2026-09-16T02:00:00Z', source: 'the_ix', team: '9' });
  assert.equal(factKey(a), 'injury:4433790');
  assert.equal(factKey(b), 'injury:4433790');
  const out = assignEvents([a, b], null, { now: NOW });
  assert.equal(out.clusters.length, 1);
  assert.equal(out.clusters[0].members.length, 2);
});

test('existing split production-style injury events are repaired in place', () => {
  const a = item({ id: 'a', type: 'injury', at: '2026-09-16T16:00:00Z', source: 'nbc', team: '3' });
  const b = item({ id: 'b', type: 'availability', at: '2026-09-16T02:00:00Z', source: 'the_ix', team: '9' });
  const registry = {
    version: 'wnba-events/1.0.0',
    item_event: { a: 'c_a', b: 'c_b' },
    events: {
      c_a: { event_id: 'c_a', event_type: 'injury', fact_keys: ['injury:4433790'], players: ['4433790'], teams: ['3'], first_published_at: a.published_at, last_published_at: a.published_at, first_seen_at: a.published_at, members: [{ item_id: 'a', source_id: 'nbc', headline: a.headline, published_at: a.published_at, event_type: a.event_type }] },
      c_b: { event_id: 'c_b', event_type: 'availability', fact_keys: ['availability:4433790'], players: ['4433790'], teams: ['9'], first_published_at: b.published_at, last_published_at: b.published_at, first_seen_at: b.published_at, members: [{ item_id: 'b', source_id: 'the_ix', headline: b.headline, published_at: b.published_at, event_type: b.event_type }] }
    }
  };
  const out = assignEvents([a, b], registry, { now: NOW });
  assert.equal(out.clusters.length, 1);
  assert.equal(out.repaired.length, 1);
  assert.equal(out.registry.item_event.a, out.registry.item_event.b);
  assert.equal(out.clusters[0].members.length, 2);
});
