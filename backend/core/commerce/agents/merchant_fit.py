# agents/merchant_fit.py
#
# Decides which of the buyer's links belong to merchants that could actually
# serve them, before Search spends time fetching pages from shops that will
# never deliver.
#
# WHAT IT CAN AND CANNOT KNOW
# There is no merchant database here, and no shipping API. What is available
# is the domain, the buyer's country, and a model that knows something about
# large retailers. That is enough to rule out clear mismatches and not
# enough to promise delivery, so this stage reports a judgement with a
# confidence and never a guarantee.
#
# It only EXCLUDES a link when the model is confident the merchant does not
# serve the buyer's country. Anything uncertain passes through, because a
# wrongly excluded link is a product the buyer chose and cannot buy here,
# which is worse than a link that later turns out not to ship.
#
# Country comes from the profile. Without it the stage cannot do its job and
# says so instead of assuming a country, since assuming is how a buyer in
# one place gets shown shops in another.

from __future__ import annotations

import re
import time
from urllib.parse import urlparse

from .. import model
from ..questions import question
from ..state import StageResult, TaskState

SCHEMA_HINT = """{
  "merchants": [
    {
      "domain": string,
      "serves_country": true|false|null,   // null when you do not know
      "confidence": "high"|"medium"|"low",
      "currency": string|null,             // what that merchant most likely prices in
      "note": string                       // one short line of reasoning
    }
  ]
}"""


def domains_from(urls: list[str]) -> list[str]:
    seen, out = set(), []
    for u in urls or []:
        host = (urlparse(u).netloc or "").lower()
        host = re.sub(r"^www\.", "", host)
        if host and host not in seen:
            seen.add(host)
            out.append(host)
    return out


def _prompt(domains: list[str], country: str, city: str | None) -> str:
    where = f"{city}, {country}" if city else country
    return (
        "You are the merchant fit stage of a shopping pipeline. For each "
        "retailer domain below, say whether it can serve a buyer in "
        f"{where}.\n\n"
        f"DOMAINS:\n" + "\n".join(f"- {d}" for d in domains) + "\n\n"
        "Rules:\n"
        "- serves_country must be false only if you are confident the "
        "merchant does not ship there or does not operate there.\n"
        "- Use null when you do not know the merchant or its shipping. Do "
        "not guess to fill the field.\n"
        "- currency is the currency that merchant most likely charges in, "
        "or null if unknown.\n"
        "- note is one short line, no more."
    )


async def run(state: TaskState) -> StageResult:
    started = time.time()

    urls = list(state.context.get("product_urls") or [])
    if not urls:
        return StageResult(
            stage="merchant_fit", status="error", data={},
            note="No product links to assess. Paste links and this stage will check which shops can serve you.",
            started_at=started, ended_at=time.time(),
        )

    country = (state.profile.get("country") or "").strip()
    city = (state.profile.get("city") or "").strip() or None
    if not country:
        return StageResult(
            stage="merchant_fit", status="error",
            data={
                "domains": domains_from(urls),
                "questions": [question("country", "Which country are you in?",
                                       "profile.country", placeholder="United Kingdom")],
            },
            note=(
                "Waiting on your country. Without it there is no way to say which shops can "
                "serve you, and assuming is how a buyer in one place gets shown shops in another."
            ),
            started_at=started, ended_at=time.time(),
        )

    domains = domains_from(urls)

    try:
        out = await model.reason(
            _prompt(domains, country, city), SCHEMA_HINT,
            intent=f"decide which of {len(domains)} retailer domain(s) can serve a buyer in {country}",
        )
    except model.ModelUnavailable as e:
        return StageResult(
            stage="merchant_fit", status="error",
            data={"domains": domains},
            note=f"{e} No link was excluded, since excluding needs a reason.",
            started_at=started, ended_at=time.time(),
        )

    if out.get("degraded"):
        # Passing everything through is the safe default: the buyer keeps
        # every link they chose, and Search reports per link anyway.
        return StageResult(
            stage="merchant_fit", status="degraded",
            data={"domains": domains, "would_have": out.get("would_have"), "reason": out.get("reason")},
            note=(
                "No model configured, so merchant fit was not assessed. Every link was kept, "
                "because dropping one needs a reason."
            ),
            started_at=started, ended_at=time.time(),
        )

    verdicts = {}
    for m in out.get("merchants") or []:
        if isinstance(m, dict) and isinstance(m.get("domain"), str):
            d = re.sub(r"^www\.", "", m["domain"].strip().lower())
            verdicts[d] = m

    kept, excluded = [], []
    for u in urls:
        host = re.sub(r"^www\.", "", (urlparse(u).netloc or "").lower())
        v = verdicts.get(host) or {}
        confident_no = v.get("serves_country") is False and v.get("confidence") in ("high", "medium")
        if confident_no:
            excluded.append({"url": u, "domain": host, "note": str(v.get("note") or "")[:160]})
        else:
            kept.append(u)

    state.context["product_urls"] = kept
    state.context["merchant_fit"] = {
        "country": country, "city": city,
        "kept": len(kept), "excluded": excluded,
        "currencies": {d: (v.get("currency") or None) for d, v in verdicts.items()},
    }

    if not kept:
        return StageResult(
            stage="merchant_fit", status="error",
            data=state.context["merchant_fit"],
            note=(
                f"None of the {len(urls)} shop(s) look able to serve {country}. "
                "Nothing was passed on, because a cart from a shop that cannot deliver is not a cart."
            ),
            started_at=started, ended_at=time.time(),
        )

    return StageResult(
        stage="merchant_fit", status="ok",
        data=state.context["merchant_fit"],
        note=(
            f"{len(kept)} of {len(urls)} link(s) kept for {country}."
            + (f" {len(excluded)} excluded." if excluded else "")
            + " Fit is a judgement, not a delivery promise."
        ),
        started_at=started, ended_at=time.time(),
    )
