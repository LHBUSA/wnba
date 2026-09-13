# WNBA search-native publishing architecture

Status: shipped with `wnba-web` 1.0.0 and `wnba-briefs/1.1.0`.
Reference: LHBUSA/UFC `docs/UFC_SEO_SHARE_METADATA_ADDENDUM.md`. The principles were ported, not the code; UFC is a Next.js server-rendered app.

## 1. Audit before this change (production, 2026-09-13)

Every route returned the same 2.5 KB SPA shell before JavaScript ran:

- `/`, `/news`, a real `/news/:slug`, `/players/:id`, `/teams/:id`, `/matchups/:id`, `/injuries`, `/standings` and `/props` all had:
  - the same `<title>`
  - `canonical = https://wnba.propbetedge.ai/` on every page, which declared every page a duplicate of the homepage
  - no H1, no body copy, no JSON-LD
  - the default OG image
- `/sitemap.xml`, `/news-sitemap.xml` and `/rss.xml` returned the HTML shell with status 200.
- Unknown URLs (`/news/nope-abcdef`, `/players/999999999`, `/nonsense`) returned 200, which are soft 404s.
- `/news/` and `/players/:id/` returned 200 duplicates; there was no trailing-slash redirect.
- `robots.txt` was `Allow: /` with no sitemap.

## 2. Decision

We added a Cloudflare publishing Worker, `wnba-web`, behind Vercel external rewrites. It renders the **same shared views** the SPA uses. Vercel Functions and a Next.js rewrite were both ruled out.

```
browser / crawler ──► wnba.propbetedge.ai (Vercel)
                         │ static file exists? (assets, media, fonts, share, robots.txt, app-shell.html) → served by Vercel
                         └ otherwise rewrite ──► wnba-web.sales-fd3.workers.dev (Cloudflare)
                                                   ├ HTML routes: renderRoute() → composeDocument(app-shell.html)
                                                   ├ /sitemap.xml /news-sitemap.xml /rss.xml
                                                   └ /og/{news|players|teams|matchups}/:id.png (satori + resvg)
                                                         ▲ service bindings: API = wnba-api, NEWS = wnba-news
```

**Why this design:**
- **It keeps the doctrine.** Vercel remains presentation only and serves static files. Cloudflare remains runtime. There is no Vercel Function and no GitHub Actions scheduling (`guard-truth` still enforces this).
- **Crawlers and readers get the same content.** Each indexable page is a pure `view(data)` in `src/views/*`. The SPA page module loads data and calls the view; the Worker loads the same data through a service-binding twin of `src/data/api.js` (`workers/wnba-web/src/api.js`) and calls the identical view. There is no separate crawler version.
- **It avoids a rewrite.** The SPA, its router and its pollers are unchanged in behavior.

**Smallest reliable pieces:**

| Piece | File |
|---|---|
| Route table (one path authority) | `src/lib/routes.js` |
| Route metadata (title, description, canonical, robots, OG) | `src/seo/meta.js` |
| JSON-LD graph | `src/seo/jsonld.js` |
| Head tags | `src/seo/head.js` |
| Sitemaps and RSS | `src/seo/feeds.js` |
| Site shell as HTML (`shellHtml`) | `src/ui/shell.js` |
| Build step publishing `dist/app-shell.html` | `scripts/publish-shell.mjs` |

On Vercel the build step removes `index.html`, so `/` reaches the rewrite; a static `index.html` would win over it.

**Hydration handoff.** The server puts page content in `<main data-ssr-path>`. On first load the router mounts the live page into a hidden, layout-neutral wrapper (`.ssr-live`). It swaps that wrapper in once the page has real content (no `.skel` left), with a 10 s ceiling. Readers never flash from the published story to a skeleton. Client-side navigations behave as before and apply `routeMeta()`.

**Status codes and URLs:**
- 200 for pages with data.
- 404 with `noindex, follow` for unknown routes, articles, players, teams, games and desks.
- 503 with `noindex` and `no-store` when an upstream is down.
- 301 from a collapsed duplicate article URL to its canonical story.
- `trailingSlash: false` in Vercel, plus a 301 in the Worker.
- Canonicals never carry query strings.
- An empty desk page is `noindex, follow`.

**Caching:**

| Resource | Cache-Control |
|---|---|
| HTML | `s-maxage=60, stale-while-revalidate=300` |
| RSS and general sitemap | 300 s |
| News sitemap | 120 s |
| Share cards | immutable when versioned (`?v=` from revision/origin time); also stored in the Worker Cache API |

Vercel honors upstream caching through `x-vercel-enable-rewrite-caching: 1`.

**Failure modes:**
- If a render throws, the Worker serves the plain shell with a 503; the SPA still boots.
- If a share card fails, the Worker 302-redirects to the approved static image.
- If `wnba-web` itself is down, HTML routes fail while static assets still load. This is the same dependency class as the data Workers the SPA already needs.
- **Rollback:** restore `vercel.json`'s `/(.*) → /index.html` rewrite and drop the `VERCEL` removal in `publish-shell.mjs`, or roll the Vercel deployment back.

## 3. Surfaces

### `/sitemap.xml`
- **Contents:** static routes; desk pages that currently have stories; every canonical live article; teams; players; games within ±14 days.
- **`lastmod`:** only real content dates (article origin or revision). Never build time.
- **Excluded:** superseded and duplicate stories, query strings, preview hosts.

### `/news-sitemap.xml`
- **Eligibility:** canonical articles whose **`first_published_at`** is within 48 h. Not `revised_at`, not `source_updated_at`, not the Worker run time. A revision never re-qualifies a story.
- **Fields:** `news:publication` is `PropBetEdge WNBA`, language `en`; `news:publication_date` is `first_published_at`.

### `/rss.xml`
- **Items:** the latest 50 canonical PBE articles.
- **Dates:** `pubDate` is `first_published_at`; `atom:updated` appears when a story has been revised.
- **Description:** the PBE deck. Publisher bodies are never included.
- **Discovery:** `<link rel="alternate">` in every page head.

### `/robots.txt`
- `Allow: /`
- `Disallow: /app-shell.html` (the shell is also served with `X-Robots-Tag: noindex`)
- Both sitemaps declared.

## 4. Structured data

There is one `@graph` per page. The stable entities are always present:

| Entity | `@id` | Details |
|---|---|---|
| `Organization` | `https://propbetedge.ai/#org` | |
| `NewsMediaOrganization` | `…/#newsroom` | publishing, corrections, ethics and verification policies point at the trust pages |
| `WebSite` | `…/#website` | |

Page entities:

| Page | Schema |
|---|---|
| Article | `WebPage` + `NewsArticle` |
| Player | `ProfilePage` + `Person` |
| Team | `WebPage` + `SportsTeam` |
| Matchup / WNBACast game | `SportsEvent` |
| Newsroom and desk pages | `CollectionPage` + `ItemList` |
| `/about` | `AboutPage` |

Every page also gets a `BreadcrumbList`.

**`NewsArticle` fields:**
- `headline` (≤110 characters; the full headline goes in `alternativeHeadline`), `description`
- `image`: the share card plus the licensed photo, with `creditText` and `license`
- `datePublished` is `first_published_at`; `dateModified` is `revised_at` when later, otherwise equal to `datePublished`
- `author` and `publisher` are the newsroom
- `mainEntityOfPage`, `articleSection`, `wordCount`
- `about` is the lead player/team (or the game for previews); `mentions` are the other linked entities
- `citation` lists the evidence URLs

Nothing is invented to fill a property: an absent fact is an absent property, and `null`/`undefined` values are stripped.

**`SportsEvent` status:** only Scheduled, Postponed or Cancelled from the source status. There is no invented "completed".

## 5. News Brief editorial model (`wnba-briefs/1.1.0`)

**Headline.** An original PBE headline from the event type and verified identity, e.g. "Carla Leite in focus for the Portland Fire: the report and her season in numbers". The publisher's exact headline is attributed in the deck ("Swish Appeal published “…”.") and in the evidence.

**Body sections:**
1. **What happened** — attributed.
2. **What PropBetEdge can verify** — from the game log (with a year-labelled season provenance), injury feed, transactions log and standings.
3. **Why it matters** — only what those records support: minutes role, listing timing.
4. **What comes next** — next scheduled game, and which record to watch.

**Method layer.** The source-rights and story-identity text moved out of the body into `method`, which renders in the trust layer.

**Gates unchanged.** Every brief still passes `gate.js` (number classes, quotation discipline) and `reconcile.js` (R1 season provenance, R7 comment shingles).

**Identity unchanged.** The id is still `hash('brief', cluster_id)`. Structured-context changes are revisions of the same story.

## 6. Share cards

- **Size:** 1200×630 PNG, rendered at the edge.
- **Fonts:** bundled TTF files of the site's own OFL fonts (Newsreader, Barlow Condensed, Inter).
- **Photo cards:** built on the approved, pre-composed newsroom `og.jpg`. Subject framing, crop and printed credit come from `scripts/media/newsroom_media.py`; no new crops are invented.
- **Card types:**
  - Article: desk and PBE headline.
  - Player: name, team, position, and a year-labelled regular-season line from the game log.
  - Team: name and record.
  - Matchup: both teams, date/time or final score, venue. Team names and colors only; no team marks.
- **Never shown:** odds, lines, probabilities or model numbers.
- **Alt text:** meaningful `og:image:alt` from the headline or entity.
- **Fallback:** a player without an approved photo gets the deliberate default share image, never a stand-in.

## 7. Trust pages

`/about`, `/editorial-policy`, `/corrections`, `/methodology` and `/sources` (the static registry sits above the live canary). They are linked from the footer, the article trust layer and the newsroom "How we write" block.
