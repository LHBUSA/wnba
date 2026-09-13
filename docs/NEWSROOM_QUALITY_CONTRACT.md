# Newsroom quality contract

Applies to intelligence `pbe-intelligence/1.0.0`, game-story `wnba-game-story/1.0.0`, international desk `wnba-international-desk/2.0.0` and quality `wnba-quality/1.0.0`.

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

**Depth gate** (`depthFailures`):
* **Story classes:** medal, elimination, recap and breaking.
* **Required words scale with the data present:**
  * base: medal 400, elimination 330, recap 280;
  * add: quarters +100, play-by-play +90, schedule path +90, earlier box scores +120;
  * cap: medal 800, elimination 650, recap 550.
* **Also required:** each class's substance keys, no duplicate sections or paragraphs.
* **Breaking:** a story with no box score needs 60 words.

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
