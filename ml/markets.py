"""Turn model output into one scoreline distribution and read every market off it.

The goals models give expected goals for each side; the match-result model
gives home/draw/away. The Poisson scoreline grid is rescaled so its
home/draw/away mass equals the match-result probabilities, so 1X2, double
chance, totals, BTTS and correct score can never contradict each other.
"""
from __future__ import annotations

import numpy as np
from scipy.stats import poisson

MAX_GOALS = 9
_I, _J = np.indices((MAX_GOALS + 1, MAX_GOALS + 1))
_HOME, _DRAW, _AWAY = _I > _J, _I == _J, _I < _J
_TOTAL = _I + _J

LABELS = {
    "1": "Home win", "X": "Draw", "2": "Away win",
    "1X": "Home or draw", "12": "Home or away", "X2": "Draw or away",
    "O1.5": "Over 1.5 goals", "U1.5": "Under 1.5 goals",
    "O2.5": "Over 2.5 goals", "U2.5": "Under 2.5 goals",
    "O3.5": "Over 3.5 goals", "U3.5": "Under 3.5 goals",
    "BTTS-Y": "Both teams to score", "BTTS-N": "Both teams to score: no",
}
SAFE_CANDIDATES = ["1", "2", "1X", "X2", "12", "O1.5", "O2.5", "U2.5", "U3.5", "BTTS-Y", "BTTS-N"]
SAFE_THRESHOLD = 0.80
VALUE_THRESHOLD = 0.05


def score_matrix(lam_h: float, lam_a: float, p_h: float, p_d: float, p_a: float) -> np.ndarray:
    k = np.arange(MAX_GOALS + 1)
    m = np.outer(poisson.pmf(k, lam_h), poisson.pmf(k, lam_a))
    for mask, target in ((_HOME, p_h), (_DRAW, p_d), (_AWAY, p_a)):
        m[mask] *= target / m[mask].sum()
    return m


def selections(m: np.ndarray) -> dict[str, float]:
    p_h, p_d, p_a = m[_HOME].sum(), m[_DRAW].sum(), m[_AWAY].sum()
    btts = m[1:, 1:].sum()
    out = {"1": p_h, "X": p_d, "2": p_a, "1X": p_h + p_d, "12": p_h + p_a, "X2": p_d + p_a,
           "BTTS-Y": btts, "BTTS-N": 1 - btts}
    for line in (1.5, 2.5, 3.5):
        over = m[_TOTAL > line].sum()
        out[f"O{line}"], out[f"U{line}"] = over, 1 - over
    return {k: float(v) for k, v in out.items()}


def top_scores(m: np.ndarray, n: int = 6) -> list[dict]:
    order = np.argsort(m, axis=None)[::-1][:n]
    return [{"s": f"{i}-{j}", "p": round(float(m[i, j]), 4)} for i, j in zip(*np.unravel_index(order, m.shape))]


def settle(sel: str, hg: int, ag: int) -> bool:
    total = hg + ag
    if sel in ("1", "X", "2"):
        return sel == ("1" if hg > ag else "X" if hg == ag else "2")
    if sel == "1X":
        return hg >= ag
    if sel == "X2":
        return hg <= ag
    if sel == "12":
        return hg != ag
    if sel == "BTTS-Y":
        return hg > 0 and ag > 0
    if sel == "BTTS-N":
        return hg == 0 or ag == 0
    line = float(sel[1:])
    return total > line if sel[0] == "O" else total < line


def main_pick(sels: dict[str, float]) -> str:
    return max(("1", "X", "2"), key=lambda s: sels[s])


def safe_tip(sels: dict[str, float]) -> str | None:
    best = max(SAFE_CANDIDATES, key=lambda s: sels[s])
    return best if sels[best] >= SAFE_THRESHOLD else None


def value_bet(sels: dict[str, float], odds: dict[str, float]) -> dict | None:
    """Biggest positive-expectation selection against the quoted bookmaker price."""
    best = None
    for sel, price in odds.items():
        if not price or np.isnan(price) or price <= 1:
            continue
        edge = sels[sel] * price - 1
        if edge >= VALUE_THRESHOLD and (best is None or edge > best["edge"]):
            best = {"sel": sel, "p": round(sels[sel], 4), "odds": round(float(price), 2), "edge": round(edge, 4)}
    return best


def implied(odds_h: float, odds_d: float, odds_a: float) -> tuple[float, float, float] | None:
    """Bookmaker probabilities with the margin removed."""
    if any(o is None or np.isnan(o) or o <= 1 for o in (odds_h, odds_d, odds_a)):
        return None
    raw = np.array([1 / odds_h, 1 / odds_d, 1 / odds_a])
    return tuple(float(x) for x in raw / raw.sum())


def confidence(sels: dict[str, float]) -> int:
    """1-5 rating from how far the favourite outcome stands clear of a coin toss."""
    top = max(sels["1"], sels["X"], sels["2"])
    return int(np.clip(np.digitize(top, [0.42, 0.50, 0.60, 0.70]) + 1, 1, 5))
