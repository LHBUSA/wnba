import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const w of [1440, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 1000, hasTouch: w < 1000 });
  const page = await ctx.newPage();
  await page.goto('https://wnba.propbetedge.ai/news/the-winba-index-the-wnbas-top-players-for-september-2026-00e543', { waitUntil: 'networkidle', timeout: 60000 });
  const m = await page.evaluate(() => {
    const board = document.querySelector('.wb-board').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.wb-depth-card')].map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; });
    const podium = [...document.querySelectorAll('.wb-podium-card')].map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    const smallest = Math.min(...[...document.querySelectorAll('.wb-board *, .wb-depth *')].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((n) => n > 0));
    return {
      boardRight: Math.round(board.right), boardLeft: Math.round(board.left),
      depthCardOverflow: cards.filter((c) => c.r > Math.round(board.right) + 1).length,
      podiumHeights: [...new Set(podium.map((p) => p.h))],
      podiumWidths: podium.map((p) => p.w),
      smallestFontPx: smallest
    };
  });
  console.log(`=== ${w}px`, JSON.stringify(m));
  await ctx.close();
}
await b.close();
