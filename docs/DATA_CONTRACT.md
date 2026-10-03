# WNBA public data contract (PropSports)

Network standard (2026-10-03): customers consume **PropSports** as the data layer. Upstream collection lanes are
internal provenance (KV/R2 captures, ingest, `/v1/sources`, the trust page); public responses name PropSports.

Applies to `wnba-api` (all routes except `/health` and `/v1/sources`), `wnba-international`, and the public
`wnba-news` article/story routes. Mapping happens at serving time in `workers/shared/customer-brand.js`
(`customerDoc` / `customerBody`), so stored captures, DNA documents and hashed articles are never rewritten.

## Source fields

| Field | Contract |
|---|---|
| `meta.source` | `{ id: "propsports", name: "PropSports", authority }` (PBE-computed products keep `{ id: "pbe" }`) |
| `data_source` | `"PropSports"` beside any legacy `source: "espn"` value (game rows, injury change ledger, …) |
| `meta.data_source` | `"PropSports"` on every `wnba-international` response |

## Neutral identifiers (additive)

| Neutral field | Legacy field (deprecated, still served) | Notes |
|---|---|---|
| `player_id` | `espn_athlete_id` | Same value. DNA player/index/404 and any other object carrying the legacy key. |
| `event_id` | `espn_event_id`, `espn_game_id` | Same value, wherever the legacy key appears. `game_id` is already neutral. |
| `odds_reference` | `odds_espn` | Same object (one sportsbook reference line). |
| `data_source` | `source: "espn"` | Legacy value kept. |
| `pbp_lane` | `pbp_source` | |
| International `id` / `game_id` (`g-*`), player `p-*`, team `slug`, `wnba.wnba_player_id` | `provider_ids.espn`, `wnba.mapping_provenance.espn_athlete_id` (now also `player_id`) | |

Every response that serves a legacy field lists it in `meta.deprecated_fields` with `meta.deprecation_note`.
Legacy fields are **compatibility-only** and are scheduled for removal in the next versioned contract; they are not
removed or renamed in v1. Identifier values are not rewritten (they keep their external-id semantics internally).

## Kept on purpose

Photo/headshot credit metadata (`photo.provider`, `headshot.provider`), named publisher reporting, sportsbook names
(ESPN BET), licence credits, the `/v1/sources` registry and `/health`.
