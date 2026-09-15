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

Both were picked by reading the live API, not chosen for how they look. They
are addresses in the collector's set and what they show changes with the
market, so a later run can legitimately produce a different number. The
script prints what each panel said, so the image can be checked against it.
"""

import pathlib
import shutil
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = ROOT / "extension-store"

WIDTH, HEIGHT = 1280, 800

# Headless by default. Pass --headed to watch it, which is the first thing to
# try if a capture comes back without a panel on it.
HEADLESS = "--headed" not in sys.argv

SHOTS = [
    {
        "name": "screenshot-1-rate.png",
        # Currently in the spraying band: most of its post-only orders are
        # refused before they rest, which is the behaviour the panel exists to
        # make visible.
        "address": "0xf58b673c1633ccef0ac58263cdc95ed80f817fc7",
        "expect": ".tnega-rate",
    },
    {
        "name": "screenshot-2-no-rate.png",
        # Thirty polls stored and 92% of its post-only orders rejected, and the
        # panel still shows no rate, because the newest order it has seen is
        # hours old. This is the case the product is built around.
        "address": "0x7839e2f2c375dd2935193f2736167514efff9916",
        "expect": ".tnega-withheld-title",
    },
]


def main():
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
            for shot in SHOTS:
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
