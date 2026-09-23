"""
liveness_probe.py

Does an agent this project calls unchecked or unproven actually answer.

WHY THIS EXISTS
On 2026-09-23 the responding tier fell from 652 to 529 across one day and the
question was whether the agents had gone down or our measurement had. It was
settled by probing a sample of them directly, outside the health pipeline, and
finding that essentially all of them answered on the first request. Two separate
investigations reached that answer the same day and neither could be reproduced
afterwards: both ran from scratch scripts in temporary directories, against a
store that rotates daily, so within a day neither was checkable by anybody,
including the people who ran them.

That is the gap this closes. The probe that settles attribution was the one
piece of evidence in the whole investigation with no home in the repository.

WHAT IT DOES, AND WHY IT DOES NOT USE THE PIPELINE
It reads tokenURI straight off the identity registry, resolves the metadata,
and probes the endpoint, all without calling core/agent_health.py. That is the
point: a check that calls the same code the site calls proves only that the code
agrees with itself, which is the rule core/monitors/reconcile.py already states
and the reason this file sits beside it.

It never writes to known_agents or full_agent_registry. It reads them, probes
third-party endpoints, and records its own counts in its own collection.

THE GATEWAY IS NOT ipfs.io, DELIBERATELY
ipfs.io was measured returning 429 with retry-after 900 on the first request
from two unrelated networks on 2026-09-23, and dweb.link returned 429 too, being
the same operator. Resolving through the gateway the pipeline uses would make
this monitor fail in exactly the circumstance it exists to diagnose, and it
would report the agents as unreachable when the gateway is what turned us away.

WHY THE RESULT IS A FUNNEL AND NOT A RATIO
A bare "298 of 298 answered" invites the question it cannot answer: how many
were dropped before the probe, and were the hard cases among them. So every
stage is counted and reported, and the loss at each one is visible. A sample
that resolves 178 of 400 and then answers 178 of 178 is a much weaker sentence
than one that resolves 397 of 400, and the funnel is what makes the difference
legible instead of hidden in a denominator.

WHY THERE IS A CONTROL
Sampling agents we already believe are responding and probing them the same way
is what shows the method is neither lenient nor broken. Without it this can only
produce reassuring numbers: a probe that answers yes to everything looks
identical to a working probe when every agent is in fact up. If the control
falls below its floor, the run says the method is suspect rather than reporting
a headline it has not earned.

WHAT HAS ACTUALLY RUN, AS OF 2026-09-23
Stated because a path that has never executed is a path that will fail the first
time it matters, and that is worth knowing before rather than after.

  RUN against live agents: _read_tokenuri, _resolve_endpoint, _probe and
    _run_funnel, over 200 agents on BSC. Funnel: 120 drawn, 120 tokenURI read,
    119 resolved, 119 probed, 119 answered, one lost to an HTTP error from an
    agent's own metadata host; control 80 of 80.
  RUN against production by a second reviewer: _sample. The 60,000-row read is
    affordable on the live collection and the seeded draw is deterministic for a
    fixed store.
  RUN as a deliberate failure injection: the control gate. Forcing IPFS_GATEWAY
    to ipfs.io destroyed 16 of 40 control agents at the resolve stage. Over
    `probed` the control rate stayed at 1.0 and published the headline; over
    `drawn` it is 0.6 and the floor fires. That is why the denominator is drawn.

THE SEED DOES NOT MAKE A RUN REPRODUCIBLE ON ITS OWN
It pins the shuffle, not the population. _sample draws from a live collection
that rotates, so two runs hours apart draw different agents and their funnels
are not comparable: one pair of runs held drawn at 120 and tokenURI read at 120
while the resolve stage moved from 119 to 81, which reads as a regression and is
a different sample. Every run therefore records `drawn_ids`, so a later run can
re-probe that exact cohort instead of drawing a fresh one. Comparing two funnels
without comparing their id lists is comparing two different questions.

WHY core.db IS IMPORTED INSIDE FUNCTIONS AND NOT AT THE TOP
Deliberate, and please do not tidy it back. A top-level `from core.db import
get_db` pulls in the Mongo driver at import time, which made this module
unimportable on a machine where that driver was broken, and so made the probe
stages untestable for a reason that has nothing to do with probing. The stages
above were only exercisable because the import is lazy. core/agent_health.py
does the same thing for the same reason.
"""

from __future__ import annotations

import asyncio
import base64
import json
import random
import time

import httpx

# core.db is imported inside the functions that need it, not here, so this
# module can be imported and its probe stages exercised without a database
# driver present. core/agent_health.py does the same thing for the same
# reason. It also means a broken database import cannot stop somebody reading
# or testing the part of this file that talks to agents.

# The registry is deployed at this address on every EVM chain this project
# reads, verified by comparing runtime bytecode rather than by assuming.
IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
_TOKENURI_SELECTOR = "0xc87b56dd"

# Not ipfs.io and not dweb.link. See the module docstring.
IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/"

# Fixed so two people running this on different days sample the same agents
# from the same store state and can compare funnels rather than guessing
# whether they disagreed or merely drew differently. Overridable per run, and
# the value used is recorded with the result.
DEFAULT_SEED = 20260923
DEFAULT_SAMPLE = 120
DEFAULT_CONTROL = 80

# Mirrors agent_health.py's own two attempts, so a difference in outcome is a
# difference in what was reached and not in how patiently it was asked.
PROBE_TIMEOUTS = (4.0, 35.0)
RESOLVE_TIMEOUT = 20.0
CONCURRENCY = 12

# What share of the control must answer, COUNTED OVER AGENTS DRAWN, for the run
# to trust itself. The control is drawn from agents already recorded responding,
# so a low figure means the method is broken, the gateway is refusing us, or
# those verdicts are badly stale, and none of the three leaves the headline
# worth publishing.
#
# The denominator is the load-bearing part: see the comment in
# run_liveness_probe. Over `probed` this gate is invariant under every
# pre-probe failure and was demonstrated not to fire during a total gateway
# outage.
#
# Control runs on 2026-09-23 answered 80 of 80 drawn and 397 of 397 drawn, so
# this floor sits far below what a working probe produces and is meant to catch
# a broken one rather than a noisy one.
CONTROL_FLOOR = 0.80

RESULT_COLLECTION = "liveness_probe_runs"


def _tokenuri_calldata(token_id: int) -> str:
    return _TOKENURI_SELECTOR + format(int(token_id), "064x")


def _decode_string(hex_result: str) -> str:
    """ABI-decode a single returned string. Empty for a revert or empty value."""
    if not hex_result or hex_result == "0x":
        return ""
    raw = bytes.fromhex(hex_result[2:])
    if len(raw) < 64:
        return ""
    length = int.from_bytes(raw[32:64], "big")
    return raw[64:64 + length].decode("utf-8", "replace")


async def _read_tokenuri(client: httpx.AsyncClient, chain_id: int,
                         token_id: int) -> str:
    from core.rpc import chain_rpc_post
    resp = await chain_rpc_post(client, chain_id, {
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": IDENTITY_REGISTRY,
                    "data": _tokenuri_calldata(token_id)}, "latest"],
    })
    resp.raise_for_status()
    body = resp.json()
    if body.get("error"):
        raise RuntimeError(str(body["error"])[:120])
    return _decode_string(body.get("result") or "")


async def _resolve_endpoint(client: httpx.AsyncClient, uri: str) -> str | None:
    """The first usable http endpoint in an agent's metadata, or None.

    A URL still carrying an unsubstituted {agentId} placeholder is rejected
    rather than probed, matching agent_health.py: it can never resolve to
    anything, so treating it as an endpoint would count a registration mistake
    as a live service.
    """
    if not uri:
        return None
    if uri.startswith("data:application/json;base64,"):
        data = json.loads(base64.b64decode(uri.split(",", 1)[1]))
    elif uri.startswith("data:"):
        data = json.loads(uri.split(",", 1)[1])
    elif uri.startswith("ipfs://"):
        r = await client.get(IPFS_GATEWAY + uri[len("ipfs://"):],
                             timeout=RESOLVE_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    elif uri.startswith(("http://", "https://")):
        r = await client.get(uri, timeout=RESOLVE_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    elif uri.lstrip()[:1] in "{[":
        data = json.loads(uri)
    else:
        raise ValueError(f"unrecognised URI scheme: {uri[:40]}")

    for service in (data.get("services") or []):
        endpoint = (service or {}).get("endpoint")
        if (isinstance(endpoint, str)
                and endpoint.startswith(("http://", "https://"))
                and "{" not in endpoint and "}" not in endpoint):
            return endpoint
    return None


async def _probe(client: httpx.AsyncClient, endpoint: str) -> tuple[bool, str]:
    """Did anything answer. Any HTTP status counts, including 4xx and 5xx:
    the question is whether a process is listening, not whether every route is
    correct, which is the same bar agent_health.py uses."""
    last = ""
    for timeout in PROBE_TIMEOUTS:
        try:
            r = await client.get(endpoint, timeout=timeout,
                                 follow_redirects=True)
            return True, str(r.status_code)
        except httpx.HTTPStatusError as e:
            return True, str(e.response.status_code)
        except Exception as e:  # noqa: BLE001
            last = type(e).__name__
    return False, last


async def _run_funnel(agents: list[dict], label: str) -> dict:
    """Probe one cohort and report every stage, plus the ids drawn.

    WHY no_endpoint IS A FINDING HERE AND NOT A LOSS
    An agent whose metadata resolves cleanly and carries no http endpoint has
    been REACHED: we asked the question and the answer is that its registration
    publishes nothing to call. That is `no_endpoint`, which agents_index.py
    lists in PROBED_STATUSES as a finding about the agent. The first version of
    this file counted it as a pre-probe loss and dropped it from the
    denominator, so the same condition was reached-and-found-nothing in one file
    and never-reached in the other, inside the one change set whose entire
    subject is that distinction. agents_index is the one that is right, so this
    follows it: a resolved registration with no endpoint is counted, under its
    own name, and only failures to RESOLVE are losses.

    WHY THE IDS ARE RETURNED
    The seed pins the shuffle, not the population: _sample draws from a live
    collection that rotates, so the same seed hours later draws different
    agents and the funnels are not comparable. An independent run reproduced
    drawn 120 and tokenuri_read 120 while resolve moved from 119 to 81, which
    looks like a regression and is a different sample. Recording the ids lets a
    later run re-probe the same agents instead of drawing fresh ones.
    """
    stages = {
        "drawn": len(agents),
        "tokenuri_read": 0,
        "metadata_resolved": 0,
        # Split out of what used to be one "resolved_to_endpoint" number, so a
        # registration with nothing to call is visible rather than absorbed.
        "endpoint_registered": 0,
        "no_endpoint_registered": 0,
        "probed": 0,
        "answered": 0,
    }
    losses: dict[str, int] = {}
    semaphore = asyncio.Semaphore(CONCURRENCY)

    def lose(stage: str, why: str) -> None:
        losses[f"{stage}:{why}"] = losses.get(f"{stage}:{why}", 0) + 1

    async with httpx.AsyncClient(timeout=40) as client:
        async def one(agent: dict) -> None:
            async with semaphore:
                try:
                    uri = await _read_tokenuri(
                        client, int(agent.get("chain_id") or 56),
                        int(agent["token_id"]))
                except Exception as e:  # noqa: BLE001
                    lose("tokenuri", type(e).__name__)
                    return
                stages["tokenuri_read"] += 1

                try:
                    endpoint = await _resolve_endpoint(client, uri)
                except Exception as e:  # noqa: BLE001
                    lose("resolve", type(e).__name__)
                    return
                stages["metadata_resolved"] += 1
                if not endpoint:
                    # Reached, and the finding is that there is nothing to call.
                    stages["no_endpoint_registered"] += 1
                    return
                stages["endpoint_registered"] += 1

                stages["probed"] += 1
                answered, detail = await _probe(client, endpoint)
                if answered:
                    stages["answered"] += 1
                else:
                    lose("probe", detail)

        await asyncio.gather(*(one(a) for a in agents if a.get("token_id")))

    return {
        "cohort": label,
        "stages": stages,
        "losses": losses,
        # So a later run can re-probe this exact cohort. See the docstring.
        "drawn_ids": [str(a.get("_id") or a.get("id")) for a in agents],
    }


def _rates(stages: dict) -> dict:
    """Both denominators, named, for one cohort.

    The pair exists for the reason liveness_coverage's pair exists, and this
    file shipped without it after getting it right there two hours earlier.

    `answered / probed` is invariant under every pre-probe failure, because
    anything lost before the probe leaves BOTH terms. It was 79 of 81, which is
    97.5%, on a run where 120 were drawn: the flattering half, and the half a
    reader quotes. `answered / drawn` is the one that moves when our own
    resolution fails, so it is the conservative figure and it carries the
    finding.
    """
    drawn = stages.get("drawn") or 0
    probed = stages.get("probed") or 0
    answered = stages.get("answered") or 0
    return {
        # Of the agents we got to probe, how many answered. The agent's side.
        "response_rate_of_probed": (
            round(answered / probed, 4) if probed else None),
        # Of the agents we drew, how many we could establish anything about.
        # A shortfall here is OURS: a gateway turning us away, not an agent
        # failing to answer.
        "answered_rate_of_drawn": (
            round(answered / drawn, 4) if drawn else None),
        "reach_rate_of_drawn": (
            round((stages.get("metadata_resolved") or 0) / drawn, 4)
            if drawn else None),
        "reach_failure_is_ours": True,
    }


async def _sample(collection, query: dict, n: int, seed: int) -> list[dict]:
    """A deterministic sample given the same store state.

    Not $sample, which is not seedable: the ids are sorted and drawn with a
    seeded PRNG so two runs against the same store draw the same agents. The
    store rotates daily, so this makes a run reproducible for as long as the
    store holds still, and the run records its seed either way.
    """
    rows = await collection.find(
        query, {"_id": 1, "token_id": 1, "chain_id": 1,
                "owner_address": 1, "service_status": 1},
    ).limit(60_000).to_list(length=60_000)
    rows = [r for r in rows if r.get("token_id") not in (None, "", "None")]
    rows.sort(key=lambda r: str(r.get("_id")))
    if len(rows) <= n:
        return rows
    return random.Random(seed).sample(rows, n)


async def run_liveness_probe(sample_size: int = DEFAULT_SAMPLE,
                             control_size: int = DEFAULT_CONTROL,
                             seed: int = DEFAULT_SEED,
                             store: bool = True) -> dict:
    """One bounded run: a sample of unchecked agents, plus a control.

    Reads known_agents and probes third-party endpoints. Writes only its own
    result document, and only to RESULT_COLLECTION.
    """
    started = time.time()
    from core.db import get_db
    db = get_db()
    agents = db.known_agents

    # The population the published tier calls unchecked: no stored health state
    # at all, or `unknown`, which is our own resolution failure rather than a
    # finding about the agent.
    unchecked_query = {"$or": [{"service_status": None},
                               {"service_status": {"$exists": False}},
                               {"service_status": "unknown"}]}
    subject = await _sample(agents, unchecked_query, sample_size, seed)
    control = await _sample(agents, {"service_status": "responding"},
                            control_size, seed)

    subject_result = await _run_funnel(subject, "unchecked")
    control_result = await _run_funnel(control, "control_responding")

    c = control_result["stages"]
    s = subject_result["stages"]

    # THE CONTROL RATE IS OVER DRAWN, NOT OVER PROBED, AND THAT IS THE WHOLE
    # POINT OF IT.
    #
    # The first version divided answered by probed. Every pre-probe failure
    # leaves BOTH terms, so that rate is invariant under exactly the condition
    # the control exists to detect. Tested rather than reasoned about: forcing
    # IPFS_GATEWAY to ipfs.io, which answers 429, destroyed 17 of 40 control
    # agents at the resolve stage and the control rate stayed at 1.0 with the
    # headline published and no withheld reason. The guard reproduced the defect
    # it was built to catch.
    #
    # Over drawn, that same forced failure is 23 of 40, which is 57.5%, and the
    # floor fires. A control cohort is agents we already recorded as responding,
    # so if we cannot even get to them the run has learned nothing about
    # anything, and that has to stop the headline rather than be visible only to
    # somebody who reads the loss lines.
    control_rate = (c["answered"] / c["drawn"]) if c["drawn"] else None

    result = {
        "ran_at": started,
        "took_seconds": round(time.time() - started, 1),
        "seed": seed,
        "gateway": IPFS_GATEWAY,
        "subject": subject_result,
        "subject_rates": _rates(s),
        "control": control_result,
        "control_rates": _rates(c),
        "control_answer_rate": (round(control_rate, 4)
                                if control_rate is not None else None),
        "control_rate_denominator": "drawn",
        "control_floor": CONTROL_FLOOR,
        # The headline is reported only when the control says the method works.
        # Otherwise the run says so instead of publishing a number it cannot
        # stand behind, which is the same rule reconcile.py follows: a check
        # that could not run returns unknown, never ok.
        "method_trusted": (control_rate is not None
                           and control_rate >= CONTROL_FLOOR),
    }
    if not result["method_trusted"]:
        result["withheld_reason"] = {
            "code": "control_below_floor",
            "detail": (
                f"the control cohort, drawn from agents already recorded "
                f"responding, answered for "
                f"{'none of' if control_rate is None else format(control_rate, '.1%') + ' of'} "
                f"the {c['drawn']} drawn, against a floor of {CONTROL_FLOOR:.0%}. "
                f"Counted over agents DRAWN rather than agents probed, so a "
                f"failure to resolve their metadata counts against the run "
                f"instead of vanishing from both terms. Either this probe is "
                f"broken, the gateway is refusing us, or those stored verdicts "
                f"are stale, and the subject figure is not reported until which "
                f"one is known."),
        }
    else:
        # Both denominators, never one. The bare over-probed figure was 79 of
        # 81 on a run that drew 120, and it is the number a reader quotes.
        result["headline"] = {
            "answered_of_drawn": f"{s['answered']} of {s['drawn']}",
            "answered_of_probed": f"{s['answered']} of {s['probed']}",
            "note": ("the over-drawn figure is the conservative one and the one "
                     "that moves when our own resolution fails; the over-probed "
                     "figure describes only the agents we got to"),
        }

    if store:
        try:
            await db[RESULT_COLLECTION].insert_one(dict(result))
        except Exception as e:  # noqa: BLE001
            print(f"[liveness_probe] result not stored "
                  f"({type(e).__name__}: {e}); the run itself stands",
                  flush=True)
    return result


async def recent_runs(limit: int = 10) -> list[dict]:
    """Past runs, newest first, so a funnel can be compared against a funnel
    rather than against somebody's memory of one."""
    from core.db import get_db
    db = get_db()
    return await db[RESULT_COLLECTION].find(
        {}, {"_id": 0}).sort("ran_at", -1).limit(limit).to_list(length=limit)


def format_funnel(result: dict) -> str:
    """The run as a person reads it. Every stage, so the loss is visible, and
    both denominators, so the flattering one cannot travel alone."""
    lines = [f"liveness probe, seed {result.get('seed')}, "
             f"{result.get('took_seconds')}s, gateway {result.get('gateway')}"]
    for cohort, rates_key in (("subject", "subject_rates"),
                              ("control", "control_rates")):
        block = result.get(cohort) or {}
        stages = block.get("stages") or {}
        lines.append(f"  {block.get('cohort', cohort)}:")
        for stage in ("drawn", "tokenuri_read", "metadata_resolved",
                      "endpoint_registered", "no_endpoint_registered",
                      "probed", "answered"):
            lines.append(f"      {stage:24} {stages.get(stage, 0)}")
        for why, n in sorted((block.get("losses") or {}).items()):
            lines.append(f"      lost {why:28} {n}")
        r = result.get(rates_key) or {}
        lines.append(f"      rate over drawn  {r.get('answered_rate_of_drawn')}"
                     f"   over probed {r.get('response_rate_of_probed')}")
    lines.append(f"  control rate ({result.get('control_rate_denominator')}): "
                 f"{result.get('control_answer_rate')} "
                 f"floor {result.get('control_floor')}")
    if result.get("method_trusted"):
        h = result.get("headline") or {}
        lines.append(f"  answered of drawn:  {h.get('answered_of_drawn')}")
        lines.append(f"  answered of probed: {h.get('answered_of_probed')}")
    else:
        reason = result.get("withheld_reason") or {}
        lines.append(f"  WITHHELD [{reason.get('code')}]: {reason.get('detail')}")
    return "\n".join(lines)
