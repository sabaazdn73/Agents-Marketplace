"""
render.py

Turning a dataset answer into a Telegram message, without ever turning a
withheld number into a zero.

THE ONE RULE THIS FILE EXISTS TO ENFORCE
When a number is withheld, the line that would have carried it is REPLACED by
the reason. It is not filled with a dash, an em space, "n/a", "0%", or the word
"unknown". A formatter with a `value if value is not None else something`
anywhere in its rate path has already failed, because that shape is exactly how
an absence becomes a figure on a screen.

WHERE THE WORDS COME FROM
extension/shared.js holds the same vocabulary for the Chrome panel, and its
header says why it is written there rather than decided there: "If the rule for
when a number is trustworthy lived here too, there would be two rules, and the
one on screen would be the one nobody reviewed." The same applies here and the
same risk arrives with it, because this is now the fourth renderer of the same
reasons after web, mobile and the extension.

So: the REASONS are decided in backend/core/hyperliquid/service.py and nowhere
else. This file only holds the words for them, and the words below are the
extension's words, shortened for a phone. When a reason is added to the service,
it is added here and in extension/shared.js in the same commit, and the test at
the bottom of this module fails until it is.
"""

from __future__ import annotations

# Every reason any Tnega surface can attach to a withheld Hyperliquid number.
# Keys match service.address_detail and service.makers exactly.
WITHHELD = {
    "not_tracked": (
        "Not tracked",
        "This address is not in the collector's set, so nothing has been "
        "measured for it."),
    "no_polls_yet": (
        "Tracked, not yet polled",
        "It was added to the set but no poll has stored anything for it yet."),
    "too_few_polls": (
        "Too few observations",
        "There are not enough polls behind this address to state a rate that "
        "would mean anything."),
    "left_rotation": (
        "No longer being polled",
        "This address was measured until it left the collector's set, so what "
        "is stored describes that earlier period and will not refresh. The set "
        "is chosen on recent trading activity, so an address can leave it "
        "without anything being wrong with the address."),
    "stale_data": (
        "Data is not current",
        "The most recent order seen for this address is older than an hour. "
        "Hyperliquid's order endpoint can return a full buffer of months-old "
        "records for an account trading today, so a rate from it would "
        "describe the past and look like the present."),
    "no_post_only_orders": (
        "No post-only orders",
        "This address has been observed but posts no post-only orders, so "
        "there is no post-only rejection rate to compute. It is trading, not "
        "quoting."),
    # Not a Hyperliquid reason, but the same rule. budgets.escrow withholds a
    # draw rate below its minimum sample.
    "sample_too_small": (
        "Sample too small",
        "A rate is withheld below the minimum number of budgets rather than "
        "computed from a few."),
    "not_found": (
        "Not found",
        "Nothing is stored under that identifier."),
}

BANDS = {
    "quoting": "Quoting",
    "mixed": "Mixed",
    "spraying": "Spraying",
}


def esc(text) -> str:
    """HTML-escape, because replies are sent with parse_mode HTML and an
    address or a name is not ours to trust. The extension learned this for its
    innerHTML path; a bot echoing user text into a formatted message is the
    same exposure."""
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;"))


def short(address: str) -> str:
    a = str(address or "")
    return f"{a[:6]}…{a[-4:]}" if len(a) > 12 else a


def age(seconds) -> str:
    """A coarse age. The point is 'this stopped a while ago', not the minute."""
    if seconds is None:
        return "unknown"
    s = float(seconds)
    if s < 90:
        return f"{int(s)} s"
    if s < 5400:
        return f"{int(s / 60)} min"
    if s < 172800:
        return f"{int(s / 3600)} h"
    return f"{int(s / 86400)} days"


def pct(x, digits=2) -> str:
    return f"{x * 100:.{digits}f}%"


def withheld_block(reason: str | None) -> str:
    """The replacement for a rate line. Never returns an empty string for an
    unknown reason: a reason this file has not met is still a reason, and
    printing nothing would put the reader back where a dash would."""
    if not reason:
        return ""
    title, body = WITHHELD.get(
        reason,
        ("No rate available",
         f"No rate is being shown. The reason given is <code>{esc(reason)}</code>, "
         "which this bot has no wording for yet."))
    return f"<b>No rate. {esc(title)}</b>\n{esc(body)}"


def address_reply(d: dict) -> str:
    """One Hyperliquid address, as the panel renders it, for a phone."""
    if d.get("error"):
        return f"<b>{esc(d.get('address'))}</b>\nNot an address this bot can read."

    a = short(d["address"])
    f = d.get("freshness") or {}
    p = d.get("post_only") or {}
    o = d.get("observed") or {}
    reason = d.get("withheld_reason")
    lines = [f"<b>{esc(a)}</b> · Hyperliquid post-only", ""]

    if reason:
        lines.append(withheld_block(reason))
    else:
        rate = p.get("rejection_rate")
        band = BANDS.get(p.get("band"), p.get("band") or "")
        lines.append(f"<b>{pct(rate)}</b> refused   {esc(band)}")

    lines.append("")
    # The counts, and the window they describe. Kept together on purpose: an
    # address that left the rotation can carry a large count from one 13-minute
    # buffer read 31 times, and the count without the window is the figure that
    # made a reader doubt the rest.
    if p.get("alo_total"):
        lines.append(
            f"Post-only seen {p['alo_total']:,} · refused {p.get('alo_rejected', 0):,}")
    if o.get("orders"):
        lines.append(f"Orders observed {o['orders']:,}")

    newest = f.get("newest_record_age_seconds")
    lines.append("")
    lines.append(
        f"<i>Coverage: {f.get('polls', 0)} polls, newest order {age(newest)} old, "
        + ("in the collector's set" if d.get("tracked") else "not in the collector's set")
        + ".</i>")
    if newest is not None and newest > 3600:
        lines.append(
            "<i>Those counts describe that earlier period, not now.</i>")
    return "\n".join(lines)


def coverage_reply(rows: list[dict]) -> str:
    """What every dataset holds, which is the answer to "is any of this
    current"."""
    lines = ["<b>Tnega coverage</b>", ""]
    for r in rows:
        cov = r.get("coverage") or {}
        partial = cov.get("partial")
        bits = ", ".join(
            f"{k} {v}" for k, v in list(cov.items())[:4]
            if not isinstance(v, (dict, list)) and k != "partial")
        lines.append(f"<b>{esc(r.get('id'))}</b>{' · partial' if partial else ''}")
        lines.append(f"<i>{esc(bits)}</i>")
    return "\n".join(lines)


def makers_reply(rows: list[dict], coverage: dict) -> str:
    lines = ["<b>Tracked Hyperliquid makers</b>", ""]
    shown = 0
    for m in rows:
        if shown >= 10:
            break
        shown += 1
        a = short(m.get("address"))
        if m.get("withheld_reason"):
            title = WITHHELD.get(m["withheld_reason"], ("withheld", ""))[0]
            lines.append(f"<code>{esc(a)}</code>  no rate · {esc(title.lower())}")
        else:
            lines.append(
                f"<code>{esc(a)}</code>  {pct(m.get('post_only_rejection_rate'))} refused")
    lines.append("")
    lines.append(
        f"<i>{coverage.get('addresses_tracked', 0)} addresses in the set now, "
        f"{coverage.get('addresses', 0)} polled at some point.</i>")
    return "\n".join(lines)


def resolve_reply(address: str) -> str:
    a = esc(address)
    return (f"<b>{esc(short(address))}</b>\n"
            "That is an address. This bot can read it three ways:\n\n"
            f"<code>/address {a}</code> · Hyperliquid post-only rejection\n"
            f"<code>/jobs {a}</code> · ERC-8183 jobs, who hired it and what was escrowed\n"
            f"<code>/budget {a}</code> · budgets funded to it and drawn against")


def whatis_reply(word: str) -> str:
    key = (word or "").strip().lower()
    if key in WITHHELD:
        title, body = WITHHELD[key]
        return f"<b>{esc(title)}</b>\n{esc(body)}"
    known = ", ".join(f"<code>{k}</code>" for k in sorted(WITHHELD))
    return ("No wording here for that one. The reasons this bot knows are:\n"
            + known)


def counts_reply(summary: dict) -> str:
    """Agent counts by tier, with the reconciliation the MCP surface makes.

    The categories are printed only when they sum to the matched total. An
    external reader once found category counts summing to 14,855 against a
    stated 14,875 with nothing saying a cut had been made, and a chat message
    is the last place that difference would be noticed.
    """
    matched = summary.get("matched")
    tiers = summary.get("tiers") or {}
    lines = [f"<b>Agents</b>  {matched:,} listed" if isinstance(matched, int)
             else "<b>Agents</b>", ""]
    for k, v in tiers.items():
        lines.append(f"{esc(k)} {v:,}" if isinstance(v, int) else f"{esc(k)} {esc(v)}")
    cats = summary.get("categories") or {}
    if isinstance(cats, dict) and cats:
        total = sum(v for v in cats.values() if isinstance(v, int))
        if isinstance(matched, int) and total != matched:
            lines.append("")
            lines.append(f"<i>Categories sum to {total:,}, not {matched:,}. "
                         f"The difference is unclassified rather than missing.</i>")
    lines.append("")
    lines.append("<i>Verified means one on-chain job from a buyer other than the "
                 "owner reached SUBMITTED or COMPLETED. It counts wallets that "
                 "paid, not independent agents.</i>")
    return "\n".join(lines)
