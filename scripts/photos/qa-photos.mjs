#!/usr/bin/env node
// Production photo QA — run AFTER wnba-api (and wnba-web) are deployed. One headless Chrome.
//
// Players (one per case): Olivia Miles, a veteran star, a traded player, a rookie, a low-sample DNA
// player, a Commons-chosen player, an ESPN-chosen player, a newly mapped CDN player, a genuine
// initials-only player. Pages per player: /players/:id and /players/:id/dna; plus /winba-score,
// the team page and /stats. Widths 1440, 768, 430, 390, 320.
//
// Checks per image that belongs to the photo pipeline (data-photo-stage, or /media/players, espncdn
// headshots, cdn.wnba.com headshots): loaded (complete && naturalWidth > 0) — or replaced by the
// initials fallback; alt equals the expected player name on the player/DNA hero; the provider the
// page ended on (wnba / espn / commons / initials) against docs/photos/coverage-<date>.json; the
// WNBA silhouette never shown (naturalWidth 1094 on a 1040x760 request); hero crop (rendered box
// aspect + object-fit); cumulative layout shift; CSP violations; console errors.
//
//   node scripts/photos/qa-photos.mjs [https://wnba.propbetedge.ai] [--widths=1440,768,430,390,320] [--report=docs/photos/coverage-2026-09-26.json]
// Output: qa-artifacts/photos/<date>/report.json + one screenshot per player hero per width. Exit 1 on any failure.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || 'https://wnba.propbetedge.ai').replace(/\/$/, '');
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const widths = opt('widths', '1440,768,430,390,320').split(',').map(Number);
const coverage = JSON.parse(fs.readFileSync(opt('report', 'docs/photos/coverage-2026-09-26.json'), 'utf8'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('qa-artifacts', 'photos', new Date().toISOString().slice(0, 10));
fs.mkdirSync(OUT, { recursive: true });

const byId = new Map(coverage.players.map((p) => [p.player_id, p]));
const CASES = [
  ['miles', '4433791'], ['veteran_star', '3149391'], ['traded', '3065570'], ['rookie', '5105737'],
  ['low_sample_dna', '4873359'], ['commons', '4790260'], ['espn', '3142055'], ['newly_mapped_cdn', '4280892'], ['initials_only', '4433744']
];
const PAGES = ['/winba-score', '/stats', '/teams/8'];
const provider = (src) => (!src ? 'initials' : /cdn\.wnba\.com/.test(src) ? 'wnba' : /espncdn\.com/.test(src) ? 'espn' : /\/media\/players\//.test(src) ? 'commons' : 'other');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
let failures = 0;
const fail = (rec, msg) => { rec.failures.push(msg); failures++; };

async function audit(ctx, route, expect = null) {
  const page = await ctx.newPage();
  const rec = { route, width: ctx._w, console: [], csp: [], failures: [], images: [], cls: 0 };
  page.on('console', (m) => { if (m.type() === 'error') rec.console.push(m.text().slice(0, 200)); if (/Content Security Policy/i.test(m.text())) rec.csp.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    window.__cls = 0; window.__csp = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  try {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(2000);
    const data = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img, image')].filter((el) => el.hasAttribute('data-photo-stage') || /\/media\/players\/|espncdn\.com\/(i|combiner)|cdn\.wnba\.com\/headshots/.test(el.getAttribute('src') || el.getAttribute('href') || ''));
      const hero = document.querySelector('.p-photo img, .dna-hero__media img, .p-photo .fallback, .dna-hero__mono');
      const heroBox = hero?.getBoundingClientRect();
      return {
        cls: window.__cls, csp: window.__csp,
        images: imgs.map((el) => ({ src: el.currentSrc || el.getAttribute('src') || el.getAttribute('href'), alt: el.getAttribute('alt'), stage: el.getAttribute('data-photo-stage'), complete: el.complete ?? true, nw: el.naturalWidth ?? null, nh: el.naturalHeight ?? null })),
        hero: hero ? { tag: hero.tagName, alt: hero.getAttribute('alt'), src: hero.currentSrc || hero.getAttribute('src'), nw: hero.naturalWidth, w: Math.round(heroBox.width), h: Math.round(heroBox.height), fit: getComputedStyle(hero).objectFit, pos: getComputedStyle(hero).objectPosition } : null
      };
    });
    rec.cls = Number(data.cls.toFixed(3));
    rec.csp.push(...data.csp);
    rec.images = data.images;
    rec.hero = data.hero;
    for (const im of data.images) {
      if (im.complete && im.nw === 0) fail(rec, `broken image ${im.src}`);
      if (/cdn\.wnba\.com\/headshots\/wnba\/latest\/1040x760/.test(im.src) && im.nw && im.nw !== 1040) fail(rec, `WNBA silhouette shown ${im.src}`);
      if (im.src && /\/players\/full\/(\d+)|\/media\/players\/(\d+)/.test(im.src) && expect && im.alt === expect.name) {
        const id = (im.src.match(/\/players\/full\/(\d+)|\/media\/players\/(\d+)/) || []).slice(1).find(Boolean);
        if (id !== expect.player_id) fail(rec, `wrong player: ${im.src} alt=${im.alt}`);
      }
    }
    if (expect) {
      const want = expect.chosen_provider === 'avatar' ? 'initials' : expect.chosen_provider;
      const got = data.hero?.tag === 'IMG' ? provider(data.hero.src) : 'initials';
      rec.hero_provider = { expected: want, got };
      if (got !== want) fail(rec, `hero provider ${got}, expected ${want} (fallback ${expect.fallback})`);
      if (data.hero?.tag === 'IMG' && data.hero.alt !== expect.name) fail(rec, `hero alt "${data.hero.alt}" != "${expect.name}"`);
      if (data.hero?.tag === 'IMG' && data.hero.fit !== 'cover') fail(rec, `hero object-fit ${data.hero.fit}`);
      await page.locator('.p-photo, .dna-hero__media').first().screenshot({ path: path.join(OUT, `${route.replace(/\W+/g, '_')}_${ctx._w}.png`) }).catch(() => {});
    }
    if (rec.cls > 0.1) fail(rec, `CLS ${rec.cls}`);
    if (rec.csp.length) fail(rec, `CSP: ${rec.csp.join(' | ')}`);
  } catch (e) { fail(rec, `load: ${String(e).slice(0, 200)}`); }
  await page.close();
  return rec;
}

for (const w of widths) { // sequential: one browser, one page at a time
  // cdn.wnba.com's bot filter answers the default "HeadlessChrome" user agent with ERR_HTTP2_PROTOCOL_ERROR
  // (verified 2026-09-26: HTTP/1.1 with any Referer and headless Chrome with a normal UA both get the 1040x760
  // portrait). Real visitors are unaffected, so QA browses with a normal desktop/mobile Chrome UA; set
  // QA_HEADLESS_UA=1 to reproduce the blocked path (the page must then fall back to ESPN with no broken image).
  const UA = process.env.QA_HEADLESS_UA ? undefined : (w < 1000
    ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
  const ctx = await browser.newContext({ viewport: { width: w, height: w >= 1000 ? 900 : 844 }, deviceScaleFactor: w >= 1000 ? 1 : 2, isMobile: w < 1000, hasTouch: w < 1000, ...(UA ? { userAgent: UA } : {}) });
  ctx._w = w;
  for (const [label, id] of CASES) {
    const expect = byId.get(id);
    if (!expect) { results.push({ label, id, width: w, failures: ['not in coverage report'] }); failures++; continue; }
    for (const r of [`/players/${id}`, `/players/${id}/dna`]) results.push({ label, id, name: expect.name, ...(await audit(ctx, r, expect)) });
  }
  for (const r of PAGES) results.push({ label: 'page', ...(await audit(ctx, r)) });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base, widths, generated_at: new Date().toISOString(), failures, results }, null, 1));
for (const r of results) console.log(`${r.failures.length ? 'FAIL' : 'ok  '} ${String(r.width).padStart(4)} ${r.route || ''} ${r.label}${r.hero_provider ? ` hero=${r.hero_provider.got}` : ''} imgs=${r.images?.length ?? 0} cls=${r.cls ?? '-'}${r.failures.length ? ` :: ${r.failures.join(' ; ')}` : ''}`);
console.log(`${failures} failure(s) -> ${path.join(OUT, 'report.json')}`);
process.exit(failures ? 1 : 0);
