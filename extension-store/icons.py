#!/usr/bin/env python3
"""Derive every Tnega image the extension and its listing use, from one master.

    python3 extension-store/icons.py

Master: extension/icons/tnega-128.png, the mark on transparency.
Writes:
    extension/icons/tnega-16.png
    extension/icons/tnega-32.png
    extension/icons/tnega-48.png
    extension-store/icon-128.png      byte-identical copy of the master
    extension-store/promo-440x280.png the small promo tile

WHY THIS IS A SCRIPT
--------------------
These five files are one mark in five places: the toolbar at three sizes, the
store icon, and the tile. Made by hand they drift, and the drift is invisible
until someone compares the toolbar against the listing. The tile is the one
that proves the point: it was built from the site's app icon, so when the mark
changed the tile silently kept the old one, background and all.

Edit the master, run this, rebuild the zip. Nothing else touches these files.

The panel's Hypurr image is not here and is not derived from anything: it is
Hyperliquid's mascot, used inside the panel only, and it has no business in a
script that generates Tnega's identity.
"""

import base64
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTER = ROOT / "extension" / "icons" / "tnega-128.png"
ICONS = ROOT / "extension" / "icons"
STORE = ROOT / "extension-store"

TOOLBAR_SIZES = (16, 32, 48)


def promo_svg(master_b64):
    """The 440x280 tile.

    Tnega's mark and wordmark on the panel's own ground, and one line saying
    what the extension shows and one saying what it does not. No Hypurr, no
    Hyperliquid mark, no number: a number on a promotional tile would either be
    invented or be stale the day after it was rendered.
    """
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="440" height="280" viewBox="0 0 440 280">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B101B"/>
      <stop offset="100%" stop-color="#131C2E"/>
    </linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#97FCE4" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#97FCE4" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="440" height="280" fill="url(#ground)"/>
  <rect x="0" y="0" width="440" height="3" fill="url(#hair)"/>

  <!-- The mark sits on the ground directly now that it carries no card of its
       own, so it is drawn a little larger and a little higher than the version
       that had one, to keep its optical weight against the wordmark. -->
  <image x="32" y="34" width="96" height="96" xlink:href="data:image/png;base64,{master_b64}"/>

  <text x="144" y="74" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="27" font-weight="700" fill="#F3F4F6">Tnega</text>
  <text x="144" y="104" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="18" font-weight="500" fill="#97FCE4">for Hyperliquid</text>

  <rect x="32" y="158" width="376" height="1" fill="#FFFFFF" fill-opacity="0.10"/>

  <text x="32" y="192" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="16" font-weight="600" fill="#E5E7EB">Post-only rejection, on the address page</text>
  <text x="32" y="218" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="13" fill="#9CA3AF">The rate for an address, or the reason there is no rate</text>
  <text x="32" y="240" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="13" fill="#9CA3AF">to show. No recommendation, no prediction.</text>
</svg>
'''


def main():
    master = Image.open(MASTER).convert("RGBA")
    if master.size != (128, 128):
        print(f"FAIL  master is {master.size}, expected 128x128")
        return 1
    if master.getchannel("A").getextrema()[0] != 0:
        print("WARN  master has no transparent pixels; it may still carry a background")

    for size in TOOLBAR_SIZES:
        out = ICONS / f"tnega-{size}.png"
        master.resize((size, size), Image.LANCZOS).save(out, optimize=True)
        print(f"wrote {out.relative_to(ROOT)}")

    store_icon = STORE / "icon-128.png"
    shutil.copyfile(MASTER, store_icon)
    print(f"wrote {store_icon.relative_to(ROOT)}  (copy of the master)")

    # The SVG is scaffolding for rsvg-convert, not a deliverable, so it is
    # written outside the repository. A copy of it sitting next to the PNG
    # would be one more thing that can fall out of step with the master.
    svg = pathlib.Path(tempfile.gettempdir()) / "tnega-promo.svg"
    svg.write_text(promo_svg(base64.b64encode(MASTER.read_bytes()).decode()))
    tile = STORE / "promo-440x280.png"
    try:
        subprocess.run(
            ["rsvg-convert", "-w", "440", "-h", "280", "-o", str(tile), str(svg)],
            check=True,
        )
    except FileNotFoundError:
        print("FAIL  rsvg-convert not found; install it with: brew install librsvg")
        return 1
    print(f"wrote {tile.relative_to(ROOT)}")

    for path in [ICONS / f"tnega-{s}.png" for s in TOOLBAR_SIZES] + [store_icon, tile]:
        print(f"  {path.relative_to(ROOT)}  {Image.open(path).size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
