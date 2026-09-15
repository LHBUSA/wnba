# WNBA atmosphere plate

One raster, owned outright, behind every page.

| | |
|---|---|
| File | `public/media/atmosphere/pbe-wnba-arena-2400.webp` |
| Size | 2400 × 1350, WebP q68, 29,352 bytes |
| sha256 | `e105748cfd5fe670b2e886d78c26628852f233942f2ca285cfe6830cb04b55da` |
| Source | Rendered by `scripts/atmosphere/render_arena.py` (numpy ray-cast, fixed seed 20260915) |
| Contents | Empty arena: hardwood court, raked seating, blank ribbon fascia, overhead rig in haze |
| Rights | No photograph, no league or team mark, no text, no person. Nothing to license or credit. |

Rebuild: `python scripts/atmosphere/render_arena.py 2400 arena.png`, then encode WebP at quality 68 (`method=6`).

## Rendering contract (`src/styles/identity.css`)

- `body::before` is a `position: fixed` layer holding the plate (`cover`, opacity `--atmo-opacity`: .62 desktop, .5 at ≤700px). A fixed element rather than `background-attachment: fixed`, so mobile browsers composite it once and never repaint it on scroll.
- `body::after` carries the gradient overlays: header scrim, floor fade, side falloff, gold arena light, a trace of WNBA orange.
- Nothing animates. The old 22-second light sweep is gone, so there is nothing for reduced motion to disable.
- Cards (`.card`, `.tile`) use 88–93% opaque warm-ink surfaces, so content sits over the arena while body-text contrast stays unchanged.

## Guard

`scripts/guard-truth.mjs` rule 7a fails the build on any of the following:

- a CSS `url()` that is a `data:` URI or an `.svg` file;
- a CSS `url()` that points anywhere except `/fonts/` or the plate;
- a missing plate;
- the return of the removed decorative SVG art (`src/ui/art.js`, `hero2-art`, `sm-court`).

The shot-chart court in `src/ui/court.js` is data, not decoration: it plots the published shot coordinates. It stays.
