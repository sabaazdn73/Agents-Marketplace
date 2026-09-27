"""
One collection run over every platform. Synchronous (called in a thread by
the worker). Returns documents for the store; writes nothing itself.

A platform whose reads fail is reported as failed for this run, with the
reason; the store then keeps that platform's previous documents and says
they are from an earlier run. An unreachable RPC is a fact about the call,
not about the vaults.

Cost control: every Solana call is counted in Helius credits (solana.py).
The run has an overall deadline, and authority traces (about 20 calls each)
are capped per day, so the collector's daily total stays under
DAILY_CREDIT_CAP; the worker spaces runs by the measured cost.
"""

from __future__ import annotations

import datetime as dt
import time

from . import catalog, glam, hyperliquid, kamino, voltr
from .authorities import AuthorityResolver, upgrade_authorities
from .solana import RpcError, SolanaRpc

PLATFORM_PROGRAMS = {
    "kamino": [kamino.KVAULT, kamino.KLEND],
    "voltr": [voltr.VOLTR] + [p for p, (_, k) in voltr.ADAPTORS.items() if k != "closed"],
    "glam": glam.GLAM_PROGRAMS,
}
PLATFORM_NAMES = {"kamino": "Kamino", "voltr": "Voltr", "glam": "GLAM"}
MODULES = {"kamino": kamino, "voltr": voltr, "glam": glam}

RUN_DEADLINE_S = 10 * 60
DAILY_CREDIT_CAP = 3000
MAX_TRACES_PER_DAY = 12  # about 21 credits each
MAX_TRACES_PER_RUN = 4


def _iso(t: float | None = None) -> str:
    return dt.datetime.fromtimestamp(t or time.time(), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _upgrade_summary(ups: dict, who: dict) -> dict:
    progs, texts = [], []
    for p, u in ups.items():
        a = who.get(u.get("authority")) if u.get("authority") else None
        t = a["text"] if a else ("immutable" if u.get("state") == "immutable" else u.get("state"))
        progs.append({**u, "authority_detail": a, "authority_text": t})
        texts.append(t)
    distinct = sorted(set(texts))
    return {"programs": progs, "text": "; ".join(distinct), "class": "A",
            "slot": min((u.get("slot") or 0) for u in ups.values()) if ups else None}


def _controls_text(doc: dict, upgrade: dict) -> str:
    c = doc["controls"]
    parts = [f"Upgrade: {upgrade['text']}"]
    if c.get("admin"):
        parts.append(f"admin: {c['admin']}")
    if doc["platform_key"] == "kamino" and c.get("global_admin"):
        parts.append(f"global admin: {c['global_admin']['text']}")
    if doc["platform_key"] == "voltr" and c.get("allow_any_adaptor"):
        parts.append("any adaptor allowed")
    if doc["platform_key"] == "glam":
        parts.append(f"state timelock {c.get('timelock_s', 0)} s")
    pause = c["pause"]["text"].split(" (")[0]
    parts.append(pause[:1].lower() + pause[1:])
    parts += doc.get("notes") or []
    return "; ".join(parts)


def _none_reason(key: str, res: dict) -> str:
    r = res["read"]
    counts = "; ".join(f"{n} {why}" for why, n in sorted(res["excluded"].items(), key=lambda x: -x[1]))
    return (f"{r.get('discovered', 0)} {PLATFORM_NAMES[key]} vault accounts read on chain at slot {r.get('slot')}, "
            f"none qualifies: {counts}.")


def _link_nesting(results: dict):
    """A Voltr position in a Kamino vault counts only when that vault is
    listed here; the page must never add the two together."""
    k, v = results.get("kamino"), results.get("voltr")
    if not k or not v:
        return
    kam = {d["address"]: d for d in k["vaults"]}
    kam_named = {n["address"]: n for n in k["named_exclusions"]}
    keep = []
    for d in v["vaults"]:
        bad = [n for n in d.get("nested_in") or [] if n["address"] not in kam]
        if bad:
            why = kam_named.get(bad[0]["address"], {}).get("reason", "not listed here")
            reason = "places funds in a Kamino vault that is not listed here"
            v["excluded"][reason] = v["excluded"].get(reason, 0) + 1
            v["named_exclusions"].append({"address": d["address"], "name": d["name"], "reason": reason,
                                          "kamino_vault": bad[0]["address"], "kamino_vault_reason": why,
                                          "tokens_there": bad[0]["tokens"]})
            continue
        for a in d.pop("attached_kvaults", None) or []:
            if a["address"] not in kam:
                why = kam_named.get(a["address"], {})
                nm = why.get("name") or f"Kamino vault {a['address'][:8]}…"
                d.setdefault("notes", []).append(f"strategy attached to {nm}, not listed here (currently 0)")
        for n in d.get("nested_in") or []:
            kd = kam[n["address"]]
            n["name"] = kd["name"]
            share = round(n["tokens"] / d["tvl"]["amount"] * 100, 1) if d["tvl"]["amount"] else None
            d["assets"]["lends_against_text"] = "; ".join(filter(None, [
                d["assets"].get("lends_against_text"),
                f"{share}% through {kd['name']} (listed): {kd['assets'].get('lends_against_text')}"]))
            kd.setdefault("contains_nested", []).append(
                {"platform_key": "voltr", "address": d["address"], "name": d["name"], "tokens": n["tokens"]})
        keep.append(d)
    v["vaults"] = keep


def run_collection(state: dict | None = None, platforms: tuple[str, ...] = ("kamino", "voltr", "glam"),
                   with_hyperliquid: bool = True, deadline_s: float = RUN_DEADLINE_S) -> dict:
    """`state` is what the previous run returned under "state" (the store's
    meta document): authority maps, trace backoffs, market classes, and the
    day's trace count."""
    state = dict(state or {})
    started = time.time()
    today = _iso()[:10]
    day = state.get("trace_day") or {}
    traced_today = day.get("count", 0) if day.get("day") == today else 0
    budget = max(0, min(MAX_TRACES_PER_RUN, MAX_TRACES_PER_DAY - traced_today))
    rpc = SolanaRpc(deadline_s=deadline_s)
    resolver = AuthorityResolver(rpc, state.get("known_authorities"), trace_budget=budget,
                                 not_found=state.get("authorities_not_found"),
                                 trace_errors=state.get("authority_trace_errors"))
    market_cache = dict(state.get("market_cache") or {})
    results: dict[str, dict] = {}
    upgrades: dict[str, dict] = {}
    failed: dict[str, str] = {}
    try:
        for key in platforms:
            try:
                ups = upgrade_authorities(rpc, PLATFORM_PROGRAMS[key])
                res = (kamino.collect(rpc, resolver, market_cache) if key == "kamino"
                       else MODULES[key].collect(rpc, resolver))
                who = resolver.resolve([u.get("authority") for u in ups.values() if u.get("authority")])
                upgrades[key] = _upgrade_summary(ups, who)
                results[key] = res
                if key == "kamino":
                    market_cache = res.pop("market_cache")
            except (RpcError, KeyError, ValueError, TypeError) as e:
                failed[key] = f"{type(e).__name__}: {e}"
    finally:
        rpc.close()
    _link_nesting(results)

    vault_docs, rows = [], []
    now = _iso()
    for key in platforms:
        row = {"_id": f"platform:{key}", "kind": "platform", "platform": PLATFORM_NAMES[key],
               "platform_key": key, "chain": "Solana", "group": "nonevm",
               "rule": catalog.QUALIFYING_RULE, "links": catalog.PLATFORM_LINKS[key],
               "audits": {"class": "D", **catalog.AUDITS[key]}}
        if key in failed:
            rows.append({**row, "status": "read_failed", "failed_at": now,
                         "error": f"this run's chain read failed ({failed[key][:200]}); earlier results, if any, are kept"})
            continue
        res, upgrade = results[key], upgrades[key]
        for d in res["vaults"]:
            d["controls"]["upgrade"] = upgrade
            d["controls"]["text"] = _controls_text(d, upgrade)
            d["read_at"] = now
            vault_docs.append(d)
        n = len(res["vaults"])
        rows.append({**row, "status": "listed" if n else "none_qualifying", "listed": n,
                     "as_of": now[:10], "read_at": now,
                     "discovered": res["read"].get("discovered"), "slot": res["read"].get("slot"),
                     "excluded": [{"reason": k, "count": c} for k, c in sorted(res["excluded"].items(), key=lambda x: -x[1])],
                     "named_exclusions": res["named_exclusions"],
                     "reason": None if n else _none_reason(key, res), "reason_class": "A",
                     "upgrade": upgrade,
                     "platform_reads": {k: v for k, v in res["read"].items() if k not in ("discovered", "slot")}})
    if with_hyperliquid:
        for r in hyperliquid.collect():
            rows.append({"_id": f"platform:{r['platform_key']}", "kind": "platform",
                         "read_at": (r.get("evidence") or {}).get("read_at"), **r})
    new_state = {
        "known_authorities": resolver.known,
        "authorities_not_found": resolver.not_found,
        "authority_trace_errors": resolver.trace_errors,
        "market_cache": market_cache,
        "trace_day": {"day": today, "count": traced_today + resolver.traced_this_run},
    }
    return {
        "vaults": vault_docs, "platforms": rows, "failed": failed, "state": new_state,
        "run": {"started": _iso(started), "finished": _iso(), "seconds": round(time.time() - started, 1),
                "solana_endpoint": rpc.endpoint_name, "solana_calls": rpc.calls, "solana_bytes": rpc.bytes,
                "solana_credits": rpc.credits, "authorities_traced": resolver.traced_this_run,
                "deadline_s": deadline_s},
    }


def next_run_delay_s(credits_per_run: int, floor_s: int = 3600) -> int:
    """Seconds until the next run so that runs of this cost stay under the
    daily credit cap (with a 10% margin), never more often than hourly."""
    if credits_per_run <= 0:
        return floor_s
    runs_per_day = max(1, int(DAILY_CREDIT_CAP * 0.9 // credits_per_run))
    return max(floor_s, int(86400 / runs_per_day) + 1)
