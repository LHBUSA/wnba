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

test('primary desktop nav keeps only the highest-frequency destinations', () => {
  assert.deepEqual(PRIMARY_NAV.map(([, , l]) => l), ['Today', 'PBE Picks', 'WNBACast', 'Props', 'Matchups', 'News']);
  const order = [...navBlock.matchAll(/<a href="([^"]+)" data-nav="([^"]+)"/g)].map((m) => m[2]);
  assert.deepEqual(order.slice(0, PRIMARY_NAV.length), PRIMARY_NAV.map(([id]) => id));
  assert.ok(!NAV.some(([id, href]) => id === 'world-cup' || href === '/world-cup'), 'World Cup is not a top-level destination');
  assert.ok(!NAV.some(([id, href]) => id === 'sources' || href === '/sources'), 'Source status is not a product-navigation destination');
});

test('secondary destinations live inside one accessible More disclosure', () => {
  assert.deepEqual(SECONDARY_NAV.map(([, , l]) => l), ['Daily Brief · FREE', 'Injuries', 'Players', 'Player Load', 'International', 'History', 'Standings', 'Stats', 'WinBA Score', 'Teams', 'Track Record']);
  assert.match(navBlock, /<button class="nav-more-btn" type="button" aria-expanded="false" aria-controls="nav-more-menu" data-more>/);
  assert.match(navBlock, /id="nav-more-menu" hidden>/, 'menu starts closed');
  for (const [id, href] of SECONDARY_NAV) assert.ok(moreMenu.includes(`<a href="${href}" data-nav="${id}">`), `${href} in More menu`);
  for (const [, href] of PRIMARY_NAV) assert.ok(!moreMenu.includes(`href="${href}"`), `${href} not duplicated into More`);
  assert.ok(navBlock.indexOf('data-more-wrap') > navBlock.lastIndexOf(`href="${PRIMARY_NAV.at(-1)[1]}"`), 'More follows the primary row');
});

test('drawer opens with ALL ACCESS, then every destination plus WNBA Pro; Pro and All Access stay outside the nav row', () => {
  for (const [id, href] of NAV) assert.ok(drawer.includes(`<a href="${href}" data-nav="${id}">`), `${href} in drawer`);
  assert.ok(drawer.includes('<a href="/pro" data-nav="pro">WNBA Pro</a>'));
  const drawerAA = drawer.indexOf('<a class="drawer-aa" href="https://propbetedge.ai/pro" data-nav="all-access"');
  assert.ok(drawerAA >= 0, 'All Access is the drawer\'s first row');
  assert.ok(drawerAA < drawer.indexOf(`<a href="${NAV[0][1]}" data-nav="${NAV[0][0]}">`), 'All Access precedes every destination in the drawer');
  assert.ok(!navBlock.includes('href="/pro"'));
  assert.ok(!navBlock.includes('propbetedge.ai/pro'), 'All Access is a header action, not a nav-row item');
  assert.ok(!moreMenu.includes('propbetedge.ai/pro'), 'All Access is never buried in More');
  assert.match(doc, /<div class="hdr-actions">\s*<a class="btn-aa" href="https:\/\/propbetedge\.ai\/pro" data-nav="all-access"[^>]*>ALL ACCESS<\/a>\s*<a class="btn-pro" href="\/pro"/, 'ALL ACCESS is the first header action, WNBA Pro beside it');
});

test('sub-routes map to their nav group', () => {
  assert.equal(NAV_GROUP.team, 'teams');
  assert.equal(NAV_GROUP.player, 'players');
  assert.equal(NAV_GROUP['edge-timeline'], 'pbe-picks');
  assert.equal(NAV_GROUP['rotation-impact'], 'pbe-picks');
  assert.equal(NAV_GROUP['scenario-lab'], 'pbe-picks');
  assert.equal(NAV_GROUP.watchlist, 'pbe-picks');
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
