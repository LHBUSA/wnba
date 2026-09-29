// Local visual QA for newsroom figures: renders every visual of a dry-run article set with the real renderer and
// stylesheets into one page, then screenshots and measures it at the seven QA widths (no production involved).
//   node scripts/qa-visuals-local.mjs <dry-run.json> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { editorialVisual } from '../src/views/visuals.js';

const [, , input, outDir = 'qa-artifacts/visuals-local'] = process.argv;
const items = JSON.parse(fs.readFileSync(input, 'utf8')).items;
const css = ['tokens.css', 'fonts.css', 'base.css', 'editorial-charts.css'].map((f) => fs.readFileSync(path.resolve('src/styles', f), 'utf8').replace(/url\(['"]?\/fonts\/[^)]*\)/g, 'local(Arial)')).join('\n');
const pick = [];
const seen = new Set();
for (const a of items) for (const v of a.visuals || []) if (!seen.has(`${a.kind}:${v.id}`)) { seen.add(`${a.kind}:${v.id}`); pick.push({ a, v }); }
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{background:var(--ink-0,#0e0c09);color:var(--paper,#f3ede2);margin:0;padding:16px;} main{max-width:720px;margin:0 auto;} h4{font:600 12px system-ui;color:#999;margin:26px 0 0}</style></head><body><main>
${pick.map(({ a, v }) => `<h4>${a.kind} · ${v.id}</h4>${String(editorialVisual(v))}`).join('\n')}
</main></body></html>`;
fs.mkdirSync(outDir, { recursive: true });
const file = path.resolve(outDir, 'visuals.html');
fs.writeFileSync(file, page);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let failed = 0;
for (const w of [320, 360, 390, 430, 768, 1024, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`file:///${file.replace(/\\/g, '/')}`);
  const m = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll('.pv-figure *')].filter((el) => el.getBoundingClientRect().right > vw + 1).map((el) => `${el.className}`).slice(0, 5);
    const tiny = [...document.querySelectorAll('.pv-figure *')].filter((el) => el.childElementCount === 0 && el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 11 && getComputedStyle(el).display !== 'none' && !el.closest('details:not([open])')).length;
    return { scroll: document.documentElement.scrollWidth, vw, over, tiny, figures: document.querySelectorAll('.pv-figure').length, unverified: document.querySelectorAll('.pv-figure--unverified').length };
  });
  const ok = m.scroll <= m.vw + 1 && !m.over.length && !m.unverified;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${w} figures=${m.figures} unverified=${m.unverified} overflow=${m.scroll > m.vw + 1 ? `${m.scroll}>${m.vw}` : 'none'} offenders=${m.over.join('|') || '-'} tiny<11px=${m.tiny}`);
  if ([320, 390, 1440].includes(w)) await p.screenshot({ path: path.resolve(outDir, `visuals-${w}.png`), fullPage: true });
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
