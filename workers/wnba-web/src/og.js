// Share cards (1200×630 PNG) rendered at the edge with satori + resvg.
//
// Rules (see docs/SEO_PUBLISHING_ARCHITECTURE.md):
//   * photo cards sit on the approved, pre-composed newsroom og.jpg (subject framed right, dark left panel,
//     photo credit printed bottom-right and left clear by the text panel) — no new crops are invented here, so no forehead crops or stretched frames;
//   * text only states what the page states: PBE headline, desk, player/team names, verified season numbers;
//   * never odds, lines, probabilities or model numbers; team marks only from the self-hosted set (PNG twins);
//   * every card carries the V3 identity (og-layout.js): PropBetEdge mark + WNBA, @PROPBETEDGE, the rail;
//   * any failure redirects to the approved static image, never a broken card.

import satori, { init as initSatori } from 'satori/wasm';
import initYoga from 'yoga-wasm-web';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import yogaWasm from '../node_modules/yoga-wasm-web/dist/yoga.wasm';
import resvgWasm from '../node_modules/@resvg/resvg-wasm/index_bg.wasm';
import newsreader600 from '../fonts/newsreader-600.ttf';
import barlow700 from '../fonts/barlow-condensed-700.ttf';
import inter500 from '../fonts/inter-500.ttf';
import inter700 from '../fonts/inter-700.ttf';
import { cardModel } from './og-model.js';
import { layout } from './og-layout.js';

let ready = null;
function boot() {
  if (!ready) {
    ready = (async () => {
      initSatori(await initYoga(yogaWasm));
      await initWasm(resvgWasm);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const FONTS = [
  { name: 'Newsreader', data: newsreader600, weight: 600, style: 'normal' },
  { name: 'Barlow Condensed', data: barlow700, weight: 700, style: 'normal' },
  { name: 'Inter', data: inter500, weight: 500, style: 'normal' },
  { name: 'Inter', data: inter700, weight: 700, style: 'normal' }
];

export async function renderCard(model) {
  await boot();
  const svg = await satori(layout(model), { width: 1200, height: 630, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

const b64 = (buf) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Serve entity, page and international share cards under /og/:kind/:id.png.
 * @param {{ api, fetchAsset: (path:string)=>Promise<Response> }} deps
 */
export async function ogResponse(kind, key, deps) {
  const model = await cardModel(kind, key, deps.api);
  if (!model) return null;
  if (model.scoreboard) {
    for (const row of model.scoreboard.rows) {
      if (!row.flagPath) continue;
      const r = await deps.fetchAsset(row.flagPath);
      if (r.ok) row.flag = `data:image/svg+xml;base64,${b64(await r.arrayBuffer())}`;
    }
  }
  if (model.podium) {
    for (const r of model.podium) {
      if (!r.photoPath) continue;
      const res = await deps.fetchAsset(r.photoPath);
      if (res.ok) r.photo = `data:${res.headers.get('content-type') || 'image/webp'};base64,${b64(await res.arrayBuffer())}`;
    }
    // A cell that did not load would read as a production error, so the whole
    // podium is dropped rather than rendered incomplete.
    if (!model.podium.every((r) => r.photo)) {
      model.podium = null;
      if (!model.photoPath) model.photoPath = model.fallback;
    }
  }
  if (model.versus) {
    for (const row of model.versus.rows) {
      if (!row.logoPath) continue;
      const r = await deps.fetchAsset(row.logoPath);
      if (r.ok) row.logo = `data:image/png;base64,${b64(await r.arrayBuffer())}`;
    }
  }
  if (model.photoPath) {
    const r = await deps.fetchAsset(model.photoPath);
    if (r.ok) model.photo = `${r.headers.get('content-type') || 'image/jpeg'};base64,${b64(await r.arrayBuffer())}`.replace(/^/, 'data:');
    // No approved photograph came back: the team mark stands in, never an empty right half.
    else if (!model.markPath && model.fallbackMarkPath) model.markPath = model.fallbackMarkPath;
  }
  if (model.markPath) {
    const r = await deps.fetchAsset(model.markPath);
    if (r.ok) model.mark = `${r.headers.get('content-type') || (model.markPath.endsWith('.svg') ? 'image/svg+xml' : 'image/webp')};base64,${b64(await r.arrayBuffer())}`.replace(/^/, 'data:');
  }
  const png = await renderCard(model);
  return { png, fallback: model.fallback };
}
