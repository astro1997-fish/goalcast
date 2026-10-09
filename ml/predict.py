"""Load registered artifacts and score matches."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import xgboost as xgb

from ml import registry
from ml.config import MODELS_DIR, ROOT

MODEL_NAMES = ("match_result", "home_goals", "away_goals")


def latest_version() -> str:
    row = registry.latest_version("match_result")
    if row:
        return row["version"]
    files = sorted(MODELS_DIR.glob("match_result_*Z.json"))
    if not files:
        raise FileNotFoundError("no trained model: run `python -m ml.training.train_match_result`")
    return files[-1].stem.removeprefix("match_result_")


class Predictor:
    def __init__(self, version: str | None = None):
        self.version = version or latest_version()
        self.boosters, self.scalers = {}, {}
        for name in MODEL_NAMES:
            booster = xgb.Booster()
            booster.load_model(ROOT / "ml" / "models" / f"{name}_{self.version}.json")
            self.boosters[name] = booster
            self.scalers[name] = json.loads((MODELS_DIR / f"{name}_{self.version}_scaler.json").read_text())

    def _run(self, name: str, feats: pd.DataFrame) -> np.ndarray:
        s = self.scalers[name]
        x = (feats[s["feature_names"]].to_numpy(dtype=float) - np.array(s["mean"])) / np.array(s["scale"])
        return self.boosters[name].predict(xgb.DMatrix(x, feature_names=s["feature_names"]))

    def predict(self, feats: pd.DataFrame) -> pd.DataFrame:
        """Columns p_h, p_d, p_a (match result) and lam_h, lam_a (expected goals)."""
        out = pd.DataFrame(self._run("match_result", feats), columns=["p_h", "p_d", "p_a"], index=feats.index)
        out["lam_h"], out["lam_a"] = self._run("home_goals", feats), self._run("away_goals", feats)
        return out
