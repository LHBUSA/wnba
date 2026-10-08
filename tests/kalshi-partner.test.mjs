// Kalshi PERPETUALS partner offer (kalshi-partner/2) on WNBA: vendored client unchanged, one footer
// mount, same-origin fixed rewrites, fail closed, and no offer economics/referral id in WNBA source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { partnerOffer, normalizeConfig, PARTNER_DISABLED } from '../src/vendor/kalshi/kalshi-partner.js';

const VENDORED = 'src/vendor/kalshi/kalshi-partner.js';
const COMPONENT = 'src/partner/kalshi-partner-footer.js';
const CANONICAL = 'D:/Workers/propbetedge-workers/workers/propsports-markets/client/kalshi-partner.js';
// SHA-256 (LF) of the canonical client at propbetedge-workers 4c3972a.
const PINNED = '063e631feadb8011fd6e1a3e7cc92908dd7f402f69fd3f5cb0153b5db4b09b7f';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p.replace(/\\/g, '/'));
  }
  return out;
};

test('kalshi-partner.js is vendored byte-identical', () => {
  assert.equal(sha(VENDORED), PINNED, 'vendored kalshi-partner.js was edited; re-vendor it from the canonical source');
});

test('vendored kalshi-partner.js matches the canonical file when it is present', { skip: !fs.existsSync(CANONICAL) && 'canonical checkout absent' }, () => {
  assert.equal(sha(VENDORED), sha(CANONICAL), 'canonical kalshi-partner.js changed; re-vendor it and update PINNED');
});

test('same-origin rewrites are fixed paths to propsports-markets only, ahead of the wnba-web catch-all', () => {
  const { rewrites } = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const kx = rewrites.filter((r) => r.source.startsWith('/go/kalshi'));
  assert.deepEqual(kx, [
    { source: '/go/kalshi-perps/config', destination: 'https://propsports-markets.sales-fd3.workers.dev/v1/partner/kalshi' },
    { source: '/go/kalshi-perps', destination: 'https://propsports-markets.sales-fd3.workers.dev/go/kalshi-perps' }
  ]);
  for (const r of kx) assert.doesNotMatch(r.source + r.destination, /\/:|\(|\*|\$/);
  const catchAll = rewrites.findIndex((r) => r.source === '/:path*');
  assert.ok(catchAll > rewrites.indexOf(kx[1]), 'partner rewrites must precede the wnba-web catch-all');
});

test('exactly one mount: the network footer, footer variant, wnba attribution', () => {
  const comp = fs.readFileSync(COMPONENT, 'utf8');
  assert.match(comp, /placement: 'sport_footer', product: 'wnba', sport: 'wnba'/);
  assert.match(comp, /variant: 'footer'/);
  assert.match(comp, /loadPartnerConfig\(PARTNER_CONFIG_URL\)/);
  assert.match(comp, /'\/go\/kalshi-perps\/config'/);
  assert.match(comp, /footer\.foot \.foot-in/);

  const files = walk('src').filter((f) => /\.(js|mjs)$/.test(f));
  const importers = files.filter((f) => f !== VENDORED && /from ['"][^'"]*kalshi-partner\.js['"]|import\(['"][^'"]*kalshi-partner\.js/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(importers, [COMPONENT]);
  const mounters = files.filter((f) => /mountKalshiPartnerFooter\(\)/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(mounters, ['src/main.js']);
  // The publishing Worker's SSR shell carries no partner markup.
  assert.doesNotMatch(fs.readFileSync('src/ui/shell.js', 'utf8'), /kxo|kalshi-partner/);
});

test('no referral id, referral URL or offer economics hardcoded in WNBA source', () => {
  for (const f of [...walk('src'), 'index.html', 'vercel.json']) {
    if (f === VENDORED || !/\.(js|mjs|css|html|json)$/.test(f)) continue;
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /kalshi\.com\/p\/|referral[=]/i, `${f} carries a referral URL`);
  }
  const comp = fs.readFileSync(COMPONENT, 'utf8') + fs.readFileSync('src/styles/kalshi-partner.css', 'utf8');
  assert.doesNotMatch(comp, /\$\d|\d+\s?% off|\d+ (months?|years?)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, 'economics and the referral id live only in the propsports-markets Worker');
});

test('fail closed: disabled or malformed config renders nothing', () => {
  const ctx = { placement: 'sport_footer', product: 'wnba', sport: 'wnba' };
  assert.equal(partnerOffer(PARTNER_DISABLED, ctx, { variant: 'footer' }), '');
  assert.equal(partnerOffer(normalizeConfig(null), ctx, { variant: 'footer' }), '');
  assert.equal(partnerOffer(normalizeConfig({ contract: 'kalshi-partner/2', enabled: true, path: 'https://evil.example/', program: 'perpetuals' }), ctx, { variant: 'footer' }), '');
  const html = partnerOffer(normalizeConfig({ contract: 'kalshi-partner/2', enabled: true, path: '/go/kalshi-perps', program: 'perpetuals' }), ctx, { variant: 'footer' });
  assert.match(html, /class="kxo kxo--footer kxo--generic"/);
  assert.match(html, /href="\/go\/kalshi-perps\?placement=sport_footer&amp;product=wnba&amp;sport=wnba"/);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
});
