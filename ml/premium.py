"""Members-only special picks.

These come from combination markets that the free site does not show (a win
with goals, a win to nil, a two-goal margin, team goals and so on), all read
from the same scoreline distribution as every other market.

They are never written to the public site files. The pipeline uploads them to
a Neon Postgres table that only accounts with an active plan can read.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

import numpy as np

from ml.markets import _AWAY, _DRAW, _HOME, _I, _J, _TOTAL

PICK_MIN, PICK_MAX = 0.55, 0.70   # a special pick: likely, but still priced at fair odds of about 1.43 or more
LONG_MAX = 0.34                   # the big-price pick: fair odds of about 3.0 or more
PICKS_PER_DAY = 8
TABLE = "premium_content"

# key -> (label template, scoreline mask)
SPECIALS = {
    "H&O1.5": ("{home} to win & over 1.5 goals", _HOME & (_TOTAL >= 2)),
    "A&O1.5": ("{away} to win & over 1.5 goals", _AWAY & (_TOTAL >= 2)),
    "H&BTTS": ("{home} to win & both teams to score", _HOME & (_J >= 1)),
    "A&BTTS": ("{away} to win & both teams to score", _AWAY & (_I >= 1)),
    "H-NIL": ("{home} to win to nil", _HOME & (_J == 0)),
    "A-NIL": ("{away} to win to nil", _AWAY & (_I == 0)),
    "H-1": ("{home} to win by 2 or more", (_I - _J) >= 2),
    "A-1": ("{away} to win by 2 or more", (_J - _I) >= 2),
    "H-TO1.5": ("{home} to score 2 or more", _I >= 2),
    "A-TO1.5": ("{away} to score 2 or more", _J >= 2),
    "1X&O1.5": ("{home} or draw & over 1.5 goals", (_HOME | _DRAW) & (_TOTAL >= 2)),
    "X2&O1.5": ("{away} or draw & over 1.5 goals", (_AWAY | _DRAW) & (_TOTAL >= 2)),
    "1X&U3.5": ("{home} or draw & under 3.5 goals", (_HOME | _DRAW) & (_TOTAL <= 3)),
    "X2&U3.5": ("{away} or draw & under 3.5 goals", (_AWAY | _DRAW) & (_TOTAL <= 3)),
    "G2-3": ("Exactly 2 or 3 goals in the match", (_TOTAL >= 2) & (_TOTAL <= 3)),
}


def special_probs(matrix: np.ndarray) -> dict[str, float]:
    return {key: float(matrix[mask].sum()) for key, (_, mask) in SPECIALS.items()}


def settle(key: str, hg: int, ag: int) -> bool:
    return bool(SPECIALS[key][1][min(hg, 9), min(ag, 9)])


def choose(matrix: np.ndarray) -> dict:
    """The best special pick for one match and its best big-price pick, or None for either."""
    probs = special_probs(matrix)
    pick = max(((k, p) for k, p in probs.items() if PICK_MIN <= p <= PICK_MAX), key=lambda kp: kp[1], default=None)
    long = max(((k, p) for k, p in probs.items() if 0.2 <= p <= LONG_MAX), key=lambda kp: kp[1], default=None)
    return {"pick": pick, "long": long}


def _entry(match: dict, key: str, p: float) -> dict:
    label = SPECIALS[key][0].format(home=match["home"], away=match["away"])
    return {"id": match["id"], "kickoff": match["kickoff"], "league": match["league"], "div": match["div"], "home": match["home"], "away": match["away"],
            "key": key, "label": label, "p": round(p, 4)}


def build_payload(predictions: list[dict], record: dict, generated: str) -> dict:
    """Group the per-match choices (in each prediction's ``_special``) into the members' page content."""
    now = datetime.now(timezone.utc)
    horizon = (now + timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ")
    soon = [m for m in predictions if m.get("_special") and generated < m["kickoff"] < horizon]
    picks = sorted((_entry(m, *m["_special"]["pick"]) for m in soon if m["_special"]["pick"]), key=lambda e: -e["p"])
    days: dict[str, list] = {}
    for e in picks:
        day = days.setdefault(e["kickoff"][:10], [])
        if len(day) < PICKS_PER_DAY:
            day.append(e)
    next_two_days = (now + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    treble = [e for e in picks if e["kickoff"] < next_two_days][:3]
    longs = sorted((_entry(m, *m["_special"]["long"]) for m in soon if m["_special"]["long"] and m["kickoff"] < next_two_days), key=lambda e: -e["p"])
    return {
        "generated": generated,
        "days": [{"date": d, "picks": sorted(v, key=lambda e: e["kickoff"])} for d, v in sorted(days.items())],
        "treble": {"legs": treble, "p": round(float(np.prod([e["p"] for e in treble])), 4)} if len(treble) == 3 else None,
        "long": longs[0] if longs else None,
        "record": record,
    }


def backtest_record(rows) -> dict:
    """How the special-pick rule did on the holdout: ``rows`` yields (date, matrix, home goals, away goals)."""
    by_day: dict[str, list] = {}
    longs = []
    for day, matrix, hg, ag in rows:
        c = choose(matrix)
        if c["pick"]:
            by_day.setdefault(day, []).append((c["pick"][1], settle(c["pick"][0], hg, ag)))
        if c["long"]:
            longs.append((c["long"][1], settle(c["long"][0], hg, ag)))
    top = [x for picks in by_day.values() for x in sorted(picks, reverse=True)[:PICKS_PER_DAY]]

    def stat(items):
        return {"n": len(items), "hits": int(sum(w for _, w in items)), "rate": round(float(np.mean([w for _, w in items])), 4),
                "expected": round(float(np.mean([p for p, _ in items])), 4)} if items else None
    return {"picks": stat(top), "long": stat(longs)}


SETUP_SQL = """
create table if not exists premium_content (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table premium_content enable row level security;
"""
# Only accounts whose sign-in token carries an active plan may read. The functions and the role exist once
# the Neon Data API is switched on for the database, so this part is skipped until then.
POLICY_SQL = """
drop policy if exists "members with an active plan can read" on premium_content;
create policy "members with an active plan can read" on premium_content
  for select to authenticated
  using (
    coalesce(auth.session() -> 'app_metadata' ->> 'plan', '') <> ''
    and coalesce(nullif(auth.session() -> 'app_metadata' ->> 'plan_until', '')::date, current_date) >= current_date
  );
grant select on premium_content to authenticated;
"""
DATA_API_READY_SQL = """
select exists (select 1 from pg_roles where rolname = 'authenticated')
   and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'session')
"""


def upload(payload: dict) -> bool:
    """Store the payload in the Neon database, where only paying members can read it. Returns False when not configured."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("premium picks not uploaded: DATABASE_URL is not set")
        return False
    import psycopg
    from psycopg.types.json import Jsonb

    with psycopg.connect(dsn, connect_timeout=30) as con:
        con.execute(SETUP_SQL)
        if con.execute(DATA_API_READY_SQL).fetchone()[0]:
            con.execute(POLICY_SQL)
        else:
            print("premium picks: the Neon Data API is not switched on yet, so members cannot read them")
        con.execute(
            f"insert into {TABLE} (id, payload, updated_at) values (%s, %s, %s) "
            "on conflict (id) do update set payload = excluded.payload, updated_at = excluded.updated_at",
            ("picks", Jsonb(payload), payload["generated"]),
        )
    print(f"premium picks uploaded: {sum(len(d['picks']) for d in payload['days'])} picks over {len(payload['days'])} days")
    return True
