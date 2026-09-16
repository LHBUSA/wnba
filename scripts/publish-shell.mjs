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
import { intelligenceFeature } from '../src/data/pro-features.js';

const dist = path.resolve('dist');
const src = path.join(dist, 'index.html');
const dest = path.join(dist, 'app-shell.html');
if (!fs.existsSync(src)) { console.error('publish-shell: dist/index.html missing'); process.exit(1); }
const html = fs.readFileSync(src, 'utf8');
for (const marker of ['<!--seo:start-->', '<!--seo:end-->', '<div id="app"></div>']) {
  if (!html.includes(marker)) { console.error(`publish-shell: shell marker missing: ${marker}`); process.exit(1); }
}

fs.writeFileSync(dest, html);

const rotation = intelligenceFeature('rotation-impact');
if (!rotation) { console.error('publish-shell: rotation-impact feature missing'); process.exit(1); }
const rotationHead = `<!--seo:start-->
    <title>WNBA Rotation Impact: Availability, Workload &amp; Opportunity Pressure | PropBetEdge</title>
    <meta name="description" content="WNBA Pro Rotation Impact combines Player Load, sourced availability and recent baseline minutes into a team-by-team rotation pressure desk." />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <link rel="canonical" href="https://wnba.propbetedge.ai/rotation-impact" />
    <meta property="og:site_name" content="PropBetEdge WNBA" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://wnba.propbetedge.ai/rotation-impact" />
    <meta property="og:title" content="WNBA Rotation Impact | PropBetEdge" />
    <meta property="og:description" content="Player Load, sourced availability and recent baseline minutes combined into a team-by-team rotation pressure desk." />
    <meta property="og:image" content="https://wnba.propbetedge.ai/share/propbetedge-wnba-social-v2.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="WNBA Rotation Impact | PropBetEdge" />
    <meta name="twitter:description" content="Player Load, sourced availability and recent baseline minutes combined into a team-by-team rotation pressure desk." />
    <meta name="twitter:image" content="https://wnba.propbetedge.ai/share/propbetedge-wnba-social-v2.jpg" />
    <!--seo:end-->`;
const rotationShell = String(shellHtml({ main: proFeaturePublicView(rotation), ssrPath: '/rotation-impact' }));
const rotationHtml = html
  .replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, rotationHead)
  .replace('<div id="app"></div>', `<div id="app">${rotationShell}</div>`);
fs.writeFileSync(path.join(dist, 'rotation-impact.html'), rotationHtml);

if (process.env.VERCEL) fs.rmSync(src);
console.log(`publish-shell: dist/app-shell.html + dist/rotation-impact.html written${process.env.VERCEL ? ' (index.html removed for Vercel routing)' : ''}`);
