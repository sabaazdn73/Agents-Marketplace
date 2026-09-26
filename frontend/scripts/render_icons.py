#!/usr/bin/env python3
"""Render every raster copy of the Tnega mark the site serves, from its SVG.

    python3 frontend/scripts/render_icons.py

Needs rsvg-convert (brew install librsvg) and Pillow.

Masters:
    public/icon_v2.svg           the mark: the arch and the hexagon network on
                                 the rounded blue tile
    public/icon_v2_maskable.svg  the same drawing on a square tile, for the
                                 platforms that cut their own corners

Writes:
    public/favicon.ico              16, 32 and 48 px, rounded tile
    public/app-icon-192.png         rounded tile, manifest "any"
    public/app-icon-512.png         rounded tile, manifest "any", JSON-LD logo
    public/app-icon-maskable-512.png  square tile, manifest "maskable"
    public/apple-touch-icon.png     180 px, square tile; iOS rounds it itself
                                    and fills transparent corners with black
    src/assets/tnega-mark.png       192 px, rounded tile; the header, the
                                    sign-in page and the QR code centre

Each size is rendered from the vector at that size, never scaled down from a
larger raster, so the 16 px favicon is drawn for 16 px. The output carries no
text chunks: rsvg-convert writes none, and Pillow is given none.
"""

import io
import pathlib
import subprocess
import sys

from PIL import Image

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = FRONTEND / "public"
ASSETS = FRONTEND / "src" / "assets"
ROUND = PUBLIC / "icon_v2.svg"
SQUARE = PUBLIC / "icon_v2_maskable.svg"


def render(svg, size):
    try:
        png = subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size), str(svg)],
            check=True, capture_output=True,
        ).stdout
    except FileNotFoundError:
        sys.exit("rsvg-convert not found; install it with: brew install librsvg")
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    assert im.size == (size, size), (svg, size, im.size)
    return im


def save_png(im, path):
    im.save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(FRONTEND)}  {im.size[0]}x{im.size[1]}")


def main():
    save_png(render(ROUND, 192), PUBLIC / "app-icon-192.png")
    save_png(render(ROUND, 512), PUBLIC / "app-icon-512.png")
    save_png(render(SQUARE, 512), PUBLIC / "app-icon-maskable-512.png")
    save_png(render(SQUARE, 180), PUBLIC / "apple-touch-icon.png")
    save_png(render(ROUND, 192), ASSETS / "tnega-mark.png")

    # One frame per size, each rendered at its own size. Pillow's ICO writer
    # takes a frame from append_images when its size matches one requested,
    # and only resamples when none does, so this asks for exactly the three
    # sizes it is given.
    frames = [render(ROUND, s) for s in (16, 32, 48)]
    ico = PUBLIC / "favicon.ico"
    frames[-1].save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)],
                    append_images=frames[:-1])
    got = sorted(Image.open(ico).info["sizes"])
    assert got == [(16, 16), (32, 32), (48, 48)], got
    print(f"wrote {ico.relative_to(FRONTEND)}  {', '.join(f'{w}x{h}' for w, h in got)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
