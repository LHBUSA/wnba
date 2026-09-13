#!/usr/bin/env node
// Post-build: publish the SPA shell as dist/app-shell.html.
//
// On Vercel every HTML route is proxied to the wnba-web publishing Worker, which composes the page into this
// shell. A dist/index.html would let Vercel's filesystem answer "/" directly (static files win over
// rewrites) and skip the Worker, so on Vercel the shell is moved, not copied. Locally (vite preview, QA)
// index.html is kept so the SPA still boots on its own.

import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const src = path.join(dist, 'index.html');
const dest = path.join(dist, 'app-shell.html');
if (!fs.existsSync(src)) { console.error('publish-shell: dist/index.html missing'); process.exit(1); }
const html = fs.readFileSync(src, 'utf8');
for (const marker of ['<!--seo:start-->', '<!--seo:end-->', '<div id="app"></div>']) {
  if (!html.includes(marker)) { console.error(`publish-shell: shell marker missing: ${marker}`); process.exit(1); }
}
fs.writeFileSync(dest, html);
if (process.env.VERCEL) fs.rmSync(src);
console.log(`publish-shell: dist/app-shell.html written${process.env.VERCEL ? ' (index.html removed for Vercel routing)' : ''}`);
