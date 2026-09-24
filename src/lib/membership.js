// WNBA adapter for the shared PropBetEdge membership contract (./pbe-membership.js, byte-identical copy of
// LHBUSA/propbetedge-workers shared/membership). The browser never decides entitlement: it only reads the
// browser-safe `membership` object the wnba-api /v1/account decision returns.

import { readMembership, deriveMembership } from './pbe-membership.js';

export const SPORT = 'wnba';

/** The membership carried by an api.account() result. Anything malformed or missing is FREE. */
export function membershipFrom(res) {
  const data = res?.ok ? res.data : null;
  if (data?.membership) return readMembership(data.membership, SPORT);
  // Legacy pass-through for the deploy window where a newer frontend meets a wnba-api that predates the
  // contract: the server's own verdict (state 'pro', access 'owner' | 'subscriber') is still the only input.
  // No plan name, price or browser value can widen it (the contract treats an absent source as the sport plan).
  if (data?.state === 'pro' && data.entitled === true) {
    return deriveMembership({
      sport: SPORT,
      entitled: true,
      accessSource: data.access === 'owner' ? 'owner' : null,
      plan: data.plan || null,
      email: data.email || null,
      currentPeriodEnd: data.current_period_end || null,
      cancelAtPeriodEnd: Boolean(data.cancel_at_period_end)
    });
  }
  return deriveMembership({ sport: SPORT, entitled: false, email: data?.email || null });
}

export const isMember = (m) => Boolean(m && m.entitled && m.state !== 'free');

/** Let the shell (header badge, footer CTA) follow a membership resolved by a page, e.g. after checkout. */
export function announceMembership(m) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('pbe:membership', { detail: m }));
}
