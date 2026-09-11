# PropBetEdge WNBA

**WNBA intelligence built as a first-class PropBetEdge vertical.**

Target: `https://wnba.propbetedge.ai`

This repository starts from the product and architecture lessons already proven across PropBetEdge NBA, UFC, NFL, NHL and MLB. It is **not** a generic basketball skin and it is **not** a copy of NBA data. The WNBA product must be WNBA-native while reusing the strongest PropBetEdge interaction, truth, account and research patterns.

## Product thesis

WNBA is a focused market where a deep, fast, independently operated intelligence product can earn meaningful search share, repeat usage and paid subscribers without needing NBA-scale traffic. It should also become a natural top-of-funnel into PropBetEdge NBA and the broader sports network.

The goal is to own the workflow:

**DISCOVER → RESEARCH → PRICE → DECIDE → WATCH → ALERT → GRADE → REPLAY → LEARN → RETURN**

## Commercial model

Founding Season pricing:

- **$9.99/month** — default / Best Value
- **$3.99/week** — Flexible
- **No free trial**
- **Cancel anytime**
- Existing/future legacy customers are never silently repriced

Checkout and entitlement architecture:

**Browser → Stripe-hosted Checkout → Cloudflare billing Worker → Supabase entitlement truth**

Vercel is frontend hosting only. GitHub is source control only.

## Architecture invariant

- **GitHub stores it.** Source, history, review, tests.
- **Vercel presents it.** Frontend delivery only.
- **Supabase remembers it.** Durable WNBA data, snapshots, entitlements and history.
- **Cloudflare operates it.** Workers, APIs, normalization, provider mediation, news automation, queues, cron/workflows, cache and edge runtime.

Do not move runtime into GitHub Actions or Vercel Functions.

## Product pillars

1. **WNBA Today / Command Center** — current slate, state, context, market readiness.
2. **WNBACast** — live game intelligence and replay from real event data; never fabricate positions or events.
3. **Props / Best Line** — sportsbook truth, consensus and PBE model output kept explicitly separate.
4. **Matchups** — pace, roles, recent form, team/player context and matchup-specific research.
5. **Player Intelligence** — real player pages, real photos where licensing permits, game logs, roles and news.
6. **Injury / Availability Desk** — sourced status with timestamps; no guessed return dates.
7. **Standings / Stats / Teams** — current-season truth plus clean archive semantics.
8. **PBE Picks + Track Record** — recorded prices, deterministic grading, truthful ROI and sample-size labels.
9. **Independent WNBA News** — automated WNBA-native newsroom with its own ingestion and publishing lane.
10. **Pro Account** — premium signed-out, signed-in-free and paid states consistent with the best PropBetEdge paywall UX.

## Imagery

Use real player photography only when rights are acceptable. Maintain a source manifest with source URL, license, attribution, dimensions, crop/focal metadata, confidence and verification time. Prefer properly licensed Wikimedia Commons / public-domain / approved provider imagery. Never substitute the wrong person. Unresolved identity falls back to a deliberate neutral PBE/player treatment.

## News

WNBA needs an **independent news automation**, not NBA stories relabeled as WNBA and not a single external wire masquerading as PropBetEdge reporting. The ingestion/publishing runtime belongs on Cloudflare; durable normalized stories and source state belong in Supabase. Source attribution and timestamps must stay visible.

## Network positioning

WNBA should cross-link naturally to NBA without making the WNBA product feel secondary. The shared footer/network should ultimately include:

`MLB · NFL · NBA · WNBA · NHL · UFC`

Canonical Discord: `https://discord.gg/kb5zCTHbME`

## Development posture

Build on `main` in small, testable commits. The repository is intentionally new, so there is no stale branch architecture to preserve. Do not deploy backend runtime through GitHub Actions. Before public launch, verify desktop 1440 and mobile 390, zero horizontal overflow, zero broken imagery, truthful unavailable states, source age/provenance, and real production Worker paths.

See `CLAUDE.md` for the execution brief.