# Player photos — identity + rights ledger

Ledger: `data/player-photos.json` (Git-versioned; bundled into `wnba-api`, which is the only authority the site reads). Derivatives: `public/media/players/<espnAthleteId>/{portrait,square}.webp`. Pipeline: `scripts/photos/s1_roster.py … s8_manifest.py` (run log: `docs/PHOTO_COVERAGE_PIPELINE_RUN.md`).

## Coverage (2026-09-11)

**156 verified photos / 209 active roster players (74.6%).**

| Status | Count |
|---|---|
| approved & shipped | 156 |
| no image on Wikidata (P18 missing) | 31 |
| no identity match (no Wikidata item: 4; ESPN/Wikidata DOB disagree: 2; name matches non-basketball items only: 1) | 7 |
| rejected on review (head cut in source, low resolution, multi-face, Commons names another subject, face hidden) | 7 |
| held — identity confidence "review" (matched by jersey/college/category) | 6 |
| held — public-domain basis needs legal sign-off | 1 |
| held — face largely hidden (final review) | 1 |

Shipped licenses: CC BY-SA 2.0 (53), CC BY 4.0 (47), CC BY-SA 4.0 (35), CC BY 2.0 (10), CC BY-SA 3.0 (8), CC0 (3). No NC, no ND, no fair use.

## Rules

1. **Identity:** ESPN athlete id → Wikidata human with WNBA.com id / basketball occupation, **exact normalized name AND exact date of birth**; ambiguity = no match. Commons side must also name the player (title, description, depicts or category).
2. **Rights:** CC0, public domain, CC BY, CC BY-SA only. Our crops are adaptations → every CC BY-SA derivative is offered under CC BY-SA; attribution text says "(cropped)" and links source + license on the player page.
3. **Crops:** face detection (Haar + YuNet), portrait 4:5 and square 1:1, whole head inside the frame, never stretched, never upscaled; every shipped crop reviewed by eye on contact sheets (desktop 4:5 and avatar 1:1 — mobile uses the same reviewed 4:5 crop).
4. **Fallback:** anything uncertain renders the neutral initials card. A wrong person is a release blocker.
5. **Build guard:** an `approved` entry without `identity_confidence: high`, license, attribution, verification time or both derivative files fails the build; a derivative folder without an approved entry fails the build.

## Owner decisions pending

- Confirm or reject the 6 "review" identities (Kelsey Mitchell, Aicha Coulibaly, Aneesah Morrow, Kierstan Bell, Dominique Malonga, Lauren Betts).
- Legal view on Rebekah Gardner's Flickr public-domain mark.
- 35 shipped files carry a Commons personality-rights notice (normal for sports photos; editorial use).
