import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/player-load.js', import.meta.url), 'utf8');
const view = fs.readFileSync(new URL('../src/views/player-load.js', import.meta.url), 'utf8');

test('Player Load never falls back to a warming-up blank page', () => {
  assert.ok(!page.includes('Player Load is warming up'));
  assert.match(page, /playerLoadExplainer/);
  assert.match(page, /Live board temporarily unavailable/);
  assert.match(page, /Methodology available below/);
});

test('Player Load explainer documents meaning, inputs, bands and limits', () => {
  for (const text of [
    'Workload pressure,',
    'not an injury prediction.',
    '7-day minutes',
    'Schedule density',
    'Recent minutes',
    'Turnaround',
    'Minutes spike',
    'Overtime',
    'LIGHT',
    'NORMAL',
    'ELEVATED',
    'HEAVY',
    'EXTREME',
    'Use it as context, not a pick',
    'Injury status is shown beside Player Load but never changes the score.'
  ]) assert.ok(view.includes(text), `missing explainer copy: ${text}`);
});

test('public Player Load page still sells Pro without hiding methodology', () => {
  assert.match(view, /Get WNBA Pro/);
  assert.match(view, /\$9\.99\/month · \$3\.99\/week/);
  assert.match(view, /playerLoadExplainer\(\)/);
});
