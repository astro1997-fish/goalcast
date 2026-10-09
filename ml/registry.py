"""SQLite model registry: ``training_runs`` and ``model_versions``.

Artifacts themselves live in ``ml/models`` and are never overwritten; this
database records which versions exist and how each one scored.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from ml.config import DATA_DIR, DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS training_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    params TEXT,
    n_train INTEGER, n_val INTEGER, n_test INTEGER,
    data_from TEXT, data_through TEXT
);
CREATE TABLE IF NOT EXISTS model_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    version TEXT NOT NULL,
    artifact_path TEXT NOT NULL,
    scaler_path TEXT NOT NULL,
    training_run_id INTEGER REFERENCES training_runs(id),
    metrics TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (model_name, version)
);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def start_run(params: dict) -> int:
    with connect() as con:
        cur = con.execute(
            "INSERT INTO training_runs (started_at, status, params) VALUES (?, 'running', ?)",
            (now(), json.dumps(params)),
        )
        return cur.lastrowid


def finish_run(run_id: int, status: str, **fields) -> None:
    cols = "".join(f", {k} = ?" for k in fields)
    with connect() as con:
        con.execute(
            f"UPDATE training_runs SET finished_at = ?, status = ?{cols} WHERE id = ?",
            (now(), status, *fields.values(), run_id),
        )


def register(model_name: str, version: str, artifact: str, scaler: str, run_id: int, metrics: dict) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO model_versions (model_name, version, artifact_path, scaler_path, training_run_id, metrics, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (model_name, version, artifact, scaler, run_id, json.dumps(metrics), now()),
        )


def versions(model_name: str | None = None) -> list[dict]:
    q = "SELECT * FROM model_versions"
    args: tuple = ()
    if model_name:
        q += " WHERE model_name = ?"
        args = (model_name,)
    with connect() as con:
        rows = con.execute(q + " ORDER BY version DESC", args).fetchall()
    return [{**dict(r), "metrics": json.loads(r["metrics"] or "{}")} for r in rows]


def latest_version(model_name: str = "match_result") -> dict | None:
    v = versions(model_name)
    return v[0] if v else None
