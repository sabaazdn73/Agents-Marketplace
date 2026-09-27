"""The issuer controls of one token, from the universe pass's raw record to the
six cells the site shows.

The universe pass records each control in the shape its family answered: a
Safe behind `pauser()` for xStocks on EVM, role members on a pause manager
for Ondo, a Token-2022 authority on Solana, a role replay on the Robinhood
registry. This module turns each into one shape:

    {capability, capability_note?, state, text, holder, detail?, evidence,
     upgrade_path?}

  capability   True, False or None (not established). Whether a direct
               function exists for the power; `capability_note` says more.
  state        what it is now, in a few words.
  holder       who can use it: {text, address?, kind?, threshold?, owners?,
               min_delay_s?, roles?, parties?}. A no-code address is "single
               key (inferred: no code)": no code does not prove an EOA.
  text         state and holder in one line, for a table cell.
  evidence     {address, block_or_slot, unit, method, url?}. Each claim
               carries the block of the read it rests on:
                 - a state read on the token: the record's own block or slot
                   (`from_record: True`, `address: "@token"`; the loader
                   fills both in);
                 - a role or authority read at another block: that block;
                 - a claim from verified source code: `unit: "source"`, the
                   implementation address and, where known, a public URL.
  upgrade_path one standard across programmes: whether the power can also be
               reached by upgrading the token, and with what delay.

One standard for the pause, freeze and burn cells: where there is no direct
function, the cell says "no direct function; reachable by an upgrade with no
delay (holder)" or "…after a 2 h timelock (holder)"; where there is one, the
same path is named in `upgrade_path`.

Nothing here reads a network or a store. It runs at build time
(scripts/te_build_universe.py).
"""

from __future__ import annotations

import re
from typing import Any

CONTROL_KEYS = ("pause", "freeze", "burn", "upgrade", "mint", "allowlist")

# Evidence whose address is the token itself says so with this marker, so the
# cells of every token in a family intern to one set; the loader puts the
# record's own address back.
TOKEN = "@token"

NO_CODE = "no code (EOA or undeployed account; no code does not prove an EOA)"

SOURCE_URL = {
    "ethereum": "https://etherscan.io/address/{}#code",
    "bsc": "https://bscscan.com/address/{}#code",
}


def _short(addr: str | None) -> str:
    if not addr:
        return ""
    return f"{addr[:6]}…{addr[-4:]}" if len(addr) > 14 else addr


def _holder_from_dict(h: dict | None, role: str | None = None) -> dict | None:
    if not isinstance(h, dict) or not h.get("address"):
        return None
    kind = h.get("kind") or ""
    out: dict[str, Any] = {"address": h["address"], "kind": kind}
    for k in ("code_bytes", "threshold", "owners", "min_delay_s"):
        if h.get(k) is not None:
            out[k] = h[k]
    if kind.startswith("Safe") and h.get("threshold") is not None:
        text = f"{h['threshold']} of {h['owners']} Safe multisig {_short(h['address'])}"
    elif kind == "TimelockController" and h.get("min_delay_s") is not None:
        text = f"TimelockController {_short(h['address'])}, {h['min_delay_s'] / 3600:g} h delay"
    elif kind.startswith("no code"):
        text = f"single key (inferred: no code) {_short(h['address'])}"
    else:
        text = f"{kind or 'kind not identified'} {_short(h['address'])}"
    out["text"] = f"{role}: {text}" if role else text
    if isinstance(h.get("owner"), dict):
        inner = _holder_from_dict(h["owner"])
        out["owner"] = inner
        out["text"] = f"{out['text']}, owned by {inner['text']}"
    return out


def _holder_from_key(addr: str | None, kind: str | None, role: str | None = None) -> dict | None:
    if not addr:
        return None
    text = f"{kind} {_short(addr)}" if kind else f"{_short(addr)} (kind not read)"
    return {"address": addr, "kind": kind or "kind not read", "text": f"{role}: {text}" if role else text}


def _known_holders(obj: Any, acc: dict | None = None) -> dict:
    acc = {} if acc is None else acc
    if isinstance(obj, dict):
        if obj.get("address") and obj.get("kind"):
            acc.setdefault(obj["address"].lower(), obj)
        for v in obj.values():
            _known_holders(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _known_holders(v, acc)
    return acc


def _roles_holder(roles: dict | None, known: dict, code: dict | None = None) -> dict | None:
    """Role members in any of the shapes the pass recorded:
    {ROLE: [{address, code_bytes}]}, {ROLE: {count, m0}}, {ROLE: [address]}."""
    if not isinstance(roles, dict) or not roles:
        return None
    code = code or {}
    out_roles: dict[str, Any] = {}
    parts = []
    for role, v in roles.items():
        members: list[dict] = []
        if v is None:
            out_roles[role] = None
            parts.append(f"{role}: holder not established")
            continue
        if isinstance(v, dict) and "count" in v:
            count = v.get("count")
            if v.get("m0"):
                members.append({"address": v["m0"]})
        else:
            for m in v:
                members.append({"address": m} if isinstance(m, str) else {k: m[k] for k in ("address", "code_bytes") if k in m})
            count = len(members)
        for m in members:
            k = known.get(m["address"].lower())
            cb = m.get("code_bytes", code.get(m["address"].lower()))
            if k and k.get("kind"):
                desc = _holder_from_dict(k)
                m["kind"], m["text"] = desc["kind"], desc["text"]
            elif cb == 0:
                m["code_bytes"] = 0
                m["kind"] = NO_CODE
                m["text"] = f"single key (inferred: no code) {_short(m['address'])}"
            elif cb:
                m["code_bytes"] = cb
                m["kind"] = f"contract ({cb} bytes, type not identified)"
                m["text"] = f"contract {_short(m['address'])}"
            else:
                m["text"] = _short(m["address"])
        out_roles[role] = {"count": count, "members": members}
        if count == 0:
            parts.append(f"{role}: 0 members")
        elif count is not None and count > len(members):
            parts.append(f"{role}: {count} members, first {', '.join(m['text'] for m in members)}")
        else:
            parts.append(f"{role}: {', '.join(m['text'] for m in members)}")
    return {"text": "; ".join(parts), "roles": out_roles}


def _ev_record(address=TOKEN, method=None) -> dict:
    return {"address": address, "method": method, "block_or_slot": None, "from_record": True}


def _ev_block(address, block, method, unit="block", label=None) -> dict:
    e = {"address": address, "method": method, "block_or_slot": block, "unit": unit}
    if label:
        e["block_label"] = label
    return e


def _ev_source(impl, chain_for_url=None, what="verified implementation source") -> dict:
    e = {"address": impl, "method": what, "block_or_slot": None, "unit": "source"}
    if impl and chain_for_url in SOURCE_URL:
        e["url"] = SOURCE_URL[chain_for_url].format(impl)
    return e


def _cell(capability, state, holder=None, *, evidence, detail=None, text=None, note=None, extra=None) -> dict:
    assert capability in (True, False, None)
    cell: dict[str, Any] = {
        "capability": capability,
        "state": state,
        "text": text or (f"{state}; {holder['text']}" if holder and holder.get("text") else state),
        "holder": holder,
        "evidence": evidence,
    }
    if note:
        cell["capability_note"] = note
    if detail:
        cell["detail"] = detail
    if extra:
        cell.update(extra)
    return cell


def _paused_state(p: dict) -> str:
    if "current_paused_features" in p:
        f = p["current_paused_features"]
        return "not paused (no paused features)" if f == [] else f"paused features: {', '.join(map(str, f))}"
    if p.get("current_paused") is True:
        return "paused"
    if p.get("current_paused") is False:
        return "not paused"
    return "pause state not read"


def _ne(reason: str, evidence: dict) -> dict:
    return _cell(None, "not established", None, evidence=evidence, detail=reason, note=reason,
                 text=f"not established: {reason}")


def _int_block(b) -> tuple[int | None, str | None]:
    """'latest ~124171733' -> (124171733, 'latest at read, approximate')."""
    if isinstance(b, int):
        return b, None
    m = re.search(r"(\d{5,})", str(b or ""))
    return (int(m.group(1)), "latest at read, approximate") if m else (None, None)


# ── families ────────────────────────────────────────────────────────────────


def _xstocks_evm(rec: dict, c: dict, ctx: dict) -> dict:
    p, f, b, u, m, t = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint", "transfer_restrictions"))
    impl = u.get("implementation")
    src = _ev_source(impl, "ethereum", "verified implementation source (verified at this address on Ethereum)")
    pa = _holder_from_dict(p.get("who"), "pauser")
    owner = _holder_from_dict(m.get("owner"), "token owner() (can swap the sanctions list)")
    lo = _holder_from_dict(f.get("list_owner"), "sanctions list owner")
    parties = [x for x in (owner, lo) if x]
    fh = {"text": "; ".join(x["text"] for x in parties), "parties": parties} if parties else None
    lname = f.get("list_contract_name")
    admin = _holder_from_dict(u.get("proxy_admin"), "ProxyAdmin")
    return {
        "pause": _cell(True, _paused_state(p), pa, evidence=_ev_record(method="isPaused(); pauser(); the pauser's getThreshold(), getOwners()"),
                       detail="setPause(bool) requires msg.sender == pauser (verified source)"),
        "freeze": _cell(True, "sanctions list checked on every transfer", fh,
                        evidence=_ev_record(method="sanctionsList(); owner(); the list's owner(); Safe getThreshold(), getOwners()"),
                        detail=(f"transfers from or to an address the list reports as sanctioned revert (verified source); "
                                f"list {f.get('list_contract')}" + (f" ({lname})" if lname else "") +
                                "; the token's owner() can replace the list with setSanctionsList(address)")),
        "burn": _cell(False, "no direct function", _holder_from_dict(b.get("burner"), "burner"), evidence=src,
                      detail="burn(account, amount) requires msg.sender == burner and account == burner or the token itself "
                             "(verified source); no function moves or burns a holder's balance"),
        "upgrade": _cell(True, "upgradeable (TransparentUpgradeableProxy)", admin,
                         evidence=_ev_record(method="EIP-1967 implementation and admin slots; ProxyAdmin.owner(); Safe getThreshold(), getOwners()"),
                         extra={"implementation": impl, "pattern": "TransparentUpgradeableProxy"}),
        "mint": _cell(True, "mintable", _holder_from_dict(m.get("authority"), "minter"),
                      evidence=_ev_record(method="minter(); setMinter(address) is owner()-only (verified source)")),
        "allowlist": _cell(False, "no allowlist", None, evidence=src,
                           detail="no allowlist in the implementation source; only the pause and the sanctions check gate transfers"),
    }


def _squads(ctx: dict, authority: str) -> tuple[dict | None, dict | None]:
    """The Squads multisig whose vault 0 is this authority, from the re-read."""
    for ms, s in (ctx.get("reread", {}).get("squads") or {}).items():
        if s.get("authority") == authority:
            return ms, s
    return None, None


def _sol_authority(ctx: dict, addr: str, role: str) -> tuple[dict, dict | None]:
    ms, s = _squads(ctx, addr)
    if s and s.get("vault0_is_authority"):
        h = {"address": addr, "kind": "Squads v4 vault", "multisig": ms, "threshold": s["threshold"],
             "owners": s["members"], "time_lock_s": s["time_lock_s"],
             "text": f"{role}: vault 0 of Squads v4 multisig {_short(ms)}, {s['threshold']} of {s['members']}, "
                     f"time lock {s['time_lock_s']} s"}
        return h, _ev_block(ms, s["slot"], s["method"], unit="slot")
    if s:
        h = {"address": addr, "kind": "program-derived address, controller not established",
             "text": f"{role}: program-derived {_short(addr)}; not vault 0 to 255 of Squads multisig {_short(ms)} "
                     f"({s['threshold']} of {s['members']}), so its controller is not established"}
        return h, _ev_block(ms, s["slot"], s["method"] + "; derivation tried for vault indexes 0 to 255", unit="slot")
    return _holder_from_key(addr, None, role), None


def _xstocks_sol(rec: dict, c: dict, ctx: dict) -> dict:
    p, f, b, u, m, t = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint", "transfer_restrictions"))
    ph, pev = _sol_authority(ctx, p.get("authority"), "pause authority")
    fh, fev = _sol_authority(ctx, f.get("freeze_authority"), "freeze authority")
    bh, bev = _sol_authority(ctx, b.get("permanent_delegate"), "permanent delegate")
    for h, ev in ((ph, pev), (fh, fev), (bh, bev)):
        if ev:
            h["evidence"] = ev
    return {
        "pause": _cell(True, _paused_state(p), ph, evidence=_ev_record(method="Token-2022 pausableConfig extension")),
        "freeze": _cell(True, "freeze authority set", fh, evidence=_ev_record(method="mint freezeAuthority")),
        "burn": _cell(True, "yes: a permanent delegate can transfer or burn from any holder", bh,
                      evidence=_ev_record(method="Token-2022 permanentDelegate extension")),
        "upgrade": _cell(False, "no program upgrade by the issuer (Token-2022); mint configuration can change",
                         _holder_from_key(u.get("transfer_hook_authority"), None, "transfer-hook and metadata authority"),
                         evidence=_ev_record(method="Token-2022 transferHook and tokenMetadata extensions"),
                         note="the Token-2022 program is not issuer-upgradeable; the transfer-hook authority can set a hook program (none set)",
                         detail="transfer hook program: none set"),
        "mint": _cell(True, "mintable", _holder_from_key(m.get("authority"), "on-curve key (keypair-capable)", "mint authority"),
                      evidence=_ev_record(method="mint mintAuthority")),
        "allowlist": _cell(False, "no allowlist", None, evidence=_ev_record(method="Token-2022 defaultAccountState and transferHook"),
                           detail="new token accounts start initialized (not frozen); no transfer hook program set"),
    }


def _ondo_sol(rec: dict, c: dict, ctx: dict) -> dict:
    p, f, b, u, m, t = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint", "transfer_restrictions"))
    prog = u.get("program")
    return {
        "pause": _cell(True, _paused_state(p), _holder_from_key(p.get("authority"), "off-curve (a PDA)", "pause authority"),
                       evidence=_ev_record(method="Token-2022 pausableConfig")),
        "freeze": _cell(True, "freeze authority set", _holder_from_key(f.get("freeze_authority"), "off-curve (a PDA)", "freeze authority"),
                        evidence=_ev_record(method="mint freezeAuthority")),
        "burn": _cell(False, "no direct function (no permanent delegate)", None,
                      evidence=_ev_record(method="Token-2022 extensions (no permanentDelegate)")),
        "upgrade": _cell(True, "upgradeable through the Ondo GM program",
                         _holder_from_key(u.get("program_upgrade_authority"), "off-curve (a PDA); which multisig, and any delay, not established", "program upgrade authority"),
                         evidence=_ev_block(prog, (ctx.get("sol_auth") or {}).get("slot"), "getAccountInfo on the program and its program data", unit="slot"),
                         detail=f"program {prog}; transfer-hook authority {u.get('transfer_hook_authority')}; hook program: none set"),
        "mint": _cell(True, "mintable", _holder_from_key(m.get("authority"), "off-curve PDA (deriving program not established)", "mint authority"),
                      evidence=_ev_record(method="mint mintAuthority")),
        "allowlist": _cell(False, "no allowlist", None, evidence=_ev_record(method="Token-2022 defaultAccountState and transferHook"),
                           detail="new token accounts start initialized; no transfer hook program set"),
    }


def _xstocks_ton(rec: dict, c: dict, ctx: dict) -> dict:
    a = c.get("admin") or {}
    reason = "the jetton code hash is not matched to a published contract, so the admin's powers are not established"
    ev = _ev_record(method="toncenter v3 jetton/masters")
    return {
        "pause": _ne(reason, ev), "freeze": _ne(reason, ev), "burn": _ne(reason, ev), "upgrade": _ne(reason, ev),
        "mint": _cell(True, "mintable", _holder_from_key(a.get("address"), a.get("kind"), "jetton admin"), evidence=ev),
        "allowlist": _ne("not read on TON", ev),
    }


def _xstocks_tron(rec: dict, c: dict, ctx: dict) -> dict:
    p, f, m = c.get("pause", {}), c.get("freeze_blacklist", {}), c.get("mint", {})
    return {
        "pause": _cell(True, _paused_state(p), _holder_from_key(p.get("who"), None, "pauser"),
                       evidence=_ev_record(method="triggerconstantcontract isPaused(), pauser()")),
        "freeze": _cell(True, "sanctions list set", None, detail=f"sanctionsList() = {f.get('list_contract')}",
                        evidence=_ev_record(method="triggerconstantcontract sanctionsList()")),
        "burn": _ne("source not read on Tron", _ev_record(method=None)),
        "upgrade": _ne("proxy structure not read on Tron", _ev_record(method=None)),
        "mint": _cell(True, "mintable", _holder_from_key(m.get("authority"), None, "minter"),
                      evidence=_ev_record(method="triggerconstantcontract minter()")),
        "allowlist": _ne("not read on Tron", _ev_record(method=None)),
    }


def _transfer_sim_cell(sim: dict | None, fallback_detail: str) -> dict:
    """The allowlist cell from an eth_call transfer to a never-used address."""
    if sim and sim.get("outcome") == "success":
        return _cell(False, "no allowlist on receipt", None,
                     evidence=_ev_block(sim["token"], sim["block"],
                                        f"eth_call transfer({sim['to']}, 1) from {sim['from']} (a pool holding the token): success; "
                                        f"the receiver has no transactions and no balance at the block; nothing broadcast"),
                     detail=f"a never-used address can receive (simulated on {sim['token']} on {sim['chain']}); {fallback_detail}")
    if sim and sim.get("outcome") == "reverted":
        return _cell(True, "receipt refused for a never-used address", None,
                     evidence=_ev_block(sim["token"], sim["block"], f"eth_call transfer({sim['to']}, 1) from {sim['from']}: reverted"),
                     detail=f"revert {sim.get('revert')}")
    return _ne("not simulated on this programme", _ev_record(method=None))


def _ondo_evm(rec: dict, c: dict, ctx: dict) -> dict:
    chain = rec["chain"]
    known = _known_holders(c)
    p, f, b, u, m, t, a = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint", "transfer_restrictions", "admin"))
    read = p.get("read") or ""
    manager = read.rsplit(" at ", 1)[-1] if " at " in read else None
    pms = ctx.get("pm_roles") or {}
    pm = pms.get(chain) or pms.get(f"{chain}:{manager}")
    if pm:
        blk, label = _int_block(pm.get("block"))
        roles = {k: v for k, v in pm["roles"].items() if k in ("PAUSE_TOKEN_ROLE", "UNPAUSE_TOKEN_ROLE", "DEFAULT_ADMIN_ROLE")}
        ph = _roles_holder(roles, known)
        ph["evidence"] = _ev_block(manager, blk, "TokenPauseManager getRoleMemberCount/getRoleMember", label=label)
    else:
        ph = {"text": "pause manager role holders not read on this chain"}
    admin = _holder_from_dict(a.get("default_admin_member0"), "DEFAULT_ADMIN_ROLE")
    nburn = b.get("burner_role_members")
    if nburn == 0:
        bstate = "yes, behind a grant: BURNER_ROLE has 0 members; DEFAULT_ADMIN_ROLE can grant it"
    else:
        bstate = f"yes: BURNER_ROLE has {nburn} member{'s' if nburn != 1 else ''}"
    impl = ((ctx.get("reread") or {}).get("ondo_beacons") or {}).get(chain, {}).get("implementation")
    beacon = u.get("beacon_detail") or {}
    nm = m.get("minter_role_members")
    mh = {"text": f"MINTER_ROLE: {nm} member{'s' if nm != 1 else ''}",
          "roles": {"MINTER_ROLE": {"count": nm, "members": [{"address": m.get("minter_role_member0")}] if m.get("minter_role_member0") else []}}}
    sims = (ctx.get("reread") or {}).get("transfers") or {}
    sim = sims.get(f"ondo-{chain}")
    allow = _transfer_sim_cell(sim or sims.get("ondo-ethereum"),
                               "every transfer also consults the compliance contract, whose rules are not decoded (a denylist is possible)")
    if not sim:
        allow["detail"] += "; this chain was not simulated, the same GMToken implementation was"
    return {
        "pause": _cell(True, _paused_state(p), ph, evidence=_ev_record(address=manager or TOKEN, method="isTokenPaused(token) on the token's pause manager")),
        "freeze": _cell(True, "compliance check on sender, receiver and spender (rules not decoded)",
                        _holder_from_dict(f.get("compliance_wrapper_owner"), "compliance owner"),
                        evidence=_ev_record(method="compliance(); the wrapper's owner(); Safe getThreshold(), getOwners()"),
                        detail=f"_beforeTokenTransfer calls compliance.checkIsCompliant (verified source); wrapper {f.get('compliance_wrapper')}"),
        "burn": _cell(True, bstate, admin, evidence=_ev_record(method="getRoleMemberCount(BURNER_ROLE); getRoleMember(DEFAULT_ADMIN_ROLE, 0); getMinDelay()"),
                      detail="burn(address from, uint256 amount) onlyRole(BURNER_ROLE) burns from any account (verified source)",
                      extra={"burner_role_members": nburn, **({"source": _ev_source(impl, chain)} if impl else {})}),
        "upgrade": _cell(True, "upgradeable (BeaconProxy)", _holder_from_dict(beacon.get("owner"), "beacon owner"),
                         evidence=_ev_record(method="EIP-1967 beacon slot; beacon owner(); getMinDelay()"),
                         extra={"beacon": u.get("beacon"), "pattern": "BeaconProxy"}),
        "mint": _cell(True, "mintable", mh, evidence=_ev_record(method="getRoleMemberCount/getRoleMember(MINTER_ROLE)")),
        "allowlist": allow,
    }


def _robinhood(rec: dict, c: dict, ctx: dict) -> dict:
    p, f, b, u, m = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint"))
    rr = c.get("role_read") or {}
    rb = rr.get("block")
    rmethod = "RoleGranted/RoleRevoked replayed from the registry's logs, then hasRole() at the block"
    known = _known_holders(c)
    registry = f.get("registry") or u.get("beacon")
    impl = "0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2"
    src = _ev_source(impl, None, "verified implementation source (Stock), verified on Robinhood Chain's explorer")
    sim = ctx.get("rh_sim")

    def roles(v):
        h = _roles_holder(v, known)
        if h:
            h["evidence"] = _ev_block(registry, rb, rmethod)
        return h

    burn_extra = {"simulation": sim} if sim else {}
    if sim:
        bstate = (f"yes: adminBurn(from, amount) burns from any holder; eth_call simulation succeeded from the role "
                  f"holder on {_short(sim['token'])} at block {sim['block']}")
        bev = _ev_block(sim["token"], sim["block"], "eth_call adminBurn(holder, 1) from the ADMIN_BURNER_ROLE holder and from a stranger; see `simulation`")
    else:
        bstate, bev = "yes: adminBurn(from, amount) burns from any holder (verified source)", src
    sims = (ctx.get("reread") or {}).get("transfers") or {}
    return {
        "pause": _cell(True, _paused_state(p), roles(p.get("who")), evidence=_ev_record(method="paused() (token flag or registry-wide pause); tokenPaused()")),
        "freeze": _cell(True, "denylist (registry isBlocked)", roles(f.get("who")), evidence=src,
                        detail="transfer, transferFrom and approve revert for an address the registry reports blocked "
                               "(onlyNotBlocked on sender, receiver and caller; verified source)"),
        "burn": _cell(True, bstate, roles(b.get("who")), evidence=bev,
                      detail="adminBurn(from, amount) onlyRole(ADMIN_BURNER_ROLE), with no pause or block check (verified source)",
                      extra=burn_extra),
        "upgrade": _cell(True, "upgradeable (BeaconProxy; the beacon is the registry)", roles(u.get("who")),
                         evidence=_ev_record(method="EIP-1967 beacon slot"),
                         extra={"beacon": u.get("beacon"), "pattern": "BeaconProxy"}),
        "mint": _cell(True, "mintable", roles(m.get("who")), evidence=_ev_block(registry, rb, rmethod)),
        "allowlist": _transfer_sim_cell(sims.get("robinhood"), "the registry denylist still applies"),
    }


def _bstocks(rec: dict, c: dict, ctx: dict) -> dict:
    known = _known_holders(c)
    p, f, b, u, m = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint"))
    read = p.get("read") or ""
    manager = read.rsplit(" at ", 1)[-1] if " at " in read else None
    pm = (ctx.get("pm_roles") or {}).get("bsc:" + (manager or ""))
    ph = _roles_holder({"DEFAULT_ADMIN_ROLE": (p.get("who") or {}).get("DEFAULT_ADMIN_ROLE")}, known)
    if ph:
        ph["text"] += "; PAUSE_TOKEN_ROLE, UNPAUSE_TOKEN_ROLE, PAUSER_ROLE and UNPAUSER_ROLE have 0 members, so the pause role names on this manager are not identified"
        if pm:
            blk, label = _int_block(pm.get("block"))
            ph["evidence"] = _ev_block(manager, blk, "getRoleMemberCount/getRoleMember on the pause manager", label=label)
    impl = "0xcfed6c4679297ea4889f8183bc057b4a86c64e46"
    src = _ev_source(impl, "bsc", "verified implementation source (SecuritiesToken)")
    beacon = u.get("beacon_detail") or {}
    roles = {"ISSUER_ROLE": m.get("ISSUER_ROLE") or [], "DEFAULT_ADMIN_ROLE": m.get("DEFAULT_ADMIN_ROLE") or []}
    sims = (ctx.get("reread") or {}).get("transfers") or {}
    return {
        "pause": _cell(True, _paused_state(p), ph, evidence=_ev_record(address=manager or TOKEN, method="isTokenPaused(token) on the pause manager")),
        "freeze": _cell(True, "blocklist and sanctions list (compliance contract)", None,
                        evidence=_ev_source("0x53dba7aabde774787a1f57236b235567da8e14f4", "bsc", "verified compliance source"),
                        detail="_update calls compliance.checkIsCompliant on sender, receiver and spender; the compliance contract "
                               "has addToBlocklist and addToSanctionsList under COMPLIANCE_ROLE; the lists' contents were not enumerated"),
        "burn": _cell(False, "no direct function", None, evidence=src,
                      detail="burn(amount) burns only the caller's own balance and needs DEFAULT_ADMIN or ISSUER role; no forced transfer or holder burn"),
        "upgrade": _cell(True, "upgradeable (BeaconProxy)", _holder_from_dict(beacon.get("owner"), "beacon owner"),
                         evidence=_ev_record(method="EIP-1967 beacon slot; beacon owner(); eth_getCode on the owner"),
                         extra={"beacon": u.get("beacon"), "pattern": "BeaconProxy"}),
        "mint": _cell(True, "mintable" if m.get("mintEnabled") else "minting disabled", _roles_holder(roles, known),
                      evidence=_ev_record(method="getRoleMembers(bytes32); mintEnabled()")),
        "allowlist": _transfer_sim_cell(sims.get("bstocks"), "whether the blocklist is populated was not read"),
    }


def _coinbase(rec: dict, c: dict, ctx: dict) -> dict:
    known = _known_holders(c)
    p, f, b, u, m = (c.get(k, {}) for k in ("pause", "freeze_blacklist", "burn_seize", "upgrade", "mint"))
    cb = ctx.get("cb_roles") or {}
    rb = cb.get("block")
    code = cb.get("code_bytes") or {}
    rmethod = (f"hasRole() at the block for every address in the tokens' RoleGranted logs and four candidate addresses; "
               f"{cb.get('log_fetch_failures', 0)} of the log queries failed, so a holder may be missing")
    probe = f.get("policy5_probe") or {}
    pol = f.get("policy_ids") or {}
    admin = probe.get("policyAdmin(5)")
    docs = "https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base"

    def roles(v):
        h = _roles_holder(v, known, code)
        if h:
            h["evidence"] = _ev_block(TOKEN, rb, rmethod)
        return h

    used = sorted({k for k, v in pol.items() if v is not None})
    unset = sorted({k for k, v in pol.items() if v is None})
    ph = {"address": admin, "kind": "not read", "text": f"policyAdmin(5): {_short(admin)} (kind not read)",
          "evidence": _ev_block(TOKEN, rb, "policyAdmin(5) on the Base Policy Registry precompile")} if admin else None
    seize = (b.get("who") or {}).get("SEIZE_ROLE")
    return {
        "pause": _cell(True, _paused_state(p), roles(p.get("who")), evidence=_ev_record(method="pausedFeatures()")),
        "freeze": _cell(True, "policy 5 checked on transfer and mint", ph,
                        evidence=_ev_block(TOKEN, rb, "policy id getters on the token; isAuthorized(5, a never-used address) "
                                                      "and policyAdmin(5) on the Policy Registry"),
                        detail=(f"policy 5 applies to {', '.join(used)}; unset: {', '.join(unset) or 'none'}; "
                                f"isAuthorized(5, a never-used address) = {probe.get('isAuthorized(5, never-used 0x…fff11)')}, "
                                f"so the policy admits addresses it has not seen (a blocklist-type or open policy)")),
        "burn": _cell(True, "yes: seizeWithMemo under SEIZE_ROLE", roles(b.get("who")),
                      evidence={"address": TOKEN, "method": "B20 documentation (class D) for the function; roles by hasRole()",
                                "block_or_slot": rb, "unit": "block", "url": docs},
                      detail=None if seize is not None else "no SEIZE_ROLE holder found among the addresses checked; see the holder evidence"),
        "upgrade": _cell(False, "no issuer upgrade (B20 precompile); changes only with a Base network upgrade", None,
                         evidence=_ev_record(method="eth_getCode (1 byte)"), extra={"pattern": "B20 precompile"},
                         note="the code is part of the chain"),
        "mint": _cell(True, "mintable", roles(m.get("who")), evidence=_ev_block(TOKEN, rb, rmethod)),
        "allowlist": _transfer_sim_cell(((ctx.get("reread") or {}).get("transfers") or {}).get("coinbase"),
                                        "policy 5 still applies to every transfer"),
    }


# ── the one standard: what an upgrade can reach ──────────────────────────────


def upgrade_path(fam: str, cells: dict) -> dict | None:
    """{delay_s, text} for families where an upgrade can replace the token's
    code, or None where it cannot (Token-2022, B20) or is not established."""
    h = (cells.get("upgrade") or {}).get("holder") or {}
    if fam == "xstocks-evm":
        owner = h.get("owner") or {}
        return {"delay_s": 0, "holder": owner.get("text") or h.get("text"),
                "text": f"reachable by an upgrade with no delay ({owner.get('text') or h.get('text')}, through the ProxyAdmin; no timelock in the path)"}
    if fam == "bstocks-evm":
        return {"delay_s": 0, "holder": h.get("text"), "text": f"reachable by an upgrade with no delay ({h.get('text')})"}
    if fam == "robinhood-evm":
        return {"delay_s": 0, "holder": h.get("text"), "text": f"reachable by an upgrade with no delay ({h.get('text')})"}
    if fam == "ondo-evm":
        d = (h.get("min_delay_s") or 0) / 3600
        return {"delay_s": h.get("min_delay_s"), "holder": h.get("text"),
                "text": f"reachable by an upgrade after a {d:g} h timelock ({h.get('text')})"}
    if fam == "ondo-solana":
        return {"delay_s": None, "holder": h.get("text"),
                "text": f"reachable by upgrading the Ondo GM program; delay not established ({h.get('text')})"}
    return None


def _apply_upgrade_path(fam: str, cells: dict) -> None:
    path = upgrade_path(fam, cells)
    if not path:
        return
    for k in ("pause", "freeze", "burn"):
        cell = cells[k]
        cell["upgrade_path"] = path
        if cell["capability"] is False:
            cell["state"] = f"no direct function; {path['text']}"
            cell["text"] = cell["state"]
            cell["capability_note"] = path["text"]


def family_of(rec: dict) -> str:
    chain = rec["chain"]
    kind = "solana" if chain == "solana" else chain if chain in ("ton", "tron") else "evm"
    return f"{rec['issuer']}-{kind}"


FAMILIES = {
    "xstocks-evm": _xstocks_evm, "xstocks-solana": _xstocks_sol, "xstocks-ton": _xstocks_ton,
    "xstocks-tron": _xstocks_tron, "ondo-evm": _ondo_evm, "ondo-solana": _ondo_sol,
    "robinhood-evm": _robinhood, "bstocks-evm": _bstocks, "coinbase-evm": _coinbase,
}


def normalise_controls(rec: dict, ctx: dict | None = None) -> dict | None:
    """The six control cells for one raw universe record, or None when the
    record carries no controls (the token is not deployed on that chain).
    `ctx` carries the reads made outside the record: role files, the
    adminBurn simulation and the public-RPC re-reads."""
    c = rec.get("controls")
    if not c:
        return None
    fam = family_of(rec)
    fn = FAMILIES.get(fam)
    if fn is None:
        raise ValueError(f"no controls normaliser for family {fam}")
    cells = fn(rec, c, ctx or {})
    _apply_upgrade_path(fam, cells)
    for cell in cells.values():
        if cell.get("capability") not in (True, False, None):
            raise ValueError(f"{rec['id']}: capability must be a boolean or None")
    return cells
