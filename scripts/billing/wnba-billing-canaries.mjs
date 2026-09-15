#!/usr/bin/env node
// Live signed-webhook canaries for WNBA Pro against the DEPLOYED propbetedge-sports-billing Worker
// and the production entitlement ledger (Supabase rlfyavnhbngwbldebrid).
//
//   node scripts/billing/wnba-billing-canaries.mjs [baseUrl]
//
// Reads three operator files from D:\Workers\secrets (never printed, never committed):
//   pbe-billing-stripe-webhook-secret     the endpoint signing secret the Worker verifies
//   pbe-billing-entitlement-read-token    bearer for the Worker's server-to-server entitlement read
//   pbe-billing-supabase.env              service role, used ONLY to delete this run's synthetic rows
//
// Every id is synthetic (sub_canary_<run>_*, evt_canary_<run>_*), every email is a canary address, and
// the run deletes its own ledger + event rows at the end. These prove the Worker + ledger path. They do
// NOT prove Stripe's own delivery or a real card payment; those need a real checkout.
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = (process.argv[2] || 'https://propbetedge-sports-billing.sales-fd3.workers.dev').replace(/\/$/, '');
const SECRETS = 'D:/Workers/secrets';
const SECRET = fs.readFileSync(`${SECRETS}/pbe-billing-stripe-webhook-secret`, 'utf8').trim();
if (!/^whsec_[A-Za-z0-9_]+$/.test(SECRET)) { console.error('secret file is not a whsec_ value'); process.exit(2); }
const READ_TOKEN = fs.readFileSync(`${SECRETS}/pbe-billing-entitlement-read-token`, 'utf8').trim();
const DB = Object.fromEntries(fs.readFileSync(`${SECRETS}/pbe-billing-supabase.env`, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const RUN = `wnbapro${Date.now().toString(36)}`;
// The verified live WNBA objects (owner-created; never recreated).
const WNBA = {
  monthly: { price: 'price_1UEfAmF3CaVzg4OReyWRioNO', link: 'plink_1UEfBOF3CaVzg4ORuxdQriRX' },
  weekly: { price: 'price_1UEfAsF3CaVzg4OR7082zM5i', link: 'plink_1UEfBTF3CaVzg4ORy1GQeoI5' }
};
const NBA = { monthly: { price: 'price_1UEWlFF3CaVzg4ORMlI1eb3j', link: 'plink_1UEWmAF3CaVzg4ORitxLA3Z3' } };
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
let seq = 0;
const ids = (tag) => ({ sub: `sub_canary_${RUN}_${tag}`, cs: `cs_canary_${RUN}_${tag}`, cus: `cus_canary_${RUN}_${tag}`, email: `wnba-pro-canary+${RUN}-${tag}@propbetedge.ai` });
const meta = (plan, sport = 'wnba') => ({ acquired_sport: sport, product: `propbetedge_${sport}`, product_key: `${sport}_pro`, plan: `pro_${plan}`, trial: 'none' });

const evt = (type, object, created = now()) => ({ id: `evt_canary_${RUN}_${++seq}`, object: 'event', type, created, livemode: true, data: { object } });
const sign = (raw, secret = SECRET, t = now()) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const accepted = [];
async function post(e, { signature, raw } = {}) {
  const body = raw ?? JSON.stringify(e);
  const headers = { 'content-type': 'application/json' };
  if (signature !== null) headers['stripe-signature'] = signature ?? sign(body);
  const r = await fetch(`${BASE}/webhook`, { method: 'POST', headers, body });
  let j = null; try { j = await r.json(); } catch {}
  if (signature === undefined && raw === undefined) {
    if (r.status !== 200) throw new Error(`signed delivery of ${e.type} returned ${r.status} ${JSON.stringify(j)}`);
    accepted.push(e.id);
  }
  return { status: r.status, body: j };
}
const checkout = (i, link, plan, metadata = meta(plan)) => ({ id: i.cs, object: 'checkout.session', mode: 'subscription', payment_link: link, subscription: i.sub, customer: i.cus, payment_status: 'paid', customer_details: { email: i.email }, metadata });
const sub = (i, price, { status = 'active', periodEnd = now() + 30 * DAY, cancel = false } = {}) => ({ id: i.sub, object: 'subscription', status, customer: i.cus, cancel_at_period_end: cancel, items: { data: [{ id: `si_canary_${RUN}`, price: { id: price }, current_period_end: periodEnd }] } });
async function entitlement(email, product = 'wnba_pro') {
  const r = await fetch(`${BASE}/v1/entitlement`, { method: 'POST', headers: { authorization: `Bearer ${READ_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, product_key: product }) });
  if (!r.ok) throw new Error(`entitlement read ${r.status}`);
  return r.json();
}
const OTHERS = ['nba_pro', 'nhl_pro', 'ufc_pro'];

const results = [];
async function check(name, fn) {
  try { results.push({ canary: name, pass: true, detail: await fn() }); }
  catch (e) { results.push({ canary: name, pass: false, detail: String(e.message || e).slice(0, 220) }); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const health = await (await fetch(`${BASE}/health`)).json();

await check('01 catalog: deployed Worker serves wnba / wnba_pro, webhook + ledger + read configured', async () => {
  expect(health.ok === true && health.sports.includes('wnba') && health.product_keys.includes('wnba_pro'), JSON.stringify(health));
  expect(health.webhook_configured && health.ledger_configured && health.entitlement_read_configured, JSON.stringify(health));
  return `${health.version}; sports ${health.sports.join(',')}`;
});
await check('02 forged, tampered, stale and missing signatures rejected', async () => {
  const e = evt('customer.subscription.created', sub(ids('badsig'), WNBA.monthly.price));
  const forged = await post(e, { signature: sign(JSON.stringify(e), 'whsec_notTheRealSecret000') });
  const raw = JSON.stringify(e);
  const tampered = await post(e, { raw: raw.replace('"active"', '"trialing"'), signature: sign(raw) });
  const stale = await post(e, { signature: sign(raw, SECRET, now() - 400) });
  const missing = await post(e, { signature: null });
  expect([forged, tampered, stale, missing].every((r) => r.status === 400), [forged, tampered, stale, missing].map((r) => r.status).join(','));
  expect((await entitlement(ids('badsig').email)).entitled === false, 'forged event granted');
  return 'forged 400 · tampered 400 · stale(>300s) 400 · missing 400 · nothing granted';
});

const m = ids('monthly');
await check('03 monthly: checkout.session.completed → subscription.created grants wnba_pro (ledger accepts sport=wnba)', async () => {
  const a = await post(evt('checkout.session.completed', checkout(m, WNBA.monthly.link, 'monthly')));
  expect(a.body?.applied === true, `checkout ${JSON.stringify(a.body)}`);
  const before = await entitlement(m.email);
  expect(before.entitled === false, 'checkout alone granted (must wait for lifecycle)');
  const b = await post(evt('customer.subscription.created', sub(m, WNBA.monthly.price)));
  expect(b.body?.applied === true, `subscription ${JSON.stringify(b.body)}`);
  const ent = await entitlement(m.email);
  expect(ent.entitled === true && ent.subscription?.plan === 'monthly' && ent.subscription?.status === 'active', JSON.stringify(ent));
  return `${a.body.reason} (not yet entitled) → ${b.body.reason} → entitled monthly`;
});
await check('04 WNBA entitlement is independent: wnba_pro never implies nba/nhl/ufc', async () => {
  for (const p of OTHERS) expect((await entitlement(m.email, p)).entitled === false, `leaked ${p}`);
  return 'nba_pro false · nhl_pro false · ufc_pro false';
});
await check('05 duplicate Stripe event id is idempotent', async () => {
  const e = evt('customer.subscription.updated', sub(m, WNBA.monthly.price, { periodEnd: now() + 31 * DAY }));
  const first = await post(e); const again = await post(e);
  expect(first.body?.applied === true && again.body?.duplicate === true, `${JSON.stringify(first.body)} / ${JSON.stringify(again.body)}`);
  return 'first applied · second {duplicate:true}';
});

const w = ids('weekly');
await check('06 weekly: subscription-first ordering then checkout grants wnba_pro', async () => {
  const s = await post(evt('customer.subscription.created', sub(w, WNBA.weekly.price, { periodEnd: now() + 7 * DAY }), now() - 5));
  const c = await post(evt('checkout.session.completed', checkout(w, WNBA.weekly.link, 'weekly')));
  const ent = await entitlement(w.email);
  expect(ent.entitled === true && ent.subscription?.plan === 'weekly', `${JSON.stringify(s.body)} ${JSON.stringify(c.body)} ${JSON.stringify(ent)}`);
  return `${s.body.reason} → ${c.body.reason} → entitled weekly`;
});

await check('07 one email holds NBA Pro and WNBA Pro as independent subscriptions', async () => {
  const both = ids('both');
  const nba = { ...both, sub: `${both.sub}_nba`, cs: `${both.cs}_nba` };
  await post(evt('checkout.session.completed', checkout(nba, NBA.monthly.link, 'monthly', meta('monthly', 'nba'))));
  await post(evt('customer.subscription.created', sub(nba, NBA.monthly.price)));
  expect((await entitlement(both.email, 'nba_pro')).entitled === true, 'nba not granted');
  expect((await entitlement(both.email, 'wnba_pro')).entitled === false, 'NBA Pro alone granted WNBA');
  await post(evt('checkout.session.completed', checkout(both, WNBA.monthly.link, 'monthly')));
  await post(evt('customer.subscription.created', sub(both, WNBA.monthly.price)));
  expect((await entitlement(both.email, 'wnba_pro')).entitled === true, 'wnba not granted');
  await post(evt('customer.subscription.deleted', sub(nba, NBA.monthly.price, { status: 'canceled' }), now() + 2));
  const n = await entitlement(both.email, 'nba_pro'); const wn = await entitlement(both.email, 'wnba_pro');
  expect(n.entitled === false && wn.entitled === true, `after NBA cancel nba=${n.entitled} wnba=${wn.entitled}`);
  return 'NBA-only → no WNBA · both → both · cancel NBA → WNBA unaffected';
});

await check('08 wrong price / wrong link / cross-sport metadata fail closed', async () => {
  const a = ids('wkonmo');
  await post(evt('checkout.session.completed', checkout(a, WNBA.monthly.link, 'monthly')));
  const ra = await post(evt('customer.subscription.created', sub(a, WNBA.weekly.price)));
  const b = ids('nbalink');
  const rb = await post(evt('checkout.session.completed', checkout(b, NBA.monthly.link, 'monthly')));
  await post(evt('customer.subscription.created', sub(b, WNBA.monthly.price)));
  const c = ids('unknownlink');
  const rc = await post(evt('checkout.session.completed', checkout(c, 'plink_canary_not_allowlisted', 'monthly')));
  const d = ids('trial');
  const rd = await post(evt('checkout.session.completed', checkout(d, WNBA.monthly.link, 'monthly', { ...meta('monthly'), trial: '7d' })));
  await post(evt('customer.subscription.created', sub(d, WNBA.monthly.price)));
  for (const x of [a, b, c, d]) expect((await entitlement(x.email)).entitled === false, `granted ${x.email}`);
  return `weekly price on monthly link → ${ra.body?.reason} · NBA link+metadata → ${rb.body?.reason} · unknown link → ${rc.body?.reason} · trial metadata → ${rd.body?.reason}`;
});

await check('09 cancel-at-period-end keeps access until the period end', async () => {
  const end = now() + 20 * DAY;
  const r = await post(evt('customer.subscription.updated', sub(m, WNBA.monthly.price, { periodEnd: end, cancel: true }), now() + 1));
  const ent = await entitlement(m.email);
  expect(r.body?.applied === true && ent.entitled === true && ent.subscription?.cancel_at_period_end === true && Date.parse(ent.subscription.current_period_end) === end * 1000, JSON.stringify(ent));
  return `entitled with cancel_at_period_end=true through ${ent.subscription.current_period_end.slice(0, 10)}`;
});
await check('10 expired period denies access even while status says active', async () => {
  const x = ids('expired');
  await post(evt('checkout.session.completed', checkout(x, WNBA.weekly.link, 'weekly')));
  await post(evt('customer.subscription.created', sub(x, WNBA.weekly.price, { periodEnd: now() - 60 })));
  const ent = await entitlement(x.email);
  expect(ent.entitled === false && ent.subscription?.status === 'active', JSON.stringify(ent));
  return 'status active, current_period_end in the past → entitled false';
});
await check('11 subscription.deleted ends access; stale and late events cannot restore it', async () => {
  const del = await post(evt('customer.subscription.deleted', sub(m, WNBA.monthly.price, { status: 'canceled', cancel: true }), now() + 3));
  expect(del.body?.applied === true && (await entitlement(m.email)).entitled === false, JSON.stringify(del.body));
  const stale = await post(evt('customer.subscription.updated', sub(m, WNBA.monthly.price), now() - 60));
  const newer = await post(evt('customer.subscription.updated', sub(m, WNBA.monthly.price), now() + 30));
  const paid = await post(evt('invoice.paid', { object: 'invoice', parent: { subscription_details: { subscription: m.sub } } }, now() + 40));
  const ent = await entitlement(m.email);
  expect(ent.entitled === false && ent.subscription?.status === 'canceled', JSON.stringify(ent));
  return `deleted → canceled · stale → ${stale.body?.reason} · newer → ${newer.body?.reason} · invoice.paid → ${paid.body?.reason}`;
});
await check('12 invoice.payment_failed moves weekly to past_due and denies', async () => {
  const r = await post(evt('invoice.payment_failed', { object: 'invoice', parent: { subscription_details: { subscription: w.sub } } }, now() + 5));
  const ent = await entitlement(w.email);
  expect(r.body?.applied === true && ent.entitled === false && ent.subscription?.status === 'past_due', JSON.stringify(ent));
  const back = await post(evt('invoice.paid', { object: 'invoice', parent: { subscription_details: { subscription: w.sub } } }, now() + 6));
  const ent2 = await entitlement(w.email);
  expect(back.body?.applied === true && ent2.entitled === true, JSON.stringify(ent2));
  return 'payment_failed → past_due (denied) · invoice.paid → active (entitled)';
});

async function cleanup() {
  const h = { apikey: DB.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${DB.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'return=representation' };
  const a = await (await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_entitlements?stripe_subscription_id=like.sub_canary_${RUN}_*`, { method: 'DELETE', headers: h })).json();
  const b = await (await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_stripe_events?event_id=like.evt_canary_${RUN}_*`, { method: 'DELETE', headers: h })).json();
  const left = await (await fetch(`${DB.SUPABASE_URL}/rest/v1/pbe_sport_entitlements?stripe_subscription_id=like.sub_canary_${RUN}_*&select=stripe_subscription_id`, { headers: h })).json();
  return { entitlements: a.length, events: b.length, remaining: left.length };
}
const removed = await cleanup();
const passed = results.filter((r) => r.pass).length;
const receipt = { run: RUN, at: new Date().toISOString(), worker: BASE, worker_version: health.version, signed_deliveries_accepted: accepted.length, passed, total: results.length, results, cleanup: removed };
console.log(JSON.stringify(receipt, null, 2));
process.exit(passed === results.length && removed.remaining === 0 ? 0 : 1);
