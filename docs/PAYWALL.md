# WNBA Pro — paywall & entitlement activation

**State: FAIL-CLOSED.** The checkout button is still disabled and no Stripe ID is in this repo. `/v1/account` now makes a real, server-only decision (verified `pbe_session` cookie -> `pbe_has_sport_entitlement`), but it cannot receive the cookie until `wnba-api` answers on a `propbetedge.ai` host, so in production today every visitor still resolves to `signed_out`.

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

## Session contract (captured 2026-09-11 from the deployed `propbetedge-auth-magic`)

| Fact | Value |
|---|---|
| Issuer | `propbetedge-auth-magic` at `auth.propbetedge.ai` |
| Cookie | `pbe_session`, `Domain=.propbetedge.ai`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day |
| Token | HS256 JWT over `{ email, type: 'session', iat, exp }`, signed with that Worker's `MAGIC_JWT_SECRET` |

`wnba-api` verifies that signature **itself** (`workers/wnba-api/src/session.js`) and does not
call `auth.propbetedge.ai/session`. That endpoint re-checks the **legacy MLB** `pbe_subscribers`
table and answers `valid:false` — *and clears the session cookie* — for anyone without an active
MLB subscription. A WNBA Pro customer who has never bought MLB must not be signed out by it.
Sports are independent; the ledger decides each one.

Our verifier is deliberately stricter than the issuer's: `alg` is pinned to HS256 (an `alg:none`
token can never pass), `exp` is required rather than optional, `type` must be `session`, and the
subject must parse as an email. It is verification only — this Worker never issues a session and
never writes an entitlement.

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
| 1 | Stripe product "PropBetEdge WNBA Pro" exists | ✓ owner-created LIVE `prod_VF9ThkcPbyvOTG` | — |
| 2 | Recurring prices $9.99/mo and $3.99/wk exist | ✓ `price_1UEfAmF3CaVzg4OReyWRioNO` / `price_1UEfAsF3CaVzg4OR7082zM5i` | — |
| 3 | Hosted Payment Links (no trial) | ✓ `plink_1UEfBOF3CaVzg4ORuxdQriRX` / `plink_1UEfBTF3CaVzg4ORy1GQeoI5`; metadata not verified by us | owner to confirm link metadata |
| 4 | `wnba` accepted by `pbe_sport_entitlements_sport_check` | ✓ owner reports applied in production | not re-verified from here (no Supabase credential in this session) |
| 5 | Billing Worker `PRODUCTS`/`LINKS` allowlist carries the exact WNBA price + link IDs | ✓ in Git, ✗ in Cloudflare | merged `LHBUSA/propbetedge-workers` PR #4 → main `fff995c0`; the Worker **`propbetedge-sports-billing` does not exist on the Cloudflare account** and has never been deployed |
| 6 | Stripe webhook endpoint → billing Worker, secret bound | ✗ | depends on 5; `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` must be set on the script, then `/health` reports `ok:true` |
| 7 | Signature verification rejects bad/expired signatures | code present in billing Worker; not canaried for WNBA | 6 |
| 8 | Event ordering (subscription.* before checkout.session.completed) | code present (`isNewer`, identity-only fill); not canaried | 6 |
| 9 | Duplicate delivery idempotent (`pbe_sport_stripe_events`) | code present; not canaried | 6 |
| 10 | Cancel → `canceled`, access ends at period end | not canaried | 6 |
| 11 | Weekly entitlement end-to-end | not canaried | 1–6 |
| 12 | Monthly entitlement end-to-end | not canaried | 1–6 |
| 13 | One email holding NBA Pro + WNBA Pro independently | not canaried | 4–6 |
| 14 | Browser cannot self-grant (no query/cookie/localStorage path) | ✓ `/v1/account` is fail-closed; guard enforces | — |
| 15a | Session contract captured | ✓ 2026-09-11 (table above) | — |
| 15b | `wnba-api` verifies `pbe_session` and calls the RPC | ✓ `src/session.js`, 22 tests in `tests/account.test.mjs` | not deployed |
| 15c | `/v1/account` can actually receive the cookie | ✗ | the cookie is scoped `Domain=.propbetedge.ai` and is `SameSite=Lax`, so it is never sent to `wnba-api.sales-fd3.workers.dev`. **`wnba-api` needs a custom domain under `propbetedge.ai`** (e.g. `wnba-api.propbetedge.ai`), the frontend must call it with `credentials: 'include'`, and the CSP `connect-src` must name it. Until then the route is correct but permanently `signed_out`. |
| 15d | Secrets bound on `wnba-api` | ✗ | `PBE_SESSION_JWT_SECRET` (= `propbetedge-auth-magic`'s `MAGIC_JWT_SECRET`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

## Atomic activation (one commit, one deploy)

1. Write the exact IDs into `src/data/pricing.js`.
2. Set `WNBA_PURCHASE_ACTIVE = "true"` in `workers/wnba-api/wrangler.toml` — the guard fails the build unless 1 and 2 change together.
3. Billing Worker allowlist change deployed first (versions upload → canary → deploy).
4. Push `main` (Vercel) and `wrangler deploy` `wnba-api` from the same SHA.
