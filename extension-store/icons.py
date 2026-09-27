#!/usr/bin/env python3
"""Derive every Tnega image the extension and its listing use, from one master.

    python3 extension-store/icons.py

Needs Pillow, and rsvg-convert for the promo tiles (brew install librsvg).

Master: frontend/public/fendi-head-512.png, Fendi's head, the site's mark
(owner's decision, 2026-09-27: the mark is Fendi's head, in the toolbar and
the store listing too). Writes:
    extension/icons/icon-16.png       the face, cropped closer so it reads at
                                      16px, with a 1px warm outline so it
                                      holds on a light toolbar as on a dark one
    extension/icons/icon-32.png       the head, same outline
    extension/icons/icon-48.png       the head, same outline
    extension/icons/icon-128.png      the manifest's 128 icon: 96px of head,
                                      16px transparent padding (store rule)
    extension-store/icon-128.png      the store icon, a copy of icon-128.png
    frontend/public/extension-mark-128.png  the head filling its square, the
                                      extension's icon on the website
    extension-store/promo-440x280.png the small promo tile
    extension-store/promo-1400x560.png the marquee tile

The popup header (icons/fendi-head-128.png) and the panels' full-body Fendi
(icons/fendi-32/48/128.png) are the owner's files as supplied, not made here.

Edit the master, run this, rebuild the zip with extension-store/build.py.
"""

import base64
import io
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTER = ROOT / "frontend" / "public" / "fendi-head-512.png"
ICONS = ROOT / "extension" / "icons"
STORE = ROOT / "extension-store"

TOOLBAR_SIZES = (16, 32, 48)

# Where the tiles draw the mark, in their own pixels. The mark is rendered at
# exactly this size and embedded, so rsvg-convert does not resample it.
PROMO_MARK = 96
MARQUEE_MARK = 220


# The face alone, for 16px: the ears stay, the scarf mostly goes.
FACE = (40, 40, 472, 472)


def render(size, crop=None, outline=False):
    """The master at size x size (RGBA), from `crop` of it, optionally with a
    1px outline in a warm brown under the edge."""
    from PIL import ImageFilter
    im = Image.open(MASTER).convert("RGBA")
    if crop:
        im = im.crop(crop)
    im = im.resize((size, size), Image.LANCZOS)
    if not outline:
        return im
    ring = im.split()[-1].point(lambda v: 255 if v > 90 else 0).filter(ImageFilter.MaxFilter(3))
    base = Image.new("RGBA", (size, size), (92, 72, 52, 0))
    base.putalpha(ring.point(lambda v: int(v * 0.85)))
    base.alpha_composite(im)
    return base


def png_b64(im):
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def promo_svg(mark_b64):
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

  <!-- Fendi's head, the mark, on the ground itself. -->
  <image x="32" y="34" width="96" height="96" xlink:href="data:image/png;base64,{mark_b64}"/>

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


def marquee_svg(mark_b64):
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

  <image x="96" y="170" width="220" height="220" xlink:href="data:image/png;base64,{mark_b64}"/>

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
    if not MASTER.exists():
        print(f"FAIL  master not found: {MASTER.relative_to(ROOT)}")
        return 1

    written = []
    for size in (16, 32, 48):
        out = ICONS / f"icon-{size}.png"
        render(size, FACE if size == 16 else None, outline=True).save(out, format="PNG", optimize=True)
        written.append(out)

    # 96px of artwork centred in 128px, per the store's image guidance. The
    # manifest's 128 icon, and the store icon as a copy of it.
    icon128 = ICONS / "icon-128.png"
    canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    canvas.alpha_composite(render(96), (16, 16))
    canvas.save(icon128, format="PNG", optimize=True)
    store_icon = STORE / "icon-128.png"
    shutil.copyfile(icon128, store_icon)

    site_mark = ROOT / "frontend" / "public" / "extension-mark-128.png"
    render(128).save(site_mark, format="PNG", optimize=True)
    written += [icon128, store_icon, site_mark]

    # The SVG is scaffolding for rsvg-convert, not a deliverable, so it is
    # written outside the repository.
    svg = pathlib.Path(tempfile.gettempdir()) / "tnega-promo.svg"
    svg.write_text(promo_svg(png_b64(render(PROMO_MARK))))
    tile = STORE / "promo-440x280.png"
    subprocess.run(["rsvg-convert", "-w", "440", "-h", "280", "-o", str(tile), str(svg)], check=True)
    msvg = pathlib.Path(tempfile.gettempdir()) / "tnega-marquee.svg"
    msvg.write_text(marquee_svg(png_b64(render(MARQUEE_MARK))))
    marquee = STORE / "promo-1400x560.png"
    subprocess.run(["rsvg-convert", "-w", "1400", "-h", "560", "-o", str(marquee), str(msvg)], check=True)
    written += [tile, marquee]

    for path in written:
        print(f"wrote {path.relative_to(ROOT)}  {Image.open(path).size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
