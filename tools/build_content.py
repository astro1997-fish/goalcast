"""Build the blog and sponsor data the website reads.

    python -m tools.build_content

Reads ``content/blog/*.md`` and ``content/sponsors.json`` and writes
``site/data/blog.json`` and ``site/data/sponsors.json``. Files whose names
start with an underscore (such as ``_template.md``) are ignored.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "content" / "blog"
SPONSORS_PATH = ROOT / "content" / "sponsors.json"
OUT_DIR = ROOT / "site" / "data"

LEAGUE_CODES = {"E0", "E1", "E2", "E3", "SC0", "D1", "D2", "I1", "I2", "SP1", "SP2", "F1", "F2", "N1", "B1", "P1", "T1", "G1"}
MARKET_SLUGS = {"1x2", "double-chance", "over-1-5", "over-2-5", "under-3-5", "btts", "correct-score"}
PAGES = {"home": "#/", "predictions": "#/", "safe": "#/safe", "value": "#/value", "results": "#/results", "model": "#/model",
         "leagues": "#/leagues", "premium": "#/premium", "blog": "#/blog"}
PLACEMENTS = {"banner", "feed", "article"}
SHORTCUT = re.compile(r"\]\((league|market|page|post):([^)\s]+)\)")

warnings: list[str] = []


def warn(message: str) -> None:
    warnings.append(message)
    print(f"warning: {message}", file=sys.stderr)


def resolve_links(text: str, source: str, slugs: set[str]) -> str:
    """Turn (league:E0), (market:btts), (page:results) and (post:slug) into site links."""
    def swap(match: re.Match) -> str:
        kind, target = match.group(1), match.group(2)
        if kind == "league" and target.upper() in LEAGUE_CODES:
            return f"](#/league/{target.upper()})"
        if kind == "market" and target.lower() in MARKET_SLUGS:
            return f"](#/market/{target.lower()})"
        if kind == "page" and target.lower() in PAGES:
            return f"]({PAGES[target.lower()]})"
        if kind == "post" and target in slugs:
            return f"](#/blog/{target})"
        warn(f"{source}: unknown link target '{kind}:{target}'")
        return match.group(0)
    return SHORTCUT.sub(swap, text)


def parse_post(path: Path) -> tuple[dict, str]:
    """Split a post into its settings block (between --- lines) and its body."""
    text = path.read_text(encoding="utf-8-sig")
    meta: dict[str, str] = {}
    if text.startswith("---"):
        _, head, text = text.split("---", 2)
        for line in head.strip().splitlines():
            if ":" in line and not line.lstrip().startswith("#"):
                key, value = line.split(":", 1)
                meta[key.strip().lower()] = value.strip().strip("\"'")
    return meta, text.strip()


def build_blog() -> list[dict]:
    paths = sorted(p for p in BLOG_DIR.glob("*.md") if not p.name.startswith("_")) if BLOG_DIR.exists() else []
    slugs = {p.stem for p in paths}
    posts = []
    for path in paths:
        meta, body = parse_post(path)
        if meta.get("draft", "").lower() in ("true", "yes"):
            continue
        if not meta.get("title"):
            warn(f"{path.name}: no title, skipped")
            continue
        try:
            published = date.fromisoformat(meta.get("date", ""))
        except ValueError:
            warn(f"{path.name}: date must look like 2026-10-09, skipped")
            continue
        html = markdown.markdown(resolve_links(body, path.name, slugs), extensions=["extra", "sane_lists"])
        words = len(re.sub(r"<[^>]+>", " ", html).split())
        posts.append({
            "slug": path.stem, "title": meta["title"], "date": published.isoformat(), "summary": meta.get("summary", ""),
            "author": meta.get("author", "GoalCast"), "tags": [t.strip() for t in meta.get("tags", "").split(",") if t.strip()],
            "image": meta.get("image", ""), "minutes": max(1, round(words / 220)), "html": html,
        })
    return sorted(posts, key=lambda p: (p["date"], p["slug"]), reverse=True)


def build_sponsors() -> dict:
    if not SPONSORS_PATH.exists():
        return {"sponsors": [], "advertise": {}}
    raw = json.loads(SPONSORS_PATH.read_text(encoding="utf-8-sig"))
    sponsors = []
    for s in raw.get("sponsors", []):
        name = s.get("name", "?")
        if not s.get("active", True):
            continue
        if not str(s.get("url", "")).startswith("https://"):
            warn(f"sponsor '{name}': url must start with https://, skipped")
            continue
        placements = [p for p in s.get("placements", []) if p in PLACEMENTS]
        if not placements:
            warn(f"sponsor '{name}': needs at least one placement of {sorted(PLACEMENTS)}, skipped")
            continue
        entry = {"name": name, "url": s["url"], "headline": s.get("headline", name), "text": s.get("text", ""),
                 "cta": s.get("cta", "Visit"), "image": s.get("image", ""), "placements": placements}
        for key in ("start", "end"):
            if s.get(key):
                try:
                    entry[key] = date.fromisoformat(s[key]).isoformat()
                except ValueError:
                    warn(f"sponsor '{name}': {key} must look like 2026-10-09, ignored")
        sponsors.append(entry)
    advertise = raw.get("advertise") or {}
    return {"sponsors": sponsors, "advertise": {"email": advertise.get("email", ""), "text": advertise.get("text", "")}}


def build() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    posts, sponsors = build_blog(), build_sponsors()
    (OUT_DIR / "blog.json").write_text(json.dumps({"posts": posts}, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "sponsors.json").write_text(json.dumps(sponsors, separators=(",", ":")), encoding="utf-8")
    print(f"built {len(posts)} posts, {len(sponsors['sponsors'])} active sponsors, {len(warnings)} warnings")


if __name__ == "__main__":
    build()
