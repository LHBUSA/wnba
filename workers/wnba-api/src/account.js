// The WNBA account decision. Server-only; nothing the browser sends except the HttpOnly session cookie matters.
//
//   identity     verified __Host-wnba_session (auth.js)
//   entitlement  network billing ledger via propbetedge-sports-billing POST /v1/entitlement (service binding
//                BILLING + ENTITLEMENT_READ_TOKEN). That Worker runs pbe_has_sport_entitlement(email, 'wnba_pro'):
//                active/trialing AND current_period_end > now. WNBA is independent: nba_pro/nhl_pro/ufc_pro never count.
//   owner        WNBA_OWNER_EMAILS (server config) — QA access for the owner's own verified session only
//
// States: signed_out | free | pro. A ledger we could not reach is `free` with entitlement_check UNAVAILABLE —
// never Pro, and never silently "not a subscriber" either.

import { sessionFrom } from './auth.js';

export const PRODUCT_KEY = 'wnba_pro';

function ownerEmails(env) {
  return new Set(String(env.WNBA_OWNER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

async function readEntitlement(env, email) {
  if (!env.BILLING || !env.ENTITLEMENT_READ_TOKEN) return { entitled: false, check: 'UNAVAILABLE', error: 'entitlement_read_unconfigured' };
  try {
    const res = await env.BILLING.fetch('https://propbetedge-sports-billing/v1/entitlement', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.ENTITLEMENT_READ_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, product_key: PRODUCT_KEY }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return { entitled: false, check: 'UNAVAILABLE', error: `entitlement_http_${res.status}` };
    const body = await res.json();
    if (body?.product_key !== PRODUCT_KEY) return { entitled: false, check: 'UNAVAILABLE', error: 'entitlement_product_mismatch' };
    return { entitled: body.entitled === true, check: 'CURRENT', subscription: body.subscription || null };
  } catch (e) {
    return { entitled: false, check: 'UNAVAILABLE', error: e?.name === 'TimeoutError' ? 'entitlement_timeout' : 'entitlement_unreachable' };
  }
}

export async function resolveAccount(request, env) {
  const purchase_activation = env.WNBA_PURCHASE_ACTIVE === 'true' ? 'active' : 'inactive';
  const { session, reason } = await sessionFrom(request, env);
  if (!session) return { state: 'signed_out', entitled: false, access: 'none', email: null, reason, entitlement_check: 'NOT_ATTEMPTED', purchase_activation, product_key: PRODUCT_KEY };
  const base = { email: session.email, session_expires_at: new Date(session.exp * 1000).toISOString(), purchase_activation, product_key: PRODUCT_KEY };
  if (ownerEmails(env).has(session.email)) {
    return { ...base, state: 'pro', entitled: true, access: 'owner', entitlement_check: 'OWNER', plan: null, status: 'owner', current_period_end: null, cancel_at_period_end: false };
  }
  const ent = await readEntitlement(env, session.email);
  if (!ent.entitled) {
    return { ...base, state: 'free', entitled: false, access: 'none', entitlement_check: ent.check, reason: ent.error || null, subscription_status: ent.subscription?.status || null };
  }
  const s = ent.subscription || {};
  return { ...base, state: 'pro', entitled: true, access: 'subscriber', entitlement_check: ent.check, plan: s.plan || null, status: s.status || 'active', current_period_end: s.current_period_end || null, cancel_at_period_end: Boolean(s.cancel_at_period_end) };
}
