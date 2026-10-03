"""
solana_cost.py

What buying (and selling) a tokenized stock on Solana costs, measured with
Jupiter's FREE public quote API, and the document it becomes in the cost
store. Read only: nothing here signs, sends or holds anything.

WHAT IS MEASURED, AND WHAT IS NOT
---------------------------------
A buy of USDC -> the version's mint at 1,000 and 10,000 dollars, quoted by
Jupiter (GET {JUPITER_API_URL}/quote, default https://lite-api.jup.ag/swap/v1).
No key, no paid service. Per size we keep what the answer says:

  outAmount          the tokens the best route pays out (raw units)
  priceImpactPct     Jupiter's own price impact of the route, read as a
                     FRACTION (0.0012 = 0.12%), as its documentation shows
                     in the example response; JUPITER_PRICE_IMPACT_UNIT=percent
                     switches the reading if a recorded answer shows otherwise
  routePlan          which venues the route crosses

and derive, in the same terms the EVM engine uses (cost.py):

  paid_per_token     size / tokens out
  mid_usd            paid_per_token / (1 + impact): the route's pre-trade price
  cost_usd, cost_bps size - tokens out x mid_usd: the price impact. Whether
                     Jupiter's figure already includes the venues' LP fees is
                     Jupiter's definition and is not checked here; the figure
                     that includes everything paid is allin_per_share
  allin_per_token    paid_per_token. No Solana network fee is added (a fraction
                     of a cent, plus about $0.30 of account rent on a first
                     purchase of a token): `gas_usd` is null and the basis says so
  allin_per_share    allin_per_token / shares_per_token, where shares_per_token
                     is the Token-2022 scaledUiAmountConfig multiplier in force
                     (xStocks), read from the mint; Ondo's is not read
  pool_usd           a DEPTH PROXY, not a pool read: dollars that would move the
                     price 2%, by linear extrapolation of the reported impact
                     (size x 2% / impact). Labelled as such wherever it shows

There is no LI.FI fee: the route is Jupiter's, called directly.

STATES (the EVM vocabulary where it applies; never a zero)
  filled      a route, a positive price impact, impact under MAX_IMPACT_BPS
  no_route    Jupiter found no route (COULD_NOT_FIND_ANY_ROUTE, TOKEN_NOT_TRADABLE)
  too_thin    a route exists but the order would move the price over
              MAX_IMPACT_BPS: no cost is served as a price at that size
  failed      the quote could not be used (reason says why); a price impact of
              exactly 0 or below is a failure to measure, not a free trade
  held        a multiplier change is within 15 minutes of the quote
  not_measured  a size the Solana pass does not quote (the engine's other nine)

THE HTTP CALL IS ONE SMALL FUNCTION. JupiterClient takes a `fetch` callable
(url, params, timeout) -> (status, body, retry_after), so a recorded answer can
be fed to everything below it (FixtureFetch). The default fetch is httpx.
Retries (429 with Retry-After, 5xx, timeouts), a minimum interval between
calls and a timeout are in the client.

The module runs in the cost worker's thread and, for one order, in a thread
off the web process's event loop (prepare.py). It does no other I/O except the
Solana RPC read of the multiplier (read_multipliers) and of a wallet's balance
(wallet_token_balance), both through an injectable `rpc` callable.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import threading
import time
from decimal import Decimal, InvalidOperation

import httpx

from .cost import SIZES
from .market_hours import us_market_open

log = logging.getLogger("te.cost")

USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
USDC_DECIMALS = 6
DEFAULT_BASE = "https://lite-api.jup.ag/swap/v1"
DEFAULT_RPC = "https://api.mainnet-beta.solana.com"
TIMEOUT_S = 8.0
RETRIES = 3
BACKOFF_S = (1.0, 2.0, 4.0)
RETRY_AFTER_CAP_S = 10.0
MIN_INTERVAL_S = 1.1            # the free endpoint's published limit is about 60 requests a minute
MEASURED_SIZES = (1000, 10000)
MAX_IMPACT_BPS = 1000           # over 10% price impact: no cost is served as a price at that size
DEPTH_TARGET = 0.02
HOLD_WINDOW_S = 15 * 60
METHOD_ID = "jupiter-quote-v1"
CHAIN_NAME = "Solana"

METHOD = (
    "Measured with Jupiter's free public quote API (USDC to the token, exact in): the tokens the best route pays "
    "out and the price impact Jupiter reports for it. paid_per_token is the size over the tokens out; mid is "
    "that price before the impact; cost is the size less the tokens out at that mid. Solana network fees and "
    "account rent are not included, and there is no LI.FI fee. pool_usd is a depth proxy extrapolated from the "
    "reported impact, not a pool read. shares_per_token is the Token-2022 scaledUiAmountConfig multiplier read "
    "from the mint where the issuer uses one (xStocks); Ondo's is not read. Stablecoins are taken at $1, an "
    "assumption."
)
COST_BASIS = ("the price impact Jupiter reports for the route at this size (priceImpactPct), against the route's own "
              "pre-trade price; whether it includes the venues' LP fees is Jupiter's definition. allin_per_share "
              "is the figure that includes everything paid")
GAS_BASIS = "Solana network fee and account rent are not included (a few cents at most)"
DEPTH_BASIS = ("a proxy, not a pool read: dollars that would move the price 2%, extrapolated linearly from "
               "Jupiter's reported price impact at this size")

NO_ROUTE_CODES = {"COULD_NOT_FIND_ANY_ROUTE", "TOKEN_NOT_TRADABLE", "NO_ROUTES_FOUND"}
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


# ── small helpers ────────────────────────────────────────────────────────────

def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def base_url() -> str:
    return (os.environ.get("JUPITER_API_URL") or DEFAULT_BASE).strip().rstrip("/")


def quote_url() -> str:
    b = base_url()
    return b if b.endswith("/quote") else b + "/quote"


def rpc_url() -> str:
    return (os.environ.get("TE_SOLANA_RPC") or DEFAULT_RPC).strip()


def b58_decode(s: str) -> bytes | None:
    """The bytes a base58 string names, or None if it has a character outside the alphabet."""
    n = 0
    for c in s:
        i = _B58.find(c)
        if i < 0:
            return None
        n = n * 58 + i
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


def is_pubkey(s) -> bool:
    """A Solana address: base58 of exactly 32 bytes."""
    if not isinstance(s, str) or not 32 <= len(s) <= 44:
        return False
    b = b58_decode(s)
    return b is not None and len(b) == 32


def _impact_fraction(raw) -> Decimal | None:
    try:
        d = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError):
        return None
    if not d.is_finite():
        return None
    if os.environ.get("JUPITER_PRICE_IMPACT_UNIT", "fraction").lower() == "percent":
        d = d / 100
    return d


# ── the HTTP call, and a recorded stand-in for it ────────────────────────────

def http_fetch(url: str, params: dict, timeout: float) -> tuple[int, object, float | None]:
    """(status, parsed JSON or None, Retry-After seconds or None). Raises
    httpx errors for a timeout or a network failure; the client classifies them."""
    r = httpx.get(url, params=params, timeout=timeout, headers={"accept": "application/json"})
    try:
        body = r.json()
    except ValueError:
        body = None
    ra = r.headers.get("retry-after")
    try:
        ra_s = float(ra) if ra is not None else None
    except ValueError:
        ra_s = None
    return r.status_code, body, ra_s


class FixtureFetch:
    """A `fetch` that answers from recorded (or constructed) responses, keyed
    "<inputMint>><outputMint>:<amount>" -> {"status": 200, "body": {...}}.
    A key with no entry answers as Jupiter does for no route. `calls` keeps
    every request. Nothing here reaches the network."""

    def __init__(self, responses: dict | None = None, default=None):
        self.responses = dict(responses or {})
        self.default = default
        self.calls: list[dict] = []

    @staticmethod
    def key(params: dict) -> str:
        return f"{params['inputMint']}>{params['outputMint']}:{params['amount']}"

    def __call__(self, url: str, params: dict, timeout: float):
        self.calls.append({"url": url, **params})
        r = self.responses.get(self.key(params), self.default)
        if callable(r):
            r = r(params)
        if r is None:
            return 400, {"error": "Could not find any route", "errorCode": "COULD_NOT_FIND_ANY_ROUTE"}, None
        if isinstance(r, Exception):
            raise r
        return r.get("status", 200), r.get("body"), r.get("retry_after")


class JupiterClient:
    """One quote at a time, spaced, retried, bounded. Thread safe."""

    def __init__(self, *, fetch=None, sleep=time.sleep, clock=time.monotonic, url: str | None = None,
                 min_interval: float | None = None, retries: int | None = None, timeout: float | None = None):
        self.fetch = fetch or http_fetch
        self.sleep, self.clock = sleep, clock
        self.url = url
        self.min_interval = float(os.environ.get("JUPITER_MIN_INTERVAL_S", MIN_INTERVAL_S)) if min_interval is None else min_interval
        self.retries = RETRIES if retries is None else retries
        self.timeout = TIMEOUT_S if timeout is None else timeout
        self._lock = threading.Lock()
        self._last = -1e9
        self.stats = {"calls": 0, "retries": 0, "rate_limited": 0, "no_route": 0, "failed": 0}

    def _space(self) -> None:
        with self._lock:
            wait = self._last + self.min_interval - self.clock()
            if wait > 0:
                self.sleep(wait)
            self._last = self.clock()

    def quote(self, input_mint: str, output_mint: str, amount_raw: int, *, slippage_bps: int = 50,
              deadline: float | None = None) -> dict:
        """{"ok": True, "quote": <Jupiter's body>, "quoted_at": iso} or
        {"ok": False, "kind": no_route | rate_limited | unavailable | refused | bad_response, "reason": str}.
        `deadline` is a clock() value past which no further attempt is made."""
        params = {"inputMint": input_mint, "outputMint": output_mint, "amount": str(int(amount_raw)),
                  "slippageBps": str(int(slippage_bps)), "swapMode": "ExactIn", "restrictIntermediateTokens": "true"}
        url = self.url or quote_url()
        last = "no attempt was made"
        kind = "unavailable"
        for attempt in range(self.retries + 1):
            if deadline is not None and self.clock() >= deadline:
                return {"ok": False, "kind": "unavailable", "reason": "ran out of time before Jupiter answered: " + last}
            self._space()
            self.stats["calls"] += 1
            try:
                status, body, retry_after = self.fetch(url, params, self.timeout)
            except httpx.TimeoutException:
                last, kind, retry_after = f"Jupiter did not answer within {self.timeout:g}s", "unavailable", None
            except httpx.HTTPError as e:
                last, kind, retry_after = f"Jupiter could not be reached ({type(e).__name__})", "unavailable", None
            else:
                if status == 200:
                    why = validate_quote(body, params)
                    if why:
                        self.stats["failed"] += 1
                        return {"ok": False, "kind": "bad_response", "reason": "Jupiter's answer was not usable: " + why}
                    return {"ok": True, "quote": body, "quoted_at": _iso(time.time())}
                code = body.get("errorCode") if isinstance(body, dict) else None
                msg = str(body.get("error") or "")[:120] if isinstance(body, dict) else ""
                if status in (400, 404) and (code in NO_ROUTE_CODES or "route" in msg.lower() or "tradable" in msg.lower()):
                    self.stats["no_route"] += 1
                    return {"ok": False, "kind": "no_route",
                            "reason": f"Jupiter found no route ({code or msg or 'HTTP ' + str(status)})"}
                if status == 429:
                    self.stats["rate_limited"] += 1
                    last, kind = "Jupiter's free endpoint rate limited this request (HTTP 429)", "rate_limited"
                elif status >= 500:
                    last, kind = f"Jupiter answered HTTP {status}", "unavailable"
                else:
                    self.stats["failed"] += 1
                    return {"ok": False, "kind": "refused",
                            "reason": f"Jupiter refused the request (HTTP {status}{': ' + msg if msg else ''})"}
            if attempt < self.retries:
                self.stats["retries"] += 1
                pause = min(retry_after, RETRY_AFTER_CAP_S) if retry_after else BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)]
                self.sleep(pause)
        self.stats["failed"] += 1
        return {"ok": False, "kind": kind, "reason": last + f" (after {self.retries + 1} attempts)"}


_client: JupiterClient | None = None
_client_lock = threading.Lock()


def default_client() -> JupiterClient:
    global _client
    with _client_lock:
        if _client is None:
            _client = JupiterClient()
        return _client


def set_client(c: JupiterClient | None) -> None:
    """For tests: replace (or, with None, reset) the process's client."""
    global _client
    with _client_lock:
        _client = c


def validate_quote(body, params: dict) -> str | None:
    """None if Jupiter's answer matches the question and carries what the
    measurement needs, else why not (the same discipline as lifi_quote)."""
    if not isinstance(body, dict):
        return "not a JSON object"
    for k in ("inputMint", "outputMint", "inAmount", "outAmount", "priceImpactPct"):
        if body.get(k) is None:
            return f"no {k}"
    if body["inputMint"] != params["inputMint"] or body["outputMint"] != params["outputMint"]:
        return "it quotes other mints than asked"
    if str(body["inAmount"]) != params["amount"]:
        return "it quotes another amount than asked"
    if body.get("swapMode", "ExactIn") != "ExactIn":
        return "it is not an exact-in quote"
    if not str(body["outAmount"]).isdigit() or int(body["outAmount"]) <= 0:
        return "outAmount is not a positive integer"
    if _impact_fraction(body["priceImpactPct"]) is None:
        return "priceImpactPct is not a number"
    return None


def route_labels(body: dict) -> list[str]:
    seen: list[str] = []
    for leg in body.get("routePlan") or []:
        lab = ((leg or {}).get("swapInfo") or {}).get("label")
        if lab and lab not in seen:
            seen.append(str(lab)[:40])
    return seen[:6]


# ── one quote, in the engine's terms ─────────────────────────────────────────

def measure_buy(body: dict, usd: float, decimals: int) -> dict:
    """The quote of a buy of `usd` dollars of USDC, as figures; or a verdict
    {"status": "too_thin" | "failed", "reason"} when it must not be served."""
    i = _impact_fraction(body["priceImpactPct"])
    out_raw = int(body["outAmount"])
    tokens = out_raw / 10 ** decimals
    labels, hops = route_labels(body), len(body.get("routePlan") or [])
    if i is None or i <= 0:
        return {"status": "failed", "reason": (
            "Jupiter reported a price impact of " + (str(body.get("priceImpactPct")) if i is not None else "nothing readable")
            + ", which is not a measurement of a trade of this size (it is not served as a free one)"),
            "out_raw": out_raw, "route": labels}
    imp = float(i)
    depth = usd * DEPTH_TARGET / imp
    row = {"out_raw": out_raw, "tokens": tokens, "paid_per_token": usd / tokens, "impact": imp,
           "impact_bps": imp * 1e4, "route": labels, "hops": hops, "depth_proxy_usd": depth,
           "min_out_raw": int(body["otherAmountThreshold"]) if str(body.get("otherAmountThreshold", "")).isdigit() else None,
           "slot": body.get("contextSlot")}
    row["mid_usd"] = row["paid_per_token"] / (1 + imp)
    row["cost_usd"] = usd - tokens * row["mid_usd"]
    row["cost_bps"] = row["cost_usd"] / usd * 1e4
    if imp * 1e4 > MAX_IMPACT_BPS:
        return {**row, "status": "too_thin", "reason": (
            f"a ${usd:,.0f} buy would move the price {imp * 100:.1f}% by Jupiter's reckoning, over the "
            f"{MAX_IMPACT_BPS / 100:.0f}% limit; no cost is served as a price at this size")}
    return {**row, "status": "filled"}


def measure_sell(body: dict, tokens: float, decimals: int) -> dict:
    """The quote of a sale of `tokens` tokens for USDC, as figures, or a verdict."""
    i = _impact_fraction(body["priceImpactPct"])
    out_usd = int(body["outAmount"]) / 10 ** USDC_DECIMALS
    labels = route_labels(body)
    if i is None or i <= 0 or i >= 1:
        return {"status": "failed", "reason": (
            "Jupiter reported a price impact of " + (str(body.get("priceImpactPct")) if i is not None else "nothing readable")
            + ", which is not a measurement of a sale of this size"), "route": labels}
    imp = float(i)
    price = out_usd / tokens
    mid = price / (1 - imp)
    row = {"out_usd": out_usd, "out_raw": int(body["outAmount"]), "price_usd": price, "mid_usd": mid, "impact": imp,
           "impact_bps": imp * 1e4, "cost_usd": tokens * mid - out_usd, "route": labels,
           "min_out_raw": int(body["otherAmountThreshold"]) if str(body.get("otherAmountThreshold", "")).isdigit() else None,
           "slot": body.get("contextSlot")}
    row["cost_bps"] = imp * 1e4
    if imp * 1e4 > MAX_IMPACT_BPS:
        return {**row, "status": "too_thin", "reason": (
            f"this sale would move the price {imp * 100:.1f}% by Jupiter's reckoning, over the "
            f"{MAX_IMPACT_BPS / 100:.0f}% limit")}
    return {**row, "status": "filled"}


def quote_buy(client: JupiterClient, mint: str, decimals: int, usd: float, *, slippage_bps: int = 50,
              deadline: float | None = None) -> dict:
    """One buy measured: {"kind": "filled" | "too_thin" | "failed" | "no_route" | "unavailable", ...}."""
    r = client.quote(USDC_MINT, mint, int(round(usd * 10 ** USDC_DECIMALS)), slippage_bps=slippage_bps, deadline=deadline)
    if not r["ok"]:
        return {"kind": "no_route" if r["kind"] == "no_route" else
                ("failed" if r["kind"] in ("refused", "bad_response") else "unavailable"),
                "reason": r["reason"], "transient": r["kind"] in ("rate_limited", "unavailable")}
    m = measure_buy(r["quote"], usd, decimals)
    return {**m, "kind": m["status"], "quoted_at": r["quoted_at"], "transient": False}


def quote_sell(client: JupiterClient, mint: str, decimals: int, tokens: Decimal, *, slippage_bps: int = 50,
               deadline: float | None = None) -> dict:
    scaled = tokens.scaleb(decimals)
    if scaled != scaled.to_integral_value():
        return {"kind": "failed", "reason": f"the token has {decimals} decimals; the amount has more places", "transient": False}
    r = client.quote(mint, USDC_MINT, int(scaled), slippage_bps=slippage_bps, deadline=deadline)
    if not r["ok"]:
        return {"kind": "no_route" if r["kind"] == "no_route" else
                ("failed" if r["kind"] in ("refused", "bad_response") else "unavailable"),
                "reason": r["reason"], "transient": r["kind"] in ("rate_limited", "unavailable")}
    m = measure_sell(r["quote"], float(tokens), decimals)
    return {**m, "kind": m["status"], "quoted_at": r["quoted_at"], "transient": False}


# ── the shares per token: the Token-2022 scaled UI amount multiplier ─────────

def rpc_call(method: str, params: list, timeout: float = TIMEOUT_S):
    r = httpx.post(rpc_url(), json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=timeout)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(str(j["error"].get("code")))
    return j["result"]


def effective_multiplier(cfg: dict, now: float) -> float:
    """The scaledUiAmountConfig multiplier in force at `now`: newMultiplier once
    its effective timestamp has passed (scripts/te_xstocks_reads.py reads it the same way)."""
    new_at = cfg.get("newMultiplierEffectiveTimestamp")
    return float(cfg["newMultiplier"]) if new_at is not None and now >= float(new_at) else float(cfg["multiplier"])


def read_multipliers(mints_by_issuer: dict[str, str], rpc=rpc_call, now: float | None = None,
                     chunk: int = 100) -> dict[str, dict]:
    """mint -> {ratio, basis, comparable, hold, hold_reason, slot, change_at}.
    xStocks mints are read in batches (getMultipleAccounts, jsonParsed); Ondo's
    share ratio is not read, as on the EVM side."""
    now = time.time() if now is None else now
    out: dict[str, dict] = {}
    xs = [m for m, iss in mints_by_issuer.items() if iss == "xstocks"]
    for m, iss in mints_by_issuer.items():
        if iss != "xstocks":
            out[m] = {"ratio": None, "basis": "share ratio not read", "comparable": False, "hold": False,
                      "hold_reason": None, "slot": None, "change_at": None}
    for i in range(0, len(xs), chunk):
        part = xs[i:i + chunk]
        try:
            res = rpc("getMultipleAccounts", [part, {"encoding": "jsonParsed", "commitment": "finalized"}])
            slot, values = (res.get("context") or {}).get("slot"), res.get("value") or []
        except Exception as e:  # noqa: BLE001  the endpoint, not the mints
            why = f"the Solana RPC read of the multiplier failed ({type(e).__name__}): share ratio not read"
            for m in part:
                out[m] = {"ratio": None, "basis": why, "comparable": False, "hold": False, "hold_reason": None,
                          "slot": None, "change_at": None}
            continue
        for m, acc in zip(part, values + [None] * (len(part) - len(values))):
            o = {"ratio": None, "basis": "share ratio not read", "comparable": False, "hold": False,
                 "hold_reason": None, "slot": slot, "change_at": None}
            try:
                info = ((acc or {}).get("data") or {}).get("parsed", {}).get("info") or {}
                ext = {e["extension"]: e.get("state") for e in info.get("extensions") or []}
                cfg = ext.get("scaledUiAmountConfig")
                if cfg is None:
                    o["basis"] = ("the mint account was not returned" if not acc else
                                  "the mint has no scaledUiAmountConfig extension: share ratio not read")
                else:
                    r = effective_multiplier(cfg, now)
                    o.update(ratio=r, comparable=r > 0,
                             basis=(f"Token-2022 scaledUiAmountConfig multiplier in force, read from the mint at slot "
                                    f"{slot}: shares = raw amount x multiplier / 10^decimals"),
                             change_at=int(cfg["newMultiplierEffectiveTimestamp"]) if cfg.get("newMultiplierEffectiveTimestamp") else None)
                    if o["change_at"] and abs(now - o["change_at"]) < HOLD_WINDOW_S:
                        o.update(hold=True, hold_reason=(
                            f"a multiplier change takes effect at {_iso(o['change_at'])}, within 15 minutes of this "
                            f"quote: no quote (SPEC B.3)"))
            except (KeyError, TypeError, ValueError):
                o["basis"] = "the scaledUiAmountConfig could not be read: share ratio not read"
            out[m] = o
    return out


def wallet_token_balance(wallet: str, mint: str, rpc=rpc_call) -> dict:
    """{"read": True, "balance_raw": int, "slot": int} or {"read": False, "reason": str}.
    The sum over the wallet's token accounts for the mint (either token program)."""
    try:
        r = rpc("getTokenAccountsByOwner", [wallet, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}])
        raw = sum(int(v["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for v in r.get("value") or [])
        return {"read": True, "balance_raw": raw, "slot": (r.get("context") or {}).get("slot")}
    except Exception as e:  # noqa: BLE001  the endpoint, not the wallet
        return {"read": False, "reason": f"the Solana RPC could not be read ({type(e).__name__})"}


# ── the stored document, in the shape the EVM documents have ─────────────────

def _blank() -> dict:
    return {k: [None] * len(SIZES) for k in (
        "cost_bps", "cost_usd", "pool_cost_usd", "gas_usd", "tokens_out_raw", "paid_per_token", "allin_per_token",
        "allin_per_share", "tokens_per_1000", "mid_usd", "mid_gap_bps", "filled_fraction", "filled_usd", "pool",
        "price_impact_bps", "depth_proxy_usd", "route")}


def _base(rec: dict, now: float, ratio: dict | None, slot) -> dict:
    open_, open_basis = us_market_open(dt.datetime.fromtimestamp(now, dt.timezone.utc))
    return {
        "_id": rec["key"], "key": rec["key"], "underlying": rec["underlying"], "chain_id": None, "chain": CHAIN_NAME,
        "group": "nonevm", "symbol": rec["symbol"], "issuer": rec["issuer"], "venue": "jupiter",
        "block": slot, "block_unit": "slot", "computed_at": _iso(now), "us_market_open": open_,
        "us_market_basis": open_basis, "controls": rec.get("controls"), "controls_block": rec.get("controls_block"),
        "block_time": None,
        "share_ratio": (ratio or {}).get("ratio"), "share_ratio_basis": (ratio or {}).get("basis"),
        "comparable": bool((ratio or {}).get("comparable")),
        "method_id": METHOD_ID, "sizes": SIZES,
        "pool_search": {"venue": "Jupiter quote API", "note": "routes across Solana venues are Jupiter's choice; "
                                                              "no pool is searched or simulated by Tnega"},
    }


def version_doc(rec: dict, results: dict[int, dict], ratio: dict | None, now: float) -> dict:
    """The document for one Solana version. results: size -> a quote_buy
    verdict for each size asked; sizes not in it are not measured."""
    slot = next((r.get("slot") for r in (results.get(s) for s in MEASURED_SIZES) if r and r.get("slot")), None)
    base = _base(rec, now, ratio, slot)
    if (ratio or {}).get("hold"):
        return {**base, "state": "held", "reason": ratio["hold_reason"]}
    first = results.get(MEASURED_SIZES[0]) or {}
    k1 = first.get("kind")
    if k1 == "no_route":
        return {**base, "state": "no_route", "reason": first["reason"] + "; asked at $1,000 and, with no route there, not at $10,000"}
    if k1 == "too_thin":
        return {**base, "state": "too_thin", "reason": first["reason"], "pool_usd": round(first.get("depth_proxy_usd") or 0, 2) or None,
                "pool_usd_basis": DEPTH_BASIS}
    per = _blank()
    status = ["not_measured"] * len(SIZES)
    why: list = [None] * len(SIZES)
    for s, r in results.items():
        i = SIZES.index(s)
        k = r["kind"]
        if k == "filled":
            allin = r["paid_per_token"]
            sh = (ratio or {}).get("ratio")
            per["cost_bps"][i] = round(r["cost_bps"], 2)
            per["cost_usd"][i] = round(r["cost_usd"], 4)
            per["pool_cost_usd"][i] = round(r["cost_usd"], 4)
            per["tokens_out_raw"][i] = str(r["out_raw"])
            per["paid_per_token"][i] = round(allin, 6)
            per["allin_per_token"][i] = round(allin, 6)
            per["allin_per_share"][i] = round(allin / sh, 6) if sh else None
            per["tokens_per_1000"][i] = round(1000 / allin, 8)
            per["mid_usd"][i] = round(r["mid_usd"], 6)
            per["filled_fraction"][i] = 1.0
            per["filled_usd"][i] = float(s)
            per["price_impact_bps"][i] = round(r["impact_bps"], 2)
            per["depth_proxy_usd"][i] = round(r["depth_proxy_usd"], 2)
            per["route"][i] = r["route"]
            status[i] = "filled"
        elif k in ("too_thin", "no_route"):
            status[i] = k
            why[i] = r["reason"]
            per["depth_proxy_usd"][i] = round(r["depth_proxy_usd"], 2) if r.get("depth_proxy_usd") else None
        else:
            status[i] = "failed"
            why[i] = r["reason"]
    filled = [i for i, st in enumerate(status) if st == "filled"]
    state = "measured" if filled else "failed"
    depth_i = next((i for i in (SIZES.index(10000), SIZES.index(1000)) if i in filled), None)
    doc = {**base, **per, "status": status, "reason_by_size": why, "state": state,
           "pool_usd": per["depth_proxy_usd"][depth_i] if depth_i is not None else None,
           "pool_usd_basis": DEPTH_BASIS, "cost_basis": COST_BASIS, "gas_basis": GAS_BASIS}
    if filled:
        doc["ref_mid_usd"] = None          # no reference mid: a depth proxy must never set the cross-chain reference
    else:
        doc["reason"] = next((w for w in why if w), "every quote failed")
    return doc


def cell(d: dict, size: int, base: dict) -> dict:
    """One Solana version at one size, in cost_views._cell's terms."""
    i = SIZES.index(size)
    st = d["status"][i]
    if st == "filled":
        labels = d["route"][i] or []
        return {**base, "state": "filled", "cost_bps": d["cost_bps"][i], "cost_usd": d["cost_usd"][i],
                "paid_per_token": d["paid_per_token"][i], "filled_fraction": 1.0,
                "allin_per_token": d["allin_per_token"][i], "allin_per_share": d["allin_per_share"][i],
                "tokens_per_1000": d["tokens_per_1000"][i], "pool_usd": d["depth_proxy_usd"][i],
                "pool_usd_basis": DEPTH_BASIS,
                "cost_parts": {"pool_usd": d["cost_usd"][i], "gas_usd": None, "l1_fee_usd": None, "lifi_fee_usd": 0.0,
                               "gas_basis": GAS_BASIS, "price_impact_bps": d["price_impact_bps"][i]},
                "mid_usd": d["mid_usd"][i], "mid_gap_bps": None, "cost_basis": COST_BASIS,
                "pool": {"family": "Jupiter route" + (": " + ", ".join(labels) if labels else ""), "address": None,
                         "other_side": USDC_MINT},
                "reason": None}
    reason = (d.get("reason_by_size") or [None] * len(SIZES))[i]
    if st == "not_measured":
        return {**base, "state": "not_measured", "cost_bps": None, "cost_usd": None, "paid_per_token": None,
                "filled_fraction": None, "pool_usd": None,
                "reason": f"Solana versions are quoted at $1,000 and $10,000 only, not at ${size:,}"}
    if st in ("too_thin", "no_route"):
        return {**base, "state": st, "cost_bps": None, "cost_usd": None, "paid_per_token": None,
                "filled_fraction": None, "pool_usd": (d.get("depth_proxy_usd") or [None] * len(SIZES))[i], "reason": reason}
    return {**base, "state": "failed", "cost_bps": None, "cost_usd": None, "paid_per_token": None,
            "filled_fraction": None, "pool_usd": None, "reason": reason or "the Jupiter quote failed at this size"}


# ── one pass over a set of versions (the worker's step) ──────────────────────

def measure_version(client: JupiterClient, rec: dict, ratio: dict | None, now: float,
                    deadline: float | None = None) -> tuple[dict | None, dict]:
    """(document or None, note). None when the failure is transient (rate
    limit, timeout, outage): the caller keeps the version's previous document
    rather than replace a measurement with a fact about this call."""
    if (ratio or {}).get("hold"):
        return version_doc(rec, {}, ratio, now), {"outcome": "held"}
    results: dict[int, dict] = {}
    for s in MEASURED_SIZES:
        r = quote_buy(client, rec["address"], rec["decimals"], float(s), deadline=deadline)
        if r["kind"] == "unavailable" or r.get("transient"):
            return None, {"outcome": "transient", "reason": r["reason"]}
        results[s] = r
        if r["kind"] in ("no_route", "too_thin"):
            break                      # a bigger size cannot do better than a smaller one that did not fill
    doc = version_doc(rec, results, ratio, now)
    return doc, {"outcome": doc["state"]}
