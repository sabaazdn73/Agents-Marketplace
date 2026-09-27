"""
baskets_selfcheck.py

Checks /api/baskets/curated, /api/baskets/{code} and /api/baskets/evaluate
through the routes themselves (FastAPI TestClient over the real routers),
against /api/te/underlying served from the same cost store.

    TE_COST_STORE=file:<dir> ./venv/bin/python scripts/baskets_selfcheck.py

With TE_COST_STORE unset it reads Mongo (core/db.py). Run it while the cost
worker is idle: a refresh between two reads makes them disagree.

1. The curated file: every version of every basket has 1 to 5 legs, each
   underlying once, integer weights summing to exactly 10,000; codes unique.
2. Selection rule: every current curated leg has a filled, ranked version at
   $1,000 in the engine now.
3. Legs match the engine, for every curated basket at every measured size and
   for ad-hoc baskets: measured_at_usd is the smallest stop at or above the
   leg's amount; a filled leg's key, cost_bps, allin_per_share, chain, issuer
   and symbol equal what /api/te/underlying serves at that stop (the best, or
   the pinned version k); a leg that fills but is not ranked is not_ranked
   with that reason; a pinned version that does not fill says so; a leg under
   $100 is flagged and costed from the measured parts.
4. The basket's cost is the weighted sum of the legs' costs (recomputed
   here), null exactly when a leg is not priced, with each such leg and its
   reason in cost_reason; cost_at_size agrees with the list at each stop.
5. The cap equals a hand calculation from /api/te/underlying at every stop,
   with the per-leg S_i and cap_lower_bound; a missing cap names its legs.
6. Prompts: signatures == swaps == priced legs == evm + nonevm; by_chain
   covers the priced legs once; the basis text states the same numbers.
7. /evaluate: legs= and b= give the curated answer for the same legs; every
   malformed request (non-ASCII digits, a non-integer size, bad base64url or
   JSON, a duplicate JSON key, a k of another underlying, ...) is a 400
   with {error, reason}; padded b= answers as unpadded; b_param (the
   canonical link, pinned versions included) round-trips.
8. No invented figures: value, return, series and followers are null with a
   reason, and the engine has no price-history module to take them from (if
   one is added, this check fails until the basket figures are wired to it).

Exit status 0 only when every check passes.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.te import baskets as B  # noqa: E402
from core.te.cost import SIZES  # noqa: E402
from te.baskets_router import router as baskets_router  # noqa: E402
from te.router import router as te_router  # noqa: E402

FAILS: list[str] = []
PASSES = 0


def check(ok: bool, what: str) -> None:
    global PASSES
    if ok:
        PASSES += 1
    else:
        FAILS.append(what)
        print("FAIL", what)


def b64raw(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def b64(obj) -> str:
    return b64raw(json.dumps(obj).encode())


def near(a, b, tol=1e-3) -> bool:
    return a is not None and b is not None and abs(a - b) <= tol


def main() -> int:
    app = FastAPI()
    app.include_router(te_router)
    app.include_router(baskets_router)
    c = TestClient(app)

    # 1. the file
    doc = B.load_curated()
    codes = [b["code"] for b in doc["baskets"]]
    check(len(codes) == len(set(codes)), "curated codes are unique")
    for b in doc["baskets"]:
        for ch in b["changes"]:
            ws = [x["weight_bps"] for x in ch["legs"]]
            us = [x["underlying"] for x in ch["legs"]]
            check(1 <= len(ws) <= 5, f"{b['code']} v{ch['version']}: 1 to 5 legs")
            check(sum(ws) == 10_000, f"{b['code']} v{ch['version']}: weights sum to 10,000 (got {sum(ws)})")
            check(all(isinstance(w, int) and w > 0 for w in ws), f"{b['code']} v{ch['version']}: integer weights > 0")
            check(len(set(us)) == len(us), f"{b['code']} v{ch['version']}: each underlying once")
        check([ch["version"] for ch in b["changes"]] == list(range(1, len(b["changes"]) + 1)),
              f"{b['code']}: versions run 1, 2, ...")

    # underlying pages, memoised per (ticker, size)
    upage: dict = {}

    def under(t: str, s: int) -> dict:
        if (t, s) not in upage:
            r = c.get(f"/api/te/underlying/{t}", params={"size": s})
            upage[(t, s)] = r.json() if r.status_code == 200 else {"_status": r.status_code, "versions": []}
        return upage[(t, s)]

    def served(t: str, s: int, k: str | None = None) -> dict | None:
        """The version /underlying serves for this leg: the pinned one (any
        state), or the best (None when there is no best)."""
        u = under(t, s)
        key = k or (u.get("best") or {}).get("key")
        return next((v for v in u["versions"] if v["key"] == key), None) if key else None

    def hand_cap(t: str, k: str | None) -> int | None:
        si = None
        for s in SIZES:
            v = served(t, s, k)
            if v is not None and v["state"] == "filled" and v["cost_bps"] <= B.THRESHOLD_BPS:
                si = s
        return si

    counts = {"below_stop": 0, "not_ranked": 0, "pinned_filled": 0, "pinned_unfilled": 0}

    def check_breakdown(label: str, legs: list[tuple], body: dict, s: int) -> None:
        weighted, complete = 0.0, True
        caps = {}
        for (t, w, k), leg in zip(legs, body["legs"]):
            tag = f"{label}@{s} {t}"
            need = s * w / 10_000
            stop = min(x for x in SIZES if x >= need)
            check(leg["ticker"] == t and leg["weight_bps"] == w, f"{tag}: leg order and weights as given")
            check(leg["measured_at_usd"] == stop, f"{tag}: measured at {stop} (got {leg['measured_at_usd']})")
            check(leg["below_smallest_stop"] == (need < SIZES[0]), f"{tag}: below_smallest_stop flag")
            v = served(t, stop, k)
            if k is not None:
                check(leg.get("pinned") is True, f"{tag}: pinned leg says so")
            ok = v is not None and v["state"] == "filled"
            if not ok:
                complete = False
                check(leg["state"] != "filled" and leg.get("cost_bps") is None and leg.get("leg_cost_bps") is None,
                      f"{tag}: not priced where /underlying has no {'filled pinned version' if k else 'best'}")
                if k is not None:
                    counts["pinned_unfilled"] += 1
                    check(leg["state"] == "unfilled" and "chosen version" in (leg.get("reason") or ""),
                          f"{tag}: pinned version that does not fill says so")
                elif any(x["state"] == "filled" for x in under(t, stop)["versions"]):
                    counts["not_ranked"] += 1
                    check(leg["state"] == "not_ranked" and "not ranked (share ratio not read)" in leg["reason"],
                          f"{tag}: fills but unranked -> not_ranked with that reason")
                else:
                    check(leg["state"] == "unfilled" and "does not fill" in (leg.get("reason") or ""),
                          f"{tag}: no fill -> unfilled with a reason")
            else:
                if k is not None:
                    counts["pinned_filled"] += 1
                check(leg["state"] == "filled" and leg["key"] == v["key"],
                      f"{tag}: key {leg.get('key')} == /underlying {v['key']}")
                check(leg.get("cost_bps") == v["cost_bps"] and leg.get("allin_per_share") == v.get("allin_per_share"),
                      f"{tag}: cost_bps and allin_per_share equal /underlying's")
                check(leg.get("chain") == v["chain"] and leg.get("issuer") == v["issuer"] and leg.get("symbol") == v["symbol"],
                      f"{tag}: chain, issuer and symbol equal /underlying's")
                if need < SIZES[0]:
                    counts["below_stop"] += 1
                    p = v["cost_parts"]
                    usd = (p["pool_usd"] / stop + 0.0025) * need + p["gas_usd"] + (p.get("l1_fee_usd") or 0)
                    exp = usd / need * 10_000
                else:
                    exp = v["cost_bps"]
                check(near(leg["leg_cost_bps"], exp), f"{tag}: leg_cost_bps {leg['leg_cost_bps']} == {exp:.4f}")
                weighted += w * exp / 10_000
            si = hand_cap(t, k)
            caps[t] = (si * 10_000) // w if si is not None else None
            check(leg["cap_stop_usd"] == si and leg["cap_usd"] == caps[t], f"{tag}: leg cap S_i {si}")
            check(leg["cap_lower_bound"] == (si == SIZES[-1]), f"{tag}: per-leg cap_lower_bound")
        if complete:
            check(near(body["cost_bps"], weighted), f"{label}@{s}: cost {body['cost_bps']} == weighted sum {weighted:.4f}")
            check(near(body["cost_usd"], weighted * s / 10_000, 1e-2), f"{label}@{s}: cost_usd == cost_bps x size")
            check(not body["unfilled_legs"] and body["cost_reason"] is None, f"{label}@{s}: complete, no unfilled")
        else:
            miss = [x for x in body["legs"] if x["state"] != "filled"]
            check(body["cost_bps"] is None and body["cost_usd"] is None and len(body["unfilled_legs"]) == len(miss),
                  f"{label}@{s}: cost null, every unpriced leg listed")
            check(all(x["ticker"] in body["cost_reason"] and x["reason"] in body["cost_reason"] for x in miss),
                  f"{label}@{s}: cost_reason names each unpriced leg with its reason")
            if any(x["state"] == "not_ranked" for x in miss):
                check("not ranked (share ratio not read)" in body["cost_reason"], f"{label}@{s}: cost_reason says not ranked")
        hc = min(caps.values()) if all(x is not None for x in caps.values()) else None
        check(body["cap_usd"] == hc, f"{label}@{s}: cap {body['cap_usd']} == hand cap {hc}")
        if hc is not None:
            check(caps.get(body["cap_leg"], -1) <= hc * 1.01, f"{label}@{s}: cap leg {body['cap_leg']} is limiting")
        else:
            check(all(t in body["cap_reason"] for t, x in caps.items() if x is None), f"{label}@{s}: cap_reason names legs")
            for t, _, k in legs:
                if caps[t] is None and k is None and not any(served(t, x) for x in SIZES) and \
                        any(v["state"] == "filled" for x in SIZES for v in under(t, x)["versions"]):
                    check("not ranked (share ratio not read)" in body["cap_reason"], f"{label}@{s}: cap_reason says not ranked")
        filled = [x for x in body["legs"] if x["state"] == "filled"]
        evm = [x for x in filled if x["group"] == "evm"]
        p = body["prompts"]
        check(body["signatures"] == p["swaps"] == len(filled), f"{label}@{s}: signatures == swaps == priced legs")
        check(body["evm"] + body["nonevm"] == body["signatures"] and body["legs_unresolved"] == len(legs) - len(filled),
              f"{label}@{s}: evm + nonevm == signatures; legs_unresolved")
        check(p["approvals_up_to"] == len(evm) and p["signatures_up_to"] == len(filled) + len(evm), f"{label}@{s}: prompts")
        check(sorted(t for g in body["by_chain"] for t in g["legs"]) == sorted(x["ticker"] for x in filled)
              and sum(g["swaps"] for g in body["by_chain"]) == p["swaps"], f"{label}@{s}: by_chain covers priced legs once")
        check(p["chain_switches"] == max(0, len(body["by_chain"]) - 1), f"{label}@{s}: chain switches")
        if body["by_chain"]:
            check(f"so {p['chain_switches']} chain switch" in p["basis"] and f"on {len(body['by_chain'])} chain" in p["basis"],
                  f"{label}@{s}: prompts basis states the same numbers")

    # 2. selection rule, at $1,000
    for b in doc["baskets"]:
        for t, _, _ in B.current_legs(b):
            check(served(t, 1000) is not None, f"{b['code']}: {t} has a filled, ranked version at $1,000")

    # 3-6. every basket at every size
    lists = {}
    for s in SIZES:
        r = c.get("/api/baskets/curated", params={"size": s})
        check(r.status_code == 200, f"/curated?size={s} answers 200 (got {r.status_code})")
        lists[s] = {x["code"]: x for x in r.json()["baskets"]}

    for b in doc["baskets"]:
        legs = B.current_legs(b)
        for s in SIZES:
            check_breakdown(b["code"], legs, lists[s][b["code"]], s)
            check(lists[s][b["code"]]["cost_bps_1k"] == lists[1000][b["code"]]["cost_bps"], f"{b['code']}@{s}: cost_bps_1k")

        # detail
        r = c.get(f"/api/baskets/{b['code']}")
        check(r.status_code == 200, f"/api/baskets/{b['code']} answers 200")
        d = r.json()
        check(d["cost_at_size"]["stops"] == SIZES, f"{b['code']}: cost_at_size covers the 11 stops")
        for i, s in enumerate(SIZES):
            check(d["cost_at_size"]["bps"][i] == lists[s][b["code"]]["cost_bps"],
                  f"{b['code']}: cost_at_size at {s} == /curated?size={s}")
            check((d["cost_at_size"]["bps"][i] is None) == bool(d["cost_at_size"]["null_reason"][i]),
                  f"{b['code']}: a null cost_at_size at {s} has a reason, and only then")
        check(d["version"] == b["changes"][-1]["version"] and len(d["changes"]) == len(b["changes"]),
              f"{b['code']}: version and changes")
        check(all(set(x) == {"ticker", "weight_bps"} for ch in d["changes"] for x in ch["legs"]),
              f"{b['code']}: changes legs carry ticker and weight only")
        # 8. no invented figures
        for k, basis in (("value_usd_indicative", "value_basis"), ("return_since_creation_pct", "return_basis"),
                         ("followers_count", "followers_basis")):
            check(d[k] is None and bool(d[basis]), f"{b['code']}: {k} is null with {basis}")
        check(d["series"] is None and d["followers"] is None and bool(d["return_source"]),
              f"{b['code']}: series and followers null; return_source says why")

        # 7a. evaluate (legs= and b=) agrees with the curated breakdown
        q = ",".join(f"{t}:{w}" for t, w, _ in legs)
        bq = b64({"v": 1, "legs": [{"t": t, "w": w} for t, w, _ in legs]})
        for name, params in (("legs", {"legs": q}), ("b", {"b": bq})):
            e = c.get("/api/baskets/evaluate", params=params)
            check(e.status_code == 200, f"evaluate {name} {q}: 200")
            ej = e.json()
            for k in ("cost_bps", "cost_usd", "cap_usd", "cap_leg", "signatures", "legs_unresolved", "evm", "nonevm",
                      "prompts", "by_chain", "cost_at_size", "legs"):
                check(ej[k] == d[k], f"evaluate {name} {q}: {k} equals the curated answer")
            check(ej["stored"] is False, f"evaluate {name} {q}: says nothing is stored")

    # 7b. ad-hoc baskets through evaluate: not ranked, pinned versions
    def ev(params: dict, legs: list[tuple], label: str) -> dict | None:
        r = c.get("/api/baskets/evaluate", params=params)
        check(r.status_code == 200, f"{label}: 200 (got {r.status_code} {r.text[:120]})")
        if r.status_code != 200:
            return None
        body = r.json()
        check_breakdown(label, legs, body, int(params.get("size", 1000)))
        return body

    unranked = [t for t in ("DIS", "FXI", "SQQQ") if served(t, 1000) is None
                and any(v["state"] == "filled" for v in under(t, 1000)["versions"])]
    check(bool(unranked), "the store holds an underlying that fills at $1,000 but is not ranked (for the D2 case)")
    for t in unranked[:1]:
        for s in (1000, 10000):
            ev({"legs": f"{t}:5000,SPY:5000", "size": s}, [(t, 5000, None), ("SPY", 5000, None)], f"unranked {t}")
    # pins: a filled non-best version, an unranked (Ondo) filled one, one that does not fill
    vs = under("NVDA", 500)["versions"]
    best = under("NVDA", 500)["best"]["key"]
    pins = [x["key"] for x in vs if x["state"] == "filled" and x["key"] != best][:2] + \
           [x["key"] for x in vs if x["state"] != "filled"][:1]
    for k in pins:
        legs = [("NVDA", 5000, k), ("SPY", 5000, None)]
        ev({"b": b64({"v": 1, "legs": [{"t": "NVDA", "k": k, "w": 5000}, {"t": "SPY", "w": 5000}]})}, legs, f"pin {k}")
    check(counts["pinned_filled"] > 0 and counts["pinned_unfilled"] > 0 and counts["not_ranked"] > 0
          and counts["below_stop"] > 0, f"every leg kind was exercised {counts}")
    spy_key = under("SPY", 1000)["best"]["key"]

    # 7c. validation: each a 400 with {error, reason}
    def bad(params: dict, why: str, path: str = "/api/baskets/evaluate") -> None:
        r = c.get(path, params=params)
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        check(r.status_code == 400 and j.get("error") == "bad_request" and j.get("reason"),
              f"{why}: 400 with error and reason (got {r.status_code} {r.text[:100]})")

    for q, why in {
        "": "no legs",
        "NVDA:2000,TSLA:2000,AAPL:2000,MSFT:2000,GOOGL:1000,META:1000": "six legs",
        "NVDA:5000,TSLA:4999": "sum 9,999",
        "NVDA:5000,TSLA:5001": "sum 10,001",
        "NVDA:5000,NVDA:5000": "duplicate",
        "NVDA:0,TSLA:10000": "zero weight",
        "NVDA:50.5,TSLA:49.5": "non-integer weight",
        "NVDA:-1,TSLA:10001": "negative weight",
        "NVDA,TSLA": "no weights",
        "ZZZZZZ:10000": "unknown underlying",
        "NV$A:10000": "not a ticker",
        "A" * 250: "too long",
        "SPY:9500,QQQ:\u2075\u2070\u2070": "superscript digits",
        "SPY:\u0665\u0660\u0660\u0660,QQQ:\u0665\u0660\u0660\u0660": "Arabic-Indic digits",
        "SPY:\uff15\uff10\uff10\uff10,QQQ:5000": "fullwidth digits",
        "SPY:5000,QQQ:5000\n": "trailing newline",
    }.items():
        bad({"legs": q}, f"evaluate {why}")
    for s in ("abc", "1000.0", "1e3", " 1000", "\uff11\uff10\uff10\uff10", "1234", "", "-1000"):
        for path in ("/api/baskets/evaluate", "/api/baskets/curated", "/api/baskets/semis"):
            bad({"legs": "SPY:5000,QQQ:5000", "size": s} if path.endswith("evaluate") else {"size": s},
                f"{path} size={s!r}", path)
    for obj, why in (
        ({"v": 2, "legs": [{"t": "SPY", "w": 10000}]}, "v 2"),
        ({"v": 1.0, "legs": [{"t": "SPY", "w": 10000}]}, "v as a float"),
        ({"v": 1, "legs": [{"t": "SPY", "w": 5000.0}, {"t": "QQQ", "w": 5000}]}, "float weight"),
        ({"v": 1, "legs": [{"t": "SPY", "w": True}]}, "boolean weight"),
        ({"v": 1, "legs": [{"t": "SPY", "w": "10000"}]}, "string weight"),
        ({"v": 1, "legs": [{"t": "SPY", "w": 10000, "x": 1}]}, "unknown leg key"),
        ({"v": 1, "legs": [{"t": "SPY", "w": 10000}], "extra": 1}, "unknown top key"),
        ({"v": 1, "legs": [{"t": "NVDA", "k": spy_key, "w": 10000}]}, "k of another underlying"),
        ({"v": 1, "legs": [{"t": "NVDA", "k": "1/0xnope", "w": 10000}]}, "k not measured"),
        ({"v": 1, "legs": [{"t": "SPY", "w": 1000}] * 6}, "six legs in b"),
        ({"v": 1, "legs": []}, "no legs in b"),
        ([1, 2], "not an object"),
    ):
        bad({"b": b64(obj)}, f"evaluate b {why}")
    # duplicate keys, at the top and inside a leg
    bad({"b": b64raw(b'{"v":1,"v":1,"legs":[{"t":"SPY","w":10000}]}')}, "evaluate b duplicate top key")
    bad({"b": b64raw(b'{"v":1,"legs":[{"t":"SPY","w":5000,"w":10000}]}')}, "evaluate b duplicate leg key")
    bad({"b": b64raw(b'{"v":1,"legs":[{"t":"SPY","t":"QQQ","w":10000}]}')}, "evaluate b duplicate ticker key")
    bad({"b": "eyJ2IjoxfQ==="}, "evaluate b three pad characters")
    bad({"b": "eyJ2IjoxfQ="}, "evaluate b padding to a non-multiple of 4")
    bad({"b": "=="}, "evaluate b padding only")
    # padded and unpadded answer the same; b_param is canonical, carries k and round-trips
    base = {"v": 1, "legs": [{"t": "NVDA", "k": pins[0], "w": 5000}, {"t": "SPY", "w": 5000}]}
    unpadded = b64(base)
    padded = base64.urlsafe_b64encode(json.dumps(base).encode()).decode()
    check(unpadded != padded and padded.endswith("="), "the padded test link is padded")
    r1 = c.get("/api/baskets/evaluate", params={"b": unpadded}).json()
    r2 = c.get("/api/baskets/evaluate", params={"b": padded})
    check(r2.status_code == 200 and {k: v for k, v in r2.json().items()} == r1, "padded b answers as unpadded")
    canon = base64.urlsafe_b64encode(json.dumps(
        {"v": 1, "legs": [{"t": "NVDA", "k": pins[0], "w": 5000}, {"t": "SPY", "w": 5000}]},
        separators=(",", ":")).encode()).decode().rstrip("=")
    check(r1.get("b_param") == canon, "b_param is compact JSON {v, legs:[{t, k?, w}]}, unpadded")
    r3 = c.get("/api/baskets/evaluate", params={"b": r1["b_param"]}).json()
    check(r3 == r1, "b_param round-trips to the same answer, pinned version included")
    r4 = c.get("/api/baskets/evaluate", params={"legs": "SPY:5000,QQQ:5000"}).json()
    r5 = c.get("/api/baskets/evaluate", params={"b": r4["b_param"]}).json()
    check(r5 == r4 and "k" not in json.loads(base64.urlsafe_b64decode(r4["b_param"] + "=" * (-len(r4["b_param"]) % 4))),
          "legs= echoes a b_param without k that round-trips")
    bad({"b": "!!!"}, "evaluate b not base64url")
    bad({"b": b64raw(b"\xff\xfe")}, "evaluate b not UTF-8")
    bad({"b": b64raw(b"{nope")}, "evaluate b not JSON")
    bad({"legs": "SPY:5000,QQQ:5000", "b": b64({"v": 1, "legs": [{"t": "SPY", "w": 10000}]})}, "evaluate legs and b both")
    bad({}, "evaluate neither legs nor b")
    r = c.get("/api/baskets/evaluate", params={"legs": "spy:5000, qqq:5000"})
    check(r.status_code == 200 and r.json()["legs_param"] == "SPY:5000,QQQ:5000", "evaluate normalises case and spaces")
    r = c.get("/api/baskets/nope")
    check(r.status_code == 404, "unknown code: 404")

    # 8b. no price-history source exists to take a return from
    te_dir = ROOT / "core" / "te"
    history = [p.name for p in te_dir.glob("*.py") if p.stem in ("bars", "series", "history", "prices")]
    check(not history, f"no price-history module in core/te ({history}); if one exists, wire basket value and return to it")

    print(f"{PASSES} passed, {len(FAILS)} failed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
