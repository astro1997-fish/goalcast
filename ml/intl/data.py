"""International match data.

National teams: full results history from the martj42/international_results
dataset, upcoming fixtures from ESPN's public scoreboard feed.

Continental clubs: results and fixtures both from ESPN. The feed only answers
one month per request, so history is kept in ``data/intl_clubs.csv`` (committed)
and each run only refreshes the most recent months.

    python -m ml.intl.data
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import numpy as np
import pandas as pd
import requests

from ml.intl.config import (CLUBS_FROM, CLUBS_HISTORY_PATH, COMPETITIONS, ESPN_URL, NATIONS_FROM, NATIONS_RAW_PATH, NATIONS_URL,
                            nation_importance, nation_region)

FIXTURE_HORIZON_DAYS = 10
NAME_ALIASES = {"usa": "United States", "czechia": "Czech Republic", "turkiye": "Turkey", "congo dr": "DR Congo",
                "cape verde islands": "Cape Verde", "bosnia-herzegovina": "Bosnia and Herzegovina", "ireland": "Republic of Ireland",
                "cote d'ivoire": "Ivory Coast", "the gambia": "Gambia"}


def _months(start: tuple[int, int], end: tuple[int, int]) -> list[str]:
    out, (y, m) = [], start
    while (y, m) <= end:
        out.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _shift(today: date, months: int) -> tuple[int, int]:
    index = today.year * 12 + today.month - 1 + months
    return index // 12, index % 12 + 1


def fetch_month(code: str, month: str) -> list[dict]:
    """Every match of one competition in one month (YYYYMM); empty on any failure."""
    try:
        r = requests.get(ESPN_URL.format(code=code), params={"dates": month, "limit": 400}, timeout=40)
        if r.status_code != 200:
            return []
        events = r.json().get("events", [])
    except (requests.RequestException, ValueError):
        return []
    rows = []
    for e in events:
        try:
            comp = e["competitions"][0]
            sides = {c["homeAway"]: c for c in comp["competitors"]}
            status = e["status"]["type"]
            done = bool(status.get("completed")) and status.get("state") == "post"
            rows.append({
                "comp": code, "kickoff": e["date"].replace("Z", ":00Z") if len(e["date"]) == 17 else e["date"],
                "home": sides["home"]["team"]["displayName"], "away": sides["away"]["team"]["displayName"],
                "fthg": float(sides["home"]["score"]) if done else np.nan, "ftag": float(sides["away"]["score"]) if done else np.nan,
                "neutral": bool(comp.get("neutralSite")), "scheduled": status.get("state") == "pre" and status.get("name") == "STATUS_SCHEDULED",
            })
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return rows


def _fetch_many(codes: list[str], months: list[str]) -> pd.DataFrame:
    jobs = [(c, m) for c in codes for m in months]
    with ThreadPoolExecutor(max_workers=8) as pool:
        chunks = list(pool.map(lambda job: fetch_month(*job), jobs))
    rows = [r for chunk in chunks for r in chunk]
    df = pd.DataFrame(rows, columns=["comp", "kickoff", "home", "away", "fthg", "ftag", "neutral", "scheduled"])
    df["date"] = pd.to_datetime(df["kickoff"], utc=True).dt.tz_localize(None).dt.normalize()
    return df


def _codes(family: str) -> list[str]:
    return [code for code, c in COMPETITIONS.items() if c[2] == family]


def _slug(day: pd.Series, home: pd.Series, away: pd.Series) -> pd.Series:
    return (day.dt.strftime("%Y%m%d") + "-" + home + "-" + away).str.replace(r"[^A-Za-z0-9\-]+", "", regex=True).str.lower()


def _upcoming(df: pd.DataFrame) -> pd.DataFrame:
    now = pd.Timestamp.now(tz="UTC")
    kick = pd.to_datetime(df["kickoff"], utc=True)
    return df[df["scheduled"] & (kick > now) & (kick < now + pd.Timedelta(days=FIXTURE_HORIZON_DAYS))]


def _finish(played: pd.DataFrame, fixtures: pd.DataFrame) -> pd.DataFrame:
    df = pd.concat([played, fixtures], ignore_index=True)
    df["played"] = df["fthg"].notna()
    df["id"] = _slug(df["date"], df["home"], df["away"])
    df = df.drop_duplicates(subset=["id"], keep="first")
    return df.sort_values(["date", "played", "kickoff"], ascending=[True, False, True]).reset_index(drop=True)


# ---------------- continental clubs ----------------

def update_clubs(today: date | None = None) -> pd.DataFrame:
    """Refresh the committed club history and return the latest raw fetch (which holds the fixtures)."""
    today = today or date.today()
    history = pd.read_csv(CLUBS_HISTORY_PATH) if CLUBS_HISTORY_PATH.exists() else pd.DataFrame()
    start = _shift(today, -2) if len(history) else CLUBS_FROM
    recent = _fetch_many(_codes("clubs"), _months(start, _shift(today, 1)))
    played = recent.dropna(subset=["fthg"])[["comp", "kickoff", "home", "away", "fthg", "ftag", "neutral"]]
    history = pd.concat([history, played], ignore_index=True).drop_duplicates(subset=["comp", "kickoff", "home", "away"], keep="last")
    CLUBS_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    history.sort_values(["kickoff", "comp", "home"]).to_csv(CLUBS_HISTORY_PATH, index=False)
    return recent


def load_clubs(recent: pd.DataFrame | None = None) -> pd.DataFrame:
    played = pd.read_csv(CLUBS_HISTORY_PATH)
    played["date"] = pd.to_datetime(played["kickoff"], utc=True).dt.tz_localize(None).dt.normalize()
    fixtures = _upcoming(recent).copy() if recent is not None and len(recent) else pd.DataFrame()
    df = _finish(played, fixtures.drop(columns=["scheduled"], errors="ignore"))
    df["league"] = df["comp"].map(lambda c: COMPETITIONS[c][0])
    df["region"] = df["comp"].map(lambda c: COMPETITIONS[c][1])
    df["importance"] = 1.0
    df["neutral"] = df["neutral"].astype(bool)
    return df


# ---------------- national teams ----------------

def _key(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    plain = re.sub(r"^st\.?\s", "saint ", plain.replace("&", "and"))
    plain = re.sub(r"^us\s", "united states ", plain)
    return re.sub(r"\s+", " ", plain).strip()


def map_nations(espn: pd.DataFrame, results: pd.DataFrame, known: list[str]) -> dict[str, str]:
    """ESPN team name -> results-dataset name, learned from matches both sources list on (nearly) the same day."""
    by_day: dict[pd.Timestamp, dict[str, set]] = defaultdict(lambda: {"home": set(), "away": set()})
    for d, h, a in zip(results["date"], results["home"], results["away"]):
        for shift in (-1, 0, 1):  # ESPN dates are UTC, the results dataset uses local dates
            day = by_day[d + pd.Timedelta(days=shift)]
            day["home"].add(h)
            day["away"].add(a)
    votes: dict[str, Counter] = defaultdict(Counter)
    for row in espn.dropna(subset=["fthg"]).itertuples(index=False):
        votes[row.home].update(by_day[row.date]["home"])
        votes[row.away].update(by_day[row.date]["away"])

    by_key = {_key(n): n for n in known}
    mapping = {}
    for name in sorted(set(espn["home"]) | set(espn["away"])):
        key = _key(name)
        ranked = votes[name].most_common(2)
        if key in by_key:
            mapping[name] = by_key[key]
        elif key in NAME_ALIASES:
            mapping[name] = NAME_ALIASES[key]
        elif ranked and ranked[0][1] >= 2 and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
            mapping[name] = ranked[0][0]
        else:
            close = difflib.get_close_matches(key, list(by_key), n=1, cutoff=0.9)
            if close:
                mapping[name] = by_key[close[0]]
    return mapping


def download_nations() -> None:
    NATIONS_RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(NATIONS_URL, timeout=60)
    r.raise_for_status()
    NATIONS_RAW_PATH.write_bytes(r.content)


def load_nations(today: date | None = None, with_fixtures: bool = True) -> pd.DataFrame:
    today = today or date.today()
    raw = pd.read_csv(NATIONS_RAW_PATH)
    played = pd.DataFrame({
        "comp": raw["tournament"], "date": pd.to_datetime(raw["date"]), "home": raw["home_team"], "away": raw["away_team"],
        "fthg": pd.to_numeric(raw["home_score"], errors="coerce"), "ftag": pd.to_numeric(raw["away_score"], errors="coerce"),
        "neutral": raw["neutral"].astype(str).str.upper().eq("TRUE"),
    }).dropna(subset=["fthg", "ftag"])
    played = played[played["date"] >= NATIONS_FROM]
    played["kickoff"] = played["date"].dt.strftime("%Y-%m-%dT15:00:00Z")
    played["league"] = played["comp"]
    played["region"] = played["comp"].map(nation_region)
    played["importance"] = played["comp"].map(nation_importance)

    fixtures = pd.DataFrame()
    if with_fixtures:
        espn = _fetch_many(_codes("nations"), _months(_shift(today, -2), _shift(today, 1)))
        upcoming = _upcoming(espn).copy()
        if len(upcoming):
            names = map_nations(espn, played[played["date"] >= pd.Timestamp(today) - pd.Timedelta(days=120)],
                                sorted(set(played["home"]) | set(played["away"])))
            missing = sorted({n for n in pd.concat([upcoming["home"], upcoming["away"]]) if n not in names})
            if missing:
                print(f"warning: national teams not matched, fixtures skipped: {missing}")
            upcoming = upcoming[upcoming["home"].isin(names) & upcoming["away"].isin(names)]
            upcoming["home"], upcoming["away"] = upcoming["home"].map(names), upcoming["away"].map(names)
            upcoming["league"] = upcoming["comp"].map(lambda c: COMPETITIONS[c][0])
            upcoming["region"] = upcoming["comp"].map(lambda c: COMPETITIONS[c][1])
            upcoming["importance"] = upcoming["comp"].map(lambda c: COMPETITIONS[c][3])
            upcoming["neutral"] = upcoming["neutral"] | (upcoming["importance"] >= 2)  # finals are played at neutral venues
            fixtures = upcoming.drop(columns=["scheduled"])
    return _finish(played, fixtures)


if __name__ == "__main__":
    download_nations()
    recent = update_clubs()
    clubs, nations = load_clubs(recent), load_nations()
    for name, df in (("clubs", clubs), ("nations", nations)):
        print(f"{name}: {int(df['played'].sum()):,} played, {int((~df['played']).sum())} fixtures, {df['date'].min():%Y-%m-%d} to {df['date'].max():%Y-%m-%d}")
