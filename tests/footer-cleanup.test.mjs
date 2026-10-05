import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shellHtml, SHELL_REV } from '../src/ui/shell.js';

const html = String(shellHtml());
const foot = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
const polish = fs.readFileSync(new URL('../src/styles/polish.css', import.meta.url), 'utf8');
const preferred = fs.readFileSync(new URL('../src/styles/preferred-source.css', import.meta.url), 'utf8');

test('WNBA footer separates local research from network trust and legal', () => {
  assert.match(foot, /Research &amp; WNBA Trust/);
  assert.match(foot, /class="foot-global-row"/);
  assert.match(foot, /Editorial &amp; Trust/);
  assert.match(foot, /Company &amp; Legal/);
  assert.match(foot, /https:\/\/propbetedge\.ai\/authors/);
  assert.match(foot, /https:\/\/propbetedge\.ai\/editorial-standards/);
  for (const path of ['about','privacy','terms','legal','support','media']) {
    assert.match(foot, new RegExp(`https:\\\/\\\/propbetedge\\.ai\\/${path}`));
  }
});

test('network column stays product/network-focused', () => {
  const start = foot.indexOf('foot-network-col');
  const end = foot.indexOf('sports-rail', start);
  const network = foot.slice(start, end);
  assert.match(network, /All Access/);
  assert.match(network, /Sports News/);
  assert.match(network, /Learn/);
  assert.match(network, /Store/);
  assert.doesNotMatch(network, /About PropBetEdge|Terms|Legal|Support|Media/);
});

test('trust controls sit together and use stronger dividers', () => {
  assert.match(foot, /class="foot-trust-grid"/);
  assert.match(foot, /data-pbe-preferred-source/);
  assert.match(foot, /class="foot-security"/);
  assert.match(polish, /\.foot-global-row::before/);
  assert.match(polish, /\.foot-global-row section \+ section \{ border-left:/);
  assert.match(polish, /\.foot-trust-grid \{[\s\S]*grid-template-columns:/);
  assert.match(preferred, /\.foot-world \.foot-trust-grid \.pbe-psrc \{ grid-column: auto;/);
});

test('legal note is more readable and shell revision moved', () => {
  assert.match(polish, /\.foot-world \.foot-note \{[\s\S]*font-size: 11\.5px/);
  assert.equal(SHELL_REV, '2026-10-04.1');
});
