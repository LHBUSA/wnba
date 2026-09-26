import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { photoChain, licensedPhoto, photoImg, photoCredits } from '../src/ui/photo.js';
import { licensedContextPhoto } from '../workers/wnba-news/src/articles.js';

// photos.js imports JSON the way wrangler bundles it; bundle it the same way for Node.
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wnba-photos-')), 'photos.mjs');
await build({ entryPoints: [new URL('../workers/wnba-api/src/photos.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
const { photoFor, photoCoverage, configurePhotos } = await import(pathToFileURL(out).href);

const manifest = JSON.parse(fs.readFileSync(new URL('../data/player-photos.json', import.meta.url), 'utf8'));
const headshots = JSON.parse(fs.readFileSync(new URL('../data/player-headshots.json', import.meta.url), 'utf8'));
const approvedIds = new Set(manifest.players.filter((p) => p.status === 'approved' && p.image).map((p) => String(p.espn_athlete_id)));
// `both` / `espnOnly` have no WNBA id so the ESPN-first chain is exercised; `triple` has all three providers.
const both = Object.keys(headshots.players).find((id) => approvedIds.has(id) && headshots.players[id].espn_headshot_full && !headshots.players[id].wnba_player_id);
const espnOnly = Object.keys(headshots.players).find((id) => !approvedIds.has(id) && headshots.players[id].espn_headshot_full && !headshots.players[id].wnba_player_id);
const triple = Object.keys(headshots.players).find((id) => approvedIds.has(id) && headshots.players[id].espn_headshot_full && headshots.players[id].wnba_player_id);
const ON = { WNBA_PHOTO_PROVIDER_ORDER: 'wnba,espn,commons,avatar', WNBA_ENABLE_WNBA_CDN: 'true', WNBA_ENABLE_ESPN_HEADSHOTS: 'true', WNBA_ENABLE_COMMONS: 'true' };

test('unconfigured Worker keeps the exact legacy Commons behaviour', () => {
  configurePhotos({});
  const p = photoFor(both);
  assert.equal(p.provider, 'commons');
  assert.equal(p.portrait, `/media/players/${both}/portrait.webp`);
  assert.equal(p.sources.length, 1);
  assert.equal(photoFor(espnOnly), null);
});

test('provider order puts the ESPN hotlink first and keeps Commons as the licensed fallback', () => {
  configurePhotos(ON);
  const p = photoFor(both);
  assert.equal(p.provider, 'espn');
  assert.equal(p.rights, 'external_editorial');
  assert.equal(p.portrait, `https://a.espncdn.com/i/headshots/wnba/players/full/${both}.png`);
  assert.equal(p.square, `https://a.espncdn.com/combiner/i?img=/i/headshots/wnba/players/full/${both}.png&w=350&h=254`);
  assert.deepEqual(p.sources.map((s) => s.provider), ['espn', 'commons']);
  assert.equal(p.licensed.provider, 'commons');
  assert.equal(p.licensed.rights, 'licensed');
  assert.equal(p.fallback, 'avatar');
  const e = photoFor(espnOnly);
  assert.deepEqual(e.sources.map((s) => s.provider), ['espn']);
  assert.equal(e.licensed, null);
});

test('WNBA CDN only for a mapped WNBA id, first in the chain; flags and order are honoured', () => {
  configurePhotos(ON);
  assert.ok(!photoFor(both).sources.some((s) => s.provider === 'wnba'), 'no WNBA id -> no WNBA source');
  const w = headshots.players[triple].wnba_player_id;
  const t = photoFor(triple);
  assert.deepEqual(t.sources.map((s) => s.provider), ['wnba', 'espn', 'commons']);
  assert.equal(t.portrait, `https://cdn.wnba.com/headshots/wnba/latest/1040x760/${w}.png`);
  assert.equal(t.square, `https://cdn.wnba.com/headshots/wnba/latest/260x190/${w}.png`);
  assert.equal(t.rights, 'external_editorial');
  assert.equal(t.identity, 'wikidata_name_dob');
  assert.equal(t.licensed.provider, 'commons');
  configurePhotos({ ...ON, WNBA_ENABLE_WNBA_CDN: 'false' });
  assert.equal(photoFor(triple).provider, 'espn', 'the CDN flag switches the provider off');
  configurePhotos(ON);
  configurePhotos({ ...ON, WNBA_ENABLE_ESPN_HEADSHOTS: 'false' });
  assert.equal(photoFor(both).provider, 'commons');
  configurePhotos({ ...ON, WNBA_PHOTO_PROVIDER_ORDER: 'commons,espn,avatar' });
  assert.deepEqual(photoFor(both).sources.map((s) => s.provider), ['commons', 'espn']);
  configurePhotos({ ...ON, WNBA_ENABLE_COMMONS: 'false' });
  assert.equal(photoFor(both).licensed, null);
  configurePhotos(ON);
  const cov = photoCoverage();
  assert.equal(cov.approved, approvedIds.size);
  assert.equal(cov.providers.espn.mapped, Object.values(headshots.players).filter((x) => x.espn_headshot_full).length);
  assert.equal(cov.providers.wnba.mapped, Object.values(headshots.players).filter((x) => x.wnba_player_id).length);
});

test('headshot map is hotlinks only, on the two sanctioned hosts', () => {
  assert.equal(headshots.rights, 'external_editorial');
  assert.equal(headshots.mirrored, false);
  for (const [id, x] of Object.entries(headshots.players)) {
    if (x.espn_headshot_full) assert.equal(x.espn_headshot_full, `https://a.espncdn.com/i/headshots/wnba/players/full/${id}.png`);
    if (x.wnba_player_id) assert.match(x.wnba_player_id, /^\d+$/);
    if (x.espn_headshot_square) assert.match(x.espn_headshot_square, /^https:\/\/a\.espncdn\.com\/combiner\/i\?img=\/i\/headshots\/wnba\/players\/full\/\d+\.png&w=350&h=254$/);
  }
  assert.ok(!fs.existsSync(new URL('../public/media/headshots', import.meta.url)), 'external headshots are never mirrored');
});

test('frontend chain walks sources, then the template fallback; JSON-LD and newsroom see Commons only', () => {
  configurePhotos(ON);
  const p = photoFor(both);
  assert.deepEqual(photoChain(p, 'square').map((c) => c.source.provider), ['espn', 'commons']);
  const img = String(photoImg(p, 'square', { alt: 'X', attrs: 'width="128"', fallback: 'AB' }));
  assert.match(img, /^<img src="https:\/\/a\.espncdn\.com\/combiner\/i\?img=[^"]+&amp;w=350&amp;h=254"/);
  assert.match(img, new RegExp(`data-photo-next="/media/players/${both}/square\\.webp"`));
  assert.match(img, /<template data-photo-fallback>AB<\/template>$/);
  const credits = String(photoCredits(p, 'portrait', (s) => s.attribution, 'none'));
  assert.match(credits, /data-photo-credit="0" >Photo: ESPN/);
  assert.match(credits, /data-photo-credit="2" hidden>none/);
  assert.equal(licensedPhoto(p).provider, 'commons');
  assert.equal(licensedPhoto(photoFor(espnOnly)), null);
  const legacy = { portrait: '/media/players/1/portrait.webp', square: '/media/players/1/square.webp' };
  assert.equal(licensedPhoto(legacy), legacy);
  assert.deepEqual(photoChain(legacy, 'portrait').map((c) => c.url), [legacy.portrait]);
  configurePhotos({});
  const before = photoFor(both);
  configurePhotos(ON);
  const ctx = licensedContextPhoto(photoFor(both));
  const { provider, rights, sources, licensed, fallback, ...legacyShape } = before;
  assert.equal(JSON.stringify(ctx), JSON.stringify(legacyShape), 'newsroom context bytes unchanged');
  assert.equal(licensedContextPhoto(photoFor(espnOnly)), null);
  const t = photoFor(triple);
  assert.equal(licensedPhoto(t).provider, 'commons', 'JSON-LD never sees the WNBA hotlink');
  assert.equal(licensedContextPhoto(t).portrait, `/media/players/${triple}/portrait.webp`, 'newsroom never sees the WNBA hotlink');
});

test('silhouette guard: a WNBA portrait is size-guarded, other stages and squares are not; a wrong-size load advances the chain', async () => {
  configurePhotos(ON);
  const t = photoFor(triple);
  const portrait = String(photoImg(t, 'portrait', { alt: 'X', fallback: 'AB' }));
  assert.match(portrait, /data-photo-guard="1040x760"/);
  assert.doesNotMatch(String(photoImg(t, 'square', { alt: 'X', fallback: 'AB' })), /data-photo-guard/);
  assert.doesNotMatch(String(photoImg(photoFor(both), 'portrait', { alt: 'X', fallback: 'AB' })), /data-photo-guard/);
  // Minimal DOM: one <img> built from photoImg's attributes, its <template> sibling, a root.
  const fakeDoc = (markup, natural) => {
    const attrs = Object.fromEntries([...markup.matchAll(/ ([a-z-]+)="([^"]*)"/g)].filter((m) => !m[1].startsWith('width')).map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
    const handlers = {};
    const root = { replaced: null, querySelectorAll: () => [] };
    const tpl = { tagName: 'TEMPLATE', hasAttribute: (k) => k === 'data-photo-fallback', content: { cloneNode: () => 'INITIALS' }, remove() {} };
    const img = {
      tagName: 'IMG', naturalWidth: natural[0], naturalHeight: natural[1], nextElementSibling: tpl, gone: false,
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, hasAttribute: (k) => k in attrs, removeAttribute: (k) => { delete attrs[k]; },
      closest: () => root, replaceWith(x) { root.replaced = x; this.gone = true; }
    };
    return { doc: { addEventListener: (type, fn) => { handlers[type] = fn; } }, img, root, fire: (type) => handlers[type]({ target: img }) };
  };
  const { installPhotoFallback } = await import(`../src/ui/photo.js?guard=${Date.now()}`);
  const a = fakeDoc(portrait, [1094, 800]);
  installPhotoFallback(a.doc);
  a.fire('load');
  assert.equal(a.img.getAttribute('src'), t.sources[1].portrait, 'silhouette (1094x800) -> ESPN');
  assert.equal(a.img.hasAttribute('data-photo-guard'), false);
  a.fire('load'); // ESPN loads at its own size; the guard is gone, nothing moves
  assert.equal(a.img.getAttribute('src'), t.sources[1].portrait);
  a.fire('error');
  assert.equal(a.img.getAttribute('src'), t.sources[2].portrait, 'ESPN error -> Commons');
  a.fire('error');
  assert.equal(a.root.replaced, 'INITIALS', 'all sources failed -> initials template, never a broken image');
  const { installPhotoFallback: install2 } = await import(`../src/ui/photo.js?guard2=${Date.now()}`);
  const b = fakeDoc(portrait, [1040, 760]);
  install2(b.doc);
  b.fire('load');
  assert.equal(b.img.getAttribute('src'), t.portrait, 'a real 1040x760 headshot stays');
  assert.equal(b.img.hasAttribute('data-photo-guard'), false);
});
