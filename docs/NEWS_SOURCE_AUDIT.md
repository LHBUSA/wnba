# WNBA newsroom — source audit, event model and 7-day coverage audit

Registry `news-sources/2.0.0` · taxonomy `wnba-taxonomy/1.0.0` · events `wnba-events/1.0.0` · fetch `wnba-news-fetch/1.0.0`.
Probed 2026-09-13 with the Worker's own user agent (`PropBetEdge-WNBA-News/1.0 (+https://wnba.propbetedge.ai/news)`); no disguised UA, no login, no paywall, no private credentials, no article bodies.

## 1. Rules

* **Stored per item:** headline, canonical link (tracking stripped), publisher categories/tags, publish/update timestamps, and — only where the publisher allows automated reuse — its own short summary. Nothing else.
* **Never stored:** article bodies. Several official payloads embed full bodies (`content`, `blocksV2`); the parser reads a field whitelist, so bodies never leave the parser (covered by a test).
* **`summary_policy: none`** (headline + link only):
  * the official team sites, whose excerpts are usually truncated body text;
  * publishers whose robots rules opt out of automated reuse: The Seattle Times, the New York Post and the Los Angeles Times.
* **Rejected:** sources needing login, paywall bypass or private credentials; HTML scraping where a better source exists; and aggregators that republish other publishers' work.
* **Terms-of-use note for the owner:** WNBA.com's terms restrict commercial reuse of site materials "without the written permission of the Operator". WNBA.com was already a production source before this release. Official team items are ingested as headline + link + timestamps only. A legal read on displaying official headlines commercially is recommended.

## 2. Source registry (ingested)

| source_id | Publisher | Format | Scope | Timestamps | Conditional | Summary | Priority |
|---|---|---|---|---|---|---|---|
| wnba_com | WNBA.com | official page data (`__NEXT_DATA__`) | league | exact UTC | ETag sent, ignored | publisher excerpt | 1 |
| wnba_com_press | WNBA.com press releases | official page data | league | exact UTC | none | publisher excerpt | 1 |
| team_aces … team_wings (14) | the 14 team sites `<team>.wnba.com/news` | official page data (App Router flight payload) | own team | exact UTC | none (deduped by post id) | none | 1 |
| team_mercury | Phoenix Mercury | Google News sitemap (list renders client-side) | own team | **date only** | If-Modified-Since → 304 | none | 1 |
| espn_wnba | ESPN | provider JSON | league filter | exact UTC | none | publisher description | 2 |
| nbc_sports_wnba | NBC Sports | Atom | WNBA section | exact (published + updated) | none | publisher summary | 2 |
| cbs_wnba | CBS Sports | RSS | mixed (filtered) | exact | none | publisher description | 3 |
| jws_wnba | Just Women's Sports | RSS (WNBA category) | WNBA section | exact | ETag + LM → 304 | short description | 3 |
| the_ix | The IX (The Next) | RSS (WNBA category) | WNBA section | exact | ETag/LM sent | description | 3 |
| seattle_times_storm | The Seattle Times | RSS | Storm beat | exact | LM → 304 | none | 3 |
| lvrj_aces | Las Vegas Review-Journal | RSS | Aces beat (AP-tagged items skipped) | exact | none | description | 3 |
| nypost_liberty | New York Post | RSS | Liberty beat (filtered) | exact | 304 | none | 3 |
| latimes_sparks | Los Angeles Times | RSS | Sparks beat | exact | none | none | 3 |
| high_post_hoops | High Post Hoops | RSS | WNBA | exact | LM → 304 | short description | 4 |
| swish_appeal | Swish Appeal | RSS (`index.xml`; `current.xml` now redirects) | mixed (filtered) | exact | none | summary | 4 |
| winsidr | Winsidr | RSS | WNBA | exact | 304 | short description | 4 |
| her_hoop_stats | Her Hoop Stats | RSS | mixed (filtered) | exact | none | subtitle | 4 |

Every entry also records its reliability, rights, attribution, failure behaviour and expected cadence (`workers/wnba-news/src/sources.js`).

**Failure behaviour (all sources):**
* Each fetch is isolated. The source is marked FAIL in health, its last-good items stay, and other sources are unaffected.
* Date-only items (the Mercury sitemap) can corroborate an event but never create a story.

**Changes to v1 sources:**
* The Next's root feed now redirects to a multi-sport feed (PWHL, softball), so the IX WNBA category feed is used instead.
* Swish Appeal's `current.xml` now redirects to `index.xml`.

## 3. Audited and not ingested

| Candidate | Decision | Reason |
|---|---|---|
| The Athletic | rejected | Paywalled; NYT RSS terms prohibit commercial use without permission |
| Associated Press | rejected | No public feed; robots disallow RSS; licence required |
| WNBA.com transactions JSON (`cdn.wnba.com`) | rejected | Served only to browser user agents; would need a disguised UA |
| WNBPA | rejected | No news section or feed |
| USA Basketball | deferred | No feed, article sitemap only; international results come from the structured international layer |
| Yahoo Sports | audit only | Republishes partner articles in full |
| ClutchPoints | audit only | High-volume aggregation/opinion; robots opt out of automated reuse |
| EssentiallySports | audit only | Gossip; republished verbatim by aggregators |
| Yardbarker | rejected | Pure republication |
| FOX Sports | rejected | Feed needs an embedded partner key; stale, mixed sport |
| Sports Illustrated | rejected | No working WNBA feed |
| Hartford Courant, Pioneer Press, Chicago Tribune | rejected | 403 for an honest UA |
| Star Tribune, Chicago Sun-Times, Dallas Morning News, AJC, SF Chronicle, Washington Post, TSN, Sporting News | rejected | No public WNBA feed found |
| Toronto Star | rejected | Feed path disallowed by robots |

## 4. Event taxonomy (one field, several desks)

`event_type → lane (desk)`:

* **Injuries:** injury, availability
* **Roster Moves:** trade, signing, waiver, roster_move
* **League:** coaching, front_office, awards, playoff, expansion, cba, draft, league, business
* **International:** international
* **Games:** record, lineup, preview, result, performance
* **Market:** market
* **Other:** news

The legacy `story_type` is derived from `event_type`, so v1 consumers keep working. The UI stays small: Latest, Injuries, Roster Moves, League, International, a team selector, and More desks (News Briefs, Previews, Performances, Team Trends, Prop Watch, Market Watch).

Two v1 misreads are fixed:
* "WNBA releases playoff schedule" was typed as a player release; it is now `playoff`.
* A passing word in a feature's summary ("draft") no longer sets the type. The summary can only type a player-level injury or roster event, and only when a player is linked.

## 5. Materiality gate (deterministic)

The score is: base by event type, plus source tier (official +1.5, priority 2 +0.5, fan/analysis −0.5), plus a linked player or team (+0.5, but the site's own team earns nothing), minus penalties:

| Penalty | Amount |
|---|---|
| Opinion or listicle | −3 |
| Explainer or guide | −3 |
| Promo, tickets, media | −3 |
| Recycled or retrospective | −4 (vetoes a new story) |
| Speculative framing | −1.5 |
| Question headline | −1.5 |
| Community feature | −2 |

At event level, each additional independent publisher adds +0.5 (up to +1). An event is material at ≥ 3.5 and needs at least one exact publisher timestamp.

**Material examples (from this week):**

| Item | Score |
|---|---|
| Storm (official) "Ezi Magbegor Injury Update" | 5.0 |
| Lynx (official) "Minnesota Lynx Sign Guard Aari McDonald" | 5.0 |
| Magbegor event, 5 publishers | 6.0 |
| Playoff schedule, 3 publishers | 4.5 |

**Not material (from this week):**

| Item | Score |
|---|---|
| "Why Kalani Brown signing … feels like a homecoming" | 2.0 |
| "How do the WNBA playoffs work? Dates, format and more" | −1 |
| "Golden State Valkyries Announce 2026 WNBA Playoffs Ticket Information" | 1.5 |
| "Seattle Storm Names 2026 Believe in Women Honorees" | −2 |
| "Muralist selected for the new Indiana Fever Sports Performance Center" | 1.5 |
| Sky game-day highlight galleries | 0 |
| "Rapid Reactions: WNBA Top 30" | −0.5 |

## 6. Event identity (persisted, fact-based)

Stored in KV at `news:v1:events`, and seeded from the v1 clusters on first run so existing event ids and brief ids are kept. **An event id is fixed when the event is first seen.** Reports join events by these rules, in order:

1. **Fact key.** Roster lane + player set; injury/availability + player set; coaching/front office + team; awards + player set. Matches within 72h of the event's latest report, and the same publisher is allowed.
2. **Shared player.** A shared linked player, a compatible lane and headline Jaccard ≥ 0.2, from a different publisher, within 48h.
3. **Headline similarity.** Headline Jaccard ≥ 0.55. For league events with no player: the same specific type and stemmed Jaccard ≥ 0.4.

A different fact (a new status, a different player, a replacement signing after an injury) is a new event.

v1 recomputed clusters every run and named each one after its earliest member. A newly added source with an earlier report therefore renamed the cluster and turned its brief into a "new" story. That failure is reproduced in `tests/news-coverage.test.mjs`.

**Freshness:**
* A new story requires the event's *earliest* report to be within 36h. A late-discovered old report, or a late corroboration, cannot make an old event fresh.
* An already-published brief can still be revised.
* Cross-generator: when a brief and the structured ESPN injury or transaction story cover the same player event, the brief collapses onto the structured story. That story inherits the brief's earlier `first_published_at`.

## 7. Speed, scheduling, health

**Speed and scheduling:**
* Cloudflare Cron runs every 5 minutes, up from every 10.
* A new material roster, injury or league event from an official source, or a corroborated high-materiality event, runs the article pass immediately. Otherwise the pass runs every 10 minutes.
* wnba-api's transactions cache TTL drops from 900s to 300s.
* A 4-minute lease prevents overlapping passes.

**Conditional requests:**
* The stored ETag / Last-Modified are replayed; a 304 counts as a successful empty poll.
* Validators are tied to the parser version, so a parser change re-reads each source once.
* The daily Mercury sitemap is polled at most hourly.

**Health:**
* `GET /v1/news/sources` reports, per source: last attempt and last success; HTTP status; fetched, accepted and rejected counts; new items, new events and duplicates; parse errors; timestamp quality; newest item; staleness (CURRENT / QUIET / STALE_FETCH); consecutive failures; and 24-hour totals.
* The same data is rendered server-side on `/sources`.

## 8. 7-day retrospective coverage audit (2026-09-06 00:00Z → 2026-09-13 16:23Z)

**Method:**
* **v1 = what production actually captured.** The live `/v1/news` store (6 sources) over the window.
* **v2 = every registry source**, fetched with the Worker's own fetch/parse/normalize/taxonomy/event code from this machine, with the production roster dictionary.
* **Limit:** source listing depth. Team pages show their latest 10 posts, feeds their latest N, so v2 is a lower bound for high-volume feeds.
* **Reproduce:** `scratchpad/coverage-audit.mjs`.

| | v1 (production) | v2 (new registry) |
|---|---|---|
| Sources polled | 6 | 30 (30 OK) |
| WNBA items accepted in window | 19 | 61 |
| Distinct events | 18 | 52 (61 reports merged into 52 events) |
| Material events | — (v1 had no materiality score) | 4 |
| Official team items in window | 0 (not polled) | 26 posts from 8 teams; 18 accepted into the WNBA wire (the rest are World Cup recaps, routed to the international lane) |

v2 events by lane: other 26, league 11, games 6, international 4, injuries 3, roster 2.

### What v1 missed and v2 captures

1. **Lynx sign guard Aari McDonald** (official, 2026-09-07 14:51Z; also waived Eliška Joklová).
   * v1 has no wire item, and **ESPN's transactions log never recorded the move**: the log's newest entries are 09-12 Valkyries and 08-29 Aces/Sparks. v1 therefore produced no story at all.
   * v2: material signing (5.0) from `team_lynx`. A News Brief would file to Roster Moves and the Lynx team news page.
2. **Katie Lou Samuelson out for the season after knee surgery** (Storm official, 2026-09-11 18:02Z; Seattle Times 21:15Z).
   * v1's only coverage was the structured injury story from ESPN's injury feed, first published 18:49Z, 47 minutes after the team's announcement. Its wire had no item.
   * v2: material injury event (5.5, 2 publishers). By design (not yet observed in production), the breaking path would run the article pass on the first five-minute tick after 18:02Z. When ESPN's feed story follows, the brief collapses onto it and the canonical story keeps the earlier origin.

### Events both captured — what changed

3. **Ezi Magbegor ACL tear.**
   * v1 captured ESPN (19:33Z) and CBS (19:58Z).
   * v2 folds 5 reports — Seattle Times 18:47Z, ESPN, CBS, Storm official 21:23Z, JWS 09-11 — into **one** event (6.0). The first report is **46 minutes earlier** than v1's, and the official team confirmation is attached to the same story, not a second one.
4. **2026 playoff schedule.**
   * v1 captured ESPN only.
   * v2 merges ESPN, NBC Sports and JWS into one playoff event (4.5).

### Noise v2 filters that v1 passed through

* **v1 accepted an off-topic item into the wire:** ESPN "Arena for 76ers, Flyers to open in 2030". v2 types it as business, scores it 2.0, and it cannot become a story.
* **v1 typed schedule stories by keyword:** "WNBA playoffs schedule 2026: Dates released" is stored in production as `transaction`.
* **Official team volume is mostly not news.** Of the 18 team items accepted this week, 3 are material. The rest are World Cup recaps, galleries, ticket information and community features, which the gate keeps out of the newsroom while still listing them, attributed, on the team news page.

## 9. Open items

* The team-site canaries ran from a residential IP; `/sources` health shows the first Cloudflare-egress results after deploy.
* Supabase is not bound. The registry, health and items live in KV, as all newsroom state did before this release.
