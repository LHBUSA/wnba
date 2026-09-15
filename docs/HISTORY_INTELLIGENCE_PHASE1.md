# Women's Basketball History Intelligence — Phase 1 (architecture + source audit)

Status: **design + audit only**. Nothing was ingested, migrated or deployed for this document. Production auth, paywall, PBE model v1, eligibility contract, shadow runner and official ledger are untouched.

Evidence (committed alongside this doc):

- `docs/evidence/history/wnba-espn-coverage-matrix-2026-09-15.json` — per-season coverage measured from our 5,974-summary local ESPN harvest (script `scripts/history-coverage-matrix.py`)
- `docs/evidence/history/espn-history-probe-2026-09-15.md` — ~380 live GETs against ESPN WNBA historical endpoints
- `docs/evidence/history/intl-identity-source-audit-2026-09-15.md` — international, identity and domestic-league sources with robots/terms quotes

---

## 0. Owner decisions required before any bulk ingestion

| # | Decision | Why it blocks | Recommendation |
|---|---|---|---|
| D1 | **ESPN public JSON as the historical system-of-origin** | ESPN is the only source with WNBA box scores + PBP 2002–2026 and Olympic women's 2016–2024 we can reach without bypassing access controls. Disney Terms of Use §2.B prohibit automated extraction and "compiling, building, creating or contributing to any collection of data, data set or database", and §2.B.viii any commercial use (https://disneytermsofuse.com/english/). We already use ESPN JSON live across PropBetEdge; building a 30-season canonical database is a materially larger exposure than live reads. | Owner/legal call. Options: (a) accept risk for facts-only derived statistics (scores and counting stats are facts; keep raw payloads private, never republish ESPN text/media); (b) seek a data licence (Sportradar/Genius/Stats Perform — paid, needs approval); (c) limit to live/near-term use and do not build the archive. **Nothing below ingests until D1 is decided.** |
| D2 | **Storage home** | History is large (≈150k player-game rows, ≈15k team-game rows, ≈2.5M play events for 2002–2026 alone) and long-lived. | Supabase **tkmlnhmylqnttmnsnief** (sports-intelligence project, same as the PBE ledger), namespace `wbh_*`, one additive migration per phase, proven in BEGIN…ROLLBACK like ledger v1. Raw provider payloads go to **R2** (immutable, content-addressed), not Postgres. |
| D3 | **1997–2001 source** | ESPN has final scores 1998–2001 (statuses wrong), no box scores, no 1997 results, no 1997–98 playoffs. Basketball-Reference (terms ban automation/databases) and stats.wnba.com (terms ban gambling use and stat databases) are **not usable**. | Build 1997–2001 from ESPN season totals + corrected scores where verifiable, mark `completeness=partial`; request permission/licence for a complete source before claiming completeness. |
| D4 | **Olympedia permission** | Only source with player box scores for all 13 women's Olympic tournaments (1976–2024). No licence; robots allow with Crawl-delay 10. | Ask OlyMADMen for written permission before bulk use. |
| D5 | **Wikidata as identity backbone** | CC0 (LOW risk). 1,314 people with a WNBA.com id; 1,310 also B-Ref WNBA id, 1,217 FIBA id, 277 Olympedia id, 1,312 DOB. | Approve as the crosswalk spine (ids + DOB + country-for-sport only; never Wikipedia prose). |

Everything scraped behind a 403, Cloudflare challenge, bot-blocking robots or "no automated means" terms is **do-not-use**: FIBA site/API/LiveStats, EuroLeague Women feeds, Basketball-Reference, stats.wnba.com, Her Hoop Stats, Proballers, RealGM, Eurobasket.com, FEB, WNBL, Unrivaled, TBF, LBF. Their ids may enter via Wikidata only.

---

## A. Current WNBA historical coverage inventory

What PropBetEdge holds today:

| Asset | Where | Coverage | Durable? |
|---|---|---|---|
| ESPN whole-year scoreboards | local `D:\Workers\wnba-model-data\raw\scoreboard` (7.8 MB) | 1997–2026 | **Local only** — must move to R2 under D1/D2 |
| ESPN game summaries | local `…\raw\summary` (747 MB, 5,974 files) | 2002–2026 regular + postseason finals | **Local only** |
| Normalized team-game rows | local `derived/rows.jsonl.gz` (11,906 rows, sha `19b4b8e1…`) | 2002–2026 | Local; fixture subset 2025–26 in Git |
| PBE row store | KV `pbe:rows:v1:<season>` | 2025–2026 | Production KV (model input) |
| Replay archive | KV `archive:v1:*` | 2026 finals (320) | Production KV |
| Live read API | wnba-api (ESPN mediation) | current season | runtime |
| International | wnba-international (ESPN `fiba` league) | 2026 Women's World Cup | KV |
| Photo ledger | `data/player-photos.json` | 166 approved current players | Git |

Per-season coverage measured from the harvest (counts are games; "reg/post" are finals):

| Season | Finals (reg/post) | Player box | Team box | PBP | Officials | Attendance | Notes |
|---|---|---|---|---|---|---|---|
| 1997 | 0 | — | — | — | — | — | 112 events all STATUS_TBD, no scores |
| 1998 | scores on 150 (statuses wrong) | — | — | — | — | — | no postseason events |
| 1999–2001 | scores correct, statuses wrong | — | — | — | — | — | two halves; some 2001 Finals TBD |
| 2002 | 257/15 | 269 | **0** | 271 | 0 | 0 | standings corrupt |
| 2003 | 239/19 | 257 | 198 | 258 | 2 | 1 | standings usable from 2003 |
| 2004–2005 | ~222/18 | ~240 | 214–230 | full | ~135 | 0 | |
| 2006–2012 | ~215/19 | full | full | full | 60–80% | ~0 (53 in 2012) | venue ~50% |
| 2013–2019 | ~205/17 | full | full | full | full | full | wallclock from 2015 |
| 2020 | 132/15 | full | full | full | full | 1 | bubble; 7 postponed |
| 2021–2026 | 194–302 reg | full | full | full | full | ~full | 2026 postseason pending |

Totals available 1997+: player season stats, v3 career rows with team ids, league leaders, awards (incomplete early).

## B. Schema inventory

| Schema object | Project | State | Relevance |
|---|---|---|---|
| `wnba_teams, wnba_players, wnba_rosters, wnba_games, wnba_game_events, wnba_player_game_stats, wnba_team_game_stats, wnba_replay_archives, wnba_standings_snapshots, wnba_availability_*, wnba_odds_*, wnba_picks, wnba_player_images, wnba_source_health` | `supabase/migrations/20260911180000_wnba_core_v1.sql` | **staged, never applied** | ESPN-id-keyed, WNBA-only, no provenance per row, no identity layer. Keep as live-product schema; do **not** stretch it into global history. |
| `wnba_news_*` | `20260911180100_wnba_news_v1.sql` | staged | unrelated |
| `wnba_pbe_*` ledger | tkmln | **applied** | model isolation boundary — history must never write here |
| `pbe_sport_entitlements` | rlfyav (billing) | applied | auth/paywall — untouched |
| KV namespaces | `WNBA_KV` | live | `pbe:*`, `auth:*`, `odds:*`, `avail:*`, `news:*`, `archive:*`, `ref:*` |
| International registry + crosswalk | `workers/wnba-international/src/{registry,crosswalk}.js` | live | generic competition registry (good seed); crosswalk has a **name + birthplace-country** medium rule that must be demoted to *candidate* in the global identity model |

## C. Authoritative-source map (by capability)

| Capability | Primary | Secondary / validation | Status |
|---|---|---|---|
| WNBA games, scores 2002+ | ESPN summaries | ESPN scoreboard | D1 |
| WNBA scores 1998–2001 | ESPN scoreboard (status corrected from score presence) | owner-supplied reference | D1 + D3 |
| WNBA 1997 results | **none open** | — | gap |
| Player box scores 2002+ | ESPN summaries | ESPN season totals (reconciliation) | D1 |
| Team box scores 2003+ (2002 derived from player sums) | ESPN summaries | derived | D1 |
| Play-by-play 2002+, shot x/y | ESPN summaries | — (FT coords are placeholders; distance derived from x/y) | D1 |
| Player season totals 1997+ | ESPN core `seasons/{y}/types/{t}/athletes/{id}/statistics` | our derived totals 2002+ | D1 |
| Standings | **derived from games** (2002+); ESPN standings 2003+ as validation | ESPN corrupt ≤2002 | derived |
| Playoff series | derived from postseason games + `competitions[0].series` | — | derived |
| Rosters / stints | **derived from box-score appearances** (2002+), v3 career rows (1997+) | ESPN season rosters are NOT season-aware (return current) | derived |
| Franchise lineage | **curated table** with citations | ESPN team ids (inconsistent across relocations; Portland Fire id reused) | curated |
| Draft | ESPN core draft 2018+ | 1997–2017 gap | gap |
| Awards | ESPN core awards (incomplete ≤2004, no COY) | curated corrections with citations | partial |
| Coaches | **none usable historically** | curated | gap |
| Identity crosswalk | **Wikidata (CC0)** | ESPN global athlete id; DOB | D5 |
| Olympic women's box scores | ESPN 2016–2024 | Olympedia 1976–2024 (permission) | D1 + D4 |
| World Cup women's | ESPN 2026 only | — (2018/2022 absent; FIBA restricted) | gap |
| Continental cups, EuroLeague Women, domestic leagues | **no usable open source** | Wikidata ids only | gap |

## D. Licensing / terms risk map

| Source | Risk | Use |
|---|---|---|
| Wikidata | LOW (CC0) | identity spine, DOB, nationality, external ids |
| ESPN public JSON | HIGH by terms (Disney ToU §2.B) | **pending D1**; facts only, never republish text/media |
| Olympedia | MEDIUM (no licence, robots permissive) | pending D4 |
| olympics.com | NOT VERIFIED (timeouts) | reference |
| FIBA (site, archive, API, LiveStats, EuroLeague Women) | HIGH (§4 no reproduction; 403/401) | do not fetch |
| Basketball-Reference / Stathead | HIGH (no automated means, no competing database) | ids via Wikidata only |
| stats.wnba.com / WNBA ToU | HIGH (§9 bans gambling use and stat databases) | do not use |
| Her Hoop Stats, Proballers, RealGM, Eurobasket.com | HIGH | ids via Wikidata only |
| FEB, WNBL, Unrivaled, TBF, LBF | HIGH | do not fetch |
| LFB, WCBA | NOT VERIFIED | — |
| Athletes Unlimited | MEDIUM (PDF season stats, terms unread) | later |

## E. Missing-data matrix by season (WNBA)

Legend: ● complete · ◐ partial · ○ absent · ▲ derivable from canonical data · ✎ curated

| Season | Results | Player box | Team box | PBP | Shots | Standings | Playoffs | Rosters | Draft | Awards | Coaches | Officials | Attendance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1997 | ○ | ○ | ○ | ○ | ○ | ✎ | ○ | ◐ (season totals) | ○ | ◐ | ✎ | ○ | ○ |
| 1998 | ◐ | ○ | ○ | ○ | ○ | ▲◐ | ○ | ◐ | ○ | ◐ | ✎ | ○ | ○ |
| 1999–2001 | ◐ | ○ | ○ | ○ | ○ | ▲◐ | ◐ | ◐ | ○ | ◐ | ✎ | ○ | ○ |
| 2002 | ● | ● | ▲ | ● | ● | ▲ | ● | ▲ | ○ | ◐ | ✎ | ○ | ○ |
| 2003–2005 | ● | ● | ◐▲ | ● | ● | ▲● | ● | ▲ | ○ | ◐ | ✎ | ◐ | ○ |
| 2006–2012 | ● | ● | ● | ● | ● | ▲● | ● | ▲ | ○ | ● | ✎ | ◐ | ○ |
| 2013–2017 | ● | ● | ● | ● | ● | ▲● | ● | ▲ | ○ | ● | ✎ | ● | ● |
| 2018–2026 | ● | ● | ● | ● | ● | ▲● | ● | ▲ | ● | ● | ✎ | ● | ● |

International: Olympics ● 2016–2024 (ESPN), ◐ 1976–2012 (Olympedia, D4); World Cup ● 2026 only; continental cups, EuroLeague Women, domestic leagues ○.

## F. Proposed global identity schema

**`wbh_persons`** — one row per athlete, `global_player_id` = `gp_` + 12-char Crockford base32 of a random 60-bit value (opaque, never derived from a name).

Resolution rules (deterministic, confidence-scored; **never merge on name alone**):

| Tier | Evidence | Confidence | Action |
|---|---|---|---|
| T1 | Same provider id in the same id space (ESPN athlete id across ESPN leagues) | 1.00 | auto-link |
| T2 | Wikidata item carries both external ids (e.g. P3588 WNBA.com + P8286 Olympedia) | 0.98 | auto-link, cite QID |
| T3 | Exact normalized full name **and** exact DOB **and** consistent nationality | 0.95 | auto-link |
| T4 | Exact name + DOB, nationality missing on one side | 0.85 | auto-link, flagged |
| T5 | Exact name + team/birthplace country, no DOB (today's crosswalk "medium" rule) | 0.60 | **candidate only**, never merged without review |
| — | name only / fuzzy | — | never |

Conflicts (two candidates, DOB mismatch, same source id on two persons) block the link and open a review item. Merges and splits are append-only events; a person id is never reused.

## G. Recommended ingestion order

1. **Provenance plumbing** — R2 raw archive (content-addressed), `wbh_sources`, `wbh_source_documents`, `wbh_ingestion_runs`, parser versions.
2. **Reference skeleton** — organizations, competitions, WNBA editions 1997–2026, curated franchise lineage, venues.
3. **Vertical slice: WNBA 2024** (section J) end to end, including records and verification.
4. **WNBA 2013–2025** (fully covered era) — repeat the slice pipeline; bulk from the local harvest after R2 migration.
5. **WNBA 2002–2012** — adds derived team box for 2002, officials/attendance nulls.
6. **Identity spine** — Wikidata crosswalk for every WNBA person; review queue.
7. **Olympics 2016–2024** (ESPN) → international career links via ESPN global ids + Wikidata.
8. **WNBA 1997–2001 partial** (D3), clearly flagged.
9. **Olympics 1976–2012** only after D4 permission.
10. Continental cups / EuroLeague Women / domestic leagues **only with a licensed or permitted source**.

## H. Proposed database tables (`wbh_*`, tkmln, additive)

Provenance on every fact row: `source_document_id` (FK), `parser_version`, `observed_at` (when we saw it), `source_published_at` (when the source says it happened/updated), `confidence`.

| Group | Tables |
|---|---|
| Provenance | `wbh_sources` (terms status, risk, approval ref), `wbh_source_documents` (url, fetched_at, http status, sha256, r2_key, parser_version), `wbh_ingestion_runs`, `wbh_review_items` |
| Reference | `wbh_organizations` (FIBA, WNBA, IOC…), `wbh_competitions` (type: league / world_cup / olympics / continental / club_continental / domestic; organization; gender), `wbh_competition_editions` (season label, start/end, host), `wbh_stages` (regular, playoffs, group, knockout) |
| Clubs & teams | `wbh_franchises`, `wbh_franchise_lineage` (from_team, to_team, event: founded/relocated/renamed/folded, effective date, citation), `wbh_teams` (club or national team, country), `wbh_team_editions` (team × edition: name, abbr, venue as of that season), `wbh_venues` |
| People | `wbh_persons`, `wbh_person_source_ids`, `wbh_person_aliases`, `wbh_person_attributes` (DOB, height, positions, nationality — each with provenance and valid_from), `wbh_identity_links` (tier, confidence, method, status: linked/candidate/rejected), `wbh_identity_events` (merge/split, append-only), `wbh_coaches` (person-based) |
| Games | `wbh_games` (edition, stage, scheduled/actual start, venue, neutral, status, periods format), `wbh_game_teams` (home/away/neutral side, score, linescore jsonb), `wbh_game_officials`, `wbh_series` + `wbh_series_games` |
| Stats | `wbh_player_game_stats` (core counting columns + `extra jsonb`, minutes, starter, dnp), `wbh_team_game_stats`, `wbh_play_events` (partitioned by edition; x/y nullable; `coordinate_quality`), `wbh_player_season_totals_source` (provider totals kept for reconciliation, never overwritten by ours) |
| Rosters & careers | `wbh_roster_stints` (derived: person × team_edition, first/last appearance game), `wbh_draft_picks`, `wbh_awards` + `wbh_award_recipients`, `wbh_championships` |
| Derived (rebuildable) | `wbh_standings` (derived, with tiebreak method), `wbh_player_season_totals`, `wbh_career_totals`, `wbh_franchise_totals`, `wbh_record_definitions` (deterministic rule: stat, scope, qualifier), `wbh_record_holders` (materialized with `dataset_sha256` + `as_of`) |

No per-competition migrations: competitions, stages and stat columns are rows, and competition-specific stats live in `extra jsonb` with a per-competition stat schema registry.

**Temporal integrity:** every derived table is rebuildable `as_of` a timestamp from facts with `observed_at`/`source_published_at <= as_of` and games completed before it. History never feeds `pbe-wnba-model-v1`; any future `pbe-wnba-model-v2-global` gets its own feature contract, leakage audit and ledger lineage.

## I. Proposed API endpoints (new Worker `wbh-api`, isolated from wnba-api auth/paywall)

Public reads (facts; Pro gating decided later per surface):

- `GET /v1/history/competitions` · `/v1/history/competitions/:id/editions`
- `GET /v1/history/editions/:id` (season explorer: standings, series, leaders)
- `GET /v1/history/games/:id` (box score, PBP, officials, provenance)
- `GET /v1/history/franchises/:id` (lineage, seasons, totals, records)
- `GET /v1/history/players/:global_player_id` (passport: identity, source ids, career timeline)
- `GET /v1/history/players/:id/games?edition=` · `/splits` · `/teammates` · `/opponents`
- `GET /v1/history/records?scope=&stat=&as_of=` (derived, with dataset hash)
- `GET /v1/history/search?q=` (names/aliases → persons; never auto-merges)
- `GET /v1/history/provenance/:record_type/:id` (source documents, parser version, confidence)

## J. First shippable vertical slice — WNBA 2024

Why 2024: complete, officials + attendance full, 12 stable franchises, 242 regular-season + 22 playoff games, directly adjacent to Paris 2024 Olympics for the next (international) slice.

Scope: one edition fully modeled — 12 team editions, every player appearing (persons + ESPN source ids + Wikidata crosswalk), 264 games with team/player box scores and play events, officials, attendance, derived standings with tiebreaks, derived playoff series, awards (ESPN + curated check), derived season/career-to-date totals and a first records set (single-game highs, season leaders, team streaks).

Acceptance (all must PASS; receipt committed):

1. Raw payload for every document in R2 with sha256; every fact row resolves to a source document.
2. Game count equals scoreboard finals (242 + 22); zero orphan stats.
3. Derived standings W-L equals ESPN 2024 standings for all 12 teams (validation source, not truth source).
4. Derived player season totals equal ESPN provider totals for every player (points, rebounds, assists, minutes; any mismatch explained or blocked).
5. Team box = sum of player box ± team-only stats for every game.
6. Playoff series results match postseason games; champion derived = recorded champion.
7. Identity: every 2024 player has a `global_player_id`; T1/T2 links only; zero name-only merges; review queue listed.
8. Records engine reproduces a published set (e.g. 2024 single-season leaders) deterministically from canonical rows; dataset hash stable across two rebuilds.
9. `as_of` rebuild at 2024-07-01 excludes everything after that date (leakage test).
10. No change to wnba-api, auth, paywall, PBE ledger or model files (diff proof).

Blocked by D1 (ESPN rights) and D2 (storage + migration approval).
