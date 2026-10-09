"""Top scorers and assist providers per league, from ESPN's public stats feed.

The feed is unofficial and may change without notice, so every failure is
soft: a league that cannot be fetched simply returns ``None`` and the exporter
keeps whatever it published last time.
"""
from __future__ import annotations

import requests

URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/statistics"
ESPN_CODES = {
    "E0": "eng.1", "E1": "eng.2", "E2": "eng.3", "E3": "eng.4", "SC0": "sco.1",
    "D1": "ger.1", "D2": "ger.2", "I1": "ita.1", "I2": "ita.2", "SP1": "esp.1", "SP2": "esp.2",
    "F1": "fra.1", "F2": "fra.2", "N1": "ned.1", "B1": "bel.1", "P1": "por.1", "T1": "tur.1", "G1": "gre.1",
}
TOP_N = 15


def _leaders(category: dict) -> list[dict]:
    rows = []
    for leader in category.get("leaders", [])[:TOP_N]:
        athlete = leader.get("athlete") or {}
        stats = {s.get("name"): s.get("value") for s in athlete.get("statistics") or [] if isinstance(s, dict)}
        rows.append({
            "player": athlete.get("displayName") or "Unknown",
            "team": (athlete.get("team") or {}).get("displayName") or "",
            "apps": int(stats.get("appearances") or 0),
            "goals": int(stats.get("totalGoals") or 0),
            "assists": int(stats.get("goalAssists") or 0),
        })
    return rows


def fetch_leaders(div: str) -> dict | None:
    """{"scorers": [...], "assists": [...]} for one division, or None if unavailable."""
    code = ESPN_CODES.get(div)
    if not code:
        return None
    try:
        r = requests.get(URL.format(code=code), timeout=30)
        r.raise_for_status()
        categories = {c.get("name"): c for c in r.json().get("stats", [])}
    except (requests.RequestException, ValueError):
        return None
    scorers = [p for p in _leaders(categories.get("goalsLeaders", {})) if p["goals"] > 0]
    assists = [p for p in _leaders(categories.get("assistsLeaders", {})) if p["assists"] > 0]
    return {"scorers": scorers, "assists": assists} if scorers or assists else None
