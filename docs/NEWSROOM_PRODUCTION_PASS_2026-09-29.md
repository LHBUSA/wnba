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

**Status: enabled** (owner set the secret) — see §5 for the canary and live results.

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

**ESPN headshots — owner-approved (standing decision, recorded 2026-09-29 in docs/PLAYER_PHOTOS.md).** Story media now
resolves licensed photo → the subject's own ESPN headshot (exact id, name-checked, team from the roster ledger, hotlinked,
never in a share card) → team art. Live effect: +4 subject photos on the listing (incl. Kelsey Mitchell and Dominique
Malonga); the 13 remaining team-art cards are team-subject stories. 0 wrong-subject.

## 5. Editorial desk — enabled, canary, live cron

`OPENAI_API_KEY` set on wnba-news by the owner; `/v1/newsroom/health` reports `editorial.configured: true`,
provider `openai`, model `gpt-5.6-sol`, `wnba-editorial/1.0.0`.

### 5.1 Six-story canary (dry run over a KV overlay — nothing published; `POST /run?editorial=canary&ids=…`)

| Desk | Deterministic headline | Editorial headline | Words | Result |
|---|---|---|---|---|
| Playoff preview | Lynx at Liberty, Game 2: Lynx favored by 3.5, with the season edge stronger than recent form | Liberty face favored Lynx with a first-round closeout at stake | 554 → 649 | applied (1 attempt); 43/44 sentences rewritten |
| Playoff result | The Golden State Valkyries beat the Dallas Wings in Game 1, 104–80 | Golden State Valkyries move one win from advancing after beating Dallas Wings | 322 → 376 | applied |
| Injury | Caitlin Clark listed day-to-day before Game 2 against the Aces | Caitlin Clark listed day-to-day as Fever face elimination against Aces | 501 → 566 | applied |
| Player-led result | A'ja Wilson’s 38 points lead the Aces past the Fever in Game 1, 102–85 | A'ja Wilson scores 38 as Aces beat Fever in Game 1 | 372 → 444 | applied (2 attempts) |
| Award brief | Caitlin Clark earns All-WNBA honors | — | 225 | **rejected → deterministic**: model language (“projection”), unsupported superlative (“largest”) |
| Transaction | The Mercury release F Saylor Poffenbarger and sign G Shay Ciezki… | — | 319 | **rejected → deterministic**: sportsbook language (“covers”) without a market; a height (6' 2") read as a quote — false positive, fixed |

Section headings before → after (preview): Game outlook · Availability · How they match up · The line · Before tip →
New York’s closeout chance · Four players listed out · Season strength meets recent form · Spread moves toward
Minnesota · Props and line movement. Injury: The latest · Who picks up the minutes · Team context · The line ·
Next up → Clark’s status before Game 2 · A major role in the rotation · Indiana faces elimination · Price set after
the update · Status will shape the rotation.

Excerpt (injury, rewrite): “Clark has played 41 games this season, averaging 22.1 points, 4 rebounds and 8.2 assists
in 30.9 minutes… The Fever are 25-16 in the 41 games she has played and 3-0 in the 3 she has not. Those splits
include different opponents, dates and lineup combinations, so they describe what happened rather than isolate her
impact or project Game 2.”

Against the UFC standard: the rewrite removes the WNBA-specific weaknesses (one heading set per desk; memo phrasing;
flat transitions) and leads with stakes — the UFC desk's strength — without its habits (“no bet yet” closer,
“<Publisher> reported…” second sentence). Median length stays well under UFC's 926 words because the desk may not add
evidence; depth comes from the fact packet, not the model.

**Known limit (documented, not hidden):** the number gate matches VALUES, not meanings. “Four players listed out”
(2 + 2) passed because 4 appears elsewhere in the draft. The count was true; the rule the prompt states (no
arithmetic) is enforced by instruction, not by the gate.

**Fallback verified in production:** canary with `model=gpt-invalid-model-canary` → provider 404 on both stories,
both published deterministic; the recorded error carries no key.

### 5.2 Live cron — issues found and fixed

1. **Padding.** The Olivia Miles ROY brief (held at 243/300 words) was published after the desk rewrote it to 408
   words by restating facts. Fixed: the desk runs only on drafts that pass every gate on their own
   (`draft_held`, no call); length ceiling 1.4× the draft. The story is **withdrawn** (corrections 1.1.0, URL kept,
   reason on the page). The owner's rule stands: hold rather than pad.
2. **Revision churn** (same stories revised every 10 min): the draft digest hashed observation clocks; a deferred
   story replaced its published rewrite with the draft; injury drafts (new id per feed update) never found their
   stored rewrite. Fixed: canonical facts digest, kept-published rewrite on deferral, predecessor lookup.
3. **Lease** raised to 9 minutes (a pass with desk calls runs ~4 min).
4. **Re-key hid charts**: a pass that only added visuals was re-keyed without a write; charts are now in the
   lifecycle change key.

Convergence after the fixes (cadence passes): 15:46Z cached 6 / deferred 11 → backfill 15:53Z cached 11 → 16:06Z **cached 14 / deferred 2 / 0 new stories**, 5 writes = first-time rewrites of the remaining queue; `no_stored_item` misses 5 → 0.

## 6. Data storytelling — frozen contract visuals in every desk (`wnba-articles/1.7.0`)

ONE visual system: ordinary newsroom stories now carry `article.visuals` on the same contract as commissioned
features (`wnba-visuals/1.2.0`, renderer `pbe-visual/1.2.0`, which still draws 1.1.0 payloads). DATA → SPEC
(`newsroom-visuals.js`) → VALIDATION (`visuals.js`) → RENDERER (`src/views/visuals.js`). The model never emits a
chart; a rewrite keeps chart placement. New types: `grouped_bars`, `diverging_bars`, `game_strip`, `stat_compare`
(units, validation incl. derived margin = plotted arithmetic, values_hash, provenance, data table, aria read-out,
tests, mobile QA). `requirement: optional|supporting|essential` (an essential failure holds the story). Legacy
render-time dashboards draw only for stories published before 1.7.0.

| Desk | Visuals |
|---|---|
| Result / performance | quarter scoring + margin · 3–5 team separators by normalised gap · player vs last-10 / season (regular season only) · WinBA context with its board date |
| Preview | matchup dashboard (net differential + strongest contrasts) · last-five form strips |
| Injury | role (season / last 10 / recent) · current rotation minutes (“not a prediction”) · with/without record (≥3 games absent, “descriptive, not causal”) |
| Transaction | player profile · where her minutes would rank (two windows, labelled) |
| Trend | results strip · result vs line (totals in neutral under/over colours) · drivers (“largest descriptive shift”) |
| Brief | season line (player briefs) |
| International | quarter flow · WNBA player vs her earlier games in the tournament |

### Coverage, newest listed stories (contract visuals)

| Desk | Before (12:36Z) | After |
|---|---|---|
| Results / performances | 0/19 (legacy scoreboard only) | **19/19** (69 charts) |
| Previews | 0/4 (legacy 4-row snapshot) | **4/4** |
| Injuries | 0/26 (legacy rotation bar) | **7/8** |
| Trends | 0/4 (legacy) | **4/4** |
| Transactions | 0/3 | **2/3** |
| International | 0/2 | **2/2** |
| Briefs | 0/5 | 2/6 |
| Features (commissioned + WinBA) | 4/8 | 4/8 (WinBA editions render their own frozen leaderboard) |

Production canary (real pages, 390 + 1440): result, performance, preview, injury, transaction, trend, brief,
international, commissioned feature — every chart in the server HTML, hash-verified, no overflow, no page errors.
Charts are close to the claim they explain (e.g. “Where the game separated” under “How it happened”), and the
Dream–Mystics separators show at a glance that Atlanta won Game 1 despite losing the glass 31–50, on a 7–23
turnover gap. Local 7-width figure QA (every figure, tables opened): 0 overflow at 320–1440.

## 7. Deployments

| Worker | Version | Rollback |
|---|---|---|
| wnba-news | `94fd6b0d` (main `523f280`) | `d87646c5` (fa696a9) + KV snapshots `D:\Workers\wnba-rollback\20260929-playoff-desk\`, `…\20260929-visuals\` |
| wnba-web | `10fd73d4` (523f280) | `921c3b2c` |
| Vercel | auto from main | previous main deployment |

Tests: 880/880; guard-truth PASS; source-brand PASS.

## 8. Final acceptance

- Editorial desk configured: YES (health). Six-story canary: 4 applied, 2 correctly rejected, 0 unsupported facts
  published. Deterministic fallback verified (invalid model). Real cron rewrites published: 14 listed stories.
- Next news cycle: no false award/transaction stories; late coverage never minted; 0 wrong-subject photos; 0
  card/article identity drift; correction (Lynx) and withdrawal (Miles) pages intact.
- Live regression scan (54 listed): 0 of “0-0”, “1 assists”, “null (undefined)”, bench-tie “outscored”; three
  known flags: Sparks coaching change (true — the scan pattern), Alysha Clark “started none” (awkward, not false,
  older copy), June WinBA Index “a 8.1-point” (WinBA lane, frozen — owner call).
- 7-width browser QA after the desk went live (17:0xZ, production): **105 page loads — 15 routes × 320/360/390/430/768/
  1024/1440 — 0 overflow, 0 broken images, 0 page errors, 0 console errors.** Routes: homepage, /news, result,
  performance, preview, injury, transaction, trend, brief, international, commissioned feature, the Lynx correction
  and Miles withdrawal pages, a team page, a player page. (The harness also reports its built-in WNBACast replay check
  `shots_match_api: false` for game 401857189 — outside the newsroom, not touched.)
- Revisions after convergence are data-driven: the 17:01Z odds capture revised previews/injuries (e.g. the Fever
  line moved to 1) and results whose “Next up” quotes the next line; no new story was minted by it.

**WNBA newsroom production pass: COMPLETE (2026-09-29).**

## 9. Open (owner action)
1. June WinBA Index “a 8.1-point” — WinBA editions are frozen; correcting it is an owner decision.
2. Props desk: held correctly (104 words, no game log); needs a real generator pass.
3. Market-move visuals: not built — no market-move story has published (captures too sparse to chart honestly).
