import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerSource } from '../src/lib/brand.js';

test('customer-facing source: provider label becomes PropSports, the authority qualifier is kept verbatim', () => {
  assert.equal(customerSource('ESPN injury feed (provider). Not the league’s official injury report.'), 'PropSports injury feed (provider data). Not the league’s official injury report.');
  assert.equal(customerSource('League official injury report.'), 'League official injury report.', 'other authorities pass through unchanged');
  assert.equal(customerSource(null), '');
});
