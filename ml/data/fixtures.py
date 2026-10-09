"""Season schedules from the openfootball public-domain dataset.

football-data.co.uk only lists the next round a few days ahead (with odds).
openfootball publishes whole-season schedules for the bigger leagues, so it
fills the gap between those updates. Team names differ between the two
sources; they are matched from the data itself (which teams played at home on
the same dates), with fuzzy name matching as the fallback early in a season.
"""
from __future__ import annotations

import difflib
import json
import unicodedata
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from ml.config import LEAGUES, RAW_DIR, current_season_start

BASE = "https://raw.githubusercontent.com/openfootball/football.json/master"
FEEDS = {
    "E0": "en.1", "E1": "en.2", "E2": "en.3", "E3": "en.4", "SC0": "sco.1",
    "D1": "de.1", "D2": "de.2", "I1": "it.1", "I2": "it.2", "SP1": "es.1", "SP2": "es.2",
    "F1": "fr.1", "F2": "fr.2", "N1": "nl.1", "B1": "be.1", "P1": "pt.1", "T1": "tr.1", "G1": "gr.1",
}
TIMEZONES = {
    "England": "Europe/London", "Scotland": "Europe/London", "Germany": "Europe/Berlin", "Italy": "Europe/Rome",
    "Spain": "Europe/Madrid", "France": "Europe/Paris", "Netherlands": "Europe/Amsterdam", "Belgium": "Europe/Brussels",
    "Portugal": "Europe/Lisbon", "Turkey": "Europe/Istanbul", "Greece": "Europe/Athens",
}
NOISE = {"fc", "afc", "cf", "sc", "sv", "ac", "as", "ssc", "us", "rcd", "rc", "ud", "cd", "sd", "ca", "club", "de", "calcio",
         "1", "04", "05", "1899", "1846", "vfb", "vfl", "tsg", "fsv", "bsc", "ogc", "losc", "stade", "olympique", "real"}


def download_schedules() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    start = current_season_start()
    season = f"{start}-{(start + 1) % 100:02d}"
    for div, feed in FEEDS.items():
        try:
            r = requests.get(f"{BASE}/{season}/{feed}.json", timeout=30)
        except requests.RequestException:
            continue
        if r.status_code == 200:
            (RAW_DIR / f"schedule_{div}.json").write_bytes(r.content)


def _played(m: dict) -> bool:
    score = m.get("score")
    return bool(score.get("ft") if isinstance(score, dict) else score)


def _key(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    tokens = [t for t in ascii_name.replace(".", " ").replace("-", " ").split() if t not in NOISE]
    return " ".join(tokens) or ascii_name


def _team_map(schedule: list[dict], played: pd.DataFrame) -> dict[str, str]:
    """openfootball name -> football-data name for one division."""
    known = sorted(set(played["home"]) | set(played["away"]))
    home_dates = defaultdict(set)
    for d, h in zip(played["date"].dt.strftime("%Y-%m-%d"), played["home"]):
        home_dates[d].add(h)
    votes: dict[str, Counter] = defaultdict(Counter)
    for m in schedule:
        if _played(m):
            votes[m["team1"]].update(home_dates.get(m["date"], ()))

    mapping, taken = {}, set()
    names = sorted({m["team1"] for m in schedule} | {m["team2"] for m in schedule}, key=lambda n: -sum(votes[n].values()))
    for name in names:
        ranked = [t for t, _ in votes[name].most_common() if t not in taken]
        # a team's own name co-occurs on every one of its home dates, so it wins clearly
        if ranked and votes[name][ranked[0]] >= 2 and (len(ranked) == 1 or votes[name][ranked[0]] > votes[name][ranked[1]]):
            mapping[name] = ranked[0]
            taken.add(ranked[0])
    for name in names:
        if name in mapping:
            continue
        free = {_key(t): t for t in known if t not in taken}
        close = difflib.get_close_matches(_key(name), list(free), n=1, cutoff=0.5)
        if close:
            mapping[name] = free[close[0]]
            taken.add(free[close[0]])
    return mapping


def load_schedule_fixtures(played: pd.DataFrame, season: int) -> pd.DataFrame:
    """Unplayed scheduled matches, in football-data team names, kickoff in UTC."""
    rows = []
    for div in FEEDS:
        path = RAW_DIR / f"schedule_{div}.json"
        if not path.exists():
            continue
        schedule = json.loads(path.read_text(encoding="utf-8")).get("matches", [])
        current = played[(played["div"] == div) & (played["season"] == season)]
        mapping = _team_map(schedule, current)
        tz = ZoneInfo(TIMEZONES[LEAGUES[div][1]])
        for m in schedule:
            if _played(m) or m["team1"] not in mapping or m["team2"] not in mapping:
                continue
            day = pd.Timestamp(m["date"])
            h, mi = (int(x) for x in (m.get("time") or "15:00").split(":")[:2])
            kickoff = day.to_pydatetime().replace(hour=h, minute=mi, tzinfo=tz).astimezone(ZoneInfo("UTC"))
            rows.append({"div": div, "home": mapping[m["team1"]], "away": mapping[m["team2"]], "date": day,
                         "time": f"{h:02d}:{mi:02d}", "kickoff": kickoff.strftime("%Y-%m-%dT%H:%M:%SZ"), "season": season})
    return pd.DataFrame(rows)
