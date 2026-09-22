// The editorial chart contract: a published figure is frozen, self-verifying and
// honestly scaled, or it does not publish and does not draw.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lineSeries, componentBars, rankCards, resumeCard, paddedAxis,
  visualFailures, visualsFailures, visualIntact, valuesHash
} from '../workers/wnba-news/src/visuals.js';
import { editorialVisual, sectionVisual } from '../src/views/visuals.js';

const PROV = { source: 'PropBetEdge frozen WinBA monthly snapshots', metric: 'winba/1.0.0', observed_at: '2026-09-21T03:17:45.205Z' };
const PT = (period, value, rank, hash) => ({ period, label: `${period} label`, short_label: period, value, rank, snapshot_at: `${period}-01T00:00:00.000Z`, source_hash: hash });
const CLIMB = () => lineSeries({
  id: 'climb', title: 'A climb', entity: { type: 'player', id: '4433402', name: 'Angel Reese', team_id: '20' },
  points: [PT('2026-06', 80, 6, 'aaaa'), PT('2026-07', 80.2, 6, 'bbbb'), PT('2026-08', 81.6, 4, 'cccc'), PT('2026-09', 82.6, 3, 'dddd')],
  provenance: PROV
});
const BARS = () => componentBars({
  id: 'bars', title: 'Components', entity: { type: 'player', id: '4433402', name: 'Angel Reese' }, total: 82.6,
  rows: [
    { key: 'production_percentile', label: 'Production percentile', unit: 'percentile', weight: 45, value: 98.4 },
    { key: 'win_rate', label: 'Win rate', unit: 'percent', weight: 25, value: 66.7 },
    { key: 'court_share', label: 'Court share', unit: 'percent', weight: 10, value: 77 }
  ],
  provenance: PROV
});

test('a built visual validates and is intact', () => {
  for (const v of [CLIMB(), BARS()]) {
    assert.deepEqual(visualFailures(v), [], `${v.id}: ${visualFailures(v).join('; ')}`);
    assert.equal(visualIntact(v), true);
  }
});

test('editing a plotted value breaks the hash, and the renderer refuses to draw it', () => {
  const v = CLIMB();
  const tampered = { ...v, series: v.series.map((p) => (p.key === '2026-09' ? { ...p, value: 99 } : p)) };
  assert.equal(visualIntact(tampered), false);
  assert.match(visualFailures(tampered).join(' '), /values_hash .* does not match/);
  const html = String(editorialVisual(tampered));
  assert.match(html, /could not be verified/);
  assert.doesNotMatch(html, /<svg/, 'a figure that cannot be verified is not drawn');
  assert.doesNotMatch(html, /99/, 'and the unverified value is not printed either');
});

test('the hash covers the values and not the prose', () => {
  const v = CLIMB();
  const reworded = { ...v, title: 'A different title', caption: 'different caption' };
  assert.equal(valuesHash(reworded), v.values_hash, 'a caption fix does not invalidate a chart');
  const rerank = { ...v, series: v.series.map((p) => ({ ...p, rank: 1 })) };
  assert.notEqual(valuesHash(rerank), v.values_hash, 'an annotation that states a rank is data');
});

test('the axis may not be truncated to dramatise small movement', () => {
  // Wilson's real four months: a two-point drop that must not read as a collapse.
  const a = paddedAxis([87.1, 86.6, 85.1, 85.7]);
  assert.ok(a.max - a.min >= 8, `span ${a.max - a.min}`);
  assert.ok((87.1 - 85.1) / (a.max - a.min) <= 0.5, 'the plotted range fills at most half the frame');
  assert.ok(a.min <= 85.1 && a.max >= 87.1, 'and it contains every value');
  assert.deepEqual(a.ticks.map((t) => t % 1), [0, 0, 0, 0, 0], 'gridlines land on whole numbers');
});

test('a hand-tightened axis is rejected even when it contains the values', () => {
  const v = CLIMB();
  const tight = { ...v, axis: { ...v.axis, min: 79, max: 83 } };
  assert.match(visualFailures(tight).join(' '), /axis span 4 is too tight/);
  const clipped = { ...v, axis: { ...v.axis, min: 81, max: 91 } };
  assert.match(visualFailures(clipped).join(' '), /axis does not contain every plotted value/);
});

test('a missing value is refused, never plotted as zero', () => {
  const v = lineSeries({
    id: 'gap', title: 'Gap', entity: { type: 'player', id: '1', name: 'X' },
    points: [PT('2026-06', 80, 6, 'a'), { ...PT('2026-07', null, 6, 'b'), value: null }],
    provenance: PROV
  });
  assert.equal(v.series[1].value, null, 'null stays null');
  assert.match(visualFailures(v).join(' '), /has no value \(a missing value must not plot as zero\)/);
  // The same for an empty string and for undefined, which both coerce to 0.
  for (const bad of ['', undefined]) {
    const b = componentBars({ id: 'b', title: 'B', entity: { type: 'player', id: '1', name: 'X' }, total: 80, rows: [{ key: 'a', label: 'A', unit: 'percent', value: bad }, { key: 'c', label: 'C', unit: 'percent', value: 50 }], provenance: PROV });
    assert.match(visualFailures(b).join(' '), /component a has no value/);
  }
});

test('every plotted value must name the frozen snapshot it came from', () => {
  const v = lineSeries({
    id: 'unsourced', title: 'Unsourced', entity: { type: 'player', id: '1', name: 'X' },
    points: [{ period: '2026-06', label: 'June', value: 80, rank: 6, snapshot_at: '2026-07-01T00:00:00.000Z' }, PT('2026-07', 81, 5, 'b')],
    provenance: PROV
  });
  assert.match(visualFailures(v).join(' '), /has no source_hash/);
});

test('provenance is mandatory and must be a real observation time', () => {
  const v = CLIMB();
  assert.match(visualFailures({ ...v, provenance: { renderer: v.provenance.renderer, source: 'x' } }).join(' '), /observed_at is not a timestamp/);
  assert.match(visualFailures({ ...v, provenance: { ...v.provenance, source: '' } }).join(' '), /no provenance.source/);
  assert.match(visualFailures({ ...v, provenance: { ...v.provenance, renderer: 'someone-elses/1.0.0' } }).join(' '), /not this renderer/);
});

test('the writer may not smuggle markup into a spec', () => {
  const v = { ...CLIMB(), title: 'A <svg><rect/></svg> title' };
  assert.match(visualFailures(v).join(' '), /contains markup; the renderer owns markup/);
});

test('an unknown type never publishes and never draws', () => {
  const v = { ...CLIMB(), type: 'sankey' };
  assert.match(visualFailures(v).join(' '), /unknown type/);
  assert.equal(String(editorialVisual(v)), '');
});

test('a component value outside its declared unit domain is refused', () => {
  const v = BARS();
  const bad = { ...v, rows: v.rows.map((r) => (r.key === 'win_rate' ? { ...r, value: 140 } : r)) };
  assert.match(visualFailures({ ...bad, values_hash: valuesHash(bad) }).join(' '), /value 140 is outside its unit domain/);
});

test('a context card must link to the canonical profile', () => {
  const v = rankCards({
    id: 'top3', title: 'Top three', provenance: PROV,
    cards: [
      { rank: 1, value: 87, entity: { id: '4433791', name: 'Olivia Miles', team_id: '8', team_name: 'Minnesota Lynx' } },
      { rank: 2, value: 85.7, entity: { id: '3149391', name: "A'ja Wilson", team_id: '17', team_name: 'Las Vegas Aces' } }
    ]
  });
  assert.deepEqual(visualFailures(v), []);
  assert.equal(v.cards[0].href, '/players/4433791');
  const hijacked = { ...v, cards: v.cards.map((c, i) => (i === 0 ? { ...c, href: 'https://example.com' } : c)) };
  assert.match(visualFailures(hijacked).join(' '), /does not link to its canonical profile/);
});

test('a résumé line must declare its window and its source', () => {
  const ok = resumeCard({
    id: 'resume', title: 'Résumé', entity: { type: 'player', id: '3149391', name: "A'ja Wilson" },
    honours: [{ key: 'mvp', count: 4, label: 'WNBA MVP' }],
    lines: [{ key: 'season', label: '2026', window: '39 appearances', source: 'PropBetEdge', stats: [{ key: 'pts', label: 'PPG', value: 26.2 }] }],
    provenance: PROV
  });
  assert.deepEqual(visualFailures(ok), []);
  const noSource = { ...ok, lines: [{ ...ok.lines[0], source: '' }] };
  assert.match(visualFailures(noSource).join(' '), /does not declare its source/);
  const noWindow = { ...ok, lines: [{ ...ok.lines[0], window: '' }] };
  assert.match(visualFailures(noWindow).join(' '), /does not declare its window/);
  const noCount = { ...ok, honours: [{ key: 'mvp', count: null, label: 'WNBA MVP' }] };
  assert.match(visualFailures({ ...noCount, values_hash: valuesHash(noCount) }).join(' '), /honour mvp has no count/);
});

test('duplicate visual ids are refused: a section addresses a figure by id', () => {
  assert.match(visualsFailures([CLIMB(), CLIMB()]).join(' '), /duplicate ids/);
  assert.deepEqual(visualsFailures(null), []);
  assert.deepEqual(visualsFailures([CLIMB(), BARS()]), []);
});

test('the renderer server-renders the figure, its provenance and its data', () => {
  const html = String(editorialVisual(CLIMB()));
  assert.match(html, /<svg[^>]+role="img"/);
  assert.match(html, /aria-label="A climb\./, 'the whole series is read out for assistive technology');
  assert.match(html, /82\.6/, 'the values are in the first response');
  assert.match(html, /No\. 3/);
  assert.match(html, /<table class="pv-table"/, 'and are also a real table');
  assert.match(html, /payload [0-9a-f]{16}/, 'with the payload hash on the page');
  assert.match(html, /dddd/, 'and each point names its snapshot');
  assert.doesNotMatch(html, /<script/);
});

test('bars, cards and résumés all render server-side with their units', () => {
  const bars = String(editorialVisual(BARS()));
  assert.match(bars, /98\.4/);
  assert.match(bars, /66\.7%/, 'a percentage carries its sign');
  assert.match(bars, /width:98\.4%/, 'and the bar is drawn from the value');
  assert.match(bars, /45% of the score/, 'with the weight it carries');
});

test('a section only draws the figure it names', () => {
  const a = { visuals: [CLIMB(), BARS()] };
  assert.match(String(sectionVisual(a, { visual: 'bars' })), /Components/);
  assert.equal(String(sectionVisual(a, { visual: 'nope' })), '');
  assert.equal(String(sectionVisual(a, {})), '');
});
