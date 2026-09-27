"""
The fixed, written parts of the vault view: which tokens count as
stablecoins, each platform's audits and the powers of each role. All of it
is class D (the platform's or issuer's own statement, or our reading of
their source), and every entry carries its link and the date it was read.

Nothing here is a figure. Figures are chain reads, made by the platform
modules.
"""

from __future__ import annotations

import re

READ_ON = "2026-09-25"  # the date the phase 7 research read these pages

# Deposit tokens that make a vault qualify (owner's scope: real-world assets,
# meaning stablecoins, tokenized stocks and ETFs, and treasuries). Identity
# is by mint address; the symbol is the token's own on-chain metadata, read
# at slot 450,383,703 (phase 7, raw/kamino_vault_mints_screen.json). USDC and
# USDT are the issuers' long-published Solana mints.
# `usd_face`: the token is counted at 1 USD per token (face value, not a
# market price). A token without it gets no USD figure.
STABLECOINS: dict[str, dict] = {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": {"symbol": "USDC", "usd_face": True},
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": {"symbol": "USDT", "usd_face": True},
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": {"symbol": "PYUSD", "usd_face": True},
    "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": {"symbol": "USDG", "usd_face": True},
    "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA": {"symbol": "USDS", "usd_face": True},
    "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB": {"symbol": "USD1", "usd_face": True},
    "AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9": {"symbol": "AUSD", "usd_face": True},
    "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH": {"symbol": "CASH", "usd_face": True},
    "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG": {"symbol": "USX", "usd_face": True, "kind": "synthetic dollar"},
    "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT": {"symbol": "USDe", "usd_face": True, "kind": "synthetic dollar"},
    "euro5sNHrZC2wu2RoLvy6xxoVMc3Qnd1vjxoWf4MftA": {"symbol": "EURØP", "usd_face": False},
}

# Tokens seen as vault deposit tokens that nothing on chain identifies. They
# are named in the exclusions rather than silently dropped.
UNIDENTIFIED_TOKENS = {
    "8fr7WGTVFszfyNWRMXj6fRjZZAnDwmXwEpCrtzmUkdih": "on-chain metadata symbol wYLDS, empty name; issuer not identified",
}

# Display floor. A vault holding less than this many tokens is counted in the
# exclusions ("empty or under the floor"), not listed. A display choice, stated
# on every platform row, not a judgement of the vault.
MIN_TVL_TOKENS = 1_000

_TEST_NAME = re.compile(r"(^|[^a-z])(test|testing|staging|stage|dev|devnet|demo|rehearsal|quickstart|sandbox|do not use)([^a-z]|$)", re.I)


def looks_like_test(name: str) -> bool:
    return bool(_TEST_NAME.search(name or ""))


def token_kind(mint: str) -> str:
    s = STABLECOINS.get(mint) or {}
    return s.get("kind", "stablecoin")


def face_note(mint: str) -> str:
    """How a token's amount becomes a USD figure, said per row."""
    s = STABLECOINS.get(mint) or {}
    if not s.get("usd_face"):
        return f"{s.get('symbol', mint)} is not a USD token; no USD figure (no FX price is read)"
    if s.get("kind") == "synthetic dollar":
        return f"{s['symbol']} is a synthetic dollar, counted at 1 USD per token (face value, not a market price)"
    return f"{s['symbol']} counted at 1 USD per token (face value, not a market price)"


def token_label(mint: str) -> str:
    k = token_kind(mint)
    return token_symbol(mint) + (f" ({k})" if k != "stablecoin" else "")


def token_symbol(mint: str) -> str:
    s = STABLECOINS.get(mint)
    return s["symbol"] if s else mint[:4] + "…" + mint[-4:]


QUALIFYING_RULE = (
    "Listed: vaults taking a stablecoin deposit (by mint address; USX and USDe are synthetic dollars and are "
    "labelled so). A listed vault lends that stablecoin on Solana; what it lends against is shown per vault, and "
    "is often crypto, so these are not real-world-asset vaults. Not listed: vaults placing funds with Drift; "
    "Kamino vaults lending into Kamino's institutional-yield markets (a market is one when any of its reserves "
    "is minted by Kamino's institutional mint authority 4gPJLzZo…; structure described at "
    "https://kamino.com/docs/products/institutional-yield/structure.md); Voltr vaults with an off-chain, closed or "
    "unlisted strategy position, or a position in a Kamino vault not listed here; GLAM vaults that are not "
    "tokenized, can bridge, or allow non-stablecoin assets; test, staging or demo names; and vaults holding "
    f"under {MIN_TVL_TOKENS:,} tokens. Kamino and GLAM figures are our chain reads; Voltr positions are as "
    "recorded by the vault. Amounts are counted at 1 USD per token (face value, not a market price)."
)

# The fields every vault page shows. Field names, not ticks.
CHECKS = [
    "Stablecoin deposit, and what it is lent against",
    "Audits and auditors, linked",
    "Upgrade authority, read on chain",
    "Timelock on admin changes",
    "What the manager can move",
]

# Kamino's institutional mint authority. Read on chain 2026-09-26: 4gPJLzZo…
# is the mint authority of CoLLWY… (a reserve in market Dwg1aeZF…, lent into
# by the Institutional Commodity Yield vaults) and of kpvCms… (a reserve in
# market DmSeodmE…, lent into by Kamino Private Credit USDC). Kamino
# describes the institutional-yield SPV and lending structure at
# INSTITUTIONAL_YIELD_STRUCTURE. A market with ANY reserve minted by it is an
# institutional-yield market, and a vault lending into one is not listed.
INSTITUTIONAL_MINT_AUTHORITIES = {
    "4gPJLzZoTHYfFdGwnFSoyNhWXaqWJ8mvoWeGDcsmb2kJ": "Kamino institutional mint authority (mints CoLLWY… and kpvCms…)",
}
INSTITUTIONAL_YIELD_STRUCTURE = "https://kamino.com/docs/products/institutional-yield/structure.md"


def offchain_backed(mint: str, info: dict | None) -> dict | None:
    """Whether a collateral token is off-chain-backed, only where a source
    establishes it (class D, linked). None means not established, not no."""
    if (info or {}).get("mint_authority") in INSTITUTIONAL_MINT_AUTHORITIES:
        return {"flag": True, "class": "D", "source": INSTITUTIONAL_YIELD_STRUCTURE, "read_on": "2026-09-26",
                "basis": "minted by Kamino's institutional mint authority; Kamino describes the SPV structure behind it"}
    return None

AUDITS: dict[str, dict] = {
    "kamino": {
        "url": "https://kamino.com/docs/security/audits.md",
        "read_on": "2026-09-26",
        "entries": [
            {"auditor": "OtterSec", "date_as_stated": "9 December 2024", "scope": "Earn Vaults (kVault)", "url": "https://kamino.com/docs/security/audits.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_vault_osec.pdf"},
            {"auditor": "Sec3", "date_as_stated": "6 February 2025", "scope": "Earn Vaults (kVault)", "url": "https://kamino.com/docs/security/audits.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_vault_sec3.pdf"},
            {"auditor": "Offside Labs", "date_as_stated": "12 April 2025", "scope": "Earn Vaults (kVault)", "url": "https://kamino.com/docs/security/audits.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_vault_offside_labs.pdf"},
            {"auditor": "RX Security", "date_as_stated": "3 July 2023", "scope": "Lend (klend)", "url": "https://kamino.com/docs/security/audits.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_lend_rx.pdf"},
            {"auditor": "OtterSec", "date_as_stated": "6 September 2023", "scope": "Lend (klend)", "url": "https://kamino.com/docs/security/audits.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_lend_ottersec.pdf"},
            {"auditor": "Sec3", "date_as_stated": "6 February 2025", "scope": "Lend (klend)", "url": "https://kamino.com/docs/security/audits.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_klend_sec3.pdf"},
            {"auditor": "Certora", "date_as_stated": "27 June 2025", "scope": "Earn Vaults (formal verification)", "url": "https://kamino.com/docs/security/formal-verification.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_vault_certora.pdf"},
            {"auditor": "Certora", "date_as_stated": "13 May 2025", "scope": "Lend (formal verification)", "url": "https://kamino.com/docs/security/formal-verification.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_lend_certora.pdf"},
            {"auditor": "OtterSec", "date_as_stated": "6 October 2025", "scope": "Lend (formal verification)", "url": "https://kamino.com/docs/security/formal-verification.md", "report": "https://github.com/Kamino-Finance/audits/blob/master/kamino_lend_osec_formal_verification.pdf"},
        ],
        "also": "https://github.com/Kamino-Finance/audits",
        "note": "Audits from the audits page; formal verifications from the formal-verification page (Certora's 21 February 2025 entry there covers Limit Orders, not these programs). No count is stated.",
    },
    "voltr": {
        "url": "https://docs.voltr.xyz/security/audits",
        "read_on": READ_ON,
        "entries": [
            {"auditor": "Sec3 X-RAY", "date_as_stated": "not stated", "scope": "vault and one adaptor; an automated scanner, not a manual audit", "url": "https://docs.voltr.xyz/security/audits"},
            {"auditor": "FYEO", "date_as_stated": "not stated (a 2025 folder)", "scope": "Vault v1.0", "url": "https://docs.voltr.xyz/security/audits"},
            {"auditor": "Certora", "date_as_stated": "not stated", "scope": "Ranger Finance, Voltr Vault", "url": "https://docs.voltr.xyz/security/audits"},
        ],
        "note": "No audit was found for the individual Kamino, Drift, Jupiter or Trustful adaptors. Program source is not public.",
    },
    "glam": {
        "url": "https://docs.glam.systems/v1/security",
        "read_on": READ_ON,
        "entries": [
            {"auditor": "Adevar Labs", "date_as_stated": "2025-11-07", "scope": "core and integrations", "url": "https://docs.glam.systems/v1/security"},
            {"auditor": "Adevar Labs", "date_as_stated": "2025-12-15", "scope": "integration patches", "url": "https://docs.glam.systems/v1/security"},
            {"auditor": "Adevar Labs", "date_as_stated": "2026-02-07", "scope": "SingleAssetVault", "url": "https://docs.glam.systems/v1/security"},
            {"auditor": "Adevar Labs", "date_as_stated": "2026-04-07/08", "scope": "security enhancements", "url": "https://docs.glam.systems/v1/security"},
        ],
        "note": "Program source is private.",
    },
}


def audits_text(platform: str) -> str:
    a = AUDITS[platform]
    names = list(dict.fromkeys(e["auditor"] for e in a["entries"]))
    return f"{', '.join(names)} (platform's audit pages, read {a['read_on']})"


# What each role can do, from source (Kamino) or SDK and docs (Voltr, GLAM).
POWERS: dict[str, dict] = {
    "kamino": {
        "source": "https://github.com/Kamino-Finance/kvault (program handlers)",
        "read_on": READ_ON,
        "rows": [
            ["vault admin", "adds lending reserves (same token, klend-owned; the source comment says 'Need to trust the admin'); sets fees (performance up to 100%, management up to 10%) and the withdrawal penalty (up to 10%); names the allocation admin and the next admin; withdraws accrued fees"],
            ["allocation admin", "changes weights and caps of reserves already added"],
            ["global admin", "maintains the reserve whitelist and can turn a vault's whitelist flags off (Kamino's docs call them irreversible; the source disagrees)"],
            ["lending-market owner", "sets each klend market's reserve configuration: collateral accepted, LTVs, oracles and caps"],
        ],
        "moves": "No handler moves deposits to an arbitrary account (from reading the handler list). Risk paths: reserve selection, market owners' reserve settings, and program upgrade.",
    },
    "voltr": {
        "source": "https://docs.voltr.xyz/introduction/key-participants and @voltr/vault-sdk 2.1.1",
        "read_on": READ_ON,
        "rows": [
            ["admin", "adds and removes adaptors; changes fees, caps, the withdrawal waiting period, the manager, the next admin and disabled operations; sets the adaptor policy"],
            ["manager", "opens strategies and moves the vault's funds into and out of them"],
        ],
        "moves": "The manager moves funds between the vault and its strategies. With the Trustful adaptor, funds can go to whitelisted addresses off chain; no listed vault has such a position.",
    },
    "glam": {
        "source": "https://docs.glam.systems/v1 and the glam_protocol IDL",
        "read_on": READ_ON,
        "rows": [
            ["owner", "changes the state (assets allowlist, integrations, delegates, fees), subject to the vault's own timelock"],
            ["delegate", "acts through the integrations and permission bits granted to it, until its expiry"],
        ],
        "moves": "Delegates move funds only through granted integrations; the assets allowlist bounds what the vault may hold.",
    },
}

PLATFORM_LINKS = {
    "kamino": {"docs": "https://kamino.com/docs", "terms": "https://kamino.com/terms"},
    "voltr": {"docs": "https://docs.voltr.xyz", "terms": "https://voltr.xyz/terms"},
    "glam": {"docs": "https://docs.glam.systems", "terms": "https://glam.systems/terms-and-conditions"},
    "hyperliquid": {"docs": "https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults"},
    "hyperevm": {"docs": "https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults"},
}
