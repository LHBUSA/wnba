# PBE WNBA v1 — early-season eligibility study (INSUFFICIENT_TEAM_HISTORY)

- **Rule:** fixed in advance in `model/pbe-wnba-model-v1/eligibility/preregistration.json` (commit `fa97b6a`), before any bin metric was computed.
- **Script:** `scripts/model/eligibility-study.py`, which imports the frozen recipe's own code from `walkforward.py`.
- **Receipt:** `model/pbe-wnba-model-v1/eligibility/eligibility_study_receipt.json`.
- **Proposed contract:** `eligibility_contract.proposed.json`, status **PROPOSED**. It is not frozen.

**m** is the smaller of the two teams' current-season final game counts under the frozen as-of rule.

The predictions are walk-forward out-of-sample from the frozen v1 recipe:
- settings: k=4, r=0.6, feature set F, window last8, C=10;
- trained on eligible prior-season games only;
- scoring **every** game of the target season, including m = 0–2.

## Reconciliation

The committed receipt's holdout 3–5 slice reproduces exactly: n=45, log loss 0.7132, Brier 0.25896, accuracy 0.4889, AUC 0.5751.

## Validation 2015–2024 (chooses K)

| bin | n | log loss | Brier | acc | AUC | ECE | cal. slope / int. | home-rate LL | net-sign LL / acc |
|---|---|---|---|---|---|---|---|---|---|
| 0–2 | 202 | 0.6857 | 0.2453 | 0.594 | 0.620 | 0.079 | 0.52 / 0.03 | 0.6896 | 0.6686 / 0.609 |
| 3–5 | 185 | 0.6265 | 0.2184 | 0.638 | 0.718 | 0.099 | 1.04 / −0.23 | 0.7014 | 0.6354 / 0.681 |
| 6–8 | 180 | 0.5901 | 0.2028 | 0.683 | 0.742 | 0.035 | 1.15 / −0.07 | 0.6854 | 0.6498 / 0.650 |
| 9–12 | 244 | 0.6135 | 0.2126 | 0.643 | 0.719 | 0.059 | 0.96 / −0.17 | 0.6885 | 0.6531 / 0.639 |
| 13+ | 1414 | 0.6026 | 0.2079 | 0.675 | 0.728 | 0.034 | 1.05 / −0.11 | 0.6836 | 0.6413 / 0.661 |

A coin flip has log loss 0.6931 in every bin.

## Holdout 2025 + 2026 (confirmation only)

| bin | n | log loss | Brier | acc | AUC | ECE | cal. slope | home-rate LL | net-sign LL / acc |
|---|---|---|---|---|---|---|---|---|---|
| 0–2 | 46 | 0.7092 | 0.2563 | 0.543 | 0.633 | insufficient | insufficient | 0.7262 | 0.7076 / 0.565 |
| 3–5 | 45 | 0.7132 | 0.2590 | 0.489 | 0.575 | insufficient | insufficient | 0.6963 | 0.6829 / 0.600 |
| 6–8 | 42 | 0.5611 | 0.1936 | 0.667 | 0.760 | insufficient | insufficient | 0.6734 | 0.6186 / 0.690 |
| 9–12 | 58 | 0.5288 | 0.1746 | 0.724 | 0.826 | insufficient | insufficient | 0.6803 | 0.5838 / 0.741 |
| 13+ | 421 | 0.6161 | 0.2134 | 0.651 | 0.713 | 0.039 | 0.85 | 0.6854 | 0.6434 / 0.658 |

## Cumulative m ≥ K

| K | val n | val cov % | val LL | val ECE | val slope | hold n | hold cov % | hold LL | hold ECE | hold slope |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2225 | 100.0 | 0.6123 | 0.032 | 1.00 | 612 | 100.0 | 0.6182 | 0.043 | 0.86 |
| 3 | 2023 | 90.9 | 0.6050 | 0.032 | 1.05 | 566 | 92.5 | 0.6108 | 0.039 | 0.88 |
| 6 | 1838 | 82.6 | 0.6028 | 0.028 | 1.05 | 521 | 85.1 | 0.6020 | 0.032 | 0.92 |
| 9 | 1658 | 74.5 | 0.6042 | 0.029 | 1.04 | 479 | 78.3 | 0.6056 | 0.037 | 0.90 |
| 13 | 1414 | 63.6 | 0.6026 | 0.034 | 1.05 | 421 | 68.8 | 0.6161 | 0.039 | 0.85 |

The receipt carries every K from 0 to 13.

## Pre-registered criterion, applied mechanically (validation only)

| K | (a) bins beat home rate | (b) cumulative slope in [0.80, 1.25], ECE ≤ 0.05 | (c) entry slice LL < 0.660 | result |
|---|---|---|---|---|
| 0 | pass | pass (1.00, 0.032) | **fail**: 0–2, 0.686 | fail |
| 1 | **fail**: 1–2 bin 0.714 vs 0.697 | pass | **fail**: 0.684 | fail |
| 2 | **fail**: bin of m=2 only, 0.720 vs 0.704 | pass | **fail**: 0.663 | fail |
| **3** | pass | pass (1.05, 0.032) | pass: 3–5, 0.626 | **PASS → K = 3** |

The contract threshold is `no_call_below = max(K, 3) = 3`, the same NO CALL floor v1 already enforces.

## Holdout check of K = 3 (does not change K)

- (a) passes on merged bins: 3–8 (n=87) 0.640 vs 0.685; 9+ (n=479) 0.606 vs 0.685.
- (b) passes: slope 0.876, ECE 0.039.
- (c) **fails**: entry slice 3–7 (extended to n=71) has log loss 0.685, above the 0.660 floor.

## Conclusion

- **The pre-registered rule selects K = 3.** m = 0–2 is clearly unfit on validation: log loss 0.686, calibration slope 0.52, no better than the home-rate baseline. Three or more current games clear every validation criterion.
- **The early-season weakness you flagged is real in the holdout, but not in the ten validation seasons.** Holdout 3–5 (n=45) and the 3–7 entry slice (n=71) both sit near a coin flip. Validation 3–5 (n=185) is 0.626, clearly better than baseline.
- The holdout samples are small, and the pre-registered rule forbids moving K on holdout. So the study does **not** support a threshold above 3, and it does **not** make the 3–5 range safe to trust.
- The honest options are owner decisions, not tuning:
  1. **Adopt K = 3 as proposed**, and label calls with fewer than 6 current games as Low confidence. The frozen tier rule already caps them at Medium when m < 8.
  2. **Pre-register a second rule now** that pools 2015–2026. It must be written before looking at pooled bin metrics.
- **No effect on 2026:** all 30 remaining regular-season games involve teams with 40–41 current finals, and the 29 postseason slots (currently TBD) will too. The rule first bites at the 2027 season openers.
