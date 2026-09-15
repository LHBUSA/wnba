// Desktop navigation structure: primary row + one "More" disclosure, drawer below the desktop breakpoint.
// The publishing Worker and the client both render shellHtml(), so these assertions cover SSR and hydrated markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellHtml, PRIMARY_NAV, SECONDARY_NAV, NAV, NAV_GROUP } from '../src/ui/shell.js';

const doc = String(shellHtml());
const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i + a.length); return i < 0 || j < 0 ? '' : s.slice(i, j); };
const navBlock = between(doc, '<nav class="nav"', '</nav>');
const moreMenu = between(navBlock, 'id="nav-more-menu"', '</div>');
const drawer = between(doc, 'class="drawer-panel"', '</div>\n    </div>');

test('primary desktop nav keeps the high-frequency destinations in order, International included', () => {
  assert.deepEqual(PRIMARY_NAV.map(([, , l]) => l), ['Today', 'PBE Picks', 'WNBACast', 'Props', 'Matchups', 'Players', 'Injuries', 'News', 'International']);
  const order = [...navBlock.matchAll(/<a href="([^"]+)" data-nav="([^"]+)"/g)].map((m) => m[2]);
  assert.deepEqual(order.slice(0, PRIMARY_NAV.length), PRIMARY_NAV.map(([id]) => id));
  assert.ok(!NAV.some(([id, href]) => id === 'world-cup' || href === '/world-cup'), 'World Cup is not a top-level destination');
});

test('secondary destinations live inside one accessible More disclosure', () => {
  assert.deepEqual(SECONDARY_NAV.map(([, , l]) => l), ['Standings', 'Stats', 'Teams', 'Track Record', 'Source status']);
  assert.match(navBlock, /<button class="nav-more-btn" type="button" aria-expanded="false" aria-controls="nav-more-menu" data-more>/);
  assert.match(navBlock, /id="nav-more-menu" hidden>/, 'menu starts closed');
  for (const [id, href] of SECONDARY_NAV) assert.ok(moreMenu.includes(`<a href="${href}" data-nav="${id}">`), `${href} in More menu`);
  for (const [, href] of PRIMARY_NAV) assert.ok(!moreMenu.includes(`href="${href}"`), `${href} not duplicated into More`);
  assert.ok(navBlock.indexOf('data-more-wrap') > navBlock.lastIndexOf(`href="${PRIMARY_NAV.at(-1)[1]}"`), 'More follows the primary row');
});

test('drawer lists every destination plus WNBA Pro; Pro stays outside the nav row', () => {
  for (const [id, href] of NAV) assert.ok(drawer.includes(`<a href="${href}" data-nav="${id}">`), `${href} in drawer`);
  assert.ok(drawer.includes('<a href="/pro" data-nav="pro">WNBA Pro</a>'));
  assert.ok(!navBlock.includes('href="/pro"'));
  assert.match(doc, /<div class="hdr-actions">\s*<a class="btn-pro" href="\/pro"/);
});

test('sub-routes map to their nav group', () => {
  assert.equal(NAV_GROUP.team, 'teams');
  assert.equal(NAV_GROUP.player, 'players');
  assert.equal(NAV_GROUP['intl-competition'], 'international');
  assert.equal(NAV_GROUP['world-cup'], 'international');
});

test('desktop nav never scrolls horizontally or squeezes; tablet hands off to the drawer', () => {
  const navRule = css.match(/\n\.nav\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(navRule, '.nav rule present');
  assert.doesNotMatch(navRule, /overflow-x\s*:\s*(auto|scroll)/);
  assert.doesNotMatch(css, /\.nav::-webkit-scrollbar/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*1480px\)\s*\{\s*\.nav a/);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)\s*\{[^}]*\.nav\s*\{\s*display:\s*none/);
  assert.match(css, /\.nav-more-menu\[hidden\]\s*\{\s*display:\s*none/);
});
