# Player photos — identity + rights ledger

Ledger: `data/player-photos.json` (Git-versioned; bundled into `wnba-api`, which is the only authority the site reads). Derivatives: `public/media/players/<espnAthleteId>/{portrait,square}.webp`. Pipeline: `scripts/photos/s1_roster.py … s8_manifest.py` (run log: `docs/PHOTO_COVERAGE_PIPELINE_RUN.md`).

## Coverage (2026-09-11, after stage 9)

**166 verified photos / 209 active roster players (79.4%)** — 156 from the Wikidata P18 route plus 10 from Commons-category discovery (stage 9).

| Status | Count |
|---|---|
| approved & shipped | 166 (P18: 156 · Commons category: 10) |
| no image (no P18 and no usable file in the item's own Commons category) | 25 |
| no identity match (no Wikidata item: 4; ESPN/Wikidata DOB disagree: 2; name matches non-basketball items only: 1) | 7 |
| rejected on review (P18 and category route both failed: Bree Hall, Nia Coffey, Anneli Maley) | 3 |
| held — identity confidence "review" (matched by jersey/college/category) | 6 |
| held — public-domain basis needs legal sign-off | 1 |
| held — face largely hidden (P18 and the category file both fail the visible-face bar) | 1 |

The ledger files rejected + held together under `status: "rejected"` (11); the reason of a held entry starts with `held:`.

Shipped licenses: CC BY-SA 2.0 (54), CC BY 4.0 (49), CC BY-SA 4.0 (42), CC BY 2.0 (10), CC BY-SA 3.0 (7), CC BY-SA 3.0 AT (1), CC0 (3). No NC, no ND, no fair use.

### Count reconciliation (why an older doc said 164)

`docs/PHOTO_COVERAGE_PIPELINE_RUN.md` was generated at 17:55Z by stage 8, **before the final visual/rights review**. Its "approved 164" includes the 8 entries that review then held (6 identity-review, Rebekah Gardner's PD mark, Nyara Sabally's hidden face), so 164 − 8 = 156 shipped at promotion (17:59Z). The license deltas account for exactly those 8 (CC BY-SA 2.0 −5, CC BY-SA 4.0 −2, Public domain −1). The ledger (`data/player-photos.json`) and the derivative folders on disk are the source of truth; both said 156 and now say 166.

## Stage 9 — Commons-category discovery

For a verified identity (exact name + exact DOB) whose P18 is missing or was rejected for an image problem, `scripts/photos/s9_category_discovery.py` inspects **at most 40 files, newest first, of the item's own Commons category** (P373, else a `Category:` commonswiki sitelink; files only, no subcategories). Ported from the UFC portrait worker, with its gaps closed:

- **Category membership is never identity proof.** The file itself must name the player in its title/description, or depict her QID (P180). A file naming another rostered player, or depicting other people, is flagged review-only.
- Same license allowlist; jpeg/png/webp; short edge ≥ 500 px; one dominant face (Haar + YuNet); stage-6 crop rules (`croplib.py`, shared with stage 6); portrait ≥ 280 px.
- **No free-text or global image search** is used, at any stage.
- Nothing ships without the recorded visual review in `data/photo-discovery-review.json`; `s10_promote.py` then writes the ledger entry (with a `discovery` record: category, files inspected, outcome) and copies the derivatives.

Run 2026-09-11: 39 eligible players → 17 with a category and a passing file → 10 approved, 5 rejected on review (soft/downcast close-ups, a cardboard fan cutout, a file whose title names Sylvia Fowles, a bowed head) → 22 have no Commons category on their item. Every inspected player now carries its `discovery` record in the ledger.

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
