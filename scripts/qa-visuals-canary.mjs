// Production data-visual canary: one live article per desk. Reports every chart's id, type, plotted values, source,
// observed time and values hash (from the API), then loads the REAL production page at phone and desktop widths and
// checks the figures are in the server HTML, verified (not refused), inside the viewport, with element screenshots.
//   node scripts/qa-visuals-canary.mjs [outDir] [--json=file]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const NEWS = 'https://wnba-news.sales-fd3.workers.dev';
const SITE = 'https://wnba.propbetedge.ai';
const outDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'qa-artifacts/visuals-canary';
const jsonOut = (process.argv.find((a) => a.startsWith('--json=')) || '').split('=')[1];
fs.mkdirSync(outDir, { recursive: true });
const get = async (p) => (await fetch(`${NEWS}${p}${p.includes('?') ? '&' : '?'}cb=${Date.now()}`)).json();
const list = (await get('/v1/articles?limit=200')).data.items;
const DESKS = [['result', ['result']], ['performance', ['performance']], ['preview', ['preview']], ['injury', ['injury']], ['transaction', ['transaction']], ['trend', ['trend']], ['brief', ['brief']], ['international', ['international']], ['winba', ['winba_index']], ['feature', ['commissioned_feature']]];
const origin = (c) => c.first_published_at || c.published_at || '';
const plotted = (v) => {
  if (v.type === 'grouped_bars') return v.rows.map((r) => `${r.label} ${r.values.join('/')}${r.delta !== null && r.delta !== undefined ? ` (${r.delta > 0 ? '+' : ''}${r.delta})` : ''}`).join('; ');
  if (v.type === 'diverging_bars' || v.type === 'impact_bars') return v.rows.map((r) => `${r.label} ${r.value}`).join('; ');
  if (v.type === 'game_strip') return v.strips.map((s) => `${s.label}: ${s.items.map((i) => i.result).join(' ')}`).join(' | ');
  if (v.type === 'stat_compare') return `${v.columns.map((c) => c.label).join(' / ')} — ${v.rows.map((r) => `${r.label} ${r.values.map((x) => (x === null ? '—' : x)).join('/')}`).join('; ')}`;
  if (v.type === 'component_bars') return `total ${v.total}; ${v.rows.map((r) => `${r.label} ${r.value}`).join('; ')}`;
  if (v.type === 'line_series') return v.series.map((p) => `${p.label} ${p.value}`).join('; ');
  if (v.type === 'rank_cards') return v.cards.map((c) => `No.${c.rank} ${c.entity.name} ${c.value}`).join('; ');
  return '';
};
const report = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [desk, kinds] of DESKS) {
  const cands = list.filter((c) => kinds.includes(c.kind)).sort((a, b) => origin(b).localeCompare(origin(a)));
  let pickA = null;
  for (const c of cands) { const a = (await get(`/v1/articles/${c.id}`)).data?.article; if (a && (a.visuals || []).length) { pickA = a; break; } }
  if (!pickA) { report.push({ desk, article: null, note: cands.length ? `no listed ${desk} article carries contract visuals` : `no listed ${desk} article` }); continue; }
  const a = pickA;
  const row = { desk, id: a.id, slug: a.slug, headline: a.headline, kind: a.kind, charts: a.visuals.map((v) => ({ id: v.id, type: v.type, requirement: v.requirement || null, source: v.provenance?.source, observed_at: v.provenance?.observed_at, values_hash: v.values_hash, values: plotted(v) })), pages: {} };
  for (const w of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    const res = await p.goto(`${SITE}/news/${a.slug}`, { waitUntil: 'networkidle', timeout: 60000 });
    const ssr = await res.text();
    const m = await p.evaluate(() => { const vw = document.documentElement.clientWidth; return { figures: [...document.querySelectorAll('.pv-figure')].map((f) => f.getAttribute('data-visual')), unverified: document.querySelectorAll('.pv-figure--unverified').length, scroll: document.documentElement.scrollWidth, vw, legacy: document.querySelectorAll('.article-analytics').length }; });
    const inHtml = a.visuals.filter((v) => ssr.includes(`data-visual="${v.id}"`)).length;
    const figs = await p.$$('.pv-figure');
    for (const [i, f] of figs.slice(0, 2).entries()) await f.screenshot({ path: path.resolve(outDir, `${desk}-${w}-${i}.png`) });
    row.pages[w] = { figures_drawn: m.figures.length, in_server_html: inHtml, unverified: m.unverified, overflow: m.scroll > m.vw + 1, legacy_dashboards: m.legacy, page_errors: errors.length, pass: m.figures.length >= a.visuals.length && !m.unverified && m.scroll <= m.vw + 1 && !errors.length };
    await ctx.close();
  }
  report.push(row);
}
await browser.close();
for (const r of report) {
  if (!r.id) { console.log(`\n## ${r.desk}: ${r.note}`); continue; }
  console.log(`\n## ${r.desk} · ${r.headline}\n   /news/${r.slug}\n   charts ${r.charts.length}: ${r.charts.map((c) => `${c.id} (${c.type})`).join(', ')}\n   390: ${JSON.stringify(r.pages[390])}\n   1440: ${JSON.stringify(r.pages[1440])}`);
  for (const c of r.charts) console.log(`   - ${c.id} [${c.values_hash}] ${c.source} @ ${c.observed_at}\n       ${c.values.slice(0, 220)}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
