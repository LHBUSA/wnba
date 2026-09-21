#!/usr/bin/env node
// Post-build: publish the SPA shell as dist/app-shell.html.
//
// Most HTML routes are proxied to the wnba-web publishing Worker, which composes the page into this shell.
// Rotation Impact is temporarily served directly by Vercel while the publishing Worker rolls forward, so
// this build also emits a fully rendered public fallback page. That route therefore has meaningful HTML
// even if browser JavaScript, entitlement resolution, or the private API is unavailable.

import fs from 'node:fs';
import path from 'node:path';
import { shellHtml } from '../src/ui/shell.js';
import { proFeaturePublicView } from '../src/views/pro-intelligence.js';
import { playerLoadPublicView } from '../src/views/player-load.js';
import { historyView } from '../src/views/history.js';
import { winbaScoreView } from '../src/views/winba-score.js';
import { intelligenceFeature } from '../src/data/pro-features.js';
import { routeMeta } from '../src/seo/meta.js';
import { pageGraph } from '../src/seo/jsonld.js';
import { headTags } from '../src/seo/head.js';

const dist = path.resolve('dist');
const src = path.join(dist, 'index.html');
const dest = path.join(dist, 'app-shell.html');
if (!fs.existsSync(src)) { console.error('publish-shell: dist/index.html missing'); process.exit(1); }
const html = fs.readFileSync(src, 'utf8');
for (const marker of ['<!--seo:start-->', '<!--seo:end-->', '<div id="app"></div>']) {
  if (!html.includes(marker)) { console.error(`publish-shell: shell marker missing: ${marker}`); process.exit(1); }
}

fs.writeFileSync(dest, html);

function writeStaticRoute(route, pathname, filename, main = '') {
  const meta = routeMeta(route, { path: pathname });
  const graph = pageGraph(route, meta, {});
  const head = `<!--seo:start-->\n    ${headTags(meta, graph)}\n    <!--seo:end-->`;
  const body = String(shellHtml({ main, ssrPath: pathname }));
  const out = html
    .replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, head)
    .replace('<div id="app"></div>', `<div id="app">${body}</div>`);
  fs.writeFileSync(path.join(dist, filename), out);
}

const premiumRoutes = [
  ['edge-timeline', '/edge-timeline', 'edge-timeline.html'],
  ['rotation-impact', '/rotation-impact', 'rotation-impact.html'],
  ['scenario-lab', '/scenario-lab', 'scenario-lab.html'],
  ['watchlist', '/watchlist', 'watchlist.html']
];
for (const [route, pathname, filename] of premiumRoutes) {
  const feature = intelligenceFeature(route);
  if (!feature) { console.error(`publish-shell: ${route} feature missing`); process.exit(1); }
  writeStaticRoute(route, pathname, filename, proFeaturePublicView(feature));
}
writeStaticRoute('player-load', '/player-load', 'player-load.html', playerLoadPublicView());
writeStaticRoute('daily-brief', '/brief', 'brief.html');
writeStaticRoute('history', '/history', 'history.html', historyView());
writeStaticRoute('winba-score', '/winba-score', 'winba-score.html', winbaScoreView());

if (process.env.VERCEL) fs.rmSync(src);
console.log(`publish-shell: app shell + route-specific SEO shells written${process.env.VERCEL ? ' (index.html removed for Vercel routing)' : ''}`);
