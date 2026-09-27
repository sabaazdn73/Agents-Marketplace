"""
A token's own on-chain metadata: the Token-2022 TokenMetadata extension, or
the Metaplex metadata account for classic SPL mints. Names and symbols are
what the token says about itself (class D, self-declared); the mint
address and its authorities are class A.

Token-2022 mint: base 82 bytes, padded to 165, account-type byte at 165,
then TLV entries (u16 type, u16 length). TokenMetadata is type 19:
update_authority 32, mint 32, name, symbol, uri (Borsh strings), ...
Metaplex: PDA ["metadata", program, mint] under metaqbxx…; key u8,
update_authority 32, mint 32, then name, symbol, uri (Borsh strings, padded).
"""

from __future__ import annotations

from .solana import TOKEN_2022_PROGRAM, SolanaRpc, find_pda, pk32, pubkey, u16, u32

METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
TOKEN_METADATA_EXT = 19


def _bstr(b: bytes, o: int) -> tuple[str, int]:
    n = u32(b, o)
    if n > 512 or o + 4 + n > len(b):
        raise ValueError("bad string")
    return b[o + 4:o + 4 + n].decode("utf-8", "replace").rstrip("\0").strip(), o + 4 + n


def _t22_meta(d: bytes) -> dict | None:
    if len(d) <= 166 or d[165] != 1:
        return None
    o = 166
    while o + 4 <= len(d):
        t, ln = u16(d, o), u16(d, o + 2)
        v = d[o + 4:o + 4 + ln]
        if t == TOKEN_METADATA_EXT:
            try:
                name, p = _bstr(v, 64)
                sym, p = _bstr(v, p)
                return {"name": name, "symbol": sym, "source": "Token-2022 metadata extension"}
            except (ValueError, IndexError):
                return None
        if t == 0 and ln == 0:
            break
        o += 4 + ln
    return None


def _metaplex(d: bytes) -> dict | None:
    try:
        name, p = _bstr(d, 65)
        sym, _ = _bstr(d, p)
        return {"name": name, "symbol": sym, "source": "Metaplex metadata account"}
    except (ValueError, IndexError):
        return None


def read(rpc: SolanaRpc, mints: list[str]) -> dict[str, dict]:
    """mint -> {program, mint_authority, decimals, name, symbol, source}."""
    if not mints:
        return {}
    _, accts = rpc.multiple(mints, batch=50)
    out: dict[str, dict] = {}
    need_mp = []
    for m in mints:
        a = accts.get(m)
        if not a:
            out[m] = {"program": None, "mint_authority": None, "name": None, "symbol": None, "source": None}
            continue
        d = a["data"]
        auth = pubkey(d, 4) if len(d) >= 36 and u32(d, 0) == 1 else None
        info = {"program": a["owner"], "mint_authority": auth, "decimals": d[44] if len(d) > 44 else None,
                "name": None, "symbol": None, "source": None}
        if a["owner"] == TOKEN_2022_PROGRAM:
            md = _t22_meta(d)
            if md:
                info.update(md)
        if not info["symbol"]:
            need_mp.append(m)
        out[m] = info
    if need_mp:
        pdas = {m: find_pda([b"metadata", pk32(METAPLEX), pk32(m)], METAPLEX)[0] for m in need_mp}
        _, mp = rpc.multiple(list(pdas.values()), data_slice=(0, 300))
        for m, pda in pdas.items():
            a = mp.get(pda)
            if a and a["owner"] == METAPLEX:
                md = _metaplex(a["data"])
                if md and md["symbol"]:
                    out[m].update(md)
    return out


def label(mint: str, info: dict | None) -> str:
    info = info or {}
    sym, name = info.get("symbol"), info.get("name")
    if sym:
        return f"{sym} ({name})" if name and name.lower() != sym.lower() else sym
    return f"unidentified token {mint}"
