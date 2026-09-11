# PropBetEdge WNBA — Claude Master Execution Brief

Owner direction: build `wnba.propbetedge.ai` as a first-class PropBetEdge product using the strongest principles already proven in NBA/UFC/NFL/NHL. Work from `main`; do not create a long-lived preview architecture. Use previews only as QA surfaces. Production runtime topology is non-negotiable unless the owner explicitly changes it.

## 0. Architecture doctrine

**GitHub = source / backup**
**Vercel = frontend presentation**
**Supabase = durable data / system of record**
**Cloudflare = intelligence + runtime**

In practical terms:
- Cloudflare Workers own APIs, provider mediation, normalization, auth-sensitive operations, model/read services and news ingestion.
- Cloudflare Queues / Workflows / Cron own asynchronous and scheduled processing.
- KV/R2/D1 may be used where their edge/storage semantics fit; durable application records belong in Supabase unless there is a documented reason otherwise.
- Vercel serves the WNBA frontend. Do not make Vercel Functions the backend.
- GitHub Actions are tests/CI only. Do not schedule production ingestion or runtime there.
- Browser code never holds privileged provider/Supabase/Stripe secrets.
- Production must be reconstructible from Git + Supabase + Cloudflare/Vercel configuration.

## 1. Product goal

Build the best independent WNBA betting/research intelligence experience we can ship truthfully. WNBA should feel native to the league and audience, not like NBA with the logo swapped.

Strategic role:
- focused niche where PropBetEdge can earn search/community share quickly;
- standalone recurring-revenue vertical;
- natural top-of-funnel into `nba.propbetedge.ai` and the wider PropBetEdge network;
- reusable proving ground for basketball intelligence shared at the method/component level, not at the league-data level.

Core loop:
`DISCOVER → RESEARCH → PRICE → DECIDE → WATCH → ALERT → GRADE → REPLAY → LEARN → RETURN`

## 2. Commercial model

Build the account/paywall layer around the network Founding Season standard:
- `$9.99 / month` — default, **Best Value**
- `$3.99 / week` — **Flexible**
- no free trial
- cancel anytime

Do not invent Stripe IDs. Until WNBA Stripe objects are created, keep purchase activation fail-closed and isolate pricing configuration so exact IDs can be inserted once.

Entitlement target:
`Browser → Stripe-hosted Checkout → Cloudflare billing Worker → Supabase pbe_sport_entitlements`

The new shared entitlement ledger currently needs WNBA added to its allowed sport values before activation. Make that an explicit migration, not an application-side workaround.

Paid account UX must have three world-class states:
1. signed out — product value + pricing + existing-member sign in;
2. signed in/free — verified account + direct upgrade;
3. active Pro — premium account/desk state, entitlement period/status, primary product action, restrained account controls.

Never let a legacy/utility fallback become the final visible state.

## 3. WNBA application surfaces

### A. TODAY / COMMAND CENTER
The default landing route. Show only real current WNBA state:
- today/next slate;
- live/final/scheduled semantics;
- market availability and age;
- injury/availability counts where sourced;
- what changed since prior durable snapshot once a change ledger exists;
- strongest PBE research actions.

If no games exist, show a useful offseason/no-games intelligence mode rather than another date's games labeled today.

### B. WNBACAST
Create the WNBA counterpart to the strongest NBA/NHL/NFL live-game experiences:
- scoreboard/game state;
- play-by-play/event stream;
- real shot locations only when provider publishes them;
- possession/run/lead-change context only when derivable from source events;
- live market context where licensed/available;
- replay from persisted event stream for completed games;
- explicit LIVE SOURCE vs POST-GAME ENRICHED semantics if enrichment arrives later.

Never reconstruct player/ball coordinates or events that the source did not publish.

### C. PROPS / BEST LINE
Keep four concepts separate:
- best sportsbook price;
- market consensus / no-vig benchmark;
- PBE fair value/model probability;
- PBE model gap/edge where the method supports it.

If a layer is unavailable, leave it unavailable. Never infer a model line from sportsbook prices and call it PBE fair value.

### D. MATCHUPS
High-value WNBA-native research:
- team pace/style context;
- recent form with clear sample windows;
- lineup/rotation/role context from observed games;
- rest/travel/schedule context where sourced;
- player/team matchup metrics;
- source age and methodology labels.

### E. PLAYER INTELLIGENCE
Build first-class player pages:
- identity + real photo where licensing permits;
- team/position;
- season and recent-game statistics;
- game logs;
- role/usage trends from observed data;
- injury/availability context;
- WNBA-native news;
- props/market/research links when available.

Do not guess player identity joins. Resolve deterministically by provider/source IDs where possible.

### F. INJURY / AVAILABILITY DESK
- source every status;
- show captured/update time;
- distinguish official status from reported context;
- never invent return dates;
- fail/degrade visibly when a source is unavailable.

### G. STANDINGS / STATS / TEAMS
Current-season truth first. Prior season must be explicitly labeled prior/final, never silently presented as current.

### H. PBE PICKS + TRACK RECORD
Reuse the PropBetEdge grading doctrine:
- picks recorded before outcome;
- recorded market price/line preserved;
- deterministic grading;
- ROI computed only where a real recorded price exists;
- hit rate may include unpriced picks but ROI may not;
- sample sizes visible;
- losing results render as losing;
- never backfill a result as though it were a pregame pick.

## 4. Independent WNBA news automation

This is a launch pillar.

Build an owned WNBA news lane with:
- source registry and explicit permitted usage;
- Cloudflare ingestion Worker(s);
- queue/workflow if normalization/publishing becomes multi-step;
- Supabase durable normalized story/source records;
- deduplication and canonical-source handling;
- WNBA-specific tagging/entities;
- published/updated/captured timestamps;
- clear attribution;
- PropBetEdge-generated analysis only when the inputs support it.

Do not make ESPN/the external wire the PropBetEdge newsroom. External wire material can be surfaced as external publisher content with attribution. Owned automated summaries/analysis must remain source-disciplined and distinguish facts from derived context.

The WNBA news lane must operate independently from NBA so one sport can fail/deploy/change without taking down the other.

## 5. Data-source audit before deep UI implementation

Do not assume NBA endpoints map 1:1 to WNBA. First produce `docs/WNBA_SOURCE_MATRIX.md` covering, at minimum:
- schedule/game IDs;
- scoreboard/live state;
- play-by-play/event stream;
- shot coordinates if available;
- box score/player game stats;
- rosters/player IDs;
- standings;
- injuries/availability;
- team/player season stats;
- odds/game markets;
- player props;
- news;
- historical/replay availability.

For each source record:
`capability | source | authority/licensing | identifier | freshness | expected failures | storage policy | public attribution`.

Run real canaries. Document exact source gaps rather than coding around them with fake values.

## 6. Real player photos — required quality bar

Player imagery should be a competitive advantage, but identity and rights must be correct.

Create an image manifest/ledger containing:
- player source ID;
- player display name;
- source page URL;
- direct media URL if appropriate;
- license type;
- attribution/author;
- source width/height;
- crop/focal metadata;
- identity confidence / manual verification state;
- last verified timestamp.

Preferred sources: properly licensed Wikimedia Commons/public-domain imagery or another source whose terms support the use. Do not scrape/rehost images merely because they are publicly visible. Never use the wrong person to fill a missing photo.

Generate responsive derivatives once rights/identity are verified. Fallback should be a polished neutral player card/initials treatment—not random stock imagery.

Acceptance:
- no forehead crops;
- no cut-off faces unless intentional and high quality;
- no stretched aspect ratios;
- no guessed identities;
- no missing broken image when an approved asset exists;
- mobile crops reviewed separately from desktop.

## 7. Visual/product system

Borrow the strongest **principles** from NBA, not a literal clone:
- high-information command-center hierarchy;
- premium near-black/gold PropBetEdge identity;
- sport-native court/basketball visual language;
- readable market/model separation;
- useful empty/offseason states;
- fast mobile navigation;
- one clear route authority per surface;
- strong player identity and editorial depth.

WNBA should get its own visual personality. Avoid unlicensed league marks and team marks in owned identity assets unless usage is confirmed.

## 8. Network / growth

Shared PropBetEdge footer:

PROPBETEDGE:
- Sports News
- Store
- Discord → `https://discord.gg/kb5zCTHbME`

SPORTS target:
- MLB
- NFL
- NBA
- WNBA
- NHL
- UFC

Cross-funnel WNBA → NBA in contextually useful places (basketball network, offseason continuity, shared research methodology), without treating WNBA as an NBA subpage.

SEO/news should make WNBA independently discoverable.

## 9. Suggested Cloudflare layout

Use names only as working suggestions; align with existing account conventions before deployment:
- `wnba-api` — public/read intelligence API and provider normalization;
- `wnba-ingest` — scheduled/archive/snapshot ingestion;
- `wnba-news` — WNBA-specific news ingestion/normalization;
- optionally reuse a shared sport billing Worker only after `wnba_pro` is explicitly supported in code + DB constraint + Stripe allowlist.

Background work belongs in Cloudflare Cron/Queues/Workflows. Do not put it in Actions.

## 10. Supabase model principles

Prefer durable tables/snapshots sufficient to support:
- games/events;
- teams/players/rosters;
- player/team game stats;
- current + historical availability;
- odds snapshots;
- line/market movement;
- news source/story normalization;
- picks + immutable recorded price context;
- replay/archive artifacts or R2 pointers;
- data-source health/capture metadata where useful.

Public browser writes are forbidden for entitlement/admin-sensitive data. Service-role operations remain server/Worker only.

## 11. Build sequence

### Milestone 0 — source truth + architecture
- source matrix;
- real source canaries;
- schema/migration design;
- Worker route contracts;
- no customer-facing fake demo data.

### Milestone 1 — production shell
- Today;
- WNBACast skeleton against real game/event data;
- Players;
- Matchups;
- Standings/Stats;
- Injury desk;
- WNBA newsroom;
- responsive PropBetEdge network shell.

### Milestone 2 — persistent intelligence
- snapshot ingestion;
- event/replay persistence;
- durable change ledger;
- odds snapshots;
- player role/rotation observations;
- news history/dedup.

### Milestone 3 — paid product
- WNBA Stripe product + monthly/weekly recurring prices;
- Cloudflare webhook recognition;
- `wnba_pro` ledger support;
- session/entitlement integration;
- premium three-state paywall/account;
- fail-closed activation canaries.

### Milestone 4 — model / picks / track record
Only ship claims after frozen methods and validation. Keep market comparison separate from model prediction.

## 12. Acceptance bar before public production

Run against the exact `main` SHA intended for production:
- build PASS;
- syntax/static guards PASS;
- source canaries PASS or explicitly degraded with truthful product states;
- 1440 desktop PASS;
- 390 mobile PASS;
- zero horizontal overflow;
- no broken images;
- no console/page exceptions;
- no duplicate page authorities/pollers;
- no fake current season/live data;
- WNBACast opens the correct game;
- scheduled/final/live semantics correct;
- source age visible on volatile data;
- player-photo identity/licensing manifest complete for every shipped photo;
- WNBA news independent and attribution-correct;
- checkout paths point to Stripe-hosted checkout;
- billing webhook runtime is Cloudflare;
- durable entitlement truth is Supabase;
- no production intelligence or billing requires GitHub Actions;
- no new backend dependency on Vercel Functions.

## 13. Reporting format

For every major push, report:
- MAIN SHA
- FRONTEND DEPLOYMENT
- CLOUDFLARE WORKER VERSION(S)
- SUPABASE MIGRATION(S)
- DATA SOURCE CANARIES
- NEWS CANARIES
- DESKTOP PASS/FAIL
- MOBILE PASS/FAIL
- WNBACAST PASS/FAIL
- PLAYER IMAGE COVERAGE + LICENSING STATUS
- PAYWALL PASS/FAIL
- BILLING/ENTITLEMENT RUNTIME PATH
- VERCEL API DEPENDENCIES REMAINING
- KNOWN BLOCKERS
- ROLLBACK TARGETS
- NEXT MILESTONE

Never mark something PROVEN unless the referenced check was actually run.