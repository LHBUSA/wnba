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
  assert.match(h, /Top 10 WinBA rankings/);
  assert.match(h, /Frozen monthly snapshot/);
  assert.match(h, /Live rankings/, 'the live board is one click away');
  assert.match(h, /September 2026/);
  assert.match(h, /193 qualified players/);
  assert.match(h, /wb-podium/);
  assert.match(h, /Olivia Miles/);
  assert.match(h, />87</, 'the frozen score is printed, rounded for display');
  assert.match(h, />86</, '85.7 displays as 86');
  assert.match(h, /wb-rows/);
  assert.match(h, /Jackie Young/);
  assert.match(h, /Caitlin Clark/);
  // The ranking is not repeated a third time as a bar chart; the spread view
  // shows what the ordered list cannot.
  assert.ok(!h.includes('wb-chart'), 'the duplicate top-10 chart is gone');
  // This fixture has five rows, too few for a spread view, so it is omitted.
  assert.ok(!h.includes('wb-spread'));
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

// ---------------------------------------------------------------- team depth

const depthRow = (rank, id, name, team, teamName, score) =>
  row(rank, id, name, team, teamName, score);

// The ACTUAL September 2026 frozen board, as published.
const SEPT_ROWS = [
  depthRow(1, '4433791', "Olivia Miles", '8', "Minnesota Lynx", 87),
  depthRow(2, '3149391', "A'ja Wilson", '17', "Las Vegas Aces", 85.7),
  depthRow(3, '4433402', "Angel Reese", '20', "Atlanta Dream", 82.6),
  depthRow(4, '4065870', "Jackie Young", '17', "Las Vegas Aces", 81.8),
  depthRow(5, '4433403', "Caitlin Clark", '5', "Indiana Fever", 81.6),
  depthRow(6, '3906949', "Jessica Shepard", '3', "Dallas Wings", 81.2),
  depthRow(7, '2529130', "Natasha Howard", '8', "Minnesota Lynx", 81),
  depthRow(8, '3917450', "Napheesa Collier", '8', "Minnesota Lynx", 80.2),
  depthRow(9, '4432831', "Aliyah Boston", '5', "Indiana Fever", 79.6),
  depthRow(10, '2998928', "Breanna Stewart", '9', "New York Liberty", 79.4),
  depthRow(11, '4398911', "Shakira Austin", '16', "Washington Mystics", 78.7),
  depthRow(12, '4433730', "Paige Bueckers", '3', "Dallas Wings", 78.4),
  depthRow(13, '4898384', "Kiki Iriafen", '16', "Washington Mystics", 77.4),
  depthRow(14, '2999101', "Jonquel Jones", '9', "New York Liberty", 77),
  depthRow(15, '2987891', "Courtney Williams", '8', "Minnesota Lynx", 76.8),
  depthRow(16, '4398935', "Veronica Burton", '129689', "Golden State Valkyries", 76.1),
  depthRow(17, '3142191', "Kelsey Mitchell", '5', "Indiana Fever", 75.4),
  depthRow(18, '1054', "Tiffany Hayes", '129689', "Golden State Valkyries", 74.6),
  depthRow(19, '3142328', "Gabby Williams", '129689', "Golden State Valkyries", 73.9),
  depthRow(20, '4790264', "Janelle Salaun", '129689', "Golden State Valkyries", 72.4),
  depthRow(21, '2529458', "Cheyenne Parker-Tyus", '17', "Las Vegas Aces", 72.2),
  depthRow(22, '5108587', "Madina Okot", '20', "Atlanta Dream", 72.2),
  depthRow(23, '3065570', "Kelsey Plum", '6', "Los Angeles Sparks", 72.1),
  depthRow(24, '4280892', "Chennedy Carter", '17', "Las Vegas Aces", 72.1),
  depthRow(25, '3142250', "Jordin Canada", '20', "Atlanta Dream", 71.9)
];
const septArticle = () => article({
  winba_board: { period: '2026-09', period_label: 'September 2026', qualified_count: 193, rows: SEPT_ROWS }
});

test('team depth is computed from the frozen board and ordered deterministically', async () => {
  const { winbaTeamDepthData } = await import('../src/views/winba-leaderboard.js');
  const teams = winbaTeamDepthData(septArticle());
  // Only teams with 2+ ranked players; the single-player team is excluded.
  assert.ok(!teams.some((t) => t.players.length < 2), 'a team with one ranked player is not depth');
  assert.deepEqual(teams.map((t) => [t.team_name, t.players.length]), [
    ['Minnesota Lynx', 4],
    ['Las Vegas Aces', 4],
    ['Golden State Valkyries', 4],
    ['Atlanta Dream', 3],
    ['Indiana Fever', 3],
    ['Dallas Wings', 2],
    ['New York Liberty', 2],
    ['Washington Mystics', 2]
  ]);
  // Within a team, players are listed by rank.
  assert.deepEqual(teams[0].players.map((p) => p.rank), [1, 7, 8, 15]);
  assert.deepEqual(teams[2].players.map((p) => p.rank), [16, 18, 19, 20]);
  // Deterministic across calls.
  assert.deepEqual(winbaTeamDepthData(septArticle()).map((t) => t.team_id), teams.map((t) => t.team_id));
});

test('teams on the same count are presented as equal, not ranked against each other', async () => {
  const { winbaTeamDepth } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaTeamDepth(septArticle()));
  // All three four-player teams carry the same claim.
  assert.equal((h.match(/top-25 players/g) || []).length >= 3, true);
  assert.equal((h.match(/class="is-most"/g) || []).length, 3, 'every team on the top count is marked equally');
  // No ordinal is asserted between them.
  assert.ok(!/No\. 1 in depth|deepest roster/i.test(h));
});

test('the depth section states the period and the board size from frozen data', async () => {
  const { winbaTeamDepth } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaTeamDepth(septArticle()));
  assert.match(h, /Teams with the most top-25 WinBA players/);
  assert.match(h, /September 2026/);
  assert.ok(!h.includes('hardcoded'));
  assert.ok(h.includes('href="/winba-score"'));
});

test('every depth player and team links, with frozen ranks and scores', async () => {
  const { winbaTeamDepth } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaTeamDepth(septArticle()));
  assert.ok(h.includes('href="/teams/8"'));
  assert.ok(h.includes('href="/teams/129689"'), 'an expansion team id links');
  assert.ok(h.includes('href="/players/4433791"'));
  const deep15 = SEPT_ROWS.find((r) => r.rank === 15);
  assert.ok(h.includes(`href="/players/${deep15.player_id}"`), `the rank-15 player ${deep15.player_name} links too`);
  assert.match(h, /#1<\/span>/);
  assert.match(h, /#15<\/span>/);
  assert.match(h, />87</);
  assert.match(h, />77</, 'Courtney Williams 76.8 displays as 77');
});

test('a depth player without an approved photo is still listed', async () => {
  const { winbaTeamDepth } = await import('../src/views/winba-leaderboard.js');
  // Media covers only the first three ids in the fixture.
  const h = String(winbaTeamDepth(septArticle()));
  assert.match(h, /Courtney Williams/);
  assert.ok(!h.includes('src="null"'));
});

test('no depth section when no team has two ranked players', async () => {
  const { winbaTeamDepth, winbaTeamDepthData } = await import('../src/views/winba-leaderboard.js');
  const thin = article({ winba_board: { period_label: 'September 2026', rows: [SEPT_ROWS[0], SEPT_ROWS[1]] } });
  assert.deepEqual(winbaTeamDepthData(thin), []);
  assert.equal(winbaTeamDepth(thin), '');
});

test('the Index aside carries the series instead of a duplicate team list', async () => {
  const { winbaIndexAside } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaIndexAside(septArticle()));
  assert.match(h, /This edition/);
  assert.match(h, /Olivia Miles/);
  assert.ok(h.includes('href="/winba-score"'));
  assert.ok(h.includes('href="/news/winba-index"'));
  assert.equal(winbaIndexAside({ kind: 'winba_index' }), '');
});

// ------------------------------------------------------------- polish pass

test('the ranking is never shown three times', async () => {
  const { winbaIndexLeaderboard } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaIndexLeaderboard(septArticle()));
  // Each top-10 player appears in exactly one of podium/rows, plus the spread
  // bars (which carry no name in text) — never in a third named list.
  const leader = SEPT_ROWS[0].player_name;
  const named = (h.match(new RegExp(leader.replace(/'/g, '&#39;'), 'g')) || []).length;
  // Visible name, the photo link's aria-label, the img alt, and the spread
  // bar's title. Never a second named ranking list.
  assert.ok(named <= 4, `the leader is named ${named} times, expected at most 4`);
  assert.ok(!h.includes('wb-chart'), 'no third ranking list');
});

test('ranks 11-25 are reachable without being heavy', async () => {
  const { winbaIndexLeaderboard } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaIndexLeaderboard(septArticle()));
  assert.match(h, /<details class="wb-more">/);
  assert.match(h, /View ranks 11–25/);
  const r11 = SEPT_ROWS.find((r) => r.rank === 11);
  assert.ok(h.includes(`href="/players/${r11.player_id}"`), 'a rank-11 player links');
  assert.ok(h.includes('wb-more-score'), 'with her frozen score');
});

test('the spread view reports real gaps from the frozen board', async () => {
  const { winbaIndexLeaderboard } = await import('../src/views/winba-leaderboard.js');
  const h = String(winbaIndexLeaderboard(septArticle()));
  const top = Math.round(SEPT_ROWS[0].score);
  const last = Math.round(SEPT_ROWS.at(-1).score);
  assert.ok(h.includes(`${top} → ${last}`), 'the real span is stated');
  assert.match(h, /Biggest single drop/);
  // The podium bars are marked, so the eye finds the top three.
  assert.equal((h.match(/class="is-podium"/g) || []).length, 3);
});

test('a board too short for a spread view simply omits it', async () => {
  const { winbaIndexLeaderboard } = await import('../src/views/winba-leaderboard.js');
  const short = article({ winba_board: { period_label: 'September 2026', rows: SEPT_ROWS.slice(0, 5) } });
  const h = String(winbaIndexLeaderboard(short));
  assert.ok(!h.includes('wb-spread'));
  assert.match(h, /wb-podium/, 'the podium still renders');
});

// -------------------------------------- backfill must not displace September

test('editions published LATER but for EARLIER periods never become current', () => {
  // The backfill scenario: September is live, then June/July/August are
  // published afterwards. Because "current" is period-based, September holds.
  const sep = { ...ed('2026-09', 'sep'), first_published_at: '2026-09-21T20:48:01.908Z' };
  const backfilled = ['2026-06', '2026-07', '2026-08'].map((p) => ({
    ...ed(p, `bf-${p}`),
    // Published today, long after September went live.
    first_published_at: '2026-11-02T10:00:00.000Z',
    historical_backfill: true
  }));
  const items = [...backfilled, sep];
  assert.equal(currentWinbaEdition({ data: { items } }).period, '2026-09');
  assert.equal(isCurrentWinbaEdition(sep, { data: { items } }), true);
  for (const b of backfilled) {
    assert.equal(isCurrentWinbaEdition(b, { data: { items } }), false, `${b.period} must not be current`);
  }
  // And October, when it legitimately arrives, takes over.
  const withOct = { data: { items: [...items, ed('2026-10', 'oct')] } };
  assert.equal(currentWinbaEdition(withOct).period, '2026-10');
  assert.equal(isCurrentWinbaEdition(sep, withOct), false);
});

test('the series orders by period, so a backfill slots in behind September', async () => {
  const { winbaIndexCards, winbaSeriesNav } = await import('../src/views/winba-index.js');
  const items = [
    { ...ed('2026-09', 'sep'), first_published_at: '2026-09-21T20:48:01.908Z' },
    { ...ed('2026-06', 'jun'), first_published_at: '2026-11-02T10:00:00.000Z' },
    { ...ed('2026-07', 'jul'), first_published_at: '2026-11-02T10:05:00.000Z' },
    { ...ed('2026-08', 'aug'), first_published_at: '2026-11-02T10:10:00.000Z' }
  ];
  assert.deepEqual(winbaIndexCards({ data: { items } }).map((c) => c.period), ['2026-09', '2026-08', '2026-07', '2026-06']);
  const nav = winbaSeriesNav(winbaIndexCards({ data: { items } }), '2026-07');
  assert.equal(nav.prev.period, '2026-06');
  assert.equal(nav.next.period, '2026-08');
  assert.equal(winbaSeriesNav(winbaIndexCards({ data: { items } }), '2026-09').next, null, 'September stays the newest');
});
