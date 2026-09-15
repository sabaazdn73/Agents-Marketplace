"""
ws_collector.py

Second collector, on the orderUpdates WebSocket feed, at seconds resolution.

WHY A SECOND COLLECTOR RATHER THAN A REPLACEMENT
------------------------------------------------
The REST collector polls every 15 minutes and measures levels, which are
stable and which the tab depends on. It stays.

What it cannot do is answer whether the rejection rate is predictable. Tested
on its own series, within address, demeaned, and restricted to non-overlapping
windows, the lag-1 autocorrelation was -0.547. The same quantity bucketed at 30
seconds inside a single response gave +0.536 on one address and -0.076 on
another. The reading that fits both is that the phenomenon lives at seconds and
is gone by minutes, which would mean the REST collector samples slower than the
thing it would predict. This collector exists to find out.

WHAT THE FEED GIVES, AND THE ONE THING IT DOES NOT
--------------------------------------------------
orderUpdates is public for arbitrary addresses, which was not obvious and was
tested: a first probe returned nothing and looked like a permissions wall, but
the address was simply quiet. Against an active maker it returns about 7,300
updates a minute, and it carries the typed statuses, badAloPxRejected among
them. There is no 2,000-record cap and no sampling.

It does not carry `tif`. Every one of 6,917 updates in a 30-second probe had
`tif: None`, where the REST response carries it. So the ALO denominator the
REST metric uses cannot be reconstructed from this feed alone.

That matters and is not worked around here. `badAloPxRejected` can only happen
to a post-only order, so the numerator is exact. The denominator is not the
same quantity, so this collector stores counts by status rather than a ratio,
and any rate computed from it must say which denominator it used. The two
collectors measure related but distinct things and their numbers should not be
placed side by side as though they were the same.

THE LIMIT THAT SETS THE ADDRESS COUNT
-------------------------------------
Hyperliquid allows "a maximum of 10 unique users across user-specific websocket
subscriptions" per IP. Ten, not fifty. The ten are chosen from the REST
collector's own data: at least 2,000 post-only orders observed, and a rejection
rate strictly inside 0.2% to 98%. An address pinned at zero or at one has no
variance, so it cannot exhibit or refute persistence no matter how long it is
watched.
"""

from __future__ import annotations

import asyncio
import collections
import datetime as dt
import json
import random
import time

WS_URL = "wss://api.hyperliquid.xyz/ws"


class _SubscriptionRefused(Exception):
    """The server answered the subscribe with channel 'error'."""


class _SubscriptionStalled(Exception):
    """The socket is open but has stopped delivering what it promised."""


# How long one recv may block before the loop checks liveness. Short enough
# that a stalled socket is noticed promptly, long enough not to spin.
RECV_TIMEOUT = 30
# No orderUpdates for this long means the subscription is rebuilt. A genuinely
# idle maker is rebuilt too, which costs one handshake and is the price of not
# being able to tell idle from dead on the wire. The coverage row records which
# it was, so the ambiguity is visible rather than silent.
IDLE_RESUBSCRIBE_SECONDS = 300
# No frames of ANY kind, including pongs, means the transport is gone.
SOCKET_DEAD_SECONDS = 90
RECONNECT_BASE_SECONDS = 2
RECONNECT_JITTER_SECONDS = 8
# Coverage for buckets long past is not worth writing after a stall.
MAX_COVERAGE_BACKLOG_BUCKETS = 60

# Per-IP ceiling on user-specific subscriptions. Not a preference.
MAX_WS_USERS = 10

# Bucket width. The signal under test sits at tens of seconds, so buckets have
# to be well under that to resolve it. Ten seconds against an active maker is
# on the order of 1,000 updates, which is a large enough sample for a rate.
BUCKET_SECONDS = 10

# How often accumulated buckets are written. Buckets are only flushed once
# closed, so a partial bucket is never stored as though it were complete.
FLUSH_SECONDS = 60


def bucket_key(ms: int) -> int:
    return int(ms / 1000 // BUCKET_SECONDS) * BUCKET_SECONDS


class Aggregator:
    """Accumulates updates into closed time buckets keyed by
    (bucket_start, address, coin, status)."""

    def __init__(self):
        self.counts: dict[tuple, int] = collections.defaultdict(int)
        self.seen_oids: dict[tuple, set] = collections.defaultdict(set)

    def add(self, address: str, update: dict) -> None:
        order = update.get("order") or {}
        status = update.get("status") or "unknown"
        ts = update.get("statusTimestamp") or order.get("timestamp")
        if not ts:
            return
        b = bucket_key(int(ts))
        coin = order.get("coin") or "unknown"
        self.counts[(b, address, coin, status)] += 1
        oid = order.get("oid")
        if oid is not None:
            self.seen_oids[(b, address)].add(oid)

    def closed(self, now_s: float) -> list[tuple]:
        """Buckets whose window has fully elapsed. A bucket is closed once the
        clock has moved past its end, so a rate is never computed from a window
        that is still filling."""
        cutoff = int(now_s // BUCKET_SECONDS) * BUCKET_SECONDS
        return [k for k in self.counts if k[0] < cutoff]

    def drain(self, keys: list[tuple]) -> list[dict]:
        out = []
        for k in keys:
            b, address, coin, status = k
            out.append({
                "bucket_start": dt.datetime.fromtimestamp(b, dt.UTC),
                "address": address, "coin": coin, "status": status,
                "n": self.counts.pop(k),
            })
        for (b, address) in list(self.seen_oids):
            if b < min((k[0] for k in self.counts), default=b + 1):
                self.seen_oids.pop((b, address), None)
        return out


async def _watch_one(address: str, agg: "Aggregator", stats: dict,
                     stop_at: float | None, log) -> None:
    """One connection, one address.

    Deliberately not multiplexed. The orderUpdates envelope is {channel, data}
    and the data items are {order, status, statusTimestamp}: nothing anywhere
    in the message names the address it belongs to. Subscribing several users
    on one socket therefore makes attribution impossible, and an earlier
    version of this file did exactly that and silently recorded zero updates
    out of 5,436 messages.

    The per-IP limits permit this precisely: 10 connections and 10 unique
    users, so ten sockets carrying one address each fits with nothing spare.
    """
    import websockets
    st = stats["per_address"][address]
    while True:
        if stop_at and time.time() > stop_at:
            return
        try:
            async with websockets.connect(WS_URL, ping_interval=20,
                                          max_size=16 * 1024 * 1024) as ws:
                await ws.send(json.dumps({
                    "method": "subscribe",
                    "subscription": {"type": "orderUpdates", "user": address}}))
                st["subscribed"] = False
                st["confirmed_at"] = None
                last_rx = time.time()      # any frame, proves the socket lives
                last_update = time.time()  # an orderUpdate, proves the SUB lives
                while True:
                    if stop_at and time.time() > stop_at:
                        return
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=RECV_TIMEOUT)
                    except asyncio.TimeoutError:
                        # Silence is no longer treated as normal. The socket is
                        # probed, and if the subscription has been quiet past
                        # the deadline it is torn down and rebuilt.
                        now = time.time()
                        if now - last_update > IDLE_RESUBSCRIBE_SECONDS:
                            raise _SubscriptionStalled(
                                f"no orderUpdates for {now - last_update:.0f}s")
                        await ws.send(json.dumps({"method": "ping"}))
                        if now - last_rx > SOCKET_DEAD_SECONDS:
                            raise _SubscriptionStalled(
                                f"no frames at all for {now - last_rx:.0f}s")
                        continue

                    last_rx = time.time()
                    m = json.loads(raw)
                    stats["messages"] += 1
                    st["messages"] += 1
                    channel = m.get("channel")

                    # The two channels the old loop discarded. They are the
                    # only confirmation, and the only rejection, the server
                    # ever sends.
                    if channel == "subscriptionResponse":
                        st["subscribed"] = True
                        st["confirmed_at"] = dt.datetime.now(dt.UTC)
                        log(f"[hl-ws] {address[:10]} subscription confirmed", flush=True)
                        continue
                    if channel == "error":
                        raise _SubscriptionRefused(str(m.get("data"))[:160])
                    if channel == "pong":
                        continue
                    if channel != "orderUpdates":
                        continue

                    # An orderUpdate on an unconfirmed socket still counts, but
                    # say so: it means the ack was missed rather than absent.
                    if not st["subscribed"]:
                        st["subscribed"] = True
                        st["confirmed_at"] = dt.datetime.now(dt.UTC)
                    last_update = time.time()
                    st["last_update_at"] = last_update
                    for u in m.get("data") or []:
                        agg.add(address, u)
                        stats["updates"] += 1
                        st["updates"] += 1
        except Exception as e:  # noqa: BLE001 -- reconnect, and say so
            stats["reconnects"] += 1
            st["reconnects"] += 1
            st["subscribed"] = False
            st["confirmed_at"] = None
            log(f"[hl-ws] {address[:10]} dropped ({type(e).__name__}: {str(e)[:80]}), "
                f"reconnecting", flush=True)
            # Jittered, and keyed off this address rather than a shared clock.
            # Ten sockets reconnecting on the same instant after a wake is what
            # walks into the 10-unique-user cap and gets some of them refused.
            await asyncio.sleep(RECONNECT_BASE_SECONDS + random.uniform(0, RECONNECT_JITTER_SECONDS))


def _coverage_rows(addresses: list[str], drained: list[dict],
                   buckets: list[int], stats: dict) -> list[dict]:
    """One row per (closed bucket, watched address).

    Update counts come from the rows actually drained for that bucket, so a
    zero is exact rather than assumed. `idle_seconds` and `subscribed` are a
    snapshot taken at flush time and applied to every bucket in the flush:
    they describe the socket, which does not have per-bucket state, and the
    flush is a minute wide at most.
    """
    if not buckets:
        return []
    seen: dict[tuple, int] = {}
    for r in drained:
        key = (r["bucket_start"], r["address"])
        seen[key] = seen.get(key, 0) + r["n"]
    now = time.time()
    out = []
    for b in buckets:
        b_dt = dt.datetime.fromtimestamp(b, dt.UTC) if isinstance(b, (int, float)) else b
        for a in addresses:
            st = stats["per_address"][a]
            last = st.get("last_update_at")
            out.append({
                "bucket_start": b_dt,
                "address": a,
                "subscribed": bool(st.get("subscribed")),
                "confirmed_at": st.get("confirmed_at"),
                "idle_seconds": (now - last) if last else None,
                "updates": seen.get((b_dt, a), 0),
                "reconnects": st.get("reconnects", 0),
            })
    return out


def _blank_address_stats() -> dict:
    return {"updates": 0, "messages": 0, "reconnects": 0,
            "subscribed": False, "confirmed_at": None, "last_update_at": None,
            "updates_at_last_flush": 0}


async def run(addresses: list[str], write, stop_after: float | None = None,
              log=print, write_coverage=None) -> dict:
    """Watch every address on its own connection and flush closed buckets."""
    if len(addresses) > MAX_WS_USERS:
        raise ValueError(
            f"{len(addresses)} addresses exceeds Hyperliquid's limit of "
            f"{MAX_WS_USERS} unique users per IP for user subscriptions")

    agg = Aggregator()
    # Per-address as well as total. The totals alone cannot say which socket
    # went quiet, which is why a 6-of-10 degradation was only visible in a
    # post-mortem of the bucket table.
    stats = {"updates": 0, "messages": 0, "reconnects": 0, "rows_written": 0,
             "coverage_rows": 0,
             "per_address": {a: _blank_address_stats() for a in addresses}}
    stop_at = (time.time() + stop_after) if stop_after else None

    watchers = [asyncio.create_task(_watch_one(a, agg, stats, stop_at, log))
                for a in addresses]
    log(f"[hl-ws] {len(addresses)} connections open, one per address", flush=True)

    async def flusher():
        # The write is synchronous and goes to a database whose connection has
        # been sitting idle while ten sockets stream. Two things follow.
        # It runs in a thread, so a slow or hung write cannot stall the
        # sockets, and it is bounded by a timeout, so it cannot hang forever.
        # The first version did neither: the very first flush blocked on a
        # stale connection and the task never came back. There was no error
        # and no log line, so 10 addresses streamed for six minutes into
        # memory and nothing reached the database. A flush that fails now says
        # so and says how much was lost.
        covered_through = None
        while True:
            if stop_at and time.time() > stop_at:
                return
            await asyncio.sleep(FLUSH_SECONDS)
            now = time.time()
            keys = agg.closed(now)
            rows = agg.drain(keys) if keys else []

            if rows:
                try:
                    await asyncio.wait_for(asyncio.to_thread(write, rows), timeout=45)
                    stats["rows_written"] += len(rows)
                    log(f"[hl-ws] flushed {len(rows)} bucket rows, "
                        f"{stats['updates']:,} updates so far", flush=True)
                except Exception as e:  # noqa: BLE001
                    stats["write_failures"] = stats.get("write_failures", 0) + 1
                    log(f"[hl-ws] FLUSH FAILED ({type(e).__name__}: {str(e)[:90]}), "
                        f"{len(rows)} bucket rows lost", flush=True)

            # Coverage is derived from the CLOCK, never from the data.
            #
            # An earlier version of this computed it from the drained buckets,
            # which reintroduced the exact fault it exists to remove: with
            # every socket silent there are no buckets, so there was nothing to
            # derive coverage from and nothing was written. A collector
            # delivering nothing produced no evidence that it was delivering
            # nothing. Bucket boundaries are a function of time, so they are
            # taken from time.
            cutoff = int(now // BUCKET_SECONDS) * BUCKET_SECONDS
            if covered_through is None:
                covered_through = cutoff - BUCKET_SECONDS
            due = list(range(covered_through + BUCKET_SECONDS, cutoff, BUCKET_SECONDS))
            # After a stall the backlog could be enormous; coverage for a window
            # nobody was watching is not worth writing.
            due = due[-MAX_COVERAGE_BACKLOG_BUCKETS:]
            if due:
                cov = _coverage_rows(addresses, rows, due, stats)
                covered_through = due[-1]
                live = sum(1 for a in addresses
                           if stats["per_address"][a]["subscribed"])
                log(f"[hl-ws] coverage {live}/{len(addresses)} subscribed, "
                    f"{len(due)} buckets", flush=True)
                if write_coverage:
                    try:
                        await asyncio.wait_for(
                            asyncio.to_thread(write_coverage, cov), timeout=45)
                        stats["coverage_rows"] += len(cov)
                    except Exception as e:  # noqa: BLE001
                        stats["coverage_failures"] = stats.get("coverage_failures", 0) + 1
                        log(f"[hl-ws] COVERAGE WRITE FAILED ({type(e).__name__}: "
                            f"{str(e)[:90]})", flush=True)

    f = asyncio.create_task(flusher())
    await asyncio.gather(*watchers, f, return_exceptions=True)

    keys = agg.closed(time.time() + BUCKET_SECONDS)
    if keys:
        rows = agg.drain(keys)
        write(rows)
        stats["rows_written"] += len(rows)
    return stats
