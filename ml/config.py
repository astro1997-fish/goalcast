"""Shared paths and constants for the GoalCast pipeline."""
from __future__ import annotations

from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "ml" / "models"
SITE_DATA_DIR = ROOT / "site" / "data"
DB_PATH = DATA_DIR / "goalcast.db"
LEDGER_PATH = DATA_DIR / "ledger.json"
BACKTEST_PATH = DATA_DIR / "backtest.csv"

SOURCE_URL = "https://www.football-data.co.uk"
FIRST_SEASON_START = 2015  # 2015/16

# code -> (league, country, tier)
LEAGUES: dict[str, tuple[str, str, int]] = {
    "E0": ("Premier League", "England", 1),
    "E1": ("Championship", "England", 2),
    "E2": ("League One", "England", 3),
    "E3": ("League Two", "England", 4),
    "SC0": ("Premiership", "Scotland", 1),
    "D1": ("Bundesliga", "Germany", 1),
    "D2": ("2. Bundesliga", "Germany", 2),
    "I1": ("Serie A", "Italy", 1),
    "I2": ("Serie B", "Italy", 2),
    "SP1": ("La Liga", "Spain", 1),
    "SP2": ("La Liga 2", "Spain", 2),
    "F1": ("Ligue 1", "France", 1),
    "F2": ("Ligue 2", "France", 2),
    "N1": ("Eredivisie", "Netherlands", 1),
    "B1": ("Pro League", "Belgium", 1),
    "P1": ("Primeira Liga", "Portugal", 1),
    "T1": ("Süper Lig", "Turkey", 1),
    "G1": ("Super League", "Greece", 1),
}


def season_code(start_year: int) -> str:
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def current_season_start(today: date | None = None) -> int:
    today = today or date.today()
    return today.year if today.month >= 7 else today.year - 1


def seasons(today: date | None = None) -> list[int]:
    return list(range(FIRST_SEASON_START, current_season_start(today) + 1))
