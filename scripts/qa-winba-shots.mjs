import { chromium } from 'playwright-core';
const OUT = process.argv[2];
const URL = 'https://wnba.propbetedge.ai/news/the-winba-index-the-wnbas-top-players-for-september-2026-00e543';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, h, tag] of [[1440, 1000, '1440'], [390, 844, '390']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 1000 ? 1 : 2, isMobile: w < 1000, hasTouch: w < 1000 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => { document.querySelectorAll('img[loading="lazy"]').forEach((i) => i.setAttribute('loading','eager')); window.scrollTo(0, document.body.scrollHeight); });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.bringToFront();
  // Sticky chrome bleeds into element captures; hide it for the shot only.
  await page.addStyleTag({ content: '*{scroll-behavior:auto!important;animation:none!important;transition:none!important} header.site, .site-nav, nav.site-nav, .masthead-bar {position:static!important}' }).catch(() => {});
  for (const sel of ['.wb-board', '.wb-depth']) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { console.log(tag, sel, 'ABSENT'); continue; }
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await el.screenshot({ path: `${OUT}/v2-${tag}-${sel.replace(/\W/g, '')}.png` });
    const box = await el.boundingBox();
    console.log(`${tag} ${sel}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(`${tag} overflow:`, o.sw > o.cw ? `OVERFLOW ${o.sw}>${o.cw}` : 'none');
  await ctx.close();
}
await b.close();
