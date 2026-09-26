# budget_index.py
#
# The delivery record for chains that have no ERC-8183.
#
# BNB Chain shows a delivery rate built from ERC-8183 jobs: funded versus
# delivered, with the count and the age of anything stuck. Arbitrum and
# Robinhood Chain have no ERC-8183 and never will, because that contract is
# Altana's and is deployed on BNB Chain only. They showed nothing at all,
# which read as "no information exists" when in fact the same information
# does exist in a different contract.
#
# A budget funded and never drawn from is a client who committed money and
# got nothing, which is the same fact an undelivered ERC-8183 job records.
# This module reads that fact.
#
#
# WHY THIS READS EVENTS AND NOT `spent`
#
# The obvious implementation is to enumerate budgets from contract state
# (budgetCounter is public, ids are sequential from 1, getBudget is a view)
# and treat `spent > 0` as "the agent drew". That is wrong, and it is wrong
# in the direction that invents a delivery that never happened.
#
# AgentBudgetEscrow.reclaim does this before paying the client back:
#
#     b.spent = b.total;
#     b.status = Status.RECLAIMED;
#
# It marks the whole budget spent so a re-entering token cannot reclaim
# twice. That is correct for the contract and fatal for this reading: after
# a reclaim, `spent == total` whether the agent drew everything or nothing.
#
# This is not hypothetical. Checked on chain on 2026-09-11, the single
# Robinhood Chain budget reads total 7e12, spent 7e12, status RECLAIMED.
# Read from state it looks like an agent that drew its entire budget. There
# are zero Drawn events for it. The agent drew nothing and the client took
# the money back.
#
# So `spent` is only truthful while status is OPEN or CLOSED, and the
# ambiguous case is the common one: 3 of the 5 budgets that exist are
# RECLAIMED. The Drawn event is the only source that cannot be overwritten,
# so the Drawn event is what this reads.
#
#
# WHERE THE SCAN STARTS
#
# From the block that opened budget #1 on each chain. Ids are sequential
# from 1, so no budget can exist before the block that opened the first one,
# which makes this an exact floor rather than a guess at a deploy block.
# Confirmed by scanning each chain and finding budget #1 at these blocks.
#
# A cursor is persisted per chain, so the long first scan happens once and
# later runs cover only new blocks.
#
#
# WHY A DRAW IS STORED BY ITS EVENT ID (2026-09-25)
#
# Draws used to be counted with `$inc: {draws: 1}`. That is only correct if no
# block is ever read twice, so the cursor could only advance after the whole
# range from cursor to head had been read, in one pass. On BSC, from a single
# endpoint, that became hundreds of requests where any one failure threw the
# whole pass away, and the index stopped moving on 2026-09-15.
#
# Each Drawn event is now recorded by `txHash:logIndex` in the budget's
# `draw_ids`, and `draws` is incremented only by the same update that adds a
# new id. A page read twice adds nothing the second time, so the cursor can
# advance after every page and a failure keeps every page before it.
#
# Documents written before this change hold a count and no ids. Their count
# is kept as `legacy_draws`, and the block the cursor stood at when they were
# migrated is kept as `legacy_before_block` on the chain's progress document:
# every draw below that block is already inside some budget's legacy count,
# and every draw at or above it is counted by id. So, per budget, always
#
#     draws == legacy_draws + len(draw_ids)
#
# and the readers, which only ask whether `draws > 0`, need no change. A
# Drawn event below the legacy block is skipped rather than recorded, because
# recording it would count it twice. That only happens if someone moves the
# cursor back by hand. To rebuild a chain purely from chain events instead,
# delete its documents and its progress document together; with no legacy
# documents there is no legacy block, and every draw is counted by id.
#
# `draw_ids` grows by one entry of about 70 bytes per draw and is not capped.
# At Mongo's 16 MB document limit that is over 200,000 draws on one budget;
# the busiest budget on 2026-09-26 had one. If a budget ever approaches
# thousands of draws, the ids belong in their own collection keyed uniquely
# on (chain_id, event id).
#
#
# WHO IS ASKED, ON BSC (2026-09-26)
#
# bloXroute (or BSC_MAINNET_RPC_URL), then QuickNode's BSC endpoint while its
# trial lasts, then any public endpoints in BSC_FALLBACK_RPC_URLS. When the
# trial ends QuickNode answers 401; the first 401 switches it off for the
# rest of the process, with one log line, and the order becomes bloXroute
# then the public list. A 403 switches it off for the current pass only (see
# _QUICKNODE_DISABLED). Every endpoint still has to pass the
# known-log control before its empty pages count. A public endpoint is a pool
# of nodes behind one URL, so for those the control is asked again on every
# empty page they return rather than once per pass: a control that reached an
# archive node says nothing about the pruned node that answered the page.
# The known-log block is budget #1's, so this still proves depth only at the
# oldest block, not at the page; docs/deferred.md entry 14 has the rest.
# The public list is empty by default: no free endpoint measured on
# 2026-09-26 passed. See _chain_urls and DEFAULT_BSC_PUBLIC_FALLBACKS.

from __future__ import annotations

import asyncio
import contextvars
import os
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from core import quicknode, rpc_credits
from core.rpc import get_chain_rpc_url, get_chain_fallback_rpc_url
from core.safe_errors import JsonRpcError, describe, redact

# keccak("Drawn(uint256,address,uint256,uint256,uint256,uint256,bytes32)")
DRAWN_TOPIC = "0x857eef7b9debffbe023f8d5f0d03d0e4f26b954deeef5d68ef6c5ebe33a5aae3"
# keccak("BudgetOpened(uint256,address,address,address,uint256,uint256,uint64,uint64)")
OPENED_TOPIC = "0x3aba8d716ec2c8a56e018967b6db59e71c926d3cbfcfa54050e0889536113e93"

# Must stay in step with frontend/src/chainContracts.js. Note that the same
# address is AgentAccessMarket on BSC, which is why this is keyed by chain and
# why 56 has a different entry rather than reusing the other three.
ESCROW_ADDRESS = {
    56: "0x4728f03693DDABbe50E79c7BfFCb930e522D585B",
    1: "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333",
    42161: "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333",
    4663: "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333",
}

# The block of BudgetOpened for budget #1 on each chain, read from chain
# 2026-09-11. An exact floor, not an estimate: see the note above.
# Ethereum has no budget #1 yet, so its floor is the contract's own creation
# block (25957217, tx 0x5e2d3149..., creator 0x48cE74cd...), read from
# Etherscan rather than guessed. No log can predate the contract, so this is
# an exact floor by construction, the same guarantee the other three get from
# budget #1's block.
FIRST_BUDGET_BLOCK = {56: 120311961, 1: 25957217, 42161: 503840279, 4663: 59515146}

# eth_getLogs page size. BSC's endpoints cap the range at 5,000 blocks and
# reject anything wider outright rather than truncating, so the page size is
# per chain and BSC's sits under its cap.
LOG_PAGE_BLOCKS = {56: 4_900, 42161: 40_000, 4663: 40_000}
DEFAULT_PAGE_BLOCKS = 10_000

COLLECTION = "budget_index"
PROGRESS_COLLECTION = "budget_index_progress"

# How many page windows one refresh may read before it stops and waits for
# the next pass. Each window is two eth_getLogs calls (one per topic) on the
# first endpoint that gives a trusted answer. Control probes are separate: at
# most two per endpoint per pass (the probe and its one retry), plus, for a
# public fallback whose control passed, at most PUBLIC_RECHECKS_PER_PASS
# re-checks. A backlog therefore catches up over several hourly passes
# rather than in one burst, and every window read is kept whatever happens
# to the next one.
#
# Duration. Typical, measured: on 2026-09-25 bloXroute took about 13 seconds
# for one 4,901-block BSC page near budget #1, so 60 windows is about 120
# calls and about 26 minutes. Worst case, bloXroute plus QuickNode and no
# public fallback, every request running to the 45-second timeout: each
# topic of each window waits 45 s on bloXroute and 45 s on QuickNode, so
# 60 x 2 x 90 s = 3 h 00 min, plus eth_blockNumber (90 s) and the controls
# (two endpoints, two attempts each, 45 s and a 2 s pause: 3 min 4 s),
# about 3 h 5 min in all. The worker sleeps an hour after each pass, so such
# a pass delays the next rather than overlapping it. A pass with every
# endpoint failing ends at its first window, in about 3 minutes.
# 60 windows cover about 294,000 BSC blocks, well ahead of the roughly 8,000
# BSC adds in an hour.
#
# QuickNode credits, when QuickNode is BSC's failover, recomputed 2026-09-26:
# at most one QuickNode call per topic per window (the page after a primary
# error, or after an empty the primary could not vouch for), 120 a pass; its
# control, at most 2; eth_blockNumber, at most 1. That is 123 calls x 20 =
# 2,460 credits a pass. The cheapest way to reach that is a fast pass, so
# the daily worst is 24 full passes: 59,040 credits, 23.6% of the 250,000
# daily budget. Only chain 56 uses QuickNode. The backlog measured on
# 2026-09-26, 2,158,207 blocks, is 441 windows: at most 882 page calls plus
# 2 control and 1 head call per pass over 8 passes, 18,120 credits.
DEFAULT_MAX_PAGES_PER_PASS = 60

# A public fallback is a pool of nodes behind one URL, so its passed control
# is re-checked on each empty page it returns, but at most this many times
# per endpoint per pass. Past that its empties are not trusted for the pass.
PUBLIC_RECHECKS_PER_PASS = 10


def _max_pages_per_pass() -> int:
    raw = os.environ.get("BUDGET_INDEX_MAX_PAGES_PER_PASS", "")
    try:
        n = int(raw)
    except ValueError:
        return DEFAULT_MAX_PAGES_PER_PASS
    return n if n > 0 else DEFAULT_MAX_PAGES_PER_PASS


def _host(url: str) -> str:
    """Host only. Infura keeps its key in the path, so a URL is never logged
    whole, and neither is anything built from one. A QuickNode host is shown
    without its endpoint name."""
    if quicknode.is_quicknode(url):
        return quicknode.display_host(url)
    try:
        return urlsplit(url).hostname or "?"
    except ValueError:
        return "?"


# The database a refresh counts metered calls into. Set by refresh_chain for
# the length of its pass, so the helpers below need no extra argument and a
# call made outside a refresh is simply not counted.
_CREDIT_DB: contextvars.ContextVar = contextvars.ContextVar("budget_index_credit_db", default=None)


# Free public BSC endpoints tried after bloXroute and QuickNode, overridable
# with BSC_FALLBACK_RPC_URLS (comma-separated; set it empty for none).
#
# Empty by default, because none of the candidates measured on 2026-09-26
# passed both tests a fallback has to pass: the known-log control at block
# 120311961 and one 4,901-block eth_getLogs page there. Measured from a local
# machine, one or two requests each:
#
#   bsc-rpc.publicnode.com     HTTP 403, -32602 "Archive requests require a
#                              personal token". Serves recent ranges (a
#                              4,901-block page at the head answered []).
#   bsc.drpc.org               HTTP 429 on the control ("Public endpoint rate
#                              limit"); HTTP 400 code 35 on every ranged page,
#                              even 1,000 recent blocks ("ranges over 10000
#                              blocks are not supported on free plan").
#   bsc-dataseed.bnbchain.org  -32005 "limit exceeded" on every getLogs; BNB
#                              Chain's own docs say eth_getLogs is disabled on
#                              these endpoints. Same on the defibit and
#                              ninicoin dataseeds.
#   1rpc.io/bnb                -32000 "header not found" on the control;
#                              -32602 "limited to 0 - 50 blocks range".
#   bsc-mainnet.public.blastapi.io  HTTP 429, rate-limited.
#   bsc.meowrpc.com            "eth_getLogs is not supported".
#   rpc.ankr.com/bsc           now requires an API key.
#   bsc.blockpi.network        HTTP 521.
#   binance.llamarpc.com       connection refused.
#
# The full record, the terms read, and what would unblock a free fallback are
# in docs/deferred.md, "Budget index: a free BSC fallback after the QuickNode
# trial".
DEFAULT_BSC_PUBLIC_FALLBACKS: tuple[str, ...] = ()

PUBLIC_PROVIDER_PREFIX = "public:"

# QuickNode's disable switch, in two scopes.
#
# 401 is an authentication answer: the token is not valid, which is what an
# ended trial or a revoked token looks like, and it will not come right on its
# own. QuickNode is off for the rest of the process, so an hourly worker
# stops asking until it is restarted with a working token.
#
# 403 is a refusal that need not be about the token: an edge block, a
# method or IP rule, a burst limit. It switches QuickNode off for the rest of
# the current pass only, so one refusal cannot cost a pass dozens of wasted
# requests, and the next hourly pass tries again. Bounded either way: at most
# one 403 per pass, 24 a day.
#
# Only the exact host built from QUICKNODE_ENDPOINT can trip either switch.
_QUICKNODE_DISABLED: dict[str, str] = {}
_PASS_STATE: contextvars.ContextVar = contextvars.ContextVar("budget_index_pass_state", default=None)

# A control probe that fails with an error (timeout, 429, 5xx, -32603, a
# refused connection) is retried once after this many seconds. Only an
# honest answer, logs or an empty list, is cached for the pass.
CONTROL_RETRY_SECONDS = 2.0


def _public_fallbacks(chain_id: int) -> list[str]:
    if chain_id != 56:
        return []
    raw = os.environ.get("BSC_FALLBACK_RPC_URLS")
    if raw is None:
        return list(DEFAULT_BSC_PUBLIC_FALLBACKS)
    return [u.strip() for u in raw.split(",") if u.strip()]


def _quicknode_enabled() -> bool:
    if not quicknode.configured() or _QUICKNODE_DISABLED:
        return False
    state = _PASS_STATE.get()
    return not (state and state.get("quicknode_403"))


async def _post(client: httpx.AsyncClient, chain_id: int, url: str, payload: dict) -> httpx.Response:
    """Every request this module makes goes through here, so that the
    QuickNode token is attached per request and only to QuickNode, and every
    QuickNode and public-fallback call is counted. A call is counted once a
    response arrives, whatever its status, since that is the conservative
    reading of what the provider will bill. Public fallbacks count at 0
    credits under their own provider name, so their call volume is visible."""
    r = await client.post(url, json=payload, headers=quicknode.headers_for(url), timeout=45.0)
    if quicknode.is_configured_host(url):
        await rpc_credits.record(_CREDIT_DB.get(), quicknode.PROVIDER, chain_id)
        if r.status_code == 401 and not _QUICKNODE_DISABLED:
            _QUICKNODE_DISABLED["reason"] = "HTTP 401"
            _log(f"chain {chain_id}: QuickNode answered HTTP 401; disabled for the rest of "
                 f"this process (trial ended or token refused). Continuing with "
                 f"{len(_public_fallbacks(chain_id))} public fallback(s).")
        elif r.status_code == 403:
            state = _PASS_STATE.get()
            if state is not None and not state.get("quicknode_403"):
                state["quicknode_403"] = True
                _log(f"chain {chain_id}: QuickNode answered HTTP 403; skipped for the rest "
                     f"of this pass, tried again next pass.")
    elif url in _public_fallbacks(chain_id):
        await rpc_credits.record(_CREDIT_DB.get(), PUBLIC_PROVIDER_PREFIX + _host(url),
                                 chain_id, credits=0)
    return r


def _log(msg: str) -> None:
    print(f"[budget_index] {msg}", flush=True)

# Below this many budgets against one agent, no percentage is shown. A rate
# derived from one or two data points is a number pretending to be evidence.
# The UI takes this from the API rather than hardcoding its own threshold, so
# the rule cannot drift between the card and the detail page.
MIN_BUDGETS_FOR_RATE = 5


def _chain_urls(chain_id: int) -> list[str]:
    """Providers in the order they are tried.

    BSC, in order (owner decisions, 2026-09-25 and 2026-09-26):
      1. BSC_MAINNET_RPC_URL if set, else bloXroute. Unchanged.
      2. QuickNode BSC, when QUICKNODE_ENDPOINT and QUICKNODE_TOKEN are both
         set, it has not answered 401 in this process, and it has not
         answered 403 in this pass. It takes
         Infura's place: once QuickNode is configured, Infura is not used
         for BSC here, even after QuickNode is disabled.
         With QuickNode unset, this slot is core/rpc.py's failover, as before.
      3. The public fallbacks, BSC_FALLBACK_RPC_URLS or the default list.
    Every other chain: core/rpc.py's primary then failover, as before."""
    if chain_id == 56:
        second = (quicknode.url_for(56) if _quicknode_enabled() else None) \
            if quicknode.configured() else get_chain_fallback_rpc_url(56)
        urls = [u for u in (get_chain_rpc_url(56), second) if u]
        urls += [u for u in _public_fallbacks(56) if u not in urls]
    else:
        urls = [u for u in (get_chain_rpc_url(chain_id), get_chain_fallback_rpc_url(chain_id)) if u]
    if not urls:
        raise RuntimeError(f"no RPC configured for chain {chain_id}")
    return urls


async def _rpc_from(client: httpx.AsyncClient, chain_id: int, method: str,
                    params: list) -> tuple[Any, str]:
    """One JSON-RPC call, primary then failover, returning which URL answered.

    The answering URL is returned rather than discarded because an empty log
    page is only meaningful once you know who produced it. See
    `_provider_serves_logs`."""
    last: Exception | None = None
    for url in _chain_urls(chain_id):
        if quicknode.is_configured_host(url) and not _quicknode_enabled():
            continue
        try:
            r = await _post(client, chain_id, url,
                            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise JsonRpcError(body["error"])
            return body["result"], url
        except Exception as e:  # noqa: BLE001 -- try the failover, then report
            last = e
    # describe(), not the exception itself: the failover URL is Infura's, which
    # holds INFURA_API_KEY in its path, and raise_for_status() builds its
    # message from that full URL. describe() keeps a JSON-RPC error's code and
    # its redacted message. Same reason everything here logs `_host(url)`
    # rather than `url`. See core/safe_errors.py.
    raise RuntimeError(
        f"chain {chain_id} {method} failed on every RPC: "
        f"{describe(last) if last is not None else 'no endpoint answered'}"
    )


async def _rpc(client: httpx.AsyncClient, chain_id: int, method: str, params: list) -> Any:
    """One JSON-RPC call, primary then failover. Raises if both fail."""
    result, _ = await _rpc_from(client, chain_id, method, params)
    return result


async def _provider_serves_logs(client: httpx.AsyncClient, chain_id: int, url: str,
                                cache: dict[str, bool]) -> bool:
    """Does this endpoint actually answer eth_getLogs for this contract?

    WHY THIS EXISTS
    ---------------
    `_scan` treats an empty page as "no events in this range". That is only
    true if the provider looked. A provider that cannot serve a range is
    supposed to return an error, and the ones measured on 2026-09-14 do:
    bsc-dataseed rate-limits with -32005, Infura returns 429 or an explicit
    range error, publicnode returns 403. But a JSON-RPC 200 carrying
    `result: []` is indistinguishable from a real empty range, and nothing
    downstream could tell the difference. An under-counted draw reads as an
    agent that took money and delivered nothing, which is wrong in the
    direction that accuses somebody, so empty has to be earned rather than
    assumed.

    THE CONTROL
    -----------
    `FIRST_BUDGET_BLOCK[chain]` is a block that provably carries at least one
    log from this address, and it holds for both cases the table covers:
    on BSC, Arbitrum and Robinhood Chain it is budget #1's `BudgetOpened`,
    and on Ethereum it is the contract's creation block, where the
    constructor emits `OwnershipTransferred` and one `TokenAccepted` per
    accepted token. So a single-block, unfiltered `eth_getLogs` there must
    come back non-empty. A provider that returns `[]` for it is not answering,
    whatever its status code says.

    It is also the right block to probe rather than a convenient one: it is
    the oldest range any scan will ask for, so it is where a non-archive or
    depth-limited endpoint fails first.

    Costs one request per provider per pass when the answer is honest, and
    two at most when it is not. Logs, or an empty list, are cached for the
    pass. An error (timeout, 429, 5xx, -32603, refused connection) is retried
    once after CONTROL_RETRY_SECONDS; if the retry fails too, the endpoint is
    marked untrusted for the rest of the pass, so it costs no more control
    calls until the next pass tries it again. Re-asking on every empty page
    cost an erroring primary two calls a window, up to hours of timeouts.
    """
    if url in cache:
        return cache[url]
    block = FIRST_BUDGET_BLOCK.get(chain_id)
    addr = ESCROW_ADDRESS[chain_id]
    # Why the control failed, in words safe to log. The exception used to be
    # swallowed whole, so a failed control on Render read the same whether
    # the node rate-limited, capped the range, had pruned the block, or
    # answered an honest-looking empty list (2026-09-25).
    reason = ""
    for attempt in (1, 2):
        try:
            r = await _post(client, chain_id, url, {
                "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
                "params": [{"address": addr, "fromBlock": hex(block), "toBlock": hex(block)}],
            })
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise JsonRpcError(body["error"])
            result = body.get("result")
            if isinstance(result, list):
                # An honest answer either way: cached.
                ok = bool(result)
                cache[url] = ok
                if not ok:
                    _log(f"chain {chain_id}: known-log control failed on {_host(url)} at "
                         f"block {block}, where at least one log is known to exist (HTTP "
                         f"{r.status_code} with result []). Its empty pages are not "
                         f"trusted for this refresh.")
                return ok
            reason = f"HTTP {r.status_code} with result {type(result).__name__}"
        except Exception as e:  # noqa: BLE001 -- an unreachable control is a failed control
            # Class name always, then describe(): the HTTP status and any
            # JSON-RPC code and redacted message. Never str(e), which can
            # quote the URL.
            detail = describe(e)
            reason = type(e).__name__ if detail == type(e).__name__ else f"{type(e).__name__}, {detail}"
        if attempt == 1:
            await asyncio.sleep(CONTROL_RETRY_SECONDS)
    cache[url] = False
    _log(f"chain {chain_id}: known-log control could not be read on {_host(url)} at block "
         f"{block}, twice ({reason}). Its empty pages are not trusted for the rest of "
         f"this pass; tried again next pass.")
    return False


def _agent_from_drawn(log: dict) -> str:
    """Drawn's second indexed field is the agent address."""
    return "0x" + log["topics"][2][-40:].lower()


def _agent_from_opened(log: dict) -> str:
    """BudgetOpened's third indexed field is the agent address."""
    return "0x" + log["topics"][3][-40:].lower()


def _budget_id(log: dict) -> int:
    return int(log["topics"][1], 16)


async def _vouched(client: httpx.AsyncClient, chain_id: int, url: str,
                   cache: dict[str, bool]) -> bool:
    """May this endpoint's empty page be believed?

    Any endpoint: its control, probed at most twice a pass and then cached.
    A public fallback whose control has passed is asked again for this page,
    because the control may have reached an archive node and the page a
    pruned one behind the same URL; at most PUBLIC_RECHECKS_PER_PASS times a
    pass, after which its empties are not trusted for the pass. A failed
    re-check distrusts it for the rest of the pass."""
    if url not in cache:
        return await _provider_serves_logs(client, chain_id, url, cache)
    if not cache[url]:
        return False
    if url not in _public_fallbacks(chain_id):
        return True
    state = _PASS_STATE.get()
    if state is None:
        state = {}
    counts = state.setdefault("public_rechecks", {})
    if counts.get(url, 0) >= PUBLIC_RECHECKS_PER_PASS:
        if not state.setdefault("recheck_cap_logged", set()).__contains__(url):
            state["recheck_cap_logged"].add(url)
            _log(f"chain {chain_id}: {_host(url)} used its {PUBLIC_RECHECKS_PER_PASS} "
                 f"control re-checks this pass; its empty pages are not trusted until "
                 f"the next pass.")
        return False
    counts[url] = counts.get(url, 0) + 1
    ok = await _provider_serves_logs(client, chain_id, url, {})
    if not ok:
        cache[url] = False
    return ok


async def _scan_page(client: httpx.AsyncClient, chain_id: int, topic: str,
                     cur: int, end: int, cache: dict[str, bool]) -> list[dict]:
    """One eth_getLogs page, [cur, end] inclusive, for one topic.

    A page that fails on both RPCs raises rather than being skipped: a
    silently dropped page would under-count draws, and an under-counted draw
    reads as an agent that took money and delivered nothing. Wrong in the
    direction that accuses somebody.

    An EMPTY page is held to the same standard (2026-09-14). It used to be
    accepted on its face, which made "this range holds no events" and "this
    endpoint did not answer" the same outcome. Now an empty page is only
    accepted from a provider that has demonstrated, against a block known to
    carry a log, that it answers eth_getLogs for this contract at all. If the
    provider that produced the empty has not proved that, the page is retried
    on the other endpoint, and if no endpoint can prove it the page raises
    rather than being recorded as scanned over data nobody read.

    Non-empty pages need no such check: logs that came back are evidence the
    provider looked.

    Endpoints are asked in _chain_urls order. An endpoint that errors, or
    answers empty without having passed the control, hands the page to the
    next one; the page raises only when every endpoint has been tried, and
    the error names what each one did."""
    addr = ESCROW_ADDRESS[chain_id]
    params = [{"address": addr, "fromBlock": hex(cur), "toBlock": hex(end),
               "topics": [topic]}]
    outcomes: list[str] = []
    for url in _chain_urls(chain_id):
        if quicknode.is_configured_host(url) and not _quicknode_enabled():
            # Switched off by an earlier answer in this pass or process.
            continue
        try:
            r = await _post(client, chain_id, url, {
                "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs", "params": params,
            })
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise JsonRpcError(body["error"])
            logs = body["result"]
        except Exception as e:  # noqa: BLE001 -- next endpoint; reported without the URL
            outcomes.append(f"{_host(url)}: {type(e).__name__}, {describe(e)}")
            continue
        if logs:
            return logs
        if await _vouched(client, chain_id, url, cache):
            return logs
        outcomes.append(f"{_host(url)}: empty, not vouched for by the known-log control")
    raise RuntimeError(
        f"chain {chain_id} eth_getLogs {cur}-{end}: no endpoint gave an answer that "
        f"can be trusted ({'; '.join(outcomes) or 'none enabled'}). Refusing to record "
        f"the range as scanned."
    )


async def _scan(client: httpx.AsyncClient, chain_id: int, topic: str,
                from_block: int, to_block: int,
                serves_cache: dict[str, bool] | None = None) -> list[dict]:
    """Every page from from_block to to_block, all or nothing. Kept for
    one-off reads; refresh_chain pages through _scan_page itself so that each
    page is committed as it succeeds."""
    step = LOG_PAGE_BLOCKS.get(chain_id, DEFAULT_PAGE_BLOCKS)
    cache = serves_cache if serves_cache is not None else {}
    out: list[dict] = []
    cur = from_block
    while cur <= to_block:
        end = min(cur + step, to_block)
        out += await _scan_page(client, chain_id, topic, cur, end, cache)
        cur = end + 1
    return out


def _event_id(log: dict) -> str:
    """`txHash:logIndex`, the identity of one log. Unique on a chain, and the
    same every time the log is read, which is what makes a re-read page add
    nothing."""
    li = log.get("logIndex")
    li = int(li, 16) if isinstance(li, str) else int(li)
    return f"{str(log['transactionHash']).lower()}:{li}"


# A budget document before it has seen anything. `draws` stays equal to
# `legacy_draws + len(draw_ids)`; see the header.
_NEW_BUDGET = {"draws": 0, "legacy_draws": 0, "draw_ids": []}


async def _migrate_legacy_counts(db, chain_id: int) -> int:
    """Move this chain's pre-id documents onto the id scheme, once.

    Returns the chain's legacy block: every draw below it is already inside a
    `legacy_draws`, every draw at or above it is counted by id. Idempotent:
    a document already carrying `draw_ids` is not touched, and a chain that
    already has a legacy block keeps it. If this stops half way the next call
    finishes it, because the cursor has not moved in between."""
    progress = db[PROGRESS_COLLECTION]
    state = await progress.find_one({"chain_id": chain_id}) or {}
    if state.get("legacy_before_block") is not None:
        return int(state["legacy_before_block"])

    # Where the old cursor stood is exactly where the old counts end: the old
    # code wrote its counts and then moved the cursor to head + 1.
    boundary = int(state.get("next_block") or FIRST_BUDGET_BLOCK[chain_id])
    col = db[COLLECTION]
    migrated = 0
    async for doc in col.find({"chain_id": chain_id, "draw_ids": {"$exists": False}},
                              {"_id": 1, "draws": 1}):
        await col.update_one(
            {"_id": doc["_id"], "draw_ids": {"$exists": False}},
            {"$set": {"legacy_draws": int(doc.get("draws") or 0), "draw_ids": []}},
        )
        migrated += 1
    await progress.update_one(
        {"chain_id": chain_id},
        {"$set": {"legacy_before_block": boundary}},
        upsert=True,
    )
    _log(f"chain {chain_id}: {migrated} budget documents moved to draw ids; draws "
         f"below block {boundary} stay as their stored counts.")
    return boundary


UNIQUE_INDEX_NAME = "chain_budget_unique"


async def _ensure_unique_index(db) -> bool:
    """One document per (chain_id, budget_id), enforced by the database.

    The upserts in _record_page already key on that pair, but two upserts
    racing on a missing document can each insert one without a unique index,
    and a duplicate would count its budget twice in get_agent_budget_stats.
    create_index is a no-op when the index already exists, so this runs at
    the start of every refresh. Checked on 2026-09-26, read-only: the
    production collection held 5 documents, no duplicate pairs, and only the
    _id index. A failure (duplicates appearing later, or no permission) is
    logged and the refresh goes on, since the index protects against a race
    and its absence does not make any stored count wrong."""
    try:
        await db[COLLECTION].create_index(
            [("chain_id", 1), ("budget_id", 1)], unique=True, name=UNIQUE_INDEX_NAME)
        return True
    except Exception as e:  # noqa: BLE001 -- logged, the refresh goes on
        _log(f"could not ensure the unique ({COLLECTION}: chain_id, budget_id) index: "
             f"{type(e).__name__}, {describe(e)}")
        return False


async def _record_page(col, chain_id: int, opened: list[dict], drawn: list[dict],
                       legacy_before_block: int) -> dict:
    """Write one page's events. Every write is idempotent, so a page written
    twice leaves the documents exactly as a page written once."""
    new_draws = 0
    skipped_legacy = 0
    for log in opened:
        if log.get("removed"):
            continue
        await col.update_one(
            {"chain_id": chain_id, "budget_id": _budget_id(log)},
            {"$set": {
                "agent": _agent_from_opened(log),
                "opened_block": int(log["blockNumber"], 16),
                "opened_event": _event_id(log),
            }, "$setOnInsert": dict(_NEW_BUDGET)},
            upsert=True,
        )
    for log in drawn:
        if log.get("removed"):
            continue
        if int(log["blockNumber"], 16) < legacy_before_block:
            # Already inside this budget's legacy count. See the header.
            skipped_legacy += 1
            continue
        bid = _budget_id(log)
        key = {"chain_id": chain_id, "budget_id": bid}
        await col.update_one(
            key,
            {"$set": {"agent": _agent_from_drawn(log)}, "$setOnInsert": dict(_NEW_BUDGET)},
            upsert=True,
        )
        # The id test and the increment are one update, so the count can only
        # move when a new id goes in, and never on a re-read.
        eid = _event_id(log)
        r = await col.update_one(
            {**key, "draw_ids": {"$ne": eid}},
            {"$push": {"draw_ids": eid}, "$inc": {"draws": 1}},
        )
        new_draws += int(getattr(r, "modified_count", 0) or 0)
    return {"new_draws": new_draws, "skipped_legacy": skipped_legacy}


async def refresh_chain(db, chain_id: int, max_pages: int | None = None) -> dict:
    """Move one chain's budget index toward the current head.

    Stores one document per budget, keyed by (chain_id, budget_id), holding
    the agent it was opened against and the Drawn events recorded against it.

    Reads at most `max_pages` page windows (BUDGET_INDEX_MAX_PAGES_PER_PASS,
    default DEFAULT_MAX_PAGES_PER_PASS), and moves the cursor after each
    window whose two topics both succeeded. A failure raises, but every
    window before it is kept. The result says whether the chain is caught up
    and how far behind it still is, so a capped pass reads as partial rather
    than as done."""
    if chain_id not in ESCROW_ADDRESS:
        raise ValueError(f"chain {chain_id} has no AgentBudgetEscrow deployment")

    cap = max_pages if (max_pages and max_pages > 0) else _max_pages_per_pass()
    _CREDIT_DB.set(db)
    _PASS_STATE.set({})
    await _ensure_unique_index(db)
    legacy_before = await _migrate_legacy_counts(db, chain_id)

    progress = db[PROGRESS_COLLECTION]
    col = db[COLLECTION]
    state = await progress.find_one({"chain_id": chain_id}) or {}
    start = int(state.get("next_block") or FIRST_BUDGET_BLOCK[chain_id])
    step = LOG_PAGE_BLOCKS.get(chain_id, DEFAULT_PAGE_BLOCKS)

    pages = opened_n = drawn_n = new_draws = skipped_legacy = 0
    cur = start
    head = None
    async with httpx.AsyncClient() as client:
        head = int(await _rpc(client, chain_id, "eth_blockNumber", []), 16)
        if start > head:
            # Nothing new, and that is itself a fresh reading: the chain was
            # checked through to its head just now, so a quiet chain's
            # coverage time must not age as if it had not been.
            await progress.update_one({"chain_id": chain_id},
                                      {"$set": {"updated_at": int(time.time()), "last_error": None}},
                                      upsert=True)
            return {"chain_id": chain_id, "pages": 0, "next_block": start, "head": head,
                    "caught_up": True, "behind_blocks": 0}

        _log(f"chain {chain_id}: from block {start} to head {head}, "
             f"{head - start + 1} blocks, at most {cap} pages of {step + 1} this pass.")
        # One control cache for the whole pass, so each endpoint is probed at
        # most once per refresh rather than once per page or per topic.
        serves: dict[str, bool] = {}
        try:
            while cur <= head and pages < cap:
                end = min(cur + step, head)
                opened = await _scan_page(client, chain_id, OPENED_TOPIC, cur, end, serves)
                drawn = await _scan_page(client, chain_id, DRAWN_TOPIC, cur, end, serves)
                rec = await _record_page(col, chain_id, opened, drawn, legacy_before)
                # Only after both topics are read and written. A failure
                # before this line leaves the cursor at `cur`, and the page is
                # read again next pass, which the event ids make harmless.
                await progress.update_one(
                    {"chain_id": chain_id},
                    {"$set": {"next_block": end + 1, "head": head,
                              "behind_blocks": head - end,
                              "progress_at": int(time.time())}},
                    upsert=True,
                )
                pages += 1
                opened_n += len(opened)
                drawn_n += len(drawn)
                new_draws += rec["new_draws"]
                skipped_legacy += rec["skipped_legacy"]
                cur = end + 1
        except Exception as e:
            # The pages before this one are already committed. Recorded on the
            # progress document as well as the log, so the reason a chain is
            # behind can be read without the logs.
            # A plain RuntimeError is one of this module's own messages, which
            # name hosts and never URLs; it is still passed through redact().
            # Anything else is reduced to describe().
            why = (redact(str(e), 400) if type(e) is RuntimeError
                   else f"{type(e).__name__}: {describe(e)}")
            await progress.update_one(
                {"chain_id": chain_id},
                {"$set": {"last_error": why[:400], "last_error_at": int(time.time())}},
                upsert=True,
            )
            _log(f"chain {chain_id}: stopped at block {cur} after {pages} pages this pass "
                 f"(kept); {head - cur + 1} blocks still behind head {head}. {why}")
            raise

    caught_up = cur > head
    done: dict[str, Any] = {"last_error": None}
    if caught_up:
        # `updated_at` keeps its old meaning, the time the chain was last
        # indexed through to the head, because the coverage report reads it
        # as freshness. A capped pass moves `progress_at` only.
        done["updated_at"] = int(time.time())
    await progress.update_one({"chain_id": chain_id}, {"$set": done}, upsert=True)
    behind = max(0, head - cur + 1)
    _log(f"chain {chain_id}: {pages} pages, blocks {start}-{cur - 1}, {opened_n} opened, "
         f"{drawn_n} drawn ({new_draws} new, {skipped_legacy} below legacy block {legacy_before}); "
         + ("caught up." if caught_up else f"{behind} blocks behind head {head}, continues next pass."))
    return {"chain_id": chain_id, "pages": pages, "opened": opened_n, "drawn": drawn_n,
            "new_draws": new_draws, "next_block": cur, "head": head,
            "caught_up": caught_up, "behind_blocks": behind}


async def get_agent_budget_stats(db, chain_ids: list[int] | None = None) -> dict[str, dict]:
    """Per-agent budget record, keyed by lowercased agent address.

    `rate` is None below MIN_BUDGETS_FOR_RATE on purpose. The caller is meant
    to render the counts in that case and say the sample is too small, not to
    divide two small integers and print a percentage."""
    q: dict = {}
    if chain_ids:
        q["chain_id"] = {"$in": chain_ids}

    by_agent: dict[str, dict] = {}
    async for doc in db[COLLECTION].find(q, {"_id": 0}):
        agent = (doc.get("agent") or "").lower()
        if not agent:
            continue
        s = by_agent.setdefault(agent, {"funded": 0, "drawn_from": 0, "chains": set()})
        s["funded"] += 1
        if int(doc.get("draws") or 0) > 0:
            s["drawn_from"] += 1
        s["chains"].add(int(doc["chain_id"]))

    out: dict[str, dict] = {}
    for agent, s in by_agent.items():
        funded = s["funded"]
        enough = funded >= MIN_BUDGETS_FOR_RATE
        out[agent] = {
            "budgets_funded": funded,
            "budgets_drawn_from": s["drawn_from"],
            "budgets_never_drawn": funded - s["drawn_from"],
            "chains": sorted(s["chains"]),
            # Null below the threshold, so a caller cannot accidentally
            # render 0% off a single budget.
            "draw_rate": (s["drawn_from"] / funded) if enough else None,
            "sample_too_small": not enough,
            "min_for_rate": MIN_BUDGETS_FOR_RATE,
        }
    return out
