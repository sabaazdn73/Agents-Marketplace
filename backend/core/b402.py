"""
b402.py

Real Binance B402 integration — the x402 payment standard, settled
natively on BSC. Built 2026-09-04 against the real, official integration
guide (web3.binance.com/en/dev-docs/products/b402-api/integration-guide)
and verified live against the real API with real credentials before any
of it was wired into a route.

Why this matters for this project specifically, stated plainly because
it's the whole reason this stopped being research and became code: every
settlement rail researched in docs/future-tnega-paybox.md died on the
same rock — MetaMask Card can't fund from BSC (and paused US signups),
Gnosis Pay doesn't support BSC, and MoonPay works but only as a
bank-payout off-ramp, not an agent-payable rail. B402 settles ON BSC.
There is no bridge hop, no chain gap, and no external company's approval
queue in the middle. Confirmed live, not assumed: every one of the 10
payment kinds the real /supported endpoint returns for this account is
on `eip155:56`.

The second, better-than-expected real finding: one of the four real
assets B402 supports here is "United Stables" ($U,
0xcE24439F2D9C6a2289F741120FE202248B666666) — which is ERC-8183's OWN
settlement token, the exact token this marketplace's hire/escrow flow
already denominates jobs in (see docs/smart-contracts.md). So a B402
payment and a Tnega escrow hire can settle in the same asset, on the
same chain, with no conversion between them. That alignment wasn't
designed for; it was found by reading the real /supported response.

Real security boundary, non-negotiable: OC_API_KEY/OC_SECRET_KEY are
backend-only. The secret key signs every request and must never reach a
browser, a frontend bundle, or source control (.env is gitignored and
untracked — verified). Nothing in this module is safe to port
client-side, and no route should ever echo either credential back.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

import httpx

B402_HOST = "https://web3.binance.com"

SUPPORTED_PATH = "/build/api/v2/b402/supported"
VERIFY_PATH = "/build/api/v2/b402/verify"
SETTLE_PATH = "/build/api/v2/b402/settle"

# The real success code in B402's own response envelope. Anything else is
# a real failure, including on an HTTP 200 — the envelope's `code`, not
# the HTTP status, is the authoritative signal (confirmed live: a
# malformed request still returns a 200-shaped envelope in some cases).
SUCCESS_CODE = "000000000"

# Real, documented error code for an account that hasn't finished B402
# onboarding. Surfaced by name because it's the one failure that means
# "your account isn't ready yet", not "your code is wrong" — worth
# distinguishing clearly for anyone picking this up later.
ERR_ONBOARDING_INCOMPLETE = 1160401

_X402_VERSION = 2

# Real BSC (chain 56) contract addresses for the four assets the live
# /supported response names. B402's own response gives only the EIP-712
# domain `name` (e.g. "Tether USD"), never the contract address, so this
# mapping is the bridge between the two — and every entry was verified
# on-chain 2026-09-04 by calling the real name()/symbol()/decimals() on
# BSC mainnet and matching name() EXACTLY against the name B402 returns,
# rather than trusting a well-known-address list. All four are 18
# decimals on BSC (note USDT/USDC are 18 here, NOT the 6 they use on
# Ethereum — a real, easy-to-get-wrong difference that would silently
# misprice a payment by 10^12).
ASSETS_BY_NAME: dict[str, dict] = {
    "United Stables": {
        "address": "0xcE24439F2D9C6a2289F741120FE202248B666666",
        "symbol": "U", "decimals": 18,
    },
    "Tether USD": {
        "address": "0x55d398326f99059fF775485246999027B3197955",
        "symbol": "USDT", "decimals": 18,
    },
    "USD Coin": {
        "address": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        "symbol": "USDC", "decimals": 18,
    },
    "World Liberty Financial USD": {
        "address": "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
        "symbol": "USD1", "decimals": 18,
    },
}


class B402Error(RuntimeError):
    """A real B402 API failure — carries the real envelope code so a
    caller can distinguish an onboarding problem from a signing problem
    from a genuine rejection, rather than collapsing all three."""

    def __init__(self, message: str, *, code=None, http_status: int | None = None, body=None):
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.body = body

    @property
    def is_onboarding_incomplete(self) -> bool:
        try:
            return int(self.code) == ERR_ONBOARDING_INCOMPLETE
        except (TypeError, ValueError):
            return False


def _credentials() -> tuple[str, str]:
    """Real credentials from the environment only — never a parameter, so
    there's no code path where a caller can accidentally thread a secret
    in from somewhere less trustworthy (a request body, a query param)."""
    api_key = os.environ.get("OC_API_KEY")
    secret_key = os.environ.get("OC_SECRET_KEY")
    if not api_key or not secret_key:
        raise B402Error(
            "OC_API_KEY / OC_SECRET_KEY are not configured — B402 is unavailable. "
            "Set both in the backend environment (.env locally, Render env vars in production)."
        )
    return api_key, secret_key


def iso_timestamp() -> str:
    """Real ISO 8601 UTC timestamp with millisecond precision.

    Worth stating exactly why this isn't epoch-millis, since the guide's
    prose doesn't spell out the format and epoch-millis is the obvious
    guess (it's what most exchange APIs use, including Binance's own spot
    API): the real B402 API rejects it outright. Confirmed live, this is
    a verbatim real response to an epoch-millis timestamp:

        HTTP 401 {"msg":"Invalid timestamp format, expected ISO 8601","code":40103}

    So: "2026-09-04T12:34:56.789Z", built from a single `now` reading so
    the seconds and milliseconds can't straddle a tick and disagree."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def sign_request(timestamp: str, method: str, request_path: str, raw_body: str, secret_key: str) -> str:
    """The real documented signing scheme, exactly as specified:

        preHash   = timestamp + method + requestPath + rawBody
        signature = base64( HMAC-SHA256(secretKey, preHash) )

    Base64, not hex — a real, silent-401 difference if confused.

    `raw_body` must be the EXACT string that goes on the wire, byte for
    byte. Every caller here serializes once and passes the same string to
    both this function and httpx's `content=`, never re-serializing in
    between: any difference at all (a re-ordered key, an added space) is
    a signature over one body sent alongside a different one, which fails
    authentication in a way that looks like a bad key rather than a bad
    body."""
    pre_hash = f"{timestamp}{method}{request_path}{raw_body}"
    digest = hmac.new(secret_key.encode(), pre_hash.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


async def post_b402(
    client: httpx.AsyncClient, request_path: str, body: dict, *, timeout: float = 20.0,
) -> dict:
    """The real postB402() pattern: serialize the body once, sign that
    exact string, send it with the real auth headers, and unwrap the
    response envelope.

    One real shape detail the guide is explicit about and which is easy
    to get wrong: the signed and sent payload is `{"body": {...}}` — the
    x402 object goes INSIDE a `body` key, it is not the top-level
    document. Callers here pass the inner object and this wraps it, so
    there's exactly one place that can get it wrong.

    Returns the unwrapped `data` object on a real success. Raises
    B402Error on any real failure, carrying the real envelope code."""
    api_key, secret_key = _credentials()

    # Serialize ONCE. This exact string is both signed and sent — see
    # sign_request's own note on why re-serializing would break auth.
    raw_body = json.dumps({"body": body}, separators=(",", ":"))
    timestamp = iso_timestamp()
    signature = sign_request(timestamp, "POST", request_path, raw_body, secret_key)

    headers = {
        "X-OC-APIKEY": api_key,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": signature,
        "Content-Type": "application/json",
    }

    try:
        resp = await client.post(
            B402_HOST + request_path, content=raw_body, headers=headers, timeout=timeout,
        )
    except (httpx.TimeoutException, httpx.TransportError) as e:
        raise B402Error(f"B402 {request_path} unreachable: {type(e).__name__}: {e}") from e

    try:
        envelope = resp.json()
    except ValueError:
        raise B402Error(
            f"B402 {request_path} returned a non-JSON response (HTTP {resp.status_code}).",
            http_status=resp.status_code, body=resp.text[:500],
        )

    code = envelope.get("code")
    # The envelope's own code is authoritative, checked before the HTTP
    # status — a real B402 failure can arrive on an HTTP 200.
    if str(code) != SUCCESS_CODE:
        msg = envelope.get("msg") or envelope.get("message") or "unknown B402 error"
        err = B402Error(
            f"B402 {request_path} failed (code {code}): {msg}",
            code=code, http_status=resp.status_code, body=envelope,
        )
        if err.is_onboarding_incomplete:
            raise B402Error(
                f"B402 onboarding is not complete for these credentials (code {code}): {msg}. "
                "This is an account-state problem, not a request problem — finish B402 "
                "onboarding in the Binance Developer Portal before retrying.",
                code=code, http_status=resp.status_code, body=envelope,
            ) from err
        raise err

    return envelope.get("data") or {}


# ---------------------------------------------------------------------------
# supported — cached, per the guide's own recommendation
# ---------------------------------------------------------------------------

# The guide's real recommendation: "Call POST /api/v2/b402/supported when
# your service starts, then refresh periodically." A 15-minute TTL is the
# real, deliberate reading of "periodically" here — the supported kinds
# are a slow-moving capability list (which assets/schemes this account can
# take), not live pricing, so refetching per-request would be pure
# overhead on a rail that's already latency-sensitive at checkout.
_SUPPORTED_CACHE: tuple[float, dict] | None = None
_SUPPORTED_TTL_SECONDS = 15 * 60


async def get_supported(client: httpx.AsyncClient, *, force_refresh: bool = False) -> dict:
    """Real, cached `/supported` — the account's real, live payment
    capability list (`kinds[]`, `extensions`, `signers`).

    Doubles as this integration's real readiness check: a success here
    (envelope code 000000000) means the credentials are valid, the
    signing is correct, and B402 onboarding is complete. An
    onboarding-incomplete account fails here with a real, distinguishable
    code rather than silently failing later at settle time."""
    global _SUPPORTED_CACHE
    now = time.time()
    if not force_refresh and _SUPPORTED_CACHE and (now - _SUPPORTED_CACHE[0]) < _SUPPORTED_TTL_SECONDS:
        return _SUPPORTED_CACHE[1]

    data = await post_b402(client, SUPPORTED_PATH, {})
    _SUPPORTED_CACHE = (now, data)
    return data


def kinds_for_network(supported: dict, network: str = "eip155:56") -> list[dict]:
    """Real payment kinds filtered to one network. Defaults to BSC
    mainnet — the only network this project settles on, and (confirmed
    live 2026-09-04) the only one this account's real /supported response
    returns at all."""
    return [k for k in (supported.get("kinds") or []) if k.get("network") == network]


def describe_supported(supported: dict) -> list[dict]:
    """Real, human-readable summary of the live supported kinds, with the
    on-chain asset address resolved for each (see ASSETS_BY_NAME). An
    asset B402 names but this module has no verified address for is
    reported with `asset: None` and `known: False` rather than guessed —
    an unverified address here would misdirect a real payment."""
    out = []
    for kind in kinds_for_network(supported):
        extra = kind.get("extra") or {}
        name = extra.get("name")
        asset = ASSETS_BY_NAME.get(name)
        out.append({
            "scheme": kind.get("scheme"),
            "network": kind.get("network"),
            "asset_name": name,
            "asset_symbol": (asset or {}).get("symbol"),
            "asset": (asset or {}).get("address"),
            "decimals": (asset or {}).get("decimals"),
            "known": asset is not None,
            "transfer_method": extra.get("assetTransferMethod"),
            "signer_address": extra.get("signerAddress"),
            "spender_address": extra.get("spenderAddress"),
        })
    return out


# ---------------------------------------------------------------------------
# verify / settle
# ---------------------------------------------------------------------------


async def verify_payment(
    client: httpx.AsyncClient, payment_payload: dict, payment_requirements: dict,
) -> dict:
    """Real B402 verify — checks a buyer's signed payment payload against
    the payment requirements WITHOUT moving funds.

    Returns the real `data` object, whose meaningful fields are
    `isValid` (bool) and `invalidReason` (str, when not valid).

    Caller contract, and the single most important rule in this whole
    module: `payment_requirements` must be the requirements the SERVER
    issued and held, never a copy echoed back by the client. Verifying a
    client-supplied requirements object against a client-supplied payload
    verifies only that the client agrees with itself — a buyer could
    lower `amount`, swap `asset` for a worthless token, or repoint
    `payTo`, and verify would pass. See server.py's paybox routes, which
    re-load the held requirements from the session store by id and pass
    those."""
    return await post_b402(client, VERIFY_PATH, {
        "x402Version": _X402_VERSION,
        "paymentPayload": payment_payload,
        "paymentRequirements": payment_requirements,
    })


async def settle_payment(
    client: httpx.AsyncClient,
    payment_payload: dict,
    payment_requirements: dict,
    *,
    settle_amount: str | None = None,
) -> dict:
    """Real B402 settle — actually moves the funds on BSC.

    `settle_amount` applies only to the `permit2-upto` transfer method,
    where the buyer authorized a maximum and the seller charges some
    amount at or below it. It's omitted entirely for `exact`, where the
    amount is already fixed by the requirements.

    Returns the real `data` object. Interpreting it is the caller's job
    and there are exactly three real outcomes — see
    classify_settle_result below, which exists so no caller has to
    re-derive them (and so nobody treats outcome 2 as a failure and
    double-charges a buyer whose payment is already on-chain)."""
    body = {
        "x402Version": _X402_VERSION,
        "paymentPayload": payment_payload,
        "paymentRequirements": payment_requirements,
    }
    if settle_amount is not None:
        body["settleAmount"] = settle_amount
    return await post_b402(client, SETTLE_PATH, body)


# The three real settle outcomes, named.
SETTLE_SUCCESS = "success"
SETTLE_BROADCAST_UNCONFIRMED = "broadcast_unconfirmed"
SETTLE_TERMINAL_FAILURE = "terminal_failure"


def classify_settle_result(data: dict) -> dict:
    """Real classification of a settle response into the three real
    outcomes the guide specifies, because the difference between two of
    them is a single easily-missed field and getting it wrong means
    either double-charging a buyer or dropping a real payment:

    1. SUCCESS — `success: true`. Funds moved. Record the transaction and
       deliver the resource.
    2. BROADCAST_UNCONFIRMED — `success: false` BUT `transaction` is
       non-empty. The transaction IS on-chain and may well confirm; this
       is emphatically NOT a failure. Poll the transaction before doing
       anything else, and never blindly retry the settle — a retry here
       risks charging the buyer twice for one purchase.
    3. TERMINAL_FAILURE — `success: false` and `transaction` is empty.
       Nothing was broadcast. Use `errorReason`; do not retry.

    Returns `{outcome, transaction, error_reason, retryable}` —
    `retryable` is False for both 2 and 3, deliberately: 3 can't succeed
    on retry, and 2 must not be retried."""
    success = bool(data.get("success"))
    transaction = (data.get("transaction") or "").strip()
    error_reason = data.get("errorReason") or data.get("invalidReason")

    if success:
        outcome = SETTLE_SUCCESS
    elif transaction:
        outcome = SETTLE_BROADCAST_UNCONFIRMED
    else:
        outcome = SETTLE_TERMINAL_FAILURE

    return {
        "outcome": outcome,
        "transaction": transaction or None,
        "error_reason": error_reason,
        "retryable": False,
        "network": data.get("network"),
        "payer": data.get("payer"),
    }
