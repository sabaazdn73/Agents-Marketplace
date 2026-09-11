#!/usr/bin/env python
"""Regenerate frontend/public/sitemap.xml.

Run: backend/venv/bin/python backend/scripts/build_sitemap.py

The sitemap was hand-maintained and had drifted: /market, the single most
important page on the site, was missing entirely, 24 of the 46 docs routes
were absent, and no agent page was listed at all. Agent pages are the long
tail -- the ones that can rank for an agent's name or a specific capability
-- and there were none.

WHICH AGENTS GET LISTED, AND WHY NOT ALL OF THEM

77,331 agents are served on BNB Chain alone. Submitting all of them would be
a mistake: the great majority are near-identical registry stubs from a few
automated signup batches, and a sitemap full of thin, near-duplicate pages
invites Google to treat the whole domain as low quality rather than to index
more of it.

The bar here is an agent that is genuinely reachable AND describes itself:

    service_status == "responding"  and a non-empty description

That is 6,052 on BNB Chain, roughly 8% of the serving set, and every one of
them is a page with something specific on it. The others stay crawlable --
robots.txt allows them, they are linked from the marketplace -- they are
simply not put forward as pages worth Google's crawl budget.

Non-BSC chains use their own /chain-agent/<chainId>/<tokenId> route and the
same bar.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys
from datetime import date
from xml.sax.saxutils import escape

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = pathlib.Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")

BASE = "https://www.tnega.app"
OUT = ROOT / "frontend" / "public" / "sitemap.xml"
DOCS_DIR = ROOT / "docs"

# Routes the app actually serves, from frontend/src/routePaths.js and App.jsx.
# `/market` is first after the homepage because it is the page this site is
# for; it was the one missing from the hand-written file.
STATIC = [
    ("/", "daily", "1.0"),
    ("/market", "daily", "0.9"),
    ("/native-agents", "weekly", "0.8"),
    ("/skills", "weekly", "0.8"),
    ("/learn", "monthly", "0.7"),
    ("/docs", "weekly", "0.7"),
    ("/report", "monthly", "0.6"),
    ("/build", "monthly", "0.6"),
    ("/sell", "monthly", "0.6"),
    ("/ecosystem", "monthly", "0.5"),
    ("/data-sources", "monthly", "0.4"),
    ("/partners", "monthly", "0.4"),
    ("/status", "weekly", "0.4"),
]
# Deliberately absent: /my-agents is per-wallet and shows nothing to a
# crawler, and /canary is disallowed in robots.txt.

# Chains whose agents get their own /chain-agent/ URL, and the BSC route.
CHAIN_VIEW_IDS = (42161, 4663)
QUALITY = {"service_status": "responding", "description": {"$nin": [None, ""]}}


def url_el(loc: str, changefreq: str, priority: str, lastmod: str) -> str:
    return (f"  <url><loc>{escape(loc)}</loc><lastmod>{lastmod}</lastmod>"
            f"<changefreq>{changefreq}</changefreq><priority>{priority}</priority></url>")


async def main() -> None:
    today = date.today().isoformat()
    rows: list[str] = [url_el(f"{BASE}{p}", cf, pr, today) for p, cf, pr in STATIC]

    # Slugs are lowercased by DocsPage.filenameToSlug, and README maps to the
    # empty slug -- it IS /docs, so listing /docs/README would submit a second
    # URL for a page already in the static list. SUMMARY is the GitBook table
    # of contents and has no route.
    docs = sorted(
        p.stem.lower() for p in DOCS_DIR.glob("*.md")
        if p.stem.upper() not in {"SUMMARY", "README"}
    )
    for slug in docs:
        rows.append(url_el(f"{BASE}/docs/{slug}", "monthly", "0.5", today))

    client = AsyncIOMotorClient(os.environ["MONGODB_URI"])
    db = client[os.environ["MONGODB_DB_NAME"]]

    seen: set[str] = set()
    bsc = 0
    async for d in db["known_agents"].find(QUALITY, {"_id": 0, "token_id": 1}):
        tid = d.get("token_id")
        if tid is None:
            continue
        loc = f"{BASE}/agent/{tid}"
        if loc in seen:
            continue
        seen.add(loc)
        rows.append(url_el(loc, "weekly", "0.5", today))
        bsc += 1

    per_chain: dict[int, int] = {}
    for cid in CHAIN_VIEW_IDS:
        n = 0
        async for d in db["full_agent_registry"].find(
            {"chain_id": cid, **QUALITY}, {"_id": 0, "token_id": 1}
        ):
            tid = d.get("token_id")
            if tid is None:
                continue
            loc = f"{BASE}/chain-agent/{cid}/{tid}"
            if loc in seen:
                continue
            seen.add(loc)
            rows.append(url_el(loc, "weekly", "0.4", today))
            n += 1
        per_chain[cid] = n
    client.close()

    OUT.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(rows)
        + "\n</urlset>\n"
    )
    total = len(rows)
    print(f"  wrote {OUT.relative_to(ROOT)}")
    print(f"    static routes {len(STATIC)}, docs {len(docs)}, "
          f"BNB Chain agents {bsc:,}, " +
          ", ".join(f"chain {c} {n:,}" for c, n in per_chain.items()))
    print(f"    {total:,} URLs, {OUT.stat().st_size/1024:.0f} KB "
          f"(limits: 50,000 URLs and 50 MB)")
    assert total <= 50_000, "sitemap over the 50,000-URL limit; split it into an index"


if __name__ == "__main__":
    asyncio.run(main())
