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
const both = Object.keys(headshots.players).find((id) => approvedIds.has(id) && headshots.players[id].espn_headshot_full);
const espnOnly = Object.keys(headshots.players).find((id) => !approvedIds.has(id) && headshots.players[id].espn_headshot_full);
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

test('WNBA CDN stays inert without a mapped WNBA player id; flags and order are honoured', () => {
  configurePhotos(ON);
  assert.ok(Object.values(headshots.players).every((x) => !x.wnba_player_id), 'no WNBA ids are mapped yet');
  assert.ok(!photoFor(both).sources.some((s) => s.provider === 'wnba'));
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
});

test('headshot map is hotlinks only, on the two sanctioned hosts', () => {
  assert.equal(headshots.rights, 'external_editorial');
  assert.equal(headshots.mirrored, false);
  for (const [id, x] of Object.entries(headshots.players)) {
    if (x.espn_headshot_full) assert.equal(x.espn_headshot_full, `https://a.espncdn.com/i/headshots/wnba/players/full/${id}.png`);
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
});
