"""
paybox.py

Real Tnega PayBox session layer — the checkout-session state machine that
sits on top of core/b402.py's raw protocol client, implementing exactly
the session shape docs/future-tnega-paybox.md designed against
Anthropic's `commerce-agents` `CheckoutHandoff` contract:

    POST /api/paybox/sessions       -> {session_id, checkout_url} + HTTP 402
    GET  /api/paybox/sessions/{id}  -> real, current status (poll target)
    POST /api/paybox/sessions/{id}/pay -> verify, then settle

Built 2026-09-04. Where the earlier design doc said "the hard part was
never how an agent calls in, it's whether the settlement rail underneath
actually works from BSC" — B402 is that rail, and it settles natively on
BSC with no bridge (see core/b402.py's own module docstring).

THE security rule this module exists to enforce, stated first because
everything else here is in service of it: the payment requirements a
buyer's signature is checked against are the ones THIS SERVER issued and
stored, loaded back by session id. They are never taken from the request
body, never merged with anything a client sent, and never trusted from a
client echo. A client that could supply its own requirements could lower
`amount`, swap `asset` to a worthless token, or repoint `payTo` at
itself, and B402's verify would faithfully confirm the payload matches
those attacker-chosen requirements. Verify only means something when the
requirements side is server-held.

Real storage note: sessions live in MongoDB with a real TTL index, so
they self-expire rather than accumulating forever. This cluster is a
512MB Atlas free tier that has already hit its quota once (see
docs/full-registry-analysis.md) — an unbounded checkout-session
collection is exactly the kind of slow leak that would do it again.
"""

from __future__ import annotations

import os
import secrets
import time
from decimal import Decimal, InvalidOperation

import httpx

from core import b402
from core.db import get_db

PAYBOX_COLLECTION = "paybox_sessions"

# Real session lifetime. Deliberately short: an open checkout session is
# a live, server-held price quote, and holding one for hours invites
# settling at a stale amount. Mirrors the `maxTimeoutSeconds` handed to
# B402 in the requirements themselves, so the two can't disagree.
SESSION_TTL_SECONDS = 30 * 60
DEFAULT_MAX_TIMEOUT_SECONDS = 300

STATUS_PENDING = "pending"
STATUS_PAID = "paid"
STATUS_BROADCAST_UNCONFIRMED = "broadcast_unconfirmed"
STATUS_FAILED = "failed"
STATUS_EXPIRED = "expired"

# Default settlement asset: $U (United Stables). Deliberate, not
# arbitrary — it's ERC-8183's own settlement token, the same asset this
# marketplace already denominates escrowed hires in, so a PayBox payment
# and a Tnega hire settle in one asset with no conversion between them.
DEFAULT_ASSET_SYMBOL = "U"

_SYMBOL_TO_NAME = {v["symbol"]: k for k, v in b402.ASSETS_BY_NAME.items()}

_ttl_index_ready = False


def _public_base_url() -> str:
    """Real, configurable public origin for building a checkout_url. Falls
    back to the real production origin rather than localhost, since a
    checkout_url is handed to a THIRD party (a merchant backend, then a
    human) — a localhost URL leaking into a real CheckoutHandoff would be
    a broken link for everyone but the developer who generated it."""
    return os.environ.get("PAYBOX_PUBLIC_BASE_URL", "https://tnega.app").rstrip("/")


def _pay_to_address() -> str:
    """Real recipient for PayBox settlements. Reuses the project's real,
    already-configured platform wallet rather than introducing a second
    address to keep in sync."""
    addr = os.environ.get("PAYBOX_PAY_TO") or os.environ.get("PLATFORM_FEE_WALLET")
    if not addr:
        raise RuntimeError(
            "No PayBox recipient configured — set PAYBOX_PAY_TO (or PLATFORM_FEE_WALLET)."
        )
    return addr


def to_base_units(amount: str | float | int, decimals: int) -> str:
    """Real decimal-string -> integer base units, via Decimal.

    Never float: 0.1 + 0.2 style binary error in a payment amount is a
    real, silent mispricing, and at 18 decimals a float can't even
    represent most valid amounts exactly. Returns a string because
    base-unit amounts at 18 decimals routinely exceed what JSON consumers
    parse safely as numbers, and B402's own `amount` field is a string."""
    try:
        d = Decimal(str(amount))
    except (InvalidOperation, ValueError) as e:
        raise ValueError(f"Not a real, parseable amount: {amount!r}") from e
    if d <= 0:
        raise ValueError(f"Amount must be positive, got {amount!r}")
    scaled = d * (Decimal(10) ** decimals)
    if scaled != scaled.to_integral_value():
        raise ValueError(
            f"Amount {amount!r} has more precision than this asset's {decimals} decimals allow."
        )
    return str(int(scaled))


async def _ensure_indexes() -> None:
    """Real TTL index so expired sessions are reclaimed by MongoDB itself
    rather than growing without bound on a quota-constrained cluster."""
    global _ttl_index_ready
    if _ttl_index_ready:
        return
    col = get_db()[PAYBOX_COLLECTION]
    await col.create_index("expires_at", expireAfterSeconds=0)
    await col.create_index("session_id", unique=True)
    _ttl_index_ready = True


async def _select_kind(client: httpx.AsyncClient, asset_symbol: str, scheme: str) -> dict:
    """Pick a real, currently-supported payment kind from the LIVE
    /supported response — never a hardcoded assumption about what this
    account can accept. If B402 stops supporting an asset, this raises
    instead of building requirements the facilitator would reject at
    settle time, after the buyer has already signed."""
    asset_name = _SYMBOL_TO_NAME.get(asset_symbol)
    if not asset_name:
        raise ValueError(
            f"Unknown asset {asset_symbol!r}. Real supported symbols: "
            f"{sorted(_SYMBOL_TO_NAME)}"
        )

    supported = await b402.get_supported(client)
    for kind in b402.kinds_for_network(supported):
        extra = kind.get("extra") or {}
        if extra.get("name") == asset_name and kind.get("scheme") == scheme:
            return kind
    raise ValueError(
        f"B402 does not currently support scheme {scheme!r} for {asset_symbol} on BSC. "
        f"Real, live options: {[ (k.get('scheme'), (k.get('extra') or {}).get('name')) for k in b402.kinds_for_network(supported) ]}"
    )


async def create_session(
    *,
    amount: str | float | int,
    order_reference: str,
    description: str | None = None,
    asset_symbol: str = DEFAULT_ASSET_SYMBOL,
    scheme: str = "exact",
    merchant_id: str | None = None,
    success_url: str | None = None,
    cancel_url: str | None = None,
) -> dict:
    """Create a real checkout session and build the real x402 payment
    requirements for it, sourced from a real, live B402 /supported call.

    Returns the full session document plus the `accepts` array a caller
    puts straight into an HTTP 402 response body."""
    await _ensure_indexes()

    asset = b402.ASSETS_BY_NAME.get(_SYMBOL_TO_NAME.get(asset_symbol, ""))
    if not asset:
        raise ValueError(f"Unknown asset {asset_symbol!r}.")

    base_units = to_base_units(amount, asset["decimals"])

    async with httpx.AsyncClient() as client:
        kind = await _select_kind(client, asset_symbol, scheme)

    # The real, server-held payment requirements. This exact object is
    # what a later verify/settle is checked against — see the module
    # docstring on why it must never be re-derived from client input.
    requirements = {
        "scheme": kind["scheme"],
        "network": kind["network"],
        "amount": base_units,
        "asset": asset["address"],
        "payTo": _pay_to_address(),
        "maxTimeoutSeconds": DEFAULT_MAX_TIMEOUT_SECONDS,
        "extra": kind.get("extra") or {},
    }

    session_id = "pbx_" + secrets.token_urlsafe(24)
    now = time.time()
    doc = {
        "session_id": session_id,
        "status": STATUS_PENDING,
        "created_at": now,
        "expires_at": _expiry_datetime(now),
        "order_reference": order_reference,
        "merchant_id": merchant_id,
        "description": description or f"Tnega PayBox order {order_reference}",
        "amount_display": str(amount),
        "asset_symbol": asset_symbol,
        "asset_decimals": asset["decimals"],
        "payment_requirements": requirements,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "checkout_url": f"{_public_base_url()}/paybox/checkout?session={session_id}",
        "settlement": None,
    }

    await get_db()[PAYBOX_COLLECTION].insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


def _expiry_datetime(now: float):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(now + SESSION_TTL_SECONDS, tz=timezone.utc)


def accepts_for(session: dict) -> list[dict]:
    """The real x402 v2 `accepts` array for a 402 response — exactly the
    server-held requirements, nothing added or reshaped."""
    return [session["payment_requirements"]]


def public_view(session: dict) -> dict:
    """Real, safe public projection of a session. Deliberately explicit
    about what it includes rather than deleting keys from the raw doc: a
    field added to the stored document later shouldn't silently start
    being served to the public."""
    return {
        "session_id": session.get("session_id"),
        "status": session.get("status"),
        "order_reference": session.get("order_reference"),
        "description": session.get("description"),
        "amount": session.get("amount_display"),
        "asset": session.get("asset_symbol"),
        "network": (session.get("payment_requirements") or {}).get("network"),
        "checkout_url": session.get("checkout_url"),
        "created_at": session.get("created_at"),
        "settlement": session.get("settlement"),
    }


async def get_session(session_id: str) -> dict | None:
    return await get_db()[PAYBOX_COLLECTION].find_one({"session_id": session_id})


async def submit_payment(session_id: str, payment_payload: dict) -> dict:
    """The real verify-then-settle flow for one session.

    Order matters and is not an optimization: verify first, settle only
    on a real `isValid: true`. Settling an unverified payload would hand
    B402 a signature this server never checked against its own
    requirements.

    All three real settle outcomes are handled distinctly (see
    b402.classify_settle_result): a broadcast-but-unconfirmed result is
    recorded as its own real status with its real transaction hash and is
    NEVER retried — the payment is already on-chain, and retrying would
    risk charging the buyer twice for one order."""
    session = await get_session(session_id)
    if not session:
        return {"ok": False, "reason": "No such PayBox session."}

    if session.get("status") == STATUS_PAID:
        # Real idempotency: a duplicate submit for an already-settled
        # session returns the original real settlement instead of
        # charging again.
        return {"ok": True, "already_settled": True, "settlement": session.get("settlement")}

    if session.get("status") in (STATUS_BROADCAST_UNCONFIRMED,):
        return {
            "ok": False, "reason": "This session already has a broadcast transaction pending "
                                   "confirmation — poll it rather than resubmitting.",
            "settlement": session.get("settlement"),
        }

    # Server-held requirements. Never from the request body.
    requirements = session["payment_requirements"]
    col = get_db()[PAYBOX_COLLECTION]

    async with httpx.AsyncClient() as client:
        verification = await b402.verify_payment(client, payment_payload, requirements)
        if not verification.get("isValid"):
            reason = verification.get("invalidReason") or "unknown"
            await col.update_one(
                {"session_id": session_id},
                {"$set": {"last_invalid_reason": reason, "last_attempt_at": time.time()}},
            )
            return {"ok": False, "stage": "verify", "reason": reason, "payer": verification.get("payer")}

        settle_data = await b402.settle_payment(client, payment_payload, requirements)

    result = b402.classify_settle_result(settle_data)

    status = {
        b402.SETTLE_SUCCESS: STATUS_PAID,
        b402.SETTLE_BROADCAST_UNCONFIRMED: STATUS_BROADCAST_UNCONFIRMED,
        b402.SETTLE_TERMINAL_FAILURE: STATUS_FAILED,
    }[result["outcome"]]

    settlement = {
        "outcome": result["outcome"],
        "transaction": result["transaction"],
        "error_reason": result["error_reason"],
        "payer": result.get("payer") or verification.get("payer"),
        "network": result.get("network") or requirements.get("network"),
        "settled_at": time.time(),
    }
    await col.update_one(
        {"session_id": session_id},
        {"$set": {"status": status, "settlement": settlement}},
    )

    return {
        "ok": result["outcome"] == b402.SETTLE_SUCCESS,
        "stage": "settle",
        "status": status,
        "settlement": settlement,
    }
