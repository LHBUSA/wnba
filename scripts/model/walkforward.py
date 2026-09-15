"""PBE WNBA model v1 - walk-forward selection, holdout, freeze.

    python scripts/model/walkforward.py select     # validation seasons only -> derived/selection.json
    python scripts/model/walkforward.py holdout    # ONE evaluation of the frozen recipe on 2025 + 2026
    python scripts/model/walkforward.py freeze     # fit the recipe on every eligible game -> model/pbe-wnba-model-v1/

Rules:
  * Walk-forward by season only. Never a random split.
  * Hyperparameters (shrinkage k/r, feature set, L2 C, training window) are chosen
    on VALIDATION seasons 2015-2024 by pooled log loss. 2025 and 2026 are not read
    by `select`.
  * Sportsbook prices are never a feature. ESPN pickcenter moneylines (2026 only)
    are read in `holdout` for evaluation, after predictions exist.
"""
import csv, hashlib, json, math, os, sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier

ROOT = Path(os.environ.get("WNBA_MODEL_DATA", "D:/Workers/wnba-model-data"))
DERIVED = ROOT / "derived"
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "model" / "pbe-wnba-model-v1"

FIRST_TARGET_SEASON = 2005
VALIDATION = list(range(2015, 2025))
HOLDOUT = [2025, 2026]
K_GRID = [4, 8, 12, 20]
R_GRID = [0.4, 0.6, 0.8]
C_GRID = [0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 100.0]
WINDOWS = {"expanding": None, "last8": 8}

FEATURE_SETS = {
    "A_core": ["net_rating", "home_court"],
    "B_four_factors": ["efg_margin", "tov_margin", "orb_margin", "ftr_margin", "home_court"],
    "C_core_situation": ["net_rating", "home_court", "rest", "back_to_back", "games_last7"],
    "D_core_form_situation": ["net_rating", "form10", "form5", "home_court", "rest", "back_to_back", "games_last7"],
    "E_core_form_situation_rotation": ["net_rating", "form10", "home_court", "rest", "back_to_back", "availability", "continuity"],
    "F_sos_form_situation_rotation": ["sos_adj_net", "form10", "home_court", "rest", "back_to_back", "availability", "continuity"],
    "G_all": ["net_rating", "sos_adj_net", "efg_margin", "tov_margin", "orb_margin", "ftr_margin", "pace", "form10", "form5",
              "home_court", "rest", "back_to_back", "games_last7", "availability", "continuity", "concentration"],
}
HGB_GRID = [
    dict(max_depth=3, learning_rate=0.05, max_iter=150, min_samples_leaf=40, l2_regularization=1.0),
    dict(max_depth=2, learning_rate=0.05, max_iter=300, min_samples_leaf=60, l2_regularization=1.0),
    dict(max_depth=4, learning_rate=0.03, max_iter=200, min_samples_leaf=80, l2_regularization=5.0),
]
EPS = 1e-12
# Product policy - mirrors scripts/model/finalize.mjs POLICY; fixed before holdout.
POLICY = {"min_pick_probability": 0.53, "high_min_prob": 0.70, "medium_min_prob": 0.60, "full_depth_min_games": 8}


def tier_table(p, y, rows):
    out = {}
    for pi, yi, r in zip(p, y, rows):
        pick_home = pi >= 0.5
        pp = pi if pick_home else 1 - pi
        ng = min(int(r["home_n_current"]), int(r["away_n_current"]))
        if pp < POLICY["min_pick_probability"]:
            t = "NO_CALL"
        else:
            t = "High" if pp >= POLICY["high_min_prob"] else "Medium" if pp >= POLICY["medium_min_prob"] else "Low"
            if ng < POLICY["full_depth_min_games"] and t != "Low":
                t = "Medium" if t == "High" else "Low"
        d = out.setdefault(t, {"n": 0, "correct": 0, "sum_p": 0.0})
        d["n"] += 1
        d["correct"] += int(pick_home == (yi == 1))
        d["sum_p"] += pp
    return {t: {"n": d["n"], "hit_rate": round(d["correct"] / d["n"], 4), "mean_pick_prob": round(d["sum_p"] / d["n"], 4)} for t, d in sorted(out.items())}


def load(k, r):
    path = DERIVED / f"dataset_k{k}_r{r}.csv"
    raw = path.read_bytes()
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    return rows, hashlib.sha256(raw).hexdigest()


def matrix(rows, feats):
    X = np.array([[float(r[f]) for f in feats] for r in rows], dtype=float)
    y = np.array([int(r["home_won"]) for r in rows], dtype=int)
    return X, y


def eligible(rows, seasons):
    s = set(seasons)
    return [r for r in rows if int(r["season"]) in s and r["eligible"] == "1"]


def train_seasons(target, window):
    lo = FIRST_TARGET_SEASON if window is None else max(FIRST_TARGET_SEASON, target - window)
    return list(range(lo, target))


HOME = "home_court"


class LR:
    """L2 logistic regression with a structural home-court term.

    logit P(home wins) = b_home * home_court + sum_j w_j * (x_j - mean_j) / std_j

    * No free intercept: at a neutral site (home_court = 0) the listed home team
      gets no edge by construction, and the 2020 single-site season is not scored
      with a home advantage learned from arena games.
    * home_court is neither standardized nor penalized (it is ~always 1 in
      training; standardizing it made a neutral game a 28-sigma outlier).
    * Every other feature is standardized on the training rows (ddof 0) and
      carries the L2 penalty 0.5 * ||w||^2 / C against the summed log loss.
    """

    def __init__(self, feats, C):
        self.feats, self.C = list(feats), C

    def _design(self, X):
        h = X[:, self.hi] if self.hi is not None else np.zeros(len(X))
        Z = (X[:, self.oi] - self.mu) / self.sd
        return h, Z

    def fit(self, X, y):
        from scipy.optimize import minimize
        self.hi = self.feats.index(HOME) if HOME in self.feats else None
        self.oi = [i for i, f in enumerate(self.feats) if f != HOME]
        self.mu = X[:, self.oi].mean(axis=0)
        self.sd = X[:, self.oi].std(axis=0)
        self.sd[self.sd == 0] = 1.0
        h, Z = self._design(X)
        y = y.astype(float)
        lam = 1.0 / self.C

        def fg(theta):
            b, w = theta[0], theta[1:]
            z = b * h + Z @ w
            loss = np.sum(np.logaddexp(0, z) - y * z) + 0.5 * lam * w @ w
            g = 1 / (1 + np.exp(-z)) - y
            return loss, np.concatenate([[g @ h], Z.T @ g + lam * w])

        res = minimize(fg, np.zeros(1 + Z.shape[1]), jac=True, method="L-BFGS-B",
                       options={"maxiter": 20000, "gtol": 1e-11, "ftol": 1e-16})
        gnorm = float(np.max(np.abs(fg(res.x)[1]))) / len(y)
        if gnorm > 1e-8:
            raise RuntimeError(f"LR fit did not converge: {res.message} |grad|={gnorm}")
        self.b_home, self.w = float(res.x[0]), res.x[1:]
        return self

    def predict(self, X):
        h, Z = self._design(X)
        z = self.b_home * h + Z @ self.w
        return 1.0 / (1.0 + np.exp(-z))


def fit_lr(X, y, C, feats):
    return LR(feats, C).fit(X, y)


def metrics(p, y):
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    y = np.asarray(y, dtype=float)
    n = len(y)
    brier = float(np.mean((p - y) ** 2))
    ll = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
    acc = float(np.mean((p >= 0.5) == (y == 1)))
    order = np.argsort(p)
    ranks = np.empty(n)
    ranks[order] = np.arange(1, n + 1)
    # average ranks for ties
    _, inv, counts = np.unique(p, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, weights=ranks)
    ranks = (sums / counts)[inv]
    pos = y == 1
    npos, nneg = pos.sum(), (~pos).sum()
    auc = float((ranks[pos].sum() - npos * (npos + 1) / 2) / (npos * nneg)) if npos and nneg else None
    bins = []
    ece = 0.0
    edges = np.linspace(0, 1, 11)
    for i in range(10):
        m = (p >= edges[i]) & ((p < edges[i + 1]) if i < 9 else (p <= 1))
        if m.sum():
            gap = abs(p[m].mean() - y[m].mean())
            ece += m.sum() / n * gap
            bins.append({"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "n": int(m.sum()), "mean_p": round(float(p[m].mean()), 4), "observed": round(float(y[m].mean()), 4)})
    lg = np.log(p / (1 - p)).reshape(-1, 1)
    cal = LogisticRegression(C=1e6, max_iter=1000).fit(lg, y.astype(int)) if len(set(y)) == 2 else None
    return {
        "n": int(n), "brier": round(brier, 5), "log_loss": round(ll, 5), "accuracy": round(acc, 4),
        "roc_auc": None if auc is None else round(auc, 4), "ece": round(float(ece), 4),
        "calibration_slope": None if cal is None else round(float(cal.coef_[0][0]), 3),
        "calibration_intercept": None if cal is None else round(float(cal.intercept_[0]), 3),
        "reliability": bins,
    }


def naive(train_rows, test_rows):
    ytr = np.array([int(r["home_won"]) for r in train_rows])
    home_rate = float(ytr.mean())
    net_tr = np.array([float(r["net_rating"]) for r in train_rows])
    fav_home = net_tr > 0
    acc = float(np.mean(np.where(net_tr == 0, ytr == 1, fav_home == (ytr == 1))))
    net_te = np.array([float(r["net_rating"]) for r in test_rows])
    return {
        "coin_0.5": np.full(len(test_rows), 0.5),
        "home_rate": np.full(len(test_rows), home_rate),
        "net_rating_sign": np.where(net_te > 0, acc, np.where(net_te < 0, 1 - acc, home_rate)),
    }


def walk(rows, feats, C, window, seasons):
    ps, ys, per = [], [], {}
    for s in seasons:
        tr = eligible(rows, train_seasons(s, window))
        te = eligible(rows, [s])
        Xtr, ytr = matrix(tr, feats)
        Xte, yte = matrix(te, feats)
        p = fit_lr(Xtr, ytr, C, feats).predict(Xte)
        ps.append(p); ys.append(yte)
        per[s] = (p, yte, tr, te)
    return np.concatenate(ps), np.concatenate(ys), per


def select():
    results = []
    cache = {}
    for k in K_GRID:
        for r in R_GRID:
            rows, sha = load(k, r)
            cache[(k, r)] = (rows, sha)
            for fs_name, feats in FEATURE_SETS.items():
                for wname, window in WINDOWS.items():
                    for C in C_GRID:
                        p, y, _ = walk(rows, feats, C, window, VALIDATION)
                        mt = metrics(p, y)
                        results.append({"k": k, "r": r, "feature_set": fs_name, "window": wname, "C": C,
                                        "log_loss": mt["log_loss"], "brier": mt["brier"], "accuracy": mt["accuracy"], "roc_auc": mt["roc_auc"], "ece": mt["ece"], "n": mt["n"]})
            print(f"k={k} r={r} done; best so far", min(results, key=lambda x: x["log_loss"]))
    results.sort(key=lambda x: (x["log_loss"], x["brier"]))
    best = results[0]
    # Simplicity rule: among configs within 0.002 log loss of the best, take the fewest features, then larger C penalty (smaller C).
    tol = 0.002
    near = [x for x in results if x["log_loss"] <= best["log_loss"] + tol]
    near.sort(key=lambda x: (len(FEATURE_SETS[x["feature_set"]]), x["log_loss"]))
    chosen = near[0]

    rows, sha = cache[(chosen["k"], chosen["r"])]
    feats = FEATURE_SETS[chosen["feature_set"]]
    window = WINDOWS[chosen["window"]]
    p_lr, y, per = walk(rows, feats, chosen["C"], window, VALIDATION)
    lr_detail = {"pooled": metrics(p_lr, y), "per_season": {s: metrics(v[0], v[1]) for s, v in per.items()}}

    # Also the best LR on the richest set, for the record.
    best_full = min([x for x in results if x["feature_set"] == "G_all"], key=lambda x: x["log_loss"])

    # Tree baseline on the chosen shrinkage dataset with ALL candidate features.
    allf = FEATURE_SETS["G_all"]
    hgb_runs = []
    for i, params in enumerate(HGB_GRID):
        ps, ys = [], []
        for s in VALIDATION:
            tr = eligible(rows, train_seasons(s, window)); te = eligible(rows, [s])
            Xtr, ytr = matrix(tr, allf); Xte, yte = matrix(te, allf)
            m = HistGradientBoostingClassifier(random_state=0, early_stopping=False, **params).fit(Xtr, ytr)
            ps.append(m.predict_proba(Xte)[:, 1]); ys.append(yte)
        mt = metrics(np.concatenate(ps), np.concatenate(ys))
        hgb_runs.append({"params": params, **{k2: mt[k2] for k2 in ("n", "log_loss", "brier", "accuracy", "roc_auc", "ece", "calibration_slope", "calibration_intercept")}})
    hgb_best = min(hgb_runs, key=lambda x: x["log_loss"])

    # Naive baselines pooled over validation.
    nb = {"coin_0.5": [], "home_rate": [], "net_rating_sign": []}
    yv = []
    for s in VALIDATION:
        tr = eligible(rows, train_seasons(s, window)); te = eligible(rows, [s])
        for name, p in naive(tr, te).items():
            nb[name].append(p)
        yv.append(np.array([int(r["home_won"]) for r in te]))
    yv = np.concatenate(yv)
    naive_metrics = {name: metrics(np.concatenate(v), yv) for name, v in nb.items()}
    for v in naive_metrics.values():
        v.pop("reliability", None)

    out = {
        "stage": "select",
        "validation_seasons": VALIDATION,
        "selection_metric": "pooled walk-forward log loss on eligible games",
        "simplicity_rule": f"fewest features among configs within {tol} log loss of the best",
        "grid": {"k": K_GRID, "r": R_GRID, "C": C_GRID, "windows": list(WINDOWS), "feature_sets": FEATURE_SETS},
        "configs_evaluated": len(results),
        "best_by_log_loss": best,
        "chosen": chosen,
        "best_G_all": best_full,
        "chosen_dataset_sha256": sha,
        "logistic_chosen": lr_detail,
        "hgb_runs": hgb_runs,
        "hgb_best": hgb_best,
        "naive": naive_metrics,
        "top20": results[:20],
    }
    (DERIVED / "selection.json").write_text(json.dumps(out, indent=2, default=str))
    print(json.dumps({"chosen": chosen, "best": best, "best_G_all": best_full, "lr": lr_detail["pooled"] | {"reliability": None},
                      "hgb_best": hgb_best, "naive": naive_metrics}, indent=1, default=str))


def devig(home_ml, away_ml):
    def imp(a):
        return 100 / (a + 100) if a > 0 else -a / (-a + 100)
    h, a = imp(home_ml), imp(away_ml)
    return h / (h + a)


def holdout():
    sel = json.loads((DERIVED / "selection.json").read_text())
    c = sel["chosen"]
    rows, sha = load(c["k"], c["r"])
    feats = FEATURE_SETS[c["feature_set"]]
    window = WINDOWS[c["window"]]
    p, y, per = walk(rows, feats, c["C"], window, HOLDOUT)
    out = {"stage": "holdout", "evaluated_once": True, "recipe": c, "dataset_sha256": sha,
           "pooled": metrics(p, y), "per_season": {s: metrics(v[0], v[1]) for s, v in per.items()}}
    out["tiers"] = tier_table(p, y, [r for s in HOLDOUT for r in per[s][3]])
    pv, yv, perv = walk(rows, feats, c["C"], window, VALIDATION)
    out["validation_tiers"] = tier_table(pv, yv, [r for s in VALIDATION for r in perv[s][3]])
    # HGB (best validation params) on the same holdout, for the comparison table.
    hp = sel["hgb_best"]["params"]; allf = FEATURE_SETS["G_all"]
    hps, hys = [], []
    for s in HOLDOUT:
        tr = eligible(rows, train_seasons(s, window)); te = eligible(rows, [s])
        Xtr, ytr = matrix(tr, allf); Xte, yte = matrix(te, allf)
        m = HistGradientBoostingClassifier(random_state=0, early_stopping=False, **hp).fit(Xtr, ytr)
        hps.append(m.predict_proba(Xte)[:, 1]); hys.append(yte)
    out["hgb_pooled"] = metrics(np.concatenate(hps), np.concatenate(hys))
    # Naive baselines on holdout.
    nb = {"coin_0.5": [], "home_rate": [], "net_rating_sign": []}; yy = []
    for s in HOLDOUT:
        tr = eligible(rows, train_seasons(s, window)); te = eligible(rows, [s])
        for name, pp in naive(tr, te).items():
            nb[name].append(pp)
        yy.append(np.array([int(r["home_won"]) for r in te]))
    yy = np.concatenate(yy)
    out["naive"] = {k2: {kk: vv for kk, vv in metrics(np.concatenate(v), yy).items() if kk != "reliability"} for k2, v in nb.items()}
    # Early-season bucket (eligibility floor is 3 current games).
    te_all = [r for s in HOLDOUT for r in eligible(rows, [s])]
    ncur = np.array([min(int(r["home_n_current"]), int(r["away_n_current"])) for r in te_all])
    out["by_min_current_games"] = {}
    for lo, hi in [(3, 5), (6, 10), (11, 20), (21, 99)]:
        m = (ncur >= lo) & (ncur <= hi)
        if m.sum() >= 20:
            mt = metrics(p[m], y[m]); mt.pop("reliability")
            out["by_min_current_games"][f"{lo}-{hi}"] = mt
    # Market comparison, 2026 only, EVALUATION ONLY.
    mk = {}
    mpath = DERIVED / "markets-eval-only.jsonl"
    for line in mpath.read_text().splitlines():
        if line.strip():
            j = json.loads(line); mk[j["event_id"]] = j
    p26, y26, _, te26 = per[2026][0], per[2026][1], None, per[2026][3]
    idx = [i for i, r in enumerate(te26) if r["event_id"] in mk]
    if idx:
        pm = np.array([devig(mk[te26[i]["event_id"]]["home_ml"], mk[te26[i]["event_id"]]["away_ml"]) for i in idx])
        pp = p26[idx]; yy2 = y26[idx]
        mm = metrics(pm, yy2); mm.pop("reliability")
        mp = metrics(pp, yy2); mp.pop("reliability")
        blend_note = "market probabilities are ESPN pickcenter moneylines (timing not published; treat as near-close), de-vigged proportionally"
        out["market_comparison_2026_eval_only"] = {"n": len(idx), "pbe": mp, "market_devig": mm,
                                                   "mean_abs_gap_pts": round(float(np.mean(np.abs(pp - pm)) * 100), 2),
                                                   "corr": round(float(np.corrcoef(pp, pm)[0, 1]), 3), "note": blend_note}
    (DERIVED / "holdout.json").write_text(json.dumps(out, indent=2, default=str))
    show = json.loads(json.dumps(out, default=str))
    show["pooled"].pop("reliability", None)
    for v in show["per_season"].values():
        v.pop("reliability", None)
    show["hgb_pooled"].pop("reliability", None)
    print(json.dumps(show, indent=1))


def canonical(obj):
    return (json.dumps(obj, indent=2, sort_keys=False) + "\n").encode("utf8")


def freeze():
    sel = json.loads((DERIVED / "selection.json").read_text())
    c = sel["chosen"]
    rows, sha = load(c["k"], c["r"])
    feats = FEATURE_SETS[c["feature_set"]]
    window = WINDOWS[c["window"]]
    last_season = max(int(r["season"]) for r in rows)
    seasons = train_seasons(last_season + 1, window)
    tr = eligible(rows, seasons)
    X, y = matrix(tr, feats)
    m = fit_lr(X, y, c["C"], feats)
    std_feats = [feats[i] for i in m.oi]
    starts = sorted(r["start_utc"] for r in tr)
    artifact = {
        "model_id": "pbe-wnba-model-v1",
        "model_type": "logistic_regression_l2_structural_home",
        "target": "P(listed home team wins)",
        "formula": "logit = home_coefficient * home_court + sum_j coefficients[j] * (x_j - mean[j]) / std[j]",
        "feature_schema": "pbe-wnba-features/1.0.0",
        "feature_order": feats,
        "home_term": {"feature": HOME, "coefficient": m.b_home, "standardized": False, "penalized": False},
        "standardized_features": std_feats,
        "standardization": {"mean": [float(v) for v in m.mu], "std": [float(v) for v in m.sd], "ddof": 0},
        "coefficients": [float(v) for v in m.w],
        "intercept": None,
        "calibration": None,
        "params": {"prior_games": c["k"], "carryover": c["r"], "min_current_games": 3},
        "regularization": {"penalty": "l2 on standardized coefficients (home term unpenalized)", "C": c["C"],
                           "objective": "sum log loss + 0.5 * ||w||^2 / C", "solver": "scipy L-BFGS-B"},
        "training_window": {"seasons": [seasons[0], seasons[-1]], "window": c["window"], "first_game_utc": starts[0],
                            "last_game_utc": starts[-1], "rows": int(len(tr)), "eligible_only": True, "season_types": [2, 3],
                            "as_of_offset_minutes": 15},
        "dataset_sha256": sha,
        "rows_sha256": json.loads((DERIVED / "audit.json").read_text())["rows_sha256"],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "artifact.json").write_bytes(canonical(artifact))
    # Parity fixture: the latest 60 eligible games scored by THIS artifact (full float precision).
    te = eligible(rows, [last_season])[-60:]
    Xt, _ = matrix(te, feats)
    pt = m.predict(Xt)
    fx = [{"event_id": r["event_id"], "vector": [float(r[f]) for f in feats], "p_home": float(p)} for r, p in zip(te, pt)]
    fdir = REPO / "tests" / "fixtures" / "pbe-wnba-model"
    fdir.mkdir(parents=True, exist_ok=True)
    (fdir / "parity.json").write_bytes(canonical({"artifact_sha256": hashlib.sha256(canonical(artifact)).hexdigest(), "games": fx}))
    print(json.dumps({k: artifact[k] for k in ("feature_order", "home_term", "coefficients", "params", "training_window")}, indent=1))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"select": select, "holdout": holdout, "freeze": freeze}.get(cmd, lambda: sys.exit("usage: walkforward.py select|holdout|freeze"))()
