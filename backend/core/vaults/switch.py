"""
Whether the vault collector runs, decided once for both processes: the
worker (which runs it) and the web service (which says why nothing is
served yet).

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
