# International women's basketball — source audit (FIBA Women's Basketball World Cup 2026)

Audited 2026-09-13, the final day of the tournament (Berlin, Sept 4–13).

## Decision

| Role | Source | Why |
|---|---|---|
| **Primary** | ESPN public JSON, league `fiba` (id 53) on `site.web.api.espn.com` | Keyless. Covers all 36 games: live status/period/clock, box scores, play-by-play for completed games, standings, notes giving round/group. Global ESPN athlete ids give a deterministic WNBA crosswalk. Same provider class as every existing WNBA Worker; `site.web.api` is the host Cloudflare egress can reach (`site.api` returns 403). |
| Player bio | `sports.core.api.espn.com/v2/sports/basketball/leagues/fiba/athletes/{id}` | Date of birth, height, citizenship. |
| Flags | Wikimedia Commons national flags (public domain), self-hosted under `public/media/flags/`, manifest `data/flags.json` | Rights-safe. No hotlinking of ESPN or FIBA images. |
| **Not used** | FIBA digital API (`digital-api.fiba.basketball/hapi/*`) | Returns 401 without an `Ocp-Apim-Subscription-Key`. The key ships in FIBA's website bundle, but FIBA publishes no API terms, and its Terms & Conditions §4 forbid reproducing content without permission. Using it would be an authenticated dependency without authorization. |
| **Not used** | `www.fiba.basketball/en/events/api/game-live-info/*` | Returns 403 to non-browser user agents, so using it would mean disguising the Worker as a browser. |
| **Not used** | Genius Sports FIBA LiveStats (`fibalivestats.dcd.shared.geniussports.com`) | FIBA game ids return 403, and these games use statistic system "OVR". |

FIBA's data is technically richer: 12-man rosters, positions, published shot x/y and a live push channel. It can replace or augment ESPN only if FIBA authorizes access.

## Normalized contract (wnba-international)

**Entities:**
- competition
- national team (`nt-<slug>`, ESPN team id)
- player (`p-<espn athlete id>`)
- game (`g-<espn event id>`)
- box score
- play
- standing
- bracket
- leader

**Game fields:** `status` (scheduled/live/final/postponed), `period`, `period_label`, `clock` (live only), scores, `winner` (final only), `phase`/`round`/`group`, `venue`, `fetched_at`.

**Every response meta:** `source`, `fetched_at`, `age_s`, `freshness` (CURRENT/CACHED/STALE/ERROR), `stale`, `stale_after_s`.

## Freshness

| Data | Strategy |
|---|---|
| Scoreboard, live game | Read-through Cache API, 10 s while a game is live or within 45 min of tip; 120 s otherwise |
| Completed box score | Normalized once and stored in KV permanently |
| Aggregates (standings, bracket, rosters, stats, leaders, WNBA crosswalk) | Rebuilt by Cron every 2 minutes; an empty or failed provider read is never persisted |
| Provider failure | KV last-good served as `STALE` |

## Computed by PropBetEdge (method published with the data)

- **Group standings:** FIBA classification points (2 for a win, 1 for a loss). Ties are broken by games between the tied teams (points, then difference, then points scored), then by overall difference and points scored. This matches FIBA's final group order for all four groups.
- **Leaders:** per-game averages, minimum 3 games.
- **Efficiency:** FIBA formula, computed from provider box scores.

## Known gaps (provider)

- Rosters are the players who appeared in box scores; ESPN omits DNP players.
- Positions are "Not Available".
- ESPN publishes play-by-play for completed games but not always during live play. Live games show score, clock and box score.
- The venue name is the provider's ("Uber Arena"; FIBA calls it "Berlin Arena").
