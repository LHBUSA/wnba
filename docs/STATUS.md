# WNBA product status

**WNBA PRODUCT STATUS: MAINTENANCE MODE**
Effective: 2026-09-25

**NO ACTIVE FEATURE ROADMAP.** The product is parked. Nothing below is a backlog.

## Production feature set

- Today / command center
- WNBACast
- PBE Picks
- Immutable track record
- WinBA Score
- WinBA Index
- Players
- Teams
- Stats
- Standings
- Injuries / availability
- Matchups
- Newsroom
- Pro auth (WNBA-owned passwordless sign-in, server-decided entitlement)
- PropBetEdge All Access
- Playoff bracket / postseason center (`docs/PLAYOFFS.md`)
- PropBetEdge Learn network link

Runtime topology is unchanged: `docs/ARCHITECTURE.md`. Cloudflare Cron keeps ingesting (live, availability,
archive, WinBA, odds, PBE, playoffs) without engineering attention.

## When engineering resumes

Only for:

1. a production defect
2. source / provider breakage
3. a security or auth issue
4. a postseason format or source change
5. a data-quality issue
6. a required shared-network compatibility change
7. next-season readiness, when WNBA work is intentionally reopened

Anything else is out of scope until WNBA is deliberately reopened.

## Health checks that stay green

- `npm run check` (guards, full test suite, build)
- `node scripts/auth/wnba-auth-canaries.mjs` (14 checks)
- `node scripts/auth/wnba-browser-auth-check.mjs` (14 checks)
- `node scripts/canary-sources.mjs` and `node scripts/canary-playoffs.mjs`
