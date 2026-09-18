# WNBA Source Matrix

Status: **MILESTONE 0 CANARIED — 2026-09-11** (re-run any time: `npm run canary` → `docs/evidence/canary-latest.json`)

Every row below was proven with a real WNBA request. "CF egress" means the request was made **from the deployed `wnba-api` Cloudflare Worker**, the same path production uses (`GET /v1/sources`). Nothing here is inferred from NBA behaviour.

Season context at canary time: ESPN season `2026 Regular Season` (type 2, 2026-05-08 → 2026-09-25; postseason 2026-09-25 → 2026-11-01). 15 teams (incl. expansion Portland Fire `132052`, Toronto Tempo `131935`). **No games 2026-08-31 → 2026-09-16** (the undated scoreboard returns 2026-09-17 as its `day`). 380 events in the season window: 320 final, 59 scheduled (29 postseason placeholders), 1 postponed.

## Matrix

| Capability | Status | Source (host) | Native identifier | Freshness | Authority / usage | Durable storage | Attribution | Failure / degradation rule | Evidence (2026-09-11) |
|---|---|---|---|---|---|---|---|---|---|
| Schedule / game IDs | **PASS** | ESPN `site.web.api` `/scoreboard?dates=` | ESPN event id (e.g. `401857189`) | edge 8s today / 60s other days | provider data, displayed with source | `wnba_games` (staged) · season sync every 30 min | "Source ESPN" | Undated scoreboard = *next* game day → labelled `NEXT_SLATE_NOT_TODAY`, never "today" | 380 events Apr 25–Nov 1; `/v1/today` → `NEXT 20260917 · 5 games` |
| Scoreboard / live state | **PASS** (live not yet observed) | ESPN scoreboard + `/summary` | event id; `status.type.state` pre/in/post | live 6–8s | provider | snapshots per minute during live games | ESPN | Unknown state stays unknown; possession shown only if ESPN sets `competitor.possession` | pre + post states verified; first live window 2026-09-17 |
| Play-by-play | **PASS** | ESPN `/summary?event=` (`plays[]`) | play `id` + `sequenceNumber` | live 6s; final immutable | provider | KV archive now; `wnba_game_events` (staged) | ESPN | No synthetic events; live stream never steps backwards | 405 events for 401857189, wallclock on every play |
| Shot coordinates | **PASS** | ESPN `plays[].coordinate` (shooting plays) | play id | with PBP | provider | event columns `coord_x/y` | ESPN | Sentinel `(-214748340,-214748365)` = no location → not plotted; missing never placed | 136/136 FGA located; FTs carry sentinel. Fit: rim ≈ (25, 0.25) ft, stated shot distances reproduced ±0.5 ft; whole-foot resolution |
| Box score | **PASS** | ESPN `/summary` `boxscore` | athlete id | with PBP | provider | `wnba_player_game_stats`, `wnba_team_game_stats` | ESPN | Missing fields null | 23 rows; derived lead changes (2), largest leads (32/1), team fouls (20/22+1 off.) and FGA (136) reconcile with ESPN totals — enforced in `tests/runtime.test.mjs` |
| Team identities | **PASS** | ESPN `/teams` | ESPN team id | 24h | provider | `wnba_teams` | ESPN | Deterministic ids only; team logos NOT used (unlicensed marks) | 15 teams |
| Player identities | **PASS** | ESPN `/teams/{id}/roster`, `common/v3/athletes/{id}` | ESPN athlete id | 1h | provider | `wnba_players` | ESPN | No fuzzy joins; props join by exact name on the two game rosters or stay `UNMATCHED` | 209 rostered; roster carries `dateOfBirth` (overview endpoint may not) |
| Rosters | **PASS** | ESPN `/teams/{id}/roster` | (season, team, athlete) | 1h | provider | `wnba_rosters` first/last seen | ESPN | Missing team roster reported in `degraded` | 15/15 rosters, 209 players |
| Standings | **PASS** | ESPN `apis/v2/.../standings` | team id | 10 min | provider | `wnba_standings_snapshots` (new row only when a record changes) | ESPN | `is_current` + label; prior season rendered "final (prior)" | 2 conferences; clinch marks (`x`) present |
| Team season stats | **PASS** | ESPN `common/v3/statistics/byteam` | team id | 30 min | provider | derived on read | ESPN | Opponent split (`splitId 900`) prefixed `opp_`, never merged into own | 15 teams incl. opponent points |
| Player season stats | **DEGRADED (coverage)** | ESPN `common/v3/statistics/byathlete` | athlete id | 30 min | provider | derived on read | ESPN | Qualified players only — **127 of 209**; `qualified=false` does not widen it. Observed rotations (box scores) fill role/usage | 127 rows |
| WinBA Score | **PASS (PBE-derived)** | Immutable ESPN final-game box scores in PropBetEdge replay archive | ESPN athlete id | checked every 10 min; rebuild only when archive index changes | PropBetEdge derived metric | KV `winba:v1:latest`; source rows remain the final archive / `wnba_player_game_stats` | “PropBetEdge WinBA Score · derived from archived ESPN WNBA box scores” | Regular-season finals only; DNP/0-minute rows excluded; 10 GP or 250 MIN qualifies; provisional rows do not move the production benchmark; no odds/projections; not a causal wins-added claim | Formula frozen in `workers/shared/winba.js` + `tests/winba.test.mjs` |
| Injury / availability | **PASS** | ESPN `/injuries` | ESPN injury id + athlete id | 5 min read; ledger every 10 min | **provider feed, not the league's official report**; notes cite reporters | `wnba_availability_current` + `_events` (before → after) · KV ledger live now | "ESPN injury feed" + quoted note | `details.returnDate` shown only as "source-reported", never estimated | 41 listed (40 Out, 1 DTD); baseline captured, change ledger armed |
| Team schedule history | **PASS** | ESPN `/teams/{id}/schedule?season=` | event id | 15 min | provider | games | ESPN | score shape here is `{value, displayValue}` (normalized) | last-10 form, rest days |
| Player game logs | **PASS** | ESPN `common/v3/athletes/{id}/gamelog` | event id | 1h | provider | player game stats | ESPN | No inferred missing games | Bueckers: 39 regular-season games |
| Transactions | **PASS** | ESPN `/transactions` | (team, date, text) | 15 min | provider | desk evidence | ESPN | — | 100 items; hardship / seven-day contracts present |
| Game odds | **PASS** | The Odds API `basketball_wnba` `h2h,spreads,totals` (us) | Odds API event id → ESPN id by exact team names + tip ±6h | **3×/day 08/13/18 ET** (Cron) | market prices; consensus = PBE arithmetic, labelled benchmark | KV snapshot + per-event history; `wnba_odds_snapshots` (staged) | "The Odds API" + book names | User traffic never spends credits; stale >12h labelled | 8 events × up to 9 books; **3 credits** per featured run |
| Player props | **DEGRADED (timing)** | The Odds API event odds `player_points/rebounds/assists/threes` | event id + player name | same 3×/day, games inside 36h only | market | same | same | No market = no line; unmatched names shown as published | Canary 2026-09-11: 1 book (FanDuel), 5 players for 9/17 — outside the 36h ingest window, so none stored yet |
| Historical / replay | **PASS** | ESPN `/summary` for finals → Cloudflare KV immutable archive (sha-256 of event array) | event id | once, immutable | provider events, PBE archive | KV `game:v1:final:*` now; `wnba_replay_archives` + events (staged) | ESPN | Replay only from archived real events; semantics `FINAL_PERSISTED_ARCHIVE` vs `FINAL_PROVIDER_ARCHIVE` | Backfill 12 games / 10 min → full 320-game season archive |
| WNBA news — official | **PASS** | WNBA.com `/news` (`__NEXT_DATA__.props.pageProps.newsData.items`) | canonical URL hash | 10 min | headline + link + excerpt only | KV + `wnba_news_items` (staged) | "WNBA.com (official)" | Shape change → source FAIL, others continue | 10 items; `/news/feed`, `/rss`, sitemaps 403/404 |
| WNBA news — external | **PASS** | ESPN WNBA news API, CBS Sports RSS, The IX RSS, Swish Appeal RSS, Her Hoop Stats RSS | canonical URL hash | 10 min | headline + link + publisher summary; never bodies | same | publisher name on every item | **Mixed feeds are filtered**: the CBS "WNBA" RSS carried an NFL story; The IX feed is multi-sport; FIBA items need a WNBA consequence | 6 sources PASS; rejects logged with reasons (`/v1/news/runs`) |
| Independent PBE WNBA news | **PASS** | `wnba-news` Worker (own KV + cron) | deterministic `pbe_` story id | 10 min | owned, generated only from cited records | KV + `wnba_pbe_stories` (staged, evidence NOT NULL) | "PropBetEdge WNBA Desk" | Quiet day = no stories | 7 stories (5 results, 2 transactions) with evidence packets |
| Player photography | **PASS (156/209)** | Wikimedia Commons via Wikidata P18 | ESPN athlete id → Wikidata (exact name + exact DOB) | re-verify per manifest | CC0 / PD / CC BY / CC BY-SA only; crops = adaptations | `data/player-photos.json` + `public/media/players/*` ; `wnba_player_images` (staged) | per-photo credit on player page | Uncertain identity/rights → neutral card | see `docs/PLAYER_PHOTOS.md` |

## Candidate sources that FAILED (do not use without new evidence)

| Source | Result (2026-09-11) |
|---|---|
| `site.api.espn.com` (any WNBA path) | 403 from Cloudflare egress and intermittently from residential IPs; `site.web.api.espn.com` serves identical payloads |
| `cdn.wnba.com/static/json/...` (schedule, scoreboard, odds, playbyplay) | HTML error page (not JSON) |
| `stats.wnba.com/stats/*` | connection timeout (bot-blocked) |
| `www.wnba.com/news/feed`, `/rss`, `/sitemap*.xml`, `/robots.txt` | 404 / 403 |
| `www.espn.com/espn/rss/wnba/news` | no response |
| `apnews.com/hub/wnba` | 403 |

## Known gaps

1. **Live state not yet observed** — no WNBA game between canary and 2026-09-17. First live window must re-run `npm run qa` against a live game.
2. **Official league injury report** not ingested; availability is ESPN's feed and labelled as such.
3. **Bonus/penalty state** not derived (WNBA last-two-minute rule not verified); team fouls per quarter are.
4. **Season leaders** limited to 127 qualified players.
5. **Props** only captured inside 36h of tip (credit bound) — 9/17 props will appear from the 9/16 18:00 ET run.
6. **Supabase not bound** — schema staged; KV holds snapshots/ledgers/archive until the owner approves the target project.

## Data-truth rules

1. **WNBA-native proof only.** NBA behavior is a design reference, not data evidence.
2. **No fabricated continuity.** Missing game, injury, prop, coordinate or stat stays missing.
3. **Market truth and model truth stay separate.** Best price, consensus/no-vig, PBE fair value and PBE model gap are different concepts.
4. **Current vs historical semantics are explicit.**
5. **Source age is product state.**
6. **Identity must be deterministic.** A neutral fallback is better than the wrong person.
7. **News rights are source-specific.**
8. **Production runtime follows the platform doctrine.** Cloudflare runs it; Supabase remembers it; Vercel presents it; Actions only test.
