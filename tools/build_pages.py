"""Build the deployable site in ``dist/``: one real HTML page per address, plus sitemap and robots.txt.

    python -m tools.build_pages

The app in ``site/`` draws every page in the browser. Search engines and link
previews need each address to exist as a file with its own title, description
and readable content, so this copies ``site/`` to ``dist/`` and writes
``dist/<route>/index.html`` for every route, with the content already in the
page. The app then takes over when its script loads.
"""
from __future__ import annotations

import html
import json
import shutil
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE, DIST, DATA = ROOT / "site", ROOT / "dist", ROOT / "site" / "data"
SETTINGS = json.loads((ROOT / "content" / "site.json").read_text(encoding="utf-8"))
SITE_URL = SETTINGS["url"].rstrip("/") + "/"
BASE_PATH = urlparse(SITE_URL).path

MARKETS = {
    "1x2": ("Match result predictions", lambda m: m["tips"]["1X2"]),
    "double-chance": ("Double chance predictions", lambda m: m["tips"]["DC"]),
    "over-1-5": ("Over 1.5 goals predictions", lambda m: {"sel": "O1.5", "p": m["sels"]["O1.5"]}),
    "over-2-5": ("Over 2.5 goals predictions", lambda m: {"sel": "O2.5", "p": m["sels"]["O2.5"]}),
    "under-3-5": ("Under 3.5 goals predictions", lambda m: {"sel": "U3.5", "p": m["sels"]["U3.5"]}),
    "btts": ("Both teams to score predictions", lambda m: m["tips"]["BTTS"]),
    "correct-score": ("Correct score predictions", lambda m: m["tips"]["CS"]),
}
REGIONS = {"europe": "Europe", "africa": "Africa", "north-america": "North America"}

e = html.escape


def load(name: str) -> dict:
    path = DATA / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


PRED, RES, MODEL, LEAGUES, BLOG = load("predictions"), load("results"), load("model"), load("leagues").get("leagues", {}), load("blog")
STATIC_PAGES = load("pages").get("pages", [])
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
UPCOMING = [m for m in PRED.get("matches", []) if m["kickoff"] > NOW]
POSTS = [p for p in BLOG.get("posts", []) if p["date"] <= date.today().isoformat()]
LABELS = PRED.get("labels", {})


def pct(p: float, digits: int = 0) -> str:
    return f"{p * 100:.{digits}f}%"


def label(sel: str, m: dict) -> str:
    names = {"1": f"{m['home']} win", "X": "Draw", "2": f"{m['away']} win", "1X": f"{m['home']} or draw",
             "X2": f"{m['away']} or draw", "12": "No draw"}
    if sel in names:
        return names[sel]
    return f"Correct score {sel}" if sel[0].isdigit() else LABELS.get(sel, sel)


def table(head: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return ""
    return ('<div class="table-wrap"><table><thead><tr>' + "".join(f"<th>{h}</th>" for h in head) + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table></div>")


def fixtures(matches: list[dict], pick=lambda m: m["tips"]["1X2"], limit: int = 60) -> str:
    rows = [[f"<strong>{e(m['home'])} v {e(m['away'])}</strong>", e(m["league"]), m["kickoff"][:16].replace("T", " ") + " UTC",
             e(label(pick(m)["sel"], m)), pct(pick(m)["p"], 1)] for m in matches[:limit]]
    return table(["Match", "Competition", "Kick-off", "Prediction", "Probability"], rows) or "<p>No fixtures are listed right now.</p>"


def head(title: str, lede: str) -> str:
    return f'<div class="page-head"><h1>{e(title)}</h1><p>{e(lede)}</p></div>'


def market_stat(key: str) -> dict | None:
    return next((m for m in RES.get("backtest", {}).get("markets", []) if m["key"] == key), None)


# ---------- one function per kind of page: returns (title, description, body html, extra head html) ----------

def page_home():
    cov = MODEL.get("coverage", {})
    lede = (f"Free football predictions from an open model trained on {cov.get('matches', 0):,} matches: match result, double chance, "
            "over/under, both teams to score and correct score, with every result published, wins and losses alike.")
    links = "".join(f'<li><a href="#/{r}">{t}</a></li>' for r, t in [("safe", "Safe tips"), ("results", "Results"), ("leagues", "Leagues and standings"),
                                                                    ("intl/europe", "International matches"), ("blog", "Blog"), ("model", "How the model performs")])
    body = head("Football predictions that show their working", lede) + f"<ul>{links}</ul><h2>Upcoming matches</h2>" + fixtures(UPCOMING)
    return "GoalCast: football predictions, graded in public", lede, body, ""


def page_market(slug):
    title, get = MARKETS[slug]
    rows = sorted(UPCOMING, key=lambda m: -get(m)["p"])
    lede = f"{title} for every upcoming match, most likely first, with the probability the model gives each one."
    return f"{title} | GoalCast", lede, head(title, lede) + fixtures(rows, get), ""


def page_safe():
    s = market_stat("SAFE") or {}
    rows = sorted((m for m in UPCOMING if "SAFE" in m["tips"]), key=lambda m: -m["tips"]["SAFE"]["p"])
    lede = (f"The most likely selection in each match, shown only at 80% or higher. {pct(s.get('rate', 0), 1)} landed across "
            f"{s.get('n', 0):,} picks on matches the model had never seen.")
    return "Safe football tips today | GoalCast", lede, head("Safe tips", lede) + fixtures(rows, lambda m: m["tips"]["SAFE"]), ""


def page_value():
    rows = sorted((m for m in UPCOMING if "VALUE" in m["tips"]), key=lambda m: -m["tips"]["VALUE"]["edge"])
    lede = "Where the model and the bookmakers disagree by 5% or more, shown with the honest record of how those disagreements have fared."
    return "Model vs bookmaker odds | GoalCast", lede, head("Model vs market", lede) + fixtures(rows, lambda m: m["tips"]["VALUE"]), ""


def page_results():
    bt = RES.get("backtest", {})
    lede = f"Every settled prediction, wins and losses side by side. {bt.get('n', 0):,} holdout matches from {bt.get('from', '')} to {bt.get('to', '')}."
    tiles = table(["Market", "Picks", "Hit rate", "Expected"], [[e(m["label"]), f"{m['n']:,}", pct(m["rate"], 1), pct(m["avg_p"], 1)] for m in bt.get("markets", [])])
    rows = [[r["date"], f"<strong>{e(r['home'])} v {e(r['away'])}</strong>", e(r["league"]), r["score"], e(label(r["tips"]["1X2"]["sel"], r)),
             "Won" if r["tips"]["1X2"]["won"] else "Lost"] for r in bt.get("rows", [])[:80]]
    return ("Football prediction results | GoalCast", lede,
            head("Results", lede) + tiles + "<h2>Recent predictions</h2>" + table(["Date", "Match", "League", "Score", "Prediction", "Result"], rows), "")


def page_model():
    x = MODEL.get("metrics", {})
    lede = "How the GoalCast model is built and how it measures up against bookmaker odds on matches it has never seen."
    rows = [[n, pct(x[k]["accuracy"], 1), f"{x[k]['log_loss']:.4f}"] for n, k in [("GoalCast model", "model_on_priced"), ("Bookmaker odds", "bookmaker"), ("League base rates", "base_rate")] if k in x]
    return "How the GoalCast model performs | GoalCast", lede, head("The model, measured", lede) + table(["Forecaster", "1X2 accuracy", "Log loss"], rows), ""


def page_premium():
    lede = "A banker of the day and ready-made accumulators built from the model's safest selections. Free for members."
    return "Premium football tips | GoalCast", lede, head("Premium", lede), ""


def page_leagues():
    lede = f"Standings, top scorers, top assists and predictions for {len(LEAGUES)} leagues, plus international matches in Europe, Africa and North America."
    items = "".join(f'<li><a href="#/league/{d}">{e(v["country"])}: {e(v["league"])}</a></li>' for d, v in sorted(LEAGUES.items(), key=lambda kv: (kv[1]["country"], kv[1]["tier"])))
    intl = "".join(f'<li><a href="#/intl/{k}">International: {v}</a></li>' for k, v in REGIONS.items())
    return "Football leagues, standings and top scorers | GoalCast", lede, head("Leagues", lede) + f"<ul>{items}{intl}</ul>", ""


def page_league(div):
    v = LEAGUES[div]
    name = f"{v['league']} ({v['country']})"
    lede = f"{v['league']} {v['season']} standings, top scorers, top assists and match predictions."
    standings = table(["#", "Club", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"],
                      [[str(t["pos"]), f"<strong>{e(t['team'])}</strong>", *(str(t[k]) for k in ("p", "w", "d", "l", "gf", "ga", "gd", "pts"))] for t in v["table"]])
    players = lambda rows, key: table(["#", "Player", "Club", "Matches", key.title()],
                                      [[str(i + 1), f"<strong>{e(p['player'])}</strong>", e(p["team"]), str(p["apps"]), str(p[key])] for i, p in enumerate(rows)])
    body = (head(name, lede) + "<h2>Standings</h2>" + standings + "<h2>Top scorers</h2>" + players(v["scorers"], "goals")
            + "<h2>Top assists</h2>" + players(v["assists"], "assists") + "<h2>Upcoming fixtures</h2>" + fixtures([m for m in UPCOMING if m["div"] == div]))
    return f"{v['league']} table, top scorers and predictions | GoalCast", lede, body, ""


def page_intl(slug):
    region = REGIONS[slug]
    lede = f"Predictions for continental club competitions and national-team matches in {region}."
    rows = [m for m in UPCOMING if m.get("intl") and m["country"] == region]
    return f"{region} international football predictions | GoalCast", lede, head(f"International: {region}", lede) + fixtures(rows), ""


def page_blog():
    lede = "Guides, previews and notes on how the model works."
    items = "".join(f'<article><h2><a href="#/blog/{p["slug"]}">{e(p["title"])}</a></h2><p class="muted">{p["date"]} · {e(p["author"])}</p><p>{e(p["summary"])}</p></article>' for p in POSTS)
    return "GoalCast blog: football betting guides and previews", lede, head("Blog", lede) + (items or "<p>No articles published yet.</p>"), ""


def page_post(post):
    schema = {"@context": "https://schema.org", "@type": "Article", "headline": post["title"], "datePublished": post["date"],
              "author": {"@type": "Person", "name": post["author"]}, "publisher": {"@type": "Organization", "name": "GoalCast"},
              "description": post["summary"], "mainEntityOfPage": f"{SITE_URL}blog/{post['slug']}/"}
    body = (f'<article class="post"><a class="muted" href="#/blog">← All articles</a><h1>{e(post["title"])}</h1>'
            f'<p class="muted">{e(post["author"])} · {post["date"]} · {post["minutes"]} min read</p><div class="prose">{post["html"]}</div></article>')
    extra = f'<meta property="article:published_time" content="{post["date"]}">\n<script type="application/ld+json">{json.dumps(schema)}</script>'
    return f"{post['title']} | GoalCast", post["summary"] or post["title"], body, extra


def page_static(p):
    body = (f'<article class="post"><h1>{e(p["title"])}</h1><p class="muted">Last updated {p["updated"]}</p><div class="prose">{p["html"]}</div></article>')
    return f"{p['title']} | GoalCast", p["summary"] or p["title"], body, ""


def routes() -> dict[str, tuple]:
    pages = {"": page_home(), "safe": page_safe(), "value": page_value(), "results": page_results(), "model": page_model(),
             "premium": page_premium(), "leagues": page_leagues(), "blog": page_blog()}
    pages.update({f"market/{slug}": page_market(slug) for slug in MARKETS})
    pages.update({f"league/{div}": page_league(div) for div in LEAGUES})
    pages.update({f"intl/{slug}": page_intl(slug) for slug in REGIONS})
    pages.update({f"blog/{p['slug']}": page_post(p) for p in POSTS})
    pages.update({p["slug"]: page_static(p) for p in STATIC_PAGES})
    return pages


def render(template: str, route: str, page: tuple, prefix: str) -> str:
    """Fill the app shell for one route. ``prefix`` is the path from this page back to the site root."""
    title, description, body, extra = page
    url = SITE_URL + (route + "/" if route else "")
    meta = (f'<link rel="canonical" href="{url}">\n<meta property="og:type" content="website">\n<meta property="og:site_name" content="GoalCast">\n'
            f'<meta property="og:title" content="{e(title)}">\n<meta property="og:description" content="{e(description)}">\n<meta property="og:url" content="{url}">\n'
            f'<meta property="og:image" content="{SITE_URL}assets/brand/goalcast-profile.png">\n<meta name="twitter:card" content="summary">\n{extra}')
    out = template
    start, end = out.index("<title>"), out.index("</title>") + len("</title>")
    out = out[:start] + f"<title>{e(title)}</title>" + out[end:]
    start = out.index('<meta name="description"')
    out = out[:start] + f'<meta name="description" content="{e(description)}">' + out[out.index(">", start) + 1:]
    start = out.index('<meta property="og:image"')
    out = out[:start] + meta + out[out.index(">", start) + 1:]
    start, end = out.index('<main class="wrap" id="app"'), out.index("</main>")
    out = out[:out.index(">", start) + 1] + body + out[end:]
    for ref in ('href="styles.css"', 'href="assets/', 'src="assets/', 'src="config.js"', 'src="app.js"'):
        out = out.replace(ref, ref.replace('="', f'="{prefix}'))
    return out.replace('href="#/', f'href="{prefix}')


def build() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SITE, DIST)
    template = (SITE / "index.html").read_text(encoding="utf-8")
    pages = routes()
    for route, page in pages.items():
        folder = DIST / route if route else DIST
        folder.mkdir(parents=True, exist_ok=True)
        prefix = "../" * route.count("/") + ("../" if route else "./")
        (folder / "index.html").write_text(render(template, route, page, prefix), encoding="utf-8", newline="\n")
    # anything not pre-built (a new article, a single day's fixtures) still opens the app
    not_found = ("GoalCast", "Football predictions, graded in public.", "<p class=\"loading\">Loading…</p>", '<meta name="robots" content="noindex">')
    (DIST / "404.html").write_text(render(template, "", not_found, BASE_PATH), encoding="utf-8", newline="\n")

    today = date.today().isoformat()
    urls = "".join(f"<url><loc>{SITE_URL}{route + '/' if route else ''}</loc><lastmod>{today}</lastmod></url>\n" for route in pages if route != "premium")
    (DIST / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n', encoding="utf-8")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}sitemap.xml\n", encoding="utf-8")
    print(f"built {len(pages)} pages into dist/ for {SITE_URL}")


if __name__ == "__main__":
    build()
