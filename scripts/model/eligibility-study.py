"""PBE WNBA model v1 - early-season eligibility study (INSUFFICIENT_TEAM_HISTORY).

    python scripts/model/eligibility-study.py

Applies model/pbe-wnba-model-v1/eligibility/preregistration.json mechanically:
  * walk-forward out-of-sample predictions from the frozen v1 recipe (imported from walkforward.py, unchanged),
    trained on ELIGIBLE prior-season rows, scoring ALL games of each target season (including m = 0-2);
  * per-bin and cumulative metrics on validation (2015-2024) and holdout (2025+2026);
  * K = smallest value in 0..13 passing (a), (b), (c) on validation only; holdout reported for K only.
Writes eligibility_study_receipt.json and eligibility_contract.proposed.json. Changes no frozen model file.
"""
import hashlib, json, sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import walkforward as wf  # noqa: E402  (the frozen recipe's own code)

REPO = wf.REPO
ELIG = REPO / "model" / "pbe-wnba-model-v1" / "eligibility"
PREREG = json.loads((ELIG / "preregistration.json").read_text(encoding="utf8"))
SEL = json.loads((wf.DERIVED / "selection.json").read_text())["chosen"]
assert (SEL["k"], SEL["r"], SEL["feature_set"], SEL["window"], SEL["C"]) == (4, 0.6, "F_sos_form_situation_rotation", "last8", 10.0), SEL

FEATS = wf.FEATURE_SETS[SEL["feature_set"]]
WINDOW = wf.WINDOWS[SEL["window"]]
BINS = [("0-2", 0, 2), ("3-5", 3, 5), ("6-8", 6, 8), ("9-12", 9, 12), ("13+", 13, 10 ** 6)]
FLOOR = 0.660
SLOPE = (0.80, 1.25)
ECE_MAX = 0.050
MIN_BIN = 60


def score(seasons, rows):
    """Out-of-sample p for every game of each target season, plus the naive baselines trained on the same window."""
    out = []
    for s in seasons:
        tr = wf.eligible(rows, wf.train_seasons(s, WINDOW))
        te = [r for r in rows if int(r["season"]) == s]
        Xtr, ytr = wf.matrix(tr, FEATS)
        Xte, yte = wf.matrix(te, FEATS)
        p = wf.fit_lr(Xtr, ytr, SEL["C"], FEATS).predict(Xte)
        nb = wf.naive(tr, te)
        for i, r in enumerate(te):
            out.append({"event_id": r["event_id"], "season": s, "m": min(int(r["home_n_current"]), int(r["away_n_current"])),
                        "eligible": r["eligible"] == "1", "y": int(yte[i]), "p": float(p[i]),
                        "home_rate": float(nb["home_rate"][i]), "net_sign": float(nb["net_rating_sign"][i])})
    return out


def mt(games, key="p"):
    if not games:
        return {"n": 0}
    p = np.array([g[key] for g in games]); y = np.array([g["y"] for g in games])
    m = wf.metrics(p, y)
    m.pop("reliability", None)
    n = m["n"]
    if n < MIN_BIN:
        m["ece"] = "insufficient"
    if n < 100:
        m["calibration_slope"] = "insufficient"; m["calibration_intercept"] = "insufficient"
    return m


def ll(games, key="p"):
    p = np.clip(np.array([g[key] for g in games]), wf.EPS, 1 - wf.EPS); y = np.array([g["y"] for g in games])
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def raw_cal(games):
    m = wf.metrics(np.array([g["p"] for g in games]), np.array([g["y"] for g in games]))
    return m["calibration_slope"], m["ece"]


def bin_table(games):
    rows = []
    for name, lo, hi in BINS:
        g = [x for x in games if lo <= x["m"] <= hi]
        rows.append({"bin": name, "model": mt(g), "coin_0.5": {"log_loss": round(ll(g, "p") * 0 + float(np.log(2)), 5) if g else None},
                     "home_rate": {k: v for k, v in mt(g, "home_rate").items() if k in ("n", "log_loss", "brier", "accuracy")},
                     "net_rating_sign": {k: v for k, v in mt(g, "net_sign").items() if k in ("n", "log_loss", "brier", "accuracy")}})
    return rows


def cumulative(games):
    total = len(games)
    out = []
    for K in range(0, 14):
        g = [x for x in games if x["m"] >= K]
        m = wf.metrics(np.array([x["p"] for x in g]), np.array([x["y"] for x in g]))
        out.append({"K": K, "n": len(g), "coverage_pct": round(100 * len(g) / total, 2), "log_loss": m["log_loss"], "brier": m["brier"], "ece": m["ece"], "calibration_slope": m["calibration_slope"]})
    return out


def judge(games, K):
    """Pre-registered criteria (a), (b), (c) for candidate K on the given games."""
    # (a) bins at or above K, merged upward below MIN_BIN
    edges = []
    for name, lo, hi in BINS:
        if hi < K:
            continue
        edges.append([max(lo, K), hi])
    groups = [[x for x in games if lo <= x["m"] <= hi] for lo, hi in edges]
    labels = [f"{lo}-{hi if hi < 10 ** 6 else '+'}" for lo, hi in edges]
    i = 0
    while i < len(groups):
        if len(groups[i]) < MIN_BIN and len(groups) > 1:
            j = i + 1 if i + 1 < len(groups) else i - 1
            groups[j] = groups[j] + groups[i] if j > i else groups[i] + groups[j]
            labels[j] = f"{labels[min(i, j)].split('-')[0]}-{labels[max(i, j)].split('-', 1)[1]}"
            del groups[i]; del labels[i]
            i = 0
            continue
        i += 1
    a_rows = [{"bin": lab, "n": len(g), "model_log_loss": round(ll(g), 5), "home_rate_log_loss": round(ll(g, "home_rate"), 5), "pass": ll(g) < ll(g, "home_rate")} for lab, g in zip(labels, groups)]
    a = all(r["pass"] for r in a_rows)
    # (b) cumulative calibration
    cum = [x for x in games if x["m"] >= K]
    slope, ece = raw_cal(cum)
    b = SLOPE[0] <= slope <= SLOPE[1] and ece <= ECE_MAX
    # (c) entry slice K..K+2, extended to n >= 60
    hi = K + 2
    entry = [x for x in games if K <= x["m"] <= hi]
    while len(entry) < MIN_BIN and hi < 10 ** 6:
        hi += 1
        entry = [x for x in games if K <= x["m"] <= hi]
        if hi > 200:
            break
    c = ll(entry) < FLOOR
    return {"K": K, "a_bins_beat_home_rate": {"pass": a, "bins": a_rows},
            "b_cumulative_calibration": {"pass": b, "n": len(cum), "calibration_slope": slope, "ece": ece},
            "c_entry_slice": {"pass": c, "range": [K, hi], "n": len(entry), "log_loss": round(ll(entry), 5), "floor": FLOOR},
            "pass": a and b and c}


def main():
    rows, dsha = wf.load(SEL["k"], SEL["r"])
    val = score(wf.VALIDATION, rows)
    hol = score(wf.HOLDOUT, rows)

    # Reconciliation with the committed receipt (holdout, eligible rows, 3-5).
    rec_games = [g for g in hol if g["eligible"] and 3 <= g["m"] <= 5]
    rec = mt(rec_games)
    receipt = json.loads((REPO / "model" / "pbe-wnba-model-v1" / "validation_receipt.json").read_text())
    committed = receipt["holdout"]["logistic_chosen"].get("by_min_current_games", {}).get("3-5") or json.loads((wf.DERIVED / "holdout.json").read_text())["by_min_current_games"]["3-5"]
    reconcile = {"committed": {k: committed[k] for k in ("n", "brier", "log_loss", "accuracy", "roc_auc")},
                 "recomputed": {k: rec[k] for k in ("n", "brier", "log_loss", "accuracy", "roc_auc")}}
    reconcile["match"] = all(abs(float(reconcile["committed"][k]) - float(reconcile["recomputed"][k])) < 5e-5 for k in reconcile["committed"])

    evaluations = [judge(val, K) for K in range(0, 14)]
    passing = [e for e in evaluations if e["pass"]]
    K = passing[0]["K"] if passing else None
    no_call_below = max(K, 3) if K is not None else None

    confirm = None
    if K is not None:
        confirm = {"K": K, "no_call_below": no_call_below, "holdout_judged_same_way": judge(hol, no_call_below),
                   "holdout_cumulative": mt([g for g in hol if g["m"] >= no_call_below]),
                   "holdout_excluded_slice": mt([g for g in hol if g["m"] < no_call_below]),
                   "validation_cumulative": mt([g for g in val if g["m"] >= no_call_below]),
                   "validation_excluded_slice": mt([g for g in val if g["m"] < no_call_below])}

    script_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    prereg_sha = hashlib.sha256((ELIG / "preregistration.json").read_bytes()).hexdigest()
    audit = json.loads((wf.DERIVED / "audit.json").read_text())
    out = {
        "receipt_id": "pbe-wnba-eligibility-study/1",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "model": "pbe-wnba-model-v1",
        "recipe": SEL,
        "preregistration_sha256": prereg_sha,
        "script_sha256": script_sha,
        "walkforward_sha256": hashlib.sha256((Path(__file__).resolve().parent / "walkforward.py").read_bytes()).hexdigest(),
        "dataset_sha256": dsha,
        "rows_sha256": audit["rows_sha256"],
        "reconciliation_holdout_3_5": reconcile,
        "bins": {"validation": bin_table(val), "holdout": bin_table(hol)},
        "cumulative": {"validation": cumulative(val), "holdout": cumulative(hol)},
        "criteria_by_K_validation": evaluations,
        "chosen_K": K,
        "no_call_below": no_call_below,
        "holdout_confirmation": confirm,
        "result": "PASS" if K is not None else "FAIL_NO_K"
    }
    body = (json.dumps(out, indent=2, default=float) + "\n").encode("utf8")
    (ELIG / "eligibility_study_receipt.json").write_bytes(body)
    rsha = hashlib.sha256(body).hexdigest()
    if K is not None:
        contract = {"contract_id": "pbe-wnba-eligibility/1", "status": "PROPOSED", "applies_to_model": "pbe-wnba-model-v1",
                    "rule": {"measure": "min_current_season_final_games", "no_call_below": no_call_below, "reason": "INSUFFICIENT_TEAM_HISTORY"},
                    "derivation": {"preregistration_sha256": prereg_sha, "study_K": K, "mapping": "no_call_below = max(K, 3)"},
                    "evidence": {"receipt": "model/pbe-wnba-model-v1/eligibility/eligibility_study_receipt.json", "receipt_sha256": rsha}}
        (ELIG / "eligibility_contract.proposed.json").write_bytes((json.dumps(contract, indent=2) + "\n").encode("utf8"))
    print(json.dumps({"reconcile": reconcile, "K": K, "no_call_below": no_call_below, "receipt_sha256": rsha,
                      "criteria": [{"K": e["K"], "a": e["a_bins_beat_home_rate"]["pass"], "b": e["b_cumulative_calibration"]["pass"], "slope": round(e["b_cumulative_calibration"]["calibration_slope"], 3), "ece": e["b_cumulative_calibration"]["ece"], "c": e["c_entry_slice"]["pass"], "c_ll": e["c_entry_slice"]["log_loss"], "c_range": e["c_entry_slice"]["range"]} for e in evaluations]}, indent=1))


if __name__ == "__main__":
    main()
