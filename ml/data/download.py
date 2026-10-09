"""Download and normalise match data from football-data.co.uk.

Finished seasons are cached in ``data/raw``; the current season and the
upcoming-fixtures feed are refreshed on every run.

    python -m ml.data.download
"""
from __future__ import annotations

import io
import time
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

from ml.config import LEAGUES, RAW_DIR, SOURCE_URL, current_season_start, season_code, seasons
from ml.data.fixtures import download_schedules, load_schedule_fixtures

FIXTURE_HORIZON_DAYS = 10

HEADERS = {"User-Agent": "Mozilla/5.0 (GoalCast data pipeline)"}
UK = ZoneInfo("Europe/London")

# normalised column -> candidate source columns, first present wins
ODDS_COLUMNS = {
    "odds_h": ["AvgH", "BbAvH", "B365H", "PSH"],
    "odds_d": ["AvgD", "BbAvD", "B365D", "PSD"],
    "odds_a": ["AvgA", "BbAvA", "B365A", "PSA"],
    "odds_o25": ["Avg>2.5", "BbAv>2.5", "B365>2.5"],
    "odds_u25": ["Avg<2.5", "BbAv<2.5", "B365<2.5"],
}
STAT_COLUMNS = {"hs": "HS", "as_": "AS", "hst": "HST", "ast": "AST"}


def _fetch(url: str) -> bytes | None:
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.content
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    return None


def download(force: bool = False) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    current = current_season_start()
    for start in seasons():
        code = season_code(start)
        for div in LEAGUES:
            path = RAW_DIR / f"{code}_{div}.csv"
            if path.exists() and start != current and not force:
                continue
            content = _fetch(f"{SOURCE_URL}/mmz4281/{code}/{div}.csv")
            if content:
                path.write_bytes(content)
    content = _fetch(f"{SOURCE_URL}/fixtures.csv")
    if content:
        (RAW_DIR / "fixtures.csv").write_bytes(content)
    download_schedules()


def _read(path) -> pd.DataFrame:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return pd.read_csv(io.StringIO(text), on_bad_lines="skip", low_memory=False)


def _normalise(df: pd.DataFrame, season: int | None) -> pd.DataFrame:
    df = df.dropna(subset=["Div", "Date", "HomeTeam", "AwayTeam"])
    df = df[df["Div"].isin(LEAGUES)]
    out = pd.DataFrame(
        {
            "div": df["Div"].astype(str),
            "home": df["HomeTeam"].astype(str).str.strip(),
            "away": df["AwayTeam"].astype(str).str.strip(),
        }
    )
    out["date"] = pd.to_datetime(df["Date"], dayfirst=True, format="mixed", errors="coerce")
    out["time"] = df["Time"].astype(str) if "Time" in df else "15:00"
    out["fthg"] = pd.to_numeric(df.get("FTHG"), errors="coerce") if "FTHG" in df else np.nan
    out["ftag"] = pd.to_numeric(df.get("FTAG"), errors="coerce") if "FTAG" in df else np.nan
    for name, src in STAT_COLUMNS.items():
        out[name] = pd.to_numeric(df[src], errors="coerce") if src in df else np.nan
    for name, candidates in ODDS_COLUMNS.items():
        col = pd.Series(np.nan, index=df.index, dtype=float)
        for c in candidates:
            if c in df:
                col = col.fillna(pd.to_numeric(df[c], errors="coerce"))
        out[name] = col
    out = out.dropna(subset=["date"])
    if season is None:
        season = out["date"].map(lambda d: d.year if d.month >= 7 else d.year - 1)
    out["season"] = season
    return out


def _kickoff_utc(row) -> str:
    hhmm = row["time"] if isinstance(row["time"], str) and ":" in row["time"] else "15:00"
    h, m = (int(x) for x in hhmm.split(":")[:2])
    local = row["date"].to_pydatetime().replace(hour=h, minute=m, tzinfo=UK)
    return local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_matches() -> pd.DataFrame:
    """All played matches plus upcoming fixtures (``fthg`` is NaN), oldest first."""
    frames = []
    for start in seasons():
        code = season_code(start)
        for div in LEAGUES:
            path = RAW_DIR / f"{code}_{div}.csv"
            if path.exists():
                frames.append(_normalise(_read(path), start))
    played = pd.concat(frames, ignore_index=True).dropna(subset=["fthg", "ftag"])

    played["kickoff"] = played.apply(_kickoff_utc, axis=1)

    # upcoming: the odds-bearing fixtures feed first, then season schedules for anything it lacks
    upcoming = []
    fixtures_path = RAW_DIR / "fixtures.csv"
    if fixtures_path.exists():
        fx = _normalise(_read(fixtures_path), None)
        if len(fx):
            fx[["fthg", "ftag", "hs", "as_", "hst", "ast"]] = np.nan
            fx["kickoff"] = fx.apply(_kickoff_utc, axis=1)
            upcoming.append(fx)
    schedule = load_schedule_fixtures(played, current_season_start())
    if len(schedule):
        upcoming.append(schedule)
    if upcoming:
        now = pd.Timestamp.now(tz="UTC")
        fx = pd.concat(upcoming, ignore_index=True)
        kick = pd.to_datetime(fx["kickoff"], utc=True)
        fx = fx[(kick > now) & (kick < now + pd.Timedelta(days=FIXTURE_HORIZON_DAYS))]
        fx = fx.drop_duplicates(subset=["div", "home", "away"], keep="first")
        played = pd.concat([played, fx], ignore_index=True)

    df = played.drop_duplicates(subset=["date", "home", "away"], keep="first")
    df["id"] = (
        df["date"].dt.strftime("%Y%m%d") + "-" + df["home"] + "-" + df["away"]
    ).str.replace(r"[^A-Za-z0-9\-]+", "", regex=True).str.lower()
    df["played"] = df["fthg"].notna()
    # fixtures sort after results on the same day so they never see that day's scores
    return df.sort_values(["date", "played", "time", "div", "home"], ascending=[True, False, True, True, True]).reset_index(drop=True)


if __name__ == "__main__":
    download()
    m = load_matches()
    print(f"{int(m['played'].sum()):,} played matches, {int((~m['played']).sum())} fixtures, "
          f"{m['date'].min():%Y-%m-%d} to {m['date'].max():%Y-%m-%d}")
