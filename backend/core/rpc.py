"""
rpc.py

The one, real, shared BSC mainnet RPC URL resolver.

Real, confirmed finding (2026-08-27 release-readiness audit): this exact
`os.environ.get("BSC_MAINNET_RPC_URL") or "https://bsc-dataseed.binance.org"`
fallback was independently duplicated in THREE different files
(core/agent_health.py, core/agent_performance.py, adapters/bsc_balance.py)
— and core/canary.py had a FOURTH, different pattern: a hardcoded
`_RPC_URL = "https://bsc.rpc.blxrbdn.com"` that never read the env var at
all. Checked directly, not assumed: `BSC_MAINNET_RPC_URL` is NOT set in
this project's real, live Render environment variables (confirmed via the
Render API's own `/services/{id}/env-vars`) — meaning every one of those
three duplicated fallbacks has been silently hitting the public, heavily-
shared `bsc-dataseed.binance.org` in production this whole time, not the
"real, tested bloXroute endpoint" `docs/getting-started.md` documents as
this project's intended setup (the frontend's own `VITE_MAINNET_READ_RPC`
already defaults to a real bloXroute URL for exactly this reason — the
public node is known to rate-limit and be slow for anything beyond a
trivial single call). Real, measured consequence: a cold-cache
`get_all_agent_performance()` call (core/agent_performance.py, a genuinely
large 5-chunk Multicall3 scan) took a real, measured 16.5s against the
public fallback.

Real fix: one canonical function, real fallback changed to the SAME
bloXroute URL canary.py already hardcoded and already relies on working —
no new credential needed, just no longer silently defaulting to the most
heavily-shared public node when the real env var isn't set. Every real
call site updated to use this one function; canary.py's own hardcode
removed in favor of it, so a future real env var change takes effect
everywhere at once, not in 3 out of 4 places.
"""

import os

# Real, keyless bloXroute BSC gateway — already proven, in production use
# by core/canary.py before this fix, and the same fallback logic in
# adapters/bsc_balance.py's own default (see this module's own docstring
# for why the public bsc-dataseed default is worth moving away from).
_FALLBACK_RPC_URL = "https://bsc.rpc.blxrbdn.com"


def get_bsc_rpc_url() -> str:
    """The one, real, current BSC mainnet RPC URL every backend on-chain
    read should use. Real env override takes priority; falls back to a
    real, already-proven-working bloXroute gateway (see module docstring),
    not the public bsc-dataseed node."""
    return os.environ.get("BSC_MAINNET_RPC_URL") or _FALLBACK_RPC_URL
