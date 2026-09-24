// The WNBA account decision. Server-only; nothing the browser sends except the HttpOnly session cookie matters.
//
//   identity     verified __Host-wnba_session (auth.js)
//   entitlement  network billing ledger via propbetedge-sports-billing POST /v1/entitlement (service binding
//                BILLING + ENTITLEMENT_READ_TOKEN). That Worker runs pbe_has_sport_entitlement(email, 'wnba_pro'):
//                active/trialing AND current_period_end > now. Other sports' own plans (nba_pro/nhl_pro/ufc_pro)
//                never count; PropBetEdge All Access (pbe_all_access) counts because the billing verdict says so
//                (access_source 'all_access'). The verdict's access_source is the ONLY input to the membership state.
//   owner        WNBA_OWNER_EMAILS (server config) — QA access for the owner's own verified session only
//
// States: signed_out | free | pro. A ledger we could not reach is `free` with entitlement_check UNAVAILABLE —
// never Pro, and never silently "not a subscriber" either.
//
// `membership` is the shared PropBetEdge membership contract (pbe-membership.js, byte-identical to
// LHBUSA/propbetedge-workers shared/membership): free | sport_pro | all_access | owner, derived here and only here.

import { sessionFrom } from './auth.js';
import { deriveMembership } from './pbe-membership.js';

export const PRODUCT_KEY = 'wnba_pro';
const SPORT = 'wnba';
const ACCESS_SOURCES = new Set(['sport', 'all_access', 'owner']);

const membershipFor = ({ entitled = false, accessSource = null, subscription = null, email = null } = {}) => deriveMembership({
  sport: SPORT,
  entitled,
  accessSource,
  productKey: subscription?.product_key || null,
  plan: subscription?.plan || null,
  email,
  currentPeriodEnd: subscription?.current_period_end || null,
  cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end)
});

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
    // Pass the verdict's access_source and the granting subscription's product_key through: the membership state is
    // derived from them, never from plan names or prices.
    const access_source = ACCESS_SOURCES.has(body.access_source) ? body.access_source : null;
    return { entitled: body.entitled === true, check: 'CURRENT', access_source, subscription: body.subscription || null };
  } catch (e) {
    return { entitled: false, check: 'UNAVAILABLE', error: e?.name === 'TimeoutError' ? 'entitlement_timeout' : 'entitlement_unreachable' };
  }
}

export async function resolveAccount(request, env) {
  const purchase_activation = env.WNBA_PURCHASE_ACTIVE === 'true' ? 'active' : 'inactive';
  const { session, reason } = await sessionFrom(request, env);
  if (!session) return { state: 'signed_out', entitled: false, access: 'none', email: null, reason, entitlement_check: 'NOT_ATTEMPTED', purchase_activation, product_key: PRODUCT_KEY, membership: membershipFor() };
  const base = { email: session.email, session_expires_at: new Date(session.exp * 1000).toISOString(), purchase_activation, product_key: PRODUCT_KEY };
  if (ownerEmails(env).has(session.email)) {
    return { ...base, state: 'pro', entitled: true, access: 'owner', access_source: 'owner', entitlement_check: 'OWNER', plan: null, status: 'owner', current_period_end: null, cancel_at_period_end: false, membership: membershipFor({ entitled: true, accessSource: 'owner', email: session.email }) };
  }
  const ent = await readEntitlement(env, session.email);
  if (!ent.entitled) {
    return { ...base, state: 'free', entitled: false, access: 'none', access_source: null, entitlement_check: ent.check, reason: ent.error || null, subscription_status: ent.subscription?.status || null, membership: membershipFor({ email: session.email }) };
  }
  const s = ent.subscription || {};
  return {
    ...base, state: 'pro', entitled: true, access: 'subscriber', access_source: ent.access_source, entitlement_check: ent.check,
    plan: s.plan || null, status: s.status || 'active', current_period_end: s.current_period_end || null, cancel_at_period_end: Boolean(s.cancel_at_period_end),
    membership: membershipFor({ entitled: true, accessSource: ent.access_source, subscription: s, email: session.email })
  };
}
