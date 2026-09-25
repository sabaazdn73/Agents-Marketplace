"""The xStocks figures the measurements record cites, read from chain, and
whether each reconciles with what the issuer publishes for the same quantity.

Run: ./venv/bin/python scripts/te_xstocks_reads.py [--all-mints] [--mint-coverage]

Every chain value is printed with the slot or block it was read at. The
issuer's figures are fetched from its public API only to compute a
reconciliation verdict, which is printed with the issuer value beside it for
the person running the check. Nothing here stores an issuer figure, and the
repository reproduces none of them (E18 in mcp/TOKENIZED-EQUITIES.md). Verdicts
use the vocabulary of section 4.8 there: reconciles, reconciles_after_exclusion,
does_not_reconcile, no_chain_counterpart.

What it reads:

  1. AZNx's multiplier: the Token-2022 scaledUiAmountConfig on Solana (the
     effective value, newMultiplier once its timestamp has passed),
     getCurrentMultiplier() on Ethereum and BNB Smart Chain, and
     get_display_multiplier on TON, each against the issuer's figure. Then the
     block range in which it halved, by bisecting past Ethereum state, and the
     label the issuer gives that change in each of its two histories.
  2. The multiplier's magnitude on a sample (KLACx, NFLXx, PPLTx, AZNx), Solana.
  3. TSLAx, AZNx and SPYx supply on every chain the issuer lists (8 EVM chains,
     Solana, TON, Tron), the balance of every wallet on the issuer's public
     system-wallet list on each, and the balance of each address on the named
     exclusion list. Verdicts on total and circulating supply, and the total
     with Solana and TON left unscaled. If any supply or balance read fails,
     the verdict is chain_incomplete naming the chains, never a comparison
     with a missing chain counted as 0.
  4. The Solana authorities on a sample of mints, whether each is on the
     issuer's list, whether each is on the ed25519 curve, and the two Squads v4
     multisigs whose vault 0 holds the freeze authority and the permanent
     delegate: vault derivation, threshold and members.
  5. One mint-creation transaction, and a sample of sixteen more from the
     permanent delegate's history: the mint authority named at creation
     against the mint authority now.
  6. The role getters on TSLAx on Ethereum, and which holders are contracts.
  8. Ink and HyperEVM: supply and code hash for three tokens, TSLAx's mint and
     burn events on Ink (from the chain's public explorer API), and the
     matching mint on HyperEVM.
  10. The shape of the issuer's withholding data: how many corporate-action
      records carry a withholding field and how many distinct values there
      are, never the values (E18).
  7. With --all-mints: every Solana mint the issuer lists, in batches of 100:
     program and every authority, the effective multiplier, how many mints'
     stored multiplier field differs from the effective one, how many have
     supply 0, and a verdict against the issuer's multiplier mint by mint.
     About 1,200 issuer calls, so several minutes.
  9. With --mint-coverage: every transaction the mint authority 7pt9 appears
     in, and which listed mints have ever been minted to under its signature.
     One read per transaction, so about fifteen minutes.

ENDPOINTS. No key is used anywhere. Overridable by environment: TE_SOLANA_RPC,
TE_ETH_ARCHIVE_RPC (past Ethereum state), TE_TON_API, TE_TRON_API,
TE_XSTOCKS_API, and TE_RPC_<NETWORK> for each EVM network (TE_RPC_ETHEREUM and
so on). Only the scheme and host of an endpoint are ever printed.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import struct
import sys
import time
from urllib.parse import urlsplit

import httpx
from eth_utils import keccak

SOLANA_RPC = os.environ.get("TE_SOLANA_RPC", "https://api.mainnet-beta.solana.com")
TON_API = os.environ.get("TE_TON_API", "https://toncenter.com/api/v3")
TRON_API = os.environ.get("TE_TRON_API", "https://api.trongrid.io")
XSTOCKS_API = os.environ.get("TE_XSTOCKS_API", "https://api.xstocks.fi/api/v2")
EVM_RPC = {
    "Ethereum": "https://ethereum-rpc.publicnode.com",
    "BinanceSmartChain": "https://bsc-rpc.publicnode.com",
    "Arbitrum": "https://arbitrum-one-rpc.publicnode.com",
    "Mantle": "https://rpc.mantle.xyz",
    "Ink": "https://rpc-gel.inkonchain.com",
    "XLayer": "https://rpc.xlayer.tech",
    "Optimism": "https://optimism-rpc.publicnode.com",
    "HyperEVM": "https://rpc.hyperliquid.xyz/evm",
}
EVM_RPC = {k: os.environ.get("TE_RPC_" + k.upper(), v) for k, v in EVM_RPC.items()}

TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
SQUADS_V4 = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
UNLISTED_SOL = "9U76mo3WuP28s4kYJ9CMH1CiQh6Ph3r5Zg5awZM5vMQd"
SQUADS_MULTISIGS = [
    "8gep9m2BmCqz4qCQMcqZoqnaGedXgRWehFYhKaPuiu8X",
    "Dsm8Dmh6ip3pc19G3oB3FBc2Kx7A9sQBSA2akD2Jraot",
]
# A transaction in which the permanent delegate's history shows a new mint
# being created; read to see who signs a creation.
CREATION_TX = "5XciNwU2vHVaQFXTuTb47ocBbefNSALXpA9pSUsvUmr4dnwZ57bQnwgcUG3Hmfg2CnkNW4S9gQAF3bQ4eFcMrq7W"
TRON_CALLER = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"  # the zero address in Tron form

ASSETS: dict = {}
client = httpx.Client(timeout=90, headers={"User-Agent": "tnega-te-xstocks"})


# Tolerances, all relative (section 4.8 of the spec). Supply figures, total and
# circulating alike, are compared relative to the token's TOTAL supply: a
# circulating figure can be small (AZNx's is about 0.2 percent of its total), and
# the same dust that is nothing against the total would be a disagreement
# against the circulating figure. Multipliers are compared relative to their own
# size.
SUPPLY_TOLERANCE = 1e-9
MULTIPLIER_TOLERANCE = 1e-12

# The named exclusion list the circulating verdict may use (section 4.8 of the
# spec). An address enters it only by the owner's approval. 9U76 is here
# because the issuer's circulating figure excludes it, as the verdict below
# shows; whether it stays is the owner's decision, flagged in the spec.
EXCLUSIONS_SOLANA = ["9U76mo3WuP28s4kYJ9CMH1CiQh6Ph3r5Zg5awZM5vMQd"]


def close(ours: float, theirs: float, scale: float, tol: float) -> bool:
    return abs(ours - theirs) <= tol * abs(scale)


def mult_verdict(ours, theirs) -> str:
    if ours is None:
        return "chain_incomplete"
    return "reconciles" if close(ours, theirs, max(abs(ours), abs(theirs)), MULTIPLIER_TOLERANCE) else "does_not_reconcile"


def host(url: str) -> str:
    """Scheme and host only: never a path, a query or any userinfo."""
    p = urlsplit(url)
    port = f":{p.port}" if p.port else ""
    return f"{p.scheme}://{p.hostname}{port}"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _retry(fn, what: str):
    last = None
    for k in range(6):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - reported, then retried
            last = e
            time.sleep(3 * (k + 1))
    raise RuntimeError(f"{what} failed after retries: {type(last).__name__}")


# ---------- issuer API ----------

def api(path: str):
    def go():
        r = client.get(XSTOCKS_API + path)
        r.raise_for_status()
        return r.json()
    out = _retry(go, "issuer API read")
    time.sleep(0.2)
    return out, now()


MAX_PAGES = 40  # 4,000 records; the asset list is about 1,100


def api_all(path: str, first_page: int, size_key: str = "pageSize"):
    nodes, page = [], first_page
    while True:
        if page - first_page >= MAX_PAGES:
            raise RuntimeError(f"issuer API pagination exceeded {MAX_PAGES} pages")
        sep = "&" if "?" in path else "?"
        d, _ = api(f"{path}{sep}page={page}&{size_key}=100")
        nodes += d["nodes"]
        if not d["page"].get("hasNextPage"):
            return nodes
        page += 1


# ---------- Solana ----------

def sol(method: str, params):
    def go():
        r = client.post(SOLANA_RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(str(j["error"].get("code")))
        return j["result"]
    out = _retry(go, "solana read")
    time.sleep(0.6)
    return out


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s: str, length: int) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    return n.to_bytes(length, "big")


def b58encode(b: bytes) -> str:
    n, s = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


_P = 2**255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def on_curve(key32: bytes) -> bool:
    """True if the 32 bytes decode to an ed25519 point: a key a keypair can
    hold. A program-derived address is off the curve by construction."""
    y = int.from_bytes(key32, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    u, v = (y * y - 1) % _P, (_D * y * y + 1) % _P
    x2 = u * pow(v, _P - 2, _P) % _P
    return x2 == 0 or pow(x2, (_P - 1) // 2, _P) == 1


def find_pda(seeds: list[bytes], program: str) -> str:
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + b58decode(program, 32) + b"ProgramDerivedAddress").digest()
        if not on_curve(h):
            return b58encode(h)
    raise RuntimeError("no PDA")


def mint_info(mint: str):
    r = sol("getAccountInfo", [mint, {"encoding": "jsonParsed", "commitment": "finalized"}])
    info = r["value"]["data"]["parsed"]["info"]
    ext = {e["extension"]: e.get("state") for e in info.get("extensions", [])}
    return r["context"]["slot"], r["value"]["owner"], info, ext


def effective_multiplier(ext) -> tuple[float, dict]:
    s = ext["scaledUiAmountConfig"]
    eff = float(s["newMultiplier"]) if time.time() >= s["newMultiplierEffectiveTimestamp"] else float(s["multiplier"])
    return eff, s


def sol_owner_balance(owner: str, mint: str) -> tuple[int, int]:
    r = sol("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "finalized"}])
    raw = sum(int(v["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for v in r["value"])
    return raw, r["context"]["slot"]


# ---------- EVM ----------

def sel(sig: str) -> str:
    return "0x" + keccak(text=sig)[:4].hex()


def evm(net: str, method: str, params):
    url = EVM_RPC[net]

    def go():
        r = client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(str(j["error"].get("code")))
        return j["result"]
    return _retry(go, f"{net} read")


def evm_call(net: str, to: str, data: str, block: str):
    return evm(net, "eth_call", [{"to": to, "data": data}, block])


def evm_uint(net, to, data, block) -> int | None:
    try:
        v = evm_call(net, to, data, block)
    except RuntimeError:
        return None
    return int(v[2:66], 16) if v and len(v) >= 66 else None


def pad_addr(a: str) -> str:
    return a.lower().replace("0x", "").rjust(64, "0")


ETH_ARCHIVE_RPC = os.environ.get("TE_ETH_ARCHIVE_RPC", "https://eth.drpc.org")
ARCHIVE_LO, ARCHIVE_HI = 24235000, 24400000  # 2026-01-14 and 2026-02-06


def _archive(method, params):
    def go():
        r = client.post(ETH_ARCHIVE_RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(str(j["error"].get("code")))
        return j["result"]
    out = _retry(go, "ethereum archive read")
    time.sleep(0.3)
    return out


def eth_archive_mult(token: str, block: int) -> int:
    return int(_archive("eth_call", [{"to": token, "data": sel("getCurrentMultiplier()")}, hex(block)])[2:66], 16)


def eth_archive_time(block: int) -> str:
    ts = int(_archive("eth_getBlockByNumber", [hex(block), False])["timestamp"], 16)
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- TON / Tron ----------

def ton_get(path: str, params: dict):
    def go():
        r = client.get(TON_API + path, params=params)
        r.raise_for_status()
        return r.json()
    out = _retry(go, "ton read")
    time.sleep(1.2)
    return out


def ton_display_multiplier(jetton: str) -> float:
    def go():
        r = client.post(TON_API + "/runGetMethod", json={"address": jetton, "method": "get_display_multiplier", "stack": []})
        r.raise_for_status()
        return r.json()
    j = _retry(go, "ton read")
    time.sleep(1.2)
    num, den = (int(x["value"], 16) for x in j["stack"][:2])
    return num / den


def tron_call(contract: str, selector: str, param: str = ""):
    def go():
        r = client.post(TRON_API + "/wallet/triggerconstantcontract", json={
            "owner_address": TRON_CALLER, "contract_address": contract,
            "function_selector": selector, "parameter": param, "visible": True})
        r.raise_for_status()
        return int(r.json()["constant_result"][0], 16)
    out = _retry(go, "tron call")
    time.sleep(0.5)
    return out


def tron_hex(addr: str) -> str:
    return b58decode(addr, 25)[1:21].hex().rjust(64, "0")


def tron_block() -> int:
    def go():
        r = client.post(TRON_API + "/wallet/getnowblock")
        r.raise_for_status()
        return r.json()["block_header"]["raw_data"]["number"]
    return _retry(go, "tron read")


def attempt(fn):
    """Run a read; None means the read failed, which is unknown and never 0."""
    try:
        return fn()
    except Exception:  # noqa: BLE001 - reported by the caller as unknown
        return None


# ---------- sections ----------

def section_multiplier(assets):
    print("\n== 1. AZNx multiplier: chain against issuer ==")
    a = assets["AZNx"]
    dep = {d["network"]: d["address"] for d in a["deployments"]}
    slot, _, _, ext = mint_info(dep["Solana"])
    eff, s = effective_multiplier(ext)
    rows = [("Solana", f"slot {slot}", eff, f"field {s['multiplier']}, new {s['newMultiplier']} at {s['newMultiplierEffectiveTimestamp']}")]
    for net in ("Ethereum", "BinanceSmartChain"):
        blk = evm(net, "eth_blockNumber", [])
        v = evm_uint(net, dep[net], sel("getCurrentMultiplier()"), blk)
        rows.append((net, f"block {int(blk, 16)}", v / 1e18 if v is not None else None, "getCurrentMultiplier()"))
    rows.append(("Ton", f"read {now()}", ton_display_multiplier(dep["Ton"]), "get_display_multiplier"))
    for net, where, chain_v, how in rows:
        d, t = api(f"/public/assets/AZNx/multiplier?network={net}")
        v = mult_verdict(chain_v, d["currentMultiplier"])
        print(f"  {net:18} chain {chain_v!r:24} ({where}, {how})  {v}  [issuer {d['currentMultiplier']!r}, fetched {t}]")
    # The 2026-02-02 event, located on chain by bisecting getCurrentMultiplier()
    # over past Ethereum blocks through an archive endpoint.
    tok = dep["Ethereum"]
    lo, hi = ARCHIVE_LO, ARCHIVE_HI
    m_lo = eth_archive_mult(tok, lo)
    m_hi = eth_archive_mult(tok, hi)
    print(f"  Ethereum archive ({host(ETH_ARCHIVE_RPC)}): block {lo} ({eth_archive_time(lo)}) {m_lo!r};"
          f" block {hi} ({eth_archive_time(hi)}) {m_hi!r}; ratio {m_hi / m_lo!r}")
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if eth_archive_mult(tok, mid) == m_lo:
            lo = mid
        else:
            hi = mid
    print(f"  the multiplier changes between block {lo} ({eth_archive_time(lo)}) and block {hi} ({eth_archive_time(hi)})")
    hist, t = api("/public/assets/AZNx/multiplier/history?network=Ethereum&pageSize=100")
    ca, t2 = api("/public/corporate-actions/history?symbol=AZNx&pageSize=100")
    near = [n for n in hist["nodes"] if abs(n["multiplier"] - m_hi / 1e18) < 1e-12]
    cnear = [n for n in ca["nodes"] if n["multiplierNew"] and abs(float(n["multiplierNew"]) - m_hi / 1e18) < 1e-12]
    print(f"  issuer label for that change: multiplier history {[n['reason'] for n in near]} (fetched {t});"
          f" corporate-actions history {[n['caType'] for n in cnear]} (fetched {t2})")
    for n in near:
        print(f"  issuer multiplier-history activation time {n['activationDateTime']}")
    for n in cnear:
        print(f"  issuer corporate-actions effective time {n['effectiveTimeUtc']}, notes {n['notes']!r}")


def section_magnitude(assets):
    print("\n== 2. Multiplier magnitude on a sample, Solana ==")
    for sym in ("KLACx", "NFLXx", "PPLTx", "AZNx"):
        mint = next(d["address"] for d in assets[sym]["deployments"] if d["network"] == "Solana")
        slot, _, _, ext = mint_info(mint)
        eff, _ = effective_multiplier(ext)
        d, t = api(f"/public/assets/{sym}/multiplier?network=Solana")
        v = mult_verdict(eff, d["currentMultiplier"])
        print(f"  {sym:6} chain {eff!r:22} slot {slot}  {v} (issuer fetched {t})"
              f"   raw-unit error if ignored: x{max(eff, 1 / eff):.4f}")


def section_supply(assets, wallets):
    listed = {"Evm": [], "Svm": [], "Ton": [], "Tron": []}
    for w in wallets:
        listed[w["networkType"]].append(w["address"])
    for sym in ("TSLAx", "AZNx", "SPYx"):
        print(f"\n== 3. {sym}: supply and listed-wallet balances per chain ==")
        dep = {d["network"]: d["address"] for d in assets[sym]["deployments"]}
        total = held = 0.0
        raw_total = 0.0  # Solana and TON left unscaled, for the scaling check
        missing = []     # chains where a supply or a listed balance could not be read
        for net in EVM_RPC:
            if net not in dep:
                continue
            blk = attempt(lambda: evm(net, "eth_blockNumber", []))
            if blk is None:
                missing.append(net)
                print(f"  {net:18} block read failed: chain_incomplete")
                continue
            dec = evm_uint(net, dep[net], sel("decimals()"), blk)
            ts = evm_uint(net, dep[net], sel("totalSupply()"), blk)
            bals = [evm_uint(net, dep[net], sel("balanceOf(address)") + pad_addr(w), blk) for w in listed["Evm"]]
            if dec is None or ts is None or any(b is None for b in bals):
                missing.append(net)
                print(f"  {net:18} block {int(blk, 16)}  a supply or balance read failed: chain_incomplete")
                continue
            h = sum(bals)
            total += ts / 10**dec
            raw_total += ts / 10**dec
            held += h / 10**dec
            print(f"  {net:18} block {int(blk, 16):>10}  supply {ts / 10**dec:>16.6f}  listed {h / 10**dec:>16.6f}  {100 * h / ts:7.3f}%")
        excluded = {}
        sol_read = attempt(lambda: mint_info(dep["Solana"]))
        sol_bals = [attempt(lambda w=w: sol_owner_balance(w, dep["Solana"])) for w in listed["Svm"]]
        exc_bals = {w: attempt(lambda w=w: sol_owner_balance(w, dep["Solana"])) for w in EXCLUSIONS_SOLANA}
        if sol_read is None or any(b is None for b in sol_bals) or any(b is None for b in exc_bals.values()):
            missing.append("Solana")
            print("  Solana             a supply or balance read failed: chain_incomplete")
        else:
            slot, _, info, ext = sol_read
            m, _ = effective_multiplier(ext)
            dec = info["decimals"]
            sup = int(info["supply"]) * m / 10**dec
            h = sum(b[0] for b in sol_bals) * m / 10**dec
            for w, (raw, sl) in exc_bals.items():
                excluded[w] = (raw * m / 10**dec, sl)
            total += sup
            raw_total += int(info["supply"]) / 10**dec
            held += h
            ex = "; ".join(f"named exclusion {w[:4]}... {v:.8f} (slot {sl})" for w, (v, sl) in excluded.items())
            print(f"  {'Solana (scaled)':18} slot  {slot:>10}  supply {sup:>16.6f}  listed {h:>16.6f}  {100 * h / sup:7.3f}%   {ex}")
        tm = attempt(lambda: ton_get("/jetton/masters", {"address": dep["Ton"]})["jetton_masters"][0])
        tmult = attempt(lambda: ton_display_multiplier(dep["Ton"]))
        ton_w = [attempt(lambda w=w: ton_get("/jetton/wallets", {"owner_address": w, "jetton_address": dep["Ton"], "limit": 10}))
                 for w in listed["Ton"]]
        if tm is None or tmult is None or any(j is None for j in ton_w):
            missing.append("Ton")
            print("  Ton                a supply or balance read failed: chain_incomplete")
        else:
            tdec = int(tm["jetton_content"].get("decimals", 9))
            tsup = int(tm["total_supply"]) * tmult / 10**tdec
            th = sum(int(x["balance"]) for j in ton_w for x in j.get("jetton_wallets", [])) * tmult / 10**tdec
            total += tsup
            raw_total += int(tm["total_supply"]) / 10**tdec
            held += th
            print(f"  {'Ton (scaled)':18} read  {now()}  supply {tsup:>16.6f}  listed {th:>16.6f}  {100 * th / tsup:7.3f}%"
                  f"   (last tx lt {tm['last_transaction_lt']})")
        if "Tron" in dep:
            tb = attempt(tron_block)
            tts = attempt(lambda: tron_call(dep["Tron"], "totalSupply()"))
            trb = [attempt(lambda w=w: tron_call(dep["Tron"], "balanceOf(address)", tron_hex(w))) for w in listed["Tron"]]
            if tb is None or tts is None or any(b is None for b in trb):
                missing.append("Tron")
                print("  Tron               a supply or balance read failed: chain_incomplete")
            else:
                total += tts / 1e18
                raw_total += tts / 1e18
                held += sum(trb) / 1e18
                print(f"  {'Tron':18} block {tb:>10}  supply {tts / 1e18:>16.6f}  listed {sum(trb) / 1e18:>16.6f}  {100 * sum(trb) / tts:7.3f}%")
        if missing:
            # No verdict on a partial read: a missing chain is unknown, never 0.
            print(f"  total supply: chain_incomplete (unread: {', '.join(missing)})")
            print(f"  circulating supply: chain_incomplete (unread: {', '.join(missing)})")
            print("  backing: no_chain_counterpart (shares held in custody are published only by the issuer)")
            continue
        chain_circ = total - held
        after = chain_circ - sum(v for v, _ in excluded.values())
        print(f"  chain: total {total:.6f}  held by listed wallets {held:.6f} ({100 * held / total:.3f}%)")
        print(f"  chain: total minus listed wallets {chain_circ:.6f}")
        print(f"  chain: total minus listed wallets minus named exclusions {after:.6f}")
        print(f"  chain: total with Solana and TON left unscaled {raw_total:.6f}")
        api_total, t1 = api(f"/public/assets/{sym}/total-supply?format=raw")
        api_circ, t2 = api(f"/public/assets/{sym}/circulating-supply?format=raw")
        print(f"  issuer (printed here as a check, not stored): total-supply {api_total} fetched {t1};"
              f" circulating-supply {api_circ} fetched {t2}")
        tol = f"{SUPPLY_TOLERANCE:g} of total supply"

        def report(q, ours, theirs, t, explained=None):
            if close(ours, theirs, total, SUPPLY_TOLERANCE):
                return f"{q}: {'reconciles_after_exclusion' if explained else 'reconciles'} (tolerance {tol}, checked {t})" + (
                    f"; explained by {explained}" if explained else "")
            sign = "ours above theirs" if ours > theirs else "ours below theirs"
            return (f"{q}: does_not_reconcile on this single check (tolerance {tol}, checked {t},"
                    f" issuer quantity compared: {q}, sign of gap: {sign}); the collector records it only"
                    f" if it persists across cycles (spec 4.8)")
        print("  " + report("total_supply", total, api_total, t1))
        print("  " + report("total_supply with Solana and TON unscaled", raw_total, api_total, t1))
        if close(chain_circ, api_circ, total, SUPPLY_TOLERANCE):
            print("  " + report("circulating_supply", chain_circ, api_circ, t2))
        elif close(after, api_circ, total, SUPPLY_TOLERANCE):
            exp = "; ".join(f"{w} holds {v:.8f} on Solana at slot {sl}, not on the issuer's list" for w, (v, sl) in excluded.items())
            print("  " + report("circulating_supply", after, api_circ, t2, exp))
        else:
            print("  " + report("circulating_supply", after, api_circ, t2))
        print("  backing: no_chain_counterpart (shares held in custody are published only by the issuer)")


def section_authorities(assets, wallets):
    print("\n== 4. Solana authorities on a sample of mints ==")
    listed = {w["address"] for w in wallets}
    seen = {}
    for sym in ("TSLAx", "AZNx", "SPYx", "NVDAx", "KLACx"):
        mint = next(d["address"] for d in assets[sym]["deployments"] if d["network"] == "Solana")
        slot, owner, info, ext = mint_info(mint)
        roles = {
            "mintAuthority": info.get("mintAuthority"),
            "freezeAuthority": info.get("freezeAuthority"),
            "scaledUiAmount authority": ext["scaledUiAmountConfig"]["authority"],
            "pausable authority": ext["pausableConfig"]["authority"],
            "permanentDelegate": ext["permanentDelegate"]["delegate"],
            "metadata updateAuthority": ext["tokenMetadata"]["updateAuthority"],
        }
        print(f"  {sym:6} {mint}  slot {slot}  program {owner}")
        for k, v in roles.items():
            seen[v] = seen.get(v, set()) | {k}
            print(f"    {k:26} {v}")
    print("  each authority address:")
    for a, ks in seen.items():
        print(f"    {a}  in issuer list: {'yes' if a in listed else 'NO '}  "
              f"{'on-curve (keypair)' if on_curve(b58decode(a, 32)) else 'off-curve (PDA)'}  roles: {sorted(ks)}")
    r = sol("getAccountInfo", [UNLISTED_SOL, {"encoding": "base64", "commitment": "finalized"}])
    print(f"  {UNLISTED_SOL} (excluded by the issuer's circulating figure): slot {r['context']['slot']},"
          f" owner program {r['value']['owner']}, "
          f"{'on-curve (keypair)' if on_curve(b58decode(UNLISTED_SOL, 32)) else 'off-curve (PDA)'},"
          f" in issuer list: {'yes' if UNLISTED_SOL in listed else 'NO'}")
    print("  Squads v4 multisigs:")
    for ms in SQUADS_MULTISIGS:
        vault0 = find_pda([b"multisig", b58decode(ms, 32), b"vault", bytes([0])], SQUADS_V4)
        r = sol("getAccountInfo", [ms, {"encoding": "base64", "commitment": "finalized"}])
        acc = r["value"]
        data = base64.b64decode(acc["data"][0])
        o = 8 + 32 + 32
        threshold, = struct.unpack_from("<H", data, o)
        o += 2 + 4 + 8 + 8
        o += 33 if data[o] == 1 else 1
        o += 1
        n, = struct.unpack_from("<I", data, o)
        o += 4
        members = [b58encode(data[o + 33 * i:o + 33 * i + 32]) for i in range(n)]
        print(f"    {ms}  slot {r['context']['slot']}  owner {acc['owner']}  vault 0 = {vault0}")
        print(f"      threshold {threshold} of {n}; members:")
        for mbr in members:
            print(f"        {mbr}  in issuer list: {'yes' if mbr in listed else 'NO'}")


def section_creation():
    print("\n== 5. Who signs a mint creation ==")
    t = sol("getTransaction", [CREATION_TX, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}])
    keys = t["transaction"]["message"]["accountKeys"]
    signers = [k["pubkey"] for k in keys if k.get("signer")]
    print(f"  tx {CREATION_TX[:16]}...  slot {t['slot']}  signers {signers}")
    for ix in t["transaction"]["message"]["instructions"]:
        p = ix.get("parsed")
        if isinstance(p, dict) and p.get("type", "").lower().startswith("initialize"):
            info = p.get("info", {})
            print(f"    {p['type']:34} mint {info.get('mint')}  {({k: v for k, v in info.items() if 'uthority' in k or k == 'delegate'})}")
    created = next(k["pubkey"] for k in keys if k.get("signer") and k["pubkey"].startswith("Xs"))
    slot, _, info, ext = mint_info(created)
    print(f"  that mint now, slot {slot}: mintAuthority {info.get('mintAuthority')}, supply {info['supply']},"
          f" symbol {ext['tokenMetadata']['symbol']}, in the issuer's asset list: "
          f"{'yes' if any(d['address'] == created for a in ASSETS.values() for d in a['deployments']) else 'NO'}")


def creation_of(sig: str):
    """The mint created in a transaction, and the authority it named at creation."""
    t = sol("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}])
    for ix in t["transaction"]["message"]["instructions"]:
        p = ix.get("parsed")
        if isinstance(p, dict) and p.get("type") in ("initializeMint", "initializeMint2"):
            signers = [k["pubkey"] for k in t["transaction"]["message"]["accountKeys"] if k.get("signer")]
            return t["slot"], p["info"]["mint"], p["info"].get("mintAuthority"), signers
    return None


def section_creation_sample(assets):
    print("\n== 5b. Mint creations: the authority named at creation against the authority now ==")
    listed = {d["address"] for a in assets.values() for d in a["deployments"] if d["network"] == "Solana"}
    sigs, before = [], None
    while len(sigs) < 5000:
        p = {"limit": 1000, "commitment": "finalized"}
        if before:
            p["before"] = before
        page = sol("getSignaturesForAddress", ["5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq", p])
        if not page:
            break
        sigs += page
        before = page[-1]["signature"]
        if len(page) < 1000:
            break
    print(f"  the permanent delegate appears in {len(sigs)} transactions; sampling the 8 oldest and the 8 newest")
    sample = [x["signature"] for x in sigs[-8:]] + [x["signature"] for x in sigs[:8]]
    counts = {"created": 0, "authority_at_creation_S7vY": 0, "now_7pt9": 0, "listed": 0}
    for sig in sample:
        c = creation_of(sig)
        if not c:
            print(f"    {sig[:16]}...  not a mint creation")
            continue
        slot, mint, auth0, signers = c
        _, _, info, ext = mint_info(mint)
        now_auth = info.get("mintAuthority")
        counts["created"] += 1
        counts["authority_at_creation_S7vY"] += auth0 == "S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS"
        counts["now_7pt9"] += now_auth == "7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj"
        counts["listed"] += mint in listed
        print(f"    slot {slot}  {ext['tokenMetadata']['symbol']:8} {mint}  at creation {auth0[:4]}...  now {str(now_auth)[:4]}..."
              f"  supply {info['supply']}  listed {'yes' if mint in listed else 'NO'}  signers {[x[:4] for x in signers]}")
    print(f"  sample: {counts}")


def section_roles(assets, wallets):
    print("\n== 6. TSLAx on Ethereum: role getters ==")
    listed = {w["address"].lower() for w in wallets}
    tok = next(d["address"] for d in assets["TSLAx"]["deployments"] if d["network"] == "Ethereum")
    blk = evm("Ethereum", "eth_blockNumber", [])
    print(f"  token {tok}  block {int(blk, 16)}")
    for fn in ("burner()", "multiplierUpdater()", "minter()", "owner()", "pauser()"):
        v = evm_call("Ethereum", tok, sel(fn), blk)
        a = "0x" + v[-40:]
        code = evm("Ethereum", "eth_getCode", [a, blk])
        kind = "EOA" if code == "0x" else f"contract, {len(code) // 2 - 1} bytes"
        extra = ""
        if code != "0x":
            th = evm_uint("Ethereum", a, sel("getThreshold()"), blk)
            if th is not None:
                owners = evm_call("Ethereum", a, sel("getOwners()"), blk)
                n = int(owners[66:130], 16)
                extra = f"; Safe-style getThreshold {th} of {n} owners"
        print(f"    {fn:22} {a}  {kind}{extra}  in issuer list: {'yes' if a.lower() in listed else 'NO'}")


def section_all_mints(assets):
    print("\n== 7. Every Solana mint the issuer lists: authorities and multiplier, chain against issuer ==")
    import collections
    mints = [(sym, d["address"]) for sym, a in assets.items() for d in a["deployments"] if d["network"] == "Solana"]
    auth, rows, slots = collections.Counter(), [], set()
    for i in range(0, len(mints), 100):
        chunk = mints[i:i + 100]
        r = sol("getMultipleAccounts", [[m for _, m in chunk], {"encoding": "jsonParsed", "commitment": "finalized"}])
        slots.add(r["context"]["slot"])
        for (sym, m), acc in zip(chunk, r["value"]):
            info = acc["data"]["parsed"]["info"]
            ext = {e["extension"]: e.get("state") for e in info.get("extensions", [])}
            auth[("program", acc["owner"])] += 1
            auth[("mintAuthority", info.get("mintAuthority"))] += 1
            auth[("freezeAuthority", info.get("freezeAuthority"))] += 1
            auth[("permanentDelegate", ext["permanentDelegate"]["delegate"])] += 1
            auth[("scaledUi authority", ext["scaledUiAmountConfig"]["authority"])] += 1
            auth[("pausable authority", ext["pausableConfig"]["authority"])] += 1
            auth[("updateAuthority", ext["tokenMetadata"]["updateAuthority"])] += 1
            eff = effective_multiplier(ext)[0]
            rows.append((sym, eff))
            if int(info["supply"]) == 0:
                auth[("supply 0", "count")] += 1
            if float(ext["scaledUiAmountConfig"]["multiplier"]) != eff:
                auth[("stored multiplier field differs from effective", "count")] += 1
    print(f"  {len(mints)} mints, slots {min(slots)} to {max(slots)}; with supply 0:"
          f" {auth.pop(('supply 0', 'count'), 0)}; stored multiplier field differs from the effective value on"
          f" {auth.pop(('stored multiplier field differs from effective', 'count'), 0)}")
    for (k, v), n in sorted(auth.items()):
        print(f"    {k:18} {v}  on {n}")
    effs = sorted(e for _, e in rows)
    print(f"  effective multiplier: min {effs[0]!r}, max {effs[-1]!r}, exactly 1.0 on {sum(e == 1.0 for e in effs)},"
          f" outside 0.9-1.1: {sorted((s, e) for s, e in rows if not 0.9 < e < 1.1)}")
    disagree = 0
    t0 = now()
    for sym, e in rows:
        d, _ = api(f"/public/assets/{sym}/multiplier?network=Solana")
        if mult_verdict(e, d["currentMultiplier"]) != "reconciles":
            disagree += 1
            print(f"    does_not_reconcile {sym}: chain {e!r} [issuer {d['currentMultiplier']!r}]")
    print(f"  issuer multiplier fetched {t0} to {now()}: {len(rows) - disagree} of {len(rows)} reconcile")


INK_EXPLORER = os.environ.get("TE_INK_EXPLORER", "https://explorer.inkonchain.com/api")
HYPER_LOG_RPCS = os.environ.get("TE_HYPER_LOG_RPCS", "https://rpc.hypurrscan.io,https://hyperliquid-json-rpc.stakely.io").split(",")
TRANSFER = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
ZERO32 = "0x" + "0" * 64


def section_ink_hyper(assets):
    print("\n== 8. Ink and HyperEVM: identical supplies, and where each came from (TSLAx); Ethereum for comparison ==")
    tok = next(d["address"] for d in assets["TSLAx"]["deployments"] if d["network"] == "Ink")
    for sym in ("TSLAx", "AZNx", "SPYx"):
        dep = {d["network"]: d["address"] for d in assets[sym]["deployments"]}
        out = []
        for net in ("Ink", "HyperEVM", "Ethereum"):
            blk = evm(net, "eth_blockNumber", [])
            code = evm(net, "eth_getCode", [dep[net], blk])
            out.append((net, int(blk, 16), evm_uint(net, dep[net], sel("totalSupply()"), blk),
                        hashlib.sha256(bytes.fromhex(code[2:])).hexdigest()[:16]))
        print(f"  {sym}: " + "; ".join(f"{n} block {b} totalSupply {ts} code sha256 {h}" for n, b, ts, h in out))

    def explorer_logs(topic_pos):
        q = {"module": "logs", "action": "getLogs", "fromBlock": 0, "toBlock": "latest", "address": tok,
             "topic0": TRANSFER, f"topic{topic_pos}": ZERO32, f"topic0_{topic_pos}_opr": "and"}
        r = _retry(lambda: client.get(INK_EXPLORER, params=q).json(), "ink explorer read")
        res = r.get("result") if isinstance(r, dict) else None
        # An explorer error is unknown, never "no events": a list or nothing.
        return res if isinstance(res, list) else None
    mints, burns = explorer_logs(1), explorer_logs(2)
    if mints is None or burns is None:
        print(f"  Ink ({host(INK_EXPLORER)}): explorer read failed; mint and burn history unknown")
        return
    print(f"  Ink ({host(INK_EXPLORER)}): {len(mints)} mint event(s), {len(burns)} burn event(s)")
    for x in mints:
        print(f"    mint block {int(x['blockNumber'], 16)} time {dt.datetime.fromtimestamp(int(x['timeStamp'], 16), dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ}"
              f" amount {int(x['data'], 16)} to 0x{x['topics'][2][-40:]}")
    if not mints:
        return
    target = int(mints[0]["timeStamp"], 16)
    lo, hi = 1, int(evm("HyperEVM", "eth_blockNumber", []), 16)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if int(evm("HyperEVM", "eth_getBlockByNumber", [hex(mid), False])["timestamp"], 16) < target:
            lo = mid
        else:
            hi = mid

    def hlogs(a, b):
        for k in range(6):
            url = HYPER_LOG_RPCS[k % len(HYPER_LOG_RPCS)]
            try:
                j = client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs", "params": [
                    {"address": tok, "fromBlock": hex(a), "toBlock": hex(b), "topics": [TRANSFER, ZERO32]}]}).json()
                if "error" not in j:
                    return j["result"]
            except Exception:  # noqa: BLE001 - retried on the next endpoint
                pass
            time.sleep(2)
        return None
    print(f"  HyperEVM block at the Ink mint's timestamp: {hi}; scanning 1,000-block windows either side"
          f" through {', '.join(host(u) for u in HYPER_LOG_RPCS)}")
    for w in [x for i in range(60) for x in (i, -i - 1)]:
        a = hi + w * 1000
        r = hlogs(a, a + 999)
        if r is None:
            print(f"    window {a} unreadable")
            continue
        if r:
            for x in r:
                b = int(x["blockNumber"], 16)
                t = int(evm("HyperEVM", "eth_getBlockByNumber", [hex(b), False])["timestamp"], 16)
                print(f"    HyperEVM mint block {b} time {dt.datetime.fromtimestamp(t, dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ}"
                      f" amount {int(x['data'], 16)} to 0x{x['topics'][2][-40:]} ({(t - target) / 60:+.1f} min from the Ink mint)")
            break
        time.sleep(0.3)
    else:
        print("    no HyperEVM mint found within 60,000 blocks of the Ink mint's time")


def section_mint_coverage(assets):
    print("\n== 9. Which listed mints have ever had supply minted under a 7pt9 signature ==")
    auth = "7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj"
    listed = {d["address"]: s for s, a in assets.items() for d in a["deployments"] if d["network"] == "Solana"}
    sigs, before = [], None
    while len(sigs) < 20000:
        p = {"limit": 1000, "commitment": "finalized"}
        if before:
            p["before"] = before
        page = sol("getSignaturesForAddress", [auth, p])
        if not page:
            break
        sigs += page
        before = page[-1]["signature"]
        if len(page) < 1000:
            break
    ok = [x for x in sigs if not x.get("err")]
    print(f"  {auth[:4]}... appears in {len(sigs)} transactions ({len(ok)} succeeded), slots {sigs[-1]['slot']} to {sigs[0]['slot']}")
    import collections
    kinds, minted = collections.Counter(), collections.Counter()
    for x in ok:
        t = attempt(lambda: sol("getTransaction", [x["signature"], {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}]))
        if t is None:
            kinds["unreadable"] += 1
            continue
        ixs = list(t["transaction"]["message"]["instructions"])
        for inner in (t.get("meta") or {}).get("innerInstructions") or []:
            ixs += inner["instructions"]
        for ix in ixs:
            p = ix.get("parsed")
            if not isinstance(p, dict):
                continue
            kinds[p.get("type")] += 1
            info = p.get("info", {})
            if p.get("type") in ("mintTo", "mintToChecked") and auth in (info.get("mintAuthority"), info.get("multisigMintAuthority")):
                minted[info["mint"]] += 1
    print(f"  instruction types seen: {dict(kinds.most_common(12))}")
    cov = [m for m in listed if m in minted]
    print(f"  distinct mints minted to under {auth[:4]}...: {len(minted)}; of those listed: {len(cov)} of {len(listed)} listed mints")
    rest = [m for m in listed if m not in minted]
    sup = {}
    for i in range(0, len(rest), 100):
        r = sol("getMultipleAccounts", [rest[i:i + 100], {"encoding": "jsonParsed", "commitment": "finalized"}])
        for m, acc in zip(rest[i:i + 100], r["value"]):
            sup[m] = int(acc["data"]["parsed"]["info"]["supply"])
    print(f"  listed mints with no {auth[:4]}... mint: {len(rest)}, of which supply > 0: {sum(1 for v in sup.values() if v > 0)},"
          f" supply 0: {sum(1 for v in sup.values() if v == 0)}")


def section_withholding_shape():
    print("\n== 10. The shape of the issuer's withholding data (counts only, no values: E18) ==")
    nodes = api_all("/public/corporate-actions/history", 1)
    with_rate = [n["withholdingTaxRate"] for n in nodes if n.get("withholdingTaxRate") is not None]
    print(f"  {len(nodes)} corporate-action records fetched {now()}; {len(with_rate)} carry a withholding field;"
          f" distinct values among them: {len(set(with_rate))}")


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    print(f"started {now()}")
    print("endpoints (host only):", host(SOLANA_RPC), host(TON_API), host(TRON_API), host(XSTOCKS_API),
          *[f"{k}={host(v)}" for k, v in EVM_RPC.items()])
    assets = {a["symbol"]: a for a in api_all("/public/assets", 0)}
    ASSETS.update(assets)
    wallets, t = api("/public/system/wallets")
    wallets = wallets["nodes"]
    print(f"issuer: {len(assets)} assets; {len(wallets)} system wallets (fetched {t})")
    section_multiplier(assets)
    section_magnitude(assets)
    section_supply(assets, wallets)
    section_authorities(assets, wallets)
    section_creation()
    section_creation_sample(assets)
    section_roles(assets, wallets)
    section_ink_hyper(assets)
    section_withholding_shape()
    if "--all-mints" in sys.argv:
        section_all_mints(assets)
    if "--mint-coverage" in sys.argv:
        section_mint_coverage(assets)
    print(f"\nfinished {now()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
