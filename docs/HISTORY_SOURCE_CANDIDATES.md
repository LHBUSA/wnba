# Licensable sources for women's basketball history — candidate register

Owner instruction 8 (2026-09-15): keep researching legitimately usable sources for 1997–2001 WNBA, 2002+ box scores/PBP, Olympic women's basketball, and awards/history, recording exact rights, commercial/database/redistribution restrictions, historical depth, fields, pricing, and whether gambling use is permitted.

**Nothing in this document changes a `wbh_sources.rights_state`.** Every source below stays at whatever state the registry currently holds until the owner decides. Two findings here disagree with a state already recorded on 2026-09-16, and that disagreement is written down rather than resolved unilaterally.

Method: read-only web research on 2026-09-18 (search + fetching public terms and pricing pages). No dataset was fetched, nothing was signed up for. **VERIFIED** = the clause was read directly on the source's own page. **NOT VERIFIED** = inference, marketing copy, search snippet, or an unreachable page. I did not personally re-read every clause below; the verification marks are the researcher's and should be re-checked by whoever signs a contract.

## The finding that matters most

**Every "official" route is a rented feed, not an archive.** Sportradar's terms require the client, on termination, to "cease all use and distribution... promptly return to Sportradar or destroy all data and databases relating to all Historical Data in its possession" (§4.5, VERIFIED), and separately bar derivative works and databases (§2.3(i), VERIFIED). WNBA statistics distribution is contractually held by Sportradar and Genius Sports/Second Spectrum, so the league route collapses into those two. Paying an enterprise price would therefore buy access we must delete on exit — structurally incompatible with the owner's goal that "the archive itself has to be ours legally and structurally, not a dependency disguised as our database."

Two further hard limits on the official route: Sportradar's WNBA coverage starts at **2015** (official from 2017) and Genius Sports' WNBA deal starts at **2024**. Neither touches 1997–2001, or even 1997–2014.

## Candidate table

| Source | Commercial DB build | Gambling use | WNBA depth | Price | Confidence |
|---|---|---|---|---|---|
| Sportradar | **Forbidden** (§2.3(i)); destroy on termination (§4.5) | **Separate written approval** required (§2.10) | 2015+ | not published (~$10k/mo, unverified) | VERIFIED terms |
| Genius Sports | contract unpublished; site ToU bars commercial use without licence | core business, eligibility unclear | 2024+ (optical tracking) | not published | partly verified |
| Stats Perform / Opta | no readable terms found | no WNBA rights claim found at all | unknown | not published | NOT VERIFIED |
| Gracenote (Nielsen) | terms pages errored | marketing hints at betting platforms | unknown | not published | NOT VERIFIED |
| SportsDataIO | redistribution barred outside licence | **permitted** — betting operators are a named paid class | start year not published | quote-only + low-cost self-serve tier | partly verified |
| API-Sports | disclaims rights; customer must clear them | flagged as possibly needing a rights-holder licence | unknown | free tier ~100 req/day | NOT VERIFIED (site unreachable) |
| WNBA / NBA league | no data-licensing desk exists | see Sportradar / Genius | — | — | VERIFIED there is no retail route |
| Olympedia | **licence-silent** (© OlyMADMen, no grant, not public domain) | not addressed | Olympic tournaments only, 1976+ | free to browse | VERIFIED silent |
| IOC / Olympics.com | written IOC licence required | not addressed | Olympic only | enterprise | partly verified |
| balldontlie | ToS §6 permits creating "databases"; bars competing products and resale of unmodified data | **explicitly permitted**: "lawful sportsbook and wagering products" | not verified | not published | VERIFIED clause |
| TheSportsDB | permissive; bars reselling the API | **silent** | **2010–2026 only**, visible gaps | $9/mo | VERIFIED |
| Newspapers.com + Wikidata | facts re-keyed by a human are outside any site contract | n/a | 1931–present / season-level | $19.90/mo | VERIFIED price |

## Two disagreements with the current registry

1. **balldontlie is registered `unresolved`** on the strength of "You may not use Data to create or operate products or services that compete with us." This research read the same ToS §6 and found it also says, verbatim, that you may "use, copy, cache, store, archive, modify, combine, analyze, publish, display, distribute, sublicense, and create derivative works, products, services, **or databases** from Data," with named permitted uses including "**lawful sportsbook and wagering products**." That is the only affirmative gambling permission found anywhere in this research. The competing-products clause is still undefined in the document, so the fail-closed call was defensible — but the question is now narrow and answerable in one email rather than open-ended. Recommend asking it. Do not change state before an answer in writing.
2. **Olympedia's registry note says it "publishes no licence."** Accurate but too soft. The site carries "© OlyMADMen 2006–2026" with no grant language, and a co-founder is quoted confirming the database was never an official IOC product and that the 2020 public release was permission to *access*, not a transfer of rights. Silence plus a copyright notice is not an open licence. D4 (request written permission) remains the only route; the note should be tightened when a migration next touches it.

## Confirmed trap: do not import

**fivethirtyeight/WNBA-stats** (GitHub and its Kaggle mirrors) states in its own README that the 1997–2019 player advanced stats come from Basketball-Reference — a source we have already ruled prohibited. A permissive licence on the wrapper repo does not cure the chain of title. The same caution applies to every Kaggle WNBA upload whose provenance has not been traced: treat as laundered until proven otherwise, not the reverse.

**API-Sports** shows the reseller tell: "it is the responsibility of the user to verify and obtain any necessary authorizations," with responsibility declined. A vendor that has cleared its rights does not write that sentence.

## Why most of these restrictions are contracts, not copyright

Worth stating plainly because it changes what our options actually are. Scores, dates, rosters and statistics are facts, and facts are not copyrightable in the US (*Feist*). ESPN, Basketball-Reference and stats.wnba.com are therefore not asserting copyright over the numbers — they bind us through **contract** (terms we accept by using the service). Sui generis database rights are a separate EU/UK regime, relevant as background for Sportradar (Swiss) and Genius/Stats Perform (UK), not a direct US concern for us.

The practical consequence: a fact a human reads in a legally-accessed newspaper scan and re-keys into our database is not governed by any API vendor's contract, because we never entered into one for that fact. That is why the manual route below is the *cleanest* legal posture available, not a fallback.

## The 1997–2001 gap

No vendor covers it. Sportradar starts 2015, TheSportsDB 2010, Genius Sports 2024. League media guides are unavailable online before 2010, and the archive.org WNBA guide is borrow-only under controlled digital lending. Wikidata's 1997 season item is season-level only — teams, dates, champion — with no box scores.

The realistic path is therefore **labour, not licensing**: Wikidata (CC0) for the free skeleton of teams, dates and draft classes, plus a ~$20/month newspaper archive subscription and a human transcribing box scores for five seasons. Budget it as a research task with a defined scope, and get a one-time legal read on how systematic that transcription can become before it starts to look like bulk extraction rather than reading.

## Recommended next actions (owner decisions)

1. **Send the balldontlie question**: does an internal historical WNBA database powering our own betting-analytics product "compete with" them under §6, and does exposing derived stats through our own API change the answer? One email; the answer either unblocks a real 2002+ source or closes it for good.
2. **Send the TheSportsDB question**: their terms are silent on gambling use. Ask for it in writing. Even if answered yes, they only cover 2010+ with visible gaps, so this is a supplement, never a spine.
3. **Send the Olympedia permission request** (D4, still outstanding).
4. **Decide whether to fund the 1997–2001 transcription project** — the only route to that era that we would actually own.
5. **Do not pursue** Sportradar, Genius Sports or the league route for the archive. They can be revisited if we ever want a live licensed feed, but they cannot produce an owned historical database at any price.

Sources that could not be verified and would need a live sales conversation rather than more research: Gracenote (both terms pages errored), API-Sports (unreachable), Stats Perform's WNBA rights status (no partnership announcement found), and every enterprise vendor's pricing.
