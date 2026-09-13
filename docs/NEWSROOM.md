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

**Editorial structures** (`wnba-articles/1.2.0`): injuries, transactions, results/performances, previews and team trends are written as an argument — one validated deterministic structure per class, in sections (The read → the evidence → The counter-case → What matters next) rendered as headings on the article page. Each story states a read, the evidence for it, the evidence against it and what is unknown; comparisons replace enumerations; absence effects are read from the box scores of games a player actually missed, never assumed; player stats carry a season provenance (a prior season is named with its year and team, never shown as this season); ESPN return dates appear only as ESPN's estimate with the feed-update date; injury-feed comment text is never used in prose. Prop watch and market moves keep the 1.1.0 shapes (2 variants each, picked from the story's identity). No shape adds a fact.

**The added gate** (`wnba-reconcile/1.0.0`, `workers/wnba-news/src/reconcile.js`) runs after `gate.js` `validate()` — which is unchanged — and holds a story on season-year leakage, an incomplete injury-feed description (checked against the full feed, not the generator's own list), a headline naming one of several materially equivalent lines, a bettor analysis aimed at the wrong market, a rest figure that is not the source's `rest_days`, provider comment text in prose, or a prose-lint failure. `node --test tests/newsroom-synthesis.test.mjs` covers all of it offline against a captured fixture. There is no standings archive, so a historical regeneration serves no standings and says less rather than borrowing today's table. A story keeps its first URL when a new structure rewrites its headline. One live injury story per player: the newest render is the story; older ones (earlier feed updates or statuses that have left the feed) are marked `superseded_by` and drop from lists (their URLs still resolve).

**No third-party browser requests** on page load: the web fonts (SIL OFL) are self-hosted (`scripts/fonts/selfhost_fonts.py`, `public/fonts/`), the CSP allows fonts and images from our origin only, and data comes from the owned Workers. The one intentional exception is the official video player below, which loads only after a reader presses play.

## Official game highlights (`wnba-video/1.0.0`)

A story about ONE completed game may carry that game's official highlight package from YouTube. If the match can't be proven, no video is shown. The pattern comes from the UFC official-video layer (`LHBUSA/UFC docs/videos.md`):
- verified channel allowlist;
- discovery ahead of serving;
- deterministic linking;
- poster-first player;
- graceful fallback;
- nothing downloaded or rehosted.

It is ported as a pattern only. WNBA has its own Worker code (`workers/wnba-news/src/video.js`), KV keys, allowlist and cron. No NBA or NHL runtime is involved.

### Channel allowlist

`data/video-channels.json`. Identity is the exact channel ID; handles are evidence only. A channel stays `enabled` only while `scripts/video/verify_channels.mjs` re-proves all three required checks:
1. The organization's own website links to a YouTube URL that resolves to that channel ID.
2. The channel page's canonical URL is `/channel/<id>`.
3. The upload feed carries the expected channel title.

- The verified badge is recorded as supporting evidence when YouTube server-renders it.
- A channel that fails is disabled with its evidence, never deleted.
- Each channel carries its `namespace` (`wnba` or `intl`), an optional `team_scope` or `competition_scope`, and a `priority`.
- Adding a channel is a data change, not a resolver change.

| Channel | Channel ID | Class | Namespace / scope | Proof (2026-09-13) |
|---|---|---|---|---|
| WNBA | `UCO9a_ryN_l7DIDS-VIt-zmw` | league_official | wnba | wnba.com → youtube.com/user/wnba → this ID; canonical; feed title "WNBA" |
| FIBA Basketball | `UCtInrnU3QbWqFGsdKT1GZtg` | federation_official | intl | fiba.basketball → youtube.com/fiba → this ID; canonical; feed title |
| USA Basketball | `UCBo3XgAVBeE74Zw0T77aDhw` | national_federation | intl, USA games only | usab.com → youtube.com/user/therealusabasketball → this ID; canonical; feed title; verified badge |

Not listed:
- **Team channels**: not needed while the league channel publishes every game; each would need its own proof.
- **ESPN**: not verified as a per-game WNBA highlight publisher.
- **Olympics**: no Olympic competition is in the registry yet.

Fan channels, aggregators, reuploads and compilation channels are never listed.

### Discovery

Runs inside the `wnba-news` cron every 20 minutes. It is bounded, never runs in the browser and never uses `search.list`.
- **With the optional secret `YOUTUBE_API_KEY`:** Data API v3.
  - Calls: `channels.list` (uploads playlist, cached) → `playlistItems.list` (newest 50) → `videos.list` (snippet, contentDetails, status, liveStreamingDetails).
  - Quota: about 2 units per channel per pass (3 on the first), so about 430 units a day for three channels against the default 10,000.
  - Region restriction, privacy, upload status, live state and duration are all known.
- **Without the key (current):**
  - Each channel's public upload feed: newest 15 entries, 3 GETs per pass.
  - An oEmbed check for only the videos a story actually matches: at most 25 per pass, re-checked every 6 h.
  - oEmbed 200 proves a video is embeddable, not that it plays in a given region, so these videos are `embeddable_region_unverified`. The player's own error report covers the rest (see Availability below).

Storage and operations:
- **`NEWS_KV` keys:**
  - `video:v1:catalog`: 45 days, at most 900 videos. Per video: id, channel, title, description excerpt, publish time, thumbnail metadata, duration/live/privacy when known, discovery method and embed check.
  - `video:v1:links`: a decision for every story.
  - `video:v1:status`.
- **Audit:** `GET /v1/articles/videos` lists every story's decision with its reason and match evidence, plus the channel verification.
- **Manual pass:** `POST /run?video=force` with the admin token.

### Eligibility (`videoTargetOf`)

The game always comes from the article's structured context, never from prose.

Eligible:
- `result` (final game recap) and `performance` (one game): from `context.game`, with final scores.
- `international`: from `context.international`, only when a current WNBA player appeared.

Not eligible: injury updates, transactions, previews, team trends (many games), prop and market stories, news briefs, and retired or external-coverage pages.

### Game resolver (`evaluateVideo` / `resolveGameVideo`)

Games live in two namespaces, `wnba:<game_id>` and `intl:<competition>:<game_id>`, and they never mix: a channel only matches games in its own namespace.

Every check must hold:
- **Channel:** allowlisted, verified and in scope.
- **Teams:** both named (whole-word, accent-insensitive), and no third team named.
- **Title type:** a game highlight package (full game, game or extended highlights). Rejected: press conferences, interviews, mic'd-up clips, podcasts, reactions, live streams, montages, player packages, previews and hashtag clips.
- **Format:** not a Short.
- **Timing:** published between 1 h and 7 days after tip-off.
- **WNBA date:** the title's date equals the game's ET date. No date means no match.
- **International date or round:**
  - either a title date equals the game date,
  - or, for an undated title, it names the same round AND the competition and was published within 72 h.
  - A title naming another competition, year or round is rejected.

Ambiguity is never guessed:
- Two matching videos on one channel, or on two channels of equal priority → `review`, nothing attached.
- One video matching two different games → `review` on both.

Each decision stores the game key, teams, date, round, the checks that passed and the rejected candidates.

### Availability: fail closed

No player is shown for:
- a malformed ID;
- a deleted or private video (oEmbed 400/404, or API privacy);
- embedding disabled (oEmbed 401/403, or `embeddable=false`);
- live or upcoming streams;
- a region block for the US;
- an unchecked video (timeout or network error);
- an embed check older than 24 h. This is re-evaluated at serve time, so a stopped cron removes players instead of leaving stale ones.

The article and its photo media are unaffected. In the browser, if the player reports error 100, 101 or 150 (not found, or embedding refused), the player is removed and the reader sees "This video can't be played here · Watch on YouTube".

### Rendering

Article page:
- A "Game Highlights" section sits after the body's opening section, or after the whole body when it has only one section.
- It shows our own poster: team marks or flags and the final score from the story's context, the video title and the official source.
- Nothing plays automatically, and nothing is requested from YouTube until the reader presses play.
- On play, a `https://www.youtube-nocookie.com/embed/<id>` iframe loads:
  - autoplay is on only because the reader just pressed play;
  - `enablejsapi` is set so the player can report errors;
  - the referrer policy is strict-origin-when-cross-origin.
- The player is 16:9 at every width.

Cards and lists show only a small "▶ Highlights" label: no YouTube posters, no iframes. A story without a verified video renders byte-identically to before.

### Privacy / CSP exception

- **The only CSP change:** `frame-src https://www.youtube-nocookie.com`, in both the Vercel headers and the `wnba-web` SSR Worker.
- **Unchanged:** `default-src`, `script-src`, `img-src` and `connect-src`. Posters are ours, YouTube thumbnails are not loaded, and there is no YouTube JS SDK.
- **Result:** page load makes no third-party request. The privacy-enhanced player and its media hosts load only after the click.

### Editorial rule

Video is enrichment, never evidence. Nothing in a video title, thumbnail or description becomes an article fact. `gate.js` and `reconcile.js` are unchanged.
