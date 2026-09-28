"""Issuer controls over the listed universe: per token, per issuer and chain,
or per issuer programme (SPEC A.1 section 7, B.2).

Each cell is pause, freeze, burn or seize, upgrade, mint, allowlist, and who
may hold, as {text, state, capability, holder, evidence}. A row that spans
several chains or tokens says where they differ instead of picking one: the
xStocks pauser is the same address on every EVM chain but a 3 of 5 Safe on
some and a 2 of 3 on others, and the row names both with their chains.

Evidence items are {chain, address, block_or_slot, block_or_slot_to?, unit,
method, tokens}. When the read was of each token itself the address is
"each token" and the block range spans the tokens' own reads.

The values are the universe pass's reads (class A) at the blocks named; the
eligibility text is the issuer's own words (class D), always with its URL and
the date it was read. Nothing here is refreshed live: `computed_at` is when
the universe was assembled, and every block is on its evidence.
"""

from __future__ import annotations

from core.te.universe import CHAINS, CONTROL_KEYS, ISSUER_NAMES, LEFT_OUT_REASONS, SITE_CHAINS, Universe

MAX_EVIDENCE = 12
MAX_VARIANTS_NAMED = 3

# SPEC A.1 section 7: the matrix order.
PROGRAMME_ORDER = ("robinhood-evm", "bstocks-evm", "xstocks-solana", "xstocks-evm",
                   "ondo-evm", "ondo-solana", "coinbase-evm", "xstocks-ton", "xstocks-tron")

KIND_LABEL = {"evm": "EVM", "solana": "Solana", "ton": "TON", "tron": "Tron"}


def _kind(chain: str) -> str:
    return "solana" if chain == "solana" else chain if chain in ("ton", "tron") else "evm"


def _fmt_int(n: int) -> str:
    return f"{n:,}"


def _aggregate(u: Universe, idx: list[int], ckey: str) -> dict:
    """One control across many tokens."""
    by_text: dict[str, dict] = {}
    evidence: dict[tuple, dict] = {}
    for i in idx:
        ci = u.control_set(i)
        if ci is None:
            continue
        cell = u.raw_controls(ci)[ckey]
        r = u.row(i)
        chain = r["chain"]
        v = by_text.setdefault(cell["text"], {"cells": {}, "tokens": 0, "chains": set()})
        v["cells"][id(cell)] = cell
        v["tokens"] += 1
        v["chains"].add(chain)
        ev = cell.get("evidence") or {}
        from_record = ev.get("from_record", False)
        addr = ev.get("address")
        ek = (chain, addr, ev.get("method"), None if from_record else ev.get("block_or_slot"))
        e = evidence.get(ek)
        point = r["block_or_slot"] if from_record else ev.get("block_or_slot")
        unit = r["unit"] if from_record else ev.get("unit")
        if e is None:
            e = evidence[ek] = {"chain": CHAINS[chain]["name"], "address": addr, "block_or_slot": point,
                                "block_or_slot_to": point, "unit": unit, "method": ev.get("method"), "tokens": 0}
        e["tokens"] += 1
        if isinstance(point, int) and isinstance(e["block_or_slot"], int):
            e["block_or_slot"] = min(e["block_or_slot"], point)
            e["block_or_slot_to"] = max(e["block_or_slot_to"], point)
    if not by_text:
        return {"text": None, "state": "not established", "capability": None,
                "capability_note": "no controls read for these tokens"}

    ev_list = []
    for e in sorted(evidence.values(), key=lambda e: (-e["tokens"], e["chain"], str(e["address"]))):
        if e["address"] == "@token":
            e["address"] = f"each token ({_fmt_int(e['tokens'])})"
        if e["block_or_slot_to"] == e["block_or_slot"]:
            e.pop("block_or_slot_to")
        ev_list.append(e)
    variants = [v for _, v in sorted(by_text.items(), key=lambda kv: (-kv[1]["tokens"], str(kv[0])))]
    for v in variants:
        v["cell"] = _merge(list(v["cells"].values()))
    total = sum(v["tokens"] for v in variants)
    out: dict = {"tokens": total}

    if len(variants) == 1:
        cell = variants[0]["cell"]
        out.update({k: v for k, v in cell.items() if k != "evidence"})
        if ckey == "pause" and cell["state"] in ("not paused", "paused"):
            out["state"] = f"{cell['state']} (all {_fmt_int(total)} tokens read)"
    else:
        states = {v["cell"]["state"] for v in variants}
        caps = {str(v["cell"]["capability"]) for v in variants}
        # Name variants by chain when each variant is on chains the others
        # are not; by token count when they share a chain.
        disjoint = all(not (a["chains"] & b["chains"]) for j, a in enumerate(variants) for b in variants[j + 1:])

        def label(v):
            if disjoint:
                return ", ".join(CHAINS[c]["name"] for c in sorted(v["chains"]))
            return f"{_fmt_int(v['tokens'])} tokens"

        if len(variants) <= MAX_VARIANTS_NAMED:
            text = "; ".join(f"{v['cell']['text']} ({label(v)})" for v in variants)
        elif len(states) == 1:
            text = f"{next(iter(states))}; holder varies by token ({len(variants)} variants)"
        else:
            text = f"varies by token ({len(variants)} variants)"
        state = next(iter(states)) if len(states) == 1 else "varies"
        if ckey == "pause" and state in ("not paused", "paused"):
            state = f"{state} (all {_fmt_int(total)} tokens read)"
        out.update({
            "text": text, "state": state,
            "capability": variants[0]["cell"]["capability"] if len(caps) == 1 else None,
            "variants": [{"text": v["cell"]["text"], "state": v["cell"]["state"], "tokens": v["tokens"],
                          "chains": [CHAINS[c]["name"] for c in sorted(v["chains"])],
                          "holder": v["cell"].get("holder")}
                         for v in variants[:MAX_VARIANTS_NAMED * 4]],
        })
        if len(caps) > 1:
            out["capability_note"] = "differs across the tokens in this row; see variants"
        paths = [c["upgrade_path"] for v in variants for c in v["cells"].values() if c.get("upgrade_path")]
        if paths:
            delays = {p.get("delay_s") for p in paths}
            out["upgrade_path"] = {"delay_s": next(iter(delays)) if len(delays) == 1 else None,
                                   "text": "; ".join(sorted({p["text"] for p in paths}))}
        if len(variants) > MAX_VARIANTS_NAMED * 4:
            out["variants_truncated"] = len(variants) - MAX_VARIANTS_NAMED * 4
    out["evidence"] = ev_list[:MAX_EVIDENCE]
    if len(ev_list) > MAX_EVIDENCE:
        out["evidence_truncated"] = len(ev_list) - MAX_EVIDENCE
    return out


def _merge(cells: list[dict]) -> dict:
    """One cell standing for several that share their text. A field whose
    value differs between them (the xStocks implementation address differs
    by token; the Ondo compliance owner is a different Safe on each chain) is
    dropped and named in `varies_across_tokens`, so no one token's value is
    shown as everyone's. by=chain or by=key gives the values."""
    first = cells[0]
    out = {k: v for k, v in first.items() if k != "evidence"}
    varies = sorted(k for k in out if any(c.get(k) != out[k] for c in cells[1:]))
    for k in varies:
        out.pop(k)
    if "upgrade_path" in varies:
        # The path differs by chain only in the holder's address: keep it,
        # naming each distinct path.
        paths = [c["upgrade_path"] for c in cells if c.get("upgrade_path")]
        delays = {p.get("delay_s") for p in paths}
        out["upgrade_path"] = {"delay_s": next(iter(delays)) if len(delays) == 1 else None,
                               "text": "; ".join(sorted({p["text"] for p in paths}))}
        varies.remove("upgrade_path")
    if varies:
        out["varies_across_tokens"] = varies
    return out


def _row(u: Universe, idx: list[int], programme: str, issuer: str, family: str) -> dict:
    # Most tokens first; a tie by the chain's name. The tie used to fall to
    # the iteration order of a set of strings, which Python randomises per
    # process, so two processes listed the same programme's chains in
    # different orders.
    chains = sorted({u.row(i)["chain"] for i in idx},
                    key=lambda c: (-sum(1 for i in idx if u.row(i)["chain"] == c), CHAINS[c]["name"]))
    row = {
        "programme": programme,
        "issuer": ISSUER_NAMES.get(issuer, issuer),
        "issuer_slug": issuer,
        "family": family,
        "chains": [CHAINS[c]["name"] for c in chains],
        "chain_slugs": chains,
        "tokens": len(idx),
    }
    for k in CONTROL_KEYS:
        row[k] = _aggregate(u, idx, k)
    row["who_may_hold"] = u.eligibility(issuer) or {"text": None, "reason": "eligibility text not read for this issuer"}
    return row


def _programme_name(u: Universe, issuer: str, kind: str, kinds_of_issuer: set) -> str:
    base = (u.issuers.get(issuer) or {}).get("programme") or ISSUER_NAMES.get(issuer, issuer)
    return f"{base} ({KIND_LABEL[kind]})" if len(kinds_of_issuer) > 1 else base


def _out_of_scope(u: Universe, by: str, chain: str) -> dict:
    n = u.chain_record_count(chain)
    return {"by": by, "computed_at": u.source.get("generated_at"), "scope": _scope_note(), "rows": [],
            "reason": (f"chain scope: the site covers seven chains and {CHAINS[chain]['name']} is not one of them; "
                       f"{n:,} records on it are read and kept, none is listed"),
            "records_on_chain": n, "source": u.provenance()}


def _filtered(u: Universe, issuer: str | None, chain: str | None) -> list[int]:
    out = []
    for i in u.listed_indices():
        r = u.row(i)
        if (issuer and r["issuer"] != issuer) or (chain and r["chain"] != chain):
            continue
        out.append(i)
    return out


def by_issuer(u: Universe, issuer: str | None = None, chain: str | None = None) -> dict:
    """One row per issuer programme (issuer and chain family), over listed
    tokens, optionally filtered to one issuer and/or one chain."""
    if chain and chain not in SITE_CHAINS:
        return _out_of_scope(u, "issuer", chain)

    def build():
        groups: dict[str, list[int]] = {}
        kinds: dict[str, set] = {}
        for i in u.listed_indices():
            r = u.row(i)
            kinds.setdefault(r["issuer"], set()).add(_kind(r["chain"]))
        for i in _filtered(u, issuer, chain):
            r = u.row(i)
            groups.setdefault(f"{r['issuer']}-{_kind(r['chain'])}", []).append(i)
        order = {f: n for n, f in enumerate(PROGRAMME_ORDER)}
        rows = []
        for fam in sorted(groups, key=lambda f: (order.get(f, 99), f)):
            iss, kind = fam.split("-", 1)
            rows.append(_row(u, groups[fam], _programme_name(u, iss, kind, kinds[iss]), iss, fam))
        out = {"by": "issuer", "computed_at": u.source.get("generated_at"), "scope": _scope_note(),
               "filter": {"issuer": issuer, "chain": chain}, "rows": rows, "source": u.provenance()}
        if not rows:
            out["reason"] = "no listed token matches this issuer and chain"
        return out
    return u.memo(("controls", "issuer", issuer, chain), build)


def by_chain(u: Universe, issuer: str | None = None, chain: str | None = None) -> dict:
    """One row per issuer on each chain, over listed tokens."""
    if chain and chain not in SITE_CHAINS:
        return _out_of_scope(u, "chain", chain)

    def build():
        groups: dict[tuple, list[int]] = {}
        for i in _filtered(u, issuer, chain):
            r = u.row(i)
            groups.setdefault((r["issuer"], r["chain"]), []).append(i)
        rows = []
        for (iss, ch), idx in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            prog = (u.issuers.get(iss) or {}).get("programme") or ISSUER_NAMES.get(iss, iss)
            rows.append(_row(u, idx, f"{prog} on {CHAINS[ch]['name']}", iss, f"{iss}-{_kind(ch)}"))
        out = {"by": "chain", "computed_at": u.source.get("generated_at"), "scope": _scope_note(),
               "filter": {"issuer": issuer, "chain": chain}, "rows": rows, "source": u.provenance()}
        if not rows:
            out["reason"] = "no listed token matches this issuer and chain"
        return out
    return u.memo(("controls", "chain", issuer, chain), build)


def by_key(u: Universe, key: str) -> dict | None:
    rec = u.record(key)
    if rec is None:
        return None
    out = {
        "by": "key", "computed_at": u.source.get("generated_at"),
        "key": rec["key"], "id": rec["id"], "symbol": rec["symbol"],
        "issuer": rec["issuer_name"], "issuer_slug": rec["issuer"],
        "chain": rec["chain_name"], "chain_slug": rec["chain"], "group": rec["group"],
        "underlying": rec["underlying"], "listed": rec["listed"],
        "read": rec["verification"],
        "controls": rec["controls"],
        "source": u.provenance(),
    }
    if not rec["listed"]:
        out["not_listed_reason"] = rec.get("not_listed_reason")
    if rec["controls"] is None:
        out["reason"] = "no controls read: " + (rec.get("not_listed_reason") or LEFT_OUT_REASONS["not_deployed"])
    return out


def _scope_note() -> str:
    return ("rows cover listed tokens only (see /api/te/summary for the definition); "
            "each cell's evidence names the contract read, the block or slot, and the method")
