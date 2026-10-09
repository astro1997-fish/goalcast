"""Train the international models: one family for national teams, one for continental clubs.

    python -m ml.intl.train

Each family is three XGBoost models (``{family}_match_result``,
``{family}_home_goals``, ``{family}_away_goals``) registered exactly like the
league models: new versioned artifacts with scalers, nothing overwritten,
metrics from an out-of-time holdout (the last 365 days).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.preprocessing import StandardScaler

from ml import registry
from ml.config import MODELS_DIR, ROOT
from ml.intl.config import CLUBS_TRAIN_FROM, INTL_BACKTEST_PATH, NATIONS_TRAIN_FROM
from ml.intl.data import download_nations, load_clubs, load_nations, update_clubs
from ml.intl.features import INTL_FEATURES, build_intl_features
from ml.training.train_match_result import BASE_PARAMS, EARLY_STOPPING, MAX_ROUNDS, calibration, prob_metrics, targets

TEST_DAYS = 365
VAL_DAYS = 365
# fewer matches than the league model, so shallower trees and heavier regularisation
PARAMS = {**BASE_PARAMS, "max_depth": 3, "min_child_weight": 40, "eta": 0.02}
OBJECTIVES = {
    "match_result": {"objective": "multi:softprob", "num_class": 3, "eval_metric": "mlogloss"},
    "home_goals": {"objective": "count:poisson", "eval_metric": "poisson-nloglik"},
    "away_goals": {"objective": "count:poisson", "eval_metric": "poisson-nloglik"},
}
FAMILIES = {"nations": NATIONS_TRAIN_FROM, "clubs": CLUBS_TRAIN_FROM}


def _x(scaler: StandardScaler, df: pd.DataFrame) -> np.ndarray:
    return scaler.transform(df[INTL_FEATURES].to_numpy(dtype=float))


def train_family(family: str, matches: pd.DataFrame, version: str, run_id: int) -> tuple[dict, pd.DataFrame]:
    feats, _ = build_intl_features(matches)
    df = pd.concat([matches.drop(columns=["neutral", "importance"]), feats], axis=1)
    df = df[df["played"] & (df["date"] >= FAMILIES[family])].reset_index(drop=True)
    end = df["date"].max()
    test_start = end - timedelta(days=TEST_DAYS)
    val_start = test_start - timedelta(days=VAL_DAYS)
    tr, va, te = df[df["date"] < val_start], df[(df["date"] >= val_start) & (df["date"] < test_start)], df[df["date"] >= test_start]
    print(f"{family}: train {len(tr):,} | val {len(va):,} | holdout {len(te):,}")

    scaler = StandardScaler().fit(tr[INTL_FEATURES].to_numpy(dtype=float))
    y_tr, y_va, y_te = targets(tr), targets(va), targets(te)
    rounds, holdout = {}, {}
    for name, objective in OBJECTIVES.items():
        booster = xgb.train(
            {**PARAMS, **objective},
            xgb.DMatrix(_x(scaler, tr), label=y_tr[name], feature_names=INTL_FEATURES),
            num_boost_round=MAX_ROUNDS,
            evals=[(xgb.DMatrix(_x(scaler, va), label=y_va[name], feature_names=INTL_FEATURES), "val")],
            early_stopping_rounds=EARLY_STOPPING, verbose_eval=False,
        )
        rounds[name] = booster.best_iteration + 1
        holdout[name] = booster.predict(xgb.DMatrix(_x(scaler, te), feature_names=INTL_FEATURES), iteration_range=(0, rounds[name]))

    p, y = holdout["match_result"], y_te["match_result"]
    base = np.tile(np.bincount(y_tr["match_result"], minlength=3) / len(tr), (len(te), 1))
    metrics = {
        "model": prob_metrics(p, y), "base_rate": prob_metrics(base, y), "calibration": calibration(p, y), "rounds": rounds,
        "splits": {"train": len(tr), "val": len(va), "test": len(te), "data_from": f"{df['date'].min():%Y-%m-%d}",
                   "test_from": f"{test_start:%Y-%m-%d}", "data_through": f"{end:%Y-%m-%d}"},
    }

    backtest = te[["id", "date", "comp", "league", "region", "home", "away", "fthg", "ftag"]].copy()
    backtest[["p_h", "p_d", "p_a"]] = p
    backtest["lam_h"], backtest["lam_a"] = holdout["home_goals"], holdout["away_goals"]
    backtest["family"], backtest["version"] = family, version

    final_scaler = StandardScaler().fit(df[INTL_FEATURES].to_numpy(dtype=float))
    y_all = targets(df)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for name, objective in OBJECTIVES.items():
        model_name = f"{family}_{name}"
        artifact, scaler_path = MODELS_DIR / f"{model_name}_{version}.json", MODELS_DIR / f"{model_name}_{version}_scaler.json"
        if artifact.exists() or scaler_path.exists():
            raise FileExistsError(f"refusing to overwrite {artifact.name}")
        booster = xgb.train({**PARAMS, **objective}, xgb.DMatrix(_x(final_scaler, df), label=y_all[name], feature_names=INTL_FEATURES),
                            num_boost_round=rounds[name])
        booster.save_model(artifact)
        scaler_path.write_text(json.dumps({"feature_names": INTL_FEATURES, "mean": final_scaler.mean_.tolist(), "scale": final_scaler.scale_.tolist()}))
        registry.register(model_name, version, artifact.relative_to(ROOT).as_posix(), scaler_path.relative_to(ROOT).as_posix(), run_id,
                          metrics if name == "match_result" else {"rounds": rounds[name]})
    m, b = metrics["model"], metrics["base_rate"]
    print(f"  holdout accuracy {m['accuracy']:.3f}  log loss {m['log_loss']:.4f}  (base rate {b['accuracy']:.3f} / {b['log_loss']:.4f})")
    return metrics, backtest


def train_intl() -> str:
    version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = registry.start_run({"families": list(FAMILIES), "params": PARAMS, "test_days": TEST_DAYS})
    try:
        frames = {"nations": load_nations(with_fixtures=False), "clubs": load_clubs()}
        backtests = [train_family(family, frames[family], version, run_id)[1] for family in FAMILIES]
        pd.concat(backtests, ignore_index=True).to_csv(INTL_BACKTEST_PATH, index=False)
        registry.finish_run(run_id, "succeeded")
    except Exception:
        registry.finish_run(run_id, "failed")
        raise
    return version


if __name__ == "__main__":
    download_nations()
    update_clubs()
    train_intl()
