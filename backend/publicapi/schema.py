"""
schema.py

The public shape. Hand-written, never generated from a Mongo document.

Every field here is a promise. Adding one is free, removing or retyping one is
a breaking change that is not permitted inside a version. A field that turns
out to be wrong gets `deprecated` set on it and stays.

The split between AgentSummary and AgentDetail is the single most important
decision in this package, and it is a capacity decision rather than a taste
one. Listing the whole catalogue is 3,975 requests at 50 a page. Fetching the
thirteen evaluation signals is one request per agent, 198,743 of them. Putting
signals in the summary would collapse that to 3,975 and hand over the only part
of this data nobody else has. So the summary carries identity and a score, and
the signals live in the detail.
"""

from __future__ import annotations

from typing import Any

# Bumped only for a breaking change, which means a new module beside this one
# rather than an edit to it.
SCHEMA_VERSION = "v1"

# Server-side and not negotiable. A caller asking for more gets this.
MAX_PAGE_SIZE = 50
DEFAULT_PAGE_SIZE = 24


def _iso(value: Any) -> str | None:
    """Timestamps go out as ISO 8601 strings, never as floats.

    Internally these are unix floats. A float is ambiguous about precision and
    timezone at a boundary we cannot change later, so it is converted once,
    here, rather than in three adapters."""
    if value in (None, "", 0):
        return None
    try:
        import datetime as dt
        return dt.datetime.fromtimestamp(float(value), dt.UTC).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def agent_summary(doc: dict) -> dict:
    """One agent in a list. Deliberately carries no evaluation signals.

    `score` is included because a list is useless for ranking without one, and
    a single composite number is not the signal set. Anyone wanting to know why
    a score is what it is has to ask for the agent."""
    return {
        "chain_id": doc.get("chain_id"),
        "token_id": str(doc.get("token_id")) if doc.get("token_id") is not None else None,
        "name": doc.get("name"),
        "description": doc.get("description") or None,
        "category": doc.get("category"),
        "owner_address": (doc.get("owner_address") or None),
        "service_status": doc.get("service_status"),
        "score": doc.get("total_score"),
        "image_url": doc.get("image_url") or None,
        "registered_at": _iso(doc.get("created_at")),
    }


def signal(entry: dict) -> dict:
    """One evaluation signal.

    `reason` is as much the point as `available`. An absent signal that does not
    say why is indistinguishable from a broken one, and the whole argument for
    this data being worth anything is that absences are explained."""
    return {
        "signal": entry.get("signal"),
        "available": bool(entry.get("available")),
        "partial": bool(entry.get("partial")),
        "reason": entry.get("reason") or None,
        "detail": entry.get("detail") or None,
    }


def agent_detail(doc: dict, signals: list[dict], hire: dict | None = None) -> dict:
    """One agent in full. This is the response the signals live in."""
    return {
        **agent_summary(doc),
        "service_endpoint": doc.get("service_endpoint") or None,
        "service_checked_at": _iso(doc.get("service_checked_at")),
        "feedback_count": doc.get("total_feedbacks"),
        "star_count": doc.get("star_count"),
        "supported_protocols": doc.get("supported_protocols") or [],
        "signals": [signal(s) for s in (signals or [])],
        "hire": hire,
    }


def chain(view: dict) -> dict:
    """A chain as the API describes it, including what it cannot answer."""
    return {
        "chain": view.get("view"),
        "chain_id": (view.get("chain_ids") or [None])[0],
        "label": view.get("label"),
        "agent_count": view.get("total"),
        "analysed": bool(view.get("analysed")),
        "hire_paths": view.get("hire_paths"),
        "signals_available": view.get("signals_available"),
        "signals_total": view.get("signals_total"),
    }


def page(items: list[dict], *, total: int | None, limit: int, offset: int) -> dict:
    """The list envelope.

    `next_offset` is null at the end rather than absent, so a caller can loop on
    a value rather than on a key's existence. `limit` echoes what was actually
    applied, which may be lower than what was asked for."""
    nxt = offset + len(items)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "next_offset": nxt if (total is not None and nxt < total) else None,
    }


def error(code: str, message: str, **extra: Any) -> dict:
    """One error shape everywhere.

    `code` is stable and meant to be branched on. `message` is for a human and
    may be reworded at any time, which is stated so nobody parses it."""
    return {"error": {"code": code, "message": message, **extra}}
