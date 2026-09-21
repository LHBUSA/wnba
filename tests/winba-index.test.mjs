import test from 'node:test';
import assert from 'node:assert/strict';

import {
  freezeWinbaMonthly,
  composeWinbaIndex,
  winbaMovement,
  winbaIndexIdentity,
  winbaIndexHeadline,
  winbaPeriodOf,
  winbaPeriodLabel,
  previousPeriod,
  periodCutoff,
  runWinbaIndex,
  winbaMonthlyKey,
  WINBA_INDEX_VERSION,
  WINBA_INDEX_KIND
} from '../workers/wnba-news/src/winba-index.js';

const SNAP_AT = '2026-09-21T03:17:45.205Z';
const AT = '2026-09-30T22:00:00.000Z';

const mkRow = (id, name, score, teamId, teamName, over = {}) => ({
  athlete_id: id, name, team_id: teamId, score, qualified: true,
  sample: { games: 40, wins: 28, losses: 12, minutes: 1240 },
  averages: { min: 31, pts: 20, reb: 6, ast: 4 },
  components: { production_percentile: 95, win_rate: 70 },
  ...over
});

const SNAP = {
  version: 'winba/1.0.0', season: 2026, generated_at: SNAP_AT,
  qualified_count: 193, provisional_count: 44,
  rows: [
    mkRow('4433791', 'Olivia Miles', 87, '8', 'Minnesota Lynx'),
    mkRow('3149391', "A'ja Wilson", 86, '17', 'Las Vegas Aces'),
    mkRow('4433402', 'Angel Reese', 83, '20', 'Atlanta Dream'),
    mkRow('4065870', 'Jackie Young', 82, '17', 'Las Vegas Aces'),
    mkRow('4433403', 'Caitlin Clark', 82, '5', 'Indiana Fever'),
    mkRow('2001', 'Jessica Shepard', 81, '3', 'Dallas Wings'),
    mkRow('2002', 'Natasha Howard', 81, '8', 'Minnesota Lynx'),
    mkRow('2003', 'Napheesa Collier', 80, '8', 'Minnesota Lynx'),
    mkRow('2004', 'Aliyah Boston', 80, '5', 'Indiana Fever'),
    mkRow('2005', 'Breanna Stewart', 79, '9', 'New York Liberty'),
    mkRow('2006', 'Kelsey Mitchell', 78, '5', 'Indiana Fever'),
    mkRow('2007', 'Courtney Williams', 77, '8', 'Minnesota Lynx'),
    mkRow('1001', 'Bench Player', 40, '5', 'Indiana Fever', { qualified: false })
  ]
};

const PLAYERS = new Map([
  ['4433791', { athlete_id: '4433791', name: 'Olivia Miles', position: 'G', experience_years: 0 }],
  ['3149391', { athlete_id: '3149391', name: "A'ja Wilson", position: 'C', experience_years: 8 }],
  ['4433402', { athlete_id: '4433402', name: 'Angel Reese', position: 'F', experience_years: 2 }],
  ['4065870', { athlete_id: '4065870', name: 'Jackie Young', position: 'G', experience_years: 7 }],
  ['4433403', { athlete_id: '4433403', name: 'Caitlin Clark', position: 'G', experience_years: 3 }],
  ['2001', { athlete_id: '2001', name: 'Jessica Shepard', position: 'F', experience_years: 6 }],
  ['2002', { athlete_id: '2002', name: 'Natasha Howard', position: 'F', experience_years: 11 }],
  ['2003', { athlete_id: '2003', name: 'Napheesa Collier', position: 'F', experience_years: 7 }],
  ['2004', { athlete_id: '2004', name: 'Aliyah Boston', position: 'C', experience_years: 3 }],
  ['2005', { athlete_id: '2005', name: 'Breanna Stewart', position: 'F', experience_years: 9 }],
  ['2006', { athlete_id: '2006', name: 'Kelsey Mitchell', position: 'G', experience_years: 8 }],
  ['2007', { athlete_id: '2007', name: 'Courtney Williams', position: 'G', experience_years: 9 }]
]);
const TEAMS = new Map([
  ['8', { team_id: '8', name: 'Minnesota Lynx', short_name: 'Lynx' }],
  ['17', { team_id: '17', name: 'Las Vegas Aces', short_name: 'Aces' }],
  ['20', { team_id: '20', name: 'Atlanta Dream', short_name: 'Dream' }],
  ['5', { team_id: '5', name: 'Indiana Fever', short_name: 'Fever' }],
  ['3', { team_id: '3', name: 'Dallas Wings', short_name: 'Wings' }],
  ['9', { team_id: '9', name: 'New York Liberty', short_name: 'Liberty' }]
]);

const freeze = (period = '2026-09', snap = SNAP) =>
  freezeWinbaMonthly(snap, { period, playerById: PLAYERS, teamById: TEAMS, at: AT });

// ------------------------------------------------------------------- periods

test('periods and cutoffs are New York calendar months', () => {
  assert.equal(winbaPeriodOf('2026-09-21T20:00:00Z'), '2026-09');
  // 01:00Z on Oct 1 is still September 30 in New York.
  assert.equal(winbaPeriodOf('2026-10-01T01:00:00Z'), '2026-09');
  assert.equal(winbaPeriodLabel('2026-09'), 'September 2026');
  assert.equal(previousPeriod('2026-09'), '2026-08');
  assert.equal(previousPeriod('2026-01'), '2025-12');
  assert.equal(periodCutoff('2026-09'), '2026-10-01T00:00:00.000Z');
  assert.equal(periodCutoff('2026-12'), '2027-01-01T00:00:00.000Z');
});

test('identity is deterministic per period, so a rerun cannot make a second article', async () => {
  const a = await winbaIndexIdentity('2026-09');
  const b = await winbaIndexIdentity('2026-09');
  const c = await winbaIndexIdentity('2026-10');
  assert.equal(a.id, b.id);
  assert.equal(a.slug, b.slug);
  assert.notEqual(a.id, c.id);
  assert.match(a.slug, /^the-winba-index-the-wnbas-top-players-for-september-2026-/);
  assert.equal(winbaIndexHeadline('2026-09'), 'The WinBA Index: the WNBA’s top players for September 2026');
});

// ------------------------------------------------------------ frozen snapshot

test('the frozen board carries correct ids, teams, ranks and scores, and excludes provisional players', () => {
  const f = freeze();
  assert.equal(f.period, '2026-09');
  assert.equal(f.rows.length, 12, 'the unqualified player must not be ranked');
  assert.deepEqual(f.rows.slice(0, 5).map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(f.rows.slice(0, 5).map((r) => r.player_id), ['4433791', '3149391', '4433402', '4065870', '4433403']);
  assert.deepEqual(f.rows.slice(0, 5).map((r) => r.score), [87, 86, 83, 82, 82]);
  const wilson = f.rows[1];
  assert.equal(wilson.team_id, '17');
  assert.equal(wilson.team_name, 'Las Vegas Aces');
  assert.equal(wilson.position, 'C');
  assert.equal(wilson.first_wnba_season, false);
  assert.equal(f.rows[0].first_wnba_season, true);
  assert.equal(f.snapshot_at, SNAP_AT);
  assert.equal(f.frozen_at, AT);
});

test('ties break deterministically, so a rerun produces the same order', () => {
  const a = freeze().rows.map((r) => r.player_id);
  const b = freeze().rows.map((r) => r.player_id);
  assert.deepEqual(a, b);
  // Young and Clark are both 82; the lower athlete id ranks first, every time.
  assert.equal(freeze().rows[3].player_id, '4065870');
});

test('roster attributes are resolved at freeze time, so a later trade cannot rewrite a published Index', () => {
  const f = freeze();
  const traded = new Map(TEAMS);
  traded.set('17', { team_id: '17', name: 'Somewhere Else', short_name: 'Else' });
  // The already-frozen board is unaffected by any later dictionary.
  assert.equal(f.rows[1].team_name, 'Las Vegas Aces');
  const refrozen = freezeWinbaMonthly(SNAP, { period: '2026-09', playerById: PLAYERS, teamById: traded, at: AT });
  assert.equal(refrozen.rows[1].team_name, 'Somewhere Else');
  assert.equal(f.rows[1].team_name, 'Las Vegas Aces', 'the original object must not be mutated');
});

test('no qualified players means no board rather than an empty feature', () => {
  assert.equal(freezeWinbaMonthly({ ...SNAP, rows: [mkRow('1', 'X', 40, '5', 'Fever', { qualified: false })] }, { period: '2026-09' }), null);
  assert.equal(freezeWinbaMonthly(null, { period: '2026-09' }), null);
});

// ------------------------------------------------------------------ movement

test('movement is null without a prior frozen board: no previous rank is ever inferred', () => {
  assert.equal(winbaMovement(freeze(), null), null);
  assert.equal(winbaMovement(freeze(), { rows: [] }), null);
  const a = composeWinbaIndex(freeze(), { movement: null });
  const text = a.body.join(' ');
  assert.match(text, /first WinBA Index/);
  assert.doesNotMatch(text, /up \d+ places|from No\. \d+ in the|moves the other way/i);
});

test('movement between two frozen boards reports real deltas only', () => {
  const august = freezeWinbaMonthly({
    ...SNAP,
    rows: [
      mkRow('3149391', "A'ja Wilson", 84, '17', 'Las Vegas Aces'),
      mkRow('4433402', 'Angel Reese', 82, '20', 'Atlanta Dream'),
      mkRow('4433791', 'Olivia Miles', 78, '8', 'Minnesota Lynx')
    ]
  }, { period: '2026-08', playerById: PLAYERS, teamById: TEAMS, at: '2026-08-31T22:00:00.000Z' });

  const m = winbaMovement(freeze(), august);
  assert.equal(m.from_period, '2026-08');
  assert.equal(m.to_period, '2026-09');
  const miles = m.moves.find((x) => x.player_id === '4433791');
  assert.equal(miles.prior_rank, 3);
  assert.equal(miles.rank, 1);
  assert.equal(miles.rank_delta, 2);
  assert.equal(miles.score_delta, 9);
  assert.equal(m.risers[0].player_id, '4433791');
  // Players with no prior board entry are "entered", never given a fake rank.
  const entered = m.entered.map((x) => x.player_id);
  assert.ok(entered.includes('4065870'));
  assert.ok(entered.includes('4433403'));
  for (const e of m.entered) {
    assert.equal(e.prior_rank, null);
    assert.equal(e.rank_delta, null);
  }
});

test('the movement section only states a delta the frozen boards support', () => {
  const august = freezeWinbaMonthly({
    ...SNAP,
    rows: [
      mkRow('3149391', "A'ja Wilson", 84, '17', 'Las Vegas Aces'),
      mkRow('4433402', 'Angel Reese', 82, '20', 'Atlanta Dream'),
      mkRow('4433791', 'Olivia Miles', 78, '8', 'Minnesota Lynx')
    ]
  }, { period: '2026-08', playerById: PLAYERS, teamById: TEAMS, at: '2026-08-31T22:00:00.000Z' });
  const a = composeWinbaIndex(freeze(), { movement: winbaMovement(freeze(), august) });
  const text = a.body.join(' ');
  assert.match(text, /Olivia Miles is the month’s clearest riser, up 2 places from No\. 3 in the August 2026 Index to No\. 1/);
  assert.match(text, /score moving from 78 to 87/);
});

// ------------------------------------------------------------------- article

test('the feature is grounded: every printed rank, score and team comes from the board', () => {
  const f = freeze();
  const a = composeWinbaIndex(f, { movement: null });
  assert.equal(a.kind, WINBA_INDEX_KIND);
  assert.equal(a.lead_player_id, '4433791');
  assert.equal(a.lead_team_id, '8');
  assert.ok(a.words > 200);
  assert.notEqual(a.headline, a.deck);
  const text = a.body.join(' ');
  for (const r of f.rows) {
    assert.ok(text.includes(r.player_name), `${r.player_name} should appear`);
  }
  assert.match(text, /No\. 1 Olivia Miles, 87 — Minnesota Lynx guard/);
  // The methodology is stated once, from the real formula.
  assert.match(text, /points plus 1\.2 times rebounds plus 1\.5 times assists/);
  assert.match(text, /not a causal estimate of wins added/);
  assert.equal(text.match(/not a causal estimate/g).length, 1, 'the caveat is stated once, not in every section');
});

test('leader cards carry identity-safe links built from real ids, never guessed slugs', () => {
  const a = composeWinbaIndex(freeze(), { movement: null });
  assert.equal(a.leader_cards.length, 10);
  for (const c of a.leader_cards) {
    assert.equal(c.href, `/players/${c.player_id}`);
    assert.equal(c.team_href, `/teams/${c.team_id}`);
    assert.match(c.href, /^\/players\/\d+$/);
    assert.equal(c.delta, null, 'no delta without a prior board');
    assert.ok(PLAYERS.has(c.player_id), 'every card is a resolved roster player');
    assert.equal(PLAYERS.get(c.player_id).name, c.player_name, 'card name must match the roster identity');
  }
  const winba = a.entities.find((e) => e.type === 'metric');
  assert.equal(winba.id, 'winba');
  assert.equal(a.links.winba, '/winba-score');
  assert.equal(a.links.methodology, '/winba-score#how-winba-is-calculated');
});

test('the leaders section is marked for card rendering but keeps readable paragraphs', () => {
  const a = composeWinbaIndex(freeze(), { movement: null });
  const leaders = a.sections.find((s) => s.title === 'The league leaders');
  assert.equal(leaders.render, 'winba_leaders');
  assert.ok(leaders.count >= 5, 'the same facts remain in prose for feeds and assistive tech');
});

test('sections render only when their facts exist', () => {
  const noPositions = new Map([...PLAYERS].map(([k, v]) => [k, { ...v, position: null, experience_years: null }]));
  const f = freezeWinbaMonthly(SNAP, { period: '2026-09', playerById: noPositions, teamById: TEAMS, at: AT });
  const a = composeWinbaIndex(f, { movement: null });
  const titles = a.sections.map((s) => s.title);
  assert.ok(!titles.includes('Who leads each position'));
  assert.ok(!titles.includes('The first-season watch'));
  assert.ok(titles.includes('The league leaders'));
});

// ------------------------------------------------------------- run + idempotency

function harness() {
  const monthly = new Map();
  const articles = new Map();
  let state = null;
  return {
    monthly, articles,
    get state() { return state; },
    io: {
      getMonthly: async (p) => monthly.get(p) || null,
      putMonthly: async (p, v) => { monthly.set(p, v); },
      getIndexState: async () => state,
      putIndexState: async (v) => { state = v; },
      getArticle: async (id) => articles.get(id) || null,
      putArticle: async (a) => { articles.set(a.id, a); }
    }
  };
}

test('one Index per calendar month: twelve cron firings produce one article', async () => {
  const h = harness();
  const results = [];
  for (let i = 0; i < 12; i += 1) {
    results.push(await runWinbaIndex({
      period: '2026-09', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS,
      at: `2026-09-30T${String(10 + i).padStart(2, '0')}:00:00.000Z`, ...h.io
    }));
  }
  assert.equal(results[0].status, 'published');
  assert.ok(results.slice(1).every((r) => r.status === 'already_published'), 'every later run is a no-op');
  assert.equal(h.articles.size, 1);
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
});

test('a rerun preserves published_at and never rewrites history', async () => {
  const h = harness();
  const first = await runWinbaIndex({ period: '2026-09', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS, at: AT, ...h.io });
  const original = h.articles.get(first.id);
  assert.equal(original.published_at, AT);
  assert.equal(original.first_published_at, AT);

  // A month later the live leaderboard has moved. A forced regeneration keeps
  // the original timestamps and the original frozen board.
  const moved = { ...SNAP, generated_at: '2026-10-20T03:00:00.000Z', rows: [mkRow('3149391', "A'ja Wilson", 99, '17', 'Las Vegas Aces')] };
  const again = await runWinbaIndex({
    period: '2026-09', snapshot: moved, playerById: PLAYERS, teamById: TEAMS,
    at: '2026-10-20T04:00:00.000Z', force: true, ...h.io
  });
  const after = h.articles.get(again.id);
  assert.equal(after.published_at, AT, 'published_at is immutable');
  assert.equal(after.first_published_at, AT);
  assert.equal(after.winba_board.rows[0].player_name, 'Olivia Miles', 'the frozen September board is reused, not rebuilt');
  assert.equal(after.winba_board.rows[0].score, 87);
  assert.ok(after.revisions.length >= 1);
});

test('a stored Index keeps its numbers after the live leaderboard changes', async () => {
  const h = harness();
  const res = await runWinbaIndex({ period: '2026-09', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS, at: AT, ...h.io });
  const published = JSON.parse(JSON.stringify(h.articles.get(res.id)));
  await runWinbaIndex({
    period: '2026-10',
    snapshot: { ...SNAP, generated_at: '2026-10-31T03:00:00.000Z', rows: SNAP.rows.map((r) => ({ ...r, score: r.athlete_id === '3149391' ? 95 : r.score === 87 ? 70 : r.score })) },
    playerById: PLAYERS, teamById: TEAMS, at: '2026-10-31T22:00:00.000Z', ...h.io
  });
  assert.equal(h.articles.size, 2);
  const september = h.articles.get(res.id);
  assert.deepEqual(september.winba_board.rows.map((r) => r.score), published.winba_board.rows.map((r) => r.score));
  assert.match(september.body.join(' '), /Olivia Miles leads September 2026 so far at the top/);
});

test('the October Index links back to September and measures movement against it', async () => {
  const h = harness();
  await runWinbaIndex({ period: '2026-09', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS, at: AT, ...h.io });
  const oct = await runWinbaIndex({
    period: '2026-10',
    snapshot: { ...SNAP, generated_at: '2026-10-31T03:00:00.000Z', rows: SNAP.rows.map((r) => ({
      ...r,
      score: r.athlete_id === '3149391' ? 90 : r.athlete_id === '4433791' ? 85 : r.athlete_id === '4433402' ? 84 : r.score
    })) },
    playerById: PLAYERS, teamById: TEAMS, at: '2026-10-31T22:00:00.000Z', ...h.io
  });
  const a = h.articles.get(oct.id);
  assert.equal(oct.movement, true);
  assert.equal(a.prior_index.period, '2026-09');
  assert.match(a.prior_index.slug, /september-2026/);
  assert.match(a.body.join(' '), /September 2026/);
  assert.equal(a.winba_movement.from_period, '2026-09');
});

test('a board too thin to support a feature is held, not padded', async () => {
  const h = harness();
  const thin = { ...SNAP, qualified_count: 1, rows: [mkRow('4433791', 'Olivia Miles', 87, '8', 'Minnesota Lynx')] };
  const res = await runWinbaIndex({ period: '2026-09', snapshot: thin, playerById: PLAYERS, teamById: TEAMS, at: AT, ...h.io });
  assert.equal(res.status, 'held_thin');
  assert.equal(h.articles.size, 0);
});

test('no snapshot means no article', async () => {
  const h = harness();
  const res = await runWinbaIndex({ period: '2026-09', snapshot: null, playerById: PLAYERS, teamById: TEAMS, at: AT, ...h.io });
  assert.equal(res.status, 'no_snapshot');
  assert.equal(h.articles.size, 0);
});

test('the monthly KV key is the period, which is what makes storage idempotent', () => {
  assert.equal(winbaMonthlyKey('2026-09'), 'winba:v1:monthly:2026-09');
  assert.equal(WINBA_INDEX_VERSION, 'wnba-winba-index/1.0.0');
});


test('a mid-month board never claims the month finished', () => {
  const mid = freezeWinbaMonthly(SNAP, { period: '2026-09', playerById: PLAYERS, teamById: TEAMS, at: '2026-09-21T20:40:00.000Z' });
  assert.equal(mid.period_complete, false);
  const a = composeWinbaIndex(mid, { movement: null });
  const text = a.body.join(' ');
  assert.match(text, /leads September 2026 so far/);
  assert.doesNotMatch(text, /finishes September 2026/);
  assert.match(text, /with September 2026 still being played/);
});

test('a board frozen after the month closes reports it as finished', () => {
  const closed = freezeWinbaMonthly(SNAP, { period: '2026-09', playerById: PLAYERS, teamById: TEAMS, at: '2026-10-01T12:00:00.000Z' });
  assert.equal(closed.period_complete, true);
  const text = composeWinbaIndex(closed, { movement: null }).body.join(' ');
  assert.match(text, /finishes September 2026 at the top/);
  assert.doesNotMatch(text, /still being played/);
});


// The renderer prints only paragraphs a section covers. A lede outside every
// section is therefore invisible on the page while still present in the API —
// which is exactly how the first published Index lost its opening three
// paragraphs. The contract is that sections cover the whole body.
test('every body paragraph is covered by a section, so none can be dropped', () => {
  const a = composeWinbaIndex(freeze(), { movement: null });
  assert.equal(a.sections[0].first, 0, 'the lede must open the first section');
  const covered = new Set();
  for (const s of a.sections) for (let i = s.first; i < s.first + s.count; i += 1) covered.add(i);
  const missing = a.body.map((_, i) => i).filter((i) => !covered.has(i));
  assert.deepEqual(missing, [], `body paragraphs outside every section: ${missing.join(', ')}`);
  // The lede section is untitled, so no heading is printed above it.
  assert.equal(a.sections[0].title, null);
  assert.equal(a.sections[0].key, 'lede');
});

test('the lede survives rendering', async () => {
  const { articleView } = await import('../src/views/article.js');
  const a = composeWinbaIndex(freeze(), { movement: null });
  const html = String(articleView({ article: { ...a, id: 'x', slug: 's', media: null, method: [], published_at: AT, first_published_at: AT }, related: [] }));
  assert.ok(html.includes('at the top of'), 'the lede sentence renders');
  assert.ok(html.includes('association-with-winning index'), 'the methodology paragraph renders');
  assert.ok(html.includes('The league leaders'), 'the sectioned copy still renders');
});


// ------------------------------------------------- leaderboard integration

test('the leaderboard points at the newest published Index and survives having none', async () => {
  const { latestWinbaIndex } = await import('../src/views/winba-score.js');
  assert.equal(latestWinbaIndex(null), null);
  assert.equal(latestWinbaIndex({ data: { items: [] } }), null);
  const items = [
    { kind: 'winba_index', status: 'published', period: '2026-08', slug: 'aug', headline: 'August' },
    { kind: 'winba_index', status: 'published', period: '2026-09', slug: 'sep', headline: 'September' },
    { kind: 'injury', status: 'published', slug: 'other' },
    { kind: 'winba_index', status: 'published', period: '2026-10', slug: 'oct-retired', quality_state: 'retired_from_index' }
  ];
  const latest = latestWinbaIndex({ data: { items } });
  assert.equal(latest.slug, 'sep', 'newest by period, ignoring a retired one');
});


test('a regeneration records revised_at while published_at never moves', async () => {
  const h = harness();
  const first = await runWinbaIndex({ period: '2026-09', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS, at: AT, ...h.io });
  assert.equal(h.articles.get(first.id).revised_at, null, 'a first publication is not a revision');
  const again = await runWinbaIndex({
    period: '2026-09', snapshot: SNAP, playerById: PLAYERS, teamById: TEAMS,
    at: '2026-10-02T09:00:00.000Z', force: true, ...h.io
  });
  const a = h.articles.get(again.id);
  assert.equal(a.published_at, AT);
  assert.equal(a.first_published_at, AT);
  assert.equal(a.revised_at, '2026-10-02T09:00:00.000Z');
});
