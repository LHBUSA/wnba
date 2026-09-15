# PBE WNBA Model v1 (`pbe-wnba-model-v1`)

A deterministic pregame win-probability model. Not an LLM. Sportsbook prices are never an input; the market is compared **after** a probability exists.

| | |
|---|---|
| Artifact | `model/pbe-wnba-model-v1/artifact.json` — sha256 in `manifest.json` |
| Feature spec | `model/pbe-wnba-model-v1/feature_spec.json` — sha256 in `manifest.json` |
| Receipt | `model/pbe-wnba-model-v1/validation_receipt.json` |
| Verify | `node scripts/model/verify-artifact.mjs` |
| Features (one implementation) | `workers/shared/pbe-wnba-features.js` |
| Inference + reasoning | `workers/shared/pbe-wnba-model.js` |
| Tests | `tests/pbe-wnba-model.test.mjs` |

## 1. Dataset audit (ESPN, harvested 2026-09-15)

Source: `site.web.api.espn.com/.../wnba/scoreboard?dates=YYYY&limit=1000` (the ranged `dates=A-B` form answers HTTP 400 for past seasons) and `summary?event=<id>`. Raw envelopes (`source_url`, `captured_at`, payload) live outside Git in `D:\Workers\wnba-model-data\raw` (5,974 regular/postseason finals 2002–2026).

- **1997–2001:** scoreboard statuses are unusable (finals listed `IN_PROGRESS`/`TBD`). Not harvested for training.
- **2002:** no team box statistics at all (0/271). History only via score — unusable.
- **2003–2004:** box complete for 196/257 and 214/240. Used only as carryover/history.
- **2005–2026:** ≥96% box complete; from 2006 every season ≥99%. Player minutes and starters present wherever the team box is.
- **Rule eras:** two 20-minute halves until 2005, four 10-minute quarters from 2006. Ratings are per 100 possessions and minutes are normalised per game (OT counted from linescores), so eras are comparable; the selected window (last 8 seasons) never reaches pre-2006 anyway.
- **Traps handled:** one All-Star game per season (non-franchise teams, 21 excluded); 2020 IMG Academy bubble has no `neutralSite` flag — treated as single-site (`SINGLE_SITE_SEASONS`); neutral-site Commissioner's Cup finals flagged by ESPN; postponed/forfeit/canceled events never enter (finals only); preseason (type 1) excluded.
- **Market data:** ESPN `pickcenter` moneylines exist for **2026 only** (301 games). Used for evaluation only; never joined into a feature row.
- **Injuries:** ESPN publishes current injuries only, with no timestamped history. **No injury input exists in v1.** Availability is inferred from observed minutes.

Usable: 5,953 games / 11,906 team-game rows (`rows_sha256` in the receipt). Training targets start 2005; a game enters training/evaluation only when both teams have ≥3 current-season finals.

## 2. Features (home minus away)

As-of rule: a feature reads only FINAL type-2/3 rows with a complete box whose game started strictly before `as_of` **and** whose ET calendar date is earlier than the target game's. Historical rows use `as_of` = tip − 15 min.

Candidates (all built, 16): shrunk net rating, schedule-adjusted net rating, four-factor margins (eFG, TOV, ORB, FT rate), pace, last-5/last-10 form vs season baseline, home court, rest, back-to-back, games in last 7 days, rotation availability, starter continuity, minutes concentration. Early season: season-to-date quality is shrunk toward the prior full season: `(n·current + k·r·prior)/(n + k)`.

**Selected (7):** `sos_adj_net`, `form10`, `home_court`, `rest`, `back_to_back`, `availability`, `continuity`; `k = 4`, `r = 0.6`.

## 3. Model form

```
logit P(home wins) = b_home·home_court + Σ w_j·(x_j − mean_j)/std_j
```

There is no free intercept. The home term is neither standardised nor penalised, so a neutral-site game carries no home edge. The first fit used a standardised home flag with an intercept. Because `home_court` is ~always 1 in training, a 2020 bubble game became a 28-sigma outlier: 2020 log loss was 0.81 and accuracy 0.47. The structural form fixed this before selection finished.

## 4. Walk-forward results

Walk-forward by season. Validation 2015–2024 chose the recipe by pooled log loss. The grid was 12 shrinkage settings × 7 feature sets × 2 windows × 8 C values = 1,344 configs. The simplicity rule took the fewest features within 0.002 of the best. The recipe and the confidence/no-call policy were committed (`fac4e7a`) **before** the 2025+2026 holdout ran, and the holdout was run once.

| Validation 2015–2024 (n=2,023) | Brier | Log loss | Acc | AUC | ECE | Cal. slope / int |
|---|---|---|---|---|---|---|
| **Logistic (chosen)** | 0.2090 | 0.6050 | 0.669 | 0.728 | 0.032 | 1.05 / −0.13 |
| HistGradientBoosting (best of 3) | 0.2165 | 0.6232 | 0.650 | 0.704 | 0.043 | 0.86 / −0.11 |
| Net-rating sign (naive) | 0.2253 | 0.6430 | 0.659 | — | — | — |
| Home-win rate | 0.2464 | 0.6860 | 0.562 | — | — | — |
| Coin 0.5 | 0.2500 | 0.6931 | 0.562 | — | — | — |

| Holdout (evaluated once) | n | Brier | Log loss | Acc | AUC | ECE | Cal. slope / int |
|---|---|---|---|---|---|---|---|
| **Logistic 2025+2026** | 566 | 0.2116 | 0.6108 | 0.647 | 0.716 | 0.039 | 0.88 / 0.07 |
| 2025 | 289 | 0.2206 | 0.6294 | 0.626 | 0.693 | 0.082 | 0.74 / 0.10 |
| 2026 | 277 | 0.2022 | 0.5914 | 0.668 | 0.743 | 0.074 | 1.04 / 0.05 |
| HGB | 566 | 0.2218 | 0.6354 | 0.633 | 0.691 | 0.062 | 0.73 / 0.12 |
| Net-rating sign | 566 | 0.2232 | 0.6386 | 0.664 | — | — | — |
| **De-vigged ESPN market, 2026 (eval only)** | 277 | **0.1968** | **0.5787** | 0.697 | 0.759 | 0.064 | — |

The market beats v1 on 2026, 0.579 vs 0.591 log loss. The mean absolute gap is 6.8 probability points and the correlation is 0.90. A PBE Edge is a disagreement with a better-calibrated benchmark, not proof of value.

Early-season holdout games are poorly calibrated: with both teams at 3–5 games, n=45, log loss 0.713 and accuracy 0.49. That is the weakest region.

Policy tiers were fixed before the holdout:

| Tier | Validation n / hit rate | Holdout n / hit rate |
|---|---|---|
| High (≥70%) | 691 / 77.1% | 219 / 80.4% |
| Medium (60–70%) | 630 / 68.7% | 145 / 62.8% |
| Low (53–60%) | 508 / 57.9% | 150 / 50.0% |
| No call (<53%) | 194 / 47.9% | 52 / 46.2% |

## 5. Frozen artifact

The chosen recipe is refit on every eligible game in the last-8-season window: 2019–2026, 1,786 games, through 2026-08-31, the last final before the FIBA break. Holdout numbers measure the recipe without 2025/2026, not this artifact in-sample.

Coefficients per SD: schedule-adjusted net rating **+0.899**, availability +0.176, form10 +0.065, rest +0.056, back-to-back −0.035, continuity **−0.065** (counter-intuitive), home court +0.291 (flag).

## 6. Leakage proof

`scripts/model/leakage-audit.mjs` checks 279 sampled eligible games:
- **L1:** every row on or after the game date is corrupted, and fake future games are injected.
- **L2:** the target game's own rows are corrupted.
- **L3:** a same-day game that finished before tip is injected.
- **L4:** no odds, price, pickcenter or injury token appears in the feature code.

Result: identical vectors in 279/279 games for L1–L3, and L4 clean. The unit tests repeat this, and also check that a prediction instant after tip is refused.

## 7. Reasoning

For each feature, the contribution is its coefficient times its standardised value; the home term is its coefficient times the flag. `impact_pts` = 100 × (p − p without that term). A feature at z = 0 means the average training game. Reasons are oriented by sign, and the home and away pages are exact mirrors. Terms under 0.5 points are omitted. Up to 3 supporting and 2 opposing reasons are shown.

A display rule was added **after holdout**. It changes no probability, metric or pick. A term whose learned sign contradicts the feature's plain meaning goes to `adjustments` instead of the supporting or opposing reasons. Today that is `continuity`. It stays in the prediction record with its exact contribution.

## 8. Live runtime contract

1. **Ingest:** for every newly FINAL WNBA game, call `teamGameRowFromSummary(summaryJson)` and persist both rows unchanged (`pbe-wnba-team-game/1`). Seed from the current season plus the prior season: both are needed for carryover and schedule adjustment. Rows are immutable once final.
2. **Predict:** call `predictFromRows({ game: { event_id, season, season_type, start_utc, neutral, home_id, away_id }, leagueRows, asOf })`. `leagueRows` holds every stored row for `season` and `season − 1`. `asOf` must be ≤ tip. The result is one canonical, home-oriented prediction per game.
3. **Team pages:** call `orient(prediction, teamId)` on that same object. Market, PBE Edge, lock and ledger belong to the caller, not this module.
