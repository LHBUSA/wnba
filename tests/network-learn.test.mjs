// Learn is a first-party PropBetEdge network destination. The publishing Worker (wnba-web) and the
// client both render shellHtml(), so this covers server-rendered and hydrated markup alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NETWORK } from '../src/ui/network.js';
import { shellHtml, SHELL_REV } from '../src/ui/shell.js';

test('network registry carries canonical Learn', () => {
  assert.deepEqual(NETWORK.learn, { label: 'Learn', href: 'https://learn.propbetedge.ai/' });
});

test('PropBetEdge Network footer renders Learn once, same-tab, beside the existing destinations', () => {
  const doc = String(shellHtml());
  const col = doc.slice(doc.indexOf('foot-network-links'), doc.indexOf('sports-rail'));
  assert.match(col, /<li><a href="https:\/\/learn\.propbetedge\.ai\/">Learn<\/a><\/li>/);
  assert.equal((doc.match(/learn\.propbetedge\.ai/g) || []).length, 1);
  for (const s of ['All Access', 'Sports News', 'Store', 'Manage billing', 'Discord']) assert.ok(col.includes(s), s);
  const shellSrc = readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');
  assert.ok(!/learn\.propbetedge\.ai/.test(shellSrc), 'URL lives only in src/ui/network.js');
});

test('SHELL_REV moved past the playoffs shell so clients reconcile the footer before the Worker redeploys', () => {
  assert.notEqual(SHELL_REV, '2026-09-25.1');
});

test('sports rail lists Tennis after UFC, read from the registry, and SHELL_REV moved for it', () => {
  assert.deepEqual(NETWORK.sports.map((s) => s.key), ['mlb', 'nfl', 'nba', 'wnba', 'nhl', 'ufc', 'tennis']);
  assert.deepEqual(NETWORK.sports.at(-1), { key: 'tennis', label: 'Tennis', name: 'Tennis Intelligence', href: 'https://tennis.propbetedge.ai/' });
  const doc = String(shellHtml());
  const rail = doc.slice(doc.indexOf('sports-rail'));
  assert.match(rail, /<a href="https:\/\/tennis\.propbetedge\.ai\/"[^>]*title="Tennis Intelligence">Tennis<\/a>/);
  const shellSrc = readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');
  assert.ok(!/tennis\.propbetedge\.ai/.test(shellSrc), 'URL lives only in src/ui/network.js');
  assert.notEqual(SHELL_REV, '2026-09-26.1');
});
