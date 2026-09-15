# WNBA Pro — paywall & entitlement activation

**State 2026-09-15: FAIL-CLOSED.** Stripe objects exist and are wired into `src/data/pricing.js` (IDs only). The billing Worker + production ledger pass 12/12 signed canaries for WNBA. Checkout stays disabled because WNBA members cannot yet obtain a verified session (gate 15) and no real checkout has been run (gates 6, 11, 12).

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

## Session contract (captured 2026-09-11 from the deployed `propbetedge-auth-magic`; re-probed 2026-09-15)

| Fact | Value |
|---|---|
| Issuer | `propbetedge-auth-magic` v2.1 at `auth.propbetedge.ai` (`POST /magic/request`, `GET /magic/verify`, `GET /session`, `GET /pickup`, `POST /logout`) |
| Cookie | `pbe_session`, `Domain=.propbetedge.ai`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day |
| Token | HS256 JWT over `{ email, type: 'session', iat, exp }`, signed with that Worker's `MAGIC_JWT_SECRET` |
| Link issuance | `allow_any_subscriber: false`; `/magic/request` answers "If that email is registered…" (legacy MLB registry) |
| CORS | `Access-Control-Allow-Origin: https://mlb.propbetedge.ai` only (probed with `Origin: https://wnba.propbetedge.ai`) |

`wnba-api` verifies the signature itself and never calls `/session`: that endpoint re-checks the legacy MLB table and clears the cookie for anyone without MLB.

## Three states (server-decided)

| State | Rendered when | What it shows |
|---|---|---|
| `signed_out` | default (current) | value, $9.99 monthly pre-selected, $3.99 weekly, existing-subscriber sign-in line |
| `free` | verified session, no active `wnba_pro` | verified email, same two plans, direct upgrade, no second login |
| `pro` | verified session + active `wnba_pro` with `current_period_end > now()` | desk treatment, plan/status/renewal, primary action "Open WNBACast", restrained controls |

`?preview=free|pro` works **only in `vite dev`** (tree-shaken from production) for design review. The guard fails the build if `localStorage` is used for entitlement.

## Activation checklist (ALL must be PASS, then flip atomically)

Evidence: `docs/evidence/billing/wnba-billing-canaries-2026-09-15.json` (run `wnbapromu31jfin`, `node scripts/billing/wnba-billing-canaries.mjs`). Synthetic ids only; the run deleted its rows (0 remaining).

| # | Gate | Status 2026-09-15 | Evidence / blocker |
|---|---|---|---|
| 1 | Stripe product exists | ✓ owner-verified LIVE | `prod_VF9ThkcPbyvOTG` |
| 2 | Recurring prices | ✓ owner-verified LIVE | monthly `price_1UEfAmF3CaVzg4OReyWRioNO` $9.99 · weekly `price_1UEfAsF3CaVzg4OR7082zM5i` $3.99 · no trial |
| 3 | Payment Links | ✓ IDs owner-verified · ✗ URLs | `plink_1UEfBOF3CaVzg4ORuxdQriRX` / `plink_1UEfBTF3CaVzg4ORy1GQeoI5`. The `buy.stripe.com/…` URLs are in no source we can verify and we hold no Stripe key; **owner supplies both URLs** and confirms both links are active |
| 4 | `wnba` accepted by the live `pbe_sport_entitlements` sport constraint | ✓ PROVEN | canary 03: the production ledger accepted `sport='wnba'` rows through the deployed Worker |
| 5 | Production catalog = verified IDs | ✓ PROVEN | canary 01: deployed `propbetedge-sports-billing` v1.2.0 serves `wnba`/`wnba_pro`; canaries 03/06/08 prove exactly those price↔link pairs grant and nothing else does |
| 6 | Stripe → billing Worker delivery | ◐ partial | the endpoint secret is bound (`webhook_configured:true`) and real Stripe events reached the ledger on 2026-09-14 (`customer.subscription.updated`, `invoice.paid`). Whether the Stripe endpoint subscribes to `checkout.session.completed` can only be proven by a real WNBA checkout or the Stripe dashboard |
| 7 | Signatures: forged / tampered / stale / missing rejected | ✓ PROVEN | canary 02 |
| 8 | `checkout.session.completed` handled (checkout alone never grants) | ✓ PROVEN (signed synthetic) | canary 03 |
| 9 | Subscription lifecycle + ordering (subscription-first and checkout-first) | ✓ PROVEN (signed synthetic) | canaries 03, 06, 11 |
| 10 | Duplicate Stripe event idempotent | ✓ PROVEN | canary 05 |
| 11 | Cancel-at-period-end keeps access to period end; deletion ends it; late events cannot resurrect | ✓ PROVEN (signed synthetic) | canaries 09, 11 |
| 12 | Weekly + monthly end to end | ✓ Worker/ledger · ✗ real card | canaries 03, 06; real checkout owed |
| 13 | Expired / past_due denied | ✓ PROVEN | canaries 10, 12 |
| 14 | WNBA independent of NBA/NHL/UFC (one email, separate subscriptions) | ✓ PROVEN | canaries 04, 07 |
| 15a | Session contract captured | ✓ | table above |
| 15b | `wnba-api` verifies `pbe_session` itself and reads the ledger via the billing Worker | ✓ in code + tests | not deployed |
| 15c | `wnba-api` reachable on a `propbetedge.ai` host with credentials | ✗ | cookie is `Domain=.propbetedge.ai` `SameSite=Lax`; needs `wnba-api.propbetedge.ai` |
| 15d | **WNBA members can sign in** | ✗ **BLOCKER** | `auth.propbetedge.ai` (auth-magic v2.1, source not in Git) runs `allow_any_subscriber:false`, sends links only to registered legacy-MLB emails, and allows CORS only from `mlb.propbetedge.ai`. Owner decision 2026-09-15: extend the shared auth-magic (capture its source into Git → add the WNBA origin/redirect → treat an active `pbe_sport_entitlements` email as registered) |
| 15e | Secrets on `wnba-api` | ✗ | `PBE_SESSION_JWT_SECRET` (= auth-magic `MAGIC_JWT_SECRET`, owner-held) · `ENTITLEMENT_READ_TOKEN` |
| 16 | Browser cannot self-grant | ✓ | no query/header/body/localStorage path reaches the decision; guard rule 7 |

## Atomic activation (one commit, one deploy)

1. Write the exact IDs into `src/data/pricing.js`.
2. Set `WNBA_PURCHASE_ACTIVE = "true"` in `workers/wnba-api/wrangler.toml` — the guard fails the build unless 1 and 2 change together.
3. Billing Worker allowlist change deployed first (versions upload → canary → deploy).
4. Push `main` (Vercel) and `wrangler deploy` `wnba-api` from the same SHA.
