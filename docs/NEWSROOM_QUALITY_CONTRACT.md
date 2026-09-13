# Newsroom quality contract

Applies to depth ladder `wnba-depth/1.0.0`, briefs `wnba-briefs/2.0.0`, intelligence `pbe-intelligence/1.1.0`, game-story `wnba-game-story/1.0.0`, international desk `wnba-international-desk/2.0.0` and quality `wnba-quality/1.0.0`.

## 1. One betting-relevance decision

`src/lib/intelligence.js` → `decideIntelligence({ kind, entities, market })`. It is called once, inside `finalize()`, and stored on the article as `intelligence`.

| `market_relevance` | When | May render |
|---|---|---|
| `actionable` | A current WNBA player, team or game is linked **and** a stored market capture is attached | Betting relevance, market evidence, markets touched (only markets in the capture), matchup/line links |
| `contextual` | A current WNBA player, team or game is linked; no capture is attached | Context only ("WNBA context" / "What carries back to the WNBA"). No markets touched, no sportsbook links, no actionable or price language |
| `none` | No current WNBA link | Nothing: no bettor angle, no market module, no labels, no links |

`market_data_status` is one of `attached`, `available`, `unavailable` or `not_applicable`.

These all read the same stored decision (or `intelligenceOf()` for legacy records, which recomputes the same answer from the same facts):
* the article renderer (`intelligenceView`)
* cards (`bettor_snippet` renders for actionable relevance only)
* the publication checks (`intelligenceFailures`)
* share cards

A generator's `markets` wish list is ignored.

**Root cause of the v1 contradiction.** `finalize()` copied three independent generator inputs straight into the page:
* bettor copy;
* a hard-coded `markets: ['player_workload']`;
* a market module that always rendered, with a props-board fallback.

The international desk wrote "nothing here bears on a WNBA line" while the other two modules said the opposite.

## 2. Game stories

`workers/wnba-news/src/game-story.js`.

**Inputs:** the stored game record, linescores, box score, play-by-play (when published), competition schedule and earlier box scores.

**Participation:** read from box-score events. ESPN's FIBA box scores omit minutes, and v1's `min > 0` test reported current WNBA players as absent.

**Derived facts, all deterministic:**
* quarter margins and halftime;
* the best quarter, and the loser's best quarter;
* separators ranked by stated weights (no double counting of steals/turnovers or offensive/total rebounds);
* play-by-play lead changes, ties, largest leads, last trailing moment;
* the decisive stretch: the best net window of at most 10 game minutes, searched after the last moment the winner was not ahead;
* turnovers inside that stretch;
* bench points (from sourced starter flags);
* the tournament path;
* earlier-game averages.

**Sections render only when their facts exist.** The possible sections are: lede, How the game unfolded, The stretch that decided it, Why X won, Who delivered, What Y couldn't overcome, What gold/bronze means / What it means, WNBA connection.

**Depth gate** (`depthFailures`): the newsroom depth ladder (section 7) applied to the game facts. `requiredWords` remains only as the diagnostic word target (base: medal 400, elimination 330, recap 280; + quarters 100, play-by-play 90, schedule path 90, earlier box scores 120; capped at the class minimum). It no longer decides publication: Australia–Italy (632 words against a 640 target) is judged on substance.

## 3. Media

`media-resolve.js` → `internationalMediaFrom(manifestPlayers, article|card)`. Priority:
* **A/B:** an approved Commons photo of a player the article features (ESPN athlete id, editorial order). Never an unrelated player.
* **C:** the deterministic PropBetEdge International scoreboard (public-domain flags, names, score, medal/round, competition).

The same `visual` feeds the article hero, cards, rows, related cards and OG images.

## 4. Temporal provenance

**v1 bug.** The desk set `published_at = scheduled_at + 2.5h` (an estimated game end). The article view printed that as "Source record", so a story published at 16:36Z showed a source time of 17:00Z.

**Fields now:**

| Field | Meaning |
|---|---|
| `provenance.source_event_at` | Tip-off |
| `provenance.source_observed_at` | When the game record was fetched |
| `provenance.generated_at` | Generation cutoff, taken after all inputs are gathered |
| `published_at` | Source clock = observation |
| `first_published_at` | Immutable newsroom origin |
| `revised_at` / `revisions[]` | Revisions |

**Checks** (`provenanceFailures`):
* evidence and observation must be at or before generation (60s skew);
* play-by-play wall clocks after the observation or cutoff are excluded;
* earlier games count only when finished and observed before the cutoff.

The byline shows "Source data as of" only when that time is not later than the displayed version.

## 5. Grammar

`count(n, noun)` handles singular and plural. The prose lint (`reconcile.js` R0) rejects "1 assists" style and "3 assist" style agreement errors for all counted stat nouns.

## 6. Regeneration

`POST /run?backfill=international` regenerates **existing** international stories only:
* same id (hash of the game id), same slug, same `first_published_at`;
* `revisions[]` gains `metadata_correction` (timestamp semantics) and `editorial_upgrade` entries;
* no historical fact changes.

## 7. Depth ladder (`workers/wnba-news/src/depth.js`)

Every story gets a deterministic class from its FACT BLOCK (never its prose), then is scored against its desk's substance contract.

| Class | Guidance | Floor | Pass score | Sections (developed) | When |
|---|---|---|---|---|---|
| Flash | 150–350 | 40 | 0.60 | 1 (0) | Developing event (≤3h, no PropBetEdge record yet, or an international result without a box score) with ≤3 evidence dimensions. Provisional; upgrades at the same id/URL. |
| Brief | 350–650 | 170 | 0.75 | 2 (1) | Legitimate event, limited verified records. External reporting stays Brief until a PropBetEdge record or a second publisher confirms it and ≥5 value dimensions exist. |
| Full | 650–1,100 | 320 | 0.80 | 4 (2) | Default: ≥6 evidence dimensions, or importance ≥2 with ≥4. |
| Deep | 1,000–1,600 | 480 | 0.85 | 5 (3) | Importance 3 (medal game, trade, fresh star injury, CBA/expansion) with ≥6 dimensions. |

*Evidence dimensions:* primary record, corroboration, player season, player recent form, rotation, injury feed, team standing, schedule, box score, play-by-play, history, market, transaction log, observed absence (international: game record, quarters, box score, play-by-play, tournament path, earlier-game form, WNBA crosswalk).

*Publication:* no hard failure, every supported core element met, score ≥ class threshold. Word count is a diagnostic against the range.

*Hard failures:* below the class floor; duplicate paragraphs; repeated sentences; phrase-repetition ratio > 0.10; empty or duplicate sections; Intelligence restating the body; play-by-play language without play-by-play; unsupported characterisation (momentum, "wanted it more", …).

*Contracts:* international (result + star lede, game flow, decisive stretch, statistical explanation, performances, opponent, tournament context, WNBA-connection decision), game (performers, flow, separators, both teams, lead changes, team context, next), injury (what changed, role, minutes, recent form, rotation, team context, schedule, market), transaction (the move, player profile/production, roster context, availability, team context, recent moves, schedule), preview (availability, matchup, form, rest, series, market, counter-case, next), market (evidence, counter-case, game log, next), external report (the development, underlying event, original value, records developed, why it matters, next). All: sections developed, evidence cited.

## 8. External reports (`briefs.js`, wnba-briefs/2.0.0)

* **Another publisher writing an article is not an event.** `underlyingEvent`: the event type must be a development (injury, availability, trade, signing, waiver, roster move, coaching, front office, awards, record, playoff, expansion, CBA, draft, league, lineup) and not every report may be commentary (opinion, speculative, explainer, recycled, promo, community, question, minor honour). Otherwise the item stays external coverage (source wire, player/team pages).
* **Original value:** `originalValue` counts PropBetEdge record dimensions (season production, recent form, rotation role, availability listing, transaction record, team standing, schedule). A story needs ≥1 of them, or a second independent publisher, or to be a developing (≤3h) report about a linked WNBA player/team.
* **Demotion:** a published brief whose source was only coverage is demoted once per brief version (`demoteExternalCoverage`): the card leaves every listing, the item keeps its URL with a "Moved to external coverage" notice and noindex, and a `demoted_to_external_coverage` revision is recorded. Nothing is deleted.

## 9. Intelligence has its own job (pbe-intelligence/1.1.0)

The body reports; the module adds. `additiveCopy` keeps a bettor-copy sentence only when it is not boilerplate, does not restate the headline/deck/body (`src/lib/semantic.js`), and — without an attached market — introduces a figure the article does not state. With no additive summary the module does not render; the reviewed `bettor_angle` stays on the record for the gate.

## 10. Lifecycle and media

* A version goes live at `max(run start, provenance.generated_at)`, so `source_observed_at ≤ generated_at ≤ published/revised`.
* Revision kinds: `data_update`, `editorial_upgrade` (international backfill), `editorial_quality_upgrade` (newer generator, same facts digest), `depth_upgrade` (class rose, e.g. Flash → Full, same URL), `metadata_correction`, `demoted_to_external_coverage`.
* Media for every desk (`newsroomMediaFrom`): approved subject photo (or one per team for a matchup) → team composition → deterministic PropBetEdge story visual (desk + brand). `visualFailures` holds any standalone story with no resolved hero.
* Run status carries `newsroom_health` (live class distribution, per-desk median words/dimensions/sections, upgrades, substance holds, external coverage) and `coverage_decisions`.
