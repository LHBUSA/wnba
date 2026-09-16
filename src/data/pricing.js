// WNBA Pro — Founding Season pricing. The ONLY place checkout identifiers live.
//
// Verified LIVE Stripe objects (owner-created; never recreate): product prod_VF9ThkcPbyvOTG.
// The same price + link IDs are allowlisted in the deployed propbetedge-sports-billing Worker
// (LHBUSA/propbetedge-workers catalog.js) and were canaried end to end on 2026-09-15
// (docs/evidence/billing/wnba-billing-canaries-2026-09-15.json, 12/12).
//
// Hosted checkout URLs were re-read directly from the LIVE Stripe Payment Link objects on 2026-09-16.
// Both links are active, subscription-mode, no-trial, and redirect back to /pro?checkout=success.

export const PRODUCT_KEY = 'wnba_pro';
export const STRIPE_PRODUCT_ID = 'prod_VF9ThkcPbyvOTG';

export const PLANS = Object.freeze({
  monthly: {
    id: 'monthly',
    label: 'Monthly',
    price: '$9.99',
    per: 'month',
    tag: 'Best value',
    note: 'Billed monthly · cancel anytime · no free trial',
    stripePriceId: 'price_1UEfAmF3CaVzg4OReyWRioNO',
    paymentLinkId: 'plink_1UEfBOF3CaVzg4ORuxdQriRX',
    url: 'https://buy.stripe.com/7sY28rb2u6ai3lr5sn7wA0E'
  },
  weekly: {
    id: 'weekly',
    label: 'Weekly',
    price: '$3.99',
    per: 'week',
    tag: 'Flexible',
    note: 'Billed weekly · cancel anytime · no free trial',
    stripePriceId: 'price_1UEfAsF3CaVzg4OR7082zM5i',
    paymentLinkId: 'plink_1UEfBTF3CaVzg4ORy1GQeoI5',
    url: 'https://buy.stripe.com/5kQeVd1rUeGO3lr3kf7wA0F'
  }
});

export const DEFAULT_PLAN = 'monthly';

/** Checkout is available only when every identifier exists AND the server says purchases are active. */
export function checkoutReady(plan, account) {
  return Boolean(plan?.url && plan?.paymentLinkId && plan?.stripePriceId && account?.purchase_activation === 'active');
}
