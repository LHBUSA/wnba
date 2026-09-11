# WNBA Newsroom — independent lane

`wnba-news` is its own Worker, KV namespace, cron and deploy. It shares no code path, table or schedule with any NBA newsroom.

```
sources (6) ──► Cloudflare Cron */10 ──► parse (headline/link/summary only)
   ──► canonical URL + sha-256 id ──► entity links ──► WNBA relevance gate ──► story type
   ──► cross-publisher dedupe clusters ──► KV (+ Supabase when bound) ──► GET /v1/news
structured records (via wnba-api) ──► PBE Desk generator ──► owned stories with evidence
```

## Sources

| Source | Kind | Scope | Stored |
|---|---|---|---|
| WNBA.com `/news` | official | WNBA-only | headline, link, excerpt, timestamps |
| ESPN WNBA news API | provider | league-scoped, still gated | headline, link, description, WNBA-sport tags |
| CBS Sports WNBA RSS | external | **mixed** (carried an NFL story on 2026-09-11) | headline, link, description |
| The IX (The Next) RSS | external | multi-sport | headline, link, description, tags |
| Swish Appeal RSS | external | women's basketball | headline, link, summary |
| Her Hoop Stats | external | women's basketball | headline, link, subtitle |

## Relevance gate (deterministic)

Accept only with: an explicit "WNBA" mention, a linked current WNBA team, an official WNBA source, a publisher WNBA tag plus a rostered player, or a rostered player plus a consequence (injury / trade / transaction / lineup). Reject: off-sport headlines, college context without WNBA signal, international (FIBA / World Cup / Olympics / national team) items without a WNBA mention or consequence. Every rejection is logged with its reason (`/v1/news/runs`).

## Entity linking

`provider_tag` (ESPN tags with WNBA sportId 59) · `exact_full_name` (unique rostered names only) · `exact_team_name` · `*_tag` from publisher tags · `nickname_with_rostered_player:<id>` (a bare nickname links a team only when one of its rostered players is named in the same item). Links drive player pages, team pages, WNBACast chips and filters (`?player=`, `?team=`, `?game=`).

## Dedupe

Cross-publisher only, within 48h: headline token Jaccard ≥ 0.55, or same story type + same player set + Jaccard ≥ 0.25. Official source wins canonical. Proof (2026-09-11): Magbegor ACL (ESPN + CBS), Engelbert retirement (WNBA.com + ESPN), Sabally concussion (ESPN + CBS) clustered; ESPN's quarterfinal vs semifinal previews correctly kept apart.

## PBE Desk

Deterministic generator (`pbe-desk/1.1.0`), no language model. Story kinds: availability change (from the ingest before/after ledger), roster moves (ESPN transactions), notable results (30+ pts, 15+ reb, 12+ ast, triple-double, OT, 15+ point comeback), clinch marks (standings diff). Every story stores its evidence records; deterministic ids mean re-runs never duplicate. Quiet days publish nothing.

## Cadence

Cloudflare Cron every 10 minutes. Manual: `POST /run` with the admin bearer token.

## In-house article engine (v2, `wnba-articles/1.0.1`)

The v1 Desk blurbs are superseded by full articles written in `workers/wnba-news/src/articles.js`, orchestrated by `articles-run.js` (every 25 min inside the 10-min cron; team trends once a day) and served at `/v1/articles`, `/v1/articles/:slug` and `/v1/articles/held`.

Contract (from the UFC newsroom, `LHBUSA/UFC docs/editorial_contract.md`): headline · deck · body · `bettor_angle { summary, supporting[], against[], unknown[], markets[], odds_status, model_status }` · `market_watch { text[], market (stored snapshot), game_id, line }` · context · entities · evidence · facts.

Kinds: injury (ESPN injury feed + attributed publisher reports + season/last-10 averages + observed rotation + next-game stored market, with capture-before/after-update note), transaction, performance/result (box score, quarters, team shooting, runs, closing line result vs ESPN-relayed DraftKings line), preview (form, rest, pace, available rotation, injuries, stored market with no-vig benchmark), team trend (ATS / totals over last 10, only at 7-3 ATS or 8-2 totals), prop watch (36h capture window), market move (≥1.5 spread / ≥2 total between captures).

Publication gate `workers/wnba-news/src/gate.js` — ported from UFC `validate()`: two-class number grounding, publisher-headline-only quotations, absence discipline (no price language without a stored market, no model language ever), banned phrases, subject discipline, counter-case + unknown required, per-kind length floors. Failing articles are held with their failures (`/v1/articles/held`). No LLM is used; the contract leaves room for a later polish pass that must pass the same gate.

Not reused (by decision): the MLB/NFL/NBA sports desk `propbet-news-enrich` — not in Git, its `NOISE_TITLE_PATTERNS` rejects every "WNBA" title, and it has no number grounding.
