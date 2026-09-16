import test from 'node:test';
import assert from 'node:assert/strict';
import { topStories, storySubjectKey } from '../src/lib/news-ranking.js';

const now = Date.parse('2026-09-16T18:30:00Z');
const card = ({ id, player, team, hours, event = 'injury', kind = 'brief' }) => ({
  id,
  kind,
  desk: event === 'injury' ? 'injury' : event,
  lead_player_id: player,
  lead_team_id: team,
  headline: `${player} ${event} update for team ${team}`,
  first_published_at: new Date(now - hours * 3600e3).toISOString(),
  facts: { brief: { event_type: event } }
});

test('Top Stories never shows two split clusters for the same player injury event', () => {
  const dallas = card({ id: 'azzi-dal', player: '4433409', team: '3', hours: 2 });
  const liberty = card({ id: 'azzi-nyl', player: '4433409', team: '9', hours: 16, event: 'availability' });
  const international = { id: 'world-cup', kind: 'international', headline: 'World Cup final', first_published_at: new Date(now - 30 * 3600e3).toISOString() };
  const transaction = card({ id: 'move', player: '5001', team: '8', hours: 4, event: 'transaction' });

  assert.equal(storySubjectKey(dallas), storySubjectKey(liberty), 'injury and availability normalize to one player event family');
  const top = topStories([dallas, liberty, international, transaction], null, { limit: 4, now });
  assert.equal(top.filter((x) => x.lead_player_id === '4433409').length, 1);
  assert.equal(top.find((x) => x.lead_player_id === '4433409')?.id, 'azzi-dal', 'newer canonical presentation wins');
});

test('different material events for the same player remain eligible', () => {
  const injury = card({ id: 'injury', player: '4433409', team: '3', hours: 2, event: 'injury' });
  const move = card({ id: 'move', player: '4433409', team: '3', hours: 3, event: 'transaction' });
  const top = topStories([injury, move], null, { limit: 3, now });
  assert.deepEqual(top.map((x) => x.id), ['injury', 'move']);
});
