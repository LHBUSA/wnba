import { chromium } from 'playwright-core';
const OUT = process.argv[2];
const URL = 'https://wnba.propbetedge.ai/news/the-winba-index-the-wnbas-top-players-for-september-2026-00e543';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, h, tag] of [[1440, 1000, '1440'], [390, 844, '390']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 1000 ? 1 : 2, isMobile: w < 1000, hasTouch: w < 1000 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.bringToFront();
  await page.addStyleTag({ content: '*{scroll-behavior:auto !important;animation:none !important;transition:none !important}' }).catch(() => {});
  for (const sel of ['.wb-board', '.wb-depth']) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { console.log(tag, sel, 'ABSENT'); continue; }
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: `${OUT}/wb-${tag}-${sel.replace(/\W/g, '')}.png` });
    const box = await el.boundingBox();
    console.log(`${tag} ${sel}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(`${tag} overflow: scrollWidth ${o.sw} vs clientWidth ${o.cw}`, o.sw > o.cw ? 'OVERFLOW' : 'none');
  await ctx.close();
}
await b.close();
