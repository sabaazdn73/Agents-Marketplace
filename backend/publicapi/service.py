"""
service.py

Query in, public schema out. No HTTP, no MCP, no request objects.

Both adapters call these and nothing else. If either ever needs something these
do not provide, the fix belongs here rather than in the adapter, because the
moment logic lands in one transport the two surfaces start to drift and the
claim that they serve the same data stops being true.

Everything is read-only and bounded. There is no function here that can return
the whole catalogue, and that is deliberate rather than an oversight: at 15.7MB
the existing `/api/agents` blob would exceed the container's typical memory
headroom at ten concurrent calls. A paginated read measured at no detectable
memory cost over 600 requests. That difference is the entire reason this
package exists in the shape it does.
"""

from __future__ import annotations

from core import chain_views
from core.chain_capabilities import summarize_view_capabilities

from . import schema

# Views a caller may name. Taken from the same VIEWS table the site uses, so a
# chain added there is reachable here with no change, which is half of what
# "existing keys keep working" means in practice.
def known_chains() -> list[str]:
    return chain_views.view_ids()


def _clamp(limit: int | None) -> int:
    """Page size is ours, not the caller's.

    Asking for more than the cap is not an error. It returns the cap, because
    failing a request over a number we are going to override anyway is a worse
    experience than quietly serving what we will serve."""
    if not limit:
        return schema.DEFAULT_PAGE_SIZE
    return max(1, min(int(limit), schema.MAX_PAGE_SIZE))


async def list_chains() -> list[dict]:
    """Every chain, what it holds, and what it can and cannot evaluate."""
    out = []
    for v in chain_views.describe_views():
        # describe_views() keys the view as `id` and carries `chains` as a list
        # of {chain_id, name}. Normalised here rather than in schema.chain, so
        # the schema module never has to know the internal shape.
        ids = [c["chain_id"] for c in (v.get("chains") or [])]
        caps = summarize_view_capabilities(ids)
        sigs = caps.get("signals") or []
        out.append(schema.chain({
            "view": v.get("id"),
            "chain_ids": ids,
            "label": v.get("label"),
            "hire_paths": v.get("hire_paths"),
            "coming_soon": v.get("coming_soon"),
            "total": await chain_views.count_view(v["id"]),
            "analysed": any(s.get("available") for s in sigs),
            "signals_available": sum(1 for s in sigs if s.get("available")),
            "signals_total": len(sigs),
        }))
    return out


async def search_agents(
    *, chain: str, category: str | None = None, limit: int | None = None,
    offset: int = 0,
) -> dict:
    """A page of agents on one chain. Summaries only, no signals.

    Deliberately requires a chain rather than searching across all of them. A
    cross-chain search would be the one call that could walk the entire
    catalogue, and there is no use for it that a caller cannot serve by asking
    per chain."""
    if chain not in known_chains():
        raise LookupError(f"unknown chain {chain!r}")
    lim = _clamp(limit)
    page = await chain_views.fetch_page(
        chain, offset=max(0, int(offset)), limit=lim, category=category
    )
    return schema.page(
        [schema.agent_summary(d) for d in page.get("agents") or []],
        total=page.get("total"), limit=lim, offset=max(0, int(offset)),
    )


async def get_agent(*, chain_id: int, token_id: str) -> dict | None:
    """One agent, with its evaluation signals. This is the valuable call.

    Signals are resolved per chain rather than per agent because availability
    is a property of the chain: whether an explorer covers it, whether the
    subgraph indexes it, whether the escrow exists there. An agent-level
    override would imply a precision the underlying data does not have."""
    doc = await chain_views.fetch_agent(int(chain_id), str(token_id))
    if not doc:
        return None
    caps = summarize_view_capabilities([int(chain_id)])
    return schema.agent_detail(
        doc, caps.get("signals") or [], hire=doc.get("hire_paths")
    )


async def chain_capabilities(*, chain: str) -> dict | None:
    """What one chain can answer, signal by signal, with reasons for absences."""
    v = chain_views.get_view(chain)
    if not v:
        return None
    ids = v.get("chain_ids") or []  # get_view returns the raw VIEWS entry
    caps = summarize_view_capabilities(ids)
    sigs = caps.get("signals") or []
    return {
        "chain": chain,
        "label": v.get("label"),
        "signals": [schema.signal(s) for s in sigs],
        "available": sum(1 for s in sigs if s.get("available")),
        "total": len(sigs),
    }


async def list_categories(*, chain: str) -> list[dict]:
    """Categories on one chain with counts, for building a filter."""
    if chain not in known_chains():
        raise LookupError(f"unknown chain {chain!r}")
    return [
        {"category": c.get("category"), "count": c.get("count")}
        for c in await chain_views.category_facets(chain)
    ]
