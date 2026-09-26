# WinBA deterministic ordering — promoted as `winba/1.0.1`

Status: **PROMOTED IN CODE (owner-approved 2026-09-26); live after wnba-ingest 1.4.0 is deployed and the
board is rebuilt.** The research candidate `winba/1.0.1-research` (`winba-research.js`) was removed; its
rule now lives in production `workers/shared/winba.js` (`WINBA_VERSION = 'winba/1.0.1'`,
`winbaGameOrder`, sha256-pinned). `winba/1.0.0` is preserved byte-for-byte in
`workers/shared/winba-1.0.0.js` (same pinned hash as the published file).

- Promotion proof on the real archive vs the live board: `docs/research/winba-1.0.1-promotion-proof-2026.json`
- The board 1.0.1 must serve on that archive: `docs/research/winba-1.0.1-expected-board-2026.json`
- Proof / post-deploy verification: `node scripts/winba-promotion-proof.mjs prove|verify`
- Tests: `tests/winba-1.0.1.test.mjs`

**Deploy:** wnba-ingest 1.4.0 (reads the season in tip order; rebuilds any stored board whose `version`
differs from `WINBA_VERSION`, so the next run — or `POST /run/winba` — writes 1.0.1 on an unchanged
archive; `POST /run/winba?force=1` also works). Then `node scripts/winba-promotion-proof.mjs verify`.

**Rollback caveat:** wnba-ingest 1.3.0 never forces the winba task (its `POST /run/winba` passes no
force and skips an unchanged archive signature regardless of version), so redeploying 1.3.0 alone
leaves the 1.0.1 board in place until the next archived game. Keep a copy of `winba:v1:latest` taken
before the 1.4.0 deploy; rollback = redeploy 1.3.0 + put that copy back.

The original research notes follow.

## Why

The winba/1.0.0 aggregate processes games in the order it receives them, and a few outputs depend on
that order — mainly a player's `team_id`, which is the team of the **last game processed**. Production
feeds games in `archive:v1:index` order, which is the order finals were archived (live + backfill),
not the order they were played. So a traded player can be credited to her earlier team, and the board
would change if the index were rebuilt in a different order.

## What the candidate changes

Only ordering: documents are sorted by `start_utc` ascending, then `game_id` ascending (numeric ids
compared numerically), then passed unchanged to the frozen winba/1.0.0 aggregation and scoring. The
formula, weights, qualification, percentile rule and rounding are untouched. The board is labelled
`winba/1.0.1-research` with `research.status = CANDIDATE_NOT_PROMOTED`.

## Result on the real 2026 archive

Production board: `GET /v1/stats/winba` (serves KV `winba:v1:latest` unchanged; photo/status stripped),
version `winba/1.0.0`, generated 2026-09-25T04:26:27.869Z, archive signature `350:401857218`,
games_used 332. The same rows are reproduced exactly by the production builder over the pulled
archive in index order (checked), so the candidate is compared on the identical archive state.

| | production | candidate |
|---|---|---|
| rows | 238 | 238 |
| games_used | 332 | 332 |
| qualified / provisional | 196 / 42 | 196 / 42 |
| row order (by rank) | — | identical |

**Rows changed: 4. Fields changed: 4, all `team_id`.** Every `score`, `rank`, `status`, `qualified`,
`components.*`, `raw.*`, `sample.*` and `averages.*` value is identical for all 238 rows. No 0.1
rounding-edge flip occurred (the candidate is also byte-identical under reversed and shuffled input).

| athlete_id | player | field | production | candidate | latest 2026 game |
|---|---|---|---|---|---|
| 3065570 | Kelsey Plum | team_id | 6 (LA Sparks) | 11 (PHX Mercury) | PHX, 2026-08-26 |
| 4068159 | Sug Sutton | team_id | 132052 (POR Fire) | 3 (DAL Wings) | DAL, 2026-08-31 |
| 4282168 | Kiana Williams | team_id | 11 (PHX Mercury) | 131935 (TOR Tempo) | TOR, 2026-08-30 |
| 4684384 | Aneesah Morrow | team_id | 18 (CON Sun) | 131935 (TOR Tempo) | TOR, 2026-08-22 |

In all four cases the candidate credits the team of the player's latest game; production credits an
earlier team. 21 players appeared for two or more franchises in 2026; the other 17 are already credited
correctly by production because their last-archived game happened to be their latest game.

59 archived games share a tip time with the previous game; the `game_id` tie-break makes their order
total. A player cannot appear in two games with the same tip, so ties cannot change a row.

## Promotion checklist (owner review required; none of this is done)

1. **Owner decision:** adopt tip-order team attribution. Effect today: the 4 `team_id` changes above;
   nothing else on the 2026 board moves.
2. **New version, never a relabel:** promotion ships as a new production version (e.g. `winba/1.1.0`
   or `winba/1.0.1`), with a new pinned hash; `winba/1.0.0` stays reproducible. The candidate label
   `winba/1.0.1-research` is not a production label.
3. **Frozen editions stay frozen:** published WinBA Index editions and daily slots carry their own
   frozen boards. They are not rebuilt or edited; an edition's team shown for a traded player stays
   what it published. Only boards built after promotion use the new ordering.
4. **Consumers to re-check:** `/v1/stats/winba`, the WinBA page, `/v1/stats/players` (joins by athlete),
   Player Load cards (show WinBA score only), Player DNA (attaches the canonical row; `team_id` from
   WinBA is not used by any DNA dimension — DNA's own `team_id` already comes from the latest game).
   The DNA historical as-of board (`canonicalWinbaBoardAsOf`) already builds in tip order.
5. **Deploy path:** switch the wnba-ingest `winba` task from `order: 'index'` to tip order (the bounded
   archive reader already supports `order: 'tip'`), bump wnba-ingest VERSION, redeploy with
   `scripts/deploy-wnba-ingest.ps1`, force one `POST /run/winba`, and verify the live board against
   this diff (expect exactly the 4 `team_id` changes plus the new version label).
6. **Rollback:** redeploy the previous wnba-ingest version and force `POST /run/winba`; the 1.0.0 board
   is reproduced exactly from the archive.
