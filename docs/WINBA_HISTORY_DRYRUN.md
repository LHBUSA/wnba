# The WinBA Index — historical publication readiness

**Status: NOTHING PUBLISHED.** June, July and August are not published. This is
the readiness verdict requested before any historical edition goes live.

Authoritative source: `GET /v1/winba/history-dryrun` on `wnba-ingest`
(read-only, admin-token), run 2026-09-21T23:07:10.613Z. This replaces the earlier
current-roster-only reconstruction entirely — those numbers (June 151, July 164,
August 179) were a lower bound produced from `/v1/players/:id/gamelog` and are
superseded. **Do not cite them.**

## The released-player gap is closed

The previous document warned that 10 players released mid-season were invisible,
one of them inside the frozen top 25. The archive-complete run reads
`archive:v1:index` + `game:v1:final:*`, which contain every box line, and the
warning is now demonstrably resolved:

* the September reconstruction returns **193 qualified**, matching the live board exactly (the roster-only run returned 183);
* **Chennedy Carter**, who is on no current roster, appears in the frozen top 25 for June (#14), July (#23), August (#21) and September (#24), with her historical team;
* across all five periods, **zero unresolved identities**.

Archive coverage: 336 indexed finals, 336 loaded, 318 regular-season finals,
**318 with a box score, 0 missing**. First tip 2026-05-08T23:30:00.000Z, last 2026-09-21T01:00:00.000Z.

## Qualification language — one real error, now corrected

`workers/shared/winba.js` defines qualification as a **disjunction**:

```js
const qualified = p.games >= WINBA_QUALIFICATION.min_games || p.minutes >= WINBA_QUALIFICATION.min_minutes;
// min_games 10, min_minutes 250
```

At least **10 appearances OR 250 minutes** — not both. Audit of every place the
rule is stated:

| Surface | Text | Status |
|---|---|---|
| `/winba-score` body copy | "at least 10 appearances or 250 minutes" | correct |
| `/winba-score` FAQ (visible) | "at least 10 appearances or 250 minutes" | correct |
| `/winba-score` FAQPage schema | "at least 10 appearances or 250 minutes" | correct |
| **Index article body** | **"qualified this month at 10 games and 250 minutes"** | **WRONG — generator corrected** |

The generator now writes "qualified for the league ranking, which takes at least
10 appearances or 250 minutes", with a test asserting the disjunction and
rejecting the conjunctive phrasing. **The live September article still carries
the old sentence** — it needs one regeneration to pick the correction up, which
is an owner call, listed as an action below.

## A rank defect found in the reference edition

The frozen board re-derived rank by sorting on score then athlete id. The metric
ranks by score, then **minutes**, then name (`scoreWinbaPlayers`). For tied
scores those disagree, and the published September edition does disagree:

| Player (both 72.2) | metric says | September board says |
|---|---|---|
| Cheyenne Parker-Tyus | No. 22 | No. 21 |
| Madina Okot | No. 21 | No. 22 |

The builder now preserves the snapshot's own rank and refuses a qualified row
that has none. The dry-run route had the same defect and now reports **0 rank
disagreements against the live metric (was 2)**.

**September itself is unchanged.** A normal regeneration reuses the stored board;
a re-freeze is *refused* precisely because ranks would change — verified in
production (`status: refreeze_refused`, board untouched). Correcting two tied
ranks on a published edition is an owner decision.

## Verdicts

| Period | Verdict | Reason |
|---|---|---|
| **May 2026** | **NOT READY** | Only **21 qualified** at the cutoff against 197 scored — the leader qualified on **8 appearances**. A 21-player board is an early-season artefact, not a league ranking, and the copy would have to claim otherwise. No prior period, so no movement. Team depth is distorted: two teams hold 6 each of the top 21. Podium not ready. The archive-complete run did **not** change this conclusion. |
| **June 2026** | **READY TO PUBLISH** | 158 qualified, complete top 25, zero unresolved identities, Carter retained at #14, all four components and PTS/REB/AST/MIN present, deterministic, podium ready 3/3, 10/10 top-ten photos, movement computable from the May comparison board. |
| **July 2026** | **READY TO PUBLISH** | 173 qualified, same integrity profile, movement from June. |
| **August 2026** | **READY TO PUBLISH** | 188 qualified, same integrity profile, movement from July. |

All three READY verdicts are **conditional on the publication decisions below** —
ready once the timestamp semantics are approved. No blocker is technical.

## Determinism

Each board was rebuilt repeatedly from the same archive and cutoff and hashed
over `[rank, player_id, score, team_id, components]`:

| Period | hash | identical across builds |
|---|---|---|
| 2026-05 | `d09a2ba9bf972ee2` | True |
| 2026-06 | `226de269ad06a126` | True |
| 2026-07 | `85fadd4329763f9d` | True |
| 2026-08 | `d3e1cdfe579f6206` | True |
| 2026-09 | `930162150c8813df` | True |

## No current-data leakage

Proven by test (`tests/winba-history.test.mjs`), not asserted:

* games played after a cutoff cannot change that period's board — the June board hashes identically whether July's games are present or absent, while July's own board does see them;
* a later team change cannot rewrite a historical team assignment — the box score decides, not the roster dictionary;
* current roster status cannot remove a historically qualified player — an empty roster dictionary leaves the board intact;
* movement comes only from frozen ranks; no prior board yields `null`, never an inferred delta;
* a re-freeze refuses to change a published board.

Photography is presentation metadata only. It is resolved *after* ranking, a
missing photo never affects eligibility, and three players in the June–August
top 25 have no approved photo and correctly render the safe avatar.

## Media readiness

Ran the reviewed pipeline (`scripts/media/newsroom_media.py`) for the 26
approved players in the June–August top 25 that had no JPEG `podium` slot. No
approvals were changed: **166 approved photos before and after, guard PASS**.

| Period | podium (1,2,3) | podium_ready | top-10 photos | top-25 photos | safe fallback |
|---|---|---|---|---|---|
| 2026-05 | [True, True, False] | False | 9/10 | 18/21 | 3 |
| 2026-06 | [True, True, True] | True | 10/10 | 23/25 | 2 |
| 2026-07 | [True, True, True] | True | 10/10 | 22/25 | 3 |
| 2026-08 | [True, True, True] | True | 10/10 | 22/25 | 3 |
| 2026-09 (live) | [True, True, True] | True | 10/10 | 22/25 | 3 |

## Component readiness — the same product, a different month

Every historical board was rendered through the **current** Index components, not
a second historical renderer: `winbaIndexLeaderboard` (podium, ranks 4–10,
expandable 11–25, spread analysis, movement) and `winbaTeamDepth`. All periods
render. Position leaders, series navigation and the methodology note come from
the same generator.

## Recommended publication contract — NOT APPLIED

Do **not** backdate publication. A reconstructed edition should carry:

```
period              2026-06                      the ranking period
snapshot_as_of      2026-07-01T00:00:00.000Z     the historical cutoff
historical_backfill true                         this edition was reconstructed
published_at        <the actual moment we publish it>
first_published_at  <same>                       never a June date
```

and say so on the page — "The June 2026 WinBA Index, reconstructed from
PropBetEdge's archived game record" — so the reader knows it is a historical
record, not a claim that we published it in June. Schema follows the same rule:
`datePublished` is the real publication instant; the period belongs in the
headline, `articleSection` and body, never in `datePublished`.

## Canonical and series plan

| Period | canonical slug | series position | previous | next |
|---|---|---|---|---|
| 2026-06 | `/news/the-winba-index-the-wnbas-top-players-for-june-2026-<id6>` | 1 of 4 | — | July |
| 2026-07 | `/news/the-winba-index-the-wnbas-top-players-for-july-2026-<id6>` | 2 of 4 | June | August |
| 2026-08 | `/news/the-winba-index-the-wnbas-top-players-for-august-2026-<id6>` | 3 of 4 | July | September |
| 2026-09 | `the-winba-index-the-wnbas-top-players-for-september-2026-00e543` | 4 of 4 (**current**) | August | — |

The id is `SHA-256('winba_index|<period>')` truncated, so each slug is stable and
a rerun cannot create a second edition. May is an **internal comparison
snapshot** at `winba:v1:monthly:2026-05` — a frozen board with no article.

**September stays the current edition.** `currentWinbaEdition()` is period-based,
so editions published later for earlier periods cannot displace it; a regression
test publishes June–August after September and asserts September remains current
and that October would take over.

## SEO and schema readiness

The same builders serve a historical edition: `NewsArticle`, WinBA Score as a
`DefinedTerm` in a `DefinedTermSet`, `about` = metric + leader + her team,
`mentions` capped at 16, `articleSection` = the series, restrained keywords,
`BreadcrumbList`, canonical, article-specific OG and Twitter cards at 1200x630,
`news-sitemap.xml`, page sitemap and RSS, and the series archive. Verified on the
live edition by `scripts/canary-winba.mjs` (58 checks). The one historical
difference is the date contract above.

## September must remain immutable — verified

`published_at` `2026-09-21T20:48:01.908Z`, slug, canonical, frozen board,
`frozen_at`, scores, components and revision history all **unchanged** by this
work, re-checked after deploying the rank fix.

## Remaining blockers

1. **Owner decision — timestamp semantics.** Approve the `historical_backfill` contract above before any edition is generated.
2. **Owner decision — September's two tied ranks.** Accepting the metric's order (Okot 21, Parker-Tyus 22) means changing a published board; the re-freeze guard refuses it by design.
3. **Owner decision — September copy.** One regeneration applies the qualification-language correction. `published_at` and the frozen board are unaffected.
4. **May stays unpublished.** The series begins with June.

## Per-period reconciliation

### 2026-05 — NOT READY

```
snapshot cutoff (as_of)   2026-06-01T00:00:00.000Z
archive games in window   63   (excluded after cutoff: 255)
games used                63
players scored            197   (qualified 21, provisional 176)
frozen board rows         21
determinism hash          d09a2ba9bf972ee2   (identical across repeated builds: true)
ranks 1..n sequential     true
scores descend with rank  true
unresolved identities     none
off-current-roster kept   none in this top 25
all four components       true
PTS/REB/AST/MIN complete  true
total minutes present     true
podium (1,2,3) approved   [true,true,false]  -> podium_ready false
top-10 approved photos    9/10
top-25 approved photos    18/21   (safe avatar fallback: 3)
movement baseline         none   computable false   overlap 0/21
renders through the live components  board true · team depth true
```

**Frozen top 25 as of 2026-06-01**

| # | player id | player | team at snapshot | WinBA | PTS | REB | AST | MIN | G | W | prod | win% | in-wins | court |
|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 3906949 | Jessica Shepard | Dallas Wings | 83.6 | 13 | 11.4 | 6.5 | 31.8 | 8 | 5 | 100 | 62.5 | 75.1 | 79.4 |
| 2 | 2998928 | Breanna Stewart | New York Liberty | 71.4 | 18.8 | 8.6 | 2.4 | 32.6 | 9 | 5 | 85 | 55.6 | 55.5 | 81.4 |
| 3 | 2988756 | Brittney Sykes | Toronto Tempo | 70.9 | 19.9 | 3.9 | 4.1 | 31.9 | 9 | 5 | 80 | 55.6 | 65.3 | 79.7 |
| 4 | 4433730 | Paige Bueckers | Dallas Wings | 68.7 | 19.4 | 3 | 5.1 | 33.3 | 8 | 5 | 70 | 62.5 | 66.1 | 83.1 |
| 5 | 2999101 | Jonquel Jones | New York Liberty | 65.2 | 12.7 | 8.4 | 2.7 | 28.9 | 9 | 5 | 75 | 55.6 | 51.7 | 72.2 |
| 6 | 4703794 | Sarah Ashlee Barker | Portland Fire | 62.7 | 10.2 | 4.6 | 1.8 | 21.5 | 10 | 6 | 65 | 60 | 65.5 | 53.8 |
| 7 | 2529122 | Chelsea Gray | Las Vegas Aces | 62 | 10.6 | 3.6 | 6.8 | 31.4 | 8 | 5 | 55 | 62.5 | 68.8 | 78.4 |
| 8 | 2529140 | Alyssa Thomas | Phoenix Mercury | 61.5 | 16.7 | 7.2 | 8.1 | 33.9 | 9 | 2 | 95 | 22.2 | 23.7 | 84.7 |
| 9 | 3906972 | Bridget Carleton | Portland Fire | 60.6 | 15.1 | 3.2 | 2.2 | 29.4 | 9 | 6 | 50 | 66.7 | 70.2 | 73.6 |
| 10 | 3934218 | Megan DiLeo | Portland Fire | 58.1 | 10.4 | 2.8 | 0.5 | 17.1 | 10 | 6 | 60 | 60 | 59.3 | 42.8 |
| 11 | 2529205 | Kayla McBride | Minnesota Lynx | 56.5 | 14 | 4.5 | 2 | 32.9 | 8 | 6 | 35 | 75 | 69.1 | 82.2 |
| 12 | 4684384 | Aneesah Morrow | Connecticut Sun | 55 | 12 | 10.1 | 1.2 | 24.9 | 10 | 2 | 90 | 20 | 16.4 | 62.2 |
| 13 | 4398729 | Emily Engstler | Portland Fire | 53.2 | 9.5 | 3.9 | 1.3 | 23.1 | 10 | 6 | 40 | 60 | 72.1 | 57.8 |
| 14 | 2998938 | Kahleah Copper | Phoenix Mercury | 38 | 18.4 | 2.6 | 2.1 | 34.1 | 9 | 2 | 45 | 22.2 | 18.2 | 85.3 |
| 15 | 4682797 | Luisa Geiselsoder | Portland Fire | 34.2 | 5.4 | 3.2 | 1.8 | 21.4 | 10 | 6 | 5 | 60 | 58 | 53.5 |
| 16 | 5209202 | Nyadiew Puoch | Portland Fire | 31.9 | 4.4 | 2 | 0.9 | 20.6 | 10 | 6 | 0 | 60 | 58.9 | 51.5 |
| 17 | 4703609 | Charlisse Leger-Walker | Connecticut Sun | 28.3 | 7.5 | 1.8 | 2.7 | 21.5 | 10 | 2 | 30 | 20 | 22.3 | 53.8 |
| 18 | 3922628 | Kennedy Burke | Connecticut Sun | 28.2 | 7.6 | 3.8 | 2.2 | 24.4 | 10 | 2 | 25 | 20 | 29 | 61 |
| 19 | 4433635 | Diamond Miller | Connecticut Sun | 20.1 | 8.3 | 2 | 0.9 | 19.9 | 10 | 2 | 15 | 20 | 17.1 | 49.7 |
| 20 | 4433514 | Saniya Rivers | Connecticut Sun | 19.3 | 6 | 2 | 3.7 | 24 | 10 | 2 | 10 | 20 | 18.9 | 60 |
| 21 | 4898898 | Gianna Kneepkens | Connecticut Sun | 18.5 | 3.8 | 1.6 | 0.4 | 10.1 | 10 | 2 | 20 | 20 | 9.8 | 25.3 |

**Team depth from this frozen board** (teams with 2+ of the top 21)

- 6 — Portland Fire
- 6 — Connecticut Sun
- 2 — Dallas Wings
- 2 — New York Liberty
- 2 — Phoenix Mercury

### 2026-06 — READY TO PUBLISH

```
snapshot cutoff (as_of)   2026-07-01T00:00:00.000Z
archive games in window   145   (excluded after cutoff: 173)
games used                145
players scored            208   (qualified 158, provisional 50)
frozen board rows         25
determinism hash          226de269ad06a126   (identical across repeated builds: true)
ranks 1..n sequential     true
scores descend with rank  true
unresolved identities     none
off-current-roster kept   #14 Chennedy Carter
all four components       true
PTS/REB/AST/MIN complete  true
total minutes present     true
podium (1,2,3) approved   [true,true,true]  -> podium_ready true
top-10 approved photos    10/10
top-25 approved photos    23/25   (safe avatar fallback: 2)
movement baseline         2026-05   computable true   overlap 5/25
renders through the live components  board true · team depth true
```

**Frozen top 25 as of 2026-07-01**

| # | player id | player | team at snapshot | WinBA | PTS | REB | AST | MIN | G | W | prod | win% | in-wins | court |
|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 3149391 | A'ja Wilson | Las Vegas Aces | 87.1 | 25.7 | 9.4 | 2.9 | 32.3 | 19 | 14 | 100 | 73.7 | 78 | 80.7 |
| 2 | 4433791 | Olivia Miles | Minnesota Lynx | 86.8 | 18.7 | 4.8 | 5.7 | 30.8 | 19 | 15 | 96.8 | 78.9 | 79 | 77 |
| 3 | 2529130 | Natasha Howard | Minnesota Lynx | 85.9 | 17.7 | 8.2 | 2.9 | 29.7 | 19 | 15 | 94.9 | 78.9 | 80.3 | 74.3 |
| 4 | 4065870 | Jackie Young | Las Vegas Aces | 80.7 | 17.3 | 4.5 | 6.8 | 32.6 | 20 | 14 | 88.5 | 70 | 76.3 | 81.4 |
| 5 | 2987891 | Courtney Williams | Minnesota Lynx | 80 | 15.8 | 5.3 | 4.1 | 30.5 | 19 | 15 | 81.5 | 78.9 | 79.7 | 76.3 |
| 6 | 4433402 | Angel Reese | Atlanta Dream | 80 | 14.8 | 11.6 | 2.5 | 30.3 | 19 | 12 | 96.2 | 63.2 | 66.7 | 75.7 |
| 7 | 3906949 | Jessica Shepard | Dallas Wings | 79.6 | 14.3 | 11.5 | 5.4 | 32.4 | 19 | 11 | 98.1 | 57.9 | 64.7 | 80.9 |
| 8 | 2998928 | Breanna Stewart | New York Liberty | 79.2 | 19.5 | 8.7 | 2.9 | 32.7 | 20 | 13 | 91.7 | 65 | 67.3 | 81.6 |
| 9 | 4433403 | Caitlin Clark | Indiana Fever | 77.1 | 21.2 | 4 | 8.2 | 30.8 | 17 | 9 | 99.4 | 52.9 | 57.3 | 77.1 |
| 10 | 3065570 | Kelsey Plum | Los Angeles Sparks | 76.7 | 23.9 | 2.2 | 6.4 | 34.6 | 12 | 7 | 90.4 | 58.3 | 63.8 | 86.5 |
| 11 | 4432831 | Aliyah Boston | Indiana Fever | 76.6 | 17 | 8.6 | 2.9 | 26.8 | 18 | 10 | 98.7 | 55.6 | 58 | 67.1 |
| 12 | 4433730 | Paige Bueckers | Dallas Wings | 76 | 19.9 | 3.8 | 5.9 | 33.1 | 18 | 11 | 87.9 | 61.1 | 64.7 | 82.6 |
| 13 | 3904576 | Marina Mabrey | Toronto Tempo | 75.2 | 21.2 | 3.5 | 3.6 | 28.6 | 18 | 9 | 97.5 | 50 | 58.3 | 71.4 |
| 14 | 4280892 | Chennedy Carter | Las Vegas Aces | 75.1 | 14.4 | 2 | 1.5 | 18.2 | 12 | 8 | 92.4 | 66.7 | 61.6 | 45.4 |
| 15 | 2999101 | Jonquel Jones | New York Liberty | 73.3 | 14.9 | 8.7 | 2.7 | 29.4 | 20 | 12 | 87.3 | 60 | 58.4 | 73.4 |
| 16 | 2529122 | Chelsea Gray | Las Vegas Aces | 72.3 | 12.1 | 3.9 | 7.4 | 33.1 | 20 | 14 | 69.4 | 70 | 76.4 | 82.8 |
| 17 | 4398935 | Veronica Burton | Golden State Valkyries | 71.5 | 12.2 | 3.6 | 5.4 | 28.3 | 20 | 13 | 74.5 | 65 | 73.2 | 70.8 |
| 18 | 4336633 | Li Yueru | Dallas Wings | 71.5 | 2.9 | 2.8 | 0.6 | 7.9 | 13 | 9 | 79.6 | 69.2 | 82.1 | 19.8 |
| 19 | 3142328 | Gabby Williams | Golden State Valkyries | 71.4 | 15.8 | 3.8 | 2.3 | 26.3 | 20 | 13 | 77.7 | 65 | 68.3 | 65.6 |
| 20 | 4281929 | Satou Sabally | New York Liberty | 70.6 | 10.4 | 2.8 | 1.9 | 16.7 | 13 | 8 | 86.6 | 61.5 | 60.5 | 41.7 |
| 21 | 5108587 | Madina Okot | Atlanta Dream | 70.6 | 5.5 | 3.6 | 0.3 | 9.7 | 19 | 12 | 93.6 | 63.2 | 51.1 | 24.2 |
| 22 | 3142250 | Jordin Canada | Atlanta Dream | 70.1 | 11.5 | 3.6 | 7 | 30.5 | 19 | 12 | 73.2 | 63.2 | 68.5 | 76.3 |
| 23 | 4898384 | Kiki Iriafen | Washington Mystics | 69.8 | 15.6 | 9.2 | 1.7 | 28 | 15 | 7 | 89.8 | 46.7 | 53.7 | 70 |
| 24 | 4398776 | NaLyssa Smith | Las Vegas Aces | 68.8 | 10.9 | 6.3 | 0.9 | 23.4 | 20 | 14 | 70.1 | 70 | 69.7 | 58.5 |
| 25 | 4398674 | Rhyne Howard | Atlanta Dream | 68.7 | 18.6 | 3.8 | 3.2 | 34.9 | 18 | 12 | 63.7 | 66.7 | 73 | 87.4 |

**Team depth from this frozen board** (teams with 2+ of the top 25)

- 5 — Las Vegas Aces
- 4 — Atlanta Dream
- 3 — Minnesota Lynx
- 3 — Dallas Wings
- 3 — New York Liberty
- 2 — Indiana Fever
- 2 — Golden State Valkyries

**Movement vs 2026-05 (frozen ranks only)**

- Jonquel Jones: No. 5 → No. 15 (-10), 65.2 → 73.3
- Chelsea Gray: No. 7 → No. 16 (-9), 62 → 72.3
- Paige Bueckers: No. 4 → No. 12 (-8), 68.7 → 76
- Jessica Shepard: No. 1 → No. 7 (-6), 83.6 → 79.6
- Breanna Stewart: No. 2 → No. 8 (-6), 71.4 → 79.2
- new to the top 25: A'ja Wilson (No. 1), Olivia Miles (No. 2), Natasha Howard (No. 3), Jackie Young (No. 4), Courtney Williams (No. 5), Angel Reese (No. 6), Caitlin Clark (No. 9), Kelsey Plum (No. 10), Aliyah Boston (No. 11), Marina Mabrey (No. 13), Chennedy Carter (No. 14), Veronica Burton (No. 17), Li Yueru (No. 18), Gabby Williams (No. 19), Satou Sabally (No. 20), Madina Okot (No. 21), Jordin Canada (No. 22), Kiki Iriafen (No. 23), NaLyssa Smith (No. 24), Rhyne Howard (No. 25)

### 2026-07 — READY TO PUBLISH

```
snapshot cutoff (as_of)   2026-08-01T00:00:00.000Z
archive games in window   216   (excluded after cutoff: 102)
games used                216
players scored            222   (qualified 173, provisional 49)
frozen board rows         25
determinism hash          85fadd4329763f9d   (identical across repeated builds: true)
ranks 1..n sequential     true
scores descend with rank  true
unresolved identities     none
off-current-roster kept   #23 Chennedy Carter
all four components       true
PTS/REB/AST/MIN complete  true
total minutes present     true
podium (1,2,3) approved   [true,true,true]  -> podium_ready true
top-10 approved photos    10/10
top-25 approved photos    22/25   (safe avatar fallback: 3)
movement baseline         2026-06   computable true   overlap 21/25
renders through the live components  board true · team depth true
```

**Frozen top 25 as of 2026-08-01**

| # | player id | player | team at snapshot | WinBA | PTS | REB | AST | MIN | G | W | prod | win% | in-wins | court |
|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 4433791 | Olivia Miles | Minnesota Lynx | 88.7 | 19.1 | 5 | 5.9 | 30.3 | 29 | 24 | 97.1 | 82.8 | 83.8 | 75.9 |
| 2 | 3149391 | A'ja Wilson | Las Vegas Aces | 86.6 | 25.9 | 9.4 | 3.1 | 31.2 | 27 | 20 | 100 | 74.1 | 76.6 | 78 |
| 3 | 2529130 | Natasha Howard | Minnesota Lynx | 82.2 | 15.3 | 7.8 | 3.1 | 29.3 | 31 | 24 | 87.8 | 77.4 | 80.1 | 73.1 |
| 4 | 3906949 | Jessica Shepard | Dallas Wings | 81.1 | 14.4 | 11.6 | 5.5 | 33 | 30 | 19 | 96.5 | 63.3 | 68 | 82.5 |
| 5 | 4432831 | Aliyah Boston | Indiana Fever | 80.4 | 16.4 | 8 | 2.7 | 25.6 | 26 | 17 | 98.8 | 65.4 | 66 | 64 |
| 6 | 4433402 | Angel Reese | Atlanta Dream | 80.2 | 15.3 | 11.4 | 2.5 | 30 | 28 | 18 | 95.3 | 64.3 | 68.5 | 75.1 |
| 7 | 4433403 | Caitlin Clark | Indiana Fever | 80.1 | 21.3 | 3.8 | 7.8 | 29 | 25 | 15 | 99.4 | 60 | 65.8 | 72.6 |
| 8 | 4065870 | Jackie Young | Las Vegas Aces | 79.4 | 17.4 | 4 | 6.6 | 31.6 | 30 | 20 | 89 | 66.7 | 74 | 79 |
| 9 | 2987891 | Courtney Williams | Minnesota Lynx | 79.3 | 14.8 | 5.1 | 4.3 | 30.1 | 31 | 25 | 79.7 | 80.6 | 79 | 75.2 |
| 10 | 4433730 | Paige Bueckers | Dallas Wings | 78.8 | 20.5 | 4.1 | 6 | 33.4 | 28 | 18 | 90.1 | 64.3 | 69.2 | 83.5 |
| 11 | 3065570 | Kelsey Plum | Los Angeles Sparks | 77.6 | 23.9 | 2.2 | 6.4 | 34.6 | 12 | 7 | 92.4 | 58.3 | 63.8 | 86.5 |
| 12 | 2998928 | Breanna Stewart | New York Liberty | 77.5 | 21.1 | 8.7 | 3.2 | 33.5 | 30 | 17 | 95.9 | 56.7 | 59.1 | 83.8 |
| 13 | 5345478 | Eliska Joklova | Minnesota Lynx | 76 | 2.4 | 1.3 | 1.4 | 6.7 | 14 | 12 | 77.9 | 85.7 | 89.4 | 16.8 |
| 14 | 4898384 | Kiki Iriafen | Washington Mystics | 75 | 15.1 | 9.1 | 1.5 | 27.7 | 26 | 15 | 89.5 | 57.7 | 66.9 | 69.1 |
| 15 | 4398911 | Shakira Austin | Washington Mystics | 74.1 | 15.5 | 9.4 | 2.6 | 29.6 | 27 | 15 | 90.7 | 55.6 | 59.8 | 74 |
| 16 | 2999101 | Jonquel Jones | New York Liberty | 72.8 | 14.4 | 9.1 | 2.9 | 29.3 | 30 | 17 | 88.4 | 56.7 | 57.5 | 73.2 |
| 17 | 2529205 | Kayla McBride | Minnesota Lynx | 72.7 | 18 | 3.4 | 2.3 | 32.2 | 30 | 24 | 64 | 80 | 79.2 | 80.6 |
| 18 | 3142191 | Kelsey Mitchell | Indiana Fever | 72.7 | 23.6 | 1.8 | 2.7 | 32 | 29 | 18 | 82 | 62.1 | 61.4 | 80 |
| 19 | 5108587 | Madina Okot | Atlanta Dream | 72.4 | 6.2 | 3.7 | 0.2 | 9.7 | 27 | 17 | 97.7 | 63 | 51.3 | 24.2 |
| 20 | 2529122 | Chelsea Gray | Las Vegas Aces | 71.9 | 12.7 | 3.4 | 7.1 | 33.1 | 29 | 20 | 69.8 | 69 | 74.7 | 82.8 |
| 21 | 3142250 | Jordin Canada | Atlanta Dream | 71.5 | 11.3 | 3.7 | 7.7 | 31.5 | 28 | 18 | 75 | 64.3 | 68.9 | 78.8 |
| 22 | 3142328 | Gabby Williams | 133384 | 71.5 | 15 | 3.4 | 2.4 | 25.6 | 27 | 18 | 77.3 | 66.7 | 68 | 64 |
| 23 | 4280892 | Chennedy Carter | Las Vegas Aces | 71.5 | 12.6 | 1.9 | 1.4 | 17.4 | 14 | 9 | 86 | 64.3 | 61.5 | 43.6 |
| 24 | 4398935 | Veronica Burton | Golden State Valkyries | 71.4 | 12 | 3.4 | 5.5 | 28.5 | 28 | 19 | 72.7 | 67.9 | 73.2 | 71.2 |
| 25 | 4281929 | Satou Sabally | New York Liberty | 70.9 | 10.4 | 2.8 | 1.9 | 16.7 | 13 | 8 | 87.2 | 61.5 | 60.5 | 41.7 |

**Team depth from this frozen board** (teams with 2+ of the top 25)

- 5 — Minnesota Lynx
- 4 — Las Vegas Aces
- 3 — Indiana Fever
- 3 — Atlanta Dream
- 3 — New York Liberty
- 2 — Dallas Wings
- 2 — Washington Mystics

**Movement vs 2026-06 (frozen ranks only)**

- Kelsey Mitchell: No. 34 → No. 18 (+16), 65.5 → 72.7
- Shakira Austin: No. 29 → No. 15 (+14), 67.7 → 74.1
- Kayla McBride: No. 30 → No. 17 (+13), 67.3 → 72.7
- Kiki Iriafen: No. 23 → No. 14 (+9), 69.8 → 75
- Chennedy Carter: No. 14 → No. 23 (-9), 75.1 → 71.5
- Veronica Burton: No. 17 → No. 24 (-7), 71.5 → 71.4
- new to the top 25: Eliska Joklova (No. 13)

### 2026-08 — READY TO PUBLISH

```
snapshot cutoff (as_of)   2026-09-01T00:00:00.000Z
archive games in window   302   (excluded after cutoff: 16)
games used                302
players scored            231   (qualified 188, provisional 43)
frozen board rows         25
determinism hash          d3e1cdfe579f6206   (identical across repeated builds: true)
ranks 1..n sequential     true
scores descend with rank  true
unresolved identities     none
off-current-roster kept   #21 Chennedy Carter
all four components       true
PTS/REB/AST/MIN complete  true
total minutes present     true
podium (1,2,3) approved   [true,true,true]  -> podium_ready true
top-10 approved photos    10/10
top-25 approved photos    22/25   (safe avatar fallback: 3)
movement baseline         2026-07   computable true   overlap 22/25
renders through the live components  board true · team depth true
```

**Frozen top 25 as of 2026-09-01**

| # | player id | player | team at snapshot | WinBA | PTS | REB | AST | MIN | G | W | prod | win% | in-wins | court |
|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 4433791 | Olivia Miles | Minnesota Lynx | 87.7 | 19.5 | 4.8 | 6.1 | 30.8 | 39 | 31 | 97.3 | 79.5 | 81.5 | 77 |
| 2 | 3149391 | A'ja Wilson | Las Vegas Aces | 85.1 | 25.6 | 9.3 | 3.1 | 31.6 | 38 | 27 | 100 | 71.1 | 72.2 | 79 |
| 3 | 4433403 | Caitlin Clark | Indiana Fever | 81.8 | 22.3 | 3.9 | 8.3 | 31 | 37 | 23 | 99.5 | 62.2 | 68.7 | 77.5 |
| 4 | 4433402 | Angel Reese | Atlanta Dream | 81.6 | 15.7 | 12.3 | 2.8 | 31 | 40 | 26 | 97.9 | 65 | 67.7 | 77.6 |
| 5 | 3917450 | Napheesa Collier | Minnesota Lynx | 81.6 | 18 | 7.3 | 2.8 | 30.5 | 12 | 9 | 88.8 | 75 | 76.2 | 76.3 |
| 6 | 2529130 | Natasha Howard | Minnesota Lynx | 81.2 | 14.7 | 7.6 | 3.3 | 29.2 | 41 | 31 | 87.2 | 75.6 | 78.7 | 73 |
| 7 | 4065870 | Jackie Young | Las Vegas Aces | 81 | 18.8 | 4.3 | 6.5 | 31.9 | 41 | 27 | 93.6 | 65.9 | 72.5 | 79.6 |
| 8 | 3906949 | Jessica Shepard | Dallas Wings | 80.4 | 14.2 | 10.9 | 4.9 | 31.5 | 39 | 24 | 96.8 | 61.5 | 67.9 | 78.7 |
| 9 | 4432831 | Aliyah Boston | Indiana Fever | 80.2 | 16.5 | 8.1 | 2.9 | 27 | 37 | 24 | 98.4 | 64.9 | 64.6 | 67.5 |
| 10 | 2998928 | Breanna Stewart | New York Liberty | 78.3 | 20.2 | 8.3 | 3.3 | 33 | 41 | 25 | 94.1 | 61 | 62.3 | 82.4 |
| 11 | 2987891 | Courtney Williams | Minnesota Lynx | 77.9 | 14.3 | 4.9 | 4.4 | 30.4 | 40 | 32 | 76.5 | 80 | 79.4 | 75.9 |
| 12 | 4398911 | Shakira Austin | Washington Mystics | 77.5 | 16.8 | 9.4 | 2.5 | 29.5 | 39 | 23 | 95.7 | 59 | 61.6 | 73.8 |
| 13 | 4433730 | Paige Bueckers | Dallas Wings | 77.1 | 20.3 | 3.9 | 5.9 | 32.8 | 39 | 24 | 89.8 | 61.5 | 65.4 | 82.1 |
| 14 | 2999101 | Jonquel Jones | New York Liberty | 76.7 | 14.6 | 9.1 | 2.8 | 28.4 | 41 | 25 | 92.5 | 61 | 63.7 | 70.9 |
| 15 | 4398935 | Veronica Burton | Golden State Valkyries | 76 | 12.3 | 3.6 | 5.8 | 28.4 | 40 | 29 | 78.6 | 72.5 | 77.2 | 71 |
| 16 | 4898384 | Kiki Iriafen | Washington Mystics | 75.9 | 15.2 | 9.3 | 1.6 | 28.1 | 38 | 23 | 89.3 | 60.5 | 67.9 | 70.3 |
| 17 | 3142191 | Kelsey Mitchell | Indiana Fever | 74.9 | 25.1 | 1.8 | 2.8 | 32.6 | 41 | 26 | 85.6 | 63.4 | 62.2 | 81.4 |
| 18 | 3142328 | Gabby Williams | Golden State Valkyries | 73.4 | 14.4 | 3.3 | 2.3 | 24.7 | 38 | 27 | 77 | 71.1 | 74.1 | 61.8 |
| 19 | 1054 | Tiffany Hayes | Golden State Valkyries | 73.3 | 8.9 | 2.1 | 2.4 | 16.6 | 38 | 28 | 80.7 | 73.7 | 72 | 41.6 |
| 20 | 3065570 | Kelsey Plum | Phoenix Mercury | 71.7 | 21.5 | 2.1 | 5.4 | 30.6 | 17 | 8 | 91.4 | 47.1 | 55.8 | 76.6 |
| 21 | 4280892 | Chennedy Carter | Las Vegas Aces | 71.7 | 12.6 | 1.9 | 1.4 | 17.4 | 14 | 9 | 86.6 | 64.3 | 61.5 | 43.6 |
| 22 | 4790264 | Janelle Salaun | Golden State Valkyries | 71.6 | 12.9 | 3.9 | 1.2 | 22.3 | 38 | 27 | 74.9 | 71.1 | 73 | 55.8 |
| 23 | 2529205 | Kayla McBride | Minnesota Lynx | 71.4 | 18.1 | 3.1 | 2.2 | 32.6 | 40 | 31 | 63.1 | 77.5 | 77.6 | 81.4 |
| 24 | 3142250 | Jordin Canada | Atlanta Dream | 71.3 | 11.6 | 3.7 | 7.4 | 31.6 | 39 | 26 | 72.2 | 66.7 | 71.4 | 78.9 |
| 25 | 5108587 | Madina Okot | Atlanta Dream | 71.1 | 5.4 | 3.3 | 0.3 | 9.3 | 39 | 25 | 93 | 64.1 | 54.5 | 23.1 |

**Team depth from this frozen board** (teams with 2+ of the top 25)

- 5 — Minnesota Lynx
- 4 — Golden State Valkyries
- 3 — Las Vegas Aces
- 3 — Indiana Fever
- 3 — Atlanta Dream
- 2 — Dallas Wings
- 2 — New York Liberty
- 2 — Washington Mystics

**Movement vs 2026-07 (frozen ranks only)**

- Tiffany Hayes: No. 45 → No. 19 (+26), 61.9 → 73.3
- Veronica Burton: No. 24 → No. 15 (+9), 71.4 → 76
- Kelsey Plum: No. 11 → No. 20 (-9), 77.6 → 71.7
- Kayla McBride: No. 17 → No. 23 (-6), 72.7 → 71.4
- Madina Okot: No. 19 → No. 25 (-6), 72.4 → 71.1
- Caitlin Clark: No. 7 → No. 3 (+4), 80.1 → 81.8
- new to the top 25: Napheesa Collier (No. 5)
