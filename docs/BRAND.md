# PropBetEdge WNBA — brand identity (V3, 2026-09-26)

One system: **PropBetEdge master mark** + **WNBA sport identity** ("PropBetEdge WNBA", descriptor "WNBA Intelligence").

## Canonical source

The mark is the network's own artwork, never a redraw:

| | |
|---|---|
| URL | `https://propbetedge.ai/logo/pbe-full-600.png` |
| Repo | `propbetedge-news-site/public/logo/pbe-full-600.png` (same bytes as `nba-propbetedge/scripts/brand/src/pbe-full-600.png`) |
| sha256 | `53d5f2a15297578b323db7ef216dcb34d3eb2fe3e9a9b46401634ae3609af7e5` |
| Local copy | `scripts/brand/src/pbe-full-600.png` — the builder refuses any other bytes |

Newest production users of the same artwork: propbetedge.ai (`/logo/pbe-mark-*`), NBA (`public/brand/`, B-glyph favicon),
Learn (`assets/brand/`), Boxing (`web/public/brand/pbe-mark-160.png`), Tennis (`workers/tennis-web/src/pbe-mark.js`).

## Build

```
python scripts/brand/build-brand-assets.py
```

| Output | Use |
|---|---|
| `public/brand/pbe-mark-{32,64,96}.webp`, `pbe-mark-64.png` | header/footer mark (letters only, 65:32) |
| `public/favicon.svg`, `favicon.ico` (16/32/48), `favicon-16x16.png`, `favicon-32x32.png` | browser tabs |
| `public/apple-touch-icon.png` (180, opaque), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | iOS / Android / PWA |
| `public/site.webmanifest` | name `PropBetEdge WNBA`, short `PBE WNBA`, theme/background `#0f0d0a` |
| `public/share/propbetedge-wnba-social-v3.jpg` | master 1200×630 card (homepage + fallback) |
| `public/share/propbetedge-logo-v3-512.png` | Organization + NewsMediaOrganization JSON-LD logo, RSS image |
| `public/media/teams/<id>/og.png` | PNG twins of the self-hosted team marks (the card renderer cannot decode WebP) |
| `workers/wnba-web/src/brand-mark.js` | the mark as base64 PNG, bundled into every dynamic card |

**Favicon glyph:** the orange basketball "B" isolated from the PBE mark (the NBA precedent). The full 2.6:1 "PBE"
turns to mush at 16px; the B stays legible, and the basketball inside it is the sport treatment. No text in icons.

## Share cards

- Master: `/share/propbetedge-wnba-social-v3.jpg`. **Never overwrite a published card URL** — X and LinkedIn cache by URL.
  A new design ships at a new URL (`-v4`). `-v2.jpg` stays only for caches that still hold it; nothing live links it.
- Dynamic: `/og/{news,players,dna,teams,matchups,cast,pages,intl-*}/<key>.png` rendered by wnba-web (satori + resvg).
  Layouts: `workers/wnba-web/src/og-layout.js` (pure); models: `og-model.js`; renderer: `og.js`.
  Every card: PropBetEdge mark + `PROPBETEDGE / WNBA` top-left, `@PROPBETEDGE` bottom-left, gold→flame rail.
- URLs carry `?v=<OG_REV>` (`src/seo/site.js`). Bump `OG_REV` whenever card chrome changes. Content-keyed URLs
  (`?v=<rev>-<key>`: articles by revision time, WNBACast by state + score) are cached immutable; design-only
  `?v=<rev>` URLs refresh with the data (6h edge).
- Photos: only the approved newsroom composite (`/media/news/players/<id>/og.jpg`, licensed Commons portraits).
  Hotlinked provider headshots (WNBA CDN, ESPN) are never re-published inside a generated card.
- Local QA: `node scripts/brand/render-og-local.mjs <outDir> players/3149391 dna/3149391 cast/<gameId> …`

## Share actions

`src/ui/share.js` — X · LinkedIn · Copy only, always on the canonical URL (no query, no hash, canonical host).
X uses `https://x.com/intent/post` with `via=PROPBETEDGE`; LinkedIn uses `share-offsite`. Copy is bound once in
`src/main.js` (`bindShareActions`). Surfaces: article, player, Player DNA, team, matchup, WNBACast game, WinBA Score.

## Guards

`tests/brand-identity-v3.test.mjs` (source hash, chrome, favicon family sizes, manifest, V3 files, no retired asset
references, OG coverage + versioning, share URLs, identity on every layout, no hotlinked photos) and
`tests/social-identity.test.mjs` (@PROPBETEDGE, no legacy `intent/tweet`).
