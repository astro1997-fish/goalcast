"""GoalCast API. Serves model metadata, predictions and the static site.

    uvicorn api.main:app --reload
"""
from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from ml import registry
from ml.config import ROOT, SITE_DATA_DIR

app = FastAPI(title="GoalCast", version="1.0.0")


def _load(name: str) -> dict:
    path = SITE_DATA_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(503, "no exported data yet: run `python -m ml.pipeline`")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/model/performance")
def model_performance() -> dict:
    """Every registered match-result model version with its holdout metrics."""
    versions = registry.versions("match_result")
    if not versions:
        raise HTTPException(404, "no model versions registered")
    return {"active": versions[0]["version"], "versions": versions}


@app.get("/predictions")
def predictions(league: str | None = None, date: str | None = None) -> dict:
    data = _load("predictions")
    matches = [m for m in data["matches"]
               if (league is None or m["div"] == league) and (date is None or m["kickoff"].startswith(date))]
    return {**data, "matches": matches}


@app.get("/predictions/{match_id}")
def prediction(match_id: str) -> dict:
    for m in _load("predictions")["matches"]:
        if m["id"] == match_id:
            return m
    raise HTTPException(404, "match not found")


@app.get("/results")
def results() -> dict:
    return _load("results")


app.mount("/", StaticFiles(directory=ROOT / "site", html=True), name="site")
