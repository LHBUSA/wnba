# Claude START NOW — PropBetEdge WNBA V1

Current working rule: **work directly from `main`; use previews only for QA.**

Read in this order before editing:
1. `CLAUDE.md`
2. `docs/WNBA_SOURCE_MATRIX.md`
3. `docs/NBA_REUSE_MAP.md`
4. GitHub Issue #1

Then inspect these exact NBA references for reusable patterns only:

## NBA files worth opening first
Repo: `LHBUSA/nba-propbetedge` current `main`

### Data contracts / truth
- `src/data/nba-api.js` — owned API adapter / envelope pattern
- `src/data/nba.js` — centralized product data adapter
- `src/data/freshness.js` — freshness state semantics
- `src/data/normalize.js` — provider normalization patterns
- `src/data/entities.js` — entity identity patterns
- `src/data/live-derive.js` — derived live context from real events
- `src/data/replay.js` — replay mechanics from persisted events
- `src/data/rotations.js` — rotation observations
- `src/data/prop-progress.js` — live prop progress patterns
- `src/data/grading.js` — deterministic grading ideas
- `src/data/pbe-news.js` — newsroom adapter ideas

### Cloudflare decomposition
- `nba-workers/nba-live-feed`
- `nba-workers/nba-schedule`
- `nba-workers/nba-stats`
- `nba-workers/nba-lineups`
- `nba-workers/nba-odds`
- `nba-workers/nba-snapshots`
- `nba-workers/nba-pipeline`
- `nba-workers/nba-grader`
- `nba-workers/nba-notify`

Do **not** copy provider URLs, NBA IDs, season constants, team/player maps, image URLs, league assumptions, or Vercel relay debt into WNBA.

---

# EXECUTE IMMEDIATELY

## Task 1 — prove WNBA source truth
Use real WNBA canaries and fill `docs/WNBA_SOURCE_MATRIX.md`.

Minimum first canaries:
- one current/recent schedule response with stable game IDs;
- one completed game detail;
- one play-by-play/event stream;
- verify whether shot coordinates are genuinely published;
- one box score;
- one roster/player identity source;
- standings;
- injury/availability source;
- official WNBA news source;
- at least one independent external WNBA news source;
- game odds support;
- player prop support;
- historical/replay availability.

For each capability record exact source, ID, observed timestamp, response semantics, freshness, rights/usage note, failure mode and proof.

Do not infer capability support from NBA.

## Task 2 — build the owned Cloudflare contract first
Create a WNBA Worker layout consistent with the repo doctrine.

Preferred first public routes:
- `GET /health`
- `GET /v1/schedule`
- `GET /v1/games/:gameId`
- `GET /v1/games/:gameId/events`
- `GET /v1/games/:gameId/boxscore`
- `GET /v1/standings`
- `GET /v1/players/:playerId`
- `GET /v1/teams/:teamId/roster`
- `GET /v1/injuries`
- `GET /v1/news`

Every response should carry source/freshness metadata and explicit degraded/unavailable state. No provider secret in browser code.

## Task 3 — design durable Supabase schema
Create additive migrations only; do not run destructive production migrations without explicit owner approval.

Minimum durable entities:
- `wnba_teams`
- `wnba_players`
- `wnba_rosters`
- `wnba_games`
- `wnba_game_events`
- `wnba_player_game_stats`
- `wnba_team_game_stats`
- `wnba_availability_events`
- `wnba_odds_snapshots`
- `wnba_news_sources`
- `wnba_news_items`
- `wnba_source_health`

Include source IDs, captured/updated times, deterministic unique keys and provenance fields.

## Task 4 — first production shell
Build a WNBA-native shell on top of real Worker responses only.

Primary product navigation:
- TODAY
- WNBACAST
- PROPS
- MATCHUPS
- PLAYERS
- INJURIES
- NEWS
- STANDINGS
- STATS
- TEAMS
- TRACK RECORD

The homepage must lead with actual current WNBA state, not a giant marketing hero.

If the season/slate is idle, show an honest useful no-games/offseason state.

## Task 5 — WNBACast first real game
Use a real completed WNBA game first so replay/event semantics can be proven deterministically.

Required:
- scoreboard/status;
- period/clock where supplied;
- event stream;
- box score;
- lead/run context derived from real events;
- shot chart only if source supplies real coordinates;
- explicit source/freshness labels;
- replay from persisted real events once storage exists.

No synthetic shot coordinates. No random positions. No fake possession state.

## Task 6 — real player identity + photography
Build the image/identity manifest before polishing player pages.

Each shipped image needs:
- stable player source ID;
- exact display name;
- source page;
- media URL;
- license/rights basis;
- attribution;
- dimensions;
- focal/crop metadata;
- identity confidence/manual verification;
- last verified timestamp.

Wrong person is a release blocker. Neutral fallback is acceptable.

## Task 7 — independent WNBA newsroom
This is not a later nice-to-have.

Build a separate WNBA news lane with:
- source registry;
- Cloudflare ingestion;
- dedupe/canonical handling;
- WNBA entity tagging;
- Supabase durable records;
- captured/published/updated timestamps;
- source attribution;
- owned PBE analysis only from supported facts.

NBA and WNBA newsroom failures/deploys must be independent.

## Task 8 — network + commercial shell
Prepare but keep purchase activation fail-closed.

Offer:
- `$9.99/month` default — Best Value
- `$3.99/week` — Flexible
- no trial
- cancel anytime

Do not invent Stripe IDs. Target entitlement is `wnba_pro` in shared sport entitlements.

Network footer target:
MLB / NFL / NBA / WNBA / NHL / UFC
Discord: `https://discord.gg/kb5zCTHbME`

## Task 9 — hard guards before first push
Add tests/static checks that fail on:
- `Math.random()` or synthetic sports-data generation in production paths;
- direct browser provider calls where Worker routes exist;
- hardcoded NBA league IDs/team maps in WNBA source;
- silently substituted prior-season data as current;
- missing source/freshness metadata on volatile responses;
- broken/unknown player image identity;
- Vercel Functions or GitHub Actions being used as production ingestion/intelligence runtime.

## Task 10 — push and report
Work on `main` unless a short-lived QA branch is absolutely required. Do not let a preview branch become a second product line.

First meaningful report must include:
- MAIN SHA
- exact files added/changed
- NBA references reused
- DATA SOURCE CANARIES: PASS / FAIL / DEGRADED
- WNBA SOURCE MATRIX status
- Cloudflare Worker routes
- Supabase migrations proposed/applied
- WNBACast state
- player-image coverage + rights state
- WNBA newsroom state
- 1440 desktop PASS/FAIL
- 390 mobile PASS/FAIL
- horizontal overflow PASS/FAIL
- console/runtime errors
- Vercel API dependencies remaining
- payment/entitlement blockers
- rollback SHA
- next milestone

Do not say PROVEN unless the exact check ran.

# Product north star

WNBA should feel like a first-class PropBetEdge vertical whose basketball intelligence benefits from everything learned in NBA, while its data, news, identity, player imagery and runtime are genuinely WNBA-native and independently operable.