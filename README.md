# GoalCast

Open football predictions, graded in public. An XGBoost model trained on
~74,000 matches from 18 European leagues, a pipeline that retrains and
re-scores fixtures daily, and a static website that shows every prediction and
every result, wins and losses alike.

## What's here

| Path | What it does |
| --- | --- |
| `ml/data/` | Downloads results, shots and odds (football-data.co.uk) and season schedules (openfootball) |
| `ml/features/build.py` | 46 pre-match features: Elo, rolling form, home/away splits, shots, rest, head-to-head |
| `ml/training/train_match_result.py` | Trains and registers the models; out-of-time holdout evaluation |
| `ml/markets.py` | One scoreline distribution per match; every market is read from it |
| `ml/export_site.py` | Scores fixtures, maintains the public ledger, writes `site/data/*.json` |
| `ml/models/` | Versioned artifacts (gitignored) — see its README |
| `api/main.py` | FastAPI: `GET /model/performance`, `/predictions`, `/results`, and the site |
| `site/` | The website: plain HTML, CSS and JavaScript, no build step |
| `data/ledger.json` | Predictions logged before kick-off, settled afterwards, never revised |

## Run it

```bash
pip install -r requirements.txt
python -m ml.pipeline                 # download, train, export
python -m http.server 8123 --directory site
```

Or with uv: `uv run python -m ml.training.train_match_result`, then
`uv run python -m ml.export_site`. For the API: `uvicorn api.main:app`.

`python -m ml.pipeline --no-train` re-scores fixtures with the latest
registered model.

## How the model is evaluated

The most recent 365 days are a holdout the model never trains on; the 365 days
before that choose the number of boosting rounds. Holdout predictions are
compared with bookmaker odds (margin removed) and a base-rate baseline. The
registered artifact is then refit on all data with those round counts.

Latest holdout (6,343 matches, Oct 2025 – Oct 2026):

| Forecaster | 1X2 accuracy | Log loss |
| --- | --- | --- |
| GoalCast | 49.5% | 1.0134 |
| Bookmaker odds | 50.7% | 1.0008 |
| League base rates | 43.3% | 1.0758 |

The model is well calibrated and clearly beats the baseline, but it does not
beat the market, and its "value" disagreements with bookmakers lost money in
the backtest (−13.2% per bet). The site says so. Current numbers are always on
the site's Model and Results pages.

## Accounts and Premium

Sign-up, sign-in and password reset use [Supabase Auth](https://supabase.com)
(free tier), called straight from the browser. To switch accounts on:

1. Create a Supabase project.
2. In **Authentication → URL Configuration**, set the Site URL to the site's
   address and add it to the redirect URLs.
3. Copy the project URL and the `anon` public key from **Project Settings →
   API** into `site/config.js`.

Until then the Sign in button explains that accounts are not switched on. The
Premium page (banker of the day, ready-made accumulators) unlocks for signed-in
members. Note that this is an interface-level lock: the prediction data itself
is public JSON, so anything that must be truly private needs to be served from
a database with access rules rather than from `site/data`.

## Deployment

`.github/workflows/refresh.yml` runs twice a day: it retrains, exports,
commits the refreshed `site/data` and ledger, and deploys `site/` to GitHub
Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Disclaimer

A statistics project, not betting advice. Probabilities are not promises.
