# currency.py
#
# Turning what somebody typed about money into a token symbol.
#
# WHY THIS EXISTS
# ---------------
# The budget currency is the one field on a spend path that comes out of a
# language model as free text. Every other money value is an integer count
# of minor units. The intent and profile stages were taking whatever string
# the model put in `budget_currency`, calling .upper() on it, and handing
# that to Money as a token symbol.
#
# So "I want a marketplace, with a 200 stablecoin budget" produced a budget
# denominated in the token STABLECOIN, which does not exist. The match stage
# then correctly refused to compare a STABLECOIN budget against services
# priced in $U, and the run died at:
#
#     The budget is in STABLECOIN and these services price in U.
#     No exchange rate is applied, so no comparison is made.
#
# That refusal is right in principle and useless here, because there was
# never a second currency. There was one currency and a person describing it
# with an ordinary English word.
#
# THE DISTINCTION THIS MODULE DRAWS
# ---------------------------------
# Three different things arrive in that field and they must not be treated
# alike:
#
#   1. A SPELLING of the settlement asset. "$U", "u", "United Stables" are
#      all the token the services already price in. Normalising these is not
#      a conversion, it is the same asset written differently.
#
#   2. A GENERIC WORD for money. "stablecoin", "stable", "token", "crypto",
#      "dollars". These name no asset at all. Someone writing "200
#      stablecoin" on a page that quotes $U is not choosing a token, they are
#      declining to. Reading it as the settlement asset is disambiguation.
#
#   3. A DIFFERENT, REAL TOKEN. "USDT", "USDC", "DAI". This one IS a second
#      currency, and no rate is applied to it, because guessing a rate on a
#      spend path is how someone ends up agreeing to a number they did not
#      agree to. B402 settles USDT as well as $U, which makes it more
#      tempting to assume 1:1 and no more correct.
#
# Case 3 keeps the old refusal. Cases 1 and 2 are what the bug was.
#
# The caller is told WHICH case it got, because a normalisation the person
# cannot see is indistinguishable from a conversion this codebase refuses to
# do. "Read as $U" belongs in the stage note, not in a silent rewrite.

from __future__ import annotations

# The asset the API/services flow prices and settles in: $U, United Stables,
# over B402 on BNB Chain. See core/paybox.py's DEFAULT_ASSET_SYMBOL, which is
# the same value for the same reason.
SETTLEMENT_SYMBOL = "U"

# Spellings that mean one specific token. The key is the canonical symbol.
# Only tokens this project actually touches are listed: an unknown symbol is
# carried through as itself rather than guessed at, which is why the table
# does not need to be exhaustive.
_SPELLINGS: dict[str, set[str]] = {
    "U": {"U", "UNITED STABLES", "UNITEDSTABLES", "UNITED STABLE"},
    "USDT": {"USDT", "TETHER", "TETHER USD", "USD TETHER"},
    "USDC": {"USDC", "USD COIN", "USDCOIN"},
    "USD1": {"USD1", "USD 1"},
    "BUSD": {"BUSD", "BINANCE USD"},
    "DAI": {"DAI"},
}

# Words for money that name no token. Deliberately does NOT include any real
# ticker: anything in here is resolved to the settlement asset, so a ticker
# landing in this set would be a silent 1:1 conversion of a real currency.
#
# "USD" and "DOLLAR" are the arguable members and they are in. On this site
# the price a person reads is "$U", captioned "worth about $1" in the UI and
# in AdvantageReport.jsx, so somebody typing "200 dollars" against a $U quote
# is naming the thing in front of them. The stage note says so out loud,
# which is the part that keeps it honest.
_GENERIC: set[str] = {
    "STABLECOIN", "STABLECOINS", "STABLE", "STABLES", "STABLE COIN",
    "STABLE COINS", "STABLECOIN TOKEN",
    "TOKEN", "TOKENS", "COIN", "COINS", "CRYPTO", "CRYPTOCURRENCY",
    "USD", "DOLLAR", "DOLLARS", "US DOLLAR", "US DOLLARS", "USD STABLECOIN",
    "DIGITAL DOLLAR", "DIGITAL DOLLARS",
    "CREDIT", "CREDITS", "UNIT", "UNITS",
}

# What the caller is told it got back.
SETTLEMENT = "settlement"   # a spelling of the settlement asset
GENERIC = "generic"         # a word for money that names no token
STATED = "stated"           # a different, real currency
UNSPECIFIED = "unspecified"  # nothing was said


def _clean(raw: str) -> str:
    """Strip the decoration a model puts around a ticker.

    A leading "$" is the common one ("$U", "$USDT"). Trailing punctuation
    comes from the model quoting a phrase. Internal whitespace is collapsed
    so "united  stables" matches "UNITED STABLES".
    """
    text = " ".join(str(raw).split()).strip().strip(".,;:!?()[]{}\"'")
    while text.startswith("$"):
        text = text[1:].lstrip()
    return text.upper()


def canonical_symbol(raw: str | None) -> str | None:
    """The canonical ticker for one spelling, or None if nothing was said.

    An unrecognised symbol comes back cleaned but otherwise untouched. That
    is deliberate: a token this table has never heard of is still a token,
    and rewriting it would be worse than carrying it.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    cleaned = _clean(raw)
    if not cleaned:
        return None
    for canon, spellings in _SPELLINGS.items():
        if cleaned in spellings:
            return canon
    return cleaned


def normalize_budget_currency(
    raw: str | None, settlement: str = SETTLEMENT_SYMBOL
) -> tuple[str, str]:
    """Resolve a free-text currency to (symbol, kind).

    `kind` is one of UNSPECIFIED, SETTLEMENT, GENERIC or STATED, and the
    caller is expected to branch on it. Only STATED means a second currency
    is genuinely in play; the other three all resolve to `settlement` and
    need no exchange rate, because no exchange is happening.
    """
    if not isinstance(raw, str) or not raw.strip():
        return settlement, UNSPECIFIED

    cleaned = _clean(raw)
    if not cleaned:
        return settlement, UNSPECIFIED

    if cleaned in _GENERIC:
        return settlement, GENERIC

    canon = canonical_symbol(cleaned) or settlement
    if canon == _clean(settlement) or canon == settlement:
        return settlement, SETTLEMENT

    return canon, STATED


def display(symbol: str) -> str:
    """How a symbol is written in user-facing copy.

    Only United Stables carries the dollar sign. It is branded "$U"
    everywhere on this site, in the UI and in the marketing copy, and a bare
    "U" in a sentence reads as a typo. Every other ticker is written plain,
    because "$USDT" is not how anyone writes USDT.
    """
    return f"${symbol}" if symbol == SETTLEMENT_SYMBOL else symbol


def reading_note(raw: str | None, symbol: str, kind: str) -> str:
    """One sentence for the stage note when the input was not a plain ticker.

    Empty when there is nothing worth saying, so a caller can concatenate it
    unconditionally.
    """
    if kind == GENERIC and isinstance(raw, str) and raw.strip():
        return (f" Read {raw.strip()!r} as {display(symbol)}, "
                "the asset these services price in.")
    return ""
