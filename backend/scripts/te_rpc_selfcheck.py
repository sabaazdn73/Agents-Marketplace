"""
te_rpc_selfcheck.py

Offline checks of the rotating RPC client (core/te/rpcclient.py, rotate=True,
Base only) and of the honesty guard after the quotes (core/te/cost.py). No
network: every request is answered by a stand-in.

    ./venv/bin/python scripts/te_rpc_selfcheck.py

1. Rotation: a 429 cools an endpoint and the next read goes elsewhere; every
   endpoint 429 means rounds with backoff, then "rate limited"; a pinned
   read skips an endpoint whose state window does not cover it, and one that
   says it lost the state is passed over, not cooled.
2. served vs by_endpoint: an endpoint that only answered 429s served nothing.
3. The after-guard (the production failure of 2026-09-28): an endpoint that
   served results and is rate limited at guard time does not fail the pass.
   It is asked again after its cool-down only when that wait is short; usually
   it is returned unverified and the pass is run again without it. A
   dishonest answer still raises. A non-rotating client is unchanged: it
   raises, and its guard uses the default retries.
4. Secrets: BASE_RPC_URL's label is fixed text and a registrable domain;
   str(e), repr(e) and e.message carry no part of the URL's key.
5. The immutable cache keeps only a well-formed, non-zero 32-byte word.

Exit status 0 only when every check passes.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from core.te import chains, cost, gasusd, rpcclient  # noqa: E402
from core.te.rpcclient import ChainRpc, Endpoint, RpcError, public_reason  # noqa: E402

FAILURES: list[str] = []
_ORIG_POST = httpx.Client.post


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


def reset() -> None:
    rpcclient._cool.clear()
    rpcclient._quota_spent.clear()


class Net:
    """Answers per host: 'ok', '429', 'state' (lost the block), 'liar' (the
    guard's TIMESTAMP differs from the header), or a callable."""

    def __init__(self, **hosts):
        self.hosts = hosts
        self.log: list[tuple[float, str, str]] = []

    def __call__(self, client, url, *a, **k):
        host = str(url).split("//")[1].split("/")[0]
        body = json.loads(k.get("content") or "{}")
        self.log.append((time.monotonic(), host, body.get("method")))
        mode = self.hosts.get(host, "ok")
        if callable(mode):
            mode = mode()
        req = httpx.Request("POST", url)
        if mode == "429":
            return httpx.Response(429, text="rate limited", request=req)
        if mode == "state" and body.get("method") == "eth_call":
            return httpx.Response(403, json={"jsonrpc": "2.0", "id": 1, "error": {
                "code": -32602, "message": "Archive requests require a personal token"}}, request=req)
        m = body.get("method")
        ts = "0x11" if (mode == "liar" and m == "eth_call") else "0x10"
        res = {"eth_blockNumber": "0x3e8", "eth_call": "0x" + "00" * 31 + ts[2:],
               "eth_getBlockByNumber": {"timestamp": "0x10"}, "eth_gasPrice": "0x1"}.get(m, "0x0")
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": res}, request=req)


def use(net: Net) -> None:
    httpx.Client.post = lambda self, url, *a, **k: net(self, url, *a, **k)


def eps(*spec) -> list[Endpoint]:
    return [Endpoint(h, f"https://{h}", w) for h, w in spec]


def check_rotation() -> None:
    print("rotation")
    reset()
    rpcclient._backoff = lambda n: 0.01
    net = Net(**{"a.test": "429"})
    use(net)
    r = ChainRpc(8453, eps(("a.test", None), ("b.test", None)), rotate=True)
    r.block_number()
    r.block_number()
    hosts = [h for _t, h, _m in net.log]
    check(hosts == ["a.test", "b.test", "b.test"], "a 429 cools a.test; the next read starts on b.test", str(hosts))
    check(r.stats.served == {"b.test": 2} and r.stats.by_endpoint.get("a.test") == 1,
          "by_endpoint counts the 429, served does not", json.dumps(r.stats.as_dict()["served"]))
    reset()
    net = Net(**{"a.test": "429", "b.test": "429"})
    use(net)
    r = ChainRpc(8453, eps(("a.test", None), ("b.test", None)), rotate=True, retries_per_endpoint=3)
    try:
        r.block_number()
        check(False, "every endpoint 429 ends in a refusal")
    except RpcError as e:
        check(public_reason(e) == "rate limited by the provider" and len(net.log) == 6 and r.stats.retries == 2,
              "every endpoint 429: three rounds over both, then rate limited", f"{len(net.log)} requests")
    reset()
    net = Net(**{"a.test": "state"})
    use(net)
    r = ChainRpc(8453, eps(("a.test", None), ("b.test", None), ("p.test", 50)), rotate=True)
    r.head = 1000
    r.eth_call("0x" + "11" * 20, "0x", 900)
    hosts = [h for _t, h, _m in net.log]
    check(hosts == ["a.test", "b.test"] and not rpcclient.cooling(),
          "a lost-state answer passes the read to the next endpoint without cooling it", str(hosts))
    check([e.label for e in r._order(900)] == ["a.test", "b.test"] and "p.test" in [e.label for e in r._order(990)],
          "a read 100 blocks back skips an endpoint with a 50-block window; 10 back does not")


def check_after_guard() -> None:
    print("\nthe after-quotes guard (production, 2026-09-28)")
    reset()
    rpcclient._backoff = lambda n: 0.01
    cost.GUARD_WAIT_MAX_S = 3.0
    rpcclient.COOL_BASE_S = 0.2
    served = {"n": 0}

    def a_mode():                          # serves three results, then 429 for good
        served["n"] += 1
        return "ok" if served["n"] <= 3 else "429"
    net = Net(**{"a.test": a_mode})
    use(net)
    r = ChainRpc(8453, eps(("a.test", None), ("b.test", None)), rotate=True, retries_per_endpoint=3,
                 deadline=time.monotonic() + 60)
    blk = int(r.call("eth_blockNumber", []), 16)
    for _ in range(8):
        r.eth_call("0x" + "11" * 20, "0x", blk)
    check(r.stats.served.get("a.test") == 3 and r.stats.served.get("b.test"),
          "a.test served three results before its 429s; b.test the rest", json.dumps(r.stats.served))
    t = time.monotonic()
    try:
        after, unverified = cost.after_guard(r, 8453, blk)
        check(after.get("b.test") is True and "a.test" in unverified,
              "a.test rate limited at guard time: not verified, returned, not raised; b.test verified",
              f"{after} in {time.monotonic() - t:.1f}s")
        waited = [x for x in net.log if x[1] == "a.test" and x[0] >= t]
        check(len(waited) >= 2, "a.test was asked again after its cool-down", f"{len(waited)} guard requests")
    except RpcError as e:
        check(False, "a.test rate limited at guard time does not fail the pass", f"raised {public_reason(e)}")

    reset()
    served["n"] = 0

    def a_later():                          # 429 at guard time, then answers after the cool-down
        served["n"] += 1
        return "429" if served["n"] == 2 else "ok"
    use(Net(**{"a.test": a_later}))
    r = ChainRpc(8453, eps(("a.test", None), ("b.test", None)), rotate=True, retries_per_endpoint=1,
                 deadline=time.monotonic() + 60)
    r.eth_call("0x" + "11" * 20, "0x", 1000)
    after, unverified = cost.after_guard(r, 8453, 1000)
    check(after.get("a.test") is True and not unverified,
          "rate limited at guard time, then answering after its cool-down: verified", str(after))

    reset()
    use(Net(**{"a.test": "liar"}))
    r = ChainRpc(8453, eps(("a.test", None), ("b.test", None)), rotate=True)
    r.eth_call("0x" + "11" * 20, "0x", 1000)
    try:
        cost.after_guard(r, 8453, 1000)
        check(False, "a dishonest endpoint still fails the pass")
    except RpcError as e:
        check("did not execute" in e.message, "a dishonest endpoint still fails the pass", e.message[:70])

    reset()
    n = {"k": 0}

    def rh():                               # a non-rotating chain: serves once, then 429s
        n["k"] += 1
        return "ok" if n["k"] == 1 else "429"
    net = Net(**{"rh.test": rh})
    use(net)
    rpcclient_sleep = time.sleep
    time.sleep = lambda s: None
    try:
        r = ChainRpc(4663, eps(("rh.test", None)), retries_per_endpoint=8)
        r.eth_call("0x" + "11" * 20, "0x", 1000)
        before = len(net.log)
        try:
            cost.after_guard(r, 4663, 1000)
            check(False, "a non-rotating chain's guard failure still raises, as before")
        except RpcError:
            check(len(net.log) - before == 3,
                  "a non-rotating chain is unchanged: its guard raises, after the default 3 tries (not its 8)",
                  f"{len(net.log) - before} guard requests")
    finally:
        time.sleep = rpcclient_sleep


def check_secrets() -> None:
    print("\nsecrets")
    reset()
    rpcclient._backoff = lambda n: 0.01
    secrets = ["PATHSECRET0123456789", "QSECRET99887766", "secretsub9f8e7d"]
    for url in ("https://secretsub9f8e7d.invalid/PATHSECRET0123456789/?apikey=QSECRET99887766",
                "https://abcsecretsub9f8e7d.base-mainnet.quiknode.pro/PATHSECRET0123456789/"):
        os.environ["BASE_RPC_URL"] = url
        label = chains.latest_endpoints(8453)[0].label
        check(label.startswith("BASE_RPC_URL") and not any(s in label for s in secrets),
              "the label is fixed text and a registrable domain", label)

        # The key's parts as they stand in this URL: a subdomain whole.
        mine = [x for x in secrets if x in url and x != "secretsub9f8e7d"] + \
               [h for h in url.split("//")[1].split("/")[0].split(".") if "secretsub9f8e7d" in h]

        def echo(client, u, *a, **k):
            # An upstream that echoes the URL, and each part of the key on
            # its own, back in its error body.
            return httpx.Response(429, text=f"rate limited on {u}; " + " ".join(mine),
                                  request=httpx.Request("POST", u))
        httpx.Client.post = echo
        r = chains.rpc_for(8453)
        r.retries = 1
        try:
            r.block_number()
        except RpcError as e:
            text = " ".join([str(e), repr(e), e.message, str(e.args), str(e.endpoint), public_reason(e),
                             json.dumps(r.stats.as_dict()), json.dumps(rpcclient.cooling())])
            leaks = [s for s in mine if s in text]
            check(not leaks, "no part of the key in str(e), repr(e), args, message, stats or cooling",
                  ", ".join(leaks) or "clean")
        reset()
    os.environ.pop("BASE_RPC_URL", None)


def check_cache() -> None:
    print("\nthe immutable cache")
    gasusd._IMMUTABLE.clear()
    answers = iter(["0x", "0x" + "00" * 32, "0x1234", "0x" + "00" * 31 + "06", "0x" + "ff" * 32])

    class Fake:
        chain_id = 1

        def eth_call(self, to, data, block):
            return next(answers)
    f = Fake()
    got = [gasusd.immutable_call(f, "0xabc", "0x313ce567") for _ in range(4)]
    check(got[:3] == ["0x", "0x" + "00" * 32, "0x1234"] and got[3].endswith("06"),
          "empty, zero and short answers are not kept; each call asked again", str(got[:3]))
    check(gasusd.immutable_call(f, "0xabc", "0x313ce567").endswith("06"),
          "a well-formed word is kept and served from the cache after")


def check_discovery() -> None:
    print("\npool discovery on Base")
    from core.te import pools
    reset()
    rpcclient._backoff = lambda n: 0.01
    deploy = {"0x" + "a1" * 20: 1_000, "0x" + "a2" * 20: 5_000}
    calls = {"n": 0}

    def getcode(client, url, *a, **k):
        body = json.loads(k.get("content") or "{}")
        req = httpx.Request("POST", url)
        m, prm = body["method"], body["params"]
        if m == "eth_getCode":
            calls["n"] += 1
            code = "0x60" if int(prm[1], 16) >= deploy[prm[0]] else "0x"
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": code}, request=req)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "0x" + format(1 << 20, "x")},
                              request=req)
    httpx.Client.post = getcode
    r = ChainRpc(8453, eps(("x.test", None)), rotate=True)
    st, per_pass, got = {}, [], None
    for _ in range(3):
        calls["n"] = 0
        got = pools._floor({"floor": "token", "floor_fallback": 0}, r, [], sorted(deploy), 1 << 20,
                           st)
        st = json.loads(json.dumps(st))          # round-trips through the store
        per_pass.append(calls["n"])
        if got[0] is not None:
            break
    check(max(per_pass) <= pools.BISECT_CALLS_PER_RUN, "the bisection spends at most 40 calls a pass",
          str(per_pass))
    check(got[0] == 1_000 and len(per_pass) > 1, "it resumes across passes (through a store round trip) and "
          "finds the earliest deployment", f"{got} after {len(per_pass)} passes")

    os.environ["BASE_RPC_URL"] = "https://paid.example.com/k"
    check([e.label for e in chains.discovery_endpoints(8453)] == ["BASE_RPC_URL (example.com)", "mainnet.base.org"],
          "discovery on Base: BASE_RPC_URL first, mainnet.base.org after", "")
    net = []

    def ranges(client, url, *a, **k):
        host = str(url).split("//")[1].split("/")[0]
        net.append(host)
        req = httpx.Request("POST", url)
        if host == "paid.example.com":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {
                "code": -32602, "message": "block range too large for your plan"}}, request=req)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": []}, request=req)
    httpx.Client.post = ranges
    r = ChainRpc(8453, chains.discovery_endpoints(8453), rotate=True)
    out = r.call("eth_getLogs", [{"fromBlock": "0x1", "toBlock": "0x7d0"}])
    check(out == [] and net == ["paid.example.com", "mainnet.base.org"] and not rpcclient.cooling(),
          "BASE_RPC_URL refusing the range falls back to mainnet.base.org cleanly", str(net))
    os.environ.pop("BASE_RPC_URL", None)

    # A result-count refusal arrives as -32005, a transient code. It must not
    # cool the endpoint or retry: next endpoint, or from the last, raise so
    # _logs splits the range at once.
    reset()
    calls = []

    def logs(beh):
        def post(client, url, *a, **k):
            body = json.loads(k.get("content"))
            host = str(url).split("//")[1].split("/")[0]
            prm = body["params"][0]
            span = int(prm["toBlock"], 16) - int(prm["fromBlock"], 16) + 1
            calls.append((host, span))
            req = httpx.Request("POST", url)
            b = beh[host]
            if b == "range" or (b == "range>100" and span > 100):
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {
                    "code": -32005, "message": "query exceeds limit of 10000 results"}}, request=req)
            if b == "ratelimit":
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {
                    "code": -32005, "message": "rate limit exceeded"}}, request=req)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": [{"span": span}]}, request=req)
        return post
    two = lambda: ChainRpc(8453, eps(("a.test", None), ("b.test", None)), rotate=True, retries_per_endpoint=3)  # noqa: E731
    httpx.Client.post = logs({"a.test": "range", "b.test": "ok"})
    out = pools._logs(two(), "0x" + "11" * 20, 0, 799, [])
    check(len(out) == 1 and [h for h, _ in calls] == ["a.test", "b.test"] and not rpcclient.cooling(),
          "-32005 'exceeds limit' on the first endpoint: the next serves it, nothing cooled", str(calls))
    calls.clear()
    httpx.Client.post = logs({"a.test": "range>100", "b.test": "range>100"})
    out = pools._logs(two(), "0x" + "11" * 20, 0, 799, [])
    # 800 refused by both (2 calls), 2 x 400 (4), 4 x 200 (8), then 8 x 100 served by the first (8): 22
    check(len(out) == 8 and len(calls) == 22 and not rpcclient.cooling(),
          "refused everywhere: raised at once from the last endpoint and split, no retry rounds",
          f"{len(out)} chunks in {len(calls)} calls")
    calls.clear()
    httpx.Client.post = logs({"a.test": "ratelimit", "b.test": "ok"})
    two().call("eth_getLogs", [{"fromBlock": "0x0", "toBlock": "0x10"}])
    check("a.test" in rpcclient.cooling(), "-32005 'rate limit exceeded' is still a rate limit: cooled", "")

    # The bisection keeps its progress on a state error from the last
    # endpoint; only an endpoint that serves no history at all marks "none".
    reset()
    for msg, want in (("header not found", "kept"), ("missing trie node abc", "kept"),
                      ("the method eth_getCode does not exist/is not available", "kept"),
                      ("method not found", "none")):
        n = {"k": 0}

        def post(client, url, *a, _msg=msg, **k):
            n["k"] += 1
            req = httpx.Request("POST", url)
            if n["k"] == 1:
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "0x60"}, request=req)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": _msg}},
                                  request=req)
        httpx.Client.post = post
        entry: dict = {}
        r = ChainRpc(8453, eps(("x.test", None)), rotate=True, retries_per_endpoint=1)
        try:
            pools._bisect(r, "0x" + "a1" * 20, 1 << 20, entry, 40)
            got = "none" if "none" in entry else "returned"
        except RpcError:
            got = "kept" if "hi" in entry and "none" not in entry else "lost"
        check(got == want, f"bisection, '{msg}': progress {want}", json.dumps(entry)[:80])


def main() -> int:
    try:
        check_rotation()
        check_discovery()
        check_after_guard()
        check_secrets()
        check_cache()
    finally:
        httpx.Client.post = _ORIG_POST
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
