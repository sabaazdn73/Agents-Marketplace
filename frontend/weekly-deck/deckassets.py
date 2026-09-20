"""The files a deck embeds, as base64, so a week module can drop them inline.

Kept apart from build.py because the week modules import these and build.py
imports the week modules.
"""

import base64
import pathlib

ASSETS = pathlib.Path(__file__).resolve().parent / "assets"


def b64(name):
    return base64.b64encode((ASSETS / name).read_bytes()).decode()


FONT_B64 = b64("caveat-latin.woff2")
RATE_B64 = b64("panel-rate.jpg")
NORATE_B64 = b64("panel-no-rate.jpg")
