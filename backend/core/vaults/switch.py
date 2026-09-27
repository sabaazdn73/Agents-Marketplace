"""
Whether the vault collector runs, on the worker. The web service does not
consult it: the two services have their own environments, so the web's
answer would describe its own settings, not the worker's.

Off unless HELIUS_API_KEY is set, so production never polls the public
Solana RPC on a schedule. VAULTS_COLLECTOR_ENABLED=1 or 0 overrides that
either way.
"""

from __future__ import annotations

import os


def collector_enabled() -> bool:
    flag = os.environ.get("VAULTS_COLLECTOR_ENABLED", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    return bool(os.environ.get("HELIUS_API_KEY", "").strip())
