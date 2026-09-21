# The WinBA Index — historical backfill dry run

**Status: NOTHING PUBLISHED.** This is the coverage report requested before any
previous month is considered for publication. No historical snapshot, article or
publication-ledger entry was written.

Generated 2026-09-21 against the live 2026 season.

## Verdict

| Period | Qualified | Top-10 photos | Movement | Publishable as an Index? |
|---|---|---|---|---|
| May 2026 | **21** | 9/10 | no prior period | **No** — see below |
| June 2026 | 151 | 10/10 | from May | Yes, once the source gap is closed |
| July 2026 | 164 | 10/10 | from June | Yes, once the source gap is closed |
| August 2026 | 179 | 10/10 | from July | Yes, once the source gap is closed |
| September 2026 | 183 | 10/10 | from August | Already published (live edition) |

### Two blockers, both fixable, neither bypassable

**1. The reconstruction source is incomplete (blocks publication of every month).**

This run had to aggregate `/v1/players/:id/gamelog`, which covers only the 218
players on a *current* roster. The live board is built from archived box scores,
which also contain players released during the season. Measured against the live
board:

* `games_used` 318 vs 318 — **exact**
* top-15 ranks — **identical**
* qualified population 183 vs 193 — **10 released players invisible**
* score drift ≤ 0.3, caused entirely by the smaller percentile population
* one omission, **Chennedy Carter, is live #24 — inside the top 25 an Index freezes**

So the shape of every historical board is right and the numbers are close, but
they are not publication-grade: WinBA's production percentile is measured
against the qualification-eligible population, so a missing player shifts every
score slightly, and a missing top-25 player would be a visible hole in a
published edition.

**The fix is already written and not deployed.** `GET /v1/winba/history-dryrun`
on `wnba-ingest` (read-only, admin-token) computes these boards from
`archive:v1:index` + `game:v1:final:*`, which include released players, using
`buildWinbaSnapshotAsOf`. It is in `main` but **undeployed**: `wnba-ingest` is
`pbe_mode: armed` and frozen by owner decision, so deploying it needs explicit
approval. Re-run this report from that endpoint before publishing any month.

**2. May 2026 should not be published at all.**

The season opened 2026-05-08, so at the May cutoff only **21 players** had
reached the 10-game / 250-minute floor, several on 8–10 games. The leader,
Jessica Shepard at 83.6, qualified on 8 games. A board of 21 players is not a
league ranking, it is an early-season artefact, and the copy would have to claim
otherwise. It also has no prior period, so it can carry no movement. Recommend
the series begins with **June 2026**.

## Prerequisite for the podium share card

The top-three podium card needs an approved JPEG `podium` slot for all three
players of that month. Only Miles, Wilson and Reese have one today, so every
historical month currently reports `podium_ready: NO` — May's top three is
Shepard / Stewart / Sykes, June's and July's differ again.

Running `python scripts/media/newsroom_media.py` with no arguments rebuilds all
166 approved players (~11 minutes, measured at 12s for three) and makes every
month's podium renderable. Until then those editions would fall back to the
leader-photo card, which is correct behaviour, not a failure.

## Integrity properties of this run

* Every period uses the **frozen WinBA v1** formula (`scoreWinbaPlayers`), not a variant.
* A game tipping at or after the cutoff is excluded from the aggregate entirely,
  so no present-day value can enter a historical period. `games_used` rises
  monotonically (63 → 145 → 216 → 302 → 318), which is the check that the
  windowing works.
* Player identity comes from ESPN athlete ids throughout; photo availability is
  read from the approved ledger, never assumed.
* Deterministic: the same archive and cutoff produce the same board, and the
  Index id is a hash of the period, so a rerun cannot create a second article.

## Full output

```
==============================================================================
WINBA INDEX — HISTORICAL DRY RUN (NOTHING PUBLISHED)
==============================================================================
Season 2026 regular season: 2026-05-08 → 2026-09-25 (live board: 318 finals, 193 qualified)
Method: frozen WinBA v1 (scoreWinbaPlayers) over only the games tipped before each cutoff.

!! RECONSTRUCTION SOURCE LIMITATION — READ BEFORE PUBLISHING ANY MONTH !!
This run aggregates per-player game logs from /v1/players/:id/gamelog, which covers
the 218 players on a CURRENT roster. The live board is built from archived box scores,
which also contain players released during the season. Measured against the live board:
  games_used             318 vs 318  EXACT
  top-15 ranks           identical
  qualified population   183 vs 193  (10 released players invisible here)
  score drift            <= 0.3, caused entirely by the smaller percentile population
  one omission, Chennedy Carter, sits at live #24 — INSIDE the top 25 an Index freezes.
Therefore these numbers are directionally sound but NOT publication-grade.

------------------------------------------------------------------------------
May 2026   as of 2026-06-01T00:00:00.000Z
  games used 63 | players scored 177 | qualified 21 | floor(>=10) MET
  identity+approved photo in top 10: 9/10 | top-three podium card renderable: NO
  month-over-month movement: NOT COMPUTABLE (no prior period)
  #   player                   tm   WinBA  G   W   PTS   REB   AST   MIN   photo
  1   Jessica Shepard          3    83.6   8   5   13    11.4  6.5   31.8  approved
  2   Breanna Stewart          9    71.4   9   5   18.8  8.6   2.4   32.6  approved
  3   Brittney Sykes           131935 70.9   9   5   19.9  3.9   4.1   31.9  approved
  4   Paige Bueckers           3    68.7   8   5   19.4  3     5.1   33.3  approved
  5   Jonquel Jones            9    65.2   9   5   12.7  8.4   2.7   28.9  approved
  6   Sarah Ashlee Barker      132052 62.7   10  6   10.2  4.6   1.8   21.5  approved
  7   Chelsea Gray             17   62     8   5   10.6  3.6   6.8   31.4  approved
  8   Alyssa Thomas            11   61.5   9   2   16.7  7.2   8.1   33.9  approved
  9   Bridget Carleton         132052 60.6   9   6   15.1  3.2   2.2   29.4  approved
  10  Megan DiLeo              132052 58.1   10  6   10.4  2.8   0.5   17.1  none
------------------------------------------------------------------------------
June 2026   as of 2026-07-01T00:00:00.000Z
  games used 145 | players scored 185 | qualified 151 | floor(>=10) MET
  identity+approved photo in top 10: 10/10 | top-three podium card renderable: NO
  month-over-month movement: computable from 2026-05
  #   player                   tm   WinBA  G   W   PTS   REB   AST   MIN   photo
  1   A'ja Wilson              17   87.1   19  14  25.7  9.4   2.9   32.3  approved
  2   Olivia Miles             8    86.7   19  15  18.7  4.8   5.7   30.8  approved
  3   Natasha Howard           8    85.8   19  15  17.7  8.2   2.9   29.7  approved
  4   Jackie Young             17   80.8   20  14  17.3  4.5   6.8   32.6  approved
  5   Courtney Williams        8    79.9   19  15  15.8  5.3   4.1   30.5  approved
  6   Angel Reese              20   79.9   19  12  14.8  11.6  2.5   30.3  approved
  7   Jessica Shepard          3    79.6   19  11  14.3  11.5  5.4   32.4  approved
  8   Breanna Stewart          9    79.3   20  13  19.5  8.7   2.9   32.7  approved
  9   Caitlin Clark            5    77.1   17  9   21.2  4     8.2   30.8  approved
  10  Kelsey Plum              11   76.8   12  7   23.9  2.2   6.4   34.6  approved
------------------------------------------------------------------------------
July 2026   as of 2026-08-01T00:00:00.000Z
  games used 216 | players scored 197 | qualified 164 | floor(>=10) MET
  identity+approved photo in top 10: 10/10 | top-three podium card renderable: NO
  month-over-month movement: computable from 2026-06
  #   player                   tm   WinBA  G   W   PTS   REB   AST   MIN   photo
  1   Olivia Miles             8    88.6   29  24  19.1  5     5.9   30.3  approved
  2   A'ja Wilson              17   86.6   27  20  25.9  9.4   3.1   31.2  approved
  3   Natasha Howard           8    81.9   31  24  15.3  7.8   3.1   29.3  approved
  4   Jessica Shepard          3    81     30  19  14.4  11.6  5.5   33    approved
  5   Aliyah Boston            5    80.4   26  17  16.4  8     2.7   25.6  approved
  6   Angel Reese              20   80.1   28  18  15.3  11.4  2.5   30    approved
  7   Caitlin Clark            5    80.1   25  15  21.3  3.8   7.8   29    approved
  8   Courtney Williams        8    79.1   31  25  14.8  5.1   4.3   30.1  approved
  9   Jackie Young             17   79.1   30  20  17.4  4     6.6   31.6  approved
  10  Paige Bueckers           3    78.6   28  18  20.5  4.1   6     33.4  approved
------------------------------------------------------------------------------
August 2026   as of 2026-09-01T00:00:00.000Z
  games used 302 | players scored 206 | qualified 179 | floor(>=10) MET
  identity+approved photo in top 10: 10/10 | top-three podium card renderable: NO
  month-over-month movement: computable from 2026-07
  #   player                   tm   WinBA  G   W   PTS   REB   AST   MIN   photo
  1   Olivia Miles             8    87.6   39  31  19.5  4.8   6.1   30.8  approved
  2   A'ja Wilson              17   85.1   38  27  25.6  9.3   3.1   31.6  approved
  3   Caitlin Clark            5    81.8   37  23  22.3  3.9   8.3   31    approved
  4   Angel Reese              20   81.5   40  26  15.7  12.3  2.8   31    approved
  5   Napheesa Collier         8    81.3   12  9   18    7.3   2.8   30.5  approved
  6   Natasha Howard           8    80.9   41  31  14.7  7.6   3.3   29.2  approved
  7   Jackie Young             17   80.9   41  27  18.8  4.3   6.5   31.9  approved
  8   Jessica Shepard          3    80.3   39  24  14.2  10.9  4.9   31.5  approved
  9   Aliyah Boston            5    80.1   37  24  16.5  8.1   2.9   27    approved
  10  Breanna Stewart          9    78.2   41  25  20.2  8.3   3.3   33    approved
------------------------------------------------------------------------------
September 2026 (IN PROGRESS)   as of season to date
  games used 318 | players scored 212 | qualified 183 | floor(>=10) MET
  identity+approved photo in top 10: 10/10 | top-three podium card renderable: YES
  month-over-month movement: computable from 2026-08
  #   player                   tm   WinBA  G   W   PTS   REB   AST   MIN   photo
  1   Olivia Miles             8    87     41  32  19.5  4.8   6     30.9  approved
  2   A'ja Wilson              17   85.7   40  29  25.8  9.2   3.2   31.5  approved
  3   Angel Reese              20   82.5   42  28  16.2  12.1  2.8   30.8  approved
  4   Jackie Young             17   81.7   43  29  19.3  4.2   6.5   31.8  approved
  5   Caitlin Clark            5    81.6   39  24  22.5  3.9   8.4   31.2  approved
  6   Jessica Shepard          3    81.1   41  26  14.1  10.8  5.1   31.3  approved
  7   Natasha Howard           8    80.8   43  32  14.7  7.6   3.2   28.9  approved
  8   Napheesa Collier         8    80     14  10  18.1  7.2   2.7   30.9  approved
  9   Aliyah Boston            5    79.5   39  25  16    7.9   3     26.8  approved
  10  Breanna Stewart          9    79.3   43  27  20.4  8.3   3.3   32.8  approved
------------------------------------------------------------------------------

written: D:/Temp/claude/C--Users-goodl/05db350f-6146-4a9d-b94b-abc91627ffe0/scratchpad/winba-history-dryrun.json
```
