# PBE WNBA — release state and owner runbook

State as of 2026-09-15 20:35Z. The official record starts at 0-0 with the first owner-approved lock.

## Live in production (2026-09-15 21:05Z, main 3141413)

| Surface | Version | Rollback | Notes |
|---|---|---|---|
| Frontend (Vercel `wnba`) | main `3141413` (auto) | Vercel deployment for `8819bda` | PBE Picks UI, team slot, Track Record, Pro rewrite, PBE in mobile bottom nav |
| `wnba-web` | `b2e208e0` | `76d60363` | SSR shell incl. mobile PBE item; CSP includes wnba-api.propbetedge.ai |
| `wnba-api` | `46a10677` on `wnba-api.propbetedge.ai` + workers.dev | `1ee7f087` (previous release) · `3e039a98` (pre-release code + secrets) · `3c73fe2f` | WNBA sign-in, account, entitlement-gated PBE routes, official track record (CONNECTED, 0-0). Secrets bound 20:49Z. |
| `wnba-ingest` | `deff1808` | `9f21fa6d` | PBE runner `dry_run` + lock-policy checkpoints + 2-min injury polling near tips |
| Email Sending | `mail.wnba.propbetedge.ai` enabled | disable subdomain | MX/SPF/DKIM/DMARC(p=reject) resolve publicly |
| Supabase tkmln | ledger v1 (19:50:44Z); view INSERT revoke (20:48:12Z); `pbe-wnba-model-v1` REGISTERED champion_candidate (20:56:47Z) | — | 0 promotions · `wnba_pbe_current_champion()` NULL · 0 observations/locks/grades |

Receipts: `docs/evidence/wnba-pbe-view-grant-revoke-tkmln.json`, `docs/evidence/wnba-pbe-model-v1-registration-tkmln.json`, `docs/evidence/auth/wnba-auth-canaries-wnbaauthmu35eem5.json` (14/14).

## Still gated (owner)

1. Eligibility contract: study proposes K=3 (unchanged floor); holdout entry slice misses the pre-registered floor — owner chooses (docs/PBE_WNBA_ELIGIBILITY_STUDY.md). Freeze `model/pbe-wnba-model-v1/eligibility/eligibility_contract.json` (status FROZEN) before promotion; `scripts/model/promotion-sql.mjs` refuses without it.
2. Promotion (`scripts/model/promotion-sql.mjs --approved-by`), then arming (`PBE_MODE=armed`, `PBE_ARMED_BY`, ingest `PBE_SUPABASE_*`) and `PBE_PUBLISH=true` — after lock-policy evidence review.
3. Lock policy: `node scripts/pbe/lock-policy-report.mjs` once games have been measured; T-15m stays experimental.
4. Checkout: stays OFF until owner activation after sign-in/entitlement/cancellation evidence (all passed on production 2026-09-15) and explicit approval; then pricing.js URLs + `WNBA_PURCHASE_ACTIVE` together.

## Dry-run timeline

The runner scores games inside 48h of tip:

- **Scoring starts 2026-09-15 23:30Z.** On the first due pass it backfills the 2025/2026 row stores, 30 finals per run, and refuses to score until complete.
- **First shadow lock:** 2026-09-17 23:15Z (CON @ ATL, T-15m).
- **Shadow data location:** KV `pbe:v1:shadow:*`.
- **Visibility:** the owner session only. Shadow data is never part of the official record.

## Lock-policy measurement (owed before T-15m/v1 is made permanent)

Compare `avail:v1:changes` timestamps (injury-feed changes captured every 10 minutes) against scheduled tips across the remaining regular season. Report how often a status changes inside T-60m, T-30m and T-15m.
