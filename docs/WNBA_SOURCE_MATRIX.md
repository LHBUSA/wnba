# WNBA Source Matrix

Status: **MILESTONE 0 · UNVERIFIED UNTIL CANARIED**

This file is the source-of-truth gate for WNBA V1. Do not mark a capability PROVEN because an NBA endpoint has a similar shape or because a provider documentation page claims support. Run a real WNBA canary, capture the identifier/response semantics, and record licensing/usage constraints.

| Capability | Status | Candidate source | Native identifier | Freshness | Authority / usage | Durable storage | Public attribution | Failure / degradation rule | Canary evidence |
|---|---|---|---|---|---|---|---|---|---|
| Schedule / game IDs | UNVERIFIED | — | — | — | — | `wnba_games` | — | Never substitute another date for today | — |
| Scoreboard / game state | UNVERIFIED | — | — | — | — | snapshots as needed | — | Unknown state stays unknown | — |
| Play-by-play events | UNVERIFIED | — | — | — | — | `wnba_game_events` | — | No synthetic events | — |
| Shot coordinates | UNVERIFIED | — | — | — | — | event fields / snapshot | — | No coordinates = no shot map positions | — |
| Box score | UNVERIFIED | — | — | — | — | `wnba_player_game_stats` | — | Missing fields stay null | — |
| Team identities | UNVERIFIED | — | — | — | — | `wnba_teams` | — | Deterministic IDs only | — |
| Player identities | UNVERIFIED | — | — | — | — | `wnba_players` | — | Never fuzzy-join a person into a shipped page | — |
| Rosters | UNVERIFIED | — | — | — | — | `wnba_rosters` / history | — | Show source age; no guessed team assignment | — |
| Standings | UNVERIFIED | — | — | — | — | current + snapshots | — | Prior season must be labeled prior/final | — |
| Team season stats | UNVERIFIED | — | — | — | — | normalized stats | — | Unsupported metric stays unavailable | — |
| Player season stats | UNVERIFIED | — | — | — | — | normalized stats | — | Unsupported metric stays unavailable | — |
| Injury / availability | UNVERIFIED | — | — | — | — | current + event history | — | No guessed return date/status | — |
| Team schedule history | UNVERIFIED | — | — | — | — | games | — | Needed for rest/recent form | — |
| Player game logs | UNVERIFIED | — | — | — | — | player game stats | — | No inferred missing games | — |
| Game odds | UNVERIFIED | — | — | — | — | `wnba_odds_snapshots` | — | Market unavailable remains explicit | — |
| Player props | UNVERIFIED | — | — | — | — | snapshots when available | — | No market = no fake line | — |
| Historical / replay data | UNVERIFIED | — | — | — | — | Supabase + R2 as appropriate | — | Replay only from persisted real events | — |
| WNBA news — official | UNVERIFIED | — | — | — | — | normalized news | — | Attribution + timestamp required | — |
| WNBA news — external wire | UNVERIFIED | — | — | — | — | headline/link/source metadata per rights | publisher | Never present external copy as PBE reporting | — |
| Independent PBE WNBA news automation | UNVERIFIED | Cloudflare-owned lane | PBE story ID | target near-real-time / scheduled by source | source-specific | `wnba_news_*` | source list + PBE methodology | Degraded source state visible | — |
| Player photography | UNVERIFIED | Wikimedia / approved rights source | player source ID + media ID | verify periodically | license per asset | manifest + generated derivatives | visible/reachable credit | Wrong/uncertain identity = neutral fallback | — |

## Required canary record

For every capability moved out of `UNVERIFIED`, record:

```text
CAPABILITY:
SOURCE:
REQUEST / IDENTIFIER:
OBSERVED AT:
STATUS:
SHAPE / SEMANTICS:
FRESHNESS FIELD:
LICENSING / USAGE NOTE:
FAILURE MODE:
STORAGE DECISION:
PUBLIC ATTRIBUTION:
PROOF:
```

## Data-truth rules

1. **WNBA-native proof only.** NBA behavior is a design reference, not data evidence.
2. **No fabricated continuity.** A provider gap does not justify filling a missing game, injury, prop, coordinate or stat with an estimate unless the field is explicitly a separately labeled PBE model output.
3. **Market truth and model truth stay separate.** Best price, consensus/no-vig, PBE fair value and PBE model gap are different concepts.
4. **Current vs historical semantics are explicit.** Never render a prior-season final table as current.
5. **Source age is product state.** Volatile surfaces expose capture/update age and degrade honestly.
6. **Identity must be deterministic.** Player/team joins should use stable source identifiers wherever possible. A neutral fallback is better than the wrong person.
7. **News rights are source-specific.** Store and republish only what the source terms permit; headline/link metadata and PBE-derived summaries are not interchangeable with copying article bodies.
8. **Production runtime follows the platform doctrine.** Ingestion/normalization/news workers run on Cloudflare; durable state goes to Supabase; Vercel presents the frontend; Actions only test.

Claude: fill this matrix from real canaries before treating a major WNBA surface as production-ready.