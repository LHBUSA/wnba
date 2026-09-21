// The visual leaderboard and the current-edition concept.
// Every value it prints must come from the article's FROZEN board.

import test from 'node:test';
import assert from 'node:assert/strict';

import { winbaIndexLeaderboard, winbaCurrentEditionModule } from '../src/views/winba-leaderboard.js';
import { currentWinbaEdition, isCurrentWinbaEdition } from '../src/views/winba-index.js';

const row = (rank, id, name, team, teamName, score, over = {}) => ({
  rank, player_id: id, player_name: name, team_id: team, team_name: teamName, score,
  position: 'G', games: 40, minutes: 1250,
  averages: { min: 31.5, pts: 19.5, reb: 4.8, ast: 6 },
  components: { production_percentile: 97.4, win_rate: 78, winning_output_share: 79.8, court_share: 77.1 },
  ...over
});

const ROWS = [
  row(1, '4433791', 'Olivia Miles', '8', 'Minnesota Lynx', 87),
  row(2, '3149391', 'Aja Wilson', '17', 'Las Vegas Aces', 85.7),
  row(3, '4433402', 'Angel Reese', '20', 'Atlanta Dream', 82.6),
  row(4, '4065870', 'Jackie Young', '17', 'Las Vegas Aces', 81.8),
  row(5, '4433403', 'Caitlin Clark', '5', 'Indiana Fever', 81.7)
];

const article = (over = {}) => ({
  kind: 'winba_index', period: '2026-09', period_label: 'September 2026',
  winba_board: { period: '2026-09', period_label: 'September 2026', qualified_count: 193, rows: ROWS },
  winba_board_media: [
    { player_id: '4433791', rank: 1, image: { square: '/sq-1.webp', portrait: '/p-1.jpg', podium: '/pod-1.jpg' } },
    { player_id: '3149391', rank: 2, image: { square: '/sq-2.webp', portrait: '/p-2.jpg', podium: '/pod-2.jpg' } },
    { player_id: '4433402', rank: 3, image: null }
  ],
  ...over
});

test('the board renders the podium, the rows and the chart from frozen values', () => {
  const h = String(winbaIndexLeaderboard(article()));
  assert.match(h, /wb-board/);
  assert.match(h, /September 2026 WinBA leaderboard/);
  assert.match(h, /Frozen at publication/);
  assert.match(h, /193 qualified players/);
  assert.match(h, /wb-podium/);
  assert.match(h, /Olivia Miles/);
  assert.match(h, />87</, 'the frozen score is printed, rounded for display');
  assert.match(h, />86</, '85.7 displays as 86');
  assert.match(h, /wb-rows/);
  assert.match(h, /Jackie Young/);
  assert.match(h, /Caitlin Clark/);
  assert.match(h, /wb-chart/);
  assert.match(h, /Top 10 by WinBA Score/);
});

test('every ranked player links to her profile and her team', () => {
  const h = String(winbaIndexLeaderboard(article()));
  for (const r of ROWS) {
    assert.ok(h.includes(`href="/players/${r.player_id}"`), `${r.player_name} links to her profile`);
    assert.ok(h.includes(`href="/teams/${r.team_id}"`), `${r.team_name} links`);
  }
  assert.ok(h.includes('href="/winba-score"'), 'WinBA Score links to the explainer');
});

test('the four published components render from frozen values only', () => {
  const h = String(winbaIndexLeaderboard(article()));
  for (const label of ['Production', 'Win rate', 'Output in wins', 'Court share']) {
    assert.ok(h.includes(label), `${label} component renders`);
  }
  assert.match(h, /width:97\.4%/, 'the production percentile drives its own bar');
  assert.match(h, /width:78%/);
  // A row with no component values renders no component block rather than zeros.
  const noComponents = article({
    winba_board: { ...article().winba_board, rows: [row(1, '1', 'One', '8', 'Lynx', 87, { components: {} })] }
  });
  assert.ok(!String(winbaIndexLeaderboard(noComponents)).includes('Court share'));
});

test('a ranked player without an approved photo still appears, with a fallback', () => {
  const h = String(winbaIndexLeaderboard(article()));
  // Reese has image: null in the media block and is rank 3.
  assert.match(h, /Angel Reese/, 'she is not dropped from the ranking');
  assert.ok(h.includes('href="/players/4433402"'));
  assert.ok(!h.includes('src="null"'));
  assert.ok(h.includes('/pod-1.jpg'), 'the podium cell uses the approved podium crop');
});

test('no movement is invented for a first edition', () => {
  const h = String(winbaIndexLeaderboard(article()));
  assert.match(h, /First edition/);
  assert.ok(!h.includes('wb-move--up'));
  assert.ok(!h.includes('wb-move--down'));
});

test('movement renders only from a real prior frozen edition', () => {
  const withMovement = article({
    winba_movement: {
      from_period: '2026-08',
      moves: [
        { player_id: '4433791', rank: 1, prior_rank: 3, rank_delta: 2, score: 87, prior_score: 80, score_delta: 7 },
        { player_id: '3149391', rank: 2, prior_rank: 1, rank_delta: -1, score: 85.7, prior_score: 88, score_delta: -2.3 },
        { player_id: '4065870', rank: 4, prior_rank: 4, rank_delta: 0, score: 81.8, prior_score: 81, score_delta: 0.8 },
        { player_id: '4433403', rank: 5, prior_rank: null, rank_delta: null, score: 81.7, prior_score: null, score_delta: null }
      ]
    }
  });
  const h = String(winbaIndexLeaderboard(withMovement));
  assert.ok(!h.includes('First edition'));
  assert.match(h, /wb-move--up/);
  assert.match(h, /wb-move--down/);
  assert.match(h, /wb-move--flat/);
  assert.match(h, /Up 2 from No\. 3 in the previous edition/);
  // A player with no prior rank gets no chip rather than a fabricated one.
  const clarkChunk = h.slice(h.indexOf('Caitlin Clark'), h.indexOf('Caitlin Clark') + 500);
  assert.ok(!/wb-move--(up|down|flat)/.test(clarkChunk));
});

test('an article with no frozen board renders no ranking frame at all', () => {
  assert.equal(winbaIndexLeaderboard({ kind: 'winba_index' }), '');
  assert.equal(winbaIndexLeaderboard({ kind: 'winba_index', winba_board: { rows: [] } }), '');
  assert.equal(winbaIndexLeaderboard(null), '');
});

test('the board never reads a live value', () => {
  const frozen = article({
    winba_board: { ...article().winba_board, rows: [row(1, '4433791', 'Olivia Miles', '8', 'Minnesota Lynx', 70)] }
  });
  const h = String(winbaIndexLeaderboard(frozen));
  assert.match(h, />70</);
  assert.ok(!h.includes('>87<'), 'no later value leaks in');
});

// ------------------------------------------------------------ current edition

const ed = (period, id) => ({
  id, slug: `the-winba-index-${period}-abc123`, kind: 'winba_index', status: 'published',
  period, period_label: period, headline: `The WinBA Index: ${period}`,
  first_published_at: `${period}-28T22:00:00.000Z`,
  winba_board: { rows: ROWS.slice(0, 3) }
});

test('the current edition is the latest valid period, not the latest publish time', () => {
  const items = [ed('2026-08', 'a'), ed('2026-10', 'c'), ed('2026-09', 'b')];
  assert.equal(currentWinbaEdition({ data: { items } }).period, '2026-10');
  assert.equal(isCurrentWinbaEdition(ed('2026-10', 'c'), { data: { items } }), true);
  assert.equal(isCurrentWinbaEdition(ed('2026-09', 'b'), { data: { items } }), false);
});

test('a retired edition is never the current edition', () => {
  const items = [ed('2026-09', 'b'), { ...ed('2026-10', 'c'), quality_state: 'retired_from_index' }];
  assert.equal(currentWinbaEdition({ data: { items } }).period, '2026-09');
});

test('with nothing published there is no current edition and no module', () => {
  assert.equal(currentWinbaEdition({ data: { items: [] } }), null);
  assert.equal(winbaCurrentEditionModule(null), '');
});

test('the promotion module names the edition and its frozen top three', () => {
  const h = String(winbaCurrentEditionModule(ed('2026-09', 'b')));
  assert.match(h, /Current edition/);
  assert.match(h, /The WinBA Index/);
  assert.match(h, /2026-09 rankings/);
  assert.match(h, /Olivia Miles/);
  assert.match(h, />87</);
  assert.ok(h.includes('href="/news/the-winba-index-2026-09-abc123"'));
  assert.ok(h.includes('href="/players/4433791"'));
});
