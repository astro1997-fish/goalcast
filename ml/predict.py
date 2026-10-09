"""Load registered artifacts and score matches."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import xgboost as xgb

from ml import registry
from ml.config import MODELS_DIR, ROOT

MODEL_NAMES = ("match_result", "home_goals", "away_goals")


def latest_version(model_name: str = "match_result") -> str:
    row = registry.latest_version(model_name)
    if row:
        return row["version"]
    files = sorted(MODELS_DIR.glob(f"{model_name}_*Z.json"))
    if not files:
        raise FileNotFoundError(f"no trained {model_name} model: run `python -m ml.pipeline`")
    return files[-1].stem.removeprefix(f"{model_name}_")


class Predictor:
    def __init__(self, version: str | None = None, prefix: str = ""):
        """``prefix`` selects a model family, e.g. ``"nations_"`` or ``"clubs_"``; empty is the league model."""
        self.version = version or latest_version(f"{prefix}match_result")
        self.boosters, self.scalers = {}, {}
        for name in MODEL_NAMES:
            booster = xgb.Booster()
            booster.load_model(ROOT / "ml" / "models" / f"{prefix}{name}_{self.version}.json")
            self.boosters[name] = booster
            self.scalers[name] = json.loads((MODELS_DIR / f"{prefix}{name}_{self.version}_scaler.json").read_text())

    def _run(self, name: str, feats: pd.DataFrame) -> np.ndarray:
        s = self.scalers[name]
        x = (feats[s["feature_names"]].to_numpy(dtype=float) - np.array(s["mean"])) / np.array(s["scale"])
        return self.boosters[name].predict(xgb.DMatrix(x, feature_names=s["feature_names"]))

    def predict(self, feats: pd.DataFrame) -> pd.DataFrame:
        """Columns p_h, p_d, p_a (match result) and lam_h, lam_a (expected goals)."""
        out = pd.DataFrame(self._run("match_result", feats), columns=["p_h", "p_d", "p_a"], index=feats.index)
        out["lam_h"], out["lam_a"] = self._run("home_goals", feats), self._run("away_goals", feats)
        return out
