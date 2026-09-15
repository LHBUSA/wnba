# International / identity source + rights audit (women's basketball history)

Date: 2026-09-15. Read-only. HTTP GETs only (plain curl UA or WebFetch), no sign-ups, no header spoofing, no challenge bypass. Evidence files: `pages/`, `robots/`, `*.json`, `*.rq` in this directory.

## Method notes that affect the findings

- ESPN `site.api.espn.com` returned **403 to a descriptive custom UA** (`PBE-research-audit/1.0`) but **200 to the default curl UA**. ESPN filters by UA. Robots.txt on all three ESPN API hosts returns an Akamai 403, and www.espn.com reset the connection, so ESPN robots is NOT VERIFIED.
- `www.fiba.basketball` returns "The request is blocked" (403) to curl on every path, robots.txt included. WebFetch could read it.
- Proballers, Eurobasket.com, RealGM's terms page and olympics.com block or time out for non-browser clients. None of them were retried with other headers.
- Wikidata: an early burst of `wbsearchentities` calls hit 429 (Retry-After 1000 s). After waiting, single SPARQL queries worked. Slow down next time.

## 1. Source table

| Source | Coverage (verified) | Granularity | IDs | Acquisition | Robots | Terms (quote + URL) | Risk |
|---|---|---|---|---|---|---|---|
| **ESPN JSON: `fiba` (id 53)** | Seasons listed: 2014, 2023, 2026. 2014 and 2023 have **0 events** (empty men's placeholders). **2026 Women's World Cup: 36 events + knockouts.** **2018 and 2022 Women's World Cups are ABSENT** (no season; scoreboard empty on tournament dates). League object says `gender: MALE` even though it serves the women's event. | Box score (14 cols incl. +/-). PBP present on some games (401917256: 344 plays), missing on others (401907392: 0). | event, athlete, team ids. **Athlete ids are global across ESPN leagues** (Collier 3917450 is the same in `fiba` and `wnba`). | Public JSON (`site.web.api`, `sports.core.api`) | NOT VERIFIED (403 / reset) | Disney ToU §2.B: may not "access, monitor, copy or extract the Disney Products using a robot, spider, script, or other automated means", incl. "data mining or web scraping or otherwise compiling, building, creating or contributing to any collection of data, data set or database". §2.B.viii bars "any commercial or business-related use". https://disneytermsofuse.com/english/ | **HIGH** (by the brief's rubric) |
| **ESPN JSON: `womens-olympics-basketball` (id 3767)** | Seasons 2016, 2020, 2024 only (2016: 35 events in type 2, plus medal games 400901119/20 on the scoreboard; 2020: 26; 2024: 26 + finals 401694857/8). **2012, 2008 and 2004 return nothing.** | Box score + PBP (2016: 310 plays; 2021: 339; 2024: 379). Earliest box score: **Rio 2016**. | Same global athlete ids. Athlete record has DOB and birthPlace. | Public JSON | NOT VERIFIED | Same Disney ToU | **HIGH** |
| **ESPN: other intl women's comps** | Full basketball league list (core `leagues?limit=200` = 15, and the dropdown list) has **no** EuroBasket Women, AmeriCup, Asia Cup, AfroBasket, EuroLeague Women or WNBL. Guessed slugs return 400 on core. `nbl` is the men's Australian league. | — | — | — | — | — | n/a |
| **FIBA archive** (`archive.fiba.com`) | **Retired.** CNAME is `redirection-service.fiba.basketball`. HTTP root is a 12-byte page. Legacy archive paths 404. HTTPS cert does not match the host. | — | Wikidata P3542 (archived) still usable as a key | none | n/a | — | **Do-not-use** (dead) |
| **fiba.basketball history + event pages** | History index covers Women's World Cup 1953–2026 (+2030), Women's EuroBasket, AmeriCup, Asia Cup, AfroBasket. Edition pages show **host + medalists only**. Event pages for current events carry games, box scores and stats. Game-level depth for past editions is NOT VERIFIED (the 2018 WWC `/games` URL was a 404). | Medal table; box scores on modern event pages | edition id (`/history/306-…/2524`), game id (`/games/128379-GALA-FENER`), Wikidata P12338 / P14814 | HTML (curl 403 "request is blocked"). Structured feed is GDAP (paid key) or Genius (403), both already rejected. | `User-agent: *` disallows only auth routes; sitemaps for en/fr/es | §4: "Content may not be reproduced or modified in any way without prior permission from the relevant right holder." No specific scraping clause. https://www.fiba.basketball/en/terms-and-conditions | **HIGH** |
| **EuroLeague Women** | `euroleaguewomen.basketball` now points to FIBA's redirection service (TLS mismatch). Live site is `fiba.basketball/en/events/euroleague-women-25-26`: schedule, results, game pages, stat leaders, standings. Historical depth NOT VERIFIED. | Box score / season leaders | FIBA game ids, team slugs. Wikidata has **no EuroLeague Women id** (P3536 euroleague.net is men's: 0 of the WNBA humans have it). | HTML (curl 403); feeds via GDAP/Genius (rejected) | as FIBA | as FIBA §4 | **HIGH** |
| **Olympedia** | Women's basketball: **all 13 editions, 1976–2024** (`/event_names/122`). Match pages list officials and attendance. | **Player box scores back to 1976** (1976: PTS, FG, FT, REB O/D, AST, TOV, PF; 2024 adds 2P/3P, STL, BLK, +/-, positions, coach) | `/athletes/{n}`, `/results/{n}`; Wikidata P8286 | HTML only, no API or dump | `User-agent: *` / `Crawl-delay: 10` (everything allowed) | No license or terms page. Footer "© OlyMADMen 2006 — 2026". About page: data "is the product of years of work by a group of dedicated Olympic historians and statisticians." https://www.olympedia.org/static/about | **MEDIUM** (no license; compiled-database rights plausible) |
| **olympics.com** | NOT VERIFIED (curl and WebFetch both timed out, robots included) | NOT VERIFIED | Wikidata P5815 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| **Wikidata** | Identity graph: 1,314 humans with WNBA.com id (see §2) | Identity facts: DOB, country for sport, external ids | QID + external-id properties | SPARQL (query.wikidata.org), API, full JSON dumps | query.wikidata.org robots disallows `/sparql` for crawlers. Direct API use is normal and needs a descriptive UA. | "All structured data in the main, property and lexeme namespaces is made available under the Creative Commons CC0 License"; "text in other namespaces is made available under the Creative Commons Attribution-ShareAlike 4.0 License". https://www.wikidata.org/wiki/Wikidata:Licensing | **LOW** |
| **Wikipedia (text)** | Prose bios | Text | — | API / dumps | — | "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License" (page footer) | LOW for facts; copying prose triggers BY-SA |
| **Basketball-Reference (WNBA)** | WNBA 1997→ (1997 schedule links to box scores, e.g. `/wnba/boxscores/199706210CLE.html`) | Box scores, season stats; game logs/splits paths robots-disallowed | slug ids `/wnba/players/x/…`; Wikidata P4561 | HTML | `Crawl-delay: 3`; disallows `*/gamelog/`, `*/splits/`, `*/lineups/`, `*/shooting/`, `/play-index/*.cgi?*`; GPTBot blocked | ToU: may not "use any automated means to access or use the Site, including scripts, bots, scrapers, data miners" without express written permission. Also bars data used "to create any database, archive, or other data store that competes with or constitutes a material substitute", and AI training/prompting. Data Use page: custom data from **$5,000 minimum**. https://www.sports-reference.com/termsofuse.html · https://www.sports-reference.com/data_use.html | **HIGH** |
| **stats.wnba.com / WNBA.com** | WNBA official stats | Box, PBP, season (not probed further) | WNBA person id (Wikidata P3588) | `stats.wnba.com/stats/*` **hung 25 s with no response to plain curl**; it only answers browser-like headers, which would be disguise. www.wnba.com robots: Akamai 403. | stats.wnba.com: `User-agent: *` with no disallows | §9 "NBA STATISTICS": "may only be used, displayed, or published for legitimate news reporting or private, non-commercial purposes"; "may not be used in connection with any gambling activity (including legal gambling activity)"; not with any "database… of comprehensive, regularly updated statistics". https://www.wnba.com/terms-of-use | **HIGH** (the gambling clause hits PropBetEdge directly) |
| **Her Hoop Stats** | WNBA + NCAA women (site). Paid subscription ("Sign Up… signuppay"). | Season/game (behind paywall) | none on Wikidata (no property exists) | Paid web app | `User-agent: *` / `Disallow: /` (only named search engines allowed) | ToS page not found (`/stats/terms_of_service` 404): NOT VERIFIED | **HIGH** (robots-banned + paid) |
| **Proballers** | Global men's + women's pro leagues (per site description) | NOT VERIFIED | Wikidata P8548 | HTML; 403 to curl and WebFetch | Blocks ClaudeBot, anthropic-ai, GPTBot, CCBot etc. with `Disallow: /` | Terms page (`/page/1-terms`) 403: NOT VERIFIED | **HIGH** (access blocked) |
| **RealGM** | WNBA, NCAAW news/player sitemaps, international | Player pages | Wikidata P3957 | HTML (homepage 200; terms page 403) | `crawl-delay: 2`; `anthropic-ai`, `Claude-Web`, `CCBot` `Disallow: /` | Per search snippet (direct fetch 403): no "automated code, program, system or other means of browsing and/or extracting data"; use must be "by click-by-click selections directly by a human being"; no commercial use without written permission. https://basketball.realgm.com/info/terms-of-use | **HIGH** |
| **Eurobasket.com / Latinbasket** | Women's league pages exist (e.g. LFB `?women=1`, Russia Premier League Women); claims 940k+ profiles; subscription tiers | NOT VERIFIED | Wikidata P3527 | HTML; 403 to curl and WebFetch | robots `Allow: /`, Crawl-delay 1 (latinbasket robots 404) | Per search snippet of site pages: "Do not copy, redistribute, publish or otherwise exploit information that you download from the site!" | **HIGH** |
| **Spain Liga Femenina (FEB)** | `baloncestoenvivo.feb.es` live-stats portal (200) | Box depth NOT VERIFIED | NOT VERIFIED | HTML | www.feb.es: only a Mediapartners rule (no general disallow) | Aviso Legal §5: "quedan expresamente prohibidas la reproducción, la distribución y la comunicación pública… de la totalidad o parte de los contenidos… con fines comerciales… sin la autorización del Titular". https://www.feb.es/avisoLegal.html | **HIGH** (commercial) |
| **France LFB** | Official site is basketlfb.com (per search). **Connection failed from here.** `lfb.fr` is an unrelated pharma group. | NOT VERIFIED | Wikidata **P4382 LFB player ID** | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| **Turkey KBSL (TBF)** | tbf.org.tr has league + player-detail pages (`/ligler/kbsl-2025-2026/basketbolcu-detay/270183`, per search) | Stats pages (per search) | TBF player id in URL | **Cloudflare JS challenge ("Just a moment…")** on robots and pages | Challenge page | NOT VERIFIED | **HIGH** (bypass needed) |
| **Australia WNBL** | wnbl.com.au (200) | Stats provider NOT VERIFIED | NOT VERIFIED | HTML | `User-agent: *` `Disallow:` (all allowed) | "for your personal use only"; "not permitted to publish, manipulate, distribute or otherwise reproduce, in any format, any of the content"; no "commercial purpose". https://www.wnbl.com.au/terms-and-conditions | **HIGH** |
| **China WCBA** | No official WCBA stats site found. cba.net.cn returns 200; its WCBA stats are NOT VERIFIED. | NOT VERIFIED | Wikidata P13375 (CBA player id, scope NOT VERIFIED) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| **Italy LBF** | legabasketfemminile.it (timed out for curl) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | `*` allowed, but **ClaudeBot / anthropic-ai / GPTBot / CCBot are disallowed from `/it/atlete/`, `/en/players/`, team pages** | NOT VERIFIED | **HIGH** (player pages barred to AI agents) |
| **Russia Premier League (women)** | League still runs; FIBA suspension (since Mar 2022) extended to at least Feb 2026 (Izvestia, 2025-12-05). No official site reached. | NOT VERIFIED | — | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED; sanctions exposure for any paid or contractual relationship | **HIGH** (legal/availability) |
| **Unrivaled (US)** | unrivaled.basketball | NOT VERIFIED | NOT VERIFIED | HTML | Disallows only /admin, /in-venue, /kiosk, /media, /staff | §8: will not "monitor, gather, copy, or distribute the Content… by using any robot, rover, 'bot', spider, scraper, crawler…"; no "commercial purpose". https://www.unrivaled.basketball/legal/terms-of-use | **HIGH** |
| **Athletes Unlimited Basketball** | auprosports.com; season stats published as **PDF** season review and media guide (2025) | Season/leaderboard PDFs; box scores NOT VERIFIED | NOT VERIFIED | PDF/HTML | WordPress default (only admin/cart disallowed) | NOT VERIFIED | **MEDIUM** (terms unread) |

## 2. Wikidata crosswalk properties + coverage

Property ids come from one SPARQL label scan (`q_props.rq`, 200 OK).

| Need | Property | Note |
|---|---|---|
| WNBA.com player ID | **P3588** | anchor |
| Basketball-Reference WNBA player ID | **P4561** | |
| B-Ref NBA player / G League / intl / NBL | P2685 / P4744 / **P4790** / P4796 | P4790 = non-US leagues |
| Sports-Reference college basketball player ID | **P3696** | "NCAA Division I" (the description does not say whether women's players are in scope) |
| FIBA player ID | **P3542** (archive.FIBA.com, archived) · **P12338** (FIBA.basketball people) · P9766 (3x3) · P8712 (Hall of Fame) · P14814 (event) | |
| EuroLeague/EuroCup player ID | P3536 euroleague.net | **no women's EuroLeague property** |
| Olympedia athlete ID | **P8286** | also P9055 event |
| Olympics.com athlete ID | **P5815** | P3171 olympic.org archived |
| ESPN athlete ID | **none for WNBA/women's basketball**; P3685 = ESPN.com NBA only | gap |
| Her Hoop Stats ID | **none exists** | gap |
| Proballers ID | **P8548** | |
| RealGM player ID | **P3957** | |
| Eurobasket.com player ID | **P3527** | |
| LFB player ID | **P4382** | women's-specific |
| Women's Basketball Hall of Fame ID | P4410 | |
| Women's Japan Basketball League ID | P5958 | |
| Date of birth | **P569** | |
| Country for sport | **P1532** | |

**SPARQL coverage** (humans `P31=Q5` with P3588; `count.json`, `count2.json`, `count3.json`; run 2026-09-15 ~22:16Z):

| Metric | Count |
|---|---|
| Humans with WNBA.com id (1,314 rows = 1,314 distinct ids, no duplicates) | **1,314** |
| + B-Ref WNBA (P4561) | 1,310 |
| + RealGM (P3957) | 1,314 |
| + any FIBA (P3542 ∪ P12338) | 1,217 (P12338: 1,217; P3542: 468) |
| + Eurobasket.com (P3527) | 1,118 |
| + SR college bb (P3696) | 1,113 |
| + Proballers (P8548) | 955 |
| + country for sport (P1532) | 928 |
| + Olympedia (P8286) | 277 |
| + FIBA ∧ Olympedia ∧ B-Ref WNBA | 276 |
| + B-Ref international (P4790) | 256 |
| + LFB (P4382) | 212 |
| + Olympics.com (P5815) | 176 |
| + Women's BB HoF (P4410) | 55 |
| + euroleague.net (P3536) | 0 |
| + ESPN NBA (P3685) | 1 |
| + DOB (P569) | 1,312 |

RealGM and P12338 coverage look like bulk imports. Spot-check a sample before trusting them as truth.

**Why structured facts and text are treated differently:** Wikidata statements (ids, DOB, country for sport) are CC0, so we can store and republish them with no attribution or share-alike. Wikipedia prose is CC BY-SA 4.0, so copying bios means attribution and share-alike on the derived text. Use Wikidata as the identity layer. Never paste Wikipedia text into product copy. Holding a third-party id (e.g. a B-Ref slug) obtained from CC0 Wikidata is fine. Fetching that third party's pages to fill in stats is still governed by its own terms.

## 3. Recommended use

- **ESPN `fiba` / `womens-olympics-basketball`**: **primary for coverage, but flagged.** Only WWC 2026 and Olympics 2016/2020/2024 exist; there is no WWC 2018/2022 and nothing before 2016. Disney ToU §2.B expressly bans automated extraction and database building, which conflicts with the "LOW" posture implied by current use. **Owner decision needed.** ESPN athlete ids are global, which helps linking to WNBA rows. Wikidata has no ESPN women's id, so link by our own ESPN↔WNBA join.
- **archive.fiba.com**: **do-not-use** (dead). Keep P3542 values as **crosswalk-only** keys.
- **fiba.basketball (history, event pages, EuroLeague Women)**: **reference-only** (manual verification of medalists and rosters). No automated collection: §4, plus 403 to non-browser clients.
- **Olympedia**: **reference-only now; best historical candidate.** Unique 1976–2024 player box scores. Ask OlyMADMen for written permission before any bulk ingest. If permitted, obey Crawl-delay 10. Use P8286 as the crosswalk.
- **olympics.com**: NOT VERIFIED; do not use until terms are read. P5815 is **crosswalk-only**.
- **Wikidata**: **primary identity crosswalk** (CC0): P3588 anchor → P4561 / P12338 / P3542 / P8286 / P5815 / P4382 / P3527 / P3957 / P8548 plus P569 / P1532. Use dumps or throttled SPARQL with a descriptive UA.
- **Wikipedia text**: **reference-only** (no copying prose).
- **Basketball-Reference / Stathead**: **crosswalk-only** (id via Wikidata). Do not scrape. Any stats licence is paid ($5k+ custom), so it needs owner approval.
- **stats.wnba.com / WNBA.com**: **do-not-use** for this project. The §9 gambling and commercial-database clauses apply, and access needs browser-emulating headers.
- **Her Hoop Stats**: **do-not-use** (robots `Disallow: /`, paid).
- **Proballers, RealGM, Eurobasket.com**: **crosswalk-only** via Wikidata ids. Never fetch (blocked to our agent class, or terms bar automation).
- **FEB, WNBL, Unrivaled**: **reference-only** (terms bar commercial reuse or automation). A licence would need owner approval.
- **LFB**: **crosswalk-only** via P4382. Site and terms NOT VERIFIED.
- **TBF (KBSL)**: **do-not-use** automated (Cloudflare challenge); manual reference only.
- **LBF Italy**: **do-not-use** player pages (robots bars Claude agents); other pages NOT VERIFIED.
- **WCBA**: NOT VERIFIED, no source identified.
- **Russia**: **do-not-use** (sanctions and suspension exposure; nothing verified).
- **Athletes Unlimited**: **reference-only** pending a terms read (PDF season stats).
