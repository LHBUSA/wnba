# PropBetEdge WNBA — Runtime Architecture

**GitHub stores it · Vercel presents it · Supabase remembers it · Cloudflare operates it.**

```
Browser (wnba.propbetedge.ai, Vercel static)
  │  CSP connect-src: self + the two Workers below. No provider host, no secret.
  ├──► wnba-api   (Cloudflare Worker, read API)  ──► ESPN site.web.api / core.api  (edge cache + KV last-good)
  │                                              ──► WNBA_KV (odds/props snapshots, replay archive, change ledger)
  │                                              ──► Supabase (when bound)
  └──► wnba-news  (Cloudflare Worker, newsroom)  ──► WNBA_NEWS_KV · Supabase (when bound)
                                                 ──► wnba-api via Service Binding (entity dictionary, desk records)
wnba-ingest (Cloudflare Worker, Cron * * * * *)  ──► ESPN · The Odds API (08/13/18 ET) ──► WNBA_KV · Supabase
```

No Vercel Functions (`api/` is forbidden by `scripts/guard-truth.mjs`). No GitHub Actions scheduler. Checkout, when activated, is Stripe-hosted → `propbetedge-sports-billing` Worker → Supabase `pbe_sport_entitlements`.

## Workers

| Worker | Trigger | Bindings | Source |
|---|---|---|---|
| `wnba-api` | HTTP | `WNBA_KV`, service `BILLING`→`propbetedge-sports-billing`, `EMAIL`, var `WNBA_PURCHASE_ACTIVE="true"` (checkout live), secrets `WNBA_SESSION_SECRET`, `ENTITLEMENT_READ_TOKEN`, `WNBA_OWNER_EMAILS`, optional `PBE_SUPABASE_*` | `workers/wnba-api` (`/v1/account` returns the shared membership contract, `src/pbe-membership.js` v1.1.0) |
| `wnba-ingest` | Cron `* * * * *` + `POST /run/<task>` (bearer) | `WNBA_KV`, secrets `ODDS_API_KEY`, `ADMIN_TOKEN`, optional `SUPABASE_*` | `workers/wnba-ingest` |
| `wnba-news` | Cron `*/10 * * * *` + `POST /run` (bearer) | `NEWS_KV` (= `WNBA_NEWS_KV`), service `API`→`wnba-api`, secret `ADMIN_TOKEN`, optional `SUPABASE_*` | `workers/wnba-news` |

Deploy Cloudflare Workers only from a pushed `main` commit with local Wrangler. GitHub Actions must not deploy or schedule Cloudflare Workers in this repo. Standard path: `cd workers/<name> && npx wrangler deploy`. For `wnba-ingest`, use `pwsh -NoProfile -File scripts/deploy-wnba-ingest.ps1` so the PBE tests, Wrangler deploy, and production canary run as one fail-closed release. Admin token: `C:\projects\wnba\.admin-token` (gitignored, never printed).

### `wnba-api` routes (all `GET`, envelope `{ ok, data, meta }`)

`/health` · `/v1/sources` (live canary from CF egress) · `/v1/today` · `/v1/season` · `/v1/schedule?date=|from&to|season` · `/v1/games/:id` · `/v1/games/:id/live?since=` · `/v1/games/:id/events` · `/v1/games/:id/boxscore` · `/v1/games/:id/shots` · `/v1/matchups/:id` · `/v1/standings` · `/v1/playoffs[?season=]` · `/v1/teams` · `/v1/teams/:id` · `/v1/teams/:id/roster` · `/v1/players` · `/v1/players/:id` · `/v1/players/:id/gamelog` · `/v1/injuries` · `/v1/transactions` · `/v1/stats/winba` · `/v1/stats/players` · `/v1/stats/teams` · `/v1/odds[?event=]` · `/v1/props` · `/v1/track-record` · `/v1/account`

`meta`: `source`, `fetched_at`, `source_updated_at`, `age_s`, `stale_after_s`, `freshness` (CURRENT / CACHED / STALE / UNAVAILABLE / ERROR / NOT_CONFIGURED), `cache`, `semantics` (e.g. `TODAY_SLATE`, `NEXT_SLATE_NOT_TODAY`, `LIVE_SOURCE`, `FINAL_PERSISTED_ARCHIVE`, `LAST_VERIFIED_MARKET`, `CURRENT_SEASON`, `PRIOR_SEASON_FINAL`), `season`, `degraded[]`.

### `wnba-ingest` tasks

| Task | When | Writes |
|---|---|---|
| live | every minute | live event deltas (Supabase), archive of newly final games |
| availability | :00/:10/… | KV `avail:v1:snapshot`, `avail:v1:changes` (before → after), Supabase availability tables |
| backfill | :00/:10/… | 12 completed games per run → KV `game:v1:final:<id>` (+ `archive:v1:index`) |
| winba | :00/:10/… after backfill | If the archive signature changed, rebuild season WinBA Score from immutable regular-season finals → KV `winba:v1:latest`; otherwise skip |
| schedule | :05/:35 | `wnba_games` |
| reference | :15 | teams, players, rosters, standings snapshot, KV `ref:v1:athletes` |
| odds | 08:00/13:00/18:00 ET (slot-locked) | KV `odds:v1:latest`, `props:v1:latest`, `odds:v1:hist:<event>`, `odds:v1:status`; `wnba_odds_snapshots`, `wnba_odds_runs` |
| playoffs | :03/:13/… (every 2 min while a playoff game is live or within 45 min of tip) | KV `playoffs:v1:<season>` (validated bracket, pbe-playoffs/1.0.0), `playoffs:v1:checked:<season>`, `playoffs:v1:current`, `playoffs:v1:seasons`, `playoffs:v1:status`, `playoffs:v1:day:<YYYYMMDD>` (settled days). `POST /run/playoffs?season=YYYY[&force=1]` backfills/re-verifies. See `docs/PLAYOFFS.md`. |

### `wnba-news` routes

`/health` · `/v1/news?limit&type&player&team&game&lane=pbe|external` · `/v1/news/story/:id` · `/v1/news/sources` · `/v1/news/runs`

## Supabase (staged, not applied)

`supabase/migrations/20260911180000_wnba_core_v1.sql` and `20260911180100_wnba_news_v1.sql`. Service-role only (RLS on, zero anon/authenticated policies, privileges revoked). Picks are immutable and pre-tip by constraint + trigger; no deletes. Workers write when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are bound; until then `/health` reports `system_of_record: NOT_CONFIGURED` and KV carries the durable-ish state listed above.

The entitlement migration that adds `wnba` to `pbe_sport_entitlements` lives with the billing Worker in `LHBUSA/propbetedge-workers` (`migrations/20260911_pbe_add_wnba_sport_v1.sql`).

## Frontend

Vite + vanilla ES modules; one path router (`src/lib/router.js`) with one module per surface; every page returns an unmount that stops its single poller. Data only through `src/data/api.js`. WinBA Score is derived in `workers/shared/winba.js`; `wnba-ingest` materializes the archive-derived season snapshot and `wnba-api` joins that one canonical row into stats, player, roster and WNBACast responses. WNBACast imports `workers/shared/derive.js` — the same code the Worker runs. `npm run check` (guards + tests + build) is the Vercel build command.

## Rollback

- Frontend: `vercel rollback` / promote the previous production deployment of project `wnba`.
- Workers: `npx wrangler rollback --name <worker>` or `wrangler versions deploy <previous-version-id>`.
- Git: revert to the previous `main` SHA and push (Vercel redeploys).
