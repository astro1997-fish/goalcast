"""International competitions covered: continental club cups and national teams."""
from __future__ import annotations

from ml.config import DATA_DIR, RAW_DIR

CLUBS_HISTORY_PATH = DATA_DIR / "intl_clubs.csv"  # committed: rebuilt incrementally, a month at a time
NATIONS_RAW_PATH = RAW_DIR / "intl_results.csv"
INTL_BACKTEST_PATH = DATA_DIR / "backtest_intl.csv"

NATIONS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/scoreboard"

CLUBS_FROM = (2015, 7)       # first month of club history
CLUBS_TRAIN_FROM = "2017-07-01"
NATIONS_FROM = "1990-01-01"  # ratings warm up from here
NATIONS_TRAIN_FROM = "2006-01-01"

# ESPN code -> (name, region, family, importance)
COMPETITIONS: dict[str, tuple[str, str, str, float]] = {
    "uefa.champions": ("UEFA Champions League", "Europe", "clubs", 1.0),
    "uefa.europa": ("UEFA Europa League", "Europe", "clubs", 1.0),
    "uefa.europa.conf": ("UEFA Conference League", "Europe", "clubs", 1.0),
    "caf.champions": ("CAF Champions League", "Africa", "clubs", 1.0),
    "caf.confed": ("CAF Confederation Cup", "Africa", "clubs", 1.0),
    "concacaf.champions": ("Concacaf Champions Cup", "North America", "clubs", 1.0),
    "concacaf.leagues.cup": ("Leagues Cup", "North America", "clubs", 1.0),
    "uefa.nations": ("UEFA Nations League", "Europe", "nations", 1.0),
    "uefa.euroq": ("European Championship Qualifying", "Europe", "nations", 1.0),
    "uefa.euro": ("European Championship", "Europe", "nations", 2.0),
    "fifa.worldq.uefa": ("World Cup Qualifying (Europe)", "Europe", "nations", 1.0),
    "caf.nations": ("Africa Cup of Nations", "Africa", "nations", 2.0),
    "caf.nations_qual": ("Africa Cup of Nations Qualifying", "Africa", "nations", 1.0),
    "fifa.worldq.caf": ("World Cup Qualifying (Africa)", "Africa", "nations", 1.0),
    "concacaf.nations.league": ("Concacaf Nations League", "North America", "nations", 1.0),
    "concacaf.gold": ("Concacaf Gold Cup", "North America", "nations", 2.0),
    "fifa.worldq.concacaf": ("World Cup Qualifying (North America)", "North America", "nations", 1.0),
}
REGIONS = ["Europe", "Africa", "North America"]

MAJOR_TOURNAMENTS = {"FIFA World Cup", "UEFA Euro", "Copa América", "African Cup of Nations", "Gold Cup", "AFC Asian Cup",
                     "Confederations Cup"}


def nation_importance(tournament: str) -> float:
    if tournament == "Friendly":
        return 0.0
    return 2.0 if tournament in MAJOR_TOURNAMENTS else 1.0


def nation_region(tournament: str) -> str:
    t = tournament.lower()
    if "uefa" in t:
        return "Europe"
    if "africa" in t or "cosafa" in t or "cecafa" in t:
        return "Africa"
    if "concacaf" in t or "gold cup" in t:
        return "North America"
    return "Other"
