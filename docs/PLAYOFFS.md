# WNBA Playoffs V1 — bracket + postseason center

`/playoffs` (frontend) · `GET /v1/playoffs[?season=YYYY]` (wnba-api) · `playoffs` task (wnba-ingest).
Contract `pbe-playoffs/1.0.0`, built in `workers/shared/playoffs.js` (sport-agnostic) with the WNBA/ESPN adapter
`workers/shared/playoffs-wnba.js`. There is no new Worker.

## Source findings (probed 2026-09-25)

ESPN publishes **no bracket resource** (`C/tournaments` 400, `/types/3/series` 404 — see
`docs/evidence/history/espn-history-probe-2026-09-15.md` row 5b). The bracket is derived from postseason game records.

| Need | Source | Fields trusted | Caveats seen |
|---|---|---|---|
| Postseason window | `W/v2/.../standings?level=1` → `seasons[].types[]` (id 3) | `startDate`, `endDate` | 2026 window opened 2026-09-25T07:00Z |
| Game days | `S/scoreboard?dates=<window start>` → `leagues[0].calendar` | whitelisted day starts (07:00Z = ET day) | 2026: 17 days 09-27…10-31; 2025: 14 days |
| Postseason games | `S/scoreboard?dates=YYYYMMDD` (one per game day) | `id`, `date`, `season.{year,type}`, `status.type.{name,state,completed}`, `competitions[0].notes[].headline`, `.series.{type,completed,totalCompetitions,summary,competitors[].{id,wins}}`, `.competitors[].{homeAway,score,team.{id,abbreviation,displayName}}`, `.timeValid`, `.venue` | see traps below |
| Seeds + clinch | `W/v2/.../standings?level=1[&season=Y]` | `playoffSeed` (league seed), `clincher.displayValue` + `.description` | the default (conference) standings' `playoffSeed` is a **conference rank** — never use it as a playoff seed |
| Completeness | `C/seasons/{y}/types/3/events?limit=200` | event id list | used only as a cross-check |

Traps, each handled in code and covered by tests:

- **Date ranges answer 400** on both ESPN site hosts from Cloudflare egress *and* a residential IP
  (`dates=YYYYMMDD-YYYYMMDD`); single dates and whole years work. The shared fetcher's team-schedule recovery
  cannot see TBD placeholder games, so ingest scans single game days.
- **Placeholders**: before matchups are set every postseason event lists team ids `-1`/`-2`, abbreviation `TBD`,
  score `0`. They are schedule slots, never teams; their 0-0 is not a score.
- **`series.totalCompetitions` is 3 on every 2026 placeholder**, including semifinals and Finals. Best-of comes from
  the published schedule ("Semifinals - Game 5 If Necessary" ⇒ best of 5) or a real series' own count.
- **Round labels vary**: "Semifinals" (2026) vs "WNBA Semifinals" (2025); "WNBA Finals" and "WNBA FINALS" in the
  same 2025 series. `competitions[0].type.abbreviation` changed too (SEMI in 2025, STD in 2026), so it is not used.
- **Event ids do not sort by date** (2025 Finals ids are below the semifinal ids). Everything orders by `date`.
- Whole-year scoreboard (`dates=2026&limit=1000`) is 6.9 MB — not used on a schedule.

Verified end to end: `node scripts/canary-playoffs.mjs` (2026: 11/11 PASS, 29 placeholder events, core 29 = scan 29)
and `--season=2025` (11/11 PASS; rebuild matches every ESPN series summary; champion LV 4-0 over PHX). Evidence:
`docs/evidence/playoffs/`.

## Contract (`pbe-playoffs/1.0.0`)

Envelope `{ ok, data, meta }` like every wnba-api route. `data`:

```
season, phase (PRESEASON|REGULAR_SEASON|POSTSEASON|OFFSEASON|null), status (NOT_STARTED|IN_PROGRESS|COMPLETE),
updated_at (last successful verification), truth_changed_at, freshness,
seeds[]:  { seed, team_id, team_name, abbreviation, logo, wins, losses, clinch_status, clinch_code, clinch_label, in_bracket }
rounds[]: { round_id, name, order, is_final, status, best_of, series_expected, unassigned_games[],
            series[]: { series_id, status (TBD|UPCOMING|LIVE|IN_PROGRESS|FINAL), best_of, wins_needed,
                        higher_seed, lower_seed, higher_wins, lower_wins, winner_team_id,
                        next_game_id, live_game_id, last_result, summary, source_summary, seeding_basis,
                        games[]: { game_id, start_utc, time_tbd, status, game_number, if_necessary,
                                   home_team, away_team, home_score, away_score, winner_team_id, venue } } }
champion: null | { team…, seed, series_score, opponent, clinched_game_id, clinched_at }
source, source_updated_at, frozen, provenance { captured_at, provider, season, source_event_count,
  postseason_game_count, played_game_count, series_count, calendar_days_scanned, core_event_count,
  missing_event_ids, duplicates_collapsed, warnings, … }
is_current_season, current_season, available_seasons
```

`meta.semantics`: `POSTSEASON_NOT_STARTED` · `CURRENT_POSTSEASON` · `POSTSEASON_SNAPSHOT` (stale) ·
`POSTSEASON_COMPLETE` · `PRIOR_SEASON_FINAL` · `PRIOR_SEASON_SNAPSHOT`. `meta.freshness` is `CACHED` inside the
window and `STALE` outside it (360 s while a game is live, 30 min in progress, 3 h not started, never for a complete
bracket); `UNAVAILABLE` / `NOT_CONFIGURED` when there is nothing to serve. A prior season is never labelled current.

Truth rules: a series exists only when a game names both teams (a game naming one team stays in
`unassigned_games`); wins are counted from final scores and cross-checked against `series.competitors[].wins`;
later-round slots stay TBD — nothing is projected from the format (no 1-v-8 pairing is ever drawn by us);
the bracket drawing carries no connector claiming which series feeds which.

Validation refuses the whole build (last good snapshot kept, failure written to `playoffs:v1:status`, shown as
`meta.degraded: last_capture_rejected:*`): conflicting duplicate game ids, same team on both sides, malformed team
identity, unsupported round label, final without a valid score, season mismatch, a team in two series of one
round, a game in two series, more series than the schedule has Game 1s, negative source wins, wins beyond best-of,
two series winners, a game played after a clinch, a source-completed series with no winner.

## Persistence + refresh

KV (`WNBA_KV`), no expiry: `playoffs:v1:<season>` (rewritten only when the truth signature changes),
`playoffs:v1:checked:<season>` (every verification), `playoffs:v1:current`, `playoffs:v1:seasons`,
`playoffs:v1:status`, `playoffs:v1:day:<YYYYMMDD>` (settled days older than yesterday — never refetched unless
`force=1`), `playoffs:v1:hot_until`. A COMPLETE bracket is frozen: it is not refetched and can never be replaced
by a less complete provider view.

Cron: every 10 minutes (`:03`), every 2 minutes while a playoff game is live, tips within 45 minutes or tipped
within the last 5 hours. About 20 provider requests per run, falling as days settle. Manual:
`POST /run/playoffs[?season=YYYY][&force=1]` with the admin bearer.

Supabase: not used for V1. The WNBA core schema is still staged-not-applied (`/health` system_of_record
`NOT_CONFIGURED`), and a new migration needs owner approval. The frozen KV snapshot is the durable record until then.

## Frontend

`src/pages/playoffs.js` (one poller: 30 s live, 2 min otherwise, none when complete) · `src/views/playoffs.js`
(shared with wnba-web SSR) · `src/ui/bracket.js` (generic renderer) · `src/styles/playoffs.css`.
Desktop ≥1024 px: rounds as columns. Below: vertical round progression with jump pills and no horizontal scroller
(PropBetEdge no-scrollbar rule). Modules: playoff picture, series center, schedule & results, PBE Picks
postseason coverage (real `/v1/pbe/coverage` rows for bracket game ids), playoff news (newsroom stories whose
headline/deck is about the postseason), postseason leaders **not published** (no verified postseason-only stat feed).

## NBA reuse

`buildPlayoffs()` and `src/ui/bracket.js` know nothing about the WNBA. An `nba-api /v1/playoffs` needs only an
adapter that emits the same normalized games (`game_id, season_year, start_utc, status, round_label, game_number,
home/away {team_id, abbreviation, name}, scores, source_series`), a round table, and a league seed table.
NBA-specific rounds (play-in, conference semis/finals) belong in that adapter's round table; the core rejects
any label its round table does not name.
