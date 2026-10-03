"""The signing link: an order, carried in its own id, that only this server
could have written.

WHY THE LINK CARRIES THE ORDER
------------------------------
An order is prepared by one call (the MCP tools in mcp_server/tools.py) and
opened by a person in a browser minutes later, possibly on another device. A
stored order would need a database write per call on a public, unauthenticated
surface, and a table that grows with every caller. So the order travels in
the id instead, and the id is signed:

    id = base64url( payload || HMAC-SHA256(key, payload)[:12] ), no padding
    payload = compact JSON, sorted keys:
      v  1
      s  "b" buy | "s" sell
      c  chain id (one of buy_chains.BUY_CHAINS), or the string "solana"
      t  the tokenized stock's address, lower case; on Solana the mint, base58,
         case kept
      p  the pay token's address, lower case (what is paid on a buy, what is
         received on a sell); on Solana the USDC mint
      a  a buy: US dollars as a decimal string; a sell: the token amount as a
         decimal string
      w  the wallet the order is for, lower case; on Solana the base58 address
      e  unix expiry (prepared + 600 s)
      n  8 hex characters of nonce
      m  the largest slippage allowed, in basis points
      b  the order's measured cost without gas, a whole number of basis
         points (prepare.tolerance(), rounded half up at mint time). The
         value-check limit is limit_from_b(b) on the server and on the
         signing page alike, so both refuse the same routes.

Nothing in the link is secret, and nothing in it is an authority: whoever
opens it still signs every transaction in their own wallet, and the page
refuses a wallet other than `w`. The signature exists so that a link cannot be
edited into an order this server did not prepare (another token, a wider
slippage, a larger amount), and decode() checks every field again anyway.

THE KEY
-------
SIGN_LINK_SECRET if set. Otherwise it is derived from a secret the service
already holds (MONGODB_URI, then BATCH_TRIGGER_SECRET), so no new environment
variable is needed in production. Never from an identifier such as
RENDER_SERVICE_ID: that value is not secret, and a key derived from it could be
recomputed by anyone. With none of them set (a local run), the key is random
per process: links then stop verifying when the process restarts, and a link
minted by the command line below verifies only in a server that shares
SIGN_LINK_SECRET with it.

USED LINKS
----------
POST /api/sign/{id}/done marks a link used, in this process's memory only.
"Used" means a transaction hash was reported for the link, unverified; an
expired link is not marked. A restart forgets it, and a second process would
not know it; the ten-minute expiry is what bounds a link, and "used" only
stops the same page from offering the same order twice.

Transport free: no web framework here.

COMMAND LINE (local testing)
----------------------------
    python -m core.te.sign_link mint --side b --chain 8453 \\
        --token 0x... --pay USDC --amount 10 --wallet 0x... [--slippage 50] [--ttl 600]
    python -m core.te.sign_link decode <id>
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from .buy_chains import BUY_CHAINS, pay_token

VERSION = 1
TTL_SECONDS = 600
TAG_BYTES = 12
MAX_ID_CHARS = 512
DEFAULT_SLIPPAGE_BPS = 50
SLIPPAGE_MIN_BPS = 10
SLIPPAGE_MAX_BPS = 300
USD_MIN = Decimal("1")
USD_MAX = Decimal("10000")
SITE_DEFAULT = "https://www.tnega.app"

_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")
_NONCE = re.compile(r"^[0-9a-f]{8}$")
_AMOUNT = re.compile(r"^(0|[1-9]\d{0,17})(\.\d{1,18})?$")
_FIELDS = frozenset("vsctpawenmb")

# SOLANA. The same signed payload with c = "solana": the mint, the pay mint and
# the wallet are base58 and keep their case (a base58 address is case
# sensitive, so it is never lower-cased), the pay token is USDC only, and
# amounts, expiry, nonce, slippage and "b" mean what they mean on EVM. An EVM
# order is minted and verified exactly as before.
SOLANA = "solana"
USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
_PUBKEY = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_SYSTEM_PROGRAM = "1" * 32
B_MAX = 100_000

# The value-check limit, from the signed "b". One definition for every
# place that applies it (prepare's check before minting, the GET view, and
# the page, which reads "b" from the id and computes the same number).
LIMIT_FLOOR = 0.02
LIMIT_CAP = 0.05
LIMIT_TIMES_COST = 3
LIMIT_RULE = "min(5%, max(2%, 3 x b / 10000)), b the cost without gas in whole bps"


def limit_from_b(b: int) -> float:
    return min(LIMIT_CAP, max(LIMIT_FLOOR, LIMIT_TIMES_COST * int(b) / 10000))


def round_bps(bps: float) -> int:
    """Basis points as the whole number the link carries: half up."""
    return int(Decimal(str(bps)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _derive_key() -> tuple[bytes, str]:
    own = os.environ.get("SIGN_LINK_SECRET", "")
    if own:
        return hashlib.sha256(own.encode()).digest(), "SIGN_LINK_SECRET"
    for name in ("MONGODB_URI", "BATCH_TRIGGER_SECRET"):
        v = os.environ.get(name, "")
        if v:
            return hmac.new(b"tnega-sign-link-v1", v.encode(), hashlib.sha256).digest(), f"derived from {name}"
    return secrets.token_bytes(32), "random per process (links die on restart)"


_KEY: bytes | None = None
_KEY_SOURCE = ""
_KEY_LOCK = threading.Lock()


def _key() -> bytes:
    global _KEY, _KEY_SOURCE
    if _KEY is None:
        with _KEY_LOCK:
            if _KEY is None:
                _KEY, _KEY_SOURCE = _derive_key()
    return _KEY


def key_source() -> str:
    """Where the key came from, in words. Never the key or the secret."""
    _key()
    return _KEY_SOURCE


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _tag(payload: bytes) -> bytes:
    return hmac.new(_key(), payload, hashlib.sha256).digest()[:TAG_BYTES]


def amount_ok(side: str, a: str) -> str | None:
    """None if the amount string is well formed and in range, else why not."""
    if not isinstance(a, str) or not _AMOUNT.match(a):
        return "amount is not a plain decimal"
    try:
        d = Decimal(a)
    except InvalidOperation:
        return "amount is not a plain decimal"
    if d <= 0:
        return "amount must be above zero"
    if side == "b" and not (USD_MIN <= d <= USD_MAX):
        return f"a buy is between ${USD_MIN} and ${USD_MAX:,}"
    return None


def check_fields(p: dict) -> str | None:
    """None if the order is one this server could have prepared, else why not."""
    if not isinstance(p, dict) or set(p) != _FIELDS:
        return "fields"
    if p["v"] != VERSION:
        return "version"
    if p["s"] not in ("b", "s"):
        return "side"
    if p["c"] == SOLANA:
        from .solana_cost import is_pubkey
        for f in ("t", "w", "p"):
            if not isinstance(p[f], str) or not _PUBKEY.match(p[f]) or not is_pubkey(p[f]):
                return f"address {f}"
        if p["p"] != USDC_MINT_SOLANA:
            return "pay token"
        if p["w"] == _SYSTEM_PROGRAM or p["t"] == p["p"]:
            return "wallet"
    else:
        if not isinstance(p["c"], int) or isinstance(p["c"], bool) or p["c"] not in BUY_CHAINS:
            return "chain"
        for f in ("t", "w", "p"):
            if not isinstance(p[f], str) or not _ADDRESS.match(p[f]):
                return f"address {f}"
        if pay_token(p["c"], p["p"]) is None:
            return "pay token"
        if p["w"] == "0x" + "0" * 40:
            return "wallet"
    if amount_ok(p["s"], p["a"]):
        return "amount"
    if not isinstance(p["e"], int) or isinstance(p["e"], bool):
        return "expiry"
    if not isinstance(p["n"], str) or not _NONCE.match(p["n"]):
        return "nonce"
    if not isinstance(p["m"], int) or isinstance(p["m"], bool) or not SLIPPAGE_MIN_BPS <= p["m"] <= SLIPPAGE_MAX_BPS:
        return "slippage"
    if not isinstance(p["b"], int) or isinstance(p["b"], bool) or not 0 <= p["b"] <= B_MAX:
        return "cost"
    return None


def mint(*, side: str, chain_id: int | str, token: str, pay: str, amount: str, wallet: str, cost_ex_gas_bps: int,
         max_slippage_bps: int = DEFAULT_SLIPPAGE_BPS, ttl: int = TTL_SECONDS,
         now: float | None = None) -> tuple[str, dict]:
    """(id, payload). Raises ValueError on a field decode() would refuse, so a
    link is never minted that its own page would call invalid."""
    sol = chain_id == SOLANA
    p = {"v": VERSION, "s": side, "c": SOLANA if sol else int(chain_id),
         "t": str(token) if sol else str(token).lower(), "p": str(pay) if sol else str(pay).lower(),
         "a": str(amount), "w": str(wallet) if sol else str(wallet).lower(),
         "e": int((time.time() if now is None else now) + ttl),
         "n": secrets.token_hex(4), "m": int(max_slippage_bps), "b": cost_ex_gas_bps}
    bad = check_fields(p)
    if bad:
        raise ValueError(f"not a valid order: {bad}")
    raw = json.dumps(p, separators=(",", ":"), sort_keys=True).encode()
    return _b64(raw + _tag(raw)), p


@dataclass(frozen=True)
class Decoded:
    status: str                 # "ok" | "expired" | "invalid"
    payload: dict | None = None
    detail: str | None = None   # for "invalid": which check failed, in one word

    @property
    def seconds_left(self) -> int:
        return max(0, int(self.payload["e"] - time.time())) if self.payload else 0


def decode(link_id: str, now: float | None = None) -> Decoded:
    """Signature first, in constant time, then every field, then the clock."""
    if not isinstance(link_id, str) or not 20 < len(link_id) <= MAX_ID_CHARS or not re.fullmatch(r"[A-Za-z0-9_-]+", link_id):
        return Decoded("invalid", detail="format")
    try:
        raw = _unb64(link_id)
    except (binascii.Error, ValueError):
        return Decoded("invalid", detail="format")
    if len(raw) <= TAG_BYTES or _b64(raw) != link_id:
        # The second test refuses a non-canonical spelling: the last base64
        # character carries spare bits, and without it two ids could name
        # the same order.
        return Decoded("invalid", detail="format")
    body, tag = raw[:-TAG_BYTES], raw[-TAG_BYTES:]
    if not hmac.compare_digest(tag, _tag(body)):
        return Decoded("invalid", detail="signature")
    try:
        p = json.loads(body)
    except ValueError:
        return Decoded("invalid", detail="format")
    bad = check_fields(p)
    if bad:
        return Decoded("invalid", detail=bad)
    if (time.time() if now is None else now) >= p["e"]:
        return Decoded("expired", payload=p)
    return Decoded("ok", payload=p)


# ── used links, in memory ────────────────────────────────────────────────────

USED_MAX = 5000
_used: dict[str, int] = {}          # tag hex -> the link's expiry
_used_lock = threading.Lock()


def _used_key(link_id: str) -> str:
    return _unb64(link_id)[-TAG_BYTES:].hex()


def is_used(link_id: str) -> bool:
    with _used_lock:
        return _used_key(link_id) in _used


def mark_used(link_id: str, expiry: int) -> None:
    """Marks a link used: a transaction hash was reported for it (POST
    /done), unverified; nothing here reads the chain. Only a link that has
    not expired is marked (prepare.mark_done answers 410 otherwise), and an
    expired link answers "expired" whether or not it was used. Remembered
    until well past the link's own expiry, then forgotten. Bounded, so a
    flood of valid links cannot grow this without limit."""
    now = time.time()
    with _used_lock:
        for k in [k for k, e in _used.items() if e + 3600 < now]:
            del _used[k]
        while len(_used) >= USED_MAX:
            del _used[min(_used, key=_used.get)]
        _used[_used_key(link_id)] = int(expiry)


def site_base() -> str:
    """Where the signing page lives. SIGN_LINK_BASE_URL for a local frontend."""
    return (os.environ.get("SIGN_LINK_BASE_URL") or SITE_DEFAULT).rstrip("/")


def link(link_id: str) -> str:
    return f"{site_base()}/sign/{link_id}"


# ── command line ─────────────────────────────────────────────────────────────

def _cli(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="python -m core.te.sign_link",
                                 description="Mint or read a signing link id, for local testing.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mint")
    m.add_argument("--side", choices=("b", "s"), default="b")
    m.add_argument("--chain", type=int, required=True)
    m.add_argument("--token", required=True, help="the tokenized stock's address on that chain")
    m.add_argument("--pay", default="", help="pay token symbol (USDC) or address; default the chain's first")
    m.add_argument("--amount", required=True, help="USD for a buy, tokens for a sell")
    m.add_argument("--wallet", required=True)
    m.add_argument("--slippage", type=int, default=DEFAULT_SLIPPAGE_BPS, help="basis points")
    m.add_argument("--ttl", type=int, default=TTL_SECONDS, help="seconds; 1 gives a link that expires at once")
    m.add_argument("--b", type=int, default=None,
                   help="cost without gas, whole bps; default: from the cost store (TE_COST_STORE) at the order size")
    m.add_argument("--any-token", action="store_true", help="skip the check that the token is a listed version")
    d = sub.add_parser("decode")
    d.add_argument("id")
    a = ap.parse_args(argv)
    if a.cmd == "decode":
        r = decode(a.id)
        print(json.dumps({"status": r.status, "detail": r.detail, "payload": r.payload,
                          "seconds_left": r.seconds_left, "key": key_source()}, indent=2))
        return 0 if r.status == "ok" else 1
    from .buy_chains import default_pay, pay_by_symbol
    if a.chain not in BUY_CHAINS:
        ap.error(f"chain must be one of {sorted(BUY_CHAINS)}")
    pay = (pay_by_symbol(a.chain, a.pay) or pay_token(a.chain, a.pay)) if a.pay else default_pay(a.chain)
    if not pay:
        ap.error(f"pay must be one of {[t['symbol'] for t in BUY_CHAINS[a.chain]['pay']]} on chain {a.chain}")
    if not a.any_token:
        from .universe import load_universe
        rec = load_universe().record(f"{a.chain}/{a.token.lower()}", controls=False)
        if not rec or not rec.get("listed"):
            ap.error("no listed version at that address on that chain (pass --any-token to mint anyway)")
    b = a.b
    if b is None:
        b = _b_from_store(a.chain, a.token.lower(), a.side, a.amount)
        if b is None:
            ap.error("no measured cost for this version in the cost store; pass --b <whole bps>")
    link_id, p = mint(side=a.side, chain_id=a.chain, token=a.token, pay=pay["address"], amount=a.amount,
                      wallet=a.wallet, max_slippage_bps=a.slippage, ttl=a.ttl, cost_ex_gas_bps=b)
    print(link_id)
    print(link(link_id))
    print(f"key: {key_source()}; expires {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(p['e']))}")
    return 0


def _b_from_store(chain: int, token: str, side: str, amount: str) -> int | None:
    """For the command line: b as prepare would set it, from the cost store."""
    import asyncio
    from decimal import Decimal as D

    from .cost_store import get_store
    from .universe import load_universe
    rec = load_universe().record(f"{chain}/{token}", controls=False)
    if not rec:
        return None
    from . import prepare
    docs = asyncio.run(get_store().costs_for(rec["underlying"]))
    if side == "s":
        ref, _ = asyncio.run(prepare._sell_reference(rec["underlying"], rec["key"], rec["symbol"], D(amount)))
        return ref["tolerance"]["cost_ex_gas_bps"] if ref else None
    d = next((x for x in docs if x.get("key") == rec["key"]), None)
    t = prepare.tolerance(d, float(amount)) if d else None
    return t["cost_ex_gas_bps"] if t else None


if __name__ == "__main__":
    import sys
    raise SystemExit(_cli(sys.argv[1:]))
