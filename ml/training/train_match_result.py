"""Train the match-result model (and its two goals models) and register them.

    python -m ml.training.train_match_result

Each run writes new ``{model_name}_{version}.json`` artifacts plus matching
``_scaler.json`` files to ``ml/models`` and records them, with their holdout
metrics, in ``model_versions`` / ``training_runs``. Nothing is overwritten.

Evaluation is strictly out of time: the last ``TEST_DAYS`` are a holdout the
model never sees, the ``VAL_DAYS`` before that pick the number of boosting
rounds. The holdout predictions are saved to ``data/backtest.csv``. The
artifact that is registered is then refit on all data with those rounds.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.preprocessing import StandardScaler

from ml import registry
from ml.config import BACKTEST_PATH, MODELS_DIR, ROOT
from ml.data.download import download, load_matches
from ml.features.build import FEATURES, build_features

TEST_DAYS = 365
VAL_DAYS = 365
MAX_ROUNDS = 2000
EARLY_STOPPING = 60

BASE_PARAMS = {
    "eta": 0.03,
    "max_depth": 4,
    "min_child_weight": 25,
    "subsample": 0.8,
    "colsample_bytree": 0.7,
    "lambda": 3.0,
    "tree_method": "hist",
    "seed": 42,
}
MODELS = {
    "match_result": {**BASE_PARAMS, "objective": "multi:softprob", "num_class": 3, "eval_metric": "mlogloss"},
    "home_goals": {**BASE_PARAMS, "objective": "count:poisson", "eval_metric": "poisson-nloglik"},
    "away_goals": {**BASE_PARAMS, "objective": "count:poisson", "eval_metric": "poisson-nloglik"},
}


def targets(df: pd.DataFrame) -> dict[str, np.ndarray]:
    result = np.where(df["fthg"] > df["ftag"], 0, np.where(df["fthg"] == df["ftag"], 1, 2))
    return {"match_result": result, "home_goals": df["fthg"].to_numpy(), "away_goals": df["ftag"].to_numpy()}


def prob_metrics(p: np.ndarray, y: np.ndarray) -> dict:
    onehot = np.eye(3)[y]
    cum_p, cum_y = np.cumsum(p, axis=1)[:, :2], np.cumsum(onehot, axis=1)[:, :2]
    return {
        "n": int(len(y)),
        "accuracy": float((p.argmax(1) == y).mean()),
        "log_loss": float(-np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1)).mean()),
        "brier": float(((p - onehot) ** 2).sum(1).mean()),
        "rps": float(((cum_p - cum_y) ** 2).sum(1).mean() / 2),
    }


def calibration(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    """Reliability of every (match, outcome) probability, pooled."""
    flat_p, flat_y = p.ravel(), np.eye(3)[y].ravel()
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (flat_p >= lo) & (flat_p < hi)
        if mask.sum() >= 30:
            out.append({"lo": float(lo), "hi": float(hi), "predicted": float(flat_p[mask].mean()),
                        "observed": float(flat_y[mask].mean()), "n": int(mask.sum())})
    return out


def scale(scaler: StandardScaler, x: pd.DataFrame) -> np.ndarray:
    return scaler.transform(x[FEATURES].to_numpy(dtype=float))


def save_scaler(scaler: StandardScaler, path) -> None:
    path.write_text(json.dumps({"feature_names": FEATURES, "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()}))


def train() -> str:
    version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = registry.start_run({"models": MODELS, "test_days": TEST_DAYS, "val_days": VAL_DAYS})
    try:
        matches = load_matches()
        feats, _ = build_features(matches)
        df = pd.concat([matches, feats], axis=1)
        # the opening season only warms up ratings and form
        df = df[df["played"] & (df["season"] > df["season"].min())].reset_index(drop=True)

        end = df["date"].max()
        test_start = end - timedelta(days=TEST_DAYS)
        val_start = test_start - timedelta(days=VAL_DAYS)
        tr, va, te = df[df["date"] < val_start], df[(df["date"] >= val_start) & (df["date"] < test_start)], df[df["date"] >= test_start]
        print(f"train {len(tr):,} | val {len(va):,} | holdout {len(te):,} ({test_start:%Y-%m-%d} to {end:%Y-%m-%d})")

        scaler = StandardScaler().fit(tr[FEATURES].to_numpy(dtype=float))
        x_tr, x_va, x_te = scale(scaler, tr), scale(scaler, va), scale(scaler, te)
        y_tr, y_va, y_te = targets(tr), targets(va), targets(te)

        rounds, holdout, importance = {}, {}, {}
        for name, params in MODELS.items():
            booster = xgb.train(
                params,
                xgb.DMatrix(x_tr, label=y_tr[name], feature_names=FEATURES),
                num_boost_round=MAX_ROUNDS,
                evals=[(xgb.DMatrix(x_va, label=y_va[name], feature_names=FEATURES), "val")],
                early_stopping_rounds=EARLY_STOPPING,
                verbose_eval=False,
            )
            rounds[name] = booster.best_iteration + 1
            holdout[name] = booster.predict(xgb.DMatrix(x_te, feature_names=FEATURES), iteration_range=(0, rounds[name]))
            importance[name] = booster.get_score(importance_type="gain")
            print(f"  {name}: {rounds[name]} rounds")

        p = holdout["match_result"]
        y = y_te["match_result"]
        has_odds = te[["odds_h", "odds_d", "odds_a"]].notna().all(axis=1).to_numpy()
        inv = 1 / te.loc[has_odds, ["odds_h", "odds_d", "odds_a"]].to_numpy()
        book = inv / inv.sum(axis=1, keepdims=True)
        base = np.tile(np.bincount(y_tr["match_result"], minlength=3) / len(tr), (len(te), 1))
        total_gain = sum(importance["match_result"].values())
        metrics = {
            "model": prob_metrics(p, y),
            "model_on_priced": prob_metrics(p[has_odds], y[has_odds]),
            "bookmaker": prob_metrics(book, y[has_odds]),
            "base_rate": prob_metrics(base, y),
            "goals_mae": {"home": float(np.abs(holdout["home_goals"] - y_te["home_goals"]).mean()),
                          "away": float(np.abs(holdout["away_goals"] - y_te["away_goals"]).mean())},
            "calibration": calibration(p, y),
            "importance": sorted(({"feature": k, "gain": v / total_gain} for k, v in importance["match_result"].items()),
                                 key=lambda r: -r["gain"])[:15],
            "rounds": rounds,
            "splits": {"train": len(tr), "val": len(va), "test": len(te),
                       "data_from": f"{df['date'].min():%Y-%m-%d}", "test_from": f"{test_start:%Y-%m-%d}", "data_through": f"{end:%Y-%m-%d}"},
        }

        backtest = te[["id", "date", "div", "home", "away", "fthg", "ftag", "odds_h", "odds_d", "odds_a", "odds_o25", "odds_u25"]].copy()
        backtest[["p_h", "p_d", "p_a"]] = p
        backtest["lam_h"], backtest["lam_a"] = holdout["home_goals"], holdout["away_goals"]
        backtest["version"] = version
        backtest.to_csv(BACKTEST_PATH, index=False)

        # final artifacts: refit on everything with the round counts chosen above
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        final_scaler = StandardScaler().fit(df[FEATURES].to_numpy(dtype=float))
        x_all, y_all = scale(final_scaler, df), targets(df)
        for name, params in MODELS.items():
            artifact = MODELS_DIR / f"{name}_{version}.json"
            scaler_path = MODELS_DIR / f"{name}_{version}_scaler.json"
            if artifact.exists() or scaler_path.exists():
                raise FileExistsError(f"refusing to overwrite {artifact.name}")
            booster = xgb.train(params, xgb.DMatrix(x_all, label=y_all[name], feature_names=FEATURES), num_boost_round=rounds[name])
            booster.save_model(artifact)
            save_scaler(final_scaler, scaler_path)
            registry.register(name, version, str(artifact.relative_to(ROOT).as_posix()),
                              str(scaler_path.relative_to(ROOT).as_posix()), run_id, metrics if name == "match_result" else {"rounds": rounds[name]})

        registry.finish_run(run_id, "succeeded", n_train=len(tr), n_val=len(va), n_test=len(te),
                            data_from=metrics["splits"]["data_from"], data_through=metrics["splits"]["data_through"])
    except Exception:
        registry.finish_run(run_id, "failed")
        raise

    m, b = metrics["model_on_priced"], metrics["bookmaker"]
    print(f"version {version}")
    print(f"  holdout accuracy {metrics['model']['accuracy']:.3f}  log loss {metrics['model']['log_loss']:.4f}  (base rate {metrics['base_rate']['log_loss']:.4f})")
    print(f"  vs bookmaker on {m['n']:,} priced matches: model {m['accuracy']:.3f}/{m['log_loss']:.4f}, market {b['accuracy']:.3f}/{b['log_loss']:.4f}")
    return version


if __name__ == "__main__":
    download()
    train()
