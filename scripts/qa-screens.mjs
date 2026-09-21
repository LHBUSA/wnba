#!/usr/bin/env node
// Screen QA: every route at 1440 and 390 in real Chrome.
// Records console errors, page exceptions, failed requests, requests to any host
// other than our own origin / owned Workers / Google Fonts (direct provider calls
// must be zero), horizontal overflow (with offenders), broken images, tiny text.
// Usage: node scripts/qa-screens.mjs [baseUrl] [--widths=1440,390] [--routes=/,/cast]

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:5190').replace(/\/$/, '');
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const widths = opt('widths', '1440,390').split(',').map(Number);
const CAST_FINAL = opt('final', '401857189');
const routes = opt('routes', `/,/cast,/cast/${CAST_FINAL},/props,/matchups,/matchups/401857190,/players,/players/4433730,/injuries,/news,/standings,/stats,/teams,/teams/3,/track-record,/pro,/sources`).split(',');
const OUT = path.resolve('qa-artifacts');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ALLOWED = [new URL(base).host, 'wnba-api.sales-fd3.workers.dev', 'wnba-news.sales-fd3.workers.dev', 'wnba-international.sales-fd3.workers.dev', 'wnba-web.sales-fd3.workers.dev', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = [];
let failed = 0;

for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w >= 1000 ? 900 : 844 }, deviceScaleFactor: w >= 1000 ? 1 : 2, isMobile: w < 1000, hasTouch: w < 1000 });
  for (const r of routes) {
    const page = await ctx.newPage();
    const rec = { route: r, width: w, console: [], pageErrors: [], failedRequests: [], foreignHosts: [], overflow: null, brokenImages: [], tinyText: 0 };
    page.on('console', (m) => { if (m.type() === 'error') rec.console.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => rec.pageErrors.push(String(e).slice(0, 300)));
    page.on('requestfailed', (q) => { const u = q.url(); if (!/favicon/.test(u)) rec.failedRequests.push(`${q.failure()?.errorText} ${u.slice(0, 140)}`); });
    page.on('request', (q) => { const h = new URL(q.url()).host; if (q.url().startsWith('http') && !ALLOWED.includes(h)) rec.foreignHosts.push(h); });
    try {
      await page.goto(base + r, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1500);
      Object.assign(rec, await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const offenders = [];
        if (document.documentElement.scrollWidth > vw + 1) {
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            if (b.right > vw + 1 && b.width > 0) {
              let p = el.parentElement; let clipped = false;
              while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
              if (!clipped) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(b.right)}`);
            }
            if (offenders.length > 6) break;
          }
        }
        const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
        let tiny = 0;
        for (const el of document.querySelectorAll('body *')) {
          if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          const b = el.getBoundingClientRect();
          if (fs < 10 && b.width > 0 && b.height > 0 && !el.closest('svg')) tiny += 1;
        }
        return { overflow: document.documentElement.scrollWidth > vw + 1 ? { scrollWidth: document.documentElement.scrollWidth, vw, offenders } : null, brokenImages: broken, tinyText: tiny, title: document.title, h1: document.querySelector('h1')?.textContent?.trim().slice(0, 80) || null };
      }));
      const dir = path.join(OUT, String(w));
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${r === '/' ? 'today' : r.slice(1).replaceAll('/', '_')}.png`), fullPage: true });
    } catch (e) {
      rec.pageErrors.push(`navigation: ${e.message.slice(0, 200)}`);
    }
    rec.foreignHosts = [...new Set(rec.foreignHosts)];
    const bad = rec.pageErrors.length || rec.overflow || rec.brokenImages.length || rec.foreignHosts.length;
    if (bad) failed += 1;
    report.push({ ...rec, pass: !bad });
    console.log(`${bad ? 'FAIL' : 'PASS'} ${w} ${r}${rec.overflow ? ` overflow ${rec.overflow.scrollWidth}>${rec.overflow.vw} ${rec.overflow.offenders.join(' | ')}` : ''}${rec.pageErrors.length ? ` errors: ${rec.pageErrors.join(' / ')}` : ''}${rec.brokenImages.length ? ` broken: ${rec.brokenImages.join(',')}` : ''}${rec.foreignHosts.length ? ` foreign: ${rec.foreignHosts.join(',')}` : ''}${rec.console.length ? ` console(${rec.console.length}): ${rec.console[0]}` : ''}${rec.tinyText ? ` tiny:${rec.tinyText}` : ''}`);
    await page.close();
  }
  await ctx.close();
}

// WNBACast correctness: the requested game is the one on screen, final state is right, shots match the API.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const api = await (await fetch(`https://wnba-api.sales-fd3.workers.dev/v1/games/${CAST_FINAL}/live`)).json();
  await page.goto(`${base}/cast/${CAST_FINAL}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const seen = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.sh-team .nm b')].map((b) => b.textContent.trim()),
    scores: [...document.querySelectorAll('.sh-team .sc')].map((b) => b.textContent.trim()),
    badge: document.querySelector('.sh-mid .badge')?.textContent.trim(),
    shots: document.querySelectorAll('.court .shot').length,
    events: document.querySelectorAll('.pbp-row').length,
    scrub: document.querySelector('[data-scrub]')?.max
  }));
  const g = api.data.game;
  const checks = {
    correct_game: seen.names[0] === g.away.name && seen.names[1] === g.home.name,
    correct_score: seen.scores[0] === String(g.away.score) && seen.scores[1] === String(g.home.score),
    final_state_label: /replay/i.test(seen.badge || ''),
    shots_match_api: seen.shots === api.data.shots.plotted,
    replay_covers_all_events: Number(seen.scrub) === api.data.events.length - 1
  };
  const pass = Object.values(checks).every(Boolean);
  if (!pass) failed += 1;
  report.push({ route: `/cast/${CAST_FINAL} correctness`, width: 1440, checks, seen, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} WNBACast correctness ${JSON.stringify(checks)}`);
  await ctx.close();
}

await browser.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base, at: new Date().toISOString(), failed, report }, null, 2));
console.log(`\nqa-screens: ${failed ? `${failed} FAIL` : 'ALL PASS'} → ${path.join(OUT, 'report.json')}`);
process.exit(failed ? 1 : 0);
