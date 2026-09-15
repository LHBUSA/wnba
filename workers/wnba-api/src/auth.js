// WNBA-owned passwordless sign-in (owner decision 2026-09-15). Identity only: this module never grants WNBA Pro.
// Entitlement is decided separately (account.js) by the network billing ledger.
//
//   POST /v1/auth/request   { email, next }  from https://wnba.propbetedge.ai only
//        -> one-time link emailed via Cloudflare Email Service (binding EMAIL). Only sha256(token) is stored
//           (KV, 15 min TTL). Rate limited per email and per IP. The answer never says whether an address exists.
//   GET  /v1/auth/verify?t= -> a confirm page. It does NOT consume the token, so mail-scanner pre-fetches are harmless.
//   POST /v1/auth/verify    -> consumes the token, sets the session cookie, 303 back to the WNBA app.
//   POST /v1/auth/logout    -> revokes the session id and clears the cookie.
//
// Session: HS256 JWT { iss, aud, typ: 'wnba_session', sub: email, sid, iat, exp } signed with WNBA_SESSION_SECRET,
// in cookie `__Host-wnba_session` (host-only on the API host, Path=/, Secure, HttpOnly, SameSite=Lax, 30 days).
// The app (wnba.propbetedge.ai) and the API host (wnba-api.propbetedge.ai) are same-site, so credentialed fetches
// carry it; no other site can. Verification pins alg, iss, aud, typ, exp and the email shape, and checks revocation.

export const SESSION_COOKIE = '__Host-wnba_session';
export const APP_ORIGIN = 'https://wnba.propbetedge.ai';
export const CREDENTIALED_ORIGINS = new Set([APP_ORIGIN]);
export const ISSUER = 'wnba-api';
export const AUDIENCE = 'wnba.propbetedge.ai';
export const LINK_TTL_S = 900;
export const SESSION_TTL_S = 30 * 86400;
const RATE = { per_email_hour: 5, per_ip_hour: 20 };

const enc = new TextEncoder();
const EMAIL_RE = /^[^\s@<>"'`]{1,64}@[^\s@.<>"'`]+(\.[^\s@.<>"'`]+)+$/;

export function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));
function fromB64url(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export async function signSession({ email, sid, now = Date.now() }, secret) {
  const iat = Math.floor(now / 1000);
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson({ iss: ISSUER, aud: AUDIENCE, typ: 'wnba_session', sub: email, sid, iat, exp: iat + SESSION_TTL_S });
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** @returns {Promise<{ email, sid, exp } | null>} null on any defect. */
export async function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (header?.alg !== 'HS256') return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (p?.iss !== ISSUER || p?.aud !== AUDIENCE || p?.typ !== 'wnba_session') return null;
    if (!Number.isInteger(p.exp) || p.exp * 1000 <= now) return null;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(p.sid || ''))) return null;
    const email = normalizeEmail(p.sub);
    if (!email || email !== p.sub) return null;
    return { email, sid: p.sid, exp: p.exp };
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The verified, unrevoked session on this request, or { session: null, reason }. */
export async function sessionFrom(request, env) {
  if (!env.WNBA_SESSION_SECRET) return { session: null, reason: 'session_unconfigured' };
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return { session: null, reason: 'no_session' };
  const session = await verifySession(token, env.WNBA_SESSION_SECRET);
  if (!session) return { session: null, reason: 'session_invalid_or_expired' };
  if (env.WNBA_KV && (await env.WNBA_KV.get(`auth:revoked:${session.sid}`))) return { session: null, reason: 'session_revoked' };
  return { session, reason: null };
}

const cookie = (value, maxAge) => `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** Only same-app relative paths survive; everything else lands on /pbe-picks. */
export function safeNext(next) {
  const n = String(next || '');
  return /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]{0,200}$/.test(n) && !n.includes('\\') ? n : '/pbe-picks';
}

// ------------------------------------------------------------------ responses

export function credentialedHeaders(request, extra = {}) {
  const origin = request.headers.get('origin') || '';
  const h = { vary: 'Origin', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...extra };
  if (CREDENTIALED_ORIGINS.has(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-credentials'] = 'true';
  }
  return h;
}

export function privateJson(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...credentialedHeaders(request, extra) } });
}

export function credentialedPreflight(request) {
  return new Response(null, { status: 204, headers: { ...credentialedHeaders(request), 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' } });
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body, status = 200, headers = {}) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0d0a;color:#f5f1eb;font:16px/1.5 system-ui,sans-serif;padding:16px}main{max-width:420px;width:100%;border:1px solid rgba(255,210,150,.18);border-radius:18px;padding:28px;background:#17130f}h1{font-size:22px;margin:0 0 10px}p{color:#cfc7b8;margin:0 0 18px}button,a.b{display:block;width:100%;box-sizing:border-box;text-align:center;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#d4af37,#ffb36b);color:#1a0c04;font-weight:800;font-size:15px;text-decoration:none;cursor:pointer}small{display:block;margin-top:14px;color:#a39d91}</style></head><body><main>${body}</main></body></html>`, { status, headers: { ...PAGE_HEADERS, ...headers } });

// ------------------------------------------------------------------ handlers

function configured(env) {
  const missing = [];
  if (!env.WNBA_SESSION_SECRET) missing.push('WNBA_SESSION_SECRET');
  if (!env.WNBA_KV) missing.push('WNBA_KV');
  if (!env.EMAIL) missing.push('EMAIL');
  if (!env.AUTH_FROM) missing.push('AUTH_FROM');
  if (!env.AUTH_PUBLIC_BASE) missing.push('AUTH_PUBLIC_BASE');
  return missing;
}

async function bump(env, key, limit) {
  const n = Number((await env.WNBA_KV.get(key)) || 0);
  if (n >= limit) return false;
  await env.WNBA_KV.put(key, String(n + 1), { expirationTtl: 3700 });
  return true;
}

export async function requestLink(request, env) {
  if (request.headers.get('origin') !== APP_ORIGIN) return privateJson(request, { ok: false, error: { code: 'origin_not_allowed' } }, 403);
  const missing = configured(env);
  if (missing.length) return privateJson(request, { ok: false, error: { code: 'auth_unconfigured', message: 'Sign-in is not available yet.' } }, 503);
  let body;
  try { body = await request.json(); } catch { return privateJson(request, { ok: false, error: { code: 'invalid_json' } }, 400); }
  const email = normalizeEmail(body?.email);
  if (!email) return privateJson(request, { ok: false, error: { code: 'invalid_email', message: 'Enter a valid email address.' } }, 400);
  const hour = Math.floor(Date.now() / 3600e3);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await bump(env, `auth:rl:ip:${await sha256Hex(ip)}:${hour}`, RATE.per_ip_hour)) || !(await bump(env, `auth:rl:e:${await sha256Hex(email)}:${hour}`, RATE.per_email_hour))) {
    return privateJson(request, { ok: false, error: { code: 'rate_limited', message: 'Too many sign-in links requested. Try again within the hour.' } }, 429);
  }
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const key = `auth:link:${await sha256Hex(token)}`;
  await env.WNBA_KV.put(key, JSON.stringify({ email, next: safeNext(body?.next), created_at: new Date().toISOString() }), { expirationTtl: LINK_TTL_S });
  const link = `${env.AUTH_PUBLIC_BASE}/v1/auth/verify?t=${token}`;
  try {
    await env.EMAIL.send({
      to: email,
      from: { email: env.AUTH_FROM, name: 'PropBetEdge WNBA' },
      subject: 'Your PropBetEdge WNBA sign-in link',
      text: `Sign in to PropBetEdge WNBA:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
      html: `<p>Sign in to <b>PropBetEdge WNBA</b>:</p><p><a href="${esc(link)}">Sign in</a></p><p>The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`
    });
  } catch (e) {
    await env.WNBA_KV.delete(key);
    console.error('[wnba-api] auth email send failed', e?.message || e);
    return privateJson(request, { ok: false, error: { code: 'email_send_failed', message: 'We could not send the email. Try again shortly.' } }, 502);
  }
  return privateJson(request, { ok: true, data: { sent: true, expires_in_s: LINK_TTL_S, message: 'Check your inbox for a sign-in link.' } });
}

// Login-CSRF protection for the confirm step. Browsers may send `Origin: null` on this form POST (privacy settings,
// referrer policy, email-client webviews), so the Origin header cannot be the gate. Instead the confirm page sets a
// short-lived host-only nonce cookie and embeds the same nonce in the form; the POST must present both. A cross-site
// page can neither read the nonce nor make a SameSite=Lax cookie ride along on its POST.
export const VERIFY_COOKIE = '__Host-wnba_verify';
const VERIFY_TTL_S = 900;
const verifyCookie = (value, maxAge) => `${VERIFY_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

async function sameValue(a, b) {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(String(a))), crypto.subtle.sign('HMAC', key, enc.encode(String(b)))]);
  const xa = new Uint8Array(x); const ya = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < xa.length; i += 1) d |= xa[i] ^ ya[i];
  return d === 0;
}

// The confirm page and the redemption POST share this header set; the 303 target (the WNBA app) must be a permitted
// form-action destination, and Referrer-Policy same-origin keeps the token out of any cross-origin Referer.
const CONFIRM_HEADERS = {
  'referrer-policy': 'same-origin',
  'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${APP_ORIGIN}; frame-ancestors 'none'; base-uri 'none'`
};

export async function verifyPage(request, env) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) return page('Sign-in link invalid', `<h1>This link is not valid</h1><p>Request a new sign-in link from WNBA Pro.</p><a class="b" href="${APP_ORIGIN}/pro">Back to WNBA Pro</a>`, 400, CONFIRM_HEADERS);
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(24)));
  return page('Sign in to PropBetEdge WNBA', `<h1>Sign in to PropBetEdge WNBA</h1><p>Confirm to finish signing in on this device.</p><form method="post" action="/v1/auth/verify"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="n" value="${nonce}"><button type="submit">Continue</button></form><small>The link works once and expires 15 minutes after it was sent.</small>`, 200, { ...CONFIRM_HEADERS, 'set-cookie': verifyCookie(nonce, VERIFY_TTL_S) });
}

export async function verifyConsume(request, env) {
  const missing = configured(env);
  if (missing.length) return page('Sign-in unavailable', '<h1>Sign-in is not available yet</h1>', 503, CONFIRM_HEADERS);
  const self = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  // An explicit foreign origin is always refused. Absent or opaque ("null") origins are allowed only because the
  // nonce check below is the real gate.
  if (origin && origin !== 'null' && origin !== self && origin !== env.AUTH_PUBLIC_BASE) return page('Sign-in refused', '<h1>Sign-in refused</h1>', 403, CONFIRM_HEADERS);
  let t = '';
  let n = '';
  try { const f = await request.formData(); t = String(f.get('t') || ''); n = String(f.get('n') || ''); } catch { /* fall through */ }
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) return page('Sign-in link invalid', `<h1>This link is not valid</h1><a class="b" href="${APP_ORIGIN}/pro">Back to WNBA Pro</a>`, 400, CONFIRM_HEADERS);
  const cookieNonce = readCookie(request, VERIFY_COOKIE);
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(n) || !cookieNonce || !(await sameValue(n, cookieNonce))) {
    return page('Open the link again', `<h1>Please open your sign-in link again</h1><p>This confirmation did not come from the page your link opened. Your link has not been used; open it from your email and press Continue.</p>`, 403, CONFIRM_HEADERS);
  }
  const key = `auth:link:${await sha256Hex(t)}`;
  const rec = await env.WNBA_KV.get(key, 'json');
  if (!rec?.email) return page('Sign-in link expired', `<h1>This link has expired or was already used</h1><p>Request a new one. Links work once, for 15 minutes.</p><a class="b" href="${APP_ORIGIN}/pro">Get a new link</a>`, 410, CONFIRM_HEADERS);
  await env.WNBA_KV.delete(key);
  const sid = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const jwt = await signSession({ email: rec.email, sid }, env.WNBA_SESSION_SECRET);
  const headers = new Headers({ location: `${APP_ORIGIN}${safeNext(rec.next)}`, 'cache-control': 'no-store', ...CONFIRM_HEADERS });
  headers.append('set-cookie', cookie(jwt, SESSION_TTL_S));
  headers.append('set-cookie', verifyCookie('', 0));
  return new Response(null, { status: 303, headers });
}

export async function logout(request, env) {
  if (request.headers.get('origin') !== APP_ORIGIN) return privateJson(request, { ok: false, error: { code: 'origin_not_allowed' } }, 403);
  const { session } = await sessionFrom(request, env);
  if (session && env.WNBA_KV) {
    const ttl = Math.max(60, session.exp - Math.floor(Date.now() / 1000));
    await env.WNBA_KV.put(`auth:revoked:${session.sid}`, '1', { expirationTtl: ttl });
  }
  return privateJson(request, { ok: true, data: { signed_out: true } }, 200, { 'set-cookie': cookie('', 0) });
}
