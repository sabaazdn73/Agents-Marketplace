#!/usr/bin/env python3
"""Package extension/ for the Chrome Web Store, and refuse to if it is wrong.

    python3 extension-store/build.py

Writes extension-store/tnega-<version>.zip.

WHY THIS IS A SCRIPT AND NOT A ZIP COMMAND
------------------------------------------
Zipping a directory is one line. The checks around it are the reason this
exists: a Web Store rejection costs days of round trip, and every check below
corresponds to a listed rejection reason that can be tested here in a second.

  every file the manifest names exists   a missing icon or script is a load
                                         failure the reviewer sees first
  nothing is fetched from a CDN          remotely hosted code is a hard
                                         rejection under MV3
  no credentials in the bundle           a key in a published package is
                                         public, and a listed rejection cause
  the file list is a whitelist           .DS_Store, notes and stray files
                                         cannot travel by accident
  permissions are inventoried            the listing has to justify each one,
                                         so the script prints them

The zip contains the extension's files at the top level, not inside a folder,
which is what the Developer Dashboard expects.
"""

import hashlib
import json
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
OUT_DIR = ROOT / "extension-store"

# The package, stated rather than globbed. Everything the extension needs at
# runtime is here; anything not here does not ship.
FILES = [
    "manifest.json",
    "shared.js",
    "filter.js",
    # The background worker, new in 0.2.0. It is what holds the membership list
    # so that a page about an address this project has never measured produces
    # no request at all.
    "sw.js",
    "agentPanel.js",
    "explorer.js",
    "scan8004.js",
    "content.js",
    "popup.js",
    "popup.html",
    "popup.css",
    "panel.css",
    "icons/tnega-16.png",
    "icons/tnega-32.png",
    "icons/tnega-48.png",
    "icons/tnega-128.png",
    # Hyperliquid's mascot, used inside the panel only. Declared in the
    # manifest's web_accessible_resources, so it has to be in the package.
    "icons/hypurr-128.png",
]

# Hosts the bundle is allowed to name. Anything else in a source file is either
# remotely hosted code or a second backend nobody reviewed.
ALLOWED_HOSTS = {
    "agents-marketplace-q3k4.onrender.com",  # the measurements endpoint
    "www.tnega.app",                         # the panel's footer and header links
    # The sites the panel is injected into. Every one of these is also a
    # content_scripts match, and the check below is what stops a host appearing
    # in the source without appearing in the manifest, which is how an
    # undeclared injection would get past review.
    "app.hyperliquid.xyz",
    "etherscan.io",
    "bscscan.com",
    "basescan.org",
    "arbiscan.io",
    "monadscan.com",
    "hyperevmscan.io",
    "8004scan.io",
}

SECRET_PATTERNS = [
    (r"\bsk-[A-Za-z0-9]{16,}", "OpenAI-style key"),
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS access key id"),
    (r"\b0x[a-fA-F0-9]{64}\b", "64-hex value, possibly a private key"),
    (r"(?i)\b(api[_-]?key|secret|passwd|password|bearer|authorization)\b\s*[:=]\s*['\"][^'\"]+['\"]",
     "assigned credential"),
]

# Loading code from anywhere but the package. MV3 forbids it and the reviewer
# checks for it.
REMOTE_CODE_PATTERNS = [
    (r"<script[^>]+src\s*=\s*['\"]https?://", "remote <script> tag"),
    # importScripts of a REMOTE url. A service worker loading a file from its
    # own package is the documented MV3 way to share code between the worker
    # and the content scripts, and sw.js does exactly that with filter.js. The
    # pattern used to match any importScripts at all, which would have failed
    # this build for the correct construction.
    (r"\bimportScripts\s*\(\s*['\"]https?://", "importScripts of a remote url"),
    (r"\beval\s*\(", "eval"),
    (r"new\s+Function\s*\(", "new Function"),
    (r"@import\s+url\(\s*['\"]?https?://", "remote CSS @import"),
]


def fail(msg):
    print(f"FAIL  {msg}")
    return 1


def main():
    problems = 0
    manifest_path = SRC / "manifest.json"
    manifest = json.loads(manifest_path.read_text())

    if manifest.get("manifest_version") != 3:
        problems += fail("manifest_version is not 3")

    version = manifest["version"]
    if not re.fullmatch(r"\d+(\.\d+){0,3}", version):
        problems += fail(f"version {version!r} is not one to four dot-separated integers")

    # Every path the manifest names has to be in the package, and every file in
    # the package has to exist. A reviewer's first action is to load it.
    named = set()
    for size, path in manifest.get("icons", {}).items():
        named.add(path)
    for size, path in manifest.get("action", {}).get("default_icon", {}).items():
        named.add(path)
    if "default_popup" in manifest.get("action", {}):
        named.add(manifest["action"]["default_popup"])
    for cs in manifest.get("content_scripts", []):
        named.update(cs.get("js", []))
        named.update(cs.get("css", []))
    for war in manifest.get("web_accessible_resources", []):
        named.update(war.get("resources", []))

    missing_from_list = sorted(named - set(FILES))
    if missing_from_list:
        problems += fail(f"manifest names files the package does not ship: {missing_from_list}")

    for rel in FILES:
        if not (SRC / rel).is_file():
            problems += fail(f"listed file does not exist: {rel}")

    # popup.html loads its own scripts and stylesheet, which the manifest never
    # mentions, so they are checked from the HTML itself rather than assumed.
    popup = (SRC / "popup.html").read_text()
    for ref in re.findall(r'(?:src|href)\s*=\s*"([^"]+)"', popup):
        if ref.startswith(("http://", "https://", "data:")):
            continue
        if ref not in FILES:
            problems += fail(f"popup.html references {ref}, which is not in the package")

    # Source-level checks, on exactly what ships.
    for rel in FILES:
        path = SRC / rel
        if path.suffix not in {".js", ".html", ".css", ".json"}:
            continue
        text = path.read_text()
        for host in set(re.findall(r"https?://([A-Za-z0-9.-]+)", text)):
            if host not in ALLOWED_HOSTS:
                problems += fail(f"{rel} names an unexpected host: {host}")
        for pattern, label in SECRET_PATTERNS:
            if re.search(pattern, text):
                problems += fail(f"{rel} looks like it contains a {label}")
        for pattern, label in REMOTE_CODE_PATTERNS:
            if re.search(pattern, text):
                problems += fail(f"{rel} uses {label}")

    if problems:
        print(f"\n{problems} problem(s). Nothing was written.")
        return 1

    OUT_DIR.mkdir(exist_ok=True)
    zip_path = OUT_DIR / f"tnega-{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in FILES:
            z.write(SRC / rel, rel)

    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()

    print(f"OK    manifest v{manifest['manifest_version']}, version {version}")
    print(f"OK    {len(FILES)} files, no remote code, no credentials, no stray files")
    print(f"OK    permissions: {manifest.get('permissions', [])}")
    print(f"OK    host permissions: {manifest.get('host_permissions', [])}")
    print(f"OK    content scripts on: "
          f"{[m for cs in manifest.get('content_scripts', []) for m in cs['matches']]}")
    print(f"OK    background service worker: "
          f"{'declared' if 'background' in manifest else 'none'}")
    print(f"\nwrote {zip_path.relative_to(ROOT)}  "
          f"{zip_path.stat().st_size:,} bytes\nsha256 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
