"""
category_groups.py

The real, backend-side mirror of frontend/src/categoryGroups.js's own
CATEGORY_GROUPS — same real 5-group presentation grouping of
categorize.py's 18 fine-grained categories, kept in sync manually (no
cross-language shared module for this one small, stable mapping — same
real tradeoff already made for core/canary.py's own real ALLOWED_GROUPS
scope, which used to keep a private, second, partial copy of this exact
mapping before this module existed).

Real fix (2026-08-28): this used to be duplicated — core/canary.py had
its own private `_GROUP_CATEGORIES` covering only 2 of the 5 real groups
(canary's own real scope never needed the rest). core/pnl.py needs the
"Trading & DeFi" group specifically too, which would have made a third,
independent copy. Pulled out into this one real, shared module instead;
canary.py now imports from here rather than keeping its own.

'Unclassified' is deliberately not a key here, same real reasoning as the
frontend's own file: it's not a real classification, so it isn't a group.
"""

CATEGORY_GROUPS: dict[str, set[str]] = {
    "trading-defi": {"Grid Trading", "Rebalancing", "Yield Optimisation", "Health Factor Monitoring", "Trading Signals", "Copy Trading"},
    "data-analysis": {"Data Analysis", "Research", "Prediction Markets"},
    "security-trust": {"Smart Contract Auditing", "Identity & Verification"},
    "content-community": {"Content & Copywriting", "Social & Community", "Customer Support", "NFT & Generative Art", "Gaming"},
    "payments-infra": {"Payments & Settlement", "Developer Tools"},
}


def group_for_category(category: str | None) -> str | None:
    """Real reverse lookup — the fine category's real group id, or None
    for 'Unclassified' / anything not in any group above."""
    if not category:
        return None
    for group_id, categories in CATEGORY_GROUPS.items():
        if category in categories:
            return group_id
    return None
