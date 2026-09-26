// WNBA id mapping rules, placeholder detection, committed mapping/coverage evidence, surface usage
// and CSP for the player photo providers (scripts/photos/mapping.js, s11_provider_ids.mjs,
// workers/wnba-api/src/photos.js, src/ui/photo.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normName, indexWikidataPeople, decideWnbaId, isPlaceholder, imageDims, WNBA_CDN } from '../scripts/photos/mapping.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const person = (qid, name, dob, w, extra = {}) => ({ wikidata_qid: qid, primary_full_name: name, aliases: [], birth_date: dob, birth_date_precision: 'day', wnba_com_id: w, external_ids: { P3588: [w] }, ...extra });
const PEOPLE = [
  person('Q1', 'Olivia Miles', '2003-01-29', '1643426', { aliases: ['Olivia Rose Miles'] }),
  person('Q2', 'Nikolina Milić', '1994-11-23', '1631263'),
  person('Q3', 'Jane Twin', '2000-01-01', '111'),
  person('Q4', 'Jane Twin', '2000-01-01', '222'),
  person('Q5', 'Myisha Hines-Allen', '1996-05-30', '1628886'),
  person('Q6', 'Multi Id', '1999-09-09', '333', { external_ids: { P3588: ['333', '334'] } }),
  person('Q7', 'Year Only', '1998-01-01', '444', { birth_date_precision: 'year' })
];
const index = indexWikidataPeople(PEOPLE);
const espn = (id, fullName, dob, displayName = fullName) => ({ id, fullName, displayName, dob });

test('normName: exact-match key folds case, diacritics and punctuation only', () => {
  assert.equal(normName('Nikolina Milić'), 'nikolina milic');
  assert.equal(normName("A'ja  Wilson"), 'a ja wilson');
  assert.equal(normName('Myisha Hines-Allen'), 'myisha hines allen');
  assert.equal(normName('JJ Quinerly'), 'jj quinerly');
  assert.notEqual(normName('Olivia Mile'), normName('Olivia Miles'), 'no fuzzy matching');
});

test('mapped only on exact name AND exact day-precision DOB with a single P3588', () => {
  const d = decideWnbaId({ espn: espn('4433791', 'Olivia Miles', '2003-01-29'), index });
  assert.equal(d.outcome, 'mapped');
  assert.equal(d.wnba_id, '1643426');
  assert.equal(d.evidence.qid, 'Q1');
  assert.equal(decideWnbaId({ espn: espn('1', 'Olivia Rose Miles', '2003-01-29', 'x'), index }).wnba_id, '1643426', 'alias counts');
  assert.equal(decideWnbaId({ espn: espn('2', 'Nikolina Milic', '1994-11-23'), index }).wnba_id, '1631263', 'diacritics folded');
});

test('never mapped: DOB differs, no DOB, roster DOB disagrees, same-name twins, multi P3588, year-only DOB, no name', () => {
  const r = (e, extra = {}) => decideWnbaId({ espn: e, index, ...extra });
  assert.deepEqual([r(espn('3', 'Myisha Hines-Allen', '1995-05-30')).outcome, r(espn('3', 'Myisha Hines-Allen', '1995-05-30')).reason], ['rejected', 'wikidata_name_match_but_dob_differs']);
  assert.equal(r(espn('4', 'Olivia Miles', null)).reason, 'no_espn_dob');
  assert.equal(r(espn('4', 'Olivia Miles', '2003-01-29'), { roster_dob: '2003-01-30' }).reason, 'espn_dob_disagrees_with_roster_dob');
  assert.equal(r(espn('5', 'Jane Twin', '2000-01-01')).outcome, 'ambiguous');
  assert.equal(r(espn('6', 'Multi Id', '1999-09-09')).reason, 'wikidata_p3588_not_single_numeric');
  assert.equal(r(espn('7', 'Year Only', '1998-01-01')).reason, 'wikidata_name_match_but_dob_differs');
  assert.equal(r(espn('8', 'Nobody Known', '2001-01-01')).reason, 'no_wikidata_person_with_exact_name');
  for (const x of [r(espn('3', 'Myisha Hines-Allen', '1995-05-30')), r(espn('5', 'Jane Twin', '2000-01-01'))]) assert.equal(x.wnba_id, null);
});

test('the Commons ledger is an independent check: any disagreement rejects', () => {
  const e = espn('4433791', 'Olivia Miles', '2003-01-29');
  assert.equal(decideWnbaId({ espn: e, index, ledger: { wnba_com_id: '1643426', wikidata_qid: 'Q1' } }).evidence.ledger_agrees, true);
  assert.equal(decideWnbaId({ espn: e, index, ledger: { wnba_com_id: '999' } }).reason, 'conflicts_with_commons_ledger_wnba_id');
  assert.equal(decideWnbaId({ espn: e, index, ledger: { wikidata_qid: 'Q999' } }).reason, 'conflicts_with_commons_ledger_qid');
});

test('placeholder detection: HTTP, MIME, silhouette hash, exact size, byte floor', () => {
  const sil = { sha256: 'abc' };
  const good = { status: 200, mime: 'image/png', bytes: 150000, sha256: 'def', dims: [1040, 760] };
  assert.equal(isPlaceholder(good, { expect: [1040, 760], silhouette: sil }), '');
  assert.equal(isPlaceholder({ ...good, sha256: 'abc' }, { expect: [1040, 760], silhouette: sil }), 'silhouette');
  assert.equal(isPlaceholder({ ...good, dims: [1094, 800] }, { expect: [1040, 760] }), 'dims_1094x800', 'the full-size WNBA silhouette is 1094x800');
  assert.equal(isPlaceholder({ ...good, status: 404 }), 'http_404');
  assert.equal(isPlaceholder({ ...good, mime: 'text/html' }), 'not_image');
  assert.equal(isPlaceholder({ ...good, bytes: 500 }), 'too_small');
  assert.equal(isPlaceholder({ ...good, dims: null }), 'unreadable');
  const png = Buffer.alloc(40); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1040, 16); png.writeUInt32BE(760, 20);
  assert.deepEqual(imageDims(png), [1040, 760]);
  assert.equal(WNBA_CDN.square('1643426'), 'https://cdn.wnba.com/headshots/wnba/latest/260x190/1643426.png');
});

test('committed mapping: every shipped WNBA id is an exact name+DOB decision whose live CDN image passed', () => {
  const map = readJson('data/wnba-player-ids.json');
  const ev = readJson('docs/photos/wnba-id-mapping-2026-09-26.json');
  const hs = readJson('data/player-headshots.json').players;
  const byId = new Map(ev.decisions.map((d) => [d.espn_id, d]));
  assert.ok(Object.keys(map).length >= 200, 'mapping populated');
  for (const [espnId, w] of Object.entries(map)) {
    const d = byId.get(espnId);
    assert.equal(d?.outcome, 'mapped', espnId);
    assert.equal(d.reason, 'exact_name_and_dob');
    assert.equal(d.wnba_id, w);
    assert.ok(d.evidence.qid && d.evidence.dob, espnId);
    for (const v of ['full', 'square']) {
      assert.equal(d.cdn[v].status, 200, `${espnId} ${v}`);
      assert.match(d.cdn[v].mime, /^image\/png/);
      assert.notEqual(d.cdn[v].sha256, v === 'full' ? ev.silhouette.full.sha256 : ev.silhouette.square.sha256, `${espnId} ${v} is the silhouette`);
    }
    assert.deepEqual(d.cdn.full.dims, [1040, 760]);
    assert.deepEqual(d.cdn.square.dims, [260, 190]);
    assert.equal(hs[espnId]?.wnba_player_id, w, `${espnId} in the headshot map`);
  }
  assert.equal(new Set(Object.values(map)).size, Object.keys(map).length, 'a WNBA id serves one athlete');
  assert.deepEqual(Object.entries(hs).filter(([, x]) => x.wnba_player_id).map(([k]) => k).sort(), Object.keys(map).sort(), 'no unreviewed WNBA id in the headshot map');
  for (const d of ev.decisions.filter((x) => x.outcome !== 'mapped')) assert.ok(!map[d.espn_id], `${d.espn_id} ${d.reason} must stay unmapped`);
  for (const [k, x] of Object.entries(hs)) if (x.espn_attested_by) assert.ok(ev.espn_athlete_headshots.added.some((a) => a.id === k), `${k} ESPN athlete headshot has evidence`);
});

test('committed coverage report: every real source verified, qualified players all have a face, ids match', () => {
  const r = readJson('docs/photos/coverage-2026-09-26.json');
  for (const k of ['player_id', 'name', 'qualified', 'active_roster', 'wnba', 'espn', 'commons', 'chosen_provider', 'fallback']) assert.ok(k in r.players[0], k);
  assert.equal(r.totals.all_dna.main.players, 239);
  assert.equal(r.totals.qualified.main.players, 166);
  assert.equal(r.totals.qualified.main.initials_only, 0);
  assert.ok(!r.players.some((p) => p.failures?.main && Object.keys(p.failures.main).length), 'no failing source in the resolver at this commit');
  for (const p of r.players) {
    const order = ['wnba', 'espn', 'commons'].filter((k) => p[k]);
    assert.equal(p.chosen_provider, order[0] || 'avatar', p.player_id);
    assert.equal(p.fallback, order[1] || 'avatar', p.player_id);
  }
});

test('surfaces consume the resolver: no page builds a provider URL, WinBA and WNBACast use API photo objects', () => {
  const walk = (d) => fs.readdirSync(new URL(`../${d}`, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(js|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const offenders = walk('src').filter((f) => /cdn\.wnba\.com\/headshots|espncdn\.com\/(i\/headshots|combiner)/.test(read(f)));
  assert.deepEqual(offenders, [], 'provider URLs are built only in workers/wnba-api/src/photos.js');
  // the Commons-only map survives only as WNBACast's pre-deploy fallback, behind the API photo
  const usesApproved = walk('src').filter((f) => /approvedPlayerPhoto\(/.test(read(f)) && !f.endsWith('player-photo-map.js'));
  assert.deepEqual(usesApproved, ['src/pages/cast.js']);
  assert.match(read('src/pages/cast.js'), /p\.photo\?\.square \? p\.photo : approvedPlayerPhoto\(p\.athlete_id\)/);
  assert.match(read('workers/wnba-api/src/index.js'), /winba: idx\.get\(String\(p\.athlete_id\)\) \|\| null, photo: photoFor\(p\.athlete_id\)/, 'box score players carry the resolver photo');
  assert.match(read('src/views/winba-score.js'), /const photoOf = \(row, player\) => player\?\.photo \|\| row\?\.photo \|\| null;/);
  assert.doesNotMatch(read('src/views/winba-score.js'), /photo: player\?\.photo/, 'WinBA board no longer drops off-roster faces');
  // photoImg / photoChain is how every face renders
  for (const f of ['src/views/player.js', 'src/views/player-dna.js', 'src/views/winba-score.js', 'src/ui/components.js', 'src/ui/court.js']) assert.match(read(f), /photoImg|photoChain/, f);
  // licensed-only surfaces
  assert.match(read('src/seo/jsonld.js'), /licensedPhoto\(/);
  assert.match(read('workers/wnba-news/src/media-resolve.js'), /\/media\/players\/\$\{pid\}\/square\.webp/);
});

test('CSP img-src allows exactly the resolver hosts (self, ESPN, WNBA CDN) plus analytics, nothing broader', () => {
  const need = new Set(["'self'", 'data:', 'https://a.espncdn.com', 'https://cdn.wnba.com']);
  const analytics = new Set(['https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://www.googletagmanager.com']);
  for (const f of ['vercel.json', 'workers/wnba-web/src/index.js', 'workers/wnba-web/src/index-historical.js']) {
    const src = read(f).match(/img-src ([^;"]+)/)[1].trim().split(/\s+/);
    assert.deepEqual(new Set(src), new Set([...need, ...analytics]), f);
    assert.ok(!src.some((h) => h === 'https:' || h === '*' || /\*\.(espncdn|wnba)\.com/.test(h)), `${f}: no wildcard image host`);
  }
  const hosts = new Set(Object.values(readJson('data/player-headshots.json').players).flatMap((x) => [x.espn_headshot_full, x.espn_headshot_square]).filter(Boolean).map((u) => new URL(u).origin));
  assert.deepEqual([...hosts], ['https://a.espncdn.com']);
  assert.equal(new URL(WNBA_CDN.full('1')).origin, 'https://cdn.wnba.com');
});
