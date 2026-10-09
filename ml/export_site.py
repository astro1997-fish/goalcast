"""Score upcoming fixtures and write the JSON the website reads.

    python -m ml.export_site

Writes ``site/data/{predictions,results,model}.json`` and maintains
``data/ledger.json``: every prediction is logged before kick-off and settled
once the result is in, so the live record cannot be edited after the fact.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ml import markets, registry
from ml.config import BACKTEST_PATH, LEAGUES, LEDGER_PATH, SITE_DATA_DIR, current_season_start
from ml.data.download import load_matches
from ml.data.players import fetch_leaders
from ml.features.build import build_features
from ml.predict import Predictor

RESULT_ROWS = 400
TRACKED = ["1X2", "DC", "O/U 2.5", "BTTS", "SAFE", "VALUE"]
MARKET_LABELS = {"1X2": "Match result (1X2)", "DC": "Double chance", "O/U 2.5": "Over/under 2.5", "BTTS": "Both teams to score",
                 "SAFE": "Safe tips", "VALUE": "Value bets", "CS": "Correct score"}


def _num(x, nd=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


def _odds(row) -> dict[str, float]:
    return {"1": row.odds_h, "X": row.odds_d, "2": row.odds_a, "O2.5": row.odds_o25, "U2.5": row.odds_u25}


def league_info(div: str) -> tuple[str, str]:
    """(competition name, country or region) for a league code or an international competition code."""
    if div in LEAGUES:
        return LEAGUES[div][0], LEAGUES[div][1]
    from ml.intl.config import COMPETITIONS
    return COMPETITIONS[div][0], COMPETITIONS[div][1]


def analyse(row) -> dict:
    """Everything derived from one match's scoreline distribution."""
    m = markets.score_matrix(row.lam_h, row.lam_a, row.p_h, row.p_d, row.p_a)
    sels = markets.selections(m)
    pick = markets.main_pick(sels)
    dc = max(("1X", "12", "X2"), key=lambda s: sels[s]) if pick == "X" else {"1": "1X", "2": "X2"}[pick]
    return {
        "matrix": m, "sels": sels, "pick": pick, "dc": dc,
        "ou": "O2.5" if sels["O2.5"] >= 0.5 else "U2.5",
        "btts": "BTTS-Y" if sels["BTTS-Y"] >= 0.5 else "BTTS-N",
        "safe": markets.safe_tip(sels),
        "value": markets.value_bet(sels, _odds(row)),
        "score": markets.top_scores(m, 1)[0]["s"],
    }


def tips(a: dict) -> dict[str, dict]:
    """The published selection for each tracked market: {market: {sel, p, odds?}}."""
    out = {"1X2": a["pick"], "DC": a["dc"], "O/U 2.5": a["ou"], "BTTS": a["btts"]}
    out = {k: {"sel": s, "p": round(a["sels"][s], 4)} for k, s in out.items()}
    out["CS"] = {"sel": a["score"], "p": round(float(a["matrix"][tuple(int(x) for x in a["score"].split("-"))]), 4)}
    if a["safe"]:
        out["SAFE"] = {"sel": a["safe"], "p": round(a["sels"][a["safe"]], 4)}
    if a["value"]:
        out["VALUE"] = a["value"]
    return out


def won(market: str, sel: str, hg: int, ag: int) -> bool:
    return sel == f"{hg}-{ag}" if market == "CS" else markets.settle(sel, hg, ag)


def summarise(rows: list[dict]) -> list[dict]:
    """Hit rate per market; for value bets also profit at the quoted odds, 1 unit stakes."""
    out = []
    for market in TRACKED + ["CS"]:
        settled = [r["tips"][market] for r in rows if market in r["tips"]]
        if not settled:
            continue
        hits = sum(t["won"] for t in settled)
        entry = {"key": market, "label": MARKET_LABELS[market], "n": len(settled), "hits": hits, "rate": round(hits / len(settled), 4),
                 "avg_p": round(float(np.mean([t["p"] for t in settled])), 4)}
        if market == "VALUE":
            profit = sum((t["odds"] - 1) if t["won"] else -1 for t in settled)
            entry["roi"] = round(profit / len(settled), 4)
        out.append(entry)
    return out


def result_row(row, a: dict) -> dict:
    hg, ag = int(row.fthg), int(row.ftag)
    t = tips(a)
    for market, tip in t.items():
        tip["won"] = bool(won(market, tip["sel"], hg, ag))
    return {"id": row.id, "date": f"{row.date:%Y-%m-%d}", "div": row.div, "league": LEAGUES[row.div][0], "home": row.home, "away": row.away,
            "score": f"{hg}-{ag}", "probs": [round(row.p_h, 3), round(row.p_d, 3), round(row.p_a, 3)], "tips": t}


def export_predictions(pred: Predictor, matches: pd.DataFrame, feats: pd.DataFrame, context: dict) -> list[dict]:
    fx = matches[~matches["played"]]
    if fx.empty:
        return []
    scored = pd.concat([fx, pred.predict(feats.loc[fx.index])], axis=1).sort_values("kickoff")
    out = []
    for row in scored.itertuples(index=False):
        a = analyse(row)
        s = a["sels"]
        f = feats.loc[matches.index[matches["id"] == row.id][0]]
        imp = markets.implied(row.odds_h, row.odds_d, row.odds_a)
        league, country = league_info(row.div)
        out.append({
            "id": row.id, "div": row.div, "league": league, "country": country, "kickoff": row.kickoff,
            "home": row.home, "away": row.away,
            "probs": {"h": round(row.p_h, 4), "d": round(row.p_d, 4), "a": round(row.p_a, 4)},
            "xg": {"h": round(float(row.lam_h), 2), "a": round(float(row.lam_a), 2)},
            "sels": {k: round(v, 4) for k, v in s.items()},
            "scores": markets.top_scores(a["matrix"]),
            "matrix": np.round(a["matrix"][:6, :6], 4).tolist(),
            "tips": tips(a),
            "confidence": markets.confidence(s),
            "odds": {"h": _num(row.odds_h), "d": _num(row.odds_d), "a": _num(row.odds_a), "o25": _num(row.odds_o25), "u25": _num(row.odds_u25)},
            "implied": {"h": round(imp[0], 4), "d": round(imp[1], 4), "a": round(imp[2], 4)} if imp else None,
            "ctx": {**context.get(row.id, {}),
                    "rest": {"h": _num(f["h_rest"], 0), "a": _num(f["a_rest"], 0)},
                    "stats": {side: {"ppg": _num(f[f"{side}_ppg10"]), "gf": _num(f[f"{side}_gf10"]), "ga": _num(f[f"{side}_ga10"]),
                                     "sot": _num(f[f"{side}_stf5"], 1), "season_ppg": _num(f[f"{side}_season_ppg"])} for side in ("h", "a")}},
        })
    return out


def update_ledger(predictions: list[dict], matches: pd.DataFrame, version: str) -> dict:
    ledger = json.loads(LEDGER_PATH.read_text(encoding="utf-8")) if LEDGER_PATH.exists() else {}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for p in predictions:
        # first publication wins: a logged prediction is never revised
        if p["id"] not in ledger and p["kickoff"] > now:
            ledger[p["id"]] = {"id": p["id"], "published": now, "version": p.get("version", version), "kickoff": p["kickoff"], "date": p["kickoff"][:10],
                               "div": p["div"], "league": p["league"], "home": p["home"], "away": p["away"],
                               "probs": [p["probs"]["h"], p["probs"]["d"], p["probs"]["a"]], "tips": p["tips"], "score": None}
    done = matches[matches["played"]].drop_duplicates(subset=["id"]).set_index("id")
    # sources disagree on the date of late kick-offs, so also match on the two teams within two days
    recent = done[done["date"] >= pd.Timestamp.now().normalize() - pd.Timedelta(days=45)]
    by_teams = {}
    for r in recent.itertuples():
        by_teams.setdefault((r.home, r.away), []).append(r)
    for entry in ledger.values():
        if entry["score"] is not None:
            continue
        r = done.loc[entry["id"]] if entry["id"] in done.index else next(
            (c for c in by_teams.get((entry["home"], entry["away"]), []) if abs((c.date - pd.Timestamp(entry["date"])).days) <= 2), None)
        if r is not None:
            hg, ag = int(r.fthg), int(r.ftag)
            entry["score"] = f"{hg}-{ag}"
            for market, tip in entry["tips"].items():
                tip["won"] = bool(won(market, tip["sel"], hg, ag))
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.write_text(json.dumps(ledger, indent=1), encoding="utf-8")
    return ledger


def export_results(ledger: dict) -> dict:
    bt = pd.read_csv(BACKTEST_PATH, parse_dates=["date"]).sort_values("date")
    rows = [result_row(r, analyse(r)) for r in bt.itertuples(index=False)]
    monthly = []
    for month, grp in pd.DataFrame({"m": [r["date"][:7] for r in rows], "w": [r["tips"]["1X2"]["won"] for r in rows],
                                    "s": [r["tips"].get("SAFE", {}).get("won") for r in rows]}).groupby("m"):
        safe = grp["s"].dropna()
        monthly.append({"month": month, "n": len(grp), "rate": round(float(grp["w"].mean()), 4),
                        "safe_n": len(safe), "safe_rate": round(float(safe.astype(float).mean()), 4) if len(safe) else None})
    by_league = []
    for div, grp in pd.DataFrame({"d": [r["div"] for r in rows], "w": [r["tips"]["1X2"]["won"] for r in rows]}).groupby("d"):
        by_league.append({"div": div, "league": LEAGUES[div][0], "country": LEAGUES[div][1], "n": len(grp), "rate": round(float(grp["w"].mean()), 4)})

    settled = sorted((e for e in ledger.values() if e["score"]), key=lambda e: e["kickoff"], reverse=True)
    return {
        "backtest": {"from": rows[0]["date"], "to": rows[-1]["date"], "n": len(rows), "version": str(bt["version"].iloc[0]),
                     "markets": summarise(rows), "monthly": monthly, "by_league": sorted(by_league, key=lambda r: -r["rate"]),
                     "rows": rows[::-1][:RESULT_ROWS]},
        "live": {"n": len(settled), "pending": sum(1 for e in ledger.values() if not e["score"]),
                 "since": min((e["published"] for e in ledger.values()), default=None),
                 "markets": summarise(settled), "rows": settled[:RESULT_ROWS]},
    }


def export_model(version: str, matches: pd.DataFrame) -> dict:
    path = SITE_DATA_DIR / "model.json"
    history = json.loads(path.read_text(encoding="utf-8")).get("history", []) if path.exists() else []
    known = {h["version"] for h in history}
    for v in reversed(registry.versions("match_result")):
        if v["version"] not in known and v["metrics"].get("model"):
            m = v["metrics"]
            history.append({"version": v["version"], "created": v["created_at"], "accuracy": m["model"]["accuracy"],
                            "log_loss": m["model"]["log_loss"], "bookmaker_log_loss": m["bookmaker"]["log_loss"], "n_test": m["model"]["n"]})
    current = next(v for v in registry.versions("match_result") if v["version"] == version)
    played = matches[matches["played"]]
    return {"version": version, "created": current["created_at"], "metrics": current["metrics"],
            "history": sorted(history, key=lambda h: h["version"], reverse=True)[:30],
            "coverage": {"matches": int(len(played)), "leagues": len(LEAGUES), "teams": int(pd.concat([played["home"], played["away"]]).nunique()),
                         "from": f"{played['date'].min():%Y-%m-%d}", "through": f"{played['date'].max():%Y-%m-%d}"}}


def standings(played: pd.DataFrame) -> list[dict]:
    """League table from results: points, then goal difference, then goals scored."""
    table: dict[str, dict] = {}
    for m in played.sort_values("date").itertuples(index=False):
        hg, ag = int(m.fthg), int(m.ftag)
        for team, gf, ga in ((m.home, hg, ag), (m.away, ag, hg)):
            row = table.setdefault(team, {"team": team, "p": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0, "pts": 0, "form": []})
            res = "W" if gf > ga else "D" if gf == ga else "L"
            row["p"] += 1
            row[res.lower()] += 1
            row["gf"] += gf
            row["ga"] += ga
            row["pts"] += {"W": 3, "D": 1, "L": 0}[res]
            row["form"] = (row["form"] + [res])[-5:]
    rows = sorted(table.values(), key=lambda r: (-r["pts"], -(r["gf"] - r["ga"]), -r["gf"], r["team"]))
    return [{"pos": i + 1, **r, "gd": r["gf"] - r["ga"]} for i, r in enumerate(rows)]


def export_leagues(matches: pd.DataFrame, generated: str) -> dict:
    """Standings (from our results) and top scorers / assists (from ESPN) per league."""
    path = SITE_DATA_DIR / "leagues.json"
    previous = json.loads(path.read_text(encoding="utf-8")).get("leagues", {}) if path.exists() else {}
    season = current_season_start()
    played = matches[matches["played"] & (matches["season"] == season)]
    out = {}
    for div, (league, country, tier) in LEAGUES.items():
        leaders = fetch_leaders(div)
        old = previous.get(div, {})
        out[div] = {
            "league": league, "country": country, "tier": tier, "season": f"{season}/{(season + 1) % 100:02d}",
            "table": standings(played[played["div"] == div]),
            "scorers": leaders["scorers"] if leaders else old.get("scorers", []),
            "assists": leaders["assists"] if leaders else old.get("assists", []),
            "players_updated": generated if leaders else old.get("players_updated"),
        }
    return out


def export() -> None:
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    pred = Predictor()
    matches = load_matches()
    feats, context = build_features(matches)
    predictions = export_predictions(pred, matches, feats, context)
    settled = matches[["id", "date", "home", "away", "fthg", "ftag", "played"]]
    intl = {}
    try:
        from ml.intl.export import intl_model, intl_predictions, intl_results
        intl_preds, intl_played = intl_predictions()
        predictions = sorted(predictions + intl_preds, key=lambda p: p["kickoff"])
        settled = pd.concat([settled, intl_played.assign(played=True)], ignore_index=True)
        intl = {"results": intl_results(), "model": intl_model()}
    except FileNotFoundError as err:
        print(f"international predictions skipped: {err}")
    ledger = update_ledger(predictions, settled, pred.version)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payloads = {
        "predictions": {"generated": generated, "version": pred.version, "labels": markets.LABELS, "matches": predictions},
        "results": {"generated": generated, **export_results(ledger), "intl": intl.get("results")},
        "model": {"generated": generated, **export_model(pred.version, matches), "intl": intl.get("model")},
        "leagues": {"generated": generated, "leagues": export_leagues(matches, generated)},
    }
    for name, payload in payloads.items():
        (SITE_DATA_DIR / f"{name}.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"exported {len(predictions)} predictions, {payloads['results']['backtest']['n']:,} backtest results, "
          f"{payloads['results']['live']['n']} live settled / {payloads['results']['live']['pending']} pending")


if __name__ == "__main__":
    export()
