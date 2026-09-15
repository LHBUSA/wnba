#!/usr/bin/env node
// Real-browser production auth check (Chrome via Playwright, real site, real wnba-api, real cookies).
//
//   node scripts/auth/wnba-browser-auth-check.mjs
//
// It does NOT send email: one-time links are seeded into production KV exactly as POST /v1/auth/request stores
// them (sha256 of a random token, 15-min TTL) and then redeemed the way a person does: open the link, press
// Continue. Email delivery and the owner's own click are separate, human steps.
// Personas: owner (server-side WNBA_OWNER_EMAILS, read from the operator file, never printed) and an NBA-Pro-only
// synthetic subscriber created through signed Stripe events (cleaned up at the end).
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const SITE = 'https://wnba.propbetedge.ai';
const API = 'https://wnba-api.propbetedge.ai';
const BILLING = 'https://propbetedge-sports-billing.sales-fd3.workers.dev';
const SECRETS = 'D:/Workers/secrets';
const OWNER = fs.readFileSync(`${SECRETS}/ufc-owner-email`, 'utf8').trim().toLowerCase();
const WHSEC = fs.readFileSync(`${SECRETS}/pbe-billing-stripe-webhook-secret`, 'utf8').trim();
const DB = Object.fromEntries(fs.readFileSync(`${SECRETS}/pbe-billing-supabase.env`, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const RUN = `wnbabrowser${Date.now().toString(36)}`;
const redact = (s) => String(s).replace(OWNER, '<owner>').replace(/t=[A-Za-z0-9_-]{20,}/g, 't=<redacted>');

function seedLink(email, next) {
  const token = crypto.randomBytes(32).toString('base64url');
  const file = `${process.env.TEMP || '.'}/wnba-browser-${crypto.randomBytes(6).toString('hex')}.json`;
  fs.writeFileSync(file, JSON.stringify({ email, next, created_at: new Date().toISOString() }));
  const r = spawnSync('npx', ['wrangler', 'kv', 'key', 'put', `auth:link:${crypto.createHash('sha256').update(token).digest('hex')}`, '--path', file, '--namespace-id', 'c3249a8e3552438da38c6cad0d54e172', '--remote', '--ttl', '900'], { encoding: 'utf8', shell: true, cwd: 'workers/wnba-api' });
  fs.rmSync(file, { force: true });
  if (r.status !== 0) throw new Error('kv seed failed');
  return token;
}
let seq = 0;
async function stripe(type, object, created = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify({ id: `evt_canary_${RUN}_${++seq}`, object: 'event', type, created, livemode: true, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const r = await fetch(`${BILLING}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex')}` }, body });
  if (r.status !== 200) throw new Error(`webhook ${r.status}`);
}

const results = [];
const step = (name, pass, detail) => { results.push({ step: name, pass, detail: redact(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} | ${redact(detail)}`); };

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

async function humanSignIn(ctx, email, next) {
  const page = await ctx.newPage();
  const errors = [];
  const api = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/cloudflareinsights|favicon/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.url().startsWith(API)) api.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  const token = seedLink(email, next);
  await page.goto(`${API}/v1/auth/verify?t=${token}`, { waitUntil: 'load' });
  const title = await page.title();
  await Promise.all([page.waitForURL(`${SITE}/**`, { timeout: 20000 }).catch(() => {}), page.click('button[type=submit]')]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  return { page, token, title, errors, api };
}
const apiCookie = async (ctx) => (await ctx.cookies(API)).find((c) => c.name === '__Host-wnba_session');

// ------------------------------------------------------------------ owner
{
  const ctx = await browser.newContext();
  const { page, token, title, errors, api } = await humanSignIn(ctx, OWNER, '/pbe-picks');
  const c = await apiCookie(ctx);
  step('owner: open link → confirm page → Continue → lands on the WNBA site', page.url() === `${SITE}/pbe-picks`, `confirm page "${title}" → ${page.url()}`);
  step('owner: session cookie created with the right attributes', Boolean(c && c.secure && c.httpOnly && c.sameSite === 'Lax' && c.path === '/' && c.domain === 'wnba-api.propbetedge.ai'), c ? `${c.name} domain=${c.domain} path=${c.path} secure=${c.secure} httpOnly=${c.httpOnly} sameSite=${c.sameSite} expires=${new Date(c.expires * 1000).toISOString()}` : 'no cookie');
  const acct = await page.evaluate(async (u) => (await fetch(`${u}/v1/account`, { credentials: 'include' })).json(), API);
  step('owner: account resolves to WNBA Pro · Owner through the server boundary', acct.data?.state === 'pro' && acct.data?.access === 'owner', `state=${acct.data?.state} access=${acct.data?.access} entitlement_check=${acct.data?.entitlement_check}`);
  step('owner: PBE Picks page opened and its protected API returned 200', api.some((x) => x === 'GET /v1/pbe/picks 200') && (await page.locator('h1').first().textContent()).includes('PBE Picks'), api.filter((x) => /pbe|account/.test(x)).join(' · '));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const again = await page.evaluate(async (u) => { const r = await fetch(`${u}/v1/pbe/picks`, { credentials: 'include' }); return { status: r.status, body: await r.json() }; }, API);
  step('owner: refresh retains the session (protected API still 200)', again.status === 200, `status ${again.status} availability ${again.body.data?.availability}`);
  const team = await ctx.newPage();
  const teamApi = [];
  team.on('response', (r) => { if (r.url().startsWith(API)) teamApi.push(`${new URL(r.url()).pathname} ${r.status()}`); });
  await team.goto(`${SITE}/teams/20`, { waitUntil: 'networkidle' });
  await team.waitForTimeout(2000);
  step('owner: second protected page (team PBE Picker) works in a new tab', teamApi.includes('/v1/pbe/teams/20 200'), teamApi.join(' · '));
  const pro = await ctx.newPage();
  await pro.goto(`${SITE}/pro`, { waitUntil: 'networkidle' });
  await pro.waitForTimeout(2000);
  const badge = (await pro.locator('.pro-state').first().textContent().catch(() => '')) || '';
  step('owner: Account (WNBA Pro page) shows the correct access', /WNBA Pro · Owner/.test(badge), badge.trim());
  const oldCookie = c?.value;
  await Promise.all([pro.waitForEvent('load').catch(() => {}), pro.click('[data-logout]')]);
  await pro.waitForTimeout(3000);
  const after = await pro.evaluate(async (u) => { const a = await (await fetch(`${u}/v1/account`, { credentials: 'include' })).json(); const p = await fetch(`${u}/v1/pbe/picks`, { credentials: 'include' }); return { state: a.data?.state, picks: p.status }; }, API);
  step('owner: logout in the UI signs the browser out; protected request 401', after.state === 'signed_out' && after.picks === 401, `account ${after.state} · picks ${after.picks}`);
  const replay = await fetch(`${API}/v1/pbe/picks`, { headers: { origin: SITE, cookie: `__Host-wnba_session=${oldCookie}` } });
  const replayAcct = await (await fetch(`${API}/v1/account`, { headers: { origin: SITE, cookie: `__Host-wnba_session=${oldCookie}` } })).json();
  step('owner: the logged-out cookie replayed elsewhere is revoked', replay.status === 401 && replayAcct.data?.reason === 'session_revoked', `picks ${replay.status} · account ${replayAcct.data?.state}/${replayAcct.data?.reason}`);
  const reuse = await fetch(`${API}/v1/auth/verify`, { method: 'POST', redirect: 'manual', headers: { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${token}&n=${'x'.repeat(32)}` });
  step('owner: the used link cannot be replayed', reuse.status === 403 || reuse.status === 410, `replay → ${reuse.status}`);
  step('owner: no console errors on the site during the flow', errors.length === 0, errors.join(' | ') || 'none');
  await ctx.close();
}

// ------------------------------------------------------------------ NBA Pro only (cross-sport isolation)
{
  const p = { email: `wnba-browser-canary+${RUN}-nba@propbetedge.ai`, sub: `sub_canary_${RUN}_nba`, cs: `cs_canary_${RUN}_nba`, cus: `cus_canary_${RUN}_nba` };
  await stripe('checkout.session.completed', { id: p.cs, object: 'checkout.session', mode: 'subscription', payment_link: 'plink_1UEWmAF3CaVzg4ORitxLA3Z3', subscription: p.sub, customer: p.cus, payment_status: 'paid', customer_details: { email: p.email }, metadata: { acquired_sport: 'nba', product: 'propbetedge_nba', product_key: 'nba_pro', plan: 'pro_monthly', trial: 'none' } });
  await stripe('customer.subscription.created', { id: p.sub, object: 'subscription', status: 'active', customer: p.cus, cancel_at_period_end: false, items: { data: [{ id: 'si', price: { id: 'price_1UEWlFF3CaVzg4ORMlI1eb3j' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } });
  const ctx = await browser.newContext();
  const { page } = await humanSignIn(ctx, p.email, '/pbe-picks');
  const r = await page.evaluate(async (u) => { const a = await (await fetch(`${u}/v1/account`, { credentials: 'include' })).json(); const k = await fetch(`${u}/v1/pbe/picks`, { credentials: 'include' }); return { state: a.data?.state, picks: k.status, text: await k.text() }; }, API);
  const teaser = await page.locator('.pbe-teaser').count();
  step('NBA-Pro-only subscriber authenticates but gets no WNBA paid access (403, teaser)', page.url() === `${SITE}/pbe-picks` && r.state === 'free' && r.picks === 403 && teaser > 0 && !/p_home|pick_probability/.test(r.text), `landed ${page.url()} · account ${r.state} · picks ${r.picks} · teaser ${teaser}`);
  await ctx.close();
  const h = { apikey: DB.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${DB.SUPABASE_SERVICE_ROLE_KEY}` };
  await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_entitlements?stripe_subscription_id=like.sub_canary_${RUN}_*`, { method: 'DELETE', headers: h });
  await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_stripe_events?event_id=like.evt_canary_${RUN}_*`, { method: 'DELETE', headers: h });
}

// ------------------------------------------------------------------ forged cookie / foreign origin in a browser
{
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: '__Host-wnba_session', value: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.', domain: 'wnba-api.propbetedge.ai', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  await page.goto(`${SITE}/pbe-picks`, { waitUntil: 'networkidle' });
  const r = await page.evaluate(async (u) => (await fetch(`${u}/v1/pbe/picks`, { credentials: 'include' })).status, API);
  step('forged session cookie in a real browser → 401', r === 401, `picks ${r}`);
  const foreign = await fetch(`${API}/v1/pbe/picks`, { headers: { origin: 'https://evil.example' } });
  step('foreign origin gets no credentialed CORS', !foreign.headers.get('access-control-allow-origin'), `ACAO ${foreign.headers.get('access-control-allow-origin')}`);
  await ctx.close();
}

await browser.close();
const passed = results.filter((r) => r.pass).length;
fs.mkdirSync('docs/evidence/auth', { recursive: true });
fs.writeFileSync(`docs/evidence/auth/wnba-browser-auth-check-${RUN}.json`, JSON.stringify({ run: RUN, at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
console.log(`browser auth check ${RUN}: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
