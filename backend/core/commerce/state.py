# state.py
#
# The shared task state every stage reads and writes, plus the money type.
#
# WHY MONEY IS ITS OWN TYPE AND NEVER A FLOAT
# -------------------------------------------
# `0.1 + 0.2 != 0.3` in IEEE 754, and a cart total is exactly the sum of a
# list of prices. Doing that in float means the total a user is shown can
# disagree with the total that gets charged, in the last decimal place, in a
# way that is invisible in testing and permanent on-chain. Worse here: the
# B402 assets are 18-decimal ERC-20s, and float64 carries ~15-17 significant
# digits, so a full-precision 18-decimal amount cannot round-trip through a
# float at all.
#
# So Money holds an INTEGER count of minor units plus the decimals that
# define them. Every arithmetic op is integer. `as_decimal()` exists for
# display only and returns a Decimal, never a float.

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict
from decimal import Decimal
from typing import Any


class MoneyError(ValueError):
    """Raised rather than silently coercing an unsafe amount."""


@dataclass(frozen=True)
class Money:
    """An exact amount. `units` is minor units: 1 USDT (18dp) is 10**18."""

    units: int
    decimals: int
    symbol: str

    def __post_init__(self) -> None:
        # A float here is the bug this class exists to prevent, so it is
        # rejected loudly at construction rather than quietly truncated.
        if isinstance(self.units, bool) or not isinstance(self.units, int):
            raise MoneyError(f"Money.units must be int, got {type(self.units).__name__}")
        if self.units < 0:
            raise MoneyError("Money.units must not be negative")
        if not isinstance(self.decimals, int) or not (0 <= self.decimals <= 36):
            raise MoneyError(f"implausible decimals: {self.decimals!r}")
        if not self.symbol or not isinstance(self.symbol, str):
            raise MoneyError("Money.symbol is required")

    def _same(self, other: "Money") -> None:
        if self.symbol != other.symbol or self.decimals != other.decimals:
            raise MoneyError(
                f"cannot combine {self.symbol}({self.decimals}dp) with "
                f"{other.symbol}({other.decimals}dp)"
            )

    def __add__(self, other: "Money") -> "Money":
        self._same(other)
        return Money(self.units + other.units, self.decimals, self.symbol)

    def __le__(self, other: "Money") -> bool:
        self._same(other)
        return self.units <= other.units

    def __gt__(self, other: "Money") -> bool:
        self._same(other)
        return self.units > other.units

    def as_decimal(self) -> Decimal:
        """Display only. Decimal, not float -- callers must not do maths on it."""
        return Decimal(self.units) / (Decimal(10) ** self.decimals)

    def __str__(self) -> str:
        return f"{self.as_decimal():f} {self.symbol}"

    @classmethod
    def from_decimal_string(cls, text: str, decimals: int, symbol: str) -> "Money":
        """Parse '12.34' exactly. Rejects more precision than the token has,
        rather than rounding someone's money without telling them."""
        d = Decimal(str(text))
        scaled = d * (Decimal(10) ** decimals)
        if scaled != scaled.to_integral_value():
            raise MoneyError(
                f"{text} has more precision than {symbol} supports ({decimals}dp)"
            )
        return cls(int(scaled), decimals, symbol)

    def to_dict(self) -> dict:
        # units as a STRING: JSON numbers are doubles in many parsers, and a
        # full 18-decimal value would lose precision crossing that boundary.
        return {
            "units": str(self.units),
            "decimals": self.decimals,
            "symbol": self.symbol,
            "display": str(self),
        }


@dataclass
class StageResult:
    """One stage's output plus the provenance that makes it diagnosable."""

    stage: str
    status: str                      # ok | not_implemented | degraded | error
    data: dict = field(default_factory=dict)
    note: str = ""
    started_at: float = 0.0
    ended_at: float = 0.0

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> dict:
        d = asdict(self)
        # asdict() turns a nested Money into plain fields with an integer
        # `units`; _encode puts it back through Money.to_dict() so units is
        # a string everywhere. See _encode for why that matters.
        d["data"] = _encode(self.data)
        d["duration_ms"] = round((self.ended_at - self.started_at) * 1000, 1)
        return d


@dataclass
class RejectionFinding:
    """What QA returns. A finding names the stage that caused it, which is
    the whole point of the split: 'over budget' is a Styling bug, 'size
    outside profile' is a Profile or Styling bug, 'link dead' is Search."""

    stage: str
    rule: str
    detail: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TaskState:
    """Everything the pipeline knows, carried stage to stage."""

    request: str
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    created_at: float = field(default_factory=time.time)

    profile: dict = field(default_factory=dict)
    context: dict = field(default_factory=dict)
    candidates: list = field(default_factory=list)
    selection: list = field(default_factory=list)
    findings: list = field(default_factory=list)   # list[RejectionFinding]
    payment: dict = field(default_factory=dict)

    stages: list = field(default_factory=list)     # list[StageResult]

    def record(self, result: StageResult) -> None:
        self.stages.append(result)

    def stage(self, name: str) -> StageResult | None:
        for s in reversed(self.stages):
            if s.stage == name:
                return s
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "request": self.request,
            "created_at": self.created_at,
            "profile": _encode(self.profile),
            "context": _encode(self.context),
            "candidates": _encode(self.candidates),
            "selection": _encode(self.selection),
            "findings": [f.to_dict() for f in self.findings],
            "payment": _encode(self.payment),
            "stages": [s.to_dict() for s in self.stages],
        }


def _encode(value: Any) -> Any:
    """Serialise Money through Money.to_dict() wherever it appears.

    Without this, a Money left in a free-form dict is encoded by FastAPI's
    own dataclass handling, which emits `units` as a JSON NUMBER. A budget of
    200 USDT at 18dp is 2e20, well past JavaScript's MAX_SAFE_INTEGER
    (~9.007e15), so a browser client would silently read back a different
    amount than the one stored. Caught by comparing the two shapes the API
    was emitting for the same value; to_dict() encodes units as a string
    precisely to avoid it, and everything must go through it.
    """
    if isinstance(value, Money):
        return value.to_dict()
    if isinstance(value, dict):
        return {k: _encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_encode(v) for v in value]
    return value
