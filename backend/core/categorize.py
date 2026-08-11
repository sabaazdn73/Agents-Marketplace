"""
categorize.py

Chain-agnostic. ERC-8004's Identity Registry metadata has no "category"
field, only free-text name/description. This classifies an agent's
description into one of a real, broad taxonomy, deterministic keyword
matching, no LLM (auditable, zero-LLM analysis layer, same principle
as OnChain Oversight).

EXPANDED 9 Aug 2026: the original 4 categories (Rebalancing, Grid
Trading, Yield Optimisation, Health Factor Monitoring) were the
hackathon's suggested DeFi examples, not an exhaustive list. Real
live 8004scan data includes badge verification, copywriting, smart
contract auditing, data analysis, research agents, and more, most of
which were landing in Unclassified. This taxonomy is broadened to
actually reflect the real, observed diversity of registered agents,
each category still traces to specific matched keywords, so every
classification stays inspectable, not a black box.
"""

from dataclasses import dataclass

CATEGORIES = [
    # Original DeFi-specific set (hackathon's named examples)
    "Rebalancing", "Grid Trading", "Yield Optimisation", "Health Factor Monitoring",
    # Broader, real categories observed in live 8004scan data
    "Trading Signals", "Copy Trading", "Smart Contract Auditing", "Data Analysis",
    "Research", "Content & Copywriting", "Identity & Verification", "Customer Support",
    "NFT & Generative Art", "Gaming", "Prediction Markets", "Social & Community",
    "Payments & Settlement", "Developer Tools",
]

# Keyword sets per category, checked against an agent's name + description,
# case-insensitive. Order matters: most-specific/distinctive vocabulary
# first, to reduce false-positive overlap between neighboring categories.
_KEYWORD_RULES: list[tuple[str, list[str]]] = [
    ("Health Factor Monitoring", [
        "health factor", "liquidation", "collateral", "under-collateralized",
        "undercollateralized", "margin call", "loan safety",
    ]),
    ("Grid Trading", [
        "grid trading", "grid order", "grid bot",
    ]),
    ("Rebalancing", [
        "rebalanc", "lp range", "liquidity range", "re-center", "recenter",
        "position range", "tick range",
    ]),
    ("Yield Optimisation", [
        "yield", "apr", "apy", "highest-earning", "yield route", "yield farm",
    ]),
    ("Copy Trading", [
        "copy trade", "copy-trade", "copytrade", "shadow", "mirror trade",
    ]),
    ("Trading Signals", [
        "trading signal", "signal", "market analysis", "technical analysis",
        "trade alert",
    ]),
    ("Smart Contract Auditing", [
        "audit", "vulnerability", "reentrancy", "security review",
        "smart contract security", "exploit detection",
    ]),
    ("Data Analysis", [
        "data analysis", "data analytics", "csv", "sql", "visualization",
        "dashboard", "reporting",
    ]),
    ("Research", [
        "research", "nuance-first", "interpreter", "mechanism analyst",
        "evidence-first", "reasoning",
    ]),
    ("Content & Copywriting", [
        "copywriting", "copywriter", "content writing", "blog post",
        "article", "marketing copy",
    ]),
    ("Identity & Verification", [
        "badge verification", "identity verification", "kyc", "credential",
        "membership verification", "proof of",
    ]),
    ("Customer Support", [
        "customer support", "helpdesk", "support agent", "faq", "ticket",
    ]),
    ("NFT & Generative Art", [
        "nft", "generative art", "pfp", "collectible", "mint art", "artwork",
    ]),
    ("Gaming", [
        "game", "gaming", "quest", "leaderboard", "player",
    ]),
    ("Prediction Markets", [
        "prediction market", "forecast", "betting", "odds",
    ]),
    ("Social & Community", [
        "social", "community management", "discord", "telegram bot",
        "moderation",
    ]),
    ("Payments & Settlement", [
        "payment", "settlement", "invoice", "billing", "x402", "escrow",
    ]),
    ("Developer Tools", [
        "developer tool", "sdk", "api wrapper", "cli", "boilerplate",
        "scaffold",
    ]),
]


@dataclass
class ClassificationResult:
    category: str | None
    matched_keywords: list[str]
    confidence: str  # "matched" | "unmatched"


def classify_agent(name: str, description: str) -> ClassificationResult:
    """Returns the first category whose keywords appear in name+description.
    Returns category=None (not a guess) if nothing matches, an honest
    "we can't confidently place this one" result rather than a forced
    guess, the agent should then be reviewed manually before listing."""
    text = f"{name} {description}".lower()

    for category, keywords in _KEYWORD_RULES:
        matched = [kw for kw in keywords if kw in text]
        if matched:
            return ClassificationResult(category=category, matched_keywords=matched, confidence="matched")

    return ClassificationResult(category=None, matched_keywords=[], confidence="unmatched")
