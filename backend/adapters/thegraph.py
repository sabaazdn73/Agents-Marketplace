"""
thegraph.py

The Graph adapter for the Agent0 ERC-8004 subgraphs, built 2026-09-04 for
ETHGlobal Online.

Why this exists, concretely rather than as a nice-to-have: this project's
ingestion had 361 offsets stuck in a permanent retry loop against
8004scan, whose deep-offset pagination returns 500s and timeouts. Checked
live before writing any of this: offsets 700,000 / 806,000 / 808,000 all
ReadTimeout, while offset 0 returns in about a second. That is not a
transient blip, it is a hard ceiling on how much of the registry this
project can see through that source.

The Agent0 subgraph indexes the same on-chain ERC-8004 registries and has
no such ceiling. Measured against the live BSC endpoint, it returned
2,399 agents that sit above our stored maximum in 1.5 seconds across
three paginated queries. Those are agents the existing pipeline cannot
reach at any speed.

What this is NOT: a replacement for 8004scan. The comparison was run
before wiring anything in, and the two sources carry different data.
8004scan supplies total_score, star_count, its Quality Center assessment,
category, image_url and owner ENS/username. All of that is computed
off-chain, so a subgraph indexing on-chain registries cannot have it, and
our stored BSC set has 100% coverage of score and category from it. The
Graph supplies chain truth: current agent IDs, owner, registration file
contents with structured endpoints (MCP, A2A, web, OASF), x402 support,
and feedback with its on-chain provenance. This adapter is therefore a
coverage fallback and a corroboration source, not a migration.

One measured limitation worth stating up front so nobody builds on a
false assumption: only 1.7% of sampled BSC registration files carry any
endpoint at all (mcp 0.4%, a2a 1.2%, web 0.7%). This source cannot drive
`service_status`; core/agent_health.py's live probe remains the only
thing that can answer whether an endpoint actually responds.

The Validation Registry is queryable here and is genuinely unused on BSC:
`validations` and `validationPoints` both return empty. It is exposed by
this adapter anyway because the capability is real and other chains may
populate it, but nothing in this project treats an empty result as a
signal.
"""

from __future__ import annotations

import os

import httpx

GATEWAY = "https://gateway.thegraph.com/api"

# Agent0 subgraph IDs, from thegraph.com/docs/en/subgraphs/guides/agent0/.
# BSC is the one that matters here: it is the only chain this marketplace
# actually displays. The others are listed because full_registry_ingest.py
# already stores data for those chains, so the same fallback can extend to
# them without hunting for IDs later.
SUBGRAPH_IDS = {
    56: "D6aWqowLkWqBgcqmpNKXuNikPkob24ADXCciiP8Hvn1K",   # BNB Smart Chain
}

BSC_CHAIN_ID = 56

# The gateway rejects requests carrying Python's default urllib
# User-Agent with a 403 (confirmed live: identical query, 403 from urllib,
# 200 from httpx and curl). httpx sends its own UA and works, which is
# also what the rest of this backend uses.
_TIMEOUT = 45.0

# The Graph caps `first` at 1000 per query. Pagination is by `agentId_gt`
# rather than `skip`, deliberately: skip is capped at 5000 on the gateway,
# so a cursor is the only way to walk a registry with 330k+ entries.
PAGE_SIZE = 1000


class TheGraphError(RuntimeError):
    """A real failure talking to the subgraph, kept distinct so callers can
    fall back to 8004scan rather than treating it as a fatal error."""


def _api_key() -> str:
    key = os.environ.get("THEGRAPH_API_KEY")
    if not key:
        raise TheGraphError("THEGRAPH_API_KEY is not configured.")
    return key


def endpoint_for(chain_id: int = BSC_CHAIN_ID) -> str:
    sid = SUBGRAPH_IDS.get(chain_id)
    if not sid:
        raise TheGraphError(f"No Agent0 subgraph ID on record for chain {chain_id}.")
    return f"{GATEWAY}/{_api_key()}/subgraphs/id/{sid}"


async def query(
    client: httpx.AsyncClient, gql: str, *, chain_id: int = BSC_CHAIN_ID,
) -> dict:
    """One real GraphQL query. Raises TheGraphError on any failure so a
    caller can decide to fall back rather than crash a batch."""
    try:
        resp = await client.post(endpoint_for(chain_id), json={"query": gql}, timeout=_TIMEOUT)
    except (httpx.TimeoutException, httpx.TransportError) as e:
        raise TheGraphError(f"subgraph unreachable: {type(e).__name__}: {e}") from e

    if resp.status_code != 200:
        raise TheGraphError(f"subgraph HTTP {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    if body.get("errors"):
        raise TheGraphError(f"subgraph query errors: {body['errors']}")
    return body.get("data") or {}


async def get_health(client: httpx.AsyncClient, chain_id: int = BSC_CHAIN_ID) -> dict:
    """Real indexing head. Used as this integration's readiness check and
    surfaced on the status page, so a stalled subgraph is visible rather
    than silently serving stale data."""
    d = await query(client, "{ _meta { block { number } deployment hasIndexingErrors } }", chain_id=chain_id)
    meta = d.get("_meta") or {}
    return {
        "block": (meta.get("block") or {}).get("number"),
        "deployment": meta.get("deployment"),
        "has_indexing_errors": meta.get("hasIndexingErrors"),
    }


_AGENT_FIELDS = """
    agentId
    owner
    agentWallet
    agentURI
    createdAt
    totalFeedback
    registrationFile {
      name
      description
      image
      active
      x402Support
      mcpEndpoint
      a2aEndpoint
      webEndpoint
      oasfEndpoint
      oasfSkills
      oasfDomains
      ens
    }
"""


async def fetch_agents_after(
    client: httpx.AsyncClient, after_agent_id: int, *, limit: int = PAGE_SIZE,
    chain_id: int = BSC_CHAIN_ID,
) -> list[dict]:
    """Real agents with agentId strictly greater than `after_agent_id`,
    ascending. This is the shape the coverage gap actually needs: the
    pipeline knows the highest agent it has stored, and 8004scan cannot
    paginate deep enough to reach past it."""
    gql = """{ agents(first: %d, orderBy: agentId, orderDirection: asc, where: {agentId_gt: "%d"}) { %s } }""" % (
        min(limit, PAGE_SIZE), after_agent_id, _AGENT_FIELDS,
    )
    return (await query(client, gql, chain_id=chain_id)).get("agents") or []


async def fetch_agent(
    client: httpx.AsyncClient, agent_id: int, chain_id: int = BSC_CHAIN_ID,
) -> dict | None:
    """One agent by its real on-chain id, or None if the subgraph has never
    seen it."""
    gql = """{ agents(first: 1, where: {agentId: "%d"}) { %s } }""" % (agent_id, _AGENT_FIELDS)
    items = (await query(client, gql, chain_id=chain_id)).get("agents") or []
    return items[0] if items else None


async def fetch_agent_feedback(
    client: httpx.AsyncClient, agent_id: int, *, limit: int = 100,
    chain_id: int = BSC_CHAIN_ID,
) -> list[dict]:
    """Real Reputation Registry entries for one agent, straight from chain.

    Worth knowing before using this for anything user-facing: an earlier
    investigation in this project established that ERC-8004 feedback on
    BSC carries no review text and no star rating, and that 96% of it
    comes from one automated cluster. The subgraph confirms the same shape
    (a numeric `value` plus two tags, no comment field in the schema at
    all). What it adds over 8004scan's aggregate count is provenance:
    who left it (`clientAddress`) and whether it was later revoked."""
    gql = """{ feedbacks(first: %d, orderBy: createdAt, orderDirection: desc,
        where: {agent_: {agentId: "%d"}}) {
        value tag1 tag2 clientAddress isRevoked createdAt feedbackIndex
    } }""" % (min(limit, PAGE_SIZE), agent_id)
    return (await query(client, gql, chain_id=chain_id)).get("feedbacks") or []


async def fetch_agent_validations(
    client: httpx.AsyncClient, agent_id: int, chain_id: int = BSC_CHAIN_ID,
) -> list[dict]:
    """Real Validation Registry entries for one agent.

    Confirmed empty across all of BSC at the time of writing (both
    `validations` and `validationPoints` return nothing), so this will
    almost certainly return []. Exposed because the capability is real and
    the registry may be used later. Callers must treat [] as "no data",
    never as a negative signal about the agent."""
    gql = """{ validations(first: 100, where: {agent_: {agentId: "%d"}}) {
        validatorAddress response status tag createdAt
    } }""" % agent_id
    return (await query(client, gql, chain_id=chain_id)).get("validations") or []


def to_registry_doc(agent: dict, chain_id: int = BSC_CHAIN_ID) -> dict:
    """Map a subgraph agent onto the exact document shape
    full_agent_registry already stores, so ingested rows are
    indistinguishable from 8004scan-sourced ones downstream.

    Deliberately writes ONLY fields the subgraph genuinely knows. It does
    not invent total_score, star_count, category or image_url: those are
    8004scan's off-chain computations, and the ingestion path uses $set,
    so leaving them out means a later 8004scan pass fills them in rather
    than this source overwriting them with nulls.

    `source` is stamped so the origin of any row stays auditable."""
    rf = agent.get("registrationFile") or {}
    endpoint = rf.get("mcpEndpoint") or rf.get("a2aEndpoint") or rf.get("webEndpoint") or ""
    doc = {
        "id": f"thegraph:{chain_id}:{agent.get('agentId')}",
        "chain_id": chain_id,
        "token_id": str(agent.get("agentId")),
        "owner_address": (agent.get("owner") or "").lower() or None,
        "source": "thegraph:agent0",
    }
    if rf.get("name"):
        doc["name"] = rf["name"]
    if rf.get("description"):
        doc["description"] = rf["description"]
    if rf.get("image"):
        doc["image_url"] = rf["image"]
    if rf.get("x402Support") is not None:
        doc["x402_supported"] = bool(rf["x402Support"])
    if endpoint:
        doc["service_endpoint"] = endpoint
    if agent.get("createdAt"):
        doc["created_at_unix"] = int(agent["createdAt"])
    if agent.get("totalFeedback") is not None:
        doc["total_feedbacks"] = int(agent["totalFeedback"])
    # Structured protocol endpoints. 8004scan exposes none of these
    # separately, and protocol_compat.py already reasons about which
    # protocols an agent speaks, so these are genuinely new inputs rather
    # than a second copy of something already stored.
    protocols = [k for k, v in (
        ("mcp", rf.get("mcpEndpoint")), ("a2a", rf.get("a2aEndpoint")),
        ("oasf", rf.get("oasfEndpoint")),
    ) if v]
    if protocols:
        doc["supported_protocols"] = protocols
    return doc
