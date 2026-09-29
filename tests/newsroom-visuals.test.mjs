// Newsroom data visuals on the frozen contract (wnba-visuals/1.2.0, wnba-newsroom-visuals/1.0.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupedBars, divergingBars, gameStrip, statCompare, visualFailures, valuesHash } from '../workers/wnba-news/src/visuals.js';
import { attachNewsroomVisuals } from '../workers/wnba-news/src/newsroom-visuals.js';
import { factNumbers } from '../workers/wnba-news/src/gate.js';
import { editorialVisual, sectionVisual } from '../src/views/visuals.js';
import { articleAnalytics } from '../src/views/article-analytics.js';
import { draftSections, applyRewrite } from '../workers/wnba-news/src/editorial-desk.js';
import { sectionKey } from '../workers/wnba-news/src/depth.js';

const P = { source: 'ESPN box score', observed_at: '2026-09-28T03:00:00Z', game_id: 'g1' };
const GB = () => groupedBars({ id: 'game-flow', title: 'Scoring by quarter', unit: 'points', series: [{ key: 'w', label: 'Aces' }, { key: 'l', label: 'Fever' }], rows: [{ key: 'q1', label: 'Q1', values: [27, 23], delta: 4 }, { key: 'q2', label: 'Q2', values: [35, 24], delta: 11 }], provenance: P });

test('each new type builds a valid, hashed, provenance-carrying spec', () => {
  const specs = [
    GB(),
    divergingBars({ id: 'vs-line', title: 'Against the total', rows: [{ key: 'a', label: 'Sep 1', value: -6.5 }, { key: 'b', label: 'Sep 3', value: 4 }], provenance: P }),
    gameStrip({ id: 'form', title: 'Last five', strips: [{ key: 't', label: 'Aces', items: [{ key: '1', label: 'Sep 1 vs SEA', result: 'W', value: 12 }, { key: '2', label: 'Sep 3 at PHX', result: 'L', value: -3 }] }], provenance: P }),
    statCompare({ id: 'line', title: 'Baselines', columns: [{ key: 'g', label: 'Game 1', sample: 1 }, { key: 's', label: 'Season', sample: 42 }], rows: [{ key: 'pts', label: 'Points', unit: 'per_game', values: [38, 25.8] }, { key: 'min', label: 'Minutes', unit: 'minutes', values: [35, 31.6] }], provenance: P })
  ];
  for (const s of specs) {
    assert.deepEqual(visualFailures(s), [], s.id);
    assert.equal(s.values_hash, valuesHash(s));
    assert.equal(s.provenance.renderer, 'pbe-visual/1.2.0');
    const htmlOut = String(editorialVisual(s));
    assert.match(htmlOut, /Show the numbers in this figure/);
    assert.match(htmlOut, /<table class="pv-table">/);
    assert.match(htmlOut, /payload [0-9a-f]{16}/);
    assert.doesNotMatch(htmlOut, /could not be verified/);
  }
});

test('a tampered payload is not drawn; a derived margin must be the arithmetic of the plotted values', () => {
  const s = GB();
  const tampered = { ...s, rows: s.rows.map((r) => (r.key === 'q2' ? { ...r, values: [36, 24] } : r)) };
  assert.match(String(editorialVisual(tampered)), /could not be verified/);
  const lying = groupedBars({ id: 'game-flow', title: 'x', unit: 'points', series: [{ key: 'w', label: 'A' }, { key: 'l', label: 'B' }], rows: [{ key: 'q1', label: 'Q1', values: [27, 23], delta: 9 }, { key: 'q2', label: 'Q2', values: [1, 1], delta: 0 }], provenance: P });
  assert.ok(visualFailures(lying).some((f) => /delta 9 is not 27 − 23/.test(f)));
});

test('missing values never plot as zero; a comparison needs two real values; units bound values', () => {
  const nullRow = groupedBars({ id: 'x', title: 'x', unit: 'points', series: [{ key: 'a', label: 'A' }], rows: [{ key: 'r1', label: 'R1', values: [null] }, { key: 'r2', label: 'R2', values: [3] }], provenance: P });
  assert.ok(visualFailures(nullRow).some((f) => /missing value/.test(f)));
  const thin = statCompare({ id: 'y', title: 'y', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ key: 'p', label: 'P', unit: 'per_game', values: [3, null] }, { key: 'q', label: 'Q', unit: 'per_game', values: [3, 4] }], provenance: P });
  assert.ok(visualFailures(thin).some((f) => /compares fewer than two values/.test(f)));
  const out = statCompare({ id: 'z', title: 'z', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ key: 'p', label: 'P', unit: 'percent', values: [140, 40] }, { key: 'q', label: 'Q', unit: 'per_game', values: [3, 4] }], provenance: P });
  assert.ok(visualFailures(out).some((f) => /outside the percent domain/.test(f)));
  const strip = gameStrip({ id: 's', title: 's', strips: [{ key: 't', label: 'T', items: [{ key: '1', label: 'a', result: 'X' }, { key: '2', label: 'b', result: 'W' }] }], provenance: P });
  assert.ok(visualFailures(strip).some((f) => /unknown result/.test(f)));
});

// ---------------------------------------------------------------- the builder, from a frozen result packet

const RESULT = () => ({
  id: 'abc123def456', kind: 'performance', primary_subject: 'Aces', lead_team_id: '17', lead_player_id: '3149391', updated_at: '2026-09-28T03:05:00Z',
  context: { game: { game_id: '401918015', start_utc: '2026-09-27T20:00Z', home: { team_id: '17', abbr: 'LV', short_name: 'Aces', score: 102, winner: true }, away: { team_id: '5', abbr: 'IND', short_name: 'Fever', score: 85, winner: false } } },
  sections: [{ title: 'Game story', first: 0, count: 1 }, { title: 'Who stood out', first: 1, count: 1 }, { title: 'How it happened', first: 2, count: 1 }, { title: 'What it means', first: 3, count: 1 }],
  body: ['a', 'b', 'c', 'd'],
  evidence: [{ kind: 'record', source: 'ESPN box score', captured_at: '2026-09-28T03:00:00Z' }],
  facts: {
    playoff: { game_number: 1 },
    quarters: [{ label: 'Q1', w: 27, l: 23 }, { label: 'Q2', w: 35, l: 24 }, { label: 'Q3', w: 24, l: 18 }, { label: 'Q4', w: 16, l: 20 }],
    team_stats: { w: { fieldGoalPct: '59', threePointFieldGoalPct: '47', freeThrowPct: '80', totalRebounds: '31', offensiveRebounds: '5', assists: '24', totalTurnovers: '17', pointsInPaint: '48', turnoverPoints: '18', fastBreakPoints: '9' }, l: { fieldGoalPct: '45', threePointFieldGoalPct: '39', freeThrowPct: '79', totalRebounds: '24', offensiveRebounds: '6', assists: '20', totalTurnovers: '17', pointsInPaint: '40', turnoverPoints: '28', fastBreakPoints: '10' } },
    derived: { bench_w: 21, bench_l: 33 },
    stars: [{ athlete_id: '3149391', name: "A'ja Wilson", pts: 38, reb: 16, ast: 2, min: 35, winba: { qualified: true, score: 86.3, rank: 2, generated_at: '2026-09-28T03:07:20Z', components: { production_percentile: 100, win_rate: 73.8, winning_output_share: 75, court_share: 79 } } }],
    comparisons: [{ athlete_id: '3149391', name: "A'ja Wilson", stat: 'pts', entering_line: { games: 42, pts: 25.8, reb: 9.2, ast: 3.2, min: 31.6 }, last10_line: { games: 10, pts: 25.9, reb: 8, ast: 3.6, min: 31.6 } }]
  }
});

test('a result packet yields game flow, team separators, player baselines and dated WinBA context, placed by section', () => {
  const a = RESULT();
  assert.deepEqual(attachNewsroomVisuals(a), []);
  assert.deepEqual(a.visuals.map((v) => v.id), ['game-flow', 'team-separators', 'player-line', 'winba-context']);
  assert.deepEqual(a.sections[2].visuals, ['game-flow', 'team-separators']);
  assert.deepEqual(a.sections[1].visuals, ['player-line', 'winba-context']);
  const sep = a.visuals.find((v) => v.id === 'team-separators');
  assert.ok(sep.rows.length >= 3 && sep.rows.length <= 5, 'selected, not dumped');
  assert.ok(!sep.rows.some((r) => r.key === 'tov'), 'equal turnovers do not separate anything');
  assert.match(a.visuals.find((v) => v.id === 'winba-context').caption, /regular season.*dated Sep 27.*does not include any playoff game/);
  // every plotted number is in the frozen facts (or the game context), or is arithmetic the spec declares (margin)
  const allowed = factNumbers([a.facts, a.context]);
  for (const v of a.visuals) {
    const nums = [...(v.rows || []).flatMap((r) => r.values || [r.value]), ...(v.total !== undefined ? [v.total] : [])].filter((x) => x !== null && x !== undefined);
    for (const x of nums) assert.ok(allowed.has(String(x)), `${v.id} plots ${x}, which is not in the fact packet`);
  }
});

test('the rendered article draws contract visuals beside their sections and retires the legacy dashboard', () => {
  const a = RESULT();
  attachNewsroomVisuals(a);
  assert.match(String(sectionVisual(a, a.sections[2])), /data-visual="game-flow"[\s\S]*data-visual="team-separators"/);
  assert.equal(String(articleAnalytics(a)), '', 'legacy render-time dashboard is not drawn over contract visuals');
  const old = RESULT();
  assert.notEqual(String(articleAnalytics(old)), '', 'a story published before contract visuals keeps its legacy dashboard');
});

test('the editorial desk keeps chart placement: a rewrite never moves or drops a chart', () => {
  const a = RESULT();
  attachNewsroomVisuals(a);
  const secs = draftSections(a, sectionKey);
  const out = { headline: 'h', deck: 'd', sections: secs.map((s) => ({ key: s.key, title: `${s.title || 'x'} rewritten`, paragraphs: s.paragraphs })) };
  const r = applyRewrite(a, secs, out);
  assert.deepEqual(r.sections.map((s) => s.visuals || null), a.sections.map((s) => s.visuals || null));
  assert.deepEqual(r.visuals, a.visuals);
});

test('thin facts build no chart: a meaningless chart is worse than none', () => {
  const a = RESULT();
  a.facts.quarters = a.facts.quarters.slice(0, 2);
  a.facts.team_stats = { w: {}, l: {} };
  a.facts.comparisons = [];
  a.facts.stars = [];
  attachNewsroomVisuals(a);
  assert.deepEqual(a.visuals, []);
});
