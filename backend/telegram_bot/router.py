"""
POST /api/telegram/webhook

A Telegram bot that answers from structured queries and holds no conversation.

WHY A WEBHOOK AND NOT LONG POLLING
This process is recycled roughly hourly and runs on a plan that spins a service
down after fifteen minutes without INBOUND traffic. A getUpdates loop is
outbound traffic: it never resets that timer, so the service sleeps and the
loop stops existing rather than lagging. Render also suspends a free service
that initiates an uncommonly high volume of outbound traffic, naming external
API calls, and that suspension is undone only by paying. A webhook inverts all
of it: each update is inbound traffic that wakes the service, and there is no
loop to die. Telegram holds an undelivered update for 24 hours and retries on
any non-2XX, so a restart costs a few seconds, not a message.

WHY THERE IS NO MODEL HERE
The on-site agent was removed because it rested on a model quota that ran out,
and a way in that is unavailable most of the time is worse than one that is
absent. So this parses commands with regular expressions and calls the same
dataset handlers the MCP server calls. It cannot understand a sentence, and it
says so rather than guessing.

THE RULE THAT MATTERS MOST
Every withheld number stays withheld. The reason is decided in the service
layer, carried through the envelope, and rendered by render.py, which replaces
the rate line rather than filling it. A bot that prints 0% where a rate was
refused would undo the whole discipline in the one place a reader is least able
to check it.
"""

from __future__ import annotations

import asyncio
import hmac
import os
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from mcp_server import registry
from mcp_server.protocol import InFlight

from telegram_bot import render

WEBHOOK_SECRET = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")

# One turn at a time, refused rather than queued, exactly as the MCP surface
# does it. A separate instance so a burst of chat traffic cannot starve MCP and
# a slow MCP call cannot stall the bot.
GATE = InFlight()

# Update ids already answered. Telegram retries on any non-2XX and a retry that
# straddles a restart can arrive twice; this bounds the common case. It is lost
# on restart by design, because a duplicate correct answer is not a wrong
# answer and paying for a database write per message to avoid one is not a
# trade worth making.
_SEEN: dict[int, float] = {}
_SEEN_MAX = 512

HELP = (
    "<b>Tnega</b> answers from what this project has measured, and says when it "
    "cannot.\n\n"
    "<code>/address 0x…</code>  Hyperliquid post-only rejection for one address\n"
    "<code>/makers</code>  the tracked makers and their rates\n"
    "<code>/jobs 0x…</code>  ERC-8183 jobs for one provider\n"
    "<code>/budget 0x…</code>  budgets funded to one agent\n"
    "<code>/counts</code>  how many agents, by tier\n"
    "<code>/coverage</code>  what every dataset holds and how current it is\n"
    "<code>/whatis &lt;reason&gt;</code>  what a withheld reason means\n\n"
    "Send a bare <code>0x…</code> address and it will offer the three readings.\n\n"
    "<i>There is no model behind this. It runs fixed queries, so it understands "
    "commands and not sentences. A number that is not current is not shown, and "
    "the reply says why.</i>"
)

_ADDRESS = r"0x[0-9a-fA-F]{40}"


def _seen(update_id: int) -> bool:
    now = time.time()
    if update_id in _SEEN:
        return True
    if len(_SEEN) >= _SEEN_MAX:
        for k in sorted(_SEEN, key=_SEEN.get)[:_SEEN_MAX // 2]:
            _SEEN.pop(k, None)
    _SEEN[update_id] = now
    return False


def build_router(providers) -> APIRouter:
    router = APIRouter()
    datasets = registry.build(providers)

    async def answer(text: str) -> str:
        import re
        t = (text or "").strip()

        if t.startswith("/start") or t.startswith("/help"):
            return HELP

        m = re.match(r"^/address\s+(" + _ADDRESS + r")", t)
        if m:
            from core.hyperliquid import service
            d = await asyncio.to_thread(service.address_detail, m.group(1))
            return render.address_reply(d)

        if re.match(r"^/makers", t):
            from core.hyperliquid import service
            rows = await asyncio.to_thread(service.makers, 50)
            # Rated rows first. All 50 are shown to nobody: ten fit a phone,
            # and ten rows that all say "no longer being polled" would report
            # the rotation's history rather than its state. The footer carries
            # both counts so the ordering cannot hide the difference.
            rows = sorted(rows, key=lambda m: m.get("withheld_reason") is not None)
            cov = await asyncio.to_thread(service.coverage)
            return render.makers_reply(rows, cov)

        m = re.match(r"^/jobs\s+(" + _ADDRESS + r")", t)
        if m:
            d = datasets.get("jobs.erc8183")
            rec = await d.get(m.group(1))
            if not rec:
                return render.withheld_block("not_found")
            keys = ("hired", "completed", "submitted", "active", "rejected", "expired")
            bits = " · ".join(f"{k} {rec[k]}" for k in keys if k in rec)
            return (f"<b>{render.esc(render.short(m.group(1)))}</b> · ERC-8183 jobs\n\n"
                    f"{render.esc(bits)}\n\n"
                    "<i>SUBMITTED means delivered and not yet settled, and is counted "
                    "inside active too, so active alone cannot tell delivery from "
                    "silence. budget is what was escrowed, not what was paid.</i>")

        m = re.match(r"^/budget\s+(" + _ADDRESS + r")", t)
        if m:
            d = datasets.get("budgets.escrow")
            rec = await d.get(m.group(1))
            if not rec:
                return render.withheld_block("not_found")
            # "Budget escrow" until now. The dataset id says escrow and the
            # contract's name says escrow; neither makes it one, and this
            # header is all a bot reader gets.
            head = f"<b>{render.esc(render.short(m.group(1)))}</b> · Spending budgets\n\n"
            # sample_too_small is this dataset's withheld reason in all but
            # name: it nulls the rate and says why in a different field. Read
            # both, so the bot cannot be the surface that shows a null rate
            # with nothing beside it.
            if rec.get("draw_rate") is None:
                body = render.withheld_block(
                    "sample_too_small" if rec.get("sample_too_small") else None)
            else:
                body = f"<b>{render.pct(rec['draw_rate'])}</b> of budgets drawn from"
            return (head + body + "\n\n"
                    + render.esc(f"Funded {rec.get('budgets_funded', 0)} · "
                                 f"drawn from {rec.get('budgets_drawn_from', 0)} · "
                                 f"never drawn {rec.get('budgets_never_drawn', 0)}")
                    # Matches the caveat line the /jobs block already carries.
                    # A drawn budget is money taken, never work received.
                    + "\n\n<i>A spending budget is not an escrow: the agent draws "
                      "without having to deliver, and only the undrawn part can be "
                      "taken back. Drawn from means money was taken, not that "
                      "anything arrived.</i>")

        if re.match(r"^/counts", t):
            d = datasets.get("agents.index")
            s = await asyncio.to_thread(d.summary)
            if s.get("partial"):
                return ("<b>Agents</b>\n\nThe index is not loaded in this process "
                        "right now, so no counts are available. That is a gap in "
                        "this reply, not a count of zero.")
            return render.counts_reply(s)

        if re.match(r"^/coverage", t):
            rows = []
            for name, d in sorted(datasets.items()):
                try:
                    cov = await d.coverage()
                except Exception as e:  # noqa: BLE001
                    cov = {"partial": True, "unavailable": type(e).__name__}
                rows.append({"id": name, "coverage": cov})
            return render.coverage_reply(rows)

        m = re.match(r"^/whatis\s+(\w+)", t)
        if m:
            return render.whatis_reply(m.group(1))

        m = re.match(r"^(" + _ADDRESS + r")$", t)
        if m:
            return render.resolve_reply(m.group(1))

        return ("That is not a command this bot knows.\n\n" + HELP)

    @router.post("/api/telegram/webhook")
    async def webhook(request: Request):
        # The secret first, before the body is read or anything is touched.
        # The URL is public and anyone can POST to it; this header is the only
        # thing that distinguishes Telegram from everyone else. Same shape as
        # the batch-secret check elsewhere in this service.
        got = request.headers.get("x-telegram-bot-api-secret-token", "")
        if not WEBHOOK_SECRET or not hmac.compare_digest(got, WEBHOOK_SECRET):
            return JSONResponse(status_code=401, content={"ok": False})

        try:
            update = await request.json()
        except Exception:  # noqa: BLE001
            return JSONResponse({"ok": True})

        uid = update.get("update_id")
        message = update.get("message") or update.get("edited_message") or {}
        chat = (message.get("chat") or {}).get("id")
        text = message.get("text") or ""
        if not chat or not text:
            return JSONResponse({"ok": True})
        if isinstance(uid, int) and _seen(uid):
            return JSONResponse({"ok": True})

        if not GATE.acquire():
            # Refused, not queued, and told so in the same words the MCP
            # surface uses.
            return JSONResponse({
                "method": "sendMessage", "chat_id": chat,
                "text": "Busy answering another question. Ask again in a moment: "
                        "this refuses rather than queues.",
            })
        try:
            body = await answer(text)
        except Exception as e:  # noqa: BLE001
            body = ("That did not work. <i>" + render.esc(type(e).__name__)
                    + "</i>. Nothing was guessed in its place.")
        finally:
            GATE.release()

        # Answering in the webhook response: one round trip, no outbound call,
        # and the token never leaves the environment. The documented cost is
        # that the result of this send cannot be observed.
        return JSONResponse({
            "method": "sendMessage",
            "chat_id": chat,
            "text": body[:4000],
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        })

    return router
