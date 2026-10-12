"""Club crests, national flags and competition logos.

The images are ESPN's, referenced by address (not copied): the same public feed
the fixtures and top scorers come from lists a logo for every team and
competition. League clubs are named differently in our results data, so they
are matched to ESPN's teams from the data itself (who played at home on the
same day), with name matching as the fallback.
"""
from __future__ import annotations

import difflib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pandas as pd
import requests

from ml.config import LEAGUES, current_season_start
from ml.data.players import ESPN_CODES
from ml.intl.config import COMPETITIONS, ESPN_URL
from ml.intl.data import NAME_ALIASES, _key, _months, _shift

SIZE = 96  # pixels requested from the image service; displayed smaller


def _sized(url: str) -> str:
    """Ask ESPN's image service for a small version instead of the 500 px original."""
    marker = "a.espncdn.com"
    if not url or marker not in url:
        return url
    path = url.split(marker, 1)[1]
    return f"https://a.espncdn.com/combiner/i?img={path}&h={SIZE}&w={SIZE}"


def _fetch(code: str, month: str) -> dict:
    try:
        r = requests.get(ESPN_URL.format(code=code), params={"dates": month, "limit": 400}, timeout=40)
        return r.json() if r.status_code == 200 else {}
    except (requests.RequestException, ValueError):
        return {}


def _league_logo(payload: dict) -> dict | None:
    logos = (payload.get("leagues") or [{}])[0].get("logos") or []
    if not logos:
        return None
    dark = next((l["href"] for l in logos if "dark" in l.get("rel", [])), logos[0]["href"])
    return {"light": _sized(logos[0]["href"]), "dark": _sized(dark)}


def _teams(payload: dict) -> list[tuple[str, str, str, bool]]:
    """(day, home name, away name, played) plus a side effect-free logo lookup via ``_team_logos``."""
    rows = []
    for e in payload.get("events", []):
        try:
            sides = {c["homeAway"]: c["team"] for c in e["competitions"][0]["competitors"]}
            rows.append((e["date"][:10], sides["home"]["displayName"], sides["away"]["displayName"], bool(e["status"]["type"].get("completed"))))
        except (KeyError, IndexError, TypeError):
            continue
    return rows


def _team_logos(payload: dict) -> dict[str, str]:
    out = {}
    for e in payload.get("events", []):
        try:
            for c in e["competitions"][0]["competitors"]:
                if c["team"].get("logo"):
                    out[c["team"]["displayName"]] = _sized(c["team"]["logo"])
        except (KeyError, IndexError, TypeError):
            continue
    return out


def _loose_match(ours: str, espn: str) -> bool:
    """True when a short results-data name plainly refers to an ESPN name: "Derby" / "Derby County", "QPR" / "Queens Park Rangers"."""
    a, b = _key(ours).replace("'", " "), _key(espn)
    words = b.replace("-", " ").split()
    initials = "".join(w[0] for w in words)
    tokens = a.split()
    return (a in b or a.replace(" ", "") == initials
            or all(any(w.startswith(t) or t in w for w in words) or t == "".join(w[0] for w in words[1:]) for t in tokens))


def _match_league(espn_rows: list, espn_names: list[str], played: pd.DataFrame) -> dict[str, str]:
    """Our club name -> ESPN club name for one league."""
    by_day: dict[str, dict[str, set]] = defaultdict(lambda: {"home": set(), "away": set()})
    for d, h, a in zip(played["date"], played["home"], played["away"]):
        for shift in (-1, 0, 1):
            day = by_day[(d + pd.Timedelta(days=shift)).strftime("%Y-%m-%d")]
            day["home"].add(h)
            day["away"].add(a)
    votes: dict[str, Counter] = defaultdict(Counter)
    for day, home, away, done in espn_rows:
        if done and day in by_day:
            votes[home].update(by_day[day]["home"])
            votes[away].update(by_day[day]["away"])

    ours = sorted(set(played["home"]) | set(played["away"]))
    mapping, taken = {}, set()
    for espn in sorted(espn_names, key=lambda n: -sum(votes[n].values())):
        ranked = [t for t, _ in votes[espn].most_common() if t not in taken]
        if ranked and votes[espn][ranked[0]] >= 2 and (len(ranked) == 1 or votes[espn][ranked[0]] > votes[espn][ranked[1]]):
            mapping[ranked[0]] = espn
            taken.add(ranked[0])
    # whatever the dates could not separate: match by name among the few that are left
    left = [n for n in espn_names if n not in mapping.values()]
    for name in (n for n in ours if n not in mapping):
        hits = [e for e in left if _loose_match(name, e)]
        if len(hits) != 1:
            close = difflib.get_close_matches(_key(name), [_key(e) for e in left], n=1, cutoff=0.6)
            hits = [e for e in left if close and _key(e) == close[0]]
        if len(hits) == 1:
            mapping[name] = hits[0]
            left.remove(hits[0])
    return mapping


def build_logos(matches: pd.DataFrame, previous: dict | None = None, today: date | None = None) -> dict:
    """{"teams": {name: url}, "leagues": {code: {"light": url, "dark": url}}}; keeps earlier entries if a fetch fails."""
    today = today or date.today()
    previous = previous or {}
    teams, leagues = dict(previous.get("teams", {})), dict(previous.get("leagues", {}))
    recent, ahead = _months(_shift(today, -2), _shift(today, 0)), _months(_shift(today, -1), _shift(today, 1))
    jobs = [(div, code, m) for div, code in ESPN_CODES.items() for m in recent] + [(code, code, m) for code in COMPETITIONS for m in ahead]
    with ThreadPoolExecutor(max_workers=8) as pool:
        payloads = list(pool.map(lambda job: _fetch(job[1], job[2]), jobs))

    by_key: dict[str, list[dict]] = defaultdict(list)
    for (key, _, _), payload in zip(jobs, payloads):
        if payload:
            by_key[key].append(payload)

    season = current_season_start(today)
    current = matches[matches["played"] & (matches["season"] == season)]
    for key, group in by_key.items():
        logo = next((l for l in map(_league_logo, group) if l), None)
        if logo:
            leagues[key] = logo
        espn_logos = {}
        for payload in group:
            espn_logos.update(_team_logos(payload))
        teams.update(espn_logos)  # ESPN's own names: international clubs, nations, and the top-scorer lists
        if key in LEAGUES:
            rows = [row for payload in group for row in _teams(payload)]
            for ours, espn in _match_league(rows, list(espn_logos), current[current["div"] == key]).items():
                teams[ours] = espn_logos[espn]
        else:
            for name, url in espn_logos.items():  # national teams are spelt differently in the results data
                alias = NAME_ALIASES.get(_key(name))
                if alias:
                    teams[alias] = url
    return {"teams": teams, "leagues": leagues}
