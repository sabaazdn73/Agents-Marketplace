"""The bounds, and what stops this being a free model endpoint.

Every /api/* route in this service is public and unauthenticated by design,
and that posture is not changed here. What is different about this one is the
cost of answering: every other route spends this container's memory and
nothing else, and one question here spends model tokens on a key this project
pays for. Silence about that would be a decision too, so the decision is
written down.

There is no key system and no second auth scheme. There are four bounds, and a
caller that hits one is told which one it was and when it clears:

  1. The question is capped at 500 characters. A prompt cannot be smuggled in
     as a long question, and the token cost of the input half is fixed.
  2. Two turns at a time, process wide, refused rather than queued. Same
     reasoning as the MCP gate in mcp_server/protocol.py: a queue teaches a
     caller that the site is slow, and the usual answer to slow is to retry,
     which is how a queue becomes the load it was meant to prevent.
  3. Five questions per IP per fifteen minutes. This is a speed bump and is
     described as one: X-Forwarded-For is client supplied, so anyone willing
     to rotate it walks past this bound.
  4. Sixty questions per hour, process wide. This one is not spoofable, and it
     is the actual ceiling on what a day of traffic can cost. It is deliberately
     low enough that the first week is affordable while the shape of the load is
     unknown, and it is one constant to raise.

The turn itself is bounded as well, because the container has a 512MiB cap and
is OOM killed roughly hourly: four tool calls, 32KB of accumulated tool output,
and a 75 second wall clock, each enforced in loop.py.

MEMORY, SINCE THE PER-IP TABLE IS THE OBVIOUS PLACE TO LEAK ONE
A dict keyed by client address grows with the internet. It is capped at 512
addresses, pruned of expired entries on every check, and the oldest are evicted
when it is full, so the worst case is a few tens of kilobytes rather than an
unbounded map in the process that is already dying on memory.
"""

from __future__ import annotations

import time

# ── the question ─────────────────────────────────────────────────────────────
MAX_QUESTION_CHARS = 500
MIN_QUESTION_CHARS = 3

# ── the turn ─────────────────────────────────────────────────────────────────
#
# Four tool calls is enough for the shape a question actually takes here: find
# the dataset, narrow it, read one record, check the coverage. A loop that
# wants more than that is usually lost rather than thorough.
MAX_TOOL_CALLS = 4
MAX_MODEL_CALLS = MAX_TOOL_CALLS + 1          # the last one has to be an answer
MAX_EVIDENCE_BYTES = 32_000                   # tool output carried into the prompt
MODEL_STEP_TIMEOUT_SECONDS = 20.0             # per model call
TURN_DEADLINE_SECONDS = 75.0                  # hard wall clock for the whole turn

# ── the traffic ──────────────────────────────────────────────────────────────
CONCURRENT_TURNS = 2
PER_IP_QUESTIONS = 5
PER_IP_WINDOW_SECONDS = 900
PROCESS_QUESTIONS_PER_HOUR = 60
MAX_TRACKED_IPS = 512


def describe() -> dict:
    """The bounds, as the readiness endpoint and the refusals report them."""
    return {
        "question_chars_max": MAX_QUESTION_CHARS,
        "tool_calls_max": MAX_TOOL_CALLS,
        "evidence_bytes_max": MAX_EVIDENCE_BYTES,
        "turn_deadline_seconds": TURN_DEADLINE_SECONDS,
        "concurrent_turns": CONCURRENT_TURNS,
        "per_ip_questions": PER_IP_QUESTIONS,
        "per_ip_window_seconds": PER_IP_WINDOW_SECONDS,
        "process_questions_per_hour": PROCESS_QUESTIONS_PER_HOUR,
    }


class Gate:
    """A few turns at a time, refused on contention rather than queued."""

    def __init__(self, limit: int = CONCURRENT_TURNS) -> None:
        self.limit = limit
        self.in_flight = 0
        self.refused = 0

    def acquire(self) -> bool:
        if self.in_flight >= self.limit:
            self.refused += 1
            return False
        self.in_flight += 1
        return True

    def release(self) -> None:
        self.in_flight = max(0, self.in_flight - 1)


class Budget:
    """Per address and per process, both, because one of them is spoofable.

    The per-address half is a speed bump: the address comes from
    X-Forwarded-For, which the client writes. The per-process half is what
    actually caps the spend, and nothing a caller sends can move it.
    """

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._process: list[float] = []

    def _prune(self, now: float) -> None:
        cutoff = now - PER_IP_WINDOW_SECONDS
        for ip in [k for k, v in self._hits.items() if not v or v[-1] < cutoff]:
            del self._hits[ip]
        if len(self._hits) > MAX_TRACKED_IPS:
            # Oldest last-seen first. The table is a rate limiter, not a
            # ledger, so losing the coldest entries costs nothing that matters.
            for ip, _ in sorted(self._hits.items(), key=lambda kv: kv[1][-1]
                                )[:len(self._hits) - MAX_TRACKED_IPS]:
                del self._hits[ip]
        self._process = [t for t in self._process if t > now - 3600]

    def check(self, ip: str) -> tuple[bool, dict]:
        """Ask before spending. Does not record the question; see `record`."""
        now = time.time()
        self._prune(now)

        if len(self._process) >= PROCESS_QUESTIONS_PER_HOUR:
            oldest = min(self._process)
            return False, {
                "limit": "process",
                "allowed": PROCESS_QUESTIONS_PER_HOUR,
                "window_seconds": 3600,
                "retry_after_seconds": int(max(1, 3600 - (now - oldest))),
            }

        mine = [t for t in self._hits.get(ip, []) if t > now - PER_IP_WINDOW_SECONDS]
        if len(mine) >= PER_IP_QUESTIONS:
            return False, {
                "limit": "per_ip",
                "allowed": PER_IP_QUESTIONS,
                "window_seconds": PER_IP_WINDOW_SECONDS,
                "retry_after_seconds": int(max(1, PER_IP_WINDOW_SECONDS - (now - min(mine)))),
            }
        return True, {"remaining_this_ip": PER_IP_QUESTIONS - len(mine),
                      "remaining_this_hour": PROCESS_QUESTIONS_PER_HOUR - len(self._process)}

    def record(self, ip: str) -> None:
        """Count a question that is about to cost model tokens.

        Counted at the point of spend rather than at the point of arrival, so a
        request refused for its length or for a missing key never consumes
        anyone's allowance.
        """
        now = time.time()
        mine = [t for t in self._hits.get(ip, []) if t > now - PER_IP_WINDOW_SECONDS]
        mine.append(now)
        self._hits[ip] = mine[-PER_IP_QUESTIONS:]
        self._process.append(now)

    def snapshot(self) -> dict:
        now = time.time()
        self._prune(now)
        return {"addresses_tracked": len(self._hits),
                "questions_this_hour": len(self._process),
                "questions_per_hour": PROCESS_QUESTIONS_PER_HOUR}


class Outcomes:
    """What the last few turns actually did, so readiness reports availability
    rather than configuration.

    A key that is present, valid and over its quota looks identical to a
    working one from the outside: `configured: true` is a fact about the
    environment and says nothing about whether a question asked now would be
    answered. This records what happened, and readiness carries it, so a reader
    deciding whether to point traffic here is told that the last four turns all
    failed instead of being told a key exists.

    In memory and per process, like every other counter in this file. It is
    lost on a restart, and an empty record says "nothing observed yet", which
    is not "everything is fine".
    """

    KEEP = 20

    def __init__(self) -> None:
        self._turns: list[dict] = []

    def record(self, answered: bool, guards: list[str] | None) -> None:
        self._turns.append({"at": time.time(), "answered": bool(answered),
                            "guards": list(guards or [])})
        self._turns = self._turns[-self.KEEP:]

    def snapshot(self) -> dict:
        if not self._turns:
            return {"turns_observed": 0, "answered": None,
                    "consecutive_failures": 0, "last_failure": None,
                    "last_failure_seconds_ago": None,
                    "note": "No question has been asked of this process yet. "
                            "That is not evidence that it answers."}
        consecutive = 0
        for turn in reversed(self._turns):
            if turn["answered"]:
                break
            consecutive += 1
        failures = [t for t in self._turns if not t["answered"]]
        last = failures[-1] if failures else None
        return {
            "turns_observed": len(self._turns),
            "answered": sum(1 for t in self._turns if t["answered"]),
            "consecutive_failures": consecutive,
            "last_failure": (last["guards"] or ["unknown"])[0] if last else None,
            "last_failure_seconds_ago": round(time.time() - last["at"], 1) if last else None,
        }


GATE = Gate()
BUDGET = Budget()
OUTCOMES = Outcomes()


def client_ip(headers, fallback: str | None) -> str:
    """The first hop of X-Forwarded-For, which is what Render sets.

    Client supplied and therefore not identity. It is used to spread a small
    allowance over many callers, not to decide who anybody is.
    """
    fwd = (headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return (fwd or fallback or "unknown")[:64]
