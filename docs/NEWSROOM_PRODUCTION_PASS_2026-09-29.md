# WNBA newsroom production pass — 2026-09-29

Owner brief: bring the WNBA newsroom to the PropBetEdge / UFC standard (article quality, photos, cadence) without
fabricating, loosening grounding, or breaking history. This file is the evidence record: the baseline measured
BEFORE any change, root causes, what shipped, and what is still open.

## 1. Baseline (production, 2026-09-29 12:36Z, before any change)

| Item | Value |
|---|---|
| main | `fa696a9` |
| wnba-news | `d87646c5` (cron `*/5`; article pass every ~10 min via `ARTICLE_RUN_MIN_GAP_MS`; breaking path on new material official events) |
| wnba-web | `921c3b2c` |
| ARTICLE_VERSION | `wnba-articles/1.5.0` |
| Last source poll / article pass | 12:35:06Z / 12:35:11Z (cadence healthy: 28/29 sources OK, `team_fire` parse heuristic) |
| Catalog | 210 indexed: 118 listed, 42 retired, 27 superseded, 20 duplicate, 3 external coverage |
| Listed by kind | injury 49, performance 17, result 16, preview 8, transaction 8, brief 5, trend 5, commissioned 4, winba_index 4, international 2 |
| New stories (first published) | 6h **0** · 12h **0** · 24h **1** · 48h 7 · 7d 52; revisions 24h 7 · 7d 51 |
| Newest story | 22h old — and it was false (see §2.1) |
| Every article pass | 39 produced, **~20 held**, 19 unchanged, 0 new |
| Median words (listed) | injury 439, preview 501, performance 364, result 334, transaction 317, trend 322, brief 158 |
| Listed media | subject photo 76 (64%), team composition 42 (36%), brand 0 |

### Why it felt stale — every issue classified

| # | Finding | Class |
|---|---|---|
| 1 | Current material news generated every pass but **held**: Caitlin Clark + Aliyah Boston day-to-day before an elimination Game 2 (depth floor), Valkyries' 104–80 playoff Game 1 (no lede), Clark All-WNBA and Olivia Miles ROY briefs (thin, "enters the conversation"), Olairi Kosu / Alanna Smith (prose lint: "1 assists", "played 0 minutes"), performances ("a 18", "a 8"), props ("null (undefined)") | C generator |
| 2 | "Minnesota Lynx make coaching change" **live and false**: ESPN's "Reeve named WNBA Coach of **Year**" missed the awards rule (it required "of the year") and fell to the coaching rule | B eligibility / C |
| 3 | **Every** result said "After the result the X were **0-0** and the Y 0-0": the schedule's `season.type` is now null, so the regular-season id set was empty | A source-shape / C |
| 4 | No story knew it was the playoffs: previews never said Game 2 or the series score; injury stories said "No. 3 seed in the East" with an elimination game tonight | C |
| 5 | Game 2 previews first published **Sep 25**, before Game 1 (median preview published 59h before tip); Top Story pools only 24–72h origins and decays 2/h → tonight's playoff previews could never lead and sat deep in Latest | F curation / C |
| 6 | "If necessary" Game 3 previews listed for games that may never be played | E lifecycle |
| 7 | Stories released after days on hold got `first_published_at = now` (Sep 20–24 events would enter Latest as new) | E lifecycle |
| 8 | Forced/manual passes bypassed the cron lease → concurrent full-index writes lost updates (cards kept old headlines while items had new ones) | E lifecycle |
| 9 | Injury/trend stories kept flowing for eliminated teams (Mercury, Tempo, Storm) | B eligibility |
| 10 | Stale transaction briefs: a Game 1 recap mentioning a month-old signing became "Atlanta Dream sign DeWanna Bonner" | B eligibility |
| 11 | Template headlines/headings: "injuries, recent form and the matchup" (4 of newest 20), "uneven recent stretch", "the roster the move inherits"; one heading set per desk ("The line" 12/20, "Game outlook"/"Availability"/"How they match up"/"Before tip" 8/20) | C (editorial desk scope) |
| 12 | Cadence itself: ingest 5 min, article pass 10 min, published stories land fast (median event→publish: injury 0.2h, performance 0.3h, brief 0.1h) | not a cause |
| 13 | Genuinely quiet windows (off days between Game 1 and Game 2) | H |

**Answer:** the newsroom did not feel stale because the schedule was slow. It felt stale because the gates were
correctly holding output that the generator had broken (1, 3), because current playoff stories did not know they
were playoff stories (4), because timing and lifecycle rules let old material look new and new material look old
(5–8), and because the one fresh story was false (2).

## 2. WNBA vs UFC (newest 20 each, 2026-09-29)

| Measure | WNBA (baseline) | UFC |
|---|---|---|
| Median words | 409 | 926 |
| Median sections | 5 (fixed per desk) | 4 (descriptive, near-unique) |
| Headline habit | template per desk ("X at Y: injuries, recent form and the matchup") | 14/20 "Fighter's …"; 11/20 betting words; 6/20 "X, not Y" |
| Repeated headings | "The line" 12/20; four preview headings 8/20 | closing section ≈ always "no bet yet" |
| Stories / 24h | 1 | ≈13 |
| Subject photo | 75% of newest 20 (64% of listed) | 35% |
| Writer | deterministic only | OpenAI desk (`ufc-news-enrich-v1`, gpt-5.6-sol) on 19/20 |

WNBA already beats UFC on photo identity. The gap is the prose layer and the held pipeline, not the data.
UFC habits NOT copied: the "no bet yet" closer, "<Publisher> reported…" second sentences, fighter-possessive
headlines.

## 3. What shipped

### 3.1 Accuracy + playoff desk — `wnba-articles/1.6.0`, taxonomy 1.3.0, brief-story 1.2.0
- Awards match with or without "the"; taxonomy bump re-types stored items. Award briefs only when **won**
  ("received", "earned", "nods"…), never "enters the conversation"; a coach award is the team's honor, never
  "The player earns…" or a coaching change. The false Lynx brief is retired with a public correction
  (`corrections.js`, sticky, `integrity_correction` revision, URL and first-publication kept).
- Regular-season ids from `/v1/season` windows + playoff notes (`playoff-context.js`). Three listed results still
  carrying "0-0" were rebuilt in place (`KNOWN_DEFECTS`, same id/URL/first publication).
- `playoff-context.js`: series state before/after any game from the series' own finals; closeout / elimination /
  decider stakes; if-necessary games previewed only when forced; eliminated teams' injuries and trends are not news.
  Previews: "Lynx at Liberty, Game 2: …", series lede. Results: "…in Game 1", series line, seeds, next series game.
  Injuries: "Caitlin Clark listed day-to-day before Game 2 against the Aces", her postseason line kept apart from
  regular-season averages, the last series game's team box. Day-to-day never written as a certain absence.
- Comparators and grammar: `benchComparison` (ties are "even"), counted-noun agreement, a/an before margins,
  "Next up" once per game, props never print a missing side.
- Stale transaction briefs declined (move logged > 7 days before the report).

### 3.2 Lifecycle + curation
- Late coverage (`legacy.js lateCoverage`): a result first published > 48h after tip or a transaction > 72h after
  its log date is held (never minted) or retired from listings at its URL. Legacy policy 1.3.0 re-reviewed the
  catalog: **49 older (Sep 19–22) stories moved to `legacy_acceptable`** because their review stamps predated the
  current storycraft checks — unlisted, URLs kept. Listed count 118 → 71.
- Manual `/run` takes the cron lease (409 busy); `mergeArticles` heals card display drift as a repair, never a
  revision.
- Previews written only inside 48h of tip; Top Story (`homepage-lead` 1.1.0) reads a preview's clock as
  max(origin, tip − 36h) — never a revision clock.

### 3.3 Editorial desk — `wnba-editorial/1.0.0` (`editorial-desk.js`)
FACT BLOCK → DETERMINISTIC DRAFT → OPENAI DESK → REWRITE GATE → EXISTING GATES → PUBLISH.
Responses API, `gpt-5.6-sol`, `store:false`, strict JSON schema, no tools; the packet is the fact block, the draft,
cited records, publisher headlines and permitted names. The rewrite may change headline, deck, section titles and
paragraphs only (section keys enumerated in the schema). The rewrite gate is stricter than the draft's own: every
number, date, clock time and proper name must already be in the draft; no new quotes, market or model language,
predictions or availability claims, superlatives or added causality; no memo headings, markdown, repetition or
padding; then gate.js + reconcile + identity + quality/storycraft + depth, and no depth element the draft met may
regress. One corrective retry, then fall back to the deterministic draft. Cached by draft digest (no churn, no
repeat cost). Bounded: 8 calls / 150s / concurrency 3 per pass. `last_run.editorial` + `item.editorial` record
provider, model, version, status, failures, usage.

**Status: deployed, inert** — `OPENAI_API_KEY` is not set on `wnba-news` (no key exists in the local secret store;
UFC's is a Worker secret and cannot be read back). Canary and backlog upgrade are blocked on it (§6).

### 3.4 Observability — `GET /v1/newsroom/health`
Source poll + health + newest item, events, last article pass (candidates by desk, generated, written, held,
grouped hold reasons, novelty, editorial stats), new stories 6h–7d, revisions, listed media coverage, freshness by
desk, and `why_nothing_new` in plain language.

## 4. Photos

| Roster (209 active) | Count |
|---|---|
| Licensed newsroom derivative (Commons, reviewed) | 166 (79.4%) |
| ESPN headshot available (external editorial hotlink) | 192 |
| ESPN only, no licensed photo | 34 |
| Nothing (initials) | 9 |

Newest listed stories: 70.4% subject photo, 29.6% team composition, 0% brand fallback, **0 wrong-subject** (the
resolver only ever resolves the story's own subject; tested). Of the team-composition cards at baseline, 25 are
team-subject stories where team art is correct, 17 are players without a licensed photo — 12 of whom have an ESPN
headshot.

**Rights decision (not changed):** `docs/PLAYER_PHOTOS.md` and `docs/BRAND.md` say the newsroom and generated cards
use licensed Commons only; hotlinked ESPN/WNBA headshots are never re-published there. The existing policy does
NOT permit ESPN headshots as article imagery, so the newsroom resolver was not extended. `cdn.wnba.com` stays off.
High-traffic players without a licensed photo: Kelsey Mitchell (rejected at review), Dominique Malonga (rejected).

## 5. Deployments

| Worker | Version | Rollback |
|---|---|---|
| wnba-news | `410d1a82` (main `55ea703`) — chain `de60a771` → `219c3822` → `218f7979` → `1b4617fc` → `405254e5` → `410d1a82` | `d87646c5` (fa696a9) + KV snapshot `D:\Workers\wnba-rollback\20260929-playoff-desk\` |
| wnba-web | `c3813cd3` (f8aa528) | `921c3b2c` |
| Vercel | auto from main pushes (news-corrections semver quarantine) | previous main deployment |

Tests: 868/868; guard-truth PASS; source-brand PASS.

## 6. Open (owner action)
1. `wrangler secret put OPENAI_API_KEY --name wnba-news` → then the six-story canary (injury, transaction,
   result, performance-led result, playoff preview, team trend) with deterministic-vs-editorial diffs, then the
   bounded backlog upgrade of listed current stories (`editorial_quality_upgrade`, same id/slug/first publication).
2. Rights decision if ESPN headshots should become newsroom identification imagery (34 roster players, 12 listed
   stories would gain a subject photo). Not taken here.
3. Photo review for Kelsey Mitchell and Dominique Malonga.
4. Props desk: every prop story is below the Brief floor (104 words, no game log) — held correctly; needs a real
   generator pass, not a looser gate.
