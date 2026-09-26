#!/usr/bin/env node
// Photo coverage report from LIVE data: every DNA doc (/v1/dna/index) and every active-roster player
// (/v1/players). For each player two columns:
//   live  the photo object the production API serves right now, every URL fetched and verified
//   main  what the resolver at this commit (workers/wnba-api/src/photos.js + data/) will serve once
//         wnba-api is deployed, with the production provider env, every URL fetched and verified
// A provider counts only when both its portrait and square URLs are live images that are not a
// placeholder (mapping.js isPlaceholder). chosen_provider = the first verified source; fallback = the
// provider the page lands on if that one fails ('avatar' = initials card).
//
//   node scripts/photos/coverage-report.mjs [--api URL] [--site URL] [--out docs/photos/coverage-<date>.json]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { imageDims, isPlaceholder, WNBA_CDN } from './mapping.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'https://wnba-api.sales-fd3.workers.dev');
const SITE = arg('--site', 'https://wnba.propbetedge.ai');
const today = new Date().toISOString().slice(0, 10);
const OUT = arg('--out', `docs/photos/coverage-${today}.json`);
const UA = { 'user-agent': 'PropBetEdge-photo-audit/1.0' };

// production provider env, read from the wnba-api wrangler config
const wrangler = fs.readFileSync(path.join(REPO, 'workers/wnba-api/wrangler.toml'), 'utf8');
const env = Object.fromEntries([...wrangler.matchAll(/^(WNBA_(?:PHOTO_PROVIDER_ORDER|ENABLE_[A-Z_]+))\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));

const tmp = fs.mkdtempSync(path.join(process.env.PHOTO_TMP || os.tmpdir(), 'wnba-cov-'));
const bundle = path.join(tmp, 'photos.mjs');
await build({ entryPoints: [path.join(REPO, 'workers/wnba-api/src/photos.js')], bundle: true, format: 'esm', platform: 'neutral', outfile: bundle, logLevel: 'silent' });
const { photoFor, configurePhotos } = await import(pathToFileURL(bundle).href);
configurePhotos(env);

const json = async (u) => (await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) })).json()).data;
const dna = (await json(`${API}/v1/dna/index`)).players;
const roster = (await json(`${API}/v1/players`)).players;

const cache = new Map();
async function probe(url) {
  const abs = url.startsWith('/') ? SITE + url : url;
  if (cache.has(abs)) return cache.get(abs);
  const p = (async () => {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(abs, { headers: UA, signal: AbortSignal.timeout(20000) });
        const b = Buffer.from(await r.arrayBuffer());
        return { status: r.status, mime: r.headers.get('content-type'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex'), dims: r.ok ? imageDims(b) : null };
      } catch { /* retry */ }
    }
    return { status: 0 };
  })();
  cache.set(abs, p);
  return p;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }

const silhouette = { full: await probe(WNBA_CDN.full('999999999')), square: await probe(WNBA_CDN.square('999999999')) };
const EXPECT = { wnba: { portrait: [1040, 760], square: [260, 190] }, espn: { portrait: [600, 436], square: [350, 254] } };
async function verify(source) {
  const why = [];
  for (const v of ['portrait', 'square']) {
    const r = await probe(source[v]);
    const w = isPlaceholder(r, { expect: EXPECT[source.provider]?.[v] || null, silhouette: source.provider === 'wnba' ? (v === 'portrait' ? silhouette.full : silhouette.square) : null, minBytes: 1500 });
    if (w) why.push(`${v}:${w}`);
  }
  return why;
}

const people = new Map();
for (const p of dna) people.set(String(p.id), { player_id: String(p.id), name: p.name, dna: true, qualified: Boolean(p.season_calculated), active_roster: false, livePhoto: p.headshot || null });
for (const p of roster) { const id = String(p.athlete_id); const x = people.get(id) || { player_id: id, name: p.name, dna: false, qualified: false, livePhoto: null }; people.set(id, { ...x, name: x.name || p.name, active_roster: true, livePhoto: x.livePhoto || p.photo || null }); } // a 0-game DNA doc carries name null

const rows = [];
await pool([...people.values()], 8, async (p) => {
  const col = async (photo) => {
    const out = { wnba: false, espn: false, commons: false, failures: {} };
    const ok = [];
    for (const s of photo?.sources || []) {
      if (![s.portrait, s.square].every((u) => String(u).includes(p.player_id) || s.provider === 'wnba')) { out.failures[s.provider] = 'url_not_keyed_to_player'; continue; }
      const why = await verify(s);
      if (why.length) out.failures[s.provider] = why.join(',');
      else { out[s.provider] = true; ok.push(s.provider); }
    }
    return { ...out, chosen_provider: ok[0] || 'avatar', fallback: ok[1] || 'avatar' };
  };
  const live = await col(p.livePhoto);
  const main = await col(photoFor(p.player_id));
  rows.push({ player_id: p.player_id, name: p.name, dna: p.dna, qualified: p.qualified, active_roster: p.active_roster, live, main });
});
rows.sort((a, b) => Number(a.player_id) - Number(b.player_id));

const totals = (list, k) => {
  const t = { players: list.length, wnba: 0, espn: 0, commons: 0, any_real_photo: 0, initials_only: 0, chosen: { wnba: 0, espn: 0, commons: 0, avatar: 0 } };
  for (const r of list) {
    const c = r[k];
    for (const p of ['wnba', 'espn', 'commons']) if (c[p]) t[p]++;
    if (c.chosen_provider === 'avatar') t.initials_only++; else t.any_real_photo++;
    t.chosen[c.chosen_provider]++;
  }
  return t;
};
const groups = { all_dna: rows.filter((r) => r.dna), qualified: rows.filter((r) => r.qualified), active_roster: rows.filter((r) => r.active_roster), dna_or_roster: rows };
const report = {
  generated_at: new Date().toISOString(),
  api: API,
  site: SITE,
  provider_env: env,
  definitions: {
    all_dna: 'every doc in /v1/dna/index',
    qualified: 'DNA docs whose season scope is calculated (season_calculated = true)',
    active_roster: 'every player in /v1/players (ESPN team rosters)',
    live: 'photo object served by production wnba-api now; every URL fetched',
    main: 'photo object the resolver at this commit serves after wnba-api deploy; every URL fetched',
    provider_true: 'portrait and square both HTTP 200 image, expected size, not the provider silhouette/placeholder'
  },
  silhouette: { wnba_full_sha256: silhouette.full.sha256?.slice(0, 16), wnba_full_dims: silhouette.full.dims, wnba_square_sha256: silhouette.square.sha256?.slice(0, 16), wnba_square_dims: silhouette.square.dims },
  urls_checked: cache.size,
  totals: Object.fromEntries(Object.entries(groups).map(([g, list]) => [g, { live: totals(list, 'live'), main: totals(list, 'main') }])),
  players: rows.map((r) => ({
    player_id: r.player_id, name: r.name, dna: r.dna, qualified: r.qualified, active_roster: r.active_roster,
    wnba: r.main.wnba, espn: r.main.espn, commons: r.main.commons, chosen_provider: r.main.chosen_provider, fallback: r.main.fallback,
    live: { wnba: r.live.wnba, espn: r.live.espn, commons: r.live.commons, chosen_provider: r.live.chosen_provider, fallback: r.live.fallback },
    ...(Object.keys(r.main.failures).length || Object.keys(r.live.failures).length ? { failures: { main: r.main.failures, live: r.live.failures } } : {})
  }))
};
fs.mkdirSync(path.dirname(path.join(REPO, OUT)), { recursive: true });
fs.writeFileSync(path.join(REPO, OUT), JSON.stringify(report, null, 1) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(report.totals, null, 1));
console.log(`urls checked ${cache.size} -> ${OUT}`);
