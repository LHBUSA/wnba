# WNBA Player DNA V1 — specification (`wnba_player_dna.v1`)

Contract `wnba_player_dna.v1` · calculation version **`wnba-player-dna/1.0.0`** · WinBA dimension `winba/1.0.0`
(frozen; the canonical board is attached unchanged). Model: `workers/shared/player-dna.js`; views:
`workers/shared/player-dna-views.js`; derive: `workers/wnba-ingest/src/dna-task.js`; API: `workers/wnba-api/src/dna.js`.
Tests: `tests/player-dna.test.mjs`, `tests/player-dna-derive.test.mjs`.

Commissioned by the owner as an exception to maintenance mode (`docs/STATUS.md`) for this feature only.
Pattern source: NBA Player DNA V1 (`nba-propbetedge/docs/nba-dna/PLAYER_DNA_V1_SPEC.md`, `player-dna/1.0.0`). The
method and output shape are adapted; no NBA code is imported and no NBA number (gate, weight, threshold) is reused
as a WNBA input without being re-sized for a 44-game, 40-minute league.

Status: **Phase 4 BUILT, NOT DEPLOYED** (2026-09-26). The derive task, KV documents and read endpoints exist in
source and are tested; no Worker has been deployed, no `POST /run` has been made, and no DNA key exists in KV yet.
Owner decisions for this build: §13. Deploy procedure: §14. No UI yet.

---

## 1. Source audit (measured 2026-09-26, read-only)

Measured by reading `archive:v1:index` and all 350 `game:v1:final:<id>` documents from the `WNBA_KV`
namespace (`wrangler kv bulk get --remote`, read-only), plus `ref:v1:athletes` and `winba:v1:latest`.

### 1.1 The archive

| Fact | Measured value |
|---|---|
| Archive index entries (`archive:v1:index`) | 350 (all resolve to a document; 0 missing) |
| Seasons covered | **2026 only** (first tip 2026-04-25, last 2026-09-25T02:00Z) |
| ESPN season type 2 (regular) | 332 documents = 330 standings games + Commissioner's Cup final (401857321) + All-Star Game (401857320) |
| ESPN season type 1 (preseason) | 18 (includes NIGERIA / JAPAN exhibitions) |
| ESPN season type 3 (postseason) | **0** (none archived at measurement time) |
| `status.completed` false | 0 |
| `status.period` | null in all 350 (period count is taken from `linescores.length`: 338 × 4, 11 × 5, 1 × 8) |
| Team player-minutes per game | 197-203 in regulation (integer rounding), 223-227 with one OT, 300-302 with four OT |
| Player box rows | 8,618: 1,526 DNP, 7,060 played with minutes, 15 played with `min: null`, 17 not-DNP with `min: 0` |
| Distinct players with a played line | 317 all types; 238 in type-2 games; 239 in DNA's regular-season set |
| Box-score pts vs team score | 0 mismatches over 700 team-games |
| `oreb + dreb == reb` | 0 mismatches |
| Franchise list (`ref:v1:athletes.teams`, written by the `reference` task) | 15 teams: ATL CHI CON DAL GS IND LV LA MIN NY PHX POR SEA TOR WSH — excludes TEAM COOP / TEAM SPOON / NIGERIA / JAPAN |

### 1.2 Candidate input fields

Null rate is over the 7,060 played lines with minutes.

| Field | Where stored | Coverage | Null rate | Used by DNA |
|---|---|---|---|---|
| `min` | `summary.box.players[]` (normalizeBoxscore) | 2026, all archived games | 0% (15 other played rows have `min: null` → excluded, counted in `sample.excluded_no_minutes`) | yes |
| `pts, reb, oreb, dreb, ast, stl, blk, tov, pf` | same | same | 0% each | yes |
| `fgm/fga, fg3m/fg3a, ftm/fta` | same (split from "M-A") | same | 0% each | yes |
| `starter` | same | same | 0% | yes (role, start rate) |
| `plus_minus` | same | same | 0% | **no** (see §10) |
| `team_id`, `athlete_id` | same | same | 0% | yes (identity, franchise filter) |
| `position` | same | same | 0% | **no** (display snapshot, never a calculation input) |
| `dnp`, `dnp_reason`, `active`, `ejected` | same | same | — | `dnp` only (not an appearance). `dnp_reason` is **never** read |
| Team FG, FT, 3P made-att; `offensiveRebounds`, `defensiveRebounds`, `totalTurnovers` | `summary.box.teams[].stats` (display strings) | 700 / 700 team-games | 0% | yes (usage, AST%, ORB%, DRB%) |
| Team `pointsInPaint`, `fastBreakPoints`, `turnoverPoints` | same | 700 / 700 | 0% | **no** — team-level only; no player attribution (see §10) |
| `game.home/away.team_id, score, linescores` | `summary.game` | 350 / 350 | 0% | yes (result, home/away, OT minutes) |
| `game.season.year/type`, `start_utc`, `status.completed` | `summary.game` | 350 / 350 | 0% | yes (scoping, as-of) |
| Play-by-play `summary.plays[]` | same documents | archived only when non-empty | — | **no** in V1 (clutch deferred, §10) |
| `summary.injuries` | same documents | — | — | **never** (explicitly excluded, tested) |
| Player season stats / game logs / career (`/v1/players/:id`, `/gamelog`) | **not stored**: wnba-api proxies ESPN live with an edge/KV cache | current only | — | **no** — not a durable, as-of-reproducible store |
| Supabase `wnba_player_game_stats` | written by `archiveGame` only when Supabase is configured | not measured (no read access used) | — | **no** — the KV archive is the canonical source WinBA reads |
| `winba:v1:latest` | KV (written by the `winba` task) | current board, `archive_signature` | — | **winba dimension only**: the canonical board row, attached unchanged (§5, dimension 17; decision §13a) |
| Player Load (`pbe-player-load/1.0.0`) | its own Worker/KV | — | — | **never** (tested) |
| `avail:v1:snapshot` / injury feeds | KV | — | — | **never** (tested) |

Rights: every DNA input is already stored by the live archive lane and already read by WinBA, Player Load, PBE
and prop-edge. DNA adds **no** new ESPN, stats.wnba.com or Basketball-Reference ingestion.

---

## 2. What Player DNA is

A **vector of explainable dimensions**. Each dimension is a 0-100 score that is a percentile against a defined
peer population, and carries its raw components, sample, confidence, status, version and `as_of`. There is **no
overall DNA score**. The profile headline (strongest / weakest traits) is derived from the vector and names its
basis. WNBA only (regular season + postseason). Preseason, exhibitions and non-team fixtures are never read.

## 3. Game selection (deterministic)

A game is used only when **all** hold (`selectDnaGames`):

1. completed, and `start_utc < as_of` (exclusive; a game tipping exactly at `as_of` is out);
2. ESPN season type 2 (regular) or 3 (postseason);
3. **both** teams are in `franchiseTeamIds` (required input; the function throws without it — fail closed).
   This removes the 2026 All-Star Game (401857320, TEAM COOP 133384 vs TEAM SPOON 133383, tagged regular season
   upstream) and any exhibition, with no hard-coded game id;
4. the game id is not in `excludeGameIds` (explicit, owner-decided; recorded in provenance; default empty).

Duplicate documents for one game count once (stable choice by `archived_at`, then `checksum`). Input order never
changes output (tested on fixtures and on the real archive). A box row counts only when its `team_id` is the home
or away team of that game.

A line is an **appearance** when `dnp` is false and `min > 0`. `min: null` on a played row → excluded from every
rate and counted in `sample.excluded_no_minutes`. `min: 0` → not an appearance.

## 4. Time: `as_of` and scopes

Every calculation takes an `as_of` instant and reads only games with tip `< as_of`. The pure function has no clock:
the caller passes `as_of`. The "current" snapshot should use `as_of` = last archived tip + 1 s so reruns are
byte-identical. A historical snapshot at D is the same function with `as_of = D`, and equals running on data
truncated to tip < D (L1, tested on fixtures and on the real archive at 2026-06-15 and 2026-08-01).

Season context `S` = the latest season with a selected game before `as_of` (overridable with `season`).

| Scope | Games in scope | Qualification (both) | Confidence reference minutes |
|---|---|---|---|
| `season` | regular season of S | ≥ 10 games, ≥ 200 min | 1,000 |
| `career` | every archived regular season ≤ S | ≥ 40 games, ≥ 800 min | 3,000 |
| `playoffs` | every archived postseason game | ≥ 4 games, ≥ 80 min | 200 |
| `last5` / `last10` / `last15` | the player's last N appearances (regular + postseason), crossing seasons, in tip order | exactly N games, ≥ 8·N min | 25·N |
| `home` / `away` | regular season of S, home or away only | ≥ 6 games, ≥ 120 min | 500 |
| `clutch` | — | never calculated in V1 → `{ calculated: false, reason: "CLUTCH_NOT_BUILT" }` | — |

`career` returns `{ calculated: false, reason: "NO_PRIOR_SEASON_COVERAGE", coverage_from }` whenever the archive
holds no season before S. **Today that is every player** (coverage is 2026 only), so the page must not show a
career block. `playoffs` returns `INSUFFICIENT_SAMPLE` until postseason games are archived (0 today).

Gate sizing: a WNBA regular season is 44 games × 40 minutes. Season minutes gate 200 = 10 games × 20 min.
The last-N minutes gate (8·N) drops deep-bench cameo players, as in NBA.

**Peer population.** Percentiles compare a player only with the **qualified players of the same scope at the same
`as_of`**; `population.n` is returned. Below 20 qualified players the scope is flagged `LOW_POPULATION` and every
confidence is capped at 0.45 (LOW). Measured today: season population n = 166 of 239 players.

## 5. Dimensions (17)

`score` = round(mean of the component percentiles that exist). A component is null when its own gate fails (never
0); the dimension is `INSUFFICIENT_DATA` when all components are null. Per-36 rates (matching WinBA and NBA).
Totals are sums per player per scope; formulas apply to the sums.

Definitions used below: `TSA = FGA + 0.44·FTA`; `TmMin = 200 + 25·max(0, periods − 4)` (periods =
`linescores.length`); team/opponent sums are over the games the player appeared in **and** where both team lines
parsed (`ctx_games`); `c_*` are the player's stats in those same games. Game Score (Hollinger) =
`PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA − FTM) + 0.7·ORB + 0.3·DRB + STL + 0.7·AST + 0.7·BLK − 0.4·PF − TOV`.

| # | Key | Label | Status | Components (each a percentile in the scope population) | Gates | Direction |
|---:|---|---|---|---|---|---|
| 1 | `scoring` | Scoring | LIVE | PTS/36; PTS per game | — | higher = more |
| 2 | `creation` | Creation | **PROXY** — no unassisted/pull-up data | usage% `100·(c_FGA + 0.44·c_FTA + c_TOV)·(TmMin/5) / (c_MIN·(TmFGA + 0.44·TmFTA + TmTOV))`; AST/36 | usage needs team lines | higher = more |
| 3 | `efficiency` | Efficiency | LIVE | TS% `PTS/(2·TSA)`; eFG% `(FGM + 0.5·3PM)/FGA` | TSA/game ≥ 4 | higher = better |
| 4 | `shooting_profile` | Shooting profile | **PROXY** — no shot locations | 3PA/36; 3P%; FT% | 3P%: ≥ 1.0 3PA/game and ≥ 20 3PA. FT%: ≥ 15 FTA | higher = more / better |
| 5 | `ft_pressure` | Free-throw pressure | **PROXY** — **not rim pressure** | FTA/36; FT rate `FTA/FGA`; 2PA/36 | FT rate: ≥ 40 FGA | higher = more |
| 6 | `playmaking` | Playmaking | LIVE | AST% `100·c_AST / ((c_MIN/(TmMin/5))·TmFGM − c_FGM)`; AST/36 | AST% needs team lines | higher = more |
| 7 | `ball_security` | Ball security | LIVE | TOV% `100·TOV/(TSA + TOV)`, **inverted** | usage ≥ 12% | higher = safer |
| 8 | `rebounding` | Rebounding | LIVE | ORB% `100·c_ORB·(TmMin/5)/(c_MIN·(TmORB + OppDRB))`; DRB% `100·c_DRB·(TmMin/5)/(c_MIN·(TmDRB + OppORB))` | team lines | higher = more |
| 9 | `defensive_activity` | Defensive activity | **PROXY** — box events only | STL/36; BLK/36; PF/36 **inverted** | — | higher = more activity |
| 10 | `pressure_clutch` | Pressure / clutch | **UNAVAILABLE** (`CLUTCH_NOT_BUILT`) | — | — | — |
| 11 | `playoff_translation` | Playoff translation | LIVE when sample exists | Δ Game Score/36 (archived postseason − archived regular season, both ≤ S and < as_of); Δ TS% | postseason ≥ 4 games and ≥ 80 min; percentile over qualified players who meet the gate; same value in every scope of an `as_of` | higher = better in playoffs |
| 12 | `role` | Role | LIVE, **descriptive** | MPG; plus `category` STARTER (start rate ≥ 0.6) / ROTATION (MPG ≥ 12.5) / BENCH (MPG ≥ 6.5) / FRINGE, and `start_rate` | — | bigger role, not better |
| 13 | `durability` | Availability | LIVE in `season`, `career` | appearances / archived team regular-season games between the player's first and last appearance for that team (per team-season, summed) | — | higher = more available |
| 14 | `form` | Form | LIVE, **descriptive**, `season` and `career` | Game Score/36 of the last 10 appearances of the scope − whole scope | scope ≥ 20 games | higher = trending up |
| 15 | `matchup_adaptability` | Matchup adaptability | **PROXY** — team-level opponent strength | Game Score/36 vs opponents at ≥ .500 **before that game** (same season, ≥ 10 prior games) − overall | ≥ 6 such games and ≥ 120 min; `season`, `career` | higher = holds up vs good teams |
| 16 | `volatility` | Volatility | LIVE, **descriptive** | population SD of per-game Game Score over appearances ≥ 10 min | ≥ 10 such games | higher = **more volatile** (not better) |
| 17 | `winba` | WinBA | LIVE, **`season` scope only** | the canonical `winba/1.0.0` row (see below) | WinBA's own rule (≥ 10 games **or** ≥ 250 min) | higher = better |

Role thresholds are the NBA ones scaled by 40/48 (15 → 12.5, 8 → 6.5). ROTATION/BENCH are descriptive only.

**Key naming vs NBA.** `ft_pressure` maps to NBA `rim_pressure`; `defensive_activity` maps to NBA
`defensive_impact`. The WNBA keys are deliberately renamed because the NBA labels overclaim what a box score
measures. `dimension_definitions[].nba_key` carries the mapping so one UI can render both leagues.

**Dimension 17 — WinBA = the canonical board, attached unchanged (owner decision §13a).** The `winba` dimension is
the player's row on the **canonical WinBA board** — the same number the WinBA page shows. In production that is
`winba:v1:latest`, written by the existing `winba` task; the model receives it as `winbaBoard` and never recomputes
it. For a historical `as_of`, `canonicalWinbaBoardAsOf(docs, { season, asOf })` produces what the winba lane would
have written (the frozen function over the **raw** archive in tip order; reproduces the stored board exactly).
It returns `value` (canonical score, 1 decimal), `score` (rounded), `rank`, `winba_status` (QUALIFIED /
PROVISIONAL), the four canonical components, WinBA's own sample, `source: "canonical_board"`, and a `note` whenever
the board counts games the other DNA dimensions exclude. Today the note reads: *the canonical WinBA board counts
ESPN regular-season game(s) that the other DNA dimensions exclude as non-team fixtures: 401857320. Open owner
finding; WinBA v1 is unchanged.* So an All-Star's WinBA `sample.games` is one more than their DNA season sample —
by design, and labelled.

Guards (all tested): the board must be for season S **and** its `games_used` must equal the number of canonical
regular-season games (completed, ESPN type 2, with box players) in the input before `as_of`; otherwise it is refused
(`CANONICAL_BOARD_OTHER_SEASON` / `CANONICAL_BOARD_OTHER_ARCHIVE_STATE`) and never attached — so today's board can
never be attached to a past snapshot. No board → `NO_CANONICAL_BOARD`, and the rest of the vector is unaffected.
The same canonical row is also carried at player level (`player.winba`) regardless of DNA qualification, because
WinBA has its own rule (≥ 10 games **or** ≥ 250 min). `winba.js` is byte-pinned by sha256; DNA never writes the
board (deep-frozen in tests) and never passes a DNA metric, Player Load or injury value into WinBA. The dimension
exists in the `season` scope only.

## 6. Confidence

Per dimension: `c = sqrt(min(1, minutes / reference_minutes[scope])) × (PROXY ? 0.75 : 1) × (components present /
components defined)`, capped at 0.45 in a `LOW_POPULATION` scope. WinBA uses the sample term only. Labels: HIGH
≥ 0.80, MEDIUM ≥ 0.55, LOW otherwise. Rounding: scores and percentiles integers; rates 1 decimal; shooting
percentages, rates in [0, 1], availability and start rate 3 decimals; confidence 2 decimals.

## 7. Traits and movement

- **Traits:** `strongest` = top 3, `weakest` = bottom 2, over LIVE and PROXY dimensions with confidence ≥ MEDIUM,
  **excluding `role`, `volatility` and `form`** (descriptive dimensions are never strengths or weaknesses).
  `weakest` never repeats a `strongest` key (NBA `player-dna/1.0.0` can list one dimension as both when only 4-5
  are eligible; fixed here).
- **Movement:** on each player, `last10` score − `season` score for every dimension calculated in both. WinBA is
  season-only, so it never appears in movement. Computed at derive time; the frontend never recomputes a dimension.

## 8. Output

`buildPlayerDna(docs, { asOf, franchiseTeamIds, excludeGameIds?, season?, winbaBoard? })` returns one object for
all players of S. One player (real data, A'ja Wilson, `as_of` 2026-09-25T02:00:01Z, abridged). The served
`/v1/dna/players/:id` body wraps this per-player object in the envelope described in §12.2.

```json
{
  "contract": "wnba_player_dna.v1", "version": "wnba-player-dna/1.0.0",
  "as_of": "2026-09-25T02:00:01.000Z", "season": 2026,
  "coverage": { "seasons": [2026], "coverage_from": 2026, "regular_games": 331, "postseason_games": 0 },
  "provenance": {
    "source": "PropBetEdge archive of final WNBA box scores (source: ESPN), KV game:v1:final:<game_id>",
    "kv_keys": ["archive:v1:index", "game:v1:final:<game_id>"],
    "docs_considered": 350, "games_used": 331,
    "excluded": { "malformed": 0, "after_as_of": 0, "not_completed": 0, "preseason_or_other": 18, "non_franchise": 1, "excluded_by_id": 0, "duplicate": 0 },
    "excluded_games": { "non_franchise": ["401857320"], "excluded_by_id": [] },
    "franchise_team_ids": ["11", "129689", "131935", "132052", "14", "16", "17", "18", "19", "20", "3", "5", "6", "8", "9"],
    "lines_hash": "0edc9e41",
    "not_inputs": ["player_load", "injuries", "availability_feed", "dnp_reason", "winba_stored_board", "odds", "props", "position", "roster_bio"]
  },
  "versions": { "player_dna": "wnba-player-dna/1.0.0", "winba": "winba/1.0.0" },
  "winba": { "source": "canonical_board", "version": "winba/1.0.0", "season": 2026, "generated_at": "2026-09-25T04:26:27.869Z", "games_used": 332, "qualified_count": 196, "archive_signature": "350:401857218", "includes_dna_excluded_games": ["401857320"], "note": "…" },
  "dimension_definitions": ["… 17 entries: key, nba_key, label, status, proxy, proxy_reason, reason, descriptive, components, desc"],
  "players": {
    "3149391": {
      "athlete_id": "3149391", "name": "A'ja Wilson", "team_id": "17", "season": 2026, "as_of": "2026-09-25T02:00:01.000Z",
      "scopes": {
        "season": {
          "calculated": true, "scope": "season",
          "sample": { "games": 41, "minutes": 1313, "starts": 41, "first_date": "2026-05-09", "last_date": "2026-09-25", "excluded_no_minutes": 0 },
          "flags": [], "population": { "n": 166, "qualification": { "games": 10, "minutes": 200 } },
          "dimensions": {
            "scoring": { "score": 100, "status": "LIVE", "proxy": false, "label": "Scoring", "confidence": 1, "confidence_label": "HIGH",
                         "components": [ { "key": "pts_per36", "value": 29.4, "percentile": 100 }, { "key": "pts_per_game", "value": 26.2, "percentile": 100 } ] },
            "ft_pressure": { "score": 96, "status": "PROXY", "proxy": true, "proxy_reason": "Foul-drawing and two-point volume only. This is NOT rim pressure: …", "…": "…" },
            "pressure_clutch": { "score": null, "status": "UNAVAILABLE", "reason": "CLUTCH_NOT_BUILT", "label": "Pressure / clutch" },
            "playoff_translation": { "score": null, "status": "INSUFFICIENT_DATA", "…": "…" },
            "winba": { "score": 86, "value": 86.3, "status": "LIVE", "version": "winba/1.0.0", "winba_status": "QUALIFIED", "rank": 2, "source": "canonical_board", "note": "The canonical WinBA board counts … 401857320 …",
                       "components": [ { "key": "production_percentile", "value": 100 }, { "key": "win_rate", "value": 73.2 },
                                       { "key": "winning_output_share", "value": 74.7 }, { "key": "court_share", "value": 80.1 } ],
                       "confidence": 1, "confidence_label": "HIGH" }
          },
          "traits": { "strongest": ["scoring", "ft_pressure", "defensive_activity"], "weakest": ["matchup_adaptability", "durability"],
                      "basis": "LIVE and PROXY dimensions with confidence >= MEDIUM, excluding role, volatility, form" }
        },
        "career": { "calculated": false, "scope": "career", "reason": "NO_PRIOR_SEASON_COVERAGE", "coverage_from": 2026 },
        "playoffs": { "calculated": false, "scope": "playoffs", "reason": "INSUFFICIENT_SAMPLE", "…": "…" },
        "last5": { "…": "…" }, "last10": { "…": "…" }, "last15": { "…": "…" }, "home": { "…": "…" }, "away": { "…": "…" },
        "clutch": { "calculated": false, "scope": "clutch", "reason": "CLUTCH_NOT_BUILT" }
      },
      "movement": { "vs": "last10", "deltas": { "scoring": -1, "creation": 3, "efficiency": 0, "shooting_profile": -10, "playmaking": 7, "rebounding": -6, "defensive_activity": -10, "role": 0, "volatility": -5 } }
    }
  }
}
```

Values above are real output; `"…"` marks elided fields. Measured on the live archive: 239 players; calculated
scopes — season 166, last5 184, last10 173, last15 160, home 160, away 160, career 0, playoffs 0, clutch 0.
Season-scope dimension status counts: efficiency INSUFFICIENT_DATA 28 (TSA/game < 4), ball_security 10 (usage
< 12%), form 15 (< 20 games), matchup_adaptability 21 (< 6 games vs .500+ opponents), playoff_translation 166
(no postseason archive). Serialized: ~27 KB per player (all scopes), ~4.6 MB for the whole league. Pure compute
over the full archive: ~0.3 s in Node.

## 9. Determinism and versioning

- Pure functions (no clock, no randomness, no I/O; the test greps the source for `Date.now`, `new Date()`,
  `Math.random`, `fetch(`). Same inputs → byte-identical output; input order and franchise-list order do not
  matter. Percentile ties use mid-rank (same rule as `winba/1.0.0`).
- The only import is `./winba.js` (asserted by test), so Player Load, injuries and every other lane are unreachable.
- Any change to a formula, gate, threshold or population rule is a new version (`wnba-player-dna/1.1.0` or
  `2.0.0`); snapshots of old versions stay as written.

## 10. Dimensions rejected / deferred

| Candidate | Decision | Reason |
|---|---|---|
| Pressure / clutch | **Deferred** (UNAVAILABLE) | Play-by-play is archived with the box score, but per-player clutch attribution (score margin + clock windows, on-floor players) is not built or validated. Needs its own spec and tests; no new data required. |
| Rim pressure (as named) | **Rejected** → `ft_pressure` PROXY | No player paint / rim / shot-location data. Team `pointsInPaint` exists but cannot be attributed to a player. |
| Shot zones / shot quality | Rejected | Shot coordinates exist only in play-by-play for some games; not validated as complete; would be new derived data. |
| On/off, lineup impact, plus-minus dimension | Rejected | `plus_minus` is teammate- and opponent-dependent raw box plus-minus; a percentile of it would read as individual impact. WinBA v1 deliberately does not use it either. |
| Defensive impact (as named) | Rejected → `defensive_activity` PROXY | No matchup / tracking data. |
| Career beyond 2026 | Deferred (scope defined, not calculable) | Archive holds 2026 only. Earlier seasons would need a historical backfill = new ingestion; `docs/HISTORY_INTELLIGENCE_PHASE1.md` records the rights hold on ESPN history. Owner decision. |
| Playoffs | Defined; **no data yet** | 0 postseason games archived at measurement. The existing backfill archives postseason finals from the same schedule feed, so this fills in without new ingestion. |
| Age / experience / draft / position curves | Rejected | Today's roster snapshot, not as-of reproducible; not calculation inputs. |
| Injury-adjusted anything | Rejected by brief | Injuries are never an input. `durability` counts box-score appearances only. |
| Player Load | Rejected by brief | Separate workload score; never an input. |
| Opponent-adjusted efficiency | Deferred | Needs opponent defensive ratings = a second derived model; team-level strength already in `matchup_adaptability`. |

## 11. Known limits and open findings

1. **All-Star Game in the canonical WinBA board (OPEN, owner finding).** `winba:v1:latest` (games_used 332)
   includes 401857320 because the canonical aggregator trusts ESPN season type 2. Per §13a the DNA `winba`
   dimension shows the canonical number anyway (one WinBA number site-wide) and carries a `note`; every other DNA
   dimension excludes the game. Measured: excluding only the All-Star Game would change 34 of 238 WinBA scores (max
   1.2 points) and 33 ranks. The clean fix — filter the WinBA *input set* to franchise games in the ingest task,
   formula unchanged — changes published scores and frozen boards, so it stays an owner decision.
2. **Commissioner's Cup final (401857321, LV @ NY 2026-06-30).** Tagged regular season, has no team record, and
   is a real game between franchises on the players' own teams, so the franchise rule keeps it. The official WNBA
   does not count the Cup final in regular-season stats. **Decision §13b: kept.** `DNA_EXCLUDE_GAME_IDS` in
   `dna-task.js` (empty) is the one place to drop it. Excluding it too would move 70 WinBA scores (max 2.6).
3. **WinBA is input-order sensitive at the rounding boundary.** Float summation order in `aggregateWinbaArchives`
   flips 2 of 238 published scores by 0.1 depending on document order. The ingest's index order and tip order both
   reproduce the published board exactly; DNA always passes tip order, so DNA is deterministic. Not fixed (frozen
   code); noted so nobody "fixes" it by reordering.
4. Minutes are integers (±0.5 min per game of rounding in per-36 rates; team minutes 197-203 per regulation game,
   DNA uses the rule 200 + 25/OT).
5. `durability` reflects games missed for any reason (rest, suspension, coach's decision, injury). It never reads
   why. It is not Player Load and not an injury signal.
6. The deployed `wnba-ingest` predates commit 37cc43d (its WinBA board has no `formula.layer_contract`). Scores are
   identical; noted for deploy hygiene.
7. `ids.slice(-500)` in the WinBA / Player Load / dry-run readers will silently drop the oldest games once the
   archive exceeds 500 games (2027 season). The DNA reader reads every id (tested with 600). **Follow-up (not done,
   out of scope):** fix the WinBA, Player Load and history-dryrun readers. Note that once WinBA drops games, its
   board `games_used` stops matching the archive and DNA will (correctly) refuse to attach it and stop publishing
   (§12.1 fail-closed) — the follow-up must land before the archive passes 500 games.
8. **Deploying `wnba-ingest` from main also ships `winba.js` at 37cc43d** (adds `formula.layer_contract`; scores
   unchanged, verified: recomputing from the archive reproduces all 238 published scores exactly in index order).

## 12. Phase 4 — derive, storage and API (built, not deployed)

### 12.1 Derive: `wnba-ingest` task `dna` (`workers/wnba-ingest/src/dna-task.js`)

- **Schedule:** Cloudflare Cron (existing `* * * * *`), queued after `winba` every minute. The task is a cheap
  signature check unless the archive changed. Daily forced run (`dna_daily`) at **06:07 ET** re-reads every archived
  document ignoring the cache and rewrites everything. No new Worker, no GitHub Action.
- **Skip rules, in order:** no archive → `no_archives`; `dna:v1:meta.archive_signature` equals
  `${ids.length}:${ids.at(-1)}` (the winba signature rule) and version unchanged → `unchanged_archive` (0 writes);
  WinBA rebuilt in this same invocation → `deferred_after_winba_rebuild` (one heavy archive pass per invocation);
  no board → `no_winba_board`; board signature ≠ archive signature → `winba_board_stale` (wait for winba).
- **Fail closed (throws, writes nothing):** franchise list missing (`ref:v1:athletes.teams`); any indexed game
  unreadable; canonical board not attachable to this archive state.
- **Inputs:** **all** ids in `archive:v1:index` (no `slice(-500)`), each document slimmed on read to the fields DNA
  uses (play-by-play, injuries and odds are dropped before the model); `winba:v1:latest`; `ref:v1:athletes`.
  `as_of` = last completed archived tip + 1 s.
- **Slim cache** `dna:v1:slim` (~2.2 MB today): box fields of every archived game, so a steady-state run reads only
  newly archived games (1 doc instead of 350). The daily forced run ignores it; cache path and forced path produce
  byte-identical documents (tested).
- **Writes, in order:** `dna:v1:player:<id>` for every player (239 today, ~27-32 KB each), then `dna:v1:index`
  (~110 KB), then `dna:v1:meta` (~9 KB; the commit marker), then `dna:v1:slim`. Nothing else. Never `winba:*`,
  `archive:*`, `game:*`, `ref:*` or Supabase (tested: every write key starts with `dna:v1:`).
- **Measured offline on the real archive** (in-memory KV loaded with the pulled data): 0.9 s in Node, 242 writes,
  350 document reads on a cold run; board attached (games_used 332 = canonical count 332).
- Append-only as-of snapshots: **not built** (not cheap in KV; the monthly-edition pattern can add
  `dna:v1:asof:<YYYY-MM>:player:<id>` later with `canonicalWinbaBoardAsOf`).

### 12.2 API: `wnba-api` (public), prepared data only (`workers/wnba-api/src/dna.js`)

All three return the standard WNBA envelope `{ ok, data, meta }`; `data` is the stored document, shaped like NBA
nba-intel `/v1/dna/*`: `schema, version, source, as_of, captured_at, partial, unavailable[], versions{player_dna,
winba}, …`. Nothing is computed per request; the only decoration is the photo from the existing `photoFor`.
`Cache-Control: public, max-age=300`; `meta.cache = "kv"`, `meta.stale_after_s = 129600`.

| Route | `data` | Errors |
|---|---|---|
| `GET /v1/dna/meta` | `schema: wnba-dna/meta`, `scopes`, `qualification` (per scope: games, minutes, **reference_minutes**), `dimension_order`, `dimensions` (definitions incl. `nba_key`), `descriptive_dimensions`, `method` (percentile rule, per 36, last-N, movement, low-population cap, proxy factor, confidence labels, gates), `decisions`, `winba` (board summary + note), `coverage`, `counts`, `archive_signature`, `lines_hash`, `run` | 503 `not_derived` |
| `GET /v1/dna/index` | `schema: wnba-dna/index`, `players[]` (id, name, position, team_id, games, minutes, season_calculated, role, winba, winba_value, winba_canonical, traits, calculated scopes, headshot) sorted by canonical WinBA → minutes → name, `teams{}`, `counts` | 503 `not_derived` |
| `GET /v1/dna/players/:id` | `schema: wnba-dna/player`, `player{id, espn_athlete_id, name, position, headshot}`, `team_id`, `team{abbr, name, short_name, color, alt_color}`, `season`, `coverage_from`, `coverage`, `versions`, `dimension_order`, `scopes` (all 9), `movement`, `winba` (canonical row, player level), `content_hash`, `archive_signature`, `provenance` | 400 `bad_request` (non-numeric id), 404 `no_snapshot` with `data.state: "UNAVAILABLE"` |

`wnba-api` VERSION 1.3.0; `wnba-ingest` VERSION 1.2.0.

### 12.3 UI rules (for the UI build)

Never render `career` (always `NO_PRIOR_SEASON_COVERAGE`); say "2026 season archive". Show PROXY dimensions with
`proxy_reason`; show `ft_pressure` as "Free-throw pressure", never "rim pressure". Show the winba `note` wherever the
DNA WinBA number appears. Render descriptive dimensions (role, form, volatility) without good/bad colouring.

## 13. Owner decisions for this build (defaults; owner may override)

| # | Decision | Default taken | Where it lives |
|---|---|---|---|
| a | WinBA inside DNA | The **canonical published board** value, unchanged, with a note that the board counts the 2026 All-Star Game. All other dimensions keep the franchise-only filter. | model `winbaBoard`; `DNA_DECISIONS.winba_source` |
| b | Commissioner's Cup final 401857321 | **Kept** (real franchise game); documented | `DNA_EXCLUDE_GAME_IDS = []` |
| c | Access | **Public**, not Pro-gated (same as NBA `/v1/dna/*`) | base `wnba-api` router (not the credentialed premium layer) |
| d | History seasons | **None** — 2026 archive only; career DNA is never rendered | `career` returns `NO_PRIOR_SEASON_COVERAGE` |

## 14. Deploy (procedure only — NOT run)

Order: **ingest first** (so KV has DNA documents), **then the API**, then the frontend (already auto-deploys from
main; it does not use DNA yet). Run from `D:\Workers\wnba` on a clean `main` equal to `origin/main`.
Admin token: `.admin-token` (repo root, gitignored) or `C:\projects\wnba\.admin-token`; never print it.

**0. Pre-flight**
```powershell
git -c safe.directory=* fetch origin main; git -c safe.directory=* status -sb    # must be "## main...origin/main", clean
npm run guard; npm test                                                          # all green
node --test tests/player-dna.test.mjs tests/player-dna-derive.test.mjs
```

**1. Capture rollback versions (before any deploy)**
```powershell
cd workers/wnba-ingest; npx wrangler deployments list --name wnba-ingest | Select-Object -First 20   # record current version id = ROLLBACK_INGEST
cd ../wnba-api;        npx wrangler deployments list --name wnba-api    | Select-Object -First 20   # record ROLLBACK_API
cd ../..
Invoke-RestMethod https://wnba-ingest.sales-fd3.workers.dev/health   # expect version 1.1.0 (pre-deploy)
```

**2. Deploy wnba-ingest (existing fail-closed script)**
```powershell
pwsh -NoProfile -File scripts/deploy-wnba-ingest.ps1
```
It refuses unless on clean pushed main, runs the PBE/playoffs tests, deploys, polls `/health` until version
**1.2.0**, and runs the PBE and playoffs canaries. It does not run DNA. (Add `tests/player-dna*.test.mjs` to its
test list in the same change if the owner wants it in the gate.)

**3. First DNA run (admin, forced)**
```powershell
$t = (Get-Content .admin-token -Raw).Trim()
$h = @{ Authorization = "Bearer $t"; 'Cache-Control' = 'no-cache' }
$r = Invoke-RestMethod -Method Post -Uri "https://wnba-ingest.sales-fd3.workers.dev/run/dna?force=1" -Headers $h
$r.result.dna    # expect ok=true, season=2026, players≈239, calculated.season≈166, games_used=331,
                 # winba_games_used=332, excluded.non_franchise=1, fetched_docs=350, player_docs_written=players
```
If it returns `skipped: winba_board_stale`, run `POST /run/winba` once (it no-ops if unchanged) and retry.
Any thrown error (`franchise list missing`, `unreadable`, `CANONICAL_BOARD_OTHER_ARCHIVE_STATE`) means nothing was
published — investigate, do not force around it.

**4. Verify KV read-only**
```powershell
cd workers/wnba-ingest
npx wrangler kv key get "dna:v1:meta" --binding WNBA_KV --remote | ConvertFrom-Json | Select-Object version, as_of, archive_signature, counts
cd ../..
```

**5. Deploy wnba-api**
```powershell
cd workers/wnba-api; npx wrangler deploy; cd ../..
```

**6. Canaries (read-only)**
```powershell
$api = 'https://wnba-api.propbetedge.ai'
$h = Invoke-RestMethod "$api/health";                           # version 1.3.0; routes include /v1/dna/meta, /v1/dna/index, /v1/dna/players/:id
$m = (Invoke-RestMethod "$api/v1/dna/meta").data                # schema wnba-dna/meta; versions.player_dna wnba-player-dna/1.0.0; versions.winba winba/1.0.0
                                                                # qualification.season = {games:10, minutes:200, reference_minutes:1000}; dimension_order.Count = 17
                                                                # decisions.winba_source = canonical_board; winba.includes_dna_excluded_games contains 401857320
$i = (Invoke-RestMethod "$api/v1/dna/index").data               # players.Count = meta.counts.players; no player has 'career' in scopes
$p = (Invoke-RestMethod "$api/v1/dna/players/4433791").data     # Olivia Miles: scopes.season.calculated; scopes.career.reason NO_PRIOR_SEASON_COVERAGE;
                                                                # scopes.clutch.reason CLUTCH_NOT_BUILT; dimensions.pressure_clutch.status UNAVAILABLE
$w = (Invoke-RestMethod "$api/v1/stats/winba").data.rows | Where-Object athlete_id -eq '4433791'
if ($p.scopes.season.dimensions.winba.value -ne $w.score) { throw 'DNA WinBA != WinBA page' }   # one WinBA number site-wide
try { Invoke-RestMethod "$api/v1/dna/players/1" } catch { $_.Exception.Response.StatusCode }   # 404
```
Also check every calculated scope meets its gates (`sample.games ≥ qualification.games`, `sample.minutes ≥
qualification.minutes`) for the three sample players, and that `provenance.excluded_games.non_franchise` contains
401857320.

**7. Watch** `GET https://wnba-ingest.sales-fd3.workers.dev/status` → `status.dna` over the next archive change:
expect one run with `fetched_docs = 1`, then `skipped: unchanged_archive` every minute.

**Rollback**
- API: `cd workers/wnba-api; npx wrangler rollback <ROLLBACK_API>` — the DNA routes disappear; nothing else changes.
- Ingest: `cd workers/wnba-ingest; npx wrangler rollback <ROLLBACK_INGEST>` — the `dna` task stops. Note this also
  rolls `winba.js` back to the pre-37cc43d build (scores identical).
- DNA KV keys are inert without the API; delete only on owner instruction:
  `npx wrangler kv key delete "dna:v1:meta" --binding WNBA_KV --remote` (and `dna:v1:index`, `dna:v1:slim`,
  `dna:v1:player:*`). No other key is touched by DNA.
