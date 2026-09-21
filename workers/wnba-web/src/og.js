// Share cards (1200×630 PNG) rendered at the edge with satori + resvg.
//
// Rules (see docs/SEO_PUBLISHING_ARCHITECTURE.md):
//   * photo cards sit on the approved, pre-composed newsroom og.jpg (subject framed right, dark left panel,
//     photo credit printed bottom-right and left clear by the text panel) — no new crops are invented here, so no forehead crops or stretched frames;
//   * text only states what the page states: PBE headline, desk, player/team names, verified season numbers;
//   * never odds, lines, probabilities or model numbers; no team marks (names and colours only);
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

// Minimal hyperscript for satori's element tree.
const h = (style, ...children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) } });
const text = (style, s) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(s) } });

const INK = '#0f0d0a';
const GOLD = '#d4af37';
const ORANGE = '#ff7a2f';
const PAPER = '#f5f1eb';
const MUTED = '#c9c0b2';

function brand() {
  return h({ flexDirection: 'column' },
    text({ fontFamily: 'Barlow Condensed', fontSize: 40, color: GOLD, letterSpacing: 1 }, 'PROPBETEDGE'),
    text({ fontFamily: 'Barlow Condensed', fontSize: 26, color: PAPER, letterSpacing: 1, marginTop: -4 }, 'WNBA NEWSROOM'));
}

function footer(left) {
  return h({ position: 'absolute', left: 56, bottom: 40, alignItems: 'center' },
    h({ width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE, marginRight: 12 }),
    text({ fontFamily: 'Inter', fontWeight: 500, fontSize: 22, color: MUTED }, left));
}

function background(model) {
  if (model.photo) {
    return [
      { type: 'img', props: { src: model.photo, width: 1200, height: 630, style: { position: 'absolute', left: 0, top: 0, width: 1200, height: 630 } } },
      h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: 'linear-gradient(90deg, rgba(15,13,10,0.97) 0%, rgba(15,13,10,0.86) 44%, rgba(15,13,10,0) 66%)' }),
      // The composition prints its own small brand top-left; mask it so the card's brand is the only one.
      h({ position: 'absolute', left: 0, top: 0, width: 460, height: 140, backgroundImage: 'linear-gradient(90deg, rgba(15,13,10,1) 0%, rgba(15,13,10,1) 78%, rgba(15,13,10,0) 100%)' })
    ];
  }
  const [c1, c2] = model.colors;
  return [
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(120deg, ${INK} 0%, ${INK} 46%, ${c1} 46%, ${c1} 73%, ${c2} 73%, ${c2} 100%)` }),
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: 'linear-gradient(90deg, rgba(15,13,10,1) 0%, rgba(15,13,10,0.9) 48%, rgba(15,13,10,0.55) 100%)' }),
    h({ position: 'absolute', left: 0, bottom: 0, width: 1200, height: 10, backgroundImage: `linear-gradient(90deg, ${GOLD}, ${ORANGE})` })
  ];
}

function scoreboardLayout(model) {
  const sb = model.scoreboard;
  const photo = Boolean(model.photo);
  const row = (t, win) => h({ alignItems: 'center', marginTop: 18, width: photo ? 560 : 1000 },
    t.flag ? { type: 'img', props: { src: t.flag, width: photo ? 84 : 120, height: photo ? 56 : 80, style: { borderRadius: 6, marginRight: 26 } } } : h({ width: photo ? 84 : 120, height: photo ? 56 : 80, marginRight: 26, backgroundColor: '#2a241c', borderRadius: 6 }),
    text({ fontFamily: 'Barlow Condensed', fontSize: photo ? 60 : 92, color: win ? PAPER : MUTED, textTransform: 'uppercase', flexGrow: 1 }, t.name),
    text({ fontFamily: 'Barlow Condensed', fontSize: photo ? 76 : 116, color: win ? GOLD : MUTED }, String(t.score ?? '')));
  return h({ width: 1200, height: 630, position: 'relative', backgroundColor: INK },
    ...background(model),
    model.mark ? { type: 'img', props: { src: model.mark, width: 380, height: 380, style: { position: 'absolute', right: 70, top: 135, width: 380, height: 380, objectFit: 'contain', opacity: 0.96 } } } : null,
    h({ position: 'absolute', left: 56, top: 52 }, brand()),
    h({ position: 'absolute', left: 56, top: 150, flexDirection: 'column' },
      text({ fontFamily: 'Barlow Condensed', fontSize: 30, color: ORANGE, letterSpacing: 2, textTransform: 'uppercase' }, model.kicker),
      row(sb.rows[0], true),
      row(sb.rows[1], false),
      text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 24, color: MUTED, marginTop: 24, width: photo ? 600 : 1000 }, sb.competition || '')),
    footer(model.footer));
}

function podiumLayout(model) {
  const CELL_W = 300;
  const CELL_H = 372;
  const cell = (r, i) => h({
    position: 'absolute', left: 56 + i * (CELL_W + 14), top: 190, width: CELL_W, height: CELL_H,
    flexDirection: 'column', borderRadius: 12, overflow: 'hidden', backgroundColor: '#1a1610'
  },
  { type: 'img', props: { src: r.photo, width: CELL_W, height: 268, style: { width: CELL_W, height: 268, objectFit: 'cover' } } },
  h({ position: 'absolute', left: 0, top: 0, width: 54, height: 54, backgroundColor: r.teamColor, alignItems: 'center', justifyContent: 'center' },
    text({ fontFamily: 'Barlow Condensed', fontSize: 34, color: PAPER }, `${r.rank}`)),
  h({ width: CELL_W, height: CELL_H - 268, paddingLeft: 14, paddingRight: 14, flexDirection: 'column', justifyContent: 'center' },
    text({ fontFamily: 'Barlow Condensed', fontSize: 34, color: PAPER, textTransform: 'uppercase', lineHeight: 1 }, r.name),
    text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 26, color: GOLD, marginTop: 4 }, `${r.score} WinBA`)));

  return h({ width: 1200, height: 630, position: 'relative', backgroundColor: INK },
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(120deg, ${INK} 0%, ${INK} 62%, #1d1a14 100%)` }),
    h({ position: 'absolute', left: 0, bottom: 0, width: 1200, height: 10, backgroundImage: `linear-gradient(90deg, ${GOLD}, ${ORANGE})` }),
    h({ position: 'absolute', left: 56, top: 52 }, brand()),
    h({ position: 'absolute', left: 56, top: 116, flexDirection: 'column' },
      text({ fontFamily: 'Barlow Condensed', fontSize: 44, color: PAPER, textTransform: 'uppercase', lineHeight: 1 }, 'The WinBA Index'),
      text({ fontFamily: 'Barlow Condensed', fontSize: 30, color: ORANGE, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }, model.period || '')),
    ...model.podium.map(cell),
    model.credits ? text({ position: 'absolute', right: 20, bottom: 16, fontFamily: 'Inter', fontWeight: 500, fontSize: 15, color: '#8d8578' }, model.credits) : null,
    footer(model.footer));
}

function layout(model) {
  if (model.podium) return podiumLayout(model);
  if (model.scoreboard) return scoreboardLayout(model);
  const size = model.title.length <= 60 ? 58 : model.title.length <= 95 ? 48 : 40;
  const titleStyle = model.titleFont === 'display'
    ? { fontFamily: 'Barlow Condensed', fontSize: model.title.length <= 18 ? 96 : 76, lineHeight: 0.95, color: PAPER, textTransform: 'uppercase' }
    : { fontFamily: 'Newsreader', fontSize: size, lineHeight: 1.12, color: PAPER };
  return h({ width: 1200, height: 630, position: 'relative', backgroundColor: INK },
    ...background(model),
    h({ position: 'absolute', left: 56, top: 52 }, brand()),
    h({ position: 'absolute', left: 56, top: 168, width: model.photo ? 640 : 1000, flexDirection: 'column' },
      text({ fontFamily: 'Barlow Condensed', fontSize: 28, color: ORANGE, letterSpacing: 2, textTransform: 'uppercase' }, model.kicker),
      text({ ...titleStyle, marginTop: 14 }, model.title),
      model.sub ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 30, color: GOLD, marginTop: 18 }, model.sub) : null,
      model.detail ? text({ fontFamily: 'Inter', fontWeight: 500, fontSize: 26, color: MUTED, marginTop: 12 }, model.detail) : null),
    footer(model.footer));
}

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
  if (model.photoPath) {
    const r = await deps.fetchAsset(model.photoPath);
    if (r.ok) model.photo = `${r.headers.get('content-type') || 'image/jpeg'};base64,${b64(await r.arrayBuffer())}`.replace(/^/, 'data:');
  }
  if (model.markPath) {
    const r = await deps.fetchAsset(model.markPath);
    if (r.ok) model.mark = `${r.headers.get('content-type') || (model.markPath.endsWith('.svg') ? 'image/svg+xml' : 'image/webp')};base64,${b64(await r.arrayBuffer())}`.replace(/^/, 'data:');
  }
  const png = await renderCard(model);
  return { png, fallback: model.fallback };
}
