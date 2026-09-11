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

## Newsroom V3 — publication layer (2026-09-11)

**Story media.** `scripts/media/newsroom_media.py` builds deliberate compositions from each approved ledger photo (`data/player-photos.json`): `wide` 16:9 (1280/960/640 — lead, hero, cards), `half` 8:9 (640/480 — one side of a matchup; two halves make one 16:9 frame) and `og.jpg` 1200×630 with the credit printed on it. Art direction follows the UFC article hero: the pictured player stays sharp in the foreground; the rest of the photo is defocused and dimmed; frame areas outside the photo are the photo's own edges mirrored and defocused, team-tinted; any other face of comparable size (YuNet) is held out of focus so only the pictured player is sharp. Framing uses the ledger's reviewed face box with the stage-6 head rules (head never cut by our frame), medium shot by default, bottom-anchored "bust" framing for press close-ups, never upscaled past 1.3×. Every frame is reviewed on contact sheets before commit. Output lives on our domain (`public/media/news/players/<id>/`), manifest `data/newsroom-media.json`; `guard-truth` fails the build on an unapproved, uncredited, missing, upscaled or orphan derivative.

**Which photo a story may show** is decided in `wnba-news` (`src/media.js`) and attached to every card/article at serve time: single-subject stories (injury, transaction, performance, result, prop watch) show *their own* subject or no photo — never a teammate standing in; matchups show one pictured player per team only when both teams have one; everything else gets a team composition. Each photo carries author · license · source and a "Pictured:" caption.

**Front page** (`/news`): masthead + desk navigation; a dominant photographic lead (editorial rule: newest injury, else performance, else preview inside the newest 48 h; a photographed story wins only a same-moment tie); top stories; Latest; Market Watch (one row per game); Injury Desk, Previews, Performances, Team Trends, Roster Moves; the external Source Wire last, visibly attributed. **Article** (`/news/:slug`): photographic hero + credit → desk → headline → deck → newsroom byline and timestamps → body → bettor and market modules → Evidence & method (trust layer) → related coverage.

**Editorial structures** (`wnba-articles/1.1.0`): each kind has several deterministic article shapes — different leads, section order and sentence construction over the same grounded facts (injury 3, transaction 3, performance/result 3, preview 3, trend 2, prop watch 2, market move 2), picked from the story's identity so a story keeps its shape. No shape adds a fact; `node scripts/newsroom-dryrun.mjs --all` runs every structure of every live story through the publication gate (2026-09-11: 102 renders, 0 held). A story keeps its first URL when a new structure rewrites its headline. Repeated feed updates of the same injury status are one story: older renders are marked `superseded_by` and drop from lists (their URLs still resolve).

**No third-party browser requests**: the web fonts (SIL OFL) are self-hosted (`scripts/fonts/selfhost_fonts.py`, `public/fonts/`), the CSP allows fonts and images from our origin only, and data comes from the owned Workers.
