"""Pre-match feature engineering.

One chronological pass over every match. Features for a match are read from
team state *before* the match is applied, so nothing leaks from the future.
Bookmaker odds are deliberately not features: the model has to form its own
view, which is what makes the model-vs-market comparison meaningful.
"""
from __future__ import annotations

from collections import defaultdict, deque

import numpy as np
import pandas as pd

from ml.config import LEAGUES

ELO_START = 1500.0
ELO_NEWCOMER = 1450.0  # teams first seen after the opening season (promoted from untracked leagues)
ELO_K = 20.0
ELO_HFA = 65.0
ELO_TIER_SHIFT = 130.0  # rating correction when a team moves between tiers
MIN_HISTORY = 3

FEATURES = [
    "elo_h", "elo_a", "elo_diff", "elo_exp",
    "h_ppg5", "h_gf5", "h_ga5", "h_ppg10", "h_gf10", "h_ga10",
    "a_ppg5", "a_gf5", "a_ga5", "a_ppg10", "a_gf10", "a_ga10",
    "h_sf5", "h_sa5", "h_stf5", "h_sta5",
    "a_sf5", "a_sa5", "a_stf5", "a_sta5",
    "h_home_ppg5", "h_home_gf5", "h_home_ga5",
    "a_away_ppg5", "a_away_gf5", "a_away_ga5",
    "h_rest", "a_rest", "rest_diff",
    "h_season_ppg", "a_season_ppg", "h_season_played",
    "h2h_n", "h2h_ppg", "h2h_gd",
    "lg_home_goals", "lg_away_goals", "lg_draw_rate",
    "ppg5_diff", "gd10_diff", "stf5_diff",
    "tier",
]


class Team:
    __slots__ = ("elo", "div", "hist", "home", "away", "season", "s_played", "s_pts", "last")

    def __init__(self, elo: float):
        self.elo = elo
        self.div = None
        self.hist = deque(maxlen=10)  # (pts, gf, ga, shots_for, shots_against, sot_for, sot_against, result, label)
        self.home = deque(maxlen=5)
        self.away = deque(maxlen=5)
        self.season = None
        self.s_played = 0
        self.s_pts = 0
        self.last = None


def _mean(rows, idx, n=None):
    rows = list(rows)[-n:] if n else list(rows)
    vals = [r[idx] for r in rows if r[idx] is not None and not np.isnan(r[idx])]
    return float(np.mean(vals)) if len(vals) >= MIN_HISTORY else np.nan


def _elo_expected(elo_h: float, elo_a: float) -> float:
    return 1.0 / (1.0 + 10 ** (-(elo_h + ELO_HFA - elo_a) / 400.0))


def build_features(matches: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, dict]]:
    """Return (features aligned to ``matches``, display context for unplayed fixtures)."""
    teams: dict[str, Team] = {}
    h2h: dict[frozenset, deque] = defaultdict(lambda: deque(maxlen=6))
    league: dict[str, deque] = defaultdict(lambda: deque(maxlen=400))
    first_season = matches["season"].min()
    rows = []
    context: dict[str, dict] = {}

    for m in matches.itertuples(index=False):
        tier = LEAGUES[m.div][2]
        pair = []
        for name in (m.home, m.away):
            t = teams.get(name)
            if t is None:
                t = teams[name] = Team(ELO_START if m.season == first_season else ELO_NEWCOMER)
            if t.div is not None and t.div != m.div:
                t.elo += ELO_TIER_SHIFT * (tier - LEAGUES[t.div][2])
            t.div = m.div
            if t.season != m.season:
                t.season, t.s_played, t.s_pts = m.season, 0, 0
            pair.append(t)
        h, a = pair

        f = {"elo_h": h.elo, "elo_a": a.elo, "elo_diff": h.elo - a.elo, "elo_exp": _elo_expected(h.elo, a.elo)}
        for p, t in (("h", h), ("a", a)):
            for n in (5, 10):
                f[f"{p}_ppg{n}"] = _mean(t.hist, 0, n)
                f[f"{p}_gf{n}"] = _mean(t.hist, 1, n)
                f[f"{p}_ga{n}"] = _mean(t.hist, 2, n)
            f[f"{p}_sf5"], f[f"{p}_sa5"] = _mean(t.hist, 3, 5), _mean(t.hist, 4, 5)
            f[f"{p}_stf5"], f[f"{p}_sta5"] = _mean(t.hist, 5, 5), _mean(t.hist, 6, 5)
            f[f"{p}_rest"] = min((m.date - t.last).days, 21) if t.last is not None else np.nan
            f[f"{p}_season_ppg"] = t.s_pts / t.s_played if t.s_played >= MIN_HISTORY else np.nan
        f["h_home_ppg5"], f["h_home_gf5"], f["h_home_ga5"] = (_mean(h.home, i) for i in (0, 1, 2))
        f["a_away_ppg5"], f["a_away_gf5"], f["a_away_ga5"] = (_mean(a.away, i) for i in (0, 1, 2))
        f["rest_diff"] = f["h_rest"] - f["a_rest"]
        f["h_season_played"] = h.s_played

        meetings = h2h[frozenset((m.home, m.away))]
        if meetings:
            pts, gd = [], []
            for _, mh, _, hg, ag in meetings:
                d = (hg - ag) if mh == m.home else (ag - hg)
                gd.append(d)
                pts.append(3 if d > 0 else 1 if d == 0 else 0)
            f["h2h_n"], f["h2h_ppg"], f["h2h_gd"] = len(meetings), float(np.mean(pts)), float(np.mean(gd))
        else:
            f["h2h_n"], f["h2h_ppg"], f["h2h_gd"] = 0, np.nan, np.nan

        lg = league[m.div]
        if len(lg) >= 50:
            arr = np.array(lg)
            f["lg_home_goals"], f["lg_away_goals"] = arr[:, 0].mean(), arr[:, 1].mean()
            f["lg_draw_rate"] = float((arr[:, 0] == arr[:, 1]).mean())
        else:
            f["lg_home_goals"] = f["lg_away_goals"] = f["lg_draw_rate"] = np.nan

        f["ppg5_diff"] = f["h_ppg5"] - f["a_ppg5"]
        f["gd10_diff"] = (f["h_gf10"] - f["h_ga10"]) - (f["a_gf10"] - f["a_ga10"])
        f["stf5_diff"] = f["h_stf5"] - f["a_stf5"]
        f["tier"] = tier
        rows.append(f)

        if np.isnan(m.fthg):
            context[m.id] = {
                "elo": {"h": round(h.elo), "a": round(a.elo)},
                "form": {"h": [r[8] for r in list(h.hist)[-5:]], "a": [r[8] for r in list(a.hist)[-5:]]},
                "last": {"h": [r[7] for r in list(h.hist)[-5:]], "a": [r[7] for r in list(a.hist)[-5:]]},
                "h2h": [
                    {"date": d.strftime("%Y-%m-%d"), "home": mh, "away": ma, "score": f"{int(hg)}-{int(ag)}"}
                    for d, mh, ma, hg, ag in reversed(meetings)
                ][:5],
            }
            continue

        hg, ag = int(m.fthg), int(m.ftag)
        res_h = "W" if hg > ag else "D" if hg == ag else "L"
        res_a = {"W": "L", "D": "D", "L": "W"}[res_h]
        pts_h = {"W": 3, "D": 1, "L": 0}[res_h]
        pts_a = {"W": 3, "D": 1, "L": 0}[res_a]
        row_h = (pts_h, hg, ag, m.hs, m.as_, m.hst, m.ast, res_h, f"{res_h} {hg}-{ag} v {m.away} (H)")
        row_a = (pts_a, ag, hg, m.as_, m.hs, m.ast, m.hst, res_a, f"{res_a} {ag}-{hg} v {m.home} (A)")
        h.hist.append(row_h)
        h.home.append(row_h)
        a.hist.append(row_a)
        a.away.append(row_a)
        for t, pts in ((h, pts_h), (a, pts_a)):
            t.s_played += 1
            t.s_pts += pts
            t.last = m.date

        margin = abs(hg - ag)
        g = 1.0 if margin <= 1 else 1.5 if margin == 2 else 1.75 + (margin - 3) / 8.0
        delta = ELO_K * g * (pts_h / 3.0 if pts_h != 1 else 0.5) - ELO_K * g * f["elo_exp"]
        h.elo += delta
        a.elo -= delta

        meetings.append((m.date, m.home, m.away, hg, ag))
        lg.append((hg, ag))

    return pd.DataFrame(rows, index=matches.index)[FEATURES], context
