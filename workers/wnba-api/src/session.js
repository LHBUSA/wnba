// WNBA account verification — server-verified PropBetEdge session -> entitlement.
//
// Identity comes from exactly one place: the `pbe_session` cookie issued by the
// PropBetEdge magic-link Worker at auth.propbetedge.ai. It is an HS256 JWT over
// { email, type: 'session', iat, exp }, set on Domain=.propbetedge.ai, HttpOnly,
// Secure, SameSite=Lax, 30-day. This Worker re-verifies that signature itself with
// the shared secret; it never accepts an email from a query string, a request
// header, a request body or anything the browser can write.
//
// Why this Worker verifies the token rather than calling auth.propbetedge.ai/session:
// that endpoint re-checks the LEGACY MLB subscriber table and answers valid:false —
// and clears the session cookie — for anyone without an active MLB subscription. A
// WNBA Pro customer who has never bought MLB must not be signed out by it. Sports are
// independent; the ledger is what decides each sport.
//
// Entitlement comes from exactly one place: the Supabase RPC
// pbe_has_sport_entitlement(email, 'wnba_pro'), executed with the service role key.
// The RPC requires an active/trialing row whose current_period_end is still in the
// future. Subscription detail is read only AFTER the RPC says yes, and is display
// material — never the authority.
//
// Everything fails closed. A missing secret, an unreachable Supabase, a malformed
// token or an expired token all end in "not entitled".

export const PRODUCT_KEY = 'wnba_pro';
export const COOKIE_NAME = 'pbe_session';

/** Origins allowed to send credentials. The session cookie is scoped to .propbetedge.ai. */
export const CREDENTIALED_ORIGINS = new Set(['https://wnba.propbetedge.ai']);

const enc = new TextEncoder();

export function readCookie(request, name) {
  const header = request?.headers?.get('cookie') || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToString = (s) => new TextDecoder().decode(b64urlToBytes(s));

// Deliberately narrow: an address we would hand to the ledger, nothing exotic.
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Verify a pbe_session JWT. Stricter than the issuer's own check on purpose:
 * the algorithm is pinned to HS256 (so a token claiming "none" can never pass),
 * `exp` is required rather than optional, and the type must be a session token.
 *
 * @returns {Promise<{ email: string, exp: number } | null>} null on any failure.
 */
export async function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const header = JSON.parse(b64urlToString(headerB64));
    if (header?.alg !== 'HS256') return null;

    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), enc.encode(`${headerB64}.${payloadB64}`));
    if (!valid) return null;

    const payload = JSON.parse(b64urlToString(payloadB64));
    if (payload?.type !== 'session') return null;
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
    const email = String(payload.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return null;
    return { email, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * The verified session for this request, or null.
 * `reason` explains the null for the response envelope; it never leaks token content.
 */
export async function verifiedSession(request, env) {
  const secret = env.PBE_SESSION_JWT_SECRET;
  if (!secret) return { session: null, reason: 'session_verification_unconfigured' };
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return { session: null, reason: 'no_session_cookie' };
  const session = await verifySessionToken(token, secret);
  return session ? { session, reason: null } : { session: null, reason: 'session_invalid_or_expired' };
}

// ------------------------------------------------------------------ ledger

async function supabase(env, path, init) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init?.headers || {})
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`supabase_${res.status}`);
  return res.json();
}

/**
 * The entitlement decision. The RPC is the authority: it demands an active or
 * trialing row for this exact email and product whose current_period_end is still
 * in the future. Any error is "not entitled", reported as UNAVAILABLE so the page
 * can say the check failed rather than tell a paying customer she is on the free tier.
 */
export async function sportEntitlement(env, email, productKey = PRODUCT_KEY) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { entitled: false, check: 'UNAVAILABLE', error: 'ledger_unconfigured' };
  try {
    const entitled = await supabase(env, 'rpc/pbe_has_sport_entitlement', {
      method: 'POST',
      body: JSON.stringify({ p_email: email, p_product_key: productKey })
    });
    return { entitled: entitled === true, check: 'CURRENT' };
  } catch (e) {
    return { entitled: false, check: 'UNAVAILABLE', error: e.message };
  }
}

/**
 * Plan / status / renewal for an already-entitled account. Display only — call it
 * only after sportEntitlement() has said yes, and never let it grant anything.
 */
export async function subscriptionDetail(env, email, productKey = PRODUCT_KEY) {
  try {
    const q = new URLSearchParams({
      select: 'plan,status,current_period_end,cancel_at_period_end,updated_at',
      customer_email: `eq.${email}`,
      product_key: `eq.${productKey}`,
      status: 'in.(active,trialing)',
      order: 'current_period_end.desc',
      limit: '1'
    });
    const rows = await supabase(env, `pbe_sport_entitlements?${q}`, { method: 'GET' });
    const r = Array.isArray(rows) ? rows[0] : null;
    return r ? { plan: r.plan, status: r.status, current_period_end: r.current_period_end, cancel_at_period_end: Boolean(r.cancel_at_period_end) } : null;
  } catch {
    return null;
  }
}

/**
 * The full account decision for /v1/account.
 *   signed_out  no verified session
 *   free        verified session, no active wnba_pro
 *   pro         verified session AND the ledger says active wnba_pro
 */
export async function accountState(request, env) {
  const { session, reason } = await verifiedSession(request, env);
  if (!session) {
    return { state: 'signed_out', entitled: false, email: null, reason, entitlement_check: 'NOT_ATTEMPTED' };
  }
  const { entitled, check, error } = await sportEntitlement(env, session.email);
  if (!entitled) {
    return { state: 'free', entitled: false, email: session.email, session_expires_at: new Date(session.exp * 1000).toISOString(), entitlement_check: check, reason: error || null };
  }
  return {
    state: 'pro',
    entitled: true,
    email: session.email,
    session_expires_at: new Date(session.exp * 1000).toISOString(),
    entitlement_check: check,
    subscription: await subscriptionDetail(env, session.email)
  };
}

/** CORS for a credentialed route: an exact allowlisted origin, or no credentials at all. */
export function credentialedCors(request) {
  const origin = request?.headers?.get('origin') || '';
  if (!CREDENTIALED_ORIGINS.has(origin)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin'
  };
}
