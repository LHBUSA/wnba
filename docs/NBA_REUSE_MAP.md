# WNBA <- NBA Reuse Map

Purpose: accelerate WNBA without cloning NBA data assumptions.

Source reference: `LHBUSA/nba-propbetedge` current `main`.

## Reuse aggressively

### Data-access shape
Use the NBA move toward one owned data adapter and explicit data envelopes as the pattern:
- source/provider
- fetched_at / captured_at
- stale_at or freshness state
- CURRENT / CACHED / STALE / UNAVAILABLE / ERROR semantics
- null/unavailable instead of invented values

WNBA should start Worker-first rather than carrying NBA's historical browser/provider debt.

### Cloudflare worker decomposition
NBA already proves useful domain separation. Use these as architectural references, not code copied blindly:
- `nba-live-feed` -> candidate `wnba-live-feed` / `wnba-api`
- `nba-schedule` -> WNBA schedule + season truth
- `nba-stats` -> WNBA team/player stats
- `nba-lineups` -> WNBA roster/rotation/availability observations
- `nba-odds` -> WNBA game/prop market snapshots
- `nba-snapshots` -> durable state and change detection
- `nba-pipeline` -> bounded ingestion/orchestration patterns
- `nba-grader` -> immutable grading patterns once WNBA picks exist
- `nba-notify` -> later alerts, only after durable source truth exists

Cloudflare remains runtime. GitHub Actions are CI only.

### Basketball product mechanics
Reuse the strongest product principles already established in NBA:
- command-center hierarchy instead of marketing-first landing
- live game selector
- scoreboard / period / clock state
- play-by-play event stream
- real shot coordinates only
- box-score context
- rotation / usage observations derived from real games
- clear separation of market price, consensus, PBE fair value and PBE model gap
- player deep dives
- injury/availability desk
- matchup research
- immutable track record
- replay from persisted events
- useful no-games / offseason state

### Truth guards
Port the NBA lessons as hard WNBA tests:
- no `Math.random()` or equivalent sports-data fabrication
- no direct provider fetches from browser code when an owned Worker path exists
- no hardcoded NBA/WNBA season assumption presented as current
- no silent catch that makes failed data look healthy
- no fake shot positions when coordinates are missing
- no model probability without a real model/version/method
- no ROI without a recorded market price

### Visual system
Reuse PropBetEdge basketball design language and interaction primitives where useful:
- near-black / gold system
- dense but readable game cards
- player identity cards
- live-state badges
- price/model separation
- responsive 1440 + 390 verification

Do not make WNBA look like an NBA skin. WNBA gets its own hierarchy, imagery, editorial rhythm and copy.

## Do NOT copy blindly

### Provider endpoints
NBA endpoint behavior is not proof of WNBA support. Every WNBA capability remains `UNVERIFIED` until canaried in `docs/WNBA_SOURCE_MATRIX.md`.

### IDs and joins
Never reuse NBA team/player/game identifiers, mapping tables or fuzzy joins. WNBA identity must be deterministic from WNBA-native source IDs wherever possible.

### Season logic
Reuse the resolver pattern, not NBA season values or calendar assumptions. Prove WNBA season boundaries and offseason behavior independently.

### Browser relays / Vercel backend debt
WNBA should not inherit temporary NBA Vercel relay patterns. Start with:
`Browser -> Cloudflare Worker -> provider / Supabase`

### News
WNBA gets an independent newsroom lane. Do not route NBA stories through a league filter and call that a WNBA newsroom.

### Images
Do not inherit NBA image URLs or identity mappings. WNBA player imagery requires its own rights + identity manifest.

### Auth / entitlement shortcuts
Do not copy legacy browser, localStorage, query-param or public-table entitlement behavior. Target:
`Stripe -> Cloudflare billing -> Supabase pbe_sport_entitlements -> server-verified WNBA session/account state`.

## Recommended first implementation order

1. Prove WNBA schedule/game identity.
2. Prove scoreboard/live-state and one completed-game detail.
3. Prove play-by-play and whether real shot coordinates exist.
4. Prove rosters/player IDs, box score and standings.
5. Prove injuries/availability and news sources.
6. Establish Worker contracts + normalized response envelopes.
7. Add Supabase schema migrations for games/events/players/stats/news/snapshots.
8. Build the Today shell against those real Worker responses.
9. Build WNBACast against one real completed game and current/live semantics when available.
10. Build player pages + verified image manifest.
11. Bring independent WNBA news automation online.
12. Add odds/props only after provider support is proven.
13. Add paid activation only after Stripe IDs + `wnba_pro` entitlement path are live and canaried.

## First report must include

- exact WNBA `main` SHA
- NBA references actually reused
- source canary table with PASS / FAIL / DEGRADED
- Worker routes implemented
- Supabase migrations proposed/applied
- direct-provider browser dependencies: NONE target
- WNBACast state
- player-photo coverage + rights state
- WNBA newsroom state
- 1440 / 390 proof
- blockers
- rollback SHA

The goal is speed through reuse of solved engineering principles, not speed through pretending NBA data is WNBA data.