"""Pre-match features for international matches (national teams or continental clubs).

Same no-leakage rule as the league features: one chronological pass, features
read from team state before the match is applied. Teams meet rarely here, so
the rating carries most of the signal and the number of matches seen is itself
a feature (it tells the model how far to trust the rating).
"""
from __future__ import annotations

from collections import defaultdict, deque

import numpy as np
import pandas as pd

ELO_START = 1500.0
ELO_K = 24.0
ELO_HFA = 80.0
MIN_HISTORY = 3
REST_CAP = 120
SEEN_CAP = 60

INTL_FEATURES = [
    "elo_h", "elo_a", "elo_diff", "elo_exp",
    "h_ppg5", "h_gf5", "h_ga5", "h_ppg10", "h_gf10", "h_ga10",
    "a_ppg5", "a_gf5", "a_ga5", "a_ppg10", "a_gf10", "a_ga10",
    "h_rest", "a_rest", "h_seen", "a_seen",
    "h2h_n", "h2h_ppg", "h2h_gd",
    "neutral", "importance", "ppg5_diff", "gd10_diff",
]


class Team:
    __slots__ = ("elo", "hist", "seen", "last")

    def __init__(self):
        self.elo, self.hist, self.seen, self.last = ELO_START, deque(maxlen=10), 0, None


def _mean(rows, idx, n):
    vals = [r[idx] for r in list(rows)[-n:]]
    return float(np.mean(vals)) if len(vals) >= MIN_HISTORY else np.nan


def build_intl_features(matches: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, dict]]:
    """Return (features aligned to ``matches``, display context for unplayed fixtures)."""
    teams: dict[str, Team] = defaultdict(Team)
    h2h: dict[frozenset, deque] = defaultdict(lambda: deque(maxlen=6))
    rows, context = [], {}

    for m in matches.itertuples(index=False):
        h, a = teams[m.home], teams[m.away]
        hfa = 0.0 if m.neutral else ELO_HFA
        f = {"elo_h": h.elo, "elo_a": a.elo, "elo_diff": h.elo - a.elo,
             "elo_exp": 1.0 / (1.0 + 10 ** (-(h.elo + hfa - a.elo) / 400.0))}
        for p, t in (("h", h), ("a", a)):
            for n in (5, 10):
                f[f"{p}_ppg{n}"], f[f"{p}_gf{n}"], f[f"{p}_ga{n}"] = (_mean(t.hist, i, n) for i in (0, 1, 2))
            f[f"{p}_rest"] = min((m.date - t.last).days, REST_CAP) if t.last is not None else np.nan
            f[f"{p}_seen"] = min(t.seen, SEEN_CAP)
        meetings = h2h[frozenset((m.home, m.away))]
        if meetings:
            gd = [(hg - ag) if mh == m.home else (ag - hg) for _, mh, _, hg, ag in meetings]
            f["h2h_n"], f["h2h_gd"] = len(meetings), float(np.mean(gd))
            f["h2h_ppg"] = float(np.mean([3 if d > 0 else 1 if d == 0 else 0 for d in gd]))
        else:
            f["h2h_n"], f["h2h_ppg"], f["h2h_gd"] = 0, np.nan, np.nan
        f["neutral"], f["importance"] = float(m.neutral), m.importance
        f["ppg5_diff"] = f["h_ppg5"] - f["a_ppg5"]
        f["gd10_diff"] = (f["h_gf10"] - f["h_ga10"]) - (f["a_gf10"] - f["a_ga10"])
        rows.append(f)

        if np.isnan(m.fthg):
            context[m.id] = {
                "elo": {"h": round(h.elo), "a": round(a.elo)},
                "form": {"h": [r[4] for r in list(h.hist)[-5:]], "a": [r[4] for r in list(a.hist)[-5:]]},
                "last": {"h": [r[3] for r in list(h.hist)[-5:]], "a": [r[3] for r in list(a.hist)[-5:]]},
                "h2h": [{"date": d.strftime("%Y-%m-%d"), "home": mh, "away": ma, "score": f"{hg}-{ag}"}
                        for d, mh, ma, hg, ag in reversed(meetings)][:5],
            }
            continue

        hg, ag = int(m.fthg), int(m.ftag)
        res_h = "W" if hg > ag else "D" if hg == ag else "L"
        res_a = {"W": "L", "D": "D", "L": "W"}[res_h]
        venue_h, venue_a = ("N", "N") if m.neutral else ("H", "A")
        h.hist.append(({"W": 3, "D": 1, "L": 0}[res_h], hg, ag, res_h, f"{res_h} {hg}-{ag} v {m.away} ({venue_h})"))
        a.hist.append(({"W": 3, "D": 1, "L": 0}[res_a], ag, hg, res_a, f"{res_a} {ag}-{hg} v {m.home} ({venue_a})"))
        for t in (h, a):
            t.seen += 1
            t.last = m.date

        margin = abs(hg - ag)
        g = 1.0 if margin <= 1 else 1.5 if margin == 2 else 1.75 + (margin - 3) / 8.0
        k = ELO_K * g * (0.5 + 0.5 * m.importance)  # friendlies move ratings half as much, finals more
        delta = k * ({"W": 1.0, "D": 0.5, "L": 0.0}[res_h] - f["elo_exp"])
        h.elo += delta
        a.elo -= delta
        meetings.append((m.date, m.home, m.away, hg, ag))

    return pd.DataFrame(rows, index=matches.index)[INTL_FEATURES], context
