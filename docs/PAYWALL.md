# WNBA Pro — paywall & entitlement activation

**State: FAIL-CLOSED.** Every visitor is `signed_out`; the checkout button is disabled; no Stripe ID exists in this repo.

## Offer (fixed)

| Plan | Price | Tag | Terms |
|---|---|---|---|
| Monthly (default selected) | $9.99 / month | Best value | recurring · no free trial · cancel anytime |
| Weekly | $3.99 / week | Flexible | recurring · no free trial · cancel anytime |

Config lives only in `src/data/pricing.js` (`stripePriceId`, `paymentLinkId`, `url` are `null`).

## Runtime path

```
Browser → Stripe-hosted Payment Link → Stripe webhook
       → propbetedge-sports-billing (Cloudflare Worker, LHBUSA/propbetedge-workers)
       → Supabase pbe_sport_entitlements (rlfyavnhbngwbldebrid), product_key wnba_pro
wnba-api /v1/account → verified PropBetEdge session → pbe_has_sport_entitlement(email, 'wnba_pro')
```

One email owns each sport independently (one row per Stripe subscription; unique on `stripe_subscription_id`, not email).

## Three states (server-decided)

| State | Rendered when | What it shows |
|---|---|---|
| `signed_out` | default (current) | value, $9.99 monthly pre-selected, $3.99 weekly, existing-subscriber sign-in line |
| `free` | verified session, no active `wnba_pro` | verified email, same two plans, direct upgrade, no second login |
| `pro` | verified session + active `wnba_pro` with `current_period_end > now()` | desk treatment, plan/status/renewal, primary action "Open WNBACast", restrained controls |

`?preview=free|pro` works **only in `vite dev`** (tree-shaken from production) for design review. The guard fails the build if `localStorage` is used for entitlement.

## Activation checklist (ALL must be PASS, then flip atomically)

| # | Gate | Status 2026-09-11 | Blocker |
|---|---|---|---|
| 1 | Stripe product "PropBetEdge WNBA Pro" exists | ✗ | no Stripe credential in this session (Worker secrets unreadable; no Stripe CLI) |
| 2 | Recurring prices $9.99/mo and $3.99/wk exist | ✗ | depends on 1 |
| 3 | Hosted Payment Links (no trial, metadata `acquired_sport=wnba`, `product=propbetedge_wnba`, `plan=pro_monthly|pro_weekly`, `trial=none`) | ✗ | depends on 2 |
| 4 | `wnba` accepted by `pbe_sport_entitlements_sport_check` | ✗ staged | `propbetedge-workers/migrations/20260911_pbe_add_wnba_sport_v1.sql` — owner must apply (after the base ledger migration) |
| 5 | Billing Worker `PRODUCTS`/`LINKS` allowlist carries the exact WNBA price + link IDs | ✗ | depends on 2–3; change lands in `LHBUSA/propbetedge-workers` |
| 6 | Stripe webhook endpoint → billing Worker, secret bound | ✗ | owner / Stripe dashboard |
| 7 | Signature verification rejects bad/expired signatures | code present in billing Worker; not canaried for WNBA | 6 |
| 8 | Event ordering (subscription.* before checkout.session.completed) | code present (`isNewer`, identity-only fill); not canaried | 6 |
| 9 | Duplicate delivery idempotent (`pbe_sport_stripe_events`) | code present; not canaried | 6 |
| 10 | Cancel → `canceled`, access ends at period end | not canaried | 6 |
| 11 | Weekly entitlement end-to-end | not canaried | 1–6 |
| 12 | Monthly entitlement end-to-end | not canaried | 1–6 |
| 13 | One email holding NBA Pro + WNBA Pro independently | not canaried | 4–6 |
| 14 | Browser cannot self-grant (no query/cookie/localStorage path) | ✓ `/v1/account` is fail-closed; guard enforces | — |
| 15 | WNBA session verification in `wnba-api` (`auth.propbetedge.ai` session → email) | ✗ | auth-magic Worker source is not in Git; session contract must be captured first |

## Atomic activation (one commit, one deploy)

1. Write the exact IDs into `src/data/pricing.js`.
2. Set `WNBA_PURCHASE_ACTIVE = "true"` in `workers/wnba-api/wrangler.toml` — the guard fails the build unless 1 and 2 change together.
3. Billing Worker allowlist change deployed first (versions upload → canary → deploy).
4. Push `main` (Vercel) and `wrangler deploy` `wnba-api` from the same SHA.
