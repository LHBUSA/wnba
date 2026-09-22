// Real-browser QA for the commissioned features: figure geometry, minimum type
// sizes, and horizontal overflow at phone and desktop width.
// Usage: node scripts/qa-commission-shots.mjs <out-dir>

import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const SITE = 'https://wnba.propbetedge.ai';
const PAGES = [
  ['reese', '/news/angel-reese-winba-empty-stats-debate-77c413'],
  ['wilson', '/news/aja-wilson-winba-consistency-greatness-routine-e934be']
];
const FIGURES = ['[data-visual="reese-climb"]', '[data-visual="reese-components"]', '[data-visual="september-context"]', '[data-visual="wilson-standard"]', '[data-visual="wilson-resume"]'];

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let problems = 0;

for (const [name, path] of PAGES) {
  for (const [w, h, tag] of [[1440, 1000, '1440'], [390, 844, '390']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 1000 ? 1 : 2, isMobile: w < 1000, hasTouch: w < 1000 });
    const page = await ctx.newPage();
    await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(() => {
      document.querySelectorAll('img[loading="lazy"]').forEach((i) => i.setAttribute('loading', 'eager'));
      document.querySelectorAll('details.pv-data').forEach((d) => { d.open = false; });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.bringToFront();
    await page.addStyleTag({ content: '*{scroll-behavior:auto!important;animation:none!important;transition:none!important} header.site,.site-nav,nav.site-nav,.masthead-bar{position:static!important}' }).catch(() => {});

    console.log(`\n== ${name} @ ${tag}`);
    for (const sel of FIGURES) {
      const el = page.locator(sel).first();
      if (!(await el.count())) continue;
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const id = sel.match(/"([^"]+)"/)[1];
      await el.screenshot({ path: `${OUT}/${name}-${tag}-${id}.png` });
      const box = await el.boundingBox();
      console.log(`   ${id}: ${Math.round(box.width)}x${Math.round(box.height)}`);
      if (box.width > w) { console.log(`   WIDER THAN VIEWPORT`); problems += 1; }
    }

    // Every rendered text node in a figure must be legible. SVG text scales with
    // the viewBox, so the effective size is measured from the page, not the CSS.
    const small = await page.evaluate(() => {
      const out = [];
      for (const fig of document.querySelectorAll('.pv-figure')) {
        for (const el of fig.querySelectorAll('text, .pv-bar-value, .pv-bar-label, .pv-rc-score, .pv-rc-name, .pv-honours b, .pv-honours span, .pv-line-stats dd, .pv-caption, .pv-title')) {
          const t = (el.textContent || '').trim();
          if (!t) continue;
          // A label the stylesheet hides at this width (the full month names on
          // a phone) is not a legibility problem.
          if (getComputedStyle(el).display === 'none') continue;
          const r = el.getBoundingClientRect();
          // Rendered cap height is a good proxy for perceived size on SVG text.
          const css = parseFloat(getComputedStyle(el).fontSize);
          const svg = el.ownerSVGElement;
          const eff = svg ? css * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width) : css;
          if (eff < 10) out.push({ fig: fig.dataset.visual, text: t.slice(0, 24), px: Math.round(eff * 10) / 10 });
          if (r.width === 0 || r.height === 0) out.push({ fig: fig.dataset.visual, text: t.slice(0, 24), px: 0, zero: true });
        }
      }
      return out;
    });
    if (small.length) { console.log('   TYPE BELOW 10px:', JSON.stringify(small.slice(0, 8))); problems += small.length; }
    else console.log('   type: all figure text >= 10px effective');

    // Does anything in a figure wrap a number onto two lines?
    const wrapped = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.pv-bar-value, .pv-rc-score, .pv-honours b, .pv-line-stats dd, .pv-total b')) {
        const cs = getComputedStyle(el);
        const lines = el.getBoundingClientRect().height / parseFloat(cs.lineHeight || cs.fontSize);
        if (lines > 1.6) out.push({ text: (el.textContent || '').trim(), lines: Math.round(lines * 10) / 10 });
      }
      return out;
    });
    if (wrapped.length) { console.log('   WRAPPED VALUES:', JSON.stringify(wrapped)); problems += wrapped.length; }

    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (o.sw > o.cw) { console.log(`   OVERFLOW ${o.sw}>${o.cw}`); problems += 1; } else console.log('   overflow: none');

    await page.screenshot({ path: `${OUT}/${name}-${tag}-page.png`, fullPage: tag === '390' });
    await ctx.close();
  }
}
await b.close();
console.log(`\n${problems ? `QA: ${problems} problem(s)` : 'QA: clean'}`);
process.exit(problems ? 1 : 0);
