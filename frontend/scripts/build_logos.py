#!/usr/bin/env python3
"""Fetch, render and cache the instrument logos the site shows.

    python3 frontend/scripts/build_logos.py [--api https://agents-marketplace-q3k4.onrender.com]

Writes frontend/public/logos/ (served from this site, so a visitor's browser
never calls a logo host) and frontend/src/te/logos.json (which ones exist, for
the bundle), plus frontend/public/logos/sources.json (every logo's source,
licence and author, which the Data sources page lists).

WHICH UNDERLYINGS: those the cost engine lists (GET /api/te/list, every page,
stock, ETF and untyped, including the ones it names as not ranked) and every
curated basket's legs. Any other underlying keeps its initials circle.

SOURCES, IN THE OWNER'S ORDER (2026-09-27):
  1. The issuer's own token image, from its official list. Only xStocks
     publishes one (api.xstocks.fi/api/v2/public/assets, field `logo`, per
     token). It is drawn in xStocks' own frame, so it is used for an xStocks
     VERSION only (keyed by the token symbol, e.g. NVDAx), never as the logo
     of a stock another issuer's version is shown for.
  2. The company's logo from Wikimedia Commons, found through Wikidata (the
     company item whose US stock-exchange statement carries the ticker; its
     small icon, property P8972, where it has one, else its logo, P154). Commons hosts only files under a free licence or in the public
     domain; the licence, the author and the trademark note of each file are
     read from Commons and kept in sources.json. Files whose licence is not in
     FREE below are skipped.
  3. Otherwise nothing: the page draws the initials circle.
  A free logo API (financialmodelingprep.com/image-stock) was checked and not
  used: its terms forbid displaying its data on a website without a specific
  agreement (read 2026-09-27, "Data Display").

RENDERING: each logo is fitted into a 96px square on a tile whose colour is
chosen from the logo itself (a light logo on near-black, anything else on
white), so it reads the same in the light and the dark theme, and saved as
WebP with no metadata.
"""

import argparse
import io
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "logos"
INDEX = ROOT / "src" / "te" / "logos.json"
UA = "tnega-logo-cache/1.0 (https://www.tnega.app)"
SIZE = 96
FREE = ("public domain", "pd", "cc0", "cc by", "cc-by", "apache", "mit", "gfdl", "attribution")


def get(url, *, binary=False, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else json.loads(data)


def listed_underlyings(api):
    names, pinned = set(), set()
    for t in ("stock", "etf", ""):
        off = 0
        while off is not None:
            d = get(f"{api}/api/te/list?type={t}&group=all&limit=100&offset={off}&sort=popular")
            for r in d["rows"]:
                names.add(r["underlying"])
            names.update((d.get("rows_not_ranked") or {}).get("underlyings") or [])
            off = d.get("next_offset")
    for b in get(f"{api}/api/baskets/curated").get("baskets", []):
        for leg in b.get("legs", []):
            if leg.get("underlying"):
                pinned.add(leg["underlying"])
        for ch in b.get("changes", []):
            for leg in ch.get("legs", []):
                pinned.add(leg.get("underlying"))
    return sorted(n for n in names | pinned if n)


def xstocks_logos():
    out, page = {}, 0
    while True:
        d = get(f"https://api.xstocks.fi/api/v2/public/assets?page={page}")
        for n in d["nodes"]:
            if n.get("logo") and n.get("symbol"):
                out[n["symbol"]] = {"logo": n["logo"], "underlying": n.get("underlyingSymbol")}
        if not d["page"].get("hasNextPage"):
            return out
        page += 1


def wikidata_logos(tickers):
    """ticker -> [Commons file names], from companies listed with that ticker."""
    out = {}
    for i in range(0, len(tickers), 150):
        chunk = " ".join(json.dumps(t) for t in tickers[i:i + 150])
        # Only a listing on a US exchange counts: the same ticker names other
        # companies elsewhere (AMC on the ASX is Amcor; SNOW elsewhere was
        # Intrawest). NYSE, Nasdaq, NYSE American, NYSE Arca, BATS (Cboe BZX).
        q = ("SELECT ?t ?logo ?item WHERE { VALUES ?t { %s } "
             "VALUES ?ex { wd:Q13677 wd:Q82059 wd:Q846626 wd:Q10593835 wd:Q795469 } "
             "?item p:P414 ?s . ?s ps:P414 ?ex ; pq:P249 ?t . FILTER NOT EXISTS { ?s pq:P582 ?end } "
             "FILTER NOT EXISTS { ?item wdt:P576 ?gone } "
             # The small icon (P8972) first where the item has one: a
             # wordmark is unreadable at 36px, a square icon is not.
             "{ ?item wdt:P8972 ?logo . BIND(0 AS ?rank) } UNION { ?item wdt:P154 ?logo . BIND(1 AS ?rank) } } "
             "ORDER BY ?t ?rank" % chunk)
        d = get("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q), timeout=90)
        items = {}
        for b in d["results"]["bindings"]:
            items.setdefault(b["t"]["value"], set()).add(b["item"]["value"])
        for b in d["results"]["bindings"]:
            t = b["t"]["value"]
            # Two live companies claiming one US ticker: which is ours is not
            # known, so neither logo is used.
            if len(items[t]) > 1:
                continue
            f = urllib.parse.unquote(b["logo"]["value"].rsplit("/", 1)[1])
            out.setdefault(t, [])
            if f not in out[t]:
                out[t].append(f)
        time.sleep(1)
    return out


def commons_info(filename):
    q = urllib.parse.urlencode({"action": "query", "titles": f"File:{filename}", "prop": "imageinfo",
                                "iiprop": "url|extmetadata", "iiurlwidth": 256, "format": "json"})
    p = next(iter(get(f"https://commons.wikimedia.org/w/api.php?{q}")["query"]["pages"].values()))
    if "imageinfo" not in p:
        return None
    ii = p["imageinfo"][0]
    m = ii.get("extmetadata") or {}
    val = lambda k: ((m.get(k) or {}).get("value") or "").strip()
    import re
    return {"file": filename, "thumb": ii.get("thumburl") or ii.get("url"), "page": ii.get("descriptionurl"),
            "licence": val("LicenseShortName"), "licence_url": val("LicenseUrl"),
            "author": re.sub(r"<[^>]+>", "", val("Artist"))[:160], "restrictions": val("Restrictions"),
            "attribution_required": val("AttributionRequired") == "true"}


def pick(files):
    """Keep the query's order (the small icon first), and within it prefer a
    file not named as a white or dark-mode variant."""
    bad = ("white", "dark", "negative", "inverted", "reversed")
    return sorted(files, key=lambda f: any(b in f.lower() for b in bad))


def render(raw):
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    box = im.getbbox()
    if box:
        im = im.crop(box)
    im.thumbnail((SIZE - 10, SIZE - 10), Image.LANCZOS)
    px = [p for p in im.getdata() if p[3] > 128]
    lum = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b, _ in px) / (255 * len(px)) if px else 0
    tile = (20, 20, 22, 255) if lum > 0.82 else (255, 255, 255, 255)
    out = Image.new("RGBA", (SIZE, SIZE), tile)
    out.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    buf = io.BytesIO()
    out.convert("RGB").save(buf, "WEBP", quality=88, method=6)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://agents-marketplace-q3k4.onrender.com")
    a = ap.parse_args()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "v").mkdir(exist_ok=True)
    tickers = listed_underlyings(a.api)
    print(f"{len(tickers)} underlyings listed")
    sources = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "underlyings": {}, "versions": {}}

    xs = xstocks_logos()
    wanted = set(tickers)
    for sym, x in sorted(xs.items()):
        if x["underlying"] not in wanted:
            continue
        try:
            (PUBLIC / "v" / f"{sym}.webp").write_bytes(render(get(x["logo"], binary=True)))
            sources["versions"][sym] = {"source": "xStocks (issuer)", "url": x["logo"],
                                        "list": "https://api.xstocks.fi/api/v2/public/assets"}
        except Exception as e:  # noqa: BLE001  a logo that fails is left out, not guessed
            print(f"  xStocks {sym}: {type(e).__name__}")
    print(f"{len(sources['versions'])} xStocks token images")

    wd = wikidata_logos(tickers)
    for t in tickers:
        for f in pick(wd.get(t, [])):
            try:
                info = commons_info(f)
                if not info or not any(k in info["licence"].lower() for k in FREE):
                    continue
                (PUBLIC / f"{t}.webp").write_bytes(render(get(info["thumb"], binary=True)))
                sources["underlyings"][t] = {"source": "Wikimedia Commons (via Wikidata P154)", **{k: v for k, v in info.items() if k != "thumb"}}
                break
            except Exception as e:  # noqa: BLE001
                print(f"  {t} {f}: {type(e).__name__}")
            time.sleep(0.3)
    print(f"{len(sources['underlyings'])} company logos from Commons")

    (PUBLIC / "sources.json").write_text(json.dumps(sources, indent=1, ensure_ascii=False) + "\n")
    INDEX.write_text(json.dumps({"u": sorted(sources["underlyings"]), "v": sorted(sources["versions"])}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
