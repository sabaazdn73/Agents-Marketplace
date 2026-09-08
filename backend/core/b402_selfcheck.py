# b402_selfcheck.py
#
# Checks the B402 rail against the live facilitator and reports each result
# on its own, so the Pay.B402 tab can show whether the rail works instead of
# asserting that it does.
#
# Every check here talks to something. None of them pass because the code
# compiled. The two that could move money do not: verify never transfers,
# and the tamper case is built to be rejected.

from __future__ import annotations

import os
import re
import secrets
import time

import httpx

from . import b402, paybox

BSC_CHAIN_ID = 56
BSC_NETWORK = "eip155:56"
TIMEOUT_SECONDS = 25.0

# Values that would mean a testnet leaked into a production path.
TESTNET_MARKERS = ("eip155:97", "chapel", "data-seed-prebsc", "testnet")


def _result(name: str, ok: bool, detail: str = "") -> dict:
    return {"name": name, "ok": ok, "detail": detail}


def _is_checksum(addr: str) -> tuple[bool, bool]:
    """(looks_valid, was_actually_verified). Without eth_utils the address is
    only shape checked, and the caller says so rather than implying more."""
    if not isinstance(addr, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", addr or ""):
        return False, False
    try:
        from eth_utils import to_checksum_address
    except ImportError:
        return True, False
    return to_checksum_address(addr) == addr, True


async def run_checks() -> dict:
    checks: list[dict] = []
    started = time.time()

    # 1. Entitlement. A success code, not merely a 200.
    supported = None
    if not (os.environ.get("OC_API_KEY") and os.environ.get("OC_SECRET_KEY")):
        checks.append(_result("Entitlement active", False,
                              "OC_API_KEY and OC_SECRET_KEY are not set, so this cannot be checked."))
    else:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                supported = await b402.get_supported(client, force_refresh=True)
            kinds = b402.describe_supported(supported)
            checks.append(_result(
                "Entitlement active", bool(kinds),
                f"/supported returned {len(kinds)} payment kind(s) with code {b402.SUCCESS_CODE}.",
            ))
        except b402.B402Error as e:
            checks.append(_result("Entitlement active", False, str(e)[:200]))
        except (httpx.HTTPError, OSError) as e:
            checks.append(_result("Entitlement active", False,
                                  f"facilitator unreachable ({type(e).__name__})"))

    kinds = b402.describe_supported(supported) if supported else []

    # 2. Asset addresses, checksums and decimals, from the facilitator itself.
    if not kinds:
        checks.append(_result("Asset addresses valid", False,
                              "No kinds returned, so no address could be checked."))
    else:
        bad_addr, bad_dec, verified_any = [], [], False
        for k in kinds:
            ok, verified = _is_checksum(str(k.get("asset", "")))
            verified_any = verified_any or verified
            if not ok:
                bad_addr.append(f"{k.get('asset_symbol')}={k.get('asset')}")
            d = k.get("decimals")
            if not isinstance(d, int) or not (0 <= d <= 36):
                bad_dec.append(f"{k.get('asset_symbol')}={d}")
        note = "checksum verified" if verified_any else "shape checked only, eth_utils not installed"
        checks.append(_result(
            "Asset addresses valid", not bad_addr and not bad_dec,
            (f"{len(kinds)} asset(s), {note}, decimals agree."
             if not bad_addr and not bad_dec
             else f"addresses {bad_addr}, decimals {bad_dec}"),
        ))

    # 3. Network. Everything on BSC mainnet, nothing testnet reachable.
    off_network = [k.get("network") for k in kinds if k.get("network") != BSC_NETWORK]
    leaked = []
    for k in kinds:
        blob = " ".join(str(v).lower() for v in k.values())
        leaked += [m for m in TESTNET_MARKERS if m in blob]
    checks.append(_result(
        "Network is eip155:56 only",
        bool(kinds) and not off_network and not leaked,
        (f"all {len(kinds)} kind(s) on {BSC_NETWORK} (chain {BSC_CHAIN_ID}), no testnet value."
         if kinds and not off_network and not leaked
         else f"off-network {sorted(set(off_network))}, testnet markers {sorted(set(leaked))}"),
    ))

    # 4. Tamper rejection. A payload whose amount was lowered against the
    #    requirements this server issued must fail verify. This is the case
    #    the whole session store exists for.
    if not kinds:
        checks.append(_result("Tampered payload rejected", False, "Facilitator unavailable."))
    else:
        kind = next((k for k in kinds if k.get("transfer_method") == "eip3009"), kinds[0])
        genuine = {
            "scheme": kind["scheme"], "network": kind["network"],
            "amount": "10000000000000000",
            "asset": kind["asset"], "payTo": paybox._pay_to_address(),
            "maxTimeoutSeconds": 300,
            "extra": {"name": kind["asset_name"], "version": "1",
                      "assetTransferMethod": "eip3009",
                      "signerAddress": kind.get("signer_address")},
        }
        now = int(time.time())
        tampered_payload = {
            "x402Version": 2, "scheme": genuine["scheme"], "network": genuine["network"],
            "payload": {
                "signature": "0x" + "11" * 65,
                "authorization": {
                    "from": paybox._pay_to_address(),
                    "to": genuine["payTo"],
                    # One unit, against a requirement of 10^16.
                    "value": "1",
                    "validAfter": "0", "validBefore": str(now + 300),
                    "nonce": "0x" + secrets.token_hex(32),
                },
            },
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                v = await b402.verify_payment(client, tampered_payload, genuine)
            rejected = not v.get("isValid")
            checks.append(_result(
                "Tampered payload rejected", rejected,
                (f"verify returned isValid=false ({v.get('invalidReason')}) for a payload "
                 "claiming 1 unit against a requirement of 10000000000000000."
                 if rejected else "verify ACCEPTED a lowered amount, which must never happen"),
            ))
        except b402.B402Error as e:
            checks.append(_result("Tampered payload rejected", False, f"could not check: {str(e)[:140]}"))
        except (httpx.HTTPError, OSError) as e:
            checks.append(_result("Tampered payload rejected", False,
                                  f"facilitator unreachable ({type(e).__name__})"))

    # 5. Requirements are held server side, and a rejected payment does not
    #    change the stored session.
    try:
        session = await paybox.create_session(
            amount="0.01", order_reference=f"selfcheck-{secrets.token_hex(4)}",
            description="B402 self-check, never paid",
        )
        sid = session["session_id"]
        before = await paybox.get_session(sid)
        held = (before or {}).get("payment_requirements") or {}
        stored_ok = bool(held.get("amount")) and bool(held.get("payTo")) and bool(held.get("asset"))

        bad = {
            "x402Version": 2, "scheme": "exact", "network": BSC_NETWORK,
            "payload": {"signature": "0x" + "22" * 65, "authorization": {
                "from": paybox._pay_to_address(), "to": held.get("payTo"),
                "value": "1", "validAfter": "0",
                "validBefore": str(int(time.time()) + 300),
                "nonce": "0x" + secrets.token_hex(32)}},
        }
        outcome = await paybox.submit_payment(sid, bad)
        after = await paybox.get_session(sid)
        unchanged = (
            (after or {}).get("payment_requirements") == held
            and (after or {}).get("status") == paybox.STATUS_PENDING
        )
        checks.append(_result(
            "Requirements held server side", stored_ok,
            f"session {sid} stores amount, asset and payTo on the server.",
        ))
        checks.append(_result(
            "Rejected payment leaves the session unchanged",
            unchanged and not outcome.get("ok"),
            (f"payment refused at {outcome.get('stage') or 'verify'} "
             f"({outcome.get('reason')}), session still {(after or {}).get('status')}."),
        ))
    except Exception as e:
        checks.append(_result("Requirements held server side", False,
                              f"{type(e).__name__}: {str(e)[:140]}"))

    # 6. Recipient wallets. Different roles, and equal values mean a
    #    settlement that pays the wrong place.
    pay_to = os.environ.get("PAYBOX_PAY_TO") or ""
    fee_wallet = os.environ.get("PLATFORM_FEE_WALLET") or ""
    if not pay_to:
        checks.append(_result("PAYBOX_PAY_TO configured", False,
                              "PAYBOX_PAY_TO is not set, so settlement has no recipient."))
    elif not fee_wallet:
        ok, verified = _is_checksum(pay_to)
        checks.append(_result(
            "PAYBOX_PAY_TO configured", ok,
            f"set to {pay_to}. PLATFORM_FEE_WALLET is unset, so they cannot collide.",
        ))
    else:
        distinct = pay_to.lower() != fee_wallet.lower()
        checks.append(_result(
            "PAYBOX_PAY_TO configured", distinct,
            ("set, and distinct from PLATFORM_FEE_WALLET."
             if distinct else
             "PAYBOX_PAY_TO and PLATFORM_FEE_WALLET are the same address. They have "
             "different roles and a settlement built on one will pay the other."),
        ))

    passed = sum(1 for c in checks if c["ok"])
    return {
        "checks": checks,
        "passed": passed,
        "total": len(checks),
        "all_ok": passed == len(checks),
        "checked_at": time.time(),
        "duration_ms": round((time.time() - started) * 1000, 1),
    }
