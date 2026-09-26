// PropBetEdge's own X identity (@PROPBETEDGE) in every server-rendered head and in the
// PropBetEdge Organization; stale identities and legacy share intents never return.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headTags } from '../src/seo/head.js';
import { routeMeta } from '../src/seo/meta.js';
import { siteEntities } from '../src/seo/jsonld.js';
import { PROPBETEDGE_X_URL, PROPBETEDGE_X_HANDLE } from '../src/seo/site.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STALE = [/x\.com\/MLBHRALERTSPBE/i, /@MLBHRALERTSPBE/i, /x\.com\/propbetedgeai/i, /@propbetedgeai/i, /twitter\.com\/intent/i, /x\.com\/intent\/tweet/i];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(m?js|html)$/.test(e.name)) out.push(full);
  }
  return out;
}

test('canonical X identity constants', () => {
  assert.equal(PROPBETEDGE_X_URL, 'https://x.com/PROPBETEDGE');
  assert.equal(PROPBETEDGE_X_HANDLE, '@PROPBETEDGE');
});

test('server head carries twitter:site once, next to a large-image card', () => {
  const h = headTags(routeMeta('home', { path: '/' }));
  assert.equal((h.match(/<meta name="twitter:site" content="@PROPBETEDGE" \/>/g) || []).length, 1);
  assert.match(h, /<meta name="twitter:card" content="summary_large_image" \/>/);
  const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal((shell.match(/<meta name="twitter:site" content="@PROPBETEDGE" \/>/g) || []).length, 1);
});

test('PropBetEdge Organization sameAs is the canonical X profile only', () => {
  const org = siteEntities().find((e) => e['@type'] === 'Organization' && e.name === 'PropBetEdge');
  assert.deepEqual(org.sameAs, [PROPBETEDGE_X_URL]);
});

test('no stale PropBetEdge X identity or legacy share intent in production source', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'workers')), path.join(ROOT, 'index.html')];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of STALE) assert.doesNotMatch(text, re, `${path.relative(ROOT, file)} contains ${re}`);
  }
});

test('footer: exactly one visible PropBetEdge X link, new tab, safe rel, accessible name', async () => {
  const { shellHtml } = await import('../src/ui/shell.js');
  const doc = String(shellHtml());
  const footer = doc.slice(doc.indexOf('<footer'), doc.indexOf('</footer>'));
  const anchors = [...footer.matchAll(/<a [^>]*href="https:\/\/x\.com\/PROPBETEDGE"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  assert.equal(anchors.length, 1);
  assert.match(anchors[0], /target="_blank" rel="noopener noreferrer"/);
  assert.match(anchors[0], /aria-label="Follow PropBetEdge on X \(@PROPBETEDGE\)"/);
  assert.match(anchors[0], /<\/span> @PROPBETEDGE<\/a>$/);
  assert.equal((doc.match(/x\.com\/PROPBETEDGE/g) || []).length, 1, 'no duplicate PropBetEdge X control anywhere in the shell');
});
