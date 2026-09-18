# 2024 game-note archive acquisition

Brute-force URL probing has reached its ceiling: club notes pages serve only the current season, and
historical documents are not addressable by convention for most clubs. This is the acquisition plan
for the archives we still need, plus the tracking table for it.

**The headline finding is that one of the six is no longer a request at all.** The Connecticut Sun
publish their complete 2024 archive — 47 PDFs, the full regular season and every playoff game —
as a public folder linked from their own notes page. It was already public; nobody had to be asked.
It is now parsed and being loaded. Details in the findings section.

Contacts below are the business addresses each club publishes on its own media page for exactly this
kind of enquiry. No credentials, private material or unpublished information is being sought.

## A. Priority table

Priority is `games_that_would_become_two_sided` first, then total recoverable team-games, then
whether an archive is known to exist. Every number is computed from canonical data, not estimated.

| # | Club | Two-sided unlocks | Team-games recoverable | Archive status | Contact |
|---|---|---|---|---|---|
| 1 | **Connecticut Sun** | 6 | 47 | **OBTAINED** — public folder, 47 PDFs | n/a (no request needed) |
| 2 | **Seattle Storm** | 6 | 42 | not found publicly; index is current-season only | media@stormbasketball.com |
| 3 | **Dallas Wings** | 6 | 40 | not found publicly; index is current-season only | pflenke@dallaswings.com (SVP/Chief Communications Officer), cokeefe@dallaswings.com (Communications Director) |
| 4 | Phoenix Mercury | 6 | 42 | documents found, but **unusable** — see note | see note |
| 5 | Indiana Fever | 5 | 42 | no per-game player log in their format | — |
| 6 | Las Vegas Aces | 4 | 46 | no per-game player log in their format | — |
| 7 | **Minnesota Lynx** | 3 | 53 | not found publicly | acarlson@lynxbasketball.com (PR Manager) |
| 8 | **Washington Mystics** | 3 | 40 | one 2024 document found on the CDN; archive not found | no club media email published; Monumental Sports contact page |
| 9 | **Los Angeles Sparks** | 3 | 40 | not found publicly | jquinn@la-sparks.com (Sr. Director of Communications), jfischman@la-sparks.com |
| 10 | New York Liberty | 2 | 52 | complete 2024 index published, but **no per-game player log** | — |

Phoenix is ranked but not requested: their documents *are* public and carry the richest table found
(separate made and attempted, a real plus/minus, the final score), yet the player's name on each page
is drawn as an image rather than text, so no row can be attached to a canonical person. An archive
request cannot fix that. What would fix it is asking Phoenix whether they can supply the same notes
with selectable text, which is a different and much weaker ask — parked, not sent.

Indiana, Las Vegas and New York are not worth an archive request: their 2024 documents are already
reachable and simply do not contain per-game player logs. Getting more of the same format yields
nothing.

## B. Archive and contact findings

### Connecticut Sun — archive obtained, yield limited by the documents themselves
- Notes page: `sun.wnba.com/notes`, which links per season to public Dropbox folders.
- The 2024 folder link is published on that page. A plain request to it redirects to Dropbox's own
  zip endpoint for the shared folder and returns the whole archive: **47 PDFs**, one per game,
  named by date and opponent, from `5.14 vs. IND` through `10.8 @ MIN (Semifinals Game 5)`.
- Nothing was bypassed: the folder is public, the redirect is Dropbox's, and the club publishes the
  link itself. What earlier tooling could not do was *enumerate* the folder, because the Dropbox web
  view is a JavaScript application that returns no file list to a plain fetch. Following the link
  rather than trying to read the page listing is what worked.
- Format: a new layout family, `sun_2024` — `DATE OPP MIN FG-FGA 3P-3PA FT-FTA OR DR TOT AST STL BK
  TO PF PTS`, one player per page, player name in text, with a season/career HIGHS panel to the
  right that the layout spec now excludes.
- Media relations page: `sun.wnba.com/mediarelations` (Senior Director of Brand Development and
  Communications, plus two public relations specialists).
- **Yield so far: 2 team-games loaded, 38 held.** The archive is complete as a document set, but each
  note carries eleven player pages, so any game in which a twelfth player logged minutes cannot reach
  the 200-minute total. Those games reconcile exactly on points and fall about three minutes short -
  the case the minutes check exists to catch. Fifteen snapshots across the season did not close it,
  so this is a property of the club's format rather than of which documents we chose. If a request
  is ever sent to the Sun, the useful ask is narrower than an archive: whether a twelfth player page
  exists for the affected games.

### Seattle Storm — highest-value outstanding request
- The league's own portal (`wnba.com/game-notes`) points to `seattlestormbasketball.com/mediacentral`
  for Seattle, which now 404s. `storm.wnba.com/notes` also 404s.
- The working index is **`storm.wnba.com/gamenotes`**, and it lists **only the current (2026)
  season** — about 40 entries, named `Storm-Game-Notes-<M>.<D>.pdf` under
  `cdn.wnba.com/sites/1611661328/2026/…`. There is no link to a 2024 archive and no year selector.
- The same path shape with a 2024 date returns 403, so the documents are either not retained at that
  location or never published there. Probing was stopped rather than broadened.
- Cleanest official contact: **media@stormbasketball.com**, published on `storm.wnba.com/mediacentral`
  as the media address. A general club line (206-217-9622) exists but the media address is the right
  door.

### Dallas Wings
- `wings.wnba.com/notes` lists 2026 only, named `<M>.<D>-<vs.|at>-<OPP>.pdf` under site 1611661321.
- Media Central: `wings.wnba.com/media-central`; credentials: `wings.wnba.com/media-credentials`.
- Published contacts: Senior Vice President / Chief Communications Officer, Communications Director,
  Communications Coordinator (addresses in the table above).

### Minnesota Lynx
- Communications page: `lynx.wnba.com/communications`, which publishes the PR Manager's address.
- No 2024 notes archive found; their 2025 documents are addressable as
  `G<n>-MIN-Notes-<MMDDYY>.pdf`, and the same shape for 2024 returns nothing.

### Los Angeles Sparks
- Media Center pages exist per season (`sparks.wnba.com/2025-media-center`,
  `/2026-media-central`), which suggests a 2024 equivalent may have existed and been retired.
- Published contacts: Sr. Director of Communications and a Manager of Public Relations.

### Washington Mystics
- Exactly one 2024 document was located on the CDN (`WAS.SEA-05.19.24-1.pdf`, site 1611661322),
  so their notes were published there under a `WAS.<OPP>-<MM>.<DD>.<YY>.pdf` convention, but no
  archive index was found.
- No club-specific media email is published; the parent company (Monumental Sports) publishes a
  general contact route. League communications is the fallback.

## C. Expected unlocks per club

"Two-sided" counts games where our canonical data already holds the opponent's validated box score,
so obtaining this club would complete the game. "Recoverable" counts every 2024 game of that club we
do not yet cover, including postseason.

| Club | Already covered | Two-sided if obtained | Total recoverable |
|---|---|---|---|
| Connecticut Sun | 0 → in progress | 6 | 47 |
| Seattle Storm | 0 | 6 | 42 |
| Dallas Wings | 0 | 6 | 40 |
| Phoenix Mercury | 0 | 6 | 42 |
| Indiana Fever | 0 | 5 | 42 |
| Las Vegas Aces | 0 | 4 | 46 |
| Minnesota Lynx | 0 | 3 | 53 |
| Washington Mystics | 0 | 3 | 40 |
| Los Angeles Sparks | 0 | 3 | 40 |
| New York Liberty | 0 | 2 | 52 |

A caveat worth stating: "two-sided if obtained" assumes every one of that club's games validates.
Real yield is lower, because a single late-season document omits players who had already left. The
Sun archive is the first case where a club's *whole season* of snapshots is available, which is
exactly what closes that gap.

## D. Finalised requests — approved wording, NOT yet sent

Both are ready to send as written. Sender: Justin Erickson, PropTechUSA.ai / PropBetEdge, reply to
justin@proptechusa.ai. Neither asks for credentials, private or unpublished material, and neither
mentions automated collection.

### D1. Seattle Storm

**To:** media@stormbasketball.com
**Subject:** Request: Seattle Storm 2024 game notes archive

> Hello,
>
> I'm preserving a statistical record of WNBA basketball season by season, and I'm working through
> 2024 club by club. The Storm's game notes are one of the better public records of that year — the
> per-player game logs in them capture detail that is hard to reconstruct from anywhere else.
>
> Your game notes page publishes the current season, and I couldn't find a link to the 2024 edition.
> Would you be willing to share a link to the club's 2024 game notes archive, pregame or postgame
> PDFs, whichever the club keeps?
>
> I'm only asking for materials the Storm already published and are happy to share — nothing private
> or unpublished, and no access to any credentialed system. A public link or a folder share would be
> perfect.
>
> Happy to say more about the project if that's useful. Either way, thank you for keeping those notes
> as thorough as they are; they're genuinely valuable to anyone trying to preserve the record of a
> season.
>
> Best regards,
> Justin Erickson
> PropTechUSA.ai / PropBetEdge
> justin@proptechusa.ai

### D2. Dallas Wings

**To:** pflenke@dallaswings.com
**Cc:** cokeefe@dallaswings.com
**Subject:** Request: Dallas Wings 2024 game notes archive

> Hello,
>
> I'm preserving a statistical record of WNBA basketball season by season, and I'm working through
> 2024 club by club. The Wings' game notes are one of the better public records of that year — the
> per-player game logs in them capture detail that is hard to reconstruct from anywhere else.
>
> Media Central publishes the current season's notes, and I couldn't find a link to the 2024 edition.
> Would you be willing to share a link to the club's 2024 game notes archive, pregame or postgame
> PDFs, whichever the club keeps?
>
> I'm only asking for materials the Wings already published and are happy to share — nothing private
> or unpublished, and no access to any credentialed system. A public link or a folder share would be
> perfect.
>
> Happy to say more about the project if that's useful. Either way, thank you for keeping those notes
> as thorough as they are; they're genuinely valuable to anyone trying to preserve the record of a
> season.
>
> Best regards,
> Justin Erickson
> PropTechUSA.ai / PropBetEdge
> justin@proptechusa.ai

### D3. Reusable shape for later clubs

Minnesota is next after these two, then Washington and Los Angeles as lower-priority research
targets. The same body works for any club: swap the club name, and name the page you checked
(a club with a season-specific media page or a folder-based archive should have that referenced
directly, so the ask is concrete rather than generic).

## D4. Connecticut acquisition note — reproducible method

Worth recording precisely, because the same shape will recur: a club publishes a real archive behind
a link whose *listing page* is a JavaScript application, so the archive looks inaccessible to any
tool that reads HTML.

What failed: fetching the folder URL and parsing the returned page. Dropbox's web view renders its
file list client-side, so a plain fetch returns a shell with no file names in it. Reading that page
and concluding "cannot enumerate" was the wrong stopping point.

What worked, in order:
1. Start from the club's own notes page (`sun.wnba.com/notes`) and take the per-season link it
   publishes, rather than trying to guess CDN paths.
2. Request that link and **follow redirects**. Dropbox itself redirects a plain GET on a shared
   folder to its `zip_download_get` endpoint, which returns the entire folder as a zip. No
   credentials, no API, no access control involved — the share is public and the redirect is theirs.
3. Enumerate the zip locally. That yields the file list the web page would not give up: 47 PDFs
   named by date and opponent.
4. Extract with flattened names. The folder uses one directory per game (`9.8 @ LAS/Game 35 at
   LAS.pdf`), and on Windows a naive extract fails — `con` is a reserved device name, so any path
   containing it errors. Flatten to safe filenames on the way out.

Generalisation for future JavaScript-rendered public folders: treat the listing page as the wrong
surface. Ask whether the host offers a bulk endpoint the share link itself resolves to, follow the
redirect, and enumerate offline. If a host requires signing in to see the list, stop — that is an
access control, and the answer there is an email, not a workaround.

## E. Tracking table

| Club | Recipient | Subject | Request sent | Response | Archive obtained | Documents | Team-games unlocked | Two-sided | Ingest status |
|---|---|---|---|---|---|---|---|---|---|
| Connecticut Sun | n/a — public folder | n/a | n/a | n/a | **yes, 2026-09-18** | 47 available, 15 parsed | 2 loaded, 38 held | 1 | **partially ingested** |
| **Seattle Storm** | media@stormbasketball.com | Request: Seattle Storm 2024 game notes archive | **drafted, awaiting approval** | — | no | 0 | 0 | 0 | blocked on archive |
| **Dallas Wings** | pflenke@dallaswings.com (cc cokeefe@dallaswings.com) | Request: Dallas Wings 2024 game notes archive | **drafted, awaiting approval** | — | no | 0 | 0 | 0 | blocked on archive |
| Minnesota Lynx | acarlson@lynxbasketball.com | *(next after Seattle and Dallas)* | no | — | no | 0 | 0 | 0 | queued behind the first two |
| Washington Mystics | none published; Monumental Sports | — | no | — | no | 1 CDN document, probed: no player game log | 0 | 0 | lower-priority research target |
| Los Angeles Sparks | jquinn@la-sparks.com | — | no | — | no | 0 | 0 | 0 | lower-priority research target |
| Phoenix Mercury | — | — | closed | — | public, unusable | 1 | 0 | 0 | **closed under current format** — names are images |
| Indiana Fever | — | — | closed | — | reachable | 1 probed | 0 | 0 | **closed under current format** — no player game log |
| Las Vegas Aces | — | — | closed | — | reachable | 1 probed | 0 | 0 | **closed under current format** — no player game log |
| New York Liberty | — | — | closed | — | full index public | 1 probed | 0 | 0 | **closed under current format** — no player game log |

Sender for all requests: Justin Erickson, PropTechUSA.ai / PropBetEdge, reply to
justin@proptechusa.ai.

The Seattle and Dallas emails are **finalised and awaiting approval — nothing has been sent.**
Writing to a club is outward-facing, so it waits for an explicit go-ahead.

Order of work after those two: Minnesota, then Washington and Los Angeles as lower-priority research
rather than immediate requests. Phoenix, Indiana, Las Vegas and New York are closed under their
current formats and should not be re-probed; reopening one would need evidence that the format
changed, not another pass over the same documents.

## F. Standing constraints

`stats_wnba` remains prohibited and untouched. Reconciliation thresholds are intact and are not to be
relaxed to raise a coverage number. Roster stints remain underived. No Phoenix rows are loaded,
because none of them can be attributed to a canonical person.

Connecticut's 38 held team-games stay held. They are the club's eleven-player notes missing a twelfth
player who logged minutes, so loading them would publish a box score that looks complete and is not.
Points reconciling exactly is not sufficient on its own — that is precisely the case the minutes
check exists to catch.

Two gate corrections stand as approved: the minutes expectation no longer tests against the
unpopulated canonical `overtime_periods`, and non-participation markers (`DNP`, `DND`, `NWT`,
`Inactive`, `OUT- <reason>`, zero-minute dashed lines, not-yet-played dashed rows) are read as what
they are. Both changed how a source is interpreted; neither weakened what a row must satisfy to be
written.
