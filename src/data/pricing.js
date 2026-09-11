// WNBA Pro — Founding Season pricing. The ONLY place checkout identifiers live.
//
// Stripe IDs are deliberately null: the WNBA Stripe product, the two recurring
// prices and the hosted Payment Links have not been created yet. Checkout stays
// fail-closed until every billing canary in docs/PAYWALL.md passes; then the
// exact IDs are written here, into the propbetedge-sports-billing Worker's
// allowlist, and WNBA_PURCHASE_ACTIVE flips — in one change.

export const PRODUCT_KEY = 'wnba_pro';

export const PLANS = Object.freeze({
  monthly: {
    id: 'monthly',
    label: 'Monthly',
    price: '$9.99',
    per: 'month',
    tag: 'Best value',
    note: 'Billed monthly · cancel anytime · no free trial',
    stripePriceId: null,
    paymentLinkId: null,
    url: null
  },
  weekly: {
    id: 'weekly',
    label: 'Weekly',
    price: '$3.99',
    per: 'week',
    tag: 'Flexible',
    note: 'Billed weekly · cancel anytime · no free trial',
    stripePriceId: null,
    paymentLinkId: null,
    url: null
  }
});

export const DEFAULT_PLAN = 'monthly';

/** Checkout is available only when every identifier exists AND the server says purchases are active. */
export function checkoutReady(plan, account) {
  return Boolean(plan?.url && plan?.paymentLinkId && plan?.stripePriceId && account?.purchase_activation === 'active');
}
