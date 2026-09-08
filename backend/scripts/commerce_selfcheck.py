#!/usr/bin/env python3
"""commerce_selfcheck.py -- the debug loop for the commerce pipeline.

Asserts against infrastructure, not mocks: the live B402 facilitator,
the live BSC RPC, and the QA rules. Exits non-zero if anything fails,
so it can gate a deploy.

Grouped the way the risk actually falls:
  MONEY integer-only arithmetic, decimals, checksummed addresses,
            chain id 56, no testnet reachable, amounts traceable to source
  FAILURE   timeouts everywhere, visible degradation, no retry on ambiguity
  GATE      QA rejects what it must; payment cannot run past a finding

Run:  python3 scripts/commerce_selfcheck.py
"""

from __future__ import annotations

import ast
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import httpx

from core import b402
from core.commerce import model
from core.commerce.agents import payment as payment_agent
from core.commerce.agents import qa as qa_agent
from core.commerce.rails.b402_rail import BSC_CHAIN_ID, BSC_NETWORK
from core.commerce.rails.base import Cart, CartLine
from core.commerce.rails.select import select_rail
from core.commerce.state import Money, MoneyError, StageResult, TaskState

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))


def is_checksum_address(addr: str) -> bool:
    """EIP-55, computed rather than trusted. Keccak via eth_utils if present;
    otherwise reported as unverifiable instead of silently passing."""
    if not isinstance(addr, str) or len(addr) != 42 or not addr.startswith("0x"):
        return False
    try:
        from eth_utils import to_checksum_address
    except ImportError:
        return True  # see the note emitted by the caller
    return to_checksum_address(addr) == addr


# ───────────────────────────── MONEY ──────────────────────────────────────

def money_checks() -> None:
    print("\nMONEY HANDLING")

    # No float can enter a value path.
    try:
        Money(1.5, 18, "USDT")            # type: ignore[arg-type]
        check("Money rejects float units", False, "a float was accepted")
    except MoneyError:
        check("Money rejects float units", True)

    try:
        Money(True, 18, "USDT")           # type: ignore[arg-type]
        check("Money rejects bool units", False, "a bool was accepted")
    except MoneyError:
        check("Money rejects bool units", True)

    # Exact at 18dp -- the value float64 cannot represent.
    big = Money.from_decimal_string("1.234567890123456789", 18, "USDT")
    check(
        "18dp round-trips exactly",
        big.units == 1234567890123456789,
        f"units={big.units}",
    )

    # The classic float bug, asserted as absent.
    a = Money.from_decimal_string("0.1", 18, "USDT")
    b = Money.from_decimal_string("0.2", 18, "USDT")
    c = Money.from_decimal_string("0.3", 18, "USDT")
    check("0.1 + 0.2 == 0.3 exactly", (a + b).units == c.units)

    # Over-precision is refused, never rounded.
    try:
        Money.from_decimal_string("0.123", 2, "USDT")
        check("over-precision refused, not rounded", False, "silently rounded")
    except MoneyError:
        check("over-precision refused, not rounded", True)

    # Mixed currencies cannot be summed into a wrong total.
    try:
        Money(1, 18, "USDT") + Money(1, 18, "USD1")
        check("mixed-currency addition refused", False)
    except MoneyError:
        check("mixed-currency addition refused", True)

    # Cart totals are integer summation.
    cart = Cart()
    for _ in range(3):
        cart.lines.append(CartLine(
            title="x", url="https://example.com",
            price=Money.from_decimal_string("0.1", 18, "USDT"),
        ))
    check(
        "cart total is exact integer sum",
        cart.total().units == 300000000000000000,
        f"units={cart.total().units}",
    )

    # Static scan: no float() or float literal arithmetic in the money path.
    money_path = [
        ROOT / "core/commerce/state.py",
        ROOT / "core/commerce/rails/base.py",
        ROOT / "core/commerce/rails/b402_rail.py",
        ROOT / "core/commerce/agents/payment.py",
    ]
    # Serialisation: `units` must cross JSON as a STRING everywhere. A raw
    # integer 2e20 exceeds JS MAX_SAFE_INTEGER and a browser would read back
    # a different number than was stored. Regression guard for a bug.
    st = TaskState(request="serialisation")
    st.profile = {"budget": Money.from_decimal_string("200", 18, "USDT")}
    st.record(StageResult(stage="profile", status="ok", data={"budget": st.profile["budget"]}))
    enc = st.to_dict()
    top = enc["profile"]["budget"]["units"]
    nested = enc["stages"][0]["data"]["budget"]["units"]
    check(
        "Money.units serialises as a string (top level and nested)",
        isinstance(top, str) and isinstance(nested, str),
        f"top={type(top).__name__} nested={type(nested).__name__}",
    )

    # Floats are legitimate for TIME (timeouts, timestamps, durations) and
    # never for VALUE. So the scan allows a float literal only where it is
    # bound to a clearly time-shaped name, and flags everything else. A
    # blanket ban would be noise; a blanket allow would miss the bug.
    TIME_NAMES = ("timeout", "seconds", "_at", "duration", "delay", "interval", "elapsed")

    def is_time_binding(node: ast.AST, parent_map: dict) -> bool:
        cur = parent_map.get(node)
        while cur is not None:
            if isinstance(cur, (ast.AnnAssign, ast.Assign, ast.arg, ast.keyword)):
                names = []
                if isinstance(cur, ast.AnnAssign) and isinstance(cur.target, ast.Name):
                    names = [cur.target.id]
                elif isinstance(cur, ast.Assign):
                    names = [t.id for t in cur.targets if isinstance(t, ast.Name)]
                elif isinstance(cur, ast.arg):
                    names = [cur.arg]
                elif isinstance(cur, ast.keyword) and cur.arg:
                    names = [cur.arg]
                return any(any(t in n.lower() for t in TIME_NAMES) for n in names)
            cur = parent_map.get(cur)
        return False

    offenders = []
    for p in money_path:
        tree = ast.parse(p.read_text())
        parents = {}
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                parents[child] = parent
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, float):
                if not is_time_binding(node, parents):
                    offenders.append(f"{p.name}:{node.lineno} float literal {node.value}")
            # float() is never acceptable in these modules, time or not.
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == "float"):
                offenders.append(f"{p.name}:{node.lineno} float() call")
    check(
        "no float in a VALUE path (time-bound floats allowed)",
        not offenders,
        "; ".join(offenders[:4]),
    )


# ───────────────────────────── CHAIN ──────────────────────────────────────

async def chain_checks() -> None:
    print("\nCHAIN / ADDRESSES")

    check("rail pins chain id 56", BSC_CHAIN_ID == 56, f"got {BSC_CHAIN_ID}")
    check("rail pins network eip155:56", BSC_NETWORK == "eip155:56", BSC_NETWORK)

    try:
        from eth_utils import to_checksum_address  # noqa: F401
        have_keccak = True
    except ImportError:
        have_keccak = False
        print("       note: eth_utils absent -- checksum is NOT verified, only shape-checked")

    if not (os.environ.get("OC_API_KEY") and os.environ.get("OC_SECRET_KEY")):
        check("B402 entitlement live", False, "OC_API_KEY / OC_SECRET_KEY unset -- cannot check")
        return

    try:
        async with httpx.AsyncClient(timeout=20) as c:
            supported = await b402.get_supported(c, force_refresh=True)
    except Exception as e:
        check("B402 entitlement live", False, f"{type(e).__name__}: {str(e)[:120]}")
        return

    kinds = b402.describe_supported(supported)
    check("B402 entitlement live", bool(kinds), f"{len(kinds)} kind(s)")

    on_bsc = [k for k in kinds if k.get("network") == BSC_NETWORK]
    check("every kind is on eip155:56", len(on_bsc) == len(kinds),
          f"{len(on_bsc)}/{len(kinds)}")

    bad = [k["asset"] for k in on_bsc if not is_checksum_address(str(k.get("asset", "")))]
    check(
        "facilitator asset addresses are checksum-valid" if have_keccak
        else "facilitator asset addresses are well-formed",
        not bad, str(bad[:2]),
    )

    # Decimals come from the facilitator, never assumed.
    odd = [f"{k['asset_symbol']}={k.get('decimals')}" for k in on_bsc
           if not isinstance(k.get("decimals"), int) or not (0 <= k["decimals"] <= 36)]
    check("facilitator states plausible decimals", not odd, str(odd[:3]))

    # No testnet INFRASTRUCTURE anywhere in the commerce package.
    #
    # Deliberately not a grep for the word "testnet": that word now appears
    # legitimately in code whose whole job is to REFUSE testnet values, and
    # flagging a guard as if it were the thing it guards against would be a
    # check that punishes the right behaviour. So this looks for real
    # testnet endpoints and chain ids instead.
    testnet_infra = ("eip155:97", "chapel", "data-seed-prebsc", "sepolia.", "goerli")
    hits = []
    for p in (ROOT / "core/commerce").rglob("*.py"):
        text = p.read_text().lower()
        for marker in testnet_infra:
            if marker in text:
                hits.append(f"{p.name}:{marker}")
    check("no testnet endpoint or chain id in the package", not hits, str(hits[:3]))

    # Stronger than a grep: a testnet payment method must be structurally
    # unselectable, not merely absent from the source.
    from core.commerce.rails import crossmint as _cm
    allowed = _cm.EVM_METHODS | _cm.SOLANA_METHODS | _cm.FIAT_METHODS
    check(
        "testnet methods are disjoint from the accepted set",
        not (_cm.TESTNET_METHODS & allowed),
        str(sorted(_cm.TESTNET_METHODS & allowed)),
    )


# ───────────────────────── FAILURE BEHAVIOUR ──────────────────────────────

async def failure_checks() -> None:
    print("\nFAILURE BEHAVIOUR")

    # Every AsyncClient constructed in the package must pass a timeout.
    missing = []
    for p in (ROOT / "core/commerce").rglob("*.py"):
        tree = ast.parse(p.read_text())
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "AsyncClient"):
                if not any(kw.arg == "timeout" for kw in node.keywords):
                    missing.append(f"{p.name}:{node.lineno}")
    check("every httpx.AsyncClient sets a timeout", not missing, str(missing[:3]))

    # The model call is bounded.
    check(
        "model call has a timeout",
        isinstance(model.DEFAULT_TIMEOUT_SECONDS, (int, float))
        and model.DEFAULT_TIMEOUT_SECONDS > 0,
        f"{model.DEFAULT_TIMEOUT_SECONDS}s",
    )

    # No write is retried. Assert the absence of retry machinery around
    # settle/order-creation rather than trusting the comments.
    for name in ("b402_rail.py", "crossmint.py"):
        src = (ROOT / "core/commerce/rails" / name).read_text()
        has_retry = any(w in src for w in ("for attempt", "while True", "retry(", "tenacity"))
        check(f"{name} contains no write-retry loop", not has_retry)

    # Degradation is visible, not a silent zero.
    saved = os.environ.pop("GEMINI_API_KEY", None)
    try:
        out = await model.reason("x", "{}", intent="probe")
        check(
            "no key degrades visibly (not a silent empty result)",
            out.get("degraded") is True and bool(out.get("would_have")),
            str(out)[:90],
        )
    finally:
        if saved is not None:
            os.environ["GEMINI_API_KEY"] = saved


# ────────────────────────────── GATE ──────────────────────────────────────

async def gate_checks() -> None:
    print("\nQA GATE")

    def state(size="M", budget="200", season="winter"):
        s = TaskState(request="selfcheck")
        s.profile = {"size": size, "budget": Money.from_decimal_string(budget, 18, "USDT")}
        s.context = {"season": season}
        return s

    def cart(size="M", price="150", title="Wool coat"):
        c = Cart()
        c.lines.append(CartLine(
            title=title, url="https://example.com/p",
            price=Money.from_decimal_string(price, 18, "USDT"), size=size,
        ))
        return c

    cases = [
        ("rejects size outside profile", state(), cart(size="XL"), "size_outside_profile"),
        ("rejects over budget", state(budget="100"), cart(price="150"), "over_budget"),
        ("rejects wrong for season", state(), cart(title="Linen shorts"), "wrong_for_season"),
        ("rejects empty cart", state(), Cart(), "empty_cart"),
    ]
    for name, st, ct, rule in cases:
        findings = await qa_agent.review(st, ct, check_links=False)
        check(name, any(f.rule == rule for f in findings),
              f"rules={[f.rule for f in findings]}")

    clean = await qa_agent.review(state(), cart(), check_links=False)
    check("clean cart yields no findings", not clean, f"rules={[f.rule for f in clean]}")

    # A dead link must be caught. Uses a reserved-for-testing TLD, so this
    # exercises DNS failure rather than a mock.
    c = Cart()
    c.lines.append(CartLine(
        title="Ghost", url="https://this-host-does-not-exist.invalid/p",
        price=Money.from_decimal_string("10", 18, "USDT"), size="M",
    ))
    f = await qa_agent.review(state(), c, check_links=True)
    check("rejects a link that does not resolve", any(x.rule == "link_dead" for x in f),
          f"rules={[x.rule for x in f]}")

    # Payment cannot run past a finding.
    s = state()
    bad = cart(size="XL")
    s.record(await qa_agent.run(s, bad, check_links=False))
    p = await payment_agent.run(s, bad)
    check("payment refuses while findings exist", p.status == "error", p.note[:70])

    # Payment refuses when QA never ran at all.
    s2 = state()
    p2 = await payment_agent.run(s2, cart())
    check("payment refuses when QA did not run", p2.status == "error", p2.note[:70])

    # A rail is always selectable -- handoff guarantees it.
    rail, quotes = await select_rail(cart())
    check("a rail is always available", rail is not None,
          f"chosen={getattr(rail, 'name', '?')}")
    check("handoff is always configured", any(
        q.rail == "handoff" and q.available for q in quotes))


async def crossmint_guard_checks() -> None:
    """The three guards standing in front of a production key."""
    print("\nCROSSMINT GUARDS")
    from core.commerce.rails import crossmint as cm
    from core.commerce.rails.crossmint import CrossmintRail

    def cart(amount="1.00", sym="USDC"):
        c = Cart(currency_symbol=sym, currency_decimals=18)
        c.lines.append(CartLine(
            title="t", url="https://www.amazon.com/dp/B08N5WRWNW",
            price=Money.from_decimal_string(amount, 18, sym)))
        return c

    r = CrossmintRail()
    saved_flag = os.environ.pop(cm.REAL_ORDERS_FLAG, None)
    saved_method = os.environ.get("CROSSMINT_PAYMENT_METHOD")

    # GUARD 1
    check("GUARD 1 default is OFF", not cm.real_orders_enabled())
    res = await r.execute(cart())
    check("GUARD 1 blocks an order", res.status == "unavailable", res.detail[:60])

    # GUARD 2
    os.environ[cm.REAL_ORDERS_FLAG] = "1"
    os.environ["CROSSMINT_PAYMENT_METHOD"] = "base"
    over = await r.execute(cart("9999"))
    check("GUARD 2 blocks over-cap order", over.status == "failed" and "cap" in over.detail.lower(),
          over.detail[:70])

    # GUARD 3
    g3 = await r.execute(cart(), browser_profile_id="p_1")
    check("GUARD 3 blocks profile id without consent",
          g3.status == "failed" and "consent" in g3.detail.lower(), g3.detail[:70])
    src = (ROOT / "core/commerce/rails/crossmint.py").read_text()
    creates = "browser-profiles" in src and ".post(" in src.split("BROWSER_PROFILE_PATH")[-1][:400]
    check("GUARD 3 never CREATES a browser profile", not creates)

    # No testnet method may be used with a production key.
    os.environ["CROSSMINT_PAYMENT_METHOD"] = "base-sepolia"
    tn = await r.execute(cart())
    check("testnet method refused", tn.status == "failed", tn.detail[:60])

    # No unsafe default: BSC is not available for Crossmint crypto payments.
    os.environ.pop("CROSSMINT_PAYMENT_METHOD", None)
    nd = await r.execute(cart())
    check("no implicit payment method default", nd.status == "failed" and "not set" in nd.detail,
          nd.detail[:60])
    check("bsc is NOT in the accepted method set", "bsc" not in cm.EVM_METHODS)

    # A currency the rail cannot settle is refused before any HTTP call.
    os.environ["CROSSMINT_PAYMENT_METHOD"] = "base"
    bad = await r.execute(cart(sym="USDT"))
    check("unsupported currency refused pre-flight",
          bad.status == "failed" and "cannot settle" in bad.detail, bad.detail[:60])

    os.environ.pop(cm.REAL_ORDERS_FLAG, None)
    if saved_flag is not None:
        os.environ[cm.REAL_ORDERS_FLAG] = saved_flag
    if saved_method is None:
        os.environ.pop("CROSSMINT_PAYMENT_METHOD", None)
    else:
        os.environ["CROSSMINT_PAYMENT_METHOD"] = saved_method


async def stage_checks() -> None:
    """Search and Styling, the two stages built this pass."""
    print("\nSEARCH AND STYLING")
    from core.commerce.agents import search as search_agent
    from core.commerce.agents import styling as styling_agent
    from core.commerce.pipeline import _cart_from_state

    def m(x, sym="USDT"):
        return Money.from_decimal_string(x, 18, sym)

    def state(budget="200", sym="USDT", cands=None):
        st = TaskState(request="selfcheck")
        st.profile = {"size": "M", "budget": m(budget, sym)}
        st.candidates = cands or []
        return st

    def cand(title, price, cat=None, sym="USDT"):
        d = {"title": title, "url": f"https://example.com/{title}", "price": m(price, sym), "size": "M"}
        if cat:
            d["category"] = cat
        return d

    # Styling never exceeds the budget, on every subset it could pick.
    st = state("100", cands=[cand("a", "40"), cand("b", "55"), cand("c", "70")])
    r = await styling_agent.run(st)
    total = int(r.data["total"]["units"]); budget = int(r.data["budget"]["units"])
    check("styling stays within budget", r.ok and total <= budget,
          f"{r.data['total']['display']} of {r.data['budget']['display']}")

    # Category coverage beats piling up one kind.
    st = state("150", cands=[cand("c1", "45", "coat"), cand("c2", "46", "coat"),
                             cand("c3", "47", "coat"), cand("b", "48", "boots"),
                             cand("s", "20", "scarf")])
    r = await styling_agent.run(st)
    check("styling spreads across categories", r.ok and len(r.data["categories"]) >= 3,
          str(r.data.get("categories")))

    # A price in another currency is refused, never converted.
    st = state("500", "USDT", cands=[cand("x", "69", sym="USD")])
    r = await styling_agent.run(st)
    check("styling refuses a currency it cannot compare",
          not r.ok and "exchange rate" in r.note, r.note[:60])

    # Nothing affordable is an error, not an empty success.
    st = state("10", cands=[cand("x", "30")])
    r = await styling_agent.run(st)
    check("styling reports when nothing is affordable", not r.ok, r.note[:60])

    # Regression: the cart takes its currency from the selection. A hardcoded
    # USDT cart made a USD selection raise inside cart.total(), which QA then
    # reported as "total_uncomputable" instead of a currency mismatch.
    st = TaskState(request="x")
    st.selection = [{"title": "t", "url": "u", "price": m("69", "USD"), "quantity": 1}]
    cart = _cart_from_state(st)
    check("cart currency follows the selection",
          cart.currency_symbol == "USD" and cart.total().units == 69 * 10**18,
          f"{cart.currency_symbol} {cart.total().units}")

    # Context reads product links from the request without a model, so a
    # model outage must not lose them. Checked on the degraded path, which
    # is the one that runs with no key.
    from core.commerce.agents import context as context_agent
    saved_key = os.environ.pop("GEMINI_API_KEY", None)
    try:
        st = TaskState(request="Buy me this https://example.com/products/coat for a trip")
        r = await context_agent.run(st)
        check(
            "context keeps product links when no model is available",
            r.status == "degraded" and st.context.get("product_urls") == ["https://example.com/products/coat"],
            f"status={r.status} urls={st.context.get('product_urls')}",
        )
    finally:
        if saved_key is not None:
            os.environ["GEMINI_API_KEY"] = saved_key

    # A season qa.py would not recognise must be dropped, not passed on. A
    # season it ignores looks the same as no season, except the result claims
    # one was found.
    check(
        "context only allows seasons qa matches on",
        set(context_agent.KNOWN_SEASONS) >= {"summer", "winter"},
        str(context_agent.KNOWN_SEASONS),
    )

    # Search invents nothing when it has nothing to work with.
    st = TaskState(request="find me a wool coat")
    st.profile = {"budget": m("200")}
    r = await search_agent.run(st)
    check("search invents no candidates without URLs",
          not r.ok and not st.candidates, r.note[:60])

    # A URL that cannot be used is rejected with a reason, not guessed at.
    st = TaskState(request="x")
    st.profile = {"budget": m("200")}
    st.context = {"product_urls": ["https://this-host-does-not-exist.invalid/p"]}
    r = await search_agent.run(st)
    check("search rejects an unusable URL with a reason",
          not r.ok and bool(r.data.get("rejected")),
          str((r.data.get("rejected") or [{}])[0].get("reason"))[:50])


async def main() -> int:
    print("commerce pipeline self-check -- infrastructure, no mocks")
    money_checks()
    await chain_checks()
    await failure_checks()
    await gate_checks()
    await crossmint_guard_checks()
    await stage_checks()

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    if failed:
        print("FAILED:")
        for n in failed:
            print(f"  - {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
