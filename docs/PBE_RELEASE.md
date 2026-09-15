# PBE WNBA — release state and owner runbook

State as of 2026-09-15 20:35Z. The official record starts at 0-0 with the first owner-approved lock.

## Live in production

| Surface | Version | Rollback | Notes |
|---|---|---|---|
| Frontend (Vercel `wnba`) | main `87d354d` (auto-deploy) | Vercel deployment for `8819bda` | PBE Picks UI, team slot, Track Record, Pro rewrite. Private calls stay dormant until `/health` lists `/v1/pbe/status`. |
| `wnba-web` | `76d60363` | `d4529f69` | CSP `connect-src` adds `https://wnba-api.propbetedge.ai`; value-free SSR for `/pbe-picks` and `/pbe-picks/model`. |
| `wnba-ingest` | `9f21fa6d` | `5d51e1a7` | PBE runner with `PBE_MODE=dry_run` (shadow KV only). It also picks up the 09-13 play-by-play semantics in `shared/espn.js` (7029e65), which were already live in `wnba-api`. |
| Supabase tkmln | `wnba_pbe_*` ledger v1, applied 19:50:44Z | tables are empty; no data to roll back | `20260915210000_wnba_pbe_current_grades_revoke_insert.sql` is staged and NOT applied (an inert view grant). |

## Not deployed (owner actions)

`wnba-api` at main (sign-in, account, PBE routes, official track record) is held. Shipping it without secrets would turn today's truthful 0-0 track record into "not connected" and make sign-in answer 503. The permission classifier blocked binding secrets from this session.

1. **Refresh Cloudflare scopes, then onboard the sign-in sending subdomain.** Wrangler currently lacks `email_sending:write`:
   ```
   npx wrangler login
   npx wrangler email sending enable mail.wnba.propbetedge.ai
   npx wrangler email sending dns get mail.wnba.propbetedge.ai
   ```
2. **Bind `wnba-api` secrets** (run in `workers/wnba-api`):
   ```
   npx wrangler secret put WNBA_SESSION_SECRET            # new random value, e.g. 48+ random bytes base64url; never reuse another product's key
   npx wrangler secret put ENTITLEMENT_READ_TOKEN         # = D:\Workers\secrets\pbe-billing-entitlement-read-token
   npx wrangler secret put WNBA_OWNER_EMAILS              # owner sign-in email(s), comma separated
   npx wrangler secret put PBE_SUPABASE_URL               # https://tkmlnhmylqnttmnsnief.supabase.co
   npx wrangler secret put PBE_SUPABASE_SERVICE_ROLE_KEY  # tkmln service role
   ```
3. **Deploy `wnba-api` from clean main.** This also creates the custom domain `wnba-api.propbetedge.ai`. Current rollback: `3c73fe2f`.
4. **Canaries** (run after deploy):
   - `GET /health`: the route list includes `/v1/pbe/status`.
   - `/v1/pbe/picks` signed out: 401, no values.
   - Owner requests a sign-in link at `/pro`, confirms it, then sees `WNBA Pro · Owner` and shadow calls on `/pbe-picks` and a team page.
   - A non-owner signed-in email sees the free state and gets 403 on `/v1/pbe/picks`.
5. **Model registration (approval).** Generate the SQL, review it, apply:
   ```
   node scripts/model/registration-sql.mjs --promoted-by "<approval ref>"
   ```
   The hashes are recomputed from file bytes:
   - artifact `180dfcf5…`
   - feature spec `83c36ef3…`
   - validation receipt `bd134206…`
6. **First official lock (approval).** Set `PBE_MODE=armed` and `PBE_ARMED_BY` on `wnba-ingest`, plus its `PBE_SUPABASE_*` secrets. Set `PBE_PUBLISH=true` on `wnba-api` in the same release window.
7. **Checkout (approval).** Supply the two `buy.stripe.com` URLs and run a real checkout canary. Then flip the `pricing.js` URLs and `WNBA_PURCHASE_ACTIVE` together (guard rule 7).

## Dry-run timeline

The runner scores games inside 48h of tip:

- **Scoring starts 2026-09-15 23:30Z.** On the first due pass it backfills the 2025/2026 row stores, 30 finals per run, and refuses to score until complete.
- **First shadow lock:** 2026-09-17 23:15Z (CON @ ATL, T-15m).
- **Shadow data location:** KV `pbe:v1:shadow:*`.
- **Visibility:** the owner session only. Shadow data is never part of the official record.

## Lock-policy measurement (owed before T-15m/v1 is made permanent)

Compare `avail:v1:changes` timestamps (injury-feed changes captured every 10 minutes) against scheduled tips across the remaining regular season. Report how often a status changes inside T-60m, T-30m and T-15m.
