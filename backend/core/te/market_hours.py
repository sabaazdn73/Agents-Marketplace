"""
market_hours.py

Is the US equity market open at a given instant? NYSE regular session,
09:30 to 16:00 America/New_York, Monday to Friday, less the exchange's
full-day holidays and 13:00 early closes.

The holiday list is NYSE's published 2026 calendar, typed in. Outside the
years listed the answer is None with a reason, never a guess: a pool quote
taken while the market is shut is still a real quote, but a buyer should
know the underlying is not trading.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
CALENDAR_SOURCE = "NYSE holidays and trading hours (nyse.com/markets/hours-calendars), 2026, typed in"

HOLIDAYS = {
    2026: {"2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
           "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"},
}
EARLY_CLOSE = {
    2026: {"2026-11-27", "2026-12-24"},
}


def us_market_open(at: dt.datetime) -> tuple[bool | None, str]:
    """(open?, basis). None when the instant falls outside the calendar held."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=dt.timezone.utc)
    ny = at.astimezone(NY)
    if ny.year not in HOLIDAYS:
        return None, f"no NYSE calendar held for {ny.year}"
    day = ny.date().isoformat()
    if ny.weekday() >= 5:
        return False, "weekend"
    if day in HOLIDAYS[ny.year]:
        return False, "NYSE holiday"
    close = dt.time(13, 0) if day in EARLY_CLOSE[ny.year] else dt.time(16, 0)
    if dt.time(9, 30) <= ny.time() < close:
        return True, "NYSE regular session"
    return False, "outside the NYSE regular session"
