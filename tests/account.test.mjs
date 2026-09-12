// /v1/account — the entitlement decision is server-made or it does not happen.
//
// These tests sign real HS256 tokens with WebCrypto and run the Worker's own
// verifier against them, and they stub fetch to watch exactly what the Worker asks
// Supabase. Nothing here mocks the verifier itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  verifySessionToken, readCookie, accountState, credentialedCors, sportEntitlement, COOKIE_NAME, PRODUCT_KEY
} from '../workers/wnba-api/src/session.js';

const SECRET = 'test-only-secret-not-a-real-one';
const enc = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(payload, secret = SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 10;
const session = (over = {}) => ({ email: 'fan@example.com', type: 'session', iat: Math.floor(Date.now() / 1000), exp: future(), ...over });

const req = (cookie, { origin = 'https://wnba.propbetedge.ai', url = 'https://wnba-api.example/v1/account' } = {}) => new Request(url, {
  headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }
});

const ENV = { PBE_SESSION_JWT_SECRET: SECRET, SUPABASE_URL: 'https://ledger.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key' };

/** Stub fetch, recording every call, and answer the ledger with `entitled` / `row`. */
function stubSupabase({ entitled = false, row = null, fail = false } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (fail) return new Response('boom', { status: 500 });
    if (String(url).includes('rpc/pbe_has_sport_entitlement')) return Response.json(entitled);
    return Response.json(row ? [row] : []);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// ------------------------------------------------------------ token verification

test('a correctly signed, unexpired session token yields its email', async () => {
  const got = await verifySessionToken(await sign(session()), SECRET);
  assert.deepEqual(got?.email, 'fan@example.com');
});

test('email is normalised, so case and padding cannot create a second identity', async () => {
  const got = await verifySessionToken(await sign(session({ email: '  Fan@Example.COM ' })), SECRET);
  assert.equal(got?.email, 'fan@example.com');
});

test('a token signed with any other secret is rejected', async () => {
  assert.equal(await verifySessionToken(await sign(session(), 'some-other-secret'), SECRET), null);
});

test('alg is pinned: "none" and HS512 headers are rejected even with a valid-looking body', async () => {
  assert.equal(await verifySessionToken(await sign(session(), SECRET, { alg: 'none', typ: 'JWT' }), SECRET), null);
  assert.equal(await verifySessionToken(await sign(session(), SECRET, { alg: 'HS512', typ: 'JWT' }), SECRET), null);
});

test('an expired token is rejected', async () => {
  assert.equal(await verifySessionToken(await sign(session({ exp: past() })), SECRET), null);
});

test('exp is required — a token that never expires is not a session we accept', async () => {
  const { exp, ...noExp } = session();
  assert.equal(await verifySessionToken(await sign(noExp), SECRET), null);
});

test('a magic-link token is not a session token', async () => {
  assert.equal(await verifySessionToken(await sign(session({ type: 'magic' })), SECRET), null);
});

test('a malformed or non-email subject is rejected', async () => {
  assert.equal(await verifySessionToken(await sign(session({ email: 'not-an-email' })), SECRET), null);
  assert.equal(await verifySessionToken(await sign(session({ email: '' })), SECRET), null);
  assert.equal(await verifySessionToken('a.b', SECRET), null);
  assert.equal(await verifySessionToken('', SECRET), null);
});

test('a tampered payload invalidates the signature', async () => {
  const token = await sign(session());
  const [h, , s] = token.split('.');
  const forged = b64url(enc.encode(JSON.stringify(session({ email: 'attacker@example.com' }))));
  assert.equal(await verifySessionToken(`${h}.${forged}.${s}`, SECRET), null);
});

test('the cookie is read by exact name, not by prefix', () => {
  assert.equal(readCookie(req('other=1; pbe_session=abc; x=2'), COOKIE_NAME), 'abc');
  assert.equal(readCookie(req('not_pbe_session=abc'), COOKIE_NAME), null);
  assert.equal(readCookie(req(''), COOKIE_NAME), null);
});

// ------------------------------------------------------------ account state

test('no cookie is signed_out, and no ledger call is made', async () => {
  const sb = stubSupabase({ entitled: true });
  try {
    const s = await accountState(req(null), ENV);
    assert.equal(s.state, 'signed_out');
    assert.equal(s.entitled, false);
    assert.equal(s.email, null);
    assert.equal(sb.calls.length, 0);
  } finally { sb.restore(); }
});

test('without the verification secret the route is signed_out, never trusting the cookie', async () => {
  const sb = stubSupabase({ entitled: true });
  try {
    const s = await accountState(req(`${COOKIE_NAME}=${await sign(session())}`), { ...ENV, PBE_SESSION_JWT_SECRET: undefined });
    assert.equal(s.state, 'signed_out');
    assert.equal(s.reason, 'session_verification_unconfigured');
    assert.equal(sb.calls.length, 0);
  } finally { sb.restore(); }
});

test('a verified session with no WNBA entitlement is free, not pro', async () => {
  const sb = stubSupabase({ entitled: false });
  try {
    const s = await accountState(req(`${COOKIE_NAME}=${await sign(session())}`), ENV);
    assert.equal(s.state, 'free');
    assert.equal(s.entitled, false);
    assert.equal(s.email, 'fan@example.com');
  } finally { sb.restore(); }
});

test('a verified session the ledger confirms is pro, with its plan detail', async () => {
  const sb = stubSupabase({ entitled: true, row: { plan: 'monthly', status: 'active', current_period_end: '2027-01-01T00:00:00Z', cancel_at_period_end: false } });
  try {
    const s = await accountState(req(`${COOKIE_NAME}=${await sign(session())}`), ENV);
    assert.equal(s.state, 'pro');
    assert.equal(s.entitled, true);
    assert.equal(s.subscription.plan, 'monthly');
    assert.equal(s.subscription.status, 'active');
  } finally { sb.restore(); }
});

test('the ledger is asked about the VERIFIED email and the WNBA product, nothing else', async () => {
  const sb = stubSupabase({ entitled: true });
  try {
    await accountState(req(`${COOKIE_NAME}=${await sign(session({ email: 'real@example.com' }))}`), ENV);
    const rpc = sb.calls.find((c) => c.url.includes('rpc/pbe_has_sport_entitlement'));
    assert.ok(rpc, 'the RPC was called');
    assert.deepEqual(JSON.parse(rpc.init.body), { p_email: 'real@example.com', p_product_key: PRODUCT_KEY });
    assert.equal(PRODUCT_KEY, 'wnba_pro');
  } finally { sb.restore(); }
});

test('a query parameter cannot supply or override the identity', async () => {
  const sb = stubSupabase({ entitled: true });
  try {
    const url = 'https://wnba-api.example/v1/account?email=attacker@example.com&entitled=true&state=pro';
    const s = await accountState(req(`${COOKIE_NAME}=${await sign(session({ email: 'real@example.com' }))}`, { url }), ENV);
    assert.equal(s.email, 'real@example.com');
    const rpc = sb.calls.find((c) => c.url.includes('rpc/pbe_has_sport_entitlement'));
    assert.equal(JSON.parse(rpc.init.body).p_email, 'real@example.com');
  } finally { sb.restore(); }
});

test('a query parameter alone, with no session, grants nothing', async () => {
  const sb = stubSupabase({ entitled: true });
  try {
    const s = await accountState(req(null, { url: 'https://wnba-api.example/v1/account?email=attacker@example.com&pro=1' }), ENV);
    assert.equal(s.state, 'signed_out');
    assert.equal(s.entitled, false);
  } finally { sb.restore(); }
});

test('an unreachable ledger fails closed and says so, rather than claiming the free tier silently', async () => {
  const sb = stubSupabase({ fail: true });
  try {
    const s = await accountState(req(`${COOKIE_NAME}=${await sign(session())}`), ENV);
    assert.equal(s.entitled, false);
    assert.equal(s.state, 'free');
    assert.equal(s.entitlement_check, 'UNAVAILABLE');
  } finally { sb.restore(); }
});

test('an unconfigured ledger never returns entitled', async () => {
  const r = await sportEntitlement({ SUPABASE_URL: null, SUPABASE_SERVICE_ROLE_KEY: null }, 'fan@example.com');
  assert.equal(r.entitled, false);
  assert.equal(r.check, 'UNAVAILABLE');
});

// ------------------------------------------------------------ transport

test('credentials are offered to the WNBA origin only, and never with a wildcard', () => {
  const allowed = credentialedCors(req(null, { origin: 'https://wnba.propbetedge.ai' }));
  assert.equal(allowed['access-control-allow-origin'], 'https://wnba.propbetedge.ai');
  assert.equal(allowed['access-control-allow-credentials'], 'true');

  for (const origin of ['https://evil.example', 'https://wnba.propbetedge.ai.evil.example', '']) {
    const denied = credentialedCors(req(null, { origin }));
    assert.equal(denied['access-control-allow-credentials'], undefined, origin);
    assert.equal(denied['access-control-allow-origin'], undefined, origin);
  }
});

// ------------------------------------------------------------ source discipline

test('no browser-side entitlement path exists in the frontend', () => {
  const src = ['src/pages/pro.js', 'src/data/api.js', 'src/data/pricing.js'].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /localStorage[^\n]*(pro|entitle|premium|session)/i);
  assert.doesNotMatch(src, /entitled\s*=\s*true/i);
});

test('the Worker reads identity from the cookie and the ledger, and from nothing else', () => {
  const src = fs.readFileSync(new URL('../workers/wnba-api/src/session.js', import.meta.url), 'utf8');
  assert.match(src, /pbe_has_sport_entitlement/);
  assert.match(src, /COOKIE_NAME = 'pbe_session'/);
  // No query/header/body-supplied email may reach the ledger.
  assert.doesNotMatch(src, /searchParams/);
  assert.doesNotMatch(src, /headers\.get\(\s*['"]x-/i);
});
