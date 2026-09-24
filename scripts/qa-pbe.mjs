#!/usr/bin/env node
// PBE Picks screen + leak QA. Serves nothing itself: point it at a running build (vite preview).
//
//   node scripts/qa-pbe.mjs http://127.0.0.1:5192 [--widths=1440,390] [--out=qa-artifacts/pbe]
//
// The wnba-api responses are produced by the REAL handlers (workers/wnba-api/src/pbe.js, account.js) running in
// this process over real 2025–2026 rows and the live odds snapshot, then served to the browser through
// Playwright route interception. For every persona the browser sees exactly what production would return.
// Personas: signed_out, free, pro (published), pro_validation (not published), all_access (published), owner (shadow).
// Checks: horizontal overflow, console/page errors, and — for every non-Pro view — no paid field anywhere in the
// DOM or in any PBE/account network response.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pbePicks, pbeGame, pbeTeam, pbeCoverage, pbeStatus, trackRecordLedger, trackRecordPublic } from '../workers/wnba-api/src/pbe.js';
import { resolveAccount } from '../workers/wnba-api/src/account.js';
import { signSession, SESSION_COOKIE, privateJson } from '../workers/wnba-api/src/auth.js';
import { buildPredictionDoc, lockDoc } from '../workers/shared/pbe-runtime.js';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:5192').replace(/\/$/, '');
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const widths = opt('widths', '1440,390').split(',').map(Number);
const OUT = path.resolve(opt('out', 'qa-artifacts/pbe'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUBLIC_API = 'https://wnba-api.sales-fd3.workers.dev';
const PRIVATE_API = 'https://wnba-api.propbetedge.ai';
const PAID = /p_home|p_away|pick_probability|win_probability|team_probability|feature_vector|feature_hash|pbe_edge|"supporting"|"opposing"|devig|consensus_moneyline|"confidence"|pick_team_id|Why PBE likes|What works against/;
const SECRET = 'qa-session-secret-0123456789abcdef';

// ------------------------------------------------------------------ real documents from real inputs
const rows = zlib.gunzipSync(fs.readFileSync('tests/fixtures/pbe-wnba-model/rows-2025-2026.jsonl.gz')).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const odds = await (await fetch(`${PUBLIC_API}/v1/odds`)).json();
const teams = (await (await fetch(`${PUBLIC_API}/v1/teams`)).json()).data.teams;
const tInfo = (id) => { const t = teams.find((x) => x.team_id === String(id)); return t ? { team_id: t.team_id, abbr: t.abbr, name: t.name, short_name: t.short_name } : { team_id: String(id) }; };
const docs = [];
for (const e of odds.data.events.filter((x) => x.game_id)) {
  const game = { event_id: e.game_id, season: 2026, season_type: 2, start_utc: new Date(e.commence_time).toISOString(), neutral: false, home_id: e.home_team_id, away_id: e.away_team_id, home: tInfo(e.home_team_id), away: tInfo(e.away_team_id) };
  try {
    docs.push(await buildPredictionDoc({ game, leagueRows: rows, asOf: new Date().toISOString(), marketEvent: e, marketCapturedAt: odds.data.captured_at, runId: 'qa', mode: 'dry_run' }));
  } catch (err) { console.warn('skip', e.game_id, err.message); }
}
console.log(`built ${docs.length} prediction documents from live odds events`);

function kv() {
  const m = new Map();
  return { async get(k, t) { const v = m.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); } };
}
const store = kv();
const index = { generated_at: new Date(Date.now() - 6 * 60e3).toISOString(), games: [], locked_history: [] };
for (const [i, d] of docs.entries()) {
  for (const ledger of ['official', 'shadow']) await store.put(`pbe:v1:${ledger}:pred:${d.game.game_id}`, JSON.stringify({ ...d, generated_at: index.generated_at }));
  index.games.push({ game_id: d.game.game_id, scheduled_tip_utc: d.game.scheduled_tip_utc, home_team_id: d.game.home_team_id, away_team_id: d.game.away_team_id, locked: i === 0 });
}
if (docs[0]) { // one locked call so the LOCKED state renders
  for (const ledger of ['official', 'shadow']) await store.put(`pbe:v1:${ledger}:lock:${docs[0].game.game_id}`, JSON.stringify(lockDoc(docs[0], { ledger })));
  index.locked_history.push(docs[0].game.game_id);
}
for (const ledger of ['official', 'shadow']) await store.put(`pbe:v1:${ledger}:index`, JSON.stringify(index));

// Billing verdict mock = the deployed propbetedge-sports-billing shape incl. access_source + subscription.product_key,
// so the shared membership contract (workers/wnba-api/src/pbe-membership.js) renders every state the browser can see.
const LEDGER = {
  'pro@qa.test': { access_source: 'sport', subscription: { product_key: 'wnba_pro', plan: 'monthly', status: 'active', current_period_end: '2026-10-15T00:00:00Z', cancel_at_period_end: false } },
  'allaccess@qa.test': { access_source: 'all_access', subscription: { product_key: 'pbe_all_access', plan: 'monthly', status: 'active', current_period_end: '2026-10-24T00:00:00Z', cancel_at_period_end: false } },
  'owner@qa.test': null,
  'free@qa.test': null
};
const billing = { async fetch(url, init) { const b = JSON.parse(init.body); const e = b.product_key === 'wnba_pro' ? LEDGER[b.email] : null; return new Response(JSON.stringify({ entitled: Boolean(e), product_key: b.product_key, access_source: e ? e.access_source : null, subscription: e ? e.subscription : null }), { status: 200 }); } };
const PERSONAS = {
  signed_out: { email: null, publish: 'true' },
  free: { email: 'free@qa.test', publish: 'true' },
  pro: { email: 'pro@qa.test', publish: 'true' },
  pro_validation: { email: 'pro@qa.test', publish: 'false' },
  all_access: { email: 'allaccess@qa.test', publish: 'true' },
  owner: { email: 'owner@qa.test', publish: 'false' }
};
const envFor = (p) => ({ WNBA_SESSION_SECRET: SECRET, WNBA_KV: store, BILLING: billing, ENTITLEMENT_READ_TOKEN: 't', PBE_PUBLISH: p.publish, WNBA_OWNER_EMAILS: 'owner@qa.test', PBE_MODE: 'dry_run' });

async function privateResponse(persona, url, method) {
  const p = PERSONAS[persona];
  const headers = { origin: 'https://wnba.propbetedge.ai' };
  if (p.email) headers.cookie = `${SESSION_COOKIE}=${await signSession({ email: p.email, sid: 'sid_qa_000000000000' }, SECRET)}`;
  const request = new Request(url, { method, headers });
  const env = envFor(p);
  const u = new URL(url);
  const m = u.pathname.match(/^\/v1\/pbe\/(games|teams)\/([A-Za-z0-9_-]+)$/);
  if (u.pathname === '/v1/account') return privateJson(request, { ok: true, data: await resolveAccount(request, env) });
  if (u.pathname === '/v1/pbe/picks') return pbePicks({ request, env });
  if (m?.[1] === 'games') return pbeGame({ request, env, params: { id: m[2] } });
  if (m?.[1] === 'teams') return pbeTeam({ request, env, params: { id: m[2] } });
  if (u.pathname === '/v1/track-record/ledger') return trackRecordLedger({ request, env });
  return privateJson(request, { ok: false, error: { code: 'not_found' } }, 404);
}

// ------------------------------------------------------------------ browser
const ROUTES = ['/pbe-picks', '/teams/20', '/teams/18', '/track-record', '/pro', '/pbe-picks/model'];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = [];
let failures = 0;
const healthBody = JSON.stringify({ ok: true, service: 'wnba-api', routes: ['/health', '/v1/pbe/status', '/v1/pbe/coverage', '/v1/pbe/picks'] });

for (const persona of Object.keys(PERSONAS)) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w >= 1000 ? 900 : 844 }, deviceScaleFactor: w >= 1000 ? 1 : 2, isMobile: w < 1000, hasTouch: w < 1000 });
    const seen = [];
    await ctx.route(`${PUBLIC_API}/health`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: healthBody }));
    await ctx.route(`${PUBLIC_API}/v1/pbe/status`, async (r) => { const res = await pbeStatus({ env: envFor(PERSONAS[persona]) }); const body = await res.text(); seen.push(['status', body]); r.fulfill({ status: res.status, contentType: 'application/json', body }); });
    await ctx.route(`${PUBLIC_API}/v1/pbe/coverage`, async (r) => { const res = await pbeCoverage({ env: envFor(PERSONAS[persona]) }); const body = await res.text(); seen.push(['coverage', body]); r.fulfill({ status: res.status, contentType: 'application/json', body }); });
    await ctx.route(`${PUBLIC_API}/v1/track-record`, async (r) => { const res = await trackRecordPublic({ env: envFor(PERSONAS[persona]) }); const body = await res.text(); seen.push(['track', body]); r.fulfill({ status: res.status, contentType: 'application/json', body }); });
    await ctx.route(`${PRIVATE_API}/**`, async (r) => {
      const req = r.request();
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
      const res = await privateResponse(persona, req.url(), req.method());
      const body = await res.text();
      seen.push([new URL(req.url()).pathname, body]);
      r.fulfill({ status: res.status, contentType: 'application/json', body, headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' } });
    });
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const rec = { persona, width: w, route, console: [], pageErrors: [], overflow: null, leak: [] };
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) rec.console.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => rec.pageErrors.push(String(e).slice(0, 200)));
      seen.length = 0;
      await page.goto(base + route, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);
      await page.bringToFront();
      rec.overflow = await page.evaluate(() => (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? document.documentElement.scrollWidth : null));
      const nonPro = persona === 'signed_out' || persona === 'free' || persona === 'pro_validation';
      if (nonPro) {
        const dom = await page.content();
        if (PAID.test(dom)) rec.leak.push(`DOM: ${dom.match(PAID)[0]}`);
        for (const [what, body] of seen) if (PAID.test(body)) rec.leak.push(`${what}: ${body.match(PAID)[0]}`);
      }
      const name = `${persona}-${w}-${route === '/' ? 'root' : route.slice(1).replaceAll('/', '_')}`;
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
      await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
      const bad = rec.console.length || rec.pageErrors.length || rec.overflow || rec.leak.length;
      if (bad) failures += 1;
      console.log(`${bad ? 'FAIL' : 'PASS'} ${persona.padEnd(15)} ${w} ${route}${rec.overflow ? ` overflow:${rec.overflow}` : ''}${rec.leak.length ? ` LEAK:${rec.leak.join(';')}` : ''}${rec.console.length ? ` console:${rec.console.join(' | ')}` : ''}${rec.pageErrors.length ? ` errors:${rec.pageErrors.join(' | ')}` : ''}`);
      report.push(rec);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`qa-pbe: ${failures} FAIL of ${report.length} → ${OUT}`);
process.exit(failures ? 1 : 0);
