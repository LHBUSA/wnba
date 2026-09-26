#!/usr/bin/env node
// Local share-card QA: renders the production layouts (workers/wnba-web/src/og-layout.js) from the production
// card models (og-model.js) with live API data, so cards can be inspected before a Worker deploy.
//
//   node scripts/brand/render-og-local.mjs <outDir> kind/key [kind/key ...]
//   e.g. node scripts/brand/render-og-local.mjs qa-og players/3149391 dna/3149391 cast/401857219 pages/winba-score
//
// Assets resolve from ./public first (unreleased files), then https://wnba.propbetedge.ai.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'workers', 'wnba-web');
const mod = (p) => import(pathToFileURL(path.join(WEB, 'node_modules', p)).href);
const { default: satori } = await mod('satori/dist/index.js');
const { initWasm, Resvg } = await mod('@resvg/resvg-wasm/index.mjs');
await initWasm(fs.readFileSync(path.join(WEB, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')));
const { cardModel } = await import(pathToFileURL(path.join(WEB, 'src', 'og-model.js')).href);
const { layout } = await import(pathToFileURL(path.join(WEB, 'src', 'og-layout.js')).href);

const font = (f) => fs.readFileSync(path.join(WEB, 'fonts', f));
const FONTS = [
  { name: 'Newsreader', data: font('newsreader-600.ttf'), weight: 600, style: 'normal' },
  { name: 'Barlow Condensed', data: font('barlow-condensed-700.ttf'), weight: 700, style: 'normal' },
  { name: 'Inter', data: font('inter-500.ttf'), weight: 500, style: 'normal' },
  { name: 'Inter', data: font('inter-700.ttf'), weight: 700, style: 'normal' }
];

const API = 'https://wnba-api.sales-fd3.workers.dev';
const NEWS = 'https://wnba-news.sales-fd3.workers.dev';
const INTL = 'https://wnba-international.sales-fd3.workers.dev';
const get = async (u) => { try { const r = await fetch(u, { headers: { accept: 'application/json' } }); return { ...(await r.json()), status: r.status }; } catch (e) { return { ok: false, error: { code: 'network', message: e.message } }; } };
const api = {
  player: (id) => get(`${API}/v1/players/${id}`),
  dna: (id) => get(`${API}/v1/dna/players/${id}`),
  team: (id) => get(`${API}/v1/teams/${id}`),
  teams: () => get(`${API}/v1/teams`),
  game: (id) => get(`${API}/v1/games/${id}`),
  statsWinba: () => get(`${API}/v1/stats/winba`),
  article: (slug) => get(`${NEWS}/v1/articles/${slug}`),
  intlCompetition: (id, view) => get(`${INTL}/v1/international/competitions/${id}${view ? `/${view}` : ''}`),
  intlGame: (id) => get(`${INTL}/v1/international/games/${id}`),
  intlTeam: (id) => get(`${INTL}/v1/international/teams/${id}`),
  intlPlayer: (id) => get(`${INTL}/v1/international/players/${id}`)
};

const type = (p) => (p.endsWith('.png') ? 'image/png' : p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
async function asset(p) {
  const local = path.join(ROOT, 'public', p.split('?')[0]);
  if (fs.existsSync(local)) return `data:${type(p)};base64,${fs.readFileSync(local).toString('base64')}`;
  const r = await fetch(`https://wnba.propbetedge.ai${p}`);
  if (!r.ok) return null;
  return `data:${r.headers.get('content-type') || type(p)};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
}

// Mirrors og.js ogResponse asset resolution.
async function resolveAssets(model) {
  for (const row of model.scoreboard?.rows || []) if (row.flagPath) row.flag = await asset(row.flagPath);
  for (const row of model.versus?.rows || []) if (row.logoPath) row.logo = await asset(row.logoPath);
  if (model.podium) {
    for (const r of model.podium) if (r.photoPath) r.photo = await asset(r.photoPath);
    if (!model.podium.every((r) => r.photo)) { model.podium = null; if (!model.photoPath) model.photoPath = model.fallback; }
  }
  if (model.photoPath) {
    model.photo = await asset(model.photoPath);
    if (!model.photo && !model.markPath && model.fallbackMarkPath) model.markPath = model.fallbackMarkPath;
  }
  if (model.markPath) model.mark = await asset(model.markPath);
}

const [outDir, ...targets] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
for (const t of targets) {
  const [kind, key] = t.split('/');
  const model = await cardModel(kind, key, api);
  if (!model) { console.log(`${t}: no model (falls back to the master card)`); continue; }
  await resolveAssets(model);
  const svg = await satori(layout(model), { width: 1200, height: 630, fonts: FONTS });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  const file = path.join(outDir, `${kind}-${key}.png`);
  fs.writeFileSync(file, png);
  console.log(`${t}: ${file} ${png.length} B photo=${Boolean(model.photo)} mark=${Boolean(model.mark)}`);
}
