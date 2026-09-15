#!/usr/bin/env node
// Production auth / session / access canaries for WNBA Pro (owner-approved 2026-09-15).
//
//   node scripts/auth/wnba-auth-canaries.mjs
//
// Real production path end to end, no mocks:
//   personas   signed synthetic Stripe events -> deployed propbetedge-sports-billing -> production entitlement ledger
//   sessions   one-time sign-in links seeded into production KV (sha256 of a random token, 15-min TTL, exactly what
//              POST /v1/auth/request stores), then consumed through the REAL POST /v1/auth/verify on
//              wnba-api.propbetedge.ai, which issues the real __Host-wnba_session cookie
//   access     every protected route on wnba-api.propbetedge.ai, bodies scanned for paid fields
// Email delivery itself is proven separately (a real link to the owner inbox). Cleanup: canary ledger + event rows.
// Reads (never prints) D:\Workers\secrets\pbe-billing-stripe-webhook-secret and pbe-billing-supabase.env.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const API = 'https://wnba-api.propbetedge.ai';
const APP = 'https://wnba.propbetedge.ai';
const BILLING = 'https://propbetedge-sports-billing.sales-fd3.workers.dev';
const KV_NS = 'c3249a8e3552438da38c6cad0d54e172';
const SECRETS = 'D:/Workers/secrets';
const WHSEC = fs.readFileSync(`${SECRETS}/pbe-billing-stripe-webhook-secret`, 'utf8').trim();
const DB = Object.fromEntries(fs.readFileSync(`${SECRETS}/pbe-billing-supabase.env`, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const PAID = /p_home|p_away|pick_probability|win_probability|team_probability|feature_vector|feature_hash|pbe_edge|"supporting"|"opposing"|devig|consensus_moneyline|"confidence"|pick_team_id/;

const RUN = `wnbaauth${Date.now().toString(36)}`;
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const W = { monthly: { price: 'price_1UEfAmF3CaVzg4OReyWRioNO', link: 'plink_1UEfBOF3CaVzg4ORuxdQriRX' }, weekly: { price: 'price_1UEfAsF3CaVzg4OR7082zM5i', link: 'plink_1UEfBTF3CaVzg4ORy1GQeoI5' } };
const NBA = { price: 'price_1UEWlFF3CaVzg4ORMlI1eb3j', link: 'plink_1UEWmAF3CaVzg4ORitxLA3Z3' };
const NHL = { price: 'price_1UEWlLF3CaVzg4OROfzmSRU1', link: 'plink_1UEWmLF3CaVzg4ORwxmpwjSz' };
const UFC = { price: 'price_1UFbcDF3CaVzg4ORCf1e51tC', link: 'plink_1UFdRLF3CaVzg4ORUQBjDiJT' };
const persona = (tag) => ({ email: `wnba-auth-canary+${RUN}-${tag}@propbetedge.ai`, sub: `sub_canary_${RUN}_${tag}`, cs: `cs_canary_${RUN}_${tag}`, cus: `cus_canary_${RUN}_${tag}` });

let seq = 0;
async function stripe(type, object, created = now()) {
  const body = JSON.stringify({ id: `evt_canary_${RUN}_${++seq}`, object: 'event', type, created, livemode: true, data: { object } });
  const t = now();
  const sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex');
  const r = await fetch(`${BILLING}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body });
  if (r.status !== 200) throw new Error(`webhook ${type} ${r.status}`);
  return r.json();
}
const checkout = (p, link, sport, plan) => ({ id: p.cs, object: 'checkout.session', mode: 'subscription', payment_link: link, subscription: p.sub, customer: p.cus, payment_status: 'paid', customer_details: { email: p.email }, metadata: { acquired_sport: sport, product: `propbetedge_${sport}`, product_key: `${sport}_pro`, plan: `pro_${plan}`, trial: 'none' } });
const sub = (p, price, { status = 'active', end = now() + 30 * DAY, cancel = false } = {}) => ({ id: p.sub, object: 'subscription', status, customer: p.cus, cancel_at_period_end: cancel, items: { data: [{ id: `si_${RUN}`, price: { id: price }, current_period_end: end }] } });
async function grant(p, product, sport, plan, opts) { await stripe('checkout.session.completed', checkout(p, product.link, sport, plan)); await stripe('customer.subscription.created', sub(p, product.price, opts)); }

// Seed a one-time link exactly as POST /v1/auth/request stores it, then consume it through the real verify endpoint.
function kvPut(key, value, ttl) {
  const file = `${process.env.TEMP || '.'}/wnba-canary-${crypto.randomBytes(6).toString('hex')}.json`;
  fs.writeFileSync(file, value);
  const r = spawnSync('npx', ['wrangler', 'kv', 'key', 'put', key, '--path', file, '--namespace-id', KV_NS, '--remote', '--ttl', String(ttl)], { encoding: 'utf8', shell: true, cwd: 'workers/wnba-api' });
  fs.rmSync(file, { force: true });
  if (r.status !== 0) throw new Error(`kv put failed: ${(r.stderr || r.stdout).split('\n').filter((l) => /rror/.test(l)).join(' ').slice(0, 200)}`);
}
async function seedLink(email, ttl = 900) {
  const token = crypto.randomBytes(32).toString('base64url');
  kvPut(`auth:link:${crypto.createHash('sha256').update(token).digest('hex')}`, JSON.stringify({ email, next: '/pbe-picks', created_at: new Date().toISOString() }), ttl);
  return token;
}
// Redeem like a browser: open the confirm page (nonce cookie + form field), then POST with Origin: null as real
// browsers may send it. (2026-09-15 regression: the old Origin-only check refused exactly this request.)
async function consume(token) {
  const pageRes = await fetch(`${API}/v1/auth/verify?t=${token}`, { redirect: 'manual' });
  const nonceCookie = (pageRes.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('__Host-wnba_verify=')) || '';
  const n = ((await pageRes.text()).match(/name="n" value="([^"]+)"/) || [])[1] || '';
  return fetch(`${API}/v1/auth/verify`, { method: 'POST', redirect: 'manual', headers: { origin: 'null', cookie: nonceCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${token}&n=${n}` });
}
async function signIn(email) {
  const token = await seedLink(email);
  const r = await consume(token);
  const set = (r.headers.getSetCookie?.() || []).find((c) => c.startsWith('__Host-wnba_session=')) || '';
  const m = set.match(/__Host-wnba_session=([^;]+)/);
  if (r.status !== 303 || !m) throw new Error(`verify for ${email} -> ${r.status}`);
  return { cookie: m[1], token, setCookie: set, location: r.headers.get('location') };
}
async function get(path, cookie, extra = {}) {
  const r = await fetch(`${API}${path}`, { headers: { origin: APP, ...(cookie ? { cookie: `__Host-wnba_session=${cookie}` } : {}), ...extra } });
  const text = await r.text();
  return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
const PROTECTED = ['/v1/pbe/picks', '/v1/pbe/teams/20', '/v1/pbe/games/401857190', '/v1/track-record/ledger'];

const results = [];
async function check(name, fn) {
  try { results.push({ canary: name, pass: true, detail: await fn() }); } catch (e) { results.push({ canary: name, pass: false, detail: String(e.message || e).slice(0, 240) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
async function denied(cookie, label, expectStatus) {
  const out = [];
  for (const p of PROTECTED) {
    const r = await get(p, cookie);
    expect(r.status === expectStatus, `${label} ${p} -> ${r.status}`);
    expect(!PAID.test(r.text), `${label} ${p} leaked ${r.text.match(PAID)?.[0]}`);
    out.push(`${p.split('/').slice(-2).join('/')} ${r.status}`);
  }
  return out.join(' · ');
}

// ------------------------------------------------------------------ personas in the real ledger
const P = { pro: persona('pro'), free: persona('free'), nba: persona('nba'), nhl: persona('nhl'), ufc: persona('ufc'), expired: persona('expired'), cancel: persona('cancel'), recheck: persona('recheck') };
await grant(P.pro, W.monthly, 'wnba', 'monthly');
await grant(P.nba, NBA, 'nba', 'monthly');
await grant(P.nhl, NHL, 'nhl', 'monthly');
await grant(P.ufc, UFC, 'ufc', 'monthly');
await grant(P.expired, W.weekly, 'wnba', 'weekly', { end: now() - 120 });
await grant(P.cancel, W.monthly, 'wnba', 'monthly');
await stripe('customer.subscription.deleted', sub(P.cancel, W.monthly.price, { status: 'canceled', cancel: true }), now() + 2);
await grant(P.recheck, W.weekly, 'wnba', 'weekly', { end: now() + 7 * DAY });

await check('01 signed out: account signed_out, every protected route 401, no paid values', async () => {
  const a = await get('/v1/account');
  expect(a.body?.data?.state === 'signed_out', `account ${a.body?.data?.state}`);
  return denied(null, 'signed_out', 401);
});

const S = {};
await check('02 active wnba_pro authenticates (real verify endpoint, real cookie) and gets full picks access', async () => {
  S.pro = await signIn(P.pro.email);
  expect(/^__Host-wnba_session=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/.test(S.pro.setCookie), `cookie attributes: ${S.pro.setCookie.replace(/=[^;]+;/, '=<redacted>;')}`);
  expect(S.pro.location === `${APP}/pbe-picks`, `redirect ${S.pro.location}`);
  const a = await get('/v1/account', S.pro.cookie);
  expect(a.body?.data?.state === 'pro' && a.body.data.access === 'subscriber' && a.body.data.entitlement_check === 'CURRENT', JSON.stringify(a.body?.data));
  const picks = await get('/v1/pbe/picks', S.pro.cookie);
  expect(picks.status === 200 && picks.body?.data?.access === 'granted', `picks ${picks.status}`);
  expect(!PAID.test(picks.text), 'values served while PBE_PUBLISH=false');
  return `303 → /pbe-picks · account pro/subscriber/CURRENT · picks 200 ${picks.body.data.availability} (PBE_PUBLISH=false: no values to any subscriber)`;
});

await check('03 session alone never grants Pro: signed-in email with no entitlement is free, 403 everywhere', async () => {
  S.free = await signIn(P.free.email);
  const a = await get('/v1/account', S.free.cookie);
  expect(a.body?.data?.state === 'free' && a.body.data.entitled === false, JSON.stringify(a.body?.data));
  return `account free · ${await denied(S.free.cookie, 'free', 403)}`;
});

for (const [tag, label] of [['nba', 'NBA Pro only'], ['nhl', 'NHL Pro only'], ['ufc', 'UFC Pro only']]) {
  await check(`04 ${label} subscriber gets no WNBA paid access`, async () => {
    const s = await signIn(P[tag].email);
    const a = await get('/v1/account', s.cookie);
    expect(a.body?.data?.state === 'free', `${tag} account ${a.body?.data?.state}`);
    return `account free · ${await denied(s.cookie, tag, 403)}`;
  });
}

await check('05 expired wnba_pro (period end passed) denied', async () => {
  const s = await signIn(P.expired.email);
  const a = await get('/v1/account', s.cookie);
  expect(a.body?.data?.state === 'free' && a.body.data.subscription_status === 'active', JSON.stringify(a.body?.data));
  return `ledger status active but period ended → free · ${await denied(s.cookie, 'expired', 403)}`;
});

await check('06 cancelled (subscription.deleted) wnba_pro denied', async () => {
  const s = await signIn(P.cancel.email);
  const a = await get('/v1/account', s.cookie);
  expect(a.body?.data?.state === 'free' && a.body.data.subscription_status === 'canceled', JSON.stringify(a.body?.data));
  return `canceled → free · ${await denied(s.cookie, 'canceled', 403)}`;
});

await check('07 every paid request rechecks entitlement: cancel mid-session, same cookie is denied on the next request', async () => {
  const s = await signIn(P.recheck.email);
  const before = await get('/v1/pbe/picks', s.cookie);
  expect(before.status === 200, `before ${before.status}`);
  await stripe('customer.subscription.deleted', sub(P.recheck, W.weekly.price, { status: 'canceled' }), now() + 5);
  const after = await get('/v1/pbe/picks', s.cookie);
  expect(after.status === 403 && !PAID.test(after.text), `after ${after.status}`);
  return 'same session: 200 → (Stripe cancel) → 403, no re-login';
});

await check('08 magic token is single use: replay of a consumed token is rejected (410), no cookie', async () => {
  const r = await consume(S.pro.token);
  expect(r.status === 410 && !/__Host-wnba_session=[^;]+[^=];/.test(r.headers.get('set-cookie') || ''), `replay ${r.status}`);
  return 'replay 410, no set-cookie';
});

await check('09 magic token expiry: a link past its TTL is rejected (410)', async () => {
  const token = await seedLink(P.pro.email, 60);
  await new Promise((res) => setTimeout(res, 75e3));
  let r = await consume(token);
  // KV expiry is eventually consistent at the edge; allow up to 60s more before calling it a failure.
  for (let i = 0; i < 6 && r.status !== 410; i++) { await new Promise((res) => setTimeout(res, 10e3)); r = await consume(token); }
  expect(r.status === 410, `expired token ${r.status}`);
  return `consumed after TTL → 410`;
});

await check('10 forged / malformed tokens and forged cookies are rejected', async () => {
  const bad = await consume(crypto.randomBytes(32).toString('base64url'));
  expect(bad.status === 410, `unknown token ${bad.status}`);
  const [h, p] = S.free.cookie.split('.');
  const proSig = S.pro.cookie.split('.')[2];
  const forged = `${h}.${p}.${proSig}`;
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${S.pro.cookie.split('.')[1]}.`;
  for (const c of [forged, none, 'x.y.z']) {
    const a = await get('/v1/account', c);
    expect(a.body?.data?.state === 'signed_out', `forged cookie state ${a.body?.data?.state}`);
  }
  const q = await get(`/v1/pbe/picks?email=${encodeURIComponent(P.pro.email)}`, null, { 'x-user-email': P.pro.email });
  expect(q.status === 401 && !PAID.test(q.text), `query/header forgery ${q.status}`);
  return 'unknown token 410 · signature swap / alg:none / garbage → signed_out · email via query/header → 401';
});

await check('11 logout revokes the session: the same cookie is signed_out afterwards', async () => {
  const s = await signIn(P.pro.email);
  const before = await get('/v1/account', s.cookie);
  expect(before.body?.data?.state === 'pro', `before ${before.body?.data?.state}`);
  const out = await fetch(`${API}/v1/auth/logout`, { method: 'POST', headers: { origin: APP, 'content-type': 'application/json', cookie: `__Host-wnba_session=${s.cookie}` }, body: '{}' });
  expect(out.status === 200 && /Max-Age=0/.test(out.headers.get('set-cookie') || ''), `logout ${out.status}`);
  let after = await get('/v1/account', s.cookie);
  for (let i = 0; i < 6 && after.body?.data?.state !== 'signed_out'; i++) { await new Promise((res) => setTimeout(res, 5e3)); after = await get('/v1/account', s.cookie); }
  expect(after.body?.data?.state === 'signed_out' && after.body.data.reason === 'session_revoked', JSON.stringify(after.body?.data));
  return 'pro → logout 200 (Max-Age=0) → same cookie signed_out/session_revoked';
});

await check('12 cross-site origins get no credentialed CORS and sign-in requests are refused', async () => {
  const r = await fetch(`${API}/v1/pbe/picks`, { headers: { origin: 'https://evil.example', cookie: `__Host-wnba_session=${S.free.cookie}` } });
  expect(!r.headers.get('access-control-allow-origin') && !r.headers.get('access-control-allow-credentials'), 'evil origin got CORS');
  const req = await fetch(`${API}/v1/auth/request`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ email: P.free.email }) });
  expect(req.status === 403, `request from evil origin ${req.status}`);
  return 'no ACAO/ACAC for foreign origin · /v1/auth/request 403';
});

// ------------------------------------------------------------------ cleanup
const h = { apikey: DB.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${DB.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'return=representation' };
const rmEnt = await (await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_entitlements?stripe_subscription_id=like.sub_canary_${RUN}_*`, { method: 'DELETE', headers: h })).json();
const rmEvt = await (await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_stripe_events?event_id=like.evt_canary_${RUN}_*`, { method: 'DELETE', headers: h })).json();
const left = await (await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_entitlements?stripe_subscription_id=like.sub_canary_${RUN}_*&select=stripe_subscription_id`, { headers: h })).json();

const passed = results.filter((r) => r.pass).length;
const receipt = { run: RUN, at: new Date().toISOString(), api: API, results, passed, total: results.length, cleanup: { entitlements: rmEnt.length, events: rmEvt.length, remaining: left.length }, note: 'KV link keys expire within 15 minutes; revoked-session keys expire with the session.' };
fs.mkdirSync('docs/evidence/auth', { recursive: true });
fs.writeFileSync(`docs/evidence/auth/wnba-auth-canaries-${RUN}.json`, JSON.stringify(receipt, null, 2));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.canary} | ${r.detail}`);
console.log(`run ${RUN}: ${passed}/${results.length} · cleanup ${rmEnt.length} entitlement rows, ${rmEvt.length} events, ${left.length} remaining`);
process.exit(passed === results.length && left.length === 0 ? 0 : 1);
