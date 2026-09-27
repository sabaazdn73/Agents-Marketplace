"""
Who controls an address: Squads v4 multisigs, the BPF upgradeable loader,
and the tracing of an authority to the multisig behind it.

Every answer here is a chain read (class A), with the slot it was read at,
except the one inference that is named as such: an on-curve key is "a single
key (inferred)", because nothing on chain says who holds it.

Squads v4 layout (multisig.rs, confirmed on chain in phase 7):
create_key@8, config_authority@40, threshold u16@72, time_lock u32@74,
transaction_index u64@78, stale_transaction_index u64@86, rent_collector
Option<Pubkey>@94, then bump u8, then members Vec<(Pubkey, u8 mask)>.
Permission bits: Initiate=1, Vote=2, Execute=4.
Vault PDA: ["multisig", multisig, "vault", u8 index] under SQDS4ep65….
"""

from __future__ import annotations

import time

from .solana import (
    BPF_UPGRADEABLE_LOADER, SYSTEM_PROGRAM, RpcError, SolanaRpc, find_pda, on_curve,
    pk32, pubkey, u16, u32, u64,
)

SQUADS_V4 = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"

# Multisigs found in the phase 7 research (PLAN-7 §0.1 and §1). A hint list
# only: an authority is attributed to one of these only when the vault PDA
# derivation reproduces the authority exactly.
KNOWN_MULTISIG_HINTS = (
    "6hhBGCtmg7tPWUSgp3LG6X2rsmYWAc4tNsA6G4CnfQbM",  # Kamino program upgrades
    "2TgbGtBq7zkAAnVUUzQQtEN4bF5sQEiXzYyVGo2tBJyb",  # Kamino kVault global admin
    "HTYwxumnCQ6y62SnNvVBwMCzdEdNsSBeLLo2T5mrYs4G",  # a Kamino vault admin
    "7idEEVRidWrahZJhxXMqniDbV6ESj7ZjyLrigcMcEt6H",  # klend market owner
    "BMPFb9HWQ6ZSCkF2nqcQXcRnyLDTwUGRT5cyhRug3P6v",  # klend market owner
    "7szuzpoZzah95BsAu2LQm3bpor5ofiAV4HuinyfFEdse",  # Voltr program upgrades
    "987uDDRCZbviPzRFuPLZfLdvyAGE7JFvGRwVvoeXMWgY",  # GLAM program upgrades
)


def squads_vault(multisig: str, index: int = 0) -> str:
    return find_pda([b"multisig", pk32(multisig), b"vault", bytes([index])], SQUADS_V4)[0]


def decode_multisig(data: bytes) -> dict:
    o = 8
    config_authority = pubkey(data, 40)
    threshold = u16(data, 72)
    time_lock = u32(data, 74)
    o = 94
    has_rc = data[o]
    o += 1 + (32 if has_rc else 0)
    o += 1  # bump
    n = u32(data, o)
    o += 4
    members = []
    for _ in range(n):
        members.append({"key": pubkey(data, o), "mask": data[o + 32]})
        o += 33
    return {
        "threshold": threshold,
        "timelock_s": time_lock,
        "config_authority": None if config_authority == SYSTEM_PROGRAM else config_authority,
        "members": len(members),
        "voters": sum(1 for m in members if m["mask"] & 2),
        "executors": sum(1 for m in members if m["mask"] & 4),
        "member_masks": [m["mask"] for m in members],
    }


def fmt_duration(s: int | None) -> str:
    if not s:
        return "no timelock"
    if s % 3600 == 0:
        return f"{s // 3600} h timelock"
    if s % 60 == 0:
        return f"{s // 60} min timelock"
    return f"{s} s timelock"


def authority_text(a: dict) -> str:
    k = a.get("kind")
    if k == "squads_v4":
        return f"Squads multisig {a['threshold']} of {a['voters']}, {fmt_duration(a['timelock_s'])}"
    if k == "single_key":
        return "single key (inferred)"
    if k == "none":
        return "none set"
    st = a.get("trace_state")
    if st == "not_traced":
        return "program-derived address, not traced yet (trace cap reached; traced on a later run)"
    if st == "trace_error":
        return "program-derived address, trace failed (will retry)"
    return "program-derived address; traced, controller not identified"


class AuthorityResolver:
    """Resolves authorities to a description. Mappings from authority to
    multisig are kept in `known` (persisted by the caller between runs); the
    multisig accounts themselves are re-read on every run, because a
    threshold or timelock can change."""

    RETRACE_AFTER_S = 7 * 86400      # a trace that found nothing
    RETRY_ERROR_AFTER_S = 6 * 3600   # a trace whose calls failed

    def __init__(self, rpc: SolanaRpc, known: dict | None = None, trace_budget: int = 6,
                 not_found: dict | None = None, trace_errors: dict | None = None):
        self.rpc = rpc
        self.trace_errors: dict[str, float] = dict(trace_errors or {})
        self.cap_text = f"trace cap of {trace_budget} this run reached"
        # authority -> unix time of the last trace that found nothing; not
        # traced again for a week.
        self.not_found: dict[str, float] = dict(not_found or {})
        self.known: dict[str, list] = dict(known or {})  # authority -> [multisig, index]
        self.trace_budget = trace_budget
        self.traced_this_run = 0

    def _match_hint(self, auth: str) -> tuple[str, int] | None:
        pool = set(KNOWN_MULTISIG_HINTS) | {v[0] for v in self.known.values()}
        for ms in pool:
            for i in range(3):
                if squads_vault(ms, i) == auth:
                    return ms, i
        return None

    def _trace(self, auth: str) -> tuple[str, int, str] | None:
        """Look through the authority's last 10 transactions for a Squads
        account whose multisig derives to this authority."""
        sigs = self.rpc.call("getSignaturesForAddress", [auth, {"limit": 10}])
        for e in sigs:
            tx = self.rpc.call("getTransaction", [e["signature"], {
                "encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}])
            if not tx:
                continue
            keys = [k["pubkey"] for k in tx["transaction"]["message"]["accountKeys"]]
            if SQUADS_V4 not in keys:
                continue
            cands = [k for k in keys if k not in (auth, SQUADS_V4)][:60]
            _, accts = self.rpc.multiple(cands)
            for k, v in accts.items():
                if not v or v["owner"] != SQUADS_V4:
                    continue
                for ms in {k, pubkey(v["data"], 8)}:
                    for i in range(3):
                        try:
                            if squads_vault(ms, i) == auth:
                                return ms, i, e["signature"]
                        except ValueError:
                            continue
        return None

    def resolve(self, authorities: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        pending: dict[str, tuple[str, int, str]] = {}
        unresolved: list[str] = []
        for a in dict.fromkeys(x for x in authorities if x):
            if a == SYSTEM_PROGRAM:
                out[a] = {"kind": "none", "address": a}
                continue
            if on_curve(a):
                out[a] = {"kind": "single_key", "address": a,
                          "basis": "on-curve key: a single key holds it (inferred)"}
                continue
            if a in self.known:
                ms, i = self.known[a]
                if squads_vault(ms, i) == a:
                    pending[a] = (ms, i, "derivation re-checked")
                    continue
            hit = self._match_hint(a)
            if hit:
                pending[a] = (hit[0], hit[1], "derivation matched a known multisig")
                continue
            unresolved.append(a)
        for a in unresolved:
            last = self.not_found.get(a)
            if last and time.time() - last < self.RETRACE_AFTER_S:
                out[a] = {"kind": "program_derived", "address": a, "trace_state": "not_found",
                          "basis": "off-curve address; no Squads v4 parent found in its last 10 transactions (traced "
                                   + time.strftime("%Y-%m-%d", time.gmtime(last)) + ")"}
                continue
            err = self.trace_errors.get(a)
            if err and time.time() - err < self.RETRY_ERROR_AFTER_S:
                out[a] = {"kind": "program_derived", "address": a, "trace_state": "trace_error",
                          "basis": "off-curve address; the last trace's calls failed ("
                                   + time.strftime("%Y-%m-%d %H:%M", time.gmtime(err)) + " UTC); retried after 6 h"}
                continue
            if self.traced_this_run >= self.trace_budget:
                out[a] = {"kind": "program_derived", "address": a, "trace_state": "not_traced",
                          "basis": f"off-curve address; not traced yet ({self.cap_text})"}
                continue
            self.traced_this_run += 1
            try:
                hit = self._trace(a)
            except RpcError as e:
                self.trace_errors[a] = time.time()
                out[a] = {"kind": "program_derived", "address": a, "trace_state": "trace_error",
                          "basis": f"off-curve address; trace failed: {e}"}
                continue
            self.trace_errors.pop(a, None)
            if hit:
                pending[a] = (hit[0], hit[1], f"traced through transaction {hit[2]}")
            else:
                self.not_found[a] = time.time()
                out[a] = {"kind": "program_derived", "address": a, "trace_state": "not_found",
                          "basis": "off-curve address; no Squads v4 parent found in its last 10 transactions"}
        if pending:
            slot, accts = self.rpc.multiple(sorted({v[0] for v in pending.values()}))
            for a, (ms, i, how) in pending.items():
                v = accts.get(ms)
                if not v or v["owner"] != SQUADS_V4:
                    out[a] = {"kind": "program_derived", "address": a,
                              "basis": f"expected Squads multisig {ms} not readable"}
                    continue
                self.known[a] = [ms, i]
                out[a] = {"kind": "squads_v4", "address": a, "multisig": ms, "vault_index": i,
                          "how": how, "slot": slot, **decode_multisig(v["data"])}
        for a, d in out.items():
            d["text"] = authority_text(d)
        return out


def upgrade_authorities(rpc: SolanaRpc, programs: list[str]) -> dict[str, dict]:
    """program -> {programdata, authority (None = immutable), last_deploy_slot, slot}."""
    slot1, progs = rpc.multiple(programs)
    pdata = {}
    for p, v in progs.items():
        if v and v["owner"] == BPF_UPGRADEABLE_LOADER and len(v["data"]) >= 36 and u32(v["data"], 0) == 2:
            pdata[p] = pubkey(v["data"], 4)
    slot2, pds = rpc.multiple(list(pdata.values()), data_slice=(0, 45))
    out = {}
    for p in programs:
        pd = pdata.get(p)
        v = pds.get(pd) if pd else None
        if not v:
            out[p] = {"program": p, "state": "closed or not upgradeable-loader", "slot": slot1}
            continue
        d = v["data"]
        auth = pubkey(d, 13) if d[12] == 1 else None
        out[p] = {"program": p, "programdata": pd, "last_deploy_slot": u64(d, 4),
                  "authority": auth, "state": "upgradeable" if auth else "immutable", "slot": slot2}
    return out


def now_ms() -> int:
    return int(time.time() * 1000)
