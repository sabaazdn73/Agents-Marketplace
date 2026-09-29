"""
sign_selfcheck.py

Checks the order path: the signing link, the prepared order, the signing
page's routes and the three MCP tools that prepare and read.

    TE_COST_STORE=file:<dir> ./venv/bin/python scripts/sign_selfcheck.py [--live]

A file cost store is required: this script never reads the database. Offline
by default: LI.FI and the chain reads are replaced by stand-ins that answer
the way they do, so the checks are about this code and not about the network.
--live adds one real LI.FI quote (NVDA, $10, Base, USDC, for a throwaway
address) and one real balance read of LIVE_HOLDER on every chain.

1. The mirror: core/te/buy_chains.py equals frontend/src/trade/chains.js
   (chain ids, names, explorers, pay symbols, addresses, decimals).
2. The link: a minted id decodes to the same order; one changed character,
   a payload re-signed with another key, a payload edited under the old tag,
   an oversized or non-base64 id are each "invalid"; past its expiry it is
   "expired"; marked used it is used; mint refuses every field decode would.
3. Refusals are answers, never exceptions: a bad wallet, amount, slippage,
   pay token, ticker, a key off the chains, a version with no cost.
4. A buy: the lowest measured all-in version is quoted first; the approval is
   the exact amount to LI.FI's approvalAddress and never unlimited; the link
   decodes to the order returned; no route or a failed value check moves to
   the next version, at most two quotes; a 4xx moves on too; a quote paying
   another recipient, or approving or calling a contract other than LI.FI's
   on that chain, is refused; LI.FI unavailable names the version and gives
   no link (partial); quotes_asked counts requests actually sent; as_of is
   the measurement's time.
5. A sell: the version held is chosen, the approval is the exact token
   amount; not held and not enough are refusals; unread chains are said,
   not taken for "not held"; a version with no measured price is checked
   through another version's price per share, and with none at all is
   refused before any quote; absurd amounts are bad_amount.
   The tolerance is one rule for both sides, min(5%, max(2%, 3 x the
   measured cost without gas)) at the size nearest the order: gas never
   widens it (NVDAon on Ethereum at 6.4% under the mid is refused), the cap
   holds, and the signing page is given the same number.
6. The routes: GET /api/sign/{id} is 200 with the order, 404 invalid, 410
   expired, 409 used; POST /done is 204, 400 on a bad hash, 404 invalid.
7. The MCP tools through tools/call: each answers in the envelope under its
   ceiling, and refuses an undeclared or a missing argument by name.

Exit status 0 only when every check passes.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if not os.environ.get("TE_COST_STORE", "").startswith("file:"):
    print("TE_COST_STORE=file:<dir> is required: this check never reads the database.")
    raise SystemExit(2)
os.environ.setdefault("SIGN_LINK_SECRET", "sign-selfcheck-only")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.te import buy_chains, holdings as H, lifi_quote, prepare as P, sign_link as S  # noqa: E402
from mcp_server import envelope, protocol  # noqa: E402

LIVE = "--live" in sys.argv
WALLET = "0x000000000000000000000000000000000000dead"
LIVE_HOLDER = "0x71003e485e0203e5a7a3ee4abcc9629dcbb4c3c5"   # held NVDAc on Base on 2026-09-28
NVDA_BASE = "8453/0xb20000000000000000000078ee7ce2fe4908108c"
NVDA_BNB = "56/0x02fca66c1d1afb4e2a7884261eb00f63598a7436"
SPENDER = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"
FAILURES: list[str] = []
LOOP = asyncio.new_event_loop()


def run(coro):
    return LOOP.run_until_complete(coro)


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


# ── stand-ins for LI.FI and the chain ────────────────────────────────────────

class FakeLifi:
    """Answers like LI.FI: a route whose estimate pays `price` dollars per
    token, or a no-route / 429 per token address."""

    def __init__(self):
        self.calls: list[dict] = []
        self.price = {}           # to_token -> dollars per token (buy) ; from_token -> dollars per token (sell)
        self.no_route: set = set()
        self.min_ratio = 0.995
        self.unavailable = False
        self.kind = "rate"            # what "unavailable" answers
        self.http4xx: set = set()     # token addresses LI.FI answers HTTP 400 for
        self.mutate = None            # a function that bends the quote before it is returned

    async def __call__(self, params):
        self.calls.append(params)
        if self.unavailable:
            return {"ok": False, "kind": self.kind, "reason": f"stand-in LI.FI unavailable ({self.kind})"}
        if params["toToken"] in self.http4xx or params["fromToken"] in self.http4xx:
            return {"ok": False, "kind": "refused", "reason": "LI.FI refused the request (HTTP 400): stand-in"}
        if params["toToken"] in self.no_route or params["fromToken"] in self.no_route:
            return {"ok": False, "kind": "no_route", "reason": "LI.FI found no route: none"}
        cid = int(params["fromChain"])
        stables = {t["address"]: t for t in buy_chains.BUY_CHAINS[cid]["pay"]}
        amt = int(params["fromAmount"])
        from core.te.universe import load_universe
        u = load_universe()
        if params["fromToken"] in stables:                      # buy
            dec_in = stables[params["fromToken"]]["decimals"]
            dec_out = u.record(f"{cid}/{params['toToken']}")["decimals"]
            out = amt / 10 ** dec_in / self.price.get(params["toToken"], 230.0) * 10 ** dec_out
        else:                                                   # sell
            dec_in = u.record(f"{cid}/{params['fromToken']}")["decimals"]
            dec_out = stables[params["toToken"]]["decimals"]
            out = amt / 10 ** dec_in * self.price.get(params["fromToken"], 229.3) * 10 ** dec_out
        q = {"action": {"fromChainId": cid, "toChainId": cid, "fromToken": {"address": params["fromToken"]},
                        "toToken": {"address": params["toToken"], "decimals": dec_out},
                        "fromAmount": params["fromAmount"], "fromAddress": params["fromAddress"],
                        "toAddress": params["toAddress"]},
             "transactionRequest": {"to": SPENDER, "data": "0xabcdef", "from": params["fromAddress"], "chainId": cid},
             "estimate": {"toAmount": str(int(out)), "toAmountMin": str(int(out * self.min_ratio)),
                          "approvalAddress": SPENDER,
                          "feeCosts": [{"name": "LIFI Fixed Fee", "amountUSD": "0.025", "percentage": "0.0025", "included": True}],
                          "gasCosts": [{"amountUSD": "0.01"}], "executionDuration": 0},
             "tool": "okx", "toolDetails": {"name": "OKX Dex Aggregator"},
             "includedSteps": [{"tool": "okx", "action": {"toAddress": lifi_quote.DIAMONDS[cid]}}]}
        q["estimate"]["approvalAddress"] = q["transactionRequest"]["to"] = lifi_quote.DIAMONDS[cid]
        if self.mutate:
            self.mutate(q)
        return {"ok": True, "quote": q, "quoted_at": "2026-09-29T00:00:00Z"}


def fake_reads(balance: int, allowance: int = 0):
    def reads(chain_id, token, wallet, spender):
        return {"read": True, "block": 1, "balance_raw": balance, "allowance_raw": allowance if spender else None}
    return reads


def fake_holdings(rows):
    async def h(wallet):
        return {"wallet": wallet, "holdings": rows, "chains": [],
                "coverage": {"chains_read": ["Base"], "chains_failed": [], "versions_checked": 10,
                             "versions_on_these_chains": 10, "partial": False, "scope": "test"},
                "as_of": None, "method": "test", "cached_seconds": 0.0}
    return h


# ── 1. the mirror ────────────────────────────────────────────────────────────

def parse_chains_js(text: str) -> dict:
    body = text.split("export const BUY_CHAINS = {", 1)[1].split("\n};", 1)[0]
    out = {}
    for m in re.finditer(r"(\d+):\s*\{\s*name:\s*'([^']+)',\s*explorer:\s*'([^']+)',\s*pay:\s*\[(.*?)\]\s*\}", body, re.S):
        pays = [{"symbol": s, "address": a.lower(), "decimals": int(d)} for s, a, d in re.findall(
            r"\{\s*symbol:\s*'([^']+)',\s*address:\s*'(0x[0-9a-fA-F]{40})',\s*decimals:\s*(\d+)\s*\}", m.group(4))]
        out[int(m.group(1))] = {"name": m.group(2), "explorer": m.group(3), "pay": pays}
    return out


def check_mirror() -> None:
    print("\nthe mirror of frontend/src/trade/chains.js")
    js = ROOT.parent / "frontend" / "src" / "trade" / "chains.js"
    if not js.exists():
        check(False, "chains.js is readable", str(js))
        return
    parsed = parse_chains_js(js.read_text())
    check(len(parsed) == 6, "chains.js parsed: six chains", str(sorted(parsed)))
    check(parsed == buy_chains.BUY_CHAINS, "buy_chains.BUY_CHAINS equals chains.js field for field",
          "" if parsed == buy_chains.BUY_CHAINS else json.dumps(
              {c: (parsed.get(c), buy_chains.BUY_CHAINS.get(c)) for c in set(parsed) | set(buy_chains.BUY_CHAINS)
               if parsed.get(c) != buy_chains.BUY_CHAINS.get(c)})[:300])
    # The parser catches a difference. A check that cannot fail is decoration.
    bent = js.read_text().replace("decimals: 6 },\n  ] },\n  42161", "decimals: 7 },\n  ] },\n  42161")
    check(parse_chains_js(bent) != buy_chains.BUY_CHAINS, "a changed decimal in chains.js is caught")


# ── 2. the link ──────────────────────────────────────────────────────────────

def _tamper(link_id: str, i: int) -> str:
    c = link_id[i]
    return link_id[:i] + ("A" if c != "A" else "B") + link_id[i + 1:]


def check_link() -> None:
    print("\nthe signing link")
    check(S.key_source() == "SIGN_LINK_SECRET", "the key comes from SIGN_LINK_SECRET here", S.key_source())
    token = NVDA_BASE.split("/")[1]
    usdc = buy_chains.default_pay(8453)["address"]
    lid, p = S.mint(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=30)
    d = S.decode(lid)
    check(d.status == "ok" and d.payload == p, "a minted id decodes to the same order", d.status)
    check(590 <= d.seconds_left <= 600, "it expires in ten minutes", f"{d.seconds_left} s")
    check(len(lid) < 400 and "=" not in lid, "the id is short and unpadded", f"{len(lid)} chars")
    check(S.link(lid).startswith(S.site_base() + "/sign/"), "the link opens /sign/<id>", S.link(lid)[:48])
    bad = [S.decode(_tamper(lid, i)).status for i in range(len(lid))]
    check(bad == ["invalid"] * len(lid), "every one-character change is invalid, the last character's spare "
          "bits included", f"{bad.count('invalid')} of {len(lid)}")
    raw = S._unb64(lid)
    body, tag = raw[:-S.TAG_BYTES], raw[-S.TAG_BYTES:]
    edited = json.loads(body)
    edited["a"] = "10000"
    forged = S._b64(json.dumps(edited, separators=(",", ":"), sort_keys=True).encode() + tag)
    check(S.decode(forged).detail == "signature", "an amount edited under the old tag is refused", S.decode(forged).detail)
    edited = json.loads(body)
    edited["b"] = 400
    forged = S._b64(json.dumps(edited, separators=(",", ":"), sort_keys=True).encode() + tag)
    check(S.decode(forged).status == "invalid", "b edited under the old tag (to widen the limit) is invalid",
          S.decode(forged).detail)
    no_b = {k: v for k, v in json.loads(body).items() if k != "b"}
    raw_nb = json.dumps(no_b, separators=(",", ":"), sort_keys=True).encode()
    d_nb = S.decode(S._b64(raw_nb + S._tag(raw_nb)))
    check(d_nb.status == "invalid" and d_nb.detail == "fields",
          "an id without b is invalid even when correctly signed: no compatibility path", str(d_nb.detail))
    check(p["b"] == 30 and S.limit_from_b(30) == 0.02 and abs(S.limit_from_b(100) - 0.03) < 1e-12
          and S.limit_from_b(200) == 0.05 and S.limit_from_b(0) == 0.02,
          "limit_from_b: 30 -> 2%, 100 -> 3%, 200 -> 5% cap, 0 -> 2% floor")
    check([S.round_bps(x) for x in (30.5, 30.4999, 2.5, 3.5, 0.5, 55.47, 0.0)] == [31, 30, 3, 4, 1, 55, 0],
          "b is rounded half up", str([S.round_bps(x) for x in (30.5, 30.4999, 2.5, 3.5, 0.5, 55.47, 0.0)]))
    saved = S._KEY
    S._KEY = b"\x01" * 32
    other, _ = S.mint(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=30)
    S._KEY = saved
    check(S.decode(other).status == "invalid", "an id signed with another key is invalid")
    check(S.decode("x" * 600).status == "invalid" and S.decode("not an id!").status == "invalid"
          and S.decode("").status == "invalid", "oversized, non-base64 and empty ids are invalid")
    old, po = S.mint(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=30, ttl=-5)
    check(S.decode(old).status == "expired", "past its expiry it is expired")
    check(S.decode(lid, now=p["e"]).status == "expired", "expired at exactly e, not a second later")
    check(not S.is_used(lid), "not used before done")
    S.mark_used(lid, p["e"])
    check(S.is_used(lid), "used after done")
    refused = []
    for kw in ({"chain_id": 10}, {"pay": token}, {"amount": "0.5"}, {"amount": "10001"}, {"amount": "1e3"},
               {"wallet": "0x" + "0" * 40}, {"max_slippage_bps": 5}, {"max_slippage_bps": 301}, {"side": "x"},
               {"cost_ex_gas_bps": -1}, {"cost_ex_gas_bps": 100_001}, {"cost_ex_gas_bps": 30.0},
               {"cost_ex_gas_bps": True}, {"cost_ex_gas_bps": None}):
        args = {**dict(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=30), **kw}
        try:
            S.mint(**args)
            refused.append(f"{kw} minted")
        except ValueError:
            pass
    check(not refused, "mint refuses a chain, pay token, amount, wallet, slippage or side decode would",
          "; ".join(refused))
    sell, ps = S.mint(side="s", chain_id=8453, token=token, pay=usdc, amount="0.00001", wallet=WALLET, cost_ex_gas_bps=30)
    check(S.decode(sell).status == "ok", "a sell of a fraction of a token is a valid order")


# ── 3. refusals ──────────────────────────────────────────────────────────────

def check_refusals() -> None:
    print("\nrefusals are answers")
    cases = [
        ("bad_wallet", P.prepare_buy("NVDA", 10, "0x123")),
        ("bad_wallet", P.prepare_buy("NVDA", 10, "0x" + "0" * 40)),
        ("bad_amount", P.prepare_buy("NVDA", 0.5, WALLET)),
        ("bad_amount", P.prepare_buy("NVDA", 10001, WALLET)),
        ("bad_amount", P.prepare_buy("NVDA", "10.001", WALLET)),
        ("bad_amount", P.prepare_buy("NVDA", True, WALLET)),
        ("bad_slippage", P.prepare_buy("NVDA", 10, WALLET, max_slippage_bps=5000)),
        ("bad_slippage", P.prepare_buy("NVDA", 10, WALLET, max_slippage_bps=50.5)),
        ("chain_not_supported", P.prepare_buy("solana/Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", 10, WALLET)),
        ("chain_not_supported", P.prepare_buy("10/0xc845b2894dbddd03858fd2d643b4ef725fe0849d", 10, WALLET)),
        ("chain_not_supported", P.prepare_sell("solana/Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "1", WALLET)),
        ("bad_pay_token", P.prepare_buy("NVDA", 10, WALLET, pay_with="DAI")),
        ("bad_pay_token", P.prepare_buy("NVDA", 10, WALLET, pay_with="8453/0x" + "1" * 40)),
        ("unknown_instrument", P.prepare_buy("ZZZZZZ", 10, WALLET)),
        ("unknown_instrument", P.prepare_buy("8453/0x" + "2" * 40, 10, WALLET)),
        ("not_buyable", P.prepare_buy("42161/0xc845b2894dbddd03858fd2d643b4ef725fe0849d", 10, WALLET)),
        ("no_buyable_version", P.prepare_buy("TSM", 10, WALLET, pay_with="8453/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")),
        ("bad_amount", P.prepare_sell(NVDA_BASE, "-1", WALLET)),
        ("bad_amount", P.prepare_sell(NVDA_BASE, "0.000000001", WALLET)),
    ]
    for want, coro in cases:
        try:
            out = run(coro)
            got = out.get("withheld_reason")
            check(got == want and bool(out.get("explanation")), f"{want}", f"{got}: {str(out.get('explanation'))[:90]}")
        except Exception as e:  # noqa: BLE001
            check(False, f"{want} (raised)", f"{type(e).__name__}: {e}")


# ── 4. a buy ─────────────────────────────────────────────────────────────────

def check_buy() -> None:
    print("\na buy, with LI.FI and the chain stood in")
    fake = FakeLifi()
    lifi_quote_orig, reads_orig = lifi_quote.quote, P._wallet_reads
    lifi_quote.quote = fake
    P._wallet_reads = fake_reads(balance=50_000_000, allowance=3_000_000)
    try:
        out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
        check(out.get("chosen", {}).get("key") == NVDA_BASE, "the lowest measured all-in version is chosen",
              str(out.get("chosen", {}).get("key") or out.get("withheld_reason")))
        ranked = [r["allin_per_share"] for r in out["why"]["ranked"]]
        check(ranked == sorted(ranked), "ranked is in all-in order", str(ranked))
        check(len(fake.calls) == 1, "one quote when the first has a route", str(len(fake.calls)))
        c = fake.calls[0]
        check(c["denyExchanges"] == "jupiter" and c["fromAmount"] == "10000000" and c["slippage"] == "0.005"
              and c["toAddress"] == WALLET, "the quote asks for exactly $10 of USDC, 0.5%, Jupiter denied", json.dumps(c)[:120])
        a = out["approval"]
        check(a["amount_raw"] == "10000000" and a["unlimited"] is False and a["spender"] == SPENDER,
              "the approval is the exact amount to LI.FI's approvalAddress, not unlimited", json.dumps(a)[:120])
        check(a["needed"] is True and a["current_allowance_raw"] == "3000000", "an allowance below the amount needs an approval")
        check(str(2 ** 256 - 1) not in json.dumps(out), "no unlimited amount anywhere in the order")
        d = S.decode(out["sign_url"].rsplit("/", 1)[1])
        check(d.status == "ok" and d.payload["t"] == NVDA_BASE.split("/")[1] and d.payload["a"] == "10"
              and d.payload["w"] == WALLET and d.payload["c"] == 8453 and d.payload["m"] == 50,
              "the link carries the order returned", json.dumps(d.payload)[:100])
        check(out["quote"]["source"] == "LI.FI quote" and out["quote"]["quoted_at"], "the quote is labelled and timed")
        check(out["value_check"]["ok"] is True, "the value check passes a fair route")
        check(d.payload["b"] == out["value_check"]["cost_ex_gas_bps"] and isinstance(d.payload["b"], int)
              and S.limit_from_b(d.payload["b"]) == out["value_check"]["limit"],
              "the link's b is the order's cost_ex_gas_bps, and its limit is the order's limit",
              f"b {d.payload['b']}, limit {out['value_check']['limit']}")
        check(out["rules"] == P.RULES, "the rules sentence rides along")
        words = json.dumps(out).lower()
        check(not re.search(r"\b(best|should|recommend|cheapest)\b", words), "no recommendation words in the order")

        fake.calls.clear()
        P._wallet_reads = fake_reads(balance=50_000_000, allowance=10_000_000)
        out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
        check(out["approval"]["needed"] is False, "an allowance at the amount needs no approval")

        fake.calls.clear()
        fake.no_route = {NVDA_BASE.split("/")[1]}
        out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
        check(out.get("chosen", {}).get("key") == NVDA_BNB and len(fake.calls) == 2,
              "no route on the first quotes the next", f"{out.get('chosen', {}).get('key')} after {len(fake.calls)} quotes")
        check("next-lowest" in out["why"]["sentence"] and "no route" in out["why"]["sentence"],
              "and says so", out["why"]["sentence"][:120])
        check(out["order"]["from_amount_raw"] == str(10 * 10 ** 18) and out["approval"]["amount_raw"] == str(10 * 10 ** 18),
              "an 18-decimal pay token is approved exactly", out["approval"]["amount_raw"])

        fake.calls.clear()
        fake.no_route = set()
        fake.min_ratio = 0.9
        out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
        check(out.get("withheld_reason") == "no_route" and len(fake.calls) == 2,
              "a minimum 10% under the estimate fails the value check twice, at most two quotes",
              f"{out.get('withheld_reason')}, {len(fake.calls)} quotes")
        fake.min_ratio = 0.995
        fake.price = {NVDA_BASE.split("/")[1]: 300.0}
        fake.calls.clear()
        out = run(P.prepare_buy(NVDA_BASE, "10", WALLET))
        check(out.get("withheld_reason") == "no_route" and "value check" in (out.get("explanation") or ""),
              "a route paying far fewer tokens than measured is refused", str(out.get("explanation"))[:100])
        fake.price = {}

        for kind in ("rate", "http", "network", "budget"):
            fake.calls.clear()
            fake.unavailable, fake.kind = True, kind
            out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
            check(out.get("quote") is None and out.get("sign_url") is None and out.get("partial") is True
                  and out.get("link_withheld_reason") == "quote_unavailable" and out["chosen"]["key"] == NVDA_BASE
                  and len(fake.calls) == 1,
                  f"LI.FI unavailable ({kind}): the version is named, no link, partial",
                  str(out.get("quote_note"))[:70])
            check(out["quotes_asked"] == (0 if kind == "budget" else 1),
                  f"quotes_asked counts only requests sent ({kind})", str(out["quotes_asked"]))
        fake.unavailable = False

        # HTTP 4xx is LI.FI refusing this route, not LI.FI being away.
        fake.calls.clear()
        fake.http4xx = {NVDA_BASE.split("/")[1]}
        out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
        check(out.get("chosen", {}).get("key") == NVDA_BNB and out.get("sign_url") and out["quotes_asked"] == 2,
              "a 4xx on the first version tries the next", str(out.get("chosen", {}).get("key")))
        fake.http4xx = set()

        # The recipient and LI.FI's contract are pinned.
        diamond = lifi_quote.DIAMONDS[8453]
        for label, bend in (
                ("a quote paying another recipient", lambda q: q["action"].update(toAddress="0x" + "be" * 20)),
                ("a step paying a third address", lambda q: q["includedSteps"][0]["action"].update(toAddress="0x" + "cd" * 20)),
                ("an approval to a contract other than LI.FI's", lambda q: q["estimate"].update(approvalAddress="0x" + "ef" * 20)),
                ("a transaction to a contract other than LI.FI's", lambda q: q["transactionRequest"].update(to="0x" + "ef" * 20))):
            fake.calls.clear()
            fake.mutate = bend
            out = run(P.prepare_buy(NVDA_BASE, "10", WALLET))
            check(out.get("withheld_reason") == "no_route" and not out.get("sign_url"),
                  f"{label} is refused, no link", str(out.get("explanation"))[-80:])
        fake.mutate = None
        check(lifi_quote.DIAMONDS[4663] != diamond and lifi_quote.DIAMONDS[999] != diamond,
              "Robinhood Chain and HyperEVM are pinned to their own LI.FI contracts")

        out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
        o = out.get("order_allin_per_token") or {}
        check(o.get("value_usd") and "from the LI.FI quote" in o.get("basis", "")
              and out["measured"]["allin_per_token"] and out["measured"]["size_usd"] == 100,
              "the order's own all-in price from the quote sits beside the measured one",
              f"{o.get('value_usd')} vs {out['measured']['allin_per_token']} at ${out['measured']['size_usd']}")
        check(out["as_of"] == out["measured"]["measured_at"] and out["quote"]["quoted_at"] != out["as_of"],
              "as_of is the measurement's time, the quote's is quote.quoted_at", out["as_of"])
    finally:
        lifi_quote.quote, P._wallet_reads = lifi_quote_orig, reads_orig


# ── 5. a sell ────────────────────────────────────────────────────────────────

def check_sell() -> None:
    print("\na sell")
    fake = FakeLifi()
    orig = (lifi_quote.quote, P._wallet_reads, P.holdings)
    lifi_quote.quote = fake
    P._wallet_reads = fake_reads(balance=10_000_000)                   # 0.1 NVDAc
    held = [{"key": NVDA_BASE, "symbol": "NVDAc", "ticker": "NVDA", "issuer": "Coinbase", "chain": "Base",
             "chain_id": 8453, "balance": "0.1", "balance_raw": "10000000", "decimals": 8},
            {"key": NVDA_BNB, "symbol": "NVDAB", "ticker": "NVDA", "issuer": "bStocks", "chain": "BNB Chain",
             "chain_id": 56, "balance": "0.02", "balance_raw": str(2 * 10 ** 16), "decimals": 18}]
    P.holdings = fake_holdings(held)
    try:
        out = run(P.prepare_sell("NVDA", "0.05", WALLET))
        check(out.get("chosen", {}).get("key") == NVDA_BASE, "the version held most of is chosen",
              str(out.get("chosen", {}).get("key") or out.get("explanation")))
        a = out["approval"]
        check(a["token"] == NVDA_BASE.split("/")[1] and a["amount_raw"] == "5000000" and a["unlimited"] is False,
              "the approval is the exact token amount", json.dumps(a)[:120])
        check(fake.calls[0]["toToken"] == buy_chains.default_pay(8453)["address"], "received in the chain's first pay token")
        check(out["value_check"]["ran"] and out["value_check"]["ok"], "the value check runs against the measured mid",
              out["value_check"].get("basis", "")[:80])
        d = S.decode(out["sign_url"].rsplit("/", 1)[1])
        check(d.payload["s"] == "s" and d.payload["a"] == "0.05", "the link is a sell of 0.05")
        out = run(P.prepare_sell("NVDA", "0.5", WALLET))
        check(out.get("withheld_reason") == "insufficient_balance", "more than the balance is refused",
              str(out.get("explanation"))[:90])
        P.holdings = fake_holdings([])
        out = run(P.prepare_sell("NVDA", "0.05", WALLET))
        check(out.get("withheld_reason") == "not_held", "a ticker the wallet does not hold is refused")

        async def all_failed(wallet):
            return {"wallet": wallet, "status": "unavailable", "holdings": [], "chains": [],
                    "coverage": {"chains_read": [], "chains_failed": [{"chain": "Base", "reason": "RPC error"}],
                                 "versions_checked": 0, "versions_on_these_chains": 10, "partial": True}}

        async def some_failed(wallet):
            return {"wallet": wallet, "status": "partial", "holdings": [], "chains": [],
                    "coverage": {"chains_read": ["Ethereum"], "chains_failed": [{"chain": "Base", "reason": "RPC error"}],
                                 "versions_checked": 5, "versions_on_these_chains": 10, "partial": True}}
        P.holdings = all_failed
        out = run(P.prepare_sell("NVDA", "0.05", WALLET))
        check(out.get("withheld_reason") == "chains_unavailable", "no chain read is chains_unavailable, not not_held",
              str(out.get("explanation"))[:80])
        P.holdings = some_failed
        out = run(P.prepare_sell("NVDA", "0.05", WALLET))
        check(out.get("withheld_reason") == "not_held_on_chains_read" and "Base" in out.get("explanation", ""),
              "some chains unread and none held names the unread chains", str(out.get("explanation"))[:90])
        P.holdings = fake_holdings(held)

        for amt in ("1000000000000000000", "123456789012345678901", "1e30"):
            out = run(P.prepare_sell(NVDA_BASE, amt, WALLET))
            check(out.get("withheld_reason") == "bad_amount", f"a sell of {amt} tokens is bad_amount, not a crash")

        # A version with no measured pool price: another version's price per
        # share through its read share ratio, else no link at all.
        fake.calls.clear()
        P._wallet_reads = fake_reads(balance=10 ** 30)
        out = run(P.prepare_sell("1/0xc845b2894dbddd03858fd2d643b4ef725fe0849d", "1", WALLET))
        check(out.get("sign_url") and out["value_check"]["ran"] and "per share" in out["measured"]["basis"],
              "NVDAx on Ethereum (not a venue) is checked through another version's price per share",
              out.get("measured", {}).get("basis", str(out.get("explanation")))[:110])
        fake.price = {"0xc845b2894dbddd03858fd2d643b4ef725fe0849d": 0.01}
        out = run(P.prepare_sell("1/0xc845b2894dbddd03858fd2d643b4ef725fe0849d", "1", WALLET))
        check(out.get("withheld_reason") == "value_check_failed" and not out.get("sign_url"),
              "and a route paying a cent for it is refused", str(out.get("explanation"))[:90])
        fake.price = {}
        fake.calls.clear()
        out = run(P.prepare_sell("56/0xa9ee28c80f960b889dfbd1902055218cba016f75", "1", WALLET))
        check(out.get("withheld_reason") == "no_reference_price" and not out.get("sign_url") and not fake.calls,
              "NVDAon on BNB Chain (no pool price, no share ratio) is refused before any quote",
              str(out.get("explanation"))[:100])
        # ONE TOLERANCE, WITHOUT GAS. NVDAon on Ethereum measured 543 bps
        # all-in at $100, nearly all of it gas; under the old rule its limit
        # was 16%, and a route paying 6.4% under the mid got a link.
        nvdaon_eth = "1/0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee"
        fake.price = {nvdaon_eth.split("/")[1]: 215.0}
        out = run(P.prepare_sell(nvdaon_eth, "1", WALLET))
        vc = out.get("value_check") or {}
        check(out.get("withheld_reason") == "value_check_failed" and not out.get("sign_url")
              and vc.get("limit_pct") == 2.0 and vc.get("cost_ex_gas_bps", 999) < 100,
              "NVDAon on Ethereum sold 6.4% under the mid is refused: its limit is 2%, gas left out",
              f"limit {vc.get('limit_pct')}% from {vc.get('cost_ex_gas_bps')} bps ex gas")
        fake.price = {nvdaon_eth.split("/")[1]: 228.0}
        out = run(P.prepare_sell(nvdaon_eth, "1", WALLET))
        check(out.get("sign_url") and out["tolerance"]["limit_pct"] == out["value_check"]["limit_pct"],
              "and at 0.7% under it passes, the tolerance shown in the order", str(out.get("tolerance"))[:100])
        sb = S.decode(out["sign_url"].rsplit("/", 1)[1]).payload["b"]
        check(sb == out["value_check"]["cost_ex_gas_bps"] == 55 and S.limit_from_b(sb) == out["value_check"]["limit"],
              "a sale's link carries b = 55 (55.47 rounded) and its limit", f"b {sb}")
        fake.price = {}
        fake.http4xx = {NVDA_BASE.split("/")[1]}
        out = run(P.prepare_sell(NVDA_BASE, "0.05", WALLET))
        check(out.get("withheld_reason") == "no_route", "a 4xx on a sell is a refusal", str(out.get("explanation"))[:80])
        fake.http4xx = set()
        fake.unavailable, fake.kind = True, "http"
        out = run(P.prepare_sell(NVDA_BASE, "0.05", WALLET))
        check(out.get("sign_url") is None and out.get("partial") is True and out["chosen"]["key"] == NVDA_BASE,
              "LI.FI unavailable on a sell: the version named, no link, partial")
        fake.unavailable = False
    finally:
        lifi_quote.quote, P._wallet_reads, P.holdings = orig


# ── 6. the routes ────────────────────────────────────────────────────────────

def check_routes() -> None:
    print("\nGET /api/sign/{id} and POST /done, through the router")
    from te.sign_router import router
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    token, usdc = NVDA_BASE.split("/")[1], buy_chains.default_pay(8453)["address"]
    lid, _ = S.mint(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=30)
    r = c.get(f"/api/sign/{lid}")
    b = r.json()
    check(r.status_code == 200 and b["status"] == "ok", "a fresh id is 200", str(r.status_code))
    check(b["token"]["symbol"] == "NVDAc" and b["chain"]["name"] == "Base" and b["pay_token"]["symbol"] == "USDC"
          and b["amount"] == {"usd": "10"} and b["from_amount_raw"] == "10000000" and b["wallet"] == WALLET,
          "it names the token, chain, pay token, amount and wallet", json.dumps(b)[:100])
    check(b["reference"] and b["reference"]["allin_per_token"] and b["controls"] and b["eligibility"]
          and 590 <= b["seconds_left"] <= 600, "with the measured reference, controls, eligibility and time left")
    check(r.headers.get("cache-control") == "no-store", "never cached")
    check("quote" not in b, "no quote is served here")
    vc = b.get("value_check") or {}
    check(vc.get("limit") == 0.02 and vc.get("rule") == P.LIMIT_RULE and vc.get("reference_price_usd")
          and "without gas" in vc.get("reference_basis", "") and vc.get("cost_ex_gas_bps") == 30,
          "the buy page gets the server's own check: reference, limit, rule and b", json.dumps(vc)[:110])
    for b_, want in ((100, 0.03), (250, 0.05), (0, 0.02)):
        bid, _ = S.mint(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=b_)
        v = c.get(f"/api/sign/{bid}").json().get("value_check") or {}
        check(v.get("cost_ex_gas_bps") == b_ and abs(v.get("limit") - want) < 1e-12
              and v.get("limit") == S.limit_from_b(b_),
              f"the view's limit is limit_from_b(b) for b = {b_}, whatever the store says now", str(v.get("limit")))
    check(c.get(f"/api/sign/{_tamper(lid, 30)}").status_code == 404, "a changed id is 404")
    check(c.get("/api/sign/abc").json() == {"reason": "invalid"}, "a malformed id is 404 invalid")
    old, _ = S.mint(side="b", chain_id=8453, token=token, pay=usdc, amount="10", wallet=WALLET, cost_ex_gas_bps=30, ttl=-1)
    r = c.get(f"/api/sign/{old}")
    check(r.status_code == 410 and r.json()["reason"] == "expired", "an expired id is 410", r.text[:80])
    r = c.post(f"/api/sign/{old}/done", json={"tx": "0x" + "c" * 64})
    check(r.status_code == 410 and not S.is_used(old), "done on an expired id is 410 and does not mark it", r.text[:60])
    S.mark_used(old, 0)
    check(c.get(f"/api/sign/{old}").status_code == 410, "an expired id is 410 even when marked used: expired first")
    check(c.post(f"/api/sign/{lid}/done", json={"tx": "0x12"}).status_code == 400, "a bad hash is 400")
    check(c.post(f"/api/sign/{lid}/done", content=b"not json").status_code == 400, "a bad body is 400")
    check(c.post(f"/api/sign/{lid}/done", content=b"x" * 600).status_code == 413, "a large body is 413")
    check(c.post(f"/api/sign/{_tamper(lid, 30)}/done", json={"tx": "0x" + "a" * 64}).status_code == 404,
          "done on a changed id is 404")
    r = c.post(f"/api/sign/{lid}/done", json={"tx": "0x" + "a" * 64})
    check(r.status_code == 204 and r.content == b"", "done is 204", str(r.status_code))
    r = c.get(f"/api/sign/{lid}")
    check(r.status_code == 409 and r.json() == {"reason": "used"}, "then the id is 409 used", r.text)
    sid, _ = S.mint(side="s", chain_id=8453, token=token, pay=usdc, amount="0.05", wallet=WALLET, cost_ex_gas_bps=30)
    b = c.get(f"/api/sign/{sid}").json()
    check(b.get("side") == "sell" and b["pay_token"]["role"] == "receive" and b["from_amount_raw"] == "5000000",
          "a sell id reads as a sell of exact token units", json.dumps(b.get("amount")))
    vc = b.get("value_check") or {}
    check(vc.get("limit") == 0.02 and vc.get("rule") == P.LIMIT_RULE and vc.get("reference_price_usd"),
          "the sell page gets the same rule and number", json.dumps(vc)[:110])
    check(b["reference"] and b["reference"]["size_usd"] == vc.get("size_usd")
          and b["reference"]["mid_usd"] == vc.get("reference_price_usd"),
          "a sell's reference cell is at the size the check uses, with the same mid",
          f"{b['reference'] and b['reference']['size_usd']} vs {vc.get('size_usd')}")


# ── 7. the MCP tools ─────────────────────────────────────────────────────────

def check_tools() -> None:
    print("\nthe three tools through tools/call")
    fake = FakeLifi()
    orig = (lifi_quote.quote, P._wallet_reads, H.holdings)
    lifi_quote.quote = fake
    P._wallet_reads = fake_reads(balance=50_000_000)
    H.holdings = fake_holdings([{"key": NVDA_BASE, "symbol": "NVDAc", "ticker": "NVDA", "issuer": "Coinbase",
                                 "chain": "Base", "chain_id": 8453, "balance": "0.1", "balance_raw": "10000000",
                                 "decimals": 8}])

    def call(name, args):
        r = run(protocol.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": name, "arguments": args}}, {}))
        text = r["result"]["content"][0]["text"]
        return json.loads(text), len(text.encode()), r["result"].get("isError")

    try:
        out, n, err = call("tnega_prepare_buy", {"query": "NVDA", "usd_amount": 10, "wallet": WALLET, "pay_with": "USDC"})
        check(not err and out["value"] and out["value"]["chosen"]["key"] == NVDA_BASE, "tnega_prepare_buy answers",
              str(out.get("withheld_reason")))
        check(n <= envelope.CEILINGS["tnega_prepare_buy"] and out["as_of"] == out["value"]["measured"]["measured_at"]
              and out["value"]["quote"]["quoted_at"] == "2026-09-29T00:00:00Z"
              and out["coverage"]["partial"] is False and out["coverage"]["quotes_asked"] == 1 and out["served_at"],
              "in the envelope, under its ceiling, as_of the measurement and the quote time in the quote",
              f"{n} bytes, as_of {out['as_of']}")
        check(any("sign each transaction in your own wallet" in c for c in out["caveats"]), "the rules are a caveat")
        out, n, _ = call("tnega_prepare_sell", {"query": NVDA_BASE, "token_amount": "0.05", "wallet": WALLET})
        check(out["value"] and out["value"]["side"] == "sell" and n <= envelope.CEILINGS["tnega_prepare_sell"],
              "tnega_prepare_sell answers under its ceiling", f"{n} bytes; {out.get('withheld_reason')}")
        out, n, _ = call("tnega_wallet_holdings", {"wallet": WALLET})
        check(isinstance(out["value"], list) and out["value"][0]["key"] == NVDA_BASE and "chains_read" in out["coverage"],
              "tnega_wallet_holdings answers with its coverage", f"{n} bytes")
        H.holdings = fake_holdings([])
        out, _, _ = call("tnega_wallet_holdings", {"wallet": WALLET})
        check(out["value"] == [] and out["withheld_reason"] is None and out["coverage"]["partial"] is False
              and out["caveats"][0].startswith("None held on the six chains read"),
              "every chain read and nothing held: an empty list with a caveat, not withheld", out["caveats"][0][:70])
        failed = [{"chain": "Base", "reason": "RPC error"}]

        def status_holdings(status, read):
            async def h(wallet):
                return {"wallet": wallet, "status": status, "holdings": [], "chains": [],
                        "coverage": {"chains_read": read, "chains_failed": failed, "versions_checked": 0,
                                     "versions_on_these_chains": 10, "partial": True},
                        "as_of": None, "method": "test", "cached_seconds": 0.0}
            return h
        H.holdings = status_holdings("unavailable", [])
        out, _, _ = call("tnega_wallet_holdings", {"wallet": WALLET})
        check(out["withheld_reason"] == "chains_unavailable", "no chain read is chains_unavailable, not none_held",
              out["caveats"][0][:80])
        H.holdings = status_holdings("partial", ["Ethereum"])
        out, _, _ = call("tnega_wallet_holdings", {"wallet": WALLET})
        check(out["withheld_reason"] == "none_held_on_chains_read" and "Base" in out["caveats"][0],
              "some chains unread names them: none_held_on_chains_read", out["caveats"][0][:90])
        out, _, _ = call("tnega_prepare_buy", {"query": "NVDA", "usd_amount": 10, "wallet": WALLET,
                                               "pay_with": "USDC", "max_slippage_bps": 50.0})
        check(out["value"] and out["value"]["order"]["max_slippage_bps"] == 50, "max_slippage_bps 50.0 is 50")
        fake.unavailable, fake.kind = True, "rate"
        out, _, _ = call("tnega_prepare_buy", {"query": "NVDA", "usd_amount": 10, "wallet": WALLET, "pay_with": "USDC"})
        check(out["coverage"]["partial"] is True and out["value"]["sign_url"] is None
              and out["withheld_reason"] == "quote_unavailable" and out["caveats"][0].startswith("Partial"),
              "through MCP, LI.FI unavailable is partial with the reason first and no link", out["caveats"][0][:90])
        fake.unavailable = False
        for name, args, want in (
                ("tnega_prepare_buy", {"query": "NVDA", "usd_amount": 10, "wallet": WALLET, "chain": 8453}, "filter_not_supported"),
                ("tnega_prepare_buy", {"query": "NVDA", "wallet": WALLET}, "missing_argument"),
                ("tnega_prepare_sell", {"query": "NVDA", "wallet": WALLET, "amount": 1}, "filter_not_supported"),
                ("tnega_wallet_holdings", {}, "missing_argument"),
                ("tnega_wallet_holdings", {"wallet": "0xabc"}, "bad_wallet"),
                ("tnega_prepare_buy", {"query": "NVDA", "usd_amount": 50000, "wallet": WALLET}, "bad_amount")):
            out, _, _ = call(name, args)
            check(out["withheld_reason"] == want and out["value"] is None, f"{name} refuses: {want}",
                  out["caveats"][0][:90] if out["caveats"] else "")
    finally:
        lifi_quote.quote, P._wallet_reads, H.holdings = orig


# ── the tolerance rule ───────────────────────────────────────────────────────

def check_tolerance() -> None:
    print("\nthe tolerance: min(5%, max(2%, 3 x cost without gas))")
    base = {"symbol": "T", "block": 1, "status": ["filled"] * len(P.SIZES), "gas_ctx": {"l1_fee_usd": 0.5}}

    def doc(pool_bps: float, gas: float) -> dict:
        cost = [s * pool_bps / 1e4 + gas + 0.5 for s in P.SIZES]
        return {**base, "cost_usd": cost, "gas_usd": [gas] * len(P.SIZES), "paid_per_token": [100.0] * len(P.SIZES),
                "mid_usd": [99.7] * len(P.SIZES)}
    t = P.tolerance(doc(30, 0.01), 100)
    check(t["limit"] == 0.02 and t["cost_ex_gas_bps"] == 30.0, "30 bps without gas is the 2% floor", str(t["limit_pct"]))
    t = P.tolerance(doc(100, 0.01), 100)
    check(abs(t["limit"] - 0.03) < 1e-9, "100 bps is 3 x 100 bps = 3%", str(t["limit_pct"]))
    t = P.tolerance(doc(400, 0.01), 100)
    check(t["limit"] == 0.05, "400 bps is capped at 5%", str(t["limit_pct"]))
    t1, t2 = P.tolerance(doc(30, 0.01), 100), P.tolerance(doc(30, 50.0), 100)
    check(t1["limit"] == t2["limit"] and t1["cost_ex_gas_bps"] == t2["cost_ex_gas_bps"],
          "$50 of gas on a $100 size does not widen it", f"{t1['limit_pct']}% vs {t2['limit_pct']}%")
    d = doc(30, 0.01)
    d["status"] = ["partial"] * 3 + ["filled"] * (len(P.SIZES) - 3)
    t = P.tolerance(d, 100)
    check(t["size_usd"] == 1000, "the nearest FILLED size when the nearest size did not fill", str(t["size_usd"]))
    t = P.tolerance(doc(30, 0.01), 4000)
    check(t["size_usd"] == 5000, "the measured size nearest the order's dollar value", str(t["size_usd"]))
    d = doc(30, 0.01)
    d["mid_usd"] = [None] * len(P.SIZES)
    d["mid_usd"][6] = 100.0
    t = P.tolerance(d, 100)
    check(t["size_usd"] == P.SIZES[6], "a filled cell with no mid is passed over, not used", str(t["size_usd"]))
    d["mid_usd"] = [None] * len(P.SIZES)
    check(P.tolerance(d, 100) is None and P._mid_near(d, 100) is None,
          "a version filled everywhere but with no mid has no tolerance and no reference")
    # End to end: a stored version filled at every size but with no mid,
    # and no other version to stand in, is refused, not a tool failure.
    class OneDoc:
        async def costs_for(self, ticker):
            return [{**d, "key": "8453/0x" + "ab" * 20, "comparable": False, "share_ratio": None}]
    saved_store = P.get_store
    P.get_store = lambda: OneDoc()
    try:
        ref, why = run(P._sell_reference("T", "8453/0x" + "ab" * 20, "T", P.Decimal("1")))
        check(ref is None and "no measured pool price" in (why or ""),
              "_sell_reference over a filled cell with no mid answers a reason", str(why)[:80])
    except Exception as e:  # noqa: BLE001
        check(False, "_sell_reference over a filled cell with no mid answers a reason", f"raised {type(e).__name__}")
    finally:
        P.get_store = saved_store
    price, tol, basis = P._buy_reference(doc(30, 5.0), 100)
    check(price == round(100.0 * 1.0025, 6) and "without gas" in basis,
          "a buy's reference price is the pool's price with LI.FI's fee and no gas", f"{price}")


# ── the keyless budget ───────────────────────────────────────────────────────

def check_budget() -> None:
    print("\nthe keyless LI.FI budget")
    saved = (list(lifi_quote._times), os.environ.pop("LIFI_API_KEY", None))
    lifi_quote._times.clear()
    try:
        got = [lifi_quote._take() for _ in range(lifi_quote.KEYLESS_PER_MINUTE + 1)]
        check(all(g is None for g in got[:-1]) and got[-1] and "last minute" in got[-1],
              f"the {lifi_quote.KEYLESS_PER_MINUTE + 1}th keyless quote in a minute is refused, and says why",
              str(got[-1])[:90])
        lifi_quote._times.clear()
        now = time.time()
        lifi_quote._times.extend(now - 3600 + i for i in range(lifi_quote.KEYLESS_BUDGET))
        check("2 hours" in (lifi_quote._take() or ""), "the 2-hour budget still holds")
        check(lifi_quote.TIMEOUT_S <= 8 and H.DEADLINE_S <= 10, "LI.FI waits at most 8 s, holdings at most 10 s",
              f"{lifi_quote.TIMEOUT_S} s, {H.DEADLINE_S} s")
    finally:
        lifi_quote._times.clear()
        lifi_quote._times.extend(saved[0])
        if saved[1]:
            os.environ["LIFI_API_KEY"] = saved[1]


# ── live ─────────────────────────────────────────────────────────────────────

def check_live() -> None:
    print("\nlive: one LI.FI quote and one balance read")
    out = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="8453/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"))
    if out.get("withheld_reason") == "reference_stale":
        check(True, "the stored reference is stale on the real clock, so no quote is asked and no link is made "
                    "(rebuild the file store to run the live quote)", out["explanation"][:100])
    q = out.get("quote") or {}
    check(bool(q) or out.get("withheld_reason") == "reference_stale", "LI.FI quoted NVDA, $10, Base, USDC",
          out.get("quote_note") or out.get("explanation") or "")
    if q:
        check(bool(out.get("sign_url")) and P._stale(out["as_of"]) is None,
              "on a reference under 30 minutes old, a link", f"reference measured {out['as_of']}")
    if q:
        print(f"        {q['quoted_at']}: {q['from_amount_raw']} USDC raw -> expected {q['to_amount_expected']}, "
              f"min {q['to_amount_min']} {out['chosen']['symbol']}; route {', '.join(q['route'])}; fees "
              f"{json.dumps(q['fees'])}; gas ${q['gas_usd']}; approval to {q['approval_address']}")
        print(f"        value check: {json.dumps(out['value_check'])}")
    t0 = time.monotonic()
    h = H.wallet_holdings(LIVE_HOLDER)
    check(not h["coverage"]["partial"] and any(x["key"] == NVDA_BASE for x in h["holdings"]),
          "the live holder holds NVDAc on Base, every chain read", f"{time.monotonic() - t0:.1f} s")
    for x in h["holdings"]:
        print(f"        {x['symbol']:8} {x['chain']:16} {x['balance']:>24}  block {x['block']}")
    print(f"        chains read: {', '.join(h['coverage']['chains_read'])}; failed: {h['coverage']['chains_failed']}; "
          f"versions checked {h['coverage']['versions_checked']}")


# ── the reference's age ──────────────────────────────────────────────────────

FIXTURE_NOW = None


def fixture_clock() -> float:
    """The file store's measurements are from one day's live answers, so the
    offline checks run on a clock one minute after NVDAc on Base was
    measured (the version most checks use)."""
    from core.te.cost_store import get_store
    at = next(d["computed_at"] for d in run(get_store().costs_for("NVDA")) if d["key"] == NVDA_BASE)
    return P.dt.datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() + 60


def check_stale() -> None:
    print("\nthe reference's age: no link on a price over 30 minutes old")
    fake = FakeLifi()
    orig = (lifi_quote.quote, P._wallet_reads, P._now)
    lifi_quote.quote = fake
    P._wallet_reads = fake_reads(balance=10 ** 30)
    try:
        for shift, want, label in ((29 * 60, None, "29 minutes after the measurement: a link"),
                                   (31 * 60, "reference_stale", "31 minutes after: reference_stale, no link"),
                                   (-6 * 60, "reference_stale", "a measurement 5+ minutes in the future: refused too")):
            P._now = lambda s=shift: FIXTURE_NOW - 60 + s
            fake.calls.clear()
            b = run(P.prepare_buy("NVDA", "10", WALLET, pay_with="USDC"))
            k = run(P.prepare_buy(NVDA_BASE, "10", WALLET))
            sl = run(P.prepare_sell(NVDA_BASE, "0.05", WALLET))
            got = [x.get("withheld_reason") for x in (b, k, sl)]
            links = [bool(x.get("sign_url")) for x in (b, k, sl)]
            check(got == [want] * 3 and links == [want is None] * 3 and (want is None or not fake.calls),
                  f"{label} (buy by ticker, by key, sell)",
                  f"{got}; LI.FI asked {len(fake.calls)}x" + ("" if want is None else f"; {str(b.get('explanation'))[:80]}"))
    finally:
        lifi_quote.quote, P._wallet_reads, P._now = orig


def main() -> int:
    global FIXTURE_NOW
    FIXTURE_NOW = fixture_clock()
    P._now = lambda: FIXTURE_NOW
    check_mirror()
    check_link()
    check_refusals()
    check_buy()
    check_sell()
    check_routes()
    check_tools()
    check_tolerance()
    check_budget()
    check_stale()
    if LIVE:
        # The live run uses the real clock: the file store must have been
        # rebuilt from the live API within 30 minutes (scratchpad
        # build_filestore.py), or the honest answer is reference_stale.
        P._now = time.time
        check_live()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
        return 1
    print("all passed" + ("" if LIVE else " (offline; --live adds a real LI.FI quote and a real balance read)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
