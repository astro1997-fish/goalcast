"""International predictions, holdout results and model metrics for the website."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ml import registry
from ml.export_site import analyse, export_predictions, summarise, tips, won
from ml.intl.config import INTL_BACKTEST_PATH, REGIONS
from ml.intl.data import load_clubs, load_nations, update_clubs
from ml.intl.features import build_intl_features
from ml.predict import Predictor

ODDS_COLUMNS = ["odds_h", "odds_d", "odds_a", "odds_o25", "odds_u25"]
DISPLAY_ONLY = ["h_stf5", "a_stf5", "h_season_ppg", "a_season_ppg"]  # league-only stats the match page expects
REGION_ROWS = 60
FAMILY_LABELS = {"nations": "National teams", "clubs": "Continental club competitions"}


def _score(family: str, matches: pd.DataFrame) -> list[dict]:
    if matches["played"].all():
        return []
    feats, context = build_intl_features(matches)
    feats = feats.assign(**{c: np.nan for c in DISPLAY_ONLY})
    frame = matches.assign(div=matches["comp"], **{c: np.nan for c in ODDS_COLUMNS})
    pred = Predictor(prefix=f"{family}_")
    out = export_predictions(pred, frame, feats, context)
    for p in out:
        p.update({"intl": True, "family": family, "version": pred.version})
    return out


def intl_predictions() -> tuple[list[dict], pd.DataFrame]:
    """(upcoming international predictions, played matches for settling the ledger)."""
    frames = {"clubs": load_clubs(update_clubs()), "nations": load_nations()}
    predictions = [p for family, matches in frames.items() for p in _score(family, matches)]
    played = pd.concat([m[m["played"]][["id", "date", "home", "away", "fthg", "ftag"]] for m in frames.values()], ignore_index=True)
    return predictions, played


def _row(r) -> dict:
    a = analyse(r)
    hg, ag = int(r.fthg), int(r.ftag)
    t = tips(a)
    for market, tip in t.items():
        tip["won"] = bool(won(market, tip["sel"], hg, ag))
    return {"id": r.id, "date": f"{r.date:%Y-%m-%d}", "div": r.comp, "league": r.league, "home": r.home, "away": r.away,
            "score": f"{hg}-{ag}", "probs": [round(r.p_h, 3), round(r.p_d, 3), round(r.p_a, 3)], "tips": t}


def intl_results() -> dict:
    """Holdout record per model family and per region."""
    bt = pd.read_csv(INTL_BACKTEST_PATH, parse_dates=["date"]).sort_values("date")
    bt = bt.assign(**{c: np.nan for c in ODDS_COLUMNS})
    families, regions = {}, {}
    rows_by_index = {}
    for family, grp in bt.groupby("family"):
        rows = [_row(r) for r in grp.itertuples(index=False)]
        rows_by_index.update(zip(grp.index, rows))
        families[family] = {"label": FAMILY_LABELS[family], "n": len(rows), "from": rows[0]["date"], "to": rows[-1]["date"],
                            "markets": summarise(rows)}
    for region in REGIONS:
        grp = bt[bt["region"] == region]
        rows = [rows_by_index[i] for i in grp.index]
        if not rows:
            continue
        hits = sum(r["tips"]["1X2"]["won"] for r in rows)
        regions[region] = {"n": len(rows), "rate": round(hits / len(rows), 4), "markets": summarise(rows), "rows": rows[::-1][:REGION_ROWS]}
    return {"families": families, "regions": regions}


def intl_model() -> dict:
    out = {}
    for family, label in FAMILY_LABELS.items():
        latest = registry.latest_version(f"{family}_match_result")
        if latest:
            m = latest["metrics"]
            out[family] = {"label": label, "version": latest["version"], "model": m["model"], "base_rate": m["base_rate"], "splits": m["splits"]}
    return out
