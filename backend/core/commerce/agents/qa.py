# agents/qa.py
#
# The gate before money moves. in this pass.
#
# WRITTEN AS A REJECTION CHECKLIST, NOT AN APPROVAL ONE
# -----------------------------------------------------
# A reviewer asked to confirm quality returns approvals; one asked what to
# reject returns findings. So there is no `approve()` here and no score.
# Every rule below answers "what would make this wrong", and the function
# returns what it found. An EMPTY list is the only thing that lets Payment
# run -- absence of findings, not presence of a blessing.
#
# It is deterministic on purpose. No model is consulted, which means it
# works with no API key, cannot be talked out of a finding by a persuasive
# product description, and gives the same answer twice for the same cart.
# The gate before a payment is the wrong place for a probabilistic judgement.
#
# Every finding names the STAGE that caused it, which is the point of the
# six-way split: "over budget" is Styling's fault, "size outside profile" is
# Styling or Profile, "link dead" is Search.

from __future__ import annotations

import asyncio

import httpx

from ..state import Money, RejectionFinding, StageResult, TaskState
from ..rails.base import Cart

LINK_TIMEOUT_SECONDS = 10.0
LINK_CONCURRENCY = 5

# Northern-hemisphere mapping, stated rather than implied. This is a
# heuristic and is labelled as one in the finding text: it flags an item for
# a human to look at, it does not claim certainty about a garment.
_SEASON_CONFLICTS = {
    "summer": {"parka", "puffer", "down jacket", "thermal", "wool coat", "snow", "fleece-lined"},
    "winter": {"swimsuit", "bikini", "sandals", "tank top", "shorts", "linen shorts"},
}


async def _link_resolves(client: httpx.AsyncClient, url: str) -> tuple[bool, str]:
    """HEAD, then GET if HEAD is refused -- plenty of retailers reject HEAD
    with 405 while the page itself is fine, and treating that as a dead link
    would reject good carts."""
    try:
        r = await client.head(url, follow_redirects=True)
        if r.status_code == 405 or r.status_code >= 400:
            r = await client.get(url, follow_redirects=True)
        if r.status_code >= 400:
            return False, f"HTTP {r.status_code}"
        return True, f"HTTP {r.status_code}"
    except (httpx.HTTPError, OSError) as e:
        return False, type(e).__name__


async def review(state: TaskState, cart: Cart, *, check_links: bool = True) -> list[RejectionFinding]:
    """Return everything wrong with this cart. Empty means Payment may run."""
    findings: list[RejectionFinding] = []
    profile = state.profile or {}
    context = state.context or {}

    # --- reject: nothing to buy -------------------------------------------
    if not cart.lines:
        findings.append(RejectionFinding(
            stage="styling", rule="empty_cart",
            detail="No items were selected, so there is nothing to pay for.",
        ))
        return findings   # every other rule is vacuous on an empty cart

    # Services have no size and no season. Applying the clothing rules to
    # them produced a size_unknown finding against an API endpoint, which
    # blocked payment for a reason that could never be satisfied.
    physical = [ln for ln in cart.lines if (ln.category or "").lower() != "service"]

    # --- reject: a size outside the profile --------------------------------
    wanted = profile.get("size")
    if wanted and physical:
        want = str(wanted).strip().lower()
        for ln in physical:
            if ln.size is None:
                findings.append(RejectionFinding(
                    stage="search", rule="size_missing",
                    detail=f"'{ln.title}' carries no size, so it cannot be checked against the profile size {wanted!r}.",
                ))
            elif str(ln.size).strip().lower() != want:
                findings.append(RejectionFinding(
                    stage="styling", rule="size_outside_profile",
                    detail=f"'{ln.title}' is size {ln.size!r}, profile says {wanted!r}.",
                ))
    elif physical:
        findings.append(RejectionFinding(
            stage="profile", rule="size_unknown",
            detail="No size in the profile, so no item's size can be verified before buying.",
        ))

    # --- reject: total over budget ----------------------------------------
    budget = profile.get("budget")
    if isinstance(budget, Money):
        try:
            total = cart.total()
            if total > budget:
                findings.append(RejectionFinding(
                    stage="styling", rule="over_budget",
                    detail=f"Cart total {total} exceeds the stated budget {budget}.",
                ))
        except Exception as e:
            findings.append(RejectionFinding(
                stage="styling", rule="total_uncomputable",
                detail=f"Cart total could not be computed ({type(e).__name__}), so it cannot be checked against budget.",
            ))
    else:
        findings.append(RejectionFinding(
            stage="profile", rule="budget_unknown",
            detail="No budget in the profile, so the total cannot be checked against one.",
        ))

    # --- reject: wrong for the stated season -------------------------------
    season = str(context.get("season") or "").strip().lower()
    if season in _SEASON_CONFLICTS:
        for ln in physical:
            hay = f"{ln.title}".lower()
            for term in _SEASON_CONFLICTS[season]:
                if term in hay:
                    findings.append(RejectionFinding(
                        stage="styling", rule="wrong_for_season",
                        detail=f"'{ln.title}' matches {term!r}, which reads wrong for {season}. Heuristic -- worth a human check.",
                    ))
                    break

    # --- reject: a link that does not resolve -------------------------------
    if check_links:
        sem = asyncio.Semaphore(LINK_CONCURRENCY)
        async with httpx.AsyncClient(
            timeout=LINK_TIMEOUT_SECONDS,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TnegaCommerceQA/1.0)"},
        ) as client:
            async def check(ln):
                async with sem:
                    return ln, *await _link_resolves(client, ln.url)

            for ln in cart.lines:
                if not ln.url:
                    findings.append(RejectionFinding(
                        stage="search", rule="link_missing",
                        detail=f"'{ln.title}' has no URL, so it cannot be verified or bought.",
                    ))
            checkable = [ln for ln in cart.lines if ln.url]
            if checkable:
                for ln, ok, why in await asyncio.gather(*(check(ln) for ln in checkable)):
                    if not ok:
                        findings.append(RejectionFinding(
                            stage="search", rule="link_dead",
                            detail=f"'{ln.title}' link did not resolve ({why}): {ln.url}",
                        ))

    return findings


async def run(state: TaskState, cart: Cart, *, check_links: bool = True) -> StageResult:
    import time
    started = time.time()
    try:
        findings = await review(state, cart, check_links=check_links)
    except Exception as e:
        # QA failing open would let an unreviewed cart reach Payment. It
        # fails CLOSED instead: the error is itself a blocking finding.
        return StageResult(
            stage="qa", status="error",
            data={"findings": [RejectionFinding(
                stage="qa", rule="qa_failed",
                detail=f"QA could not complete ({type(e).__name__}: {e}); treating as blocking.",
            ).to_dict()]},
            note="QA errored; payment blocked.",
            started_at=started, ended_at=time.time(),
        )
    state.findings = findings
    return StageResult(
        stage="qa",
        status="ok",
        data={"findings": [f.to_dict() for f in findings], "passed": not findings},
        note="No blocking findings." if not findings else f"{len(findings)} blocking finding(s).",
        started_at=started, ended_at=time.time(),
    )
