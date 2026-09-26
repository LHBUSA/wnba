// PropBetEdge WNBA identity V3: canonical mark in the chrome, the favicon family, the manifest, the V3 master
// card, versioned dynamic cards with one identity, and X · LinkedIn · Copy share actions on canonical URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeMeta } from '../src/seo/meta.js';
import { DEFAULT_IMAGE, LOGO, OG_REV, SOCIAL_CARD_PATH } from '../src/seo/site.js';
import { shareLinks, shareBar, canonicalUrl } from '../src/ui/share.js';
import { layout } from '../workers/wnba-web/src/og-layout.js';
import { PBE_MARK_PNG } from '../workers/wnba-web/src/brand-mark.js';
import { approvedCardPhoto, versusModel } from '../workers/wnba-web/src/og-model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => path.join(ROOT, 'public', p.replace(/^\//, ''));
const pngSize = (file) => { const b = fs.readFileSync(file); assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
function jpegSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt16BE(0), 0xffd8, `${file} is a JPEG`);
  for (let i = 2; i < b.length;) {
    const marker = b.readUInt16BE(i);
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error('no SOF');
}

test('the brand source is the canonical PropBetEdge artwork (propbetedge.ai/logo/pbe-full-600.png)', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'brand', 'src', 'pbe-full-600.png'))).digest('hex');
  assert.equal(sha, '53d5f2a15297578b323db7ef216dcb34d3eb2fe3e9a9b46401634ae3609af7e5');
  assert.match(PBE_MARK_PNG, /^data:image\/png;base64,iVBORw0KGgo/);
});

test('header and footer carry the canonical mark, never the old basketball stand-in', async () => {
  const { shellHtml } = await import('../src/ui/shell.js');
  const doc = String(shellHtml());
  const header = doc.slice(doc.indexOf('<header'), doc.indexOf('</header>'));
  const footer = doc.slice(doc.indexOf('<footer'), doc.indexOf('</footer>'));
  for (const part of [header, footer]) {
    assert.match(part, /<img class="brand-mark" src="\/brand\/pbe-mark-32\.webp" srcset="[^"]*pbe-mark-64\.webp 2x[^"]*"/);
    assert.match(part, /PropBetEdge <span>WNBA<\/span><\/b><small>WNBA Intelligence<\/small>/);
  }
  assert.doesNotMatch(doc, /<svg class="brand-mark"/);
  for (const f of ['brand/pbe-mark-32.webp', 'brand/pbe-mark-64.webp', 'brand/pbe-mark-96.webp']) assert.ok(fs.existsSync(pub(f)), f);
});

test('favicon family, touch icon and manifest are linked from the shell and exist at the right sizes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const outsideSeo = html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '');
  for (const tag of [
    '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />',
    '<link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />',
    '<link rel="manifest" href="/site.webmanifest" />',
    '<meta name="apple-mobile-web-app-title" content="PBE WNBA" />',
    '<meta name="theme-color" content="#0f0d0a" />'
  ]) assert.ok(outsideSeo.includes(tag), `shell (outside the SSR-replaced block) has ${tag}`);
  assert.deepEqual(pngSize(pub('favicon-16x16.png')), [16, 16]);
  assert.deepEqual(pngSize(pub('favicon-32x32.png')), [32, 32]);
  assert.deepEqual(pngSize(pub('apple-touch-icon.png')), [180, 180]);
  assert.deepEqual(pngSize(pub('icon-192.png')), [192, 192]);
  assert.deepEqual(pngSize(pub('icon-512.png')), [512, 512]);
  assert.deepEqual(pngSize(pub('icon-maskable-512.png')), [512, 512]);
  const ico = fs.readFileSync(pub('favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
  assert.ok(ico.readUInt16LE(4) >= 2, 'ICO holds 16 and 32 frames');
  assert.match(fs.readFileSync(pub('favicon.svg'), 'utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 128 128">/);
});

test('web manifest identity', () => {
  const m = JSON.parse(fs.readFileSync(pub('site.webmanifest'), 'utf8'));
  assert.equal(m.name, 'PropBetEdge WNBA');
  assert.equal(m.short_name, 'PBE WNBA');
  assert.equal(m.theme_color, '#0f0d0a');
  assert.equal(m.background_color, '#0f0d0a');
  assert.equal(m.start_url, '/');
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512', '512x512']);
  for (const i of m.icons) assert.ok(fs.existsSync(pub(i.src)), i.src);
});

test('the V3 master card and the publisher logo exist at the declared sizes', () => {
  assert.equal(SOCIAL_CARD_PATH, '/share/propbetedge-wnba-social-v3.jpg');
  assert.equal(DEFAULT_IMAGE.url, `https://wnba.propbetedge.ai${SOCIAL_CARD_PATH}`);
  assert.deepEqual(jpegSize(pub(SOCIAL_CARD_PATH)), [1200, 630]);
  assert.equal(LOGO.url, 'https://wnba.propbetedge.ai/share/propbetedge-logo-v3-512.png');
  assert.deepEqual(pngSize(pub('share/propbetedge-logo-v3-512.png')), [512, 512]);
});

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(m?js|html|css)$/.test(e.name)) out.push(full);
  }
  return out;
}

test('no live metadata or chrome references retired identity assets', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'workers')), path.join(ROOT, 'index.html'), path.join(ROOT, 'scripts', 'publish-shell.mjs')];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /propbetedge-wnba-social(?:-v2)?\.(?:jpg|png)|propbetedge-wnba-logo-512\.png/, path.relative(ROOT, f));
  }
});

test('every indexable route shares an absolute 1200×630 image with alt text; dynamic cards are versioned', () => {
  const routes = [
    ['today', { path: '/' }],
    ['news', { path: '/news' }],
    ['cast', { path: '/cast' }],
    ['pbe-picks', { path: '/pbe-picks' }],
    ['winba-score', { path: '/winba-score' }],
    ['international', { path: '/international' }],
    ['player', { path: '/players/1', data: { player: { athlete_id: '1', name: 'A Player' } } }],
    ['team', { path: '/teams/9', data: { team: { team_id: '9', name: 'New York Liberty' } } }],
    ['matchups', { path: '/matchups/401', params: { gameId: '401' }, data: { game: { game_id: '401', away: { name: 'A' }, home: { name: 'B' }, start_utc: '2026-09-30T23:00Z' } } }],
    ['cast', { path: '/cast/401', params: { gameId: '401' }, data: { game: { game_id: '401', status: { state: 'post' }, away: { name: 'A', score: 80 }, home: { name: 'B', score: 77 }, start_utc: '2026-09-30T23:00Z' } } }],
    ['player-dna', { path: '/players/1/dna', params: { playerId: '1' }, data: { player: { name: 'A Player' } } }]
  ];
  for (const [id, o] of routes) {
    const m = routeMeta(id, o);
    assert.match(m.image.url, /^https:\/\/wnba\.propbetedge\.ai\//, `${id} image is absolute https`);
    assert.equal(m.image.width, 1200);
    assert.equal(m.image.height, 630);
    assert.ok(m.image.alt && m.image.alt.length > 12, `${id} has image alt`);
    if (m.image.url.includes('/og/')) assert.match(m.image.url, new RegExp(`\\?v=${OG_REV}(?:-|$)`), `${id} card URL carries the design revision`);
  }
  assert.equal(routeMeta('today', { path: '/' }).image.url, DEFAULT_IMAGE.url, 'homepage shares the V3 master card');
  assert.equal(routeMeta('today', { path: '/' }).title, 'PropBetEdge WNBA — Live WNBA Intelligence, Player DNA & WNBACast');
  const cast = routeMeta('cast', routes[9][1]);
  assert.match(cast.image.url, /\/og\/cast\/401\.png\?v=3-post80-77$/, 'WNBACast card URL is keyed to the game state');
  assert.match(routeMeta('player-dna', routes[10][1]).image.url, /\/og\/dna\/1\.png\?v=3$/);
});

test('share actions: X · LinkedIn · Copy on the canonical URL only', () => {
  const s = shareLinks({ path: '/players/3149391/dna?scope=last10&vs=4433791&utm_source=x#top', title: 'A’ja Wilson Player DNA' });
  assert.equal(s.url, 'https://wnba.propbetedge.ai/players/3149391/dna');
  const x = new URL(s.x);
  assert.equal(`${x.origin}${x.pathname}`, 'https://x.com/intent/post');
  assert.equal(x.searchParams.get('url'), s.url);
  assert.equal(x.searchParams.get('text'), 'A’ja Wilson Player DNA');
  assert.equal(x.searchParams.get('via'), 'PROPBETEDGE');
  const li = new URL(s.linkedin);
  assert.equal(`${li.origin}${li.pathname}`, 'https://www.linkedin.com/sharing/share-offsite/');
  assert.equal(li.searchParams.get('url'), s.url);
  assert.equal(canonicalUrl('/'), 'https://wnba.propbetedge.ai/');
  assert.equal(canonicalUrl('https://wnba-abc-justins-projects.vercel.app/teams/9/?x=1'), 'https://wnba.propbetedge.ai/teams/9');
  const bar = String(shareBar({ path: '/news/a-story-abc123', title: 'A story' }));
  assert.equal((bar.match(/class="share-btn"/g) || []).length, 3);
  assert.match(bar, /aria-label="Share on X"/);
  assert.match(bar, /aria-label="Share on LinkedIn"/);
  assert.match(bar, /data-share-copy="https:\/\/wnba\.propbetedge\.ai\/news\/a-story-abc123"/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'ui', 'share.js'), 'utf8'), /facebook|reddit|bsky|bluesky/i);
});

test('every share-card layout carries the same PropBetEdge identity', () => {
  const models = [
    { kicker: 'Injury Desk', title: 'A headline that is long enough to wrap across more than one line on the card', footer: 'x' },
    { kicker: 'Team', title: 'New York Liberty', titleFont: 'display', tag: 'Team', footer: 'x' },
    { kicker: 'WNBA player profile', title: 'A Player', stats: [{ label: 'PPG', value: '20.1' }], footer: 'x' },
    { kicker: 'Player DNA', title: 'A Player', winba: { score: '80.0', context: 'No. 5 in the WNBA · 2026' }, dims: [{ label: 'Scoring', score: 90 }], footer: 'x' },
    { winbaBoard: true, title: 'WinBA Score', board: [{ rank: 1, name: 'A Player', team: 'Team', score: '87.0' }], footer: 'x' },
    versusModel({ status: { state: 'in', short_detail: 'Q3 4:12' }, start_utc: '2026-09-30T23:00Z', away: { name: 'Atlanta Dream', abbr: 'ATL', team_id: '20', score: 60 }, home: { name: 'Washington Mystics', abbr: 'WSH', team_id: '16', score: 58 } }, 'cast'),
    { kicker: 'Gold medal', title: 'x', scoreboard: { competition: 'World Cup', rows: [{ name: 'United States', score: 97 }, { name: 'France', score: 79 }] }, footer: 'x' }
  ];
  for (const m of models) {
    const tree = JSON.stringify(layout(m));
    assert.ok(tree.includes(PBE_MARK_PNG.slice(0, 80)), 'canonical mark');
    assert.ok(tree.includes('"@PROPBETEDGE"'), '@PROPBETEDGE');
    assert.ok(tree.includes('"WNBA"'), 'sport identity');
    assert.doesNotMatch(tree, /WNBA NEWSROOM/);
  }
  const live = models[5];
  assert.equal(live.versus.status, 'live');
  assert.equal(live.tag, 'WNBACast');
});

test('generated cards never re-publish hotlinked provider headshots', () => {
  assert.equal(approvedCardPhoto('1628932', { provider: 'wnba', rights: 'external_editorial', portrait: 'https://cdn.wnba.com/x.png' }), null);
  assert.equal(approvedCardPhoto('3149391', { provider: 'wnba', licensed: { provider: 'commons', rights: 'licensed' } }), '/media/news/players/3149391/og.jpg');
});
