#!/usr/bin/env python3
"""Capture the Web Store screenshots from the running extension.

    python3 extension-store/capture.py

Writes extension-store/screenshot-*.png, each exactly 1280x800, which is what
the store accepts.

WHAT THIS IS AND IS NOT
-----------------------
It is a real capture: Chromium loads extension/ unpacked, opens a real
Hyperliquid explorer page, and the panel in the image is the panel the code
draws from live measurements. Nothing is composited and no frame is drawn by
hand. If the backend is down the script fails rather than producing a picture
of something that did not happen.

Two addresses, because the two states are the point of the product:

  the rate       an address with enough current observations behind it, so
                 the panel shows a number and a band
  no rate        an address whose newest order is hours old, where the panel
                 refuses to compute a rate and says why

Both are chosen at run time by reading the API, not written into this file.
The first version hardcoded two addresses and one of them went stale
overnight: it stopped showing a rate, which made it a second picture of the
withheld case and broke the run. Which addresses are current is exactly the
thing this product measures and therefore exactly the thing that will not hold
still, so the script asks rather than assumes. It prints what it picked and
what each panel said, so an image can be checked against the text.
"""

import concurrent.futures
import json
import pathlib
import shutil
import sys
import tempfile
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = ROOT / "extension-store"

WIDTH, HEIGHT = 1280, 800

# Headless by default. Pass --headed to watch it, which is the first thing to
# try if a capture comes back without a panel on it.
HEADLESS = "--headed" not in sys.argv

API = "https://agents-marketplace-q3k4.onrender.com"

# A current address can sit minutes away from its own staleness cutoff, and a
# capture that starts before it crosses can finish after. Addresses with this
# much margin are the ones that will still be showing a rate when the page has
# finished loading.
SAFE_MARGIN_SECONDS = 1800


def fetch(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=90) as r:
        return json.load(r)


def pick_addresses():
    """One address showing a rate, one being refused one, chosen from the set.

    The rate goes to the highest rejection rate among addresses that are
    comfortably current, because that is the panel doing the thing it exists
    for. The withheld one goes to whichever stale address has seen the most
    post-only orders, so the facts under the refusal are substantial and the
    image says plainly that a large sample is not the same as a current one.
    """
    makers = [m["address"] for m in fetch("/api/hyperliquid/overview")["makers"]]
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        detail = dict(zip(makers, ex.map(
            lambda a: fetch(f"/api/hyperliquid/address/{a}"), makers)))

    current = [
        (d["post_only"]["rejection_rate"], a) for a, d in detail.items()
        if not d["withheld_reason"]
        and d["freshness"]["newest_record_age_seconds"] < SAFE_MARGIN_SECONDS
    ]
    stale = [
        (d["post_only"]["alo_total"], a) for a, d in detail.items()
        if d["withheld_reason"] == "stale_data"
    ]
    if not current or not stale:
        raise SystemExit(
            f"cannot pick addresses: {len(current)} current, {len(stale)} stale")

    return [
        {
            "name": "screenshot-1-rate.png",
            "address": max(current)[1],
            "expect": ".tnega-rate",
        },
        {
            "name": "screenshot-2-no-rate.png",
            "address": max(stale)[1],
            "expect": ".tnega-withheld-title",
        },
    ]


def main():
    shots = pick_addresses()
    for s in shots:
        print(f"picked {s['address']} for {s['name']}")
    profile = pathlib.Path(tempfile.mkdtemp(prefix="tnega-capture-"))
    failures = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(profile),
            # channel="chromium" is load-bearing. Playwright's default headless
            # Chromium is the headless shell, a stripped binary with no
            # extension support at all: the first run of this script produced
            # two pages with no panel on them, because nothing had been loaded.
            # This asks for the full browser in the new headless mode, which
            # does run extensions.
            channel="chromium",
            headless=HEADLESS,
            args=[
                f"--disable-extensions-except={EXT}",
                f"--load-extension={EXT}",
                f"--window-size={WIDTH},{HEIGHT}",
            ],
            viewport={"width": WIDTH, "height": HEIGHT},
            # Exactly 1280x800 device pixels. A retina scale factor would
            # produce a 2560x1600 file the store rejects.
            device_scale_factor=1,
        )
        try:
            for shot in shots:
                page = ctx.new_page()
                page.set_viewport_size({"width": WIDTH, "height": HEIGHT})
                page.goto(
                    f"https://app.hyperliquid.xyz/explorer/address/{shot['address']}",
                    wait_until="domcontentloaded",
                    timeout=90_000,
                )
                try:
                    # The panel waits for their card to render before it places
                    # itself, and then for the backend, so this is two waits in
                    # one: the selector only exists once both have happened.
                    page.wait_for_selector(
                        f"#tnega-hl-panel {shot['expect']}", timeout=90_000
                    )
                except Exception as e:  # noqa: BLE001
                    failures.append(f"{shot['name']}: {type(e).__name__}")
                    panel = page.query_selector("#tnega-hl-panel")
                    print(f"  panel text: {panel.inner_text() if panel else 'no panel'}")
                    page.close()
                    continue

                # Their announcements toast opens over the bottom right of the
                # page and has nothing to do with the extension. Dismissed the
                # way a reader would dismiss it, by clicking its close control,
                # rather than hidden with injected CSS: the image should be a
                # page someone could be looking at.
                try:
                    toast = page.locator(
                        "div:has(> div:text-is('Announcements'))"
                    ).last
                    if toast.count():
                        toast.locator("svg, button").last.click(timeout=3000)
                        page.wait_for_timeout(400)
                except Exception:  # noqa: BLE001
                    pass

                page.locator("#tnega-hl-panel").scroll_into_view_if_needed()
                # Let the scroll settle and their own lazy content stop moving.
                page.wait_for_timeout(1500)
                out = OUT / shot["name"]
                page.screenshot(path=str(out))
                text = page.inner_text("#tnega-hl-panel").replace("\n", " | ")
                print(f"{shot['name']}  {shot['address']}\n  {text}\n")
                page.close()
        finally:
            ctx.close()
            shutil.rmtree(profile, ignore_errors=True)

    if failures:
        print("FAILED: " + "; ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
