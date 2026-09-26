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

The panel's cat, Fendi, is not generated here. fendi-128.png is the owner's
file as supplied; fendi-32.png and fendi-48.png are Lanczos downscales of the
owner's 512px master, which is not in the repository, at the same framing.
He is shown inside the panels only. This script makes the logo, which is what
the toolbar, the store icon and the tile carry.
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
    what the extension shows and one saying what it does not. No mascot, no
    Hyperliquid mark, no number: a number on a promotional tile would either be
    invented or be stale the day after it was rendered.

    The strapline reads "for Hyperliquid and On-chain Agents" from 0.2.0. It
    was "for Hyperliquid", which described half the extension once the agent
    subject existed. Note that the ITEM NAME dropped the venue's name entirely,
    on the trademark reasoning in listing.md; naming the venue here says what
    the extension works with rather than claiming to be their product, which is
    the distinction the policy draws. The type is smaller because the line is
    twice as long and the tile did not grow.
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
        font-size="14" font-weight="500" fill="#97FCE4">for Hyperliquid and On-chain Agents</text>

  <rect x="32" y="158" width="376" height="1" fill="#FFFFFF" fill-opacity="0.10"/>

  <text x="32" y="192" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="16" font-weight="600" fill="#E5E7EB">What was measured, on the address page</text>
  <text x="32" y="216" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="13" fill="#9CA3AF">Post-only rejection, or whether an agent answers and who</text>
  <text x="32" y="236" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="13" fill="#9CA3AF">has paid it. Or the reason there is nothing to show.</text>
  <text x="32" y="258" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="12" fill="#6B7280">No recommendation, no prediction.</text>
</svg>
'''


def marquee_svg(master_b64):
    """The 1400x560 marquee tile.

    Not the small tile scaled up. At 1400 wide the same three lines would sit
    in a corner with half the canvas empty, so the mark and wordmark take the
    left third and the three things the extension says take the right, each on
    its own line at a size that survives the store's own downscaling.

    The store crops this tile at several aspect ratios depending on where it is
    shown, so nothing meaningful goes within 40px of any edge.
    """
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1400" height="560" viewBox="0 0 1400 560">
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

  <rect width="1400" height="560" fill="url(#ground)"/>
  <rect x="0" y="0" width="1400" height="4" fill="url(#hair)"/>

  <image x="96" y="170" width="220" height="220" xlink:href="data:image/png;base64,{master_b64}"/>

  <text x="360" y="246" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="68" font-weight="700" fill="#F3F4F6">Tnega</text>
  <text x="360" y="296" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="26" font-weight="500" fill="#97FCE4">for Hyperliquid and On-chain Agents</text>

  <rect x="360" y="330" width="944" height="1" fill="#FFFFFF" fill-opacity="0.10"/>

  <text x="360" y="376" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="24" font-weight="600" fill="#E5E7EB">What was measured about the address on the page you are on</text>
  <text x="360" y="414" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="19" fill="#9CA3AF">Post-only rejection on Hyperliquid. Whether a registered agent answers,</text>
  <text x="360" y="442" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="19" fill="#9CA3AF">and who has paid it. Or the reason there is nothing to show.</text>
  <text x="360" y="482" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="17" fill="#6B7280">No recommendation, no prediction, no score.</text>
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

    msvg = pathlib.Path(tempfile.gettempdir()) / "tnega-marquee.svg"
    msvg.write_text(marquee_svg(base64.b64encode(MASTER.read_bytes()).decode()))
    marquee = STORE / "promo-1400x560.png"
    subprocess.run(
        ["rsvg-convert", "-w", "1400", "-h", "560", "-o", str(marquee), str(msvg)],
        check=True,
    )
    print(f"wrote {marquee.relative_to(ROOT)}")

    for path in [ICONS / f"tnega-{s}.png" for s in TOOLBAR_SIZES] + [store_icon, tile, marquee]:
        print(f"  {path.relative_to(ROOT)}  {Image.open(path).size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
