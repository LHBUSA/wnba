// Footer parity with the canonical PropBetEdge family registry (owner decision 2026-10-03).
// src/ui/family.json is vendored verbatim from LHBUSA/propbetedge-workers shared/network/family.json;
// this test fails if src/ui/network.js (the footer's only source) drifts from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NETWORK, CURRENT_SPORT } from '../src/ui/network.js';
import { shellHtml, SHELL_REV } from '../src/ui/shell.js';
import { ALL_ACCESS_URL } from '../src/lib/pbe-membership.js';

const FAMILY = JSON.parse(readFileSync(new URL('../src/ui/family.json', import.meta.url), 'utf8'));
const local = (s) => (s.key === CURRENT_SPORT ? `https://${CURRENT_SPORT}.propbetedge.ai/` : s.href);

test('sports: same set, order and canonical URLs as the family registry (self may be relative)', () => {
  assert.deepEqual(NETWORK.sports.map((s) => s.key), FAMILY.sports.map((s) => s.key));
  assert.deepEqual(NETWORK.sports.map(local), FAMILY.sports.map((s) => s.url));
});

test('Predictions is a separate non-sport product with the canonical URL', () => {
  assert.deepEqual(NETWORK.products.map((p) => [p.key, p.href]), FAMILY.products.map((p) => [p.key, p.url]));
  assert.ok(!NETWORK.sports.some((s) => s.key === 'predictions' || /predictions\./.test(s.href)));
  assert.ok(NETWORK.products.every((p) => p.kind === 'product'));
});

test('network URLs: PropBetEdge home, All Access, Learn', () => {
  const want = Object.fromEntries(FAMILY.network.map((n) => [n.key, n.url]));
  assert.equal(NETWORK.news.href, want.hub);
  assert.equal(ALL_ACCESS_URL, want.all_access);
  assert.equal(NETWORK.learn.href, want.learn);
});

test('rendered footer: exactly one canonical F1 and one Predictions link, no retired hosts, no "11 sports"', () => {
  const doc = String(shellHtml());
  const foot = doc.slice(doc.indexOf('<footer'), doc.indexOf('</footer>'));
  assert.equal((foot.match(/href="https:\/\/f1\.propbetedge\.ai\/"/g) || []).length, 1);
  assert.equal((foot.match(/href="https:\/\/predictions\.propbetedge\.ai\/"/g) || []).length, 1);
  assert.equal((doc.match(/f1\.propbetedge\.ai/g) || []).length, 1);
  assert.equal((doc.match(/predictions\.propbetedge\.ai/g) || []).length, 1);
  const rail = foot.slice(foot.indexOf('sports-rail'), foot.indexOf('foot-intel'));
  assert.ok(!rail.includes('predictions.propbetedge.ai'), 'Predictions never rendered inside the sports rail');
  for (const h of FAMILY.retired_hosts) assert.ok(!doc.includes(h), h);
  assert.ok(!/http:\/\/[^"]*propbetedge\.ai/.test(foot));
  assert.ok(!/\b(11|eleven) sports\b/i.test(doc));
  assert.ok(SHELL_REV >= '2026-10-03.1', 'SHELL_REV moved so clients reconcile the new footer');
});
