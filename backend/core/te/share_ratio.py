"""
share_ratio.py

How many shares of the underlying one token is, per issuer, read at the
quote block, and whether a multiplier change is close enough to hold the
quote back (SPEC B.3: no quote within 15 minutes of a multiplier change).

Evidence, from the verified sources the universe pass saved:
- xStocks EVM (BackedAutoFeeTokenImplementation): balanceOf returns the
  underlying amount (shares x multiplier), so the unit a pool trades is one
  share: ratio 1. The change time is newMultiplierActivationTime(), public,
  past or future.
- Robinhood and bStocks (EIP-8056): balanceOf is raw; the share-equivalent
  (UI) amount is raw x uiMultiplier / 1e18, so a token is uiMultiplier/1e18
  shares. effectiveAt() differs between the two implementations:
    Robinhood (ERC20ScaledUI) returns the stored effective time, past or
    future, so both sides of a change are readable;
    bStocks (ERC8056BaseUpgradeable) returns it only while the change is
    pending (block.timestamp < effectiveAt) and 0 once it has passed.
  So the 15 minutes after a bStocks change are covered by noting when a
  refresh first sees uiMultiplier differ from the previous one, which is
  done for Robinhood too.
- Coinbase (B20 precompile): multiplier() is readable and taken as the ratio,
  labelled "issuer-set, source not shown": no source defines it. No change
  time is readable, so a change is held from when a refresh first sees the
  raw value differ from the previous one.
- Ondo: no ratio is read. Its versions are shown but not ranked on price
  against other issuers.
"""

from __future__ import annotations

import time

from eth_utils import function_signature_to_4byte_selector as _sel

from .multicall import aggregate3
from .rpcclient import ChainRpc

WINDOW_SECONDS = 15 * 60
_UI = _sel("uiMultiplier()")
_EFF = _sel("effectiveAt()")
_XS_ACT = _sel("newMultiplierActivationTime()")
_MULT = _sel("multiplier()")

BASIS = {
    "xstocks": "1 token = 1 share: balanceOf returns the underlying amount (verified source)",
    "robinhood": "uiMultiplier() / 1e18 shares per token (EIP-8056, verified source)",
    "bstocks": "uiMultiplier() / 1e18 shares per token (EIP-8056, verified source)",
    "coinbase": "multiplier() / 1e18 shares per token: issuer-set, source not shown",
    "ondo": "share ratio not read",
}


def _w(b: bytes | None) -> int | None:
    return int.from_bytes(b[:32], "big") if b and len(b) >= 32 else None


def read(rpc: ChainRpc, recs: list[dict], block: int, block_time: int, previous: dict | None) -> dict:
    """key -> {ratio, basis, comparable, change_at, hold, hold_reason}.
    `previous` is the last run's result (for changes seen, not announced)."""
    previous = previous or {}
    calls, idx = [], []
    for r in recs:
        iss, a = r["issuer"], r["address"]
        if iss in ("robinhood", "bstocks"):
            calls += [(a, _UI), (a, _EFF)]; idx += [(r["key"], "ui"), (r["key"], "eff")]
        elif iss == "xstocks":
            calls.append((a, _XS_ACT)); idx.append((r["key"], "act"))
        elif iss == "coinbase":
            calls.append((a, _MULT)); idx.append((r["key"], "mult"))
    got: dict = {}
    for (k, what), res in zip(idx, aggregate3(rpc, calls, block) if calls else []):
        got.setdefault(k, {})[what] = _w(res)
    out = {}
    for r in recs:
        k, iss, g = r["key"], r["issuer"], got.get(r["key"], {})
        o = {"ratio": None, "basis": BASIS.get(iss, "share ratio not read"), "comparable": False,
             "change_at": None, "hold": False, "hold_reason": None}
        if iss == "xstocks":
            o.update(ratio=1.0, comparable=True, change_at=g.get("act") or None)
        elif iss in ("robinhood", "bstocks"):
            ui = g.get("ui")
            if ui:
                o.update(ratio=ui / 1e18, comparable=True, ui_raw=str(ui), change_at=g.get("eff") or None)
                prev = previous.get(k) or {}
                if prev.get("ui_raw") and prev["ui_raw"] != str(ui):
                    o["change_seen_at"] = block_time          # changed since the last refresh
                elif prev.get("change_seen_at"):
                    o["change_seen_at"] = prev["change_seen_at"]
            else:
                o["basis"] = "uiMultiplier() did not answer: share ratio not read"
        elif iss == "coinbase":
            m = g.get("mult")
            if m:
                o.update(ratio=m / 1e18, comparable=True, ui_raw=str(m))
                prev = previous.get(k) or {}
                if prev.get("ui_raw") and prev["ui_raw"] != str(m):
                    o["change_seen_at"] = block_time
                elif prev.get("change_seen_at"):
                    o["change_seen_at"] = prev["change_seen_at"]
            else:
                o["basis"] = "multiplier() did not answer: share ratio not read"
        for t, what in ((o.get("change_at"), "a multiplier change takes effect"),
                        (o.get("change_seen_at"), "a multiplier change was first seen")):
            if t and abs(block_time - t) < WINDOW_SECONDS:
                o.update(hold=True, hold_reason=f"{what} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))}, "
                                                f"within 15 minutes of this block: no quote (SPEC B.3)")
        out[k] = o
    return out
