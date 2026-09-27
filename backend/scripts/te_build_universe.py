"""Builds the compact tokenized-equity universe the site serves, from the
universe pass's output.

Run: ./venv/bin/python scripts/te_build_universe.py --src <dir>

<dir> holds what the universe pass wrote (its UNIVERSE.md describes it):

  universe.json              every record, the issuer eligibility map, the excluded list
  universe_pools.json        every pool found per verified token
  reads/rh_adminburn_sim.json  the Robinhood adminBurn eth_call simulation

Writes two versioned data files, both gzip JSON, and prints their sizes:

  data/te_universe.json.gz   one row per (issuer, chain, token): identity,
                             scope, verification and its block or slot, the
                             six control cells (interned: tokens of one family
                             on one chain share a set), eligibility per issuer,
                             and the three deepest pools. Loaded by the web
                             process (core/te/universe.py).
  data/te_pools.json.gz      every pool per verified token, for the cost
                             worker only (core/te/universe.get_pools). The web
                             process never loads it unless a caller asks.

What is left out on purpose: issuer figures (E18; ISINs, issuer supply or
circulating figures are not carried), any LI.FI field (list views never depend
on LI.FI), listed names from issuer pages (names come from each token's own
name() read on chain), and pool prices in the web file.

No network call is made. Re-run it after a new universe pass; the output is
deterministic for the same input, so the diff of the data file is the diff of
the universe.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.te.normalise import CONTROL_KEYS, normalise_controls  # noqa: E402
from core.te.universe import (  # noqa: E402
    CHAINS, ENUM_FIELDS, ISSUER_NAMES, RECORD_FIELDS, SCHEMA, DATA_DIR, UNIVERSE_FILE, POOLS_FILE,
)

TOP_POOLS = 3

POOL_KEEP = ("venue", "family", "pool", "pool_id", "pool_manager", "quote", "quote_address",
             "fee", "tick_spacing", "hooks", "tvl_usd", "depth_plus2pct_usd_ub",
             "depth_minus2pct_usd_ub", "price_outlier")

NAME_SUFFIXES = (" (Ondo Tokenized)", " • Robinhood Token", " xStock")
NAME_PREFERENCE = ("ondo", "robinhood", "coinbase", "xstocks", "bstocks")
TYPE_BASIS_RANK = {"Ondo CSV Type": 3, "Nasdaq Trader ETF flag": 2, "name words": 1}


def _key(rec: dict) -> str:
    """SPEC B.1: <chainId>/<address> on EVM, solana/<mint> (E2), and the same
    shape for TON and Tron."""
    cid = rec["chain_id"]
    if isinstance(cid, int):
        return f"{cid}/{rec['address'].lower()}"
    return f"{rec['chain']}/{rec['address']}"


def _read_point(ev: dict) -> tuple:
    if ev.get("block") is not None:
        return ev["block"], "block"
    if ev.get("slot") is not None:
        return ev["slot"], "slot"
    if ev.get("last_transaction_lt") is not None:
        return str(ev["last_transaction_lt"]), "ton_last_transaction_lt"
    if ev.get("block_after") is not None:
        return ev["block_after"], "block_after"
    return None, None


def _round(x, nd=2):
    return None if x is None else round(float(x), nd)


def _pool(p: dict) -> dict:
    out = {k: p.get(k) for k in POOL_KEEP if p.get(k) is not None}
    for k in ("tvl_usd", "depth_plus2pct_usd_ub", "depth_minus2pct_usd_ub"):
        if k in out:
            out[k] = _round(out[k])
    return out


def _block_int(b, meta=None) -> tuple:
    """(block or slot as an int, unit, label). 'latest (~124169042)' becomes
    124169042 with the label 'latest at read, approximate'."""
    if isinstance(b, int):
        return b, "block", None
    m = re.search(r"(\d{5,})", str(b or ""))
    if m:
        return int(m.group(1)), "block", "latest at read, approximate"
    if meta and meta[0].get("balance_slot"):
        return int(meta[0]["balance_slot"]), "slot", None
    return None, None, None


def _liquidity(liq: dict | None) -> list | None:
    """LIQ_FIELDS order (core/te/universe.py)."""
    if not liq:
        return None
    if liq.get("status") != "measured":
        return ["not_measured", None, None, None, None, None, None, None, None, [], None,
                "not searched on this chain" if liq.get("reason") else None]
    all_pools = liq.get("pools") or []
    pools = [p for p in all_pools if not p.get("price_outlier")]
    pools.sort(key=lambda p: -min(p.get("depth_plus2pct_usd_ub") or 0, p.get("depth_minus2pct_usd_ub") or 0))
    # The record's pool_count includes price-outlier pools, which are left
    # out of every total; they are counted separately here.
    outliers = liq.get("pools_price_outliers") or 0
    n = max((liq.get("pool_count") or len(all_pools)) - outliers, 0)
    block, unit, label = _block_int(liq.get("block"), liq.get("meta"))
    venues = liq.get("venues_scope") or ", ".join(liq.get("venues_searched") or [])
    if n == 0:
        return ["no_pool_found", 0, outliers, None, None, None, block, unit, label, [], venues, None]
    tvl = liq.get("tvl_usd_total_v2v3", liq.get("tvl_usd_total"))
    return ["pools_found", n, outliers,
            _round(liq.get("depth_plus2pct_usd_ub_total")), _round(liq.get("depth_minus2pct_usd_ub_total")),
            _round(tvl), block, unit, label, [_pool(p) for p in pools[:TOP_POOLS]], venues, None]


def _pool_entry(v: dict) -> dict:
    """One token's pools for the cost worker, with the block as an int."""
    block, unit, label = _block_int(v.get("block"))
    out = {k: w for k, w in v.items() if k != "block"}
    out.update({"block": block, "block_unit": unit or "block", "block_label": label})
    return clean_all(out)


def _read_on(read: str | None) -> str | None:
    m = re.search(r"\d{4}-\d{2}-\d{2}", read or "")
    return m.group(0) if m else None


def _underlyings(records: list[dict]) -> dict:
    names: dict[str, dict] = {}
    types: dict[str, dict] = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for r in records:
        t = r["underlying"]["ticker"]
        at, basis = r["underlying"].get("asset_type"), r["underlying"].get("asset_type_basis")
        if at:
            types[t][TYPE_BASIS_RANK.get(basis, 0)][(at, basis)] += 1
        nm = (r.get("onchain") or {}).get("name")
        if not nm:
            continue
        for sfx in NAME_SUFFIXES:
            if nm.endswith(sfx):
                nm = nm[: -len(sfx)]
        nm = nm.strip()
        if not nm or nm.upper() == t.upper():
            continue
        rank = NAME_PREFERENCE.index(r["issuer"]) if r["issuer"] in NAME_PREFERENCE else 99
        cur = names.get(t)
        if cur is None or rank < cur["rank"]:
            names[t] = {"rank": rank, "name": nm, "issuer": r["issuer"]}
    out = {}
    for t in sorted({r["underlying"]["ticker"] for r in records}):
        n = names.get(t)
        ty = types.get(t)
        if ty:
            best = max(ty)
            (atype, abasis), _ = ty[best].most_common(1)[0]
        else:
            atype, abasis = None, None
        out[t] = {
            "name": n["name"] if n else None,
            "name_basis": (f"name() read on chain from the {ISSUER_NAMES[n['issuer']]} token, issuer suffix removed"
                           if n else "not established: no token name() beyond the ticker"),
            "type": atype,
            "type_basis": (f"{abasis} (class D)" if abasis else "not established"),
        }
    return out


LOCAL_REF = re.compile(r"\s*\([^()]*(?:reads/|src/|scratch/|UNIVERSE\.md|NOTES\.md|\.json|\.html|earlier pass)[^()]*\)")


def clean_text(s):
    """Served text names chain evidence or a public URL, never a file of the
    universe pass; and it is valid UTF-8 (the pass decoded some names as
    Latin-1: 'RÃ¼ck' is 'Rück')."""
    if not isinstance(s, str):
        return s
    if re.search("Ã|â€|Â", s):
        try:
            s = s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    s = LOCAL_REF.sub("", s)
    return s


def clean_all(x):
    if isinstance(x, dict):
        return {k: clean_all(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean_all(v) for v in x]
    return clean_text(x)


EXCLUDE_TEXT = {"HK": "Hong Kong listing", "GB": "United Kingdom listing", "DE": "Germany listing",
                "ES": "Spain listing", "non-US": "listing outside the US"}


def _exclusion_text(reason: str) -> str:
    m = re.search(r"\(([^)]+)\)$", reason or "")
    if reason == "test token":
        return "excluded: test token"
    if m:
        return f"excluded: {EXCLUDE_TEXT.get(m.group(1), m.group(1) + ' listing')}"
    return f"excluded: {reason}"


def _directory(src: Path) -> dict:
    """Nasdaq Trader symbol -> security name."""
    out = {}
    for name, col in (("nasdaqlisted.txt", 0), ("otherlisted.txt", 0)):
        p = src / "src" / name
        if not p.exists():
            continue
        for line in p.read_text(errors="replace").splitlines()[1:]:
            parts = line.split("|")
            if len(parts) > 1 and parts[0] and not parts[0].startswith("File Creation"):
                out[parts[0].strip()] = parts[1]
    return out


def prepare(u: dict, src: Path) -> dict:
    """The corrections made to the universe pass's records before they are
    served, each printed so the diff is visible:

      - text decoded as UTF-8 where the pass read it as Latin-1;
      - a ticker the Nasdaq Trader directory lists only with a class dot
        (BRKB -> BRK.B) is normalised, and its scope becomes a ticker match;
      - one exclusion rule for non-US listings on every chain: an underlying
        the issuer's list places outside the US is excluded wherever the
        same issuer has it, including tokens the list does not carry (TEF);
      - the Solana identity basis says what it rests on (E10).
    Returns {"excluded": [...compact...], "notes": [...]}."""
    records = u["records"]
    notes = []
    dirset = _directory(src)
    for r in records:
        on = r.get("onchain") or {}
        for k in ("name", "symbol"):
            if on.get(k):
                on[k] = clean_text(on[k])
        t = r["underlying"]["ticker"]
        new = f"{t[:-1]}.{t[-1]}" if len(t) >= 3 and "." not in t else None
        # Only when the token's own name agrees with the directory's name for
        # the dotted ticker: HEIA (Heineken) is not HEI.A (HEICO).
        first = re.split(r"[\s(,.]", (on.get("name") or "").strip())[0].lower()
        if (new and dirset and t not in dirset and new in dirset and len(first) >= 3
                and first in dirset[new].lower()):
            notes.append(f"{r['id']}: ticker {t} normalised to {new}")
            r["underlying"]["ticker"] = new
            if r["scope"] == "us_not_established":
                r["scope"] = "us_ticker_match"
                r["underlying"]["listing_country_basis"] = f"ticker in Nasdaq Trader's directory after normalising {t} to {new}"
        if r["chain"] == "solana":
            if r["issuer"] == "xstocks":
                r["verification"]["basis"] = (
                    "identity from the xStocks asset list of 2026-09-24 plus the authority fields read on chain: mint "
                    "authority, freeze authority and permanent delegate equal the xStocks set (7pt9…, JDq14…, 5aMNN…). "
                    "Per E10 the authorities alone are not an issuer identification")
            elif r["issuer"] == "ondo":
                r["verification"]["basis"] = (
                    "identity from Ondo's address CSV of 2026-09-25 plus the mint authority read on chain (the PDA "
                    "9foMHs… shared by all 450 CSV mints). Per E10 the authority alone is not an issuer identification")
        r["verification"]["basis"] = clean_text(r["verification"].get("basis"))

    ex_by_ticker = {}
    for x in u.get("excluded") or []:
        iss = x["id"].split(":")[0]
        s = x.get("symbol") or ""
        t = s[:-1] if iss == "xstocks" and s.endswith("x") else s
        ex_by_ticker.setdefault((iss, t), (x["reason"], s))
    kept, moved = [], []
    for r in records:
        hit = ex_by_ticker.get((r["issuer"], r["underlying"]["ticker"]))
        if hit and r["scope"] != "us_confirmed":
            moved.append({"id": r["id"], "symbol": (r.get("onchain") or {}).get("symbol"),
                          "reason": hit[0], "note": f"same underlying as {hit[1]}, which the issuer's list places outside the US"})
            continue
        kept.append(r)
    if moved:
        notes.append(f"{len(moved)} records moved to excluded by the one-rule check: " +
                     ", ".join(sorted({m['symbol'] for m in moved})))
    u["records"] = kept

    excluded = []
    for x in list(u.get("excluded") or []) + moved:
        iss, chain, addr = x["id"].split(":", 2)
        cid = CHAINS.get(chain, {}).get("chain_id")
        key = f"{cid}/{addr.lower()}" if cid is not None else f"{chain}/{addr}"
        text = _exclusion_text(x["reason"])
        if x.get("note"):
            text = f"{text} ({x['note']})"
        excluded.append([key, iss, chain, x.get("symbol"), text])
    excluded.sort()
    return {"excluded": excluded, "notes": notes}


def coverage(u: dict) -> list:
    """What the universe does not cover, measured where it can be."""
    recs = u["records"]
    ok = lambda r: (r["verification"]["status"] == "verified" and r["scope"] in ("us_confirmed", "us_ticker_match")
                    and (r.get("onchain") or {}).get("total_supply") not in (None, "0"))
    from core.te.universe import SITE_CHAINS
    evm_x = {r["underlying"]["ticker"] for r in recs if r["issuer"] == "xstocks" and r["chain"] in SITE_CHAINS
             and r["chain"] != "solana" and ok(r)}
    sol_x = {r["underlying"]["ticker"] for r in recs if r["issuer"] == "xstocks" and r["chain"] == "solana"}
    missing = sorted(evm_x - sol_x)
    return [
        {"scope": "xStocks on Solana", "source": "the xStocks asset list of 2026-09-24 only",
         "missing_us_underlyings": len(missing),
         "text": (f"Solana xStocks come from the issuer's list of 2026-09-24 only: {len(missing)} US underlyings listed "
                  f"here as xStocks on an EVM chain have no Solana mint in this universe. Enumerating Token-2022 mints "
                  f"by authority (getProgramAccounts) was refused by the endpoints used."),
         "examples": missing[:12]},
        {"scope": "Ondo on Solana", "source": "Ondo's address CSV of 2026-09-25 only",
         "text": "Ondo Solana mints come from Ondo's CSV of 2026-09-25 only; mints created since, or not in the CSV, are not found."},
        {"scope": "Coinbase on Base", "source": "the 10 addresses on docs.base.org only",
         "url": "https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base",
         "text": "Coinbase tokens are the 10 addresses on the Base docs page, each verified on chain; B20 tokens not on that page were not searched for."},
    ]


def _json_or(s):
    try:
        import ast
        return ast.literal_eval(s) if isinstance(s, str) and s.startswith("{") else s
    except (ValueError, SyntaxError):
        return s


def build(src: Path) -> tuple[dict, dict]:
    raw_bytes = (src / "universe.json").read_bytes()
    u = json.loads(raw_bytes)
    pools_raw = json.loads((src / "universe_pools.json").read_bytes())
    sim_path = src / "reads" / "rh_adminburn_sim.json"
    sim = json.loads(sim_path.read_text()) if sim_path.exists() else None
    if sim:
        # Exactly as measured: the file's fields, with the two calls named.
        sims = sim.get("sims") or {}
        sim = {
            "chain": "robinhood", "token": sim.get("token"), "block": sim.get("block"),
            "holder_burned_from": sim.get("holder"), "calldata": sim.get("calldata"),
            "calldata_decoded": "adminBurn(address from, uint256 amount) with from = holder_burned_from, amount = 1",
            "calls": [{"from": k, **{kk: _json_or(vv) for kk, vv in v.items()}} for k, v in sims.items()],
            "reading": "eth_call only, nothing broadcast. From the ADMIN_BURNER_ROLE holder the call returns 0x "
                       "(success); from a stranger it reverts with AccessControlUnauthorizedAccount "
                       "(selector 0xe2517d3f, the role hash appended). Simulated on this one token; the other "
                       "Robinhood tokens share the beacon implementation and the role registry.",
        }

    def _rj(name):
        p = src / "reads" / name
        return json.loads(p.read_text()) if p.exists() else None

    reread = _rj("controls_reread.json")
    if reread is None:
        raise SystemExit("reads/controls_reread.json is missing: run scripts/te_reread_controls.py --src first")
    pm = _rj("pausemanager_roles.json") or {}
    ctx = {
        "rh_sim": sim, "reread": reread,
        "pm_roles": {("ethereum" if k == "ethereum" else k): v for k, v in pm.items()},
        "cb_roles": _rj("coinbase_roles.json"),
        "sol_auth": _rj("solana_authorities.json"),
    }
    n_read, n_excl_read = len(u["records"]), len(u.get("excluded") or [])
    prep = prepare(u, src)
    for n in prep["notes"]:
        print("  note:", n)

    records = u["records"]
    issuers = {}
    for slug, iss in u["issuers"].items():
        e = iss.get("eligibility") or {}
        issuers[slug] = {
            "name": ISSUER_NAMES.get(slug, slug),
            "programme": iss.get("programme"),
            "eligibility": {
                "text": e.get("text"), "url": e.get("url"), "read_on": _read_on(e.get("read")),
                "read_note": clean_text(e.get("read")), "class": e.get("class", "D"),
                **({"also": e["also"]} if e.get("also") else {}),
            },
        }

    # Controls are stored twice interned: each distinct cell once, and each
    # distinct six-cell combination as a list of cell indices. Tokens of one
    # family on one chain share everything except, for Ondo, the first
    # MINTER_ROLE member, so this is about 1,000 short lists over a few
    # hundred cells rather than 14,290 copies.
    cell_index: dict[str, int] = {}
    cells: list[dict] = []
    ctl_index: dict[tuple, int] = {}
    ctl_sets: list[list[int]] = []
    basis_index: dict[str, int] = {}
    rows = []
    for r in sorted(records, key=lambda x: x["id"]):
        ctl = normalise_controls(r, ctx)
        ctl = clean_all(ctl) if ctl else ctl
        ci = None
        if ctl is not None:
            ids = []
            for k in CONTROL_KEYS:
                ks = json.dumps(ctl[k], sort_keys=True, separators=(",", ":"))
                if ks not in cell_index:
                    cell_index[ks] = len(cells)
                    cells.append(ctl[k])
                ids.append(cell_index[ks])
            ci = ctl_index.get(tuple(ids))
            if ci is None:
                ci = ctl_index[tuple(ids)] = len(ctl_sets)
                ctl_sets.append(ids)
        key = _key(r)
        if key.split("/", 1)[1] != (r["address"].lower() if isinstance(r["chain_id"], int) else r["address"]):
            raise SystemExit(f"{r['id']}: address is not recoverable from its key")
        basis = (r.get("verification") or {}).get("basis") or ""
        bi = basis_index.setdefault(basis, len(basis_index))
        ev = r.get("evidence") or {}
        point, unit = _read_point(ev)
        on = r.get("onchain") or {}
        row = {
            "key": key, "issuer": r["issuer"], "chain": r["chain"],
            "ticker": r["underlying"]["ticker"],
            "symbol": on.get("symbol"), "decimals": on.get("decimals"),
            "supply": on.get("total_supply"),
            "scope": r.get("scope"), "status": (r.get("verification") or {}).get("status"),
            "block_or_slot": point, "unit": unit, "read_at": ev.get("read_at"),
            "basis": bi, "ctl": ci, "liq": _liquidity(r.get("liquidity")),
        }
        rows.append(row)

    # Categorical columns go out as indexes into a value list, and the
    # liquidity entries as indexes into a list of distinct ones, so parsing
    # the file allocates one string per distinct value rather than one per
    # row. That is what keeps the load's transient peak low.
    enums = {f: sorted({row[f] for row in rows if row[f] is not None}) for f in ENUM_FIELDS}
    pos = {f: {v: i for i, v in enumerate(vals)} for f, vals in enums.items()}
    liqs: list = []
    liq_pos: dict = {}
    encoded = []
    for row in rows:
        if row["liq"] is not None:
            ks = json.dumps(row["liq"], separators=(",", ":"))
            if ks not in liq_pos:
                liq_pos[ks] = len(liqs)
                liqs.append(row["liq"])
            row["liq"] = liq_pos[ks]
        for f in ENUM_FIELDS:
            if row[f] is not None:
                row[f] = pos[f][row[f]]
        encoded.append(row)
    # Column-wise: one list per field, so the loader's parse allocates 17
    # long lists rather than 14,290 short ones (less transient, less heap
    # fragmentation left behind in the web process).
    columns = {f: [row[f] for row in encoded] for f in RECORD_FIELDS}

    art = {
        "schema": SCHEMA,
        "builder": "backend/scripts/te_build_universe.py",
        "source": {
            "file": "universe.json", "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "generated_at": u.get("generated_at"), "records": n_read, "records_served_as_rows": len(u["records"]),
            "excluded_candidates": n_excl_read,
            "reread_at": reread.get("read_at"),
            "reads_note": "chain reads taken 2026-09-26 between about 14:30 and 22:30 UTC; each record names its block or slot",
            "pools_generated_at": pools_raw.get("generated_at"),
        },
        "chains": CHAINS,
        "issuers": issuers,
        "underlyings": _underlyings(records),
        "bases": sorted(basis_index, key=basis_index.get),
        "control_keys": list(CONTROL_KEYS),
        "control_cells": cells,
        "controls": ctl_sets,
        "fields": list(RECORD_FIELDS),
        "enums": enums,
        "liqs": liqs,
        "columns": columns,
        "excluded": prep["excluded"],
        "coverage": coverage(u),
        "corrections": prep["notes"],
    }

    pools = {
        "schema": SCHEMA.replace("universe", "pools"),
        "source": {"file": "universe_pools.json", "generated_at": pools_raw.get("generated_at"), "note": pools_raw.get("note")},
        "tokens": {k: _pool_entry(v) for k, v in sorted(pools_raw["tokens"].items()) if v.get("pools")},
    }
    return art, pools


def _write(obj: dict, path: Path) -> tuple[int, int]:
    raw = json.dumps(obj, sort_keys=False, separators=(",", ":"), ensure_ascii=False).encode()
    # mtime=0 so the same input gives the same bytes.
    with open(path, "wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", compresslevel=9, mtime=0, filename="") as gz:
        gz.write(raw)
    return len(raw), path.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", required=True, type=Path, help="directory holding universe.json, universe_pools.json and reads/")
    args = ap.parse_args()
    art, pools = build(args.src)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for obj, path in ((art, UNIVERSE_FILE), (pools, POOLS_FILE)):
        raw, gz = _write(obj, path)
        print(f"{path.relative_to(DATA_DIR.parent)}: {raw:,} bytes JSON, {gz:,} bytes gzip")
    print(f"records {len(art['columns']['key']):,}; control sets {len(art['controls']):,}; cells {len(art['control_cells']):,}; underlyings {len(art['underlyings']):,}; "
          f"tokens with pools {len(pools['tokens']):,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
