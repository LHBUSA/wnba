#!/usr/bin/env node
// Stage 11: WNBA.com player-id mapping + ESPN athlete-attested headshots, both LIVE-verified.
//
// Runs after s1_roster.py (which only sees current rosters). Population: every player the live API
// can show a face for — /v1/dna/index (all DNA docs) ∪ /v1/players (active rosters).
//
// WNBA id identity proof (mapping.js rules, pure + tested):
//   ESPN core athlete record (name + date of birth)  ⟷  Wikidata person (P3588 WNBA.com id, CC0;
//   data/wbh/manifests/wikidata-wnba-identity-v1.json) by EXACT normalized name (primary or alias)
//   AND EXACT day-precision date of birth, exactly one candidate, single-valued P3588, the id unique
//   across the population, and no conflict with the Commons ledger's own (independent) match.
//   stats.wnba.com / wnba.com pages are never read (docs/HISTORY_INTELLIGENCE_PHASE1.md: HIGH risk).
// Then the cdn.wnba.com headshot must be live: HTTP 200, image/png, expected dimensions, and NOT the
// generic silhouette (the CDN answers 200 with a silhouette for unknown ids, so the browser's error
// fallback can never catch it — the silhouette hash is measured live from a guaranteed-missing id).
//
// ESPN: an athlete without a roster headshot gets one only when ESPN's own athlete record carries a
// headshot href equal to the WNBA headshot path for that same id, and the image is live.
//
// Writes data/wnba-player-ids.json ({espn: wnba}, read by s1_roster.py), data/player-headshots.json,
// docs/photos/wnba-id-mapping-<date>.json (every decision with its evidence).
//
//   node scripts/photos/s11_provider_ids.mjs [--api https://wnba-api.sales-fd3.workers.dev] [--dry]

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decideWnbaId, indexWikidataPeople, isPlaceholder, imageDims, WNBA_CDN, ESPN_FULL, ESPN_SQUARE } from './mapping.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'https://wnba-api.sales-fd3.workers.dev');
const DRY = process.argv.includes('--dry');
const CACHE = path.join(REPO, 'scripts', 'cache', 'espn-core');
fs.mkdirSync(CACHE, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const UA = { 'user-agent': 'PropBetEdge-photo-audit/1.0' };

async function json(url) {
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (a + 1)));
  }
  throw new Error(`fetch failed ${url}`);
}

async function probe(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      const b = Buffer.from(await r.arrayBuffer());
      return { status: r.status, mime: r.headers.get('content-type'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex'), dims: r.ok ? imageDims(b) : null };
    } catch { await new Promise((res) => setTimeout(res, 500 * (a + 1))); }
  }
  return { status: 0, mime: null, bytes: 0, sha256: null, dims: null };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function espnCore(id) {
  const f = path.join(CACHE, `${id}.json`);
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 12 * 3600e3) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const a = await json(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/athletes/${id}`);
  const rec = a ? { id: String(a.id), fullName: a.fullName || null, displayName: a.displayName || null, firstName: a.firstName || null, lastName: a.lastName || null, dob: a.dateOfBirth ? String(a.dateOfBirth).slice(0, 10) : null, headshot: a.headshot?.href || null, active: a.active ?? null } : null;
  fs.writeFileSync(f, JSON.stringify(rec));
  return rec;
}

// ---------------------------------------------------------------- population (live API)
const dna = (await json(`${API}/v1/dna/index`)).data.players;
const roster = (await json(`${API}/v1/players`)).data.players;
const pop = new Map();
for (const p of dna) pop.set(String(p.id), { id: String(p.id), name: p.name, team_id: p.team_id, dna: true, active: false });
for (const p of roster) { const id = String(p.athlete_id); pop.set(id, { ...(pop.get(id) || { id, name: p.name, dna: false }), team_id: p.team_id, active: true, roster_dob: p.dob || null }); }
const ids = [...pop.keys()].sort((a, b) => Number(a) - Number(b));
console.log(`population ${ids.length} (dna ${dna.length}, roster ${roster.length})`);

const espn = new Map((await pool(ids, 6, espnCore)).map((r, i) => [ids[i], r]));

// ---------------------------------------------------------------- WNBA ids
const wd = JSON.parse(fs.readFileSync(path.join(REPO, 'data/wbh/manifests/wikidata-wnba-identity-v1.json'), 'utf8'));
const wdIndex = indexWikidataPeople(wd.people);
const ledger = new Map(JSON.parse(fs.readFileSync(path.join(REPO, 'data/player-photos.json'), 'utf8')).players.map((p) => [String(p.espn_athlete_id), p]));
const decisions = ids.map((id) => decideWnbaId({
  espn: espn.get(id), roster_dob: pop.get(id).roster_dob, ledger: ledger.get(id) || null, index: wdIndex
}));
// the same WNBA id may never serve two ESPN athletes
const byW = new Map();
decisions.forEach((d, i) => { if (d.wnba_id) byW.set(d.wnba_id, [...(byW.get(d.wnba_id) || []), i]); });
for (const [w, list] of byW) if (list.length > 1) for (const i of list) Object.assign(decisions[i], { outcome: 'ambiguous', reason: `wnba_id_${w}_claimed_by_${list.length}_espn_ids`, wnba_id: null });

// live CDN verification; the silhouette is measured, not assumed
const silhouette = {
  full: await probe(WNBA_CDN.full('999999999')),
  square: await probe(WNBA_CDN.square('999999999'))
};
console.log('silhouette', silhouette.full.sha256.slice(0, 16), silhouette.full.dims, silhouette.square.sha256.slice(0, 16), silhouette.square.dims);
await pool(decisions.map((d, i) => [d, i]).filter(([d]) => d.outcome === 'mapped'), 6, async ([d]) => {
  const full = await probe(WNBA_CDN.full(d.wnba_id));
  const square = await probe(WNBA_CDN.square(d.wnba_id));
  const bad = [
    isPlaceholder(full, { expect: [1040, 760], silhouette: silhouette.full }),
    isPlaceholder(square, { expect: [260, 190], silhouette: silhouette.square })
  ].filter(Boolean);
  d.cdn = { full: { status: full.status, mime: full.mime, bytes: full.bytes, sha256: full.sha256?.slice(0, 16), dims: full.dims }, square: { status: square.status, mime: square.mime, bytes: square.bytes, sha256: square.sha256?.slice(0, 16), dims: square.dims } };
  if (bad.length) Object.assign(d, { outcome: 'rejected', reason: `cdn_${bad.join('+')}`, wnba_id_candidate: d.wnba_id, wnba_id: null });
});

// ---------------------------------------------------------------- ESPN athlete-attested headshots
const headshotsPath = path.join(REPO, 'data/player-headshots.json');
const headshots = JSON.parse(fs.readFileSync(headshotsPath, 'utf8'));
const espnAdds = [];
const espnSkips = [];
await pool(ids.filter((id) => !headshots.players[id]?.espn_headshot_full), 6, async (id) => {
  const e = espn.get(id);
  if (!e?.headshot) return espnSkips.push({ id, name: pop.get(id).name, reason: 'espn_athlete_record_has_no_headshot' });
  if (e.headshot !== ESPN_FULL(id)) return espnSkips.push({ id, name: pop.get(id).name, reason: 'espn_headshot_not_wnba_path', href: e.headshot });
  const full = await probe(ESPN_FULL(id));
  const square = await probe(ESPN_SQUARE(id));
  const bad = [isPlaceholder(full, { expect: [600, 436] }), isPlaceholder(square, { expect: [350, 254] })].filter(Boolean);
  if (bad.length) return espnSkips.push({ id, name: pop.get(id).name, reason: `espn_${bad.join('+')}` });
  espnAdds.push({ id, name: e.displayName || pop.get(id).name });
});

// ---------------------------------------------------------------- write
const mapped = decisions.filter((d) => d.outcome === 'mapped');
const map = Object.fromEntries(mapped.map((d) => [d.espn_id, d.wnba_id]).sort((a, b) => Number(a[0]) - Number(b[0])));
const players = { ...headshots.players };
for (const a of espnAdds) players[a.id] = { name: a.name, espn_headshot_full: ESPN_FULL(a.id), espn_headshot_square: ESPN_SQUARE(a.id), wnba_player_id: null, espn_attested_by: 'athlete_record' };
for (const [id, w] of Object.entries(map)) players[id] = { ...(players[id] || { name: espn.get(id)?.displayName || pop.get(id).name, espn_headshot_full: null, espn_headshot_square: null }), wnba_player_id: w };
for (const id of Object.keys(players)) if (players[id].wnba_player_id && !map[id]) players[id].wnba_player_id = null; // a mapping that no longer verifies is dropped
const sorted = Object.fromEntries(Object.entries(players).sort((a, b) => Number(a[0]) - Number(b[0])));
const nextHeadshots = {
  ...headshots,
  source: 'ESPN WNBA team rosters (s1_roster.py) + ESPN athlete records and Wikidata P3588 WNBA ids, live-verified (s11_provider_ids.mjs)',
  s11_verified_at: new Date().toISOString(),
  players: sorted
};
const count = (o) => Object.entries(o).reduce((m, [, d]) => ((m[d] = (m[d] || 0) + 1), m), {});
const evidence = {
  generated_at: new Date().toISOString(),
  api: API,
  population: { total: ids.length, dna: dna.length, roster: roster.length },
  rules: {
    identity: 'ESPN core athlete (normalized exact full/display name + exact DOB) == Wikidata person (normalized exact primary/alias name + day-precision DOB); exactly one candidate; single P3588; id unique; no conflict with the Commons ledger wnba_com_id',
    wnba_source: 'Wikidata P3588 (CC0) via data/wbh/manifests/wikidata-wnba-identity-v1.json; stats.wnba.com / wnba.com pages never read',
    cdn: 'cdn.wnba.com 1040x760 and 260x190 PNG, HTTP 200, image/png, exact dimensions, sha256 != silhouette measured live from id 999999999',
    espn_athlete: 'ESPN athlete record headshot.href == the WNBA headshot path for the same id; image live, PNG, 600x436 / 350x254, not a placeholder'
  },
  silhouette: { full: { sha256: silhouette.full.sha256?.slice(0, 16), dims: silhouette.full.dims, bytes: silhouette.full.bytes }, square: { sha256: silhouette.square.sha256?.slice(0, 16), dims: silhouette.square.dims, bytes: silhouette.square.bytes } },
  totals: { outcome: count(Object.fromEntries(decisions.map((d) => [d.espn_id, d.outcome]))), reason: count(Object.fromEntries(decisions.filter((d) => d.outcome !== 'mapped').map((d) => [d.espn_id, d.reason.replace(/_\d+.*$/, '')]))), espn_athlete_headshots_added: espnAdds.length },
  decisions: decisions.map((d) => ({ ...d, name: pop.get(d.espn_id).name, dna: pop.get(d.espn_id).dna, active_roster: pop.get(d.espn_id).active })),
  espn_athlete_headshots: { added: espnAdds.sort((a, b) => Number(a.id) - Number(b.id)), not_added: espnSkips.sort((a, b) => Number(a.id) - Number(b.id)) }
};
console.log(JSON.stringify(evidence.totals));
if (DRY) process.exit(0);
const w = (p, o) => fs.writeFileSync(path.join(REPO, p), JSON.stringify(o, null, 1) + '\n');
w('data/wnba-player-ids.json', map);
w('data/player-headshots.json', nextHeadshots);
fs.mkdirSync(path.join(REPO, 'docs/photos'), { recursive: true });
w(`docs/photos/wnba-id-mapping-${today}.json`, evidence);
console.log(`wrote data/wnba-player-ids.json (${mapped.length}), data/player-headshots.json, docs/photos/wnba-id-mapping-${today}.json`);
