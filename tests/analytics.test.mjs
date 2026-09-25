import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { GA_ID, initAnalytics, trackPageView } from '../src/analytics.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

function browser(url = 'https://wnba.propbetedge.ai/players/4433403') {
  const location = new URL(url);
  const appended = [];
  const listeners = new Map();
  const win = { location };
  const doc = {
    title: 'Caitlin Clark | PropBetEdge WNBA',
    head: { appendChild(node) { appended.push(node); } },
    querySelector() { return null; },
    createElement(tag) {
      return { tagName: tag.toUpperCase(), dataset: {}, async: false, src: '', crossOrigin: '' };
    },
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
  return { win, doc, appended, listeners };
}

test('GA4 loads only on the production WNBA host and queues config without an automatic duplicate page view', () => {
  const prod = browser();
  assert.equal(initAnalytics({ win: prod.win, doc: prod.doc }), true);
  assert.equal(prod.appended.length, 1);
  assert.equal(prod.appended[0].src, `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`);
  assert.equal(prod.appended[0].dataset.pbeGa4, GA_ID);

  const queue = prod.win.dataLayer.map((args) => Array.from(args));
  const config = queue.find((args) => args[0] === 'config' && args[1] === GA_ID);
  assert.ok(config, 'GA4 config is queued');
  assert.equal(config[2].send_page_view, false);
  assert.equal(config[2].cookie_domain, '.propbetedge.ai');

  assert.equal(trackPageView({ routeId: 'player', path: '/players/4433403', win: prod.win, doc: prod.doc }), true);
  const event = prod.win.dataLayer.map((args) => Array.from(args)).find((args) => args[0] === 'event' && args[1] === 'page_view');
  assert.ok(event, 'manual SPA page_view is queued');
  assert.equal(event[2].page_path, '/players/4433403');
  assert.equal(event[2].pbe_route_id, 'player');
  assert.equal(event[2].pbe_surface, 'wnba');

  const preview = browser('https://wnba-abc-justins-projects-ad4f4bb7.vercel.app/');
  assert.equal(initAnalytics({ win: preview.win, doc: preview.doc }), false);
  assert.equal(preview.appended.length, 0);
});

test('WNBA shell has no inline analytics bootstrap and production CSP allows only the required GA endpoints', () => {
  const html = read('../index.html');
  const vercel = JSON.parse(read('../vercel.json'));
  const worker = read('../workers/wnba-web/src/index.js');
  const historical = read('../workers/wnba-web/src/index-historical.js');
  const main = read('../src/main.js');
  const router = read('../src/lib/router.js');

  assert.doesNotMatch(html, /PropBetEdge network analytics: GA4 wnba/);
  assert.doesNotMatch(html, /window\.gtag|googletagmanager\.com\/gtag\/js/);
  assert.match(main, /initAnalytics\(\)/);
  assert.match(main, /onMounted:[\s\S]*trackPageView/);
  assert.match(router, /onMounted\?\.\(\{ routeId: route\.id, path, params, query \}\)/);

  const csp = vercel.headers
    .flatMap((group) => group.headers || [])
    .find((h) => h.key === 'Content-Security-Policy')?.value;
  assert.ok(csp);
  for (const required of [
    "script-src 'self' https://www.googletagmanager.com",
    'https://www.google-analytics.com',
    'https://region1.google-analytics.com',
    'https://analytics.google.com'
  ]) assert.ok(csp.includes(required), required);

  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'inline scripts remain blocked');
  const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  // gtag's diagnostics beacon (https://www.googletagmanager.com/a?id=G-…) loads as an image; production logged it
  // blocked by img-src on /cast (2026-09-25). Only that host is added — no wildcard, no other Google domain.
  assert.equal(directive('img-src'), "img-src 'self' data: https://a.espncdn.com https://cdn.wnba.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com");
  assert.equal(directive('script-src'), "script-src 'self' https://www.googletagmanager.com");
  assert.equal(directive('connect-src'), "connect-src 'self' https://wnba-api.sales-fd3.workers.dev https://wnba-api.propbetedge.ai https://wnba-news.sales-fd3.workers.dev https://wnba-international.sales-fd3.workers.dev https://www.googletagmanager.com https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com");
  assert.doesNotMatch(directive('script-src'), /unsafe/);
  for (const source of [worker, historical]) {
    const served = source.match(/'content-security-policy': "([^"]+)"/)?.[1];
    assert.equal(served, csp, 'Cloudflare publishing CSP is identical to the Vercel CSP');
  }
});
